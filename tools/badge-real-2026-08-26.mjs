/* Le tir precedent montrait des badges que j'avais fabriques a la main dans un div : il prouvait
   le CSS, pas l'ecran. Celui-ci tape une vraie requete et photographie la carte REELLE que le
   moteur rend, badges compris. Une requete qui produit a la fois du verifie et du non verifie. */
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:8912/';
const Q = process.argv[3] || 'beseder';
const b = await chromium.launch({ headless: true, channel: 'chrome' });
for (const theme of ['dark', 'light']) {
  const ctx = await b.newContext({ viewport: { width: 900, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => document.documentElement.classList.toggle('light', t === 'light'), theme);
  const input = p.locator('#qs-input, .qs-input, input[type="search"]').first();
  await input.waitFor({ timeout: 15000 });
  await input.click();
  await p.keyboard.type(Q, { delay: 40 });
  await p.waitForFunction(() => {
    const r = document.querySelector('#qs-results, .qs-results');
    return r && r.querySelectorAll('.qs-tag').length > 0;
  }, { timeout: 30000 });
  await p.waitForTimeout(1500);
  const tags = await p.$$eval('.qs-tag', ns => ns.map(n => n.className.replace('qs-tag ', '') + ':' + n.textContent.trim()));
  console.log(`[${theme}] badges rendus : ${tags.join(' | ') || '(aucun)'}`);
  if (!tags.length) { console.log('ECHEC : aucun badge sur un ecran reel'); process.exit(1); }
  const out = `tools/reports/carte-reelle-${theme}.png`;
  await p.locator('#qs-results, .qs-results').first().screenshot({ path: out });
  console.log('  ecrit ' + out);
  await ctx.close();
}
await b.close();
