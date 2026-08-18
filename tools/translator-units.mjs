#!/usr/bin/env node
/* translator-units.mjs — the three rules that decide what the phonetic path asks for and keeps.
 *
 *   node tools/serve.mjs 8912        # in another shell
 *   node tools/translator-units.mjs
 *   node tools/translator-units.mjs --self-test
 *
 * WHY A BROWSER FOR THREE PURE FUNCTIONS. Because they must be THE three pure functions. Each is
 * small enough to re-type in Node in a minute, and a re-typed rule is a second program: it passes
 * on itself and says nothing about the one that shipped. This file therefore loads the real page
 * and calls window.QuickSay._weldProclitics, ._dropPadded, ._isAllHebrew, ._phoneticQuery and
 * ._normalizeQuery — the same bytes the learner's browser runs.
 *
 * WHAT THEY GUARD.
 *
 * weldProclitics — a hyphen after a prefixed particle (ha-, la-, ba-, …) is read by Google Input
 * Tools as a word boundary, so la-lechet came back לֹא-לָלֶכֶת, "not-to go". It also strips the
 * apostrophe, which is not a nicety: given one anywhere in the query Input Tools returns an EMPTY
 * list, so every learner writing the standard me'od / she'ela / la'azor romanization got nothing
 * at all. The compound guard is the load-bearing half: welding a hyphen that is NOT a particle
 * destroys the answer (beit-sefer -> בביצפר, tel-aviv -> תלאביב), so the negative cases below
 * matter more than the positive ones and must never be relaxed to make a new case pass.
 *
 * dropPadded — Input Tools offers the same word twice, once with a letter repeated (בבקשה beside
 * בבבקשה), both vocalized with equal confidence. The rule is comparative on purpose: an absolute
 * "no tripled letters" rule has real false positives in Hebrew, a comparative one has none
 * because it needs an unpadded sibling to fire against.
 *
 * isAllHebrew — on an all-Hebrew input Input Tools is not called at all: it does not correct
 * Hebrew (6/6 typos returned unchanged) and asked to "improve" it proposes other sentences
 * (בוקר טוב -> בוקר אוטובוסים, 34 of 58 cards). The candidate is the input; Dicta points it and
 * keeps the punctuation the learner wrote. A mixed line still goes to Input Tools.
 *
 * phoneticQuery — the string Input Tools is actually sent: welded, cleaned, and with every Latin
 * word we already know replaced by its Hebrew from data/romanization-fixes.json. Input Tools
 * passes Hebrew through, so achshav never reaches it as Latin and cannot come back as ייחשב.
 *
 * normalizeQuery — one trailing full stop is removed at the single point every path reads the
 * query, so Google's unstable word choice across it becomes irrelevant by construction.
 *
 * --self-test replaces the functions in the page with plausible WRONG versions and requires the
 * table to go red. A check that has never been shown to fail is not evidence. */
import { chromium } from 'playwright-core';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912').replace(/\/$/, '');
const SELFTEST = process.argv.includes('--self-test');

let pass = 0, fail = 0;
const say = (ok, msg) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); };

/* Every case is (input, expected). The comment on a group says what a user did to get there —
   a case whose motivation cannot be written down is a case nobody needed. */
const WELD = [
  // the defect: a particle hyphen, welded
  ['ha-tachana', 'hatachana'],
  ['la-lechet', 'lalechet'],
  ['ba-bank', 'babank'],
  ['be-seder', 'beseder'],
  ['ha-ir ha-atika', 'hair haatika'],
  ['me-ha-bayit', 'mehabayit'],                       // stacked particles weld left to right
  ['she-ani rotze', 'sheani rotze'],
  ['ani tzarich la-lechet la-rofe', 'ani tzarich lalechet larofe'],
  ['HA-Tachana', 'HATachana'],                        // case is the user's, not ours to change
  // the guard: NOT particles, so the hyphen the user typed survives untouched
  ['beit-sefer', 'בית-sefer'],                       // beit is a known word (resolved), the hyphen survives
  ['tel-aviv', 'tel-aviv'],
  ['bat-yam', 'bat-yam'],
  ['ha-beit-sefer', 'הבית-sefer'],                   // welds the particle, stops at the compound
  // the apostrophe: Input Tools returns NOTHING for a query containing one, so it goes. The
  // compound guard still has to survive the strip — be'er becomes beer, which is still not a
  // particle, so the hyphen after it stays.
  ["me'od", 'meod'],
  ["la'azor", 'laazor'],
  ["yesh li she'ela", 'yesh li sheela'],
  ["be'er-sheva", 'beer-שבע'],                        // beer is not a particle; sheva is a known word
  ["ha'sefer", 'hasefer'],                            // apostrophe used where a hyphen was meant
  ['me’od', 'meod'],                                  // typographic apostrophe, what phones insert
  ["at yechola la'azor li rega im ha-mismach ha-ze",
   'at yechola laazor li rega im hamismach haze'],
  // the comma: Input Tools silently drops everything after it, so it becomes a space. A space
  // and not nothing, or "kafe,bevakasha" would become one word.
  ['ani rotze kafe, bevakasha', 'ani rotze kafe  bevakasha'],
  ['ani rotze kafe,bevakasha', 'ani rotze kafe bevakasha'],
  ['שלום, מה שלומך', 'שלום  מה שלומך'],
  // the gershayim sits inside the word, so it is removed rather than spaced
  ['אני משרת בצה"ל', 'אני משרת בצהל'],
  ['אני משרת בצה״ל', 'אני משרת בצהל'],               // the Hebrew gershayim character, U+05F4
  // nothing to do
  ['ani rotze kafe', 'ani rotze kafe'],
  ['', ''],
  ['-', '-'],                                         // a lone hyphen has no host to weld to
  ['ha-', 'ha-']                                      // trailing particle, no word after it
];

const PADDED = [
  // the defect, verbatim from a capture of the live page
  [['תודה רבה', 'לתודה רבה', 'תודה רבההה'], ['תודה רבה', 'לתודה רבה']],
  [['בבקשה', 'בבואכש', 'בבבקשה'], ['בבקשה', 'בבואכש']],
  [['הבית', 'הבסיסית', 'הביית'], ['הבית', 'הבסיסית']],
  // a tripled letter with no unpadded sibling is a real Hebrew word and is kept
  [['חנני'], ['חנני']],
  [['ממלכה', 'חנני'], ['ממלכה', 'חנני']],
  // conservative on purpose: when the padded form outranks the plain one we keep both rather
  // than second-guess the ranking, because dropping the TOP candidate is the costlier mistake
  [['תודה רבההה', 'תודה רבה'], ['תודה רבההה', 'תודה רבה']],
  // different words that merely share letters are not padding
  [['שהוא', 'שהו'], ['שהוא', 'שהו']],
  // a doubled final ה is the feminine, not padding: both readings stay
  [['כמה זה עולה המצהיר גבוה מדי', 'כמה זה עולה המצהיר גבוהה מדי'], ['כמה זה עולה המצהיר גבוה מדי', 'כמה זה עולה המצהיר גבוהה מדי']],
  [['אני', 'אאני'], ['אני']],                           // a doubled initial letter is padding
  [[], []]
];

/* search — the curated forward lookup. A three-letter query is not a stem: "ici" sat inside
   delICIous and "eau" inside bEAUtiful, and both cards were shown to a French learner as answers. */
const SEARCH = [
  ['ici', ['פֹּה']],                                   // curated French, exact: leads. Not delICIous.
  ['eau', ['מַיִם']],                                  // curated French, exact. Not bEAUtiful.
  ['hello', ['שָׁלוֹם']],                              // exact English gloss still hits
  ['thank', ['תּוֹדָה', 'תּוֹדָה רַבָּה']],              // a 5-letter stem still hits (prefix / keyword)
  ['where is the bathroom', ['אֵיפֹה הַשֵּׁרוּתִים']],
  // French, curated: Google fr->he is measured wrong on every one of these (or, to close, to
  // open, to farm, amnesty, happy) and no retry repairs them. Accents must fold, not vanish.
  ['où', ['אֵיפֹה']],
  ['où', ['אֵיפֹה', 'אֵיפֹה הַשֵּׁרוּתִים'], 'only'],   // exact + the whole-word keyword hit (où sont les toilettes); no "oui" by prefix
  ['près', ['קָרוֹב'], 'only'],                        // exact: not "après" by substring
  ['where is', ['אֵיפֹה', 'אֵיפֹה הַשֵּׁרוּתִים']],       // exact + a word-boundary continuation still follows
  ['ou', ['אֵיפֹה']],
  ['Où ?', ['אֵיפֹה']],
  ['près', ['קָרוֹב']],
  ['ouvert', ['פָּתוּחַ']],
  ['fermé', ['סָגוּר']],
  ['pardon', ['סְלִיחָה']],
  ['enchanté', ['נָעִים מְאוֹד']],
  ['enchantée', ['נָעִים מְאוֹד']],
  ['de rien', ['בְּבַקָּשָׁה']],
  ['ça va', ['בְּסֵדֶר', 'מָה שְׁלוֹמְךָ']],              // both the answer and the question; not בְּבַקָּשָׁה (beVAkasha)
  ["s'il vous plaît", ['בְּבַקָּשָׁה']],
  ['hier', ['אֶתְמוֹל']]
];

/* reverseOffline — the curated lookup from a typed romanization. Exactness decides who leads. */
const REVERSE = [
  ['toda', true], ['TODA', true], ['to-da', true], ['toda raba', true],
  ['today', false], ['tod', false], ['todaa', false], ['', false]
];
const REVERSE_LIST = [
  ['toda raba', ['תּוֹדָה רַבָּה', 'תּוֹדָה']],           // exact first, then the phrase that begins it
  ['tod', ['תּוֹדָה', 'תּוֹדָה רַבָּה']],               // typing in progress: keys that begin with the input
  ['kama ze ole hamechir gavoha midai', []]           // a fragment covering 30% of the input is not a match
];

/* isAllHebrew decides whether Input Tools is called at all. The mixed cases are the ones that
   matter: a learner who types one Latin word inside Hebrew must still get it transliterated. */
const ALL_HEBREW = [
  ['בוקר טוב', true],
  ['שלום, מה שלומך?', true],
  ['תּוֹדָה', true],                                     // pointed Hebrew is still Hebrew
  ['איפה hatachana', false],                          // mixed: Input Tools transliterates the Latin
  ['אני רוצה kafe', false],
  ['toda raba', false],
  ['', false],
  ['123', false],
  ['?!', false]
];

/* phoneticQuery — the fixes are read from the page's own loaded data/romanization-fixes.json, so a
   case here also proves the file loads and parses on the live page. */
const ROM_FIX = [
  ['achshav ani holech', 'עכשיו ani holech'],
  ['akhshav ani holech', 'עכשיו ani holech'],          // kh spelling folds onto the same key
  ['ACHSHAV', 'עכשיו'],
  ['atsmecha', 'עצמך'],                               // file says atzmecha; keys are folded at load
  ['eyfo ha-tachana', 'איפה hatachana'],               // fix + weld together
  ['eifo hatachana', 'איפה hatachana'],
  ['arba, chamesh, shesh', 'ארבע  חמש  שש'],          // commas cleaned first, then fixed
  ['beit-sefer', 'בית-sefer'],                        // per segment: the compound keeps its hyphen
  ['beit sefer', 'בית sefer'],
  ['ani rotze kafe', 'ani rotze kafe'],               // nothing known, nothing touched
  ['lo, toda', 'lo  toda'],                           // lo is ambiguous (לא/לו) and is NOT in the file
  // word-initial ch -> h, so Input Tools hears ח and not כ+ח
  ['chadash', 'hadash'],
  ['Chaver tov', 'Haver tov'],
  ['ha-chodesh ha-ba', 'hahodesh haba'],              // segment-initial, so it fires after a particle
  ['lechem', 'lechem'],                               // mid-word ch is ambiguous (ח/כ): untouched
  ['cham', 'חם'],                                     // the fix list wins over the ch rule
  // a Hebrew host takes Hebrew particles: "haחודש" is measured unreliable, "החודש" is not
  ['ha-cham', 'החם'],
  ['be-eifo', 'באיפה'],
  ['ve-ha-cham', 'והחם'],
  ['ha-beit-sefer', 'הבית-sefer']
];

const NORMALIZE = [
  ['I want a coffee.', 'I want a coffee'],
  ['I want a coffee', 'I want a coffee'],
  ['Where is it?', 'Where is it?'],                    // a question mark carries meaning
  ['Really!', 'Really!'],
  ['Well...', 'Well...'],                              // an ellipsis is not a full stop
  ['  toda.  ', 'toda'],
  ['.', ''],
  ['', '']
];

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.QuickSay && window.QuickSay._weldProclitics, null, { timeout: 20000 });

if (SELFTEST) {
  /* Plausible wrong versions, not absurd ones. Each is a rule someone could genuinely have
     written: "just strip every hyphen" is the obvious first attempt at the particle bug and is
     exactly what breaks tel-aviv; "drop anything with a tripled letter" is the obvious first
     attempt at the padding bug and is exactly what eats חנני. If the table stays green against
     these two, it is not testing the part that was hard. */
  await page.evaluate(() => {
    window.QuickSay._weldProclitics = q => String(q || '').replace(/-/g, '');
    window.QuickSay._dropPadded = c => c.filter(x => !/(.)\1\1/.test(x));
    // "Mostly Hebrew" is the plausible wrong version: it bypasses Input Tools on a mixed line
    // and leaves the learner's one Latin word untransliterated.
    window.QuickSay._isAllHebrew = q => { const t = String(q).replace(/\s/g, ''); return t.length > 0 && (t.match(/[א-ת]/g) || []).length >= t.length * 0.6; };
    // An empty fix table is what a failed fetch of the JSON looks like — the table must notice.
    window.QuickSay._setRomFixes({});
    // Stripping any trailing punctuation is the plausible over-reach: it eats the question mark.
    window.QuickSay._normalizeQuery = q => String(q).trim().replace(/[.?!]+$/, '').trim();
  });
  console.log('SELF-TEST: the rules replaced with their plausible wrong versions.\n' +
              'Every line below that says FAIL is this file working.\n');
}

console.log(`weldProclitics — ${WELD.length} cases`);
for (const [input, want] of WELD) {
  const got = await page.evaluate(q => window.QuickSay._weldProclitics(q), input);
  say(got === want, `"${input}" -> "${got}"` + (got === want ? '' : `   (expected "${want}")`));
}

console.log(`\ndropPadded — ${PADDED.length} cases`);
for (const [input, want] of PADDED) {
  const got = await page.evaluate(c => window.QuickSay._dropPadded(c), input);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  say(ok, `[${input.join(', ')}] -> [${got.join(', ')}]` + (ok ? '' : `   (expected [${want.join(', ')}])`));
}

console.log(`\nisAllHebrew — ${ALL_HEBREW.length} cases`);
for (const [q, want] of ALL_HEBREW) {
  const got = await page.evaluate(x => window.QuickSay._isAllHebrew(x), q);
  say(got === want, `"${q}" -> ${got}` + (got === want ? '' : `   (expected ${want})`));
}

console.log(`\nphoneticQuery (weld + clean + romanization fixes) — ${ROM_FIX.length} cases`);
// The fixes file is fetched at module load; wait for it rather than race it.
await page.waitForFunction(() => window.QuickSay._phoneticQuery('achshav') !== 'achshav', null, { timeout: 10000 }).catch(() => {});
for (const [q, want] of ROM_FIX) {
  const got = await page.evaluate(x => window.QuickSay._phoneticQuery(x), q);
  say(got === want, `"${q}" -> "${got}"` + (got === want ? '' : `   (expected "${want}")`));
}

console.log(`\nsearch — ${SEARCH.length} cases`);
for (const [q, want, mode] of SEARCH) {
  const got = await page.evaluate(x => window.QuickSay._search(x).map(p => p.he), q);
  // The first expected card must LEAD (exact beats keyword); the rest must be present. With
  // mode 'only', nothing else may be shown at all.
  const ok = want.length
    ? (got[0] === want[0] && want.every(w => got.includes(w)) && (mode !== 'only' || got.length === want.length))
    : got.length === 0;
  say(ok, `"${q}" -> [${got.join(', ')}]` + (ok ? '' : `   (expected ${want.length ? 'to include [' + want.join(', ') + ']' : 'nothing'})`));
}

const FORWARD = [
  ['où', true], ['Où ?', true], ['près', true], ['enchantée', true], ['ça va', true], ['hello', true], ['sorry', true],
  ['today', true], ['toda', false], ['where is', true], ['bonjour le monde', false], ['', false]   // "where is...?" is a gloss
];
console.log(`\nhasExactForward — ${FORWARD.length} cases`);
for (const [q, want] of FORWARD) {
  const got = await page.evaluate(x => window.QuickSay._hasExactForward(x), q);
  say(got === want, `"${q}" -> ${got}` + (got === want ? '' : `   (expected ${want})`));
}

console.log(`\nhasExactReverse — ${REVERSE.length} cases`);
for (const [q, want] of REVERSE) {
  const got = await page.evaluate(x => window.QuickSay._hasExactReverse(x), q);
  say(got === want, `"${q}" -> ${got}` + (got === want ? '' : `   (expected ${want})`));
}
console.log(`\nreverseOffline — ${REVERSE_LIST.length} cases`);
for (const [q, want] of REVERSE_LIST) {
  const got = await page.evaluate(x => window.QuickSay._reverseOffline(x).map(p => p.he), q);
  const ok = want.length ? want.every((w, i) => got[i] === w) : got.length === 0;
  say(ok, `"${q}" -> [${got.join(', ')}]` + (ok ? '' : `   (expected [${want.join(', ')}])`));
}

console.log(`\nnormalizeQuery — ${NORMALIZE.length} cases`);
for (const [q, want] of NORMALIZE) {
  const got = await page.evaluate(x => window.QuickSay._normalizeQuery(x), q);
  say(got === want, `"${q}" -> "${got}"` + (got === want ? '' : `   (expected "${want}")`));
}

/* The rule runs on every keystroke of the phonetic path, so a throw here is a dead translator,
   not a wrong answer. Cheap to assert, and it is the failure mode a user cannot work around. */
console.log('\nrobustness');
for (const junk of [null, undefined, 123, '   ', '-----', 'a'.repeat(500) + '-b']) {
  const ok = await page.evaluate(q => {
    try { window.QuickSay._weldProclitics(q); return true; } catch (e) { return false; }
  }, junk === undefined ? null : junk);
  say(ok, `weldProclitics survives ${JSON.stringify(junk)}`);
}

say(jsErrors.length === 0, `no JS errors on the page (${jsErrors.length})`);
jsErrors.forEach(e => console.log('       ' + e));

await browser.close();
console.log(`\n${pass} ok, ${fail} failed`);
if (SELFTEST) {
  /* The self-test inverts the contract: a green run means the injected breakage went unnoticed. */
  const caught = fail > 0;
  console.log(caught
    ? `\nSELF-TEST PASSED: ${fail} assertions rejected the broken rules.`
    : '\nSELF-TEST FAILED: the broken rules passed. This file is not checking anything.');
  process.exit(caught ? 0 : 1);
}
process.exit(fail ? 1 : 0);
