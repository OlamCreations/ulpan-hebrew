/* hebrew-clean.mjs — turn an edition's Hebrew into what a learner reads, and
 * prove it did.
 *
 * WHY THIS FILE EXISTS, precisely. The rule it holds was written twice, once in
 * tools/tehilim-scaffold.mjs and once, by copy, in tools/songs-scaffold.mjs. The
 * two lines rendered IDENTICALLY on screen and were not the same rule:
 *
 *     psalms   [ U+0591 - U+05AF ] U+05BD U+05C0 U+05C3 U+05C6     accents, plus meteg
 *     songs    [ U+0591 - U+05BD ] U+05AF U+05C0 U+05C3 U+05C6     accents THROUGH meteg
 *
 * A character class is a bidirectional run of Hebrew marks, so copying it let the
 * renderer's reordering swap U+05AF and U+05BD. The range then swallowed
 * U+05B0-U+05BC — every vowel point in the language. The songs scaffold happily
 * fetched, cleaned and pinned 22 unvocalized songs, and the only reason anyone
 * noticed is that an unrelated counter said "glosses pre-filled: 0/2723", because
 * a glossary keyed on vocalized forms cannot match a word with no vowels.
 *
 * The fix is not "write it carefully this time". Two people wrote it carefully
 * and one of them was wrong in a way reading cannot catch. The fix is one
 * definition, in one place, with a self-test that fails if any vowel point ever
 * goes missing again.
 *
 * A word on what does NOT protect these lines: writing the character classes as
 * \u escapes. That is the obvious idea and it was tried; every route through a
 * shell or an editor turned the escapes back into the literal characters they
 * denote, and an earlier version of this header claimed the protection anyway.
 * The classes below are literal Hebrew, they are therefore still reorderable by
 * a careless copy, and the ONLY thing standing between that and a shipped page
 * is the self-test at the bottom, which asserts each of the sixteen vowel points
 * individually. Run it; do not trust the way this file looks.
 *
 *   node tools/hebrew-clean.mjs --self-test
 */

/* Cantillation (te'amim) U+0591-U+05AF, plus meteg U+05BD, paseq U+05C0,
   sof pasuk U+05C3 and nun hafukha U+05C6. These are a reading edition's
   apparatus: meaningless to a learner sounding a word out, and translit.js
   expects vowels only.

   THE ENDPOINT OF THE RANGE IS THE WHOLE BUG. U+05AF is the last accent and
   U+05B0 is the first vowel, so a range ending one codepoint late eats sheva
   and everything after it. The self-test exists for this line specifically. */
const CANTILLATION = /[֑-ֽ֯׀׃׆]/g;

/* Vowel points, which must SURVIVE: sheva through dagesh/mappiq U+05B0-U+05BC,
   sin/shin dots U+05C1-U+05C2, qamats qatan U+05C7. Never removed; named here so
   the self-test can assert every one of them individually. */
const NIQQUD = [
  0x05B0, 0x05B1, 0x05B2, 0x05B3, 0x05B4, 0x05B5, 0x05B6, 0x05B7,
  0x05B8, 0x05B9, 0x05BA, 0x05BB, 0x05BC, 0x05C1, 0x05C2, 0x05C7
];

/* The maqaf joins two words into one printed unit. Each side is its own word
   cell on the page, so it becomes a space. BOTH forms: MAM writes U+05BE, Daat
   Siddur Ashkenaz writes an ASCII hyphen. Handling only the Hebrew one left
   עַד-אָנָה as a single cell whose transliteration ran the two words together. */
const MAQAF = /[־-]/g;

/* Directional marks. Invisible, and they end up inside a word cell where they
   change nothing on screen and everything in a codepoint comparison. */
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

/* Does this line carry any vowel point? Used by the song scaffold two ways:
   to reject a whole edition that is unpointed, and to tell a sung line from
   an editorial one (colophons and rubrics are never pointed in these
   editions, sung lines always are). */
const NIQQUD_RE = /[ְ-ׇּׁׂ]/;
export const hasNiqqud = s => NIQQUD_RE.test(String(s || ''));

/* nun-alef, straight or Hebrew double quote: the siddur abbreviation for
   nusach acher, "another version reads". It introduces a variant of the word
   just sung, and printing it would show the singer two readings of one line. */
const VARIANT_MARKER = /^נ["״]א$/;
export const isVariantMarker = w => VARIANT_MARKER.test(String(w || ''));

/** Scribal paragraph marks {פ} petucha and {ס} setuma: layout, not language. */
export const stripParagraphMarks = s => String(s || '').replace(/\{[פסש]\}/g, ' ');

/** One physical line of an edition, as a learner should see it. */
export function cleanLine(s) {
  return stripParagraphMarks(s)
    .replace(CANTILLATION, '')
    .replace(MAQAF, ' ')
    .replace(BIDI, '')
    .replace(/[.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------------ self-test
const cps = x => [...x].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');

function selfTest() {
  let bad = 0;
  const fail = (what, got, want) => { bad++; console.log(`FAIL  ${what}\n        got  ${cps(got)}\n        want ${cps(want)}`); };

  /* Every vowel point, one at a time, on a carrier letter. A range that has crept
     one codepoint too far shows up here as exactly one missing mark, which is the
     defect this file was written for and is invisible in a rendered string. */
  let survived = 0;
  for (const cp of NIQQUD) {
    const carrier = 'ב' + String.fromCodePoint(cp);   // bet + the mark
    const out = cleanLine(carrier);
    if (out === carrier) survived++;
    else fail(`niqqud U+${cp.toString(16).toUpperCase().padStart(4, '0')} was removed`, out, carrier);
  }
  console.log(`${survived}/${NIQQUD.length} vowel points survive cleaning`);

  const CASES = [
    // [ what, input, expected ]
    ['etnachta and meteg go, vowels stay', 'דְּרוֹרֽ֑', 'דְּרוֹר'],
    ['Hebrew maqaf splits two words',      'עַד־אָנָה', 'עַד אָנָה'],
    ['ASCII hyphen splits two words',      'עַד-אָנָה',      'עַד אָנָה'],
    ['sof pasuk removed',                  'בָת׃',                               'בָת'],
    ['bidi mark removed',                  'בָת‏',                               'בָת'],
    ['petucha removed',                    'בָת {פ}',                            'בָת'],
    ['shin dot survives',                  'שָׁ',                                     'שָׁ'],
    ['runs of space collapse',             '  בָ   תָ  ',                        'בָ תָ']
  ];
  let casesOk = 0;
  for (const [what, input, want] of CASES) {
    const got = cleanLine(input);
    if (got === want) casesOk++;
    else fail(what, got, want);
  }
  console.log(`${casesOk}/${CASES.length} cleaning cases pass`);

  /* hasNiqqud decides whether a source line is a sung line or an editorial one,
     and whether a whole edition is usable at all. A range that drifted here would
     not produce a visible error: it would quietly delete real lyrics as though
     they were colophons. Both directions are asserted — every vowel point must be
     seen, and a bare letter, a cantillation mark and an empty string must not be. */
  const nqMissed = NIQQUD.filter(cp => !hasNiqqud('ב' + String.fromCodePoint(cp)));
  const nqFalse = ['ב', 'ב֑', ''].filter(x => hasNiqqud(x));
  if (nqMissed.length || nqFalse.length) {
    bad++;
    console.log(`FAIL  hasNiqqud missed ${nqMissed.length} vowel points and fired on ${nqFalse.length} non-vowels`);
  } else {
    console.log(`hasNiqqud: all ${NIQQUD.length} points seen, silent on bare letter, accent and empty string`);
  }

  const vmCases = [['נ״א', true], ['נ"א', true], ['נְצוֹר', false], ['נא', false], ['', false]];
  const vmBad = vmCases.filter(([w, want]) => isVariantMarker(w) !== want);
  if (vmBad.length) { bad++; console.log(`FAIL  isVariantMarker wrong on ${vmBad.length} of ${vmCases.length} cases`); }
  else console.log(`isVariantMarker: ${vmCases.length}/${vmCases.length}, both quote forms matched, real words rejected`);

  /* The injected defect IS the bug: the class extended by one codepoint, which is
     what the reorder produced. It must be caught, or this file is decoration. */
  const DEFECTS = [
    { what: 'LIVED: the class runs U+0591 through U+05BD and swallows every vowel',
      clean: s => String(s).replace(/[֑-ֽ׀׃׆]/g, '').replace(MAQAF, ' ').replace(/\s+/g, ' ').trim() },
    { what: 'only the Hebrew maqaf is split, the ASCII hyphen is left welded',
      clean: s => String(s).replace(CANTILLATION, '').replace(/־/g, ' ').replace(/\s+/g, ' ').trim() },
    { what: 'cantillation is left in, so translit.js receives accents',
      clean: s => String(s).replace(MAQAF, ' ').replace(/\s+/g, ' ').trim() }
  ];
  let caught = 0;
  for (const d of DEFECTS) {
    const broke = NIQQUD.some(cp => { const c = 'ב' + String.fromCodePoint(cp); return d.clean(c) !== c; })
      || CASES.some(([, input, want]) => d.clean(input) !== want);
    if (broke) { console.log(`red   ${d.what}`); caught++; }
    else console.log(`GREEN, and should not be: ${d.what}`);
  }
  console.log(`\n${caught}/${DEFECTS.length} injected defects rejected`);
  if (bad || caught < DEFECTS.length) process.exit(1);
}

if (process.argv.includes('--self-test')) selfTest();
