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
    tNat: 16000,        // ms budget: the on-demand "natural version" (70B model, can be slow cold)
    tForm: 16000        // ms budget: the on-demand gendered/plural version (same 70B model)
  };

  // The forms a learner can ask for. Labelled exactly as the breakdown labels what it finds
  // ("f. sing."), so the chip you press and the grammar line you read afterwards use one vocabulary.
  const FORMS = [
    { g: 'm', n: 'sg', label: 'm. sing.', say: 'the masculine singular' },
    { g: 'f', n: 'sg', label: 'f. sing.', say: 'the feminine singular' },
    { g: 'm', n: 'pl', label: 'm. pl.', say: 'the masculine plural' },
    { g: 'f', n: 'pl', label: 'f. pl.', say: 'the feminine plural' }
  ];

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

  /* Romanized words Input Tools is measured to mis-hear (achshav -> ייחשב, eyfo -> איפו, every
     number from four to ten), and the Hebrew the learner means. Config, not code (LOI 0a) —
     the list is data/romanization-fixes.json, and its rule for admission is written in the file.
     Loaded once, best-effort: with the file absent the translator behaves as before. */
  let ROM_FIXES = {};
  // Keys are folded with romNorm at load, so the file can be written naturally (atzmecha) and
  // still match what the learner types under any spelling (atsmecha, ATZMECHA). Without this
  // fold, one entry in the first version of the file was silently never applied.
  const setRomFixes = raw => { ROM_FIXES = {}; Object.keys(raw || {}).forEach(k => { ROM_FIXES[romNorm(k)] = raw[k]; }); };
  fetch((window.ULPAN_BASE || '') + 'data/romanization-fixes.json')
    .then(r => r.json())
    .then(d => setRomFixes(d && d.fixes))
    .catch(() => {});

  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // phoneme-level romanization key: kh==ch (כ/ח), tz==ts (צ), drop everything non-letter.
  // Same normalization as _translit_test.cjs so the reverse-match agrees with the forward test.
  const romNorm = s => (s || '').toLowerCase().replace(/kh/g, 'ch').replace(/tz/g, 'ts').replace(/[^a-z]/g, '');
  // Consonants only, deliberately: a niqqud mark alone would make a bare vowel point read as
  // "this is Hebrew", and the question being asked is whether there are any Hebrew WORDS here.
  const HEBREW_LETTER = /[א-ת]/;
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

  // --- Copy to clipboard --------------------------------------------------------
  // What gets copied is the BARE Hebrew, not what's on screen: niqqud is a reading aid for the
  // learner and looks wrong (and breaks some fonts) in a WhatsApp message or an email, which is
  // the whole point of the button. The async Clipboard API needs a secure context — the site is
  // HTTPS, but the textarea fallback keeps it working on a plain-http local server and on old
  // Safari, where the modal would otherwise fail silently.
  const COPY_TITLE = 'Copy the plain Hebrew — ready to paste in a message';
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
        document.body.appendChild(ta);
        ta.select(); ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy refused'));
      } catch (e) { reject(e); }
    });
  }

  function wireCopy(container) {
    container.querySelectorAll('.qs-copy').forEach(b => {
      if (b._wired) return; b._wired = true;
      b.addEventListener('click', () => {
        const text = b.dataset.copy || '';
        if (!text) return;
        copyToClipboard(text).then(() => {
          if (window.track) track('phrase_copied');
          b.classList.remove('failed');
          b.classList.add('done');
          b.setAttribute('aria-label', 'Copied');   // the icon swap alone says nothing to a screen reader
          clearTimeout(b._t);
          b._t = setTimeout(() => { b.classList.remove('done'); b.setAttribute('aria-label', 'Copy Hebrew'); }, 1500);
        }).catch(() => {
          b.classList.add('failed');
          clearTimeout(b._t);
          b._t = setTimeout(() => b.classList.remove('failed'), 1500);
        });
      });
    });
  }

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
    const heWordCount = /[֐-׿]/.test(p.he || '')
      ? stripNiqqud(p.he).trim().split(/\s+/).filter(Boolean).length : 0;
    const breakable = heWordCount >= 2;
    const breakBtn = breakable
      ? '<button type="button" class="qs-break" data-he="' + escapeHtml(p.he) + '">Break it down</button>' : '';
    // A ONE-word answer gets its grammar inline instead of behind a button. Looking up a single
    // Hebrew word, the gender is half the answer: Hebrew has no neuter, and every adjective, verb
    // and number that follows has to agree with it — so "table" is not learnable as שולחן alone.
    // Filled asynchronously by wireGnp; stays empty (and CSS-hidden) if the Worker has nothing.
    const gnpSlot = (heWordCount === 1)
      ? '<div class="qs-gnp" data-he="' + escapeHtml(p.he) + '"></div>' : '';
    // Tools column: listen, copy, save. Round icon buttons, same visual language as the lesson
    // word-row, so the same three gestures mean the same thing everywhere in the app.
    const tools =
      '<button class="qs-play icon-btn" title="Listen" aria-label="Listen: ' + escapeHtml(p.he) + '" data-he="' + escapeHtml(p.he) + '">▶</button>' +
      '<button type="button" class="qs-tool qs-copy" title="' + COPY_TITLE + '" aria-label="Copy Hebrew" ' +
        'data-copy="' + escapeHtml(stripNiqqud(p.he || '').trim()) + '"></button>' +
      '<button type="button" class="qs-tool qs-save" title="Save to my phrases" aria-label="Save to my phrases" ' +
        'data-he="' + escapeHtml(p.he) + '" data-tr="' + escapeHtml(p.tr || '') + '" data-en="' + escapeHtml(meaning) + '"></button>';
    return '' +
      '<div class="qs-card' + (breakable ? ' has-break' : '') + '">' +
        '<div class="qs-text">' +
          '<div class="qs-he" dir="rtl" lang="he">' + escapeHtml(heDisp) + '</div>' +
          cursive +
          tr +
          en +
          gnpSlot +
        '</div>' +
        '<div class="qs-tools">' + tools + '</div>' +
        (breakBtn ? '<div class="qs-actions">' + breakBtn + '</div>' : '') +
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

  /* Everyone writing Hebrew in Latin letters marks a prefixed particle with a hyphen — ha-bayit,
     la-lechet, ba-bank — because in Hebrew it IS a prefix and the hyphen is how you show that in
     Latin script. Input Tools reads that hyphen as a word boundary instead, transliterates the
     two-letter particle as a word in its own right, and joins the two with the hyphen it was
     given. The card comes back entirely in Hebrew and entirely wrong, which is the worst shape a
     wrong answer can have: nothing about it looks broken.

         ha-tachana  -> היא-תכנה   "she-software"     (wanted התחנה, the station)
         la-lechet   -> לא-ללכת    "not-to go"        (wanted ללכת, to go)
         ba-bank     -> בא-בנק     "comes-bank"       (wanted בבנק, at the bank)

     Welding the particle to its host fixes it. Measured over 19 candidate particles against what
     a learner means: 14 go from wrong to right, 5 stay wrong for an unrelated reason (eyfo and
     achshav are mis-heard by Input Tools whatever you do), and NOT ONE gets worse. The full set
     is kept rather than only the 14, because even where the meaning stays wrong, welding removes
     a card that falsely presents itself as two glossed Hebrew words.

     The guard is the whole rule and it is not optional: welding a hyphen that is NOT a particle
     destroys the answer, also measured — beit-sefer -> בבית-ספר becomes בביצפר, tel-aviv -> תל-אביב
     becomes תלאביב. So the left side must match a particle EXACTLY (beit and tel do not, be'er
     does not), and everything else keeps the hyphen the user typed. Stacked particles weld left
     to right: me-ha-bayit -> mehabayit -> מהבית. */
  /* Each particle with the single letter it is in Hebrew. The letter is needed when the HOST has
     already been resolved to Hebrew (see resolveSegment): a Latin particle glued to a Hebrew word
     is measured unreliable — "haחודש" comes back האחודש, "veחבר" comes back ויחבר — while the
     particle written as its letter is not: "החודש", "וחבר". */
  const PARTICLE_HE = {
    h: 'ה', ha: 'ה', b: 'ב', be: 'ב', ba: 'ב', l: 'ל', le: 'ל', la: 'ל', m: 'מ', me: 'מ', mi: 'מ',
    k: 'כ', ke: 'כ', ka: 'כ', v: 'ו', ve: 'ו', va: 'ו', u: 'ו', sh: 'ש', she: 'ש'
  };
  const PROCLITICS = new Set(Object.keys(PARTICLE_HE));

  /* Three characters break Input Tools outright, and it never says so. Measured one mark at a
     time in a fixed carrier phrase, everything else — full stop, semicolon, colon, question
     mark, exclamation, dash, ellipsis, bracket — passes through untouched and is even echoed
     back. Only these three:

       '  apostrophe    the ENTIRE result is empty. 10 phrases tested, 10 empty, 10 correct once
                        removed. This is how you romanize the ayin between two vowels — me'od,
                        she'ela, la'azor, be'er sheva — so it is what a phrasebook prints and what
                        a learner types. Every one of them got an empty phonetic section, and the
                        app then fell through to Google's forward translation, which handed back
                        "בְּ-ychola La'azor לִי רָגָ'ה" as if it were an answer.
       "  gershayim     the entire result is empty, the same way. It sits INSIDE Hebrew words
                        (צה"ל), so it is removed rather than spaced, which leaves the consonants
                        the query needs.
       ,  comma         worse than empty, because it looks like it worked: everything after the
                        first comma is silently DROPPED. "ani rotze kafe, bevakasha" came back
                        אני רוצה קפה — the please is gone — correctly pointed, confidently shown.
                        "שלום, מה שלומך" came back שלום. Replaced with a space rather than removed,
                        so "kafe,bevakasha" does not become one welded word.

     None of the three carries information Input Tools uses: it strips punctuation from its own
     output too. So removing them costs nothing and is the difference between half a sentence and
     the sentence. */
  const CLEAN_FOR_IT = q => String(q || '').replace(/['’ʼ׳"״]/g, '').replace(/,/g, ' ');

  /* One hyphen-free Latin piece of what the learner typed, turned into what Input Tools should be
     shown for it. Two things happen here, in this order:

       1. A word we already KNOW is replaced by its Hebrew, from data/romanization-fixes.json.
          Input Tools passes Hebrew through untouched (measured on mixed lines), so it is left to
          guess only the words we do not know — achshav never reaches it as Latin and cannot come
          back as ייחשב. Held-out, on 129 idioms the list was not built from: 84 -> 91 whole
          phrases right, 55 -> 44 wrong words, nothing made worse.

       2. A word beginning with "ch" is sent beginning with "h". In this site's scheme a
          word-initial ch is always ח (a word-initial kaf carries dagesh and is written k), and
          Input Tools reads "ch" as TWO letters, כ then ח: chadash -> כחדש, chaver -> כבר,
          cheshbon -> כחשבון. Written h it hears ח from context. Measured on 30 words and phrases:
          6 right raw, 24 right with h. The rule is per SEGMENT so it also fires after a welded
          particle: ha-chodesh -> ha + hodesh -> החודש. Every alternative was tried first and
          none works — kh 0/15, x 0/15, 7 0/15, hh 0/15, ḥ 0/15. Two common words go the other
          way (cham -> הם) and are in the fix list, which is consulted first. */
  function resolveSegment(seg) {
    if (!/^[A-Za-z]+$/.test(seg)) return seg;
    const known = ROM_FIXES[romNorm(seg)];
    if (known) return known;
    return seg.replace(/^ch/i, m => (m[0] === 'C' ? 'H' : 'h'));
  }

  function weldProclitics(q) {
    return CLEAN_FOR_IT(q).split(/(\s+)/).map(word => {
      const seg = word.split('-').map(resolveSegment);
      if (seg.length === 1) return seg[0];
      let i = 0;
      // seg[i + 1] must be non-empty: a particle needs a host. "ha-" on its own is someone
      // mid-word, and eating their hyphen moves the caret out from under them as they type.
      while (i < seg.length - 1 && seg[i + 1] && PROCLITICS.has(seg[i].toLowerCase())) i++;
      if (i === 0) return seg.join('-');
      const host = seg[i];
      // A host resolved to Hebrew takes its particles as Hebrew letters (see PARTICLE_HE).
      const particles = /[א-ת]/.test(host)
        ? seg.slice(0, i).map(p => PARTICLE_HE[p.toLowerCase()]).join('')
        : seg.slice(0, i).join('');
      return particles + host + seg.slice(i + 1).map(s => '-' + s).join('');
    }).join('');
  }

  /* Input Tools ranks its guesses, and the low-ranked ones are routinely the SAME word with a
     letter repeated: bevakasha came back beside בבבקשה, tovakasha beside תודה רבההה, each one
     then vocalized and transliterated with exactly as much confidence as the real answer. A
     learner has no way to tell which of the three is the word.

     Stated absolutely — "no Hebrew word repeats a letter three times" — the rule has real false
     positives (חנני, ממלכה-class forms: 2 in the 22,252 words of this repository). Stated
     comparatively it has none, because it fires only when a HIGHER-RANKED sibling collapses to
     the same skeleton. The defect was never "this word has doubled letters", it was "the same
     word is offered twice, once padded". */
  /* When the learner has ALREADY typed Hebrew, the phonetic section has exactly one job: put the
     vowel points on what they wrote. Input Tools is a phonetic IME built for Latin input, and
     asked to "correct" real Hebrew it starts proposing other sentences — measured over a capture
     of the live page, 34 of the 58 cards on the Hebrew-input path were a different sentence from
     the one typed, and not one of the 34 was a plausible alternative reading:

         בוקר טוב  -> בוקר אוטובוסים   "morning buses"
         מזל טוב   -> מזל אוטובוסים
         תודה רבה  -> תודה רבהעליך
         ...בשעה תשע בבוקר -> ...בשעה תשע בבוקרשט   "at nine in Bucharest"

     The first version of this filtered those out and stood down if nothing survived, on the
     theory that the other readings might be typo corrections. Then that theory was measured:
     given Hebrew with a typo — שלוום, קפא, צריח — Input Tools returns it UNCHANGED, six out of six.
     It never corrects Hebrew; it only decorates it. So on an all-Hebrew input the call buys one
     round trip, a comma-stripped copy of what was typed (its own punctuation handling), and
     nothing else. It is not made. The candidate is the input, and pointing it is Dicta's job
     downstream, which keeps the punctuation the learner wrote.

     "All-Hebrew" means no Latin letter at all. A mixed line — "איפה hatachana", "אני רוצה kafe"
     — still goes to Input Tools, which passes the Hebrew words through untouched (measured) and
     transliterates the Latin ones, exactly what a learner mixing scripts wants. */
  const isAllHebrew = q => /[א-ת]/.test(q) && !/[A-Za-z]/.test(q);

  const collapseRuns = s => String(s || '').replace(/(.)\1+/g, '$1');
  function dropPadded(cands) {
    const kept = [];
    for (const c of cands) {
      const cc = collapseRuns(c);
      if (kept.some(p => p.length < c.length && collapseRuns(p) === cc)) continue;
      kept.push(c);
    }
    return kept;
  }

  // --- Reverse: romanized Hebrew -> Hebrew script candidates (ranked = the "si hésitation") ---
  /* What Input Tools is actually asked: the query cleaned of the three characters that break
     it, every hyphen-free piece resolved (known word -> its Hebrew; word-initial ch -> h), and
     particle hyphens welded. All of it lives in weldProclitics; this name says what the result
     is for. */
  const phoneticQuery = weldProclitics;

  function fetchInputTools(q, signal) {
    // All-Hebrew: nothing to transliterate, and Input Tools does not correct Hebrew (measured,
    // 6/6 typos returned unchanged). The candidate is the input; Dicta points it downstream.
    if (isAllHebrew(q)) return Promise.resolve([String(q).trim()]);
    const url = 'https://inputtools.google.com/request?text=' + encodeURIComponent(phoneticQuery(q)) +
      '&itc=he-t-i0-und&num=' + CFG.phoneticMax + '&cp=0&cs=1&ie=utf-8&oe=utf-8';
    return fetch(url, { signal: signal })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(j => {
        if (!Array.isArray(j) || j[0] !== 'SUCCESS') return [];
        const block = j[1] && j[1][0];
        const cands = block && block[1];
        return Array.isArray(cands) ? dropPadded(cands.filter(Boolean)) : [];
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
        /* And drop the alternate that is not in Hebrew at all. When a language simply does not
           know the word, gtx does not fail — it hands the input straight back, so asking it to
           read "aujourd'hui" as Spanish produced a card whose Hebrew side read "aujourd'hui",
           with a play button and a copy button on it. That is not the "prefer showing too much"
           case argued above: an extra reading is mild noise, a card offering the learner their
           own question as the answer is the engine failing silently. */
        if (!HEBREW_LETTER.test(a.he)) return;
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
  function vocalizeBare(res, signal, prefer) {
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
    const once = () => fetchMorph(res.he, signal, prefer);
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
    wireCopy(container);
    wireGnp(container);
  }

  // Save a result to the personal phrasebook (window.QSNotebook, owned by hub.js).
  function wireSave(container) {
    container.querySelectorAll('.qs-save').forEach(b => {
      if (b._wired) return; b._wired = true;
      const nb = window.QSNotebook;
      const mark = () => { b.classList.add('on'); b.setAttribute('aria-label', 'Saved to my phrases'); b.title = 'Saved'; };
      if (nb && nb.has(b.dataset.he, b.dataset.en)) mark();
      b.addEventListener('click', () => {
        if (!window.QSNotebook || b.classList.contains('on')) return;
        window.QSNotebook.add({ he: b.dataset.he, tr: b.dataset.tr, en: b.dataset.en });
        if (window.track) track('phrase_saved');
        mark();
      });
    });
  }

  // --- Word-by-word breakdown (deep morphology via the Dicta proxy Worker) --------
  // Config: the Cloudflare Worker that relays Dicta Nakdan (CORS-blocked in the browser) and
  // returns per-word vocalization + root (lemma). Point this at another deployment to move it.
  const MORPH_URL = 'https://ulpan-morph.olamcreations.workers.dev';
  const NAT_URL = MORPH_URL + '/nat';
  const FORM_URL = MORPH_URL + '/form';
  const isHeb = s => /[֐-׿]/.test(s || '');
  const morphCache = new Map();
  const natCache = new Map();
  const formCache = new Map();

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
        b.classList.add('loading'); b.textContent = 'Natural version…';
        if (window.track) track('nat_used');
        const sig = new AbortController().signal;
        const fail = () => { out.innerHTML = '<div class="qs-hint">Natural version isn’t available right now.</div>'; b.classList.remove('loading'); b.textContent = '✦ natural version'; };
        fetchNatural(q, sig).then(opts => {
          if (!opts || !opts.length) return fail();
          // Strip the model's niqqud and re-point each option through Dicta + translit.js.
          return Promise.all(opts.map(o => {
            // en = the phrase the learner typed (the meaning — so Save stores it right); the
            // register note becomes the tag. Strip the model's niqqud; Dicta re-points it.
            const res = { he: stripNiqqud(o.he), rm: null, en: q, cat: o.note ? ('✦ ' + o.note) : '✦ natural' };
            return withTimeout(vocalizeBare(res, sig), CFG.tVocalize).then(v => v || res);
          })).then(cards => {
            out.innerHTML = '<div class="qs-sub">Natural version</div>' + cards.map(c => card(c)).join('');
            wirePlay(out);
            b.style.display = 'none';
          });
        }).catch(fail);
      });
    });
  }

  /* --- Gendered / plural version (on-demand) ------------------------------------------------
     Hebrew has no way to say a sentence without saying who is speaking and who is spoken to. "I
     want a coffee" is רוֹצֶה from a man and רוֹצָה from a woman; "do you want" changes again with who
     is being asked. Google returns exactly one of these and never says which, so a learner reading
     the card has no way to know whether it is the sentence HE can say. Hence a request: pick a
     form, get that form.

     The translation comes from the Worker's /form (the same 70B model as the natural version, told
     which agreement to apply). The POINTING does not: /form hands back consonants only, and they
     are re-pointed through Dicta with the requested gender attached — because for the commonest
     case the consonants are identical and the niqqud IS the whole difference. Ask for the feminine
     of "I want a coffee" without that and Dicta's default answers רוֹצֶה, so the card would say
     "f. sing." above a masculine word and the learner would say it out loud, wrong. */
  function fetchForm(q, g, n, signal) {
    const key = g + n + ':' + q.toLowerCase();
    if (formCache.has(key)) return Promise.resolve(formCache.get(key));
    const run = fetch(FORM_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: q, gender: g, number: n }), signal: signal
    })
      .then(r => { if (!r.ok) throw new Error('form ' + r.status); return r.json(); })
      .then(j => (j && j.options) || []);
    return withTimeout(run, CFG.tForm).then(opts => {
      const o = opts || [];
      if (o.length) formCache.set(key, o);
      return o;
    });
  }

  // Comparison key for "is this actually a different sentence?". Keeps the niqqud — that is the
  // entire difference between רוֹצֶה and רוֹצָה and must never be normalized away — but drops spacing
  // and punctuation: Google keeps the question mark of "where is the station?" and the model does
  // not, and that alone was enough to present an identical sentence as a new form.
  const sameKey = s => (s || '').normalize('NFC').replace(/[\s.,!?;:"'״׳־]/g, '');

  function wireForm(container) {
    container.querySelectorAll('.qs-form').forEach(wrap => {
      if (wrap._wired) return; wrap._wired = true;
      const out = wrap.querySelector('.qs-form-out');
      const q = wrap.dataset.q || '';
      const base = sameKey(wrap.dataset.base || '');
      wrap.querySelectorAll('.qs-form-btn').forEach(b => {
        b.addEventListener('click', () => {
          if (wrap.classList.contains('loading')) return;
          const form = FORMS[+b.dataset.i] || FORMS[0];
          // Pressing the chip that is already showing puts the card away again, so the control is
          // a toggle rather than a one-way door.
          if (b.classList.contains('on')) {
            b.classList.remove('on'); out.innerHTML = ''; return;
          }
          wrap.querySelectorAll('.qs-form-btn').forEach(x => x.classList.remove('on'));
          b.classList.add('on');
          wrap.classList.add('loading');
          out.innerHTML = skeleton('Loading the ' + form.say, 2);
          if (window.track) track('form_used', form.g + form.n);
          const sig = new AbortController().signal;
          const done = () => wrap.classList.remove('loading');
          const fail = () => { out.innerHTML = '<div class="qs-hint">That form isn’t available right now.</div>'; done(); };
          const prefer = { g: form.g, n: form.n };
          fetchForm(q, form.g, form.n, sig).then(opts => {
            if (!opts || !opts.length) return fail();
            return Promise.all(opts.map(o => {
              // The heading above the card already names the form, so the tag carries only what it
              // adds: WHICH participant is carrying it. Repeating "f. sing." in both is noise.
              const res = { he: stripNiqqud(o.he), rm: null, en: q, cat: o.note || '' };
              return withTimeout(vocalizeBare(res, sig, prefer), CFG.tVocalize).then(v => v || res);
            })).then(cards => {
              // Not every sentence HAS a masculine and a feminine — "where is the station?" is the
              // same either way, and the model is told to say so. Showing an identical card under a
              // "f. sing." heading would invent a distinction the language does not make, so say
              // plainly that there is nothing to change. Compared on the POINTED form, never the
              // consonants: רוצה/רוצה are the same letters and genuinely different words.
              const changed = cards.filter(c => sameKey(c.he) !== base);
              if (!changed.length) {
                out.innerHTML = '<div class="qs-hint">This sentence doesn’t change in ' +
                  escapeHtml(form.say) + ' — it is the same as above.</div>';
                return done();
              }
              out.innerHTML = '<div class="qs-sub">' + escapeHtml(form.label) + '</div>' +
                changed.map(c => card(c)).join('');
              wirePlay(out);
              done();
            });
          }).catch(fail);
        });
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

  // `prefer` ({g,n}) asks the Worker for a specific reading instead of Dicta's first guess — the
  // only thing that separates rotze from rotza, which share every letter. It is part of the cache
  // key for the same reason it is part of the Worker's: without it the masculine pointing already
  // held here is handed back to the request that just asked for the feminine one.
  function fetchMorph(text, signal, prefer) {
    const key = 'm:' + (prefer ? prefer.g + (prefer.n || '') : '') + '|' + text;
    if (morphCache.has(key)) return Promise.resolve(morphCache.get(key));
    return fetch(MORPH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefer ? { text: text, prefer: prefer } : { text: text }), signal: signal
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

  // Loading placeholder. Keeps the `.qs-loading` class — the translator probe synchronises on it
  // (a positive "loading gone" signal), and swapping it for a differently-named skeleton would
  // silently break every measurement run. Only the visual changed: a card-shaped shimmer instead
  // of a line of text, so the layout does not jump when the real card lands.
  const skeleton = (label, lines) =>
    '<div class="qs-loading" role="presentation" aria-label="' + label + '">' +
      new Array(lines || 3).fill(0).map((_, i) => '<span class="qs-sk sk-' + i + '"></span>').join('') +
    '</div>';

  function renderBreakdown(out, hebrew, signal) {
    out.innerHTML = skeleton('Breaking down', 2);
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

  /* Inline grammar for a single-word result: part of speech, gender/number, and the dictionary
     form when it differs from the surface. Same token the breakdown uses, same Worker call, same
     preferences (grammar / root) — this is the one-word shape of "Break it down", not a new
     source of truth.
     Measured before shipping, on 30 held-out everyday nouns whose gender is unambiguous in
     standard Hebrew: 29 right, 0 wrong, 1 abstention (כוס, which UDPipe tags Fem,Masc and the
     Worker deliberately refuses to guess on). Silence is the failure mode here, never a guess —
     a confidently wrong gender would teach the learner an error they would then repeat aloud. */
  /* The whole present tense under a verb, straight away — the thing Jonas asked for after looking
     up לנוח and getting an infinitive with nothing to inflect. No round trip: conjugate.js builds
     the forms from the root, the binyan and the pointed word, so the table is there in the same
     frame as the card.

     It appears only when the engine RECOGNISES the class. That is not caution for its own sake:
     the verbs anyone bothers to look up are the irregular ones, and the alternative — a model
     generating forms — cannot be checked, because the only analyser this app can reach tags
     invented words like נוחיתי as a clean Pa'al past. Silence where the pattern is unknown is
     the same rule the gender labels already follow: blank beats wrong. */
  var CONJ_LABELS = [['m.s', 'm. sing.'], ['f.s', 'f. sing.'], ['m.pl', 'm. pl.'], ['f.pl', 'f. pl.']];

  function renderConjugation(slot, tok, lemma) {
    if (!window.Conjugate || !slot || !slot.parentNode) return;
    if (String(tok.pos || '').toLowerCase() !== 'verb') return;
    var built = window.Conjugate.present(lemma, tok.binyan, tok.voc || tok.word || '');
    if (!built) return;

    var prefs = window.QSPrefs;
    var wantTr = !prefs || prefs.translit();
    var wantNiqqud = !prefs || prefs.niqqud();
    var cells = CONJ_LABELS.map(function (pair) {
      var he = built.forms[pair[0]];
      if (!he) return '';
      var shown = wantNiqqud ? he : stripNiqqud(he);
      var tr = wantTr && window.Translit ? window.Translit.transliterate(he) : '';
      return '<div class="qs-cj-cell">' +
        '<div class="qs-cj-tag">' + escapeHtml(pair[1]) + '</div>' +
        '<div class="qs-cj-he" dir="rtl" lang="he">' + escapeHtml(shown) + '</div>' +
        (tr ? '<div class="qs-cj-tr">' + escapeHtml(tr) + '</div>' : '') +
      '</div>';
    }).join('');
    if (!cells) return;

    var host = slot.parentNode.querySelector('.qs-cj');
    if (!host) {
      host = document.createElement('div');
      host.className = 'qs-cj';
      slot.parentNode.insertBefore(host, slot.nextSibling);
    }
    host.innerHTML = '<div class="qs-cj-title">Present tense</div>' +
      '<div class="qs-cj-grid">' + cells + '</div>';
  }

  function wireGnp(container) {
    container.querySelectorAll('.qs-gnp[data-he]').forEach(slot => {
      if (slot._wired) return; slot._wired = true;
      const prefs = window.QSPrefs;
      const wantGrammar = !prefs || prefs.grammar();
      const wantRoot = !prefs || prefs.root();
      if (!wantGrammar && !wantRoot) return;
      withTimeout(fetchMorph(slot.dataset.he, new AbortController().signal), CFG.tMorph)
        .then(tokens => {
          const t = (tokens || []).find(x => x && !x.sep && isHeb(x.word));
          if (!t) return;
          const grammar = wantGrammar ? [t.pos, t.binyan, t.form, t.gnp].filter(Boolean).join(' · ') : '';
          const lemma = stripNiqqud(t.lemma || '');
          const showRoot = wantRoot && lemma && lemma !== stripNiqqud(t.voc || t.word || '');
          if (!grammar && !showRoot) return;
          slot.innerHTML =
            (grammar ? '<span class="qs-gnp-g">' + escapeHtml(grammar) + '</span>' : '') +
            (showRoot ? '<span class="qs-gnp-r" dir="rtl" lang="he" title="root / dictionary form">√ '
              + escapeHtml(lemma) + '</span>' : '');
          renderConjugation(slot, t, lemma);
        })
        .catch(() => {});
    });
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
  /* A single full stop at the end of the query is not part of the question. Google's word choice
     is not stable across it — "I'm just looking (man)" came back מחפש and, with a full stop,
     מסתכל, two different verbs for the same phrase, and the phonetic engine drops it anyway. So
     it is removed HERE, at the one point every path reads the query, which makes the answer
     independent of it by construction: cache keys, the curated lookup, Google and Input Tools
     all see the same string. Only a lone terminal full stop: "?" and "!" carry meaning, and
     "..." is not a full stop. Measured on 26 phrases first — 25 were already stable, and this
     turns the 26th from a coin toss into a rule. */
  const normalizeQuery = q => String(q || '').trim().replace(/(?<![.!?])\.$/, '').trim();

  function render(container, q) {
    const nq = normalizeQuery(q);
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
      skeleton('Translating', 3) +
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
      // Ask for a different agreement. Offered only when there is a translation to vary and the
      // learner typed a language rather than Hebrew — on Hebrew-you-heard the word is already in
      // hand, and the question "how would a woman say this" is not what was asked.
      // data-base carries the POINTED Hebrew on screen, which is what the answer is compared
      // against to tell a real variant from a sentence that simply does not inflect.
      if (!isHeb(nq) && fwdCard && fwdCard.he) {
        html += '<div class="qs-form" data-q="' + escapeHtml(nq) + '" data-base="' + escapeHtml(fwdCard.he) + '">' +
          '<span class="qs-form-lbl">Say it as</span>' +
          '<span class="seg" role="group" aria-label="Grammatical form">' +
          FORMS.map((f, i) => '<button type="button" class="seg-btn qs-form-btn" data-i="' + i + '">' +
            escapeHtml(f.label) + '</button>').join('') +
          '</span><div class="qs-form-out"></div></div>';
      }
      if (!isHeb(nq)) {
        html += '<div class="qs-nat">' +
          '<button type="button" class="qs-nat-btn" data-q="' + escapeHtml(nq) + '">✦ natural version</button>' +
          '<div class="qs-nat-out"></div></div>';
      }
      container.innerHTML = html;
      wirePlay(container);
      wireNat(container);
      wireForm(container);
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
        '<div class="qs-field">' +
          '<span class="qs-field-icon" aria-hidden="true">א</span>' +
          '<input type="text" id="qs-input" class="qs-input" maxlength="200" placeholder="Type something…" ' +
                 'autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Translate English, French, Spanish or Russian to Hebrew, or look up transliterated Hebrew">' +
          '<button type="button" class="qs-clear" aria-label="Clear" title="Clear (Esc)">×</button>' +
        '</div>' +
        '<div id="qs-results" class="qs-results" role="status" aria-live="polite" aria-atomic="false"></div>' +
      '</div>';
    const input = host.querySelector('#qs-input');
    const results = host.querySelector('#qs-results');
    const field = host.querySelector('.qs-field');
    // The clear button only exists while there is something to clear — a dead × in an empty
    // field is the kind of always-there control that makes an interface feel unresponsive.
    const syncClear = () => field.classList.toggle('has-value', !!input.value);
    let t = null;
    input.addEventListener('input', () => { syncClear(); clearTimeout(t); t = setTimeout(() => render(results, input.value), 350); });
    host.querySelector('.qs-clear').addEventListener('click', () => {
      input.value = ''; syncClear(); clearTimeout(t); render(results, ''); input.focus();
    });
    // Tappable example chips (and any future chips) seed the input.
    results.addEventListener('click', e => {
      const chip = e.target.closest('.qs-chip');
      if (!chip) return;
      input.value = chip.dataset.phrase;
      input.focus();
      render(results, input.value);
    });
    loadPhrases().then(() => { if (input.value) render(results, input.value); });
    syncClear();
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
      input.value = '';
      const field = input.closest('.qs-field');
      if (field) field.classList.remove('has-value');   // else the clear × outlives the text it clears
      if (results) render(results, ''); input.blur();
    }
  });

  // renderBreakdown is reused by the lesson Sentence-Builder (app.js) to turn a finished
  // sentence into a per-word morphology micro-lesson, so it's exposed alongside mount.
  // copy/copyTitle are exported so "My phrases" (hub.js) offers the same gesture on a saved
  // phrase as the translator does on a fresh one — one implementation, one fallback path.
  /* weldProclitics and dropPadded are exported so tools/translator-units.mjs can exercise the
     shipped functions in the shipped page instead of re-implementing them in Node. A test that
     recopies the rule it is testing passes on the copy and says nothing about what users get. */
  window.QuickSay = {
    mount: mount, renderBreakdown: renderBreakdown, copy: copyToClipboard, copyTitle: COPY_TITLE,
    _weldProclitics: weldProclitics, _dropPadded: dropPadded, _isAllHebrew: isAllHebrew,
    _phoneticQuery: phoneticQuery, _normalizeQuery: normalizeQuery, _setRomFixes: setRomFixes
  };
})();
