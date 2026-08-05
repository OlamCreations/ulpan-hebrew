#!/usr/bin/env node
/**
 * Put the autoscroll script tag on every liturgy page.
 *
 *   node tools/wire-autoscroll.mjs          report what is missing it
 *   node tools/wire-autoscroll.mjs --write  add it
 *
 * Idempotent, so it can be re-run after a new song or psalm is added rather than being a
 * one-shot that has to be remembered. It reads the liturgy folder out of layout.config.json
 * like every other tool here — no folder name is written twice in this repo.
 *
 * These pages load NO other script (not app.js, not the shared modules), which is why the
 * tag is added directly instead of the module being registered with the shared loader.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, cfg } from './paths.mjs';

const write = process.argv.includes('--write');
const TAG = '<script src="../assets/autoscroll.js" defer></script>';
const ANCHOR = '</body>';

// The rule that owns the liturgy family, straight from the layout contract.
const rule = cfg.pageRules.find((r) => r.folder === 'liturgy');
if (!rule) {
  console.error('no liturgy rule in layout.config.json');
  process.exit(1);
}
const dir = join(ROOT, rule.folder);
const match = new RegExp(rule.match);

const files = (await readdir(dir)).filter((f) => match.test(f)).sort();
let added = 0;
let already = 0;
const noAnchor = [];

for (const f of files) {
  const p = join(dir, f);
  const html = await readFile(p, 'utf8');
  if (html.includes('assets/autoscroll.js')) { already++; continue; }
  const at = html.lastIndexOf(ANCHOR);
  if (at < 0) { noAnchor.push(f); continue; }
  const out = html.slice(0, at) + TAG + '\n' + html.slice(at);
  if (write) await writeFile(p, out, 'utf8');
  added++;
}

console.log(`${files.length} liturgy pages`);
console.log(`  ${already} already wired`);
console.log(`  ${added} ${write ? 'wired now' : 'would be wired'}`);
if (noAnchor.length) {
  console.log(`  ${noAnchor.length} WITHOUT a </body> anchor: ${noAnchor.join(', ')}`);
  process.exitCode = 1;
}
