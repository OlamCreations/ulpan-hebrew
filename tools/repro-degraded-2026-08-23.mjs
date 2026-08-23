/* repro-degraded-2026-08-23.mjs — le moteur sous réseau dégradé.
 *
 * Les captures de Jonas du 23/08 montrent trois choses que ni le local ni la prod ne
 * reproduisent à HEAD : hébreu SANS niqqud, champ sens qui répète l'hébreu, et une carte
 * illisible. Les trois captures montrent aussi un signal mobile faible.
 *
 * Hypothèse à TESTER, pas à affirmer : le niqqud et le sens viennent du Worker, la
 * translittération vient du corpus local. Si le Worker est injoignable, on doit voir
 * exactement la signature rapportée. C'est falsifiable : si le rendu dégradé ne ressemble
 * PAS aux captures, l'hypothèse tombe et il faut chercher ailleurs.
 *
 * Trois régimes : worker coupé, worker lent (au-delà du budget), tout coupé sauf la page.
 *
 * Usage : node tools/serve.mjs 8912   puis   node tools/repro-degraded-2026-08-23.mjs
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const BASE = process.env.BASE || 'http://localhost:8912';
const WORKER = 'ulpan-morph.olamcreations.workers.dev';

const CASES = [
  { id: 'acharei', input: 'אחרי' },
  { id: 'hard',    input: 'hard' },
];

const NIQQUD = /[֑-ׇ]/;
const HEB = /[֐-׿]/;

const REGIMES = [
  { id: 'REF   worker ok',      worker: 'pass' },
  { id: 'DEG   worker coupé',   worker: 'abort' },
  { id: 'DEG   worker lent 9s', worker: 'slow' },
];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });

for (const reg of REGIMES) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let workerCalls = 0, workerBlocked = 0;

  await page.route('**/*', async route => {
    const u = route.request().url();
    if (!u.includes(WORKER)) return route.continue();
    workerCalls++;
    if (reg.worker === 'abort') { workerBlocked++; return route.abort(); }
    if (reg.worker === 'slow') {
      workerBlocked++;
      await new Promise(r => setTimeout(r, 9000));
      return route.abort();
    }
    return route.continue();
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  console.log('='.repeat(78));
  console.log(reg.id);
  for (const c of CASES) {
    let settled = true;
    try { await ask(page, c.input); } catch { settled = false; }
    const r = await page.evaluate(READ);
    const card = r.sections[0] && r.sections[0].cards[0];
    if (!card) { console.log(`  [${c.id}] AUCUNE CARTE  settled=${settled} rawLen=${r.rawLen}`); continue; }
    const he = card.he || '', en = card.en || '';
    console.log(`  [${c.id}] settled=${settled}`);
    console.log(`     he      = ${JSON.stringify(he.slice(0, 80))}`);
    console.log(`     niqqud  = ${NIQQUD.test(he)}`);
    console.log(`     tr      = ${JSON.stringify((card.tr || '').slice(0, 80))}`);
    console.log(`     en      = ${JSON.stringify(en.slice(0, 80))}  enEstHebreu=${HEB.test(en)}`);
  }
  console.log(`  appels worker: ${workerCalls} (bloqués ${workerBlocked})`);
  await ctx.close();
}

await browser.close();
process.exit(0);
