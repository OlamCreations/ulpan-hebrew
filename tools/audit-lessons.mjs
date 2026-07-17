#!/usr/bin/env node
// audit-lessons.mjs — find real niqqud errors in the lesson corpus.
//
// The naive approaches both fail, loudly, and I tried both before writing this:
//
//   "compare the hand transliteration to translit.js"  -> 44.6% mismatch, almost all FALSE:
//       New York rabati -> "nyu york rabati" (proper noun), yom kippur -> "yom kipur"
//       (established English), qeltu/bēt (deliberate academic Judeo-Iraqi). Acting on it
//       would have transliterated Manhattan.
//
//   "compare the niqqud to Dicta's top reading"        -> 30% mismatch, ~2/3 FALSE:
//       בַּגְדָאד (Baghdad), אוֹפְּטָלְגִין (a brand name), הִיפ-הוֹפּ, דִי-גֵ'יי, מַ"חָ"ט
//       (acronym). Dicta is trained on Hebrew; on a loanword it is guessing, and its guess
//       is not evidence that the lesson is wrong.
//
// What works is asking a question Dicta can actually answer. It returns EVERY valid
// vocalization of a consonantal skeleton, not just its favourite. So:
//
//     FLAG when the lesson's spelling is in NONE of Dicta's options
//     AND Dicta knows the word (>= MIN_OPTIONS analyses).
//
// The second clause is what kills the loanword false positives: for a word in its lexicon
// Dicta returns many analyses (ספר 12, תקנה 22); for a foreign word it manufactures 1-2.
// Validated by hand on knowns — caught אֲחֲזָקָה, תַּקָנָה, אַגָן, עָבוֹדָה; passed בַּגְדָאד,
// אוֹפְּטָלְגִין, מְדוּזָה, and correct native words.
//
// Known blind spot, by construction: a word that is a VALID vocalization but wrong in
// context (חָבָל is really "rope", but the phrase needs חֲבָל "what a pity") is invisible
// here — per-word lexical lookup cannot see context. Those need reading, not tooling.
//
// This REPORTS. It does not edit lessons. Dicta is an oracle, not truth (see gen-expressions
// audit()), and 460 lessons are not worth a blind sed.
//
// Usage:
//   node tools/audit-lessons.mjs                 # whole corpus -> lesson-niqqud-report.json
//   node tools/audit-lessons.mjs --limit 200     # first N words (quick pass)
//   node tools/audit-lessons.mjs --file 172-mekorot.html

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const NAKDAN = process.env.NAKDAN_URL || 'https://nakdan-u1-0.loadbalancer.dicta.org.il/api';
const MIN_OPTIONS = 3;   // below this, Dicta is guessing at a word it does not know
const BATCH = 24;        // words per Dicta call
const PAUSE = 350;       // ms between calls

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Holam male has two encodings for the same sound: the standard בּוֹקֶר (vav carries the holam)
// and Dicta's בֹּוקֶר (the consonant carries it, vav bare). Identical word, different code points.
// Left unnormalized this fires on every וֹ in the corpus — בּוֹקֶר alone spans 35 files — and the
// lessons are the ones that are RIGHT. Fold the consonant-side spelling onto the vav.
// Order-agnostic on purpose: NFC sorts combining marks by class, so Dicta's raw dagesh+holam
// (05BC 05B9) becomes holam+dagesh (05B9 05BC) after normalization. A regex written for either
// literal order silently matches nothing — which is exactly how בּוֹקֶר survived the first fix.
const holamFold = (s) => (s || '').replace(
  /([א-ת])([֑-ׇ]*)ֹ([֑-ׇ]*)ו(?![ֹּ])/g,
  (_, c, a, b) => c + a + b + 'וֹ');

// Meteg and Dicta's prefix pipe are presentation, not vocalization; NFC because Hebrew
// combining marks are order-sensitive (bet+hiriq+dagesh != bet+dagesh+hiriq as code points).
const N = (s) => holamFold((s || '').normalize('NFC').replace(/[ֽ|]/g, '')).normalize('NFC');
const bare = (s) => (s || '').replace(/[֑-ׇ]/g, '');
const hasNiqqud = (s) => /[֑-ׇ]/.test(s || '');

// Foreign-word classes where Dicta is out of domain and the lesson author's spelling wins.
const isForeignShape = (s) => /['"׳״\-–]/.test(s);

async function lessonWords(only) {
  const files = only ? [only]
    : (await readdir(ROOT)).filter((f) => /^\d+-.*\.html$/.test(f)).sort();
  const seen = new Map();
  for (const f of files) {
    const src = await readFile(join(ROOT, f), 'utf8');
    const re = /(?:const|var|let)\s+([A-Z_]{2,})\s*=\s*(\[[\s\S]*?\]);/g;
    let m;
    while ((m = re.exec(src))) {
      let arr;
      try { arr = vm.runInNewContext(`(${m[2]})`); } catch { continue; }
      if (!Array.isArray(arr)) continue;
      for (const x of arr) {
        if (!x || typeof x.he !== 'string') continue;
        // Audit word by word: a phrase's vocalization is context-bound, a word's is not.
        for (const w of x.he.trim().split(/\s+/)) {
          const word = w.replace(/[?!.,;:]/g, '').trim();
          if (!word || !hasNiqqud(word) || isForeignShape(word)) continue;
          if (!seen.has(word)) seen.set(word, { he: word, files: new Set() });
          seen.get(word).files.add(f);
        }
      }
    }
  }
  return [...seen.values()].map((x) => ({ he: x.he, files: [...x.files] }));
}

async function dictaOptions(words) {
  const payload = { task: 'nakdan', data: words.map(bare).join(' '), genre: 'modern',
    addmorph: true, keepqq: false, nodageshdefault: false, patachma: false, keepmetagim: true };
  const r = await fetch(NAKDAN, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`nakdan ${r.status}`);
  const j = await r.json();
  return (Array.isArray(j) ? j : []).filter((t) => !t.sep)
    .map((t) => ({ word: t.word, options: (t.options || []).map((o) => N(o[0])) }));
}

const args = process.argv.slice(2);
const only = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const limit = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : 0;

let words = await lessonWords(only);
if (limit) words = words.slice(0, limit);
console.log(`auditing ${words.length} unique vocalized native-shaped words…`);

const flagged = [];
let known = 0, unknown = 0, failed = 0;

for (let i = 0; i < words.length; i += BATCH) {
  const chunk = words.slice(i, i + BATCH);
  let toks;
  try { toks = await dictaOptions(chunk.map((w) => w.he)); }
  catch { try { await sleep(1500); toks = await dictaOptions(chunk.map((w) => w.he)); } catch { failed += chunk.length; continue; } }
  // Align by consonantal skeleton: Dicta may split/merge, so never trust index alone.
  const byBare = new Map();
  for (const t of toks) if (!byBare.has(t.word)) byBare.set(t.word, t);
  for (const w of chunk) {
    const t = byBare.get(bare(w.he));
    if (!t) { failed++; continue; }
    if (t.options.length < MIN_OPTIONS) { unknown++; continue; }   // Dicta doesn't know it -> abstain
    known++;
    if (!t.options.some((o) => o === N(w.he))) {
      flagged.push({ he: w.he, suggest: t.options[0], nOptions: t.options.length, files: w.files });
    }
  }
  process.stdout.write(`\r  ${Math.min(i + BATCH, words.length)}/${words.length} · flagged ${flagged.length}   `);
  await sleep(PAUSE);
}

console.log('\n');
console.log(`Dicta knew (>=${MIN_OPTIONS} analyses) : ${known}`);
console.log(`abstained (foreign/unknown)      : ${unknown}`);
console.log(`unreachable                      : ${failed}`);
console.log(`FLAGGED (spelling in no option)  : ${flagged.length}` +
  (known ? `  (${(100 * flagged.length / known).toFixed(1)}% of known)` : ''));

flagged.sort((a, b) => b.files.length - a.files.length);
const out = join(ROOT, 'lesson-niqqud-report.json');
await writeFile(out, JSON.stringify({
  _note: 'Suspect lesson niqqud. FLAGGED = the shipped spelling matches NONE of Dicta\'s valid vocalizations for that skeleton, and Dicta knows the word. Review by hand before changing anything: Dicta is an oracle, not truth. Blind spot: context-dependent errors (חָבָל vs חֲבָל) are invisible to a per-word check.',
  generated: new Date().toISOString().slice(0, 10),
  known, unknown, failed, flagged,
}, null, 1) + '\n', 'utf8');
console.log(`\n-> ${out}`);
console.log('\ntop suspects (most-used first):');
flagged.slice(0, 25).forEach((f) =>
  console.log(`   ${f.he.padEnd(16)} -> ${String(f.suggest).padEnd(16)} (${f.files.length} file${f.files.length > 1 ? 's' : ''}: ${f.files.slice(0, 3).join(', ')}${f.files.length > 3 ? '…' : ''})`));
