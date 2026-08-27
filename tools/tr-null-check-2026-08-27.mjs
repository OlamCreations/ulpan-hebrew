/* tr-null-check-2026-08-27.mjs — la ligne de lecture manque-t-elle VRAIMENT, ou est-ce le
 * lecteur de la sonde qui ne la trouve pas ?
 *
 * surface-probe rapporte tr=null sur 4 requêtes hébraïques courtes (אֲנִי, כּוֹחַ, גַּב, עוֹבֶדֶת).
 * Deux causes opposées rendent le même null : la carte n'a pas de lecture, ou READ() ne sait pas
 * la lire (deux mises en page existent : .qs-tr et .qs-wp-tr). On ne conclut pas sans regarder
 * le HTML brut de la carte.
 */
import { chromium } from 'playwright-core';
import { ask } from './translator-driver.mjs';

const BASE = process.env.BASE || 'https://olamcreations.github.io/ulpan-hebrew';
const CASES = ['אֲנִי', 'כּוֹחַ', 'גַּב', 'צָרְפָתִית'];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

for (const q of CASES) {
  await ask(page, q);
  const dump = await page.evaluate(() => {
    const c = document.querySelector('#qs-results .qs-card');
    if (!c) return { html: null };
    return {
      html: c.innerHTML,
      hasQsTr: !!c.querySelector('.qs-tr'),
      qsTrText: (c.querySelector('.qs-tr') || {}).textContent || null,
      hasWpTr: c.querySelectorAll('.qs-wp-tr').length,
      visibleText: c.innerText,
    };
  });
  console.log('='.repeat(78));
  console.log(`"${q}"  .qs-tr=${dump.hasQsTr} texte=${JSON.stringify(dump.qsTrText)} .qs-wp-tr=${dump.hasWpTr}`);
  console.log('  ce que l\'oeil voit : ' + JSON.stringify(dump.visibleText));
}

await browser.close();
