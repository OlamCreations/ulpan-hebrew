#!/usr/bin/env node
/* translator-metamorphic.mjs — test the translator where there is no right answer to compare to.
 *
 * The invariant checker asks whether a card agrees with itself. The judges asked whether a
 * translation was good. Between those two sits the class of bug that neither can see: the
 * engine returning a DIFFERENT answer to the same question. Nothing about either answer is
 * self-contradictory, and either one might be a fine translation, so both other methods pass.
 *
 * This is the oracle problem, and rules/testing.md already names the way out. You do not need
 * to know the right output; you need to know how the output must CHANGE when the input changes
 * in a controlled way. Feed "toda raba" and "Toda Raba" and the Hebrew must be identical —
 * whatever it is. That relation is falsifiable without anyone knowing Hebrew.
 *
 * Five relations, chosen because each one, if broken, is a bug a user would actually hit:
 *
 *   M1 determinism        the same input twice, in one session, gives the same cards
 *   M2 case               capitalisation of a Latin input does not change the Hebrew
 *   M3 whitespace         leading, trailing and doubled spaces do not change the Hebrew
 *   M4 final punctuation  a trailing full stop does not change the words
 *   M5 idempotence        vocalizing the engine's own output returns that output
 *
 * M5 is the round trip and the most valuable: it takes the Hebrew the engine just produced,
 * strips the vowel points, feeds it back, and requires the same pointing. An engine that
 * cannot reproduce its own answer is guessing, and the bare-Hebrew path is where this project
 * has repeatedly shipped a plausible wrong word.
 *
 * Network and a server are both required — it drives the real page.
 *
 *   node tools/serve.mjs 8912 &
 *   node tools/translator-metamorphic.mjs [--base URL] [--seeds N]
 *   node tools/translator-metamorphic.mjs --self-test
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912').replace(/\/$/, '');
const SEEDS = Number(arg('--seeds', '8'));

const stripNiqqud = s => String(s || '').replace(/[֑-ׇ]/g, '');
const heOf = shown => {
  const c = ((shown.sections || [])[0] || { cards: [] }).cards[0];
  return c ? (c.he || '').trim() : null;
};
const cardsOf = shown => (shown.sections || []).flatMap(s => (s.cards || []).map(c => `${c.he}|${c.tr}`));

/* Comparison after normalising away what the relation explicitly permits to differ, and
   nothing else. Final punctuation is allowed to move for M4 and for no other relation, which
   is why the allowance is a parameter rather than baked into the comparison. */
const norm = (s, { dropFinalPunct = false } = {}) => {
  let x = String(s || '').replace(/\s+/g, ' ').trim();
  if (dropFinalPunct) x = x.replace(/[.!?،,;:]+$/u, '').trim();
  return x;
};

/* ------------------------------------------------------------------ relations */
export const RELATIONS = [
  {
    id: 'M1',
    what: 'the same input twice gives the same answer',
    variants: s => [s, s],
    compare: (a, b) => cardsOf(a).join('\n') === cardsOf(b).join('\n')
      ? null : `first run showed ${cardsOf(a).length} cards, second ${cardsOf(b).length}, and they differ`
  },
  {
    id: 'M2',
    what: 'capitalisation of the input does not change the Hebrew',
    skip: s => !/[a-z]/i.test(s),
    variants: s => [s.toLowerCase(), s.replace(/\b\w/g, c => c.toUpperCase())],
    compare: (a, b) => norm(heOf(a)) === norm(heOf(b))
      ? null : `lower gave "${heOf(a)}", Title gave "${heOf(b)}"`
  },
  {
    id: 'M3',
    what: 'stray spaces do not change the Hebrew',
    variants: s => [s, `  ${s.replace(/ /g, '  ')}  `],
    compare: (a, b) => norm(heOf(a)) === norm(heOf(b))
      ? null : `tight gave "${heOf(a)}", spaced gave "${heOf(b)}"`
  },
  {
    id: 'M4',
    what: 'a trailing full stop does not change the words',
    skip: s => /[.!?]$/.test(s),
    variants: s => [s, `${s}.`],
    compare: (a, b) => norm(heOf(a), { dropFinalPunct: true }) === norm(heOf(b), { dropFinalPunct: true })
      ? null : `bare gave "${heOf(a)}", with a full stop gave "${heOf(b)}"`
  },
  {
    id: 'M5',
    what: 'the engine can reproduce its own vocalization',
    /* Two-stage: the second variant is not known until the first has answered, so this one is
       driven specially below. Declared here so it appears in the report with the others. */
    twoStage: true,
    what2: 'strip the vowel points from the answer, ask again, expect the same pointing'
  }
];

/* ------------------------------------------------------------------ verdict
 * The decision of what a pair of results is EVIDENCE for, kept out of the driving loop so it
 * can be exercised without a browser. Inline, this guard would be the one piece of the harness
 * that could never be shown able to go red — and it is the piece that decides whether a run
 * blames the engine or blames the limiter.
 *
 * Order matters and is load-bearing: throttled beats empty beats compare. A throttled response
 * IS empty, so testing emptiness first would file every 429 under "the engine produced nothing"
 * and quietly keep the wrong conclusion. */
export function verdict(rel, ra, rb) {
  if (ra.throttled || rb.throttled) return { untested: true, msg: 'rate limited, relation untested' };
  if (!heOf(ra.shown) && !heOf(rb.shown)) return { untested: true, msg: 'produced nothing, relation untested' };
  const bad = rel.compare(ra.shown, rb.shown);
  return bad ? { untested: false, msg: bad } : null;
}

/* ------------------------------------------------------------------ seeds
 * Real inputs rather than invented ones: what a learner types is what the engine has to
 * survive. Taken from the phrasebook (verified) and from the free-form probe corpus (the
 * class where this engine actually breaks). */
function seeds(n) {
  const pb = JSON.parse(readFileSync(join(ROOT, 'data', 'phrasebook.json'), 'utf8')).phrases;
  const free = JSON.parse(readFileSync(join(ROOT, 'tools', 'translator-corpus-free.json'), 'utf8'));
  const freeList = Array.isArray(free) ? free : (free.items || free.phrases || []);
  const out = [];
  const step = Math.max(1, Math.floor(pb.length / Math.ceil(n / 2)));
  for (let i = 0; out.length < Math.ceil(n / 2) && i < pb.length; i += step) {
    if (pb[i] && pb[i].en) out.push(pb[i].en);
  }
  for (const f of freeList) {
    if (out.length >= n) break;
    const t = typeof f === 'string' ? f : (f.input || f.fr || f.en);
    if (t) out.push(t);
  }
  return out.slice(0, n);
}

/* ------------------------------------------------------------------ self-test
 * The relations are pure functions of two captured results, so they can be exercised without
 * a browser. Each is given a pair that satisfies it and a pair that violates it: a relation
 * that cannot go red is decoration, and one that fires on agreement is worse. */
const shownWith = (he, tr = 'x') => ({ sections: [{ title: 's', cards: [{ he, tr }] }] });

function selfTest() {
  let bad = 0, ran = 0;
  const line = (ok, s) => { ran++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${s}`); };

  for (const r of RELATIONS.filter(r => !r.twoStage)) {
    const same = shownWith('שָׁלוֹם');
    const other = shownWith('תּוֹדָה');
    line(r.compare(same, shownWith('שָׁלוֹם')) === null, `${r.id} agrees when the two answers match`);
    line(r.compare(same, other) !== null, `${r.id} reddens when they differ`);
  }

  /* M4 must forgive a final stop and nothing else — the one place the comparison is loosened,
     so the one place it could be loosened too far. */
  const m4 = RELATIONS.find(r => r.id === 'M4');
  line(m4.compare(shownWith('שָׁלוֹם'), shownWith('שָׁלוֹם.')) === null, 'M4 forgives a trailing full stop');
  line(m4.compare(shownWith('שָׁלוֹם'), shownWith('שָׁלוֹם רַב')) !== null, 'M4 does not forgive an extra word');

  /* M3 must forgive collapsed whitespace and not a different word. */
  const m3 = RELATIONS.find(r => r.id === 'M3');
  line(m3.compare(shownWith('שָׁלוֹם רַב'), shownWith('  שָׁלוֹם   רַב ')) === null, 'M3 forgives stray spaces');

  /* M1 compares every card, not only the first: an engine that drops its third alternate on a
     second run is inconsistent, and comparing first cards only would call that stable. */
  const m1 = RELATIONS.find(r => r.id === 'M1');
  const two = { sections: [{ cards: [{ he: 'א', tr: 'a' }, { he: 'ב', tr: 'b' }] }] };
  const one = { sections: [{ cards: [{ he: 'א', tr: 'a' }] }] };
  line(m1.compare(two, one) !== null, 'M1 reddens when a card disappears on the second run');

  selfTestVerdict(line);

  /* Counted, not computed from the shape of RELATIONS. The formula that used to stand here
     would have kept printing a full score after an assertion was deleted. */
  console.log(`\n${ran - bad}/${ran} self-test assertions pass`);
  process.exit(bad ? 1 : 0);
}

/* The throttle guard, exercised without a browser. This is the part that decides whether a run
   accuses the engine or excuses it, so each branch is pinned in both directions. */
function selfTestVerdict(line) {
  const m1 = RELATIONS.find(r => r.id === 'M1');
  const ok = { shown: shownWith('שָׁלוֹם'), throttled: false };
  const other = { shown: shownWith('תּוֹדָה'), throttled: false };
  const empty = { shown: { sections: [] }, throttled: false };
  const cut = { shown: { sections: [] }, throttled: true };

  line(verdict(m1, ok, other).untested === false, 'verdict blames the engine when both answers are real and differ');
  line(verdict(m1, ok, { shown: shownWith('שָׁלוֹם'), throttled: false }) === null, 'verdict stays silent when they agree');
  line(verdict(m1, empty, empty).untested === true, 'verdict marks a silent engine untested, not broken');

  /* The ordering trap, stated as its own assertion: a throttled result is ALSO empty, so a
     guard that checked emptiness first would file it under the wrong reason and keep looking
     innocent. The message is asserted, not just the untested flag. */
  line(/rate limited/.test(verdict(m1, cut, cut).msg), 'a throttled pair reads as rate limited, not as "produced nothing"');
  line(/rate limited/.test(verdict(m1, ok, cut).msg), 'one throttled side is enough to withdraw the check');
  line(verdict(m1, ok, cut).untested === true, 'a real answer compared against a throttled one is never a violation');
}

if (process.argv.includes('--self-test')) selfTest();

/* ------------------------------------------------------------------ drive */
const { chromium } = await import('playwright-core');
const { ask, READ, watchUpstream } = await import('./translator-driver.mjs');

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await (await browser.newContext()).newPage();
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#qs-input', { timeout: 15000 });

const upstream = watchUpstream(page);

/* Paced under RL_AI (12 requests / 60s), not under the general limiter. The first attempt at
   this used the probe's 400ms and then 700ms, and both produced the same fifteen "failures" —
   because both are several times too fast for the AI meter. The pause makes throttling rare;
   the watcher below makes it visible when it happens anyway. Neither alone is enough. */
const PAUSE = Number(arg('--pause', '5200'));

/** Ask, and report whether the answer can be trusted as evidence about the engine. */
async function askShown(input) {
  await new Promise(r => setTimeout(r, PAUSE));
  upstream.drain();                                  // ignore anything from before this ask
  const { rendered } = await ask(page, input);
  const { throttled } = upstream.drain();
  const shown = rendered ? await page.evaluate(READ) : { sections: [] };
  return { shown, throttled };
}

/** One retry after cooling: a throttle is a property of the moment, not of the input. */
async function askTrusted(input) {
  let r = await askShown(input);
  if (r.throttled) { await upstream.cool(page); r = await askShown(input); }
  return r;
}

const list = seeds(SEEDS);
const findings = [];
let checks = 0;

for (const seed of list) {
  for (const rel of RELATIONS) {
    if (rel.twoStage) continue;
    if (rel.skip && rel.skip(seed)) continue;
    const [a, b] = rel.variants(seed);
    const ra = await askTrusted(a);
    const rb = await askTrusted(b);
    checks++;
    /* Throttled first, and before any comparison: a 429 empties the results box exactly like a
       declined translation, so comparing the two answers here would be comparing one real answer
       against the limiter. This is the guard that removed nine of the first run's fifteen
       "engine bugs". Decided by verdict(), which the self-test drives without a browser. */
    const v = verdict(rel, ra, rb);
    if (v) findings.push({ id: rel.id, seed, ...v });
  }

  // M5: strip the vowel points off the engine's own answer and ask again.
  const first = await askTrusted(seed);
  const he = heOf(first.shown);
  if (he && /[֑-ׇ]/.test(he)) {
    const back = await askTrusted(stripNiqqud(he));
    checks++;
    const got = heOf(back.shown);
    if (back.throttled) findings.push({ id: 'M5', seed, msg: 'rate limited on the way back, relation untested', untested: true });
    else if (!got) findings.push({ id: 'M5', seed, msg: `"${stripNiqqud(he)}" produced nothing on the way back`, untested: true });
    else if (norm(got) !== norm(he)) findings.push({ id: 'M5', seed, msg: `answered "${he}", but re-pointing its own consonants gave "${got}"` });
  }
}

await browser.close();

const real = findings.filter(f => !f.untested);
const untested = findings.filter(f => f.untested);
console.log(`\n${list.length} seeds, ${checks} relation checks\n`);
for (const rel of RELATIONS) {
  const n = real.filter(f => f.id === rel.id).length;
  const u = untested.filter(f => f.id === rel.id).length;
  console.log(`${n ? 'FAIL' : 'ok  '}  ${rel.id}  ${String(n).padStart(3)} broken${u ? `, ${u} untested` : ''}  ${rel.what}`);
}
for (const f of real) console.log(`\n  ${f.id}  ${JSON.stringify(f.seed).slice(0, 40)}\n      ${f.msg}`);
const limited = untested.filter(f => /rate limited/.test(f.msg)).length;
if (untested.length) console.log(`\n${untested.length} checks untested (${limited} rate limited, ${untested.length - limited} produced nothing).`);
if (jsErrors.length) console.log(`\n${jsErrors.length} JS errors on the page: ${jsErrors[0]}`);

const out = join(ROOT, 'tools', 'reports', 'translator-metamorphic.json');
writeFileSync(out, JSON.stringify({ ran: new Date().toISOString(), base: BASE, seeds: list, checks, findings, jsErrors }, null, 1) + '\n', 'utf8');
console.log(`\n${real.length} broken relations over ${checks} checks -> ${out}`);
process.exit(real.length ? 1 : 0);
