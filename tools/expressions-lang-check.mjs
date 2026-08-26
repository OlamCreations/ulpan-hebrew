#!/usr/bin/env node
/*
 * expressions-lang-check.mjs — un champ de langue contient-il bien cette langue ?
 *
 * Ce contrôle existe parce que personne ne posait la question. `data/expressions.json` a porté,
 * pendant des mois, un champ nommé **`fr`** dont **aucune** des 129 lignes n'était en français
 * ("cool / OK / awesome", "broken heart"), et `reference/expressions.html` l'affichait tel quel
 * dans `.xp-fr`. Un francophone y lisait donc de l'anglais dans un champ qui promettait du
 * français, et rien dans la chaîne ne pouvait s'en apercevoir : un nom de champ n'est vérifié
 * par personne.
 *
 * Quatre règles :
 *   E1  chaque expression a une glose anglaise (`en`)
 *   E2  chaque expression a une glose française (`fr`)
 *   E3  `fr` diffère de `en` — un champ recopié est la panne d'origine qui revient
 *   E4  `fr` ne contient pas de mot anglais franc (a/the/of/with/…), ce qui trahit une copie
 *
 * E4 est délibérément grossière : elle attrape la recopie en masse, pas la nuance de traduction.
 * Un faux positif se règle en ajoutant le mot à ALLOWED, jamais en désactivant la règle.
 *
 *   node tools/expressions-lang-check.mjs [--self-test]
 * Hors ligne, aucun prérequis.
 */
import { readFileSync } from 'node:fs';

const FILE = new URL('../data/expressions.json', import.meta.url);

/* Mots anglais qui ne peuvent pas apparaître dans une glose française honnête. Volontairement
   court et sans ambiguïté : "cool", "OK", "stop", "top" sont français aussi et n'y sont pas. */
/* Un ENSEMBLE de mots entiers, jamais une regex à \b : la limite de mot de JavaScript est ASCII,
   donc /\ba\b/ trouve le « a » DANS « ça » et dans « l'a ». Première version de cette règle :
   sept faux positifs, tous des mots français parfaitement corrects. Une règle qui rougit sur du
   bon travail finit désactivée, et c'est ainsi qu'on perd une règle. */
const ENGLISH_TELLS = new Set(['the', 'an', 'of', 'with', 'your', 'you', 'is', 'are', 'it',
  'nothing', 'thing', 'good', 'bad', 'great', 'well', 'done', 'really', 'enough', 'please',
  'sorry', 'hand', 'heart', 'head', 'mouth', 'eye', 'dog', 'cat', 'fish', 'bird', 'horse',
  'donkey', 'elephant', 'salt', 'bread', 'wine', 'milk', 'honey', 'money', 'work', 'life',
  'time', 'awesome', 'blunt', 'jerk', 'pest', 'idiot', 'fine', 'exactly', 'wrong', 'married']);
const ALLOWED = new Set(['stop', 'cool', 'ok', 'super', 'top', 'wow', 'week-end']);

export function check(list) {
  const out = [];
  for (const e of list) {
    const id = e.translit || e.he;
    if (!e.en || !String(e.en).trim()) out.push({ id, rule: 'E1', msg: 'pas de glose anglaise' });
    if (!e.fr || !String(e.fr).trim()) { out.push({ id, rule: 'E2', msg: 'pas de glose française' }); continue; }
    /* Identique n'est pas toujours recopie : « excellent » s'ecrit pareil dans les deux langues.
       La liste est courte et explicite, parce qu'une exception muette rouvrirait exactement la
       porte que cette regle ferme. */
    const SAME_IN_BOTH = new Set(['excellent', 'wow', 'cool']);
    const same = String(e.fr).trim() === String(e.en || '').trim();
    if (same && !SAME_IN_BOTH.has(String(e.fr).trim().toLowerCase())) {
      out.push({ id, rule: 'E3', msg: `fr recopie en : "${e.fr}"` });
    }
    // Découpe sur l'apostrophe aussi : « l'a » doit rendre « l » et « a », pas le mot collé.
    const words = String(e.fr).toLowerCase().split(/[^a-zà-ÿ]+/).filter(Boolean);
    const tell = words.find(w => !ALLOWED.has(w) && ENGLISH_TELLS.has(w));
    if (tell) out.push({ id, rule: 'E4', msg: `mot anglais dans fr : "${tell}" (${e.fr})` });
  }
  return out;
}

/* Les fixtures sont l'état RÉEL d'avant et d'après, pas un cas fabriqué : une règle éprouvée sur
   un défaut inventé ne prouve pas qu'elle aurait attrapé celui qui est passé. */
const FIXTURES = {
  bad: [{ translit: 'lev shavur', en: 'broken heart', fr: 'broken heart' },
        { translit: 'sababa', en: 'cool / OK / awesome', fr: 'cool / OK / awesome' }],
  good: [{ translit: 'lev shavur', en: 'broken heart', fr: 'le cœur brisé' },
         { translit: 'sababa', en: 'cool / OK / awesome', fr: 'cool / OK / super' }],
};

if (process.argv.includes('--self-test')) {
  const onBad = check(FIXTURES.bad);
  const onGood = check(FIXTURES.good);
  let bad = 0;
  if (!onBad.length) { console.log('FAIL la règle reste verte sur le défaut réel'); bad++; }
  else console.log(`  ok   rouge sur le défaut réel : ${onBad.map(x => x.rule).join(',')}`);
  if (onGood.length) { console.log('FAIL la règle rougit sur des données correctes : ' + JSON.stringify(onGood)); bad++; }
  else console.log('  ok   verte sur les données corrigées');
  console.log(`\n${2 - bad}/2 assertions du self-test`);
  process.exit(bad ? 1 : 0);
}

const list = JSON.parse(readFileSync(FILE, 'utf8')).expressions || [];
const found = check(list);
for (const f of found) console.log(`  ${f.rule} ${f.id}: ${f.msg}`);
console.log(`${list.length} expressions, ${found.length} problème(s)`);
process.exit(found.length ? 1 : 0);
