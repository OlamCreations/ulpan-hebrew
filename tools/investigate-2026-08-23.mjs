/* investigate-2026-08-23.mjs — les trois symptômes que la première sonde n'expliquait pas.
 *
 *   A. « hard » rend deux mots (זריקה קשה) au lieu de קשה
 *   B. le champ sens contient de l'hébreu au lieu de l'anglais
 *   C. une carte géante mêlée à la navigation du site, alors que l'input est capé à 200
 *
 * Chaque piste est une hypothèse FALSIFIABLE, pas une intuition :
 *   A1 les langues sources actives (qs-src-langs) changent la lecture de « hard »
 *   B1 la cursive force stripNiqqud — donc l'hébreu nu est VOULU, pas une panne
 *   C1 maxlength=200 ne s'applique pas à une écriture par programme (chip, restauration)
 *   C2 un collage clavier réel EST tronqué, lui
 *   D1 l'espace insécable (U+00A0) de WhatsApp ressort en « Â » après aller-retour
 *
 * L'hébreu vit ICI, jamais en argv (il ne survit pas à argv sous Windows).
 * Usage : node tools/serve.mjs 8912   puis   node tools/investigate-2026-08-23.mjs
 */
import { chromium } from 'playwright-core';
import { ask, READ, settle, snapshot, sig, arm } from './translator-driver.mjs';

const BASE = process.env.BASE || 'http://localhost:8912';
const HEB = /[֐-׿]/;
const NIQQUD = /[֑-ׇ]/;

/* Le blob de la capture 3 : message WhatsApp + le sommaire de la page d'accueil. */
const BLOB =
  'סליחה @~טליה מרקין , האוטובוס שלי מאחר.אני כנראה אאחר ב-10-15 דקות. '
  + 'Start here▾ ✦ Foundations 5▾ 01 The Aleph Beth אלף-בית 02 Vowels (Niqqud) ניקוד '
  + '03 First Words מילים ראשונות 04 Greetings ברכות בסיסיות';

const NBSP = 'סליחה טליה מרקין';

const line = (s) => console.log(s);
const head = (s) => { line(''); line('='.repeat(78)); line(s); line('='.repeat(78)); };

const browser = await chromium.launch({ headless: true, channel: 'chrome' });

async function fresh(prefs = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((p) => {
    for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v);
  }, prefs);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  return { ctx, page };
}

function show(tag, r) {
  const card = r.sections[0] && r.sections[0].cards[0];
  if (!card) { line(`  ${tag}: AUCUNE CARTE (rawLen=${r.rawLen})`); return null; }
  const he = card.he || '', en = card.en || '';
  const words = he.trim() ? he.trim().split(/\s+/).length : 0;
  line(`  ${tag}`);
  line(`     section = ${JSON.stringify(r.sections[0].title)}`);
  line(`     he      = ${JSON.stringify(he.slice(0, 90))}  (${words} mot(s), niqqud=${NIQQUD.test(he)})`);
  line(`     cursive = ${JSON.stringify((card.cursive || '').slice(0, 40))}`);
  line(`     tr      = ${JSON.stringify((card.tr || '').slice(0, 90))}`);
  line(`     en      = ${JSON.stringify(en.slice(0, 90))}  enEstHebreu=${HEB.test(en)}`);
  return card;
}

/* ---------------------------------------------------------------- A : langues */
head('A — « hard » selon les langues sources actives (qs-src-langs)');
for (const langs of [null, ['en'], ['fr'], ['ru'], ['es'], ['fr', 'ru'], ['en', 'fr', 'es', 'ru']]) {
  const prefs = langs ? { 'qs-src-langs': JSON.stringify(langs) } : {};
  const { ctx, page } = await fresh(prefs);
  await ask(page, 'hard');
  const r = await page.evaluate(READ);
  line(`  --- langs=${langs ? langs.join(',') : '(défaut)'} : ${r.sections.length} section(s)`);
  r.sections.forEach(s => s.cards.slice(0, 2).forEach(c => {
    const he = c.he || '';
    line(`     [${s.title}] he=${JSON.stringify(he.slice(0, 60))} (${he.trim().split(/\s+/).length} mots) en=${JSON.stringify((c.en || '').slice(0, 50))}`);
  }));
  await ctx.close();
}

/* --------------------------------------------------- B : cursive / niqqud off */
head('B — l\'hébreu nu est-il la préférence cursive, et le sens devient-il hébreu ?');
for (const prefs of [
  { label: 'défaut', set: {} },
  { label: 'cursive ON', set: { 'qs-cursive': 'on' } },
  { label: 'niqqud OFF', set: { 'qs-niqqud': 'off' } },
  { label: 'cursive ON + niqqud OFF', set: { 'qs-cursive': 'on', 'qs-niqqud': 'off' } },
]) {
  const { ctx, page } = await fresh(prefs.set);
  await ask(page, 'אחרי');
  show(`${prefs.label} — entrée אחרי`, await page.evaluate(READ));
  await ctx.close();
}

/* --------------------------------------------- C : le cap de 200 est-il tenu ? */
head('C — maxlength=200 : collage clavier réel contre écriture par programme');
{
  const { ctx, page } = await fresh();
  line(`  longueur du blob : ${BLOB.length} caractères`);

  const attrMax = await page.getAttribute('#qs-input', 'maxlength');
  line(`  maxlength de l'input inline : ${attrMax}`);

  // C2 — collage clavier réel (presse-papier + Ctrl+V)
  await page.evaluate(async (txt) => {
    const i = document.getElementById('qs-input');
    i.focus();
    // simule un collage : insertText passe par le chemin d'édition du navigateur
    document.execCommand('insertText', false, txt);
  }, BLOB);
  await page.waitForTimeout(600);
  const afterPaste = await page.inputValue('#qs-input');
  line(`  après collage simulé : ${afterPaste.length} caractères  -> ${afterPaste.length <= 200 ? 'TRONQUÉ (cap tenu)' : 'NON TRONQUÉ (cap contourné)'}`);

  // C1 — écriture par programme, le chemin des chips (ligne 1396)
  await page.evaluate((txt) => {
    const i = document.getElementById('qs-input');
    i.value = txt;                     // exactement ce que fait le handler de chip
  }, BLOB);
  const afterProg = await page.inputValue('#qs-input');
  line(`  après écriture par programme : ${afterProg.length} caractères -> ${afterProg.length > 200 ? 'CAP CONTOURNÉ' : 'tronqué'}`);
  await ctx.close();
}

/* ----------------------------------------- C bis : que rend le blob complet ? */
head('C bis — rendu du blob complet (le cas de la capture 3)');
{
  const { ctx, page } = await fresh({ 'qs-cursive': 'on' });
  await ask(page, BLOB);
  const r = await page.evaluate(READ);
  const card = show('blob + cursive ON', r);
  if (card) {
    const he = card.he || '';
    line(`     mots hébreu dans la carte : ${he.trim().split(/\s+/).length}`);
    line(`     la carte contient-elle « Foundations » ? ${/Foundations/i.test(he + (card.en || ''))}`);
    line(`     la carte contient-elle « Aleph » ? ${/Aleph/i.test(he + (card.en || ''))}`);
  }
  const box = await page.evaluate(() => {
    const c = document.querySelector('#qs-results .qs-card');
    if (!c) return null;
    const b = c.getBoundingClientRect();
    return { h: Math.round(b.height), w: Math.round(b.width), docW: document.documentElement.scrollWidth, winW: window.innerWidth };
  });
  line(`     boîte de la carte : ${JSON.stringify(box)}`);
  if (box) line(`     débordement horizontal : ${box.docW > box.winW ? 'OUI (' + (box.docW - box.winW) + 'px)' : 'non'}`);
  await ctx.close();
}

/* ------------------------------------------------------------------ D : NBSP */
head('D — espace insécable de WhatsApp : ressort-il en « Â » ?');
{
  const { ctx, page } = await fresh();
  await ask(page, NBSP);
  const r = await page.evaluate(READ);
  const card = show('entrée avec U+00A0', r);
  if (card) {
    const all = (card.he || '') + (card.tr || '') + (card.en || '');
    line(`     contient U+00A0 : ${all.includes(' ')}`);
    line(`     contient « Â » (U+00C2) : ${all.includes('Â')}`);
  }
  await ctx.close();
}

await browser.close();
process.exit(0);
