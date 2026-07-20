/*
 * paths.mjs — the one place that knows where things live.
 *
 * Before the repo was foldered, every tool did `readdir(ROOT)` and filtered by filename. That
 * only worked because the site was flat. Tools now ask for a scope ("lessons", "allPages") and
 * get back repo-relative paths, so moving a family of pages means editing layout.config.json
 * and nothing else.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ROOT = join(HERE, '..');
export const TOOLS = HERE;
export const cfg = JSON.parse(await readFile(join(HERE, 'layout.config.json'), 'utf8'));

/** Site data the pages fetch at runtime (phrasebook, expressions). */
export const dataPath = (file) => join(ROOT, cfg.data.folder, file);
/** Tool output — audits, violation lists. Never shipped, never precached. */
export const reportPath = (file) => join(HERE, 'reports', file);

/**
 * Repo-relative paths of the HTML pages in a declared scope.
 * @param {'lessons'|'allPages'} scope
 * @param {RegExp} [match] extra filter on the bare filename
 */
export async function pages(scope, match) {
  const dirs = cfg.toolScopes[scope];
  if (!dirs) throw new Error(`Unknown tool scope "${scope}" — declare it in layout.config.json`);
  const out = [];
  for (const dir of dirs) {
    let ents;
    try { ents = await readdir(join(ROOT, dir), { withFileTypes: true }); }
    catch { continue; }
    for (const e of ents) {
      if (!e.isFile() || !e.name.endsWith('.html')) continue;
      if (match && !match.test(e.name)) continue;
      out.push(dir ? `${dir}/${e.name}` : e.name);
    }
  }
  return out.sort();
}

/** The numbered curriculum pages, in curriculum order. */
export const lessonPages = () => pages('lessons', /^\d+-.*\.html$/);
