/* Capture les trois badges cote a cote, dans les deux themes, pour REGARDER le changement.
   Un contraste vert ne dit pas si la hierarchie se lit ; seul l'oeil le dit. */
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:8912/';
const b = await chromium.launch({ headless: true, channel: 'chrome' });
for (const theme of ['dark', 'light']) {
  const ctx = await b.newContext({ viewport: { width: 520, height: 260 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => { document.documentElement.classList.toggle('light', t === 'light'); }, theme);
  await p.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'shot';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg);display:flex;align-items:center;justify-content:center;gap:14px;font-family:system-ui,sans-serif';
    host.innerHTML =
      '<span class="qs-tag qs-tag-curated">✓ lesson</span>' +
      '<span class="qs-tag qs-tag-online">online</span>' +
      '<span class="qs-tag qs-tag-phonetic">phonetic</span>';
    document.body.appendChild(host);
  });
  await p.waitForTimeout(300);
  const out = `tools/reports/badges-${theme}.png`;
  await p.locator('#shot').screenshot({ path: out });
  console.log('ecrit ' + out);
  await ctx.close();
}
await b.close();
