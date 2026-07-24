// Quick-Say — type English, French, Spanish, or Hebrew-you-heard; get the Hebrew.
// Input modes, auto-detected on every keystroke, shown together ("montre les deux"):
//   1. English → Hebrew           (Google gtx, sl=auto)
//   2. French / Spanish → Hebrew  (same call: sl=auto detects fr, es, and any language)
//   3. Transliterated Hebrew → Hebrew word(s), with candidates when unsure ("si hésitation")
//        (Google Input Tools he-t-i0-und, ranked; offline reverse-match against the phrasebook)
// Hebrew results are transliterated by the app's own translit.js, which needs niqqud: gtx points
// single words but not phrases, and Input Tools points nothing, so bare Hebrew is vocalized via
// the Dicta Worker first (see vocalizeBare — Dicta is CORS-blocked direct, but the Worker relays
// it). Google's own romanization (dt=rm) is only the last-resort fallback; it is bad (סָבָּא ->
// "sibea"). A curated offline phrasebook is the plane-mode fallback.
// Reuses the app's speak() (Web Speech + voice selector) when present.
(function () {
  'use strict';

  // --- Tunables (centralized; no magic scattered through the logic) -------------
  const CFG = {
    phoneticMax: 5,     // max phonetic-Hebrew candidates to request from Input Tools
    enrichTop: 3,       // how many phonetic candidates get niqqud + gloss (extra API calls)
    glossLang: 'en',    // meaning language for phonetic candidates (UI is English)
    hiConf: 0.85,       // detected-lang confidence above which en/fr is "clearly a translation query"
    tTranslate: 8000,   // ms budget: forward EN/FR -> HE
    tPhon: 5000,        // ms budget: Input Tools phonetic candidates
    tGloss: 6000,       // ms budget: HE -> meaning + romanization gloss
    tMorph: 9000,       // ms budget: word-by-word morphology (the Worker + its two upstreams)
    // Enrichment budgets. These are ADDITIVE on top of tTranslate, so they stay tight: each
    // one only buys a nicety (the other reading / a good transliteration) over an answer we
    // already have, and must never hold the card hostage. The Worker answers in 86-355ms warm
    // and caches 7 days; when Dicta is having a bad day it 502s at ~6s, so 4s bails out to
    // Google's rm instead of making the learner watch "Translating" for 14 seconds.
    tAlts: 5000,        // ms budget: the "as French" second reading
    tVocalize: 4000,    // ms budget: pointing bare Hebrew via the Worker
    tNat: 16000         // ms budget: the on-demand "natural version" (70B model, can be slow cold)
  };

  // Source languages we treat as "a translation query" (vs romanized Hebrew). sl=auto handles
  // any language, but these are the ones whose confident detection suppresses phonetic guesses.
  const TRANSLATE_LANGS = new Set(['en', 'fr', 'es', 'ru']);

  // Enabled source languages (window.QSPrefs.langs) drive which sources we retry.
  const prefLangs = () => (window.QSPrefs && window.QSPrefs.langs) ? window.QSPrefs.langs() : ['en', 'fr', 'es', 'ru'];

  let PHRASES = [];
  let loaded = false;
  let loadPromise = null;

  function loadPhrases() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch((window.ULPAN_BASE || '') + 'data/phrasebook.json')
      .then(r => r.json())
      .then(d => { PHRASES = (d && d.phrases) || []; loaded = true; return PHRASES; })
      .catch(() => { PHRASES = []; loaded = true; return PHRASES; });
    return loadPromise;
  }

  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // phoneme-level romanization key: kh==ch (כ/ח), tz==ts (צ), drop everything non-letter.
  // Same normalization as _translit_test.cjs so the reverse-match agrees with the forward test.
  const romNorm = s => (s || '').toLowerCase().replace(/kh/g, 'ch').replace(/tz/g, 'ts').replace(/[^a-z]/g, '');
  const stripNiqqud = window.stripNiqqud;

  // Normalized Levenshtein similarity in [0,1] (1 = identical). Short strings only.
  function levSim(a, b) {
    a = a || ''; b = b || '';
    const m = a.length, n = b.length;
    if (!m || !n) return 0;
    const d = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = d[j];
        d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return 1 - d[n] / Math.max(m, n);
  }

  // Did Google TRANSLITERATE the input (echo its sound in Hebrew letters) instead of
  // TRANSLATING it? Its own romanization (dt=rm) then reads back ~ the input. This is the
  // sl=auto failure on short foreign words (bonjour->בונז'ור, merci->מרסי); the fix is to
  // retry with an explicit source language. Compared against Google's rm, not translit.js
  // (which drops vowels and renders ו as v — too noisy to compare a sound against).
  const consSkel = s => romNorm(s).replace(/[aeiou]/g, '');
  // Strict: same consonant skeleton = the Hebrew is the input's SOUND, not its meaning
  // (bonjour/bonejeor -> bnjr == bnjr). No vowel-level fuzziness, so a real translation that
  // merely rhymes (chat -> chatul) is never mistaken for an echo.
  function isSoundEcho(input, rm) {
    const a = consSkel(romNorm(input)), b = consSkel(romNorm(rm));
    return !!a && !!b && a.length >= 2 && a === b;
  }
  function looksTransliterated(input, rm) {
    const a = romNorm(input), b = romNorm(rm);
    if (!a || !b) return false;
    if (isSoundEcho(input, rm)) return true;
    return levSim(a, b) >= 0.5;
  }

  // Forward offline search: English/keyword -> curated phrase.
  function search(q, limit = 6) {
    const nq = norm(q);
    if (!nq) return [];
    const terms = nq.split(' ');
    const scored = [];
    for (const p of PHRASES) {
      const en = norm(p.en);
      const k = norm(p.en + ' ' + (p.k || ''));
      let score = 0;
      if (en === nq) score = 1000;
      else if (en.startsWith(nq)) score = 700;
      else if ((' ' + k + ' ').includes(' ' + nq + ' ')) score = 500;
      else if (k.includes(nq)) score = 300;
      else if (terms.every(t => k.includes(t))) score = 150;
      if (score > 0) scored.push({ p, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.p);
  }

  // Reverse offline lookup: romanized Hebrew -> curated phrase (verified niqqud + meaning).
  // Matches the typed romanization against both the phrasebook's `tr` and translit.js(he).
  function reverseOffline(q, limit = CFG.phoneticMax) {
    const ri = romNorm(q);
    if (ri.length < 2) return [];
    const T = window.Translit;
    const seen = new Set();
    const scored = [];
    for (const p of PHRASES) {
      const keys = [romNorm(p.tr)];
      if (T) keys.push(romNorm(T.transliterate(p.he)));
      let score = 0;
      for (const k of keys) {
        if (!k) continue;
        if (k === ri) score = Math.max(score, 1000);
        else if (ri.length >= 3 && k.startsWith(ri)) score = Math.max(score, 600);
        else if (k.length >= 3 && ri.startsWith(k)) score = Math.max(score, 400);
      }
      if (score > 0 && !seen.has(p.he)) { seen.add(p.he); scored.push({ p, score }); }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.p);
  }

  function play(he) {
    if (typeof window.speak === 'function') { window.speak(he, 0.8); return; }
    try {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(he);
      u.lang = 'he-IL'; u.rate = 0.8;
      const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.startsWith('he'));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  const escapeHtml = window.escHtml;

  function card(p, kind) {
    let tag = '';
    if (kind === 'online') tag = '<span class="qs-tag qs-tag-online" title="Translated online">online</span>';
    else if (kind === 'curated') tag = '<span class="qs-tag qs-tag-curated" title="From the lessons, with niqqud">✓ lesson</span>';
    else if (kind === 'phonetic') tag = '<span class="qs-tag qs-tag-phonetic" title="Matched from what you typed phonetically">phonetic</span>';
    else if (kind === 'phonetic-lesson') tag = '<span class="qs-tag qs-tag-curated" title="From the lessons, with niqqud">✓ lesson</span>';
    else if (p.cat) tag = '<span class="qs-tag">' + escapeHtml(p.cat) + '</span>';
    // Spell digits out in the transliteration: "ani ben 33" -> "ani ben shloshim ve shalosh".
    // A learner needs to know how to SAY the number, not just see the glyph. The Hebrew keeps the
    // digit (that's how Hebrew writes numbers); only the romanization is spelled.
    const trText = (window.Translit && window.Translit.spellNumbersInText) ? window.Translit.spellNumbersInText(p.tr) : p.tr;
    const tr = (trText && (!window.QSPrefs || window.QSPrefs.translit())) ? '<div class="qs-tr">' + escapeHtml(trText) + '</div>' : '';
    const meaning = (p.en || '').trim();
    const en = (meaning || tag)
      ? '<div class="qs-en">' + escapeHtml(meaning) + (meaning ? ' ' : '') + tag + '</div>' : '';
    // Preference-aware Hebrew: strip niqqud when the user turned it off; echo the word in
    // cursive (ktav yad) when enabled. Cursive fonts don't carry niqqud, so it's always stripped.
    const prefs = window.QSPrefs;
    const heDisp = (!prefs || prefs.niqqud()) ? p.he : stripNiqqud(p.he);
    const cursive = (prefs && prefs.cursive())
      ? '<div class="qs-he-cursive" dir="rtl" lang="he">' + escapeHtml(stripNiqqud(p.he)) + '</div>' : '';
    // Multi-word Hebrew results can be decomposed word by word (root + niqqud + meaning).
    const breakable = /[֐-׿]/.test(p.he || '') && stripNiqqud(p.he).trim().split(/\s+/).filter(Boolean).length >= 2;
    const breakBtn = breakable
      ? '<button type="button" class="qs-break" data-he="' + escapeHtml(p.he) + '">Break it down</button>' : '';
    const saveBtn = '<button type="button" class="qs-save" data-he="' + escapeHtml(p.he) +
      '" data-tr="' + escapeHtml(p.tr || '') + '" data-en="' + escapeHtml(meaning) + '">Save</button>';
    return '' +
      '<div class="qs-card' + (breakable ? ' has-break' : '') + '">' +
        '<button class="qs-play icon-btn" title="Listen" aria-label="Listen: ' + escapeHtml(p.he) + '" data-he="' + escapeHtml(p.he) + '">▶</button>' +
        '<div class="qs-text">' +
          '<div class="qs-he" dir="rtl" lang="he">' + escapeHtml(heDisp) + '</div>' +
          cursive +
          tr +
          en +
          '<div class="qs-actions">' + saveBtn + breakBtn + '</div>' +
        '</div>' +
        (breakable ? '<div class="qs-break-out"></div>' : '') +
      '</div>';
  }

  // --- Shared abort: a new keystroke cancels every in-flight request from the last one ---
  let qAbort = null;
  const transCache = new Map();  // forward EN/FR->HE, keyed by lowercased query
  const phonCache = new Map();   // phonetic online candidates, keyed by "p:"+query

  // Race a promise against a timeout so a hung request can't freeze "Translating…".
  function withTimeout(promise, ms) {
    return new Promise(resolve => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
      promise.then(v => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
                   () => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
    });
  }

  // Pick the transliteration shown to the learner.
  //
  // We used to display Google's own romanization (gtx dt=rm). The app already ships a better
  // Hebrew transliterator (translit.js) and was throwing it away. Measured head-to-head on gtx's
  // OWN output for single words (the population where this actually applies): translit.js 17/20,
  // Google rm 6/20. Google's misses are systematic vowel mangling — which is exactly what reads
  // as "approximate":  סָבָּא -> "sibea" (saba) · סַבתָא -> "sivata" (savta) · קָפֶה -> "kafa"
  // (kafe) · לֹא -> "lea" (lo) · לֶחֶם -> "lachem" (lechem).
  //
  // The catch: translit.js needs niqqud. On BARE Hebrew it emits vowel-less garbage
  // (שלום -> "shlvm", סבא -> "sv") on 68/68 of the phrasebook — never let it near unpointed text.
  // Hence the per-word niqqud test below. Per-WORD, not per-string: one pointed word in a bare
  // sentence used to let it loose on the whole thing ("אני רוצה לֶחֶם" -> "ny rvtz lechem").
  // Mixed input falls back to rm rather than shipping a half-garbage line.
  //
  // Raw rm is still kept on the result for looksTransliterated(), which needs the SOURCE-side
  // sound echo and would be broken by a good Hebrew transliteration.
  const hasNiqqud = s => /[֑-ׇ]/.test(s || '');
  function bestTranslit(he, rm) {
    const T = window.Translit;
    if (!T || !he) return rm || null;
    const words = he.trim().split(/\s+/).filter(Boolean);
    // Every HEBREW word must be vocalized (translit.js garbles bare Hebrew). Non-Hebrew tokens —
    // a number like "45", punctuation — are fine and pass through; without this exception a single
    // digit in a phrase forced the whole line back to Google's rm ("hisper" for hasefer).
    if (!words.length || !words.every(w => hasNiqqud(w) || !isHeb(w))) return rm || null;
    const out = words.map(w => T.transliterate(w)).filter(Boolean);
    return out.length === words.length ? out.join(' ') : (rm || null);
  }

  // --- Forward: EN/FR (any language) -> Hebrew. sl=auto is what makes French work. ---
  function fetchGoogle(q, signal, sl) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + (sl || 'auto') + '&tl=he&dt=t&dt=rm&q=' + encodeURIComponent(q);
    return fetch(url, { signal: signal })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(j => {
        const segs = j && j[0];
        if (!Array.isArray(segs)) return null;
        const he = segs.filter(s => s && s[0]).map(s => s[0]).join('').trim();
        // romanization sits in a segment with a null translation slot, in [2] (Hebrew->Latin).
        const rm = segs.filter(s => s && !s[0]).map(s => s[2]).filter(Boolean).join(' ').trim();
        if (!he) return null;
        const src = (typeof j[2] === 'string') ? j[2] : null;    // detected source language
        const conf = (typeof j[6] === 'number') ? j[6] : null;   // detection confidence
        // tr = what the learner reads (translit.js when the Hebrew is vocalized); rm = Google's
        // raw romanization, kept only for the source-echo test in looksTransliterated().
        return { he: he, tr: bestTranslit(he, rm), rm: rm || null, en: q, src: src, conf: conf };
      });
  }

  function guessLangpair(q) {
    if (/[Ѐ-ӿ]/.test(q)) return 'ru|he';         // Cyrillic -> Russian
    if (/[ñ¿¡]/i.test(q)) return 'es|he';                 // unambiguous Spanish
    if (/[àâçéèêëîïôûùÿœæ]/i.test(q)) return 'fr|he';      // French diacritics
    return 'en|he';
  }

  function fetchMyMemory(q, signal, langpair) {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=' + (langpair || 'en|he');
    return fetch(url, { signal: signal })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(j => {
        const he = j && j.responseData && j.responseData.translatedText;
        if (!he || !/[֐-׿]/.test(he)) return null;
        // MyMemory returns bare (unvocalized) Hebrew, where translit.js is unreliable (סבא -> "sv"),
        // so bestTranslit yields null rather than a confident-looking wrong answer.
        return { he: he.trim(), tr: bestTranslit(he.trim(), null), rm: null, en: q, src: (langpair || '').split('|')[0] || null, conf: null };
      });
  }

  // --- Reverse: romanized Hebrew -> Hebrew script candidates (ranked = the "si hésitation") ---
  function fetchInputTools(q, signal) {
    const url = 'https://inputtools.google.com/request?text=' + encodeURIComponent(q) +
      '&itc=he-t-i0-und&num=' + CFG.phoneticMax + '&cp=0&cs=1&ie=utf-8&oe=utf-8';
    return fetch(url, { signal: signal })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(j => {
        if (!Array.isArray(j) || j[0] !== 'SUCCESS') return [];
        const block = j[1] && j[1][0];
        const cands = block && block[1];
        return Array.isArray(cands) ? cands.filter(Boolean) : [];
      });
  }

  // Meaning + romanization of a Hebrew word (HE -> UI language), for phonetic candidates.
  // When Hebrew is the source (sl=iw), gtx puts the source-side romanization at s[3], so the
  // one call that glosses a candidate also transliterates it. Dicta Nakdan (which we used
  // before) has no browser CORS and is blocked outright on GitHub Pages; gtx (CORS *) covers
  // both needs with no proxy or backend. Returns { en: meaning, tr: romanization }.
  function fetchGloss(he, signal) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=' + CFG.glossLang + '&dt=t&dt=rm&q=' + encodeURIComponent(he);
    return fetch(url, { signal: signal })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(j => {
        const segs = j && j[0];
        if (!Array.isArray(segs)) return null;
        const t = segs.filter(s => s && s[0]).map(s => s[0]).join('').trim();
        const rm = segs.filter(s => s && !s[0]).map(s => s[3] || s[2]).filter(Boolean).join(' ').trim();
        const meaning = (t && t.toLowerCase() !== he.toLowerCase()) ? t : '';
        if (!meaning && !rm) return null;
        // NOTE: Input Tools returns BARE Hebrew (measured 0/6 with niqqud), so bestTranslit's
        // niqqud test always fails here and this path falls back to Google's rm — which is how
        // the app came to answer "beseder" with "basder", contradicting what the user just typed.
        // vocalizeCandidate() (below) points the word through the Worker first so translit.js
        // can actually read it; rm stays the fallback when the Worker is unreachable.
        return { en: meaning, tr: bestTranslit(he, rm), rm: rm || null };
      });
  }

  // Retry sources when sl=auto transliterates a short foreign word instead of translating.
  // Only the romance/cyrillic sources the user actually types (prefs) are worth retrying.
  const retrySls = () => ['fr', 'es', 'ru'].filter(l => prefLangs().indexOf(l) >= 0);

  const LANG_NAME = { en: 'English', fr: 'French', es: 'Spanish', ru: 'Russian', iw: 'Hebrew', he: 'Hebrew' };

  // --- Homograph rescue: the SILENT wrong answer -------------------------------------------
  // looksTransliterated() only catches the LOUD failure — gtx echoing the sound (bonjour ->
  // בונז'ור). It cannot catch the silent one: a French word that is also an English word, which
  // gtx confidently translates as English and never echoes. Measured, all with src=en conf=1.0,
  // so no existing retry fires:
  //     pain -> כְּאֵב (ache, not bread) · chat -> לְשׂוֹחֵחַ (to chat, not cat)
  //     main -> רָאשִׁי (chief, not hand) · coin -> מַטְבֵּעַ (a coin, not corner) · eau -> או
  // A French oleh types the most basic word he knows and is told, fluently and confidently, the
  // wrong thing. So: for a single word, also ask the user's own languages explicitly, and when
  // the reading DIFFERS, show both instead of silently picking. Noise cost measured at zero —
  // on 7/7 genuine English words (grandfather, bread, dog, water, house, coffee, thanks) sl=fr
  // returns the identical Hebrew, so no alternate is produced.
  function addLangAlts(res, q, signal, single) {
    if (!res || !single || !res.he) return Promise.resolve(res);
    const cands = retrySls().filter(l => l !== res.src);
    if (!cands.length) return Promise.resolve(res);
    return Promise.all(cands.map(sl =>
      fetchGoogle(q, signal, sl).then(r => (r && r.he) ? Object.assign({}, r, { sl: sl }) : null).catch(() => null)
    )).then(list => {
      const seen = new Set([stripNiqqud(res.he)]);
      const alts = [];
      list.forEach(a => {
        if (!a) return;
        const k = stripNiqqud(a.he);
        if (seen.has(k)) return;              // same reading -> nothing to disambiguate
        // Drop alternates that are just the SOUND echoed back in Hebrew letters rather than a
        // translation: sl=es on "bonjour" yields בונז'ור, and an "(as Spanish)" card for it is
        // pure noise. Use the STRICT half of the echo test (identical consonant skeleton), not
        // looksTransliterated's full rule: its levSim>=0.5 branch flags chat->חתול ("chatul",
        // 0.67) as an echo and would drop the correct French reading — the exact answer this
        // whole function exists to surface. The costs are asymmetric: a stray echo card is mild
        // noise, hiding the right word is the bug. Prefer showing too much.
        if (isSoundEcho(q, a.rm)) return;
        seen.add(k);
        alts.push(Object.assign({}, a, { en: q + ' (as ' + (LANG_NAME[a.sl] || a.sl) + ')' }));
      });
      if (!alts.length) return res;
      // Name the language on the primary card too, so the pair reads as a real choice.
      return Object.assign({}, res, {
        en: q + ' (as ' + (LANG_NAME[res.src] || res.src || 'detected') + ')',
        alts: alts
      });
    });
  }

  // --- Vocalize bare Hebrew through the Dicta Worker, so translit.js can read it ------------
  // gtx returns vocalized Hebrew for single words (19/20) but BARE Hebrew for every phrase
  // (0/10), which is most of the value. On that path the learner was shown Google's rm:
  //     הספר -> "hisper" (hasefer) · מים קרים -> "mim krim" (mayim karim)
  //     אני רוצה לקנות לחם -> "ani rotza lekanot lecham" (ani rotze liknot lechem)
  // The old comment said Dicta was CORS-blocked so rm was the only option. That has been false
  // since the morphology Worker shipped: it relays Dicta and returns per-word `voc`. Routing
  // bare Hebrew through it and then translit.js scored 7/7 where Google's rm scored 0/7, and it
  // structurally fixes shva na / qamats qatan, which translit.js guesses at from letters alone
  // (Dicta actually knows the morphology). Cached 7 days by the Worker.
  function vocalizeBare(res, signal) {
    if (!res || !res.he || !isHeb(res.he) || hasNiqqud(res.he)) return Promise.resolve(res);
    // Consonant skeleton for the "Dicta didn't rewrite the word" guard: strip niqqud, whitespace
    // AND punctuation. Dicta returns commas/periods/? as separator tokens that we filter out, so a
    // guard that keeps punctuation on one side only sees a phantom mismatch on EVERY sentence with
    // a "," or "?" — and silently falls back to Google's bad romanization (le/mura). This is why
    // single words worked and full sentences didn't.
    const bare = s => stripNiqqud(s).replace(/[\s,.?!;:'"״׳()־-]/g, '');
    // Dicta 502s on some cold calls and succeeds on retry — but the 502 itself can take ~6s, so
    // the retry lives INSIDE one shared budget rather than doubling the wall clock. Fail fast to
    // Google's rm; the Worker's 7-day cache means the next attempt at this phrase is ~90ms.
    const once = () => fetchMorph(res.he, signal);
    return withTimeout(once().catch(() => once()), CFG.tVocalize)
      .then(toks => {
        if (!toks || !toks.length) return res;
        // Rebuild KEEPING the separator tokens (digits, punctuation) in place; only the word
        // tokens get vocalized. Dicta returns "45" and "," as separators — filtering them out
        // dropped numbers from the Hebrew ("הספר עולה 45" lost its 45) AND made the skeleton
        // guard below misfire, falling back to Google's bad rm ("hisper" for hasefer).
        const voc = toks.map(t => t.sep ? (t.word || '') : (t.voc || t.word || '')).join('').replace(/\s+/g, ' ').trim();
        // Never let the Worker rewrite the answer: it may only ADD niqqud, never change letters.
        if (!voc || bare(voc) !== bare(res.he)) return res;
        // Clean Dicta's encoding before it reaches the screen, not only before transliteration.
        // transliterate() folds this internally, so the romanization was always right while the
        // Hebrew shown carried a stray meteg and a holam sitting on the consonant instead of the
        // vav (בֹּוֽקֶר for בּוֹקֶר) — wrong for anyone learning to read niqqud, which is the point here.
        const clean = (window.Translit && window.Translit.cleanDictaForDisplay) ? window.Translit.cleanDictaForDisplay(voc) : voc;
        return Object.assign({}, res, { he: clean, tr: bestTranslit(clean, res.rm) });
      })
      .catch(() => res);   // offline / Dicta down -> keep Google's rm rather than nothing
  }

  function translateOnline(q, signal) {
    const key = q.toLowerCase();
    if (transCache.has(key)) return Promise.resolve(transCache.get(key));
    const single = !/\s/.test(q.trim());  // the failure is isolated words; phrases translate fine
    const run = fetchGoogle(q, signal, 'auto')
      .catch(() => null)
      .then(res => res || fetchMyMemory(q, signal, guessLangpair(q)).catch(() => null))
      .then(res => {
        // sl=auto echoed the sound (bonjour->בונז'ור) rather than translating it: retry with
        // explicit romance sources and keep the first result that isn't itself a transliteration.
        // Compare against Google's RAW rm (the source-side sound echo), not the display `tr`:
        // tr is now a good Hebrew transliteration, which would no longer resemble the typed
        // input and would silently disable this retry.
        if (!res || !single || !looksTransliterated(q, res.rm)) return res;
        return Promise.all(retrySls().map(sl => fetchGoogle(q, signal, sl).catch(() => null)))
          .then(alts => alts.find(a => a && a.he && !looksTransliterated(q, a.rm)) || res);
      });
    // Staged budgets, not one big one. The translation itself gets tTranslate; each enrichment
    // then gets its own short budget and degrades to the answer we already have. Folding these
    // into a single withTimeout made every phrase hang: vocalizeBare could burn the whole
    // tTranslate on a Dicta 502, and the learner just watched "Translating" forever.
    return withTimeout(run, CFG.tTranslate)
      .then(res => res && withTimeout(addLangAlts(res, q, signal, single), CFG.tAlts).then(r => r || res))
      .then(res => res && withTimeout(vocalizeBare(res, signal), CFG.tVocalize).then(r => r || res))
      .then(res => {
        if (!res) return null;
        transCache.set(key, res);
        return res;
      });
  }

  // Phonetic pipeline: offline reverse-match (instant) + online Input Tools candidates
  // (enriched with niqqud + gloss). Returns { offline:[phrase], online:[{he,tr,en,bare}] }.
  function lookupPhonetic(q, signal, offlineMatches) {
    const offline = offlineMatches || (loaded ? reverseOffline(q) : []);
    if (!navigator.onLine) return Promise.resolve({ offline: offline, online: [] });
    const key = 'p:' + q.toLowerCase();
    if (phonCache.has(key)) return Promise.resolve({ offline: offline, online: phonCache.get(key) });
    const offHe = new Set(offline.map(p => stripNiqqud(p.he)));
    return withTimeout(fetchInputTools(q, signal), CFG.tPhon).then(cands => {
      cands = (cands || []).filter(c => c && !offHe.has(stripNiqqud(c)));
      const top = cands.slice(0, CFG.enrichTop);
      return Promise.all(top.map(c =>
        withTimeout(fetchGloss(c, signal), CFG.tGloss)
          .then(gl => ({ he: c, tr: (gl && gl.tr) || null, rm: (gl && gl.rm) || null, en: (gl && gl.en) || '', bare: c }))
          // Input Tools hands back bare Hebrew, so point it through the Worker before showing a
          // transliteration — otherwise the app answers "beseder" with Google's "basder" and
          // contradicts the very spelling the learner typed.
          .then(p => vocalizeBare(p, signal).then(v => Object.assign({}, v, { bare: c })))
          .catch(() => ({ he: c, tr: null, en: '', bare: c }))
      )).then(list => { phonCache.set(key, list); return { offline: offline, online: list }; });
    });
  }

  function wirePlay(container) {
    container.querySelectorAll('.qs-play').forEach(b => {
      if (b._wired) return; b._wired = true;
      b.addEventListener('click', () => play(b.dataset.he));
    });
    wireBreak(container);
    wireSave(container);
  }

  // Save a result to the personal phrasebook (window.QSNotebook, owned by hub.js).
  function wireSave(container) {
    container.querySelectorAll('.qs-save').forEach(b => {
      if (b._wired) return; b._wired = true;
      const nb = window.QSNotebook;
      if (nb && nb.has(b.dataset.he, b.dataset.en)) { b.classList.add('on'); b.textContent = 'Saved'; }
      b.addEventListener('click', () => {
        if (!window.QSNotebook || b.classList.contains('on')) return;
        window.QSNotebook.add({ he: b.dataset.he, tr: b.dataset.tr, en: b.dataset.en });
        if (window.track) track('phrase_saved');
        b.classList.add('on'); b.textContent = 'Saved';
      });
    });
  }

  // --- Word-by-word breakdown (deep morphology via the Dicta proxy Worker) --------
  // Config: the Cloudflare Worker that relays Dicta Nakdan (CORS-blocked in the browser) and
  // returns per-word vocalization + root (lemma). Point this at another deployment to move it.
  const MORPH_URL = 'https://ulpan-morph.olamcreations.workers.dev';
  const NAT_URL = MORPH_URL + '/nat';
  const isHeb = s => /[֐-׿]/.test(s || '');
  const morphCache = new Map();
  const natCache = new Map();

  // --- Natural version (on-demand LLM layer) --------------------------------------
  // Google Translate under the live translator gives literal calques on idiomatic phrases and
  // gets register/gender wrong ("c'est ma professeure" -> masculine מורה). The Worker's /nat
  // endpoint runs a 70B model that returns the idiomatic Hebrew a native actually says
  // (זו מורתי). It's opt-in (a button, not every keystroke): the model is slow and the neuron
  // budget is real. We take ONLY the model's consonantal Hebrew — its niqqud is patchy and its
  // transliteration is wrong — then re-vocalize each option through the same Dicta + translit.js
  // path as any other result, so the pointing and romanization stay from the trusted source.
  function fetchNatural(q, signal) {
    const key = 'n:' + q.toLowerCase();
    if (natCache.has(key)) return Promise.resolve(natCache.get(key));
    const run = fetch(NAT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: q }), signal: signal
    })
      .then(r => { if (!r.ok) throw new Error('nat ' + r.status); return r.json(); })
      .then(j => (j && j.options) || []);
    return withTimeout(run, CFG.tNat).then(opts => {
      const o = opts || [];
      if (o.length) natCache.set(key, o);
      return o;
    });
  }

  function wireNat(container) {
    container.querySelectorAll('.qs-nat-btn').forEach(b => {
      if (b._wired) return; b._wired = true;
      b.addEventListener('click', () => {
        const wrap = b.closest('.qs-nat');
        const out = wrap && wrap.querySelector('.qs-nat-out');
        if (!out || b.classList.contains('loading')) return;
        const q = b.dataset.q || '';
        b.classList.add('loading'); b.textContent = 'Version naturelle…';
        if (window.track) track('nat_used');
        const sig = new AbortController().signal;
        const fail = () => { out.innerHTML = '<div class="qs-hint">Version naturelle indisponible pour l’instant.</div>'; b.classList.remove('loading'); b.textContent = '✦ version naturelle'; };
        fetchNatural(q, sig).then(opts => {
          if (!opts || !opts.length) return fail();
          // Strip the model's niqqud and re-point each option through Dicta + translit.js.
          return Promise.all(opts.map(o => {
            // en = the phrase the learner typed (the meaning — so Save stores it right); the
            // French register note becomes the tag. Strip the model's niqqud; Dicta re-points it.
            const res = { he: stripNiqqud(o.he), rm: null, en: q, cat: o.note ? ('✦ ' + o.note) : '✦ naturel' };
            return withTimeout(vocalizeBare(res, sig), CFG.tVocalize).then(v => v || res);
          })).then(cards => {
            out.innerHTML = '<div class="qs-sub">Version naturelle</div>' + cards.map(c => card(c)).join('');
            wirePlay(out);
            b.style.display = 'none';
          });
        }).catch(fail);
      });
    });
  }

  /* --- Verified glosses ------------------------------------------------------------------
     The breakdown used to ask Google for each word ALONE, which on Hebrew homographs is a coin
     flip it kept losing: שְׁמִי -> "Semitic" (my name), הַאִם -> "the mother" (the yes/no particle),
     אֶת -> "you" (the accusative marker), עוֹבֵר -> "fetus" (passes).

     Sending the vocalized form instead of the bare one was measured to change nothing — Google
     returns the same gloss for שמי and שְׁמִי — so the cause is isolation, not vocalization. What
     fixes it is not asking at all for the words we have already verified ourselves: 6871 vocalized
     words across the phrasebook, the expressions and the 465 lessons, each with its meaning.
     Keyed on the FULL vocalization (never the consonant skeleton — that is the ambiguity itself).
     Loaded lazily, so a learner who never opens a breakdown never pays for it. */
  let glossDict = null, glossPromise = null;
  function loadGloss() {
    if (glossPromise) return glossPromise;
    glossPromise = fetch((window.ULPAN_BASE || '') + 'data/gloss.json')
      .then(r => r.json())
      .then(d => { glossDict = (d && d.v) || {}; return glossDict; })
      .catch(() => { glossDict = {}; return glossDict; });   // offline: fall back to Google
    return glossPromise;
  }
  function verifiedGloss(voc) {
    if (!glossDict || !voc) return null;
    // Match on the same cleaned form the cell displays, or Dicta's raw encoding would miss
    // every key (our corpus stores בּוֹקֶר, Dicta sends בֹּוֽקֶר).
    const clean = (window.Translit && window.Translit.cleanDictaForDisplay)
      ? window.Translit.cleanDictaForDisplay(voc) : voc;
    return glossDict[clean.normalize('NFC')] || null;
  }

  /* Ask the Worker to gloss several words at once, in the context of the sentence they came
     from. One request per breakdown, not per word — and only for words our verified corpus
     does not already cover. Returns {} on any failure so the caller degrades to Google. */
  function fetchContextGloss(sentence, words, signal) {
    return fetch(MORPH_URL + '/gloss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sentence, words: words }), signal: signal
    })
      .then(r => { if (!r.ok) throw new Error('gloss ' + r.status); return r.json(); })
      .then(j => (j && j.glosses) || {})
      .catch(() => ({}));
  }

  function fetchMorph(text, signal) {
    const key = 'm:' + text;
    if (morphCache.has(key)) return Promise.resolve(morphCache.get(key));
    return fetch(MORPH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }), signal: signal
    })
      .then(r => { if (!r.ok) throw new Error('morph ' + r.status); return r.json(); })
      .then(j => { const toks = (j && j.tokens) || []; morphCache.set(key, toks); return toks; });
  }

  // One word cell: vocalized Hebrew (+ optional cursive), transliteration (niqqud-based via
  // translit.js), meaning, and the root / dictionary form (√lemma) when it differs.
  function morphWordHtml(tok, gloss) {
    const prefs = window.QSPrefs;
    const raw = tok.voc || tok.word || '';
    // Same Dicta encoding cleanup as vocalizeBare: the breakdown is where a learner looks at the
    // niqqud most closely, so it is the last place that should show the raw encoding.
    const voc = (window.Translit && window.Translit.cleanDictaForDisplay) ? window.Translit.cleanDictaForDisplay(raw) : raw;
    const heShown = (!prefs || prefs.niqqud()) ? voc : stripNiqqud(voc);
    const cursive = (prefs && prefs.cursive())
      ? '<div class="mw-cursive" dir="rtl" lang="he">' + escapeHtml(stripNiqqud(voc)) + '</div>' : '';
    const tr = (!prefs || prefs.translit())
      ? '<div class="mw-tr">' + escapeHtml((window.Translit && window.Translit.transliterate(voc)) || '') + '</div>' : '';
    const lemma = stripNiqqud(tok.lemma || '');
    const root = ((!prefs || prefs.root()) && lemma && lemma !== stripNiqqud(voc))
      ? '<div class="mw-root" dir="rtl" lang="he" title="root / dictionary form">√ ' + escapeHtml(lemma) + '</div>' : '';
    // Grammar: part of speech · binyan · tense, then gender/number/person.
    let morph = '';
    if (!prefs || prefs.grammar()) {
      const bits = [tok.pos, tok.binyan, tok.form].filter(Boolean);
      if (bits.length) morph += '<div class="mw-morph">' + escapeHtml(bits.join(' · ')) + '</div>';
      if (tok.gnp) morph += '<div class="mw-gnp">' + escapeHtml(tok.gnp) + '</div>';
    }
    return '<div class="mw">' +
      '<div class="mw-he" dir="rtl" lang="he">' + escapeHtml(heShown) + '</div>' +
      cursive +
      tr +
      // The title says where the meaning came from without putting a badge in the learner's face.
      '<div class="mw-gloss"' + (gloss && gloss.verified ? ' title="meaning from the lessons (verified)"' : '') + '>'
        + escapeHtml((gloss && gloss.en) || (typeof gloss === 'string' ? gloss : '')) + '</div>' +
      root +
      morph +
    '</div>';
  }

  function renderBreakdown(out, hebrew, signal) {
    out.innerHTML = '<div class="qs-loading">Breaking down</div>';
    withTimeout(fetchMorph(hebrew, signal), CFG.tMorph)
      .then(tokens => {
        if (!tokens) { out.innerHTML = '<div class="qs-hint">Breakdown needs a connection.</div>'; return; }
        const words = tokens.filter(t => t && !t.sep && isHeb(t.word));
        if (!words.length) { out.innerHTML = '<div class="qs-hint">No breakdown for this.</div>'; return; }
        /* Three tiers, cheapest and most trustworthy first:
             1. our own verified corpus  — exact vocalized match, offline, no call
             2. the Worker, IN CONTEXT   — one batched call for everything still unknown; the
                                           sentence is what settles a homograph
             3. Google, word in isolation — last resort, and the source of the original bug
           Tier 2 is one request for the whole sentence, not one per word. */
        return loadGloss().then(() => {
          const need = words.filter(t => !verifiedGloss(t.voc || t.word))
                            .map(t => stripNiqqud(t.voc || t.word));
          if (!need.length) return {};
          return withTimeout(fetchContextGloss(hebrew, need, signal), CFG.tGloss).catch(() => ({}));
        }).then(ctxGloss => Promise.all(words.map(t => {
          const voc = t.voc || t.word;
          const known = verifiedGloss(voc);
          if (known) return Promise.resolve({ en: known, verified: true });
          const inCtx = ctxGloss && ctxGloss[stripNiqqud(voc)];
          if (inCtx) return Promise.resolve({ en: inCtx, context: true });
          return withTimeout(fetchGloss(stripNiqqud(voc), signal), CFG.tGloss)
            .then(g => ({ en: (g && g.en) || '', verified: false }));
        }))).then(glosses => {
          out.innerHTML = '<div class="qs-sub">Word by word</div>' +
            '<div class="mw-grid" dir="rtl">' + words.map((t, i) => morphWordHtml(t, glosses[i])).join('') + '</div>';
        });
      })
      .catch(() => { out.innerHTML = '<div class="qs-hint">Breakdown needs a connection.</div>'; });
  }

  function wireBreak(container) {
    container.querySelectorAll('.qs-break').forEach(b => {
      if (b._wired) return; b._wired = true;
      b.addEventListener('click', () => {
        const cardEl = b.closest('.qs-card');
        const out = cardEl && cardEl.querySelector('.qs-break-out');
        if (!out) return;
        if (out.dataset.open === '1') { out.innerHTML = ''; out.dataset.open = '0'; b.classList.remove('on'); return; }
        out.dataset.open = '1'; b.classList.add('on');
        if (window.track) track('breakdown_used');
        renderBreakdown(out, b.dataset.he, new AbortController().signal);
      });
    });
  }

  // --- Section builders ---------------------------------------------------------
  function phonSectionHtml(offline, online) {
    const cards = offline.map(p => card(p, 'phonetic-lesson')).concat(online.map(p => card(p, 'phonetic')));
    if (!cards.length) return '';
    return '<div class="qs-sub">Hebrew — did you mean?</div>' + cards.join('');
  }

  function transSectionHtml(fwd, fwdOffline, dupeSet) {
    const cards = [];
    if (fwd && !dupeSet.has(stripNiqqud(fwd.he))) { cards.push(card(fwd, 'online')); dupeSet.add(stripNiqqud(fwd.he)); }
    // Homograph alternates (pain = ache in English, bread in French): show the other reading
    // rather than silently betting on Google's language detection.
    if (fwd && fwd.alts) fwd.alts.forEach(a => {
      const k = stripNiqqud(a.he);
      if (dupeSet.has(k)) return;
      dupeSet.add(k); cards.push(card(a, 'online'));
    });
    // Skip curated matches already shown in the phonetic "did you mean?" section (e.g. "beseder"
    // surfaces both as romanized-Hebrew and as a keyword) so the same card isn't listed twice.
    fwdOffline.forEach(p => {
      const k = stripNiqqud(p.he);
      if (dupeSet.has(k)) return;
      dupeSet.add(k); cards.push(card(p, 'curated'));
    });
    if (!cards.length) return '';
    return '<div class="qs-sub">Translation</div>' + cards.join('');
  }

  let renderToken = 0;
  function render(container, q) {
    const nq = q.trim();
    if (!nq) {
      container.removeAttribute('aria-busy');
      container.innerHTML = '';   // minimal empty state: no hint text, no example chips
      return;
    }
    const token = ++renderToken;
    const fwdOffline = loaded ? search(nq) : [];
    const revOffline = loaded ? reverseOffline(nq) : [];

    if (!navigator.onLine) {
      // Plane mode: curated phrasebook only, both directions.
      const ph = phonSectionHtml(revOffline, []);
      const tr = fwdOffline.length ? '<div class="qs-sub">Translation</div>' + fwdOffline.map(p => card(p, 'curated')).join('') : '';
      if (ph || tr) {
        container.innerHTML = ph + tr + '<div class="qs-hint qs-offline">Offline — showing saved phrases only.</div>';
      } else {
        container.innerHTML = '<div class="qs-hint qs-offline">Offline, and no saved phrase matches “' + escapeHtml(nq) + '”. Connect to translate anything.</div>';
      }
      wirePlay(container);
      return;
    }

    // Online-first: loading line + whatever the offline phrasebook already knows, then fill in.
    container.setAttribute('aria-busy', 'true');
    container.innerHTML =
      '<div class="qs-loading">Translating</div>' +
      phonSectionHtml(revOffline, []) +
      (fwdOffline.length ? '<div class="qs-sub">Translation</div>' + fwdOffline.map(p => card(p, 'curated')).join('') : '');
    wirePlay(container);

    if (qAbort) { try { qAbort.abort(); } catch (e) {} }
    qAbort = new AbortController();
    const sig = qAbort.signal;

    Promise.all([translateOnline(nq, sig), lookupPhonetic(nq, sig, revOffline)]).then(([fwd, phon]) => {
      if (token !== renderToken) return; // a newer keystroke superseded this
      container.removeAttribute('aria-busy');

      // Auto-decide: if the input is clearly a confident English/French word AND nothing
      // matched offline as Hebrew, it's a translation query — drop the online phonetic guesses.
      let online = phon.online;
      const realLang = fwd && TRANSLATE_LANGS.has(fwd.src) && (fwd.conf == null || fwd.conf >= CFG.hiConf);
      if (realLang && !phon.offline.length) online = [];

      // Order: lead with Hebrew-you-heard when there's a verified match, or when Google could
      // NOT place the input as a known translation language (its tell for romanized Hebrew,
      // e.g. beseder→"sl", sababa→"om").
      const phonFirst = phon.offline.length > 0 ||
        (fwd && fwd.src && !TRANSLATE_LANGS.has(fwd.src)) || !fwd;

      // Romanized-Hebrew input makes Google "translate" the latin word as some random language
      // (ahava→rw→משם, beseder→sl→מפתח מילים) — a parasitic forward card. When we're confident
      // it's Hebrew-you-heard (phonFirst, not a real translate language) and the phonetic section
      // already has the real word, drop that card. Curated forward matches (fwdOffline) stay.
      const romanizedHebrew = phonFirst && !realLang && (phon.offline.length + online.length) > 0;
      const fwdCard = romanizedHebrew ? null : fwd;

      const dupe = new Set(phon.offline.map(p => stripNiqqud(p.he)).concat(online.map(p => stripNiqqud(p.he))));
      const ph = phonSectionHtml(phon.offline, online);
      const tr = transSectionHtml(fwdCard, fwdOffline, dupe);

      let html = phonFirst ? (ph + tr) : (tr + ph);
      if (!html) html = '<div class="qs-hint">Nothing found for “' + escapeHtml(nq) + '”. Try rephrasing.</div>';
      // On-demand "natural version": only for a translation query (not Hebrew-you-heard, where the
      // learner already has the word). Idiomatic phrases are exactly where Google calques and this
      // 70B layer earns its keep — but it's slow and metered, so it stays a button, not automatic.
      if (!isHeb(nq)) {
        html += '<div class="qs-nat">' +
          '<button type="button" class="qs-nat-btn" data-q="' + escapeHtml(nq) + '">✦ version naturelle</button>' +
          '<div class="qs-nat-out"></div></div>';
      }
      container.innerHTML = html;
      wirePlay(container);
      wireNat(container);
    }).catch(() => {
      // Without this the chain had no rejection handler at all: one failed upstream call left
      // aria-busy set and the "Translating" line on screen forever, with no way for the learner
      // to tell a slow network from a dead one. Only clear OUR render — a superseded one
      // (token !== renderToken) must not wipe the newer query's results.
      if (token !== renderToken) return;
      container.removeAttribute('aria-busy');
      container.innerHTML = '<div class="qs-hint">Translation failed — check the connection and try again.</div>';
    });
  }

  function mount(containerId) {
    const host = document.getElementById(containerId);
    if (!host || host._qsMounted) return;
    host._qsMounted = true;
    host.innerHTML =
      '<div class="qs-box">' +
        '<input type="text" id="qs-input" class="qs-input" maxlength="200" placeholder="Type something…" ' +
               'autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Translate English, French, Spanish or Russian to Hebrew, or look up transliterated Hebrew">' +
        '<div id="qs-results" class="qs-results" role="status" aria-live="polite" aria-atomic="false"></div>' +
      '</div>';
    const input = host.querySelector('#qs-input');
    const results = host.querySelector('#qs-results');
    let t = null;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => render(results, input.value), 350); });
    // Tappable example chips (and any future chips) seed the input.
    results.addEventListener('click', e => {
      const chip = e.target.closest('.qs-chip');
      if (!chip) return;
      input.value = chip.dataset.phrase;
      input.focus();
      render(results, input.value);
    });
    loadPhrases().then(() => { if (input.value) render(results, input.value); });
    render(results, '');
  }

  // `/` focuses the current translator, Escape clears it — registered ONCE at module scope
  // (not per mount()) so reopening the modal doesn't leak a listener + detached DOM each time.
  document.addEventListener('keydown', e => {
    const input = document.getElementById('qs-input');
    if (!input) return;
    if (e.key === '/' && !/^(input|textarea)$/i.test(e.target.tagName) && !e.target.isContentEditable) {
      e.preventDefault(); input.focus(); input.select();
    } else if (e.key === 'Escape' && document.activeElement === input) {
      const results = document.getElementById('qs-results');
      input.value = ''; if (results) render(results, ''); input.blur();
    }
  });

  // renderBreakdown is reused by the lesson Sentence-Builder (app.js) to turn a finished
  // sentence into a per-word morphology micro-lesson, so it's exposed alongside mount.
  window.QuickSay = { mount: mount, renderBreakdown: renderBreakdown };
})();
