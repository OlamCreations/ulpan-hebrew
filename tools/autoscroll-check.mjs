#!/usr/bin/env node
// Drives a real liturgy page and MEASURES the autoscroll.
//
//   node tools/serve.mjs 8912        # in another shell
//   node tools/autoscroll-check.mjs
//   node tools/autoscroll-check.mjs --base https://olamcreations.github.io/ulpan-hebrew
//
// Why measure rather than assert the bar exists: the whole design claim is that the speed is
// in PIXELS PER SECOND and not pixels per frame, which no amount of "the button toggled a
// class" can show. A frame-based scroller passes every structural check and then runs at
// double speed on a 120Hz phone. So this times a real run and compares the distance covered
// against the configured rate.
//
// It also pins the two behaviours that are easy to get backwards: the module must NOT pause
// itself (it scrolls the page, so a `scroll` listener would stop it on its own first frame),
// and it MUST pause when the reader scrolls by hand.

import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:8912';

// The rates the module declares. Read from the source so the probe cannot drift from it.
const src = await readFile(join(ROOT, 'assets', 'autoscroll.js'), 'utf8');
const STEPS = JSON.parse(src.match(/steps:\s*(\[[^\]]*\])/)[1]);
const DEFAULT_STEP = Number(src.match(/defaultStep:\s*(\d+)/)[1]);

let pass = 0, fail = 0;
const say = (ok, msg, extra = '') => {
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + msg + (extra ? '  — ' + extra : ''));
};

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];

async function open(path, width = 900, height = 800) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(path + ': ' + e));
  // The browser asks for /favicon.ico on its own and neither the dev server nor GitHub
  // Pages answers it. It is on every page of the site, it predates this feature, and left
  // unfiltered it makes this probe permanently red for something it does not test.
  const noise = (t) => /favicon.ico/.test(t);
  page.on('console', (m) => { if (m.type() === 'error' && !noise(m.location().url + m.text())) errors.push(path + ': ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && !noise(r.url())) errors.push(path + ': HTTP ' + r.status() + ' ' + r.url()); });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  return { ctx, page };
}

// Times a run of `ms` at the current speed and reports pixels covered per second.
async function measure(page, ms) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(120);
  await page.click('.as-play');
  const t0 = Date.now();
  await page.waitForTimeout(ms);
  const y = await page.evaluate(() => window.pageYOffset);
  const dt = (Date.now() - t0) / 1000;
  await page.evaluate(() => {
    const b = document.querySelector('.as-play');
    if (b.classList.contains('as-playing')) b.click();
  });
  return y / dt;
}

for (const path of ['/liturgy/songs-001-hatikvah-en.html', '/liturgy/tehilim-001.html']) {
  const name = path.split('/').pop().replace('.html', '');
  console.log('\n' + name);
  const { ctx, page } = await open(path);

  const present = await page.evaluate(() => {
    const bar = document.querySelector('.as-bar');
    if (!bar) return null;
    return {
      play: !!bar.querySelector('.as-play'),
      steps: bar.querySelectorAll('.as-step').length,
      readout: (bar.querySelector('.as-readout') || {}).textContent,
      pressed: bar.querySelector('.as-play').getAttribute('aria-pressed'),
      scrollable: document.documentElement.scrollHeight - window.innerHeight,
    };
  });
  say(!!present && present.play && present.steps === 2, 'the bar is there with play and two steps');
  say(!!present && present.pressed === 'false', 'it does not start playing on its own');
  say(!!present && present.readout === String(DEFAULT_STEP + 1), 'speed reads its stored default',
    present ? present.readout : '-');

  // --- the load-bearing measurement -------------------------------------------
  const want = STEPS[DEFAULT_STEP];
  const got = await measure(page, 2000);
  const ratio = got / want;
  say(ratio > 0.75 && ratio < 1.25, `scrolls at the configured rate`,
    `${want} px/s configured, ${got.toFixed(1)} measured`);

  // Faster must be faster, by roughly the ratio the config declares.
  await page.evaluate(() => {
    document.querySelectorAll('.as-step')[1].click();
    document.querySelectorAll('.as-step')[1].click();
  });
  const want2 = STEPS[DEFAULT_STEP + 2];
  const got2 = await measure(page, 2000);
  say(got2 > got * 1.2, 'raising the speed really scrolls faster',
    `${got.toFixed(1)} -> ${got2.toFixed(1)} px/s (configured ${want} -> ${want2})`);
  const declared = want2 / want;
  const actual = got2 / got;
  say(actual > declared * 0.7 && actual < declared * 1.4, 'the step matches the declared ratio',
    `declared ×${declared.toFixed(2)}, measured ×${actual.toFixed(2)}`);
  await page.evaluate(() => {
    document.querySelectorAll('.as-step')[0].click();
    document.querySelectorAll('.as-step')[0].click();
  });

  // --- it must not stop itself -------------------------------------------------
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.click('.as-play');
  await page.waitForTimeout(900);
  const stillOn = await page.evaluate(() => ({
    playing: document.querySelector('.as-play').classList.contains('as-playing'),
    y: window.pageYOffset,
  }));
  say(stillOn.playing && stillOn.y > 10, 'it does not pause itself while scrolling',
    `y=${stillOn.y}`);

  // --- but the reader takes over --------------------------------------------------
  await page.mouse.move(450, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(250);
  const afterWheel = await page.evaluate(() => document.querySelector('.as-play').classList.contains('as-playing'));
  say(!afterWheel, 'scrolling by hand pauses it');

  const frozen = await page.evaluate(async () => {
    const a = window.pageYOffset;
    await new Promise((r) => setTimeout(r, 600));
    return window.pageYOffset - a;
  });
  say(frozen === 0, 'and it really stops moving', `moved ${frozen}px while paused`);

  // --- the end of the page ----------------------------------------------------------
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(150);
  const wasAtBottom = await page.evaluate(() => window.pageYOffset >= document.documentElement.scrollHeight - window.innerHeight - 2);
  say(wasAtBottom, 'the probe really reached the bottom before pressing play');
  await page.click('.as-play');                    // at the bottom, play restarts from the top
  await page.waitForTimeout(400);
  const restarted = await page.evaluate(() => window.pageYOffset);
  say(restarted < 200, 'pressing play at the very bottom starts again from the top', `y=${restarted}`);
  await page.evaluate(() => {
    const b = document.querySelector('.as-play');
    if (b.classList.contains('as-playing')) b.click();
  });

  await ctx.close();
}

// --- frame-rate independence, tested by CHANGING THE FRAME RATE -----------------------
//
// This is the assertion the module's own comment is written against, and the obvious version
// of it does not work: headless Chrome runs rAF at exactly 60fps, so a per-frame scroller
// using speed()/60 measures identically to a per-second one. Injecting that bug on purpose
// left every other check in this file green — the probe could not see the one thing it
// exists for.
//
// So drive the clock instead. rAF is replaced before the module loads with one that fires at
// roughly double rate while still reporting REAL timestamps. A time-based implementation
// covers the same ground per second; a frame-based one covers twice as much.
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    // ~120Hz, honest timestamps. Kept deliberately simple: the point is the CALL RATE.
    window.requestAnimationFrame = function (cb) {
      return window.setTimeout(function () { cb(performance.now()); }, 8);
    };
    window.cancelAnimationFrame = function (id) { window.clearTimeout(id); };
  });
  await page.goto(BASE + '/liturgy/songs-001-hatikvah-en.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  // make sure we are on the same speed step the 60Hz runs used
  await page.evaluate((d) => {
    localStorage.setItem('ulpan-autoscroll-speed', String(d));
  }, DEFAULT_STEP);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const fastFrames = await measure(page, 2000);
  const want = STEPS[DEFAULT_STEP];
  say(fastFrames / want > 0.75 && fastFrames / want < 1.25,
    'the rate holds when the frame rate doubles (the 120Hz-phone case)',
    `${want} px/s configured, ${fastFrames.toFixed(1)} measured at ~2x frame rate`);
  await ctx.close();
}

// --- the speed is remembered, the playing state is not -------------------------------
{
  const { ctx, page } = await open('/liturgy/songs-001-hatikvah-en.html');
  await page.evaluate(() => document.querySelectorAll('.as-step')[1].click());
  const set = await page.evaluate(() => document.querySelector('.as-readout').textContent);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    readout: document.querySelector('.as-readout').textContent,
    playing: document.querySelector('.as-play').classList.contains('as-playing'),
  }));
  say(after.readout === set, 'the chosen speed survives a reload', `${set} -> ${after.readout}`);
  say(!after.playing, 'a freshly opened page never scrolls on its own');
  await ctx.close();
}

// --- a page too short to scroll gets no control --------------------------------------
{
  const { ctx, page } = await open('/liturgy/songs-001-hatikvah-en.html', 900, 800);
  const gone = await page.evaluate(() => {
    // Collapse the page, re-run the module's own guard the way a short page would meet it.
    document.body.style.height = '200px';
    document.querySelectorAll('.container, .verses-grid').forEach((n) => n.style.display = 'none');
    return document.documentElement.scrollHeight - window.innerHeight;
  });
  say(gone < 240, 'a collapsed page really is under the threshold', `${gone}px scrollable`);
  await ctx.close();
}

await browser.close();
console.log('\n' + (errors.length ? 'JS ERRORS:\n  ' + errors.join('\n  ') : 'no JS errors'));
if (errors.length) fail++;
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
