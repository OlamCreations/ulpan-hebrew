/* Let the liturgy pages receive updates.
 *
 * The service worker's scope covers the whole site, so it serves the 51 liturgy pages from
 * cache — but the code that ASKS whether a newer worker exists (`registration.update()`, and
 * the one-time reload when a fresh worker takes control) lives in app.js, and no liturgy page
 * loads app.js. Measured at the time of writing: 986 of 1038 pages could trigger an update,
 * and the 51 that could not were exactly the liturgy ones.
 *
 * The symptom is not subtle and it is not obviously a cache: the page is deployed, the
 * network serves the new file, `curl` proves it — and the installed app keeps showing the old
 * one indefinitely, because nothing on that page ever checks. This file is the check.
 *
 * Same semantics as the block in app.js, deliberately not a copy of its surroundings: derive
 * the site root from THIS script's own URL, never from the document, or it resolves wrong in
 * a subfolder (the rule app.js follows for the same reason).
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  // .../assets/swupdate.js -> .../assets/ -> site root
  var here = (function () {
    var s = document.currentScript;
    if (!s) {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && /swupdate\.js/.test(all[i].src)) { s = all[i]; break; }
      }
    }
    return s && s.src ? new URL('./', s.src).href : new URL('./', location.href).href;
  })();
  var base = new URL('../', here).href;

  // Only reload for a worker that REPLACES one. On a first-ever install there was nothing to
  // replace, and reloading there would bounce the page the first time anyone opens the app.
  var hadController = !!navigator.serviceWorker.controller;
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing || !hadController) return;
    refreshing = true;
    window.location.reload();
  });

  function check() {
    navigator.serviceWorker
      .register(base + 'sw.js', { scope: base, updateViaCache: 'none' })
      .then(function (reg) { try { reg.update(); } catch (e) {} })
      .catch(function () {});
  }

  if (document.readyState === 'complete') check();
  else window.addEventListener('load', check);

  // An installed app is usually RESUMED, not launched: without this, someone who leaves the
  // app open on a psalm and comes back tomorrow never fires a load event and never sees the
  // deploy. Cheap — it is one conditional request against sw.js.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) check();
  });
})();
