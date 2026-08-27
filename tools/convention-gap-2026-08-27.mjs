/* convention-gap-2026-08-27.mjs — les deux apps lisent-elles l'hébreu de la même façon ?
 *
 * kita10 stocke une lecture ÉCRITE À LA MAIN par entrée (champ `translit`, 3467 entrées) et n'a
 * aucun moteur. ulpan-hebrew a un moteur vérifié (translit.js) et aucune lecture stockée.
 * Amener le traducteur partagé dans kita10, c'est y amener translit.js — et donc afficher deux
 * lectures du même mot dans la même app si les conventions divergent.
 *
 * Cette sonde mesure la divergence AVANT de décider laquelle est la source de vérité. Elle ne
 * compare que les entrées POINTÉES : sur des consonnes nues le moteur ne prétend rien.
 *
 * Sortie : taux d'accord exact, taux d'accord une fois la casse et les traits de syllabe
 * neutralisés (c'est-à-dire la même lecture écrite autrement), et un échantillon des vrais
 * désaccords — ceux où les deux disent des sons différents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../assets/translit.js');

const KITA10 = process.env.KITA10 || 'C:/dev/projects/ulpan-etzion/data/days';

const hasNiqqud = s => /[\u05B0-\u05BC\u05C1\u05C2\u05C7]/.test(s);
const fold = s => String(s || '')
  .toLowerCase()
  .replace(/[-'’ʼ]/g, '')      // traits de syllabe et apostrophes : mise en forme, pas son
  .replace(/\s+/g, ' ')
  .trim();

const items = [];
const walk = o => {
  if (!o) return;
  if (Array.isArray(o)) return o.forEach(walk);
  if (typeof o !== 'object') return;
  if (typeof o.he === 'string' && typeof o.translit === 'string' && /[\u0590-\u05FF]/.test(o.he)) {
    items.push({ he: o.he.trim(), tr: o.translit.trim() });
  }
  Object.values(o).forEach(walk);
};
for (const f of fs.readdirSync(KITA10).filter(x => x.endsWith('.json'))) {
  walk(JSON.parse(fs.readFileSync(path.join(KITA10, f), 'utf8')));
}

const pointed = items.filter(i => i.he.split(/\s+/).every(w => !/[\u05D0-\u05EA]/.test(w) || hasNiqqud(w)));
let exact = 0, folded = 0;
const diffs = [];
for (const it of pointed) {
  const mine = it.he.split(/\s+/).map(w => T.transliterate(w)).filter(Boolean).join(' ');
  if (mine === it.tr) { exact++; folded++; continue; }
  if (fold(mine) === fold(it.tr)) { folded++; continue; }
  diffs.push({ he: it.he, kita10: it.tr, engine: mine });
}

console.log(`entrées kita10 avec he + translit      ${items.length}`);
console.log(`... dont entièrement pointées          ${pointed.length}`);
console.log(`accord EXACT (chaîne identique)        ${exact}  (${(100 * exact / pointed.length).toFixed(0)} %)`);
console.log(`accord une fois casse+traits neutres   ${folded}  (${(100 * folded / pointed.length).toFixed(0)} %)`);
console.log(`vrais désaccords (sons différents)     ${diffs.length}  (${(100 * diffs.length / pointed.length).toFixed(0)} %)`);
console.log('\n40 premiers désaccords réels :');
for (const d of diffs.slice(0, 40)) console.log(`   ${d.he.padEnd(18)} kita10="${d.kita10}"   moteur="${d.engine}"`);

/* Les désaccords les plus fréquents, par forme : un désaccord qui revient 50 fois est une règle
   de convention, un désaccord unique est une coquille. Les deux se corrigent différemment. */
const byShape = new Map();
for (const d of diffs) {
  const k = `${fold(d.kita10)} :: ${fold(d.engine)}`;
  byShape.set(k, (byShape.get(k) || 0) + 1);
}
const top = [...byShape.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log('\nformes de désaccord les plus fréquentes :');
for (const [k, n] of top) console.log(`   ${String(n).padStart(4)}  ${k}`);
