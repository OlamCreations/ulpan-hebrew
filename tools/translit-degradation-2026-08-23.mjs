/* translit-degradation-2026-08-23.mjs — à partir de quelle longueur la lecture cesse d'être fiable.
 *
 * Constat de la sonde du 23/08 : sur 3 mots la carte rend « sli-CHA tal-YA mar-KIN » (moteur
 * vérifié : syllabes + accent tonique). Sur 30 mots elle rend « saliha @~talia markin haotobus
 * shli meachar » — la romanisation de Google, sans syllabes ni accent, et phonétiquement fausse
 * (saliha ≠ sli-CHA). L'apprenant ne voit AUCUNE différence entre les deux : même carte, même
 * couleur, même place.
 *
 * On mesure donc la part de mots qui portent la signature du moteur vérifié (au moins une
 * MAJUSCULE d'accent tonique, ou un tiret de syllabe) en fonction du nombre de mots.
 *
 * Ce n'est pas une métrique de justesse : c'est une métrique de PROVENANCE. Un mot sans accent
 * tonique n'est pas forcément faux, mais il n'est pas passé par le chemin vérifié.
 *
 * Usage : node tools/serve.mjs 8912   puis   node tools/translit-degradation-2026-08-23.mjs
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const BASE = process.env.BASE || 'http://localhost:8912';

/* Une phrase hébraïque réelle, allongée par tranches. Chaque tranche est du hébreu courant,
   pas du remplissage : on veut mesurer la longueur, pas la rareté du vocabulaire. */
const CHUNKS = [
  'סליחה',
  'האוטובוס שלי מאחר',
  'אני כנראה אאחר',
  'בעשר דקות',
  'אני מצטער מאוד',
  'נתראה בקרוב',
  'תודה רבה על ההבנה',
  'שיהיה לך יום טוב',
];

/* Signature du moteur vérifié : accent tonique en capitales, ou tiret de syllabe. */
const VERIFIED = t => /[A-Z]/.test(t) || t.includes('-');

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

console.log(`${'mots'.padStart(5)} ${'chars'.padStart(6)}  ${'part vérifiée'.padStart(14)}  exemple de lecture`);
console.log('-'.repeat(96));

const rows = [];
for (let n = 1; n <= CHUNKS.length; n++) {
  const input = CHUNKS.slice(0, n).join(' ');
  await ask(page, input);
  const r = await page.evaluate(READ);
  const card = r.sections[0] && r.sections[0].cards[0];
  if (!card || !card.tr) { console.log(`${String(n).padStart(5)} ${String(input.length).padStart(6)}  ${'AUCUNE CARTE'.padStart(14)}`); continue; }

  // on ne compte que les jetons alphabétiques latins (on saute chiffres et ponctuation)
  const toks = card.tr.split(/\s+/).filter(t => /[a-zA-Z]/.test(t));
  const ok = toks.filter(VERIFIED).length;
  const pct = toks.length ? Math.round(100 * ok / toks.length) : 0;
  const heWords = (card.he || '').trim().split(/\s+/).filter(Boolean).length;
  rows.push({ n: heWords, chars: input.length, pct, tr: card.tr });
  console.log(`${String(heWords).padStart(5)} ${String(input.length).padStart(6)}  ${String(pct + ' %').padStart(14)}  ${card.tr.slice(0, 60)}`);
}

console.log('-'.repeat(96));
const first = rows.find(r => r.pct < 100);
if (first) {
  console.log(`Premier décrochage : ${first.n} mots (${first.chars} caractères), ${first.pct} % de mots vérifiés.`);
} else {
  console.log('Aucun décrochage sur cette plage : la lecture reste vérifiée jusqu\'au bout.');
}
const worst = rows.reduce((a, b) => (b.pct < a.pct ? b : a), rows[0] || { pct: 100 });
if (rows.length) console.log(`Pire point : ${worst.n} mots -> ${worst.pct} % vérifiés.`);

await browser.close();
process.exit(0);
