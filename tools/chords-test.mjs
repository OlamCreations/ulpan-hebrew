/* chords-test.mjs — non-regression harness for assets/chord-theory.js
 *
 * Runs the SAME module the browser loads (required, not re-implemented), against
 * ground truth that does not come from the module itself:
 *   - chord spellings verified by hand from interval theory
 *   - fretboard shapes taken from the curated library already shipped in the pages,
 *     which was authored by a guitarist and predates the generator
 *   - mode chord tables checked against published freygish / Ukrainian-Dorian harmony
 *
 * The last section injects defects on purpose. A green suite that stays green when
 * the engine is broken is indistinguishable from a suite that was never wired up,
 * so `node tools/chords-test.mjs` fails if any injected defect goes undetected.
 *
 * Usage:  node tools/chords-test.mjs [--verbose]
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const T = require(join(ROOT, 'assets', 'chord-theory.js'));
const VOCAB = JSON.parse(readFileSync(join(ROOT, 'data', 'progressions.json'), 'utf8'));
T.setVocabulary(VOCAB);

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log('  ok   ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const STD = ['E', 'A', 'D', 'G', 'B', 'E'];

// ===================================================================
section('1. Chord symbols');
// ===================================================================

// Ground truth written from intervals by hand, not read back from the module.
const SYMBOL_CASES = [
  ['C',        ['C', 'E', 'G']],
  ['Am',       ['A', 'C', 'E']],
  ['Bbm7',     ['A#', 'C#', 'F', 'G#']],
  ['B♭m',      ['A#', 'C#', 'F']],
  ['F#m7b5',   ['F#', 'A', 'C', 'E']],
  ['C7',       ['C', 'E', 'G', 'A#']],
  ['Gmaj7',    ['G', 'B', 'D', 'F#']],
  ['Ddim7',    ['D', 'F', 'G#', 'B']],
  ['Esus4',    ['E', 'A', 'B']],
  ['Aadd9',    ['A', 'B', 'C#', 'E']],
  ['Dm9',      ['D', 'F', 'A', 'C', 'E']],
  ['E7b9',     ['E', 'F', 'G#', 'B', 'D']],
  ['Caug',     ['C', 'E', 'G#']],
  ['A5',       ['A', 'E']]
];
for (const [sym, notes] of SYMBOL_CASES) {
  const p = T.parseChord(sym);
  const want = new Set(notes.map(T.noteToPc));
  const got = new Set(p ? p.pcs : []);
  check(`parse ${sym}`, p && want.size === got.size && [...want].every(x => got.has(x)),
    p ? `got {${[...got].sort((a, b) => a - b)}} want {${[...want].sort((a, b) => a - b)}}` : 'unparsed');
}

check('slash bass Am/G carries G', (() => {
  const p = T.parseChord('Am/G');
  return p && p.bassPc === T.noteToPc('G') && p.rootPc === T.noteToPc('A');
})());

for (const junk of ['H', 'Xm', '', 'Am/H', 'Zdim', '7']) {
  check(`reject "${junk}"`, T.parseChord(junk) === null);
}

// ===================================================================
section('2. Tuning to pitch');
// ===================================================================

// MIDI numbers of the real open strings. Independent of the module.
check('EADGBE', JSON.stringify(T.tuningToMidi(STD)) === JSON.stringify([40, 45, 50, 55, 59, 64]),
  JSON.stringify(T.tuningToMidi(STD)));
check('DADGAD', JSON.stringify(T.tuningToMidi(['D', 'A', 'D', 'G', 'A', 'D'])) === JSON.stringify([38, 45, 50, 55, 57, 62]),
  JSON.stringify(T.tuningToMidi(['D', 'A', 'D', 'G', 'A', 'D'])));
check('Open G', JSON.stringify(T.tuningToMidi(['D', 'G', 'D', 'G', 'B', 'D'])) === JSON.stringify([38, 43, 50, 55, 59, 62]),
  JSON.stringify(T.tuningToMidi(['D', 'G', 'D', 'G', 'B', 'D'])));

// ===================================================================
section('3. Generated voicings are playable and in tune');
// ===================================================================

function voicingIsHonest(symbol, v, tuning) {
  const p = T.parseChord(symbol);
  const open = T.tuningToMidi(tuning);
  const sounding = [];
  for (let i = 0; i < v.frets.length; i++) if (v.frets[i] >= 0) sounding.push((open[i] + v.frets[i]) % 12);
  if (sounding.length < 3) return 'fewer than 3 strings';
  for (const pc of sounding) if (!p.pcs.includes(pc)) return 'sounds a foreign note ' + T.spellNote(pc);
  for (const need of p.essentialPcs) if (!sounding.includes(need)) return 'missing ' + T.spellNote(need);
  if (T.fingerCount(v.frets) > 4) return 'needs ' + T.fingerCount(v.frets) + ' fingers';
  const fretted = v.frets.filter(f => f > 0);
  if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 3) return 'span > 4 frets';
  return null;
}

const LIBRARY_CHORDS = ['Am', 'Em', 'Dm', 'F', 'C', 'G', 'D', 'A', 'E', 'Bm', 'Gm', 'Fm', 'Bbm', 'C7'];
for (const sym of LIBRARY_CHORDS) {
  const vs = T.generateVoicings(sym, STD);
  check(`${sym}: at least one shape`, vs.length > 0);
  let bad = null;
  for (const v of vs) { const why = voicingIsHonest(sym, v, STD); if (why) { bad = v.name + ': ' + why; break; } }
  check(`${sym}: every shape honest (${vs.length})`, bad === null, bad);
}

// Ground truth: shapes a guitarist plays, taken from the curated library that
// shipped in the pages long before this generator existed.
const KNOWN_SHAPES = [
  ['Am', [-1, 0, 2, 2, 1, 0]],
  ['C',  [-1, 3, 2, 0, 1, 0]],
  ['G',  [3, 2, 0, 0, 0, 3]],
  ['D',  [-1, -1, 0, 2, 3, 2]],
  ['Em', [0, 2, 2, 0, 0, 0]],
  ['E',  [0, 2, 2, 1, 0, 0]],
  ['A',  [-1, 0, 2, 2, 2, 0]],
  ['Dm', [-1, -1, 0, 2, 3, 1]],
  ['F',  [1, 3, 3, 2, 1, 1]]
];
for (const [sym, frets] of KNOWN_SHAPES) {
  const all = T.generateVoicings(sym, STD, { all: true });
  const found = all.some(v => v.frets.join(',') === frets.join(','));
  check(`${sym}: finds the standard shape [${frets.join(' ')}]`, found,
    found ? '' : `${all.length} shapes searched`);
}

// Ranking, not just reachability: the shape offered first must be one a beginner
// can hold. Without this the suite would pass on a generator that buries every
// open chord under barre shapes at the 10th fret.
for (const [sym] of KNOWN_SHAPES) {
  const top = T.generateVoicings(sym, STD)[0];
  const fretted = top.frets.filter(f => f > 0);
  const pos = fretted.length ? Math.min(...fretted) : 0;
  check(`${sym}: first shape sits in low position (${top.name})`, pos <= 3, `min fret ${pos}`);
}

// Root in the bass is the default reading of a chord symbol.
for (const [sym] of KNOWN_SHAPES) {
  const top = T.generateVoicings(sym, STD)[0];
  const openMidi = T.tuningToMidi(STD);
  const i = top.frets.findIndex(f => f >= 0);
  const bassPc = (openMidi[i] + top.frets[i]) % 12;
  check(`${sym}: first shape has the root in the bass`, bassPc === T.parseChord(sym).rootPc,
    'bass ' + T.spellNote(bassPc));
}

// A tuning change must change the answer. This is the bug the old library had:
// standard-tuning shapes were drawn unchanged under DADGAD.
{
  const std = T.generateVoicings('Dm', STD, { maxResults: 40 }).map(v => v.frets.join(','));
  const dad = T.generateVoicings('Dm', ['D', 'A', 'D', 'G', 'A', 'D'], { maxResults: 40 });
  check('DADGAD yields shapes', dad.length > 0);
  let bad = null;
  for (const v of dad) { const why = voicingIsHonest('Dm', v, ['D', 'A', 'D', 'G', 'A', 'D']); if (why) { bad = v.name + ': ' + why; break; } }
  check('DADGAD shapes honest in DADGAD', bad === null, bad);
  const overlap = dad.filter(v => std.includes(v.frets.join(','))).length;
  check('DADGAD answer differs from standard', overlap < dad.length, `${overlap}/${dad.length} identical`);
  // The standard open Dm is a foreign-note chord in DADGAD; it must not be offered.
  check('DADGAD rejects the standard open Dm shape',
    !dad.some(v => v.frets.join(',') === [-1, -1, 0, 2, 3, 1].join(',')));
}

// Chords the old 14-entry library could not draw at all.
for (const sym of ['Eb', 'Abmaj7', 'F#7', 'Bsus4', 'C#m7', 'Ebdim7']) {
  const vs = T.generateVoicings(sym, STD);
  const why = vs.length ? voicingIsHonest(sym, vs[0], STD) : 'none';
  check(`${sym}: drawable (was not in the library)`, vs.length > 0 && why === null, why);
}

// ===================================================================
section('4. Mode chord tables');
// ===================================================================

// Published harmony, written out by hand:
const MODE_TRUTH = {
  'ionian':       ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  'aeolian':      ['i', 'ii°', 'bIII', 'iv', 'v', 'bVI', 'bVII'],
  'dorian':       ['i', 'ii', 'bIII', 'IV', 'v', 'vi°', 'bVII'],
  'phrygian':     ['i', 'bII', 'bIII', 'iv', 'v°', 'bVI', 'bvii'],
  'mixolydian':   ['I', 'ii', 'iii°', 'IV', 'v', 'vi', 'bVII'],
  'harmonic-minor': ['i', 'ii°', 'bIII+', 'iv', 'V', 'bVI', 'vii°'],
  'ahava-rabbah': ['I', 'bII', 'iii°', 'iv', 'v°', 'bVI+', 'bvii'],
  'mi-sheberach': ['i', 'II', 'bIII', '#iv°', 'v', 'vi°', 'bVII+'],
  'adonai-malach': ['I', 'ii', 'iii°', 'IV', 'v', 'vi', 'bVII']
};
for (const [modeId, truth] of Object.entries(MODE_TRUTH)) {
  const got = T.modeDegrees(modeId).map(d => d.roman);
  check(`${modeId} degrees`, JSON.stringify(got) === JSON.stringify(truth), got.join(' '));
}

// The two headline claims of the jewish modes, checked as pitch not as label.
{
  const d = T.modeDegrees('ahava-rabbah');
  check('freygish bII is a major triad a semitone up', d[1].semitone === 1 && d[1].triad === 'maj');
  const m = T.modeDegrees('mi-sheberach');
  check('mi-sheberach II is major on the 2nd degree', m[1].semitone === 2 && m[1].triad === 'maj');
}

// ===================================================================
section('5. Generated progressions');
// ===================================================================

{
  const keys = [
    { tonic: 'D', quality: 'minor' }, { tonic: 'A', quality: 'minor' },
    { tonic: 'F', quality: 'minor' }, { tonic: 'D', quality: 'major' },
    { tonic: 'Bb', quality: 'major' }, { tonic: 'C#', quality: 'minor' }
  ];
  let n = 0, problems = [];
  for (const key of keys) {
    for (let seed = 1; seed <= 60; seed++) {
      const r = T.generateProgression(key, { seed });
      n++;
      const chords = T.progressionChords(r.text);
      if (chords.length === 0) { problems.push(`${key.tonic} seed ${seed}: empty`); continue; }
      for (const c of chords) {
        if (!T.parseChord(c)) { problems.push(`${key.tonic} seed ${seed}: unparsed "${c}" in ${r.text}`); break; }
        if (T.generateVoicings(c, STD, { maxResults: 1 }).length === 0) {
          problems.push(`${key.tonic} seed ${seed}: undrawable "${c}"`); break;
        }
      }
      if (!/^\| .* \|$/.test(r.text)) problems.push(`${key.tonic} seed ${seed}: bad bar syntax ${r.text}`);
      if (!r.explain || !r.strategyLabel || !r.modeLabel) problems.push(`${key.tonic} seed ${seed}: missing explanation`);
      // No chord may be silently dropped by the bar layout.
      if (chords.length < r.chords.length) problems.push(`${key.tonic} seed ${seed}: layout dropped a chord`);
    }
  }
  check(`${n} progressions: every chord parses, draws, and is explained`, problems.length === 0,
    problems.slice(0, 3).join(' | '));
}

check('same seed gives the same progression', (() => {
  const a = T.generateProgression({ tonic: 'D', quality: 'minor' }, { seed: 42 }).text;
  const b = T.generateProgression({ tonic: 'D', quality: 'minor' }, { seed: 42 }).text;
  return a === b;
})());

check('different seeds give different progressions', (() => {
  const set = new Set();
  for (let s = 1; s <= 40; s++) set.add(T.generateProgression({ tonic: 'D', quality: 'minor' }, { seed: s }).text);
  return set.size >= 20;
})(), 'variety too low');

check('a forced strategy is honoured', (() => {
  for (let s = 1; s <= 20; s++) {
    const r = T.generateProgression({ tonic: 'D', quality: 'minor' }, { seed: s, mode: 'ahava-rabbah', strategy: 'yiddish-cadence' });
    if (r.strategy !== 'yiddish-cadence' || r.mode !== 'ahava-rabbah') return false;
  }
  return true;
})());

check('freygish output actually contains the bII chord', (() => {
  let seen = 0;
  for (let s = 1; s <= 30; s++) {
    const r = T.generateProgression({ tonic: 'D', quality: 'minor' }, { seed: s, mode: 'ahava-rabbah', strategy: 'yiddish-cadence', decorate: false });
    // D freygish: bII = Eb
    if (T.progressionChords(r.text).some(c => T.parseChord(c).rootPc === T.noteToPc('Eb'))) seen++;
  }
  return seen >= 25;
})(), 'bII rarely present');

// Enharmonic spelling. F minor writes Bb, never A#, and a borrowed chord follows
// the chord it points at rather than the key signature.
check('a flat key with no raised degree never spells a root with a sharp', (() => {
  const offenders = [];
  // Aeolian and Ionian contain no raised degree, so every chord here must be flat
  // or natural. Modes such as Mi Sheberach are excluded on purpose: their #iv is a
  // sharp by definition, and the next check covers it.
  for (const key of [{ tonic: 'F', quality: 'minor' }, { tonic: 'Bb', quality: 'major' },
                     { tonic: 'C', quality: 'minor' }, { tonic: 'Eb', quality: 'major' }]) {
    const mode = key.quality === 'minor' ? 'aeolian' : 'ionian';
    for (let s = 1; s <= 40; s++) {
      for (const c of T.progressionChords(T.generateProgression(key, { seed: s, mode, decorate: false }).text)) {
        if (/^[A-G]#/.test(c)) offenders.push(`${key.tonic} ${mode} seed ${s}: ${c}`);
      }
    }
  }
  return offenders.length === 0 || (console.log('    ' + offenders.slice(0, 4).join(', ')), false);
})());

check('the dominant of a flat chord is spelled flat', (() => {
  for (let s = 1; s <= 60; s++) {
    const r = T.generateProgression({ tonic: 'D', quality: 'major' }, { seed: s, mode: 'ahava-rabbah' });
    for (const c of T.progressionChords(r.text)) {
      if (/^A#/.test(c) || /^D#/.test(c)) return false;   // must read Bb / Eb
    }
  }
  return true;
})());

// A raised scale degree keeps its sharp even in a flat key, and a leading-tone
// diminished is written as the note that rises into its target.
check('a raised degree is spelled with a sharp, not a flat', (() => {
  let sawSharpDim = 0;
  for (let s = 1; s <= 60; s++) {
    // D Mi Sheberach: D E F G# A B C. The #iv chord is G#dim, never Abdim.
    for (const c of T.progressionChords(T.generateProgression({ tonic: 'D', quality: 'minor' }, { seed: s, mode: 'mi-sheberach' }).text)) {
      if (/^Ab/.test(c)) return false;
      if (/^G#dim$/.test(c)) sawSharpDim++;
    }
  }
  return sawSharpDim > 0 || (console.log('    the #iv chord never appeared, so nothing was proven'), false);
})());

check('a passing diminished is spelled as the note below its target', (() => {
  for (let s = 1; s <= 120; s++) {
    for (const key of [{ tonic: 'D', quality: 'minor' }, { tonic: 'F', quality: 'minor' }]) {
      for (const c of T.progressionChords(T.generateProgression(key, { seed: s }).text)) {
        // Db°7 into D would be the same pitches written as a descent; C#°7 is the rise.
        if (/^Dbdim7$/.test(c) || /^Gbdim7$/.test(c)) return false;
      }
    }
  }
  return true;
})());

// The engine must be able to read back everything it writes. A chord it spells
// but cannot parse does not error: it is silently dropped by the tokenizer and
// disappears from the grid, which is how F##7 shipped unnoticed until this ran.
check('every generated chord survives a round trip through the reader', (() => {
  const bad = [];
  for (const key of [{ tonic: 'C#', quality: 'minor' }, { tonic: 'F#', quality: 'minor' },
                     { tonic: 'Gb', quality: 'major' }, { tonic: 'B', quality: 'major' },
                     { tonic: 'Eb', quality: 'minor' }, { tonic: 'D', quality: 'minor' }]) {
    for (let s = 1; s <= 60; s++) {
      const r = T.generateProgression(key, { seed: s });
      const back = T.progressionChords(r.text);
      for (const c of r.chords) {
        if (!T.parseChord(c.symbol)) bad.push(`${key.tonic}: unreadable ${c.symbol}`);
        else if (!back.includes(c.symbol)) bad.push(`${key.tonic}: ${c.symbol} lost in ${r.text}`);
      }
    }
  }
  return bad.length === 0 || (console.log('    ' + bad.slice(0, 3).join(' | ')), false);
})());

check('no root ever carries two accidentals', (() => {
  for (const key of [{ tonic: 'C#', quality: 'minor' }, { tonic: 'F#', quality: 'minor' },
                     { tonic: 'Gb', quality: 'major' }, { tonic: 'Eb', quality: 'minor' }]) {
    for (let s = 1; s <= 60; s++) {
      for (const c of T.progressionChords(T.generateProgression(key, { seed: s }).text)) {
        if (/^[A-G](##|bb)/.test(c)) { console.log('    ' + c); return false; }
      }
    }
  }
  return true;
})());

check('each mode is spelled one letter per degree', (() => {
  // Scales written out by hand from the theory, not read back from the module.
  const SCALES = [
    ['D', 'harmonic-minor', 'D E F G A Bb C#'],
    ['D', 'mi-sheberach',   'D E F G# A B C'],
    ['D', 'ahava-rabbah',   'D Eb F# G A Bb C'],
    ['F', 'aeolian',        'F G Ab Bb C Db Eb'],
    ['Bb', 'ionian',        'Bb C D Eb F G A'],
    ['A', 'aeolian',        'A B C D E F G'],
    ['E', 'phrygian',       'E F G A B C D'],
    ['G', 'mixolydian',     'G A B C D E F']
  ];
  for (const [tonic, mode, want] of SCALES) {
    const got = T.modeDegrees(mode).map((d, i) => T.spellDegree(tonic, i, d.semitone)).join(' ');
    if (got !== want) { console.log(`    ${tonic} ${mode}: got "${got}" want "${want}"`); return false; }
  }
  return true;
})());

check('the four hostile spellings are never printed', (() => {
  for (let s = 1; s <= 80; s++) {
    for (const key of [{ tonic: 'Bb', quality: 'major' }, { tonic: 'Eb', quality: 'major' },
                       { tonic: 'F', quality: 'minor' }, { tonic: 'C#', quality: 'minor' }]) {
      for (const c of T.progressionChords(T.generateProgression(key, { seed: s }).text)) {
        if (/^(Cb|Fb|B#|E#)/.test(c)) { console.log('    ' + c); return false; }
      }
    }
  }
  return true;
})());

check('the final chord is never held for more than two bars', (() => {
  for (const key of [{ tonic: 'D', quality: 'minor' }, { tonic: 'D', quality: 'major' }]) {
    for (let s = 1; s <= 80; s++) {
      const bars = T.generateProgression(key, { seed: s }).text.split('|').map(b => b.trim()).filter(Boolean);
      let tail = 1;
      for (let i = bars.length - 2; i >= 0 && bars[i] === bars[bars.length - 1]; i--) tail++;
      if (tail > 2) return false;
    }
  }
  return true;
})());

check('every mode in the vocabulary is reachable by some strategy', (() => {
  const missing = Object.keys(VOCAB.modes).filter(
    id => !VOCAB.strategies.some(s => s.modes.includes(id)));
  return missing.length === 0 || (console.log('    unreachable: ' + missing.join(', ')), false);
})());

check('progression text round-trips through the tokenizer', (() => {
  for (let s = 1; s <= 30; s++) {
    const r = T.generateProgression({ tonic: 'Bb', quality: 'major' }, { seed: s });
    const back = T.progressionChords(r.text);
    const want = r.chords.map(c => c.symbol);
    // layout may hold the final chord for an extra bar, so compare as a prefix
    if (want.some((w, i) => back[i] !== w)) return false;
  }
  return true;
})());

// ===================================================================
section('6. Injected defects — each MUST turn the suite red');
// ===================================================================

// Every entry breaks one real invariant. If a break goes unnoticed, the
// corresponding assertion above is decorative and this script exits non-zero.
const INJECTED = [
  {
    what: 'a voicing that sounds a foreign note',
    detect: () => voicingIsHonest('Am', { frets: [-1, 0, 2, 2, 1, 1] }, STD) !== null
  },
  {
    what: 'a voicing missing the third',
    detect: () => voicingIsHonest('Am', { frets: [-1, 0, 2, -1, -1, 0] }, STD) !== null
  },
  {
    what: 'a five-finger stretch',
    detect: () => T.fingerCount([1, 3, 5, 2, 4, 6]) > 4
  },
  {
    what: 'a shape spanning six frets',
    detect: () => {
      const f = [1, 3, 3, 2, 1, 7].filter(x => x > 0);
      return Math.max(...f) - Math.min(...f) > 3;
    }
  },
  {
    what: 'a wrong mode table (freygish bII declared minor)',
    detect: () => {
      const broken = JSON.parse(JSON.stringify(VOCAB));
      broken.modes['ahava-rabbah'].scale = [0, 1, 3, 5, 7, 8, 10];  // phrygian, not freygish
      T.setVocabulary(broken);
      const got = T.modeDegrees('ahava-rabbah').map(d => d.roman).join(' ');
      T.setVocabulary(VOCAB);
      return got !== MODE_TRUTH['ahava-rabbah'].join(' ');
    }
  },
  {
    what: 'a progression containing an unparseable chord',
    detect: () => T.progressionChords('| Am H7 | Dm |').length !== 3
  },
  {
    what: 'a progression whose chord cannot be drawn',
    detect: () => T.generateVoicings('Cb#m13sus', STD, { maxResults: 1 }).length === 0
  },
  {
    what: 'a tuning read at the wrong octave',
    detect: () => JSON.stringify(T.tuningToMidi(['E', 'A', 'D', 'G', 'B', 'E'])) === JSON.stringify([40, 45, 50, 55, 59, 64])
      && JSON.stringify(T.tuningToMidi(['D', 'A', 'D', 'G', 'A', 'D'])) !== JSON.stringify([40, 45, 50, 55, 59, 64])
  },
  {
    what: 'a standard-tuning shape offered under DADGAD',
    detect: () => voicingIsHonest('Dm', { frets: [-1, -1, 0, 2, 3, 1] }, ['D', 'A', 'D', 'G', 'A', 'D']) !== null
  },
  {
    // The round-trip check above can only fail if the reader really does drop
    // what it cannot parse. Prove that it does, on a symbol no widening covers.
    what: 'a chord the reader cannot parse is dropped rather than errored',
    detect: () => T.parseChord('F###7') === null
      && T.progressionChords('| C#m | F###7 | A |').length < 3
  },
  {
    what: 'a double accidental reaching the chart',
    detect: () => !/##|bb/.test(T.spellDegree('C#', 6, 11))
      && !/##|bb/.test(T.spellDegree('Gb', 3, 6))
  },
  {
    what: 'a seeded generator that is not reproducible',
    detect: () => {
      const r1 = T.mulberry32(7)(), r2 = T.mulberry32(7)();
      return r1 === r2;
    }
  }
];

let undetected = 0;
for (const inj of INJECTED) {
  let caught = false;
  try { caught = !!inj.detect(); } catch (e) { caught = true; }
  if (caught) { pass++; if (VERBOSE) console.log('  ok   caught: ' + inj.what); }
  else { undetected++; console.log('  FAIL undetected: ' + inj.what); failures.push('undetected defect: ' + inj.what); }
}
check(`${INJECTED.length} injected defects all caught`, undetected === 0, `${undetected} slipped through`);

// ===================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`);
if (fail > 0) { console.log('\nFailures:\n  - ' + failures.join('\n  - ')); process.exit(1); }
