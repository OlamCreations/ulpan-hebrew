#!/usr/bin/env node
/*
 * build-gloss.mjs — compile a verified word-gloss dictionary from our own corpus.
 *
 * The breakdown glossed each word by asking Google to translate it ALONE. Out of context that
 * is a coin flip on Hebrew homographs, and it lost badly: שְׁמִי -> "Semitic" (my name),
 * אֶקְנֶה -> "acne" (I will buy), הַאִם -> "the mother" (the yes/no question particle),
 * עוֹבֵר -> "fetus" (passes), אֶת -> "you" (the accusative marker).
 *
 * Measured first, so the fix targets the real cause:
 *   - sending the VOCALIZED form instead of the bare one changes nothing (Google returns the
 *     identical gloss for שמי and שְׁמִי) — the problem is isolation, not vocalization
 *   - glossing Dicta's lemma trades one set of errors for another (שם -> "name" but
 *     קני -> "Kenny", עבר -> "past")
 *
 * What we do have is 7000+ hand-verified vocalized words across the phrasebook and 465 lessons,
 * each already carrying its meaning. Those are exactly the high-frequency words and function
 * words Google mangles worst. So: look them up before asking anyone.
 *
 * Keys are the FULLY VOCALIZED form, and ONLY that.
 *
 * A consonantal-skeleton fallback was built first and then removed, because the test caught it
 * lying: it emitted בשוק -> "in shock" as if unambiguous. The rule had been "keep a skeleton
 * when it has exactly one vocalization in the corpus" — but that measures ambiguity in OUR 7000
 * words, not in Hebrew. Our corpus happens to contain בְּשׁוֹק and not בַּשּׁוּק ("in the market"),
 * so the skeleton looked settled purely by absence. At this corpus size almost every skeleton
 * looks unambiguous, which makes the guard confidently wrong exactly where homographs live —
 * the failure this whole file exists to fix. Dicta hands us the vocalized form, so exact
 * matching is available and is the only safe key.
 *
 *   node tools/build-gloss.mjs [--max-len 60]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, dataPath, cfg } from './paths.mjs';

const argMax = process.argv.indexOf('--max-len');
const MAX_LEN = argMax >= 0 ? Number(process.argv[argMax + 1]) : 60;

const strip = (s) => (s || '').replace(/[֑-ׇ]/g, '');
const hasNiqqud = (s) => /[֑-ׇ]/.test(s || '');

/** vocalized form -> Set of glosses */
const byVoc = new Map();
/** consonantal skeleton -> Set of vocalized forms (used only to detect ambiguity) */
const bySkel = new Map();

function add(he, en) {
  if (!he || !en) return;
  he = he.trim();
  en = en.trim();
  if (!he || !en) return;
  if (!hasNiqqud(he)) return;                       // unvocalized entries cannot be keyed safely
  if (strip(he).split(/\s+/).length > 1) return;    // single words only; phrases are not glosses
  if (en.length > MAX_LEN) return;                  // long lesson notes are commentary, not a gloss
  if (!byVoc.has(he)) byVoc.set(he, new Set());
  byVoc.get(he).add(en);
  const k = strip(he);
  if (!bySkel.has(k)) bySkel.set(k, new Set());
  bySkel.get(k).add(he);
}

/* ---------- sources: everything we have already verified by hand ---------- */
const pb = JSON.parse(await readFile(dataPath('phrasebook.json'), 'utf8'));
for (const p of pb.phrases) add(p.he, p.en);

try {
  const ex = JSON.parse(await readFile(dataPath('expressions.json'), 'utf8'));
  for (const e of ex.expressions || []) add(e.he, e.en || e.literal);
} catch { /* generated file; fine if absent */ }

const lessonsDir = join(ROOT, cfg.toolScopes.lessons[0]);
for (const f of (await readdir(lessonsDir)).filter((x) => x.endsWith('.html'))) {
  const s = await readFile(join(lessonsDir, f), 'utf8');
  // Lesson word rows are object literals; pull he together with the meaning in the SAME object,
  // so a gloss can never be paired with a neighbouring word's Hebrew.
  for (const m of s.matchAll(/\{[^{}]*?"he"\s*:\s*"([^"]+)"[^{}]*?\}/g)) {
    const en = (m[0].match(/"(?:en|fr)"\s*:\s*"([^"]+)"/) || [])[1];
    add(m[1], en);
  }
  for (const m of s.matchAll(/\{[^{}]*?he:\s*'([^']+)'[^{}]*?\}/g)) {
    const en = (m[0].match(/(?:en|fr):\s*'([^']+)'/) || [])[1];
    add(m[1], en);
  }
}

/* ---------- emit ---------- */
/* Several lessons gloss the same word slightly differently. Prefer the shortest: it is the
   dictionary sense rather than a sentence-specific paraphrase. */
const pick = (set) => [...set].sort((a, b) => a.length - b.length)[0];

const v = {};
for (const [he, glosses] of byVoc) v[he] = pick(glosses);

/* How many skeletons carry more than one reading even inside this small corpus — reported as a
   reminder of why there is no skeleton fallback, not used for lookup. */
const ambiguous = [...bySkel.values()].filter((forms) => forms.size > 1).length;

const out = {
  _note: 'Verified word glosses compiled from the phrasebook, the expressions and the lessons. '
       + 'Keys are FULLY VOCALIZED forms — there is deliberately no consonantal-skeleton fallback, '
       + 'see the header of tools/build-gloss.mjs. Generated; do not edit.',
  // Deliberately no build timestamp: it would make every regeneration produce a diff even when
  // not a single gloss changed, so a real content change could not be told from a rebuild.
  v,
};
await writeFile(dataPath('gloss.json'), JSON.stringify(out) + '\n', 'utf8');

const bytes = JSON.stringify(out).length;
console.log(`gloss.json: ${Object.keys(v).length} vocalized entries (no skeleton fallback, by design)`);
console.log(`skeletons ambiguous even within this corpus: ${ambiguous}`);
console.log(`size: ${(bytes / 1024).toFixed(0)} KB -> ${dataPath('gloss.json')}`);
