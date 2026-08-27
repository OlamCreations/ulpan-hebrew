/* parity-diag-2026-08-28.mjs — le HTML exact des cas que la barre de parité signale.
 *
 * La barre dit qu'un invariant est violé ; elle ne dit pas par quel noeud. Sans ce détail on
 * corrige le symptôme mesuré au lieu de la cause, et la sonde redevient verte sans que
 * l'apprenant voie de différence.
 *
 * Usage : node tools/parity-diag-2026-08-28.mjs [requête ...]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ask } from './translator-driver.mjs';

const ROOT = path.resolve('.');
const PORT = 8933;
const QUERIES = process.argv.slice(2).length ? process.argv.slice(2) : ['bureau'];

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

for (const q of QUERIES) {
  await ask(page, q);
  const d = await page.evaluate(() => {
    const r = document.getElementById('qs-results');
    const lead = r.querySelector('.qs-card:not(details .qs-card)');
    const subs = Array.from(r.querySelectorAll('.qs-sub')).map(n => ({
      text: n.textContent.trim().slice(0, 70),
      inDetails: !!n.closest('details'),
      parent: n.parentElement ? n.parentElement.className : null,
    }));
    return {
      subs,
      leadClass: lead ? lead.className : null,
      /* Le sens tel qu'il est LU par la barre, et le noeud d'où il sort. */
      enNodes: Array.from(r.querySelectorAll('.qs-en')).map(n => ({
        text: n.textContent.trim().slice(0, 60), cls: n.className,
        inDetails: !!n.closest('details'),
      })),
      tags: Array.from(r.querySelectorAll('[class*="qs-tag"]')).map(n => n.textContent.trim()),
      html: r.innerHTML.slice(0, 1400),
    };
  });
  console.log('\n=== « ' + q + ' » ===');
  console.log('carte de tête :', d.leadClass);
  console.log('titres .qs-sub :', JSON.stringify(d.subs, null, 1));
  console.log('noeuds .qs-en :', JSON.stringify(d.enNodes, null, 1));
  console.log('badges :', JSON.stringify(d.tags));
  console.log('--- html (1400 premiers) ---\n' + d.html);
}

await browser.close();
server.close();
