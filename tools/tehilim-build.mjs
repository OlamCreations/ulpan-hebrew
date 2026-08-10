/* tehilim-build.mjs — turn a scaffold plus an authored file into a psalm page.
 *
 *   node tools/tehilim-scaffold.mjs 23      # Hebrew + transliteration, from Sefaria
 *   <author content/tehilim/023.json>       # English only, agents or hand
 *   node tools/tehilim-build.mjs 23         # -> liturgy/tehilim-023-en.html
 *
 * The split is the whole point. Every Hebrew character on the finished page comes
 * from the Masoretic text and every transliteration from assets/translit.js, which
 * is measured at 139/139 on syllables and stress. The authored file is English
 * only and tools/tehilim-validate.mjs refuses it otherwise, so a page cannot be
 * wrong in Hebrew no matter who or what wrote the commentary.
 *
 * Authors still need to quote Hebrew in their prose. They do it by reference:
 * {{2.3}} means verse 2, word 3, and is expanded here into the real vocalized
 * word with its transliteration. An index that does not exist is an error, not a
 * blank, which is the difference between a citation and a guess.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { validatePsalm } from './tehilim-validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);

const CONV = JSON.parse(readFileSync(join(ROOT, 'data', 'tehilim-conventions.json'), 'utf8'));
const FORCE = process.argv.includes('--force');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** translit.js emits the stressed syllable in capitals; the pages show it bold. */
function boldStress(tr) {
  return esc(tr).replace(/(^|-)([^-\s]*[A-Z][^-\s]*)/g, (m, sep, syl) => sep + '<b>' + syl + '</b>');
}

/** The reading a learner should say, which is not always the spelling. */
function readingOf(he, tr) {
  return CONV.readAs[he] || tr;
}

function heNumeral(heRef) {
  // Sefaria's own "תהילים כ״ג" -> "כ״ג". Never computed here.
  const parts = String(heRef || '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

function expandRefs(text, data, psalm) {
  return String(text).replace(/\{\{(\d+)\.(\d+)\}\}/g, (m, v, w) => {
    const verse = data.verses.find(x => x.n === Number(v));
    const word = verse && verse.words[Number(w)];
    if (!word) throw new Error(`psalm ${psalm}: reference ${m} points at no word`);
    return `<strong>${esc(word.he)}</strong> (${esc(readingOf(word.he, word.tr).replace(/([A-Z])/g, c => c.toLowerCase()))}, v.${v})`;
  });
}

export function buildPsalm(n) {
  const nn = String(n).padStart(3, '0');
  const data = JSON.parse(readFileSync(join(ROOT, 'content', 'tehilim', 'source', `${nn}.json`), 'utf8'));
  const content = JSON.parse(readFileSync(join(ROOT, 'content', 'tehilim', `${nn}.json`), 'utf8'));

  const errs = validatePsalm(n);
  if (errs.length && !FORCE) throw new Error(`psalm ${n} did not validate:\n  ` + errs.slice(0, 6).join('\n  '));

  const firstWords = data.verses[0].words.slice(0, CONV.page.titleWordCount).map(w => w.he).join(' ');
  const heTitle = `${CONV.page.tehilimWord} ${heNumeral(data.heRef)} · ${firstWords}`;

  // ---- verses
  const verseHtml = data.verses.map(dv => {
    const cv = content.verses.find(v => v.n === dv.n);
    const lines = cv.stichs.map(st => dv.words.slice(st.from, st.to + 1).map(w => w.he).join(' '));
    const full = lines.map(esc).join('<br>\n  ');

    const stichs = cv.stichs.map(st => {
      const words = dv.words.slice(st.from, st.to + 1).map((w, k) => {
        const gloss = CONV.defaultGloss[w.he] || cv.glosses[st.from + k];
        return `<div class="word"><div class="he">${esc(w.he)}</div>`
          + `<div class="tr">${boldStress(readingOf(w.he, w.tr))}</div>`
          + `<div class="fr">${esc(gloss)}</div></div>`;
      }).join('\n      ');
      return `  <div class="stich">\n    <div class="stich-words">\n      ${words}\n    </div>\n`
        + `    <div class="stich-translation">${esc(st.en)}</div>\n  </div>`;
    }).join('\n\n');

    return `<!-- VERSE ${dv.n} -->\n<div class="verse">\n  <span class="verse-num">${dv.n}</span>\n`
      + `  <div class="verse-full">${full}</div>\n\n${stichs}\n\n`
      + `  <div class="verse-summary">${esc(cv.summary)}</div>\n</div>`;
  }).join('\n\n');

  // ---- pardes
  const pardes = content.pardes.map(p => {
    const heading = CONV.pardesLevels[p.level];
    if (!heading) throw new Error(`psalm ${n}: unknown pardes level "${p.level}"`);
    return `  <div class="pardes-level">\n    <h4>${esc(heading)}</h4>\n    <p>${expandRefs(p.body, data, n)}</p>\n  </div>`;
  }).join('\n\n');

  const template = readFileSync(join(ROOT, 'tools', 'fixtures', 'tehilim-page.html'), 'utf8');

  const html = template
    .replaceAll('{{CSS_VERSION}}', CONV.page.cssVersion)
    .replaceAll('{{N}}', String(n))
    .replaceAll('{{NN}}', nn)
    .replaceAll('{{HE_TITLE}}', heTitle)
    .replaceAll('{{HE_FIRST_WORDS}}', esc(firstWords))
    .replaceAll('{{TITLE_EN}}', esc(content.titleEn))
    .replaceAll('{{INTRO}}', expandRefs(content.intro, data, n))
    .replaceAll('{{VERSES}}', verseHtml)
    .replaceAll('{{PARDES}}', pardes)
    .replaceAll('{{PROGRESSION}}', content.progression || '| Am Am | Em Em | Am Dm | Em Am |')
    .replaceAll('{{TEMPO}}', String(content.tempo || 70))
    .replaceAll('{{ATTR_HE}}', esc(CONV.attribution.hebrew))
    .replaceAll('{{ATTR_EN}}', esc(CONV.attribution.english))
    .replaceAll('{{ATTR_TR}}', esc(CONV.attribution.transliteration));

  // A template hole that stays unfilled, or a field read off the wrong key, does
  // not throw: it writes the word "undefined" into the page and ships. The first
  // build of psalm 23 put it in all four PARDES headings and still exited zero.
  const leak = html.match(/\{\{[A-Z_]+\}\}|>undefined<|\bNaN\b|>null</);
  if (leak) throw new Error(`psalm ${n}: template produced ${leak[0]} — refusing to write`);
  return html;
}

// -------------------------------------------------------------- cli
const args = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
if (args.length) {
  let ok = 0;
  for (const n of args) {
    const nn = String(n).padStart(3, '0');
    try {
      const html = buildPsalm(n);
      const out = join(ROOT, 'liturgy', `tehilim-${nn}-en.html`);
      writeFileSync(out, html, 'utf8');
      console.log(`ok   psalm ${n} -> liturgy/tehilim-${nn}-en.html (${html.split('\n').length} lines)`);
      ok++;
    } catch (e) {
      console.log(`FAIL psalm ${n}: ${e.message.split('\n')[0]}`);
    }
  }
  console.log(`\n${ok}/${args.length} built`);
  if (ok < args.length) process.exit(1);
}
