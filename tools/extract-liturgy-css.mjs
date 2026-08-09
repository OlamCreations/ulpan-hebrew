/* extract-liturgy-css.mjs — pull the duplicated CSS out of the liturgy pages.
 *
 * The 51 liturgy pages carried ~47 700 lines of inline CSS between them, 97-99%
 * of it identical: one page's stylesheet pasted 51 times, then edited in six
 * slightly different directions.
 *
 * This splits each page's <style> into top-level chunks, keeps the chunks that
 * are byte-identical across every page, and writes them once:
 *
 *   assets/liturgy.css   verse layout, intro, pardes, chant tips, print rules
 *   assets/chords.css    the chord chart, linked only by pages that have one
 *
 * Whatever is not shared stays inline on the page that differs, so the six
 * variants keep their own behaviour instead of being averaged into one.
 *
 * TWO GUARDS, because a CSS move is silent when it goes wrong:
 *
 *   1. cascade — an extracted chunk moves ahead of everything left inline. A
 *      chunk is therefore only extracted if no page-specific chunk that used to
 *      precede it shares a selector with it. Ties on specificity would otherwise
 *      swap winner, and nothing would error.
 *   2. pixels — tools/liturgy-pixel-check.mjs --compare must stay green. The
 *      chunk arithmetic proving "same rules" says nothing about how they render.
 *
 * Usage: node tools/extract-liturgy-css.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DRY = process.argv.includes('--dry');

// Selector prefixes that belong to the chord chart rather than to the page.
const CHORD_SELECTORS = /(^|[\s,>])(\.t-chord|\.t-tuning|\.active-voicings|\.voicings-grid|\.voicing-|\.chord-tooltip|\.chord-popup|\.tt-|\.fret-editor|\.edit-cell|\.edit-toggle|\.chord\b|\.stich-chords|\.progression\b|\.link-btn|\.cx-)/;

/** Split a stylesheet into top-level chunks, each carrying the comments and
 *  blank lines that preceded it so the file still reads like it was written. */
function chunkCss(css) {
  const chunks = [];
  let depth = 0, start = 0, i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        chunks.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
    i++;
  }
  const tail = css.slice(start);
  if (tail.trim()) chunks.push(tail);
  return chunks;
}

const norm = s => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/** The selectors a chunk targets, for the cascade guard. */
function selectorsOf(chunk) {
  const head = chunk.slice(0, chunk.indexOf('{'));
  if (/@media/.test(head)) {
    // Compare a media block by everything it contains; cheap and conservative.
    return [...chunk.matchAll(/([^{};]+)\{/g)].map(m => m[1].trim()).filter(Boolean);
  }
  return head.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(s => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- read
const pages = [];
for (const file of readdirSync(join(ROOT, 'liturgy')).sort()) {
  if (!file.endsWith('.html')) continue;
  const html = readFileSync(join(ROOT, 'liturgy', file), 'utf8');
  if (html.includes('assets/liturgy.css')) { console.log(`skip   ${file} (already extracted)`); continue; }
  const blocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  if (!blocks.length) continue;
  const big = blocks.reduce((a, b) => (b[1].length > a[1].length ? b : a));
  pages.push({
    file, html,
    styleOuter: big[0],
    css: big[1],
    chunks: chunkCss(big[1]),
    hasChart: html.includes('<div class="t-chord">')
  });
}
if (!pages.length) { console.log('nothing to do'); process.exit(0); }

// ---------------------------------------------------------- shared set
const counts = new Map();          // normalised chunk -> pages containing it
for (const p of pages) {
  const seen = new Set();
  for (const c of p.chunks) {
    const k = norm(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
}
const sharedKeys = new Set([...counts].filter(([, n]) => n === pages.length).map(([k]) => k));

// -------------------------------------------------------- cascade guard
// Drop from the shared set any chunk that a page-specific chunk precedes and
// whose selectors it also targets.
const withdrawn = [];
for (const p of pages) {
  const localSelectors = [];
  for (const c of p.chunks) {
    const k = norm(c);
    if (!k) continue;
    if (!sharedKeys.has(k)) { localSelectors.push(...selectorsOf(c)); continue; }
    const mine = selectorsOf(c);
    const clash = mine.find(s => localSelectors.includes(s));
    if (clash) {
      sharedKeys.delete(k);
      withdrawn.push(`${p.file}: "${clash}" is redefined locally before the shared copy`);
    }
  }
}

// ------------------------------------------------------------- write css
// Chunk order is taken from the page that has the most shared chunks, so the
// output keeps a sane reading order rather than a set's iteration order.
const donor = pages.reduce((a, b) =>
  b.chunks.filter(c => sharedKeys.has(norm(c))).length > a.chunks.filter(c => sharedKeys.has(norm(c))).length ? b : a);

const liturgyOut = [], chordsOut = [];
const emitted = new Set();
for (const c of donor.chunks) {
  const k = norm(c);
  if (!sharedKeys.has(k) || emitted.has(k)) continue;
  emitted.add(k);
  (CHORD_SELECTORS.test(c.slice(0, c.indexOf('{'))) ? chordsOut : liturgyOut).push(c.trim());
}
// Anything shared that the donor lacks (possible when the donor is a variant).
for (const p of pages) {
  for (const c of p.chunks) {
    const k = norm(c);
    if (!sharedKeys.has(k) || emitted.has(k)) continue;
    emitted.add(k);
    (CHORD_SELECTORS.test(c.slice(0, c.indexOf('{'))) ? chordsOut : liturgyOut).push(c.trim());
  }
}

const header = what => `/* ${what}
 * Extracted by tools/extract-liturgy-css.mjs from the ${pages.length} liturgy pages, which
 * each carried their own copy. Only rules byte-identical on every page live here;
 * anything a page does differently stayed in that page's <style> block, which is
 * why the six layout variants still behave differently.
 */\n\n`;

const liturgyCss = header('Shared liturgy page styles: verses, intro, pardes, chant tips, print.') + liturgyOut.join('\n\n') + '\n';
const chordsCss = header('Shared chord chart styles. Linked only by pages that show a chart.') + chordsOut.join('\n\n') + '\n';

// -------------------------------------------------------- rewrite pages
let totalBefore = 0, totalAfter = 0;
for (const p of pages) {
  const keep = [];
  for (const c of p.chunks) {
    const k = norm(c);
    if (!k) continue;
    if (sharedKeys.has(k)) continue;
    // A page with no chart has no use for chart rules: the markup is gone.
    if (!p.hasChart && CHORD_SELECTORS.test(c.slice(0, c.indexOf('{')))) continue;
    keep.push(c.trim());
  }

  const links = ['<link rel="stylesheet" href="../assets/liturgy.css">']
    .concat(p.hasChart ? ['<link rel="stylesheet" href="../assets/chords.css">'] : []);

  const inline = keep.length
    ? `<style>\n/* Only what this page does differently. The rest is in assets/liturgy.css. */\n${keep.join('\n')}\n</style>`
    : '';

  const replacement = links.join('\n') + (inline ? '\n' + inline : '');
  let html = p.html.replace(p.styleOuter, replacement);

  totalBefore += p.css.split('\n').length;
  totalAfter += keep.join('\n').split('\n').length;

  if (!DRY) writeFileSync(join(ROOT, 'liturgy', p.file), html, 'utf8');
}

if (!DRY) {
  writeFileSync(join(ROOT, 'assets', 'liturgy.css'), liturgyCss, 'utf8');
  writeFileSync(join(ROOT, 'assets', 'chords.css'), chordsCss, 'utf8');
}

console.log(`pages                  : ${pages.length} (${pages.filter(p => p.hasChart).length} with a chart)`);
console.log(`shared chunks          : ${sharedKeys.size}`);
console.log(`  -> assets/liturgy.css: ${liturgyOut.length} rules, ${liturgyCss.split('\n').length} lines`);
console.log(`  -> assets/chords.css : ${chordsOut.length} rules, ${chordsCss.split('\n').length} lines`);
console.log(`inline CSS lines       : ${totalBefore} -> ${totalAfter}`);
if (withdrawn.length) {
  console.log(`\nkept inline by the cascade guard (${withdrawn.length}):`);
  for (const w of withdrawn.slice(0, 10)) console.log('  ' + w);
}
console.log(`\n${DRY ? '[dry run, nothing written] ' : ''}done`);
