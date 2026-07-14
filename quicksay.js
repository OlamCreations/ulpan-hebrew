// Quick-Say — type English, French, Spanish, or Hebrew-you-heard; get the Hebrew.
// Input modes, auto-detected on every keystroke, shown together ("montre les deux"):
//   1. English → Hebrew           (Google gtx, sl=auto)
//   2. French / Spanish → Hebrew  (same call: sl=auto detects fr, es, and any language)
//   3. Transliterated Hebrew → Hebrew word(s), with candidates when unsure ("si hésitation")
//        (Google Input Tools he-t-i0-und, ranked; offline reverse-match against the phrasebook)
// Every Hebrew result is transliterated from Google's own romanization (gtx dt=rm); Dicta
// Nakdan is CORS-blocked in the browser. A curated offline phrasebook is the plane-mode fallback.
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
    tGloss: 6000        // ms budget: HE -> meaning + romanization gloss
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
    loadPromise = fetch('phrasebook.json')
      .then(r => r.json())
      .then(d => { PHRASES = (d && d.phrases) || []; loaded = true; return PHRASES; })
      .catch(() => { PHRASES = []; loaded = true; return PHRASES; });
    return loadPromise;
  }

  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // phoneme-level romanization key: kh==ch (כ/ח), tz==ts (צ), drop everything non-letter.
  // Same normalization as _translit_test.cjs so the reverse-match agrees with the forward test.
  const romNorm = s => (s || '').toLowerCase().replace(/kh/g, 'ch').replace(/tz/g, 'ts').replace(/[^a-z]/g, '');
  const stripNiqqud = s => (s || '').replace(/[֑-ׇ]/g, '');

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
  function looksTransliterated(input, rm) {
    const a = romNorm(input), b = romNorm(rm);
    if (!a || !b) return false;
    if (consSkel(a).length >= 2 && consSkel(a) === consSkel(b)) return true;
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

  const escapeHtml = s => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function card(p, kind) {
    let tag = '';
    if (kind === 'online') tag = '<span class="qs-tag qs-tag-online" title="Translated online">online</span>';
    else if (kind === 'curated') tag = '<span class="qs-tag qs-tag-curated" title="From the lessons, with niqqud">✓ lesson</span>';
    else if (kind === 'phonetic') tag = '<span class="qs-tag qs-tag-phonetic" title="Matched from what you typed phonetically">phonetic</span>';
    else if (kind === 'phonetic-lesson') tag = '<span class="qs-tag qs-tag-curated" title="From the lessons, with niqqud">✓ lesson</span>';
    else if (p.cat) tag = '<span class="qs-tag">' + escapeHtml(p.cat) + '</span>';
    const tr = p.tr ? '<div class="qs-tr">' + escapeHtml(p.tr) + '</div>' : '';
    const meaning = (p.en || '').trim();
    const en = (meaning || tag)
      ? '<div class="qs-en">' + escapeHtml(meaning) + (meaning ? ' ' : '') + tag + '</div>' : '';
    // Preference-aware Hebrew: strip niqqud when the user turned it off; echo the word in
    // cursive (ktav yad) when enabled. Cursive fonts don't carry niqqud, so it's always stripped.
    const prefs = window.QSPrefs;
    const heDisp = (!prefs || prefs.niqqud()) ? p.he : stripNiqqud(p.he);
    const cursive = (prefs && prefs.cursive())
      ? '<div class="qs-he-cursive" dir="rtl" lang="he">' + escapeHtml(stripNiqqud(p.he)) + '</div>' : '';
    return '' +
      '<div class="qs-card">' +
        '<button class="qs-play icon-btn" title="Listen" aria-label="Listen: ' + escapeHtml(p.he) + '" data-he="' + escapeHtml(p.he) + '">▶</button>' +
        '<div class="qs-text">' +
          '<div class="qs-he" dir="rtl" lang="he">' + escapeHtml(heDisp) + '</div>' +
          cursive +
          tr +
          en +
        '</div>' +
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
        return { he: he, tr: rm || null, en: q, src: src, conf: conf };
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
        return { he: he.trim(), tr: null, en: q, src: (langpair || '').split('|')[0] || null, conf: null };
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
        return { en: meaning, tr: rm || null };
      });
  }

  // Retry sources when sl=auto transliterates a short foreign word instead of translating.
  // Only the romance/cyrillic sources the user actually types (prefs) are worth retrying.
  const retrySls = () => ['fr', 'es', 'ru'].filter(l => prefLangs().indexOf(l) >= 0);

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
        if (!res || !single || !looksTransliterated(q, res.tr)) return res;
        return Promise.all(retrySls().map(sl => fetchGoogle(q, signal, sl).catch(() => null)))
          .then(alts => alts.find(a => a && a.he && !looksTransliterated(q, a.tr)) || res);
      });
    return withTimeout(run, CFG.tTranslate)
      .then(res => {
        if (!res) return null;
        // Google's own romanization (dt=rm) is the transliteration. Nakdan is CORS-blocked in
        // the browser, so we keep the raw rm rather than chase a call that always fails.
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
          .then(gl => ({ he: c, tr: (gl && gl.tr) || null, en: (gl && gl.en) || '', bare: c }))
      )).then(list => { phonCache.set(key, list); return { offline: offline, online: list }; });
    });
  }

  function wirePlay(container) {
    container.querySelectorAll('.qs-play').forEach(b => {
      if (b._wired) return; b._wired = true;
      b.addEventListener('click', () => play(b.dataset.he));
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
    if (fwd && !dupeSet.has(stripNiqqud(fwd.he))) cards.push(card(fwd, 'online'));
    fwdOffline.forEach(p => cards.push(card(p, 'curated')));
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
      container.innerHTML = html;
      wirePlay(container);
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
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/^(input|textarea)$/i.test(e.target.tagName) && !e.target.isContentEditable) {
        e.preventDefault(); input.focus(); input.select();
      }
      if (e.key === 'Escape' && document.activeElement === input) { input.value = ''; render(results, ''); input.blur(); }
    });
  }

  window.QuickSay = { mount: mount };
})();
