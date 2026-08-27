/* translit-gap-2026-08-27.mjs — pourquoi trois mots pointés n'ont pas de lecture.
 *
 * Mesuré le 27/08 : אֲנִי, כּוֹחַ, גַּב s'affichent SANS ligne de lecture, alors qu'ils portent
 * leur niqqud. Deux causes possibles et opposées : translit.js ne sait pas les lire, ou le
 * chemin du traducteur ne lui a jamais passé la forme pointée. On appelle le moteur directement,
 * dans la page (il n'est pas importable hors navigateur).
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'https://olamcreations.github.io/ulpan-hebrew';
const WORDS = ['אֲנִי', 'כּוֹחַ', 'גַּב', 'צָרְפָתִית', 'הָרִים', 'סֵפֶר', 'שָׁלוֹם'];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const out = await page.evaluate(words => {
  const T = window.Translit;
  if (!T) return { error: 'window.Translit absent' };
  return {
    api: Object.keys(T),
    rows: words.map(w => {
      let r = null, err = null;
      try { r = T.transliterate ? T.transliterate(w) : (T.he2lat ? T.he2lat(w) : null); }
      catch (e) { err = String(e); }
      return { w, r, err };
    }),
  };
}, WORDS);

console.log(JSON.stringify(out, null, 2));
await browser.close();
