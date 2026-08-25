/* probe-modal-2026-08-25.mjs — le traducteur EN MODALE, jamais mesuré.
 *
 * Toutes les sondes de ce dépôt tapent dans le #qs-input de la home. Or sur un téléphone le
 * traducteur s'ouvre depuis le menu hamburger, en overlay (hub.js openTranslator), et depuis
 * une page de leçon c'est la SEULE façon de l'atteindre. Ce chemin n'a jamais été mesuré : ni
 * son rendu, ni la lisibilité du champ SENS dedans.
 *
 * On mesure ce qui est PEINT (géométrie, style calculé, débordement du conteneur scrollable de
 * la modale), pas ce qui est dans le DOM.
 */
import { chromium } from 'playwright-core';
import { sig, snapshot, arm, settle, READ } from './translator-driver.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://olamcreations.github.io/ulpan-hebrew');

const PAGES = ['/', '/lessons/03-common-words.html', '/liturgy/songs-001-hatikvah-en.html'];
const QUERIES = ['hello', 'ספר', 'ani rotze kafe'];
const VIEWPORTS = [{ name: 'phone-390', width: 390, height: 844 }, { name: 'desktop-1200', width: 1200, height: 900 }];

/* Same measurement as probe-en-painted, but relative to the SCROLLING ANCESTOR: inside an
   overlay the fold is the modal's own box, not the viewport. A line pushed below the modal's
   visible area is invisible even though its viewport coordinates look fine. */
const MEASURE = () => {
  const out = [];
  const root = document.getElementById('qs-modal') || document;
  const res = root.querySelector('#qs-results') || document.getElementById('qs-results');
  if (!res) return [{ fatal: 'no #qs-results inside the modal' }];
  const scroller = (() => {
    let n = res.parentElement;
    while (n && n !== document.body) { const cs = getComputedStyle(n); if (/auto|scroll/.test(cs.overflowY)) return n; n = n.parentElement; }
    return null;
  })();
  const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight, left: 0, right: innerWidth };
  res.querySelectorAll('.qs-card').forEach((card, i) => {
    const en = card.querySelector('.qs-en');
    const he = card.querySelector('.qs-he') || card.querySelector('.qs-wp-he');
    const rHe = he ? he.getBoundingClientRect() : null;
    if (!en) { out.push({ i, missing: true }); return; }
    const cs = getComputedStyle(en);
    const r = en.getBoundingClientRect();
    const insideScroller = r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
    const heInside = rHe ? (rHe.top >= box.top - 1 && rHe.bottom <= box.bottom + 1) : null;
    out.push({
      i, text: (en.textContent || '').trim(),
      w: Math.round(r.width), h: Math.round(r.height),
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity, fontSize: cs.fontSize,
      scroller: scroller ? (scroller.className || scroller.id || scroller.tagName) : '(none)',
      insideScroller, heInside,
      /* The shape that matches the report exactly: the Hebrew is on screen and its meaning is
         not, because the card straddles the bottom edge of whatever is scrolling. */
      heVisibleEnNot: heInside === true && insideScroller === false,
    });
  });
  return out;
};

async function ask(page, input) {
  await page.fill('#qs-input', '');
  await page.waitForTimeout(120);
  const before = sig(await snapshot(page));
  await arm(page);
  await page.fill('#qs-input', input);
  return settle(page, before);
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let defects = 0;
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  // The voice banner is dismissed the way a real learner dismisses it, once, before measuring:
  // it is a legitimate part of the page, but it is not what is under test here.
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.setItem('voice-banner-dismissed', '1'); } catch (e) {} });
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const opened = await page.evaluate(() => { if (typeof window.openTranslator === 'function') { window.openTranslator(); return true; } return false; });
    console.log(`\n########## ${vp.name} · ${path}  ${opened ? '' : '(openTranslator MISSING)'}`);
    if (!opened) { defects++; continue; }
    await page.waitForSelector('#qs-input', { timeout: 10000 });
    await page.waitForTimeout(400);
    for (const q of QUERIES) {
      try { await ask(page, q); } catch {}
      const rows = await page.evaluate(MEASURE);
      for (const r of rows) {
        if (r.fatal) { console.log('  FATAL ' + r.fatal); defects++; continue; }
        if (r.missing) { console.log(`  "${q}" card${r.i}: no .qs-en at all`); defects++; continue; }
        const bad = !r.text || r.h === 0 || r.display === 'none' || r.heVisibleEnNot;
        if (bad) defects++;
        console.log(`  ${bad ? 'BLANK ' : 'ok    '} "${q}" c${r.i}: ${JSON.stringify(r.text).slice(0, 42)} ${r.w}x${r.h} `
          + `disp=${r.display} size=${r.fontSize} scroller=${r.scroller} enVisible=${r.insideScroller} heVisible=${r.heInside}`
          + `${r.heVisibleEnNot ? '  <== Hebrew visible, meaning cut off' : ''}`);
      }
    }
    await page.screenshot({ path: `tools/reports/modal-${vp.name}-${path.replace(/[^a-z0-9]/gi, '_')}.png` });
  }
  await page.close(); await ctx.close();
}
await browser.close();
console.log(`\n${defects} defect(s)`);
process.exit(defects ? 1 : 0);
