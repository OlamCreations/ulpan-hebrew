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
import { deriveKey } from './chord-key.mjs';

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

/* The divine-name glosses in conventions exist to stop three authors rendering
 * the same word three ways. They were applied unconditionally, which is a
 * different thing: it also overruled authors who had read the verse. Psalm 96:4
 * says the nations' gods are nothing, and the page said "God".
 *
 * So: normalise the variants, honour the readings. An authored gloss that is the
 * config value wearing an article, a vocative or a copula is variation and gets
 * flattened; anything else is a decision someone made with the verse in front of
 * them and survives. Divergences are counted and printed, because a rule that
 * silently picks a winner is how the first version got it wrong. */
const GLOSS_NOISE = /^(the|a|an|o|is|are|am|to|of|and)\s+|\s+(of)$/g;
const flattenGloss = s => String(s).toLowerCase().trim().replace(GLOSS_NOISE, '').replace(GLOSS_NOISE, '').trim();

export function resolveGloss(he, authored) {
  const fixed = CONV.defaultGloss[he];
  if (!fixed || fixed.startsWith('_')) return { gloss: authored, honoured: false };
  if (typeof authored !== 'string' || !authored.trim()) return { gloss: fixed, honoured: false };
  if (flattenGloss(authored) === flattenGloss(fixed)) return { gloss: fixed, honoured: false };
  return { gloss: authored, honoured: true };
}

function heNumeral(heRef) {
  // Sefaria's own "תהילים כ״ג" -> "כ״ג". Never computed here.
  const parts = String(heRef || '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

/* Escape first, then expand. A reference contains nothing HTML-special, so the
   order is safe, and it lets EVERY authored string go through the same path.
   Expanding only `intro` and `pardes` was the earlier behaviour, and it shipped
   two live pages with a literal "{{3.7}}" printed inside a verse summary. */
function expandRefs(text, data, psalm) {
  return esc(String(text)).replace(/\{\{(\d+)\.(\d+)\}\}/g, (m, v, w) => {
    const verse = data.verses.find(x => x.n === Number(v));
    const word = verse && verse.words[Number(w)];
    if (!word) throw new Error(`psalm ${psalm}: reference ${m} points at no word`);
    return `<strong>${word.he}</strong> (${readingOf(word.he, word.tr).replace(/([A-Z])/g, c => c.toLowerCase())}, v.${v})`;
  });
}

export function buildPsalm(n) {
  const nn = String(n).padStart(3, '0');
  const data = JSON.parse(readFileSync(join(ROOT, 'content', 'tehilim', 'source', `${nn}.json`), 'utf8'));
  const content = JSON.parse(readFileSync(join(ROOT, 'content', 'tehilim', `${nn}.json`), 'utf8'));

  const errs = validatePsalm(n);
  if (errs.length && !FORCE) throw new Error(`psalm ${n} did not validate:\n  ` + errs.slice(0, 6).join('\n  '));

  const honoured = [];
  const firstWords = data.verses[0].words.slice(0, CONV.page.titleWordCount).map(w => w.he).join(' ');
  const heTitle = `${CONV.page.tehilimWord} ${heNumeral(data.heRef)} · ${firstWords}`;

  // ---- verses
  const verseHtml = data.verses.map(dv => {
    const cv = content.verses.find(v => v.n === dv.n);
    const lines = cv.stichs.map(st => dv.words.slice(st.from, st.to + 1).map(w => w.he).join(' '));
    const full = lines.map(esc).join('<br>\n  ');

    const stichs = cv.stichs.map(st => {
      const words = dv.words.slice(st.from, st.to + 1).map((w, k) => {
        const r = resolveGloss(w.he, cv.glosses[st.from + k]);
        const gloss = r.gloss;
        if (r.honoured) honoured.push(`${n}.${dv.n} w${st.from + k}: "${gloss}" kept over "${CONV.defaultGloss[w.he]}"`);
        return `<div class="word"><div class="he">${esc(w.he)}</div>`
          + `<div class="tr">${boldStress(readingOf(w.he, w.tr))}</div>`
          + `<div class="fr">${esc(gloss)}</div></div>`;
      }).join('\n      ');
      return `  <div class="stich">\n    <div class="stich-words">\n      ${words}\n    </div>\n`
        + `    <div class="stich-translation">${expandRefs(st.en, data, n)}</div>\n  </div>`;
    }).join('\n\n');

    return `<!-- VERSE ${dv.n} -->\n<div class="verse">\n  <span class="verse-num">${dv.n}</span>\n`
      + `  <div class="verse-full">${full}</div>\n\n${stichs}\n\n`
      + `  <div class="verse-summary">${expandRefs(cv.summary, data, n)}</div>\n</div>`;
  }).join('\n\n');

  // ---- pardes
  const pardes = content.pardes.map(p => {
    const heading = CONV.pardesLevels[p.level];
    if (!heading) throw new Error(`psalm ${n}: unknown pardes level "${p.level}"`);
    return `  <div class="pardes-level">\n    <h4>${esc(heading)}</h4>\n    <p>${expandRefs(p.body, data, n)}</p>\n  </div>`;
  }).join('\n\n');

  const template = readFileSync(join(ROOT, 'tools', 'fixtures', 'tehilim-page.html'), 'utf8');

  /* One grid, read once. The key used to be a literal in the template and was
     wrong on 126 of 140 pages; deriving it here means the two can no longer
     disagree, and deriveKey throws rather than name a key it cannot read. */
  const progression = content.progression || '| Am Am | Em Em | Am Dm | Em Am |';
  const key = deriveKey(progression, `psalm ${n}`);

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
    .replaceAll('{{PROGRESSION}}', progression)
    .replaceAll('{{KEY}}', key)
    .replaceAll('{{TEMPO}}', String(content.tempo || 70))
    .replaceAll('{{ATTR_HE}}', esc(CONV.attribution.hebrew))
    .replaceAll('{{ATTR_EN}}', esc(CONV.attribution.english))
    .replaceAll('{{ATTR_TR}}', esc(CONV.attribution.transliteration));

  // A template hole that stays unfilled, or a field read off the wrong key, does
  // not throw: it writes the word "undefined" into the page and ships. The first
  // build of psalm 23 put it in all four PARDES headings and still exited zero.
  // The second alternative catches a live {{4.9}}: the guard used to look only
  // for upper-case template holes, so an unexpanded reference printed as-is.
  const leak = html.match(/\{\{[A-Z_]+\}\}|\{\{\d+\.\d+\}\}|>undefined<|\bNaN\b|>null</);
  if (leak) throw new Error(`psalm ${n}: template produced ${leak[0]} — refusing to write`);
  honouredGlosses.set(n, honoured);
  return html;
}

/** Per-psalm list of divine-name cells where the author's reading beat the
 *  config default. Reported by the CLI so the count stays in view. */
export const honouredGlosses = new Map();

// ------------------------------------------------- gloss rule, self-test
/* resolveGloss decides which of two glosses reaches the learner, so a bug in it
   is a wrong translation under a correct Hebrew word. The cases below are drawn
   from what authors actually wrote across the 140 psalms; the mutations under
   them are the rule broken on purpose, and every one must be caught. */
const GLOSS_CASES = [
  // [ hebrew, authored, expected, honoured? ]  — variation flattened
  ['יְהֹוָה', 'the LORD', 'the LORD', false],
  ['יְהֹוָה', 'O LORD', 'the LORD', false],
  ['יְהֹוָה', 'LORD', 'the LORD', false],
  ['יְהֹוָה', 'is the LORD', 'the LORD', false],
  ['אֱלֹהִים', 'God', 'God', false],
  ['אֱלֹהִים', 'O God', 'God', false],
  ['אֱלֹהִים', 'to God', 'God', false],
  // readings honoured: these change what the verse says
  ['אֱלֹהִים', 'gods', 'gods', true],
  ['אֱלֹהִים', 'the gods of', 'the gods of', true],
  ['אֲדֹנָי', 'my Lord', 'my Lord', true],
  // a word with no config entry is never touched
  ['רֹעִי', 'my shepherd', 'my shepherd', false],
  // an author who left the cell empty gets the default rather than a blank cell
  ['יְהֹוָה', '', 'the LORD', false]
];

const GLOSS_DEFECTS = [
  { what: 'config always wins (the bug that shipped "God" for "gods")',
    rule: (he, a) => CONV.defaultGloss[he] || a },
  { what: 'author always wins (divine names drift across pages)',
    rule: (he, a) => a || CONV.defaultGloss[he] },
  { what: 'case-insensitive equality only, so "O LORD" survives as a variant',
    rule: (he, a) => { const f = CONV.defaultGloss[he]; if (!f) return a; if (!a) return f;
                       return a.toLowerCase() === f.toLowerCase() ? f : a; } },
  { what: 'an empty authored cell falls through and prints nothing',
    rule: (he, a) => { const f = CONV.defaultGloss[he]; if (!f) return a;
                       return flattenGloss(a) === flattenGloss(f) ? f : a; } }
];

function glossSelfTest() {
  let bad = 0;
  for (const [he, authored, expected] of GLOSS_CASES) {
    const got = resolveGloss(he, authored).gloss;
    if (got !== expected) { bad++; console.log(`FAIL  ${he} + ${JSON.stringify(authored)} -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); }
  }
  console.log(`${GLOSS_CASES.length - bad}/${GLOSS_CASES.length} gloss cases pass`);

  let caught = 0;
  for (const d of GLOSS_DEFECTS) {
    const broke = GLOSS_CASES.some(([he, authored, expected]) => d.rule(he, authored) !== expected);
    if (broke) { console.log(`red   ${d.what}`); caught++; }
    else console.log(`GREEN, and should not be: ${d.what}`);
  }
  console.log(`\n${caught}/${GLOSS_DEFECTS.length} injected defects rejected`);
  if (bad || caught < GLOSS_DEFECTS.length) process.exit(1);
}

// -------------------------------------------------------------- cli
if (process.argv.includes('--self-test')) glossSelfTest();

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
  const kept = [...honouredGlosses.values()].flat();
  console.log(`\n${ok}/${args.length} built`);
  if (kept.length) {
    console.log(`${kept.length} divine-name cells kept the author's reading over the config default:`);
    for (const k of kept.slice(0, 8)) console.log('   ' + k);
    if (kept.length > 8) console.log(`   ... and ${kept.length - 8} more`);
  }
  if (ok < args.length) process.exit(1);
}
