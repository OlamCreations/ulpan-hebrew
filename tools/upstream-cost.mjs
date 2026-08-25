#!/usr/bin/env node
/*
 * upstream-cost.mjs — combien d'appels externes coûte UNE requête du traducteur.
 *
 * La question posée le 2026-08-25 : « et si 10 personnes utilisent l'app en même temps ? ».
 * À l'ulpan elles sont derrière un seul wifi, donc une seule IP, et les quotas des services
 * empruntés (gtx surtout) se comptent par IP. La question devient donc arithmétique, et il
 * manquait le seul chiffre qui permet de la poser : le coût unitaire.
 *
 * On compte les requêtes réseau sortantes PAR HÔTE pour chaque type de saisie, cache vidé et
 * service worker bloqué (sinon le SW ressert et on mesure le cache, pas le coût).
 *
 *   node tools/serve.mjs 8912
 *   node tools/upstream-cost.mjs [--base URL] [--locale fr-FR]
 */
import { chromium } from 'playwright-core';
import { ask } from './translator-driver.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912');
const LOCALE = arg('--locale', 'fr-FR');

const CASES = [
  { label: 'mot hébreu couvert par le corpus', q: 'ספר' },
  { label: 'mot hébreu hors corpus', q: 'זזזז' },
  { label: 'phrase hébreu (carnet)', q: 'אני רוצה קפה' },
  // Une phrase qui vient des LEÇONS, pas du carnet : c'est ce que l'index vérifié de 13 029
  // phrases (data/phrases.json) est censé résoudre sans toucher au réseau.
  { label: 'phrase hébreu (leçon)', q: 'בסופו של דבר' },
  { label: 'romanisé', q: 'ani rotze kafe' },
  { label: 'français (mot)', q: 'bonjour' },
  { label: 'français (phrase)', q: 'je voudrais un café' },
  { label: 'anglais (phrase)', q: 'where is the pharmacy' },
];

const HOSTS = ['translate.googleapis.com', 'inputtools.google.com', 'api.mymemory.translated.net', 'ulpan-morph.olamcreations.workers.dev'];
const shortHost = h => h.split('.')[0];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, locale: LOCALE, serviceWorkers: 'block' });
const page = await ctx.newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

let counts = {};
page.on('request', r => {
  const u = r.url();
  const h = HOSTS.find(x => u.includes(x));
  if (h) counts[h] = (counts[h] || 0) + 1;
});

console.log(`locale ${LOCALE} — appels externes par requête (cache off, service worker bloqué)\n`);
console.log('  ' + 'saisie'.padEnd(36) + HOSTS.map(h => shortHost(h).slice(0, 9).padStart(10)).join('') + '   TOTAL');
let grand = 0;
let unmeasured = 0;
for (const c of CASES) {
  /* Une page NEUVE par cas.
     Première version : une seule page pour toute la table. Les caches EN MÉMOIRE du moteur
     (transCache, phonCache, le dictionnaire vérifié) survivent d'un cas au suivant, et le dernier
     cas est ressorti à 0 appel alors que la même requête en coûte 9 en isolation. Un coût mesuré
     sur un moteur déjà chaud n'est pas celui que paie un apprenant qui arrive. */
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#qs-input', { timeout: 20000 });
  await page.waitForTimeout(1200);
  counts = {};
  try { await ask(page, c.q); } catch {}
  await page.waitForTimeout(900);          // laisser retomber les enrichissements tardifs
  // Un cas qui n'a rien rendu ne mesure rien, et un zéro silencieux se lit comme une victoire.
  const cards = await page.evaluate(() => document.querySelectorAll('.qs-card').length);
  if (!cards) unmeasured++;
  const row = HOSTS.map(h => String(counts[h] || 0).padStart(10)).join('');
  const total = HOSTS.reduce((a, h) => a + (counts[h] || 0), 0);
  grand += total;
  console.log('  ' + `${c.label} "${c.q}"`.slice(0, 35).padEnd(36) + row + String(total).padStart(8)
    + (cards ? '' : '   RIEN RENDU — non mesuré'));
}
console.log('\n  ' + 'moyenne par requête'.padEnd(36) + String(Math.round((grand / CASES.length) * 10) / 10).padStart(48));
if (unmeasured) console.log(`  ATTENTION : ${unmeasured} cas n'ont rien rendu ; la moyenne les compte à zéro et ment.`);

/* Ce que ça vaut à l'échelle. Une frappe rend UNE requête (l'entrée est debouncée à 350ms), donc
   un apprenant qui cherche un mot en dépense une, deux s'il ouvre le mot-à-mot. */
const avg = grand / CASES.length;
console.log('\n  Si 10 personnes derrière un même wifi cherchent 3 mots par minute :');
console.log(`    ${Math.round(10 * 3 * avg)} appels/minute depuis UNE seule IP`);
await browser.close();
