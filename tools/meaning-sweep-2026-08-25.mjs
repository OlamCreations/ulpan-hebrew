/* meaning-sweep-2026-08-25.mjs — balayage large du champ SENS, réseau sain.
 *
 * « Là où ça doit afficher la trad, y a rien », sur les trois appareils. Un défaut qui ne dépend
 * pas de l'appareil ne dépend pas du réseau non plus : il doit se voir ici. 130 entrées mêlées
 * (hébreu tiré des leçons, romanisé, français, anglais), et on compte les cartes dont la ligne
 * de sens est vide UNE FOIS LE BADGE RETIRÉ — parce qu'une carte peut afficher « phonetic » tout
 * seul, ce qui a l'air d'une ligne vide à l'écran.
 *
 * On distingue trois causes, sinon on corrige la mauvaise :
 *   upstream  : p.en était vide (la glose n'a rien rendu)
 *   guard     : le sens a été effacé parce qu'il répétait l'hébreu de la carte (garde du 24/08)
 *   echo      : le sens est l'entrée de l'apprenant renvoyée telle quelle
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { ask, READ } from './translator-driver.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://olamcreations.github.io/ulpan-hebrew');
const INPUTS = JSON.parse(readFileSync(new URL('./reports/meaning-inputs.json', import.meta.url), 'utf8'));

const TAGS = /(phonetic|online|✓\s*lesson)/gi;
const meaningOf = c => String(c.en || '').replace(TAGS, '').trim();
const norm = s => String(s || '').toLowerCase().replace(/[\s.,!?'"()-]/g, '');

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.setItem('voice-banner-dismissed', '1'); } catch (e) {} });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#qs-input', { timeout: 20000 });
await page.waitForTimeout(1500);

const blanks = [], echoes = [];
let cards = 0, n = 0;
for (const item of INPUTS) {
  n++;
  let settled = true;
  try { await ask(page, item.in); } catch { settled = false; }
  const r = await page.evaluate(READ);
  const cs = r.sections.flatMap(s => s.cards);
  cards += cs.length;
  const first = cs[0];
  if (!cs.length) { blanks.push({ ...item, why: 'no card', hint: r.hint }); continue; }
  cs.forEach((c, i) => {
    const m = meaningOf(c);
    if (!m) blanks.push({ ...item, card: i, he: c.he, why: 'blank meaning', hint: r.hint, raw: c.en });
    else if (norm(m) === norm(item.in)) echoes.push({ ...item, card: i, he: c.he, meaning: m });
  });
  if (n % 20 === 0) console.log(`  … ${n}/${INPUTS.length}`);
  if (!first) continue;
}

console.log('\n' + '='.repeat(72));
console.log(`${INPUTS.length} inputs · ${cards} cards`);
console.log(`BLANK meaning: ${blanks.length}`);
for (const b of blanks.slice(0, 40)) console.log(`   [${b.kind}] "${b.in}" card${b.card ?? '-'} he=${b.he || '-'} raw=${JSON.stringify(b.raw || '')} ${b.hint ? 'hint: ' + b.hint : 'NO HINT'}`);
console.log(`\nmeaning that merely ECHOES the input: ${echoes.length}`);
for (const e of echoes.slice(0, 40)) console.log(`   [${e.kind}] "${e.in}" -> ${e.he} = "${e.meaning}"`);
console.log(`\nJS errors: ${jsErrors.length}`);
jsErrors.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 160)));
await browser.close();
