/* tehilim-merge-parts.mjs — assemble one psalm written by several authors.
 *
 * Psalm 119 is 176 verses and 1064 words, which is more than one author should
 * hold at once: the glosses at the end get thinner than the glosses at the start.
 * It is written instead as parts, one per group of stanzas, plus a meta file for
 * the title, intro and PARDES, and joined here.
 *
 *   content/tehilim/parts/119.meta.json    { titleEn, tempo, progression, intro, pardes }
 *   content/tehilim/parts/119.p1.json      { verses: [ ... ] }
 *   ...
 *   -> content/tehilim/119.json
 *
 * The merge refuses on any gap, overlap or duplicate rather than producing a
 * psalm with a hole in the middle, which the per-verse validator would catch but
 * only after the fact and with a less useful message.
 *
 * Usage: node tools/tehilim-merge-parts.mjs 119
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const n = Number(process.argv[2]);
if (!n) { console.error('usage: node tools/tehilim-merge-parts.mjs <psalm>'); process.exit(2); }
const nn = String(n).padStart(3, '0');

const partsDir = join(ROOT, 'content', 'tehilim', 'parts');
const source = JSON.parse(readFileSync(join(ROOT, 'content', 'tehilim', 'source', `${nn}.json`), 'utf8'));

const metaPath = join(partsDir, `${nn}.meta.json`);
if (!existsSync(metaPath)) { console.error(`missing ${nn}.meta.json`); process.exit(1); }
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

const partFiles = readdirSync(partsDir)
  .filter(f => new RegExp(`^${nn}\\.p\\d+\\.json$`).test(f))
  .sort((a, b) => parseInt(a.match(/p(\d+)/)[1], 10) - parseInt(b.match(/p(\d+)/)[1], 10));

if (!partFiles.length) { console.error(`no ${nn}.pN.json parts found`); process.exit(1); }

const byVerse = new Map();
const dupes = [];
for (const f of partFiles) {
  const part = JSON.parse(readFileSync(join(partsDir, f), 'utf8'));
  if (!Array.isArray(part.verses)) { console.error(`${f}: no verses array`); process.exit(1); }
  for (const v of part.verses) {
    if (byVerse.has(v.n)) dupes.push(`verse ${v.n} appears in more than one part`);
    byVerse.set(v.n, v);
  }
}

const missing = source.verses.map(v => v.n).filter(x => !byVerse.has(x));
if (missing.length || dupes.length) {
  if (missing.length) console.error(`missing ${missing.length} verses: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' ...' : ''}`);
  for (const d of dupes.slice(0, 10)) console.error(d);
  process.exit(1);
}

const merged = {
  psalm: n,
  titleEn: meta.titleEn,
  tempo: meta.tempo,
  progression: meta.progression,
  intro: meta.intro,
  verses: source.verses.map(v => byVerse.get(v.n)),
  pardes: meta.pardes
};

writeFileSync(join(ROOT, 'content', 'tehilim', `${nn}.json`), JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log(`psalm ${n}: ${partFiles.length} parts + meta -> content/tehilim/${nn}.json (${merged.verses.length} verses)`);
console.log('now run: node tools/tehilim-validate.mjs ' + n);
