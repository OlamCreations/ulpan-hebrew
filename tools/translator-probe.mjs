#!/usr/bin/env node
/*
 * translator-probe.mjs — capture what the live translator actually shows a user.
 *
 * It drives the REAL page in a real browser rather than re-calling Google and the Worker from
 * Node. That distinction matters: most of this engine is not the upstream calls, it is our
 * layer over them — bestTranslit's per-word choice, vocalizeBare's guard, the homograph
 * alternates, the de-duplication between sections. A Node re-implementation would test a
 * different program and pass while the shipped one fails.
 *
 *   node tools/serve.mjs 8912 &
 *   node tools/translator-probe.mjs [--base http://localhost:8912] [--nat] [--break] [--limit N]
 *
 * Output: tools/reports/translator-capture.json — one record per input, ready for judging.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportPath } from './paths.mjs';
import { snapshot as driverSnapshot, sig, settle as driverSettle, READ as driverREAD } from './translator-driver.mjs';

/* Which translit.js produced the transliterations in this capture. Anything that RE-DERIVES
   a transliteration later — tools/translator-invariants.mjs does — is comparing two programs
   unless it can check they are the same one. Judging a July capture with an August engine
   produced 86 confident violations, every one of them the diff between the two engines. */
const ENGINE = createHash('sha256')
  .update(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'translit.js')))
  .digest('hex').slice(0, 12);

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = (arg('--base', 'http://localhost:8912')).replace(/\/$/, '');
const WANT_NAT = process.argv.includes('--nat');
const WANT_BREAK = process.argv.includes('--break');
const LIMIT = Number(arg('--limit', '0')) || 0;
const ONLY = arg('--paths', '');

const corpus = JSON.parse(await readFile(reportPath('translator-corpus.json'), 'utf8'));
let items = corpus.items;
if (ONLY) items = items.filter((i) => ONLY.split(',').includes(i.path));
if (LIMIT) items = items.slice(0, LIMIT);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const netErrors = [];
page.on('response', (r) => { if (r.status() >= 400) netErrors.push({ at: Date.now(), status: r.status(), url: r.url() }); });
// Aborted/refused upstream calls never produce a response, so they must be caught separately —
// otherwise an upstream that simply drops long requests looks identical to a clean empty result.
page.on('requestfailed', (r) => netErrors.push({ at: Date.now(), failed: r.url(), reason: (r.failure() || {}).errorText }));
page.on('pageerror', (e) => netErrors.push({ at: Date.now(), jsError: e.message }));

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#qs-input', { timeout: 15000 });

/* READ, snapshot and settle now live in tools/translator-driver.mjs, imported above. They were
   duplicated here and in the metamorphic runner, and the synchronisation is the part of this
   harness that has been got wrong twice — each time producing a confident green. Two copies
   would drift and there would be no way to know which numbers to believe. */
const READ = driverREAD;

/*
 * Waiting correctly here is the whole ballgame. The input is debounced by 350ms, so for the
 * first third of a second after typing the results container still holds the PREVIOUS state —
 * which, because we clear the field between inputs, is empty. A naive "wait until the DOM
 * stops changing" therefore reports a stable empty result before rendering has even begun,
 * and silently records a working engine as producing nothing.
 *
 * So we synchronise on the signal render() actually publishes: it sets aria-busy="true" when
 * it starts online work and removes it when done. Sequence: wait for work to start (or for
 * an offline-only result to appear), wait for it to finish, then confirm stability.
 */
/* Synchronisation lives in tools/translator-driver.mjs. It was duplicated here and would have
   been duplicated again in the metamorphic runner; waiting correctly is the part of this
   harness that has been got wrong twice, each time producing a confident green — 40 invented
   failures the first time and 20 the second. Two copies drift and there is then no way to know
   which numbers to believe. The two traps and their fixes are documented in that file. */
const snapshot = () => driverSnapshot(page);
const settle = (beforeKey, maxMs) => driverSettle(page, beforeKey, maxMs);

const records = [];
let n = 0;
for (const item of items) {
  n++;
  const errBefore = netErrors.length;
  await page.fill('#qs-input', '');
  await page.waitForTimeout(120);
  // Signature of what is on screen BEFORE typing — the baseline settle() compares against.
  const before = await snapshot();
  const beforeKey = `${before.busy}|${before.len}|${before.cards}|${before.loading}`;
  await page.fill('#qs-input', item.input);
  const { settled, rendered } = await settle(beforeKey);

  let natClicked = false;
  if (WANT_NAT && rendered) {
    const btn = await page.$('.qs-nat-btn');
    if (btn) { await btn.click().catch(() => {}); natClicked = true; await page.waitForTimeout(2500); await settle('', 20000); }
  }
  if (WANT_BREAK && rendered) {
    const btn = await page.$('.qs-card .qs-break');
    if (btn) { await btn.click().catch(() => {}); await page.waitForTimeout(1800); await settle('', 15000); }
  }

  const shown = await page.evaluate(READ);
  records.push({ ...item, settled, rendered, natClicked, shown, errors: netErrors.slice(errBefore) });
  const first = shown.sections[0] && shown.sections[0].cards[0];
  console.log(`${String(n).padStart(3)}/${items.length}  [${item.path}] ${JSON.stringify(item.input).slice(0, 34).padEnd(36)} -> ${first ? (first.he || '').slice(0, 24) : (shown.hint || 'NOTHING')}`);
  await page.waitForTimeout(400);   // stay under the Worker's 100-req/60s rate limit
}

await browser.close();

const out = reportPath('translator-capture.json');
await writeFile(out, JSON.stringify({
  captured: new Date().toISOString(), base: BASE, engine: ENGINE,
  options: { nat: WANT_NAT, breakdown: WANT_BREAK }, records,
}, null, 1) + '\n', 'utf8');

const empty = records.filter((r) => !r.shown.sections.length).length;
console.log(`\n${records.length} captured · ${empty} produced nothing · ${records.filter((r) => !r.settled).length} did not settle`);
console.log(`-> ${out}`);
