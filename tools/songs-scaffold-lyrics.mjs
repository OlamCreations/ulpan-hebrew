#!/usr/bin/env node
/* songs-scaffold-lyrics.mjs — pin a MODERN song's lyrics into the same source shape the Sefaria
 * scaffold produces, so the rest of the pipeline (validate, build, hebrew-check, index) does not
 * know the difference.
 *
 *   node tools/songs-scaffold-lyrics.mjs 30
 *
 * WHY A SECOND SCAFFOLD. tools/songs-scaffold.mjs takes a Sefaria reference and a pointed
 * edition; the whole pipeline rests on "the author never types Hebrew, the machine owns it". A
 * modern song has no pointed edition anywhere. What it has is an unpointed lyrics text on a
 * lyrics site, and this project already owns the machine that points unpointed Hebrew: the
 * Dicta Nakdan behind the site's Worker, which the live translator uses on every phrase. So the
 * contract holds — the author still types no Hebrew — with two honest differences that this
 * file records in the source rather than hides:
 *
 *   1. The Hebrew is POINTED BY A MODEL, not by a scholar. Nakdan is measured good on modern
 *      prose and wrong sometimes; the pointed text is therefore printed by this tool for a
 *      human to read line by line before the page is built, and `heVersion` says so.
 *   2. The words are copyrighted. The site owner decided on 2026-08-18 to reproduce them for
 *      learning; `heLicense` names the rights holders and says the site's CC licence does not
 *      cover them. That is what songs-hebrew-check prints in the provenance footer.
 *
 * INPUT. content/songs/source/NNN.lyrics.txt — the lyrics as fetched from the site named in the
 * registry `ref`, verbatim apart from blank-line normalisation, one line per sung line, a blank
 * line between stanzas. The registry row carries `family: "lyrics"`, `ref` (the URL) and
 * `credits` (the writers, as the lyrics site prints them).
 *
 * WHAT IS CHANGED, AND REPORTED. Two kinds of edit are allowed and both go into
 * `droppedByScaffold` so nothing is silent:
 *   - a definite article split from its word by the site's typesetting ("ה קדוש") is rejoined;
 *   - a numeral the site prints where the singer says a word ("2000") is replaced by that word,
 *     COPIED from a page of this site where it already stands verified, never typed here.
 * Anything else — a spelling the site has and the singer does not sing — stays as the site has
 * it, and the human review is where it would be caught.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const require = createRequire(import.meta.url);
const T = require(join(REPO, 'assets', 'translit.js'));
const REGISTRY = JSON.parse(readFileSync(join(REPO, 'content', 'songs', 'index.json'), 'utf8')).songs;
const WORKER = 'https://ulpan-morph.olamcreations.workers.dev';

const n = Number(process.argv[2]);
const entry = REGISTRY.find(s => s.n === n);
if (!entry) { console.error(`song ${n}: not in content/songs/index.json`); process.exit(1); }
if (entry.family !== 'lyrics') { console.error(`song ${n}: family is "${entry.family}", not "lyrics" — use tools/songs-scaffold.mjs`); process.exit(1); }
if (!entry.credits) { console.error(`song ${n}: registry row needs \`credits\` (the writers, as the lyrics site prints them)`); process.exit(1); }

const NN = String(n).padStart(3, '0');
const txtPath = join(REPO, 'content', 'songs', 'source', `${NN}.lyrics.txt`);
if (!existsSync(txtPath)) { console.error(`song ${n}: ${txtPath} is missing — pin the lyrics text first`); process.exit(1); }
const raw = readFileSync(txtPath, 'utf8').replace(/\r/g, '');

const stripNiqqud = s => s.replace(/[\u0591-\u05C7]/g, '');
const dropped = [];
const restore = [];   // { lineIndex, bare, pointed } — verified words to put back over the pointer's guess

/* Numeral -> the sung word, copied from a verified page of this site. Declared here as data:
   the numeral, the page, and the pointed word to look for on it. The bare consonants of that
   word (its niqqud stripped) replace the numeral in the text sent to the pointer, so the
   pointer treats it like every other word and the page shows one consistent hand. */
const NUMERAL_WORDS = [
  { numeral: '2000', page: 'liturgy/songs-001-hatikvah-en.html', pointed: null, findBefore: 'בַּת שְׁנוֹת ' }
];
const numeralWord = (rule) => {
  const html = readFileSync(join(REPO, rule.page), 'utf8');
  const at = html.indexOf(rule.findBefore);
  if (at < 0) throw new Error(`song ${n}: ${rule.page} does not contain "${rule.findBefore}"`);
  const after = html.slice(at + rule.findBefore.length);
  const m = after.match(/^[\u0591-\u05EA]+/);
  if (!m) throw new Error(`song ${n}: no Hebrew word after "${rule.findBefore}" on ${rule.page}`);
  return m[0];
};

let lines = raw.split('\n').map(l => l.trim());
// keep stanza structure as a list of blank-separated groups, but the source is flat lines
const stanzaBreaks = [];
const flat = [];
for (const l of lines) {
  if (!l) { if (flat.length && stanzaBreaks[stanzaBreaks.length - 1] !== flat.length) stanzaBreaks.push(flat.length); continue; }
  let line = l;
  // split article: a lone ה/ו/ב/ל/כ/מ/ש token followed by a word is the site's typesetting
  const fixed = line.replace(/(^|\s)([הובלכמש])\s+(?=[א-ת])/g, (m, pre, letter) => pre + letter);
  if (fixed !== line) { dropped.push({ why: 'prefix letter rejoined to its word (site typesetting)', line, became: fixed }); line = fixed; }
  for (const rule of NUMERAL_WORDS) {
    if (line.includes(rule.numeral)) {
      const pointedWord = numeralWord(rule);
      const word = stripNiqqud(pointedWord);
      const became = line.replace(rule.numeral, word);
      dropped.push({ why: `numeral written as the sung word, copied from ${rule.page}`, line, became });
      // The pointer will read the bare consonants its own way — it read אלפים as "thousands",
      // plural, where the verified page and the singer have the dual — so the verified pointed
      // word is put back over the pointer's guess after pointing (see below).
      restore.push({ lineIndex: flat.length, bare: word, pointed: pointedWord });
      line = became;
    }
  }
  flat.push(line);
}

/* Point every line through the Worker, one call per line, and rebuild the text keeping every
   token in place — the same reconstruction quicksay.js does in vocalizeBare. A line whose
   consonants come back changed is a pointer failure and is refused, not accepted. */
async function point(text) {
  const r = await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!r.ok) throw new Error(`worker ${r.status} on "${text}"`);
  const j = await r.json();
  const toks = (j && j.tokens) || [];
  const voc = toks.map(t => t.sep ? (t.word || '') : (t.voc || t.word || '')).join('').replace(/\s+/g, ' ').trim();
  const clean = T.cleanDictaForDisplay ? T.cleanDictaForDisplay(voc) : voc;
  if (stripNiqqud(clean).replace(/\s+/g, ' ') !== text.replace(/\s+/g, ' ')) throw new Error(`pointer changed the consonants of "${text}" -> "${clean}"`);
  if (!/[\u0591-\u05C7]/.test(clean)) throw new Error(`pointer returned no vowel points for "${text}"`);
  return clean;
}

const pointed = [];
for (const line of flat) {
  let v = null, err = null;
  for (let attempt = 0; attempt < 3 && !v; attempt++) {
    try { v = await point(line); } catch (e) { err = e; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!v) throw err;
  const li = pointed.length;
  for (const r of restore.filter(r => r.lineIndex === li)) {
    const before = v;
    v = v.split(' ').map(w => stripNiqqud(w) === r.bare ? r.pointed : w).join(' ');
    if (v !== before) dropped.push({ why: "the pointer's reading replaced by the verified pointed word", line: before, became: v });
  }
  pointed.push(v);
}

let li = 0;
const data = {
  song: n,
  slug: entry.slug,
  category: entry.category,
  family: 'lyrics',
  ref: entry.ref,
  heRef: entry.ref,
  heVersion: 'lyrics text as published on the site named in ref, pointed by Dicta Nakdan through this site\'s Worker and read line by line before building',
  heLicense: `© ${entry.credits} — reproduced for learning by the site owner's decision (2026-08-18); not covered by this site's LICENSE-CONTENT`,
  heVia: 'via the lyrics site and the site\'s own pointing engine',
  enVersion: null,
  enLicense: null,
  enRaw: [],
  stanzaBreaks,
  droppedByScaffold: dropped,
  lines: pointed.map(text => {
    const words = text.split(' ').filter(Boolean);
    return { i: li++, he: text, words: words.map((w, wi) => ({ i: wi, he: w, tr: T.transliterate(w), gloss: '' })) };
  })
};

const outPath = join(REPO, 'content', 'songs', 'source', `${NN}.json`);
writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

const words = data.lines.reduce((a, l) => a + l.words.length, 0);
console.log(`ok   ${NN} ${entry.slug.padEnd(24)} ${data.lines.length} lines, ${String(words).padStart(4)} words  [pointed by Nakdan; stanza breaks after lines ${stanzaBreaks.join(', ')}]`);
for (const d of dropped) console.log(`     changed: ${d.why}\n        ${d.line}\n     -> ${d.became}`);
console.log('\nREAD EVERY LINE. The pointing is a model\'s, not an edition\'s:\n');
data.lines.forEach(l => console.log(`  ${String(l.i).padStart(2)}  ${l.he}\n      ${l.words.map(w => w.tr).join(' ')}`));
