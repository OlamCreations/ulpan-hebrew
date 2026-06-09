# Tehilim content authoring spec

You author ONE psalm as a single JSON file: `_tehilim_build/content/ps{N}.json`.
A generator turns it into two faithful pages (FR + EN) identical in structure to the
artisanal model Psalm 1. You only write CONTENT, never HTML scaffolding.

## Read first
1. Your Hebrew brief: `_tehilim_build/brief/ps{N}.txt` — REAL Masoretic (Aleppo/MAM) Hebrew
   per verse + a JPS English reference. The Hebrew is GROUND TRUTH.
2. The gold example: `_tehilim_build/content/ps1.json` — copy its style, depth, and JSON shape exactly.

## Hard rules
- **Hebrew niqqud: COPY from the brief, never invent or alter a vowel.** Split a verse into
  its words on spaces. (Maqaf is already normalized to spaces in the brief.)
- **Tetragrammaton** יְהוָה / יְהֹוָה : keep the Hebrew as written; transliterate `a-do-<b>NAY</b>`;
  gloss "the LORD" (en) / "l'Éternel" (fr). Same convention as Ps 1.
- **Transliteration**: modern Israeli/Sephardi. `kh`=chaf, `ch`=chet, `tz`=tzadi, `'`=ayin/aleph break.
  Mark the STRESSED syllable with `<b>...</b>` (Biblical Hebrew is usually milra — last syllable —
  but many segolates/forms are milel — penult; follow the te'amim/known pronunciation). Examples
  from Ps 1: `ash-<b>REI</b>`, `ha-<b>ISH</b>`, `<b>MA</b>-yim`, `ya-a-<b>SE</b>`.
- **Chords**: use ONLY this set: `Am Em Dm F C G`. Keep the A-minor family like Ps 1
  (contemplative, fits the chord library on the page). 8 chords in `progression_chords`,
  grouped as 4 bars of 2. `default_progression` must be the matching `| c1 c2 | c3 c4 | c5 c6 | c7 c8 |` string.
- **No em dashes in the FRENCH text** (use comma, semicolon, colon, parentheses). English may use them.
- **Superscription**: if v1 of your brief is a title (e.g. "מִזְמוֹר לְדָוִד..."), it IS verse 1 — keep num "1".
- Output **valid JSON only**, UTF-8, to the file. Escape `"` and `\` properly. No trailing commas.

## JSON schema (exact keys)
```json
{
  "n": <int>,
  "letter": "<hebrew numeral: 2=ב 3=ג 4=ד 5=ה 6=ו 7=ז 8=ח 9=ט 10=י>",
  "incipit": "<first 2-3 Hebrew words of v1 WITH niqqud>",
  "key": "Am",
  "progression_chords": ["Am","Am","Em","Em","Am","Dm","Em","Am"],
  "default_progression": "| Am Am | Em Em | Am Dm | Em Am |",
  "h1": {"en": "<short title phrase, e.g. 'Why do the nations rage'>", "fr": "<idem fr>"},
  "intro": {"en": "<2-4 sentence intro: theme, structure, liturgical use>", "fr": "<idem fr>"},
  "meta_line": {
    "en": "~70 BPM · 4/4 · gentle thumb-index-middle arpeggio · one bar per stich, two bars per verse · to reset the progression: <button id=\"prog-reset\" class=\"link-btn\" type=\"button\">↺ restore default</button>",
    "fr": "~70 BPM · 4/4 · arpège doux pouce-index-majeur · une mesure par stique, deux mesures par verset · pour réinitialiser la progression : <button id=\"prog-reset\" class=\"link-btn\" type=\"button\">↺ remettre par défaut</button>"
  },
  "chant_li": {
    "en": ["<li inner html>", "... 6-7 items, may contain <span class=\"chord\" data-chord=\"Am\">Am</span>"],
    "fr": ["<idem fr, 6-7 items>"]
  },
  "pardes": {
    "en": [
      {"h4": "פשט · Peshat — literal meaning", "p": "<paragraph>"},
      {"h4": "רמז · Remez — allusion", "p": "<paragraph>"},
      {"h4": "דרש · Drash — interpretation", "p": "<paragraph>"},
      {"h4": "סוד · Sod — mystical meaning", "p": "<paragraph>"}
    ],
    "fr": [
      {"h4": "פשט · Peshat — sens littéral", "p": "<paragraphe>"},
      {"h4": "רמז · Remez — allusion", "p": "<paragraphe>"},
      {"h4": "דרש · Drash — interprétation", "p": "<paragraphe>"},
      {"h4": "סוד · Sod — sens mystique", "p": "<paragraphe>"}
    ]
  },
  "verses": [
    {
      "num": "1",
      "full": ["<hebrew line 1>", "<hebrew line 2>", "..."],
      "stichs": [
        {
          "words": [
            {"he": "<word>", "tr": "<trans-<b>LIT</b>>", "en": "<gloss>", "fr": "<glose>"}
          ],
          "trans": {"en": "<clean english line>", "fr": "<ligne française propre>"}
        }
      ],
      "summary": {"en": "<1-2 sentence insight, <strong>/<em> allowed>", "fr": "<idem fr>"}
    }
  ]
}
```

## Quality bar (match Ps 1)
- Every Hebrew word of every verse appears once as a `word` cell, in order.
- `full` = the same verse split into 2-4 poetic lines; stichs follow the same line breaks.
- `summary` and `pardes` carry a real insight (grammar, a verb's root, an image, a structural
  pivot) — not a paraphrase. Cite verse numbers in pardes like Ps 1 (e.g. "<strong>V.3</strong>:").
- French is natural French, not translated-from-English stiffness, and uses no em dashes.
