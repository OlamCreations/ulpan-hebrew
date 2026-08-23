/* repro-2026-08-23.mjs — rejoue les requêtes exactes des captures de Jonas (23/08).
 *
 * Trois symptômes rapportés, à séparer avant de diagnostiquer :
 *   A. « hard » (un mot anglais) rend une phrase hébraïque de deux mots
 *   B. « אחרי » (hébreu nu) rend l'hébreu SANS niqqud, et le champ sens répète l'hébreu
 *   C. un message WhatsApp collé rend une carte géante mêlée à la navigation du site
 *
 * Les requêtes vivent ICI, jamais en argv : l'hébreu ne survit pas à argv sous Windows.
 * Synchronisation déléguée à translator-driver.mjs — ne pas réinventer l'attente, elle a
 * produit 60 faux échecs quand elle a été réécrite.
 *
 * Usage : node tools/serve.mjs 8912   puis   node tools/repro-2026-08-23.mjs
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const BASE = process.env.BASE || 'http://localhost:8912';

const CASES = [
  { id: 'A-hard',        input: 'hard',  note: 'un mot EN -> attendu une carte "kasheh"' },
  { id: 'A-control-dog', input: 'dog',   note: 'contrôle : mot EN simple et non ambigu' },
  { id: 'B-acharei',     input: 'אחרי', note: 'hébreu nu -> attendu niqqud + sens EN' },
  { id: 'B-control-sefer', input: 'ספר',     note: 'contrôle hébreu nu' },
  {
    id: 'C-whatsapp',
    input: 'סליחה @~טליה מרקין , '
         + 'האוטובוס שלי מאחר.'
         + 'אני כנראה אאחר ב-10-15 '
         + 'דקות.',
    note: 'collage WhatsApp : @ mention, virgule, point collé, plage 10-15',
  },
];

const HEB = /[֐-׿]/;
const NIQQUD = /[֑-ׇ]/;

const page = await (await chromium.launch({ headless: true, channel: 'chrome' })).newPage();
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

for (const c of CASES) {
  let settled = true;
  try { await ask(page, c.input); } catch { settled = false; }
  const r = await page.evaluate(READ);

  console.log('='.repeat(78));
  console.log(`[${c.id}] input=${JSON.stringify(c.input).slice(0, 90)}`);
  console.log(`         ${c.note}`);
  console.log(`         settled=${settled} rawLen=${r.rawLen} inputAtRead=${JSON.stringify((r.inputAtRead || '').slice(0, 40))}`);
  if (r.hint) console.log(`         hint: ${r.hint}`);
  for (const s of r.sections) {
    console.log(`  § ${s.title}`);
    s.cards.slice(0, 3).forEach((card, i) => {
      const he = card.he || '';
      console.log(`    [${i}] he      = ${JSON.stringify(he.slice(0, 120))}`);
      console.log(`        heWords = ${he.trim() ? he.trim().split(/\s+/).length : 0}   niqqud=${NIQQUD.test(he)}`);
      console.log(`        tr      = ${JSON.stringify((card.tr || '').slice(0, 120))}`);
      const en = card.en || '';
      console.log(`        en      = ${JSON.stringify(en.slice(0, 120))}   enIsHebrew=${HEB.test(en)}`);
    });
    if (s.cards.length > 3) console.log(`    (+${s.cards.length - 3} cartes)`);
  }
  if (r.natural) console.log(`  natural: ${r.natural.length} carte(s)`);
}

console.log('='.repeat(78));
console.log('erreurs JS:', jsErrors.length ? jsErrors : 'aucune');
process.exit(0);
