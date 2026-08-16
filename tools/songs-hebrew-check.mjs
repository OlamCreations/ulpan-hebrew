/* songs-hebrew-check.mjs — read the Hebrew back off the shipped song pages and
 * compare it, codepoint for codepoint, with the pinned edition.
 *
 * The builder derives every Hebrew character from content/songs/source/NNN.json,
 * so the pages match "by construction". That is exactly the kind of guarantee
 * that cannot fail, and a check that cannot fail is indistinguishable from no
 * check. This one reads the HTML on disk, not the builder's output in memory, so
 * a bad slice index, a stray replace, a page hand-edited after the fact, or an
 * editor normalising niqqud on save all have somewhere to show up.
 *
 * That is not hypothetical here. The Tehilim pages carried psalm 1's incipit in
 * every footer and a wrong key on 126 of 140 pages, and both survived because
 * the only check anyone had was pointed at the word cells.
 *
 * Four things are compared, because they can drift apart from each other:
 *   1. the word cells, in document order, against the source word list
 *   2. the verse-full block of each stanza, whose lines are the source lines
 *   3. the stanza ranges actually present against the authored from/to
 *   4. the page identity: SONG_CHORDS id, and the key against its own grid
 *
 * Comparison is on raw codepoints with no Unicode normalisation. NFC and NFD
 * niqqud look identical in a browser and are different text; normalising here
 * would hide the one class of corruption this file exists to catch.
 *
 * Usage:
 *   node tools/songs-hebrew-check.mjs            # every built page
 *   node tools/songs-hebrew-check.mjs 17 23      # named songs
 *   node tools/songs-hebrew-check.mjs --self-test
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveKey } from './chord-key.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'content', 'songs', 'index.json'), 'utf8')).songs;

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const cps = s => [...s].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

const pagePath = e => join(ROOT, 'liturgy', `songs-${String(e.n).padStart(3, '0')}-${e.slug}-en.html`);
const srcPath = e => join(ROOT, 'content', 'songs', 'source', `${String(e.n).padStart(3, '0')}.json`);
const authPath = e => join(ROOT, 'content', 'songs', `${String(e.n).padStart(3, '0')}.json`);

/** Every Hebrew word cell on the page, in document order. */
const wordCells = html => [...html.matchAll(/<div class="word"><div class="he">([^<]*)<\/div>/g)].map(m => unesc(m[1]));

/** Every verse-full block, split back into the lines the builder joined with <br>. */
const fullBlocks = html => [...html.matchAll(/<div class="verse-full">([\s\S]*?)<\/div>/g)]
  .map(m => m[1].split(/<br>\s*/).map(x => unesc(x.trim())).filter(Boolean));

/**
 * All findings for one song, as strings. Exported so the self-test can run it
 * over deliberately damaged HTML rather than re-implementing the comparison — a
 * self-test that re-implements what it checks proves only that it agrees with
 * itself.
 */
export function checkSong(entry, html, source, authored) {
  const out = [];
  const nn = String(entry.n).padStart(3, '0');

  // ---- 1. word cells, in order
  /* Built from the authored stanza ranges rather than from the whole source, so
     a song that deliberately omits nothing is compared against exactly what the
     author said the page should hold. The validator already refuses a file whose
     ranges do not cover every line. */
  const expected = [];
  for (const st of authored.stanzas) {
    for (let i = st.from; i <= st.to; i++) {
      const line = source.lines[i];
      if (!line) { out.push(`stanza ${st.n}: line ${i} is not in the source`); continue; }
      for (const w of line.words) expected.push(w.he);
    }
  }
  const got = wordCells(html);
  if (got.length !== expected.length) {
    out.push(`${got.length} word cells on the page, ${expected.length} in the source`);
  }
  const n = Math.min(got.length, expected.length);
  for (let i = 0; i < n; i++) {
    if (got[i] !== expected[i]) {
      out.push(
        `word ${i} differs\n        page   ${cps(got[i])}\n        source ${cps(expected[i])}`
        + `\n        first difference at index ${firstDiff(got[i], expected[i])}`
      );
      break;   // one is enough; a shifted list would report every cell after it
    }
  }

  // ---- 2. verse-full blocks against the source lines
  const blocks = fullBlocks(html);
  if (blocks.length !== authored.stanzas.length) {
    out.push(`${blocks.length} verse-full blocks, ${authored.stanzas.length} stanzas authored`);
  }
  authored.stanzas.forEach((st, si) => {
    const block = blocks[si];
    if (!block) return;
    const want = [];
    for (let i = st.from; i <= st.to; i++) if (source.lines[i]) want.push(source.lines[i].he);
    if (block.length !== want.length) {
      out.push(`stanza ${st.n}: ${block.length} lines in the full block, ${want.length} in the source`);
      return;
    }
    for (let k = 0; k < want.length; k++) {
      if (block[k] !== want[k]) {
        out.push(`stanza ${st.n} line ${st.from + k} of the full block differs\n        page   ${cps(block[k])}\n        source ${cps(want[k])}`);
        return;
      }
    }
  });

  // ---- 3. the stanza cards actually rendered
  const cards = (html.match(/<div class="verse">/g) || []).length;
  if (cards !== authored.stanzas.length) out.push(`${cards} stanza cards on the page, ${authored.stanzas.length} authored`);

  // ---- 4. page identity and harmony
  const id = (html.match(/id: '([^']+)'/) || [])[1];
  if (id !== `songs-${nn}-${entry.slug}-en`) out.push(`SONG_CHORDS.id is "${id}", file is songs-${nn}-${entry.slug}-en`);

  const prog = (html.match(/progression: '([^']+)'/) || [])[1];
  const key = (html.match(/key: '([^']+)'/) || [])[1];
  if (!prog || !key) out.push('the page declares no key or no progression');
  else {
    let derived = null;
    try { derived = deriveKey(prog, `song ${entry.n}`); } catch (e) { out.push(e.message); }
    if (derived && key !== derived) out.push(`declares key ${key} over a grid in ${derived} ("${prog}")`);
    if (prog !== authored.progression) out.push(`page grid "${prog}" is not the authored grid "${authored.progression}"`);
  }

  // ---- 5. the provenance line, which is the licence claim the page makes
  if (!html.includes(source.heVersion)) out.push(`the page does not name its edition (${source.heVersion})`);
  if (!html.includes(source.heLicense)) out.push(`the page does not name its licence (${source.heLicense})`);

  return out;
}

function load(entry) {
  return {
    html: readFileSync(pagePath(entry), 'utf8'),
    source: JSON.parse(readFileSync(srcPath(entry), 'utf8')),
    authored: JSON.parse(readFileSync(authPath(entry), 'utf8'))
  };
}

function run(list) {
  let failed = 0, words = 0;
  for (const entry of list) {
    const { html, source, authored } = load(entry);
    words += wordCells(html).length;
    const errs = checkSong(entry, html, source, authored);
    for (const e of errs) { console.log(`FAIL song ${entry.n} (${entry.slug}): ${e}`); failed++; }
  }
  console.log(`\n${list.length}/${list.length} pages checked, ${words} word cells compared, ${failed} failures`);
  return failed;
}

/* ------------------------------------------------------------------ self-test
 * Each defect is injected into a page that passes, and every one must turn this
 * file red. Two of them are classes that actually shipped elsewhere in this
 * repository: a hard-coded key, and text lifted from one page onto another. */
const DEFECTS = [
  { what: 'one niqqud mark dropped from a word cell',
    hit: h => h.replace(/(<div class="word"><div class="he">)([^<]*)/, (m, a, b) => a + b.replace(/[֑-ׇ]/, '')) },
  { what: 'a word cell replaced by a lookalike final form',
    hit: h => h.replace(/(<div class="word"><div class="he">[^<]*)מ/, '$1ם') },
  { what: 'a word cell silently deleted',
    hit: h => h.replace(/<div class="word"><div class="he">[^<]*<\/div><div class="tr">[^<]*<\/div><div class="fr">[^<]*<\/div><\/div>/, '') },
  { what: 'the full-line block disagrees with the word cells',
    hit: h => h.replace(/(<div class="verse-full">)([^<]*)/, (m, a, b) => a + b.replace(/[֑-ׇ]/, '')) },
  { what: 'a whole stanza card removed',
    hit: h => h.replace(/<!-- STANZA \d+ -->[\s\S]*?<\/div>\n\n<!-- STANZA/, '<!-- STANZA') },
  { what: 'LIVED elsewhere: the key is a literal Am over a grid in another key',
    hit: h => h.replace(/key: '[^']+'/, "key: 'Am'") },
  { what: 'the page grid no longer matches the authored one',
    hit: h => h.replace(/progression: '[^']+'/, "progression: '| F F | Bb F | C C | F F |'") },
  { what: 'SONG_CHORDS.id points at another page',
    hit: h => h.replace(/id: '[^']+'/, "id: 'songs-001-hatikvah-en'") },
  { what: 'the provenance line loses its edition',
    hit: h => h.replace(/Daat Siddur Ashkenaz|The Metsudah siddur, 1981|Pesach Haggadah|Miqra according to the Masorah|The Metsudah Siddur, Metsudah Publications, 1981 - HE/g, 'Some Other Edition') }
];

function selfTest() {
  /* Song 17 on purpose: its grid is in Am, so the injected-key defect would be
     GREEN there and prove nothing. Pick one whose grid is not Am. */
  const entry = REGISTRY.find(s => {
    if (!existsSync(pagePath(s)) || !existsSync(authPath(s))) return false;
    const a = JSON.parse(readFileSync(authPath(s), 'utf8'));
    return a.progression && !/^\|\s*Am/.test(a.progression) && a.stanzas.length > 2;
  });
  if (!entry) { console.log('no suitable song for the self-test'); process.exit(1); }

  const { html, source, authored } = load(entry);
  const clean = checkSong(entry, html, source, authored);
  console.log(`baseline: song ${entry.n} (${entry.slug}), grid ${authored.progression}, ${clean.length} findings`);
  for (const e of clean) console.log('  unexpected FAIL  ' + e);

  let caught = 0;
  for (const d of DEFECTS) {
    const broken = d.hit(html);
    if (broken === html) { console.log(`NOT INJECTED, pattern missed: ${d.what}`); continue; }
    let bad;
    try { bad = checkSong(entry, broken, source, authored).length; }
    catch { bad = 1; }
    if (bad > clean.length) { console.log(`red   ${d.what}`); caught++; }
    else console.log(`GREEN, and should not be: ${d.what}`);
  }
  console.log(`\n${caught}/${DEFECTS.length} injected defects rejected`);
  if (clean.length || caught < DEFECTS.length) process.exit(1);
}

const args = process.argv.slice(2);
const built = REGISTRY.filter(e => existsSync(pagePath(e)) && existsSync(authPath(e)));

if (args.includes('--self-test')) selfTest();
else {
  const named = args.filter(a => /^\d+$/.test(a)).map(Number);
  const list = named.length ? built.filter(e => named.includes(e.n)) : built;
  if (!list.length) { console.error('no built song pages to check'); process.exit(1); }
  process.exit(run(list) ? 1 : 0);
}
