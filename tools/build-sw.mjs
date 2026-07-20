#!/usr/bin/env node
/*
 * build-sw.mjs — regenerate the service-worker precache list from what is actually on disk,
 * and bump the cache version.
 *
 * The old list was hand-maintained, which is how a page ships without being cached (or a
 * deleted page keeps 404-ing an install). Walking the folders declared in layout.config.json
 * removes that failure mode: adding a page is enough.
 *
 *   node tools/build-sw.mjs            # rewrite ASSETS, bump ulpan-vN -> ulpan-v(N+1)
 *   node tools/build-sw.mjs --no-bump  # rewrite ASSETS, keep the current version
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const cfg = JSON.parse(await readFile(join(HERE, 'layout.config.json'), 'utf8')).serviceWorker;

const swPath = join(ROOT, cfg.file);
let sw = await readFile(swPath, 'utf8');

/* ---------- collect precachable files ---------- */
const exts = new Set(cfg.precacheExtensions);
const exclude = new Set(cfg.precacheExclude);
const urls = ['./'];

for (const dir of cfg.precacheDirs) {
  let ents;
  try { ents = await readdir(join(ROOT, dir), { withFileTypes: true }); }
  catch { continue; }                                   // declared but not created yet
  const files = ents
    .filter((e) => e.isFile() && exts.has(extname(e.name)) && !exclude.has(e.name))
    .map((e) => e.name)
    .sort();
  for (const f of files) urls.push(dir ? `./${dir}/${f}` : `./${f}`);
}

/* ---------- version ---------- */
const verRe = new RegExp(`const CACHE = '${cfg.cachePrefix}(\\d+)';`);
const cur = sw.match(verRe);
if (!cur) { console.error(`Cannot find "const CACHE = '${cfg.cachePrefix}N';" in ${cfg.file}`); process.exit(1); }
const next = process.argv.includes('--no-bump') ? Number(cur[1]) : Number(cur[1]) + 1;

sw = sw.replace(verRe, `const CACHE = '${cfg.cachePrefix}${next}';`);
sw = sw.replace(/const ASSETS = \[[\s\S]*?\];/, `const ASSETS = ${JSON.stringify(urls)};`);

await writeFile(swPath, sw, 'utf8');
console.log(`${cfg.file}: ${cfg.cachePrefix}${cur[1]} -> ${cfg.cachePrefix}${next} · ${urls.length} precached entries`);
