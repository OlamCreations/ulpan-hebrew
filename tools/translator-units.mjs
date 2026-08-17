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
 * and calls window.QuickSay._weldProclitics, ._dropPadded and ._keepSameWords — the same bytes
 * the learner's browser runs.
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
 * keepSameWords — asked to "correct" Hebrew the learner already typed, Input Tools proposes other
 * sentences (בוקר טוב -> בוקר אוטובוסים). On a Hebrew input the section exists to add vowel points,
 * so a candidate with different consonants is not a reading of it. The stand-down clause, when
 * nothing matches, is what keeps a typo from being answered with an empty screen.
 *
 * --self-test replaces all three functions in the page with plausible WRONG versions and requires
 * the table to go red. A check that has never been shown to fail is not evidence. */
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
  ['beit-sefer', 'beit-sefer'],
  ['tel-aviv', 'tel-aviv'],
  ['bat-yam', 'bat-yam'],
  ['ha-beit-sefer', 'habeit-sefer'],                  // welds the particle, stops at the compound
  // the apostrophe: Input Tools returns NOTHING for a query containing one, so it goes. The
  // compound guard still has to survive the strip — be'er becomes beer, which is still not a
  // particle, so the hyphen after it stays.
  ["me'od", 'meod'],
  ["la'azor", 'laazor'],
  ["yesh li she'ela", 'yesh li sheela'],
  ["be'er-sheva", 'beer-sheva'],
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
  [[], []]
];

/* Every case here is (input, candidates, expected). The wrong candidates are verbatim from a
   capture of the live page — including בוקר אוטובוסים, which is what the app offered a learner
   who typed "good morning". */
const SAME_WORDS = [
  ['בוקר טוב', ['בוקר טוב', 'בוקר אוטובוסים', 'בוקר לטובתו'], ['בוקר טוב']],
  ['תודה רבה', ['תודה רבה', 'לתודה רבה', 'תודה רבהעליך'], ['תודה רבה']],
  ['מה קורה?', ['מה קורה', 'אימה קורה', 'מהא קורה'], ['מה קורה']],   // punctuation is not a word
  ['תודה', ['תּוֹדָה', 'תודה'], ['תּוֹדָה', 'תודה']],                  // niqqud is the point, not a change
  // a Latin input is none of this function's business — the whole rule is about Hebrew input
  ['toda raba', ['תודה רבה', 'תודה רבהעליך'], ['תודה רבה', 'תודה רבהעליך']],
  ['', ['תודה'], ['תודה']],
  // nothing matches: stand down rather than answer with silence. This is the typo case.
  ['שלוום', ['שלום', 'שלומו'], ['שלום', 'שלומו']],
  ['תודה', [], []]
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
    // The plausible wrong version here is the one without the stand-down clause: filter and
    // accept whatever is left, including nothing. It answers every good case correctly and
    // hands an empty screen to the learner with a typo.
    window.QuickSay._keepSameWords = (q, c) => c.filter(x =>
      String(x).replace(/[֑-ׇ]/g, '') === String(q).replace(/[֑-ׇ]/g, ''));
  });
  console.log('SELF-TEST: all three rules replaced with their plausible wrong versions.\n' +
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

console.log(`\nkeepSameWords — ${SAME_WORDS.length} cases`);
for (const [q, cands, want] of SAME_WORDS) {
  const got = await page.evaluate(([a, b]) => window.QuickSay._keepSameWords(a, b), [q, cands]);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  say(ok, `"${q}" [${cands.join(', ')}] -> [${got.join(', ')}]` + (ok ? '' : `   (expected [${want.join(', ')}])`));
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
