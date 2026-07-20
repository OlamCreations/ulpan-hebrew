#!/usr/bin/env node
/*
 * judge-batches.mjs — split a probe capture into self-contained batches for judging,
 * and merge the verdicts back once the judges have run.
 *
 *   node tools/judge-batches.mjs split [--n 4]
 *   node tools/judge-batches.mjs merge
 *
 * A batch carries only what a judge needs to rule: the input, the path, the reference when we
 * have one, and exactly what the page displayed. It deliberately does NOT carry our source
 * code — a judge who has read the implementation starts explaining the output instead of
 * evaluating it.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { reportPath } from './paths.mjs';

const mode = process.argv[2] || 'split';
const argN = process.argv.indexOf('--n');
const N = argN >= 0 ? Number(process.argv[argN + 1]) : 4;

if (mode === 'split') {
  const cap = JSON.parse(await readFile(reportPath('translator-capture.json'), 'utf8'));
  const recs = cap.records.map((r) => ({
    id: r.id,
    path: r.path,
    source_language: r.lang,
    input: r.input,
    reference: r.ref || null,            // hand-verified Hebrew, when it exists
    trap: r.note || null,
    displayed: r.shown,                  // exactly what the user sees
    natural_version_requested: r.natClicked,
    request_errors: (r.errors || []).length ? r.errors : undefined,
  }));

  // Round-robin so every batch sees every path — a judge that only sees bare-Hebrew inputs
  // has no basis for comparing how the paths fail differently.
  const batches = Array.from({ length: N }, () => []);
  recs.forEach((r, i) => batches[i % N].push(r));

  for (let i = 0; i < N; i++) {
    const f = reportPath(`judge-batch-${i + 1}.json`);
    await writeFile(f, JSON.stringify({ batch: i + 1, of: N, records: batches[i] }, null, 1) + '\n', 'utf8');
    console.log(`batch ${i + 1}: ${batches[i].length} records -> ${f}`);
  }
}

if (mode === 'merge') {
  const dir = reportPath('.').replace(/[\\/]\.$/, '');
  const files = (await readdir(dir)).filter((f) => /^judge-verdicts-\d+\.json$/.test(f)).sort();
  if (!files.length) { console.error('no judge-verdicts-N.json found in tools/reports/'); process.exit(1); }

  const all = [];
  for (const f of files) {
    const j = JSON.parse(await readFile(reportPath(f), 'utf8'));
    for (const v of j.verdicts || []) all.push({ ...v, _from: f });
  }

  const by = (k) => all.reduce((a, v) => (a[v[k] || 'unspecified'] = (a[v[k] || 'unspecified'] || 0) + 1, a), {});
  const merged = {
    merged: new Date().toISOString(),
    files, total: all.length,
    by_verdict: by('verdict'),
    by_layer: by('fault_layer'),
    by_path: by('path'),
    our_layer_could_mitigate: all.filter((v) => v.our_layer_could_mitigate).length,
    verdicts: all,
  };
  await writeFile(reportPath('judge-merged.json'), JSON.stringify(merged, null, 1) + '\n', 'utf8');
  console.log(`merged ${all.length} verdicts from ${files.length} judges`);
  console.log('verdict:', merged.by_verdict);
  console.log('fault layer:', merged.by_layer);
  console.log('our layer could mitigate:', merged.our_layer_could_mitigate);
  console.log(`-> ${reportPath('judge-merged.json')}`);
}
