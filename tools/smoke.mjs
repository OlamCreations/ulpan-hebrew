#!/usr/bin/env node
/*
 * smoke.mjs — prove the site still works, one page per folder.
 *
 * The layout puts pages one level deep while assets and data sit elsewhere, so the failure mode
 * to guard against is a path that resolves on the home and 404s in a subfolder (or the reverse).
 * A page "looking fine" does not cover it: a missing shared module fails silently. So this
 * asserts on failed requests, JS errors, and the globals each layer is supposed to install.
 *
 *   node tools/serve.mjs 8912 &
 *   node tools/smoke.mjs [baseURL]
 */
import { chromium } from 'playwright-core';
import { pages as scopePages } from './paths.mjs';

const BASE = (process.argv[2] || 'http://localhost:8912').replace(/\/$/, '');

/* One representative page per folder, discovered rather than listed, so a new family is
   covered the moment its folder exists. */
const all = await scopePages('allPages');
const byFolder = new Map();
// The home is the page that must never break, and it sorts after 404.html — so name it
// explicitly rather than letting "first file in the folder" decide what gets tested.
byFolder.set('(home)', 'index.html');
for (const p of all) {
  if (p === 'index.html' || p === '404.html') continue;
  const folder = p.includes('/') ? p.split('/')[0] : '(root)';
  if (!byFolder.has(folder)) byFolder.set(folder, p);
}
// liturgy and reference mix families; sample one of each prefix too.
for (const p of all) {
  const m = p.match(/^(liturgy|reference)\/([a-z]+)-/);
  if (m && !byFolder.has(m[1] + ':' + m[2])) byFolder.set(m[1] + ':' + m[2], p);
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let failures = 0;

for (const [label, path] of byFolder) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const bad = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => bad.push(`REQFAIL ${r.url()}`));
  page.on('pageerror', (e) => bad.push(`JSERR ${e.message}`));

  await page.goto(`${BASE}/${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const probe = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    base: window.ULPAN_BASE || null,
    translit: typeof window.Translit,
    quicksay: typeof window.QuickSay,
    // Liturgy pages deliberately do not load app.js; they are self-contained.
    hasApp: !!document.querySelector('script[src*="app.js"]'),
  }));

  const styled = probe.bg && probe.bg !== 'rgba(0, 0, 0, 0)';
  const modulesOk = !probe.hasApp || (probe.base && probe.translit === 'object' && probe.quicksay === 'object');
  const ok = !bad.length && styled && modulesOk;
  if (!ok) failures++;

  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(20)} ${path}`);
  console.log(`        css=${styled} app=${probe.hasApp} base=${probe.base ? 'set' : '-'} Translit=${probe.translit} QuickSay=${probe.quicksay}`);
  if (bad.length) console.log('        ' + bad.slice(0, 6).join('\n        '));
  await ctx.close();
}

/* The legacy-URL contract: a pre-reorganisation link must still land on the page. */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/12-verbs-past.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const landed = new URL(page.url()).pathname;
  const ok = landed.endsWith('/lessons/12-verbs-past.html');
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  legacy redirect      /12-verbs-past.html -> ${landed}`);

  /* A genuinely missing page must NOT be remapped, or a typo bounces between two 404s. */
  await page.goto(`${BASE}/roots/does-not-exist.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const stayed = new URL(page.url()).pathname.includes('does-not-exist');
  if (!stayed) failures++;
  console.log(`${stayed ? 'ok  ' : 'FAIL'}  real 404 stays put   /roots/does-not-exist.html`);
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
