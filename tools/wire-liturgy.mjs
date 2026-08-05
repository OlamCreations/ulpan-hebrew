#!/usr/bin/env node
/**
 * Put the liturgy pages' scripts on every liturgy page.
 *
 *   node tools/wire-liturgy.mjs          report what is missing
 *   node tools/wire-liturgy.mjs --write  add what is missing
 *
 * These 51 pages load NO other script — not app.js, not the shared modules — so anything
 * they need is named here and added directly. Idempotent, so it can be re-run after a new
 * song or psalm is added rather than being a one-shot somebody has to remember.
 *
 * swupdate.js is not optional decoration. Without it a liturgy page can never learn that a
 * new service worker exists, so a deploy reaches the network and never reaches the installed
 * app — the failure that made the autoscroll invisible on the phone for the first hour of its
 * life. If you add a page family that also skips app.js, it needs this script too.
 *
 * Reads the liturgy folder from layout.config.json like every other tool here.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, cfg } from './paths.mjs';

const write = process.argv.includes('--write');
const ANCHOR = '</body>';
const SCRIPTS = ['swupdate.js', 'autoscroll.js'];

const rule = cfg.pageRules.find((r) => r.folder === 'liturgy');
if (!rule) {
  console.error('no liturgy rule in layout.config.json');
  process.exit(1);
}
const dir = join(ROOT, rule.folder);
const match = new RegExp(rule.match);
const files = (await readdir(dir)).filter((f) => match.test(f)).sort();

const added = Object.fromEntries(SCRIPTS.map((s) => [s, 0]));
const noAnchor = [];

for (const f of files) {
  const p = join(dir, f);
  let html = await readFile(p, 'utf8');
  let touched = false;

  for (const script of SCRIPTS) {
    if (html.includes('assets/' + script)) continue;
    const at = html.lastIndexOf(ANCHOR);
    if (at < 0) { if (!noAnchor.includes(f)) noAnchor.push(f); break; }
    const tag = `<script src="../assets/${script}" defer></script>`;
    html = html.slice(0, at) + tag + '\n' + html.slice(at);
    added[script]++;
    touched = true;
  }
  if (touched && write) await writeFile(p, html, 'utf8');
}

console.log(`${files.length} liturgy pages`);
for (const s of SCRIPTS) {
  console.log(`  ${s.padEnd(14)} ${added[s]} ${write ? 'wired now' : 'would be wired'}, ${files.length - added[s]} already`);
}
if (noAnchor.length) {
  console.log(`  ${noAnchor.length} WITHOUT a </body> anchor: ${noAnchor.join(', ')}`);
  process.exitCode = 1;
}
