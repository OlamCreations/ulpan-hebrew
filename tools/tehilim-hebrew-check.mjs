/* tehilim-hebrew-check.mjs — read the Hebrew back off the shipped pages and
 * compare it, codepoint for codepoint, with the Masoretic source.
 *
 * The build derives every Hebrew character from content/tehilim/source/NNN.json,
 * so the pages match "by construction". That is exactly the kind of guarantee
 * that cannot fail, and a check that cannot fail is indistinguishable from no
 * check: a bad slice index, a stray replace, an editor normalising niqqud, or a
 * page hand-edited after the fact would all pass unnoticed. This reads the HTML
 * on disk, not the builder's output in memory, so the two can disagree.
 *
 * Three things are compared, because they can drift apart from each other:
 *   1. the word cells, in document order, against the source word list
 *   2. the verse-full block, whose lines are the stichs joined
 *   3. the count of verses actually present on the page
 *
 * Comparison is on raw codepoints with no Unicode normalisation. NFC and NFD
 * niqqud look identical in a browser and are different text; normalising here
 * would hide the one class of corruption this file exists to catch.
 *
 * Usage:
 *   node tools/tehilim-hebrew-check.mjs            # every built page
 *   node tools/tehilim-hebrew-check.mjs 23 119     # named psalms
 *   node tools/tehilim-hebrew-check.mjs --self-test
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const CONV = JSON.parse(readFileSync(join(ROOT, 'data', 'tehilim-conventions.json'), 'utf8'));
const LEGACY = CONV.legacyEdition || { psalms: [], ignoreMarks: [], foldPairs: [], foldWords: [] };

/* Psalms 1 to 10 predate the pipeline and follow a different printed edition.
   Their differences were measured, not assumed: meteg, the qamats qatan MAM
   marks separately, and the holam on the he of the divine name. None of them
   changes a consonant or a reading. Holding those ten pages permanently red
   would train everyone to ignore this check, so the exemption is named in
   config and kept narrow, and the self-test proves a real error on a legacy
   page still fails. */
function editionFold(s, psalm) {
  if (!LEGACY.psalms.includes(psalm)) return s;
  /* Marks come off first. A meteg sitting inside the divine name stops the
     word-level fold from matching, which is how psalm 5 stayed red after the
     tolerance was added: the two rules were correct and their order was not. */
  let out = s.normalize('NFC');
  for (const m of LEGACY.ignoreMarks || []) out = out.split(m).join('');
  for (const [a, b] of LEGACY.foldPairs || []) out = out.split(a).join(b);
  for (const [a, b] of LEGACY.foldWords || []) out = out.split(a).join(b);
  return out;
}

/** Codepoints, so a mismatch report names the character instead of showing two
 *  strings that print the same. */
const cps = s => [...s].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');

function firstDiff(a, b) {
  const A = [...a], B = [...b];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) return `at char ${i}: page has ${A[i] ? cps(A[i]) : '(end)'}, source has ${B[i] ? cps(B[i]) : '(end)'}`;
  }
  return 'lengths differ';
}

/** Split a page into its verse blocks.
 *
 *  The builder emits one `<!-- VERSE n -->` marker per verse. Psalms 1 to 10
 *  predate the builder and were written by hand: same markup, no marker. Keying
 *  only off the marker would silently report "0 verses" on exactly the ten pages
 *  whose Hebrew has never been machine-checked, so the fallback reads the
 *  verse-num span instead. A checker that can only read its own output is a
 *  mirror, not a check. */
export function verseBlocks(html) {
  const marks = [...html.matchAll(/<!-- VERSE (\d+) -->/g)].map(m => ({ n: Number(m[1]), index: m.index }));
  const found = marks.length
    ? marks
    : [...html.matchAll(/<span class="verse-num">\s*(\d+)/g)].map(m => ({ n: Number(m[1]), index: m.index }));

  return found.map((m, i) => ({
    n: m.n,
    html: html.slice(m.index, i + 1 < found.length ? found[i + 1].index : html.length)
  }));
}

export function checkPsalm(n) {
  const nn = String(n).padStart(3, '0');
  const pagePath = join(ROOT, 'liturgy', `tehilim-${nn}-en.html`);
  const srcPath = join(ROOT, 'content', 'tehilim', 'source', `${nn}.json`);
  const errs = [];

  if (!existsSync(pagePath)) return [`psalm ${n}: no built page`];
  if (!existsSync(srcPath)) return [`psalm ${n}: no source text`];

  const html = readFileSync(pagePath, 'utf8');
  const src = JSON.parse(readFileSync(srcPath, 'utf8'));
  const blocks = verseBlocks(html);
  let tolerated = 0;

  if (blocks.length !== src.verses.length) {
    errs.push(`psalm ${n}: page has ${blocks.length} verses, the source has ${src.verses.length}`);
  }

  for (const sv of src.verses) {
    const block = blocks.find(b => b.n === sv.n);
    if (!block) { errs.push(`psalm ${n}.${sv.n}: verse absent from the page`); continue; }

    // 1. word cells, in document order
    const shipped = [...block.html.matchAll(/<div class="word"><div class="he">([^<]*)<\/div>/g)].map(m => unesc(m[1]));
    const expect = sv.words.map(w => w.he);
    if (shipped.length !== expect.length) {
      errs.push(`psalm ${n}.${sv.n}: ${shipped.length} word cells on the page, ${expect.length} words in the source`);
    }
    for (let i = 0; i < Math.min(shipped.length, expect.length); i++) {
      if (shipped[i] === expect[i]) continue;
      if (editionFold(shipped[i], n) === editionFold(expect[i], n)) { tolerated++; continue; }
      errs.push(`psalm ${n}.${sv.n}: word ${i} differs, ${firstDiff(shipped[i], expect[i])}`);
      break; // one report per verse is enough to send someone to the file
    }

    // 2. the full-verse block is the same words, re-joined
    const full = block.html.match(/<div class="verse-full">([\s\S]*?)<\/div>/);
    if (!full) { errs.push(`psalm ${n}.${sv.n}: no verse-full block`); continue; }
    const fullWords = unesc(full[1]).split(/<br>|\s+/).map(s => s.trim()).filter(Boolean);
    if (editionFold(fullWords.join(' '), n) !== editionFold(expect.join(' '), n)) {
      errs.push(`psalm ${n}.${sv.n}: the full-verse line is not the word list rejoined (${fullWords.length} vs ${expect.length} words)`);
    }
  }

  editionTolerated.set(n, tolerated);
  return errs;
}

/** Words that only matched because of the legacy-edition tolerance. Printed by
 *  the CLI: an exemption nobody can see is an exemption that quietly widens. */
export const editionTolerated = new Map();

// ------------------------------------------------------- injected defects
/* A green run proves nothing unless the same code goes red on a page that is
   actually wrong. Each defect mutates a real shipped page in memory and the
   check must reject it. */
const DEFECTS = [
  { what: 'a single niqqud mark dropped from one word',
    break: h => h.replace(/(<div class="word"><div class="he">)([^<]*)/, (m, a, w) => a + [...w].filter(c => !/[֑-ׇ]/.test(c)).join('')) },
  { what: 'two adjacent words swapped',
    break: h => { const re = /(<div class="word"><div class="he">)([^<]*)(<\/div>[\s\S]*?<div class="word"><div class="he">)([^<]*)/;
                  return h.replace(re, (m, a, w1, mid, w2) => a + w2 + mid + w1); } },
  { what: 'a word cell deleted outright',
    break: h => h.replace(/<div class="word">[\s\S]*?<\/div><\/div>\n?/, '') },
  { what: 'a whole verse removed',
    break: h => { const b = verseBlocks(h); return b.length > 1 ? h.replace(b[1].html, '') : h; } },
  { what: 'the full-verse line disagrees with the word cells',
    break: h => h.replace(/<div class="verse-full">([\s\S]*?)<\/div>/, (m, t) => `<div class="verse-full">${t.split(/\s+/).slice(0, -1).join(' ')}</div>`) },
  { what: 'NFD niqqud where the source is NFC (invisible in a browser)',
    break: h => h.replace(/(<div class="word"><div class="he">)([^<]*)/, (m, a, w) => a + w.normalize('NFD')) },
  { what: 'a Hebrew letter replaced by its lookalike final form',
    break: h => h.replace(/(<div class="word"><div class="he">)([^<]*)/, (m, a, w) => a + w.replace(/מ/, 'ם').replace(/נ/, 'ן')) }
];

function selfTest() {
  const built = readdirSync(join(ROOT, 'liturgy')).filter(f => /^tehilim-\d{3}-en\.html$/.test(f)).sort();
  if (!built.length) { console.error('no built pages to test against'); process.exit(1); }

  // A page that is genuinely fine, so a red below is the defect and not the page.
  // Not simply the first page: psalms 1 to 10 predate this pipeline and have no
  // source to compare against, so they cannot serve as the reference.
  // Not a legacy page either: the edition tolerance legitimately absorbs two of
  // the mutations below, so the full matrix belongs on a pipeline page. The
  // legacy pages get their own, narrower matrix afterwards.
  const refFile = built.find(f => { const n = parseInt(f.slice(8, 11), 10);
    return !LEGACY.psalms.includes(n) && checkPsalm(n).length === 0; });
  if (!refFile) { console.log('self-test cannot run: no page currently passes, so a red proves nothing'); process.exit(1); }
  const nRef = parseInt(refFile.slice(8, 11), 10);

  const pagePath = join(ROOT, 'liturgy', refFile);
  const original = readFileSync(pagePath, 'utf8');
  const srcPath = join(ROOT, 'content', 'tehilim', 'source', `${String(nRef).padStart(3, '0')}.json`);
  const src = JSON.parse(readFileSync(srcPath, 'utf8'));

  /* Run the same comparison against a mutated copy without writing to disk: a
     self-test that edits a shipped page and restores it can leave the repo
     corrupted if it throws in between. */
  const checkString = html => {
    const errs = [];
    const blocks = verseBlocks(html);
    if (blocks.length !== src.verses.length) errs.push('verse count');
    for (const sv of src.verses) {
      const block = blocks.find(b => b.n === sv.n);
      if (!block) { errs.push(`verse ${sv.n} absent`); continue; }
      const shipped = [...block.html.matchAll(/<div class="word"><div class="he">([^<]*)<\/div>/g)].map(m => unesc(m[1]));
      const expect = sv.words.map(w => w.he);
      if (shipped.length !== expect.length) errs.push(`verse ${sv.n} word count`);
      for (let i = 0; i < Math.min(shipped.length, expect.length); i++) if (shipped[i] !== expect[i]) { errs.push(`verse ${sv.n} word ${i}`); break; }
      const full = block.html.match(/<div class="verse-full">([\s\S]*?)<\/div>/);
      if (!full) { errs.push(`verse ${sv.n} no full block`); continue; }
      const fw = unesc(full[1]).split(/<br>|\s+/).map(s => s.trim()).filter(Boolean);
      if (fw.join(' ') !== expect.join(' ')) errs.push(`verse ${sv.n} full line`);
    }
    return errs;
  };

  if (checkString(original).length) { console.log('self-test harness disagrees with checkPsalm on a clean page'); process.exit(1); }

  let caught = 0;
  for (const d of DEFECTS) {
    const mutated = d.break(original);
    if (mutated === original) { console.log(`SKIP (defect did not apply) ${d.what}`); continue; }
    const errs = checkString(mutated);
    if (errs.length) { console.log(`red  ${d.what}`); caught++; }
    else console.log(`GREEN, and should not be: ${d.what}`);
  }
  console.log(`\n${caught}/${DEFECTS.length} injected defects rejected (reference page: psalm ${nRef})`);

  /* The legacy tolerance is the part of this file most likely to rot into a
     blanket pass. These four mutations are errors no edition explains, on a page
     the tolerance applies to; if any goes green the exemption has widened past
     what was measured. */
  const legacyN = LEGACY.psalms.find(p => existsSync(join(ROOT, 'liturgy', `tehilim-${String(p).padStart(3, '0')}-en.html`)) && checkPsalm(p).length === 0);
  let legacyCaught = 0, legacyTotal = 0;
  if (legacyN == null) {
    console.log('\nno legacy page available to test the edition tolerance against');
  } else {
    const lPath = join(ROOT, 'liturgy', `tehilim-${String(legacyN).padStart(3, '0')}-en.html`);
    const lOrig = readFileSync(lPath, 'utf8');
    const structural = DEFECTS.filter(d => !/NFD|niqqud mark dropped/.test(d.what));
    legacyTotal = structural.length;
    console.log(`\nedition tolerance, on legacy psalm ${legacyN}:`);
    for (const d of structural) {
      const mutated = d.break(lOrig);
      if (mutated === lOrig) { console.log(`  SKIP  ${d.what}`); legacyTotal--; continue; }
      // Compare the mutated page against the same source the checker uses.
      const tmp = join(ROOT, 'liturgy', `tehilim-${String(legacyN).padStart(3, '0')}-en.html`);
      const before = readFileSync(tmp, 'utf8');
      let errs;
      try { writeFileSync(tmp, mutated, 'utf8'); errs = checkPsalm(legacyN); }
      finally { writeFileSync(tmp, before, 'utf8'); }
      if (errs.length) { console.log(`  red   ${d.what}`); legacyCaught++; }
      else console.log(`  GREEN, and should not be: ${d.what}`);
    }
    console.log(`  ${legacyCaught}/${legacyTotal} rejected through the tolerance`);
    if (readFileSync(lPath, 'utf8') !== lOrig) { console.log('  the legacy page was left modified'); process.exit(1); }
  }

  if (caught < DEFECTS.length || legacyCaught < legacyTotal) process.exit(1);
}

// -------------------------------------------------------------- cli
const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest();
} else {
  let list = args.filter(a => /^\d+$/.test(a)).map(Number);
  if (!list.length) {
    list = readdirSync(join(ROOT, 'liturgy'))
      .filter(f => /^tehilim-\d{3}-en\.html$/.test(f))
      .map(f => parseInt(f.slice(8, 11), 10)).sort((a, b) => a - b);
  }
  let bad = 0, words = 0;
  for (const n of list) {
    const errs = checkPsalm(n);
    const nn = String(n).padStart(3, '0');
    const srcPath = join(ROOT, 'content', 'tehilim', 'source', `${nn}.json`);
    if (existsSync(srcPath)) words += JSON.parse(readFileSync(srcPath, 'utf8')).verses.reduce((a, v) => a + v.words.length, 0);
    if (errs.length) { bad++; console.log(`FAIL psalm ${n}`); errs.slice(0, 5).forEach(e => console.log('   ' + e)); }
  }
  const tol = [...editionTolerated.entries()].filter(([, c]) => c > 0);
  console.log(`\n${list.length - bad}/${list.length} pages match the Masoretic source, ${words} words compared`);
  if (tol.length) {
    const total = tol.reduce((a, [, c]) => a + c, 0);
    console.log(`${total} words matched only through the legacy-edition tolerance, on psalms ${tol.map(([p]) => p).join(', ')}`);
    console.log('  (meteg, qamats qatan, divine-name spelling; see legacyEdition in data/tehilim-conventions.json)');
  }
  if (bad) process.exit(1);
}
