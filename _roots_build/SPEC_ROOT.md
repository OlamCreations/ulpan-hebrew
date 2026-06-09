# Roots Atlas — content authoring spec

You author ONE root as a bilingual JSON: `_tehilim... no →` `_roots_build/content_roots/{slug}.json`.
A generator turns it into two pages (FR + EN) identical in structure to the gold model
`root-001` (the כ־ת־ב page). You write CONTENT only, never HTML.

## Read first
1. Your verified family: `_roots_build/families/{root}.json` — REAL pealim data: each member has
   `lemma` (vocalized Hebrew, niqqud correct), `pos` (Verb/Noun/Adjective), `binyan` (for verbs),
   `meaning` (English). **This is ground truth — copy the Hebrew lemmas exactly, never invent niqqud.**
2. The gold example: `_roots_build/content_roots/ktav.json` — match its shape, depth, and style exactly.

## Your job (the pedagogical layer on top of verified data)
- **Verbs** (pos=Verb) → the `binyanim` list. For each verb provide `bn` (its binyan, UPPER e.g. "PA'AL"),
  `he` (the exact lemma from the family = the infinitive), `tr` (transliteration), `gloss` {en,fr}.
  Order: PA'AL, NIF'AL, PI'EL, PU'AL, HIF'IL, HUF'AL, HITPA'EL. **Do NOT write a "voice" field** —
  the generator supplies the generic voice label per binyan.
- **Nouns / adjectives** (pos≠Verb) → the `groups`. Cluster them into 2 to 4 functional groups
  (e.g. ① the people / agent, ② the act / action-noun, ③ the thing / result, ④ the abstract or place).
  Use circled numerals ① ② ③ ④ in titles like the gold. Each word: `he` (exact lemma), `tr`,
  `gloss` {en,fr}, `mould` (the mishkal pattern in Hebrew letters with קטל slots, e.g. "מִקְטָל",
  "קְטִילָה", "הַקְטָלָה"), `mouldtip` {en,fr}. **If you are not sure of the mould, leave `mould`:""
  and `mouldtip`:{"en":"","fr":""} — never invent a wrong mould.**

## Hard rules
- **Hebrew = copy from the family file.** Do not alter a vowel. Verbs appear as the infinitive given.
- **Transliteration**: modern Israeli. `kh`=chaf, `ch`=chet, `tz`=tzadi, `'`=ayin/aleph break.
- **Tetragrammaton** never relevant here.
- **No em dashes in FRENCH text** (use comma, semicolon, colon, parentheses). English may use them.
- French is natural French, not stiff translation.
- Every family member appears exactly once (as a binyan row OR a group word). Don't drop or duplicate.
- Output **valid JSON only**, UTF-8, to the file. Escape `"` and `\`. No trailing commas.

## JSON schema (exact keys — see ktav.json for a filled example)
```json
{
  "n": <int you are told>,
  "root": "<consonantal, e.g. ספר>",
  "root_spaced": "<letters with spaces, e.g. ס פ ר>",
  "slug": "<latin slug you are told>",
  "translit": "<s · p · r>",
  "field": {"en":"<one word: the semantic field>", "fr":"<un mot>"},
  "field_phrase": {"en":"the <X> root", "fr":"la racine de <X>"},
  "h1": {"en":"Root <root_with_maqaf> — <field>", "fr":"Racine <root_with_maqaf> — <champ>"},
  "hero_gloss": {"en":"everything to do with <strong>X</strong>", "fr":"tout ce qui touche à <strong>X</strong>"},
  "intro": {"en":"<3-4 sentences: the root's core idea, how it radiates into verbs and nouns>", "fr":"<idem fr>"},
  "binyanim": [ {"bn":"PA'AL","he":"<infinitive>","tr":"<translit>","gloss":{"en":"to ...","fr":"..."}} ],
  "binyan_note": {"en":"<1-2 sentences: which binyanim are missing/not lexicalized, or a nuance>", "fr":"<idem>"},
  "groups": [ {"title":{"en":"① ...","fr":"① ..."}, "words":[ {"he":"...","tr":"...","gloss":{"en":"...","fr":"..."},"mould":"...","mouldtip":{"en":"...","fr":"..."}} ]} ],
  "quiz_title": {"en":"Root <maqaf> — decode check","fr":"Racine <maqaf> — vérifie"},
  "quiz": [ {"q":{"en":"...","fr":"..."}, "he":"<optional Hebrew prompt or omit>", "options":{"en":["a","b","c","d"],"fr":["a","b","c","d"]}, "answer":<0-3>, "explain":{"en":"...","fr":"..."}} ]
}
```
`root_spaced` uses spaces; the `<root_with_maqaf>` inside h1/quiz_title uses the maqaf form e.g. "ס־פ־ר".

## Quiz (5 questions)
Like the gold: where the meaning lives, a same-root recognition, a binyan-voice inference
(causative/passive/etc), a mould inference ("you meet new word X, it most likely means…"), and one
linking a mould to a famous word if natural. Make them specific to THIS root's words.

## Quality bar (match ktav.json)
- intro and groups carry real insight (the semantic thread linking the family, the mould → function logic).
- A learner should feel "one root unlocked a dozen words". Group titles name the function, not just "nouns".
