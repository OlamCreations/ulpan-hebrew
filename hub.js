// Hub — hamburger menu + modal live-translator + preferences. Mobile-first entry points that
// keep the home uncluttered: the translator and settings live in overlays, reachable from the
// menu or the `/` shortcut. Preferences are plain localStorage keys that quicksay.js reads back,
// so this file is the single source of truth for them.
(function () {
  'use strict';

  // --- Preferences (quicksay.js reads the same keys via window.QSPrefs) ----------
  const ALL_LANGS = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
    { code: 'ru', label: 'Русский' }
  ];
  const DEFAULT_LANGS = ALL_LANGS.map(l => l.code);

  const Prefs = {
    langs() {
      try { const v = JSON.parse(localStorage.getItem('qs-src-langs') || 'null');
        return (Array.isArray(v) && v.length) ? v : DEFAULT_LANGS.slice(); }
      catch (e) { return DEFAULT_LANGS.slice(); }
    },
    setLangs(a) { try { localStorage.setItem('qs-src-langs', JSON.stringify(a)); } catch (e) {} },
    cursive() { return localStorage.getItem('qs-cursive') === 'on'; },        // default off
    setCursive(on) { try { localStorage.setItem('qs-cursive', on ? 'on' : 'off'); } catch (e) {} },
    niqqud() { return localStorage.getItem('qs-niqqud') !== 'off'; },          // default on
    setNiqqud(on) { try { localStorage.setItem('qs-niqqud', on ? 'on' : 'off'); } catch (e) {} },
    translit() { return localStorage.getItem('qs-translit') !== 'off'; },      // default on
    setTranslit(on) { try { localStorage.setItem('qs-translit', on ? 'on' : 'off'); } catch (e) {} },
    root() { return localStorage.getItem('qs-root') !== 'off'; },              // default on
    setRoot(on) { try { localStorage.setItem('qs-root', on ? 'on' : 'off'); } catch (e) {} },
    grammar() { return localStorage.getItem('qs-grammar') !== 'off'; },        // default on
    setGrammar(on) { try { localStorage.setItem('qs-grammar', on ? 'on' : 'off'); } catch (e) {} },
    voice() { try { return localStorage.getItem('voice-gender') || 'auto'; } catch (e) { return 'auto'; } },
    setVoice(v) { try { localStorage.setItem('voice-gender', v); } catch (e) {} }
  };
  window.QSPrefs = Prefs;

  const esc = s => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stripN = s => (s || '').replace(/[֑-ׇ]/g, '');

  // --- Personal phrasebook: one store, two views (Manual + Journal) ---------------
  const Notebook = {
    all() { try { return JSON.parse(localStorage.getItem('qs-notebook') || '[]'); } catch (e) { return []; } },
    write(list) { try { localStorage.setItem('qs-notebook', JSON.stringify(list)); } catch (e) {} },
    has(he, en) { return Notebook.all().some(x => x.he === he && x.en === en); },
    add(entry) {
      const list = Notebook.all();
      if (list.some(x => x.he === entry.he && x.en === entry.en)) return false;
      list.push(Object.assign({ id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), date: Date.now(), note: '' }, entry));
      Notebook.write(list); return true;
    },
    remove(id) { Notebook.write(Notebook.all().filter(x => x.id !== id)); },
    update(id, patch) { const l = Notebook.all(); const i = l.findIndex(x => x.id === id); if (i >= 0) { l[i] = Object.assign(l[i], patch); Notebook.write(l); } }
  };
  window.QSNotebook = Notebook;

  // Today's Hebrew date with classic (Western) day numbers — gematria letters are unfamiliar
  // without a lesson — plus a transliteration of the spoken date, so the day number teaches the
  // Hebrew numbers: you see "29 בתמוז", read "esrim ve-tisha be-Tammuz", learn 29 = esrim ve-tisha.
  const T_ONES = ['', 'echad', 'shnayim', 'shlosha', 'arbaa', 'chamisha', 'shisha', 'shiva', 'shmona', 'tisha'];
  const T_TEEN = ['asara', 'achad-asar', 'shneim-asar', 'shlosha-asar', 'arbaa-asar', 'chamisha-asar', 'shisha-asar', 'shiva-asar', 'shmona-asar', 'tisha-asar'];
  function dayTranslit(n) {
    if (n >= 1 && n <= 9) return T_ONES[n];
    if (n >= 10 && n <= 19) return T_TEEN[n - 10];
    if (n === 20) return 'esrim';
    if (n >= 21 && n <= 29) return 'esrim ve-' + T_ONES[n - 20];
    if (n === 30) return 'shloshim';
    return String(n);
  }
  const HE_MONTHS = { 'תשרי': 'Tishrei', 'חשוון': 'Cheshvan', 'חשון': 'Cheshvan', 'כסלו': 'Kislev', 'טבת': 'Tevet',
    'שבט': 'Shvat', 'אדר': 'Adar', 'אדרא': 'Adar I', 'אדרב': 'Adar II', 'ניסן': 'Nisan', 'אייר': 'Iyar',
    'סיון': 'Sivan', 'סיוון': 'Sivan', 'תמוז': 'Tammuz', 'אב': 'Av', 'אלול': 'Elul' };
  function monthTranslit(name) { return HE_MONTHS[(name || '').replace(/[^א-ת]/g, '')] || name; }
  function hebrewDate() {
    try {
      const now = new Date();
      const day = parseInt(new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric' }).format(now), 10);
      const monthHe = new Intl.DateTimeFormat('he-u-ca-hebrew', { month: 'long' }).format(now);
      if (!day) return null;
      return { he: day + ' ב' + monthHe, tr: dayTranslit(day) + ' be-' + monthTranslit(monthHe) };
    } catch (e) { return null; }
  }

  // --- Generic overlay (mirrors the SRS modal; reuses app.js makeModalAccessible) --
  function openOverlay(id, cardClass, innerHtml, onMount) {
    const prev = document.getElementById(id);
    if (prev) prev.remove();
    const m = document.createElement('div');
    m.id = id; m.className = 'hub-modal';
    m.innerHTML = '<div class="hub-overlay"></div><div class="' + cardClass + '" role="dialog" tabindex="-1"></div>';
    const card = m.querySelector('[role="dialog"]');
    card.innerHTML = innerHtml;
    document.body.appendChild(m);
    m.querySelector('.hub-overlay').addEventListener('click', () => m.remove());
    if (typeof window.makeModalAccessible === 'function') window.makeModalAccessible(m, card);
    else document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', esc); } });
    if (onMount) onMount(card, m);
    return m;
  }

  // --- Live translator, as a modal ------------------------------------------------
  function openTranslator() {
    closeMenu();
    openOverlay('qs-modal', 'hub-card qs-modal-card',
      '<button class="hub-close" aria-label="Close">×</button>' +
      '<div class="hub-title">Live translator</div>' +
      '<div class="hub-sub">Type a phrase, or Hebrew you heard</div>' +
      '<div id="qs-modal-mount"></div>',
      (card, m) => {
        card.querySelector('.hub-close').addEventListener('click', () => m.remove());
        if (window.QuickSay && typeof window.QuickSay.mount === 'function') window.QuickSay.mount('qs-modal-mount');
        setTimeout(() => { const i = card.querySelector('#qs-input'); if (i) i.focus(); }, 30);
      });
  }
  window.openTranslator = openTranslator;

  // --- Preferences panel ----------------------------------------------------------
  function toggleRow(id, label, hint, on) {
    return '<div class="pref-row"><div><div class="pref-label">' + esc(label) + '</div>' +
      (hint ? '<div class="pref-hint">' + esc(hint) + '</div>' : '') + '</div>' +
      '<button type="button" class="pref-switch' + (on ? ' on' : '') + '" id="' + id + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"><span class="knob"></span></button></div>';
  }
  function segRow(label, hint, options, current, groupId) {
    const btns = options.map(o => '<button type="button" class="seg-btn' + (o.value === current ? ' on' : '') +
      '" data-val="' + o.value + '">' + esc(o.label) + '</button>').join('');
    return '<div class="pref-row"><div><div class="pref-label">' + esc(label) + '</div>' +
      (hint ? '<div class="pref-hint">' + esc(hint) + '</div>' : '') + '</div>' +
      '<div class="seg" id="' + groupId + '">' + btns + '</div></div>';
  }

  function openPrefs() {
    closeMenu();
    const t = (localStorage.getItem('theme') || 'light');
    const langs = Prefs.langs();
    const langChips = ALL_LANGS.map(l => '<button type="button" class="lang-chip' + (langs.indexOf(l.code) >= 0 ? ' on' : '') +
      '" data-lang="' + l.code + '">' + esc(l.label) + '</button>').join('');

    openOverlay('prefs-modal', 'hub-card prefs-card',
      '<button class="hub-close" aria-label="Close">×</button>' +
      '<div class="hub-title">Preferences</div>' +
      segRow('Theme', 'Dark is the real mode; light is the adaptation.',
        [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], t, 'pref-theme') +
      segRow('Voice', 'Hebrew text-to-speech.',
        [{ value: 'auto', label: 'Auto' }, { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }], Prefs.voice(), 'pref-voice') +
      '<div class="pref-row col"><div><div class="pref-label">Translate from</div>' +
        '<div class="pref-hint">Languages you type into the translator.</div></div>' +
        '<div class="lang-chips" id="pref-langs">' + langChips + '</div></div>' +
      toggleRow('pref-cursive', 'Cursive (ktav yad)', 'Show results in Israeli handwriting too.', Prefs.cursive()) +
      toggleRow('pref-niqqud', 'Niqqud', 'Show vowel points on Hebrew.', Prefs.niqqud()) +
      toggleRow('pref-translit', 'Transliteration', 'Show the Latin reading under Hebrew.', Prefs.translit()) +
      toggleRow('pref-root', 'Root in breakdown', 'Show the √ root in the word-by-word view.', Prefs.root()) +
      toggleRow('pref-grammar', 'Grammar in breakdown', 'Show part of speech, binyan and tense.', Prefs.grammar()),
      (card, m) => {
        card.querySelector('.hub-close').addEventListener('click', () => m.remove());

        card.querySelector('#pref-theme').addEventListener('click', e => {
          const b = e.target.closest('.seg-btn'); if (!b) return;
          if (typeof window.toggleTheme === 'function' && (localStorage.getItem('theme') || 'light') !== b.dataset.val) window.toggleTheme();
          else { localStorage.setItem('theme', b.dataset.val); if (window.applyTheme) window.applyTheme(b.dataset.val); }
          card.querySelectorAll('#pref-theme .seg-btn').forEach(x => x.classList.toggle('on', x === b));
        });
        card.querySelector('#pref-voice').addEventListener('click', e => {
          const b = e.target.closest('.seg-btn'); if (!b) return;
          Prefs.setVoice(b.dataset.val);
          card.querySelectorAll('#pref-voice .seg-btn').forEach(x => x.classList.toggle('on', x === b));
        });
        card.querySelector('#pref-langs').addEventListener('click', e => {
          const b = e.target.closest('.lang-chip'); if (!b) return;
          let cur = Prefs.langs();
          const code = b.dataset.lang;
          if (cur.indexOf(code) >= 0) { if (cur.length > 1) cur = cur.filter(c => c !== code); }  // keep at least one
          else cur = cur.concat([code]);
          Prefs.setLangs(cur);
          b.classList.toggle('on', cur.indexOf(code) >= 0);
        });
        const wireSwitch = (id, setter) => {
          const el = card.querySelector('#' + id);
          el.addEventListener('click', () => {
            const on = !el.classList.contains('on');
            el.classList.toggle('on', on); el.setAttribute('aria-checked', on ? 'true' : 'false');
            setter(on);
          });
        };
        wireSwitch('pref-cursive', v => { Prefs.setCursive(v); refreshTranslator(); });
        wireSwitch('pref-niqqud', v => { Prefs.setNiqqud(v); refreshTranslator(); });
        wireSwitch('pref-translit', v => { Prefs.setTranslit(v); refreshTranslator(); });
        wireSwitch('pref-root', v => { Prefs.setRoot(v); refreshTranslator(); });
        wireSwitch('pref-grammar', v => { Prefs.setGrammar(v); refreshTranslator(); });
      });
  }
  window.openPrefs = openPrefs;

  // --- My phrases (saved phrases, two views) --------------------------------------
  const fmtDate = ts => { try { return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };

  function phraseRowHtml(e, tab) {
    const prefs = window.QSPrefs;
    const he = (prefs && !prefs.niqqud()) ? stripN(e.he) : e.he;
    return '<div class="ph-row" data-id="' + e.id + '">' +
      '<button class="ph-play icon-btn" title="Listen" data-he="' + esc(e.he) + '">▶</button>' +
      '<div class="ph-text">' +
        '<div class="ph-he" dir="rtl" lang="he">' + esc(he) + '</div>' +
        (e.tr ? '<div class="ph-tr">' + esc(e.tr) + '</div>' : '') +
        (e.en ? '<div class="ph-en">' + esc(e.en) + '</div>' : '') +
        (tab === 'journal' ? '<div class="ph-date">' + esc(fmtDate(e.date)) + '</div>' : '') +
        '<input class="ph-note" placeholder="add a note…" value="' + esc(e.note || '') + '">' +
      '</div>' +
      '<button class="ph-del" title="Delete" aria-label="Delete" data-id="' + e.id + '">×</button>' +
    '</div>';
  }

  function renderPhrases(host, tab, query) {
    let list = Notebook.all();
    if (!list.length) { host.innerHTML = '<div class="ph-empty">No saved phrases yet. Translate something and tap <strong>Save</strong>.</div>'; return; }
    if (query) { const q = query.toLowerCase(); list = list.filter(e => (e.he + ' ' + (e.tr || '') + ' ' + (e.en || '') + ' ' + (e.note || '')).toLowerCase().indexOf(q) !== -1); }
    list = (tab === 'journal')
      ? list.slice().sort((a, b) => b.date - a.date)
      : list.slice().sort((a, b) => (a.tr || a.en || '').localeCompare(b.tr || b.en || ''));
    host.innerHTML = list.map(e => phraseRowHtml(e, tab)).join('') || '<div class="ph-empty">No match.</div>';
    host.querySelectorAll('.ph-play').forEach(b => b.addEventListener('click', () => { if (typeof window.speak === 'function') window.speak(b.dataset.he, 0.8); }));
    host.querySelectorAll('.ph-del').forEach(b => b.addEventListener('click', () => { Notebook.remove(b.dataset.id); renderPhrases(host, tab, query); }));
    host.querySelectorAll('.ph-note').forEach(inp => inp.addEventListener('change', () => { Notebook.update(inp.closest('.ph-row').dataset.id, { note: inp.value }); }));
  }

  function openPhrases() {
    closeMenu();
    let tab = 'manual';
    openOverlay('phrases-modal', 'hub-card phrases-card',
      '<button class="hub-close" aria-label="Close">×</button>' +
      '<div class="hub-title">My phrases</div>' +
      '<div class="hub-sub">Everything you save, as a manual or a journal.</div>' +
      '<div class="seg ph-tabs"><button type="button" class="seg-btn on" data-tab="manual">Manual</button>' +
        '<button type="button" class="seg-btn" data-tab="journal">Journal</button></div>' +
      '<input class="ph-search qs-input" placeholder="Search your phrases…">' +
      '<div class="ph-list"></div>',
      (card, m) => {
        card.querySelector('.hub-close').addEventListener('click', () => m.remove());
        const host = card.querySelector('.ph-list');
        const search = card.querySelector('.ph-search');
        const draw = () => renderPhrases(host, tab, search.value.trim());
        card.querySelector('.ph-tabs').addEventListener('click', e => {
          const b = e.target.closest('.seg-btn'); if (!b) return;
          tab = b.dataset.tab;
          card.querySelectorAll('.ph-tabs .seg-btn').forEach(x => x.classList.toggle('on', x === b));
          search.style.display = (tab === 'manual') ? '' : 'none';
          draw();
        });
        search.addEventListener('input', draw);
        draw();
      });
  }
  window.openPhrases = openPhrases;

  // --- Hamburger menu (slide-in drawer) -------------------------------------------
  const clickHidden = id => { closeMenu(); const b = document.getElementById(id); if (b) b.click(); };
  const hasBtn = id => () => !!document.getElementById(id);
  const MENU_ITEMS = [
    { label: 'Live translator', hint: 'press /', act: openTranslator },
    { label: 'My phrases', hint: '', act: openPhrases },
    { label: 'SRS review', hint: '', showIf: hasBtn('d-srs-btn'), act: () => { closeMenu(); if (window.openSRSReview) window.openSRSReview(); } },
    { label: 'Mixed quiz', hint: '', showIf: hasBtn('d-quiz-btn'), act: () => clickHidden('d-quiz-btn') },
    { label: 'Wrong words', hint: '', showIf: hasBtn('d-review-btn'), act: () => clickHidden('d-review-btn') },
    // Lesson-page actions (route to the hidden floating-control buttons app.js still injects).
    { label: 'Reveal all', hint: '', showIf: hasBtn('fc-show-all'), act: () => clickHidden('fc-show-all') },
    { label: 'Hide all', hint: '', showIf: hasBtn('fc-hide-all'), act: () => clickHidden('fc-hide-all') },
    { label: 'Listen to all', hint: '', showIf: hasBtn('fc-listen-all'), act: () => clickHidden('fc-listen-all') },
    { label: 'Add all to review', hint: '', showIf: hasBtn('fc-add-sr'), act: () => clickHidden('fc-add-sr') },
    { label: 'SRS review', hint: '', showIf: hasBtn('fc-srs'), act: () => clickHidden('fc-srs') },
    { label: 'Print', hint: '', showIf: hasBtn('fc-print'), act: () => clickHidden('fc-print') },
    { label: 'Shortcuts', hint: '', showIf: hasBtn('fc-help'), act: () => clickHidden('fc-help') },
    { label: 'Preferences', hint: '', act: openPrefs },
    { label: 'Toggle theme', hint: '', act: () => { if (window.toggleTheme) window.toggleTheme(); syncMenuTheme(); } },
    { label: 'No sound? Install a voice', hint: '', act: () => { closeMenu(); if (window.showVoiceBanner) window.showVoiceBanner(true); } }
  ];

  function syncMenuTheme() {
    const el = document.querySelector('#hub-menu [data-role="theme"] .menu-hint');
    if (el) el.textContent = (localStorage.getItem('theme') || 'light') === 'light' ? 'dark' : 'light';
  }
  function closeMenu() {
    const menu = document.getElementById('hub-menu');
    const btn = document.getElementById('hub-burger');
    if (menu) menu.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('hub-menu-open');
  }
  // Render menu items on each open so page-specific actions (lesson floating-control buttons
  // injected by app.js after the hub builds) are detected fresh, not frozen at build time.
  function renderMenuItems() {
    const host = document.querySelector('#hub-menu .hub-menu-items');
    if (!host) return;
    const items = MENU_ITEMS.filter(it => !it.showIf || it.showIf());
    host.innerHTML = items.map((it, i) => '<button type="button" class="menu-item" role="menuitem" data-i="' + i + '"' +
      (it.label === 'Toggle theme' ? ' data-role="theme"' : '') + '>' +
      '<span class="menu-label">' + esc(it.label) + '</span>' +
      '<span class="menu-hint">' + esc(it.hint) + '</span></button>').join('');
    host.querySelectorAll('.menu-item').forEach(el => {
      el.addEventListener('click', () => { const it = items[+el.dataset.i]; if (it && it.act) it.act(); });
    });
  }
  function openMenu() {
    const menu = document.getElementById('hub-menu');
    const btn = document.getElementById('hub-burger');
    renderMenuItems();
    if (menu) menu.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('hub-menu-open');
    syncMenuTheme();
  }

  // Re-render the open translator so a preference change (cursive/niqqud) lands immediately
  // instead of only on the next keystroke. Cached results mean this rarely re-hits the network.
  function refreshTranslator() {
    const inp = document.getElementById('qs-input');
    if (inp && inp.value.trim()) inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
  window.refreshTranslator = refreshTranslator;

  function buildMenu() {
    if (document.getElementById('hub-burger')) return;
    const header = document.querySelector('header');
    if (!header) return;

    // Today's Hebrew date on the left of the top bar (home only), with a transliteration below
    // so the daily-changing day number teaches the Hebrew numbers.
    if (document.body && document.body.classList.contains('home')) {
      const hd = hebrewDate();
      if (hd) {
        const d = document.createElement('div');
        d.className = 'hub-hdate'; d.title = 'Today (Hebrew date)';
        d.innerHTML = '<span class="hd-he" dir="rtl" lang="he">' + esc(hd.he) + '</span>' +
          '<span class="hd-tr">' + esc(hd.tr) + '</span>';
        header.appendChild(d);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'hub-actions';

    // Back to the lesson index — every page except the home.
    if (!(document.body && document.body.classList.contains('home'))) {
      const back = document.createElement('a');
      back.className = 'hub-back'; back.href = 'index.html';
      back.setAttribute('aria-label', 'Back to index'); back.title = 'Back to index';
      back.innerHTML = '<span>←</span>';
      actions.appendChild(back);
    }

    // One-tap translator, immediately left of the hamburger.
    const tbtn = document.createElement('button');
    tbtn.id = 'hub-translate'; tbtn.className = 'hub-translate';
    tbtn.setAttribute('aria-label', 'Live translator');
    tbtn.title = 'Live translator (/)';
    tbtn.innerHTML = '<span>א</span>';
    tbtn.addEventListener('click', openTranslator);
    actions.appendChild(tbtn);

    const burger = document.createElement('button');
    burger.id = 'hub-burger'; burger.className = 'hub-burger';
    burger.setAttribute('aria-label', 'Menu'); burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = '<span></span><span></span><span></span>';
    actions.appendChild(burger);

    header.appendChild(actions);

    const menu = document.createElement('div');
    menu.id = 'hub-menu';
    menu.innerHTML =
      '<div class="hub-menu-backdrop"></div>' +
      '<nav class="hub-menu-panel" role="menu" aria-label="Menu">' +
        '<div class="hub-menu-head">Menu</div>' +
        '<div class="hub-menu-items"></div>' +
      '</nav>';
    document.body.appendChild(menu);

    burger.addEventListener('click', () => { menu.classList.contains('open') ? closeMenu() : openMenu(); });
    menu.querySelector('.hub-menu-backdrop').addEventListener('click', closeMenu);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  }

  function init() {
    buildMenu();
    // Home: mount the translator inline for direct access; elsewhere it lives in the modal.
    if (document.getElementById('qs-mount') && window.QuickSay) window.QuickSay.mount('qs-mount');
    // `/` opens the modal translator — unless one already exists (inline on the home, or the
    // modal is open), in which case QuickSay's own handler just focuses it.
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/^(input|textarea)$/i.test(e.target.tagName) && !e.target.isContentEditable) {
        if (!document.getElementById('qs-input') && !document.getElementById('qs-modal')) { e.preventDefault(); openTranslator(); }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
