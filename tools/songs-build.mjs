/* songs-build.mjs — turn a scaffold plus an authored file into a song page.
 *
 *   node tools/songs-scaffold.mjs 17        # Hebrew + transliteration, from Sefaria
 *   <author content/songs/017.json>         # English only
 *   node tools/songs-build.mjs 17           # -> liturgy/songs-017-dror-yikra-en.html
 *
 * The split is the whole point, and it is the same one the psalm pipeline uses:
 * every Hebrew character on the finished page comes from a pinned edition and
 * every transliteration from assets/translit.js, measured at 139/139 on syllables
 * and stress. The authored file is English only and songs-validate.mjs refuses it
 * otherwise, so a page cannot be wrong in Hebrew no matter who wrote the prose.
 *
 * Authors quote Hebrew by reference, never by typing: {{3.2}} means source line
 * 3, word 2, and expands to the real vocalized word with its reading. An index
 * that does not exist is an error rather than a blank, which is the difference
 * between a citation and a guess.
 */
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateSong } from './songs-validate.mjs';
import { deriveKey, chordsOf } from './chord-key.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const CONV = JSON.parse(readFileSync(join(ROOT, 'data', 'songs-conventions.json'), 'utf8'));
const REGISTRY = JSON.parse(readFileSync(join(ROOT, 'content', 'songs', 'index.json'), 'utf8')).songs;
const FORCE = process.argv.includes('--force');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** translit.js emits the stressed syllable in capitals; the pages show it bold. */
const boldStress = tr => esc(tr).replace(/(^|-)([^-\s]*[A-Z][^-\s]*)/g, (m, sep, syl) => sep + '<b>' + syl + '</b>');

/* The reading a learner should say, which is not always the spelling. Same
   mechanism as the psalm builder, and it exists here for the same word: the
   Masoretic text spells Jerusalem with no yod before the final mem and it is
   read as though the yod were there. translit.js reads the spelling, correctly,
   and produced ye-ru-sha-LAm. Keyed on the exact vocalized string. */
const readingOf = (he, tr) => (CONV.readAs && CONV.readAs[he]) || tr;

/** Chord symbols become hoverable chips; bar lines and separators stay text. */
function chordLineHtml(spec) {
  return String(spec).split(/(\s+)/).map(tok => {
    const t = tok.trim();
    if (!t) return tok;
    if (t === '|' || t === ',' || t === '-') return `<span class="sep">${esc(t)}</span>`;
    return `<span class="chord" data-chord="${esc(t)}">${esc(t)}</span>`;
  }).join('');
}

export function buildSong(n) {
  const nn = String(n).padStart(3, '0');
  const entry = REGISTRY.find(s => s.n === n);
  if (!entry) throw new Error(`song ${n}: not in content/songs/index.json`);

  const source = JSON.parse(readFileSync(join(ROOT, 'content', 'songs', 'source', `${nn}.json`), 'utf8'));
  const content = JSON.parse(readFileSync(join(ROOT, 'content', 'songs', `${nn}.json`), 'utf8'));

  const errs = validateSong(n);
  if (errs.length && !FORCE) throw new Error(`song ${n} did not validate:\n  ` + errs.slice(0, 6).join('\n  '));

  /* Escape first, then expand: a reference holds nothing HTML-special, so the
     order is safe and it lets every authored string take the same path. The
     psalm builder expanded only two fields for a while and shipped a literal
     "{{3.7}}" inside a live verse summary. */
  const expand = text => esc(String(text)).replace(/\{\{(\d+)\.(\d+)\}\}/g, (m, li, wi) => {
    const line = source.lines[Number(li)];
    const word = line && line.words[Number(wi)];
    if (!word) throw new Error(`song ${n}: reference ${m} points at no word`);
    return `<strong>${word.he}</strong> (${readingOf(word.he, word.tr).toLowerCase()})`;
  });

  const firstWords = source.lines[0].words
    .slice(0, CONV.page.titleWordCount)
    .map(w => w.he)
    .join(' ');

  // ---- stanzas
  const stanzaHtml = content.stanzas.map((st, si) => {
    const num = st.n ?? si + 1;
    const label = st.label ? `${num} · ${st.label}` : String(num);

    const srcLines = source.lines.slice(st.from, st.to + 1);
    const full = srcLines.map(l => esc(l.he)).join('<br>\n  ');

    const stichs = srcLines.map((src, k) => {
      const ln = st.lines[k];
      const authored = Array.isArray(ln.glosses) ? ln.glosses : [];
      const words = src.words.map((w, wi) => {
        const gloss = (authored[wi] || '').trim() || (w.gloss || '').trim();
        return `<div class="word"><div class="he">${esc(w.he)}</div>`
          + `<div class="tr">${boldStress(readingOf(w.he, w.tr))}</div>`
          + `<div class="fr">${esc(gloss)}</div></div>`;
      }).join('\n      ');

      const chords = ln.chords
        ? `\n    <div class="stich-chords">${chordLineHtml(ln.chords)}</div>`
        : '';

      return `  <div class="stich">\n    <div class="stich-words">\n      ${words}\n    </div>${chords}\n`
        + `    <div class="stich-translation">${expand(ln.en)}</div>\n  </div>`;
    }).join('\n\n');

    const summary = st.summary
      ? `\n\n  <div class="verse-summary">${expand(st.summary)}</div>`
      : '';

    return `<!-- STANZA ${num} -->\n<div class="verse">\n  <span class="verse-num">${esc(label)}</span>\n`
      + `  <div class="verse-full">${full}</div>\n\n${stichs}${summary}\n</div>`;
  }).join('\n\n');

  const tips = content.chantTips.map(t => `    <li>${expand(t)}</li>`).join('\n');
  const about = content.about.map(s =>
    `  <div class="pardes-level">\n    <h4>${esc(s.h)}</h4>\n    <p>${expand(s.body)}</p>\n  </div>`
  ).join('\n\n');

  const progression = content.progression;
  const key = deriveKey(progression, `song ${n}`);
  const uniq = [...new Set(chordsOf(progression))];
  const progressionHtml = uniq.map(c => `<span class="chord" data-chord="${esc(c)}">${esc(c)}</span>`).join(' · ');
  const keyLabel = `${key} · ${uniq.length} chord${uniq.length === 1 ? '' : 's'} used`;

  const heTitle = [content.heTitleNote, firstWords].filter(Boolean).join(' · ');

  const template = readFileSync(join(ROOT, 'tools', 'fixtures', 'song-page.html'), 'utf8');
  const html = template
    .replaceAll('{{CSS_VERSION}}', CONV.page.cssVersion)
    .replaceAll('{{NN}}', nn)
    .replaceAll('{{SLUG}}', entry.slug)
    .replaceAll('{{TITLE_EN}}', esc(content.titleEn))
    .replaceAll('{{SUBTITLE_EN}}', esc(content.subtitleEn))
    .replaceAll('{{HE_TITLE}}', esc(heTitle))
    .replaceAll('{{HE_FIRST_WORDS}}', esc(firstWords))
    .replaceAll('{{INTRO}}', expand(content.intro))
    .replaceAll('{{STANZAS}}', stanzaHtml)
    .replaceAll('{{CHANT_TIPS}}', tips)
    .replaceAll('{{ABOUT}}', about)
    .replaceAll('{{META_LINE}}', expand(content.metaLine || `${content.tempo} BPM`))
    .replaceAll('{{PROGRESSION_HTML}}', progressionHtml)
    .replaceAll('{{KEY_LABEL}}', esc(keyLabel))
    .replaceAll('{{KEY}}', key)
    .replaceAll('{{PROGRESSION}}', progression)
    .replaceAll('{{TEMPO}}', String(content.tempo))
    .replaceAll('{{REF}}', esc(source.ref))
    .replaceAll('{{HE_VERSION}}', esc(source.heVersion))
    .replaceAll('{{HE_LICENSE}}', esc(source.heLicense))
    .replaceAll('{{ATTR_EN}}', esc(CONV.attribution.english))
    .replaceAll('{{ATTR_TR}}', esc(CONV.attribution.transliteration));

  /* A template hole left unfilled does not throw: it writes the word "undefined"
     into the page and ships. The psalm builder learned this by putting it in all
     four PARDES headings and still exiting zero. The second alternative catches a
     live {{4.9}}, which an upper-case-only guard walks straight past. */
  const leak = html.match(/\{\{[A-Z_]+\}\}|\{\{\d+\.\d+\}\}|>undefined<|\bNaN\b|>null</);
  if (leak) throw new Error(`song ${n}: template produced ${leak[0]} — refusing to write`);
  return html;
}

export const pageName = entry => `songs-${String(entry.n).padStart(3, '0')}-${entry.slug}-en.html`;

// -------------------------------------------------------------------- cli
const invokedDirectly = (() => {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] || ''); }
  catch { return false; }
})();

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const list = args.includes('--all')
    ? REGISTRY.filter(s => existsSync(join(ROOT, 'content', 'songs', `${String(s.n).padStart(3, '0')}.json`))).map(s => s.n)
    : args.filter(a => /^\d+$/.test(a)).map(Number);

  if (!list.length) {
    console.error('usage: node tools/songs-build.mjs <song number...|--all> [--force]');
    process.exit(2);
  }

  let ok = 0;
  for (const n of list) {
    const entry = REGISTRY.find(s => s.n === n);
    try {
      const html = buildSong(n);
      const out = join(ROOT, 'liturgy', pageName(entry));
      writeFileSync(out, html, 'utf8');
      console.log(`ok   song ${n} -> liturgy/${pageName(entry)} (${html.split('\n').length} lines)`);
      ok++;
    } catch (e) {
      console.log(`FAIL song ${n}: ${e.message.split('\n').slice(0, 4).join(' / ')}`);
    }
  }
  console.log(`\n${ok}/${list.length} built`);
  process.exit(ok < list.length ? 1 : 0);
}
