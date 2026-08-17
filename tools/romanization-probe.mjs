#!/usr/bin/env node
/* romanization-probe.mjs — how well does Google Input Tools hear what a learner types, and how much
 * does data/romanization-fixes.json help?
 *
 *   node tools/serve.mjs 8912        # in another shell — the page's own phoneticQuery is used
 *   node tools/romanization-probe.mjs
 *
 * WHAT IT DOES. For each verified row (Hebrew + human romanization) it types the romanization the
 * way a learner would — lowercase, syllable hyphens dropped — sends it to Input Tools twice, raw
 * and through the page's phoneticQuery (weld + clean + fixes), and compares the first answer to
 * the verified Hebrew, whole-phrase and word by word.
 *
 * TWO SETS, KEPT APART. The phrasebook (118 rows) is where the fix list was BUILT from, so its
 * score is in-sample and proves nothing about generalisation — a list derived from a set will
 * always score well on that set. The expressions (129 idioms, romanized by translit.js since
 * they carry no human tr) never touched the fix list. That is the held-out number, and it is the
 * only one that says whether the fixes help a learner typing something the author never saw.
 * They are printed separately and must stay separate.
 *
 * WHAT IS NOT AN ERROR. Input Tools writes full spelling (ktiv malé): בעייה for בעיה, השירותים
 * for השרותים, צימחוני for צמחוני. Those are the same word and are folded before comparing, so
 * they neither count as errors nor as fixes. Counting them would flatter or blame the wrong thing.
 *
 * The page's phoneticQuery is used, not a copy: the measurement is of the code that ships. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const T = require(join(ROOT, 'assets', 'translit.js'));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912').replace(/\/$/, '');

const it = async (text) => {
  const url = 'https://inputtools.google.com/request?text=' + encodeURIComponent(text) + '&itc=he-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8';
  const j = await (await fetch(url)).json();
  if (!Array.isArray(j) || j[0] !== 'SUCCESS') return '';
  const b = j[1] && j[1][0]; return ((b && b[1]) || [''])[0] || '';
};

/* Consonants only, punctuation dropped, and the two matres lectionis of full spelling folded out
   so ktiv malé and ktiv chaser compare equal. Crude on purpose: it removes EVERY yod and vav, so
   it under-counts errors involving those letters, and it says so here rather than pretending. */
const skel = s => String(s).replace(/[֑-ׇ]/g, '').replace(/[^א-ת ]/g, '').replace(/\s+/g, ' ').trim();
const fold = s => skel(s).replace(/[יו]/g, '');
const asTyped = tr => String(tr).toLowerCase().replace(/-/g, '').replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();

const phrasebook = JSON.parse(readFileSync(join(ROOT, 'data', 'phrasebook.json'), 'utf8')).phrases
  .map(p => ({ he: p.he, typed: asTyped(p.tr) }));
const expressions = (JSON.parse(readFileSync(join(ROOT, 'data', 'expressions.json'), 'utf8')).expressions || [])
  .filter(e => e.he && /[֑-ׇ]/.test(e.he))
  .map(e => ({ he: e.he, typed: asTyped(T.transliterate(e.he)) }))
  .filter(e => e.typed.length > 1);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await (await browser.newContext()).newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.QuickSay && window.QuickSay._phoneticQuery && window.QuickSay._phoneticQuery('achshav') !== 'achshav', null, { timeout: 20000 });
const shipped = q => page.evaluate(x => window.QuickSay._phoneticQuery(x), q);

async function run(name, rows) {
  let rawOk = 0, fixOk = 0, gained = [], lost = [];
  let rawWordBad = 0, fixWordBad = 0, words = 0;
  for (const r of rows) {
    const want = fold(r.he);
    const [raw, fixed] = await Promise.all([it(r.typed), it(await shipped(r.typed))]);
    const a = fold(raw) === want, b = fold(fixed) === want;
    rawOk += a; fixOk += b;
    if (!a && b) gained.push([r.typed, skel(raw), skel(fixed)]);
    if (a && !b) lost.push([r.typed, skel(raw), skel(fixed)]);
    const ww = want.split(' '), rw = fold(raw).split(' '), fw = fold(fixed).split(' ');
    if (rw.length === ww.length && fw.length === ww.length) {
      words += ww.length;
      for (let i = 0; i < ww.length; i++) { rawWordBad += rw[i] !== ww[i]; fixWordBad += fw[i] !== ww[i]; }
    }
  }
  console.log(`\n${name} — ${rows.length} rows`);
  console.log(`  whole phrase right : raw ${rawOk}  ->  with fixes ${fixOk}   (${gained.length} gained, ${lost.length} lost)`);
  console.log(`  words wrong        : raw ${rawWordBad}  ->  with fixes ${fixWordBad}   of ${words} aligned words`);
  for (const [t, a, b] of gained) console.log(`     + "${t}"   ${a}  ->  ${b}`);
  for (const [t, a, b] of lost) console.log(`     - "${t}"   ${a}  ->  ${b}   REGRESSION`);
  return { lost: lost.length };
}

const inSample = await run('phrasebook (IN-SAMPLE — the fix list was built from these; this number cannot generalise)', phrasebook);
const heldOut = await run('expressions (HELD-OUT — never used to build the fix list)', expressions);
await browser.close();

if (inSample.lost + heldOut.lost) { console.error(`\nFAIL: the fixes made ${inSample.lost + heldOut.lost} phrase(s) worse.`); process.exit(1); }
console.log('\nno regression: no phrase Input Tools got right became wrong through the fixes.');
