/* repro-2026-08-25.mjs — « le live translator ne donne même plus la traduction ».
 *
 * Rejoue des requêtes ordinaires (EN, FR, romanisé, hébreu nu) contre la base demandée, et
 * imprime CE QUE VOIT L'UTILISATEUR : sections, hébreu, lecture, sens. Les requêtes vivent ici,
 * jamais en argv (l'hébreu ne survit pas à argv sous Windows).
 *
 * Usage : node tools/repro-2026-08-25.mjs            (prod par défaut)
 *         BASE=http://localhost:8912 node tools/repro-2026-08-25.mjs
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const BASE = process.env.BASE || 'https://olamcreations.github.io/ulpan-hebrew';

const CASES = [
  { id: 'en-hello',   input: 'hello' },
  { id: 'en-phrase',  input: 'I want a coffee' },
  { id: 'fr-mot',     input: 'bonjour' },
  { id: 'fr-phrase',  input: 'je voudrais un café' },
  { id: 'rom',        input: 'ani rotze kafe' },
  { id: 'he-mot',     input: 'ספר' },
  { id: 'he-phrase',  input: 'אני רוצה קפה' },
];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage();
const jsErrors = [];
const netFail = [];
page.on('pageerror', e => jsErrors.push(String(e)));
page.on('requestfailed', r => netFail.push(r.url().slice(0, 90) + ' :: ' + (r.failure() || {}).errorText));
page.on('response', r => { if (r.status() >= 400) netFail.push('HTTP ' + r.status() + ' ' + r.url().slice(0, 90)); });

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

for (const c of CASES) {
  let settled = true;
  try { await ask(page, c.input); } catch { settled = false; }
  const r = await page.evaluate(READ);
  console.log('='.repeat(76));
  console.log(`[${c.id}] "${c.input}"  settled=${settled} rawLen=${r.rawLen} sections=${r.sections.length}`);
  if (r.hint) console.log('   hint: ' + r.hint);
  for (const s of r.sections) {
    console.log('   § ' + s.title);
    for (const card of s.cards) {
      console.log('      he = ' + JSON.stringify(card.he));
      console.log('      tr = ' + JSON.stringify(card.tr));
      console.log('      en = ' + JSON.stringify(card.en));
    }
  }
}

console.log('='.repeat(76));
console.log('JS errors (' + jsErrors.length + '):');
jsErrors.forEach(e => console.log('  ' + e.slice(0, 200)));
console.log('Network failures / HTTP >=400 (' + netFail.length + '):');
[...new Set(netFail)].forEach(e => console.log('  ' + e));

await browser.close();
