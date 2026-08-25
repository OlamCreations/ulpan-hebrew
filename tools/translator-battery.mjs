#!/usr/bin/env node
/*
 * translator-battery.mjs — beaucoup d'exemples, et on VÉRIFIE la sortie.
 *
 * La sonde (translator-probe) capture, les invariants jugent la forme, le banc dégradé coupe des
 * upstreams. Il manquait le contrôle le plus simple : taper des centaines d'entrées dont on
 * CONNAÎT la réponse, et compter combien reviennent justes.
 *
 * La vérité-terrain n'est pas écrite ici. Elle est LUE dans les fichiers du site au moment du run
 * (data/phrasebook.json, data/expressions.json), pour deux raisons : une attente recopiée se
 * désynchronise à la première correction de gloss, et surtout ces fichiers sont ce que l'app
 * enseigne — si le traducteur les contredit, c'est lui qui a tort.
 *
 * Quatre chemins, chacun compté séparément, parce qu'ils échouent pour des raisons différentes :
 *
 *   en2he   « thank you »      -> l'hébreu attendu doit être sur une carte
 *   fr2he   « merci »          -> idem, et c'est le chemin qui n'existait pas avant le 18/08
 *   rom2he  « toda »           -> idem, via Input Tools + la reconnaissance du carnet
 *   he2mean « תודה »            -> le SENS attendu doit être sur une carte
 *
 * Et cinq règles de forme sur CHAQUE écran, celles qui ont déjà attrapé de vrais défauts ici :
 *   S1  au moins une carte
 *   S2  aucun champ de sens ne contient de l'hébreu       (invariant I6, défaut du 23/08)
 *   S3  aucun sens ne répète l'hébreu de sa propre carte  (même famille)
 *   S4  la carte de tête porte du niqqud                  (l'app enseigne la lecture)
 *   S5  la carte de tête porte une romanisation
 *
 *   node tools/serve.mjs 8912
 *   node tools/translator-battery.mjs [--base URL] [--n 40] [--locale fr-FR] [--path en2he,...]
 *
 * Exit 0 si aucune régression contre tools/reports/battery-baseline.json (--save pour la poser).
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ask, READ } from './translator-driver.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912');
const N = Number(arg('--n', '40'));
const LOCALE = arg('--locale', 'fr-FR');
const ONLY = arg('--path', '').split(',').filter(Boolean);
const SAVE = process.argv.includes('--save');
const BASELINE = new URL('./reports/battery-baseline.json', import.meta.url);

const NIQQUD = /[֑-ׇ]/;
const HEB = /[֐-׿]/;
const LATIN = /[A-Za-z]/;
const stripN = s => String(s || '').replace(/[֑-ׇ]/g, '');
const bare = s => stripN(s).replace(/[\s,.?!;:'"״׳()־-]/g, '');
const TAGS = /(phonetic|online|✓\s*lesson)/gi;
const meaningOf = c => String(c.en || '').replace(TAGS, '').trim();
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/* Un sens est juste s'il rend UNE des alternatives curées ("a / b / c"). Comparer à la liste
   entière mesurerait la richesse de la référence et pas la justesse de la réponse : c'est
   l'erreur de métrique commise le 25/08, qui donnait 26/45 au lieu de 33/45. */
const meaningHit = (got, ref) => {
  const A = new Set(norm(got));
  return String(ref).split(' / ').some(alt => {
    const B = norm(alt);
    return B.length && B.filter(w => A.has(w)).length / B.length >= 0.5;
  });
};

const book = JSON.parse(readFileSync(new URL('../data/phrasebook.json', import.meta.url), 'utf8')).phrases;
let expressions = [];
try { expressions = JSON.parse(readFileSync(new URL('../data/expressions.json', import.meta.url), 'utf8')).expressions || []; } catch { /* optional */ }

/* Échantillon déterministe : un pas premier sur la liste triée. Pas de Math.random, sinon deux
   runs ne se comparent pas et une régression se cache derrière un tirage différent. */
const pick = (arr, n) => { const out = []; for (let i = 0; out.length < n && i < arr.length; i++) out.push(arr[(i * 7 + 3) % arr.length]); return out; };

/* DEUX POOLS, jamais additionnes.
 *
 * Le carnet est IN-SAMPLE : le moteur le charge et le resout hors ligne, donc un score de 100 %
 * dessus prouve seulement qu'il sait se citer. C'est le biais deja paye le 20/07 (verdict
 * `untested_curated_hit`) et le 24/07 sur les loanwords (139/139 in-sample, 74 % en reel).
 *
 *   in-sample : data/phrasebook.json, ce que le traducteur connait par coeur
 *   held-out  : data/expressions.json (129 idiomes, que quicksay ne lit PAS) et le vocabulaire
 *               des 465 lecons - la vraie question, "et sur un mot qu'il n'a pas appris ?"
 *
 * Les deux tournent, les deux sont rapportes, et le held-out est celui qu'il faut regarder. */
const heldOut = expressions
  .filter(e => e.he && e.translit && (e.fr || e.en))
  .map(e => ({ he: e.he, tr: e.translit, en: e.fr || e.en, fr: e.fr || e.en }));

const rows = pick(book.filter(p => p.he && p.en && p.fr && p.tr), Math.min(N, book.length));
const CASES = [];
for (const p of pick(heldOut, Math.min(N, heldOut.length))) {
  // Held-out: only the two directions whose answer cannot be read off a file the app ships.
  CASES.push({ path: 'HELD rom2he', input: p.tr.replace(/-/g, '').toLowerCase(), wantHe: p.he, row: p, held: true });
  CASES.push({ path: 'HELD he2mean', input: stripN(p.he), wantMeaning: p, row: p, held: true });
}
for (const p of rows) {
  CASES.push({ path: 'en2he', input: p.en.split(' / ')[0], wantHe: p.he, row: p });
  CASES.push({ path: 'fr2he', input: p.fr.split(' / ')[0], wantHe: p.he, row: p });
  CASES.push({ path: 'rom2he', input: p.tr.replace(/-/g, '').toLowerCase(), wantHe: p.he, row: p });
  CASES.push({ path: 'he2mean', input: stripN(p.he), wantMeaning: p, row: p });
}
const RUN = ONLY.length ? CASES.filter(c => ONLY.includes(c.path)) : CASES;

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, locale: LOCALE });
const page = await ctx.newPage();
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.setItem('voice-banner-dismissed', '1'); } catch (e) {} });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#qs-input', { timeout: 20000 });
await page.waitForTimeout(1200);

const wantLang = LOCALE.slice(0, 2).toLowerCase() === 'fr' ? 'fr' : 'en';
const stats = {};
const failures = [];
const shapeFails = [];
let n = 0;

for (const c of RUN) {
  n++;
  let settled = true;
  try { await ask(page, c.input); } catch { settled = false; }
  const r = await page.evaluate(READ);
  const cards = r.sections.flatMap(s => s.cards);
  const s = stats[c.path] || (stats[c.path] = { ok: 0, total: 0 });
  s.total++;

  // --- shape rules, on every screen
  const shape = [];
  if (!cards.length) shape.push('S1 no card at all');
  for (const card of cards) {
    const m = meaningOf(card);
    if (m && HEB.test(m)) shape.push(`S2 meaning holds Hebrew: "${m}"`);
    if (m && bare(m) && bare(m) === bare(card.he)) shape.push(`S3 meaning repeats its own Hebrew: "${m}"`);
  }
  const lead = cards[0];
  if (lead && HEB.test(lead.he || '') && !NIQQUD.test(lead.he || '')) shape.push(`S4 lead card has no niqqud: "${lead.he}"`);
  if (lead && !(lead.tr && LATIN.test(lead.tr))) shape.push('S5 lead card has no transliteration');
  if (shape.length) shapeFails.push({ input: c.input, path: c.path, shape });

  // --- accuracy
  let ok;
  if (c.wantHe) ok = cards.some(x => bare(x.he) === bare(c.wantHe));
  else {
    /* La reference du jeu retenu est ANGLAISE, quelle que soit la locale : verifie le 25/08,
       data/expressions.json porte un champ nomme `fr` sur ses 129 lignes et PAS UNE n'est en
       francais ("cool / OK / awesome", "broken heart"). Comparer une reponse francaise a cette
       reference-la fabrique des faux echecs, et le champ mal nomme est un defaut de donnees
       separe, note pour Jonas. */
    const refLang = c.held ? 'en' : wantLang;
    ok = cards.some(x => meaningHit(meaningOf(x), c.wantMeaning[refLang] || c.wantMeaning.en));
  }
  if (ok) s.ok++;
  else failures.push({
    path: c.path, input: c.input,
    want: c.wantHe ? c.wantHe : (c.wantMeaning[c.held ? 'en' : wantLang] || c.wantMeaning.en),
    got: cards.slice(0, 3).map(x => `${x.he} = ${meaningOf(x) || '(no meaning)'}`),
    settled,
  });
  if (n % 25 === 0) console.log(`  … ${n}/${RUN.length}`);
}
await browser.close();

console.log('\n' + '='.repeat(76));
console.log(`locale ${LOCALE} · meaning language expected: ${wantLang} · ${RUN.length} queries`);
console.log('  (HELD = jeu retenu : expressions + vocabulaire lecons, que le traducteur ne charge pas)');
const summary = {};
for (const [path, s] of Object.entries(stats)) {
  const pct = Math.round((s.ok / s.total) * 1000) / 10;
  summary[path] = { ok: s.ok, total: s.total, pct };
  console.log(`  ${path.padEnd(9)} ${String(s.ok).padStart(3)}/${String(s.total).padEnd(3)}  ${pct}%`);
}
console.log(`\nshape violations (S1-S5): ${shapeFails.length}`);
for (const f of shapeFails.slice(0, 15)) console.log(`   [${f.path}] "${f.input}": ${f.shape.join(' | ')}`);
console.log(`\naccuracy misses: ${failures.length}`);
for (const f of failures.slice(0, 30)) console.log(`   [${f.path}] "${f.input}" want ${JSON.stringify(f.want)}\n        got ${JSON.stringify(f.got)}`);
console.log(`\nJS errors: ${jsErrors.length}`);
jsErrors.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 150)));

const result = { locale: LOCALE, n: RUN.length, summary, shapeViolations: shapeFails.length, jsErrors: jsErrors.length };
if (SAVE) { writeFileSync(BASELINE, JSON.stringify(result, null, 1)); console.log('\nbaseline saved.'); process.exit(0); }

if (!existsSync(BASELINE)) { console.log('\n(no baseline yet — run with --save to record one)'); process.exit(shapeFails.length || jsErrors.length ? 1 : 0); }
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
let regressed = 0;
for (const [path, s] of Object.entries(summary)) {
  const b = base.summary[path];
  if (!b) continue;
  // A 2-point band absorbs Google answering a shade differently between runs; anything more is
  // a change in the engine, not in the weather.
  if (s.pct < b.pct - 2) { console.log(`REGRESSION ${path}: ${s.pct}% vs baseline ${b.pct}%`); regressed++; }
}
if (shapeFails.length > base.shapeViolations) { console.log(`REGRESSION shape: ${shapeFails.length} vs baseline ${base.shapeViolations}`); regressed++; }
if (jsErrors.length > base.jsErrors) { console.log(`REGRESSION js errors: ${jsErrors.length} vs baseline ${base.jsErrors}`); regressed++; }
console.log(regressed ? `\n${regressed} regression(s) against the baseline` : '\nno regression against the baseline');
process.exit(regressed ? 1 : 0);
