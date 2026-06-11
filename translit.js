// Transliterate VOCALIZED (niqqud) Hebrew to a Latin romanization.
// Modern Israeli pronunciation, matching the lesson style: ch (ח/כ), tz (צ),
// sh (שׁ), final he silent, matres lectionis resolved, sheva-na as "e".
// Pure function. Works in the browser (window.Translit) and Node (module.exports).
// It expects POINTED Hebrew (e.g., from Dicta Nakdan); bare consonants give a
// best-effort consonant-only reading.
(function (root) {
  'use strict';

  // niqqud code points
  const SHEVA = 0x05B0, HATAF_SEGOL = 0x05B1, HATAF_PATAH = 0x05B2, HATAF_QAMATS = 0x05B3,
        HIRIQ = 0x05B4, TSERE = 0x05B5, SEGOL = 0x05B6, PATAH = 0x05B7, QAMATS = 0x05B8,
        HOLAM = 0x05B9, HOLAM_HASER = 0x05BA, QUBUTS = 0x05BB, DAGESH = 0x05BC,
        SHIN_DOT = 0x05C1, SIN_DOT = 0x05C2, QAMATS_QATAN = 0x05C7;

  const VOWELS = new Set([SHEVA, HATAF_SEGOL, HATAF_PATAH, HATAF_QAMATS, HIRIQ, TSERE,
    SEGOL, PATAH, QAMATS, HOLAM, HOLAM_HASER, QUBUTS, QAMATS_QATAN]);

  const isHebrewLetter = c => c >= 0x05D0 && c <= 0x05EA;
  const isMark = c => (c >= 0x0591 && c <= 0x05C7); // niqqud + cantillation

  // base consonant -> [soft, hard(with dagesh)]
  const CONS = {
    0x05D0: ['', ''],        // alef (silent carrier)
    0x05D1: ['v', 'b'],      // bet
    0x05D2: ['g', 'g'],      // gimel
    0x05D3: ['d', 'd'],      // dalet
    0x05D4: ['h', 'h'],      // he (final handled separately)
    0x05D6: ['z', 'z'],      // zayin
    0x05D7: ['ch', 'ch'],    // het
    0x05D8: ['t', 't'],      // tet
    0x05DA: ['ch', 'k'],     // final kaf
    0x05DB: ['ch', 'k'],     // kaf
    0x05DC: ['l', 'l'],      // lamed
    0x05DD: ['m', 'm'],      // final mem
    0x05DE: ['m', 'm'],      // mem
    0x05DF: ['n', 'n'],      // final nun
    0x05E0: ['n', 'n'],      // nun
    0x05E1: ['s', 's'],      // samekh
    0x05E2: ['', ''],        // ayin (silent)
    0x05E3: ['f', 'p'],      // final pe
    0x05E4: ['f', 'p'],      // pe
    0x05E5: ['tz', 'tz'],    // final tsadi
    0x05E6: ['tz', 'tz'],    // tsadi
    0x05E7: ['k', 'k'],      // qof
    0x05E8: ['r', 'r'],      // resh
    0x05EA: ['t', 't']       // tav
    // vav (05D5), yod (05D9), shin (05E9) handled specially
  };

  function vowelSound(mark) {
    switch (mark) {
      case HIRIQ: return 'i';
      case TSERE: case SEGOL: case HATAF_SEGOL: return 'e';
      case PATAH: case QAMATS: case HATAF_PATAH: return 'a';
      case QAMATS_QATAN: case HATAF_QAMATS: return 'o';
      case HOLAM: case HOLAM_HASER: return 'o';
      case QUBUTS: return 'u';
      default: return '';
    }
  }

  // Split into units: { base, marks:Set, isLetter }
  function units(text) {
    const out = [];
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c === 0x7C) continue;                 // "|" = Dicta morpheme boundary, not pronounced
      if (c === 0x05BE) { out.push({ base: 0, marks: new Set(), nonletter: ' ' }); continue; } // maqaf -> space
      if (isHebrewLetter(c)) out.push({ base: c, marks: new Set(), nonletter: null });
      else if (isMark(c)) { if (out.length && out[out.length - 1].base) out[out.length - 1].marks.add(c); }
      else out.push({ base: 0, marks: new Set(), nonletter: ch }); // space / punctuation passthrough
    }
    return out;
  }

  // Romanize a single Hebrew word (already split into letter-units).
  function word(us) {
    let res = '';
    let lastVowel = null;      // last vowel sound emitted (for matres yod)
    let prevHadVowel = false;  // did the previous consonant carry a vowel?
    const letters = us.filter(u => u.base);

    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      const c = u.base, m = u.marks;
      const dagesh = m.has(DAGESH);
      const idxLetters = letters.indexOf(u);
      const isFirst = idxLetters === 0;
      const isLast = idxLetters === letters.length - 1;

      // vowel mark on this letter (first vowel mark found)
      let vmark = null;
      for (const x of m) if (VOWELS.has(x)) { vmark = x; break; }

      // --- VAV ---
      if (c === 0x05D5) {
        const hasHolam = m.has(HOLAM) || m.has(HOLAM_HASER);
        if (hasHolam) { res += 'o'; lastVowel = 'o'; prevHadVowel = true; continue; }     // holam male: וֹ = o
        if (dagesh && vmark === null) { res += 'u'; lastVowel = 'u'; prevHadVowel = true; continue; } // shuruk: וּ = u
        // bare vav after a vowel = mater lectionis (defective holam, e.g. בֹּוקֶר = boker), silent
        if (vmark === null && prevHadVowel) continue;
        // consonantal vav
        let v = vmark === SHEVA ? shevaSound(c, isFirst) : vowelSound(vmark);
        res += 'v' + v; lastVowel = v || lastVowel; prevHadVowel = !!v; continue;
      }

      // --- YOD ---
      if (c === 0x05D9) {
        // geminated yod (dagesh) is a real consonant, not a glide: הַיּוֹם = ha-yom
        const bareOrShevaGlide = !dagesh && (vmark === null || vmark === SHEVA) && !m.has(SHIN_DOT) && !m.has(SIN_DOT);
        if (bareOrShevaGlide) {
          // mater / glide based on the previous vowel
          if (lastVowel === 'e' || lastVowel === 'a' || lastVowel === 'o' || lastVowel === 'u') {
            res += 'i'; lastVowel = 'i'; prevHadVowel = true; continue;
          }
          if (lastVowel === 'i') { prevHadVowel = true; continue; } // hiriq male, already 'i'
          if (vmark === null) { res += 'y'; prevHadVowel = false; continue; } // consonantal yod
        }
        let v = vmark === SHEVA ? shevaSound(c, isFirst) : vowelSound(vmark);
        res += 'y' + v; lastVowel = v || lastVowel; prevHadVowel = !!v; continue;
      }

      // --- SHIN / SIN ---
      if (c === 0x05E9) {
        const cons = m.has(SIN_DOT) ? 's' : 'sh';
        let v = vmark === SHEVA ? shevaSound(c, isFirst) : vowelSound(vmark);
        res += cons + v; lastVowel = v || lastVowel; prevHadVowel = !!v; continue;
      }

      // --- furtive patach: final ח after a vowel sounds "a" BEFORE the guttural
      //     (פָּתוּחַ = pa-tu-ach, not pa-tu-cha) ---
      if (c === 0x05D7 && isLast && prevHadVowel && vmark === PATAH) {
        res += 'ach'; lastVowel = 'a'; prevHadVowel = true; continue;
      }

      // --- HE: silent at word end (no mappiq dagesh) ---
      if (c === 0x05D4 && isLast && !dagesh) {
        let v = vowelSound(vmark);
        res += v; if (v) { lastVowel = v; prevHadVowel = true; }
        continue;
      }

      // --- generic consonant ---
      const pair = CONS[c];
      if (!pair) { if (u.nonletter) res += u.nonletter; continue; }
      const cons = dagesh ? pair[1] : pair[0];
      let v;
      if (vmark === SHEVA) v = shevaSound(c, isFirst);
      else v = vowelSound(vmark);
      res += cons + v;
      if (v) { lastVowel = v; prevHadVowel = true; }
      else { prevHadVowel = false; if (cons === '') { /* silent carrier, keep lastVowel */ } }
    }
    return res;
  }

  // sheva: in modern Israeli speech most shevas are silent. The reliably-pronounced
  // case is the initial one-letter proclitic prefixes be/ve/ke/le/me (ב ו כ ל מ),
  // e.g. לְךָ = le-cha. Everything else (root-initial clusters like סְלִיחָה = slicha,
  // and medial shevas) is dropped. Shin is excluded on purpose (root שׁל = shl, not she).
  const PREFIX_SHEVA = new Set([0x05D1, 0x05D5, 0x05DB, 0x05DC, 0x05DE]);
  function shevaSound(letter, isFirst) {
    if (isFirst && PREFIX_SHEVA.has(letter)) return 'e';
    return '';
  }

  function transliterate(text) {
    if (!text) return '';
    const us = units(text);
    // split on non-letters into words, transliterate each, rejoin with the separators
    let out = '';
    let buf = [];
    const flush = () => { if (buf.length) { out += word(buf); buf = []; } };
    for (const u of us) {
      if (u.base) buf.push(u);
      else { flush(); out += (u.nonletter || ''); }
    }
    flush();
    return out.replace(/\s+/g, ' ').trim();
  }

  const api = { transliterate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Translit = api;
})(typeof window !== 'undefined' ? window : globalThis);
