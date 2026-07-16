#!/usr/bin/env node
// gen-sentences.mjs — content pipeline for the Ulpan sentence-production engine (P2).
//
// The engine (app.js openSentenceBuilder) consumes a per-lesson `window.SENTENCES`
// array of { he, translit, fr, chunks, distractors, focus }. Hand-eyeballing the
// `chunks` (word boundaries with correct niqqud) is exactly where a teaching app can
// ship wrong Hebrew, so this script offloads that to the live Dicta morphology Worker:
// it vocalizes each phrase, reads the REAL token boundaries, and derives `chunks`
// from them. Distractors + focus stay a human/pedagogical decision (a `// TODO`
// placeholder is emitted per item).
//
// Usage:
//   node tools/gen-sentences.mjs suggest <lesson.html> [--phrases "p1|p2|..."]
//        Auto-extract multi-word phrases from the lesson's { he, translit, fr } arrays
//        (or use the ones passed via --phrases), enrich each through Dicta, and print a
//        ready-to-paste SENTENCES skeleton with real chunks + TODO distractors/focus.
//
//   node tools/gen-sentences.mjs --validate <lesson.html> [lesson2.html ...]
//        Regression guard: extract the he strings already in each file's window.SENTENCES
//        and confirm every one vocalizes cleanly through Dicta AND that its authored
//        `chunks` partition the phrase exactly (niqqud-agnostic). Exit non-zero on any
//        failure so it can gate a deploy.
//
// Config-driven, no secrets. Override the endpoint with MORPH_URL=... if needed.

import { readFile } from 'node:fs/promises';

const MORPH_URL = process.env.MORPH_URL || 'https://ulpan-morph.olamcreations.workers.dev';

// Reduce a string to its bare consonantal skeleton: drop niqqud+cantillation (U+0591–U+05C7),
// whitespace, and punctuation. Dicta returns punctuation/space as separator tokens (voc:null)
// that never appear in the word list, so comparisons must be punctuation-agnostic on both sides
// or every phrase with a comma / '?' would look like a mismatch.
const strip = (s) => (s || '')
  .replace(/[֑-ׇ]/g, '')            // niqqud + cantillation marks
  .replace(/[\s,.?!;:'"״׳()־-]/g, '');  // whitespace + ASCII/Hebrew punctuation

async function morph(text) {
  const res = await fetch(MORPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // JSON.stringify keeps the Hebrew as proper UTF-8 in the body.
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`morph HTTP ${res.status} for "${text}"`);
  const data = await res.json();
  if (!data || !Array.isArray(data.tokens)) throw new Error(`morph: no tokens for "${text}"`);
  return data.tokens;
}

// Real word boundaries: every non-separator token is one vocalized word. Separators
// (spaces, punctuation) carry voc:null / sep:true and are dropped. This is what makes
// the chunks trustworthy instead of naive space-splitting.
function wordsFromTokens(tokens) {
  return tokens.filter((t) => !t.sep && t.voc).map((t) => t.voc);
}

// "Clean" = Dicta vocalized every word token, and the reconstructed consonantal skeleton
// matches the input (Dicta neither dropped nor invented letters).
function vocalizationReport(he, tokens) {
  const wordTokens = tokens.filter((t) => !t.sep);
  const missing = wordTokens.filter((t) => !t.voc);
  const recon = strip(wordsFromTokens(tokens).join(''));
  const src = strip(he);
  return {
    clean: missing.length === 0 && recon === src,
    missing: missing.map((t) => t.word),
    reconMismatch: recon !== src ? { src, recon } : null,
    words: wordsFromTokens(tokens),
  };
}

// --- lesson HTML parsing (regex, no JS eval) -------------------------------------
// The lesson arrays are literal `{ he: '...', translit: '...', fr: '...' }` objects in
// a fixed key order. Hebrew phrases never contain a straight single quote, so a simple
// quoted-string capture is safe here.
const OBJ_RE = /\{\s*he:\s*'((?:[^'\\]|\\.)*)'\s*,\s*translit:\s*'((?:[^'\\]|\\.)*)'\s*,\s*fr:\s*'((?:[^'\\]|\\.)*)'/g;

function extractPhrases(html) {
  const out = [];
  const seen = new Set();
  let m;
  while ((m = OBJ_RE.exec(html))) {
    const he = m[1].trim();
    if (!he.includes(' ')) continue;            // multi-word only — single words aren't sentences
    if (seen.has(he)) continue;
    seen.add(he);
    out.push({ he, translit: m[2], fr: m[3] });
  }
  return out;
}

// Pull just the window.SENTENCES = [ ... ]; block for --validate.
function extractSentencesBlock(html) {
  const start = html.indexOf('window.SENTENCES');
  if (start < 0) return null;
  const open = html.indexOf('[', start);
  if (open < 0) return null;
  let depth = 0, i = open;
  for (; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(open, i);
}

// Parse { he, chunks } out of a SENTENCES block (order-independent for these two keys).
function parseSentenceItems(block) {
  const items = [];
  // Split into object literals at top level by tracking braces.
  let depth = 0, buf = '';
  for (const ch of block) {
    if (ch === '{') { if (depth === 0) buf = ''; depth++; }
    if (depth > 0) buf += ch;
    if (ch === '}') { depth--; if (depth === 0) { items.push(buf); } }
  }
  return items.map((obj) => {
    const heM = obj.match(/he:\s*'((?:[^'\\]|\\.)*)'/);
    const chM = obj.match(/chunks:\s*\[([^\]]*)\]/);
    const chunks = chM
      ? [...chM[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1])
      : [];
    return heM ? { he: heM[1], chunks } : null;
  }).filter(Boolean);
}

function esc(s) { return s.replace(/'/g, "\\'"); }

async function cmdSuggest(file, phraseArg) {
  const html = await readFile(file, 'utf8');
  let phrases;
  if (phraseArg) {
    const wanted = phraseArg.split('|').map((s) => s.trim()).filter(Boolean);
    const all = extractPhrases(html);
    phrases = wanted.map((he) => all.find((p) => p.he === he) || { he, translit: '', fr: '' });
  } else {
    phrases = extractPhrases(html);
  }
  console.log(`// ${phrases.length} candidate phrase(s) from ${file}`);
  console.log('window.SENTENCES = [');
  for (const p of phrases) {
    let tokens;
    try { tokens = await morph(p.he); }
    catch (e) { console.log(`  // SKIP "${p.he}" — ${e.message}`); continue; }
    const rep = vocalizationReport(p.he, tokens);
    const flag = rep.clean ? '' : `  // ⚠ NOT CLEAN: ${rep.missing.length ? 'unvocalized ' + rep.missing.join(',') : 'recon mismatch'}`;
    const chunks = rep.words.map((w) => `'${esc(w)}'`).join(', ');
    console.log(`  { he: '${esc(p.he)}', translit: '${esc(p.translit)}', fr: '${esc(p.fr)}',`);
    console.log(`    chunks: [${chunks}], distractors: [/* TODO */], focus: '/* TODO */' },${flag}`);
  }
  console.log('];');
}

async function cmdValidate(files) {
  let failures = 0, total = 0;
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    const block = extractSentencesBlock(html);
    if (!block) { console.log(`— ${file}: no window.SENTENCES`); continue; }
    const items = parseSentenceItems(block);
    console.log(`\n=== ${file} — ${items.length} sentence(s) ===`);
    for (const it of items) {
      total++;
      let tokens;
      try { tokens = await morph(it.he); }
      catch (e) { failures++; console.log(`  ✗ "${it.he}" — ${e.message}`); continue; }
      const rep = vocalizationReport(it.he, tokens);
      const chunksOk = it.chunks.length > 0 && strip(it.chunks.join('')) === strip(it.he);
      const ok = rep.clean && chunksOk;
      if (!ok) failures++;
      const notes = [];
      if (!rep.clean) notes.push(rep.missing.length ? `unvocalized: ${rep.missing.join(',')}` : `recon mismatch ${JSON.stringify(rep.reconMismatch)}`);
      if (!chunksOk) notes.push(`chunks don't partition phrase (chunks=${strip(it.chunks.join(''))} vs he=${strip(it.he)})`);
      console.log(`  ${ok ? '✓' : '✗'} ${it.he}${notes.length ? ' — ' + notes.join('; ') : ''}`);
    }
  }
  console.log(`\n${total - failures}/${total} sentences clean across ${files.length} lesson(s).`);
  if (failures) process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--validate') {
    const files = argv.slice(1);
    if (!files.length) { console.error('usage: --validate <lesson.html> [...]'); process.exit(2); }
    await cmdValidate(files);
  } else if (argv[0] === 'suggest') {
    const file = argv[1];
    if (!file) { console.error('usage: suggest <lesson.html> [--phrases "a|b|c"]'); process.exit(2); }
    const pi = argv.indexOf('--phrases');
    await cmdSuggest(file, pi >= 0 ? argv[pi + 1] : null);
  } else {
    console.error('usage:\n  node tools/gen-sentences.mjs suggest <lesson.html> [--phrases "a|b|c"]\n  node tools/gen-sentences.mjs --validate <lesson.html> [...]');
    process.exit(2);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
