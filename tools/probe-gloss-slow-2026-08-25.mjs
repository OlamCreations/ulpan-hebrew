/* probe-gloss-slow-2026-08-25.mjs — le champ SENS quand la glose est LENTE, pas morte.
 *
 * Jonas, 25/08 : « là où ça doit afficher la trad, y a rien ». Réseau sain, le sens n'est jamais
 * vide (36/36 mots tirés au hasard des leçons, mesuré contre la prod). Reste la panne du
 * téléphone : une connexion vivante mais mauvaise. Un upstream refusé lève tout de suite ; un
 * upstream LENT tient jusqu'à ce que le budget expire, et l'app rend alors une carte sans sens.
 *
 * On retarde donc la glose au-delà de son budget (tGloss = 6 s) au lieu de la couper, et on
 * regarde ce que l'apprenant a sous les yeux, pour une requête hébraïque ET une romanisée.
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912');
const DELAY = Number(arg('--delay', '9000'));   // > CFG.tGloss (6000)

const QUERIES = [
  { q: 'ספר', kind: 'hebrew' },
  { q: 'מקרר', kind: 'hebrew' },
  { q: 'ani rotze kafe', kind: 'romanized' },
  { q: 'beseder', kind: 'romanized' },
  { q: 'shulchan', kind: 'romanized' },
];
const TAGS = /(phonetic|online|✓\s*lesson)/gi;
const meaningOf = c => String(c.en || '').replace(TAGS, '').trim();

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

let held = 0;
/* The gloss is gtx with sl=iw, on the SAME host as the forward path — so the route has to key
   on the query string, not the host, or the whole translation dies too and we would be
   measuring the case already fixed instead of this one. */
await page.route('**/translate_a/**', async r => {
  if (r.request().url().includes('sl=iw')) { held++; await new Promise(res => setTimeout(res, DELAY)); }
  return r.continue();
});
// The Worker's /gloss is the second rung of the same ladder; hold it too.
await page.route('**/ulpan-morph.olamcreations.workers.dev/gloss**', async r => {
  held++; await new Promise(res => setTimeout(res, DELAY)); return r.continue();
});

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#qs-input', { timeout: 20000 });
await page.waitForTimeout(1500);

console.log(`########## gloss held ${DELAY}ms (budget tGloss = 6000ms)`);
let blankSilent = 0;
for (const { q, kind } of QUERIES) {
  held = 0;
  let settled = true;
  try { await ask(page, q); } catch { settled = false; }
  const r = await page.evaluate(READ);
  const cs = r.sections.flatMap(s => s.cards);
  const glossed = cs.filter(c => meaningOf(c)).length;
  const silent = cs.length > 0 && glossed === 0 && !r.hint;
  if (silent) blankSilent++;
  console.log(`  ${silent ? 'SILENT' : 'ok    '} [${kind}] "${q}"  ${glossed}/${cs.length} glossed  held=${held}  ${settled ? '' : '(timeout)'}`);
  for (const c of cs) console.log(`        ${c.he} = ${meaningOf(c) || '(BLANK)'}`);
  console.log(`        hint: ${r.hint || '(none)'}`);
}
console.log(`\n${blankSilent} querie(s) rendered cards with no meaning and no word about it`);
await browser.close();
process.exit(blankSilent ? 1 : 0);
