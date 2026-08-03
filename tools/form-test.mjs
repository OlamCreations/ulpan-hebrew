#!/usr/bin/env node
// Does asking Dicta for a gender actually get that gender?
//
// The live translator can now be asked for the masculine / feminine / singular / plural reading of
// a sentence. The hard half is not the translation, it is the POINTING: Hebrew writes the masculine
// and feminine of a whole class of everyday verbs with the same consonants — רוצה is both rotze and
// rotza, and likewise קונה, עושה, שותה, גרה, plus nouns like מורה. Take Dicta's first reading, as the
// Worker always did, and a card labelled "feminine" shows masculine niqqud and a masculine
// transliteration. The learner then says it out loud, wrong.
//
// pickOption() (worker/src/index.js, imported here — not copied) chooses among Dicta's readings
// using the gender and number encoded in its morph id. This checks that it does, and — just as
// important — that it leaves alone every word whose gender is not up for discussion.
//
//   node tools/form-test.mjs
//
// Needs the network (it calls Dicta). No key, no deploy: this tests the decision, not the endpoint.

import { createRequire } from 'node:module';
import { decodeGN, pickOption } from '../worker/src/index.js';

// Compare what the learner SEES, not what Dicta sends: the app cleans Dicta's encoding before it
// reaches the screen (stray meteg, a holam parked on the consonant instead of the vav — שֻׁוֽלְחָן for
// שׁוּלְחָן). Checking the raw form instead fails rows that are in fact correct on screen.
const { cleanDictaForDisplay } = createRequire(import.meta.url)('../assets/translit.js');

const HOSTS = [
  'https://nakdan-u1-0.loadbalancer.dicta.org.il/api',
  'https://nakdan-2-0.loadbalancer.dicta.org.il/api',
];

async function nakdan(text) {
  const payload = { task: 'nakdan', data: text, genre: 'modern', addmorph: true,
    keepqq: false, nodageshdefault: false, patachma: false, keepmetagim: true };
  for (const url of HOSTS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload) });
      if (r.ok) return await r.json();
    } catch (e) { /* next node */ }
  }
  return null;
}

const norm = s => cleanDictaForDisplay((s || '').replace(/[֑-֯]/g, '').replace(/\|/g, '')).normalize('NFC');

// What the Worker would put on screen for this word, given a requested form.
async function pointed(word, prefer) {
  const j = await nakdan(word);
  if (!j) return null;
  for (const t of j) {
    if (t.sep) continue;
    const opts = Array.isArray(t.options) ? t.options : null;
    if (!opts || !opts.length) continue;
    const chosen = opts[pickOption(opts, prefer)];
    return norm(chosen && chosen[0]);
  }
  return null;
}

/* The class this whole mechanism exists for: masculine and feminine spelled identically.
   If pickOption does nothing, every `f` row here fails — which is exactly the injected-defect
   check at the bottom. */
const AMBIGUOUS = [
  ['רוצה', 'm', 'רוֹצֶה'], ['רוצה', 'f', 'רוֹצָה'],
  ['קונה', 'm', 'קוֹנֶה'], ['קונה', 'f', 'קוֹנָה'],
  ['עושה', 'm', 'עוֹשֶׂה'], ['עושה', 'f', 'עוֹשָׂה'],
  ['שותה', 'm', 'שׁוֹתֶה'], ['שותה', 'f', 'שׁוֹתָה'],
  ['רואה', 'm', 'רוֹאֶה'], ['רואה', 'f', 'רוֹאָה'],
  ['מורה', 'm', 'מוֹרֶה'], ['מורה', 'f', 'מוֹרָה'],
];

/* Words with a gender of their own. A feminine speaker still drinks a masculine קָפֶה, so asking
   for the feminine reading of the SENTENCE must not touch them. These guard against the obvious
   way to make the table above pass: bend every word toward the requested gender. קפה is the sharp
   one — Dicta really does offer קֻפָּה (a till, feminine) for those three letters.

   Stated as an INVARIANCE (all three requests agree) rather than against a spelling written out by
   hand. The property is "the request changes nothing here", which is what invariance says exactly;
   and every hand-written expectation in this file's history has failed on my own orthography before
   it ever tested the code. */
const FIXED = [
  'קפה', 'ספר', 'דלת', 'שולחן', 'בית', 'חלון',   // nouns: a gender of their own
  'איפה', 'מתי', 'למה',                          // question words: NO gender, so nothing to agree
];

let pass = 0, fail = 0;
const say = (ok, msg) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); };

console.log('Ambiguous spellings — the requested gender must win');
for (const [word, g, want] of AMBIGUOUS) {
  const got = await pointed(word, { g, n: 'sg' });
  say(got === norm(want), `${word} as ${g}. -> ${got || '(none)'}  want ${want}`);
}

console.log('\nWords with a fixed gender — the request must NOT bend them');
for (const word of FIXED) {
  const [base, m, f] = await Promise.all([pointed(word, null),
    pointed(word, { g: 'm', n: 'sg' }), pointed(word, { g: 'f', n: 'sg' })]);
  say(!!base && base === m && base === f,
    `${word} -> ${base || '(none)'} unchanged under both requests` +
    (base === m && base === f ? '' : `  (m: ${m}, f: ${f})`));
}

/* Injected defect. A test that passes and a test that never ran look the same from the outside, so
   prove this one is measuring the mechanism: with the preference removed, pickOption falls back to
   Dicta's first reading and every feminine row above MUST go wrong. If they still pass, the table
   is being satisfied by Dicta's defaults and proves nothing about the code under test. */
console.log('\nInjected defect — with no preference, the feminine rows must break');
let brokeAsExpected = 0;
const femRows = AMBIGUOUS.filter(([, g]) => g === 'f');
for (const [word, , want] of femRows) {
  const got = await pointed(word, null);
  if (got !== norm(want)) brokeAsExpected++;
}
say(brokeAsExpected === femRows.length,
  `${brokeAsExpected}/${femRows.length} feminine readings lost without the preference` +
  (brokeAsExpected === femRows.length ? '' : ' — the table above is not testing pickOption'));

// decodeGN's own contract, on the two bits and the field the rule rests on.
console.log('\nBit decoding');
say(decodeGN('1092681728').g === 'm', 'masculine bit reads as m.');
say(decodeGN('22872064').g === 'f', 'feminine bit reads as f.');
say(decodeGN('1092681728').n === 'sg', 'number field reads singular');
say(decodeGN(null).g === '', 'garbage in -> no claim, not a guess');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
