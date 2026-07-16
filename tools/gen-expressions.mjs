#!/usr/bin/env node
// gen-expressions.mjs — content pipeline for the Expressions layer (pedagogy plan P3).
//
// The page (expressions.html) consumes a flat `expressions.json`. This script builds it by
// joining two sources, and ships NOTHING that is not in both:
//
//   1. The POOL — { he, translit, fr } arrays already authored in the idiom/slang lessons
//      (18, 92, 94, 95, 96, 197). Real content that already shipped and was reviewed.
//   2. The CURATION — tools/expressions-curation.json, a hand-written whitelist keyed by the
//      exact `he` string, carrying the thing the lessons never had: `usage` (when / with whom /
//      register), plus `literal` where the literal reading diverges from the meaning.
//
// Why a whitelist and not a filter: the pool also contains textbook-invented or mistyped
// "idioms" (מַיִם שֶׁקֶטוֹם for מַיִם שְׁקֵטִים, דֻּבֵּי אֱמֶת, צִפּוֹר הַסַּף). An expression no Israeli
// actually says is worse than no expression. Curation is the gate; the pool is the evidence.
//
// Three guards, each of which exits non-zero (so this can gate a deploy):
//   - every curation key must still match a pool entry  → a lesson edit can't silently
//     orphan a curated expression (and a typo'd key can't ship an unverified string);
//   - every entry must carry a usage note              → the whole point of the layer;
//   - --validate re-runs each `he` through the live Dicta Worker → morphology verified,
//     not invented (LOI #0g, plan §7.1). A phrase Dicta can't vocalize cleanly is reported,
//     never silently shipped.
//
// Usage:
//   node tools/gen-expressions.mjs build [--out expressions.json]
//   node tools/gen-expressions.mjs --validate     # build + Dicta round-trip on every entry
//   node tools/gen-expressions.mjs --report       # what's in the pool but not yet curated
//
// Config-driven, no secrets. Override the endpoint with MORPH_URL=... if needed.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CURATION = join(HERE, 'expressions-curation.json');
const MORPH_URL = process.env.MORPH_URL || 'https://ulpan-morph.olamcreations.workers.dev';

// The lessons whose arrays are the source pool. Config, not hardcoded policy: add a file here
// and its expressions become curatable.
const SOURCES = [
  '18-slang-idioms.html',
  '92-small-talk.html',
  '94-idioms-body.html',
  '95-idioms-animals.html',
  '96-idioms-food.html',
  '197-idioms-master.html',
];

// Dialogue/story arrays are running lines, not reusable expressions. They'd pollute the pool
// with full sentences that happen to have { he, translit, fr }.
const SKIP_GROUPS = new Set(['DIALOGUE', 'STORY']);

const strip = (s) => (s || '').replace(/[֑-ׇ]/g, '').replace(/[\s,.?!;:'"״׳()־-]/g, '');

// Pull every `const NAME = [ ... ];` array of { he, translit, fr } out of a lesson's inline JS.
// Evaluated in a bare VM context: these are data literals from our own repo, no I/O reachable.
async function poolFrom(file) {
  const src = await readFile(join(ROOT, file), 'utf8');
  const out = [];
  const re = /(?:const|var|let)\s+([A-Z_]{3,})\s*=\s*(\[[\s\S]*?\]);/g;
  let m;
  while ((m = re.exec(src))) {
    const [, group, literal] = m;
    if (SKIP_GROUPS.has(group)) continue;
    let arr;
    try { arr = vm.runInNewContext(`(${literal})`); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    for (const x of arr) {
      if (x && typeof x.he === 'string' && typeof x.fr === 'string') {
        out.push({ he: x.he, translit: x.translit || '', fr: x.fr, src: file, group });
      }
    }
  }
  return out;
}

async function buildPool() {
  const all = [];
  for (const f of SOURCES) all.push(...(await poolFrom(f)));
  // First occurrence wins: earlier SOURCES are the more canonical lessons for a given form.
  const byHe = new Map();
  for (const e of all) if (!byHe.has(e.he)) byHe.set(e.he, e);
  return byHe;
}

async function build() {
  const pool = await buildPool();
  const curation = JSON.parse(await readFile(CURATION, 'utf8'));
  const catIds = new Set(curation.categories.map((c) => c.id));
  const entries = [];
  const orphans = [];
  const problems = [];

  for (const [he, cur] of Object.entries(curation.expressions)) {
    const p = pool.get(he);
    if (!p) { orphans.push(he); continue; }
    if (!cur.usage || !cur.usage.trim()) problems.push(`${he}: no usage note`);
    if (!catIds.has(cur.cat)) problems.push(`${he}: unknown category "${cur.cat}"`);
    entries.push({
      he,
      translit: p.translit,
      fr: p.fr,
      cat: cur.cat,
      register: cur.register || 'neutral',
      usage: cur.usage,
      ...(cur.literal ? { literal: cur.literal } : {}),
      src: p.src.replace('.html', ''),
    });
  }

  if (orphans.length) {
    console.error(`\n✗ ${orphans.length} curated key(s) match no source lesson entry.`);
    console.error('  Either the lesson changed the string, or the key has a typo.');
    console.error('  Curation must join onto verified source content — fix the key, do not ship it.\n');
    orphans.forEach((o) => console.error('   ' + o));
  }
  if (problems.length) {
    console.error(`\n✗ ${problems.length} curation problem(s):`);
    problems.forEach((p) => console.error('   ' + p));
  }
  if (orphans.length || problems.length) process.exit(1);

  // Stable order: category order as declared, then as curated within a category.
  const order = curation.categories.map((c) => c.id);
  entries.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
  return { curation, entries };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Worker rate-limits. A 429 means "not yet verified", which is categorically different from
// "bad Hebrew" — reporting it as a failure would be a false negative that hides the real ones.
// So 429/5xx get backed off and retried; only a real answer counts either way.
async function morph(text, attempt = 0) {
  const res = await fetch(MORPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`morph HTTP ${res.status} after ${attempt} retries (rate limit, NOT a Hebrew error)`);
    await sleep(1000 * Math.pow(2, attempt));
    return morph(text, attempt + 1);
  }
  if (!res.ok) throw new Error(`morph HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.tokens)) throw new Error('morph: no tokens');
  return data.tokens;
}

async function validate(entries) {
  const bad = [];
  const unverified = [];
  for (const e of entries) {
    try {
      const tokens = await morph(e.he);
      const words = tokens.filter((t) => !t.sep);
      const missing = words.filter((t) => !t.voc);
      const recon = strip(words.map((t) => t.voc || '').join(''));
      if (missing.length || recon !== strip(e.he)) {
        bad.push(e.he);
        console.error(`✗ ${e.he} — ${missing.length ? 'unvocalized: ' + missing.map((t) => t.word).join(',') : 'reconstruction mismatch'}`);
      }
    } catch (err) {
      unverified.push(e.he);
      console.error(`? ${e.he} — ${err.message}`);
    }
    await sleep(250); // pace the Worker rather than trip its rate limit
  }
  const clean = entries.length - bad.length - unverified.length;
  console.log(`\nDicta round-trip: ${clean}/${entries.length} clean · ${bad.length} malformed · ${unverified.length} unverified (network/rate-limit).`);
  return bad.length;
}

const args = process.argv.slice(2);

if (args.includes('--report')) {
  const pool = await buildPool();
  const curation = JSON.parse(await readFile(CURATION, 'utf8'));
  const uncurated = [...pool.values()].filter((p) => !curation.expressions[p.he]);
  console.log(`Pool ${pool.size} · curated ${Object.keys(curation.expressions).length} · uncurated ${uncurated.length}\n`);
  const byGroup = {};
  uncurated.forEach((u) => { (byGroup[`${u.src}/${u.group}`] ||= []).push(u); });
  for (const [g, list] of Object.entries(byGroup)) {
    console.log(`--- ${g} (${list.length})`);
    list.forEach((u) => console.log(`   ${u.he}  ::  ${u.translit}  ::  ${u.fr}`));
  }
  process.exit(0);
}

const { curation, entries } = await build();

if (args.includes('--validate')) {
  const bad = await validate(entries);
  if (bad) process.exit(1);
}

const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, 'expressions.json');
const payload = {
  _note: 'GENERATED by tools/gen-expressions.mjs — do not edit by hand. Source: the { he, translit, fr } arrays already shipping in the idiom/slang lessons, joined onto the hand-written usage notes in tools/expressions-curation.json. Regenerate: node tools/gen-expressions.mjs build',
  generated: new Date().toISOString().slice(0, 10),
  categories: curation.categories,
  expressions: entries,
};
await writeFile(out, JSON.stringify(payload, null, 1) + '\n', 'utf8');
console.log(`✓ ${entries.length} expressions across ${curation.categories.length} categories → ${out}`);
const byCat = {};
entries.forEach((e) => { byCat[e.cat] = (byCat[e.cat] || 0) + 1; });
console.log('  ' + Object.entries(byCat).map(([c, n]) => `${c}:${n}`).join(' · '));
