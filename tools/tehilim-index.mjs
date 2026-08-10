/* tehilim-index.mjs — rebuild the Tehilim section of index.html from the pages
 * that actually exist.
 *
 * The section carried a hand-written card list, a hand-written "10 / 150" and a
 * progress bar whose width was typed as 6.67%. Three places to forget, and the
 * kind of number that stays wrong for months because nothing contradicts it.
 * Everything here is read off liturgy/tehilim-*-en.html instead.
 *
 * Usage: node tools/tehilim-index.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DRY = process.argv.includes('--dry');
const TOTAL = 150;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- what exists
const pages = readdirSync(join(ROOT, 'liturgy'))
  .filter(f => /^tehilim-\d{3}-en\.html$/.test(f))
  .map(f => {
    const html = readFileSync(join(ROOT, 'liturgy', f), 'utf8');
    const n = parseInt(f.slice(8, 11), 10);
    const h1 = html.match(/<h1>Tehilim \d+:\s*([^<]*)<\/h1>/);
    const sub = html.match(/<div class="subtitle">([^<]*)<\/div>/);
    // "תְּהִלִּים כ״ג · מִזְמוֹר לְדָוִד" -> the opening words after the separator
    const he = sub ? (sub[1].split('·').pop() || '').trim() : '';
    if (!h1 || !he) throw new Error(`${f}: could not read its title or subtitle`);
    return { n, file: f, titleEn: h1[1].trim(), he };
  })
  .sort((a, b) => a.n - b.n);

if (!pages.length) { console.error('no psalm pages found'); process.exit(1); }

// ---- contiguous ranges, so the blurb reads "1 to 17, 19 to 21" and not a list of 30
const ranges = [];
for (const p of pages) {
  const last = ranges[ranges.length - 1];
  if (last && p.n === last[1] + 1) last[1] = p.n;
  else ranges.push([p.n, p.n]);
}
const rangeText = ranges.map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`)).join(', ');

const cards = pages.map(p =>
  `        <a href="liturgy/${p.file}" class="tehilim-card">\n`
  + `          <div class="ps">Psalm ${p.n}</div>\n`
  + `          <div class="he">${p.he}</div>\n`
  + `          <div class="ti">${esc(p.titleEn)}</div>\n`
  + `        </a>`
).join('\n');

const pct = (pages.length / TOTAL * 100).toFixed(2);
const blurb = `Psalms ${rangeText}, word-by-word Hebrew + English + transliteration + a four-level PARDES reading, with a guitar chord chart on each. Print-friendly, share-friendly.`;

// ---- splice it in
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const start = html.indexOf('<section class="mega-cat" id="cat-tehilim">');
if (start < 0) { console.error('index.html has no #cat-tehilim section'); process.exit(1); }
const end = html.indexOf('</section>', start);
if (end < 0) { console.error('#cat-tehilim is not closed'); process.exit(1); }

const section =
`<section class="mega-cat" id="cat-tehilim">
      <div class="mega-cat-header"><h2 class="mega-cat-title" style="display:block !important;">Tehilim: Psalms</h2>
        <div class="mega-cat-bar"><div class="mega-cat-bar-fill" style="width:${pct}%"></div></div>
        <span class="mega-cat-stat">${pages.length} / ${TOTAL}</span>
      </div>
      <p style="color:var(--text-dim);font-size:13px;margin:0 0 12px;">${esc(blurb)}</p>
      <div class="tehilim-grid">
${cards}
      </div>
    `;

const next = html.slice(0, start) + section + html.slice(end);
if (!DRY) writeFileSync(join(ROOT, 'index.html'), next, 'utf8');

console.log(`${pages.length} psalm pages -> ${pct}% of ${TOTAL}`);
console.log(`ranges: ${rangeText}`);
console.log(DRY ? '[dry run, nothing written]' : 'index.html updated');
