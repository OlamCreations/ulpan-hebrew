/* normalize-cap-test.mjs — les deux correctifs du 2026-08-23, avec leurs cassures injectées.
 *
 *   1. normalizeQuery sans lookbehind doit être ÉQUIVALENT à la version lookbehind.
 *      La version de référence est construite ici avec `new RegExp` : écrite en littéral, elle
 *      ferait échouer le PARSE de ce fichier même sur les moteurs qui la supportent mal, ce qui
 *      est précisément le défaut qu'on retire du site.
 *   2. Le plafond de longueur doit rendre une carte à 200 caractères et un message à 201.
 *
 * Chaque contrôle porte sa cassure : un test qui ne peut pas rougir ne prouve rien.
 *
 * Usage : node tools/serve.mjs 8912   puis   node tools/normalize-cap-test.mjs
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const BASE = process.env.BASE || 'http://localhost:8912';

/* ---------------------------------------------- 1. équivalence de normalizeQuery */
const LOOKBEHIND = new RegExp('(?<![.!?])\\.$');
const reference = q => String(q || '').trim().replace(LOOKBEHIND, '').trim();

const CASES = [
  'abc.', 'abc', 'abc...', 'abc?.', 'abc!.', '.', '..', '  abc.  ', '',
  'שלום.', 'שלום', 'Dr. Cohen.', 'a.b.', '?', 'abc?', 'abc.def',
];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

let fail = 0, n = 0;
console.log('1. normalizeQuery — nouvelle version contre référence lookbehind');
for (const q of CASES) {
  const got = await page.evaluate(s => window.QuickSay._normalizeQuery(s), q);
  const want = reference(q);
  n++;
  const ok = got === want;
  if (!ok) fail++;
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(q).padEnd(14)} -> ${JSON.stringify(got).padEnd(14)} (référence ${JSON.stringify(want)})`);
}

/* cassure injectée : une version naïve « enlève tout point final » DOIT diverger */
const naive = q => String(q || '').trim().replace(/\.$/, '').trim();
const diverges = CASES.some(q => naive(q) !== reference(q));
console.log(`   ${diverges ? 'ok  ' : 'FAIL'} cassure injectée : la version naïve diverge bien sur au moins un cas`);
n++; if (!diverges) fail++;

/* ------------------------------------------------------ 2. le plafond de longueur */
console.log('');
console.log('2. plafond de longueur');
const cap = await page.evaluate(() => window.QuickSay._cfg ? window.QuickSay._cfg.maxQuery : 200);
const under = 'א '.repeat(60).trim();                    // court, doit rendre une carte
const at = 'ש'.repeat(cap);                              // pile au plafond
const over = 'ש'.repeat(cap + 1);                        // un de trop

for (const [label, input, wantHint] of [
  ['sous le plafond', under, false],
  [`pile ${cap}`, at, false],
  [`${cap + 1} caractères`, over, true],
]) {
  await page.evaluate(v => {
    const i = document.getElementById('qs-input');
    i.value = v;                                          // écriture par PROGRAMME : contourne maxlength
    window.QuickSay._render
      ? window.QuickSay._render(document.getElementById('qs-results'), v)
      : i.dispatchEvent(new Event('input', { bubbles: true }));
  }, input);
  await page.waitForTimeout(1200);
  const r = await page.evaluate(READ);
  const hasHint = !!(r.hint && /trop long/i.test(r.hint));
  const ok = hasHint === wantHint;
  n++; if (!ok) fail++;
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(18)} (${input.length} car.) -> ${hasHint ? 'message de refus' : 'traduit'}`);
  if (hasHint) console.log(`        « ${r.hint} »`);
}

console.log('');
console.log(`${n - fail}/${n} contrôles passés`);
await browser.close();
process.exit(fail ? 1 : 0);
