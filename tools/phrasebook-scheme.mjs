#!/usr/bin/env node
/* phrasebook-scheme.mjs — put every curated transliteration in the site's own convention.
 *
 *   node tools/phrasebook-scheme.mjs            # report
 *   node tools/phrasebook-scheme.mjs --fix      # rewrite data/phrasebook.json
 *
 * THE DEFECT. The site writes ch and tz. That is what translit.js emits, what every one of the
 * 1200-odd generated pages carries, and what the live translator derives from the Hebrew. But 35
 * of the 118 curated rows in data/phrasebook.json were typed by hand in the older kh/ts
 * convention, and the translator puts both on one screen at once: a phrase that hits the curated
 * lookup shows "sli-KHA", the phrase beside it, derived from the Hebrew, shows "sli-CHA". The
 * learner is reading two spellings of one word and has no way to know they are the same word.
 *
 * tools/translit-test.cjs has counted these for a while and held the number at a ceiling so it
 * could not grow. A ceiling is not a fix; it is a record of a decision not to make one.
 *
 * WHY NOT A SEARCH AND REPLACE. Replacing kh with ch across the file assumes every kh in every
 * row is the Hebrew phoneme, and the moment that is wrong it is wrong silently — inside a proper
 * noun, a loanword, or a genuine t+s sequence across a morpheme seam. So this does not rewrite
 * the string at all. It DERIVES the transliteration from the row's own Hebrew with translit.js
 * (the module the pages use), and then refuses to write it unless the derived form and the human
 * form are the same word: identical after folding kh into ch, tz into ts and dropping everything
 * that is not a letter. If they differ by so much as a vowel, the row is left alone and printed,
 * because then the disagreement is not a convention, it is a reading, and a reading is a question
 * for a human. The rewrite can therefore change spelling and can never change pronunciation.
 *
 * Deriving also brings the syllable hyphens and the stressed CAPS from the same engine as the
 * rest of the site, which is a second silent disagreement gone. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const { transliterate } = require(join(ROOT, 'assets', 'translit.js'));

const FILE = join(ROOT, 'data', 'phrasebook.json');
const FIX = process.argv.includes('--fix');

/* The same fold translit-test.cjs uses to score phoneme accuracy: it is the definition of "these
   two spellings are the same word", and reusing it keeps one definition rather than two. */
const fold = s => (s || '').toLowerCase().replace(/kh/g, 'ch').replace(/tz/g, 'ts').replace(/[^a-z]/g, '');

const raw = readFileSync(FILE, 'utf8');
const doc = JSON.parse(raw);
const rows = Array.isArray(doc) ? doc : (doc.phrases || doc.items || []);

const offScheme = rows.filter(p => p.tr && /kh|ts/i.test(p.tr));
const changed = [], refused = [];

for (const p of offScheme) {
  const derived = transliterate(p.he);
  if (!derived) { refused.push([p, '(translit.js produced nothing)']); continue; }
  if (fold(derived) !== fold(p.tr)) { refused.push([p, derived]); continue; }
  changed.push([p, p.tr, derived]);
}

console.log(`data/phrasebook.json — ${rows.length} rows, ${offScheme.length} written in the kh/ts convention\n`);
console.log(`rewritable (same word, different convention): ${changed.length}`);
for (const [p, was, now] of changed) console.log(`   ${p.he}   ${was}  ->  ${now}`);

if (refused.length) {
  console.log(`\nleft alone — the derived form is a DIFFERENT reading, not a different spelling: ${refused.length}`);
  for (const [p, d] of refused) console.log(`   ${p.he}   human "${p.tr}"   engine "${d}"`);
  console.log('   These are for a human to adjudicate. Do not fold them in mechanically.');
}

if (!FIX) { console.log(`\n(dry run — pass --fix to write)`); process.exit(0); }

/* Written by replacing the exact "tr": "..." string of each changed row rather than by
   re-serializing the document: JSON.stringify would reformat all 118 rows and bury 35 real edits
   in a whole-file diff nobody can review. */
let out = raw, misses = 0;
for (const [p, was, now] of changed) {
  const needle = `"tr": ${JSON.stringify(was)}`;
  const rowAt = out.indexOf(`"he": ${JSON.stringify(p.he)}`);
  if (rowAt < 0) { misses++; continue; }
  const at = out.indexOf(needle, rowAt);
  // The tr must belong to the row we just located, not to some later row that happens to carry
  // the same transliteration — bounded by the end of this row's object.
  const rowEnd = out.indexOf('}', rowAt);
  if (at < 0 || at > rowEnd) { misses++; continue; }
  out = out.slice(0, at) + `"tr": ${JSON.stringify(now)}` + out.slice(at + needle.length);
}
if (misses) { console.error(`\nFAIL: ${misses} rows could not be located unambiguously. Nothing written.`); process.exit(1); }

// Re-parse before writing: a string edit that produces invalid JSON, or that moves a row, is a
// corrupted phrasebook shipped to every page.
const after = JSON.parse(out);
const afterRows = Array.isArray(after) ? after : (after.phrases || after.items || []);
if (afterRows.length !== rows.length) { console.error('\nFAIL: row count changed. Nothing written.'); process.exit(1); }
for (let i = 0; i < rows.length; i++) {
  if (afterRows[i].he !== rows[i].he || afterRows[i].en !== rows[i].en) {
    console.error(`\nFAIL: row ${i} moved or changed beyond its transliteration. Nothing written.`);
    process.exit(1);
  }
}
writeFileSync(FILE, out);
console.log(`\nwrote ${changed.length} transliterations into the site's ch/tz convention.`);
