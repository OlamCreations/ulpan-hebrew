#!/usr/bin/env node
/*
 * ratelimit-check.mjs — le traducteur quand Google dit 429.
 *
 * C'est LA panne réelle, pas une hypothèse : mesurée le 2026-08-25 sur cette machine,
 * `curl` sur gtx rendait `429` et une page HTML après quelques centaines de requêtes de test.
 * gtx n'est pas une API publique (ni clé, ni quota documenté), l'app tire plusieurs appels par
 * écran rendu, et le quota est par CONNEXION — donc tous les appareils d'un même foyer tombent
 * ensemble. Ça explique un symptôme qui n'a aucun sens autrement : « la carte s'affiche, le
 * champ de traduction est vide », sur les trois appareils, sans rien casser d'autre.
 *
 * Pourquoi seule la traduction meurt : le chemin avant a MyMemory derrière lui, l'hébreu vient
 * d'Input Tools (autre hôte), mais le SENS ne venait que de gtx, sans repli.
 *
 * Trois règles :
 *   R1  un mot couvert par le corpus vérifié garde son sens malgré le 429 (l'échelle marche)
 *   R2  quand le sens manque quand même, la page dit « rate-limiting », pas « check your connection »
 *   R3  l'hébreu et sa lecture restent affichés (ce qui marche encore doit rester)
 *
 *   node tools/serve.mjs 8912
 *   node tools/ratelimit-check.mjs [--base URL] [--locale en-US]
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912');
const LOCALE = arg('--locale', 'en-US');

const TAGS = /(phonetic|online|✓\s*lesson)/gi;
const meaningOf = c => String(c.en || '').replace(TAGS, '').trim();
const NIQQUD = /[֑-ׇ]/;

// Words the verified corpus covers (R1) and a nonsense one it cannot (R2).
const CASES = [
  { q: 'ספר', covered: true },
  { q: 'שולחן', covered: true },
  { q: 'מקרר', covered: true },
  { q: 'זזזז', covered: false },
];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, locale: LOCALE, serviceWorkers: 'block' });
const page = await ctx.newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

/* The real 429: an HTML body, not JSON. Fulfilling with JSON would test a failure Google does
   not actually produce, and the JSON parse is part of what breaks. */
let served = 0;
await page.route('**/translate_a/**', r => {
  served++;
  return r.fulfill({ status: 429, contentType: 'text/html', body: '<html><head><title>Error 429</title></head><body>Too Many Requests</body></html>' });
});

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#qs-input', { timeout: 20000 });
await page.waitForTimeout(1200);

let bad = 0, checks = 0;
console.log(`########## every gtx call answers 429 (locale ${LOCALE})`);
for (const c of CASES) {
  served = 0;
  try { await ask(page, c.q); } catch {}
  const r = await page.evaluate(READ);
  const cards = r.sections.flatMap(x => x.cards);
  const meanings = cards.map(meaningOf).filter(Boolean);
  const hint = String(r.hint || '');

  if (c.covered) {
    checks++;
    if (!meanings.length) { bad++; console.log(`  FAIL R1 "${c.q}" is in the verified corpus and lost its meaning anyway (hint: ${hint || 'none'})`); }
    else console.log(`  ok   R1 "${c.q}" -> ${JSON.stringify(meanings[0])} (survived the 429, ${served} gtx calls refused)`);
  } else {
    checks++;
    if (meanings.length) { console.log(`  ok   R2 "${c.q}" got a meaning anyway: ${JSON.stringify(meanings[0])}`); }
    else if (/rate-limit/i.test(hint)) console.log(`  ok   R2 "${c.q}" no meaning, and the page names the quota`);
    else { bad++; console.log(`  FAIL R2 "${c.q}" no meaning and the page said: ${JSON.stringify(hint) || '(nothing)'}`); }
  }

  checks++;
  const lead = cards[0];
  if (!lead || !lead.he) { bad++; console.log(`  FAIL R3 "${c.q}" no Hebrew at all under a 429`); }
  else if (!NIQQUD.test(lead.he)) { bad++; console.log(`  FAIL R3 "${c.q}" Hebrew lost its niqqud: ${lead.he}`); }
  else console.log(`  ok   R3 "${c.q}" Hebrew + reading still shown: ${lead.he} / ${lead.tr}`);
}
await browser.close();
console.log(`\n${checks - bad}/${checks} rate-limit assertions pass`);
process.exit(bad ? 1 : 0);
