// Validate translit.js against the curated phrasebook (he = vocalized, tr = human romanization).
// Paths are resolved from this file, not from the shell's cwd, so the test runs the same
// whether it is invoked from the repo root or from tools/.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { transliterate } = require(path.join(ROOT, 'assets', 'translit.js'));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'phrasebook.json'), 'utf8')).phrases;

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

/*
 * cleanDictaForDisplay — the fold we apply to Hebrew shown on screen.
 *
 * It exists because the full normalizeDicta cannot be shown to a user: its qamats/qubuts rules
 * rewrite consonantal double-vav (שָׁווַרְמָה -> שׁוֹוַרְמָה). Two properties keep the display version
 * honest, and both are asserted here rather than asserted in a comment:
 *
 *   1. idempotent — a fold that keeps folding corrupts by degrees
 *   2. a near no-op on Hebrew we have already verified by hand
 *
 * The corpus is every vocalized `he` in the phrasebook, the expressions and all lesson pages.
 */
const { cleanDictaForDisplay } = require(path.join(ROOT, 'assets', 'translit.js'));

const verified = [];
for (const p of data) verified.push(p.he);
try {
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'expressions.json'), 'utf8'));
  for (const e of ex.expressions || []) verified.push(e.he);
} catch (e) { /* expressions.json is generated; skip when absent */ }
const lessonsDir = path.join(ROOT, 'lessons');
for (const f of fs.readdirSync(lessonsDir).filter((x) => x.endsWith('.html'))) {
  const s = fs.readFileSync(path.join(lessonsDir, f), 'utf8');
  for (const m of s.matchAll(/"he"\s*:\s*"([^"]+)"|he:\s*'([^']+)'/g)) {
    const v = m[1] || m[2];
    if (/[֑-ׇ]/.test(v)) verified.push(v);
  }
}

const notIdempotent = verified.filter((h) => cleanDictaForDisplay(cleanDictaForDisplay(h)) !== cleanDictaForDisplay(h));
const rewritten = verified.filter((h) => cleanDictaForDisplay(h) !== h);
// Ceiling, not zero: the fold legitimately repairs Dicta artefacts that got baked into a lesson.
// It is a tripwire — if a future rule starts rewriting verified Hebrew wholesale, this fails.
const CEILING = 10;

console.log(`\ncleanDictaForDisplay over ${verified.length} verified strings`);
console.log(`  idempotent : ${notIdempotent.length === 0 ? 'OK' : 'FAIL on ' + notIdempotent.length}`);
console.log(`  rewrites   : ${rewritten.length} (ceiling ${CEILING})`);
for (const h of rewritten.slice(0, 5)) console.log(`     ${h}  ->  ${cleanDictaForDisplay(h)}`);
if (notIdempotent.length || rewritten.length > CEILING) {
  console.error('\nFAIL: cleanDictaForDisplay is not safe to apply to displayed Hebrew.');
  process.exit(1);
}
