#!/usr/bin/env node
/*
 * migrate-layout.mjs — move the flat repo into the foldered layout described by
 * tools/layout.config.json, and rewrite every intra-site reference to match.
 *
 * The site is ~1000 static pages whose link graph is shallow and mechanical:
 * each page points at index.html, the two shared assets, and a handful of
 * siblings. So the migration is a filename -> new path map applied in one pass.
 *
 * Every content page lands exactly ONE level deep. That is deliberate: it makes
 * the relative prefix uniform ("../") instead of depth-dependent, which is the
 * difference between a rewrite you can verify by eye and one you cannot.
 *
 *   node tools/migrate-layout.mjs --dry-run   # report only, touch nothing
 *   node tools/migrate-layout.mjs             # move + rewrite
 *
 * Not idempotent by design: it expects the flat layout and refuses to run twice.
 */
import { readFile, writeFile, readdir, rename, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DRY = process.argv.includes('--dry-run');

const cfg = JSON.parse(await readFile(join(HERE, 'layout.config.json'), 'utf8'));
const rules = cfg.pageRules.map((r) => ({ folder: r.folder, re: new RegExp(r.match) }));

/* ---------- 1. build the flat-name -> new-path map ---------- */

const entries = await readdir(ROOT, { withFileTypes: true });
const rootHtml = entries.filter((e) => e.isFile() && e.name.endsWith('.html')).map((e) => e.name);

if (rootHtml.length < 100) {
  console.error(`Refusing to run: only ${rootHtml.length} HTML files at root — layout already migrated?`);
  process.exit(1);
}

/** flat filename -> repo-relative destination path (posix separators) */
const pageMap = new Map();
const unmatched = [];
for (const name of rootHtml) {
  const rule = rules.find((r) => r.re.test(name));
  if (!rule) { unmatched.push(name); continue; }
  pageMap.set(name, rule.folder ? `${rule.folder}/${name}` : name);
}

if (unmatched.length) {
  console.error('Refusing to run: no layout rule matches these pages:\n  ' + unmatched.join('\n  '));
  console.error('Add a rule to tools/layout.config.json rather than special-casing here.');
  process.exit(1);
}

/** asset/data filename -> destination path */
const fileMap = new Map();
for (const f of cfg.assets.files) fileMap.set(f, `${cfg.assets.folder}/${f}`);
for (const f of cfg.data.files) fileMap.set(f, `${cfg.data.folder}/${f}`);

/* ---------- 2. reference rewriting ---------- */

/** relative path from a page living in `dir` to a repo-root-relative `target` */
function relTo(dir, target) {
  return relative(dir || '.', target).split('\\').join('/');
}

const assetNames = [...fileMap.keys()].map((f) => f.replace(/[.]/g, '\\.')).join('|');
const REF_HTML = /(["'])([A-Za-z0-9._-]+\.html)((?:\?|#)[^"']*)?\1/g;
const REF_FILE = new RegExp(`(["'])(${assetNames})((?:\\?|#)[^"']*)?\\1`, 'g');

/** Rewrite every intra-site reference in `content` for a file living in `dir`. */
function rewrite(content, dir) {
  let hits = 0;
  const out = content
    .replace(REF_HTML, (m, q, name, tail) => {
      const target = pageMap.get(name);
      if (!target) return m;
      hits++;
      return q + relTo(dir, target) + (tail || '') + q;
    })
    .replace(REF_FILE, (m, q, name, tail) => {
      const target = fileMap.get(name);
      if (!target) return m;
      hits++;
      return q + relTo(dir, target) + (tail || '') + q;
    });
  return { out, hits };
}

/* ---------- 3. execute ---------- */

const plan = { moved: 0, rewritten: 0, refs: 0, dropped: 0 };

// 3a. move assets + data out of the root
for (const [name, dest] of fileMap) {
  if (!existsSync(join(ROOT, name))) continue;
  plan.moved++;
  if (DRY) { console.log(`move  ${name} -> ${dest}`); continue; }
  await mkdir(join(ROOT, dirname(dest)), { recursive: true });
  await rename(join(ROOT, name), join(ROOT, dest));
}

// 3b. move pages, rewriting their references on the way
for (const [name, dest] of pageMap) {
  const dir = dirname(dest) === '.' ? '' : dirname(dest);
  const raw = await readFile(join(ROOT, name), 'utf8');
  const { out, hits } = rewrite(raw, dir);
  plan.refs += hits;
  if (hits) plan.rewritten++;
  if (dest !== name) plan.moved++;
  if (DRY) continue;
  if (dir) await mkdir(join(ROOT, dir), { recursive: true });
  await writeFile(join(ROOT, dest), out, 'utf8');
  if (dest !== name) await rm(join(ROOT, name));
}

// 3c. manifest.json stays at root but its icons moved
{
  const p = join(ROOT, 'manifest.json');
  const raw = await readFile(p, 'utf8');
  const { out, hits } = rewrite(raw, '');
  plan.refs += hits;
  if (!DRY && hits) await writeFile(p, out, 'utf8');
}

// 3d. drop committed build scratch
for (const d of cfg.drop) {
  if (!existsSync(join(ROOT, d))) continue;
  plan.dropped++;
  if (DRY) { console.log(`drop  ${d}/`); continue; }
  await rm(join(ROOT, d), { recursive: true, force: true });
}

console.log(
  `${DRY ? '[dry-run] ' : ''}pages ${pageMap.size} · files moved ${plan.moved} · ` +
  `pages rewritten ${plan.rewritten} · references updated ${plan.refs} · dirs dropped ${plan.dropped}`
);
