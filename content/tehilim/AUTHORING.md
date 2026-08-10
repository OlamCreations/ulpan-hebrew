# Authoring a Tehilim page

You write **English only**. Every Hebrew character on the finished page comes from
the Masoretic text and every transliteration from this site's own engine. You never
type Hebrew, and `tools/tehilim-validate.mjs` refuses your file if you do.

This is not a style rule. The project has spent months removing roughly 410 niqqud
errors from pages that were written by hand, and wrong niqqud looks exactly like
right niqqud. So the machine owns the Hebrew and you own the English.

## What you get

`content/tehilim/source/NNN.json`, produced from Sefaria and pinned in the repo:

```json
{ "psalm": 23, "heRef": "תהילים כ״ג",
  "verses": [ { "n": 1,
                "he": "מִזְמוֹר לְדָוִד ...",
                "enLines": ["A Psalm of David.", "The LORD is my shepherd; ..."],
                "words": [ { "i": 0, "he": "מִזְמוֹר", "tr": "miz-MOR" }, ... ] } ] }
```

`enLines` is JPS 1917, public domain. It is **raw material, not your output**: it is
Edwardian English ("Thou preparest", "Yea, though I walk"). Read it for the sense,
then write a line a learner in 2026 can map word by word onto the Hebrew above it.

## What you write

`content/tehilim/NNN.json`:

```json
{
  "psalm": 23,
  "titleEn": "The LORD is my shepherd",
  "tempo": 66,
  "progression": "| Am Am | Dm Dm | Am Em | Am Am |",
  "intro": "...",
  "verses": [
    { "n": 1,
      "stichs": [ { "from": 0, "to": 1, "en": "A psalm of David." },
                  { "from": 2, "to": 5, "en": "The LORD is my shepherd; I shall not want." } ],
      "glosses": ["a psalm", "of David", "the LORD", "my shepherd", "not", "I shall lack"],
      "summary": "..." } ],
  "pardes": [ { "level": "peshat", "body": "..." },
              { "level": "remez",  "body": "..." },
              { "level": "drash",  "body": "..." },
              { "level": "sod",    "body": "..." } ]
}
```

### The rules the validator enforces

1. **No Hebrew characters anywhere.** Not in a gloss, not in the commentary.
2. **`stichs` partition the verse.** The first starts at word 0, each next starts
   where the previous ended plus one, the last ends at the final word. No gaps, no
   overlaps. A stich is a poetic line, usually a half-verse.
3. **`glosses` has exactly one entry per word**, in word order, none empty.
4. **Every verse of the psalm is present**, numbered as in the data.
5. **`summary` is at least 25 characters, `intro` at least 60, each pardes body at
   least 80.** No "TODO", no "...".

### Quoting Hebrew in prose

You cannot type it, so reference it: `{{4.9}}` means verse 4, word 9. The builder
expands it into the real vocalized word with its transliteration. An index that does
not exist is a build error, so check it against the data file.

## What makes a gloss good

The gloss sits directly under one Hebrew word. It translates **that word**, not the
sentence, and it keeps the grammar visible:

- `בְּגֵיא` → "in a valley of" — the prefix and the construct state are both real
- `יְנַחֲמֻנִי` → "comfort me" — the object suffix is part of the word
- `וּמִשְׁעַנְתֶּךָ` → "and Your staff" — so is the conjunction and the possessive

Do not write "valley", "comfort", "staff". The learner is reading the morphology.

Leave the divine names alone: the builder glosses יְהֹוָה, אֱלֹהִים and אֲדֹנָי from
`data/tehilim-conventions.json`, so whatever you put at those indices is ignored.
Put a placeholder-free string there anyway, e.g. "the LORD".

## What makes the prose good

- **intro**: what this psalm is, when it is said, and one thing a learner should
  notice. Concrete. No "this beautiful psalm".
- **summary** (per verse): one or two sentences on what this verse does in the
  argument. Not a restatement of the translation.
- **pardes**: peshat is the plain reading; remez the allusion, the wordplay, the
  philological crux; drash what the rabbis did with it; sod the mystical reading.
  Say who says a thing when it is contested. Where a reading is disputed, say that
  it is disputed rather than picking a side silently.

Do not invent a source. If you do not know that a specific midrash says a specific
thing, write the reading without attaching a name to it. An invented attribution is
the one error this pipeline cannot catch.

## Tone

Match the pages that already exist (`liturgy/tehilim-023-en.html` is the worked
example, `content/tehilim/023.json` its source). Direct, concrete, no filler. No em
dashes in prose. No "it is worth noting". The reader is an adult learning Hebrew,
not a congregation being addressed.

## Finishing

```
node tools/tehilim-validate.mjs NNN
```

Fix until it says `ok`. Then you are done: the build is not yours to run.
