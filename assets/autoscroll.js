/* Autoscroll for the liturgy pages — songs, tehilim, prayers, shabbat.
 *
 * Press play and the page creeps down at a chosen speed so both hands stay on the
 * instrument, the way Tab4U and Ultimate Guitar do it. Speed is remembered; the playing
 * state is not, because a page you just opened should never start moving on its own.
 *
 * STANDALONE ON PURPOSE. The 51 liturgy pages load no other script — not app.js, not the
 * shared modules — so this file assumes nothing exists and exports nothing. Do not make it
 * depend on app.js without first deciding to load app.js there, which is a separate
 * question (it would also bring the translator, the hub and the lesson toggles).
 */
(function () {
  'use strict';

  /* Every tunable in one place (LOI 0a — the same shape as CFG in quicksay.js).
   * Speed is in PIXELS PER SECOND, never pixels per frame: a phone at 120Hz would scroll
   * twice as fast as a laptop at 60Hz for the same setting, which is exactly the kind of
   * bug that reads as "it feels different on my phone" and never gets diagnosed. */
  var CFG = {
    key: 'ulpan-autoscroll-speed',
    steps: [8, 12, 16, 22, 30, 40, 52, 68, 88, 115],  // px/s
    defaultStep: 4,                                    // index into steps → 30 px/s
    // A page with nothing to scroll must not offer a control that cannot do anything.
    minScrollable: 240,
    bottomSlack: 2,
  };

  var LABELS = {
    play: 'Start scrolling',
    pause: 'Pause scrolling',
    slower: 'Slower',
    faster: 'Faster',
    speed: 'Scroll speed',
  };

  // ---- state ----------------------------------------------------------------
  var step = CFG.defaultStep;
  try {
    var saved = parseInt(localStorage.getItem(CFG.key), 10);
    if (!isNaN(saved) && saved >= 0 && saved < CFG.steps.length) step = saved;
  } catch (e) {}

  var playing = false;
  var rafId = 0;
  var lastT = 0;
  var carry = 0;      // sub-pixel remainder, so a slow speed still moves smoothly
  var els = {};
  // Set around our own scrollBy. See userTookOver below for why it has to exist.
  var selfScroll = false;

  function speed() { return CFG.steps[step]; }

  /* Every scroll this module performs is EXPLICITLY instant.
   *
   * style.css sets `html { scroll-behavior: smooth }` for the whole site, which is right for
   * an anchor link and wrong for us twice over: the jump back to the top became a several
   * hundred millisecond animation that the running loop then fought, and each frame's own
   * scrollBy is handed to the same animator instead of being applied. Asking for `instant`
   * per call means the page's setting stays as the author intended and this module still
   * moves exactly as far as it computed. */
  function jump(fn, px) {
    try {
      fn.call(window, { top: px, left: 0, behavior: 'instant' });
    } catch (e) {
      fn.call(window, 0, px);      // very old browsers: positional args, no options object
    }
  }

  function maxScroll() {
    var doc = document.documentElement;
    return Math.max(0, doc.scrollHeight - window.innerHeight);
  }

  function atBottom() {
    return window.pageYOffset >= maxScroll() - CFG.bottomSlack;
  }

  // ---- the loop ---------------------------------------------------------------
  function frame(t) {
    if (!playing) return;
    if (!lastT) lastT = t;
    var dt = (t - lastT) / 1000;
    lastT = t;
    // A backgrounded tab hands back one enormous dt on return, which would teleport the
    // page. Clamp to a frame's worth rather than trusting the clock.
    if (dt > 0.1) dt = 0.1;

    carry += speed() * dt;
    var whole = Math.floor(carry);
    if (whole > 0) {
      carry -= whole;
      selfScroll = true;
      jump(window.scrollBy, whole);
      selfScroll = false;
    }
    if (atBottom()) { stop(); return; }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (playing || maxScroll() < 1) return;
    if (atBottom()) jump(window.scrollTo, 0);   // pressing play at the end restarts the page
    playing = true;
    lastT = 0;
    carry = 0;
    rafId = requestAnimationFrame(frame);
    paint();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    paint();
  }

  function toggle() { playing ? stop() : start(); }

  function setStep(next) {
    step = Math.max(0, Math.min(CFG.steps.length - 1, next));
    try { localStorage.setItem(CFG.key, String(step)); } catch (e) {}
    paint();
  }

  // ---- pausing when the reader takes over ---------------------------------------
  // Listen to INPUT (wheel, touch, keys), never to the scroll event: this module scrolls
  // the page itself, so a scroll listener would pause it on its own first frame.
  function userTookOver() { if (playing && !selfScroll) stop(); }

  // ---- ui ------------------------------------------------------------------------
  function paint() {
    if (!els.root) return;
    els.play.setAttribute('aria-pressed', String(playing));
    els.play.setAttribute('aria-label', playing ? LABELS.pause : LABELS.play);
    els.play.title = playing ? LABELS.pause : LABELS.play;
    els.play.classList.toggle('as-playing', playing);
    els.root.classList.toggle('is-playing', playing);
    els.readout.textContent = String(step + 1);
    els.readout.setAttribute('aria-valuenow', String(step + 1));
    els.slower.disabled = step === 0;
    els.faster.disabled = step === CFG.steps.length - 1;
  }

  function build() {
    var root = document.createElement('div');
    root.className = 'as-bar';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Autoscroll');

    var slower = document.createElement('button');
    slower.type = 'button';
    slower.className = 'as-step';
    slower.textContent = '−';
    slower.title = LABELS.slower;
    slower.setAttribute('aria-label', LABELS.slower);

    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'as-play';

    var readout = document.createElement('span');
    readout.className = 'as-readout';
    readout.setAttribute('role', 'slider');
    readout.setAttribute('aria-label', LABELS.speed);
    readout.setAttribute('aria-valuemin', '1');
    readout.setAttribute('aria-valuemax', String(CFG.steps.length));
    readout.tabIndex = 0;

    var faster = document.createElement('button');
    faster.type = 'button';
    faster.className = 'as-step';
    faster.textContent = '+';
    faster.title = LABELS.faster;
    faster.setAttribute('aria-label', LABELS.faster);

    root.appendChild(slower);
    root.appendChild(play);
    root.appendChild(readout);
    root.appendChild(faster);
    document.body.appendChild(root);

    els = { root: root, play: play, slower: slower, faster: faster, readout: readout };

    play.addEventListener('click', toggle);
    slower.addEventListener('click', function () { setStep(step - 1); });
    faster.addEventListener('click', function () { setStep(step + 1); });
    // The readout is a slider to a screen reader, so arrows have to work on it.
    readout.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { setStep(step + 1); e.preventDefault(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { setStep(step - 1); e.preventDefault(); }
    });
    // Pressing a control must not count as "the reader took over".
    root.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: true });
    root.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });

    window.addEventListener('wheel', userTookOver, { passive: true });
    window.addEventListener('touchstart', userTookOver, { passive: true });
    window.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      // The keys that scroll. Anything else (a shortcut, a letter) is not taking over.
      if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End|Space| )$/.test(e.key)) userTookOver();
    });
    // Leaving the tab pauses: coming back to a page that scrolled on without you is worse
    // than coming back to where you left it.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
    });

    paint();
  }

  function init() {
    if (document.querySelector('.as-bar')) return;       // never two bars
    if (maxScroll() < CFG.minScrollable) return;          // nothing to scroll, no control
    build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
