/* terms-translit.mjs — vocalise et translittère une liste de termes hébreux.
 *
 * Pourquoi passer par la page plutôt que d'écrire la lecture à la main : la translittération
 * d'un mot hébreu NU est indevinable (translit.js le dit lui-même, il exige le niqqud). Écrire
 * « Mishor HaGefen » de mémoire, c'est fabriquer la donnée qu'un document présente comme un fait.
 * Ici l'hébreu vient de la source, le niqqud de Dicta via le Worker, et la lecture du moteur
 * vérifié du site. Rien n'est retapé.
 *
 * Le fichier d'entrée porte `{ terms: [{ he, fr }] }` et vit AVEC le document qui le consomme,
 * pas ici : ce script est l'outil, la liste est la donnée de quelqu'un d'autre.
 *
 * Usage : node tools/serve.mjs 8912
 *         node tools/terms-translit.mjs --terms <chemin.json> [--out <chemin.json>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const BASE = process.env.BASE || 'http://localhost:8912';
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const termsPath = arg('--terms');
if (!termsPath) {
  console.error('usage : node tools/terms-translit.mjs --terms <chemin.json> [--out <chemin.json>]');
  process.exit(2);
}
const SRC = pathToFileURL(termsPath);
const OUT = pathToFileURL(arg('--out') || termsPath.replace(/\.json$/, '') + '-translit.json');

const { terms, _source } = JSON.parse(readFileSync(SRC, 'utf8'));
const NIQQUD = /[֑-ׇ]/;

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await (await browser.newContext()).newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const out = [];
for (const t of terms) {
  let card = null;
  try {
    await ask(page, t.he);
    const r = await page.evaluate(READ);
    /* On prend la carte dont l'hébreu a les MÊMES consonnes que l'entrée : le traducteur peut
       proposer d'autres lectures, et une carte voisine donnerait la lecture d'un autre mot. */
    const bare = s => (s || '').replace(/[֑-ׇ]/g, '').replace(/\s+/g, ' ').trim();
    for (const s of r.sections) {
      for (const c of s.cards) {
        if (bare(c.he) === bare(t.he)) { card = c; break; }
      }
      if (card) break;
    }
  } catch { /* laissé null : mieux vaut un trou déclaré qu'une lecture inventée */ }

  const voc = card ? (card.he || '') : '';
  const tr = card ? (card.tr || '') : '';
  out.push({
    he: t.he,
    fr: t.fr,
    vocalized: voc,
    hasNiqqud: NIQQUD.test(voc),
    translit: tr,
    resolved: !!(voc && tr),
  });
  console.log(`${t.he.padEnd(22)} ${voc.padEnd(26)} ${tr || '(non résolu)'}`);
}

mkdirSync(dirname(OUT.pathname.replace(/^\/([A-Za-z]:)/, '$1')), { recursive: true });
writeFileSync(OUT, JSON.stringify({ _source, generated: 'terms-translit.mjs', terms: out }, null, 2), 'utf8');
const ok = out.filter(o => o.resolved).length;
console.log('');
console.log(`${ok}/${out.length} termes résolus par le moteur vérifié`);
const missing = out.filter(o => !o.resolved).map(o => o.he);
if (missing.length) console.log('non résolus (à ne PAS combler à la main) :', missing.join(' · '));

await browser.close();
process.exit(0);
