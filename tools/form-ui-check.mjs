#!/usr/bin/env node
// Drives the REAL translator page and checks the "Say it as" control end to end.
//
//   node tools/serve.mjs 8912        # in another shell
//   node tools/form-ui-check.mjs
//
// Why a browser and not a fetch: everything interesting here happens on the client — the chip
// wiring, the re-vocalization with the requested gender, and the "this sentence doesn't change"
// branch that stops the app inventing a distinction Hebrew does not make. A passing Worker probe
// says nothing about any of it.
//
// Synchronises on a POSITIVE signal (results present) rather than "the DOM stopped moving": the
// input is debounced 350ms, so stability sampled too early measures the PREVIOUS query's cards.
// That mistake produced 40 false failures the first time it was made in this project.

import { chromium } from 'playwright-core';

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:8912';

let pass = 0, fail = 0;
const say = (ok, msg) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); };

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];

async function open(width, height, theme) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  // Name the URL. "404 (Not Found)" with no address is unactionable, and a console listener alone
  // reports exactly that.
  page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  page.on('console', m => {
    if (m.type() === 'error' && !/status of \d+/.test(m.text())) errors.push(m.text());
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  // Headless Chrome ships no Hebrew system voice, so the app raises its "no voice installed"
  // banner, which then sits over the controls and swallows clicks. An artefact of the harness,
  // not of the page a learner sees — hidden rather than worked around.
  await page.addStyleTag({ content: '#voice-banner{display:none!important}' });
  if (theme === 'light') await page.evaluate(() => document.documentElement.classList.add('light'));
  return { ctx, page };
}

/* Type a query and wait until ITS translation has landed.
   Clearing the field does not clear the results synchronously — the input is debounced 350ms — so
   "results contain a card" is satisfied instantly by the PREVIOUS query's cards, and the probe then
   reads the wrong sentence with every appearance of success. (This exact mistake is on record in
   this project twice; it cost 60 false results.) The fix is to wait for the empty state first,
   which is a positive signal that the debounce has fired, and only then type. */
async function emptied(page) {
  await page.fill('#qs-input', '');
  await page.waitForFunction(() => {
    const r = document.getElementById('qs-results');
    return r && r.children.length === 0;
  }, null, { timeout: 20000 });
}

async function translate(page, q) {
  await emptied(page);
  await page.type('#qs-input', q, { delay: 8 });
  await page.waitForFunction(() => {
    const r = document.getElementById('qs-results');
    return r && !r.hasAttribute('aria-busy') && !r.querySelector('.qs-loading') && r.querySelector('.qs-card');
  }, null, { timeout: 60000 });   // arg slot first — options passed as arg 2 silently keep the 30s default
}

// Press a form chip and wait for its own result (or its "nothing changes" note). Starts from the
// empty output for the same reason translate() starts from the empty results.
async function askForm(page, label) {
  // Put away whatever form is already showing, using the control's own toggle, so what is read
  // below cannot be the previous chip's card.
  await page.evaluate(() => { const on = document.querySelector('.qs-form-btn.on'); if (on) on.click(); });
  await page.waitForFunction(() => {
    const o = document.querySelector('.qs-form-out');
    return o && o.children.length === 0;
  }, null, { timeout: 20000 });
  await page.click(`.qs-form-btn:text-is("${label}")`);
  await page.waitForFunction(() => {
    const o = document.querySelector('.qs-form-out');
    return o && !o.querySelector('.qs-loading') && (o.querySelector('.qs-card') || o.querySelector('.qs-hint'));
  }, null, { timeout: 60000 });   // arg slot first — options passed as arg 2 silently keep the 30s default
  return page.evaluate(() => {
    const o = document.querySelector('.qs-form-out');
    const c = o.querySelector('.qs-card');
    return {
      hint: (o.querySelector('.qs-hint') || {}).textContent || '',
      he: c ? (c.querySelector('.qs-he') || {}).textContent || '' : '',
      tr: c ? (c.querySelector('.qs-tr') || {}).textContent || '' : '',
      tag: c ? (c.querySelector('.qs-tag') || {}).textContent || '' : ''
    };
  });
}

const { ctx, page } = await open(1200, 900, 'dark');

console.log('Control appears only where it makes sense');
await translate(page, 'I want a coffee');
say(await page.locator('.qs-form').count() === 1, 'chips shown for a translation query');
say(await page.locator('.qs-form-btn').count() === 4, 'four forms offered');
const base = await page.locator('.qs-card .qs-he').first().textContent();
console.log('       base card: ' + base.trim());

console.log('\nThe requested gender reaches the niqqud, not just the label');
// The transliteration is syllabified with hyphens and stress in caps (ro-TZA), so compare on
// letters alone — matching the raw string would fail on a correct answer.
const plain = s => (s || '').toLowerCase().replace(/[^a-z]/g, '');

const fem = await askForm(page, 'f. sing.');
console.log('       f. sing. -> ' + fem.he.trim() + '   ' + fem.tr.trim() + '   [' + fem.tag.trim() + ']');
say(/רוֹצָה/.test(fem.he), 'feminine card is pointed רוֹצָה, not רוֹצֶה');
say(plain(fem.tr).includes('rotza'), 'transliteration says rotza — what the learner will actually say');
say(!/רוֹצֶה/.test(fem.he), 'no masculine pointing left on a feminine card');
say(/קָפֶה/.test(fem.he), 'קָפֶה kept its own masculine pointing (not bent to the request)');
say(fem.he.trim() !== base.trim(), 'the feminine card differs from the card above it');

/* Google's default for this phrase is already the masculine, so asking for the masculine must
   report "same as above" rather than stack an identical card. That is the honest branch, not a
   failure — an earlier version of this file asserted a rotze card here and was simply wrong. */
const masc = await askForm(page, 'm. sing.');
console.log('       m. sing. -> ' + (masc.hint.trim() || masc.he.trim()));
say(!!masc.hint && !masc.he, 'masculine request on an already-masculine card reports no change');

console.log('\nA sentence with nothing to change says so, instead of faking a variant');
await translate(page, 'where is the station');
const inv = await askForm(page, 'f. sing.');
console.log('       -> ' + (inv.hint.trim() || inv.he.trim()));
say(!!inv.hint && /doesn/i.test(inv.hint), 'told plainly that the sentence does not change');
say(!inv.he, 'no duplicate card invented for a form that does not exist');

console.log('\nPlural');
await translate(page, 'we are going home');
const pl = await askForm(page, 'f. pl.');
console.log('       f. pl. -> ' + pl.he.trim() + '   ' + pl.tr.trim());
say(/הוֹלְכוֹת/.test(pl.he), 'feminine plural verb form');

console.log('\nToggle');
await translate(page, 'I want a coffee');
await askForm(page, 'f. sing.');
await page.click('.qs-form-btn:text-is("f. sing.")');
say(await page.locator('.qs-form-out .qs-card').count() === 0, 'pressing the lit chip puts the card away');

console.log('\nLayout');
for (const [w, h, theme] of [[1200, 900, 'dark'], [390, 780, 'dark'], [390, 780, 'light']]) {
  const { ctx: c2, page: p2 } = await open(w, h, theme);
  await translate(p2, 'I want a coffee');
  await askForm(p2, 'f. sing.');
  const over = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  say(!over, `no horizontal overflow at ${w}px (${theme})`);
  await c2.close();
}

say(errors.length === 0, `no JS errors (${errors.length})` + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

await ctx.close();
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
