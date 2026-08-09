/* migrate-chord-engine.mjs — one-shot: replace the pasted chord engine in the song
 * pages with a per-song config plus the shared modules.
 *
 * Before: 1153 lines of identical JavaScript inside each of the seven song files,
 * differing only in DEFAULT_PROGRESSION (and three extra chord entries in one).
 * After:  a six-line config object and two <script src> tags.
 *
 * The per-song values below are not invented. `key`, `tempo` and `meter` are read
 * off the page's own header and meta line; `progression` is either the grid the
 * file already declared, or, where that grid was copy-paste debris from Hatikvah,
 * the chords of the song's own first verse lines, one bar per line.
 *
 * Refuses to run twice. Run with --dry to see the plan.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DRY = process.argv.includes('--dry');

const SONGS = [
  {
    file: 'songs-001-hatikvah-en.html', id: 'hatikvah',
    key: 'Dm', tempo: 76, meter: '4/4',
    progression: '| Dm Dm Gm A | Dm A Dm | Gm Dm A | Gm Dm A Dm |',
    source: 'verse 1-4 stich chords (the file\'s own DEFAULT_PROGRESSION was an A-minor copy-paste, unrelated to this D-minor song)'
  },
  {
    file: 'songs-002-yerushalayim-shel-zahav-en.html', id: 'yerushalayim-shel-zahav',
    key: 'Am', tempo: 80, meter: '3/4',
    progression: '| Am G Am | F E Am | Am G Am | F E Am |',
    source: 'verse 1-4 stich chords (previous default was the Hatikvah copy-paste)'
  },
  {
    file: 'songs-003-shalom-aleichem-en.html', id: 'shalom-aleichem',
    key: 'Am', tempo: 92, meter: '4/4',
    progression: '| Am Dm | G C | Dm E Am | Dm G C |',
    source: 'verse 1-4 stich chords (previous default was the Hatikvah copy-paste)'
  },
  {
    file: 'songs-004-hava-nagila-en.html', id: 'hava-nagila',
    key: 'Dm', tempo: 80, meter: '4/4',
    progression: '| Dm | Dm A | Gm A Dm |',
    source: 'the grid this file already declared'
  },
  {
    file: 'songs-005-al-hanissim-en.html', id: 'al-hanissim',
    key: 'D', tempo: 111, meter: '4/4',
    progression: '| D | G | D A | Bm G D |',
    source: 'the grid this file already declared'
  },
  {
    file: 'songs-006-az-yashir-en.html', id: 'az-yashir',
    key: 'Am', tempo: null, meter: '4/4',
    progression: '| Am | F G | Am Dm | E Am |',
    source: 'the grid this file already declared; the meta line says "mid-tempo" and gives no BPM, so tempo is left unset and playback falls back to the module default'
  },
  {
    file: 'songs-007-sharei-shomayim-en.html', id: 'sharei-shomayim',
    key: 'Fm', tempo: 67, meter: '4/4',
    progression: '| Fm Fm | Bbm Bbm | C7 C7 | Fm Fm |',
    source: 'the grid this file already declared'
  }
];

// The engine block is the long inline <script> that starts with the chord library.
const ENGINE_RE = /<script>\s*\n\/\/ Chord library[\s\S]*?\n<\/script>\s*\n/;

/* The prayer, shabbat and tehilim pages carry the same pasted engine. There are
 * 44 of them, so their config is READ OFF each page instead of typed out here:
 * hand-copying 44 rows is how a wrong key ends up in a file nobody rechecks.
 *
 *   progression  the grid that page already declared, verbatim
 *   tempo        the BPM printed in its own meta line, when it prints one
 *   key          its own "Key: X minor" header when it has one; otherwise
 *                inferred from the progression, and only when that grid opens
 *                AND closes on the same chord. Anything less certain is left
 *                unset rather than guessed, and the page is reported. */
function deriveConfig(file, html) {
  const prog = html.match(/const DEFAULT_PROGRESSION = '([^']*)'/);
  if (!prog) return { error: 'no DEFAULT_PROGRESSION' };
  const progression = prog[1];

  const chords = progression.match(/[A-G][#b♯♭]?(?:m(?!aj)|maj|dim|aug|sus|add)?[0-9]*/g) || [];
  if (!chords.length) return { error: 'progression has no chords' };

  const header = html.match(/<strong>Key:\s*([A-G][#b♯♭]?)\s*(minor|major)/i);
  let key, keySource;
  if (header) {
    key = header[1] + (/minor/i.test(header[2]) ? 'm' : '');
    keySource = 'the page\'s own "Key:" header';
  } else if (chords[0] === chords[chords.length - 1]) {
    key = chords[0];
    keySource = `inferred from this page's own grid, which opens and closes on ${chords[0]}`;
  } else {
    return { error: `no key header and the grid runs ${chords[0]} to ${chords[chords.length - 1]}` };
  }

  const meta = html.match(/<div class="meta-line">([\s\S]*?)<\/div>/);
  const bpm = meta ? meta[1].replace(/<[^>]+>/g, '').match(/~?(\d+)\s*BPM/i) : null;

  return {
    file,
    // The file stem, so the English and Hebrew copies of a psalm keep separate grids.
    id: file.replace(/\.html$/, ''),
    key,
    tempo: bpm ? parseInt(bpm[1], 10) : null,
    meter: null,                        // none of these pages states one
    progression,
    source: `the grid this file already declared; key from ${keySource}` +
            (bpm ? '' : '; no BPM is printed on this page, so playback uses the module default')
  };
}

function collectDerived() {
  const out = [];
  const problems = [];
  for (const file of readdirSync(join(ROOT, 'liturgy')).sort()) {
    if (!file.endsWith('.html') || file.startsWith('songs-')) continue;
    const html = readFileSync(join(ROOT, 'liturgy', file), 'utf8');
    if (!html.includes('// Chord library')) continue;
    const cfg = deriveConfig(file, html);
    if (cfg.error) { problems.push(`${file}: ${cfg.error}`); continue; }
    out.push(cfg);
  }
  if (problems.length) {
    console.log('\nleft untouched, config could not be derived without guessing:');
    for (const p of problems) console.log('  ' + p);
    console.log('');
  }
  return out;
}

const ALL = SONGS.concat(collectDerived());

let changed = 0, skipped = 0;

for (const song of ALL) {
  const path = join(ROOT, 'liturgy', song.file);
  let html = readFileSync(path, 'utf8');

  if (html.includes('window.SONG_CHORDS')) {
    console.log(`skip   ${song.file} (already migrated)`);
    skipped++;
    continue;
  }
  if (!ENGINE_RE.test(html)) {
    console.log(`SKIP   ${song.file} — engine block not found, left untouched`);
    skipped++;
    continue;
  }

  const fields = [
    `  id: '${song.id}'`,
    `  key: '${song.key}'`,
    song.tempo === null || song.tempo === undefined ? null : `  tempo: ${song.tempo}`,
    song.meter ? `  meter: '${song.meter}'` : null,
    `  progression: '${song.progression}'`
  ].filter(Boolean).join(',\n');

  const block =
`<script>
/* This page's harmony. The chord chart itself is shared:
     assets/chord-theory.js  harmony, fretboard search, progression generator
     assets/chords.js        drawing, chord popup, shuffle, playback
   Progression source: ${song.source}. */
window.SONG_CHORDS = {
${fields}
};
</script>
<script src="../assets/chord-theory.js" defer></script>
<script src="../assets/chords.js" defer></script>
`;

  const before = html.length;
  const after = html.replace(ENGINE_RE, block);
  if (!DRY) writeFileSync(path, after, 'utf8');
  console.log(`${DRY ? 'would' : 'ok   '}  ${song.file}  ${before} -> ${after.length} chars (-${before - after.length})`);
  changed++;
}

console.log(`\n${DRY ? '[dry run, nothing written] ' : ''}${changed} migrated, ${skipped} skipped`);
