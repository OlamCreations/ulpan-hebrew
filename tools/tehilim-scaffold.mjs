#!/usr/bin/env node
// Scaffold the mechanical half of a Tehilim page, so that nothing an agent writes is Hebrew.
//
//   node tools/tehilim-scaffold.mjs 11 12 13
//   node tools/tehilim-scaffold.mjs 11 --stdout
//
// Writes tools/reports/tehilim-NNN.data.json: the verses, and inside each verse every word with
// its vocalized Hebrew, its transliteration and a literal English rendering of the verse.
//
// WHY THIS EXISTS. A Tehilim page is ~2400 lines, of which ~1150 are the shared chord library and
// only ~334 are actually authored. Everything else is mechanical — the masoretic text, the split
// into words, the transliteration of each one — and mechanical is exactly what a language model
// produces plausibly and wrongly. This project has spent months removing roughly 410 niqqud errors
// and still carries several hundred; generating ten more psalms by hand would undo that work at
// scale and invisibly, because wrong niqqud looks exactly like right niqqud.
//
// So: the text comes from Sefaria (Miqra According to the Masorah, CC-BY-SA, from the Aleppo
// Codex), the transliteration from the app's own translit.js — measured 139/139 on syllables and
// stress — and an agent authoring a psalm only ever picks WHERE to break a verse into poetic lines
// and writes the commentary around it. It never types a Hebrew character.

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const require = createRequire(import.meta.url);
const T = require(join(REPO, 'assets', 'translit.js'));

const SEFARIA = 'https://www.sefaria.org/api/texts/Psalms.';

/* The pages carry niqqud and nothing else. MAM ships the full cantillation (te'amim) because it is
   a reading edition; those marks are meaningless to a learner sounding the word out, and they break
   translit.js, which expects vowels only. Removed here rather than in translit.js: the transliterator
   should keep receiving what the rest of the app sends it.
   U+0591-U+05AF are the accents; U+05BD (meteg) and U+05C0/U+05C3 (paseq, sof pasuk) go too — the
   existing pages show none of them (compare אַשְׁרֵי הָאִישׁ in tehilim-001). Maqaf becomes a space,
   which is what the existing pages do (עַל פַּלְגֵי, not עַל־פַּלְגֵי): each side is its own word cell. */
// MAM also carries MARKUP inside the Hebrew, which a character-level filter walks straight past:
// a paseq as `&thinsp;<b>׀</b>`, and ketiv/qere as a `mam-kq` span holding both the written form
// (unvocalized) and the read form (vocalized). Left in, they reach the transliterator, which
// obligingly romanizes the HTML. The read form is what a learner sounds out, so the qere is kept
// and the ketiv dropped — and that has to happen BEFORE tags are stripped, or the two forms merge
// into one unreadable word.
const stripHeMarkup = s => (s || '')
  .replace(/<span class="mam-kq">[\s\S]*?<span class="mam-kq-q">([\s\S]*?)<\/span>[\s\S]*?<\/span>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&thinsp;|&nbsp;/g, ' ')
  .replace(/[\[\]()]/g, '');

const stripAccents = s => stripHeMarkup(s || '')
  .replace(/[֑-ֽ֯׀׃׆]/g, '')
  .replace(/־/g, ' ')
  .replace(/[ -‏]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// Sefaria's English is JPS with poetry markup; keep the line structure as a hint for where the
// Hebrew colon breaks fall, but strip the tags before anything reaches a page.
const stripTags = s => (s || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&thinsp;/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\n{2,}/g, '\n')
  .split('\n').map(x => x.trim()).filter(Boolean);

async function fetchPsalm(n) {
  const r = await fetch(SEFARIA + n + '?context=0');
  if (!r.ok) throw new Error('sefaria ' + r.status + ' for psalm ' + n);
  const j = await r.json();
  const he = Array.isArray(j.he) ? j.he : [];
  const en = Array.isArray(j.text) ? j.text : [];
  if (!he.length) throw new Error('no Hebrew returned for psalm ' + n);
  return {
    psalm: n,
    heVersion: j.versionTitle || '',
    heLicense: j.license || '',
    enVersion: j.versionTitleInHebrew || j.versionTitle || '',
    verses: he.map((v, i) => {
      const clean = stripAccents(v);
      const words = clean.split(' ').filter(Boolean);
      return {
        n: i + 1,
        he: clean,
        // Literal English straight from the source, split on its own poetic line breaks. This is
        // the raw material for the stich translation, not the final wording.
        enLines: stripTags(en[i] || ''),
        words: words.map((w, wi) => ({
          i: wi,
          he: w,
          tr: T.transliterate(w),
          gloss: ''      // filled by the authoring pass; never guessed here
        }))
      };
    })
  };
}

const args = process.argv.slice(2);
const toStdout = args.includes('--stdout');
const psalms = args.filter(a => /^\d+$/.test(a)).map(Number);
if (!psalms.length) {
  console.error('usage: node tools/tehilim-scaffold.mjs <psalm number...> [--stdout]');
  process.exit(2);
}

const outDir = join(REPO, 'tools', 'reports');
mkdirSync(outDir, { recursive: true });

for (const n of psalms) {
  const data = await fetchPsalm(n);
  const nn = String(n).padStart(3, '0');
  const words = data.verses.reduce((a, v) => a + v.words.length, 0);
  if (toStdout) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    const p = join(outDir, `tehilim-${nn}.data.json`);
    writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`psalm ${n}: ${data.verses.length} verses, ${words} words  ->  ${p}`);
    console.log(`   v1: ${data.verses[0].he}`);
    console.log(`       ${data.verses[0].words.map(w => w.tr).join(' ')}`);
  }
}
