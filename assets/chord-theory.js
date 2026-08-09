/* chord-theory.js — pure harmony engine for the song pages.
 *
 * No DOM, no storage, no network: everything here is a function of its arguments,
 * which is what lets tools/chords-test.mjs exercise the SAME code the browser runs
 * instead of a copy that can drift from it.
 *
 * Three jobs:
 *   1. read a chord symbol   ("Bbm7", "F#7b9", "Am/G")  -> pitch classes
 *   2. find playable shapes  (symbol + any tuning)      -> fretboard voicings
 *   3. invent a progression  (key + mode + strategy)    -> a bar grid with a reason
 *
 * The vocabulary (modes, strategies, decorators) is NOT in this file. It is loaded
 * from data/progressions.json through setVocabulary(), so adding a mode is a data
 * edit. The diatonic chords of a mode are derived from its scale rather than listed,
 * so an exotic scale gets correct triads without anyone hand-typing them.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ChordTheory = api;
})(this, function () {
  'use strict';

  // ===================================================================
  // NOTES
  // ===================================================================

  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Unicode accidentals reach us from the page text (B♭m in the stich chords).
  function normalizeAccidentals(s) {
    return String(s).replace(/♭/g, 'b').replace(/♯/g, '#');
  }

  function noteToPc(name) {
    const n = normalizeAccidentals(name).trim();
    const m = n.match(/^([A-Ga-g])([#b]*)/);
    if (!m) return -1;
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    if (base === undefined) return -1;
    let pc = base;
    for (const ch of m[2]) pc += (ch === '#' ? 1 : -1);
    return ((pc % 12) + 12) % 12;
  }

  function spellNote(pc, preferFlat) {
    const i = ((pc % 12) + 12) % 12;
    return preferFlat ? FLAT_NAMES[i] : SHARP_NAMES[i];
  }

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PCS = [0, 2, 4, 5, 7, 9, 11];

  function letterIndex(name) {
    return LETTERS.indexOf(normalizeAccidentals(name).trim().charAt(0).toUpperCase());
  }

  /**
   * Spell a scale degree on its OWN letter, which is how key signatures work:
   * D harmonic minor is D E F G A Bb C#, one letter each, so its leading tone is
   * C# and never Db even though D minor is a flat key. Falls back to the plain
   * sharp/flat name when the letter would need a double accidental.
   *
   * @param tonic        the tonic's note name, e.g. 'D' or 'Bb'
   * @param degreeIndex  0 for the tonic, 1 for the second, ... 6 for the seventh
   * @param semitone     the degree's distance above the tonic, in semitones
   */
  function spellDegree(tonic, degreeIndex, semitone, preferFlatFallback) {
    const tonicPc = noteToPc(tonic);
    const li = letterIndex(tonic);
    const target = (((tonicPc + semitone) % 12) + 12) % 12;
    if (li < 0 || degreeIndex === undefined || degreeIndex === null) {
      return spellNote(target, preferFlatFallback);
    }
    const idx = (li + degreeIndex) % 7;
    const acc = ((target - LETTER_PCS[idx] + 18) % 12) - 6;
    // One accidental at most. A double sharp is correct on paper for things like
    // the dominant of a raised seventh, but it is unreadable on a chord chart AND
    // parseChord will not read it back, so the chord would vanish from the grid.
    if (acc < -1 || acc > 1) return spellNote(target, preferFlatFallback);
    const name = LETTERS[idx] + (acc < 0 ? 'b' : acc > 0 ? '#' : '');

    // Cb, Fb, B# and E# are correct on paper and hostile on a chord chart: the
    // reader has to convert before their hand moves. This is a beginners' guitar
    // page, so those four fall back to the plain name for the same pitch. The
    // letter rule still governs everything else, which is what keeps D harmonic
    // minor's leading tone spelled C# instead of Db.
    if (/^(Cb|Fb|B#|E#)$/.test(name)) return spellNote(target, preferFlatFallback);
    return name;
  }

  // Major keys whose signature is written with flats. A minor key follows its
  // relative major, which is why F minor spells its bVII as Eb and not D#, even
  // though nothing in the letter "F" says so.
  const FLAT_KEY_PCS = new Set([1, 3, 5, 8, 10]);   // Db Eb F Ab Bb

  function keyPrefersFlats(tonic, quality) {
    const pc = noteToPc(tonic);
    if (pc < 0) return false;
    if (/b/.test(normalizeAccidentals(tonic))) return true;
    if (/#/.test(normalizeAccidentals(tonic))) return false;
    const relativeMajor = quality === 'minor' ? (pc + 3) % 12 : pc;
    return FLAT_KEY_PCS.has(relativeMajor);
  }

  // ===================================================================
  // CHORD SYMBOLS
  // ===================================================================

  // Interval sets in semitones above the root.
  const QUALITIES = {
    'maj':    { pcs: [0, 4, 7],             essential: [0, 4] },
    'm':      { pcs: [0, 3, 7],             essential: [0, 3] },
    'dim':    { pcs: [0, 3, 6],             essential: [0, 3, 6] },
    'aug':    { pcs: [0, 4, 8],             essential: [0, 4, 8] },
    '5':      { pcs: [0, 7],                essential: [0, 7] },
    'sus2':   { pcs: [0, 2, 7],             essential: [0, 2] },
    'sus4':   { pcs: [0, 5, 7],             essential: [0, 5] },
    '6':      { pcs: [0, 4, 7, 9],          essential: [0, 4, 9] },
    'm6':     { pcs: [0, 3, 7, 9],          essential: [0, 3, 9] },
    '7':      { pcs: [0, 4, 7, 10],         essential: [0, 4, 10] },
    'maj7':   { pcs: [0, 4, 7, 11],         essential: [0, 4, 11] },
    'm7':     { pcs: [0, 3, 7, 10],         essential: [0, 3, 10] },
    'mmaj7':  { pcs: [0, 3, 7, 11],         essential: [0, 3, 11] },
    'dim7':   { pcs: [0, 3, 6, 9],          essential: [0, 3, 6, 9] },
    'm7b5':   { pcs: [0, 3, 6, 10],         essential: [0, 3, 6, 10] },
    '7sus4':  { pcs: [0, 5, 7, 10],         essential: [0, 5, 10] },
    'add9':   { pcs: [0, 2, 4, 7],          essential: [0, 2, 4] },
    'madd9':  { pcs: [0, 2, 3, 7],          essential: [0, 2, 3] },
    '9':      { pcs: [0, 2, 4, 7, 10],      essential: [0, 4, 10] },
    'maj9':   { pcs: [0, 2, 4, 7, 11],      essential: [0, 4, 11] },
    'm9':     { pcs: [0, 2, 3, 7, 10],      essential: [0, 3, 10] },
    '11':     { pcs: [0, 2, 5, 7, 10],      essential: [0, 5, 10] },
    'm11':    { pcs: [0, 2, 3, 5, 7, 10],   essential: [0, 3, 10] },
    '13':     { pcs: [0, 2, 4, 7, 9, 10],   essential: [0, 4, 9, 10] },
    '7b9':    { pcs: [0, 1, 4, 7, 10],      essential: [0, 1, 4, 10] },
    '7#9':    { pcs: [0, 3, 4, 7, 10],      essential: [0, 3, 4, 10] },
    '7b5':    { pcs: [0, 4, 6, 10],         essential: [0, 4, 6, 10] },
    '7#5':    { pcs: [0, 4, 8, 10],         essential: [0, 4, 8, 10] }
  };

  // Spellings a human (or the existing pages) might type, mapped to the canonical key.
  const SUFFIX_ALIASES = {
    '': 'maj', 'M': 'maj', 'maj': 'maj', 'major': 'maj',
    'm': 'm', '-': 'm', 'min': 'm', 'minor': 'm',
    'dim': 'dim', 'o': 'dim', '°': 'dim',
    'dim7': 'dim7', 'o7': 'dim7', '°7': 'dim7',
    'aug': 'aug', '+': 'aug',
    'm7b5': 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', 'min7b5': 'm7b5', '-7b5': 'm7b5', 'halfdim': 'm7b5',
    'sus': 'sus4', 'sus2': 'sus2', 'sus4': 'sus4',
    '7sus': '7sus4', '7sus4': '7sus4',
    '6': '6', 'maj6': '6', 'M6': '6',
    'm6': 'm6', 'min6': 'm6', '-6': 'm6',
    '7': '7', 'dom7': '7',
    'maj7': 'maj7', 'M7': 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', 'ma7': 'maj7',
    'm7': 'm7', 'min7': 'm7', '-7': 'm7',
    'mmaj7': 'mmaj7', 'mM7': 'mmaj7', 'minmaj7': 'mmaj7',
    'add9': 'add9', 'madd9': 'madd9', 'madd 9': 'madd9',
    '9': '9', 'maj9': 'maj9', 'M9': 'maj9', 'm9': 'm9', 'min9': 'm9', '-9': 'm9',
    '11': '11', 'm11': 'm11', 'min11': 'm11',
    '13': '13',
    '7b9': '7b9', '7#9': '7#9', '7b5': '7b5', '7#5': '7#5', '7+5': '7#5',
    '5': '5', 'no3': '5', 'power': '5'
  };

  function normalizeSuffix(raw) {
    let s = normalizeAccidentals(raw || '').replace(/[()\s]/g, '');
    if (SUFFIX_ALIASES[s] !== undefined) return SUFFIX_ALIASES[s];
    // Case-insensitive retry, except for the M/m distinction which is meaningful.
    const lower = s.toLowerCase();
    for (const k in SUFFIX_ALIASES) {
      if (k.toLowerCase() === lower && k.toLowerCase() !== 'm') return SUFFIX_ALIASES[k];
    }
    return null;
  }

  // One chord token: root, optional suffix, optional slash bass. The root accepts
  // up to two accidentals so a pasted Bbb or F## is read rather than silently
  // half-matched into a different chord; the generator itself never emits them.
  const CHORD_RE = /^([A-G][#b♯♭]{0,2})((?:maj|min|sus|add|dim|aug|alt|[Mm+°ø\-#b♯♭0-9()])*)(?:\/([A-G][#b♯♭]{0,2}))?/;

  /** Parse a chord symbol. Returns null when the symbol is not readable. */
  function parseChord(symbol) {
    if (!symbol) return null;
    const s = normalizeAccidentals(String(symbol).trim());
    const m = s.match(CHORD_RE);
    if (!m || m[0].length !== s.length) return null;

    const rootPc = noteToPc(m[1]);
    if (rootPc < 0) return null;
    const qual = normalizeSuffix(m[2]);
    if (qual === null) return null;

    const spec = QUALITIES[qual];
    const bassPc = m[3] ? noteToPc(m[3]) : null;

    return {
      symbol: s,
      root: m[1],
      rootPc,
      quality: qual,
      bass: m[3] || null,
      bassPc,
      // Absolute pitch classes that may sound.
      pcs: spec.pcs.map(i => (rootPc + i) % 12).concat(bassPc === null ? [] : [bassPc]),
      // Pitch classes that MUST sound for the chord to be itself.
      essentialPcs: spec.essential.map(i => (rootPc + i) % 12),
      intervals: spec.pcs.slice()
    };
  }

  function isMinorish(parsed) {
    return parsed && /^(m|dim|m7|m6|m9|m11|mmaj7|dim7|m7b5|madd9)$/.test(parsed.quality);
  }

  // ===================================================================
  // PROGRESSION TEXT  (tokenizing keeps the separators so display is byte-faithful)
  // ===================================================================

  function tokenizeProgression(text) {
    const tokens = [];
    let i = 0;
    const src = String(text || '');
    while (i < src.length) {
      const ch = src[i];
      if (ch >= 'A' && ch <= 'G') {
        const m = src.slice(i).match(CHORD_RE);
        if (m && m[0].length > 0 && parseChord(m[0])) {
          tokens.push({ type: 'chord', name: m[0] });
          i += m[0].length;
          continue;
        }
      }
      tokens.push({ type: 'sep', text: ch });
      i++;
    }
    return tokens;
  }

  function progressionChords(text) {
    return tokenizeProgression(text).filter(t => t.type === 'chord').map(t => t.name);
  }

  function uniqueProgressionChords(text) {
    const seen = new Set();
    const out = [];
    for (const name of progressionChords(text)) {
      if (!seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out;
  }

  // ===================================================================
  // TUNING  ->  MIDI
  // ===================================================================

  /** Map a tuning given as note names (low string first) to MIDI numbers.
   *  String 0 lands in the C2..B2 octave, each next string is the nearest pitch
   *  above the previous one, which reproduces every standard preset (EADGBE,
   *  DADGAD, open C, ...) without asking the caller for octaves. */
  function tuningToMidi(tuning) {
    const out = [];
    for (let i = 0; i < tuning.length; i++) {
      const pc = noteToPc(tuning[i]);
      if (pc < 0) return null;
      if (i === 0) { out.push(36 + pc); continue; }
      const prev = out[i - 1];
      let step = (pc - (prev % 12) + 12) % 12;
      if (step === 0) step = 12;
      out.push(prev + step);
    }
    return out;
  }

  // ===================================================================
  // VOICING GENERATOR
  // ===================================================================

  const VOICING_DEFAULTS = {
    maxResults: 8,
    maxWindow: 12,     // highest starting fret searched
    minSounding: 3,
    maxFingers: 4,
    maxInteriorMutes: 1
  };

  function fingerCount(frets) {
    const fretted = frets.filter(f => f > 0);
    if (fretted.length === 0) return 0;
    const minF = Math.min(...fretted);
    const atMin = fretted.filter(f => f === minF).length;
    const above = fretted.filter(f => f > minF).length;
    // Several strings sharing the lowest fret are taken by one barring finger.
    return (atMin > 0 ? 1 : 0) + above;
  }

  function hasBarre(frets) {
    const fretted = frets.filter(f => f > 0);
    if (fretted.length < 2) return false;
    const minF = Math.min(...fretted);
    return fretted.filter(f => f === minF).length >= 2;
  }

  function interiorMutes(frets) {
    const first = frets.findIndex(f => f >= 0);
    const last = frets.length - 1 - frets.slice().reverse().findIndex(f => f >= 0);
    if (first < 0) return 0;
    let n = 0;
    for (let i = first; i <= last; i++) if (frets[i] === -1) n++;
    return n;
  }

  // Which chord tone is in the bass: 0 root, 1/2/3 first/second/third inversion,
  // null when the bass is a note the chord does not otherwise contain.
  function inversionOf(bassPc, parsed) {
    if (bassPc === parsed.rootPc) return 0;
    const at = parsed.intervals.indexOf(((bassPc - parsed.rootPc) + 12) % 12);
    return at > 0 ? at : null;
  }

  function inversionLabel(bassPc, parsed) {
    const inv = inversionOf(bassPc, parsed);
    if (inv === 0) return '';
    if (inv === 1) return ' · 1st inv';
    if (inv === 2) return ' · 2nd inv';
    if (inv === 3) return ' · 3rd inv';
    return ' · ' + spellNote(bassPc, false) + ' bass';
  }

  /**
   * Search the fretboard for playable shapes of `symbol` in `tuning`.
   * Returns [{ name, frets, baseFret, barre, score, _generated }], best first.
   */
  function generateVoicings(symbol, tuning, options) {
    const opts = Object.assign({}, VOICING_DEFAULTS, options || {});
    const parsed = parseChord(symbol);
    if (!parsed) return [];
    const open = tuningToMidi(tuning);
    if (!open) return [];

    const nStrings = open.length;
    const allowed = new Set(parsed.pcs);
    const essential = parsed.essentialPcs;
    const results = [];
    const seen = new Set();

    for (let win = 0; win <= opts.maxWindow; win++) {
      const frets = new Array(nStrings).fill(-1);

      // Fret options for one string in this window: mute, open, or the 4-fret box.
      const choices = [];
      choices.push(-1);
      if (win === 0) { for (let f = 0; f <= 3; f++) choices.push(f); }
      else { choices.push(0); for (let f = win; f <= win + 3; f++) choices.push(f); }

      (function walk(s) {
        if (s === nStrings) { consider(frets.slice()); return; }
        for (const f of choices) {
          if (f >= 0) {
            const pc = (open[s] + f) % 12;
            if (!allowed.has(pc)) continue;   // prune: never sound a wrong note
          }
          frets[s] = f;
          walk(s + 1);
        }
        frets[s] = -1;
      })(0);
    }

    function consider(frets) {
      const soundingIdx = [];
      for (let i = 0; i < frets.length; i++) if (frets[i] >= 0) soundingIdx.push(i);
      if (soundingIdx.length < opts.minSounding) return;

      const pcs = new Set(soundingIdx.map(i => (open[i] + frets[i]) % 12));
      for (const need of essential) if (!pcs.has(need)) return;

      const fingers = fingerCount(frets);
      if (fingers > opts.maxFingers) return;

      const mutes = interiorMutes(frets);
      if (mutes > opts.maxInteriorMutes) return;

      const fretted = frets.filter(f => f > 0);
      const minF = fretted.length ? Math.min(...fretted) : 0;
      const maxF = fretted.length ? Math.max(...fretted) : 0;
      if (fretted.length && maxF - minF > 3) return;

      const key = frets.join(',');
      if (seen.has(key)) return;
      seen.add(key);

      const bassPc = (open[soundingIdx[0]] + frets[soundingIdx[0]]) % 12;
      const openCount = frets.filter(f => f === 0).length;

      // Weights tuned against the shapes a guitarist actually plays: root in the
      // bass dominates, open position beats a barre up the neck, and a shape that
      // mixes open strings with high frets is legal but awkward, so it sinks.
      let score = 0;
      score += 1.2 * (soundingIdx.length - opts.minSounding);
      score += (bassPc === parsed.rootPc) ? 4.0 : 0;
      score += (bassPc === (parsed.rootPc + 7) % 12) ? 0.5 : 0;
      score += Math.min(openCount, 3) * 1.0;
      score -= 0.7 * fingers;
      score -= 0.45 * minF;
      score -= 1.5 * mutes;
      if (parsed.pcs.every(pc => pcs.has(pc))) score += 1.2;   // nothing omitted
      if (minF <= 3 && openCount > 0) score += 1.5;            // true open position
      if (openCount > 0 && maxF > 5) score -= 2.0;             // open strings under a high grip

      const baseFret = (openCount > 0 || fretted.length === 0) ? 1 : minF;
      const barre = hasBarre(frets) && openCount === 0 ? minF : null;

      // `meta` describes the shape; `name` is its English rendering. The caller
      // formats from meta when it needs another language, so the wording of a
      // diagram label is a display concern and not baked in here.
      const meta = {
        position: fretted.length ? minF : 0,
        openPosition: (minF <= 1 && openCount > 0) || fretted.length === 0,
        allOpen: fretted.length === 0,
        barre: !!barre,
        inversion: inversionOf(bassPc, parsed),
        bass: spellNote(bassPc, false)
      };

      let name;
      if (meta.allOpen) name = 'open strings';
      else if (meta.openPosition) name = 'open position';
      else name = ordinal(minF) + ' fret' + (barre ? ' · barre' : '');
      name += inversionLabel(bassPc, parsed);

      results.push({ name, meta, frets, baseFret, barre, score, _generated: true });
    }

    results.sort((a, b) => b.score - a.score);
    if (opts.all) return results;

    // Spread the offered shapes over the neck instead of returning eight fingerings
    // of one box. Deliberately NOT deduped by "differs on one string": muting the
    // low E rather than playing it changes the bass note, so x02210 and 002210 are
    // two different chords, not two spellings of one.
    const kept = [];
    const bucket = new Map();
    for (const v of results) {
      if (kept.length >= opts.maxResults) break;
      const fretted = v.frets.filter(f => f > 0);
      const pos = fretted.length ? Math.min(...fretted) : 0;
      const soundingIdx = v.frets.findIndex(f => f >= 0);
      const bassPc = (open[soundingIdx] + v.frets[soundingIdx]) % 12;
      const k = pos + '|' + bassPc;
      const n = bucket.get(k) || 0;
      if (n >= 2) continue;
      bucket.set(k, n + 1);
      kept.push(v);
    }
    return kept;
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ===================================================================
  // MODES  (diatonic chords derived from the scale, never hand-listed)
  // ===================================================================

  let VOCAB = null;

  function setVocabulary(json) { VOCAB = json; MODE_CACHE = {}; }
  function getVocabulary() { return VOCAB; }

  let MODE_CACHE = {};

  const MAJOR_REF = [0, 2, 4, 5, 7, 9, 11];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  function triadQuality(third, fifth) {
    if (third === 4 && fifth === 7) return 'maj';
    if (third === 3 && fifth === 7) return 'm';
    if (third === 3 && fifth === 6) return 'dim';
    if (third === 4 && fifth === 8) return 'aug';
    if (third === 2 && fifth === 7) return 'sus2';
    if (third === 5 && fifth === 7) return 'sus4';
    if (third === 4 && fifth === 6) return '7b5';   // rare, treat the b5 as characteristic
    if (third === 3 && fifth === 8) return 'm';     // no clean triad, minor is the closest read
    return 'maj';
  }

  function seventhSuffix(triad, seventh) {
    if (triad === 'maj') return seventh === 11 ? 'maj7' : seventh === 10 ? '7' : 'maj7';
    if (triad === 'm')   return seventh === 10 ? 'm7' : seventh === 11 ? 'mmaj7' : 'm7';
    if (triad === 'dim') return seventh === 9 ? 'dim7' : 'm7b5';
    if (triad === 'aug') return seventh === 10 ? '7#5' : 'maj7';
    return triad;
  }

  /** The seven diatonic chords of a mode, as degree records. */
  function modeDegrees(modeId) {
    if (MODE_CACHE[modeId]) return MODE_CACHE[modeId];
    if (!VOCAB || !VOCAB.modes[modeId]) throw new Error('unknown mode: ' + modeId);
    const scale = VOCAB.modes[modeId].scale;
    const out = [];
    for (let i = 0; i < 7; i++) {
      const rootIv = scale[i];
      const third  = (scale[(i + 2) % 7] - rootIv + 24) % 12;
      const fifth  = (scale[(i + 4) % 7] - rootIv + 24) % 12;
      const sev    = (scale[(i + 6) % 7] - rootIv + 24) % 12;
      const triad = triadQuality(third, fifth);

      const alt = rootIv - MAJOR_REF[i];
      const prefix = alt === -1 ? 'b' : alt === 1 ? '#' : alt === -2 ? 'bb' : '';
      const numeral = (triad === 'm' || triad === 'dim') ? ROMAN[i].toLowerCase() : ROMAN[i];
      const mark = triad === 'dim' ? '°' : triad === 'aug' ? '+' : '';

      out.push({
        index: i,
        semitone: rootIv,
        triad,
        seventh: seventhSuffix(triad, sev),
        roman: prefix + numeral + mark,
        preferFlat: prefix === 'b' || prefix === 'bb'
      });
    }
    MODE_CACHE[modeId] = out;
    return out;
  }

  // Canonical quality key -> what a chart prints. "Gmmaj7" is legal input but
  // nobody writes it that way; parseChord reads the parenthesised form back.
  const DISPLAY_SUFFIX = { maj: '', mmaj7: 'm(maj7)' };

  function qualityToSuffix(q) {
    return DISPLAY_SUFFIX[q] !== undefined ? DISPLAY_SUFFIX[q] : q;
  }

  // ===================================================================
  // PROGRESSION GENERATOR
  // ===================================================================

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  function pickWeighted(rng, arr, weightOf) {
    const total = arr.reduce((s, x) => s + (weightOf(x) || 1), 0);
    let r = rng() * total;
    for (const x of arr) { r -= (weightOf(x) || 1); if (r <= 0) return x; }
    return arr[arr.length - 1];
  }

  /** Which modes make sense for a tonic of this quality. */
  function modesForKey(quality) {
    const ids = Object.keys(VOCAB.modes);
    return ids.filter(id => VOCAB.modes[id].tonicQuality === (quality === 'minor' ? 'minor' : 'major'));
  }

  // ---- token -> chord --------------------------------------------------

  // A token becomes { semitone, suffix, label } relative to the tonic.
  function realizeToken(token, degrees) {
    const T = tok => realizeToken(tok, degrees);

    if (/^[1-7]$/.test(token)) {
      const i = parseInt(token, 10) - 1;
      const d = degrees[i];
      return { semitone: d.semitone, suffix: qualityToSuffix(d.triad), label: d.roman, degree: i };
    }
    if (token === 'V')  return { semitone: 7,  suffix: '',  label: 'V',    degree: 4 };
    if (token === 'V7') return { semitone: 7,  suffix: '7', label: 'V7',   degree: 4 };
    if (token === 'v')  return { semitone: 7,  suffix: 'm', label: 'v',    degree: 4 };
    if (token === '4m') return { semitone: 5,  suffix: 'm', label: 'iv',   degree: 3 };
    if (token === 'b2') return { semitone: 1,  suffix: '',  label: 'bII',  degree: 1 };
    if (token === 'b3') return { semitone: 3,  suffix: '',  label: 'bIII', degree: 2 };
    if (token === 'b6') return { semitone: 8,  suffix: '',  label: 'bVI',  degree: 5 };
    if (token === 'b7') return { semitone: 10, suffix: '',  label: 'bVII', degree: 6 };
    if (token === '3M') return { semitone: 4,  suffix: '',  label: 'III',  degree: 2 };
    if (token === '6M') return { semitone: 9,  suffix: '',  label: 'VI',   degree: 5 };
    if (token === 'TT') return { semitone: 1,  suffix: '7', label: 'bII7 (tritone sub)', degree: 1 };

    // A borrowed chord is spelled the way its target is spelled: the dominant of
    // Eb is Bb, never A#, even in a key whose signature uses sharps.
    const sec = token.match(/^S\/(.+)$/);
    if (sec) {
      const target = T(sec[1]);
      return { semitone: (target.semitone + 7) % 12, suffix: '7', label: 'V7/' + target.label,
               degree: (target.degree + 4) % 7 };
    }
    const dim = token.match(/^o\/(.+)$/);
    if (dim) {
      const target = T(dim[1]);
      // A passing diminished sits a semitone BELOW its target and rises into it,
      // so it takes the letter below: C#dim7 into D, never Dbdim7.
      return { semitone: (target.semitone + 11) % 12, suffix: 'dim7', label: '°7 → ' + target.label,
               degree: (target.degree + 6) % 7 };
    }
    throw new Error('unknown progression token: ' + token);
  }

  function tokensToChords(tokens, tonic, degrees, keyPrefersFlat) {
    return tokens.map(tok => {
      const r = realizeToken(tok, degrees);
      return {
        token: tok,
        symbol: spellDegree(tonic, r.degree, r.semitone, keyPrefersFlat) + r.suffix,
        label: r.label
      };
    });
  }

  // ---- skeleton builders ----------------------------------------------

  const FUNCTIONS = { tonic: ['1', '6', '3'], subdominant: ['4', '2', '6'], dominant: ['5', '7'] };

  function buildFunctional(rng, degrees) {
    const seq = ['1'];
    if (rng() < 0.5) seq.push(pick(rng, FUNCTIONS.tonic.slice(1)));
    seq.push(pick(rng, FUNCTIONS.subdominant));
    if (rng() < 0.4) seq.push(pick(rng, FUNCTIONS.subdominant));
    // A minor v has no leading tone; borrow the major V often, as practice does.
    const dom = degrees[4].triad === 'm' && rng() < 0.7 ? 'V' : pick(rng, FUNCTIONS.dominant);
    seq.push(dom);
    seq.push('1');
    return seq;
  }

  function buildCircle(rng) {
    const chain = ['4', '7', '3', '6', '2', '5', '1'];
    const len = 3 + Math.floor(rng() * 3);           // 3..5 links, tonic included
    return chain.slice(chain.length - len);
  }

  function buildInterchange(rng) {
    const shapes = [
      ['1', 'b7', 'b6', '1'],
      ['1', '4m', '1'],
      ['1', 'b6', 'b7', '1'],
      ['1', '4', '4m', '1'],
      ['1', 'b3', 'b7', '1']
    ];
    return pick(rng, shapes).slice();
  }

  function buildMediant(rng) {
    const shapes = [
      ['1', 'b3', '1', 'b6'],
      ['1', 'b6', 'b3', '1'],
      ['1', '3M', '1', 'b6'],
      ['1', 'b3', 'b6', '1']
    ];
    return pick(rng, shapes).slice();
  }

  const GENERATORS = {
    functional: buildFunctional,
    circle: (rng) => buildCircle(rng),
    interchange: (rng) => buildInterchange(rng),
    mediant: (rng) => buildMediant(rng)
  };

  // ---- decorators ------------------------------------------------------

  function applyDecorators(tokens, rng, degrees, enabled) {
    const notes = [];
    const cfg = {};
    for (const d of (VOCAB.decorators || [])) cfg[d.id] = d;
    const on = id => enabled !== false && cfg[id] && rng() < cfg[id].probability;

    let out = tokens.slice();

    // Secondary dominant before a non-tonic diatonic degree.
    if (on('secondary-dominant')) {
      const spots = [];
      for (let i = 1; i < out.length; i++) if (/^[2-7]$/.test(out[i])) spots.push(i);
      if (spots.length) {
        const at = pick(rng, spots);
        out.splice(at, 0, 'S/' + out[at]);
        notes.push('secondary-dominant');
      }
    }

    // Tritone substitute for a plain dominant.
    if (on('tritone-sub')) {
      const at = out.findIndex(t => t === 'V' || t === 'V7' || t === '5');
      if (at >= 0) { out[at] = 'TT'; notes.push('tritone-sub'); }
    }

    // Passing diminished into a later chord.
    if (on('passing-dim') && out.length > 2) {
      const at = 1 + Math.floor(rng() * (out.length - 1));
      if (/^[1-7]$/.test(out[at])) {
        out.splice(at, 0, 'o/' + out[at]);
        notes.push('passing-dim');
      }
    }

    const realized = tokensToChords(out, 'C', degrees, false);

    // Sevenths / add9 / sus are suffix edits, applied after realization so they
    // ride on whatever the token produced.
    const suffixEdits = [];
    if (on('seventh')) suffixEdits.push('seventh');
    if (on('add9')) suffixEdits.push('add9');
    if (on('sus-resolution')) suffixEdits.push('sus');

    return { tokens: out, notes, suffixEdits, realizedPreview: realized };
  }

  function applySuffixEdits(chords, edits, rng, degrees) {
    const cfg = {};
    for (const d of (VOCAB.decorators || [])) cfg[d.id] = d;
    const notes = [];
    let out = chords.map(c => Object.assign({}, c));

    if (edits.includes('seventh')) {
      // One or two chords gain their diatonic seventh; the tonic is left alone
      // so the phrase still lands somewhere plain.
      const spots = out.map((c, i) => i).filter(i => i > 0 && i < out.length - 1);
      const n = spots.length ? 1 + (rng() < 0.4 ? 1 : 0) : 0;
      for (let k = 0; k < n && spots.length; k++) {
        const at = spots.splice(Math.floor(rng() * spots.length), 1)[0];
        const c = out[at];
        const deg = degrees.find(d => d.roman === c.label);
        const sev = deg ? deg.seventh : null;
        if (sev) {
          const p = parseChord(c.symbol);
          if (p) { c.symbol = p.root + qualityToSuffix(sev); c.label += ' (7th)'; }
        }
      }
      if (n > 0) notes.push('seventh');
    }

    if (edits.includes('add9')) {
      const at = Math.floor(rng() * out.length);
      const p = parseChord(out[at].symbol);
      if (p && (p.quality === 'maj' || p.quality === 'm')) {
        out[at].symbol = p.root + (p.quality === 'm' ? 'madd9' : 'add9');
        notes.push('add9');
      }
    }

    if (edits.includes('sus')) {
      for (let i = 0; i + 1 < out.length; i++) {
        if (out[i].symbol === out[i + 1].symbol) {
          const p = parseChord(out[i].symbol);
          if (p && (p.quality === 'maj' || p.quality === 'm')) {
            out[i] = Object.assign({}, out[i], { symbol: p.root + 'sus4' });
            notes.push('sus-resolution');
            break;
          }
        }
      }
    }

    return { chords: out, notes };
  }

  // ---- bar layout ------------------------------------------------------

  function layoutBars(symbolsIn, rng, form) {
    const counts = (form && form.barCounts) || [4];
    const perBar = (form && form.chordsPerBar) || [1, 1, 2];
    let symbols = symbolsIn.slice();
    let bars = pick(rng, counts);
    bars = Math.max(bars, Math.ceil(symbols.length / 2));

    // An eight-bar form over a four-chord cycle is the cycle played twice, not the
    // cycle followed by four bars of the last chord.
    if (symbols.length >= 3 && bars >= symbols.length * 2) {
      const reps = Math.floor(bars / symbols.length);
      const cycle = symbols.slice();
      for (let r = 1; r < reps; r++) symbols = symbols.concat(cycle);
    }
    // Never hold the final chord for more than one extra bar.
    bars = Math.min(bars, symbols.length + 1);

    const out = [];
    let i = 0;
    for (let b = 0; b < bars; b++) {
      const remainingBars = bars - b;
      const remainingChords = symbols.length - i;
      let take;
      if (remainingChords <= 0) take = 0;
      else if (remainingChords >= remainingBars * 2) take = 2;
      else if (remainingChords <= remainingBars) take = 1;
      else take = pick(rng, perBar);
      take = Math.min(take, remainingChords);

      if (take === 0) out.push([symbols[symbols.length - 1]]);   // hold the last chord
      else { out.push(symbols.slice(i, i + take)); i += take; }
    }
    // Anything left over is appended so no chord is silently dropped.
    while (i < symbols.length) { out.push(symbols.slice(i, i + 1)); i++; }

    // A seed that already ends on two tonic bars plus a hold bar would sit on the
    // same chord three times. Two is a cadence; three is dead air.
    const same = b => b.join(' ');
    while (out.length > 2 && same(out[out.length - 1]) === same(out[out.length - 2])
                          && same(out[out.length - 2]) === same(out[out.length - 3])) {
      out.pop();
    }

    return '| ' + out.map(b => b.join(' ')).join(' | ') + ' |';
  }

  // ---- the public call -------------------------------------------------

  /**
   * Invent a progression.
   * @param {{tonic:string, quality:string}} key   e.g. { tonic:'D', quality:'minor' }
   * @param {{mode?:string, strategy?:string, seed?:number, decorate?:boolean}} options
   * @returns {{text, chords, mode, modeLabel, strategy, strategyLabel, explain, notes, degreeLine}}
   */
  function generateProgression(key, options) {
    if (!VOCAB) throw new Error('vocabulary not loaded: call setVocabulary(json) first');
    const opts = options || {};
    const rng = opts.seed === undefined ? Math.random : mulberry32(opts.seed);

    const tonicPc = noteToPc(key.tonic);
    if (tonicPc < 0) throw new Error('unreadable tonic: ' + key.tonic);
    const keyPrefersFlat = keyPrefersFlats(key.tonic, key.quality);

    // Mode: explicit, else one that fits the tonic quality.
    let modeId = opts.mode;
    if (!modeId || !VOCAB.modes[modeId]) {
      const candidates = modesForKey(key.quality);
      modeId = pick(rng, candidates);
    }
    const mode = VOCAB.modes[modeId];
    const degrees = modeDegrees(modeId);

    // Strategy: explicit, else one that declares this mode.
    let strategy = opts.strategy
      ? VOCAB.strategies.find(s => s.id === opts.strategy)
      : null;
    if (!strategy) {
      const usable = VOCAB.strategies.filter(s => s.modes.indexOf(modeId) >= 0);
      if (usable.length === 0) throw new Error('no strategy declares mode ' + modeId);
      strategy = pickWeighted(rng, usable, s => s.weight);
    }

    // Skeleton.
    let tokens;
    if (strategy.generator) tokens = GENERATORS[strategy.generator](rng, degrees);
    else tokens = pick(rng, strategy.seeds).slice();

    const dec = applyDecorators(tokens, rng, degrees, opts.decorate);
    let chords = tokensToChords(dec.tokens, key.tonic, degrees, keyPrefersFlat);
    const edited = applySuffixEdits(chords, dec.suffixEdits, rng, degrees);
    chords = edited.chords;

    const text = layoutBars(chords.map(c => c.symbol), rng, VOCAB.form);

    return {
      text,
      chords,
      mode: modeId,
      modeLabel: mode.label,
      modeNote: mode.note,
      family: mode.family,
      strategy: strategy.id,
      strategyLabel: strategy.label,
      explain: strategy.explain,
      notes: dec.notes.concat(edited.notes),
      degreeLine: chords.map(c => c.label).join(' – '),
      tonic: spellNote(tonicPc, keyPrefersFlat),
      keyLabel: spellNote(tonicPc, keyPrefersFlat) + ' ' + mode.label
    };
  }

  // ===================================================================

  return {
    // notes
    noteToPc, spellNote, spellDegree, normalizeAccidentals,
    // symbols
    parseChord, isMinorish, QUALITIES, normalizeSuffix,
    // progression text
    tokenizeProgression, progressionChords, uniqueProgressionChords,
    // fretboard
    tuningToMidi, generateVoicings, fingerCount, hasBarre, interiorMutes,
    // modes
    setVocabulary, getVocabulary, modeDegrees, modesForKey,
    // generation
    generateProgression, mulberry32
  };
});
