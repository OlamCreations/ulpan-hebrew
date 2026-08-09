/* chords.js — the chord chart on the song pages.
 *
 * Replaces the 1153-line block that used to be pasted into all seven song files.
 * Each page now declares only what is true of that song:
 *
 *   <script>window.SONG_CHORDS = {
 *     id: 'hatikvah', key: 'Dm', tempo: 76, meter: '4/4',
 *     progression: '| Dm Dm | Gm A | Dm A | Dm |'
 *   };</script>
 *   <script src="../assets/chord-theory.js" defer></script>
 *   <script src="../assets/chords.js" defer></script>
 *
 * Harmony, fretboard search and progression invention live in chord-theory.js,
 * which has no DOM and is covered by tools/chords-test.mjs. This file is the part
 * that draws and listens.
 */
(function () {
  'use strict';

  const Theory = window.ChordTheory;
  if (!Theory) { console.warn('[chords] chord-theory.js must load first'); return; }

  const SONG = window.SONG_CHORDS || {};
  const SONG_ID = SONG.id || 'song';

  // Storage keys. The tuning, the fingerings you entered and the shapes you pinned
  // describe YOUR guitar, so they are shared across songs. The progression belongs
  // to one song: the old build kept it under a single global key, so editing the
  // grid on Hatikvah silently rewrote it on Hava Nagila.
  const K_TUNING = 'chords:tuning';
  const K_USER   = 'chords:userVoicings';
  const K_PINS   = 'chords:pins';
  const K_PROG   = 'chords:prog:' + SONG_ID;

  const STD_TUNING = ['E', 'A', 'D', 'G', 'B', 'E'];

  function readJSON(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ===================================================================
  // LANGUAGE
  // The chart speaks whatever the page around it speaks. Most of the site is in
  // English; the ten French copies of the psalms declare lang="fr" and used to
  // carry a French copy of this engine, so reading <html lang> keeps both right
  // without a per-page setting to forget.
  // ===================================================================

  const I18N = {
    en: {
      shuffle: '⟳ shuffle', shuffleTitle: 'Invent a new progression in this key',
      hear: '♪ hear it', stop: '■ stop', hearTitle: 'Play the grid above at this song\'s tempo',
      modeField: 'mode', ideaField: 'idea',
      anyOf: q => `any (${q})`, any: 'any',
      minor: 'minor', major: 'major',
      jewishModes: 'Jewish modes', westernModes: 'Western modes',
      undo: '↶ undo shuffle', undoTitle: 'Put the previous progression back',
      genFailed: 'Could not build a progression:',
      noAudio: 'This browser has no Web Audio support, so the grid cannot be played here.',
      tuningNote: t => `Shapes below are computed for ${t}. The hand-picked standard-tuning library is set aside while this tuning is active.`,
      noShapeIn: t => `No playable shape in ${t}.`, hoverToAdd: 'Hover to add your own.',
      unpin: 'Remove from the panel',
      replace: '✎ replace', addFingering: '+ fingering', neighbours: '⚇ neighbours',
      noShapeFor: (c, t) => `No playable shape for <strong style="color:var(--text)">${c}</strong><br>in <strong style="color:var(--text)">${t}</strong>.`,
      clickToAdd: n => `Click <strong style="color:var(--accent)">${n}</strong> to enter your own.`,
      prevShape: 'previous shape', nextShape: 'next shape',
      pinAdd: 'Pin to the printable panel', pinRemove: 'Remove from the printable panel',
      yours: '★ yours', computed: 'computed', deleteFingering: 'delete this fingering',
      fingeringTitle: (c, t) => `+ Fingering · ${c} · ${t}`,
      nameOptional: 'Name (optional)',
      clear: '↺ clear', cancel: '✕ cancel', add: '✓ add', nothingToPlay: '× nothing to play',
      replaceTitle: c => `✎ Replace ${c} with…`,
      replacePlaceholder: 'e.g. G, Am7, F#m, Cmaj9…',
      replaceHint: 'Any chord name works. Shapes are computed for your tuning, so unusual chords still get a diagram.',
      doReplace: '✓ replace', notAChord: '× not a chord',
      tabs: { diatonic: 'Diatonic', fifths: 'Fifths', jazz: 'Jazz', modes: 'Modes' },
      neighboursTitle: (c, tab) => `⚇ ${c}, ${tab.toLowerCase()} neighbours`,
      noSuggestion: 'No suggestion',
      shapeOpen: 'open position', shapeAllOpen: 'open strings',
      shapeFret: n => `${ordinalEn(n)} fret`, shapeBarre: ' · barre',
      shapeInv: n => ` · ${ordinalEn(n)} inv`, shapeBass: b => ` · ${b} bass`,
      nb: {
        ii_dim: 'ii° · supertonic', bIII: 'bIII · relative major', iv: 'iv · subdominant',
        v_min: 'v · dominant (natural minor)', V_maj: 'V · dominant (harmonic minor)',
        bVI: 'bVI', bVII: 'bVII', ii: 'ii · supertonic', iii: 'iii · mediant',
        IV: 'IV · subdominant', V: 'V · dominant', vi: 'vi · relative minor',
        vii_dim: 'vii° · leading tone',
        fifthUp: 'a fifth up, clockwise', fourthUp: 'a fourth up, anticlockwise',
        majorV: 'major V · tension', parallelMajor: 'parallel major, same tonic',
        parallelMinor: 'parallel minor, same tonic',
        relMajor: 'relative major, 3 semitones up', relMinor: 'relative minor, 3 semitones down',
        colour: 'ii · colour chord',
        add7m: 'add the 7th (m7)', m9: 'm9 · lush', m11: 'm11 · modal',
        bIIImaj7: 'bIIImaj7 · relative-major substitute', iv7: 'iv7 · ii-V toward bVII',
        V7hm: 'V7 · harmonic-minor dominant', tritone: 'bII7 · tritone substitute for V',
        addMaj7: 'add the major 7th', add9: 'add the 9th', add13: 'add the 13th · lush',
        vim7: 'vim7 · relative-minor substitute', iim7: 'iim7 · for a ii-V-I', V7: 'V7 · dominant',
        aeolianHere: 'Aeolian (natural minor) · you are here', dorian: 'Dorian · major IV instead of iv',
        phrygian: 'Phrygian · major bII, dark colour', misheberach: 'Mi Sheberach · major II, klezmer lift',
        harmonicMinor: 'Harmonic minor · major V', locrian: 'Locrian · ii° (rare)',
        ionianHere: 'Ionian (major) · you are here', ahavaRabbah: 'Ahava Rabbah · major bII a semitone up',
        lydian: 'Lydian · major #IV, bright', mixolydian: 'Mixolydian · major bVII, rock and folk',
        aeolian: 'Aeolian · major bVI, sombre', phrygianIII: 'Phrygian · major bIII'
      }
    },
    fr: {
      shuffle: '⟳ mélanger', shuffleTitle: 'Inventer une nouvelle grille dans cette tonalité',
      hear: '♪ écouter', stop: '■ stop', hearTitle: 'Jouer la grille ci-dessus au tempo du morceau',
      modeField: 'mode', ideaField: 'idée',
      anyOf: q => `au choix (${q})`, any: 'au choix',
      minor: 'mineur', major: 'majeur',
      jewishModes: 'Modes juifs', westernModes: 'Modes occidentaux',
      undo: '↶ annuler', undoTitle: 'Remettre la grille précédente',
      genFailed: 'Impossible de construire une grille :',
      noAudio: 'Ce navigateur ne gère pas Web Audio, la grille ne peut pas être jouée ici.',
      tuningNote: t => `Les doigtés ci-dessous sont calculés pour ${t}. La bibliothèque écrite à la main pour l'accordage standard est mise de côté tant que cet accordage est actif.`,
      noShapeIn: t => `Aucun doigté jouable en ${t}.`, hoverToAdd: 'Survole pour ajouter le tien.',
      unpin: 'Retirer du panneau',
      replace: '✎ remplacer', addFingering: '+ doigté', neighbours: '⚇ voisins',
      noShapeFor: (c, t) => `Aucun doigté jouable pour <strong style="color:var(--text)">${c}</strong><br>en <strong style="color:var(--text)">${t}</strong>.`,
      clickToAdd: n => `Clique sur <strong style="color:var(--accent)">${n}</strong> pour entrer le tien.`,
      prevShape: 'doigté précédent', nextShape: 'doigté suivant',
      pinAdd: 'Épingler au panneau imprimable', pinRemove: 'Retirer du panneau imprimable',
      yours: '★ perso', computed: 'calculé', deleteFingering: 'supprimer ce doigté',
      fingeringTitle: (c, t) => `+ Doigté · ${c} · ${t}`,
      nameOptional: 'Nom (optionnel)',
      clear: '↺ vider', cancel: '✕ annuler', add: '✓ ajouter', nothingToPlay: '× rien à jouer',
      replaceTitle: c => `✎ Remplacer ${c} par…`,
      replacePlaceholder: 'ex : G, Am7, F#m, Cmaj9…',
      replaceHint: 'N\'importe quel nom d\'accord fonctionne. Les doigtés sont calculés pour ton accordage, donc même un accord rare obtient un diagramme.',
      doReplace: '✓ remplacer', notAChord: '× pas un accord',
      tabs: { diatonic: 'Diatonique', fifths: 'Quintes', jazz: 'Jazz', modes: 'Modes' },
      neighboursTitle: (c, tab) => `⚇ ${c}, voisins ${tab.toLowerCase()}`,
      noSuggestion: 'Aucune suggestion',
      shapeOpen: 'position ouverte', shapeAllOpen: 'cordes à vide',
      shapeFret: n => `${ordinalFr(n)} case`, shapeBarre: ' · barré',
      shapeInv: n => ` · ${n}${n === 1 ? 'er' : 'e'} renv.`, shapeBass: b => ` · basse ${b}`,
      nb: {
        ii_dim: 'ii° · sus-tonique', bIII: 'bIII · relatif majeur', iv: 'iv · sous-dominante',
        v_min: 'v · dominante (mineur naturel)', V_maj: 'V · dominante (mineur harmonique)',
        bVI: 'bVI', bVII: 'bVII', ii: 'ii · sus-tonique', iii: 'iii · médiante',
        IV: 'IV · sous-dominante', V: 'V · dominante', vi: 'vi · relatif mineur',
        vii_dim: 'vii° · sensible',
        fifthUp: 'une quinte au-dessus, sens horaire', fourthUp: 'une quarte au-dessus, sens anti-horaire',
        majorV: 'V majeur · tension', parallelMajor: 'majeur parallèle, même tonique',
        parallelMinor: 'mineur parallèle, même tonique',
        relMajor: 'relatif majeur, 3 demi-tons au-dessus', relMinor: 'relatif mineur, 3 demi-tons en dessous',
        colour: 'ii · accord de couleur',
        add7m: 'ajouter la 7e (m7)', m9: 'm9 · ample', m11: 'm11 · modal',
        bIIImaj7: 'bIIImaj7 · substitut du relatif majeur', iv7: 'iv7 · ii-V vers bVII',
        V7hm: 'V7 · dominante du mineur harmonique', tritone: 'bII7 · substitut tritonique de V',
        addMaj7: 'ajouter la 7e majeure', add9: 'ajouter la 9e', add13: 'ajouter la 13e · ample',
        vim7: 'vim7 · substitut du relatif mineur', iim7: 'iim7 · pour un ii-V-I', V7: 'V7 · dominante',
        aeolianHere: 'Éolien (mineur naturel) · tu es ici', dorian: 'Dorien · IV majeur au lieu de iv',
        phrygian: 'Phrygien · bII majeur, couleur sombre', misheberach: 'Mi Sheberach · II majeur, élan klezmer',
        harmonicMinor: 'Mineur harmonique · V majeur', locrian: 'Locrien · ii° (rare)',
        ionianHere: 'Ionien (majeur) · tu es ici', ahavaRabbah: 'Ahava Rabbah · bII majeur un demi-ton au-dessus',
        lydian: 'Lydien · #IV majeur, lumineux', mixolydian: 'Mixolydien · bVII majeur, rock et folk',
        aeolian: 'Éolien · bVI majeur, sombre', phrygianIII: 'Phrygien · bIII majeur'
      }
    }
  };

  function ordinalEn(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function ordinalFr(n) { return n + (n === 1 ? 're' : 'e'); }

  const LANG = String(document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
  const S = I18N[LANG] || I18N.en;

  /** Read a field from the vocabulary JSON in the page's language, falling back
   *  to English when that entry has no translation yet. */
  function loc(obj, field) {
    if (!obj) return '';
    return obj[field + '_' + LANG] || obj[field] || '';
  }

  /** Name a computed shape in the page's language, from its structured meta. */
  function shapeName(v) {
    if (!v.meta) return v.name;                // curated and user shapes carry their own
    const m = v.meta;
    let out = m.allOpen ? S.shapeAllOpen
            : m.openPosition ? S.shapeOpen
            : S.shapeFret(m.position) + (m.barre ? S.shapeBarre : '');
    if (m.inversion === null) out += S.shapeBass(m.bass);
    else if (m.inversion > 0) out += S.shapeInv(m.inversion);
    return out;
  }

  // ===================================================================
  // CURATED LIBRARY
  // Hand-picked shapes, authored for standard tuning. They stay first in the list
  // because a guitarist chose them; the generator fills in everything else. Under
  // a non-standard tuning they are simply wrong (the old build drew them anyway),
  // so they are withheld and the generator takes over entirely.
  // ===================================================================

  const CURATED = {
    Am: [
      { name: 'open triad', frets: [-1, 0, 2, 2, 1, 0], baseFret: 1, barre: null },
      { name: 'Am7', frets: [-1, 0, 2, 0, 1, 0], baseFret: 1, barre: null },
      { name: 'Am(maj7)', frets: [-1, 0, 2, 1, 1, 0], baseFret: 1, barre: null },
      { name: 'Am6', frets: [-1, 0, 2, 2, 1, 2], baseFret: 1, barre: null },
      { name: 'Am(add9)', frets: [-1, 0, 2, 4, 1, 0], baseFret: 1, barre: null },
      { name: 'Am9', frets: [-1, 0, 5, 5, 5, 7], baseFret: 5, barre: null },
      { name: 'Am11 · 5th fret barre', frets: [5, 5, 5, 5, 5, 5], baseFret: 5, barre: 5 },
      { name: 'A° (Adim)', frets: [-1, 0, 1, 2, 1, -1], baseFret: 1, barre: null },
      { name: 'Am · 5th fret barre (E-shape)', frets: [5, 7, 7, 5, 5, 5], baseFret: 5, barre: 5 }
    ],
    Em: [
      { name: 'open triad', frets: [0, 2, 2, 0, 0, 0], baseFret: 1, barre: null },
      { name: 'Em7', frets: [0, 2, 2, 0, 3, 0], baseFret: 1, barre: null },
      { name: 'Em(maj7)', frets: [0, 2, 1, 0, 0, 0], baseFret: 1, barre: null },
      { name: 'Em6', frets: [0, 2, 2, 0, 2, 0], baseFret: 1, barre: null },
      { name: 'Em(add9)', frets: [0, 2, 4, 0, 0, 0], baseFret: 1, barre: null },
      { name: 'Em9', frets: [0, 2, 0, 0, 0, 2], baseFret: 1, barre: null },
      { name: 'Em11 · 7th fret barre', frets: [-1, 7, 7, 7, 7, 7], baseFret: 7, barre: 7 },
      { name: 'E° (Edim)', frets: [0, 1, 2, 0, -1, -1], baseFret: 1, barre: null },
      { name: 'Em · 7th fret barre (A-shape)', frets: [-1, 7, 9, 9, 8, 7], baseFret: 7, barre: 7 }
    ],
    Dm: [
      { name: 'open triad', frets: [-1, -1, 0, 2, 3, 1], baseFret: 1, barre: null },
      { name: 'Dm7', frets: [-1, -1, 0, 2, 1, 1], baseFret: 1, barre: null },
      { name: 'Dm(maj7)', frets: [-1, -1, 0, 2, 2, 1], baseFret: 1, barre: null },
      { name: 'Dm6', frets: [-1, -1, 0, 2, 0, 1], baseFret: 1, barre: null },
      { name: 'Dm(add9)', frets: [-1, -1, 0, 2, 3, 0], baseFret: 1, barre: null },
      { name: 'Dm9', frets: [-1, 5, 3, 5, 5, -1], baseFret: 3, barre: null },
      { name: 'Dm11 · 5th fret barre', frets: [-1, 5, 5, 5, 5, 5], baseFret: 5, barre: 5 },
      { name: 'D° (Ddim)', frets: [-1, -1, 0, 1, 3, 1], baseFret: 1, barre: null },
      { name: 'Dm · 5th fret barre (A-shape)', frets: [-1, 5, 7, 7, 6, 5], baseFret: 5, barre: 5 }
    ],
    F: [
      { name: 'F (4 strings)', frets: [-1, -1, 3, 2, 1, 1], baseFret: 1, barre: 1 },
      { name: 'Fmaj7', frets: [-1, -1, 3, 2, 1, 0], baseFret: 1, barre: null },
      { name: 'F6', frets: [-1, -1, 3, 2, 3, 1], baseFret: 1, barre: null },
      { name: 'F7 · 1st fret barre', frets: [1, 3, 1, 2, 1, 1], baseFret: 1, barre: 1 },
      { name: 'Fadd9', frets: [-1, -1, 3, 2, 1, 3], baseFret: 1, barre: null },
      { name: 'Fmaj9', frets: [-1, 0, 3, 0, 1, 0], baseFret: 1, barre: null },
      { name: 'F9 · 1st fret barre', frets: [1, 3, 1, 2, 4, 3], baseFret: 1, barre: 1 },
      { name: 'Fsus4', frets: [-1, -1, 3, 3, 1, 1], baseFret: 1, barre: 1 },
      { name: 'F · 1st fret barre (E-shape)', frets: [1, 3, 3, 2, 1, 1], baseFret: 1, barre: 1 }
    ],
    C: [
      { name: 'open triad', frets: [-1, 3, 2, 0, 1, 0], baseFret: 1, barre: null },
      { name: 'Cmaj7', frets: [-1, 3, 2, 0, 0, 0], baseFret: 1, barre: null },
      { name: 'C7', frets: [-1, 3, 2, 3, 1, 0], baseFret: 1, barre: null },
      { name: 'C6', frets: [-1, 3, 2, 2, 1, 0], baseFret: 1, barre: null },
      { name: 'Cadd9', frets: [-1, 3, 2, 0, 3, 0], baseFret: 1, barre: null },
      { name: 'Cmaj9', frets: [-1, 3, 0, 0, 0, 0], baseFret: 1, barre: null },
      { name: 'C11 · 3rd fret barre', frets: [-1, 3, 3, 3, 3, 3], baseFret: 3, barre: 3 },
      { name: 'Csus4', frets: [-1, 3, 3, 0, 1, 1], baseFret: 1, barre: null },
      { name: 'C · 3rd fret barre (A-shape)', frets: [-1, 3, 5, 5, 5, 3], baseFret: 3, barre: 3 }
    ],
    G: [
      { name: 'open triad', frets: [3, 2, 0, 0, 0, 3], baseFret: 1, barre: null },
      { name: 'Gmaj7', frets: [3, 2, 0, 0, 0, 2], baseFret: 1, barre: null },
      { name: 'G7', frets: [3, 2, 0, 0, 0, 1], baseFret: 1, barre: null },
      { name: 'G6', frets: [3, 2, 0, 0, 0, 0], baseFret: 1, barre: null },
      { name: 'Gadd9', frets: [3, 0, 0, 2, 0, 3], baseFret: 1, barre: null },
      { name: 'Gsus4', frets: [3, 3, 0, 0, 1, 3], baseFret: 1, barre: null },
      { name: 'G9 · 3rd fret barre', frets: [3, 5, 3, 4, 3, 5], baseFret: 3, barre: 3 },
      { name: 'G · 3rd fret barre (E-shape)', frets: [3, 5, 5, 4, 3, 3], baseFret: 3, barre: 3 }
    ],
    D: [
      { name: 'open triad', frets: [-1, -1, 0, 2, 3, 2], baseFret: 1, barre: null },
      { name: 'Dmaj7', frets: [-1, -1, 0, 2, 2, 2], baseFret: 1, barre: null },
      { name: 'D7', frets: [-1, -1, 0, 2, 1, 2], baseFret: 1, barre: null },
      { name: 'D6', frets: [-1, -1, 0, 2, 0, 2], baseFret: 1, barre: null },
      { name: 'Dadd9', frets: [-1, -1, 0, 2, 3, 0], baseFret: 1, barre: null },
      { name: 'Dsus4', frets: [-1, -1, 0, 2, 3, 3], baseFret: 1, barre: null },
      { name: 'Dsus2', frets: [-1, -1, 0, 2, 3, 0], baseFret: 1, barre: null },
      { name: 'D · 5th fret barre (A-shape)', frets: [-1, 5, 7, 7, 7, 5], baseFret: 5, barre: 5 }
    ],
    A: [
      { name: 'open triad', frets: [-1, 0, 2, 2, 2, 0], baseFret: 1, barre: null },
      { name: 'Amaj7', frets: [-1, 0, 2, 1, 2, 0], baseFret: 1, barre: null },
      { name: 'A7', frets: [-1, 0, 2, 0, 2, 0], baseFret: 1, barre: null },
      { name: 'A6', frets: [-1, 0, 2, 2, 2, 2], baseFret: 1, barre: null },
      { name: 'Aadd9', frets: [-1, 0, 2, 4, 2, 0], baseFret: 1, barre: null },
      { name: 'Asus4', frets: [-1, 0, 2, 2, 3, 0], baseFret: 1, barre: null },
      { name: 'Asus2', frets: [-1, 0, 2, 2, 0, 0], baseFret: 1, barre: null },
      { name: 'A · 5th fret barre (E-shape)', frets: [5, 7, 7, 6, 5, 5], baseFret: 5, barre: 5 }
    ],
    E: [
      { name: 'open triad', frets: [0, 2, 2, 1, 0, 0], baseFret: 1, barre: null },
      { name: 'Emaj7', frets: [0, 2, 1, 1, 0, 0], baseFret: 1, barre: null },
      { name: 'E7', frets: [0, 2, 0, 1, 0, 0], baseFret: 1, barre: null },
      { name: 'E6', frets: [0, 2, 2, 1, 2, 0], baseFret: 1, barre: null },
      { name: 'Eadd9', frets: [0, 2, 4, 1, 0, 0], baseFret: 1, barre: null },
      { name: 'Esus4', frets: [0, 2, 2, 2, 0, 0], baseFret: 1, barre: null },
      { name: 'E · 7th fret barre (A-shape)', frets: [-1, 7, 9, 9, 9, 7], baseFret: 7, barre: 7 }
    ],
    Bm: [
      { name: 'Bm · 2nd fret barre', frets: [-1, 2, 4, 4, 3, 2], baseFret: 2, barre: 2 },
      { name: 'Bm7 · 2nd fret barre', frets: [-1, 2, 4, 2, 3, 2], baseFret: 2, barre: 2 },
      { name: 'Bm (3 strings)', frets: [-1, -1, -1, 4, 3, 2], baseFret: 1, barre: null },
      { name: 'Bm · 7th fret barre (E-shape)', frets: [7, 9, 9, 7, 7, 7], baseFret: 7, barre: 7 }
    ],
    Gm: [
      { name: 'Gm · 3rd fret barre', frets: [3, 5, 5, 3, 3, 3], baseFret: 3, barre: 3 },
      { name: 'Gm7 · 3rd fret barre', frets: [3, 5, 3, 3, 3, 3], baseFret: 3, barre: 3 },
      { name: 'Gm (3 strings)', frets: [-1, -1, -1, 3, 3, 3], baseFret: 1, barre: null },
      { name: 'Gm · 10th fret barre (A-shape)', frets: [-1, 10, 12, 12, 11, 10], baseFret: 10, barre: 10 }
    ],
    Fm: [
      { name: 'Fm · 1st fret barre (E-shape)', frets: [1, 3, 3, 1, 1, 1], baseFret: 1, barre: 1 },
      { name: 'Fm7 · 1st fret barre', frets: [1, 3, 1, 1, 1, 1], baseFret: 1, barre: 1 },
      { name: 'Fm (top 3 strings)', frets: [-1, -1, 3, 1, 1, 1], baseFret: 1, barre: null },
      { name: 'Fm9', frets: [-1, -1, 3, 1, 4, 3], baseFret: 1, barre: null },
      { name: 'Fm · 8th fret barre (A-shape)', frets: [-1, 8, 10, 10, 9, 8], baseFret: 8, barre: 8 }
    ],
    Bbm: [
      { name: 'B♭m · 1st fret barre (A-shape)', frets: [-1, 1, 3, 3, 2, 1], baseFret: 1, barre: 1 },
      { name: 'B♭m7 · 1st fret barre', frets: [-1, 1, 3, 1, 2, 1], baseFret: 1, barre: 1 },
      { name: 'B♭m (top 3 strings)', frets: [-1, -1, -1, 3, 2, 1], baseFret: 1, barre: null },
      { name: 'B♭m · 6th fret barre (E-shape)', frets: [6, 8, 8, 6, 6, 6], baseFret: 6, barre: 6 }
    ],
    C7: [
      { name: 'C7 · open', frets: [-1, 3, 2, 3, 1, 0], baseFret: 1, barre: null },
      { name: 'C7 (4 strings)', frets: [-1, -1, 2, 3, 1, 0], baseFret: 1, barre: null },
      { name: 'C9', frets: [-1, 3, 2, 3, 3, 0], baseFret: 1, barre: null },
      { name: 'C7 · 3rd fret barre (A-shape)', frets: [-1, 3, 5, 3, 5, 3], baseFret: 3, barre: 3 },
      { name: 'C7 · 8th fret barre (E-shape)', frets: [8, 10, 8, 9, 8, 8], baseFret: 8, barre: 8 }
    ]
  };

  // A curated entry named "Am7" answers a lookup for Am7, not only for Am.
  function curatedFor(chordName) {
    if (!isStandardTuning()) return [];
    if (CURATED[chordName]) return CURATED[chordName].map(v => Object.assign({ _curated: true }, v));

    const parsed = Theory.parseChord(chordName);
    if (!parsed) return [];
    const roots = [];
    if (Theory.isMinorish(parsed)) roots.push(parsed.root + 'm');
    roots.push(parsed.root);

    for (const key of roots) {
      const entries = CURATED[key];
      if (!entries) continue;
      const hits = entries.filter(v => {
        const primary = v.name.split(/[\s·]/)[0];
        if (primary === chordName) return true;
        const paren = v.name.match(/\(([^)]+)\)/);
        return !!(paren && paren[1].trim() === chordName);
      });
      if (hits.length) return hits.map(v => Object.assign({ _curated: true }, v));
    }
    return [];
  }

  // ===================================================================
  // TUNING
  // ===================================================================

  let TUNING = STD_TUNING.slice();

  const TUNING_PRESETS = {
    'standard':  ['E', 'A', 'D', 'G', 'B', 'E'],
    'drop-d':    ['D', 'A', 'D', 'G', 'B', 'E'],
    'dadgad':    ['D', 'A', 'D', 'G', 'A', 'D'],
    'open-d':    ['D', 'A', 'D', 'F#', 'A', 'D'],
    'open-g':    ['D', 'G', 'D', 'G', 'B', 'D'],
    'open-c':    ['C', 'G', 'C', 'G', 'C', 'E'],
    'half-down': ['Eb', 'Ab', 'Db', 'Gb', 'Bb', 'Eb'],
    'full-down': ['D', 'G', 'C', 'F', 'A', 'D']
  };

  function tuningKey() { return TUNING.join(' '); }
  function isStandardTuning() { return tuningKey() === STD_TUNING.join(' '); }

  function setTuning(arr) {
    if (!Array.isArray(arr) || arr.length !== 6) return;
    TUNING = arr.slice();
    writeJSON(K_TUNING, TUNING);
    VOICING_CACHE = {};
    const cur = document.getElementById('tuning-current');
    if (cur) cur.textContent = tuningKey();
    const warn = document.getElementById('cx-tuning-note');
    if (warn) {
      warn.hidden = isStandardTuning();
      warn.textContent = isStandardTuning() ? '' : S.tuningNote(tuningKey());
    }
    renderActiveVoicings();
  }

  function parseTuningString(str) {
    const t = String(str).trim().split(/[\s,]+/).filter(Boolean);
    return t.length === 6 && t.every(n => Theory.noteToPc(n) >= 0) ? t : null;
  }

  function findTuningPreset(arr) {
    for (const k in TUNING_PRESETS) if (TUNING_PRESETS[k].join(' ') === arr.join(' ')) return k;
    return null;
  }

  // ===================================================================
  // VOICING LIST  (curated + generated + yours)
  // ===================================================================

  let VOICING_CACHE = {};

  function generatedFor(chordName) {
    const k = chordName + '|' + tuningKey();
    if (!VOICING_CACHE[k]) VOICING_CACHE[k] = Theory.generateVoicings(chordName, TUNING);
    return VOICING_CACHE[k];
  }

  function userVoicings(chordName) {
    const all = readJSON(K_USER, {});
    return (all[chordName + '|' + tuningKey()] || []).map(v => Object.assign({ _user: true }, v));
  }

  function addUserVoicing(chordName, voicing) {
    const all = readJSON(K_USER, {});
    const k = chordName + '|' + tuningKey();
    if (!all[k]) all[k] = [];
    all[k].push(voicing);
    writeJSON(K_USER, all);
  }

  function removeUserVoicing(chordName, indexInUserList) {
    const all = readJSON(K_USER, {});
    const k = chordName + '|' + tuningKey();
    if (all[k] && all[k][indexInUserList]) {
      all[k].splice(indexInUserList, 1);
      if (!all[k].length) delete all[k];
      writeJSON(K_USER, all);
    }
  }

  /** Everything playable for this chord in the current tuning, best first. */
  function allVoicings(chordName) {
    const curated = curatedFor(chordName);
    const taken = new Set(curated.map(v => v.frets.join(',')));
    const generated = generatedFor(chordName).filter(v => !taken.has(v.frets.join(',')));
    return curated.concat(generated, userVoicings(chordName));
  }

  // ===================================================================
  // PINS
  // Pins are stored by shape, not by list index. Indices used to be stable only
  // as long as the list never changed; the generator changes it whenever the
  // tuning does, which would have silently re-pointed every pin.
  // ===================================================================

  function fretKey(frets) { return frets.join(','); }

  function pinnedKeys(chordName) {
    const all = readJSON(K_PINS, {});
    const v = all[chordName + '|' + tuningKey()];
    return Array.isArray(v) ? v : null;
  }

  function isPinned(chordName, voicing) {
    const keys = pinnedKeys(chordName);
    if (keys === null) {
      const list = allVoicings(chordName);
      return list.length > 0 && fretKey(list[0].frets) === fretKey(voicing.frets);
    }
    return keys.indexOf(fretKey(voicing.frets)) >= 0;
  }

  function togglePin(chordName, voicing) {
    const all = readJSON(K_PINS, {});
    const k = chordName + '|' + tuningKey();
    if (!Array.isArray(all[k])) {
      const list = allVoicings(chordName);
      all[k] = list.length ? [fretKey(list[0].frets)] : [];
    }
    const fk = fretKey(voicing.frets);
    const at = all[k].indexOf(fk);
    if (at >= 0) all[k].splice(at, 1); else all[k].push(fk);
    if (!all[k].length) delete all[k];
    writeJSON(K_PINS, all);
  }

  function pinnedVoicings(chordName) {
    const list = allVoicings(chordName);
    if (!list.length) return [];
    const keys = pinnedKeys(chordName);
    if (keys === null) return [list[0]];
    const out = list.filter(v => keys.indexOf(fretKey(v.frets)) >= 0);
    return out.length ? out : [list[0]];
  }

  // ===================================================================
  // FRETBOARD DRAWING
  // ===================================================================

  const ACCENT = '#4A9EDB';

  function renderFretboard(chord) {
    const stringSpacing = 18, fretSpacing = 22, offsetX = 28, offsetY = 36, STR = 6;
    const baseFret = chord.baseFret;
    const fretted = chord.frets.filter(f => f > 0);
    const maxFret = fretted.length ? Math.max(...fretted) : baseFret + 3;
    const numFrets = Math.max(4, maxFret - baseFret + 1);
    const W = offsetX * 2 + stringSpacing * (STR - 1);
    const H = offsetY + numFrets * fretSpacing + 22;

    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="fretboard diagram">`;

    if (baseFret === 1) {
      svg += `<rect x="${offsetX - 1}" y="${offsetY - 4}" width="${stringSpacing * (STR - 1) + 2}" height="5" fill="#ccc"/>`;
    } else {
      svg += `<text x="${offsetX - 10}" y="${offsetY + 14}" fill="${ACCENT}" font-size="11" text-anchor="end" font-family="monospace" font-weight="600">${baseFret}fr</text>`;
    }
    for (let i = 0; i <= numFrets; i++) {
      svg += `<line x1="${offsetX}" y1="${offsetY + i * fretSpacing}" x2="${offsetX + (STR - 1) * stringSpacing}" y2="${offsetY + i * fretSpacing}" stroke="#444" stroke-width="1"/>`;
    }
    for (let i = 0; i < STR; i++) {
      svg += `<line x1="${offsetX + i * stringSpacing}" y1="${offsetY}" x2="${offsetX + i * stringSpacing}" y2="${offsetY + numFrets * fretSpacing}" stroke="#666" stroke-width="1"/>`;
    }
    for (let i = 0; i < STR; i++) {
      const f = chord.frets[i], x = offsetX + i * stringSpacing;
      if (f === -1) svg += `<text x="${x}" y="${offsetY - 8}" fill="#666" font-size="14" text-anchor="middle" font-weight="600">×</text>`;
      else if (f === 0) svg += `<circle cx="${x}" cy="${offsetY - 10}" r="5" fill="none" stroke="${ACCENT}" stroke-width="1.5"/>`;
    }
    if (chord.barre) {
      let first = -1, last = -1;
      for (let i = 0; i < STR; i++) if (chord.frets[i] === chord.barre) { if (first === -1) first = i; last = i; }
      if (first !== -1 && last > first) {
        const y = offsetY + (chord.barre - baseFret + 0.5) * fretSpacing;
        svg += `<rect x="${offsetX + first * stringSpacing - 8}" y="${y - 8}" width="${(last - first) * stringSpacing + 16}" height="16" rx="8" fill="${ACCENT}" opacity="0.9"/>`;
        const midX = offsetX + (first + last) / 2 * stringSpacing;
        svg += `<text x="${midX}" y="${y + 3.5}" fill="#0a0a0a" font-size="${chord.barre >= 10 ? 9 : 10}" text-anchor="middle" font-weight="700" font-family="monospace">${chord.barre}</text>`;
      }
    }
    for (let i = 0; i < STR; i++) {
      const f = chord.frets[i];
      if (f > 0) {
        const rel = f - baseFret;
        if (rel < 0 || rel >= numFrets) continue;
        if (chord.barre && f === chord.barre) continue;
        const x = offsetX + i * stringSpacing, y = offsetY + (rel + 0.5) * fretSpacing;
        svg += `<circle cx="${x}" cy="${y}" r="8" fill="${ACCENT}" stroke="#0a0a0a" stroke-width="1"/>`;
        svg += `<text x="${x}" y="${y + 3.5}" fill="#0a0a0a" font-size="${f >= 10 ? 9 : 10}" text-anchor="middle" font-weight="700" font-family="monospace">${f}</text>`;
      }
    }
    for (let i = 0; i < STR; i++) {
      svg += `<text x="${offsetX + i * stringSpacing}" y="${offsetY + numFrets * fretSpacing + 14}" fill="#555" font-size="9" text-anchor="middle" font-family="monospace">${esc(TUNING[i] || '')}</text>`;
    }
    return svg + '</svg>';
  }

  function renderFretboardEditor(draftFrets, numEditFrets) {
    numEditFrets = numEditFrets || 7;
    const stringSpacing = 22, fretSpacing = 24, offsetX = 30, offsetY = 50, STR = 6;
    const W = offsetX * 2 + stringSpacing * (STR - 1);
    const H = offsetY + numEditFrets * fretSpacing + 40;
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

    for (let i = 0; i < STR; i++) {
      const x = offsetX + i * stringSpacing;
      const muted = draftFrets[i] === -1, open = draftFrets[i] === 0;
      svg += `<g class="edit-toggle ${muted ? 'active' : ''}" data-string="${i}" data-fret="-1">`;
      svg += `<rect x="${x - 9}" y="${offsetY - 44}" width="18" height="14" rx="2" stroke="#444" stroke-width="0.5"/>`;
      svg += `<text x="${x}" y="${offsetY - 33}" fill="${muted ? '#000' : '#888'}" font-size="11" text-anchor="middle" font-weight="700" pointer-events="none">×</text></g>`;
      svg += `<g class="edit-toggle ${open ? 'active' : ''}" data-string="${i}" data-fret="0">`;
      svg += `<rect x="${x - 9}" y="${offsetY - 26}" width="18" height="14" rx="2" stroke="#444" stroke-width="0.5"/>`;
      svg += `<text x="${x}" y="${offsetY - 15}" fill="${open ? '#000' : '#888'}" font-size="11" text-anchor="middle" font-weight="700" pointer-events="none">○</text></g>`;
    }
    svg += `<rect x="${offsetX - 1}" y="${offsetY - 4}" width="${stringSpacing * (STR - 1) + 2}" height="5" fill="#ccc"/>`;
    for (let i = 0; i <= numEditFrets; i++) {
      svg += `<line x1="${offsetX}" y1="${offsetY + i * fretSpacing}" x2="${offsetX + (STR - 1) * stringSpacing}" y2="${offsetY + i * fretSpacing}" stroke="#444" stroke-width="1"/>`;
    }
    for (let i = 0; i < STR; i++) {
      svg += `<line x1="${offsetX + i * stringSpacing}" y1="${offsetY}" x2="${offsetX + i * stringSpacing}" y2="${offsetY + numEditFrets * fretSpacing}" stroke="#666" stroke-width="1"/>`;
    }
    for (let s = 0; s < STR; s++) {
      for (let f = 1; f <= numEditFrets; f++) {
        svg += `<g class="edit-cell" data-string="${s}" data-fret="${f}"><rect x="${offsetX + s * stringSpacing - stringSpacing / 2}" y="${offsetY + (f - 1) * fretSpacing}" width="${stringSpacing}" height="${fretSpacing}"/></g>`;
      }
    }
    for (let i = 0; i < STR; i++) {
      const f = draftFrets[i];
      if (f > 0) {
        const x = offsetX + i * stringSpacing, y = offsetY + (f - 0.5) * fretSpacing;
        svg += `<circle cx="${x}" cy="${y}" r="9" fill="${ACCENT}" stroke="#0a0a0a" stroke-width="1" pointer-events="none"/>`;
        svg += `<text x="${x}" y="${y + 3.5}" fill="#0a0a0a" font-size="${f >= 10 ? 9 : 10}" text-anchor="middle" font-weight="700" font-family="monospace" pointer-events="none">${f}</text>`;
      }
    }
    for (let i = 1; i <= numEditFrets; i++) {
      svg += `<text x="${offsetX + (STR - 1) * stringSpacing + 14}" y="${offsetY + (i - 0.5) * fretSpacing + 3}" fill="#444" font-size="9" text-anchor="middle" font-family="monospace">${i}</text>`;
    }
    for (let i = 0; i < STR; i++) {
      const f = draftFrets[i];
      const label = f === -1 ? '×' : f === 0 ? '○' : String(f);
      svg += `<text x="${offsetX + i * stringSpacing}" y="${offsetY + numEditFrets * fretSpacing + 14}" fill="${ACCENT}" font-size="9" text-anchor="middle" font-family="monospace">${esc(TUNING[i] || '')}</text>`;
      svg += `<text x="${offsetX + i * stringSpacing}" y="${offsetY + numEditFrets * fretSpacing + 28}" fill="#666" font-size="10" text-anchor="middle" font-family="monospace" font-weight="600">${label}</text>`;
    }
    return svg + '</svg>';
  }

  function parseFretsString(str) {
    const t = String(str).trim().split(/[\s,\-]+/).filter(Boolean);
    if (t.length !== 6) return null;
    const frets = t.map(x => {
      const lo = x.toLowerCase();
      if (lo === 'x' || lo === '-' || lo === 'm') return -1;
      if (lo === 'o') return 0;
      const n = parseInt(x, 10);
      return isNaN(n) ? null : n;
    });
    return frets.some(f => f === null) ? null : frets;
  }

  function buildVoicingFromFrets(frets, name) {
    const fretted = frets.filter(f => f > 0);
    const hasOpen = frets.some(f => f === 0);
    const baseFret = (hasOpen || !fretted.length) ? 1 : Math.min(...fretted);
    return { name: name || 'custom', frets, baseFret, barre: null, _user: true };
  }

  // ===================================================================
  // PROGRESSION
  // ===================================================================

  const DEFAULT_PROGRESSION = SONG.progression || '| Am | F | C | G |';
  let CURRENT_PROGRESSION = DEFAULT_PROGRESSION;

  function progressionToHTML(text) {
    let html = '', idx = 0;
    for (const t of Theory.tokenizeProgression(text)) {
      if (t.type === 'chord') {
        html += `<span class="chord" data-chord="${esc(t.name)}" data-prog-idx="${idx}" tabindex="0" role="button">${esc(t.name)}</span>`;
        idx++;
      } else html += esc(t.text);
    }
    return html;
  }

  function applyProgression(text, opts) {
    CURRENT_PROGRESSION = text;
    const display = document.getElementById('progression-display');
    if (display) {
      display.innerHTML = progressionToHTML(text);
      attachChordTooltips(display);
    }
    if (!opts || opts.persist !== false) {
      try { localStorage.setItem(K_PROG, text); } catch (e) {}
    }
    renderActiveVoicings();
  }

  function replaceChordAtIdx(progIdx, newChord) {
    const tokens = Theory.tokenizeProgression(CURRENT_PROGRESSION);
    let n = 0;
    for (const t of tokens) {
      if (t.type === 'chord') { if (n === progIdx) { t.name = newChord; break; } n++; }
    }
    CURRENT_PROGRESSION = tokens.map(t => t.type === 'chord' ? t.name : t.text).join('');
    try { localStorage.setItem(K_PROG, CURRENT_PROGRESSION); } catch (e) {}
    const span = document.querySelector(`#progression-display .chord[data-prog-idx="${progIdx}"]`);
    if (span) { span.textContent = newChord; span.dataset.chord = newChord; }
    renderActiveVoicings();
  }

  function renderActiveVoicings() {
    const grid = document.getElementById('active-voicings-grid');
    if (!grid) return;
    let html = '';
    for (const name of Theory.uniqueProgressionChords(CURRENT_PROGRESSION)) {
      const all = allVoicings(name);
      if (!all.length) {
        html += `<div class="voicing-card" data-chord="${esc(name)}"><div class="voicing-name">${esc(name)}</div>
          <div class="voicing-empty">${esc(S.noShapeIn(tuningKey()))}<br>${esc(S.hoverToAdd)}</div></div>`;
        continue;
      }
      for (const v of pinnedVoicings(name)) {
        const label = shapeName(v);
        html += `<div class="voicing-card" data-chord="${esc(name)}">
          <button class="voicing-unpin" data-chord="${esc(name)}" data-frets="${esc(fretKey(v.frets))}" type="button" title="${esc(S.unpin)}">×</button>
          <div class="voicing-name">${esc(name)}</div>
          <div class="voicing-diagram">${renderFretboard(v)}</div>
          <div class="voicing-label" title="${esc(label)}">${esc(label)}</div>
        </div>`;
      }
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.voicing-unpin').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        togglePin(btn.dataset.chord, { frets: btn.dataset.frets.split(',').map(Number) });
        renderActiveVoicings();
      });
    });
    grid.querySelectorAll('.voicing-card').forEach(card => card.classList.add('chord'));
    attachChordTooltips(grid);
  }

  // ===================================================================
  // AUDIO — plucked string (Karplus-Strong), no samples, no dependencies
  // ===================================================================

  const Audio_ = {
    ctx: null,
    playing: false,
    sources: [],
    buffers: {},

    context() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },

    // One decaying string, synthesised once per pitch and reused.
    buffer(midi) {
      const ctx = this.context();
      if (this.buffers[midi]) return this.buffers[midi];
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const sr = ctx.sampleRate;
      const dur = 2.4;
      const n = Math.max(2, Math.round(sr / freq));
      const buf = ctx.createBuffer(1, Math.ceil(sr * dur), sr);
      const out = buf.getChannelData(0);
      const ring = new Float32Array(n);
      for (let i = 0; i < n; i++) ring[i] = Math.random() * 2 - 1;
      // Damping under 1 shortens the tail; higher strings ring slightly less.
      const damp = 0.9955 - Math.min(0.004, (midi - 40) * 0.00012);
      let idx = 0;
      for (let i = 0; i < out.length; i++) {
        const cur = ring[idx];
        const next = ring[(idx + 1) % n];
        ring[idx] = (cur + next) * 0.5 * damp;
        out[i] = cur;
        idx = (idx + 1) % n;
      }
      // Fade the last 150 ms so stopping never clicks.
      const fade = Math.floor(sr * 0.15);
      for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
      this.buffers[midi] = buf;
      return buf;
    },

    note(midi, when, gain) {
      const ctx = this.context();
      const src = ctx.createBufferSource();
      src.buffer = this.buffer(midi);
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(ctx.destination);
      src.start(when);
      this.sources.push(src);
    },

    /** Strum one voicing: low string first, 20 ms apart, like a downstroke. */
    strum(voicing, when) {
      const open = Theory.tuningToMidi(TUNING);
      if (!open) return;
      let k = 0;
      for (let i = 0; i < voicing.frets.length; i++) {
        if (voicing.frets[i] < 0) continue;
        this.note(open[i] + voicing.frets[i], when + k * 0.02, 0.22 - k * 0.012);
        k++;
      }
    },

    stop() {
      for (const s of this.sources) { try { s.stop(); } catch (e) {} }
      this.sources = [];
      this.playing = false;
      const btn = document.getElementById('cx-play');
      if (btn) { btn.textContent = S.hear; btn.classList.remove('cx-on'); }
    },

    /** Play the current grid at the song's tempo. */
    play(text) {
      const ctx = this.context();
      if (!ctx) return false;
      if (this.playing) { this.stop(); return true; }

      const bars = String(text).split('|').map(b => b.trim()).filter(Boolean);
      const bpm = Number(SONG.tempo) > 0 ? Number(SONG.tempo) : 90;
      const beatsPerBar = parseInt(String(SONG.meter || '4/4').split('/')[0], 10) || 4;
      const beat = 60 / bpm;
      const barLen = beat * beatsPerBar;

      let t = ctx.currentTime + 0.08;
      let scheduled = 0;
      for (const bar of bars) {
        const names = bar.split(/\s+/).filter(Boolean);
        const slot = barLen / Math.max(1, names.length);
        names.forEach((name, i) => {
          const v = (pinnedVoicings(name)[0] || allVoicings(name)[0]);
          if (!v) return;
          // Re-strum on every beat inside the slot so a held bar still pulses.
          const strums = Math.max(1, Math.round(slot / beat));
          for (let s = 0; s < strums; s++) this.strum(v, t + i * slot + s * beat);
          scheduled++;
        });
        t += barLen;
      }
      if (!scheduled) return false;

      this.playing = true;
      const btn = document.getElementById('cx-play');
      if (btn) { btn.textContent = S.stop; btn.classList.add('cx-on'); }
      const total = (t - ctx.currentTime) * 1000;
      clearTimeout(this._endTimer);
      this._endTimer = setTimeout(() => this.stop(), total + 400);
      return true;
    }
  };

  // ===================================================================
  // SHUFFLE
  // ===================================================================

  let VOCAB = null;
  let LAST_SHUFFLE = null;

  function songKey() {
    const raw = String(SONG.key || 'Am').trim();
    const m = Theory.normalizeAccidentals(raw).match(/^([A-G][#b]?)\s*(m|min|minor)?/i);
    if (!m) return { tonic: 'A', quality: 'minor' };
    return { tonic: m[1], quality: m[2] ? 'minor' : 'major' };
  }

  function buildShuffleBar() {
    const host = document.querySelector('.t-chord');
    if (!host || !VOCAB) return;

    const key = songKey();

    // Every mode is offered, not only those whose tonic triad matches the song's
    // quality. Ahava Rabbah has a major tonic, so filtering on quality would hide
    // the mode from every minor-key song here, which is where it is most wanted:
    // a D-minor niggun played in D freygish is the whole point. What the filter
    // still governs is the "any" case, which stays inside the song's own quality.
    const opt = id => `<option value="${esc(id)}">${esc(loc(VOCAB.modes[id], 'label'))}</option>`;
    const ids = Object.keys(VOCAB.modes);
    const jewish = ids.filter(id => VOCAB.modes[id].family === 'jewish');
    const western = ids.filter(id => VOCAB.modes[id].family !== 'jewish');
    const modeOptions =
      `<optgroup label="${esc(S.jewishModes)}">${jewish.map(opt).join('')}</optgroup>` +
      `<optgroup label="${esc(S.westernModes)}">${western.map(opt).join('')}</optgroup>`;

    const bar = document.createElement('div');
    bar.className = 'cx-bar';
    bar.innerHTML = `
      <div class="cx-controls">
        <button id="cx-shuffle" class="cx-btn cx-primary" type="button" title="${esc(S.shuffleTitle)}">${esc(S.shuffle)}</button>
        <button id="cx-play" class="cx-btn" type="button" title="${esc(S.hearTitle)}">${esc(S.hear)}</button>
        <label class="cx-field"><span>${esc(S.modeField)}</span>
          <select id="cx-mode">
            <option value="">${esc(S.anyOf(key.quality === 'minor' ? S.minor : S.major))}</option>
            ${modeOptions}
          </select>
        </label>
        <label class="cx-field"><span>${esc(S.ideaField)}</span>
          <select id="cx-strategy"><option value="">${esc(S.any)}</option></select>
        </label>
        <button id="cx-keep" class="cx-btn cx-ghost" type="button" hidden title="${esc(S.undoTitle)}">${esc(S.undo)}</button>
      </div>
      <div id="cx-note" class="cx-note" hidden></div>
      <div id="cx-tuning-note" class="cx-warn" hidden></div>
    `;
    host.appendChild(bar);

    const modeSel = bar.querySelector('#cx-mode');
    const stratSel = bar.querySelector('#cx-strategy');

    function refreshStrategies() {
      const mode = modeSel.value;
      const usable = VOCAB.strategies.filter(s => !mode || s.modes.indexOf(mode) >= 0);
      stratSel.innerHTML = `<option value="">${esc(S.any)}</option>` +
        usable.map(s => `<option value="${esc(s.id)}">${esc(loc(s, 'label'))}</option>`).join('');
    }
    refreshStrategies();
    modeSel.addEventListener('change', refreshStrategies);

    let previous = null;
    bar.querySelector('#cx-shuffle').addEventListener('click', () => {
      let result;
      try {
        result = Theory.generateProgression(songKey(), {
          mode: modeSel.value || undefined,
          strategy: stratSel.value || undefined
        });
      } catch (e) {
        showNote(`<strong>${esc(S.genFailed)}</strong> ` + esc(e.message));
        return;
      }
      previous = CURRENT_PROGRESSION;
      LAST_SHUFFLE = result;
      applyProgression(result.text);
      bar.querySelector('#cx-keep').hidden = false;
      showShuffleNote(result);
      if (Audio_.playing) Audio_.stop();
    });

    bar.querySelector('#cx-keep').addEventListener('click', () => {
      if (previous === null) return;
      applyProgression(previous);
      previous = null;
      LAST_SHUFFLE = null;
      bar.querySelector('#cx-keep').hidden = true;
      hideNote();
    });

    bar.querySelector('#cx-play').addEventListener('click', () => {
      if (!Audio_.play(CURRENT_PROGRESSION)) {
        showNote(esc(S.noAudio));
      }
    });
  }

  function showNote(html) {
    const el = document.getElementById('cx-note');
    if (!el) return;
    el.innerHTML = html;
    el.hidden = false;
  }
  function hideNote() {
    const el = document.getElementById('cx-note');
    if (el) el.hidden = true;
  }

  // Everything shown here is re-read from the vocabulary in the page's language.
  // generateProgression returns ids precisely so the prose is chosen at display
  // time rather than baked into the result.
  function showShuffleNote(r) {
    const mode = VOCAB.modes[r.mode];
    const strategy = VOCAB.strategies.find(s => s.id === r.strategy);
    const decorators = VOCAB.decorators || [];
    const extras = r.notes.length
      ? `<div class="cx-extras">${r.notes
          .map(id => decorators.find(d => d.id === id))
          .filter(Boolean)
          .map(d => '<span>' + esc(loc(d, 'explain')) + '</span>').join('')}</div>`
      : '';
    showNote(`
      <div class="cx-head"><strong>${esc(r.tonic + ' ' + loc(mode, 'label'))}</strong> · ${esc(loc(strategy, 'label'))}</div>
      <div class="cx-degrees">${esc(r.degreeLine)}</div>
      <div class="cx-why">${esc(loc(strategy, 'explain'))}</div>
      ${mode && loc(mode, 'note') ? `<div class="cx-why cx-dim">${esc(loc(mode, 'note'))}</div>` : ''}
      ${extras}
    `);
  }

  // ===================================================================
  // CHORD POPUP
  // ===================================================================

  let CURRENT_TOOLTIP_CLOSE = null;

  function attachChordTooltips(root) {
    (root || document).querySelectorAll('.chord').forEach(el => {
      if (el.dataset.cxBound) return;
      el.dataset.cxBound = '1';
      attachOneChord(el, el.dataset.chord);
    });
  }

  function attachOneChord(el, chordNameInit) {
    let chordName = chordNameInit;
    let posIndex = 0;
    let tooltip = null;
    let mode = 'view';
    let harmTab = 'diatonic';
    let draftFrets = [-1, -1, -1, -1, -1, -1];
    let draftName = '';

    const positions = () => allVoicings(chordName);

    function maxHeight() {
      const list = positions();
      if (!list.length) return 165;
      let maxH = 0;
      for (const p of list) {
        const fretted = p.frets.filter(f => f > 0);
        const maxFret = fretted.length ? Math.max(...fretted) : p.baseFret + 3;
        const numFrets = Math.max(4, maxFret - p.baseFret + 1);
        maxH = Math.max(maxH, 36 + numFrets * 22 + 22);
      }
      return maxH;
    }

    function place() {
      if (!tooltip) return;
      const rect = el.getBoundingClientRect();
      const tt = tooltip.getBoundingClientRect();
      let left = rect.left + window.scrollX + rect.width / 2 - tt.width / 2;
      left = Math.min(left, window.scrollX + window.innerWidth - tt.width - 12);
      left = Math.max(left, window.scrollX + 12);
      let top = rect.bottom + window.scrollY + 10;
      if (rect.bottom + tt.height + 20 > window.innerHeight) top = rect.top + window.scrollY - tt.height - 10;
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    }

    function actionsBar() {
      const inProg = el.dataset.progIdx !== undefined;
      return `<div class="tt-actions">
        ${inProg ? `<button class="tt-action-btn ${mode === 'rename' ? 'active' : ''}" data-mode="rename" type="button">${esc(S.replace)}</button>` : ''}
        <button class="tt-action-btn ${mode === 'add' ? 'active' : ''}" data-mode="add" type="button">${esc(S.addFingering)}</button>
        <button class="tt-action-btn ${mode === 'harmonic' ? 'active' : ''}" data-mode="harmonic" type="button">${esc(S.neighbours)}</button>
      </div>`;
    }

    function viewBody() {
      const list = positions();
      if (!list.length) {
        return `<div class="tt-name">${esc(chordName)}</div>
          <div class="tt-fretboard" style="height:auto;min-height:80px">
            <div style="color:var(--text-faint);font-size:12px;text-align:center;padding:16px 8px;line-height:1.5">
              ${S.noShapeFor(esc(chordName), esc(tuningKey()))}
              <br><br>${S.clickToAdd(esc(S.addFingering))}
            </div></div>`;
      }
      posIndex = Math.min(posIndex, list.length - 1);
      const p = list[posIndex];
      const pinned = isPinned(chordName, p);
      const dots = list.map((v, i) =>
        `<span class="tt-dot${i === posIndex ? ' active' : ''}${isPinned(chordName, v) ? ' pinned' : ''}" data-i="${i}"></span>`).join('');
      const badge = p._user ? `<span class="tt-custom-badge">${esc(S.yours)}</span>`
                  : p._curated ? '' : `<span class="tt-custom-badge tt-gen">${esc(S.computed)}</span>`;
      return `<div class="tt-name">${esc(chordName)}, ${esc(shapeName(p))}${badge}</div>
        <div class="tt-fretboard" style="height:${maxHeight()}px">${renderFretboard(p)}</div>
        <div class="tt-controls">
          <button class="tt-arrow tt-prev" type="button" aria-label="${esc(S.prevShape)}">‹</button>
          <span class="tt-pos">${posIndex + 1} / ${list.length}</span>
          <button class="tt-arrow tt-next" type="button" aria-label="${esc(S.nextShape)}">›</button>
          <button class="tt-pin ${pinned ? 'pinned' : ''}" type="button" title="${esc(pinned ? S.pinRemove : S.pinAdd)}">★</button>
        </div>
        <div class="tt-dots">${dots}</div>
        ${p._user ? `<button class="tt-delete-btn" type="button">${esc(S.deleteFingering)}</button>` : ''}`;
    }

    function addForm() {
      return `<div class="tt-name">${esc(S.fingeringTitle(chordName, tuningKey()))}</div>
        <div class="fret-editor">${renderFretboardEditor(draftFrets, 7)}</div>
        <div class="tt-add-form">
          <input class="tt-add-name" type="text" placeholder="${esc(S.nameOptional)}" value="${esc(draftName)}">
          <div class="tt-form-buttons">
            <button class="tt-add-clear" type="button">${esc(S.clear)}</button>
            <button class="tt-add-cancel" type="button">${esc(S.cancel)}</button>
            <button class="save tt-add-save" type="button">${esc(S.add)}</button>
          </div>
        </div>`;
    }

    function renameForm() {
      return `<div class="tt-name">${esc(S.replaceTitle(chordName))}</div>
        <div class="tt-add-form">
          <input class="tt-rename-input" type="text" placeholder="${esc(S.replacePlaceholder)}" value="">
          <span class="tt-form-label" style="color:var(--text-faint);font-size:10px">
            ${esc(S.replaceHint)}
          </span>
          <div class="tt-form-buttons">
            <button class="tt-rename-cancel" type="button">${esc(S.cancel)}</button>
            <button class="save tt-rename-save" type="button">${esc(S.doReplace)}</button>
          </div>
        </div>`;
    }

    function harmonicPanel() {
      const tabs = ['diatonic', 'fifths', 'jazz', 'modes']
        .map(k => `<button class="tt-harm-tab ${harmTab === k ? 'active' : ''}" data-tab="${k}" type="button">${esc(S.tabs[k])}</button>`).join('');
      const items = neighbours(chordName, harmTab).map(it =>
        `<button class="tt-harm-item" data-chord="${esc(it.chord)}" type="button"><span class="h-chord">${esc(it.chord)}</span><span class="h-label">${esc(it.label)}</span></button>`).join('');
      return `<div class="tt-name">${esc(S.neighboursTitle(chordName, S.tabs[harmTab]))}</div>
        <div class="tt-harm-panel">
          <div class="tt-harm-tabs">${tabs}</div>
          <div class="tt-harm-list">${items || `<div style="color:var(--text-faint);font-size:11px;text-align:center;padding:8px">${esc(S.noSuggestion)}</div>`}</div>
        </div>`;
    }

    function update() {
      if (!tooltip) return;
      const body = mode === 'add' ? addForm()
                 : mode === 'harmonic' ? harmonicPanel()
                 : mode === 'rename' ? renameForm()
                 : viewBody();
      tooltip.innerHTML = '<button class="tt-close" type="button" aria-label="Close">×</button>' + body + actionsBar();
      bind();
    }

    function setCurrentChord(newName, alsoInProgression) {
      if (alsoInProgression && el.dataset.progIdx !== undefined) {
        replaceChordAtIdx(parseInt(el.dataset.progIdx, 10), newName);
      }
      chordName = newName;
      posIndex = 0;
      mode = 'view';
      update();
    }

    function bind() {
      const q = s => tooltip.querySelector(s);
      const close = q('.tt-close');
      if (close) close.addEventListener('click', closeTooltip);

      const prev = q('.tt-prev');
      if (prev) prev.addEventListener('click', e => {
        e.stopPropagation();
        const n = positions().length;
        posIndex = (posIndex - 1 + n) % n; update();
      });
      const next = q('.tt-next');
      if (next) next.addEventListener('click', e => {
        e.stopPropagation();
        const n = positions().length;
        posIndex = (posIndex + 1) % n; update();
      });
      tooltip.querySelectorAll('.tt-dot').forEach(d => d.addEventListener('click', e => {
        posIndex = parseInt(e.target.dataset.i, 10); update();
      }));

      const pin = q('.tt-pin');
      if (pin) pin.addEventListener('click', e => {
        e.stopPropagation();
        const p = positions()[posIndex];
        if (p) { togglePin(chordName, p); renderActiveVoicings(); update(); }
      });

      const del = q('.tt-delete-btn');
      if (del) del.addEventListener('click', () => {
        const before = curatedFor(chordName).length + generatedFor(chordName).filter(
          v => !curatedFor(chordName).some(c => c.frets.join() === v.frets.join())).length;
        const userIdx = posIndex - before;
        if (userIdx >= 0) {
          removeUserVoicing(chordName, userIdx);
          posIndex = Math.max(0, posIndex - 1);
          renderActiveVoicings(); update();
        }
      });

      tooltip.querySelectorAll('.tt-action-btn').forEach(btn => btn.addEventListener('click', () => {
        const m = btn.dataset.mode;
        if (mode === m) mode = 'view';
        else {
          mode = m;
          if (mode === 'add') {
            const p = positions()[posIndex];
            draftFrets = p ? p.frets.slice() : [-1, -1, -1, -1, -1, -1];
            draftName = '';
          }
        }
        update();
      }));

      const editor = q('.fret-editor');
      if (editor) editor.addEventListener('click', e => {
        const target = e.target.closest('.edit-cell, .edit-toggle');
        if (!target) return;
        const s = parseInt(target.dataset.string, 10), f = parseInt(target.dataset.fret, 10);
        if (isNaN(s) || isNaN(f)) return;
        draftFrets[s] = (draftFrets[s] === f && f !== -1) ? -1 : f;
        const ed = q('.fret-editor');
        if (ed) ed.innerHTML = renderFretboardEditor(draftFrets, 7);
      });

      const addName = q('.tt-add-name');
      if (addName) addName.addEventListener('input', () => { draftName = addName.value; });
      const addSave = q('.tt-add-save');
      if (addSave) addSave.addEventListener('click', () => {
        if (!draftFrets.some(f => f >= 0)) {
          addSave.textContent = S.nothingToPlay;
          setTimeout(() => { addSave.textContent = S.add; }, 1500);
          return;
        }
        const v = buildVoicingFromFrets(draftFrets.slice(), draftName.trim() || 'custom');
        addUserVoicing(chordName, v);
        if (!isPinned(chordName, v)) togglePin(chordName, v);
        posIndex = positions().length - 1;
        renderActiveVoicings();
        mode = 'view';
        update();
      });
      const addCancel = q('.tt-add-cancel');
      if (addCancel) addCancel.addEventListener('click', () => { mode = 'view'; update(); });
      const addClear = q('.tt-add-clear');
      if (addClear) addClear.addEventListener('click', () => {
        draftFrets = [-1, -1, -1, -1, -1, -1];
        const ed = q('.fret-editor');
        if (ed) ed.innerHTML = renderFretboardEditor(draftFrets, 7);
      });

      tooltip.querySelectorAll('.tt-harm-tab').forEach(t =>
        t.addEventListener('click', () => { harmTab = t.dataset.tab; update(); }));
      tooltip.querySelectorAll('.tt-harm-item').forEach(item =>
        item.addEventListener('click', () => setCurrentChord(item.dataset.chord, true)));

      const rIn = q('.tt-rename-input'), rSave = q('.tt-rename-save'), rCancel = q('.tt-rename-cancel');
      if (rIn) {
        rIn.focus();
        rIn.addEventListener('keydown', e => {
          if (e.key === 'Enter') rSave.click();
          if (e.key === 'Escape') rCancel.click();
        });
      }
      if (rSave) rSave.addEventListener('click', () => {
        const v = rIn.value.trim();
        if (!v) return;
        if (!Theory.parseChord(v)) {
          rSave.textContent = S.notAChord;
          setTimeout(() => { rSave.textContent = S.doReplace; }, 1500);
          return;
        }
        setCurrentChord(v, true);
      });
      if (rCancel) rCancel.addEventListener('click', () => { mode = 'view'; update(); });
    }

    function closeTooltip() {
      if (tooltip) { tooltip.remove(); tooltip = null; }
      if (CURRENT_TOOLTIP_CLOSE === closeTooltip) CURRENT_TOOLTIP_CLOSE = null;
    }

    function show() {
      if (tooltip) return;
      if (CURRENT_TOOLTIP_CLOSE) CURRENT_TOOLTIP_CLOSE();
      chordName = el.dataset.chord || chordNameInit;
      const list = positions();
      const pins = pinnedVoicings(chordName);
      posIndex = pins.length ? Math.max(0, list.findIndex(v => fretKey(v.frets) === fretKey(pins[0].frets))) : 0;
      mode = 'view';
      harmTab = 'diatonic';
      draftFrets = [-1, -1, -1, -1, -1, -1];
      draftName = '';
      tooltip = document.createElement('div');
      tooltip.className = 'chord-tooltip';
      document.body.appendChild(tooltip);
      update();
      place();
      CURRENT_TOOLTIP_CLOSE = closeTooltip;
    }

    el.addEventListener('mouseenter', show);
    el.addEventListener('focus', show);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
  }

  // ===================================================================
  // NEIGHBOURING CHORDS  (the ⚇ panel)
  // ===================================================================

  function neighbours(chordName, type) {
    const p = Theory.parseChord(chordName);
    if (!p) return [];
    const isMin = Theory.isMinorish(p);
    const flat = /b/.test(Theory.normalizeAccidentals(p.root));
    const T = (n, suffix) => Theory.spellNote((p.rootPc + n) % 12, flat || [1, 3, 8, 10].indexOf(n) >= 0) + (suffix || '');

    const L = S.nb;
    switch (type) {
      case 'diatonic':
        return isMin ? [
          { chord: T(2, 'dim'), label: L.ii_dim },
          { chord: T(3), label: L.bIII },
          { chord: T(5, 'm'), label: L.iv },
          { chord: T(7, 'm'), label: L.v_min },
          { chord: T(7), label: L.V_maj },
          { chord: T(8), label: L.bVI },
          { chord: T(10), label: L.bVII }
        ] : [
          { chord: T(2, 'm'), label: L.ii },
          { chord: T(4, 'm'), label: L.iii },
          { chord: T(5), label: L.IV },
          { chord: T(7), label: L.V },
          { chord: T(9, 'm'), label: L.vi },
          { chord: T(11, 'dim'), label: L.vii_dim }
        ];

      case 'fifths':
        return [
          { chord: T(7, isMin ? 'm' : ''), label: L.fifthUp },
          { chord: T(5, isMin ? 'm' : ''), label: L.fourthUp },
          { chord: T(7), label: L.majorV },
          { chord: T(0, isMin ? '' : 'm'), label: isMin ? L.parallelMajor : L.parallelMinor },
          { chord: isMin ? T(3) : T(9, 'm'), label: isMin ? L.relMajor : L.relMinor },
          { chord: T(2, isMin ? 'dim' : 'm'), label: L.colour }
        ];

      case 'jazz':
        return isMin ? [
          { chord: p.root + 'm7', label: L.add7m },
          { chord: p.root + 'm9', label: L.m9 },
          { chord: p.root + 'm11', label: L.m11 },
          { chord: T(3, 'maj7'), label: L.bIIImaj7 },
          { chord: T(5, 'm7'), label: L.iv7 },
          { chord: T(7, '7'), label: L.V7hm },
          { chord: T(1, '7'), label: L.tritone }
        ] : [
          { chord: p.root + 'maj7', label: L.addMaj7 },
          { chord: p.root + '9', label: L.add9 },
          { chord: p.root + '13', label: L.add13 },
          { chord: T(9, 'm7'), label: L.vim7 },
          { chord: T(2, 'm7'), label: L.iim7 },
          { chord: T(7, '7'), label: L.V7 },
          { chord: T(1, '7'), label: L.tritone }
        ];

      case 'modes':
        return isMin ? [
          { chord: T(0, 'm'), label: L.aeolianHere },
          { chord: T(5), label: L.dorian },
          { chord: T(1), label: L.phrygian },
          { chord: T(2), label: L.misheberach },
          { chord: T(7), label: L.harmonicMinor },
          { chord: T(2, 'dim'), label: L.locrian }
        ] : [
          { chord: T(0), label: L.ionianHere },
          { chord: T(1), label: L.ahavaRabbah },
          { chord: T(6), label: L.lydian },
          { chord: T(10), label: L.mixolydian },
          { chord: T(8), label: L.aeolian },
          { chord: T(3), label: L.phrygianIII }
        ];
    }
    return [];
  }

  // ===================================================================
  // INIT
  // ===================================================================

  function init() {
    // Tuning first: everything downstream depends on it.
    const saved = readJSON(K_TUNING, null);
    if (Array.isArray(saved) && saved.length === 6) TUNING = saved.slice();

    const presetEl = document.getElementById('tuning-preset');
    const customEl = document.getElementById('tuning-custom');
    if (presetEl) {
      const matched = findTuningPreset(TUNING);
      if (matched) presetEl.value = matched;
      else if (customEl) { presetEl.value = 'custom'; customEl.hidden = false; customEl.value = TUNING.join(' '); }
      presetEl.addEventListener('change', () => {
        if (presetEl.value === 'custom') {
          if (customEl) { customEl.hidden = false; customEl.focus(); customEl.value = TUNING.join(' '); }
        } else {
          if (customEl) customEl.hidden = true;
          const arr = TUNING_PRESETS[presetEl.value];
          if (arr) setTuning(arr);
        }
      });
    }
    if (customEl) customEl.addEventListener('input', () => {
      const arr = parseTuningString(customEl.value);
      if (arr) setTuning(arr);
    });
    setTuning(TUNING);

    let progression = DEFAULT_PROGRESSION;
    try {
      const savedProg = localStorage.getItem(K_PROG);
      if (savedProg) progression = savedProg;
    } catch (e) {}
    applyProgression(progression, { persist: false });

    attachChordTooltips(document.querySelector('.chant-tip'));
    document.querySelectorAll('.stich-chords').forEach(el => attachChordTooltips(el));

    // Capture phase: read the click target before a tooltip handler replaces the
    // innerHTML underneath it and detaches that node from the document.
    document.addEventListener('click', e => {
      if (!CURRENT_TOOLTIP_CLOSE) return;
      if (e.target.closest('.chord-tooltip') || e.target.closest('.chord')) return;
      CURRENT_TOOLTIP_CLOSE();
    }, true);

    const reset = document.getElementById('prog-reset');
    if (reset) reset.addEventListener('click', () => {
      applyProgression(DEFAULT_PROGRESSION);
      try { localStorage.removeItem(K_PROG); } catch (e) {}
      const keep = document.getElementById('cx-keep');
      if (keep) keep.hidden = true;
      hideNote();
      Audio_.stop();
    });

    const print = document.getElementById('print-btn');
    if (print) print.addEventListener('click', () => window.print());

    // The shuffle vocabulary is data, so it is fetched rather than inlined. The
    // rest of the chart works without it; only the shuffle bar waits.
    fetch(DATA_URL)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(json => { VOCAB = json; Theory.setVocabulary(json); buildShuffleBar(); })
      .catch(err => console.warn('[chords] progression vocabulary unavailable:', err.message));
  }

  // document.currentScript is null once we are inside a deferred callback, so the
  // data path is resolved from the script's own URL here and not against the
  // document: the pages sit one folder deep but the module is shared.
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  const DATA_URL = SCRIPT_SRC
    ? SCRIPT_SRC.replace(/assets\/chords\.js.*$/, 'data/progressions.json')
    : '../data/progressions.json';

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Exposed for the smoke test and for the console.
  window.ChordChart = {
    apply: applyProgression,
    current: () => CURRENT_PROGRESSION,
    voicings: allVoicings,
    tuning: () => TUNING.slice(),
    setTuning,
    shuffleResult: () => LAST_SHUFFLE,
    audio: Audio_
  };
})();
