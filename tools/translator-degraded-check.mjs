#!/usr/bin/env node
/*
 * translator-degraded-check.mjs — type Hebrew into the real translator with ONE upstream cut,
 * and assert that what the learner sees is still honest.
 *
 * WHY THIS FILE EXISTS. On 2026-08-23 Jonas reported that a Hebrew word came back as itself
 * instead of its English. Nothing in the harness had ever gone red: the probe, the invariants
 * and the metamorphic runner all measure a HEALTHY network, and this engine degrades silently
 * by design — every enrichment is wrapped in .catch() so that a slow upstream costs a nicety
 * rather than the answer. On a Hebrew query that reasoning inverts, because the "nicety"
 * (fetchGloss, sl=iw) IS the answer. Cut it and the page rendered a card headed "Translation",
 * badged online, whose meaning field held the learner's own word — measured, three cases out of
 * three. The rule that catches it (invariant I6, "the meaning field is not Hebrew") already
 * existed and was never reached, because nothing ever ran the engine with an upstream down.
 *
 * So this is not a new rule. It is the missing INPUT: the failure conditions themselves, made
 * routine. The harness cannot see a silent fallback it never provokes.
 *
 *   node tools/serve.mjs 8912                     # in another shell
 *   node tools/translator-degraded-check.mjs [--base http://localhost:8912]
 *   node tools/translator-degraded-check.mjs --self-test      # no browser, no network
 *
 * Exit 0 = every degraded screen is honest. Exit 1 = a defect a learner would be shown.
 */
import { chromium } from 'playwright-core';
import { ask, READ } from './translator-driver.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:8912');

const HEB = /[֐-׿]/;
const stripNiqqud = s => String(s || '').replace(/[֑-ׇ]/g, '');
const bareKey = s => stripNiqqud(s).replace(/[\s,.?!;:'"״׳()־-]/g, '');
/* The badge text ("phonetic", "online", "✓ lesson") lives inside .qs-en with the meaning, so a
   naive "is the meaning empty" test is never true. Strip the badge words before judging. */
const TAGS = /(phonetic|online|✓\s*lesson)/gi;
const meaningOf = card => String(card.en || '').replace(TAGS, '').trim();

/* ------------------------------------------------------------------ the assertions
 * Each takes one recorded screen { q, sections, hint } and returns the defects a learner would
 * be shown. Pure, so the self-test can prove each one goes red without a browser. */
export const CHECKS = [
  {
    id: 'D1',
    what: 'no card presents its own Hebrew as its meaning',
    why: 'The forward path asks Google for tl=he. Handed Hebrew it returns the Hebrew, and both '
       + 'fetchGoogle and fetchMyMemory set en:q unconditionally, so the query lands in the slot '
       + 'where the English belongs — on a card that looks answered. This is invariant I6 asked '
       + 'under the condition that produces it.',
    check(screen) {
      const out = [];
      for (const s of screen.sections) for (const c of s.cards) {
        const m = meaningOf(c);
        if (!m) continue;
        if (bareKey(m) && bareKey(m) === bareKey(c.he)) out.push(`[${s.title}] meaning repeats the card's own Hebrew: "${m}"`);
        else if (HEB.test(m)) out.push(`[${s.title}] meaning field holds Hebrew: "${m}"`);
      }
      return out;
    }
  },
  {
    id: 'D2',
    what: 'a Hebrew query keeps its "Hebrew — did you mean?" section',
    why: 'MyMemory stamps src from guessLangpair() — a guess, not detection — so its echo of a '
       + 'Hebrew query passed the realLang test and wiped the phonetic section, which is the one '
       + 'holding the correct English. The learner lost the right answer to a fallback that had '
       + 'no answer at all.',
    check(screen) {
      /* Hebrew queries only. Added 2026-08-25 with the non-Hebrew cases: without it this rule
         fired on every "I want a coffee", which HAS a forward answer and must not carry a
         "did you mean" section at all — the bench would have reported 13 defects in a healthy
         engine and buried the one real finding. */
      if (screen.heQuery === false) return [];
      if (!screen.sections.length) return [];
      const titles = screen.sections.map(s => s.title);
      return titles.some(t => /did you mean/i.test(t)) ? []
        : [`a Hebrew query rendered only ${titles.map(t => JSON.stringify(t)).join(', ')} — the Hebrew section was suppressed`];
    }
  },
  {
    id: 'D3',
    what: 'a card with no meaning is not left standing as if it were an answer',
    why: 'Pointed Hebrew with its reading and no English looks answered and is not: the question '
       + 'was what the word means. When the gloss is the one thing that failed, the page has to '
       + 'say which half is missing rather than let the niqqud stand in for a translation.',
    check(screen) {
      const cards = screen.sections.flatMap(s => s.cards);
      if (!cards.length) return [];
      if (cards.some(c => meaningOf(c))) return [];
      return screen.hint ? [] : ['every card came back without a meaning and the page says nothing about it'];
    }
  },
  {
    id: 'D4',
    what: 'a non-Hebrew query whose translation failed says so',
    why: 'Added 2026-08-25, from "the live translator does not even give the translation any '
       + 'more". With both forward sources refused, "I want a coffee" rendered three unglossed '
       + 'phonetic guesses (י וַעֲנָת א צוֹפִי) and not one word about the failure; a query with no '
       + 'phonetic guess got "Nothing found — try rephrasing", which sends the learner to '
       + 'rephrase a sentence that was never the problem. translateOnline could not tell an '
       + 'absence from an unreachable source, so render() could not either. navigator.onLine is '
       + 'no substitute: on a captive wifi it stays true while every request fails.',
    check(screen) {
      if (screen.heQuery) return [];              // no forward path by construction
      const cards = screen.sections.flatMap(s => s.cards);
      if (cards.some(c => meaningOf(c))) return [];   // something was actually answered
      const hint = String(screen.hint || '');
      if (/could not be fetched|could not be reached|offline/i.test(hint)) return [];
      if (/rephras/i.test(hint)) return [`the network failed and the page blamed the wording: "${hint}"`];
      return [`nothing was translated and the page says nothing about it (${cards.length} unglossed card${cards.length === 1 ? '' : 's'})`];
    }
  },
  {
    id: 'D5',
    what: 'le champ hebreu ne contient ni balisage ni annotation en lettres latines',
    why: 'Ajoutee le 2026-08-26. MyMemory, alors utilise en repli du chemin avant, rendait du '
       + 'balisage TMX dans l\'hebreu (une balise <g id=1> au milieu de credit card) et collait '
       + '(MAN) a ses traductions : des annotations de source, affichees a un apprenant qui va '
       + 'les prononcer. La source a ete retiree ; la regle reste, parce que le defaut est celui '
       + 'de tout upstream qui rend un segment stocke plutot qu\'une traduction.',
    check(screen) {
      const out = [];
      for (const s of screen.sections) for (const c of s.cards) {
        const he = String(c.he || '');
        if (!he) continue;
        if (/<[^>]+>/.test(he)) out.push(`[${s.title}] balisage dans l'hebreu : "${he}"`);
        else if (/[A-Za-z]{2,}/.test(he)) out.push(`[${s.title}] lettres latines dans l'hebreu : "${he}"`);
      }
      return out;
    }
  }
];

const judge = screen => CHECKS.flatMap(c => c.check(screen).map(m => ({ id: c.id, msg: m })));

/* ------------------------------------------------------------------ self-test
 * Fixtures are the screens actually recorded on 2026-08-23, before and after the fix. A check
 * that has never been red is indistinguishable from no check, so each one is handed the real
 * defect it was written for and the real correct screen beside it. */
const FIXTURES = {
  D1: {
    bad: { q: 'ספר', hint: null, sections: [{ title: 'Translation', cards: [{ he: 'סֵפֶר', tr: 'SE-fer', en: 'ספר online' }] }] },
    good: { q: 'ספר', hint: null, sections: [{ title: 'Hebrew — did you mean?', cards: [{ he: 'סֵפֶר', tr: 'SE-fer', en: 'book phonetic' }] }] }
  },
  D2: {
    bad: { q: 'חתול', hint: null, sections: [{ title: 'Translation', cards: [{ he: 'חָתוּל', tr: 'cha-TUL', en: 'cat online' }] }] },
    good: { q: 'חתול', hint: null, sections: [{ title: 'Hebrew — did you mean?', cards: [{ he: 'חָתוּל', tr: 'cha-TUL', en: 'cat phonetic' }] }] }
  },
  D3: {
    bad: { q: 'ספר', hint: null, sections: [{ title: 'Hebrew — did you mean?', cards: [{ he: 'סֵפֶר', tr: 'SE-fer', en: 'phonetic' }] }] },
    good: { q: 'ספר', hint: 'The meaning could not be fetched — the reading above is correct, the English is missing. Try again in a moment.', sections: [{ title: 'Hebrew — did you mean?', cards: [{ he: 'סֵפֶר', tr: 'SE-fer', en: 'phonetic' }] }] }
  },
  /* Recorded 2026-08-25 against production with both forward sources refused (bad), and after
     the fix (good). The garbage Hebrew is verbatim: it is Input Tools reading the English
     letters of "I want a coffee" as if they spelled Hebrew sounds. */
  D4: {
    bad: { q: 'I want a coffee', heQuery: false, hint: null, sections: [{ title: 'Hebrew — did you mean?', cards: [
      { he: 'י וַעֲנָת א צוֹפִי', tr: null, en: 'phonetic' },
      { he: 'י וַעֲנָת ע צוֹפִי', tr: null, en: 'phonetic' }] }] },
    good: { q: 'I want a coffee', heQuery: false, hint: 'The translation could not be fetched — check the connection and try again. What follows is guesswork from the spelling.', sections: [{ title: 'Hebrew — did you mean?', cards: [
      { he: 'י וַעֲנָת א צוֹפִי', tr: null, en: 'phonetic' }] }] }
  },
  /* The other half of the same defect: no phonetic guess at all, so the page had nothing to show
     and blamed the wording of a sentence that was never the problem. */
  /* Recorde le 2026-08-26 : ce que MyMemory rendait reellement pour "credit card", et la carte
     correcte que rend gtx. */
  D5: {
    bad: { q: 'credit card', heQuery: false, hint: null, sections: [{ title: 'Translation', cards: [{ he: "כ<g id=\"1\">''</g>א", tr: null, en: 'credit card online' }] }] },
    good: { q: 'credit card', heQuery: false, hint: null, sections: [{ title: 'Translation', cards: [{ he: 'כַּרְטִיס אַשְׁרַאי', tr: 'kar-TIS ash-RAI', en: 'credit card online' }] }] }
  },
  D4b: {
    bad: { q: 'where is the pharmacy', heQuery: false, hint: 'Nothing found for “where is the pharmacy”. Try rephrasing.', sections: [] },
    good: { q: 'where is the pharmacy', heQuery: false, hint: 'The translation could not be fetched — check the connection and try again.', sections: [] }
  }
};

/* Iterates the FIXTURES, not the CHECKS, so one rule can carry several recorded screens: D4 and
   D4b are the two shapes of the same failure (guesses with no word about it / the wording
   blamed) and a rule proved on only one of them is proved on half its job. The key's leading
   id names the rule ("D4b" -> D4); a fixture whose rule does not exist is itself a failure. */
function selfTest() {
  let bad = 0, total = 0;
  for (const key of Object.keys(FIXTURES)) {
    const id = key.match(/^[A-Z]+\d+/)[0];
    const c = CHECKS.find(x => x.id === id);
    if (!c) { console.log(`FAIL fixture ${key} names no rule`); bad += 2; total += 2; continue; }
    const f = FIXTURES[key];
    total += 2;
    const onBad = c.check(f.bad), onGood = c.check(f.good);
    if (!onBad.length) { console.log(`FAIL ${c.id} stayed green on its own defect`); bad++; }
    else console.log(`  ok   ${c.id} red on the defect: ${onBad[0]}`);
    if (onGood.length) { console.log(`FAIL ${c.id} fired on correct output: ${onGood[0]}`); bad++; }
    else console.log(`  ok   ${c.id} green on the correct screen`);
  }
  console.log(`\n${total - bad}/${total} self-test assertions pass`);
  return bad;
}

/* ------------------------------------------------------------------ live run */
/* Hebrew queries exercise D1-D3 (the meaning comes from the gloss and nowhere else). The
   non-Hebrew ones exercise D4 and were missing until 2026-08-25: the whole bench only ever asked
   the engine questions in Hebrew, so the plain "translate this for me" path — the one the app is
   for — had never been run with an upstream down. "where is the pharmacy" is in neither the
   phrasebook nor Input Tools' comfort zone, so it is the case where the page has nothing at all
   to show and must say why. */
const WORDS = ['ספר', 'חתול', 'מקרר', 'אני רוצה קפה', 'I want a coffee', 'where is the pharmacy', 'je voudrais un café'];
const HEB_Q = w => HEB.test(w);
const CASES = [
  { name: 'healthy', block: [] },
  { name: 'gloss + forward down (translate.googleapis.com refused)', block: ['**translate.googleapis.com**'] },
  { name: 'worker down (ulpan-morph refused)', block: ['**ulpan-morph.olamcreations.workers.dev**'] },
  { name: 'both down', block: ['**translate.googleapis.com**', '**ulpan-morph.olamcreations.workers.dev**'] },
  /* No forward source reachable at all. This is the ordinary phone failure — a wifi that is
     connected and dead — and it is the one navigator.onLine cannot see. */
  { name: 'no forward source (gtx + mymemory refused)', block: ['**translate.googleapis.com**', '**api.mymemory.translated.net**'] },
];

/* The host each pattern stands for, so a request that got through DESPITE the block can be
   recognised on the wire. Measured 2026-08-23: it happens. A `page.route` abort is not a
   guarantee — one sl=iw gloss came back 200 while the route was installed, and the screen it
   produced looked like a clean pass of the very case it was meant to break. A bench whose
   injection does not land reports the same green for a fixed engine and a broken one, so the
   leak is counted and the screen is reported UNTESTED rather than ok. */
const HOST_OF = p => p.replace(/\*/g, '');

async function live() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let defects = 0, tested = 0, untested = 0;
  for (const c of CASES) {
    /* Service workers OFF for this bench, and that is the whole reason the leak existed.
       sw.js calls e.respondWith() on every GET, cross-origin included, and re-issues it with a
       fetch() from the worker's own context — which page.route does not intercept. So the FIRST
       query of a run was blocked correctly and every query after the worker activated sailed
       through, while the screen it produced looked like a clean pass. The service worker is not
       what is under test here (the translator's network paths are), and leaving it on made the
       injection land or not depending on timing. */
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const hosts = c.block.map(HOST_OF);
    let leaks = [];
    // Cache off: a 200 served from Chrome's cache never consults the route, which is one way
    // the block silently fails to apply.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    page.on('response', r => { if (hosts.some(h => r.url().includes(h))) leaks.push(r.status() + ' ' + r.url().slice(0, 70)); });
    for (const pat of c.block) await page.route(pat, r => r.abort());
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#qs-input', { timeout: 15000 });
    console.log('\n########## ' + c.name);
    for (const w of WORDS) {
      leaks = [];
      await ask(page, w);
      const read = await page.evaluate(READ);
      const screen = { q: w, heQuery: HEB_Q(w), hint: read.hint, sections: read.sections };
      const found = judge(screen);
      const shown = screen.sections.flatMap(s => s.cards)
        .map(x => `${x.he || ''} = ${meaningOf(x) || '(no meaning)'}`).join(' | ');
      const leaked = leaks.length > 0;
      if (leaked && !found.length) untested++; else tested++;
      const verdict = found.length ? 'DEFECT' : leaked ? 'UNTEST' : 'ok    ';
      console.log(`  ${verdict} ${w}  ->  ${shown || '(nothing)'}${screen.hint ? '  [+hint]' : ''}`);
      if (leaked) console.log(`         block leaked (${leaks.length}): ${leaks[0]}`);
      for (const f of found) { console.log(`         ${f.id}: ${f.msg}`); defects++; }
    }
    await page.close(); await ctx.close();
  }
  await browser.close();
  console.log(`\n${tested} screens measured, ${untested} untested (block leaked), ${defects} defect${defects === 1 ? '' : 's'}`);
  return defects;
}

const run = async () => {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);
  process.exit((await live()) ? 1 : 0);
};
run().catch(e => { console.error(e); process.exit(2); });
