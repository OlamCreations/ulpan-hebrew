/* tehilim-page-check.mjs — check the parts of a psalm page that are NOT the psalm.
 *
 * tehilim-hebrew-check.mjs reads the word cells, the verse-full block and the
 * verse count. It is thorough about the text and blind to everything around it,
 * which is exactly where the two defects this file exists for were living, in
 * plain sight, across every page:
 *
 *   - the footer read "Tehilim 1 · אַשְׁרֵי הָאִישׁ" on all 140 built pages,
 *     because the incipit of psalm 1 had been typed into the shared template;
 *   - window.SONG_CHORDS.key read 'Am' on all of them, while 126 grids were in
 *     Dm, Em, C, G, D or F. songKey() in assets/chords.js feeds that field to the
 *     shuffle generator, so shuffle answered in the wrong scale.
 *
 * Neither is a Hebrew error and neither is a build error: both files were valid,
 * every test was green, and the pages shipped. The lesson is not "add a check",
 * it is that a check only sees the thing it was pointed at, so this one is
 * pointed at the page furniture: the footer, the chord declaration, the page
 * identity. Everything it compares is read back off the HTML on disk, never from
 * the builder's output in memory, so a hand-edited page disagrees with its source.
 *
 * Usage:
 *   node tools/tehilim-page-check.mjs             # every psalm page
 *   node tools/tehilim-page-check.mjs 12 23       # named psalms
 *   node tools/tehilim-page-check.mjs --self-test
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chordsOf, rootOf, deriveKey } from './chord-key.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CONV = JSON.parse(readFileSync(join(ROOT, 'data', 'tehilim-conventions.json'), 'utf8'));

/* The same tolerance tehilim-hebrew-check.mjs applies, read from the same config
   and re-implemented in four lines rather than imported. That is deliberate: two
   checks that share a helper share its bugs, and this one exists precisely to see
   what the other one could not. */
const LEGACY = CONV.legacyEdition || { psalms: [], ignoreMarks: [], foldPairs: [], foldWords: [] };
const LEGACY_PSALMS = LEGACY.psalms || [];
function editionFold(s) {
  let out = String(s).normalize('NFC');
  for (const m of LEGACY.ignoreMarks || []) out = out.split(m).join('');
  for (const [a, b] of LEGACY.foldPairs || []) out = out.split(a).join(b);
  for (const [a, b] of LEGACY.foldWords || []) out = out.split(a).join(b);
  return out;
}

const pagePath = n => join(ROOT, 'liturgy', `tehilim-${String(n).padStart(3, '0')}-en.html`);
const srcPath  = n => join(ROOT, 'content', 'tehilim', 'source', `${String(n).padStart(3, '0')}.json`);

/* Every field is pulled with its own pattern rather than one big one, so a
   missing field reports as missing instead of silently shifting the capture
   groups of the fields after it. */
const grab = (html, re, what, psalm) => {
  const m = html.match(re);
  if (!m) throw new Error(`psalm ${psalm}: could not find ${what} on the page`);
  return m[1];
};

/**
 * Every invariant for one page, as {ok, why} rows. Exported so the self-test can
 * run it over deliberately damaged HTML instead of re-implementing the rules —
 * a self-test that re-implements what it checks proves only that it agrees with
 * itself.
 */
export function checkPage(psalm, html, source) {
  const nn = String(psalm).padStart(3, '0');
  const rows = [];
  const add = (ok, why) => rows.push({ ok, why });

  // ---- identity: the page knows which psalm it is, in all three places
  const footerN = grab(html, /<footer>Tehilim (\d+) /, 'the footer psalm number', psalm);
  add(footerN === String(psalm), `footer says psalm ${footerN}, file is psalm ${psalm}`);

  const h1N = grab(html, /<h1>Tehilim (\d+):/, 'the h1 psalm number', psalm);
  add(h1N === String(psalm), `h1 says psalm ${h1N}, file is psalm ${psalm}`);

  const id = grab(html, /id: '([^']+)'/, 'the SONG_CHORDS id', psalm);
  add(id === `tehilim-${nn}-en`, `SONG_CHORDS.id is "${id}", file is tehilim-${nn}-en`);

  // ---- the footer incipit is THIS psalm's opening words, taken from the source
  /* Compared on raw codepoints. Normalising would let an NFD footer pass against
     an NFC source, and niqqud that differs only in composition looks identical. */
  const footerHe = grab(html, /<footer>Tehilim \d+ · ([^·]+?) · /, 'the footer incipit', psalm).trim();

  if (LEGACY_PSALMS.includes(psalm)) {
    /* Psalms 1 to 10 predate the builder: their footer was typed per page, from a
       different printed edition, and follows no fixed word count — psalm 8 and 9
       skip the superscription and open at verse 2, psalm 10 runs to three words.
       Holding them permanently red would train everyone to ignore this file, and
       exempting them outright would let psalm 1's incipit sit on psalm 8 unseen,
       which is the defect. So the rule is loosened, not dropped: the incipit must
       still be a contiguous run of words from THIS psalm's opening, and only the
       word count and the edition's diacritics are forgiven. */
    const opening = source.verses.slice(0, 2).flatMap(v => v.words.map(w => w.he));
    const hay = ' ' + opening.map(editionFold).join(' ') + ' ';
    const needle = ' ' + footerHe.split(/\s+/).map(editionFold).join(' ') + ' ';
    add(hay.includes(needle), `footer incipit "${footerHe}" is not a run of words from psalm ${psalm}`);
  } else {
    const wanted = source.verses[0].words
      .slice(0, CONV.page.titleWordCount)
      .map(w => w.he)
      .join(' ');
    add(footerHe === wanted, `footer incipit is "${footerHe}", source opens "${wanted}"`);
  }

  // ---- harmony: the declared key is the key of the declared grid
  const prog = grab(html, /progression: '([^']+)'/, 'the progression', psalm);
  const key = grab(html, /key: '([^']+)'/, 'the key', psalm);
  const chords = chordsOf(prog);
  add(chords.length > 0, `progression "${prog}" holds no chords`);
  add(chords.every(c => rootOf(c) !== null), `progression "${prog}" holds a symbol that is not a chord`);

  let derived = null;
  try { derived = deriveKey(prog, `psalm ${psalm}`); }
  catch (e) { add(false, e.message); }
  if (derived) add(key === derived, `declares key ${key} over a grid in ${derived} ("${prog}")`);

  const tempo = Number(grab(html, /tempo: (\d+)/, 'the tempo', psalm));
  add(Number.isFinite(tempo) && tempo >= 30 && tempo <= 240, `tempo ${tempo} is outside 30-240 BPM`);

  return rows;
}

function psalmsOnDisk() {
  const out = [];
  for (let n = 1; n <= 150; n++) if (existsSync(pagePath(n)) && existsSync(srcPath(n))) out.push(n);
  return out;
}

function run(list) {
  let failed = 0, checks = 0;
  for (const n of list) {
    const html = readFileSync(pagePath(n), 'utf8');
    const source = JSON.parse(readFileSync(srcPath(n), 'utf8'));
    let rows;
    try { rows = checkPage(n, html, source); }
    catch (e) { console.log(`FAIL psalm ${n}: ${e.message}`); failed++; continue; }
    checks += rows.length;
    for (const r of rows) if (!r.ok) { console.log(`FAIL psalm ${n}: ${r.why}`); failed++; }
  }
  console.log(`\n${list.length} pages, ${checks} checks, ${failed} failures`);
  return failed;
}

/* ------------------------------------------------------------------ self-test
 * A check that has never been red is indistinguishable from no check. Each
 * defect below is one of the real ones, or a near neighbour of it, injected into
 * a page that passes; every one must turn this file red. The two marked LIVED
 * are verbatim what shipped. */
const DEFECTS = [
  { what: 'LIVED: the footer carries psalm 1\'s incipit on every page',
    hit: h => h.replace(/<footer>Tehilim \d+ · [^·]+ · /, '<footer>Tehilim 1 · אַשְׁרֵי הָאִישׁ · ') },
  { what: 'LIVED: key is a literal Am over a grid in another key',
    hit: h => h.replace(/key: '[^']+'/, "key: 'Am'") },
  { what: 'the footer names a different psalm number',
    hit: h => h.replace(/<footer>Tehilim \d+ /, '<footer>Tehilim 999 ') },
  { what: 'the h1 names a different psalm number',
    hit: h => h.replace(/<h1>Tehilim \d+:/, '<h1>Tehilim 999:') },
  { what: 'SONG_CHORDS.id points at another page',
    hit: h => h.replace(/id: '[^']+'/, "id: 'tehilim-001-en'") },
  { what: 'one niqqud mark dropped from the footer incipit',
    hit: h => h.replace(/(<footer>Tehilim \d+ · )([^·]+)/, (m, a, b) => a + b.replace(/[֑-ׇ]/, '')) },
  { what: 'the grid is transposed but the key is left behind',
    hit: h => h.replace(/progression: '[^']+'/, "progression: '| F F | Bb F | C C | F F |'") },
  { what: 'the tempo is nonsense',
    hit: h => h.replace(/tempo: \d+/, 'tempo: 9') }
];

function selfTest() {
  /* Psalm 12 on purpose: its grid is in Dm, so the "key is a literal Am" defect
     is actually a defect there. Injecting it into an Am psalm would be green and
     would prove nothing, which is how the bug survived in the first place. */
  const n = 12;
  const html = readFileSync(pagePath(n), 'utf8');
  const source = JSON.parse(readFileSync(srcPath(n), 'utf8'));

  const clean = checkPage(n, html, source);
  const cleanBad = clean.filter(r => !r.ok);
  console.log(`baseline psalm ${n}: ${clean.length - cleanBad.length}/${clean.length} checks pass`);
  for (const r of cleanBad) console.log('  unexpected FAIL  ' + r.why);

  let caught = 0;
  for (const d of DEFECTS) {
    const broken = d.hit(html);
    if (broken === html) { console.log(`NOT INJECTED, pattern missed: ${d.what}`); continue; }
    let bad;
    try { bad = checkPage(n, broken, source).filter(r => !r.ok).length; }
    catch { bad = 1; }          // a defect that makes a field unfindable is caught too
    if (bad > cleanBad.length) { console.log(`red   ${d.what}`); caught++; }
    else console.log(`GREEN, and should not be: ${d.what}`);
  }
  /* The loosened rule for psalms 1 to 10 is the part most likely to be loosened
     into uselessness, so it gets its own injection on a legacy page. Psalm 8 is
     the awkward one: its own footer opens at verse 2, so it exercises the
     tolerance, and it must still reject psalm 1's incipit. */
  const L = 8;
  const lHtml = readFileSync(pagePath(L), 'utf8');
  const lSrc = JSON.parse(readFileSync(srcPath(L), 'utf8'));
  const lClean = checkPage(L, lHtml, lSrc).filter(r => !r.ok).length;
  const lBroken = lHtml.replace(/<footer>Tehilim \d+ · [^·]+ · /, '<footer>Tehilim 8 · אַשְׁרֵי הָאִישׁ · ');
  const lBad = checkPage(L, lBroken, lSrc).filter(r => !r.ok).length;
  const legacyOk = lClean === 0 && lBad > 0;
  console.log(legacyOk
    ? `red   legacy tolerance still rejects a foreign incipit on psalm ${L}`
    : `GREEN, and should not be: legacy tolerance on psalm ${L} (clean=${lClean}, broken=${lBad})`);

  console.log(`\n${caught}/${DEFECTS.length} injected defects rejected, legacy tolerance ${legacyOk ? 'holds' : 'FAILED'}`);
  if (cleanBad.length || caught < DEFECTS.length || !legacyOk) process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else {
  const named = args.filter(a => /^\d+$/.test(a)).map(Number);
  process.exit(run(named.length ? named : psalmsOnDisk()) ? 1 : 0);
}
