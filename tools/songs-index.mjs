/* songs-index.mjs — rebuild the Songs section of index.html from the pages that
 * actually exist on disk.
 *
 * The section carried a hand-written card list, a hand-written count and a
 * progress bar whose width was typed as a literal percentage. It said "6 songs"
 * over seven cards, and had done for as long as anyone can tell — which is the
 * ordinary fate of a number that nothing contradicts. Same fix as
 * tools/tehilim-index.mjs: read the directory, count what is there, and let the
 * three places agree by construction rather than by attention.
 *
 * Cards are grouped by the category named in content/songs/index.json, and the
 * seven hand-written pages that predate that registry are listed first under
 * their own heading, since they are modern songs rather than traditional ones.
 *
 * Usage: node tools/songs-index.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DRY = process.argv.includes('--dry');

const CONV = JSON.parse(readFileSync(join(ROOT, 'data', 'songs-conventions.json'), 'utf8'));
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'content', 'songs', 'index.json'), 'utf8')).songs;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Every page in liturgy/ whose name marks it as a song, in file order. The
   registry says what a built page SHOULD be called; the disk says what is
   actually there, and the disk wins — a registry row whose page was never built
   must not appear on the home page as a working link. */
const files = readdirSync(join(ROOT, 'liturgy'))
  .filter(f => /^songs-\d{3}-.*-en\.html$/.test(f))
  .sort();

const pages = files.map(file => {
  const html = readFileSync(join(ROOT, 'liturgy', file), 'utf8');
  const n = parseInt(file.slice(6, 9), 10);
  const entry = REGISTRY.find(s => s.n === n);

  const h1 = html.match(/<h1>([^<:]*)(?::\s*([^<]*))?<\/h1>/);
  const sub = html.match(/<div class="subtitle">([^<]*)<\/div>/);
  if (!h1) throw new Error(`${file}: no h1 to read a title from`);

  /* The Hebrew shown on a card is the page's own opening words, taken off the
     page rather than retyped — the one rule this whole pipeline is built on.
     The subtitle is a `·`-separated list and the Hebrew is the one segment that
     contains Hebrew letters: LAST on the built pages ("Eyal Golan, 2023 · עַם…"),
     FIRST on the seven hand-written ones ("הַתִּקְוָה · National anthem of Israel").
     Taking "the last segment" put "National anthem of Israel" in the Hebrew slot
     of seven cards, in the Hebrew serif, for as long as this script existed. */
  const segs = sub ? sub[1].split('·').map(x => x.trim()) : [];
  const he = segs.find(x => /[א-ת]/.test(x)) || '';
  if (!he) throw new Error(`${file}: no Hebrew in the subtitle to put on the card`);

  return {
    n, file,
    category: entry ? entry.category : 'modern',
    title: h1[1].trim(),
    blurb: (h1[2] || '').trim(),
    he
  };
});

if (!pages.length) { console.error('no song pages found'); process.exit(1); }

const card = p =>
  ` <a href="liturgy/${p.file}" class="tehilim-card">\n`
  + ` <div class="ps">${esc(p.title)}</div>\n`
  + ` <div class="he">${p.he}</div>\n`
  + ` <div class="ti">${esc(p.blurb)}</div>\n`
  + ` </a>`;

/* Modern first, because those pages already existed and people have their links;
   then the traditional groups in the order data/songs-conventions.json lists. */
const order = ['modern', ...Object.keys(CONV.categories)];
const label = k => k === 'modern' ? 'Modern and popular' : CONV.categories[k].label;

const blocks = order
  .map(k => ({ k, list: pages.filter(p => p.category === k) }))
  .filter(g => g.list.length)
  .map(g =>
    ` <h3 style="margin:18px 0 8px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);">`
    + `${esc(label(g.k))} · ${g.list.length}</h3>\n`
    + ` <div class="tehilim-grid">\n${g.list.map(card).join('\n')}\n </div>`
  );

const total = pages.length;
const registered = REGISTRY.length + 7;   // 7 hand-written pages predate the registry
const pct = Math.round(100 * total / registered);

const section =
  `<section class="mega-cat" id="cat-songs">\n`
  + ` <div class="mega-cat-header"><h2 class="mega-cat-title" style="display:block !important;">Songs</h2>\n`
  + ` <div class="mega-cat-bar"><div class="mega-cat-bar-fill" style="width:${pct}%"></div></div>\n`
  + ` <span class="mega-cat-stat">${total} songs</span>\n`
  + ` </div>\n`
  + ` <p style="color:var(--text-dim);font-size:13px;margin:0 0 12px;">Word-by-word Hebrew + English + transliteration + real chord progressions under each line. Hover any chord for fretboard. Print-friendly. The traditional songs take their Hebrew from a pinned edition, named at the foot of each page.</p>\n`
  + blocks.join('\n')
  + `\n</section>`;

const indexPath = join(ROOT, 'index.html');
const html = readFileSync(indexPath, 'utf8');

/* Replace between the opening tag and its matching close. Anchored on the id so
   a section that moves in the file is still found, and refusing rather than
   guessing if the anchors are not there. */
const start = html.indexOf('<section class="mega-cat" id="cat-songs">');
if (start < 0) { console.error('index.html: no #cat-songs section to replace'); process.exit(1); }
const end = html.indexOf('</section>', start);
if (end < 0) { console.error('index.html: #cat-songs section is not closed'); process.exit(1); }

const out = html.slice(0, start) + section + html.slice(end + '</section>'.length);

for (const g of order) {
  const list = pages.filter(p => p.category === g);
  if (list.length) console.log(`${label(g).padEnd(24)} ${list.length}`);
}
const missing = REGISTRY.filter(s => !pages.some(p => p.n === s.n));
console.log(`\n${total} song pages on disk, ${pct}% of ${registered} planned`);
if (missing.length) {
  console.log(`${missing.length} registered but not built yet: ${missing.map(s => s.slug).join(', ')}`);
}

if (DRY) { console.log('\n--dry, index.html not written'); process.exit(0); }
writeFileSync(indexPath, out, 'utf8');
console.log('index.html updated');
