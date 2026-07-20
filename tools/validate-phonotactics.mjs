#!/usr/bin/env node
// validate-phonotactics.mjs — find niqqud errors that are DECIDABLE FROM THE STRING.
//
// Every previous approach needed an oracle, and every oracle lied:
//   - translit.js vs the hand romanization -> 44.6% flagged, nearly all conventions
//     (New York, yom kippur, academic qeltu). Would have transliterated Manhattan.
//   - Dicta's top reading -> 30% flagged, ~2/3 proper nouns and loanwords it cannot know
//     (Vichy -> "and Yishai", Optalgin, hip-hop).
//   - Dicta's full option list -> 47% precision even after adjudication. Half its flags are
//     the lessons being right.
//
// The rules below need no oracle at all. They are laws of Hebrew orthography: a string that
// violates them is wrong no matter what word it is, native or borrowed, name or noun. That is
// what makes them safe to sweep — a proper noun cannot rescue וְ before a shva.
//
// THE RULES ARE ONLY WORTH ANYTHING IF THEY DO NOT FIRE ON CORRECT HEBREW. So `--selftest`
// runs them against phrasebook.json (118 hand-authored, verified entries) and expressions.json
// (129 curated). Those files are known-good: every hit there is a FALSE POSITIVE and condemns
// the rule, not the data. A rule that cannot pass that gate does not ship.
//
// Usage:
//   node tools/validate-phonotactics.mjs --selftest     # rules vs known-good corpora
//   node tools/validate-phonotactics.mjs                # report violations in the lessons
//   node tools/validate-phonotactics.mjs --fix          # apply (only after --selftest is clean)

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { ROOT, pages, lessonPages, dataPath, reportPath } from './paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const SHEVA = 'ְ', HATAF_SEGOL = 'ֱ', HATAF_PATAH = 'ֲ', HATAF_QAMATS = 'ֳ';
const HIRIQ = 'ִ', TSERE = 'ֵ', SEGOL = 'ֶ', PATAH = 'ַ', QAMATS = 'ָ';
const HOLAM = 'ֹ', QUBUTS = 'ֻ', DAGESH = 'ּ';
const VAV = 'ו', YOD = 'י', HE = 'ה', HET = 'ח';
const HATAFS = [HATAF_SEGOL, HATAF_PATAH, HATAF_QAMATS];

// A "letter cell" = a consonant plus the marks that hang off it.
function cells(word) {
  const out = [];
  for (const ch of word) {
    if (ch >= 'א' && ch <= 'ת') out.push({ c: ch, m: '' });
    else if (ch >= '֑' && ch <= 'ׇ') { if (out.length) out[out.length - 1].m += ch; }
    else out.push({ c: ch, m: '', other: true });
  }
  return out;
}
const render = (cs) => cs.map((x) => x.c + x.m).join('');
const has = (cell, mark) => cell && cell.m.includes(mark);

/* RULE 1 — the conjunction וְ cannot stand before a shva or a chataf.
 * Before a shva it becomes וּ (shuruk); before a chataf it takes that chataf's full vowel.
 * This is not a preference, it is not register, and no loanword escapes it: וְקְצָת and
 * וְאֲנִי are simply not writable. Zero-risk to sweep. */
function rule1(cs) {
  if (cs.length < 2) return null;
  if (cs[0].c !== VAV || !has(cs[0], SHEVA) || has(cs[0], DAGESH)) return null;
  const next = cs[1];
  if (!next || next.other) return null;
  if (has(next, SHEVA)) {
    // Compound error: וְבְּתֵיאָבוֹן is wrong twice over — the vav AND the dagesh on a bgdkpt
    // that should spirantize after the shuruk (Dicta: וּבְתֵיאָבוֹן). Fixing only the vav would
    // ship וּבְּ..., still wrong. Abstain and leave it for review rather than half-fix it.
    if (has(next, DAGESH)) return null;
    const fixed = [{ c: VAV, m: DAGESH }, ...cs.slice(1)];
    return { rule: 'vav-conjunction before shva must be shuruk (וּ)', fix: render(fixed) };
  }
  for (const [hataf, full] of [[HATAF_PATAH, PATAH], [HATAF_SEGOL, SEGOL], [HATAF_QAMATS, QAMATS]]) {
    if (has(next, hataf)) {
      const fixed = [{ c: VAV, m: full }, ...cs.slice(1)];
      return { rule: 'vav-conjunction before chataf takes its full vowel', fix: render(fixed) };
    }
  }
  return null;
}

/* RULE 2 — the definite article before ח or ה carrying qamats is הֶ, not הַ.
 * הַחָדָשׁ is not a variant of הֶחָדָשׁ, it is a misspelling. (ע takes הָ and is excluded;
 * a guttural with any other vowel keeps הַ, so the qamats test is what makes this safe.) */
function rule3(cs) {
  if (cs.length < 3) return null;
  if (cs[0].c !== HE || !has(cs[0], PATAH) || has(cs[0], DAGESH)) return null;
  const g = cs[1];
  if (!g || (g.c !== HET && g.c !== HE)) return null;
  if (!has(g, QAMATS) || has(g, DAGESH)) return null;
  // Only qamats GADOL ("a") triggers הֶ. A qamats QATAN ("o") does not: הַחָדְשִׁי is
  // ha-CHODshi, and is correct as shipped — Dicta confirms it. The two are the same code
  // point, so the syllable decides: a qamats closed by a shva is qatan. Without this the rule
  // "corrects" correct Hebrew, which is how it got caught in the Dicta cross-check.
  const after = cs[2];
  if (after && has(after, SHEVA) && !has(after, DAGESH)) return null;
  const fixed = [{ c: HE, m: SEGOL }, ...cs.slice(1)];
  return { rule: 'definite article before ח/ה + qamats gadol is הֶ', fix: render(fixed) };
}

/* RULE 3 — a yod between hiriq and a shuruk/holam mater carries dagesh chazak:
 * מִיוּן -> מִיּוּן, דִּיוּר -> דִּיּוּר, עִבְרִיוֹת -> עִבְרִיּוֹת. Without it the yod reads
 * as a mater and the syllable collapses ("miun" for miyun). */
function rule4(cs) {
  for (let i = 1; i < cs.length - 1; i++) {
    const prev = cs[i - 1], y = cs[i], next = cs[i + 1];
    if (y.c !== YOD || y.m || next.c !== VAV) continue;          // bare yod followed by vav
    if (!has(prev, HIRIQ)) continue;                              // hiriq before it
    if (!(has(next, DAGESH) || has(next, HOLAM))) continue;       // shuruk or holam male after
    const fixed = cs.slice();
    fixed[i] = { c: YOD, m: DAGESH };
    return { rule: 'yod between hiriq and shuruk/holam takes dagesh chazak', fix: render(fixed) };
  }
  return null;
}

const RULES = [rule1, rule3, rule4];

function check(word) {
  const cs = cells(word);
  for (const r of RULES) { const hit = r(cs); if (hit) return hit; }
  return null;
}

// ---- corpora -------------------------------------------------------------
async function lessonRows() {
  const files = await lessonPages();
  const rows = [];
  for (const f of files) {
    const s = await readFile(join(ROOT, f), 'utf8');
    const re = /(?:const|var|let)\s+([A-Z_]{2,})\s*=\s*(\[[\s\S]*?\]);/g;
    let m;
    while ((m = re.exec(s))) {
      let arr; try { arr = vm.runInNewContext(`(${m[2]})`); } catch { continue; }
      if (!Array.isArray(arr)) continue;
      for (const x of arr) if (x && typeof x.he === 'string') rows.push({ f, he: x.he });
    }
  }
  return rows;
}

const words = (he) => he.split(/\s+/).map((w) => w.replace(/[?!.,;:'"״׳()־-]/g, '')).filter(Boolean);

const args = process.argv.slice(2);

if (args.includes('--selftest')) {
  // Known-good by construction: both files are hand-authored and verified. Any hit is a rule bug.
  const pb = JSON.parse(await readFile(dataPath('phrasebook.json'), 'utf8')).phrases.map((p) => p.he);
  const ex = JSON.parse(await readFile(dataPath('expressions.json'), 'utf8')).expressions.map((e) => e.he);
  let bad = 0, n = 0;
  for (const [label, corpus] of [['phrasebook.json', pb], ['expressions.json', ex]]) {
    let hits = 0;
    for (const he of corpus) for (const w of words(he)) {
      n++;
      const v = check(w);
      if (v) { hits++; bad++; console.log(`  FALSE POSITIVE [${label}] ${w} -> ${v.fix}  (${v.rule})`); }
    }
    console.log(`${label}: ${hits} false positives`);
  }
  console.log(`\nchecked ${n} words of known-good Hebrew.`);
  console.log(bad ? `\n✗ ${bad} false positives — a rule is wrong. Do NOT sweep.`
                  : '\n✓ zero false positives on verified Hebrew. Rules are safe to sweep.');
  process.exit(bad ? 1 : 0);
}

const rows = await lessonRows();
const found = new Map();
for (const r of rows) {
  for (const w of words(r.he)) {
    const v = check(w);
    if (!v) continue;
    if (!found.has(w)) found.set(w, { he: w, fix: v.fix, rule: v.rule, files: new Set() });
    found.get(w).files.add(r.f);
  }
}
const list = [...found.values()].map((x) => ({ ...x, files: [...x.files] }))
  .sort((a, b) => b.files.length - a.files.length);

console.log(`lesson rows scanned: ${rows.length}`);
console.log(`distinct violations : ${list.length}\n`);
const byRule = {};
list.forEach((v) => { byRule[v.rule] = (byRule[v.rule] || 0) + 1; });
Object.entries(byRule).forEach(([r, n]) => console.log(`  ${n
  .toString().padStart(4)}  ${r}`));
console.log('\ntop violations:');
list.slice(0, 20).forEach((v) => console.log(`   ${v.he.padEnd(16)} -> ${v.fix.padEnd(16)} (${v.files.length} files)`));

if (args.includes('--fix')) {
  const HEB = /[֐-׿]/;
  let applied = 0;
  const files = await pages('allPages');
  for (const f of files) {
    let s = await readFile(join(ROOT, f), 'utf8');
    const orig = s;
    for (const v of list) {
      // Word-boundary aware: never rewrite a string glued inside a longer Hebrew word.
      let out = '', last = 0, i = 0;
      while ((i = s.indexOf(v.he, last)) >= 0) {
        const b = s[i - 1] || '', a = s.slice(i + v.he.length, i + v.he.length + 1);
        out += s.slice(last, i);
        if (HEB.test(b) || HEB.test(a)) out += v.he; else { out += v.fix; applied++; }
        last = i + v.he.length;
      }
      s = out + s.slice(last);
    }
    if (s !== orig) await writeFile(join(ROOT, f), s, 'utf8');
  }
  console.log(`\napplied ${applied} replacements.`);
} else {
  await writeFile(reportPath('phonotactic-violations.json'), JSON.stringify({ count: list.length, violations: list }, null, 1) + '\n');
  console.log('\n-> tools/reports/phonotactic-violations.json  (run with --fix to apply, after --selftest)');
}
