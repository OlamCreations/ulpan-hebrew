/* gloss-delta-2026-08-27.mjs — ce qu'une nouvelle source AJOUTE, et ce qu'elle FAIT PERDRE.
 *
 * Le générateur écarte toute forme dont le squelette consonantique porte plusieurs
 * vocalisations ou plusieurs sens. Ajouter une source peut donc créer une ambiguïté là où il
 * n'y en avait pas, et SUPPRIMER une entrée qui marchait. Le total peut monter pendant que des
 * mots disparaissent : « +276 entrées » ne dit rien sur ce point, et c'est exactement le genre
 * de chiffre qui rassure à tort.
 *
 * On compare donc les deux ENSEMBLES DE CLÉS, pas leurs tailles.
 *
 * Usage : node tools/gloss-delta-2026-08-27.mjs --before <gloss.json d'avant> [--after data/gloss.json]
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const BEFORE = path.resolve(arg('--before'));
const AFTER = path.resolve(arg('--after') || 'data/gloss.json');

const load = p => JSON.parse(fs.readFileSync(p, 'utf8')).v || {};
const a = load(BEFORE), b = load(AFTER);
const ka = new Set(Object.keys(a)), kb = new Set(Object.keys(b));

const lost = [...ka].filter(k => !kb.has(k));
const gained = [...kb].filter(k => !ka.has(k));
const changed = [...ka].filter(k => kb.has(k) && a[k] !== b[k]);

console.log(`avant   ${ka.size} entrées`);
console.log(`après   ${kb.size} entrées`);
console.log(`gagnées ${gained.length}`);
console.log(`PERDUES ${lost.length}`);
console.log(`sens modifié sur une clé conservée : ${changed.length}`);

if (lost.length) {
  console.log('\nles 20 premières perdues (une entrée qui marchait et qui ne répond plus) :');
  for (const k of lost.slice(0, 20)) console.log(`   ${k}  était « ${a[k]} »`);
}
if (changed.length) {
  console.log('\nles 15 premiers sens modifiés (la nouvelle source a pris la main) :');
  for (const k of changed.slice(0, 15)) console.log(`   ${k}  « ${a[k]} » -> « ${b[k]} »`);
}
console.log('\n' + (lost.length === 0
  ? 'Aucune entrée perdue : la source est purement additive.'
  : `${lost.length} entrée(s) perdue(s) — à peser contre les ${gained.length} gagnées avant de livrer.`));
