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
    voice() { try { return localStorage.getItem('voice-gender') || 'auto'; } catch (e) { return 'auto'; } },
    setVoice(v) { try { localStorage.setItem('voice-gender', v); } catch (e) {} }
  };
  window.QSPrefs = Prefs;

  const esc = s => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
      '<div class="hub-sub">English, French, Spanish, Russian, or Hebrew you heard</div>' +
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
      toggleRow('pref-niqqud', 'Niqqud', 'Show vowel points on Hebrew.', Prefs.niqqud()),
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
        wireSwitch('pref-cursive', v => Prefs.setCursive(v));
        wireSwitch('pref-niqqud', v => Prefs.setNiqqud(v));
      });
  }
  window.openPrefs = openPrefs;

  // --- Hamburger menu (slide-in drawer) -------------------------------------------
  const MENU_ITEMS = [
    { label: 'Live translator', hint: 'press /', act: openTranslator },
    { label: 'SRS review', hint: '', act: () => { closeMenu(); if (window.openSRSReview) window.openSRSReview(); } },
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
  function openMenu() {
    const menu = document.getElementById('hub-menu');
    const btn = document.getElementById('hub-burger');
    if (menu) menu.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('hub-menu-open');
    syncMenuTheme();
  }

  function buildMenu() {
    if (document.getElementById('hub-burger')) return;
    const header = document.querySelector('header');
    if (!header) return;

    const burger = document.createElement('button');
    burger.id = 'hub-burger'; burger.className = 'hub-burger';
    burger.setAttribute('aria-label', 'Menu'); burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = '<span></span><span></span><span></span>';
    header.appendChild(burger);

    const menu = document.createElement('div');
    menu.id = 'hub-menu';
    menu.innerHTML =
      '<div class="hub-menu-backdrop"></div>' +
      '<nav class="hub-menu-panel" role="menu" aria-label="Menu">' +
        '<div class="hub-menu-head">Menu</div>' +
        MENU_ITEMS.map((it, i) => '<button type="button" class="menu-item" role="menuitem" data-i="' + i + '"' +
          (it.label === 'Toggle theme' ? ' data-role="theme"' : '') + '>' +
          '<span class="menu-label">' + esc(it.label) + '</span>' +
          '<span class="menu-hint">' + esc(it.hint) + '</span></button>').join('') +
      '</nav>';
    document.body.appendChild(menu);

    burger.addEventListener('click', () => {
      const open = menu.classList.contains('open');
      if (open) closeMenu(); else openMenu();
    });
    menu.querySelector('.hub-menu-backdrop').addEventListener('click', closeMenu);
    menu.querySelectorAll('.menu-item').forEach(el => {
      el.addEventListener('click', () => { const it = MENU_ITEMS[+el.dataset.i]; if (it && it.act) it.act(); });
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  }

  function init() {
    buildMenu();
    // `/` opens the translator from anywhere (unless typing).
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/^(input|textarea)$/i.test(e.target.tagName) && !e.target.isContentEditable) {
        if (!document.getElementById('qs-modal')) { e.preventDefault(); openTranslator(); }
      }
    });
    // A home trigger, if present, opens the translator.
    const trigger = document.getElementById('qs-open');
    if (trigger) trigger.addEventListener('click', openTranslator);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
