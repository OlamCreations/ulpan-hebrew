# Hebrew Course — Next Session Prompt (Lessons 101-200, Block 11+)

Copy-paste this entire block as the first message in a fresh Claude Code session.

---

## Context

I'm continuing a Hebrew self-study course I've been building.

**Project root:** `C:/dev/projects/admin/alyah/ulpan/hebrew-beginner/`

**Current state (sealed and validated):**
- 100 lessons (`01-alefbet.html` through `100-final-test.html`) covering CEFR A1 → B1
- `index.html` — dashboard, search, SRS review, mixed quiz, daily streak
- `app.js` — universal exercise engine (6 modes auto-injected per lesson), TTS audio with 3-tier fallback (OS voice → Google Translate TTS via `<audio>` → Forvo links), word-tokenized passages, SRS (SM-2), daily streak, progress export/import, keyboard shortcuts, IndexedDB audio cache
- `style.css` — dark mode, RTL Hebrew, responsive
- `CURRICULUM.md` — 10-block 100-lesson plan (all 10 done)
- 6,978 vocab triplets, 491 quiz questions, 97 mini-quizzes, 50+ cultural text passages
- All 101 pages validated: 0 JS errors, 0 HTML errors, 0 quiz answer-index issues, 0 runtime errors

**Helper functions (defined in app.js, callable from any lesson script after DOMContentLoaded):**
- `addExtraVocab(title, items)` — appends a vocab block
- `addMiniQuiz(title, questions)` — appends an interactive 4-option quiz
- `addCulturalText(title, subtitle, items)` — appends a paragraph-style text passage
- `renderTextBlock(id, items)` — renders text into a div with id
- `speak(hebrew, rate)` — pronounces Hebrew, OS voice or cloud fallback
- `markLessonDone(id)` — saves to localStorage

**Lesson HTML pattern:**
```html
<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NN — Lesson Title</title><link rel="stylesheet" href="style.css"></head>
<body><div class="container">
<a href="index.html" class="back">← Back to lessons</a>
<header><div><h1>Title</h1><div class="subtitle">Lesson NN · Hebrew title</div></div>
<div class="nav"><a href="index.html">Home</a><a href="NN-slug.html" class="active">NN</a></div></header>

<p class="intro">English intro paragraph.</p>
<div class="tip"><strong>Cultural note</strong> — short cultural insight.</div>

<h2>Section Name</h2>
<div class="word-list" id="section1"></div>

<footer>Lesson NN · topic · <a href="NEXT.html" style="color:var(--accent)">Next →</a></footer>
</div>
<script src="app.js"></script>
<script>
const SECTION1 = [
  { he: 'שָׁלוֹם', translit: 'shalom', fr: 'hello / peace' },
  // ...
];
function R(id, items) { const list = document.getElementById(id); items.forEach(w => { const r = document.createElement('div'); r.className = 'word-row'; r.innerHTML = `<div class="he">${w.he}</div><div class="translit">${w.translit}</div><div class="fr">${w.fr}</div><button class="btn icon-btn">▶</button>`; r.querySelector('button').addEventListener('click', () => speak(w.he, 0.85)); list.appendChild(r); }); }
R('section1', SECTION1);

addMiniQuiz('Lesson Quiz', [
  { q: 'Question?', options: ['A', 'B', 'C', 'D'], answer: 1, explain: 'why' }
]);

let c = 0; document.body.addEventListener('click', e => { if (e.target.closest('.icon-btn')) { c++; if (c >= 15) markLessonDone('slug'); } });
</script></body></html>
```

## Constraints (mandatory)

1. **Anglo transliteration only**: ch=ח, tz=צ, kh=כ no dagesh. The fr field is English (course is shareable).
2. **No emojis** in lesson content unless I explicitly ask.
3. **Hebrew with niqqud** — vowel marks ON for vocab. Real Israeli register, not biblical.
4. **Cultural authenticity** — Israeli reality (Misrad HaPnim, Bituach Leumi, Mahane Yehuda, Mizrahi music, etc.), not generic Middle East.
5. **No fluff** — concrete dialogues, real institutions, actual prayer texts, real song excerpts.
6. **All addExtraVocab / addMiniQuiz / addCulturalText calls must be inside the bottom `<script>` block** (after `app.js` loads), or wrapped in `window.addEventListener('DOMContentLoaded', () => {...})`. Calls before `app.js` loads → ReferenceError.
7. **Quiz answer indexes 0-based** and must be valid for the options array length.

## What I want next: Block 11+ (Lessons 101-200)

Design a **second-half curriculum** in 10 themed blocks of 10 lessons, picking up where Block 10 ended (mastery & integration). Suggested directions — pick what's strongest, propose alternatives if you have better ideas:

- **Block 11 (101-110): Hebrew Bible Deep Dive** — Bereshit Aleph (creation), Avraham, Exodus, David, prophets, Psalms in depth
- **Block 12 (111-120): Talmud & Halacha** — major tractates, Mishnah, Rashi, halachic decision-making
- **Block 13 (121-130): Modern Israeli Politics & Society** — coalition dynamics, oligarchies, social protests, parties' real positions, current PM
- **Block 14 (131-140): Israeli Economy & Business** — VC ecosystem, Tnuva/Strauss/Osem, banking, real estate cycle, taxes
- **Block 15 (141-150): Israeli Cuisine Deep** — by region, by ethnic origin, holiday foods, cookbook reading
- **Block 16 (151-160): IDF Deep Dive** — units (Sayeret Matkal, 8200, 669), training, hierarchy, equipment, doctrine
- **Block 17 (161-170): Yiddish Layer** — Yiddish words alive in Hebrew, songs, theater, Eastern European Jewish culture
- **Block 18 (171-180): Mizrahi Layer** — Yemeni, Moroccan, Iraqi, Persian, Ethiopian Jewish culture, music, food, identity
- **Block 19 (181-190): Israeli Arabic & Druze/Bedouin** — basics of Arabic for Hebrew speakers, common shared words, communities
- **Block 20 (191-200): Advanced Topics & Final Mastery** — academic Hebrew, legal Hebrew, specialized fields, B2 → C1 prep, final cumulative test

Each lesson should follow the existing pattern:
- Multiple vocab sections (`<div class="word-list">` with R() function)
- One or two cultural texts when relevant (full Hebrew + transliteration + English, click to hear)
- One mini-quiz (5-6 questions with explanations)
- Mini-dialogue or real text excerpt for advanced blocks
- "Next: ..." link in footer

## How to run

1. **First**: read `CURRICULUM.md`, `app.js`, `index.html`, and 2-3 representative lesson files (e.g. `64-prayer.html`, `99-real-texts.html`, `100-final-test.html`) to understand the conventions.
2. **Propose** the Block 11 outline (10 lesson topics with one-line descriptions). Wait for my "go" before creating files.
3. **Build** each block one at a time. Update `index.html` (header nav links + Block section with cards) and `CURRICULUM.md` after each block.
4. **Validate** at the end of each block: same checks as 100-lesson pass — JS syntax (`new Function(code)`), HTML structure, quiz answer bounds, runtime via Playwright headless. Aim for 0 errors before moving to next block.
5. **No emojis**, **no AI-tells in prose** (no "delve", "intricate tapestry", "stands as", em-dashes hopefully — ASCII hyphens are fine).

## Audio/runtime guardrails

- Local OS Hebrew voice → cloud TTS via `<audio>` element → Forvo manual fallback.
- Don't break the IndexedDB audio cache or the SRS data structures in localStorage (`hebrew-progress`, `hebrew-sr`, `hebrew-streak`, `ex-*`).
- The Niqqud ON/OFF toggle reads `el.dataset.original` — preserve that pattern when rendering Hebrew.

## When stuck

- The course should remain offline-capable (zero external runtime dependencies except Google TTS optional fallback and Forvo links).
- Frank Ruhl Libre font for Hebrew display is loaded via Google Fonts in `style.css` — keep it.
- Mobile responsive via media queries already in `style.css`.

Start by reading the 4 files mentioned above and propose Block 11.
