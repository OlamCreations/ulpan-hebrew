/* Contraste WCAG des badges de provenance du traducteur (.qs-tag-*), dans les DEUX themes.
   Ecrit le 2026-08-26 avec la hierarchie de poids : le badge « verifie » devient plein, donc
   du texte sur un aplat de couleur, et un aplat est exactement l'endroit ou le contraste
   casse en silence. Le badge fait 10 px : le seuil WCAG applicable est 4.5:1 (texte normal),
   pas 3:1.

   Le controle LIT style.css — les variables de theme et les regles .qs-tag-* — au lieu de
   redire les couleurs. Changer `--accent` fait donc rougir ce controle, ce qui est le point :
   une restitution des couleurs dans l'outil ne mesurerait que l'outil.

   `--self-test` injecte des paires connues (une qui passe, une qui echoue) et exige les deux
   verdicts, pour prouver que le controle peut rougir. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEUIL = 4.5;          // WCAG 2.1 AA, texte normal (< 18.66px ou < 24px non gras)

const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const hexToRgb = h => {
  const m = String(h).trim().replace('#', '');
  const f = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(f)) return null;
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16));
};
const lum = hex => { const r = hexToRgb(hex); if (!r) return null; const [R, G, B] = r.map(lin); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
const ratio = (a, b) => {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

/* ---- lecture de style.css ---------------------------------------------------------------- */
const css = readFileSync(join(ROOT, 'assets', 'style.css'), 'utf8');

function varsOf(selector) {
  const i = css.indexOf(selector + ' {');
  if (i < 0) throw new Error('bloc de variables introuvable : ' + selector);
  const j = css.indexOf('}', i);
  const body = css.slice(i, j);
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const THEMES = {
  dark: varsOf(':root'),
  light: { ...varsOf(':root'), ...varsOf('html.light') },   // .light surcharge :root
};
for (const [nom, v] of Object.entries(THEMES)) {
  if (!v['--accent'] || !v['--bg-card']) throw new Error('theme ' + nom + ' : variables essentielles absentes');
}

/* Resout une valeur CSS en couleur concrete pour un theme donne. */
function resolve(val, theme, depth = 0) {
  if (val == null || depth > 4) return null;
  const v = String(val).trim();
  if (v === 'transparent' || v === 'none' || v === 'inherit') return null;
  const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (m) return resolve(THEMES[theme][m[1]] ?? m[2], theme, depth + 1);
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

/* Les declarations de chaque badge, telles qu'ecrites, y compris les surcharges `html.light`.

   Premiere version le 2026-08-26 : l'expression ancrait sur `(?:^|\})` sans le drapeau `m`, donc
   `^` ne valait qu'au tout debut du fichier et une regle precedee d'un commentaire n'etait jamais
   vue. `declsFor` rendait {} pour les trois badges, le repli `var(--text)` s'appliquait, et le
   controle affichait 6/6 VERT en ne mesurant rien. Il a fallu remarquer que les trois badges
   rendaient la MEME couleur — impossible s'il avait lu les regles. D'ou les deux gardes ci-dessous :
   toutes les regles sont extraites puis leurs selecteurs compares a l'identique (plus d'ancre
   fragile), et `assertLu` exige que chaque badge ait effectivement une declaration `color`. */
function toutesLesRegles() {
  const out = [];
  /* Les commentaires CSS sont retires AVANT le decoupage. Sans ca, le bloc de selecteur
     `[^{}]+` avale le commentaire qui precede la regle : le selecteur lu devient le texte du
     commentaire suivi de `.qs-tag-online`, et il n'est plus egal a rien. C'est la DEUXIEME
     fois que le parseur de ce controle rend un vert vide (la premiere : une ancre `^` sans
     le drapeau `m`), d'ou la garde `assertLu` plus bas, qui rend le vert vide impossible. */
  const net = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const m of net.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const decls = {};
    for (const d of m[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) decls[d[1].trim()] = d[2].trim();
    out.push({ sels, decls });
  }
  return out;
}
const REGLES = toutesLesRegles();
if (REGLES.length < 200) throw new Error('style.css : ' + REGLES.length + ' regles lues, attendu >= 200 — le fichier n a pas ete parse');

function declsFor(cls) {
  const out = {};
  for (const r of REGLES) {
    for (const sel of r.sels) {
      if (sel === '.' + cls) Object.assign(out.both ||= {}, r.decls);
      else if (sel === 'html.light .' + cls) Object.assign(out.light ||= {}, r.decls);
    }
  }
  return out;
}

const BADGES = ['qs-tag-curated', 'qs-tag-online', 'qs-tag-phonetic'];
const base = declsFor('qs-tag').both || {};

const paires = [];
for (const cls of BADGES) {
  const d = declsFor(cls);
  for (const theme of ['dark', 'light']) {
    const decl = { ...base, ...(d.both || {}), ...(theme === 'light' ? (d.light || {}) : {}) };
    // Fond effectif du badge : son propre background s'il en a un, sinon la carte qui le porte.
    const bgDecl = decl['background'] || decl['background-color'];
    const bg = resolve(bgDecl, theme) || resolve('var(--bg-card)', theme);
    const fg = resolve(decl['color'], theme) || resolve('var(--text)', theme);
    paires.push({ cls, theme, fg, bg, plein: !!bgDecl && bgDecl !== 'transparent' });
  }
}
if (paires.length !== BADGES.length * 2) throw new Error('paires attendues ' + BADGES.length * 2 + ', obtenues ' + paires.length);
/* assertLu : sans ca, une regle non lue retombe sur le repli `var(--text)` et le controle rend un
   vert qui ne mesure rien — c'est exactement le defaut de la premiere version. */
for (const cls of BADGES) {
  const d = declsFor(cls);
  const a = { ...(d.both || {}), ...(d.light || {}) };
  if (!a['color']) throw new Error('.' + cls + ' : aucune declaration `color` lue dans style.css');
}

/* ---- self-test : le controle doit pouvoir rougir ------------------------------------------ */
if (process.argv.includes('--self-test')) {
  const cas = [
    { nom: 'blanc sur #4A9EDB (accent sombre)', fg: '#ffffff', bg: '#4A9EDB', doitPasser: false },
    { nom: 'noir #0a0a0a sur #4A9EDB',          fg: '#0a0a0a', bg: '#4A9EDB', doitPasser: true },
    { nom: 'blanc sur #0071B9 (accent clair)',  fg: '#ffffff', bg: '#0071B9', doitPasser: true },
    { nom: '#888 sur #131313 (texte dim)',      fg: '#888888', bg: '#131313', doitPasser: true },
  ];
  let ko = 0;
  for (const c of cas) {
    const r = ratio(c.fg, c.bg);
    const passe = r >= SEUIL;
    const ok = passe === c.doitPasser;
    if (!ok) ko++;
    console.log(`  ${ok ? 'ok  ' : 'ECHEC'} ${c.nom} -> ${r.toFixed(2)}:1 (attendu ${c.doitPasser ? '>=' : '<'} ${SEUIL})`);
  }
  console.log(`\n${cas.length - ko}/${cas.length} assertions du self-test`);
  process.exit(ko ? 1 : 0);
}

/* ---- verdict ------------------------------------------------------------------------------ */
let ko = 0;
for (const p of paires) {
  const r = p.fg && p.bg ? ratio(p.fg, p.bg) : null;
  if (r === null) { console.log(`  ECHEC ${p.cls} [${p.theme}] couleur non resolue (fg=${p.fg} bg=${p.bg})`); ko++; continue; }
  const ok = r >= SEUIL;
  if (!ok) ko++;
  console.log(`  ${ok ? 'ok  ' : 'ECHEC'} ${p.cls.padEnd(17)} [${p.theme.padEnd(5)}] ${p.fg} sur ${p.bg}${p.plein ? ' (plein)' : ''} -> ${r.toFixed(2)}:1`);
}
console.log(`\n${paires.length - ko}/${paires.length} paires au-dessus de ${SEUIL}:1 (WCAG AA, texte 10px)`);
process.exit(ko ? 1 : 0);
