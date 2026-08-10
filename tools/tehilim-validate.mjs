/* tehilim-validate.mjs — check an authored psalm before it can become a page.
 *
 * The authoring pass is done by agents working in parallel. They receive the
 * scaffold (Hebrew + transliteration, both machine-produced) and return English:
 * glosses by word index, a translation per poetic line, a summary per verse, and
 * the commentary. They never type a Hebrew character, and this refuses the file
 * if they did.
 *
 * What it enforces, in the order the mistakes actually happen:
 *   1. no Hebrew anywhere in the authored file      (the whole point)
 *   2. every verse of the psalm is present, once    (silent truncation)
 *   3. stichs cover every word exactly once, in order (a word losing its gloss)
 *   4. every word has a gloss, none empty           (blank cells on the page)
 *   5. prose fields are present and not placeholder (a page that ships "TODO")
 *
 * Usage: node tools/tehilim-validate.mjs 23 [24 25 ...]     (or --all)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const HEBREW = /[֐-׿]/;
const PLACEHOLDER = /\b(TODO|TBD|FIXME|lorem ipsum|placeholder|\.\.\.)\b/i;

export function validatePsalm(n) {
  const nn = String(n).padStart(3, '0');
  const dataPath = join(ROOT, 'content', 'tehilim', 'source', `${nn}.json`);
  const contentPath = join(ROOT, 'content', 'tehilim', `${nn}.json`);
  const errs = [];

  if (!existsSync(dataPath)) return [`psalm ${n}: no source text, run tools/tehilim-scaffold.mjs ${n}`];
  if (!existsSync(contentPath)) return [`psalm ${n}: no authored content at content/tehilim/${nn}.json`];

  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  let content;
  try { content = JSON.parse(readFileSync(contentPath, 'utf8')); }
  catch (e) { return [`psalm ${n}: content is not valid JSON — ${e.message}`]; }

  // 1. no Hebrew in authored text
  (function scan(node, path) {
    if (typeof node === 'string') {
      if (HEBREW.test(node)) errs.push(`psalm ${n}: Hebrew characters at ${path} — the authored file must be English only`);
      if (PLACEHOLDER.test(node)) errs.push(`psalm ${n}: placeholder text at ${path}`);
      return;
    }
    if (Array.isArray(node)) return node.forEach((v, i) => scan(v, `${path}[${i}]`));
    if (node && typeof node === 'object') return Object.entries(node).forEach(([k, v]) => scan(v, `${path}.${k}`));
  })(content, 'content');

  // 2. prose fields
  for (const [field, min] of [['titleEn', 3], ['intro', 60]]) {
    const v = content[field];
    if (typeof v !== 'string' || v.trim().length < min) errs.push(`psalm ${n}: ${field} missing or too short`);
  }
  if (!Array.isArray(content.pardes) || content.pardes.length < 2) {
    errs.push(`psalm ${n}: pardes needs at least two sections`);
  } else {
    content.pardes.forEach((p, i) => {
      if (!p || !p.level || !p.body || p.body.length < 80) errs.push(`psalm ${n}: pardes[${i}] needs a level key and a body of substance`);
      else if (!['peshat', 'remez', 'drash', 'sod'].includes(p.level)) errs.push(`psalm ${n}: pardes[${i}] has unknown level "${p.level}"`);
    });
  }

  // 3. verses
  if (!Array.isArray(content.verses)) return errs.concat(`psalm ${n}: no verses array`);
  if (content.verses.length !== data.verses.length) {
    errs.push(`psalm ${n}: ${content.verses.length} verses authored, the psalm has ${data.verses.length}`);
  }

  for (const dv of data.verses) {
    const cv = content.verses.find(v => v && v.n === dv.n);
    if (!cv) { errs.push(`psalm ${n}: verse ${dv.n} missing`); continue; }

    // 4. stichs partition the words, in order, with no gap and no overlap
    if (!Array.isArray(cv.stichs) || !cv.stichs.length) {
      errs.push(`psalm ${n}.${dv.n}: no stichs`);
      continue;
    }
    let cursor = 0;
    for (const [si, st] of cv.stichs.entries()) {
      if (!st || typeof st.from !== 'number' || typeof st.to !== 'number') {
        errs.push(`psalm ${n}.${dv.n}: stich ${si} needs numeric from/to word indices`); continue;
      }
      if (st.from !== cursor) errs.push(`psalm ${n}.${dv.n}: stich ${si} starts at ${st.from}, expected ${cursor}`);
      if (st.to < st.from) errs.push(`psalm ${n}.${dv.n}: stich ${si} ends before it starts`);
      if (typeof st.en !== 'string' || st.en.trim().length < 3) errs.push(`psalm ${n}.${dv.n}: stich ${si} has no English line`);
      cursor = st.to + 1;
    }
    if (cursor !== dv.words.length) {
      errs.push(`psalm ${n}.${dv.n}: stichs cover ${cursor} of ${dv.words.length} words`);
    }

    // 5. one gloss per word
    if (!Array.isArray(cv.glosses) || cv.glosses.length !== dv.words.length) {
      errs.push(`psalm ${n}.${dv.n}: ${cv.glosses ? cv.glosses.length : 0} glosses for ${dv.words.length} words`);
    } else {
      cv.glosses.forEach((g, i) => {
        if (typeof g !== 'string' || !g.trim()) errs.push(`psalm ${n}.${dv.n}: word ${i} has no gloss`);
      });
    }

    if (typeof cv.summary !== 'string' || cv.summary.trim().length < 25) {
      errs.push(`psalm ${n}.${dv.n}: summary missing or too short`);
    }
  }

  return errs;
}

// -------------------------------------------------------------- cli
const args = process.argv.slice(2);
if (args.length) {
  let list = args.filter(a => /^\d+$/.test(a)).map(Number);
  if (args.includes('--all')) {
    const dir = join(ROOT, 'content', 'tehilim');
    list = existsSync(dir) ? readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).map(f => parseInt(f, 10)).sort((a, b) => a - b) : [];
  }
  let bad = 0;
  for (const n of list) {
    const errs = validatePsalm(n);
    if (errs.length) { bad++; console.log(`FAIL psalm ${n}`); for (const e of errs.slice(0, 8)) console.log('   ' + e); }
    else console.log(`ok   psalm ${n}`);
  }
  console.log(`\n${list.length - bad}/${list.length} valid`);
  if (bad) process.exit(1);
}
