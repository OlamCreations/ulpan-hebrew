/* chord-key.mjs — derive a song's key from the chord grid it already declares.
 *
 * WHY THIS FILE EXISTS. The page template used to carry the key as a literal.
 * Someone wrote `key: 'Am'` with a comment saying it was inferred from the grid,
 * which was true of the one page it was written on. Copied 140 times it became
 * false on 126 of them: psalms whose grid is in Dm, Em, C, G, D or F all shipped
 * declaring Am. `songKey()` in assets/chords.js reads that field and hands the
 * tonic to the shuffle generator, so pressing shuffle produced chords from a
 * different scale than the one printed directly above the button. Nothing was
 * red, because nothing looked.
 *
 * A derived value cannot drift from its source the way a copied one can. But
 * derivation is only worth more than a literal if the rule is measured rather
 * than assumed, so the rule below was checked against every grid in the corpus
 * before it was written:
 *
 *   first chord === last chord            126 / 140
 *   last chord = dominant of the first      14 / 140
 *   anything else                            0 / 140
 *
 * That is the songbook convention: the grid opens on the tonic and either
 * returns to it or hangs on the V. So the tonic is the OPENING chord, and the
 * closing chord is used as a check on that reading, not as the reading itself.
 * A grid that satisfies neither relation is not a key this rule can name, and
 * deriveKey throws instead of picking one — the whole point is to stop shipping
 * a confident wrong key.
 */

/* Pitch classes. Enharmonics collapse: the interval test only cares about
   distance, and a grid mixing D# and Eb must not read as two different keys. */
const PITCH = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
};

/** The chord symbols of a grid, in order, with the bar lines removed. */
export function chordsOf(progression) {
  return String(progression || '')
    .replace(/\|/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Root pitch class of a chord symbol, or null if it does not start with a note. */
export function rootOf(chord) {
  const m = String(chord).match(/^([A-G][#b]?)/);
  return m ? PITCH[m[1]] : null;
}

/** True when `b` sits a perfect fifth above `a` — i.e. b is the V of a. */
function isDominantOf(b, a) {
  const ra = rootOf(a), rb = rootOf(b);
  if (ra === null || rb === null) return false;
  return ((rb - ra) % 12 + 12) % 12 === 7;
}

/**
 * The key a grid is in, as a chord symbol ('Am', 'Dm', 'C', ...), which is the
 * form `songKey()` in assets/chords.js parses.
 *
 * @param {string} progression  e.g. '| Am Am | Dm Dm | Am Em | Am Am |'
 * @param {string} [label]      what to name in the error, e.g. 'psalm 23'
 * @throws when the grid is empty, unparseable, or resolves neither to itself
 *         nor to its own dominant — see the header for why that throws.
 */
export function deriveKey(progression, label = 'grid') {
  const chords = chordsOf(progression);
  if (!chords.length) throw new Error(`${label}: empty chord grid, no key to derive`);

  const first = chords[0];
  const last = chords[chords.length - 1];
  if (rootOf(first) === null) throw new Error(`${label}: "${first}" is not a chord symbol`);
  if (rootOf(last) === null) throw new Error(`${label}: "${last}" is not a chord symbol`);

  if (first === last || isDominantOf(last, first)) return first;

  throw new Error(
    `${label}: grid opens on ${first} and closes on ${last}, which is neither the same `
    + `chord nor its dominant. The tonic cannot be read off this grid; name the key in the `
    + `authored file instead of letting a rule guess it.`
  );
}
