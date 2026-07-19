# Ulpan Hebrew

Pre-Ulpan crash course — 430+ interactive Hebrew lessons.

Static site (no build step). Open `index.html` in a browser.

## Features

- 430+ lessons covering A1 → C1, ethnic heritages, arts & culture
- Click-to-reveal cards (Hebrew first, then transliteration / translation)
- Spaced-repetition system (SM-2) with review modal
- Niqqud toggle (per page and inside SRS)
- Light / dark mode
- Listen-all + per-word audio (system TTS, Forvo fallback)

## Local dev

```bash
# any static server
python -m http.server 8000
# then open http://localhost:8000
```

Validation script for new lessons:

```bash
node _validate.js   # uses Playwright headless
```

## License

- **Code** (HTML/CSS/JS, `tools/`, service worker): MIT — see [LICENSE](LICENSE).
- **Course content** (lessons, Hebrew, translations, transliterations, data files):
  CC BY-NC-SA 4.0 — see [LICENSE-CONTENT](LICENSE-CONTENT). Free for non-commercial
  use with attribution; share adaptations alike.
- **Fonts**: KtavYadCLM (Culmus, GPL + font exception) is bundled; Frank Ruhl Libre
  loads from Google Fonts (SIL OFL).

**Honest note:** the content is authored and curated by Jonas Nephtali with LLM
assistance, then hand-corrected. It is a work in progress, not a vetted textbook —
expect residual niqqud errors, and the live translator runs on Google Translate, so
it produces literal calques on idiomatic phrases. Corrections welcome.
