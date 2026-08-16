/* translator-driver.mjs — type into the real translator and know when it has finished.
 *
 * Extracted from tools/translator-probe.mjs so that the probe and the metamorphic runner share
 * ONE synchronisation. That is not tidiness. Waiting correctly here is the hard part of the
 * whole harness, it has been got wrong twice, and each time the wrong answer was a confident
 * green: the first version invented 40 failures the engine never had and the second invented
 * 20 more. A second copy of this logic would drift from the first and there would be no way to
 * tell which numbers to believe.
 *
 * The three traps, kept here where the code is (the third is documented at arm() below):
 *
 *   1. The input is debounced by 350ms. For the first third of a second after typing, the
 *      results container still holds the PREVIOUS state. "Wait until the DOM stops changing"
 *      therefore reports a stable result before rendering has begun.
 *   2. Clearing the field does NOT clear the results — that render is cancelled by the same
 *      debounce. So "there is something on screen" is satisfied instantly by the previous
 *      query's cards, and the harness reads the wrong phrase while looking successful.
 *
 *   3. A cached answer can be painted and finished between two samples of a 100ms poll, leaving
 *      a signature identical to the one before typing — indistinguishable from no render at all.
 *
 * The fix for the first two is to compare against a signature taken BEFORE typing, and to wait
 * for a positive finished signal rather than for the absence of change. The fix for the third is
 * to stop sampling and observe: see arm().
 *
 * Every one of the three produced confident, plausible, entirely fictional bug reports before it
 * was found. That is the standing hazard of this file — its failures do not look like failures,
 * they look like findings.
 */

/** A cheap signature of the results container: what changed, not what it says. */
export const snapshot = page => page.evaluate(() => {
  const r = document.getElementById('qs-results');
  if (!r) return { busy: false, len: 0, cards: 0, loading: false };
  return {
    busy: r.getAttribute('aria-busy') === 'true',
    len: r.innerHTML.length,
    cards: r.querySelectorAll('.qs-card').length,
    /* The positive "still working" marker. aria-busy alone is not enough: the loading line
       outlives it on a slow request, and waiting only on aria-busy let that line sit still
       through the stability window and be recorded as a finished empty result. */
    loading: !!r.querySelector('.qs-loading'),
  };
});

export const sig = s => `${s.busy}|${s.len}|${s.cards}|${s.loading}`;

/* --------------------------------------------------------------- render watch
 * Trap 3, and the one that cost the most. The two above are about reading too early. This one
 * is about not seeing the render at all.
 *
 * Start-of-render used to be detected by polling every 100ms for a changed signature or a busy
 * flag. That works while an answer takes a second to arrive. It does not work when the Worker
 * serves a cached translation in about 90ms: render() paints its skeleton, the answer lands,
 * aria-busy clears, and the container settles on markup IDENTICAL to what was there before —
 * all between two samples. The signature then equals the baseline, the poll concludes nothing
 * ever started, and the harness records "produced nothing" while the correct answer is on
 * screen the whole time.
 *
 * That single blind spot produced ten of the fifteen relations the first metamorphic run called
 * broken, and it produced them in the most convincing possible shape: M1 saying the engine is
 * non-deterministic, M3 saying stray spaces change its answer. Both accusations were the cache
 * being fast. Note the direction of the bias — the faster and more correct the engine gets, the
 * more bugs this harness invented.
 *
 * A MutationObserver cannot miss it. render() assigns innerHTML unconditionally, so a mutation
 * fires even when the resulting HTML is byte-identical, and the observer records it whether or
 * not anyone was sampling at that instant. Polling asks "is it different now"; this asks "did
 * anything happen since I armed", which is the question that was actually being asked all along.
 */
export const arm = page => page.evaluate(() => {
  const r = document.getElementById('qs-results');
  if (!r) return;
  if (!window.__qsObs) {
    window.__qsMut = 0;
    window.__qsObs = new MutationObserver(() => { window.__qsMut++; });
    window.__qsObs.observe(r, { childList: true, subtree: true, characterData: true });
  }
  window.__qsMut = 0;
});

const mutations = page => page.evaluate(() => window.__qsMut || 0);

/**
 * Wait for the render triggered by the last keystroke.
 * @param {string} beforeKey signature taken BEFORE typing — the only reliable way to tell a
 *   new render from the previous query's results still sitting on screen.
 * @returns {{settled: boolean, rendered: boolean}} `rendered:false` means the page genuinely
 *   produced nothing, which is a result and not a harness failure.
 */
export async function settle(page, beforeKey, maxMs = 20000) {
  const t0 = Date.now();

  /* Any of the three is enough, and the mutation count is the only one that cannot be missed
     by sampling. The other two are kept because they cost nothing and cover the case where the
     observer failed to attach at all — a silent arm() would otherwise turn every result into
     "produced nothing" and look like a catastrophic engine failure. */
  let started = false;
  while (Date.now() - t0 < 4000) {
    const s = await snapshot(page);
    if (await mutations(page) > 0 || sig(s) !== beforeKey || s.busy || s.loading) { started = true; break; }
    await page.waitForTimeout(100);
  }
  if (!started) return { settled: true, rendered: false };

  while (Date.now() - t0 < maxMs) {
    const s = await snapshot(page);
    if (!s.busy && !s.loading) break;
    await page.waitForTimeout(150);
  }

  // Stable for a beat: late sections can still land after aria-busy clears.
  let last = '', stableSince = 0;
  while (Date.now() - t0 < maxMs) {
    const s = await snapshot(page);
    const key = sig(s);
    if (key === last) {
      if (!stableSince) stableSince = Date.now();
      else if (Date.now() - stableSince > 600) return { settled: true, rendered: true };
    } else { last = key; stableSince = 0; }
    await page.waitForTimeout(150);
  }
  return { settled: false, rendered: true };
}

/* --------------------------------------------------------------- throttle watch
 * The worker meters AI paths at 12 requests per 60 seconds (RL_AI in wrangler.toml) and answers
 * 429 {error:'rate limited'} over that line. On the page a 429 looks exactly like a translation
 * the engine declined to produce: no cards, no error, an empty results box.
 *
 * That collision is not hypothetical. The metamorphic runner fires four to ten requests per
 * seed, sailed past twelve, and reported that the engine was non-deterministic and that stray
 * spaces changed its answer — fifteen broken relations, of which the majority were this harness
 * throttling itself and then reading its own silence as an engine bug. Slowing down was not the
 * fix either: at 700ms between requests the same false failures came back identically, because
 * 700ms is still five times too fast for this limiter.
 *
 * So the harness watches the wire. A check whose requests were throttled is reported UNTESTED
 * with the reason attached, never as a violation. A measurement you were prevented from taking
 * is not a measurement that failed.
 */
export function watchUpstream(page) {
  let seen = [];
  page.on('response', r => {
    const u = r.url();
    if (/localhost|127\.0\.0\.1/.test(u)) return;   // the page itself, not the engine
    seen.push({ url: u, status: r.status() });
  });
  return {
    /** Read and reset. Returns { throttled, statuses } for the window since the last drain. */
    drain() {
      const batch = seen; seen = [];
      return { throttled: batch.some(r => r.status === 429), statuses: batch };
    },
    /** Wait out the limiter's window. Called only after a 429 has actually been observed. */
    async cool(page, ms = 62000) { await page.waitForTimeout(ms); seen = []; }
  };
}

/** Type one input and wait for its result. Clears first, and takes the baseline AFTER clearing. */
export async function ask(page, input) {
  await page.fill('#qs-input', '');
  await page.waitForTimeout(120);
  const beforeKey = sig(await snapshot(page));
  await arm(page);                      // armed AFTER clearing: the clear's own render is
  await page.fill('#qs-input', input);  // cancelled by the same debounce and must not count
  return settle(page, beforeKey);
}

/** Read the rendered result tree the way a user reads it: sections, then cards. */
export const READ = () => {
  const out = { sections: [], hint: null };
  const res = document.getElementById('qs-results');
  if (!res) return out;
  /* Kept on every record so an empty result can be diagnosed instead of guessed at: rawLen 0
     means the container really was cleared, rawLen > 0 means this reader failed to parse what
     was on screen. Those are opposite bugs and they look identical without this number. */
  out.rawLen = res.innerHTML.length;
  out.inputAtRead = (document.getElementById('qs-input') || {}).value;
  const hint = res.querySelector('.qs-hint');
  if (hint) out.hint = hint.textContent.trim();
  let current = null;
  for (const el of res.children) {
    if (el.classList.contains('qs-sub')) { current = { title: el.textContent.trim(), cards: [] }; out.sections.push(current); continue; }
    const cards = el.classList.contains('qs-card') ? [el] : Array.from(el.querySelectorAll(':scope > .qs-card'));
    for (const c of cards) {
      if (!current) { current = { title: '(unlabelled)', cards: [] }; out.sections.push(current); }
      current.cards.push({
        he: (c.querySelector('.qs-he') || {}).textContent || null,
        cursive: (c.querySelector('.qs-he-cursive') || {}).textContent || null,
        tr: (c.querySelector('.qs-tr') || {}).textContent || null,
        en: (c.querySelector('.qs-en') || {}).textContent || null,
        breakdown: (c.querySelector('.qs-break-out') || {}).textContent || null,
      });
    }
  }
  const nat = res.querySelector('.qs-nat-out');
  if (nat && nat.textContent.trim()) {
    out.natural = Array.from(nat.querySelectorAll('.qs-card')).map((c) => ({
      he: (c.querySelector('.qs-he') || {}).textContent || null,
      tr: (c.querySelector('.qs-tr') || {}).textContent || null,
      en: (c.querySelector('.qs-en') || {}).textContent || null,
    }));
  }
  return out;
};
