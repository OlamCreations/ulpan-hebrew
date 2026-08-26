#!/usr/bin/env node
/*
 * swupdate-check.mjs — l'app demande-t-elle s'il existe une version plus récente ?
 *
 * Ce contrôle existe parce que son absence a coûté trois allers-retours. `app.js` ne vérifiait
 * qu'au `load`. Or **une app installée est reprise, pas lancée** : quelqu'un qui la laisse ouverte
 * sur l'accueil et y revient le lendemain ne déclenche jamais de `load`, ne demande donc jamais
 * s'il existe une version plus récente, et continue d'exécuter le code déjà en mémoire. Un
 * déploiement ne l'atteint pas, et rien à l'écran ne le dit — c'est indiscernable d'un bug qu'on
 * n'aurait pas corrigé.
 *
 * Le raisonnement était déjà écrit dans `assets/swupdate.js` (ajouté pour les 214 pages de
 * liturgie, qui ne chargent pas app.js) et n'avait jamais été reporté dans app.js : l'accueil et
 * les 465 leçons en étaient privés.
 *
 * Trois règles, sur les trois familles de pages :
 *   S1  la page APPELLE registration.update() au chargement
 *   S2  elle le rappelle au retour au premier plan (visibilitychange)
 *   S3  la demande contourne le cache HTTP (updateViaCache: 'none'), sinon elle peut se faire
 *       resservir l'ancien sw.js par le cache du navigateur et croire qu'il n'y a rien de neuf
 *
 *   node tools/serve.mjs 8912
 *   node tools/swupdate-check.mjs [--base URL]
 */
import { chromium } from 'playwright-core';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912');

const PAGES = [
  { label: 'accueil', path: '/' },
  { label: 'leçon', path: '/lessons/03-common-words.html' },
  { label: 'liturgie', path: '/liturgy/prayers-002-shema-en.html' },
];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let bad = 0, checks = 0;

for (const pg of PAGES) {
  // Service workers actifs ici : c'est justement eux qu'on mesure.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  /* On espionne registration.update(), pas les requetes reseau.
     Premiere version de ce controle : elle comptait les requetes vers /sw.js vues par la page, et
     rendait 0 partout - parce que register() va chercher sw.js depuis les entrailles du navigateur,
     hors du fil de requetes de la page. Elle rapportait donc un echec total sur du code correct,
     tout en affirmant par ailleurs (S3) qu'un enregistrement existait bel et bien. Meme famille
     d'erreur que le filtre qui comptait le SCRIPT track.js pour une balise d'analytics : mesurer ce
     qui est OBSERVABLE plutot que ce qui est pertinent. */
  await ctx.addInitScript(() => {
    window.__swUpdateCalls = 0;
    const proto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
    if (proto && proto.update) {
      const orig = proto.update;
      proto.update = function () { window.__swUpdateCalls++; return orig.apply(this, arguments); };
    }
  });

  /* Attendre l'appel, pas une duree.
     Premiere version : waitForTimeout(2500) puis lecture. register() rend une promesse, et
     update() n'est appele qu'a sa resolution ; quand celle-ci arrive apres la fenetre, la sonde
     rapporte un echec sur du code correct. Mesure : trois executions de suite ont rendu 9/9, 8/9
     puis 7/9 sur le MEME code. Une sonde instable est pire qu'aucune, on finit par croire le
     resultat qui arrange. */
  const waitCalls = async (ms = 9000) => {
    const t0 = Date.now();
    for (;;) {
      const n = await page.evaluate(() => window.__swUpdateCalls || 0);
      if (n > 0 || Date.now() - t0 > ms) return n;
      await page.waitForTimeout(200);
    }
  };

  await page.goto(BASE + pg.path, { waitUntil: 'load' });

  /* Attendre que le worker soit ACTIF avant de juger quoi que ce soit.
     Sur un profil neuf il precache 1231 entrees : mesure contre la production, 54 secondes avant
     activation. Tant qu'il n'est pas actif la page n'est controlee par personne, et la sonde
     rapportait alors 6/9 sur du code dont on venait de verifier qu'il marchait - elle mesurait
     une premiere visite, pas le regime dans lequel vit un apprenant dont l'app est installee
     depuis des semaines. */
  for (let i = 0; i < 300; i++) {
    const active = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return !!(r && r.active);
    });
    if (active) break;
    await page.waitForTimeout(500);
  }

  const atLoad = await waitCalls();

  checks++;
  if (!atLoad) { bad++; console.log(`  FAIL S1 ${pg.label} : registration.update() jamais appelé au chargement`); }
  else console.log(`  ok   S1 ${pg.label} : ${atLoad} appel(s) au chargement`);

  /* Retour au premier plan. On simule ce que fait le système quand on rouvre l'app : la page passe
     cachée puis visible. Playwright n'expose pas visibilityState directement, donc on le pilote par
     CDP — le redéfinir en JS ne déclencherait qu'un événement sans changer l'état lu par le code. */
  await page.evaluate(() => {
    window.__swUpdateCalls = 0;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  checks++;
  const atResume = await waitCalls();
  if (!atResume) { bad++; console.log(`  FAIL S2 ${pg.label} : rien redemandé au retour au premier plan — un déploiement n'atteint pas une app laissée ouverte`); }
  else console.log(`  ok   S2 ${pg.label} : ${atResume} appel(s) au retour`);

  checks++;
  const opts = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length ? String(regs[0].updateViaCache) : null;
  });
  if (opts !== 'none') { bad++; console.log(`  FAIL S3 ${pg.label} : updateViaCache = ${opts} (le cache HTTP peut resservir l'ancien sw.js)`); }
  else console.log(`  ok   S3 ${pg.label} : updateViaCache = none`);

  await page.close(); await ctx.close();
}

await browser.close();
console.log(`\n${checks - bad}/${checks} assertions de mise à jour`);
process.exit(bad ? 1 : 0);
