/* probe-offline-2026-08-25.mjs — l'app est une PWA : elle se charge hors ligne, et le
 * traducteur, lui, ne peut rien répondre. C'est le cas le plus banal chez un utilisateur de
 * téléphone (réseau coupé, wifi captif, données coupées) et il n'a jamais été mesuré.
 * On charge la page en ligne, puis on coupe TOUT le réseau, et on regarde l'écran rendu.
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://olamcreations.github.io/ulpan-hebrew');
const QUERIES = ['hello', 'bonjour', 'I want a coffee', 'je voudrais un café', 'where is the pharmacy', 'ani rotze kafe'];
const TAGS = /(phonetic|online|✓\s*lesson)/gi;
const meaningOf = c => String(c.en || '').replace(TAGS, '').trim();

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#qs-input', { timeout: 20000 });
await page.waitForTimeout(2000);          // let the phrasebook + modules load

await ctx.setOffline(true);
console.log('########## OFFLINE (page already loaded, phrasebook in memory)');
for (const q of QUERIES) {
  let settled = true;
  const t0 = Date.now();
  try { await ask(page, q); } catch { settled = false; }
  const r = await page.evaluate(READ);
  const shown = r.sections.map(s => '[' + s.title + '] ' + s.cards.map(x => `${x.he || '?'} = ${meaningOf(x) || '(no meaning)'}`).join(' | ')).join('  ||  ');
  console.log(`  ${settled ? 'settled' : 'TIMEOUT'} ${String(Date.now() - t0).padStart(6)}ms  "${q}"`);
  console.log(`      -> ${shown || '(NOTHING RENDERED)'}   rawLen=${r.rawLen}`);
  if (r.hint) console.log(`      hint: ${r.hint}`);
}
await browser.close();
