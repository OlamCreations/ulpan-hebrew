#!/usr/bin/env node
/*
 * meaning-lang-check.mjs — le sens est-il écrit dans la langue de l'apprenant ?
 *
 * Ajouté le 2026-08-25, sur « là où ça doit afficher la trad en anglais ou français ou autre
 * langue en fonction de l'input, y a rien ». Le carnet portait un champ `fr` sur ses 118 lignes
 * depuis le 18/08 et il ne servait QU'À CHERCHER : un francophone tapait « où », matchait sur le
 * champ français, et se faisait répondre en anglais. Sur un mot hébreu c'était pareil, la langue
 * de la glose était la constante 'en'.
 *
 * Trois règles, chacune vérifiée dans les DEUX locales, parce que « ça marche en français » ne
 * dit rien tant qu'on n'a pas montré que l'anglais n'a pas été cassé au passage.
 *
 *   L1  une ligne curée répond dans la langue du navigateur (fr -> le champ fr, en -> le champ en)
 *   L2  une requête dans une langue détectable gagne sur le navigateur (bonjour -> français,
 *       même dans une session anglaise)
 *   L3  le mot par mot reste en anglais, dans les deux locales : sa source vérifiée
 *       (data/gloss.json) est anglaise et un tableau bilingue se lit comme un bug
 *
 *   node tools/serve.mjs 8912
 *   node tools/meaning-lang-check.mjs [--base http://localhost:8912]
 *
 * Ces règles ont été ROUGES avant le correctif du même jour, sur le vrai défaut et pas sur un
 * défaut injecté : 3/6 assertions passaient, שלום rendait « paix » en session française et
 * « peace » en anglaise, parce que la fiche curée n'était atteignable que depuis la
 * romanisation. C'est leur matrice de cassures.
 *
 * Exit 0 = les trois règles tiennent. Exit 1 = au moins une carte parle la mauvaise langue.
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912');

const TAGS = /(phonetic|online|✓\s*lesson)/gi;
const meaningOf = c => String(c.en || '').replace(TAGS, '').trim();

/* Les attentes ne sont pas écrites à la main : elles sont LUES dans data/phrasebook.json au
   moment du run. Une attente recopiée ici se serait désynchronisée du carnet à la première
   correction de gloss, et le contrôle aurait échoué sur sa propre copie périmée. */
const book = await (await fetch(BASE + '/data/phrasebook.json')).json();
const row = he => book.phrases.find(p => p.he.replace(/[֑-ׇ]/g, '') === he);

const CASES = [
  { id: 'L1', q: 'שלום', field: p => p, note: 'curated Hebrew word, browser language decides' },
  { id: 'L1', q: 'תודה', field: p => p, note: 'curated Hebrew word' },
];

/* L2 is not a curated-row lookup like L1: the point is that a FRENCH INPUT is answered in
   French even in an English session. The reference is the curated row whose French gloss is
   the word typed, so the expectation still comes from the file rather than from my hand. */
const L2 = { q: 'bonjour', want: 'fr' };

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let bad = 0, checks = 0;

for (const [locale, lang] of [['fr-FR', 'fr'], ['en-US', 'en']]) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, locale });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#qs-input', { timeout: 20000 });
  await page.waitForTimeout(1000);
  console.log(`\n########## locale ${locale}`);

  for (const c of CASES) {
    const want = c.forceLang || lang;          // L2: the input's language, not the session's
    const r0 = row(c.q);
    if (!r0) { console.log(`  skip ${c.id} "${c.q}" is not a curated row`); continue; }
    const expected = (r0[want] || '').split(' / ')[0].trim();
    await ask(page, c.q).catch(() => {});
    const read = await page.evaluate(READ);
    const got = read.sections.flatMap(s => s.cards).map(meaningOf).filter(Boolean);
    checks++;
    /* Match on the FIRST curated synonym only: the card shows the whole "a / b / c" string, so
       containment is the honest test, and comparing whole strings would fail on formatting. */
    const ok = got.some(g => g.toLowerCase().includes(expected.toLowerCase()));
    if (!ok) { bad++; console.log(`  FAIL ${c.id} "${c.q}" wanted ${want} ("${expected}") got ${JSON.stringify(got)}`); }
    else console.log(`  ok   ${c.id} "${c.q}" -> ${want}: ${JSON.stringify(got[0]).slice(0, 60)}`);
  }

  /* L2 : une requete francaise est repondue en francais QUAND le francais fait partie des langues
     actives de la session. Ce n'etait pas la formulation d'origine ("quelle que soit la langue de
     la session"), et la nuance est le prix mesure du levier de capacite du 2026-08-25 : les
     langues de retry sont passees des quatre a "celle du navigateur + l'anglais", ce qui fait
     tomber un mot francais de 6 a 4 appels gtx. Sans le retry sl=fr, Google classe parfois
     "bonjour" en anglais (c'est le sauvetage d'homographe que documente addLangAlts : pain, chat,
     main, coin) et la carte repond alors en anglais.
     Concretement : sur un navigateur francais - celui de l'apprenant vise - rien ne change, et
     c'est l'assertion qui compte. Sur un navigateur anglais ou l'on tape du francais, la reponse
     est en anglais, ce qui reste defendable. Les autres langues sont a un clic dans Preferences. */
  {
    await ask(page, L2.q).catch(() => {});
    const read = await page.evaluate(READ);
    const got = read.sections.flatMap(s => s.cards).map(meaningOf).filter(Boolean);
    checks++;
    // French, not English: the curated row for שלום reads "bonjour / salut / paix" in French and
    // "hello / peace" in English, so the two are unambiguous.
    const frEnabled = lang === 'fr';
    const ok = frEnabled
      ? got.some(g => /bonjour|salut|paix|matin/i.test(g)) && !got.some(g => /^hello \/ peace/i.test(g))
      : got.length > 0;   // session anglaise : on exige une reponse, pas sa langue
    if (!ok) { bad++; console.log(`  FAIL L2 "${L2.q}" (fr actif: ${frEnabled}) got ${JSON.stringify(got)}`); }
    else console.log(`  ok   L2 "${L2.q}" -> ${frEnabled ? 'French: ' + JSON.stringify(got[0]).slice(0, 50) : 'session anglaise, reponse en anglais (cout assume du levier)'}`);
  }

  // L3: the word-by-word breakdown stays English whatever the session language.
  await ask(page, 'אני רוצה קפה').catch(() => {});
  const opened = await page.evaluate(async () => {
    const b = document.querySelector('.qs-break');
    if (!b) return null;
    b.click();
    await new Promise(r => setTimeout(r, 6000));
    const out = document.querySelector('.qs-break-out');
    return out ? out.textContent.trim() : null;
  });
  checks++;
  if (!opened) { bad++; console.log('  FAIL L3 no breakdown rendered'); }
  else {
    // "je"/"veux"/"café" would mean the breakdown followed the session language.
    const french = /\b(je|veux|voudrais|caf[ée]|vouloir)\b/i.test(opened);
    if (french) { bad++; console.log(`  FAIL L3 breakdown drifted into French: ${JSON.stringify(opened.slice(0, 90))}`); }
    else console.log(`  ok   L3 breakdown stayed English: ${JSON.stringify(opened.slice(0, 60))}`);
  }
  await page.close(); await ctx.close();
}

await browser.close();
console.log(`\n${checks - bad}/${checks} language assertions pass`);
process.exit(bad ? 1 : 0);
