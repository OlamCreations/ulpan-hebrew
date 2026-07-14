/* Anonymous usage analytics — self-hosted on the ulpan-morph Cloudflare Worker (/track).
   Purpose: see whether olim actually use the app, and how (which lessons, which features).
   Privacy by design: no cookies, no PII, no IP stored. The only identifier is a random,
   user-resettable anon key kept in localStorage, used to count returning sessions (DAU /
   retention). Respects Do Not Track and a manual kill switch (localStorage ulpan-analytics-off).
   Events are batched and sent with a safelisted text/plain body (no CORS preflight), flushed
   on page hide via sendBeacon so a closed tab still reports. Tracking never blocks or slows the
   app: every failure is swallowed. */
(function () {
  'use strict';
  if (window.__ulpanTrack) return;

  var ENDPOINT = 'https://ulpan-morph.olamcreations.workers.dev/track';

  var off = false;
  try {
    off = localStorage.getItem('ulpan-analytics-off') === '1' ||
      navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes' || window.doNotTrack === '1';
  } catch (e) {}

  // Random anonymous id (no PII). Resettable by the user; only used to count returning sessions.
  var aid = 'anon';
  try {
    aid = localStorage.getItem('ulpan-aid') || '';
    if (!aid) { aid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem('ulpan-aid', aid); }
  } catch (e) {}

  var queue = [];

  function pageSlug() {
    try {
      var p = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
      if (p) return p;
    } catch (e) {}
    return (document.body && document.body.classList.contains('home')) ? 'home' : 'home';
  }

  function flush(useBeacon) {
    if (off || !queue.length) return;
    var payload;
    try { payload = JSON.stringify({ aid: aid, events: queue }); } catch (e) { queue = []; return; }
    queue = [];
    try {
      if (useBeacon && navigator.sendBeacon) { navigator.sendBeacon(ENDPOINT, payload); return; }
      fetch(ENDPOINT, { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
    } catch (e) {}
  }

  // window.track(event, detail, value, opts) — the one call site everything else uses.
  function track(e, detail, val, opts) {
    if (off || !e) return;
    var ev = { e: String(e), page: pageSlug(), detail: detail == null ? '' : String(detail), val: Number(val) || 0 };
    if (opts && opts.lang) ev.lang = String(opts.lang);
    queue.push(ev);
    if (queue.length >= 12) flush(false);
  }

  window.track = track;
  window.__ulpanTrack = { flush: flush, off: off, aid: aid };

  function pageView() { track('page_view', document.referrer ? 'ref' : 'direct'); }
  if (document.readyState !== 'loading') pageView();
  else document.addEventListener('DOMContentLoaded', pageView);

  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', function () { flush(true); });
  setInterval(function () { flush(false); }, 20000);
})();
