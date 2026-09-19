# Ulpan Hebrew

A Hebrew course for new immigrants to Israel: 465 lessons, a roots atlas (250 roots), the 150 psalms, prayers, songs, and a live translator.

**Live:** https://olamcreations.github.io/ulpan-hebrew/

Static site, no build step. It installs as an app on a phone and works offline.

## Features

- 465 lessons covering A1 → C1, ethnic heritages, arts & culture
- Click-to-reveal cards (Hebrew first, then transliteration / translation)
- Spaced-repetition system (SM-2) with review modal
- Niqqud toggle (per page and inside SRS)
- Light / dark mode
- Listen-all + per-word audio (system TTS, Forvo fallback)

## How this was built

I don't write the code by hand. I direct AI coding agents (Claude Code). I set the goal, review what comes back, and decide what ships. Since August 2026, many commits carry the `Claude-Session:` trailer that Claude Code adds (`git log --grep=Claude-Session:` lists them).

Scripts check what I don't take on trust. Anyone can run them:

1. `node tools/translit-test.cjs` checks the transliteration against a curated phrasebook: 118/118.
2. `node tools/tehilim-hebrew-check.mjs` compares all 150 psalm pages with the Masoretic source: 19,586 words, codepoint for codepoint (psalms 1-10 through a documented tolerance).
3. `node tools/tehilim-hebrew-check.mjs --self-test` feeds it 7 deliberately broken pages. It rejects all 7.
4. `node tools/chords-test.mjs` runs 129 checks on the chord engine.

## Repo layout

Pages sit exactly one folder deep. That uniform depth is deliberate: every page reaches
shared code the same way (`../assets/…`), so a link is either right everywhere or wrong
everywhere, never subtly wrong in one family.

```
index.html          the home — lesson index and live translator
sw.js               service worker (precache list is generated, not hand-edited)
404.html            generated; redirects pre-reorganisation URLs to their new folder
assets/             app.js, style.css, shared modules, fonts, icons
data/               what the site fetches at runtime: phrasebook.json, expressions.json
lessons/            the numbered curriculum (01-… to 465-…)
roots/              the roots atlas (root-NNN-…, plus -en variants)
liturgy/            prayers-, shabbat-, songs-, tehilim-
reference/          morpho-, cursive-, calendar-, expressions.html
tools/              build + audit scripts (see below); tools/reports/ is generated output
worker/             the Cloudflare Worker (morphology, vocalization, natural version)
docs/               design and pedagogy notes
```

`tools/layout.config.json` is the single source of truth for that layout — the migration,
the precache builder, the 404 shim and the corpus tools all read it. Add a page family
there rather than teaching each script about a new folder.

## Local dev

```bash
npm i --no-save --prefix . playwright-core   # once: smoke.mjs drives your installed Chrome through it
node tools/serve.mjs 8912     # dev server that mimics GitHub Pages (unknown path -> 404.html); leave it running
node tools/smoke.mjs          # from a second terminal: one page per folder: assets load, modules install, redirects work
node tools/translit-test.cjs  # transliteration vs the curated phrasebook (must stay 118/118)
node tools/chords-test.mjs    # the harmony engine, including its injected-defect matrix
```

For the Psalms, the Hebrew on the shipped pages is checked back against the Masoretic
source rather than trusted:

```bash
node tools/tehilim-hebrew-check.mjs             # every page, codepoint for codepoint
node tools/tehilim-hebrew-check.mjs --self-test # 7 injected defects, all must go red
node tools/tehilim-build.mjs --self-test        # the divine-name gloss rule
```

The builder derives every Hebrew character from `content/tehilim/source/`, so the pages
match "by construction" and the check should never fail. That is exactly why it exists:
a guarantee that cannot fail is indistinguishable from no guarantee, and the check reads
the HTML on disk, so the two can disagree. Comparison is on raw codepoints with no Unicode
normalisation, because NFC and NFD niqqud render identically and are different text.

After adding, renaming or deleting pages:

```bash
node tools/build-sw.mjs       # regenerate the precache list and bump the cache version
```

Forgetting that last step is how a page ships uncached (or a deleted one keeps 404-ing an
installed app), so it is scripted rather than remembered.

## The morphology / translation Worker

The word-by-word breakdown, the vowel marks on bare Hebrew, and the "natural version" button
call a small Cloudflare Worker (`worker/`). It relays Dicta Nakdan (vowels and roots), UDPipe
(grammar) and Workers AI (the natural version, in-context word glosses).

Its CORS policy only answers browsers on our own app origins, plus `localhost` and `127.0.0.1` for local
development, so a fork published anywhere else cannot use it.
If you fork this repo, deploy your own Worker and point `MORPH_URL` in `assets/quicksay.js` and
`ENDPOINT` in `assets/track.js` at it. The pages' Content-Security-Policy (`connect-src`) names
our Worker's host too, so add yours there.

```bash
cd worker && npx wrangler deploy   # your own Cloudflare account, the free tier is enough
```

`worker/dicta-space/` holds a self-hosted alternative for the vowels: Dicta's open model on a
Hugging Face Space. It is not wired into the Worker yet. `worker/dicta-space/README.md` explains how.

## Privacy

1. Your progress (lessons done, quiz scores, review cards) stays in your browser. There is no account.
2. The site counts anonymous usage: page views, which features are used, and JavaScript errors.
   The Worker stores the event, the country and the device type (mobile, tablet or desktop).
   No cookie, no IP address. Analytics never include the text you type. The only identifier is
   a random key kept in your browser.
3. Do Not Track turns the counting off.
4. The live translator sends what you type to Google (Translate and Input Tools) and to our
   Worker, which relays it to Dicta, UDPipe and Workers AI to get the Hebrew, the vowels and the
   grammar. The Worker caches translation results for up to 7 days, keyed on the text alone.

## License

- **Code** (HTML/CSS/JS, `tools/`, service worker): MIT — see [LICENSE](LICENSE).
- **Course content** (lessons, Hebrew, translations, transliterations, data files):
  CC BY-NC-SA 4.0 — see [LICENSE-CONTENT](LICENSE-CONTENT). Free for non-commercial
  use with attribution; share adaptations alike.
- **Fonts**: both are bundled in `assets/` — KtavYadCLM (Culmus, GPL + font exception)
  and Frank Ruhl Libre (SIL OFL). Nothing is fetched from an external host.

**Honest note:** the lessons were drafted with LLMs, then corrected through scripted checks
and AI-assisted review, not by a professional editor. It is a work in progress, not a vetted
textbook. A July 2026 estimate put 700 to 900 niqqud errors left; 41 have been fixed since.
The live translator's default pass is Google Translate, which is literal on idiomatic phrases.
The opt-in "natural version" button asks a larger model for the idiomatic reading. It is
better, not infallible. Corrections are welcome.
