# Ulpan Hebrew

Pre-Ulpan crash course — 460+ interactive Hebrew lessons.

Static site (no build step). Open `index.html` in a browser.

## Features

- 460+ lessons covering A1 → C1, ethnic heritages, arts & culture
- Click-to-reveal cards (Hebrew first, then transliteration / translation)
- Spaced-repetition system (SM-2) with review modal
- Niqqud toggle (per page and inside SRS)
- Light / dark mode
- Listen-all + per-word audio (system TTS, Forvo fallback)

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
node tools/serve.mjs 8912     # dev server that mimics GitHub Pages (unknown path -> 404.html)
node tools/smoke.mjs          # one page per folder: assets load, modules install, redirects work
node tools/translit-test.cjs  # transliteration vs the curated phrasebook (must stay 118/118)
```

After adding, renaming or deleting pages:

```bash
node tools/build-sw.mjs       # regenerate the precache list and bump the cache version
```

Forgetting that last step is how a page ships uncached (or a deleted one keeps 404-ing an
installed app), so it is scripted rather than remembered.

## The morphology / translation Worker

The word-by-word breakdown, the bare-Hebrew vocalization, and the "natural version"
button call a small Cloudflare Worker (`worker/`) that relays Dicta Nakdan, UDPipe,
and Workers AI. The front-end (`quicksay.js`, `track.js`) points `MORPH_URL` at our
deployment. If you fork and host this yourself, **deploy your own Worker** and change
`MORPH_URL` to your own `*.workers.dev` URL — our deployment only accepts requests
from `olamcreations.github.io`, so a fork will not reach it. Deploy with:

```bash
cd worker && npx wrangler deploy   # needs your own Cloudflare account (free tier is fine)
```

## License

- **Code** (HTML/CSS/JS, `tools/`, service worker): MIT — see [LICENSE](LICENSE).
- **Course content** (lessons, Hebrew, translations, transliterations, data files):
  CC BY-NC-SA 4.0 — see [LICENSE-CONTENT](LICENSE-CONTENT). Free for non-commercial
  use with attribution; share adaptations alike.
- **Fonts**: both are bundled in `assets/` — KtavYadCLM (Culmus, GPL + font exception)
  and Frank Ruhl Libre (SIL OFL). Nothing is fetched from an external host.

**Honest note:** the content is authored and curated by Jonas Nephtali with LLM
assistance, then hand-corrected. It is a work in progress, not a vetted textbook —
expect residual niqqud errors. The live translator's default pass is Google Translate
(literal on idiomatic phrases); an opt-in "natural version" button routes the phrase
through a larger model for the idiomatic reading, which is better but not infallible.
Corrections welcome.
