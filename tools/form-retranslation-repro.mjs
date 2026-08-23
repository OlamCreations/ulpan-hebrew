/* form-retranslation-repro.mjs — le chip « Say it as » accorde-t-il, ou retraduit-il ?
 *
 * Défaut noté à la clôture du 2026-08-20, jamais reproduit depuis : demander une autre forme
 * renverrait une AUTRE PHRASE au lieu de la même phrase accordée. Le code le rend plausible —
 * `fetchForm` (quicksay.js:917) envoie `{ text: q }`, c'est-à-dire la requête d'origine, et jamais
 * `data-base`, l'hébreu déjà affiché. Le Worker retraduit donc depuis zéro avec une consigne de
 * genre, au lieu d'accorder ce que l'apprenant a sous les yeux.
 *
 * Plausible n'est pas mesuré. Ce script mesure.
 *
 * Critère : on compare les MOTS de la carte de base et ceux de la carte accordée, consonnes nues.
 * Un accord légitime change une poignée de mots (le verbe, l'adjectif). Une retraduction en change
 * d'autres, ou change le nombre de mots. On rapporte les deux, sans trancher à la place du lecteur.
 *
 * Usage : node tools/serve.mjs 8912   puis   node tools/form-retranslation-repro.mjs
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const BASE = process.env.BASE || 'http://localhost:8912';
/* --form-at <origine> reroute les appels /form vers un aperçu (wrangler dev --remote) au lieu du
   Worker de production. La page ne peut pas être configurée pour ça — MORPH_URL est en dur — donc
   on intercepte la requête ici. La production n'est jamais touchée par cette mesure. */
const FORM_AT = (() => {
  const i = process.argv.indexOf('--form-at');
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1].replace(/\/$/, '') : null;
})();

/* Phrases qui ont un verbe ET un sujet susceptibles de bouger. La première est celle de Jonas. */
const CASES = [
  { id: 'phrase de Jonas', q: 'tu es émue que nous révisons' },
  { id: 'je veux un café',  q: 'je veux un café' },
  { id: 'tu es fatigué',    q: 'tu es fatigué' },
  { id: 'je suis prêt',     q: 'je suis prêt' },
];

const bare = s => (s || '').replace(/[֑-ׇ]/g, '').replace(/[\s.,!?;:"'״׳־]/g, ' ').trim();
const words = s => bare(s).split(/\s+/).filter(Boolean);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.addInitScript(() => {
  // le bandeau « aucune voix hébreu » intercepte les clics en headless
  const s = document.createElement('style');
  s.textContent = '#voice-banner{display:none !important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
});
if (FORM_AT) {
  await page.route('**/form', async route => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const r = await fetch(FORM_AT + '/form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://olamcreations.github.io' },
      body: req.postData() || '{}',
    });
    const body = await r.text();
    return route.fulfill({
      status: r.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*' },
      body,
    });
  });
  console.log(`/form rerouté vers ${FORM_AT} (la production n'est pas sollicitée)\n`);
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

for (const c of CASES) {
  console.log('='.repeat(84));
  console.log(`[${c.id}] « ${c.q} »`);
  await ask(page, c.q);
  const r0 = await page.evaluate(READ);
  const baseCard = r0.sections[0] && r0.sections[0].cards[0];
  if (!baseCard) { console.log('  aucune carte de base'); continue; }
  console.log(`  base      : ${baseCard.he}`);

  const hasChip = await page.evaluate(() => !!document.querySelector('.qs-form-btn'));
  if (!hasChip) { console.log('  (pas de chip « Say it as » sur cette carte)'); continue; }

  /* Ce que le client envoie vraiment au Worker : on l'observe sur le réseau plutôt que
     de le déduire du code. */
  let sent = null;
  page.on('request', req => {
    if (req.url().includes('/form') && req.method() === 'POST') {
      try { sent = JSON.parse(req.postData() || '{}'); } catch { /* ignoré */ }
    }
  });

  // chip f. sing. = index 1 dans FORMS (m.sing, f.sing, m.pl, f.pl)
  await page.evaluate(() => {
    const b = document.querySelectorAll('.qs-form-btn')[1];
    if (b) b.click();
  });
  await page.waitForTimeout(9000);

  const outText = await page.evaluate(() => {
    const o = document.querySelector('.qs-form-out');
    if (!o) return null;
    const card = o.querySelector('.qs-card');
    if (!card) return { hint: (o.textContent || '').trim().slice(0, 120) };
    const ps = card.querySelectorAll('.qs-wp-he');
    const he = ps.length ? Array.from(ps).map(x => x.textContent).join(' ')
                         : (card.querySelector('.qs-he') || {}).textContent;
    return { he };
  });

  console.log(`  envoyé au Worker : ${sent ? JSON.stringify(Object.keys(sent)) : '(non capté)'}`);
  if (sent) console.log(`     text = ${JSON.stringify(sent.text)}   base transmis ? ${'base' in sent ? 'OUI' : 'NON'}`);

  if (!outText) { console.log('  pas de sortie'); continue; }
  if (outText.hint) { console.log(`  sortie    : ${outText.hint}`); continue; }

  console.log(`  f. sing.  : ${outText.he}`);
  const a = words(baseCard.he), b = words(outText.he);
  const kept = b.filter(w => a.includes(w)).length;
  const changed = b.filter(w => !a.includes(w));
  console.log(`  mots : base ${a.length}, forme ${b.length}, conservés ${kept}`);
  console.log(`  mots qui ne sont PAS dans la base : ${changed.length ? changed.join(' · ') : '(aucun)'}`);
  if (a.length !== b.length) console.log('  >>> le NOMBRE de mots change : ce n\'est pas un accord');
  else if (changed.length > 2) console.log('  >>> plus de deux mots changent : retraduction probable');
}

console.log('='.repeat(84));
await browser.close();
process.exit(0);
