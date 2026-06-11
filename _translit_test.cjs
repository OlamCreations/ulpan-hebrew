// Validate translit.js against the curated phrasebook (he = vocalized, tr = human romanization).
const fs = require('fs');
const { transliterate } = require('./translit.js');
const data = JSON.parse(fs.readFileSync('phrasebook.json', 'utf8')).phrases;

// normalize for phoneme-level comparison: drop case, hyphens, spaces, apostrophes,
// punctuation; treat kh==ch (same sound, different convention).
// phoneme-level: kh==ch (כ/ח), tz==ts (צ) — both spellings are valid conventions.
const norm = s => (s || '').toLowerCase()
  .replace(/kh/g, 'ch')
  .replace(/tz/g, 'ts')
  .replace(/[^a-z]/g, '');

let ok = 0, bad = [];
for (const p of data) {
  const got = transliterate(p.he);
  if (norm(got) === norm(p.tr)) ok++;
  else bad.push({ he: p.he, want: p.tr, got, nw: norm(p.tr), ng: norm(got) });
}
console.log(`accuracy: ${ok}/${data.length} = ${(100 * ok / data.length).toFixed(1)}%`);
console.log('--- mismatches ---');
for (const b of bad) console.log(`he=${b.he}\n  want=${b.want}  (${b.nw})\n  got =${b.got}  (${b.ng})`);
