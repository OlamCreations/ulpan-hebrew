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
import { reportPath } from './paths.mjs';

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

/** Read the rendered result tree the way a user reads it: sections, then cards. */
const READ = () => {
  const out = { sections: [], hint: null };
  const res = document.getElementById('qs-results');
  if (!res) return out;
  const hint = res.querySelector('.qs-hint');
  if (hint) out.hint = hint.textContent.trim();
  let current = null;
  for (const el of res.children) {
    if (el.classList.contains('qs-sub')) { current = { title: el.textContent.trim(), cards: [] }; out.sections.push(current); continue; }
    const cards = el.classList.contains('qs-card') ? [el] : Array.from(el.querySelectorAll(':scope > .qs-card'));
    for (const c of cards) {
      if (!current) { current = { title: '(unlabelled)', cards: [] }; out.sections.push(current); }
      current.cards.push({
        he: (c.querySelector('.qs-he') || {}).textContent || null,
        cursive: (c.querySelector('.qs-he-cursive') || {}).textContent || null,
        tr: (c.querySelector('.qs-tr') || {}).textContent || null,
        en: (c.querySelector('.qs-en') || {}).textContent || null,
        breakdown: (c.querySelector('.qs-break-out') || {}).textContent || null,
      });
    }
  }
  // The natural-version block renders outside the card list.
  const nat = res.querySelector('.qs-nat-out');
  if (nat && nat.textContent.trim()) {
    out.natural = Array.from(nat.querySelectorAll('.qs-card')).map((c) => ({
      he: (c.querySelector('.qs-he') || {}).textContent || null,
      tr: (c.querySelector('.qs-tr') || {}).textContent || null,
      en: (c.querySelector('.qs-en') || {}).textContent || null,
    }));
  }
  return out;
};

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
const snapshot = () => page.evaluate(() => {
  const r = document.getElementById('qs-results');
  if (!r) return { busy: false, len: 0, cards: 0 };
  return { busy: r.getAttribute('aria-busy') === 'true', len: r.innerHTML.length, cards: r.querySelectorAll('.qs-card').length };
});

async function settle(maxMs = 20000) {
  const t0 = Date.now();

  // 1. Work started, or an offline-only answer already rendered. The floor must clear the
  //    350ms debounce; without it we would sample the pre-render state.
  let started = false;
  while (Date.now() - t0 < 3000) {
    const s = await snapshot();
    if (s.busy || s.len > 0) { started = true; break; }
    await page.waitForTimeout(100);
  }
  if (!started) return { settled: true, rendered: false };   // genuinely produced nothing

  // 2. Online work finished.
  while (Date.now() - t0 < maxMs) {
    if (!(await snapshot()).busy) break;
    await page.waitForTimeout(150);
  }

  // 3. Stable for a beat (late sections can still land after aria-busy clears).
  let last = '', stableSince = 0;
  while (Date.now() - t0 < maxMs) {
    const s = await snapshot();
    const key = `${s.busy}|${s.len}|${s.cards}`;
    if (key === last) { if (!stableSince) stableSince = Date.now(); else if (Date.now() - stableSince > 600) return { settled: true, rendered: true }; }
    else { last = key; stableSince = 0; }
    await page.waitForTimeout(150);
  }
  return { settled: false, rendered: true };
}

const records = [];
let n = 0;
for (const item of items) {
  n++;
  const errBefore = netErrors.length;
  await page.fill('#qs-input', '');
  await page.waitForTimeout(120);
  await page.fill('#qs-input', item.input);
  const { settled, rendered } = await settle();

  let natClicked = false;
  if (WANT_NAT && rendered) {
    const btn = await page.$('.qs-nat-btn');
    if (btn) { await btn.click().catch(() => {}); natClicked = true; await page.waitForTimeout(2500); await settle(20000); }
  }
  if (WANT_BREAK && rendered) {
    const btn = await page.$('.qs-card .qs-break');
    if (btn) { await btn.click().catch(() => {}); await page.waitForTimeout(1800); await settle(15000); }
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
  captured: new Date().toISOString(), base: BASE,
  options: { nat: WANT_NAT, breakdown: WANT_BREAK }, records,
}, null, 1) + '\n', 'utf8');

const empty = records.filter((r) => !r.shown.sections.length).length;
console.log(`\n${records.length} captured · ${empty} produced nothing · ${records.filter((r) => !r.settled).length} did not settle`);
console.log(`-> ${out}`);
