// Quick-Say — type English, get Hebrew + transliteration.
// ONLINE-FIRST: as you type, it translates via Google's free endpoint and shows
// the Hebrew + a vocalized romanization (real vowels, not bare consonants).
// A curated offline phrasebook is shown as a bonus when it has a strong match
// (better word choice + niqqud), and becomes the sole source when offline.
// Reuses the app's speak() (Web Speech + voice selector) when present.
(function () {
  'use strict';

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
    else if (p.cat) tag = '<span class="qs-tag">' + escapeHtml(p.cat) + '</span>';
    const tr = p.tr ? '<div class="qs-tr">' + escapeHtml(p.tr) + '</div>' : '';
    return '' +
      '<div class="qs-card">' +
        '<button class="qs-play icon-btn" title="Listen" aria-label="Listen: ' + escapeHtml(p.en) + '" data-he="' + escapeHtml(p.he) + '">▶</button>' +
        '<div class="qs-text">' +
          '<div class="qs-he" dir="rtl" lang="he">' + escapeHtml(p.he) + '</div>' +
          tr +
          '<div class="qs-en">' + escapeHtml(p.en) + ' ' + tag + '</div>' +
        '</div>' +
      '</div>';
  }

  // --- Online translation: Google gtx (translation + romanization), MyMemory fallback ---
  let onlineAbort = null;
  const transCache = new Map(); // nq -> result, avoids re-hitting the API on repeat queries

  // Race a promise against a timeout so a hung request can't freeze "Translating…".
  function withTimeout(promise, ms, onAbort) {
    return new Promise(resolve => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; if (onAbort) onAbort(); resolve(null); } }, ms);
      promise.then(v => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
                   () => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
    });
  }

  function fetchGoogle(q, signal) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=he&dt=t&dt=rm&q=' + encodeURIComponent(q);
    return fetch(url, { signal: signal })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(j => {
        const segs = j && j[0];
        if (!Array.isArray(segs)) return null;
        const he = segs.filter(s => s && s[0]).map(s => s[0]).join('').trim();
        // romanization sits in a segment with a null translation slot, in [2] (Hebrew->Latin).
        const rm = segs.filter(s => s && !s[0]).map(s => s[2]).filter(Boolean).join(' ').trim();
        if (!he) return null;
        return { he: he, tr: rm || null, en: q };
      });
  }

  function fetchMyMemory(q, signal) {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) + '&langpair=en|he';
    return fetch(url, { signal: signal })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(j => {
        const he = j && j.responseData && j.responseData.translatedText;
        if (!he || !/[֐-׿]/.test(he)) return null;
        return { he: he.trim(), tr: null, en: q };
      });
  }

  // --- Romanization: Google's own romanization for Hebrew is unreliable (drops vowels:
  // "ifo" for איפה, "lech" for לך). We instead vocalize the Hebrew with Dicta Nakdan
  // (adds niqqud) and transliterate it ourselves (translit.js) → "eifo", "lecha".
  const NAKDAN_URL = 'https://nakdan-u1-0.loadbalancer.dicta.org.il/api';
  const isHebrew = s => /[֐-׿]/.test(s || '');

  function vocalize(text, signal) {
    if (!isHebrew(text)) return Promise.resolve(null);
    const body = { task: 'nakdan', data: text, genre: 'modern', addmorph: false,
      keepqq: false, nodageshdefault: false, patachma: false, keepmetagim: true };
    return fetch(NAKDAN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: signal
    })
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(toks => {
        if (!Array.isArray(toks)) return null;
        let out = '';
        for (const t of toks) {
          if (t && t.sep) out += (t.word || '');
          else if (t && Array.isArray(t.options) && t.options.length) out += t.options[0];
          else if (t && t.word) out += t.word;
        }
        return out.trim() || null;
      });
  }

  function romanize(hebrew, signal) {
    if (!window.Translit) return Promise.resolve(null);
    return vocalize(hebrew, signal)
      .then(voc => (voc ? (window.Translit.transliterate(voc) || null) : null))
      .catch(() => null);
  }

  function translateOnline(q) {
    const key = q.toLowerCase();
    if (transCache.has(key)) return Promise.resolve(transCache.get(key));
    if (onlineAbort) { try { onlineAbort.abort(); } catch (e) {} }
    onlineAbort = new AbortController();
    const sig = onlineAbort.signal;
    const run = fetchGoogle(q, sig)
      .catch(() => null)
      .then(res => res || fetchMyMemory(q, sig).catch(() => null));
    return withTimeout(run, 8000, () => { try { onlineAbort.abort(); } catch (e) {} })
      .then(res => {
        if (!res) return null;
        // Replace Google's romanization with our niqqud-based one (fall back to Google's if it fails).
        return withTimeout(romanize(res.he, sig), 6000, null)
          .then(tr => { if (tr) res.tr = tr; transCache.set(key, res); return res; });
      });
  }

  function wirePlay(container) {
    container.querySelectorAll('.qs-play').forEach(b => {
      if (b._wired) return; b._wired = true;
      b.addEventListener('click', () => play(b.dataset.he));
    });
  }

  let renderToken = 0;
  function render(container, q) {
    const nq = q.trim();
    if (!nq) {
      container.removeAttribute('aria-busy');
      const examples = ['thank you', 'where is the bathroom', 'how much does it cost', 'I would like to pay'];
      container.innerHTML = '<div class="qs-hint">Type an English word or phrase, or tap an example:</div>' +
        '<div class="qs-chips">' + examples.map(x => '<button type="button" class="qs-chip" data-phrase="' + escapeHtml(x) + '">' + escapeHtml(x) + '</button>').join('') + '</div>';
      return;
    }
    const token = ++renderToken;
    const offline = loaded ? search(nq) : [];

    if (!navigator.onLine) {
      // Plane mode: curated phrasebook only.
      if (offline.length) {
        container.innerHTML = offline.map(p => card(p, 'curated')).join('') +
          '<div class="qs-hint qs-offline">Offline — showing saved phrases only.</div>';
      } else {
        container.innerHTML = '<div class="qs-hint qs-offline">Offline, and no saved phrase matches “' + escapeHtml(nq) + '”. Connect to translate anything.</div>';
      }
      wirePlay(container);
      return;
    }

    // Online-first: show a loading line, fetch, then render online result on top.
    container.setAttribute('aria-busy', 'true');
    container.innerHTML =
      '<div class="qs-loading">Translating</div>' +
      (offline.length ? '<div class="qs-sub">From the lessons</div>' + offline.map(p => card(p, 'curated')).join('') : '');
    wirePlay(container);

    translateOnline(nq).then(res => {
      if (token !== renderToken) return; // a newer keystroke superseded this
      container.removeAttribute('aria-busy');
      const offlineHe = new Set(offline.map(p => p.he.replace(/[֑-ׇ]/g, '')));
      let html = '';
      if (res) {
        const dupe = offlineHe.has(res.he.replace(/[֑-ׇ]/g, ''));
        if (!dupe) html += card(res, 'online');
      } else {
        html += '<div class="qs-hint">Online translation unavailable right now.</div>';
      }
      if (offline.length) {
        html += '<div class="qs-sub">From the lessons</div>' + offline.map(p => card(p, 'curated')).join('');
      } else if (!res) {
        html += '<div class="qs-hint">No saved phrase matches either.</div>';
      }
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
        '<input type="text" id="qs-input" class="qs-input" maxlength="200" placeholder="Say it in Hebrew… (type English)" ' +
               'autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Translate English to Hebrew">' +
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
