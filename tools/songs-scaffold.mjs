#!/usr/bin/env node
/* songs-scaffold.mjs — fetch the Hebrew of a traditional song and pin it in the repo.
 *
 *   node tools/songs-scaffold.mjs 11          # one song, by its registry number
 *   node tools/songs-scaffold.mjs --all
 *   node tools/songs-scaffold.mjs 11 --stdout
 *
 * Same contract as tools/tehilim-scaffold.mjs, and for the same reason. This
 * project has spent months removing roughly 410 niqqud errors from pages typed
 * by hand, and wrong niqqud looks exactly like right niqqud — there is no way to
 * catch it by reading. So the Hebrew comes from Sefaria, the transliteration from
 * this site's own translit.js, and an author writing a song page never types a
 * Hebrew character. songs-validate.mjs refuses the authored file if they do.
 *
 * WHAT IS DIFFERENT FROM A PSALM, AND WHAT IS NOT. A psalm is verses; a zemer is
 * stanzas of sung lines, and where the stanzas break matters — it is where the
 * tune comes round again. The first version of this file read the empty strings
 * in Sefaria's array as those breaks. Measured against the actual data, that is
 * wrong, and wrong in opposite directions per edition:
 *
 *   Daat Siddur Ashkenaz   one COUPLET per element, a <br> inside it, and an
 *                          empty string between every couplet. Read as stanza
 *                          breaks it gave Baruch Kel Elyon "36 stanzas of 1 line".
 *   The Metsudah siddur    one line per element and no empty strings at all.
 *                          Kol Mekadesh came out as a single stanza of 33 lines.
 *
 * So Sefaria does not encode stanza structure here; the blanks are typesetting.
 * Rather than infer a shape from a formatting artefact, this file emits LINES and
 * nothing else, and grouping them into stanzas is an authoring decision recorded
 * in content/songs/NNN.json — exactly how a psalm author groups word indices into
 * stichs. A guessed stanza break would look like knowledge and be a guess.
 *
 * VERSION PINNING. Asking Sefaria for a text plainly returns whatever it
 * considers default, which for Tanakh today is the JPS Gender-Sensitive Edition
 * under CC-BY-NC, and for the Siddur varies section by section. Every family in
 * data/songs-conventions.json names its versions in preference order; the first
 * one actually available wins and is recorded in the source file with its
 * licence. A family whose whole list misses is an error. Falling back to the
 * default would put a differently licensed text on a public page with nothing to
 * show that anything had changed.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanLine, hasNiqqud, isVariantMarker } from './hebrew-clean.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const require = createRequire(import.meta.url);
const T = require(join(REPO, 'assets', 'translit.js'));

const CONV = JSON.parse(readFileSync(join(REPO, 'data', 'songs-conventions.json'), 'utf8'));
const REGISTRY = JSON.parse(readFileSync(join(REPO, 'content', 'songs', 'index.json'), 'utf8')).songs;

/* NO GLOSS PRE-FILL, and the reason is worth keeping. The repo carries 6857
   verified glosses in data/gloss.json, keyed on fully vocalized forms, and this
   file used to copy them into the pinned source so an author started from a
   verified word instead of a blank one. Read against a real zemer, 23.9% of the
   words came back pre-filled and some of the fills were nonsense IN CONTEXT:

     shorek   in Dror Yikra means a choice vine. The corpus, built from lessons
              about modern Israel, glossed it "Sorek (largest single-train SWRO
              plant in the world)" and put a desalination plant in a 10th-century
              piyyut.
     bamidbar rendered "Numbers", the book, not "in the wilderness".
     chai     rendered "Alive (Aviv Geffen)".
     bavel    rendered "Babylonia (modern Iraq)".

   Every one of those is the right gloss for the lesson it was written for and
   the wrong gloss here. This is the same failure as the consonantal-skeleton
   fallback that once shipped ba-shuk as "in shock": a lookup that cannot see
   context is confidently wrong exactly where context decides. So the author
   writes every gloss, as psalm authors do, and songs-validate.mjs refuses a file
   with an empty cell. Suggestions are still available with --suggest, which
   writes them to tools/reports/ and never into a page.

   The one thing NOT to conclude is that gloss.json is bad. It is verified and
   correct for the lessons it serves. What is bad is reusing it across contexts
   without a human in between. */
let GLOSSARY = {};
try {
  const raw = JSON.parse(readFileSync(join(REPO, 'data', 'gloss.json'), 'utf8'));
  GLOSSARY = raw.v || raw;   // the words live under "v"; the top level is {_note, v}
} catch { /* optional, only used by --suggest */ }
const suggestFor = he => {
  const hit = GLOSSARY[he];
  if (!hit) return '';
  return typeof hit === 'string' ? hit : (hit.en || hit.gloss || hit.fr || '');
};

/* ---- the same Hebrew cleaning the psalm pipeline does, for the same reasons.
   MAM ships full cantillation because it is a reading edition; those marks mean
   nothing to a learner sounding a word out and they break translit.js, which
   expects vowels only. Markup goes first: ketiv/qere arrives as nested spans and
   a character filter walks straight past it, merging the written and the read
   form into one unreadable word. The read form is what you sing, so the qere is
   kept. */
const stripHeMarkup = s => (s || '')
  .replace(/<span class="mam-kq">[\s\S]*?<span class="mam-kq-q">([\s\S]*?)<\/span>[\s\S]*?<\/span>/g, '$1')
  /* <br> is the ONE tag here that carries meaning: Daat puts a whole couplet in
     one element and separates its two sung lines with it. Stripped like the
     others it welds two lines into one, and the page then shows a line nobody
     sings. Turned into a newline BEFORE tags go, so the split below sees it. */
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&thinsp;|&nbsp;/g, ' ')
  .replace(/[\[\]()]/g, '');

/* Cleaning lives in tools/hebrew-clean.mjs, imported above, and is NOT restated
   here. It was restated here once, by copying the character class out of the
   psalm scaffold, and the copy came back with two codepoints transposed: the
   class went from "accents plus meteg" to "accents through meteg" and removed
   every vowel point in the language. Both lines rendered identically. */

/* hasNiqqud and isVariantMarker live in hebrew-clean.mjs, where the self-test
   asserts each of the sixteen vowel points individually. They were defined here
   first, under a comment claiming they were written as unreorderable escapes.
   They were not, and neither is anything else — see that file's header. */

/** A Sefaria element, cleaned, split into the lines it actually holds. */
const linesOf = s => stripHeMarkup(s || '').split('\n').map(cleanLine).filter(Boolean);

const stripTags = s => (s || '')
  .replace(/<sup class="footnote-marker">[\s\S]*?<\/sup>/g, '')
  .replace(/<i class="footnote">[\s\S]*?<\/i>/g, '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&thinsp;|&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Sefaria returns a string for a single-segment ref and an array otherwise. */
const asLines = t => (Array.isArray(t) ? t : [t]).map(x => String(x == null ? '' : x));

async function versionsOf(ref) {
  const r = await fetch('https://www.sefaria.org/api/texts/versions/' + encodeURIComponent(ref));
  if (!r.ok) throw new Error(`sefaria versions ${r.status} for ${ref}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

async function textOf(ref, versionTitle, lang) {
  const url = 'https://www.sefaria.org/api/v3/texts/' + encodeURIComponent(ref)
    + '?version=' + lang + '|' + encodeURIComponent(versionTitle);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`sefaria ${r.status} for ${ref}`);
  const j = await r.json();
  if (j.error) throw new Error(`sefaria: ${j.error}`);
  const v = (j.versions || []).find(x => x.versionTitle === versionTitle);
  if (!v) throw new Error(`${ref}: asked for "${versionTitle}", did not get it`);
  return { text: asLines(v.text), versionTitle: v.versionTitle, license: v.license, heRef: j.heRef || '' };
}

/** First named preference that actually exists, or an error naming all misses. */
function choose(available, preferences, lang, ref) {
  const here = available.filter(v => v.language === lang);
  for (const want of preferences) {
    const hit = here.find(v => v.versionTitle === want);
    if (hit) return hit;
  }
  throw new Error(
    `${ref}: none of the ${lang} versions named in songs-conventions.json is available.\n`
    + `      wanted: ${preferences.join(' | ')}\n`
    + `      has:    ${here.map(v => v.versionTitle).join(' | ') || '(none)'}`
  );
}

async function scaffold(entry) {
  const fam = CONV.families[entry.family];
  if (!fam) throw new Error(`song ${entry.n}: unknown family "${entry.family}"`);

  const available = await versionsOf(entry.ref);

  /* Take the first named version that is BOTH licensed and vocalized. The
     vocalization test is not fussiness: this site exists to teach reading, and a
     zemer with no vowel points teaches nothing here. It is also not theoretical —
     Daat Siddur Ashkenaz serves Ki Eshmera Shabbat entirely unpointed, and
     preferring Daat by name would have shipped 22 lines of bare consonants under
     a transliteration engine that needs vowels to work at all. Refusing and
     moving on is the whole reason the preference is a LIST. */
  const heNotes = [];
  let he = null, heWant = null;
  for (const want of fam.he) {
    const v = available.find(x => x.language === 'he' && x.versionTitle === want);
    if (!v) continue;
    if (!CONV.licences.includes(v.license)) { heNotes.push(`${want}: licence "${v.license}" not in the allowlist`); continue; }
    const got = await textOf(entry.ref, want, 'hebrew');
    const sample = got.text.join(' ');
    if (!hasNiqqud(sample)) { heNotes.push(`${want}: unvocalized`); continue; }
    he = got; heWant = v; break;
  }
  if (!he) {
    throw new Error(
      `song ${entry.n}: no usable Hebrew version for ${entry.ref}\n`
      + `      wanted: ${fam.he.join(' | ')}\n`
      + (heNotes.length ? `      rejected: ${heNotes.join('; ')}\n` : '')
      + `      has: ${available.filter(v => v.language === 'he').map(v => v.versionTitle).join(' | ') || '(none)'}`
    );
  }

  /* English is raw material, not output: the author rewrites every line for a
     learner. It is fetched so they have the sense in front of them, and it is
     allowed to be missing — several zemirot have no free translation, and the
     song still builds. A missing translation is a gap in the author's raw
     material; a wrongly licensed one would be a gap in what we may publish. */
  let en = null;
  try {
    const enWant = choose(available, fam.en, 'en', entry.ref);
    const got = await textOf(entry.ref, enWant.versionTitle, 'english');
    if (CONV.licences.includes(got.license)) en = got;
  } catch { /* no free English for this ref; the author works from the Hebrew */ }

  /* Flat lines, in order. The empty strings are dropped as the typesetting they
     are; see the header for what happened when they were read as stanza breaks. */
  const rawLines = he.text.flatMap(linesOf);
  if (!rawLines.length) throw new Error(`song ${entry.n}: no Hebrew lines returned for ${entry.ref}`);

  /* An edition prints more than the song. Two kinds of intruder appear here, and
     both would otherwise become a line someone tries to sing:

       colophons and rubrics   "author: R. Dunash ben Labrat" closes six of these
                               songs, and Ma Nishtana is preceded by the stage
                               direction "remove the plate, pour the second cup".
       variant readings        nun-alef, nusach acher, marks an alternative word
                               for the one just sung. Left in, the page prints the
                               marker as a word and both readings as if the singer
                               said each of them.

     The colophon test is the absence of vowel points, which is a property of the
     line rather than a list of phrases to match — the editorial matter in these
     editions is simply never pointed, while every sung line always is. That test
     is only safe because the version was already required to be vocalized above;
     applied to an unpointed edition it would delete the entire song, which is
     precisely what it did to Ki Eshmera before the gate existed.

     Nothing is dropped quietly: each removal is returned and printed. A silent
     filter and a broken source look identical from the outside. */
  const dropped = [];
  const lines = [];
  for (const line of rawLines) {
    if (!hasNiqqud(line)) { dropped.push({ why: 'editorial (no vowel points)', line }); continue; }
    const words = line.split(' ');
    const kept = [];
    for (let i = 0; i < words.length; i++) {
      if (isVariantMarker(words[i])) {
        /* Marker plus the ONE word it introduces. Measured on all five instances
           in this corpus, the variant is a single word every time. It is removed
           rather than guessed at, and reported, so a multi-word variant shows up
           as a strange line in the report instead of a plausible wrong lyric. */
        dropped.push({ why: 'variant reading', line, variant: words.slice(i, i + 2).join(' ') });
        i++;
        continue;
      }
      kept.push(words[i]);
    }
    const out = kept.join(' ').replace(/\s+/g, ' ').trim();
    if (out) lines.push(out);
  }
  if (!lines.length) throw new Error(`song ${entry.n}: every line was dropped as editorial for ${entry.ref}`);

  const enLines = en ? en.text.map(stripTags).filter(Boolean) : [];

  let li = 0;
  return {
    song: entry.n,
    slug: entry.slug,
    category: entry.category,
    family: entry.family,
    ref: entry.ref,
    heRef: he.heRef,
    heVersion: he.versionTitle,
    heLicense: he.license,
    enVersion: en ? en.versionTitle : null,
    enLicense: en ? en.license : null,
    /* Kept flat and whole rather than zipped line-to-line: the source English
       almost never segments the way the Hebrew does, and pairing them here would
       invent a correspondence nobody checked. */
    enRaw: enLines,
    droppedByScaffold: dropped,
    lines: lines.map(text => {
      const words = text.split(' ').filter(Boolean);
      return {
        i: li++,
        he: text,
        words: words.map((w, wi) => ({
          i: wi,
          he: w,
          tr: T.transliterate(w),
          gloss: ''         // authors write every gloss; see the header on why nothing is pre-filled
        }))
      };
    })
  };
}

// -------------------------------------------------------------------- cli
const args = process.argv.slice(2);
const toStdout = args.includes('--stdout');
const wantSuggestions = args.includes('--suggest');
const wanted = args.includes('--all')
  ? REGISTRY.map(s => s.n)
  : args.filter(a => /^\d+$/.test(a)).map(Number);

if (!wanted.length) {
  console.error('usage: node tools/songs-scaffold.mjs <song number...|--all> [--stdout]');
  process.exit(2);
}

const outDir = join(REPO, 'content', 'songs', 'source');
mkdirSync(outDir, { recursive: true });

let ok = 0, words = 0;
const allDropped = [];
const suggestions = [];

for (const n of wanted) {
  const entry = REGISTRY.find(s => s.n === n);
  if (!entry) { console.log(`FAIL song ${n}: not in content/songs/index.json`); continue; }
  try {
    const data = await scaffold(entry);
    const nn = String(n).padStart(3, '0');
    const ws = data.lines.flatMap(l => l.words);
    words += ws.length;
    for (const d of data.droppedByScaffold) allDropped.push({ song: nn, slug: entry.slug, ...d });
    if (wantSuggestions) {
      for (const w of ws) { const g = suggestFor(w.he); if (g) suggestions.push({ song: nn, he: w.he, tr: w.tr, suggestion: g }); }
    }
    if (toStdout) { console.log(JSON.stringify(data, null, 2)); ok++; continue; }
    writeFileSync(join(outDir, `${nn}.json`), JSON.stringify(data, null, 2) + '\n', 'utf8');
    const drops = data.droppedByScaffold.length ? `  (-${data.droppedByScaffold.length} editorial)` : '';
    console.log(
      `ok   ${nn} ${entry.slug.padEnd(24)} ${String(data.lines.length).padStart(3)} lines, `
      + `${String(ws.length).padStart(4)} words  [${data.heVersion}, ${data.heLicense}]${drops}`
    );
    ok++;
  } catch (e) {
    console.log(`FAIL song ${n} (${entry.slug}): ${e.message}`);
  }
}

if (!toStdout) {
  console.log(`\n${ok}/${wanted.length} scaffolded, ${words} words for the author to gloss`);

  /* Everything the scaffold removed, listed. A filter that discards quietly and
     a source that is missing lines look identical from here, and the only cheap
     way to keep them distinguishable is to print what went. */
  if (allDropped.length) {
    console.log(`\n${allDropped.length} lines or fragments dropped as editorial matter:`);
    for (const d of allDropped) {
      console.log(`   ${d.song} ${d.slug.padEnd(22)} ${d.why.padEnd(28)} ${d.variant || d.line}`);
    }
  }

  if (wantSuggestions) {
    mkdirSync(join(REPO, 'tools', 'reports'), { recursive: true });
    const p = join(REPO, 'tools', 'reports', 'songs-gloss-suggestions.json');
    writeFileSync(p, JSON.stringify(suggestions, null, 2) + '\n', 'utf8');
    console.log(
      `\n${suggestions.length} gloss suggestions written to ${p}.`
      + `\nThey are SUGGESTIONS and several are wrong in this context — read the header of this file before using one.`
    );
  }
}
process.exit(ok < wanted.length ? 1 : 0);
