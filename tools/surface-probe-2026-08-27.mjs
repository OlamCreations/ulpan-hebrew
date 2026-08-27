/* surface-probe-2026-08-27.mjs — ce que la carte MONTRE, pas ce que le moteur trouve.
 *
 * Motif : le 27/08 Jonas dit « le live translator fonctionne très mal, le code est trop
 * compliqué et ça embrouille tout ». Les sondes existantes mesurent la JUSTESSE (le moteur
 * trouve-t-il la bonne réponse). Elles rendent vert. Aucune ne mesure la LISIBILITÉ : combien
 * de cartes, sous quel titre, avec quel mélange de provenances.
 *
 * Les requêtes hébraïques ne sont pas choisies ici : elles sont TIRÉES du corpus de kita10
 * (C:/dev/projects/ulpan-etzion/data/days), c'est-à-dire du vocabulaire réellement vu en cours.
 * Échantillon déterministe (pas au hasard) : un mot tous les N, graine fixe, pour que deux runs
 * mesurent la même chose. Si le dossier kita10 est absent, la sonde le dit et s'arrête plutôt
 * que de se rabattre sur des mots inventés ici.
 *
 * Usage : node tools/surface-probe-2026-08-27.mjs
 *         BASE=http://localhost:8912 node tools/surface-probe-2026-08-27.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const BASE = process.env.BASE || 'https://olamcreations.github.io/ulpan-hebrew';
const KITA10 = process.env.KITA10 || 'C:/dev/projects/ulpan-etzion/data/days';
const N_HE = 8;   // mots hébreux pointés, tirés de kita10
const N_BARE = 4; // les mêmes, dénudés de leur niqqud : ce qu'on tape vraiment au clavier

function kita10Words() {
  if (!fs.existsSync(KITA10)) {
    console.error(`ARRÊT : corpus kita10 introuvable (${KITA10}). Aucune substitution : des mots
choisis ici mesureraient mon jugement, pas le vocabulaire de la classe.`);
    process.exit(2);
  }
  const words = new Set();
  const walk = o => {
    if (!o) return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o !== 'object') return;
    if (typeof o.he === 'string' && /[\u0590-\u05FF]/.test(o.he) && o.he.trim().split(/\s+/).length === 1) {
      words.add(o.he.trim());
    }
    Object.values(o).forEach(walk);
  };
  for (const f of fs.readdirSync(KITA10).filter(x => x.endsWith('.json'))) {
    walk(JSON.parse(fs.readFileSync(path.join(KITA10, f), 'utf8')));
  }
  return [...words];
}

const stripNiqqud = s => s.replace(/[\u0591-\u05C7]/g, '');

const all = kita10Words();
const step = Math.max(1, Math.floor(all.length / (N_HE + N_BARE)));
const picked = [];
for (let i = 0; picked.length < N_HE + N_BARE && i < all.length; i += step) picked.push(all[i]);

const CASES = [
  ...picked.slice(0, N_HE).map((w, i) => ({ id: `he-${i + 1}`, input: w })),
  ...picked.slice(N_HE).map((w, i) => ({ id: `he-bare-${i + 1}`, input: stripNiqqud(w) })),
  /* Les latines, elles, sont ce qu'on tape quand on cherche à DIRE quelque chose. */
  { id: 'fr-mot-01', input: 'bureau' },
  { id: 'fr-mot-02', input: 'demain' },
  { id: 'fr-phr-01', input: "je n'ai pas compris" },
  { id: 'en-mot-01', input: 'homework' },
  { id: 'en-phr-01', input: 'can you repeat please' },
  { id: 'rom-01', input: 'beseder' },
  { id: 'rom-02', input: 'kacha kacha' },
];

const badgeOf = en => {
  if (!en) return 'none';
  if (/✓/.test(en)) return 'verified';
  if (/phonetic/i.test(en)) return 'phonetic';
  if (/online/i.test(en)) return 'online';
  return 'plain';
};

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage();
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

console.log(`corpus kita10 : ${all.length} mots hébreux d'un seul mot ; ${N_HE + N_BARE} tirés (pas ${step})\n`);

const rows = [];
for (const c of CASES) {
  let settled = true;
  try { await ask(page, c.input); } catch { settled = false; }
  const r = await page.evaluate(READ);
  const cards = r.sections.flatMap(s => s.cards);
  const badges = cards.map(x => badgeOf(x.en));
  rows.push({
    id: c.id, input: c.input, settled,
    sections: r.sections.map(s => s.title),
    nCards: cards.length, badges,
    topBadge: badges[0] || 'none',
    firstHe: (cards[0] || {}).he || null,
    firstEn: (cards[0] || {}).en || null,
    hint: r.hint,
  });
  console.log('='.repeat(78));
  console.log(`[${c.id}] "${c.input}"  cartes=${cards.length}  settled=${settled}`);
  for (const s of r.sections) {
    console.log(`   § ${s.title}`);
    for (const card of s.cards) console.log(`       ${card.he}  |  ${card.tr}  |  ${card.en}`);
  }
  if (r.hint) console.log(`   hint: ${r.hint}`);
}

console.log('\n' + '#'.repeat(78));
console.log('BILAN DE SURFACE');
const n = rows.length;
const avg = (rows.reduce((a, r) => a + r.nCards, 0) / n).toFixed(1);
const zero = rows.filter(r => r.nCards === 0);
const over2 = rows.filter(r => r.nCards > 2).length;
const guessy = rows.filter(r => r.badges.includes('phonetic') || r.badges.includes('online')).length;
const mixed = rows.filter(r => new Set(r.badges).size > 1).length;
const didYouMean = rows.filter(r => r.sections.some(t => /did you mean/i.test(t)));
const didYouMeanButVerified = didYouMean.filter(r => r.topBadge === 'verified');
console.log(`requêtes                          ${n}`);
console.log(`cartes par requête (moyenne)      ${avg}`);
console.log(`requêtes rendant 0 carte          ${zero.length}/${n}`);
for (const r of zero) console.log(`      ${r.input}  hint=${r.hint || '(rien)'}`);
console.log(`requêtes rendant > 2 cartes       ${over2}/${n}`);
console.log(`requêtes mêlant plusieurs sources ${mixed}/${n}`);
console.log(`requêtes portant une devinette    ${guessy}/${n}`);
console.log(`titre « did you mean? »           ${didYouMean.length}/${n}`);
console.log(`  ... dont la 1re carte est VÉRIFIÉE (le titre ment) : ${didYouMeanButVerified.length}`);
for (const r of didYouMeanButVerified) console.log(`      ${r.input} -> ${r.firstHe} (${r.firstEn})`);
console.log(`erreurs JS                        ${jsErrors.length}`);
for (const e of jsErrors) console.log('   ' + e);

await browser.close();
