/* collapse-check-2026-08-27.mjs — combien de cartes l'apprenant VOIT, pas combien le DOM porte.
 *
 * La sonde de surface compte les noeuds `.qs-card`, y compris ceux qui sont dans un <details>
 * fermé. Elle rapporte donc « 4 cartes » sur un écran qui n'en montre qu'une, ce qui est le
 * contraire de ce qu'on veut mesurer. Elle reste utile pour le contenu ; celle-ci mesure la
 * mise en page.
 *
 * Pas getClientRects() : Chrome masque le contenu d'un <details> fermé par
 * `content-visibility` sur ::details-content, et les descendants RENDENT QUAND MÊME une boîte.
 * On teste l'ancêtre `details:not([open])`, qui est le fait, pas sa trace.
 *
 * Usage : BASE=http://localhost:8912 node tools/collapse-check-2026-08-27.mjs
 */
import { chromium } from 'playwright-core';
import { ask } from './translator-driver.mjs';

const BASE = process.env.BASE || 'https://olamcreations.github.io/ulpan-hebrew';

const CASES = [
  { q: 'beseder', why: 'romanisé : la bonne réponse plus deux devinettes' },
  { q: 'kacha kacha', why: 'romanisé sans correspondance vérifiée : trois devinettes' },
  { q: 'מזלות', why: 'hébreu absent du corpus : la réponse plus trois suggestions' },
  { q: 'אֲנִי', why: 'une seule réponse : aucun repli ne doit apparaître' },
  { q: 'bureau', why: 'traduction simple : une carte' },
];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage();
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

let pass = 0, fail = 0;
for (const c of CASES) {
  await ask(page, c.q);
  const got = await page.evaluate(() => {
    const r = document.getElementById('qs-results');
    const all = Array.from(r.querySelectorAll('.qs-card'));
    return {
      total: all.length,
      visible: all.filter(x => !x.closest('details:not([open])')).length,
      hasDetails: !!r.querySelector('details.qs-alts'),
      summary: (r.querySelector('details.qs-alts > summary') || {}).textContent || null,
      /* Le sens de la carte de tête : il ne doit jamais être la question réécrite. */
      lead: all[0] ? ((all[0].querySelector('.qs-en') || {}).textContent || '').trim() : null,
    };
  });

  const problems = [];
  if (got.visible !== 1) problems.push(`${got.visible} cartes visibles au lieu d'une`);
  if (got.total > 1 && !got.hasDetails) problems.push('plusieurs cartes mais aucun repli');
  if (got.total === 1 && got.hasDetails) problems.push('un repli vide a été rendu');
  if (got.lead && got.lead.toLowerCase().replace(/[^a-z0-9]/g, '') === c.q.toLowerCase().replace(/[^a-z0-9]/g, '')) {
    problems.push(`le sens de la carte de tête est la question elle-même : « ${got.lead} »`);
  }

  if (problems.length) { fail++; console.log(`ÉCHEC  « ${c.q} »  (${c.why})`); for (const p of problems) console.log(`        - ${p}`); }
  else { pass++; console.log(`ok     « ${c.q} »  ${got.visible} visible / ${got.total} au total${got.summary ? '  -> ' + got.summary.trim() : ''}`); }
}

console.log('\n' + '-'.repeat(66));
console.log(`${pass}/${pass + fail} cas · erreurs JS ${jsErrors.length}`);
for (const e of jsErrors) console.log('   ' + e);
await browser.close();
process.exit(fail === 0 && !jsErrors.length ? 0 : 1);
