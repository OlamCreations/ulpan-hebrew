/* parity-2026-08-28.mjs — les DEUX traducteurs, les MÊMES questions, la même barre.
 *
 * Jonas : « ne migre pas mais mirror les deux, que ça marche aussi bien dans ulpan hebrew ».
 * Les deux surfaces gardent donc leur code (2040 lignes ici, 987 dans le moteur partagé) et
 * doivent tenir les mêmes promesses. Ce fichier est la barre commune.
 *
 * Ce qu'il ne fait PAS : exiger une sortie identique. Les deux corpus diffèrent, les deux
 * publics diffèrent, et une comparaison octet à octet rougirait sur du travail parfaitement bon
 * — donc finirait désactivée. Ce qui est comparé est la QUALITÉ de la réponse, énoncée en
 * invariants que les deux doivent tenir :
 *
 *   P1  une question qui a une réponse en rend une (pas zéro)
 *   P2  une seule carte est visible ; les autres sont dans un repli
 *   P3  un repli existe si et seulement s'il a quelque chose dedans
 *   P4  le sens ne répète jamais la question (ni en latin, ni en hébreu)
 *   P5  une carte hébraïque porte une lecture
 *   P6  aucun titre de groupe au-dessus d'un élément unique
 *
 * Chaque invariant est mesuré des DEUX côtés, sur la même question, et la sortie dit lequel des
 * deux le rate. C'est la seule forme de « miroir » qui survit à la divergence des deux codes :
 * si demain l'un gagne une fonction que l'autre n'a pas, la barre ne bouge pas.
 *
 * Réseau : ouvert des deux côtés. Les étages 3 et 4 passent par le vrai Worker, et c'est
 * précisément là que les deux surfaces peuvent diverger sans que personne le voie.
 *
 * Usage : node tools/parity-2026-08-28.mjs
 *         K10=/chemin/vers/ulpan-etzion/site node tools/parity-2026-08-28.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ask as askQs } from './translator-driver.mjs';

const UH = path.resolve(process.env.UH || '.');
const K10 = path.resolve(process.env.K10 || '../ulpan-etzion/site');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

function serve(rootDir, port) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(rootDir, rel);
    if (!f.startsWith(rootDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

/* Les deux vocabulaires de sélecteurs. Rien d'autre ne diffère dans ce fichier : tout le reste
   est écrit une fois et mesuré deux fois. */
const SURFACES = {
  'ulpan-hebrew': {
    port: 8931, dir: UH, page: '/index.html',
    input: '#qs-input', results: '#qs-results', card: '.qs-card',
    he: '.qs-he', tr: '.qs-tr', meaning: '.qs-en',
    alts: 'details.qs-alts', sub: '.qs-sub', badge: '.qs-tag',
    /* Deux formes de carte coexistent ici : le mot seul (.qs-he / .qs-tr) et la phrase, rendue
       en paires mot-sur-lecture (.qs-pairs). Ne lire que la première, c'est déclarer « aucun
       hébreu » sur toutes les phrases — et une sonde qui ne voit pas la moitié des cartes rend
       vert en ne mesurant rien. */
    pairsHe: '.qs-pairs .qs-wp-he', pairsTr: '.qs-pairs .qs-wp-tr',
    strip: '.qs-wp-tr, .qs-tag',
  },
  'kita10': {
    port: 8932, dir: K10, page: '/index.html',
    input: '#ut-input', results: '#ut-results', card: '.ut-card',
    he: '.ut-he', tr: '.ut-tr', meaning: '.ut-meaning',
    alts: 'details.ut-alts', sub: '.ut-sub', badge: '.ut-badge',
    strip: '.ut-badge',
  },
};

/* Les questions. Chacune vise un étage précis, et la colonne « attendu » dit ce que
   l'apprenant a le droit d'exiger — pas ce que le code rend aujourd'hui. */
const CASES = [
  { q: 'משרד',           why: 'hébreu nu, corpus : réponse vérifiée' },
  { q: 'אֲנִי',            why: 'hébreu pointé : lecture sans réseau' },
  { q: 'מזלות',          why: 'hébreu hors corpus : une réponse, le reste replié' },
  { q: 'אני רוצה קפה',   why: 'phrase hébraïque' },
  { q: 'beseder',        why: 'romanisation vérifiée + devinettes à replier' },
  { q: 'kacha kacha',    why: 'romanisation sans correspondance vérifiée' },
  { q: 'bureau',         why: 'sens français : le sens ne doit pas répéter la question' },
  { q: 'thank you',      why: 'sens anglais' },
  { q: 'todah',          why: 'romanisation courante' },
  { q: 'shalom',         why: 'le mot le plus cherché de tous' },
];

/* --- lecture normalisée d'un écran, quelle que soit la surface --- */
async function observe(page, S) {
  return page.evaluate(sel => {
    const root = document.querySelector(sel.results);
    if (!root) return null;
    const all = Array.from(root.querySelectorAll(sel.card));
    const vis = all.filter(c => !c.closest('details:not([open])'));
    /* On lit sur une COPIE dont les noeuds parasites sont retirés : lire l'original recollerait
       la lecture à l'hébreu sur les cartes de phrase, et le badge au sens sur les cartes en
       ligne. Deux façons de rapporter un texte que personne n'a jamais vu à l'écran. */
    const txt = (n, s) => {
      const x = n && n.querySelector(s);
      if (!x) return '';
      const c = x.cloneNode(true);
      if (sel.strip) c.querySelectorAll(sel.strip).forEach(k => k.remove());
      return c.textContent.replace(/\s+/g, ' ').trim();
    };
    /* Les cartes de phrase : chaque mot est un noeud. Les recoller AVEC une espace, sinon la
       mesure du nombre de mots (P8) compte toujours un. */
    const join = (n, s) => {
      if (!n || !s) return '';
      return Array.from(n.querySelectorAll(s)).map(x => x.textContent.trim()).filter(Boolean).join(' ');
    };
    const lead = vis[0] || null;
    const det = root.querySelector(sel.alts);
    let inDetails = 0;
    if (det) inDetails = det.querySelectorAll(sel.card).length;
    return {
      total: all.length,
      visible: vis.length,
      he: lead ? (txt(lead, sel.he) || join(lead, sel.pairsHe)) : '',
      tr: lead ? (txt(lead, sel.tr) || join(lead, sel.pairsTr)) : '',
      meaning: lead ? txt(lead, sel.meaning) : '',
      hasAlts: !!det,
      inAlts: inDetails,
      /* Un titre de groupe (« autres lectures », « did you mean ») laissé au-dessus de la tête :
         il annonce un ensemble là où il n'y a plus qu'un élément. */
      leadSubs: lead ? lead.querySelectorAll(sel.sub).length : 0,
      /* Uniquement les titres de PREMIER niveau : ceux qui sont dans une carte nomment un
         panneau ouvert à la demande (mot-à-mot, formes), qui a bien plusieurs morceaux. Les
         compter ferait rougir l'invariant sur un écran correct, et un invariant qui rougit sur
         du bon travail finit désactivé. */
      headSubs: Array.from(root.children)
        .filter(n => n.classList && n.classList.contains(sel.sub.replace('.', ''))).length,
      /* Le badge de confiance, dans les mots de chaque surface. Il n'est pas comparé
         littéralement : seul « est-ce donné pour vérifié » l'est. */
      badge: lead ? Array.from(lead.querySelectorAll(sel.badge))
        .map(n => n.textContent.trim()).join(' ') : '',
      text: root.textContent.replace(/\s+/g, ' ').trim().slice(0, 160),
    };
  }, S);
}

/* La saisie côté kita10 : miroir de celle des sondes kita10, pas de celle d'ulpan-hebrew, dont
   la synchronisation est propre à son DOM (et documentée dans translator-driver.mjs). */
async function askUt(page, S, q) {
  await page.evaluate(sel => {
    const r = document.querySelector(sel.results);
    if (!window.__obs) {
      window.__n = 0;
      window.__obs = new MutationObserver(() => { window.__n++; });
      window.__obs.observe(r, { childList: true, subtree: true });
    }
    window.__n = 0;
  }, S);
  await page.fill(S.input, '');
  await page.waitForTimeout(80);
  await page.evaluate(() => { window.__n = 0; });
  await page.fill(S.input, q);
  await page.waitForFunction(sel => window.__n > 0
    && document.querySelector(sel.results).getAttribute('aria-busy') !== 'true'
    && document.querySelector(sel.results).textContent.trim().length > 0,
  S, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(350);
}

/* --- les invariants, énoncés une fois, appliqués aux deux --- */
/* Les plages sont écrites en \u et jamais en caractères combinants littéraux : un signe
   diacritique nu dans une classe de caractères est invisible à la relecture, et un fichier de
   ce dépôt a déjà passé `node --check` avec des octets de contrôle collés dans une regex. */
const fold = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const bare = s => String(s || '').replace(/[֑-ׇ]/g, '').replace(/[^א-ת]/g, '');
const isHeb = s => /[א-ת]/.test(String(s || ''));

function invariants(o, q) {
  if (!o) return ['aucun conteneur de résultats'];
  const bad = [];
  if (o.total === 0) bad.push('P1 aucune réponse');
  if (o.total > 0 && o.visible !== 1) bad.push(`P2 ${o.visible} cartes visibles au lieu d'une`);
  if (o.total > 1 && !o.hasAlts) bad.push('P2 plusieurs cartes et aucun repli');
  if (o.hasAlts && o.inAlts === 0) bad.push('P3 un repli vide a été rendu');
  if (o.meaning) {
    if (!isHeb(q) && fold(o.meaning) === fold(q)) bad.push(`P4 le sens répète la question : « ${o.meaning} »`);
    if (isHeb(q) && bare(o.meaning) && bare(o.meaning) === bare(q)) bad.push('P4 le sens répète la question (hébreu)');
  }
  if (o.he && !o.tr) bad.push('P5 carte hébraïque sans lecture');
  if (o.headSubs > 0 && o.visible === 1) bad.push(`P6 ${o.headSubs} titre(s) de groupe au-dessus d'une carte unique`);
  /* P8 — répondre à deux mots par une phrase entière. Le mot cherché est bien dedans, ce qui
     rend l'erreur difficile à voir en lisant : la carte contient la bonne réponse noyée dans
     une phrase que personne n'a demandée. La borne est N+1 et pas N : un mot composé, un
     article soudé, une forme construite ajoutent légitimement un mot, jamais quatre. */
  const nq = String(q).trim().split(/\s+/).filter(Boolean).length;
  const nh = String(o.he || '').trim().split(/\s+/).filter(Boolean).length;
  if (nh > nq + 1) bad.push(`P8 question de ${nq} mot(s), réponse de ${nh} mots`);
  return bad;
}

/* --- P7, le seul invariant vraiment CROISÉ : la confiance ---
 * Chaque surface dit sa confiance dans ses propres mots. On ne compare pas les mots, on compare
 * le fait : si l'une donne une réponse vérifiée à une question et que l'autre rend une
 * devinette, la seconde a un trou de corpus. C'est ce que « miroir » veut dire ici, et aucune
 * sonde interne à un dépôt ne peut le voir : il faut les deux à la fois. */
function confident(name, o) {
  if (!o || !o.he) return null;
  const b = (o.badge || '').toLowerCase();
  if (name === 'ulpan-hebrew') {
    if (/lesson|curated|✓/.test(b)) return true;
    if (/online|phonetic|guess/.test(b)) return false;
    return true;              // pas de badge = tiré du corpus
  }
  if (/not verified|unverified|non vérifié/.test(b)) return false;
  return true;
}

/* --- exécution --- */
const servers = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = {};
const errors = {};

for (const [name, S] of Object.entries(SURFACES)) {
  if (!fs.existsSync(path.join(S.dir, 'index.html'))) {
    console.log(`!! ${name} : pas de index.html dans ${S.dir} — surface ignorée`);
    continue;
  }
  servers.push(await serve(S.dir, S.port));
  const page = await browser.newPage();
  errors[name] = [];
  page.on('pageerror', e => errors[name].push(String(e)));
  await page.goto(`http://localhost:${S.port}${S.page}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const ready = await page.evaluate(sel => !!document.querySelector(sel.input), S);
  if (!ready) {
    console.log(`!! ${name} : pas de champ ${S.input} sur ${S.page} — surface ignorée`);
    results[name] = null;
    continue;
  }

  results[name] = {};
  for (const c of CASES) {
    if (name === 'ulpan-hebrew') await askQs(page, c.q);
    else await askUt(page, S, c.q);
    results[name][c.q] = await observe(page, S);
  }
}

/* --- rapport --- */
const names = Object.keys(results).filter(n => results[n]);
let bad = 0;
const perSurface = Object.fromEntries(names.map(n => [n, 0]));

console.log('');
for (const c of CASES) {
  const rows = names.map(n => [n, results[n][c.q], invariants(results[n][c.q], c.q)]);
  /* P7 se décide en regardant les deux lignes ensemble, donc après les invariants locaux. */
  if (names.length > 1) {
    const conf = Object.fromEntries(rows.map(r => [r[0], confident(r[0], r[1])]));
    const sure = names.filter(n => conf[n] === true);
    const guess = names.filter(n => conf[n] === false);
    if (sure.length && guess.length) {
      for (const g of guess) {
        const row = rows.find(r => r[0] === g);
        row[2].push(`P7 devinette ici alors que ${sure.join(' et ')} rend une réponse vérifiée`);
      }
    }
  }
  const anyBad = rows.some(r => r[2].length);
  console.log(`${anyBad ? 'DIVERGE' : 'ok     '} « ${c.q} »  ${c.why}`);
  for (const [n, o, prob] of rows) {
    const shape = o ? `${o.visible}/${o.total} vis${o.hasAlts ? ` +${o.inAlts} repliées` : ''}` : 'rien';
    const head = o && o.he
      ? `${o.he}${o.tr ? ' · ' + o.tr : ''}${o.meaning ? ' · ' + o.meaning : ''}${o.badge ? '  [' + o.badge + ']' : ''}`
      : (o ? o.text.slice(0, 60) : '');
    console.log(`         ${n.padEnd(13)} ${shape.padEnd(20)} ${head}`);
    for (const p of prob) { console.log(`           ✗ ${p}`); perSurface[n]++; bad++; }
  }
}

console.log('\n' + '-'.repeat(72));
for (const n of names) {
  console.log(`${n.padEnd(14)} ${perSurface[n]} invariant(s) violé(s) sur ${CASES.length} questions · erreurs JS ${errors[n].length}`);
  for (const e of errors[n].slice(0, 3)) console.log('    JS ' + e);
}
console.log(`total ${bad} violation(s)`);

await browser.close();
for (const s of servers) s.close();
process.exit(bad === 0 && names.every(n => !errors[n].length) ? 0 : 1);
