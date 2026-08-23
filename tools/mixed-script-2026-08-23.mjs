/* mixed-script-2026-08-23.mjs — un jeton étranger empoisonne-t-il la lecture de toute la carte ?
 *
 * Mesuré le 23/08 : hébreu pur sur 22 mots garde 86 % de mots à lecture vérifiée. Le blob de la
 * capture 3, lui, tombe à presque zéro — et il contenait du latin, des symboles et des chiffres.
 * La longueur n'est donc pas le facteur. L'hypothèse à tester est le MÉLANGE D'ÉCRITURES.
 *
 * Protocole : UNE phrase hébraïque fixe, la même partout, plus un contaminant à la fois. On
 * mesure la part des mots HÉBREUX (les autres ne sont pas concernés) dont la lecture porte la
 * signature du moteur vérifié : accent tonique en capitales ou tiret de syllabe.
 *
 * Falsifiable : si tous les contaminants laissent la part à 100 %, l'hypothèse est morte.
 *
 * Usage : node tools/serve.mjs 8912   puis   node tools/mixed-script-2026-08-23.mjs
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const BASE = process.env.BASE || 'http://localhost:8912';
const BASE_HE = 'סליחה האוטובוס שלי מאחר אני כנראה אאחר';   // 6 mots, tous vérifiés au départ
const N_HE = BASE_HE.split(/\s+/).length;

const CASES = [
  { id: 'témoin — hébreu seul',        input: BASE_HE },
  { id: '+ un mot latin',              input: BASE_HE + ' sorry' },
  { id: '+ un nom propre latin',       input: 'Talia ' + BASE_HE },
  { id: '+ un chiffre',                input: BASE_HE + ' 15' },
  { id: '+ une plage 10-15',           input: BASE_HE + ' 10-15' },
  { id: '+ une mention @',             input: '@Talia ' + BASE_HE },
  { id: '+ un tilde ~',                input: '@~Talia ' + BASE_HE },
  { id: '+ un symbole ✦',              input: BASE_HE + ' ✦' },
  { id: '+ une flèche ▾',              input: BASE_HE + ' ▾' },
  { id: '+ une URL',                   input: BASE_HE + ' https://x.co' },
  { id: '+ un emoji',                  input: BASE_HE + ' 🙂' },
  { id: '+ point collé au mot',        input: 'סליחה האוטובוס שלי מאחר.אני כנראה אאחר' },
];

const isHeb = s => /[֐-׿]/.test(s);
const VERIFIED = t => /[A-Z]/.test(t) || t.includes('-');

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

console.log(`phrase de base : ${N_HE} mots hébreux`);
console.log('');
console.log(`${'cas'.padEnd(28)} ${'vérifié'.padStart(9)}  lecture`);
console.log('-'.repeat(100));

for (const c of CASES) {
  await ask(page, c.input);
  const r = await page.evaluate(READ);
  const card = r.sections[0] && r.sections[0].cards[0];
  if (!card || !card.tr) { console.log(`${c.id.padEnd(28)} ${'PAS DE CARTE'.padStart(9)}`); continue; }

  /* On apparie hébreu et lecture par index quand les comptes concordent ; sinon on juge sur
     l'ensemble des jetons latins, ce qui est plus sévère mais jamais faussement rassurant. */
  const heToks = (card.he || '').trim().split(/\s+/).filter(Boolean);
  const trToks = card.tr.trim().split(/\s+/).filter(Boolean);
  let toks;
  if (heToks.length === trToks.length) {
    toks = trToks.filter((_, i) => isHeb(heToks[i]));     // seulement en face d'un mot hébreu
  } else {
    toks = trToks.filter(t => /[a-zA-Z]/.test(t));
  }
  const ok = toks.filter(VERIFIED).length;
  const pct = toks.length ? Math.round(100 * ok / toks.length) : 0;
  const flag = pct === 100 ? '' : '   <-- DÉGRADÉ';
  console.log(`${c.id.padEnd(28)} ${String(pct + ' %').padStart(9)}  ${card.tr.slice(0, 52)}${flag}`);
}

console.log('-'.repeat(100));
await browser.close();
process.exit(0);
