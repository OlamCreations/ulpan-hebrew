// Validate translit.js against the curated phrasebook (he = vocalized, tr = human romanization).
// Paths are resolved from this file, not from the shell's cwd, so the test runs the same
// whether it is invoked from the repo root or from tools/.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { transliterate } = require(path.join(ROOT, 'assets', 'translit.js'));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'phrasebook.json'), 'utf8')).phrases;

// normalize for phoneme-level comparison: drop case, hyphens, spaces, apostrophes,
// punctuation; treat kh==ch (same sound, different convention).
// phoneme-level: kh==ch (כ/ח), tz==ts (צ) — both spellings are valid conventions.
const norm = s => (s || '').toLowerCase()
  .replace(/kh/g, 'ch')
  .replace(/tz/g, 'ts')
  .replace(/[^a-z]/g, '');

let ok = 0, bad = [];
for (const p of data) {
  const got = transliterate(p.he);
  if (norm(got) === norm(p.tr)) ok++;
  else bad.push({ he: p.he, want: p.tr, got, nw: norm(p.tr), ng: norm(got) });
}
console.log(`accuracy: ${ok}/${data.length} = ${(100 * ok / data.length).toFixed(1)}%`);
console.log('--- mismatches ---');
for (const b of bad) console.log(`he=${b.he}\n  want=${b.want}  (${b.nw})\n  got =${b.got}  (${b.ng})`);

/*
 * Syllabification + stress accuracy — the defect this file was written to catch after the fact.
 * `norm()` above strips hyphens and case, so a translit.js that never marks a syllable boundary
 * or a stressed syllable still shows 100% on the check above (that IS the bug: the live
 * translator showed the learner no stress at all, and this test could not see it). This block
 * compares the ACTUAL hyphen positions and the ACTUAL capitalized syllable against phrasebook.json's
 * hand-authored `tr` (e.g. "sha-LOM"), per Hebrew word (phrases are split word-for-word, `he` and
 * `tr` always have the same word count — asserted below). `normSyl` only folds the kh/ch and tz/ts
 * spelling-convention differences already accepted elsewhere in this file; it does NOT strip
 * hyphens or case, so it cannot hide a missing or misplaced boundary/stress mark the way the
 * phoneme-level `norm()` above can.
 */
const normSyl = (s) => (s || '').toLowerCase().replace(/kh/g, 'ch').replace(/tz/g, 'ts');
let wordCountMismatch = 0, multiSyl = 0, syllOk = 0, stressOk = 0;
const syllBad = [];
for (const p of data) {
  const heWords = p.he.trim().split(/\s+/).filter(Boolean);
  const trWords = p.tr.trim().split(/\s+/).filter(Boolean);
  if (heWords.length !== trWords.length) { wordCountMismatch++; continue; }
  for (let i = 0; i < heWords.length; i++) {
    const wantSyl = trWords[i].split('-');
    if (wantSyl.length < 2) continue; // monosyllables carry no boundary/stress to check
    multiSyl++;
    const gotSyl = transliterate(heWords[i]).split('-');
    const boundaryMatch = gotSyl.length === wantSyl.length &&
      gotSyl.every((s, idx) => normSyl(s) === normSyl(wantSyl[idx]));
    const wantStress = wantSyl.findIndex((s) => /[A-Z]/.test(s));
    const gotStress = gotSyl.findIndex((s) => /[A-Z]/.test(s));
    if (boundaryMatch) syllOk++;
    if (boundaryMatch && wantStress === gotStress) stressOk++;
    else syllBad.push({ he: heWords[i], want: trWords[i], got: gotSyl.join('-') });
  }
}
console.log(`\nsyllabification + stress over ${multiSyl} multi-syllable words (word-count mismatches: ${wordCountMismatch})`);
console.log(`  syllable-boundary accuracy : ${syllOk}/${multiSyl} = ${(100 * syllOk / multiSyl).toFixed(1)}%`);
console.log(`  stress-position accuracy   : ${stressOk}/${multiSyl} = ${(100 * stressOk / multiSyl).toFixed(1)}%`);
for (const b of syllBad) console.log(`  MISS he=${b.he}  want=${b.want}  got=${b.got}`);
if (wordCountMismatch > 0 || syllOk !== multiSyl || stressOk !== multiSyl) {
  console.error('\nFAIL: syllabification/stress regressed below the measured 100% baseline.');
  process.exit(1);
}

/*
 * cleanDictaForDisplay — the fold we apply to Hebrew shown on screen.
 *
 * It exists because the full normalizeDicta cannot be shown to a user: its qamats/qubuts rules
 * rewrite consonantal double-vav (שָׁווַרְמָה -> שׁוֹוַרְמָה). Two properties keep the display version
 * honest, and both are asserted here rather than asserted in a comment:
 *
 *   1. idempotent — a fold that keeps folding corrupts by degrees
 *   2. a near no-op on Hebrew we have already verified by hand
 *
 * The corpus is every vocalized `he` in the phrasebook, the expressions and all lesson pages.
 */
const { cleanDictaForDisplay } = require(path.join(ROOT, 'assets', 'translit.js'));

const verified = [];
for (const p of data) verified.push(p.he);
try {
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'expressions.json'), 'utf8'));
  for (const e of ex.expressions || []) verified.push(e.he);
} catch (e) { /* expressions.json is generated; skip when absent */ }
const lessonsDir = path.join(ROOT, 'lessons');
for (const f of fs.readdirSync(lessonsDir).filter((x) => x.endsWith('.html'))) {
  const s = fs.readFileSync(path.join(lessonsDir, f), 'utf8');
  for (const m of s.matchAll(/"he"\s*:\s*"([^"]+)"|he:\s*'([^']+)'/g)) {
    const v = m[1] || m[2];
    if (/[֑-ׇ]/.test(v)) verified.push(v);
  }
}

const notIdempotent = verified.filter((h) => cleanDictaForDisplay(cleanDictaForDisplay(h)) !== cleanDictaForDisplay(h));
const rewritten = verified.filter((h) => cleanDictaForDisplay(h) !== h);
// Ceiling, not zero: the fold legitimately repairs Dicta artefacts that got baked into a lesson.
// It is a tripwire — if a future rule starts rewriting verified Hebrew wholesale, this fails.
const CEILING = 10;

console.log(`\ncleanDictaForDisplay over ${verified.length} verified strings`);
console.log(`  idempotent : ${notIdempotent.length === 0 ? 'OK' : 'FAIL on ' + notIdempotent.length}`);
console.log(`  rewrites   : ${rewritten.length} (ceiling ${CEILING})`);
for (const h of rewritten.slice(0, 5)) console.log(`     ${h}  ->  ${cleanDictaForDisplay(h)}`);
if (notIdempotent.length || rewritten.length > CEILING) {
  console.error('\nFAIL: cleanDictaForDisplay is not safe to apply to displayed Hebrew.');
  process.exit(1);
}

/* ---------------------------------------------------------------- convention drift
 * The score above is PHONEME-level on purpose: normSyl folds kh into ch and tz into ts before
 * comparing, because both spell the same sound and the test is about the sound. That is the
 * right call for that test and it leaves a second property unmeasured — WHICH spelling the
 * learner is shown — and nothing else in this repository was measuring it either.
 *
 * It matters because the live translator puts both on one screen. A phrase that hits the
 * phrasebook is shown with the phrasebook's own `tr`; the card under it is transliterated by
 * translit.js. So "sli-KHA" and "sli-CHA", "tsa-RIKH" and "tza-RICH", appear together as if
 * they were different words. Found by tools/translator-invariants.mjs, which derives the
 * transliteration from the Hebrew on the card and had 13 mismatches, every one of them this.
 *
 * The site's scheme is ch/tz — that is what translit.js emits everywhere and what every
 * generated page carries. This counts the verified data that disagrees.
 *
 * The count was held at a ceiling of 35 for a while, which recorded the problem without fixing
 * it. All 35 rows were rewritten on 2026-08-17 by tools/phrasebook-scheme.mjs, which derives the
 * transliteration from each row's own Hebrew and refuses to write it unless the derived form and
 * the human one are the same word — so the rewrite could change spelling and could not change
 * pronunciation. The ceiling is now zero, and zero is the only defensible ceiling: any new row in
 * the old convention is a new contradiction on the learner's screen.
 */
const OFF_SCHEME_CEILING = 0;
const offScheme = [];
for (const p of data) {
  if (!p.tr) continue;
  if (/kh|ts/i.test(p.tr)) offScheme.push(`${p.he}  ->  ${p.tr}`);
}
console.log(`\nconvention: the site writes ch and tz; phrasebook rows written kh or ts`);
console.log(`  off-scheme : ${offScheme.length} of ${data.length} (ceiling ${OFF_SCHEME_CEILING})`);
for (const s of offScheme.slice(0, 5)) console.log(`     ${s}`);
if (offScheme.length > OFF_SCHEME_CEILING) {
  console.error(`\nFAIL: ${offScheme.length} rows use kh/ts where the engine uses ch/tz — the translator will show both spellings side by side.`);
  process.exit(1);
}

/*
 * A final ה that carries a qamats is a consonant (06.10.2026). The engine treated every final ה
 * as a silent mater and kept only its vowel: אָחִיהָ ("her brother") read "achi'a" where pealim
 * prints "achiha", and the whole ־ֶיהָ family ("her …": עָלֶיהָ, אֵלֶיהָ) lost its h. A final ה
 * WITHOUT a vowel stays silent (תּוֹדָה), and a patah under it is the furtive one (גָּבוֹהַ),
 * left as it was.
 */
const FINAL_HE = [
  ['אָחִיהָ', (n) => n === 'achiha'],
  ['עָלֶיהָ', (n) => /ha$/.test(n)],
  ['תּוֹדָה', (n) => n === 'toda'],
  ['גָּבוֹהַ', (n) => !/ha$/.test(n)],
];
const finalHeBad = FINAL_HE.filter(([he, want]) => !want(norm(transliterate(he.normalize('NFC')))));
console.log(`\nfinal he: ${FINAL_HE.length - finalHeBad.length}/${FINAL_HE.length}`);
for (const [he] of finalHeBad) console.log(`  MISS ${he} -> ${transliterate(he.normalize('NFC'))}`);
if (finalHeBad.length) { console.error('\nFAIL: a final he with a qamats must be read as h + a; a bare final he stays silent.'); process.exit(1); }

/*
 * Suffix stress (06.10.2026). Measured against pealim's bold syllable on 1 223 real forms:
 * 57 % → 86 % on the pages the rule was written from, 55 % → 84 % on pages never looked at.
 * The guards are the words that share the letters and keep the old stress.
 */
const SUFFIX_STRESS = [
  ['אֲנַחְנוּ', 'a-NACH-nu'], ['אֲמַרְתֶּם', 'a-mar-TEM'], ['אֲחִיכֶם', 'a-chi-CHEM'],
  ['אִיחַרְתִּי', 'i-CHAR-ti'], ['אִיבַּדְתָּ', 'i-BAD-ta'], ['אֱלֹהֶיךָ', 'e-lo-HEI-cha'],
  ['אָחִיהָ', 'a-CHI-ha'],
  // guards: a two-syllable ־ְתִּי noun stays final, a segolate stays penultimate
  ['אִשְׁתִּי', 'ish-TI'], ['לֶחֶם', 'LE-chem'],
];
const suffixBad = SUFFIX_STRESS.filter(([he, want]) => transliterate(he.normalize('NFC')) !== want);
console.log(`\nsuffix stress: ${SUFFIX_STRESS.length - suffixBad.length}/${SUFFIX_STRESS.length}`);
for (const [he, want] of suffixBad) console.log(`  MISS ${he} want ${want} got ${transliterate(he.normalize('NFC'))}`);
if (suffixBad.length) { console.error('\nFAIL: suffix stress.'); process.exit(1); }

/*
 * Shape stress, second pass (06.10.2026): long stem vowel before a vowel suffix (hif'il, hollow),
 * the segolate scope of the final-ayin rule, ־ַעַת/־ַחַת, the ל"ה and hollow pasts. Each pair below
 * is either a pealim form the rule fixes or a word it must leave alone. Bench after this pass:
 * 94.7 % on the pages the rules were written from, 95.8 % on pages never looked at.
 */
const SHAPE_STRESS = [
  ['הִסְגִּירוּ', 'his-GI-ru'], ['יָקוּמוּ', 'ya-KU-mu'], ['הִסְגִּירָה', 'his-GI-ra'], ['דַּלּוֹתִי', 'da-LO-ti'],
  ['מְשַׁכְנַעַת', 'me-shach-NA-at'], ['שִׁכְנַע', 'shich-NA'], ['הִצְטַנַּע', 'hitz-ta-NA'], ['שָׁמַע', 'sha-MA'],
  ['קָנִיתִי', 'ka-NI-ti'], ['הָיִיתָ', 'ha-YI-ta'],
  // guards
  ['אוֹתִי', 'o-TI'], ['סְלִיחָה', 'sli-CHA'], ['כָּתְבוּ', 'kat-VU'], ['אַחַת', 'a-CHAT'], ['תַּלְמִידִי', 'tal-mi-DI'],
  ['רֶגַע', 'RE-ga'], ['אַרְבַּע', 'AR-ba'], ['רֹבַע', 'RO-va'], ['בָּרֶגַע', 'ba-RE-ga'], ['מֵהַטֶּבַע', 'me-ha-TE-va'],
  ['שֶׁבָּהֶם', 'she-ba-HEM'], ['וְכֻלָּנוּ', 've-chu-LA-nu'], ['בָּנוּ', 'ba-NU'],
  ['לַקַּרְקַע', 'la-KAR-ka'], ['הָרַע', 'ha-RA'], ['כַּסּוּ', 'ka-SU'], ['אֲמִיתִי', 'a-mi-TI'], ['נְשַׁכְנַע', 'ne-shach-NA'],
];
const posOf = (s) => s.split('-').findIndex((x) => /[A-Z]/.test(x));
const shapeBad = SHAPE_STRESS.filter(([he, want]) => { const got = transliterate(he.normalize('NFC')); return posOf(got) !== posOf(want) || got.split('-').length !== want.split('-').length; });
console.log(`\nshape stress: ${SHAPE_STRESS.length - shapeBad.length}/${SHAPE_STRESS.length}`);
for (const [he, want] of shapeBad) console.log(`  MISS ${he} want ${want} got ${transliterate(he.normalize('NFC'))}`);
if (shapeBad.length) { console.error('\nFAIL: shape stress.'); process.exit(1); }

/*
 * The stress lexicon (06.10.2026, data/stress-lexicon.json, written by tools/build-stress-lexicon.mjs
 * from pealim pages). Every entry must apply as written: the engine, lexicon loaded, puts the
 * stress where the entry says. A key the engine reconstructs differently (NFC, mark order) would
 * sit in the file and do nothing; this catches it.
 */
let lexBad = 0, lexN = 0;
try {
  const lex = require(path.join(ROOT, 'data', 'stress-lexicon.json'));
  for (const [he, fromEnd] of Object.entries(lex)) {
    if (he.startsWith('_')) continue;
    lexN++;
    const syl = transliterate(he).split('-');
    if (syl.length - syl.findIndex((x) => /[A-Z]/.test(x)) !== fromEnd) lexBad++;
  }
} catch (e) { console.log('\nstress lexicon: absent'); }
console.log(`\nstress lexicon: ${lexN - lexBad}/${lexN} entries apply`);
if (lexBad) { console.error(`\nFAIL: ${lexBad} lexicon entries do not apply.`); process.exit(1); }
