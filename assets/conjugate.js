/* Present-tense (בינוני) conjugation, derived from root + binyan + the pointed infinitive.
 *
 * WHY THIS IS A RULE ENGINE AND NOT AN API CALL
 *
 * The obvious build is: ask the 70B model for the table, then check it. That check does not
 * exist. Measured against UDPipe, the only morphological analyser this app can reach: with each
 * form in a carrier sentence it tagged 8 of 10 REAL forms of נוח as verbs — and 4 of 5 INVENTED
 * ones too, נוחיתי coming back as a clean "Pa'al, past, 1st person, singular" for a word that is
 * not a word. A verifier that rejects real forms and blesses fabricated ones is worse than none,
 * because its output looks checked. Out of a carrier sentence it was worse still: only 4 of 14
 * real forms were even tagged VERB.
 *
 * So nothing here is generated. Every form is built from the pattern of its class, and a class
 * this engine does not KNOW returns null rather than a guess — because the verbs a learner looks
 * up are exactly the irregular ones, and a table that is right most of the time is not a table
 * you can use.
 *
 * Scored against 57 verb paradigms written down in Jonas's ulpan class (tools/conjugate-test.mjs):
 * 152 of 152 forms exact, niqqud included, across the seven classes below; the other 19 verbs are
 * refused. Coverage grows by adding a class and its test rows, never by loosening the test.
 *
 * PRESENT TENSE ONLY, and that is a deliberate stop. There is no ground truth to hand for past or
 * future, and shipping a tense that has never been scored is the thing this whole file exists to
 * avoid.
 */
(function () {
  'use strict';

  var NIQQUD = /[֑-ׇ]/;
  var GUTTURAL = 'אהחער';
  var DAGESHABLE = 'בגדכפת';
  var D = 'ּ';    // dagesh
  var SH = 'ׁ';   // shin dot
  var SIN = 'ׂ';  // sin dot
  var holam = 'ֹ', tsere = 'ֵ', segol = 'ֶ', patah = 'ַ',
      qamats = 'ָ', hiriq = 'ִ', sheva = 'ְ';

  // Holam is written MALE, with a vav carrying the point: יוֹדֵעַ, not יֹדֵעַ.
  var HOL = 'ו' + holam;

  var MEDIAL = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };
  var FINAL = { 'מ': 'ם', 'נ': 'ן', 'צ': 'ץ', 'פ': 'ף', 'כ': 'ך' };

  function shin(c) { return c === 'ש' ? c + SH : c; }

  // A letter mid-word: never a final form, and a bare shin defaults to שׁ.
  function L(c) {
    if (c.length > 1) return (MEDIAL[c[0]] || c[0]) + c.slice(1);
    return shin(MEDIAL[c] || c);
  }
  /* A letter at the end of a word takes its final form. The roots are inconsistent about this —
   * ר.ו.צ is written medially, ק.ו.ם already carries the final mem — so both directions are
   * handled here rather than trusting how the root happened to be spelled. */
  function Lend(c) {
    var base = FINAL[c[0]] || c[0];
    return c.length > 1 ? base + c.slice(1) : shin(base);
  }
  // Word-initial: a begadkefat letter takes a dagesh; a bare shin still needs its dot.
  function withDagesh(c) {
    var base = c[0], marks = c.slice(1);
    if (DAGESHABLE.indexOf(base) >= 0) return base + D + marks;
    return base + (marks || (base === 'ש' ? SH : ''));
  }

  /* The root's three letters, each carrying the shin/sin dot it wears in the infinitive.
   *
   * That dot is not decoration and it is not in the root: עשה is עוֹשֶׂה with a SIN, שתה is
   * שׁוֹתֶה with a SHIN, and both roots are spelled with a bare ש. The infinitive is pointed and
   * is the word being looked up, so the dot is read off it.
   *
   * The scan walks the WHOLE run of combining marks after the letter, not just the next
   * character: NFC sorts Hebrew points by combining class and the vowel (14) comes before the
   * sin/shin dot (24/25), so in לָשִׂים the character after ש is the hiriq and the dot is one
   * further on. Reading only the next character turned שָׂם into שָׁם. */
  function letters(root, inf) {
    var bare = String(root || '').normalize('NFC').replace(/[֑-ׇ]/g, '').replace(/[^א-ת]/g, '');
    var chars = String(inf || '').normalize('NFC').split('');
    var at = 0;
    var out = [];
    for (var k = 0; k < bare.length; k++) {
      var c = bare[k];
      var want = MEDIAL[c] || c;
      var got = c;
      for (var i = at; i < chars.length; i++) {
        if (chars[i] !== want && chars[i] !== c) continue;
        at = i + 1;
        for (var j = i + 1; j < chars.length; j++) {
          var m = chars[j];
          if (m === SH || m === SIN) { got = c + m; break; }
          if (!NIQQUD.test(m)) break;
        }
        break;
      }
      out.push(got);
    }
    return out;
  }

  /* Which pattern this verb follows, or null for "not claimed". Every `return null` is a class
   * whose forms have not been scored against real paradigms — פ"י (לִישׁוֹן → יָשֵׁן) does not
   * follow the strong pattern, and guessing it produced יוֹשֵׁן. */
  function classify(r, binyan) {
    if (r.length !== 3) return null;
    var c1 = r[0][0], c2 = r[1][0], c3 = r[2][0];
    if (binyan === "pa'al") {
      if (c3 === 'ה') return 'paal-lamed-he';
      if (c2 === 'ו' || c2 === 'י') return 'paal-hollow';
      if (c3 === 'א') return 'paal-lamed-alef';
      if (c3 === 'ח' || c3 === 'ע') return 'paal-guttural3';
      if (c1 === 'י' || c1 === 'נ') return null;
      if (GUTTURAL.indexOf(c1) >= 0 || GUTTURAL.indexOf(c2) >= 0) return null;
      return 'paal-strong';
    }
    if (binyan === "pi'el") {
      if (c3 === 'ה' || GUTTURAL.indexOf(c2) >= 0) return null;
      return 'piel-strong';
    }
    if (binyan === "hif'il") {
      if (c3 === 'ה' || c1 === 'נ' || c1 === 'י' || c2 === 'ו' || c2 === 'י') return null;
      return 'hifil-strong';
    }
    return null;
  }

  var BUILD = {
    'paal-strong': function (a, b, c) {
      return {
        'm.s': withDagesh(a) + HOL + L(b) + tsere + Lend(c),
        'f.s': withDagesh(a) + HOL + L(b) + segol + L(c) + segol + 'ת',
        'm.pl': withDagesh(a) + HOL + L(b) + sheva + L(c) + hiriq + 'י' + 'ם',
        'f.pl': withDagesh(a) + HOL + L(b) + sheva + L(c) + HOL + 'ת',
      };
    },
    'paal-guttural3': function (a, b, c) {
      return {
        'm.s': withDagesh(a) + HOL + L(b) + tsere + Lend(c) + patah,
        'f.s': withDagesh(a) + HOL + L(b) + patah + L(c) + patah + 'ת',
        'm.pl': withDagesh(a) + HOL + L(b) + sheva + L(c) + hiriq + 'י' + 'ם',
        'f.pl': withDagesh(a) + HOL + L(b) + sheva + L(c) + HOL + 'ת',
      };
    },
    'paal-lamed-alef': function (a, b) {
      return {
        'm.s': withDagesh(a) + HOL + L(b) + tsere + 'א',
        'f.s': withDagesh(a) + HOL + L(b) + tsere + 'א' + 'ת',
        'm.pl': withDagesh(a) + HOL + L(b) + sheva + 'א' + hiriq + 'י' + 'ם',
        'f.pl': withDagesh(a) + HOL + L(b) + sheva + 'א' + HOL + 'ת',
      };
    },
    'paal-lamed-he': function (a, b) {
      return {
        'm.s': withDagesh(a) + HOL + L(b) + segol + 'ה',
        'f.s': withDagesh(a) + HOL + L(b) + qamats + 'ה',
        'm.pl': withDagesh(a) + HOL + L(b) + hiriq + 'י' + 'ם',
        'f.pl': withDagesh(a) + HOL + L(b) + HOL + 'ת',
      };
    },
    'paal-hollow': function (a, b, c) {
      return {
        'm.s': withDagesh(a) + qamats + Lend(c),
        'f.s': withDagesh(a) + qamats + L(c) + qamats + 'ה',
        'm.pl': withDagesh(a) + qamats + L(c) + hiriq + 'י' + 'ם',
        'f.pl': withDagesh(a) + qamats + L(c) + HOL + 'ת',
      };
    },
    'piel-strong': function (a, b, c) {
      return {
        'm.s': 'מ' + sheva + L(a) + patah + L(b) + D + tsere + Lend(c),
        'f.s': 'מ' + sheva + L(a) + patah + L(b) + D + segol + L(c) + segol + 'ת',
        'm.pl': 'מ' + sheva + L(a) + patah + L(b) + D + sheva + L(c) + hiriq + 'י' + 'ם',
        'f.pl': 'מ' + sheva + L(a) + patah + L(b) + D + sheva + L(c) + HOL + 'ת',
      };
    },
    'hifil-strong': function (a, b, c) {
      return {
        'm.s': 'מ' + patah + L(a) + sheva + withDagesh(b) + hiriq + 'י' + Lend(c),
        'f.s': 'מ' + patah + L(a) + sheva + withDagesh(b) + hiriq + 'י' + L(c) + qamats + 'ה',
        'm.pl': 'מ' + patah + L(a) + sheva + withDagesh(b) + hiriq + 'י' + L(c) + hiriq + 'י' + 'ם',
        'f.pl': 'מ' + patah + L(a) + sheva + withDagesh(b) + hiriq + 'י' + L(c) + HOL + 'ת',
      };
    },
  };

  /* Normalise the binyan the way each upstream spells it. Dicta returns "PAAL"/"PIEL"/"HIFIL",
   * the class notes write "pa'al". Anything unrecognised falls through to null and no table is
   * shown, which is the correct outcome — a binyan we cannot name is a pattern we cannot apply. */
  function normBinyan(b) {
    var s = String(b || '').toLowerCase().replace(/['’׳\s-]/g, '');
    if (s === 'paal' || s === 'qal' || s === 'kal') return "pa'al";
    if (s === 'piel') return "pi'el";
    if (s === 'hifil' || s === 'hiphil') return "hif'il";
    return null;
  }

  /**
   * @returns {null|{cls:string, forms:{'m.s':string,'f.s':string,'m.pl':string,'f.pl':string}}}
   *          null whenever the class is not one this engine has been scored on.
   */
  function present(root, binyan, infinitive) {
    var b = normBinyan(binyan);
    if (!b || !root) return null;
    var r = letters(root, infinitive || '');
    var cls = classify(r, b);
    if (!cls) return null;
    return { cls: cls, forms: BUILD[cls](r[0], r[1], r[2]) };
  }

  var api = { present: present, normBinyan: normBinyan, _letters: letters, _classify: classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Conjugate = api;
})();
