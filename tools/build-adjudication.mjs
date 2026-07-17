#!/usr/bin/env node
// Turn the raw niqqud flags into an ADJUDICABLE packet.
//
// The audit flags words; words alone are not reviewable. כֵן looked like 52 errors and was 52
// correct spellings — לָכֵן, שׁוֹכֵן, אַחֲרֵי כֵן — because the extraction had stripped the context
// that made them right. So every candidate here carries the phrases it actually appears in, the
// lesson's own transliteration (the author's intent), whether it is ever embedded in a longer
// word, and what translit.js would say before vs after. That is the minimum a human (or Fable)
// needs to rule on it without guessing.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const src = await readFile(join(ROOT, 'translit.js'), 'utf8');
const win = {}; new Function('window', src)(win); const T = win.Translit;

const report = JSON.parse(await readFile(join(ROOT, 'lesson-niqqud-report.json'), 'utf8'));
const HEB = /[֐-׿]/;
const holamFold = (s) => (s || '').replace(/([א-ת])([֑-ׇ]*)ֹ([֑-ׇ]*)ו(?![ֹּ])/g, (_, c, a, b) => c + a + b + 'וֹ');
const shurukFold = (s) => (s || '').replace(/([א-ת])([֑-ׇ]*)ֻ([֑-ׇ]*)ו(?![ֹּ])/g, (_, c, a, b) => c + a + b + 'וּ');
const N = (s) => shurukFold(holamFold((s || '').normalize('NFC').replace(/[ֽ|]/g, ''))).normalize('NFC');

// Collect every {he, translit, fr} row so a flagged word can be shown in situ.
const rows = [];
const files = (await readdir(ROOT)).filter((f) => /^\d+-.*\.html$/.test(f));
for (const f of files) {
  const s = await readFile(join(ROOT, f), 'utf8');
  const re = /(?:const|var|let)\s+([A-Z_]{2,})\s*=\s*(\[[\s\S]*?\]);/g;
  let m;
  while ((m = re.exec(s))) {
    let arr; try { arr = vm.runInNewContext(`(${m[2]})`); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    for (const x of arr) if (x && typeof x.he === 'string' && HEB.test(x.he)) rows.push({ f, he: x.he, tr: x.translit || '', fr: x.fr || '' });
  }
}

const raw = await Promise.all(files.map(async (f) => [f, await readFile(join(ROOT, f), 'utf8')]));

const out = [];
for (const flag of report.flagged) {
  if (N(flag.he) === N(flag.suggest)) continue;                  // encoding artifact
  const before = T.transliterate(flag.he), after = T.transliterate(flag.suggest);
  if (before === after) continue;                                // inaudible notation
  // Is it ever glued inside a longer Hebrew word? That is what made כֵן a false alarm.
  let embedded = 0, standalone = 0;
  for (const [, s] of raw) {
    let i = 0;
    while ((i = s.indexOf(flag.he, i)) >= 0) {
      const b = s[i - 1] || '', a = s.slice(i + flag.he.length, i + flag.he.length + 1);
      if (HEB.test(b) || HEB.test(a)) embedded++; else standalone++;
      i += flag.he.length;
    }
  }
  const ctx = rows.filter((r) => r.he.includes(flag.he)).slice(0, 3)
    .map((r) => ({ file: r.f.replace('.html', ''), he: r.he, translit: r.tr, en: r.fr }));
  out.push({ he: flag.he, dicta_suggests: flag.suggest, reads_now: before, would_read: after,
    files: flag.files.length, standalone, embedded, nOptions: flag.nOptions, context: ctx });
}
out.sort((a, b) => b.files - a.files || b.standalone - a.standalone);
const top = out.slice(0, +(process.argv[2] || 120));
await writeFile(join(ROOT, 'adjudication-batch.json'), JSON.stringify({
  _note: 'Candidate lesson niqqud errors WITH context, for human/Fable adjudication. reads_now = what translit.js says with the shipped niqqud; would_read = with Dicta\'s. embedded>0 means the string also occurs glued inside longer words, where the shipped form may be CORRECT (see כֵן / לָכֵן). Dicta is an oracle, not truth: it mangles proper nouns (Vichy -> veyishai) and loanwords.',
  total_audible: out.length, in_this_batch: top.length, candidates: top,
}, null, 1) + '\n', 'utf8');
console.log(`audible candidates: ${out.length} · wrote top ${top.length} -> adjudication-batch.json`);
console.log(`  never embedded (cleaner signal): ${top.filter((x) => !x.embedded).length}/${top.length}`);
