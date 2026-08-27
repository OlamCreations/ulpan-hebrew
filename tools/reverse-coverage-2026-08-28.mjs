/* reverse-coverage-2026-08-28.mjs — combien de mots VÉRIFIÉS sont atteignables quand on les tape.
 *
 * Le corpus d'ulpan-hebrew connaît 7136 mots hébreux avec leur sens vérifié. La recherche dans
 * ce sens-là (hébreu -> sens) les voit tous. La recherche dans l'autre (sens -> hébreu) ne
 * consulte que le phrasebook, 118 lignes. 2339 mots anglais sont donc sur le disque, vérifiés,
 * et partent quand même chercher une réponse en ligne — parfois une autre réponse.
 *
 * Ce fichier mesure ça, et rien d'autre : sur un échantillon de mots dont on SAIT qu'ils sont
 * dans le corpus, combien reviennent avec une réponse vérifiée, et combien partent en ligne.
 *
 * L'échantillon est pris à pas fixe et jamais au hasard : deux exécutions doivent rendre le même
 * chiffre, sinon « c'est passé de 4 % à 61 % » ne veut rien dire.
 *
 * Usage : node tools/reverse-coverage-2026-08-28.mjs [N]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ask } from './translator-driver.mjs';

const ROOT = path.resolve('.');
const PORT = 8934;
const N = Number(process.argv[2] || 25);

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* Les mots à tester : couverts par gloss.json, absents du phrasebook, un seul mot, assez longs
   pour ne pas être une syllabe. Le pas fixe balaie tout le corpus au lieu de s'agglutiner sur
   les premières lettres de l'alphabet. */
function sample(n) {
  const g = JSON.parse(fs.readFileSync('data/gloss.json', 'utf8')).v;
  const pb = JSON.parse(fs.readFileSync('data/phrasebook.json', 'utf8')).phrases || [];
  const inPb = new Set(pb.flatMap(p => [p.en, p.fr].filter(Boolean)
    .flatMap(x => x.split(' / ')).map(norm)));
  const seen = new Set();
  const all = [];
  for (const [he, en] of Object.entries(g)) {
    const k = norm(en);
    if (!k || k.includes(' ') || k.length < 4) continue;
    if (inPb.has(k) || seen.has(k)) continue;
    seen.add(k);
    all.push({ q: k, he: he });
  }
  const step = Math.max(1, Math.floor(all.length / n));
  const out = [];
  for (let i = 0; i < all.length && out.length < n; i += step) out.push(all[i]);
  return { picked: out, pool: all.length };
}

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

const { picked, pool } = sample(N);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage();
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const bare = s => String(s || '').replace(/[֑-ׇ]/g, '').replace(/[^א-ת]/g, '');
const CORPUS = new Set(Object.keys(JSON.parse(fs.readFileSync('data/gloss.json', 'utf8')).v).map(bare));
let verified = 0, right = 0, online = 0, nothing = 0;
const rows = [];

for (const c of picked) {
  await ask(page, c.q);
  const o = await page.evaluate(() => {
    const r = document.getElementById('qs-results');
    const lead = r.querySelector('.qs-card:not(details .qs-card)');
    if (!lead) return null;
    const t = s => { const x = lead.querySelector(s); return x ? x.textContent.trim() : ''; };
    const pairs = Array.from(lead.querySelectorAll('.qs-pairs .qs-wp-he')).map(n => n.textContent.trim());
    return {
      he: t('.qs-he') || pairs.join(' '),
      badge: Array.from(lead.querySelectorAll('.qs-tag')).map(n => n.textContent.trim()).join(' '),
    };
  });
  if (!o || !o.he) { nothing++; rows.push([c.q, c.he, '—', 'aucune réponse']); continue; }
  const isOnline = /online|phonetic/i.test(o.badge);
  /* « juste » ne veut pas dire « le mot que l'échantillon a tiré ». Un sens porte souvent
     plusieurs mots vérifiés (« drill » : la perceuse ET l'exercice militaire), et exiger celui
     du tirage ferait rougir une réponse parfaitement bonne. Ce qui compte est : le mot rendu
     est-il DANS le corpus vérifié. */
  const same = CORPUS.has(bare(o.he));
  if (isOnline) online++; else verified++;
  if (same) right++;
  rows.push([c.q, c.he, o.he, (isOnline ? 'en ligne' : 'vérifié') + (same ? '' : '  HORS corpus')]);
}

console.log(`\néchantillon : ${picked.length} mots pris à pas fixe dans ${pool} mots vérifiés hors phrasebook\n`);
for (const [q, want, got, how] of rows) {
  console.log(`  ${q.padEnd(14)} corpus ${want.padEnd(12)} rendu ${String(got).padEnd(12)} ${how}`);
}
console.log('\n' + '-'.repeat(70));
console.log(`répondu hors ligne (vérifié) : ${verified}/${picked.length}`);
console.log(`parti en ligne               : ${online}/${picked.length}`);
console.log(`aucune réponse               : ${nothing}/${picked.length}`);
console.log(`hébreu présent dans le corpus: ${right}/${picked.length}`);
console.log(`erreurs JS ${jsErrors.length}`);
for (const e of jsErrors.slice(0, 3)) console.log('   ' + e);

await browser.close();
server.close();
