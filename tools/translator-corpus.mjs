#!/usr/bin/env node
/*
 * translator-corpus.mjs — assemble the input corpus for probing the live translator.
 *
 * Three of the four engine paths get a reference for free from data we already verified by
 * hand, so they can be MEASURED rather than merely reviewed:
 *
 *   en -> he        phrasebook `en` in, phrasebook `he`/`tr` as the reference
 *   romanized -> he phrasebook `tr` (de-hyphenated) in, same `he` as the reference
 *   bare he -> he   phrasebook/ulpan `he` with niqqud stripped in, the original as the reference
 *
 * The fourth path (fr -> he) uses the ulpan class notes, which carry a French gloss.
 * Free-form phrases have no reference by construction — that is the judges' job, and it is
 * the class of input where this engine actually breaks (le/mura, tavchnit, homographs were
 * all phrase-level). They are added separately by tools/translator-corpus-free.json.
 *
 *   node tools/translator-corpus.mjs [--per 12]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataPath, reportPath, ROOT } from './paths.mjs';

const argPer = process.argv.indexOf('--per');
const PER = argPer >= 0 ? Number(process.argv[argPer + 1]) : 12;

const stripNiqqud = (s) => (s || '').replace(/[֑-ׇ]/g, '');
/** "to-DA ra-BA" -> "toda raba": what a learner would actually type. */
const deHyphen = (s) => (s || '').toLowerCase().replace(/-/g, '').replace(/\s+/g, ' ').trim();

const items = [];
const add = (o) => items.push({ id: `${o.path}-${String(items.length + 1).padStart(3, '0')}`, ...o });

/* ---------- phrasebook: verified he + human translit ---------- */
const pb = JSON.parse(await readFile(dataPath('phrasebook.json'), 'utf8')).phrases;

/* Spread across categories instead of taking the first N, so the sample isn't all greetings. */
function spread(rows, n) {
  const byCat = new Map();
  for (const r of rows) { const k = r.cat || '-'; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(r); }
  const out = [], cats = [...byCat.values()];
  for (let i = 0; out.length < n && i < 60; i++) for (const c of cats) { if (c[i] && out.length < n) out.push(c[i]); }
  return out;
}

const multiWord = pb.filter((p) => stripNiqqud(p.he).trim().split(/\s+/).length >= 2);
const anyWord = pb;

for (const p of spread(anyWord, PER)) {
  add({ path: 'en2he', lang: 'en', input: p.en.split(' / ')[0], ref: { he: p.he, tr: p.tr },
        note: 'phrasebook reference' });
}
for (const p of spread(multiWord.length >= PER ? multiWord : anyWord, PER)) {
  add({ path: 'rom2he', lang: 'romanized', input: deHyphen(p.tr), ref: { he: p.he, tr: p.tr },
        note: 'phrasebook reference (romanized input)' });
}
for (const p of spread(multiWord.length >= PER ? multiWord : anyWord, PER)) {
  add({ path: 'bare2he', lang: 'he-bare', input: stripNiqqud(p.he), ref: { he: p.he, tr: p.tr },
        note: 'phrasebook reference (niqqud stripped on input)' });
}

/* ---------- ulpan class notes: real French glosses from Jonas's own sheets ---------- */
const daysDir = join(ROOT, '..', 'ulpan-etzion', 'data', 'days');
let ulpanCount = 0;
if (existsSync(daysDir)) {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(daysDir)).filter((f) => f.endsWith('.json')).sort();
  const rows = [];
  for (const f of files) {
    const day = JSON.parse(await readFile(join(daysDir, f), 'utf8'));
    for (const sec of day.sections || []) {
      for (const it of sec.items || []) {
        if (it.he && (it.fr || it.en)) rows.push({ ...it, day: day.date, section: sec.title });
      }
    }
  }
  for (const r of spread(rows.map((r) => ({ ...r, cat: r.section })), PER)) {
    if (!r.fr) continue;
    add({ path: 'fr2he', lang: 'fr', input: r.fr, ref: { he: r.he, tr: r.translit || null },
          note: `ulpan ${r.day} — ${r.section}` });
    ulpanCount++;
  }
  /* Bare Hebrew straight off a class sheet: the "I photographed the board" case. */
  for (const r of spread(rows.map((r) => ({ ...r, cat: r.section })), Math.ceil(PER / 2))) {
    add({ path: 'bare2he', lang: 'he-bare', input: stripNiqqud(r.he), ref: { he: r.he, tr: r.translit || null },
          note: `ulpan ${r.day} — ${r.section}` });
    ulpanCount++;
  }
}

/* ---------- free-form phrases (no reference; judged, not measured) ---------- */
const freePath = join(ROOT, 'tools', 'translator-corpus-free.json');
let freeCount = 0;
if (existsSync(freePath)) {
  const free = JSON.parse(await readFile(freePath, 'utf8'));
  for (const f of free.phrases || []) { add({ path: f.path || 'fr2he', lang: f.lang || 'fr', input: f.input, ref: null, note: f.note || 'free-form' }); freeCount++; }
}

const out = reportPath('translator-corpus.json');
await writeFile(out, JSON.stringify({
  built: new Date().toISOString(),
  sources: { phrasebook: pb.length, ulpanItems: ulpanCount, free: freeCount },
  items,
}, null, 1) + '\n', 'utf8');

const byPath = items.reduce((a, i) => (a[i.path] = (a[i.path] || 0) + 1, a), {});
console.log(`corpus: ${items.length} inputs ->`, byPath);
console.log(`with reference: ${items.filter((i) => i.ref).length} · free-form: ${items.filter((i) => !i.ref).length}`);
console.log(`-> ${out}`);
