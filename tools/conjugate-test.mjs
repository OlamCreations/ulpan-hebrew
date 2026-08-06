#!/usr/bin/env node
/**
 * Score assets/conjugate.js against real verb paradigms.
 *
 *   node tools/conjugate-test.mjs            report
 *   node tools/conjugate-test.mjs --misses   list every form that does not match
 *
 * The fixture is 57 verbs from Jonas's ulpan class notes — his teacher's paradigms, not mine —
 * frozen into tools/fixtures/verb-paradigms.json. It is ground truth, so this test is the only
 * thing standing between the app and a confidently wrong verb table.
 *
 * The bar is EXACT match including niqqud, and it is 100% or the build is wrong. Not 95%: a
 * conjugation table that is usually right is one a learner cannot rely on, and the learner
 * cannot tell which row is the wrong one. Coverage is raised by adding a class and its rows,
 * never by relaxing this comparison.
 *
 * A verb whose class the engine declines is NOT a failure — it is the engine working. Those are
 * counted separately and printed, because a silent drop in coverage would otherwise look like a
 * pass.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const Conjugate = require_(join(HERE, '..', 'assets', 'conjugate.js'));
const SET = JSON.parse(await readFile(join(HERE, 'fixtures', 'verb-paradigms.json'), 'utf8'));

const showMisses = process.argv.includes('--misses');
const TAGS = ['m.s', 'f.s', 'm.pl', 'f.pl'];
const norm = (s) => (s || '').normalize('NFC');

const byClass = {};
const declined = [];
const misses = [];
let forms = 0, exact = 0;

for (const v of SET) {
  const got = Conjugate.present(v.root, v.binyan, v.inf);
  if (!got) { declined.push(`${v.inf} (${v.binyan}, ${v.root})`); continue; }
  const s = (byClass[got.cls] = byClass[got.cls] || { verbs: 0, forms: 0, ok: 0 });
  s.verbs++;
  for (const t of TAGS) {
    if (!v.forms[t]) continue;
    s.forms++; forms++;
    if (norm(v.forms[t]) === norm(got.forms[t])) { s.ok++; exact++; }
    else misses.push(`${v.inf} [${got.cls}] ${t}: expected ${norm(v.forms[t])}  built ${norm(got.forms[t])}`);
  }
}

console.log(`${SET.length} verbs in the fixture\n`);
for (const [cls, s] of Object.entries(byClass).sort()) {
  const pct = ((s.ok / s.forms) * 100).toFixed(0);
  console.log(`  ${cls.padEnd(18)} ${String(s.verbs).padStart(2)} verbs   ${String(s.ok).padStart(3)}/${String(s.forms).padEnd(3)} forms exact  ${pct}%`);
}
console.log(`\n  ${declined.length} verbs declined (class not claimed):`);
for (const d of declined) console.log(`    ${d}`);

console.log(`\n${exact}/${forms} forms exact on the classes the engine claims`);
if (misses.length) {
  console.log(`\n${misses.length} MISMATCHES:`);
  for (const m of (showMisses ? misses : misses.slice(0, 12))) console.log('  ' + m);
  if (!showMisses && misses.length > 12) console.log(`  ... ${misses.length - 12} more (--misses)`);
}

// Jonas's own example from the screenshot, pinned: לנוח is a hollow root, and it is exactly the
// shape a naive generator gets wrong.
const nuach = Conjugate.present('נוח', 'PAAL', 'לָנוּחַ');
const wantNuach = { 'm.s': 'נָח', 'f.s': 'נָחָה', 'm.pl': 'נָחִים', 'f.pl': 'נָחוֹת' };
let nuachOk = !!nuach;
for (const t of TAGS) if (!nuach || norm(nuach.forms[t]) !== norm(wantNuach[t])) nuachOk = false;
console.log(`\nלָנוּחַ (the screenshot's verb, Dicta-style root and binyan): ${nuachOk ? 'correct' : 'WRONG — ' + JSON.stringify(nuach)}`);

const pass = misses.length === 0 && nuachOk && exact === forms && forms > 100;
console.log(pass ? '\nall good' : '\nFAILED');
process.exit(pass ? 0 : 1);
