# Authoring a traditional song page

You write **English only**. Every Hebrew character on the finished page comes from a
pinned edition and every transliteration from this site's own engine. You never type
Hebrew, and `tools/songs-validate.mjs` refuses your file if you do.

This is not a style rule. The project has spent months removing roughly 410 niqqud
errors from pages that were written by hand, and wrong niqqud looks exactly like right
niqqud. So the machine owns the Hebrew and you own the English. Same contract as
`content/tehilim/AUTHORING.md`, and it is worth reading that one too.

## Adding a song

1. Add a row to `content/songs/index.json`: `n`, `slug`, `category`, `family`, `ref`.
   The `ref` is a Sefaria reference. Nothing else in code changes.
2. `node tools/songs-scaffold.mjs <n>` — fetches the Hebrew, pins it in
   `content/songs/source/NNN.json`, and prints everything it removed.
3. Write `content/songs/NNN.json` (below).
4. `node tools/songs-validate.mjs <n>` then `node tools/songs-build.mjs <n>`.
5. `node tools/songs-index.mjs` and `node tools/build-sw.mjs`.
6. `node tools/songs-hebrew-check.mjs <n>` — reads the shipped page back and compares
   it with the source, codepoint for codepoint.

## What the scaffold gives you

```json
{ "song": 17, "slug": "dror-yikra", "ref": "...",
  "heVersion": "Daat Siddur Ashkenaz", "heLicense": "Public Domain",
  "enRaw": ["..."],
  "droppedByScaffold": [ { "why": "variant reading", "line": "...", "variant": "..." } ],
  "lines": [ { "i": 0, "he": "...",
               "words": [ { "i": 0, "he": "...", "tr": "de-ROR", "gloss": "" } ] } ] }
```

`enRaw` is the source translation where a freely licensed one exists. It is **raw
material, not your output**: read it for the sense, then write a line a learner in 2026
can map word by word onto the Hebrew above it.

**Read `droppedByScaffold` every time.** It lists what was removed as editorial matter —
colophons, rubrics, variant readings — and it is printed rather than dropped silently
because a filter that discards quietly and a broken source look identical from outside.

## What you write

```json
{
  "song": 17,
  "titleEn": "Dror Yikra",
  "subtitleEn": "He will proclaim freedom",
  "heTitleNote": "Shabbat day, at the second meal",
  "tempo": 100,
  "progression": "| Am Am | Dm Am | E E | Am Am |",
  "metaLine": "100 BPM · 4/4 · ...",
  "intro": "...",
  "vocab": { "ten": "give! (2ms)" },
  "stanzas": [
    { "n": 1, "label": "freedom", "from": 0, "to": 3,
      "lines": [
        { "en": "...", "glosses": ["...", "..."], "chords": "| Am | Dm |" }
      ],
      "summary": "..." }
  ],
  "chantTips": ["...", "..."],
  "about": [ { "h": "...", "body": "..." } ]
}
```

### The rules the validator enforces

| Rule | Why |
|---|---|
| no Hebrew anywhere | the whole point |
| stanzas cover every source line once, in order | a stanza that skips a line drops it off the page and still looks complete |
| every word ends with a gloss | a blank cell ships silently |
| the grid yields a key | see below |
| `intro` ≥ 60 chars, ≥ 2 `chantTips`, ≥ 2 `about` sections | a page that ships half-written |

### Stanzas, lines and stichs

`from`/`to` are **line** indices into the source. Each entry in `lines` is the English
for one source line, in order.

A line may instead declare word-level `stichs` when one source line is too long to sing
in one breath — the Tanakh songs, whose "line" is a whole biblical verse:

```json
"lines": [ { "stichs": [
  { "from": 0, "to": 5, "en": "...", "glosses": [...], "chords": "| Em | Am |" },
  { "from": 6, "to": 10, "en": "...", "glosses": [...] }
] } ]
```

Those ranges obey the same rule as psalm stichs: cover every word once, in order.

### Glosses

Per word, in source order, as `glosses`. An empty string falls through to `vocab`.

`vocab` is a per-song glossary keyed on the **transliteration**, not the Hebrew — you
may not type Hebrew, and the transliteration is machine-generated so you cannot mistype
it into matching the wrong word. It exists because Chad Gadya is 196 cells over twenty
distinct words and Echad Mi Yodea is 345 over fewer. A line-level gloss always wins,
for the places where context changes the sense.

If a word appears in `data/songs-conventions.json` under `readAs`, key the vocab on the
**corrected reading**, which is what the page shows.

### Chords

`chords` is optional per line. `progression` is the page's grid and is required, and the
key is **derived** from it by `tools/chord-key.mjs` — never written. The psalm template
held the key as a literal and shipped `Am` over 126 grids in other keys, which sent the
shuffle generator into the wrong scale on every one of them. `deriveKey` throws rather
than name a key it cannot read off the grid.

### Quoting Hebrew in your prose

By reference, never by typing. `{{3.2}}` means source line 3, word 2, and expands to the
real vocalized word with its reading. An index that does not exist is a build error, not
a blank — the difference between a citation and a guess.

## Things that have gone wrong here, so you do not repeat them

1. **Sefaria does not encode stanza breaks.** The empty strings in its arrays are
   typesetting. Read as structure they gave one song "36 stanzas of one line" and
   another "one stanza of 33". Grouping is your decision, recorded in `from`/`to`.
2. **Do not pre-fill glosses from `data/gloss.json`.** It is verified and correct for
   the lessons it serves, and wrong here: it glosses the choice vine of Dror Yikra as a
   desalination plant, `bamidbar` as "Numbers", `chai` as a pop song. A lookup that
   cannot see context is confidently wrong exactly where context decides.
   `songs-scaffold --suggest` writes suggestions to `tools/reports/` and never to a page.
3. **An edition prints more than the song.** Colophons, rubrics, variant readings, and
   words broken across a column break. All handled, all reported; read the report.
4. **Never copy a Hebrew character class between files.** One was copied from the psalm
   scaffold and came back with two codepoints transposed — "accents plus meteg" became
   "accents through meteg" and deleted every vowel point in the language, with both
   lines rendering identically. Cleaning lives once, in `tools/hebrew-clean.mjs`, with a
   self-test that asserts all sixteen vowel points individually. Run it; do not trust
   how the file looks.
5. **Do not go looking for Hebrew by typing Hebrew.** A script written to find the
   Jerusalem spellings matched against literals typed by hand, found none, and reported
   "0 forms found" as though the sources were clean. Match on the machine-generated
   transliteration, which is ASCII.

## Choosing what to add

Only songs whose Hebrew has a citable source, because the pipeline refuses hand-typed
Hebrew. That rules out the folk repertoire whose words exist on lyric sites and nowhere
citable, and it rules out post-1928 melodies whose text is not the point.

The scaffold also refuses an edition with no vowel points — a song with bare consonants
is useless on a site that teaches reading. Ki Eshmera Shabbat was dropped for exactly
this reason and Shabbat HaYom took its slot; see the `_was` note in the registry.

Nothing should duplicate a page the site already ships. Psalms 133, 121 and 126 already
have singable pages, so Hine Ma Tov, Esa Einai and Shir HaMa'alot are absent.
