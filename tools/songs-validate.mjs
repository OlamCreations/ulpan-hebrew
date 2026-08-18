/* songs-validate.mjs — check an authored song before it can become a page.
 *
 * Same contract as tools/tehilim-validate.mjs: the author receives the scaffold
 * (Hebrew and transliteration, both machine-produced, pinned in the repo) and
 * returns English. They never type a Hebrew character, and this refuses the file
 * if they did. Wrong niqqud looks exactly like right niqqud; there is no reading
 * your way out of it, so the rule is structural rather than editorial.
 *
 * What it enforces, in the order the mistakes actually happen:
 *   1. no Hebrew anywhere in the authored file        (the whole point)
 *   2. stanzas cover every source line exactly once, in order
 *   3. every line has an English rendering
 *   4. every word ends up with a gloss, authored or pre-filled
 *   5. the chord grid parses and names a key that can be derived from it
 *   6. prose fields present, long enough, and not placeholder
 *
 * Usage: node tools/songs-validate.mjs 17 [18 ...]      (or --all)
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveKey, chordsOf, rootOf } from './chord-key.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'content', 'songs', 'index.json'), 'utf8')).songs;
const CONV = JSON.parse(readFileSync(join(ROOT, 'data', 'songs-conventions.json'), 'utf8'));

/* The reading the page will show, which readAs may correct away from the raw
   transliteration. The vocab must be keyed on what an author SEES, so this has
   to match the builder exactly — otherwise the validator demands a gloss for a
   key the builder will never look up, or passes one it will never find. */
const readingOf = (he, tr) => (CONV.readAs && CONV.readAs[he]) || tr;

const HEBREW = /[֐-׿]/;
const PLACEHOLDER = /\b(TODO|TBD|FIXME|lorem ipsum|placeholder)\b/i;

export function validateSong(n) {
  const nn = String(n).padStart(3, '0');
  const entry = REGISTRY.find(s => s.n === n);
  const errs = [];
  if (!entry) return [`song ${n}: not in content/songs/index.json`];

  const sourcePath = join(ROOT, 'content', 'songs', 'source', `${nn}.json`);
  const contentPath = join(ROOT, 'content', 'songs', `${nn}.json`);
  if (!existsSync(sourcePath)) return [`song ${n}: no source text, run tools/songs-scaffold.mjs ${n}`];
  if (!existsSync(contentPath)) return [`song ${n}: no authored content at content/songs/${nn}.json`];

  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  let content;
  try { content = JSON.parse(readFileSync(contentPath, 'utf8')); }
  catch (e) { return [`song ${n}: content is not valid JSON — ${e.message}`]; }

  // 1. no Hebrew, no placeholders, anywhere in the authored file
  (function scan(node, path) {
    if (typeof node === 'string') {
      if (HEBREW.test(node)) errs.push(`song ${n}: Hebrew characters at ${path} — the authored file must be English only`);
      if (PLACEHOLDER.test(node)) errs.push(`song ${n}: placeholder text at ${path}`);
      return;
    }
    if (Array.isArray(node)) return node.forEach((v, i) => scan(v, `${path}[${i}]`));
    if (node && typeof node === 'object') return Object.entries(node).forEach(([k, v]) => scan(v, `${path}.${k}`));
  })(content, 'content');

  // 2. prose fields
  for (const [field, min] of [['titleEn', 3], ['subtitleEn', 3], ['intro', 60]]) {
    const v = content[field];
    if (typeof v !== 'string' || v.trim().length < min) errs.push(`song ${n}: ${field} missing or shorter than ${min} characters`);
  }
  if (!Array.isArray(content.chantTips) || content.chantTips.length < 2) errs.push(`song ${n}: chantTips needs at least two entries`);
  if (!Array.isArray(content.about) || content.about.length < 2) errs.push(`song ${n}: about needs at least two sections`);
  else content.about.forEach((s, i) => {
    if (!s || typeof s.h !== 'string' || !s.h.trim()) errs.push(`song ${n}: about[${i}] has no heading`);
    if (!s || typeof s.body !== 'string' || s.body.trim().length < 40) errs.push(`song ${n}: about[${i}] body is missing or too short`);
  });

  /* Optional. A modern song's lyrics are copyrighted and never reproduced here; the page carries
     the public-domain text its refrain rests on, and sends the learner to the lyrics elsewhere.
     Each link needs a label and an https URL — an http one, or a bare domain, is a typo waiting
     to become a dead link on a page a learner has installed. */
  if (content.links !== undefined) {
    if (!Array.isArray(content.links)) errs.push(`song ${n}: links must be an array`);
    else content.links.forEach((l, i) => {
      if (!l || typeof l.label !== 'string' || !l.label.trim()) errs.push(`song ${n}: links[${i}] has no label`);
      if (!l || typeof l.url !== 'string' || !/^https:\/\/[^\s"<>]+$/.test(l.url)) errs.push(`song ${n}: links[${i}] url is not an https URL`);
    });
  }

  // 3. the grid, and the key it must yield
  const prog = content.progression;
  if (typeof prog !== 'string' || !chordsOf(prog).length) {
    errs.push(`song ${n}: progression missing or holds no chords`);
  } else {
    const bad = chordsOf(prog).filter(c => rootOf(c) === null);
    if (bad.length) errs.push(`song ${n}: progression holds non-chord symbols: ${bad.join(' ')}`);
    else { try { deriveKey(prog, `song ${n}`); } catch (e) { errs.push(e.message); } }
  }
  const tempo = content.tempo;
  if (!Number.isFinite(tempo) || tempo < 30 || tempo > 240) errs.push(`song ${n}: tempo ${tempo} is outside 30-240 BPM`);

  // 4. stanzas cover the source lines exactly once, in order
  /* This is the check that matters most, and it is why `from`/`to` are indices
     into the source rather than text the author retypes. A stanza that quietly
     skips a line produces a page that is missing a line of the song and looks
     perfectly well-formed — nothing else here would notice. */
  if (!Array.isArray(content.stanzas) || !content.stanzas.length) {
    errs.push(`song ${n}: no stanzas`);
    return errs;
  }
  /* Same fallback chain the builder uses: line gloss, then the per-song
     vocabulary keyed on transliteration, then whatever the source carried.
     If this list and the builder ever disagree, the validator passes a file
     that then builds a page with blank cells — so they are written to be
     read side by side. */
  const VOCAB = content.vocab && typeof content.vocab === 'object' ? content.vocab : {};
  for (const [k, v] of Object.entries(VOCAB)) {
    if (typeof v !== 'string' || !v.trim()) errs.push(`song ${n}: vocab entry "${k}" has no gloss`);
  }

  let expected = 0;
  for (const [si, st] of content.stanzas.entries()) {
    const where = `stanza ${st.n ?? si + 1}`;
    if (!Number.isInteger(st.from) || !Number.isInteger(st.to)) { errs.push(`song ${n}: ${where} has no from/to line indices`); continue; }
    if (st.from !== expected) errs.push(`song ${n}: ${where} starts at line ${st.from}, expected ${expected} — a line would be skipped or repeated`);
    if (st.to < st.from) errs.push(`song ${n}: ${where} ends (${st.to}) before it starts (${st.from})`);
    if (st.to >= source.lines.length) errs.push(`song ${n}: ${where} runs to line ${st.to}, the source has ${source.lines.length}`);
    expected = st.to + 1;

    const want = st.to - st.from + 1;
    if (!Array.isArray(st.lines) || st.lines.length !== want) {
      errs.push(`song ${n}: ${where} spans ${want} source lines but carries ${Array.isArray(st.lines) ? st.lines.length : 0} translations`);
      continue;
    }
    st.lines.forEach((ln, k) => {
      const idx = st.from + k;
      const src = source.lines[idx];
      if (!src) return;

      /* A line is one stich unless it declares word-level ranges. Those ranges
         obey the same rule as psalm stichs: cover every word once, in order. A
         range that skips a word drops it off the page, and nothing downstream
         would notice — the stanza would still look complete. */
      const ranges = Array.isArray(ln.stichs) && ln.stichs.length ? ln.stichs : null;
      if (ranges) {
        let want = 0;
        ranges.forEach((r, ri) => {
          const at = `${where} line ${idx} stich ${ri}`;
          if (!Number.isInteger(r.from) || !Number.isInteger(r.to)) { errs.push(`song ${n}: ${at} has no from/to word indices`); return; }
          if (r.from !== want) errs.push(`song ${n}: ${at} starts at word ${r.from}, expected ${want} — a word would be skipped or repeated`);
          if (r.to < r.from) errs.push(`song ${n}: ${at} ends (${r.to}) before it starts (${r.from})`);
          if (r.to >= src.words.length) errs.push(`song ${n}: ${at} runs to word ${r.to}, the line has ${src.words.length}`);
          want = r.to + 1;
          if (typeof r.en !== 'string' || !r.en.trim()) errs.push(`song ${n}: ${at} has no English`);
          const g = Array.isArray(r.glosses) ? r.glosses : [];
          const span = r.to - r.from + 1;
          if (g.length > span) errs.push(`song ${n}: ${at} has ${g.length} glosses for ${span} words`);
          for (let j = 0; j < span; j++) {
            const w = src.words[r.from + j];
            if (!w) continue;
            if (!((g[j] || '').trim() || (VOCAB[readingOf(w.he, w.tr)] || VOCAB[w.tr] || '').trim() || (w.gloss || '').trim())) errs.push(`song ${n}: ${at} word ${r.from + j} has no gloss`);
          }
        });
        if (want !== src.words.length) {
          errs.push(`song ${n}: ${where} line ${idx} stichs cover ${want} of ${src.words.length} words — the rest would vanish`);
        }
        if (ln.en) errs.push(`song ${n}: ${where} line ${idx} has both stichs and a line-level en; only one can reach the page`);
        return;
      }

      if (typeof ln.en !== 'string' || !ln.en.trim()) errs.push(`song ${n}: ${where} line ${idx} has no English`);
      const authored = Array.isArray(ln.glosses) ? ln.glosses : [];
      src.words.forEach((w, wi) => {
        const g = (authored[wi] || '').trim() || (VOCAB[readingOf(w.he, w.tr)] || VOCAB[w.tr] || '').trim() || (w.gloss || '').trim();
        if (!g) errs.push(`song ${n}: ${where} line ${idx} word ${wi} has no gloss`);
      });
      if (authored.length > src.words.length) {
        errs.push(`song ${n}: ${where} line ${idx} has ${authored.length} glosses for ${src.words.length} words`);
      }
    });
  }
  if (expected !== source.lines.length) {
    errs.push(`song ${n}: stanzas cover ${expected} of ${source.lines.length} source lines — the tail of the song would be dropped silently`);
  }

  return errs;
}

// -------------------------------------------------------------------- cli
/* import.meta.url resolves through the D: junction while argv[1] stays on C:,
   so comparing them as strings is always false here and silently kills the CLI.
   realpathSync on both sides is the fix; this bit the tehilim validator first. */
const invokedDirectly = (() => {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] || ''); }
  catch { return false; }
})();

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const list = args.includes('--all') ? REGISTRY.map(s => s.n) : args.filter(a => /^\d+$/.test(a)).map(Number);
  if (!list.length) {
    console.error('usage: node tools/songs-validate.mjs <song number...|--all>');
    process.exit(2);
  }
  let ok = 0, missing = 0;
  for (const n of list) {
    const nn = String(n).padStart(3, '0');
    if (!existsSync(join(ROOT, 'content', 'songs', `${nn}.json`))) {
      console.log(`--   song ${n}: not authored yet`);
      missing++;
      continue;
    }
    const errs = validateSong(n);
    if (!errs.length) { console.log(`ok   song ${n}`); ok++; }
    else for (const e of errs.slice(0, 8)) console.log(`FAIL ${e}`);
  }
  const authored = list.length - missing;
  console.log(`\n${ok}/${authored} authored songs valid, ${missing} not authored yet (of ${list.length} registered)`);
  process.exit(ok < authored ? 1 : 0);
}
