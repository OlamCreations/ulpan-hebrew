/* Guard: handwriting (ktav yad) must never render SMALLER than the printed Hebrew it replaces.
 *
 * Why this file exists. The cursive rule used to read `font-size: 1.15em`, written as a nudge
 * upward. On font-size, `em` resolves against the PARENT, not against the element's own size, so
 * 1.15em against a 17px .word-row produced ~19.6px where print was 36px — cursive shipped at 54%
 * of print for months, on the one script the learner is still decoding. Nothing failed; it just
 * looked small.
 *
 * The check therefore does two things, and the second is the point: it measures the fix, AND it
 * re-injects the old rule to confirm it can still tell broken from fixed. A size guard that cannot
 * go red is indistinguishable from no guard at all.
 *
 * Run: node tools/serve.mjs 8912   (in another shell)
 *      node tools/cursive-size-check.mjs [--base http://localhost:8912]
 */
import { chromium } from 'playwright-core';

const baseArg = process.argv.indexOf('--base');
const BASE = baseArg > -1 ? process.argv[baseArg + 1] : 'http://localhost:8912';
const PAGE = '/lessons/03-common-words.html';
const VIEWPORTS = [{ name: 'laptop', width: 1440 }, { name: 'mobile', width: 390 }];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const rows = [];
for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: 900 } });
  await page.goto(BASE + PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  const m = await page.evaluate(async () => {
    const el = document.querySelector('.word-row .he');
    if (!el) return null;
    const px = () => parseFloat(getComputedStyle(el).fontSize);
    const family = () => getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '');
    const print = px();
    document.body.classList.add('cursive');
    await new Promise(r => requestAnimationFrame(r));
    const fixed = { px: px(), family: family() };
    const s = document.createElement('style');           // injected defect: the pre-fix rule
    s.textContent = 'body.cursive .word-row .he { font-size: 1.15em !important; }';
    document.head.appendChild(s);
    await new Promise(r => requestAnimationFrame(r));
    const broken = px();
    s.remove();
    document.body.classList.remove('cursive');
    return { print, fixed, broken };
  });
  await page.close();
  if (!m) { rows.push({ viewport: vp.name, error: 'no .word-row .he on ' + PAGE }); continue; }
  rows.push({
    viewport: vp.name,
    printPx: m.print,
    cursivePx: m.fixed.px,
    ratio: +(m.fixed.px / m.print).toFixed(2),
    fontApplied: m.fixed.family === 'KtavYad',
    defectPx: m.broken,
    // The two properties that must BOTH hold for this file to mean anything.
    notSmaller: m.fixed.px >= m.print,
    goesRedOnDefect: Math.abs(m.fixed.px - m.broken) > 1
  });
}
await browser.close();

console.table(rows);
const bad = rows.filter(r => r.error || !r.notSmaller || !r.fontApplied || !r.goesRedOnDefect);
if (bad.length) {
  console.error('\nFAIL\n' + bad.map(r => '  ' + r.viewport + ': ' + JSON.stringify(r)).join('\n'));
  process.exit(1);
}
console.log('\nPASS — cursive >= print at every breakpoint, KtavYad applied, and the guard still '
  + 'reddens on the old `1.15em` rule.');
