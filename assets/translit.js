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

  /* --- Syllable stress ---------------------------------------------------------------------
   *
   * Hebrew stress is mostly final (milra) — measured 110/139 multi-syllable words in the
   * curated phrasebook (data/phrasebook.json, hand-verified `tr` with hyphens + CAPS). That is
   * the default below. The 29 exceptions were analyzed by cross-tabulating each word's FINAL
   * syllable shape (nucleus vowel x open/closed) against its measured stress, not guessed from
   * grammar (see tools/translit-test.cjs for the reproducible accuracy check). Three shapes came
   * out 100% clean with zero contradictions and are implemented as general rules; everything
   * else that could not be reduced to a clean rule is a small, named, measured exception list.
   */
  function vmarkOf(u) {
    for (const x of u.marks) if (VOWELS.has(x)) return x;
    return null;
  }

  // Is the word's FINAL syllable an unstressable "helper" vowel, so stress retreats one
  // syllable back? All three rules were tested against every multi-syllable word in the
  // phrasebook and hold with ZERO contradictions at the scope written here — each comment
  // states the measured count and the closest contradiction found, so the scope is not
  // guessed narrower than necessary nor generalized past what was checked.
  function finalSyllableUnstressable(letters) {
    const n = letters.length;
    if (n < 2) return false;
    const last = letters[n - 1], prev = letters[n - 2];
    const lastV = vmarkOf(last);
    // Rule F — classic furtive patach: the guttural (ח/ע) IS the final letter and carries the
    // patach itself. יוֹדֵעַ yode'a, שָׂמֵחַ sameach, פָּתוּחַ patuach — 3/3, 0 contradictions.
    if ((last.base === 0x05D7 || last.base === 0x05E2) && lastV === PATAH) return true;
    // Rule T — trailing SILENT ayin after a patah: the ayin carries no sound at all, so the
    // syllable it silently trails never gets to be "truly final" for stress purposes — same
    // mechanism as Rule F, different trigger shape. רֶגַע rega, אַרְבַּע arba, שֶׁבַע sheva,
    // תֵּשַׁע tesha — 4/4, 0 contradictions. Scoped to ayin (not alef: the corpus's trailing-mute
    // -alef words are all qamats/tsere and all final-stressed) and to patah specifically
    // (נִשְׁמָע nishma trails a silent ayin too but after QAMATS, and is final — excluded by
    // requiring lastV===null here and prev vowel===PATAH, not by word list).
    if (last.base === 0x05E2 && lastV === null && prev && vmarkOf(prev) === PATAH) return true;
    // Rule S — segolate nucleus: final syllable closes on a SEGOL with one real (non-mater,
    // non-alef/ayin) consonant. בְּסֵדֶר seder, בּוֹקֶר boker, עֶרֶב erev, כֶּסֶף kesef, עֶשֶׂר eser —
    // 6/6, 0 contradictions. Deliberately NOT extended to patah-closed (בֶּטַח betakh is
    // penultimate but לְאַט le-AT has the identical final shape and is final-stressed — a real
    // measured contradiction, n=2 — so patah-closed stays lexical, see STRESS_EXCEPTIONS_PENULT)
    // nor to qamats/holam/tsere-closed (each measured 100% final in the corpus, see
    // tools/translit-test.cjs's cross-tab dump).
    if (lastV === null && last.base !== 0x05D4 && last.base !== 0x05D0 && last.base !== 0x05E2 &&
        prev && vmarkOf(prev) === SEGOL) return true;
    // Rule D — the -ayim / -ayit shape (dual and a family of common nouns): a yod carrying HIRIQ
    // as the final nucleus, with a PATAH on the letter before it. בַּיִת BA-yit, מַיִם MA-yim,
    // שְׁתַּיִם SHTA-yim, שָׁמַיִם sha-MA-yim, יָדַיִם ya-DA-yim, עַיִן A-yin — penultimate, every one.
    // The phrasebook has two of these and they were being carried as lexical exceptions; they are
    // not lexical, they are this shape, which is why held-out בַּיִת and שָׁמַיִם both came out wrong
    // (74% on 19 held-out words vs 100% on the corpus the rules were tuned against). Narrow on
    // purpose: the nucleus letter must be yod. עִבְרִית iv-RIT and תַּלְמִיד tal-MID carry hiriq on an
    // ordinary consonant and stay final-stressed.
    if (prev && prev.base === 0x05D9 && vmarkOf(prev) === HIRIQ && lastV === null) {
      const before = n >= 3 ? letters[n - 3] : null;
      if (before && vmarkOf(before) === PATAH) return true;
    }
    return false;
  }

  // A sheva that resolves silent (nach) via shevaSound's cluster-onset branch (word-initial, or
  // the 2nd of two consecutive shevas, AND the cluster it forms with the NEXT consonant is
  // pronounceable) is deliberately joining THAT consonant's onset, not closing what precedes:
  // אַנְגְּלִית's גּ is the 2nd of two shevas and clusters fine with ל (g+l, rising sonority) — it
  // must stay pending so the boundary lands "an-GLIT", not lock into "ang-LIT". An ordinary
  // single medial sheva-nach (not word-initial, not the 2nd of a pair) is a real coda and DOES
  // close the syllable before it: לַמִּשְׁטָרָה's שׁ locks "mish" before ת opens "ta". Needed
  // because shevaSound() returns '' (silent) for BOTH cases; only this second call distinguishes
  // WHY it is silent, purely to decide where the syllable boundary falls (the phoneme output —
  // shevaSound's return value itself — is untouched).
  function shevaDefersToNext(u, isFirst, next, wasSheva) {
    return (isFirst || wasSheva) && clusterOk(consOf(u), consOf(next));
  }

  // Reconstruct the plain (unromanized) Hebrew for a word's letter-units, NFC-normalized, for
  // the exception lookup below. Marks are stored per-unit in a Set (insertion order = source
  // text order after normalizeDicta's NFC pass), so this round-trips reliably.
  function hebrewKey(us) {
    let s = '';
    for (const u of us) {
      if (!u.base) continue;
      s += String.fromCodePoint(u.base);
      for (const m of u.marks) s += String.fromCodePoint(m);
    }
    return s.normalize('NFC');
  }

  // Small, explicit, MEASURED stress exceptions — every entry checked against phrasebook.json's
  // hand-verified `tr`. None of these are guessed; each is a case where the rules above are
  // proven insufficient (checked, not assumed) and the word falls into a closed, bounded,
  // high-frequency class rather than an open-ended pattern:
  //
  //  interrogatives (closed grammatical class): לָמָּה כַּמָּה אֵיפֹה — 3/3 measured penultimate.
  //  directional-he ה"א המגמה, "toward X" (closed class; the suffix never bears stress, but is
  //    NOT distinguishable from the ordinary feminine qamats+he ending by niqqud alone —
  //    תּוֹדָה toda has the identical final shape and is final-stressed): שְׂמֹאלָה smola,
  //    יְמִינָה yemina — 2/2 measured penultimate.
  //  numerals not covered by a rule above (see NUM_UNITS/NUM_TENS — most numerals already fall
  //    under Rule T or Rule S; only these two don't): שְׁתַּיִם shtayim (hiriq-closed, no rule
  //    covers it), שְׁמוֹנֶה shmone (segol + silent-he, that shape is final in every OTHER
  //    measured word — מְעוּלֶה עוֹלֶה רוֹצֶה קָפֶה יָפֶה — 8/9 in that bucket, shmone is the one).
  //  lexical / no productive rule available, each independently measured, NOT generalized to a
  //    suffix or word-family rule (the closest such generalization was tried and contradicted —
  //    see finalSyllableUnstressable's comment on אַחַר/אַחַת):
  //    לַיְלָה layla — identical final shape (qamats + silent he) as תּוֹדָה toda (final); no
  //      niqqud-only signal separates them, this is a lexical/historical fact.
  //    סַבַּבָּה sababa — slang loanword, arbitrary stress.
  //    בֶּטַח betakh — see Rule S comment (patah-closed, contradicted by לְאַט le-AT).
  //    מַיִם mayim — ancient irregular "dual-form" noun (with panim, shamayim — not in corpus).
  //    הַצִּילוּ hatzilu — n=1 for the imperative -u suffix; NOT generalized (untested elsewhere).
  //    יוֹדַעַת yodaat, מִרְקַחַת mirkakhat — guttural+patah+bare-suffix-consonant, but the SAME
  //      shape on אַחַר/אַחַת is final-stressed (measured contradiction) — see finalSyllableUnstressable.
  const STRESS_EXCEPTIONS_PENULT = new Set([
    'לָמָּה', 'כַּמָּה', 'אֵיפֹה',
    'שְׂמֹאלָה', 'יְמִינָה',
    'שְׁתַּיִם', 'שְׁמוֹנֶה',
    'לַיְלָה', 'סַבַּבָּה', 'בֶּטַח', 'מַיִם', 'הַצִּילוּ', 'יוֹדַעַת', 'מִרְקַחַת'
  ].map((s) => s.normalize('NFC')));

  // Romanize a single Hebrew word (already split into letter-units).
  //
  // Syllable boundaries are recorded ALONGSIDE res as it is built, at zero risk to the phoneme
  // string itself: openSyllable()/lockOnset() only ever record positions into `boundaries` /
  // `pendingOnsetStart`, called from the exact same branches that already decide a vowel is
  // being emitted. Nothing about what gets appended to res changes as a result.
  function word(us) {
    let res = '';
    let lastVowel = null;      // last vowel sound emitted (for matres yod)
    let prevHadVowel = false;  // did the previous consonant carry a vowel?
    let prevWasSheva = false;  // did the previous letter carry a sheva? (2nd of two = na)
    const letters = us.filter(u => u.base);

    const boundaries = [];         // res.length offsets where a NEW syllable begins
    let sawNucleus = false;        // has any syllable nucleus appeared yet in this word?
    let pendingOnsetStart = 0;     // earliest res offset belonging to the NOT-YET-OPENED next syllable
    // A run of consonants with NO vowel mark at all (not even sheva) sitting right before a
    // fresh nucleus is that nucleus's ONSET, not the coda of what came before it: in שָׁלוֹם the
    // bare ל belongs to "lom" (sha-LOM ground truth), not to "sha". Such a run is never locked
    // in by lockOnset() below, so pendingOnsetStart still points to before it when the next
    // nucleus opens. Call openSyllable() right BEFORE appending a fresh nucleus's text.
    const openSyllable = () => { if (sawNucleus) boundaries.push(pendingOnsetStart); sawNucleus = true; };
    // Call AFTER appending a nucleus, a glide that extends one, or an explicit sheva-NACH
    // consonant (silent but MARKED — it closes the syllable it follows, e.g. מִרְקַחַת's ר,
    // לַמִּשְׁטָרָה's שׁ). Locks everything appended so far onto the syllable just finished.
    const lockOnset = () => { pendingOnsetStart = res.length; };

    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      const c = u.base, m = u.marks;
      const dagesh = m.has(DAGESH);
      const idxLetters = letters.indexOf(u);
      const isFirst = idxLetters === 0;
      const isLast = idxLetters === letters.length - 1;
      const nextLetter = idxLetters >= 0 ? letters[idxLetters + 1] : null;
      const wasSheva = prevWasSheva;

      // vowel mark on this letter (first vowel mark found)
      let vmark = null;
      for (const x of m) if (VOWELS.has(x)) { vmark = x; break; }
      // Record for the NEXT letter before any branch returns: two consecutive shevas mean the
      // second one is na (עַצְמְךָ = atz-me-cha). `wasSheva` above already holds the previous state.
      prevWasSheva = (vmark === SHEVA);

      // --- VAV ---
      if (c === 0x05D5) {
        const hasHolam = m.has(HOLAM) || m.has(HOLAM_HASER);
        if (hasHolam) { openSyllable(); res += 'o'; lockOnset(); lastVowel = 'o'; prevHadVowel = true; continue; }     // holam male: וֹ = o
        if (dagesh && vmark === null) { openSyllable(); res += 'u'; lockOnset(); lastVowel = 'u'; prevHadVowel = true; continue; } // shuruk: וּ = u
        // A bare vav after a vowel is only a mater lectionis when it spells that vowel — i.e. a
        // defective holam/shuruk (בֹּוקֶר = boker). After any OTHER vowel it is a real consonant,
        // and dropping it deleted a whole letter: עַכְשָׁיו -> "achshai" (achshav), תָּו -> "ta"
        // (tav), סְתָיו -> "stai" (stav).
        if (vmark === null && prevHadVowel && (lastVowel === 'o' || lastVowel === 'u')) continue;
        // consonantal vav
        let v = vmark === SHEVA ? shevaSound(u, isFirst, nextLetter, wasSheva) : vowelSound(vmark);
        if (v) openSyllable();
        res += 'v' + v;
        if (v || (vmark === SHEVA && !shevaDefersToNext(u, isFirst, nextLetter, wasSheva))) lockOnset();
        lastVowel = v || lastVowel; prevHadVowel = !!v; continue;
      }

      // --- YOD ---
      if (c === 0x05D9) {
        // geminated yod (dagesh) is a real consonant, not a glide: הַיּוֹם = ha-yom
        const bareOrShevaGlide = !dagesh && (vmark === null || vmark === SHEVA) && !m.has(SHIN_DOT) && !m.has(SIN_DOT);
        // The ־ָיו ending: yod + final bare vav spells plain "av", the yod is silent
        // (עַכְשָׁיו = achshav, סְתָיו = stav — not "achshaiv"/"staiv").
        if (bareOrShevaGlide && vmark === null && nextLetter && nextLetter.base === 0x05D5 &&
            !nextLetter.marks.has(DAGESH) && ![...nextLetter.marks].some(x => VOWELS.has(x)) &&
            letters.indexOf(nextLetter) === letters.length - 1) {
          prevHadVowel = true; continue;
        }
        if (bareOrShevaGlide) {
          // mater / glide based on the previous vowel
          if (lastVowel === 'e' || lastVowel === 'a' || lastVowel === 'o' || lastVowel === 'u') {
            res += 'i'; lockOnset(); lastVowel = 'i'; prevHadVowel = true; continue;
          }
          if (lastVowel === 'i') { prevHadVowel = true; continue; } // hiriq male, already 'i'
          // consonantal yod with no vowel of its own yet — an onset consonant, not a coda: leave
          // pendingOnsetStart alone so it (like שָׁלוֹם's bare ל) joins whichever syllable opens next.
          if (vmark === null) { res += 'y'; prevHadVowel = false; continue; }
        }
        let v = vmark === SHEVA ? shevaSound(u, isFirst, nextLetter, wasSheva) : vowelSound(vmark);
        if (v) openSyllable();
        res += 'y' + v;
        if (v || (vmark === SHEVA && !shevaDefersToNext(u, isFirst, nextLetter, wasSheva))) lockOnset();
        lastVowel = v || lastVowel; prevHadVowel = !!v; continue;
      }

      // --- SHIN / SIN ---
      if (c === 0x05E9) {
        const cons = m.has(SIN_DOT) ? 's' : 'sh';
        let v = vmark === SHEVA ? shevaSound(u, isFirst, nextLetter, wasSheva) : vowelSound(vmark);
        if (v) openSyllable();
        res += cons + v;
        if (v || (vmark === SHEVA && !shevaDefersToNext(u, isFirst, nextLetter, wasSheva))) lockOnset();
        lastVowel = v || lastVowel; prevHadVowel = !!v; continue;
      }

      // --- furtive patach: final ח after a vowel sounds "a" BEFORE the guttural
      //     (פָּתוּחַ = pa-tu-ach, not pa-tu-cha) ---
      if (c === 0x05D7 && isLast && prevHadVowel && vmark === PATAH) {
        openSyllable(); // its own syllable for splitting (pa-TU-akh), even though Rule F never stresses it
        res += 'ach'; lockOnset(); lastVowel = 'a'; prevHadVowel = true; continue;
      }

      // --- HE: silent at word end (no mappiq dagesh) ---
      if (c === 0x05D4 && isLast && !dagesh) {
        let v = vowelSound(vmark);
        if (v) openSyllable();
        res += v; if (v) { lockOnset(); lastVowel = v; prevHadVowel = true; }
        continue;
      }

      // --- generic consonant ---
      const pair = CONS[c];
      if (!pair) { if (u.nonletter) res += u.nonletter; continue; }
      const cons = dagesh ? pair[1] : pair[0];
      let v;
      if (vmark === SHEVA) v = shevaSound(u, isFirst, nextLetter, wasSheva);
      else v = vowelSound(vmark);
      if (v) openSyllable();
      res += cons + v;
      // sheva-NACH (silent but explicitly marked) closes the syllable before it; a letter with
      // NO mark at all (vmark===null, e.g. bare alef/ayin carriers) stays pending — it is onset
      // material for whatever nucleus opens next, exactly like שָׁלוֹם's bare ל.
      if (v || (vmark === SHEVA && !shevaDefersToNext(u, isFirst, nextLetter, wasSheva))) lockOnset();
      if (v) { lastVowel = v; prevHadVowel = true; }
      else { prevHadVowel = false; if (cons === '') { /* silent carrier, keep lastVowel */ } }
    }

    if (!boundaries.length) return res;     // single syllable: nothing to mark (ken, lo, tov...)
    const syl = [];
    { let start = 0; for (const b of boundaries) { syl.push(res.slice(start, b)); start = b; } syl.push(res.slice(start)); }
    const fromEnd = STRESS_EXCEPTIONS_PENULT.has(hebrewKey(us)) ? 1
      : finalSyllableUnstressable(letters) ? 1
      : 0;
    const stressIdx = Math.max(0, syl.length - 1 - fromEnd);
    return syl.map((s, i) => (i === stressIdx ? s.toUpperCase() : s)).join('-');
  }

  /* sheva na (pronounced "e") vs sheva nach (silent).
   *
   * The old rule keyed on letter IDENTITY — "word-initial ב ו כ ל מ = e" — as a proxy for "is
   * this a proclitic prefix?". It cannot be: the SAME letter goes both ways (בְּלִי = bli but
   * בְּסֵדֶר = beseder), so it failed in both directions at once:
   *     false 'e': כְּנִיסָה->kenisa (knisa) · בְּלִי->beli (bli) · בְּרָכָה->beracha (bracha)
   *     missed 'e': יְלָדִים->yladim (yeladim) · נְדַבֵּר->ndaber · רְחוֹב->rchov (rechov)
   *
   * Nor can the Dicta Worker fix it, despite the obvious hope: Nakdan returns an IDENTICAL plain
   * sheva for כְּנִיסָה (silent) and יְלָדִים (pronounced) — verified against its raw API, whose
   * per-word payload is only [vocalized, [[morphcode, lemma, bool]]]. There is no na/nach flag to
   * read. The distinction is not in the niqqud at all.
   *
   * What actually governs it in Israeli Hebrew is PHONOTACTICS: the sheva goes silent only when
   * the two consonants form a pronounceable onset cluster. Derived from the 33 word-initial sheva
   * cases in the curated phrasebook (hand-authored `tr` = ground truth), four forces decide:
   *   1. sibilant onset — s/sh + anything is always legal (סְלִיחָה slicha, שְׁתַּיִם shtayim,
   *      שְׁמוֹנֶה shmone, שְׂמֹאלָה smola), even where sonority falls;
   *   2. gutturals never cluster (בְּעָיָה be-aya, מְאוֹד me-od, רְחוֹב rechov, לְךָ lecha);
   *   3. homorganic pairs are blocked — same place of articulation can't cluster
   *      (בְּבַקָּשָׁה be-vakasha b+v both labial; תְּדַבֵּר te-daber t+d both alveolar);
   *   4. otherwise the cluster needs RISING sonority (bli 1<4, knisa 1<3, ktsat 1<2), or a
   *      same-voicing stop plateau (כְּתוֹבֶת ktovet k+t both voiceless — while בְּתֵאָבוֹן
   *      be-teavon is blocked, b voiced + t voiceless).
   * Medially, the classical rule applies and IS readable from the niqqud: the second of two
   * consecutive shevas is na (עַצְמְךָ = atz-me-cha).
   */
  const SONORITY = { b: 1, g: 1, d: 1, t: 1, k: 1, p: 1,
                     v: 2, z: 2, ch: 2, s: 2, sh: 2, f: 2, tz: 2, h: 2,
                     m: 3, n: 3, l: 4, r: 4, y: 5 };
  const PLACE = { b: 'lab', v: 'lab', f: 'lab', p: 'lab', m: 'lab',
                  d: 'alv', t: 'alv', s: 'alv', z: 'alv', tz: 'alv', n: 'alv', l: 'alv', r: 'alv',
                  sh: 'post', y: 'pal', g: 'vel', k: 'vel', ch: 'vel', h: 'glo' };
  const VOICED = new Set(['b', 'g', 'd', 'v', 'z', 'm', 'n', 'l', 'r', 'y']);

  // Resolve a letter-unit to its consonant sound, so clusters can be tested before the main
  // loop reaches the second letter.
  function consOf(u) {
    if (!u || !u.base) return '';
    const c = u.base;
    if (c === 0x05E9) return u.marks.has(SIN_DOT) ? 's' : 'sh';
    if (c === 0x05D9) return 'y';
    const pair = CONS[c];
    if (!pair) return '';
    return u.marks.has(DAGESH) ? pair[1] : pair[0];
  }

  function clusterOk(c1, c2) {
    if (!c1 || !c2) return false;                 // alef/ayin resolve to '' -> never cluster
    if (c1 === 's' || c1 === 'sh') return true;   // 1. sibilant onset
    if (c2 === 'h' || c2 === 'ch') return false;  // 2. guttural second member
    if (PLACE[c1] && PLACE[c1] === PLACE[c2]) return false;  // 3. homorganic
    const s1 = SONORITY[c1], s2 = SONORITY[c2];
    if (!s1 || !s2) return false;
    // 4. Sonority must rise, and a rise of only ONE step (stop -> fricative) is too shallow to
    //    carry the cluster on its own: it also needs voicing agreement. That single distinction
    //    separates קְצָת ktsat (k+tz, both voiceless) from בְּסֵדֶר be-seder (b voiced + s
    //    voiceless), and כְּתוֹבֶת ktovet (k+t) from בְּתֵאָבוֹן be-teavon (b+t) at the plateau.
    if (s2 - s1 >= 2) return true;                                       // clear rise: bli, knisa
    if (s2 - s1 === 1) return VOICED.has(c1) === VOICED.has(c2);         // shallow rise
    if (s1 === s2 && s1 === 1) return VOICED.has(c1) === VOICED.has(c2); // stop plateau
    return false;
  }

  function shevaSound(u, isFirst, next, prevWasSheva) {
    // Word-initially and after another sheva, the sheva is only silent if the resulting cluster
    // is pronounceable. The classical rule ("second of two shevas is na") is right about WHERE to
    // look but too absolute for modern speech: אַנְגְּלִית is anglit, not an-ge-lit, because g+l
    // clusters happily — while עַצְמְךָ is atz-me-cha, because m+ch cannot.
    if (isFirst || prevWasSheva) return clusterOk(consOf(u), consOf(next)) ? '' : 'e';
    return '';
  }

  // Dicta (via the morphology Worker) encodes holam-male and shuruk as a vowel on the CONSONANT
  // plus a bare mater vav — תָּוכְנִית for תּוֹכְנִית, הָאֻולְפָּן for הָאוּלְפָּן — and sprinkles
  // meteg. Fed that raw, translit.js read the qamats as "a" and the vav as a consonant, turning
  // tochnit into "tavchnit" on every phrase the live translator routes through the Worker. Rewrite
  // Dicta's spelling to standard before the main loop. The vav must be a bare mater (no mark of its
  // own) with a letter after it, which leaves word-final consonantal vav — תָּו (tav), סְתָיו
  // (stav) — untouched.
  function normalizeDicta(s) {
    s = s.normalize('NFC').replace(/ֽ/g, '');                                     // strip meteg
    // Order-agnostic on the marks around the qamats/qubuts: NFC sorts combining marks by class, so
    // a dagesh lands BETWEEN the qamats and the vav (תּ -> tav, qamats, dagesh, vav). A regex that
    // expects dagesh-then-qamats matches nothing — the exact trap that silently defeated the first
    // version of this fold. Keep every mark except the qamats/qubuts, drop that, holam/shuruk the vav.
    s = s.replace(/([א-ת])([֑-ׇ]*)ָ([֑-ׇ]*)ו(?![֑-ׇ])(?=[א-ת])/g, (_, c, a, b) => c + a + b + 'וֹ'); // holam male
    s = s.replace(/([א-ת])([֑-ׇ]*)ֻ([֑-ׇ]*)ו(?![֑-ׇ])(?=[א-ת])/g, (_, c, a, b) => c + a + b + 'וּ'); // shuruk
    return s.normalize('NFC');
  }

  function transliterate(text) {
    if (!text) return '';
    const us = units(normalizeDicta(text));
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

  // --- Numbers -> Hebrew words -------------------------------------------------------------
  // The translator shows "ani ben 33"; a learner needs "ani ben shloshim ve shalosh". We spell
  // the integer in vocalized Hebrew (feminine / absolute forms — the counting default, and what
  // age takes: בן שלושים ושלוש) and let transliterate() romanize it, so the number reads in the
  // app's own scheme. 0-999; larger values are left as digits (construct plurals like שלושת
  // אלפים are irregular and rare in the translator — not worth teaching a wrong form).
  const NUM_UNITS = ['אֶפֶס', 'אַחַת', 'שְׁתַּיִם', 'שָׁלוֹשׁ', 'אַרְבַּע', 'חָמֵשׁ', 'שֵׁשׁ', 'שֶׁבַע', 'שְׁמוֹנֶה', 'תֵּשַׁע'];
  const NUM_TEENS = ['עֶשֶׂר', 'אַחַת עֶשְׂרֵה', 'שְׁתֵּים עֶשְׂרֵה', 'שְׁלוֹשׁ עֶשְׂרֵה', 'אַרְבַּע עֶשְׂרֵה', 'חֲמֵשׁ עֶשְׂרֵה', 'שֵׁשׁ עֶשְׂרֵה', 'שְׁבַע עֶשְׂרֵה', 'שְׁמוֹנֶה עֶשְׂרֵה', 'תְּשַׁע עֶשְׂרֵה'];
  const NUM_TENS = ['', '', 'עֶשְׂרִים', 'שְׁלוֹשִׁים', 'אַרְבָּעִים', 'חֲמִשִּׁים', 'שִׁשִּׁים', 'שִׁבְעִים', 'שְׁמוֹנִים', 'תִּשְׁעִים'];
  const NUM_HUNDREDS = ['', 'מֵאָה', 'מָאתַיִם', 'שְׁלוֹשׁ מֵאוֹת', 'אַרְבַּע מֵאוֹת', 'חֲמֵשׁ מֵאוֹת', 'שֵׁשׁ מֵאוֹת', 'שְׁבַע מֵאוֹת', 'שְׁמוֹנֶה מֵאוֹת', 'תְּשַׁע מֵאוֹת'];

  // The conjunctive vav on the last component: וְ, but וּ before a shva and וַ/וֶ before a chataf.
  function conjVav(w) {
    if (/^[א-ת][ּׁׂ]*ְ/.test(w)) return 'וּ' + w;
    if (/^[א-ת][ּׁׂ]*ֲ/.test(w)) return 'וַ' + w;
    if (/^[א-ת][ּׁׂ]*ֱ/.test(w)) return 'וֶ' + w;
    return 'וְ' + w;
  }

  // Components of n (0..999) as vocalized Hebrew words WITHOUT the conjunctive vav, or null.
  function numberParts(n) {
    if (!Number.isInteger(n) || n < 0 || n > 999) return null;
    if (n === 0) return ['אֶפֶס'];
    const parts = [];
    const h = Math.floor(n / 100), rem = n % 100;
    if (h) parts.push(NUM_HUNDREDS[h]);
    if (rem >= 10 && rem <= 19) parts.push(NUM_TEENS[rem - 10]);
    else {
      const t = Math.floor(rem / 10), u = rem % 10;
      if (t) parts.push(NUM_TENS[t]);
      if (u) parts.push(NUM_UNITS[u]);
    }
    return parts;
  }

  // { he, tr } for an integer, or null. The Hebrew keeps the conjunctive vav attached to the last
  // word (correct orthography: וְשָׁלוֹשׁ). The romanization spaces it — "shloshim ve shalosh" —
  // because that reads far better for a learner than the glued "veshalosh".
  function spellNumber(n) {
    const parts = numberParts(n);
    if (!parts) return null;
    const last = parts[parts.length - 1];
    const he = parts.length === 1 ? parts[0]
      : parts.slice(0, -1).join(' ') + ' ' + conjVav(last);
    const trParts = parts.map(transliterate);
    let tr;
    if (trParts.length === 1) tr = trParts[0];
    else {
      const conj = /^[א-ת][ּׁׂ]*ְ/.test(last) ? 'u' : /^[א-ת][ּׁׂ]*ֲ/.test(last) ? 'va' : 've';
      tr = trParts.slice(0, -1).join(' ') + ' ' + conj + ' ' + trParts[trParts.length - 1];
    }
    return { he, tr };
  }

  // Replace standalone integer runs in a romanization with their spelled form (for the
  // translator: "ani ben 33" -> "ani ben shloshim ve shalosh"). Out-of-range digits stay.
  function spellNumbersInText(tr) {
    return (tr || '').replace(/\d+/g, (d) => {
      if (d.length > 1 && d[0] === '0') return d;   // 054, 007 -> phone/id, read digit by digit
      const s = spellNumber(parseInt(d, 10));
      return s ? s.tr : d;
    });
  }

  /*
   * The conservative subset of the fold above, safe to apply to Hebrew we SHOW.
   *
   * normalizeDicta itself must stay internal to transliterate(). Its qamats/qubuts rules cannot
   * tell a mater lectionis from a consonantal vav, so they rewrite double-vav loanwords —
   * שָׁווַרְמָה becomes שׁוֹוַרְמָה, וָואלָּה becomes ווֹאלָּה. Measured on 8956 verified strings from the
   * phrasebook, the expressions and the lessons: 31 such rewrites. Harmless while the fold only
   * ever fed romanization, corrupting the moment it reaches the screen.
   *
   * What IS safe to show:
   *  - stripping the stray meteg (zero legitimate metegs in those same 8956 strings)
   *  - moving a holam parked on the consonant onto the bare vav that follows it (בֹּוקֶר -> בּוֹקֶר)
   *
   * The bearer is matched as [א-הז-ת] — every Hebrew letter EXCEPT vav. Without that exclusion the
   * rule re-matches the וֹ it just produced and folds it again on the next pass: not idempotent,
   * and it eats the same double-vav words. Idempotence is asserted in tools/translit-test.cjs.
   */
  function cleanDictaForDisplay(s) {
    if (!s) return s;
    s = s.normalize('NFC').replace(/ֽ/g, '');
    s = s.replace(/([א-הז-ת])([֑-ׇ]*)ֹ([֑-ׇ]*)ו(?![֑-ׇ])(?=[א-ת])/g, (_, c, a, b) => c + a + b + 'וֹ');
    return s.normalize('NFC');
  }

  const api = { transliterate, spellNumber, spellNumbersInText, cleanDictaForDisplay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Translit = api;
})(typeof window !== 'undefined' ? window : globalThis);
