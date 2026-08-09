/* strip-hidden-chart.mjs — remove the chord chart from the pages that hide it.
 *
 * The twelve prayer and twelve shabbat pages were built from the song template
 * and then neutralised with one CSS rule:
 *
 *     .t-chord, .active-voicings, .stich-chords, .progression,
 *     .chord-popup, .chord-tooltip { display: none !important; }
 *
 * Everything behind that rule still shipped: the tuning selector, the progression
 * line, the printable voicing panel, and, since the engine was made shared, two
 * script tags that fetch the harmonic vocabulary and draw fretboard diagrams into
 * a container nobody can see.
 *
 * The prose inside the hidden block is not authored content: all 24 pages carry
 * the identical meta-line, and it is Az Yashir's (songs-006), describing Aviv
 * Alush's recording. It is template debris, so it goes with the rest.
 *
 * Every page must match exactly; anything unexpected is skipped and reported
 * rather than half-edited. Verify with tools/liturgy-pixel-check.mjs --compare:
 * removing something invisible must not move a single pixel.
 *
 * Usage: node tools/strip-hidden-chart.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DRY = process.argv.includes('--dry');

const HIDE_MARKER = 'hide all chord/guitar machinery';

let done = 0, skipped = 0;
const problems = [];

for (const file of readdirSync(join(ROOT, 'liturgy')).sort()) {
  if (!file.endsWith('.html')) continue;
  const path = join(ROOT, 'liturgy', file);
  let html = readFileSync(path, 'utf8');
  if (!html.includes(HIDE_MARKER)) continue;

  const before = html.length;
  const steps = [];

  // 1. the markup, from the chart container up to the verses. Asserted to hold
  //    nothing but those two blocks, so a page with content in between is left alone.
  const start = html.indexOf('<div class="t-chord">');
  const end = html.indexOf('<div class="verses-grid">');
  if (start < 0 || end < 0 || end < start) { problems.push(`${file}: chart markup not found`); skipped++; continue; }
  const slice = html.slice(start, end);
  const stray = slice
    .replace(/<div class="t-chord">[\s\S]*?<\/div>\s*<\/div>\s*/, '')
    .replace(/<div class="active-voicings"[\s\S]*?<\/div>\s*<\/div>\s*/, '')
    .trim();
  if (stray !== '') { problems.push(`${file}: unexpected markup between the chart and the verses`); skipped++; continue; }
  if (!/id="active-voicings"/.test(slice)) { problems.push(`${file}: voicing panel missing`); skipped++; continue; }
  html = html.slice(0, start) + html.slice(end);
  steps.push('markup');

  // 2. the per-page config and the two shared modules
  const cfg = /<script>\s*\n\/\* This page's harmony[\s\S]*?<\/script>\s*\n/;
  if (!cfg.test(html)) { problems.push(`${file}: SONG_CHORDS block not found`); skipped++; continue; }
  html = html.replace(cfg, '');
  html = html.replace(/<script src="\.\.\/assets\/chord-theory\.js" defer><\/script>\s*\n/, '');
  html = html.replace(/<script src="\.\.\/assets\/chords\.js" defer><\/script>\s*\n/, '');
  steps.push('scripts');

  // 3. the rule that hid it all
  const rule = /[ \t]*\/\* Prayer page, hide all chord\/guitar machinery \*\/\s*\n[ \t]*\.t-chord,[^\n]*\n/;
  if (!rule.test(html)) { problems.push(`${file}: hiding rule not found`); skipped++; continue; }
  html = html.replace(rule, '');
  steps.push('css rule');

  if (/SONG_CHORDS|assets\/chords\.js|t-chord">/.test(html)) {
    problems.push(`${file}: something survived the strip`);
    skipped++;
    continue;
  }

  if (!DRY) writeFileSync(path, html, 'utf8');
  console.log(`${DRY ? 'would' : 'ok   '}  ${file}  −${before - html.length} chars  (${steps.join(', ')})`);
  done++;
}

if (problems.length) {
  console.log('\nleft untouched:');
  for (const p of problems) console.log('  ' + p);
}
console.log(`\n${DRY ? '[dry run, nothing written] ' : ''}${done} stripped, ${skipped} skipped`);
