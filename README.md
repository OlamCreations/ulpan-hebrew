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
