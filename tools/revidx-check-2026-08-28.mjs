/* revidx-check-2026-08-28.mjs — l'index inverse répond-il, et sa réponse arrive-t-elle à l'écran ?
 *
 * Deux questions distinctes, et les confondre est ce qui fait corriger le mauvais étage : un
 * index qui trouve mais dont la carte est reléguée derrière la réponse en ligne ressemble, à
 * l'écran, à un index qui ne trouve rien.
 *
 * Usage : node tools/revidx-check-2026-08-28.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ask } from './translator-driver.mjs';

const ROOT = path.resolve('.');
const PORT = 8935;
const WORDS = ['drill', 'attack', 'garden', 'manhole', 'skirt'];

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('JS ' + e));
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const api = await page.evaluate(() => ({
  hasFn: !!(window.QuickSay && window.QuickSay._glossReverse),
  hasLoad: !!(window.QuickSay && window.QuickSay._loadGloss),
}));
console.log('API exposée :', JSON.stringify(api));
if (!api.hasFn) { console.log('!! _glossReverse absent — le fichier servi n\'est pas celui du disque'); }

await page.evaluate(() => window.QuickSay._loadGloss());
await page.waitForTimeout(600);

console.log('\n--- étage 1 : ce que l\'index rend ---');
for (const w of WORDS) {
  const r = await page.evaluate(q => {
    try { return window.QuickSay._glossReverse(q).map(x => x.he + ' (' + (x.tr || 'sans lecture') + ') = ' + x.en); }
    catch (e) { return ['exception : ' + e.message]; }
  }, w);
  console.log(`  ${w.padEnd(10)} ${r.length ? r.join(' | ') : '(rien)'}`);
}

console.log('\n--- étage 2 : ce que l\'écran montre ---');
for (const w of WORDS) {
  await ask(page, w);
  const o = await page.evaluate(() => {
    const r = document.getElementById('qs-results');
    const cards = Array.from(r.querySelectorAll('.qs-card'));
    return cards.slice(0, 3).map(c => {
      const t = s => { const x = c.querySelector(s); return x ? x.textContent.trim() : ''; };
      return {
        he: t('.qs-he'),
        badge: Array.from(c.querySelectorAll('.qs-tag')).map(n => n.textContent.trim()).join(','),
        hidden: !!c.closest('details:not([open])'),
      };
    });
  });
  console.log(`  ${w.padEnd(10)} ${o.map(c => `${c.he}[${c.badge || 'sans badge'}]${c.hidden ? '(replié)' : ''}`).join('  ')}`);
}

await browser.close();
server.close();
