#!/usr/bin/env node
/*
 * judge-triage.mjs — turn 85 individual verdicts into a ranked work list.
 *
 * Verdicts are per-record, but bugs are not: one broken vocalization rule shows up in seven
 * records. Ranking by raw count would then rank symptoms, not causes. So this clusters by
 * (fault_layer, recurring evidence signature) and scores each cluster by reach x severity,
 * keeping only what our own layer can actually act on.
 *
 *   node tools/judge-triage.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { reportPath } from './paths.mjs';

const dir = reportPath('x').slice(0, -1);
const files = (await readdir(dir)).filter((f) => /^judge-verdicts-\d+\.json$/.test(f)).sort();
if (!files.length) { console.error('no judge-verdicts-N.json yet'); process.exit(1); }

const all = [];
for (const f of files) {
  const j = JSON.parse(await readFile(reportPath(f), 'utf8'));
  for (const v of j.verdicts || []) all.push({ ...v, judge: j.judge });
}

const SEV = { high: 3, medium: 2, low: 1 };
const bad = all.filter((v) => v.verdict === 'wrong' || v.verdict === 'acceptable');

/* Cluster on the fault layer plus the salient words of the problem statement: judges phrase
   the same defect differently, so exact-matching the sentence would split one bug into four. */
const KEYS = [
  ['meteg/stray diacritic', /meteg|stray (diacritic|mark)|extra diacritic|U\+05BD/i],
  ['holam misplaced (mater lectionis)', /holam|U\+05B9|mater|vowel-letter|male/i],
  ['transliteration lacks stress/syllables', /stress|CAPS|syllab|hyphen/i],
  ['breakdown picks wrong homograph', /breakdown|homograph|gloss|word-by-word/i],
  ['gender not honoured / no alternate', /gender|feminine|masculine|f\.s|m\.s/i],
  ['source text left untranslated', /untranslated|raw (french|english)|left in (french|english)|not translated/i],
  ['numbers/dates left raw', /\d{1,2}:\d{2}|digit|number|date|time expression/i],
  ['idiom calqued literally', /idiom|literal|calque|word-for-word/i],
  ['register/politeness wrong', /register|politeness|formal|informal/i],
  ['curated answer existed but not shown', /curated|phrasebook|verified (entry|alternative)|exact (hit|match)/i],
];

const clusters = new Map();
for (const v of bad) {
  const text = `${v.problem || ''} ${v.evidence || ''} ${v.mitigation || ''}`;
  const hit = KEYS.find(([, re]) => re.test(text));
  const key = `${hit ? hit[0] : 'other'}`;
  if (!clusters.has(key)) clusters.set(key, { theme: key, records: [], layers: new Set(), mitigable: 0, score: 0, examples: [] });
  const c = clusters.get(key);
  c.records.push(v.id);
  c.layers.add(v.fault_layer);
  if (v.our_layer_could_mitigate) c.mitigable++;
  c.score += (SEV[v.severity] || 1) * (v.verdict === 'wrong' ? 2 : 1);
  if (c.examples.length < 3) c.examples.push({ input: v.input, problem: v.problem, expected_he: v.expected_he, evidence: v.evidence });
}

const ranked = [...clusters.values()]
  .map((c) => ({ ...c, layers: [...c.layers], reach: c.records.length, mitigable_share: +(c.mitigable / c.records.length).toFixed(2) }))
  .sort((a, b) => b.score - a.score);

const byJudge = {};
for (const v of all) {
  byJudge[v.judge] = byJudge[v.judge] || { wrong: 0, acceptable: 0, correct: 0, untested_curated_hit: 0, mitigable: 0, n: 0 };
  byJudge[v.judge][v.verdict] = (byJudge[v.judge][v.verdict] || 0) + 1;
  byJudge[v.judge].n++;
  if (v.our_layer_could_mitigate) byJudge[v.judge].mitigable++;
}

const out = {
  triaged: new Date().toISOString(),
  judges: files.length, verdicts: all.length,
  by_verdict: all.reduce((a, v) => (a[v.verdict] = (a[v.verdict] || 0) + 1, a), {}),
  by_layer: all.reduce((a, v) => (a[v.fault_layer] = (a[v.fault_layer] || 0) + 1, a), {}),
  by_path: all.reduce((a, v) => (a[v.path] = (a[v.path] || 0) + 1, a), {}),
  /* Judge severity varies; a cluster backed by several judges is more trustworthy than one
     judge's hobby-horse, so keep the per-judge spread visible rather than averaging it away. */
  per_judge: byJudge,
  clusters: ranked,
};
await writeFile(reportPath('judge-triage.json'), JSON.stringify(out, null, 1) + '\n', 'utf8');

console.log(`${all.length} verdicts from ${files.length} judges`);
console.log('verdict:', out.by_verdict);
console.log('layer  :', out.by_layer);
console.log('\nper judge (strictness spread):');
for (const [j, s] of Object.entries(byJudge)) console.log(`  judge ${j}: ${s.wrong} wrong / ${s.acceptable} acc / ${s.correct} ok / ${s.untested_curated_hit} untested · mitigable ${s.mitigable}/${s.n}`);
console.log('\nranked clusters:');
for (const c of ranked) console.log(`  ${String(c.score).padStart(3)}  ${c.theme.padEnd(38)} reach ${String(c.reach).padStart(2)}  mitigable ${c.mitigable_share}  [${c.layers.join(', ')}]`);
console.log(`\n-> ${reportPath('judge-triage.json')}`);
