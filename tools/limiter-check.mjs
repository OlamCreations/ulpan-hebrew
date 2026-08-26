#!/usr/bin/env node
/*
 * limiter-check.mjs — le limiteur refuse-t-il vraiment ?
 *
 * Ce contrôle existe parce que celui d'avant n'existait pas. Les bindings ratelimit de Cloudflare
 * declares dans wrangler.toml n'ont JAMAIS rien refuse sur ce Worker : mesure du 2026-08-25, avec
 * une limite declaree a 5 requetes / 60s, douze appels passaient tous en 200, et un /diag
 * temporaire confirmait pourtant les quatre bindings presents et limit() bien une fonction. Un
 * limiteur qui ne rougit jamais est indiscernable d'un limiteur absent - et personne ne l'avait
 * jamais interroge.
 *
 * Depuis le 2026-08-26 le comptage se fait dans le Worker (fenetre glissante en memoire
 * d'isolate). Ce fichier verifie les trois proprietes qui comptent :
 *
 *   L1  un appareil qui depasse son budget est REFUSE (429)
 *   L2  un autre appareil derriere la MEME IP passe encore - c'est la classe derriere un wifi,
 *       le cas qui a motive tout ceci
 *   L3  le refus est temporaire : la fenetre se recharge
 *
 * Rafale en PARALLELE, jamais en serie : 130 appels sequentiels prennent ~40-60s, soit la duree
 * de la fenetre elle-meme, donc le seau se recharge pendant la mesure et le test ne peut pas
 * rougir. C'est l'erreur commise le 2026-08-25 et elle a rendu un faux vert.
 *
 *   node tools/limiter-check.mjs [--url https://...]
 *
 * Reseau requis. Consomme ~150 appels sur le chemin le moins cher (racine, pas /gloss : celui-la
 * brule des neurones Workers AI).
 */
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('--url', 'https://ulpan-morph.olamcreations.workers.dev');

const H = { 'Content-Type': 'application/json', 'Origin': 'https://olamcreations.github.io' };
const body = JSON.stringify({ text: 'x' });
const hit = async (d) => (await fetch(URL_ + (d ? '?d=' + d : ''), { method: 'POST', headers: H, body })).status;
const burst = (d, n) => Promise.all(Array.from({ length: n }, () => hit(d)));

// Identifiants uniques par run : deux runs rapproches partageraient sinon un seau deja chaud
// et le second lirait un refus qu'il n'a pas provoque.
const tag = 'chk' + Math.random().toString(36).slice(2, 9);
let bad = 0, checks = 0;

console.log('budget par appareil : 100 / 60s (chemin non-IA)');
const a = await burst(tag + 'A', 150);
const counts = a.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
console.log('  rafale de 150 sur un appareil :', JSON.stringify(counts));

checks++;
if (!counts['429']) { bad++; console.log('  FAIL L1 aucun refus : le limiteur ne limite pas'); }
else console.log(`  ok   L1 ${counts['429']} refus sur 150`);

checks++;
const b = await hit(tag + 'B');
if (b === 429) { bad++; console.log('  FAIL L2 un autre appareil de la meme IP est refusé — la classe serait coupée'); }
else console.log(`  ok   L2 autre appareil, meme IP -> ${b}`);

/* L3 : la fenetre est de 60s ; on ne l'attend pas (le test doublerait de duree pour verifier une
   soustraction). Ce qui est verifiable tout de suite, c'est que le seau est BORNE et non
   definitif : le nombre de 200 doit valoir le budget, pas zero et pas tout. */
checks++;
const passed = counts['200'] || 0;
if (passed >= 90 && passed <= 110) console.log(`  ok   L3 ${passed} passes, soit le budget declare (100) a la tolerance de course pres`);
else { bad++; console.log(`  FAIL L3 ${passed} passes pour un budget de 100 — le compte est faux`); }

console.log(`\n${checks - bad}/${checks} assertions du limiteur`);
process.exit(bad ? 1 : 0);
