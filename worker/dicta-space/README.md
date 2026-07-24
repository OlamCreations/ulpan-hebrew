---
title: Ulpan Niqqud
emoji: 🔤
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Ulpan niqqud Space

Self-hosted Hebrew diacritizer for the ulpan-hebrew live-translator breakdown. Runs Dicta's own
open model (`dicta-il/dictabert-large-char-menaked`, CC-BY-4.0) behind a tiny FastAPI, so the
Cloudflare Worker gets Dicta-quality niqqud from an IP that Dicta doesn't block.

## Why this exists

Dicta's public API 503's Cloudflare's shared Worker egress IPs (browsers/curl get 200 — it's an
anti-datacenter block, not a payload issue). This Space runs the model ourselves on Hugging Face
(an AWS-range IP we own), so it can't be IP-blocked and the niqqud is identical/SOTA.

Scope: **vocalization (niqqud) only** — returns `{word, voc}` tokens + whitespace separators, the
minimum the breakdown needs to re-vocalize a card. Morphology (POS/gender/number/person) still comes
from UDPipe (not blocked). Verb binyan/lemma is dropped in this v1; add `dicta-il/dictabert-joint`
to `app.py` later for full parity.

## Deploy (needs a free Hugging Face account)

1. huggingface.co → **New Space** → SDK **Docker**, hardware **CPU basic** (free), visibility your choice.
2. Upload the four files in this folder to the Space repo: `Dockerfile`, `app.py`, `requirements.txt`, `README.md`.
3. Space **Settings → Variables and secrets → New secret**: `SPACE_KEY` = a long random string.
4. Wait for the build (first build downloads the ~1.2 GB model — a few minutes).
5. Test:
   ```bash
   curl https://<user>-ulpan-niqqud.hf.space/health
   curl -X POST https://<user>-ulpan-niqqud.hf.space/vocalize \
     -H 'content-type: application/json' -H 'x-key: <SPACE_KEY>' \
     -d '{"text":"שלום עולם"}'
   # → {"tokens":[{"sep":false,"word":"שלום","voc":"שָׁלוֹם"},{"sep":true,"word":" "},{"sep":false,"word":"עולם","voc":"עוֹלָם"}]}
   ```
   If the shape/markers differ from the above, `app.py`'s output handling needs a small tweak — that
   is the one thing that can only be confirmed on a live deploy.

## Wire the Worker (after the Space is live)

1. Set the Worker secret: `cd worker && npx wrangler secret put SPACE_KEY` (paste the same value).
2. In `worker/src/index.js`, replace the Dicta call with the Space call — swap `NAKDAN_HOSTS` + the
   `dicta()` body for:
   ```js
   const SPACE_URL = 'https://<user>-ulpan-niqqud.hf.space/vocalize';
   async function dicta(text, signal, env) {
     const r = await fetch(SPACE_URL, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json', 'X-Key': (env && env.SPACE_KEY) || '' },
       body: JSON.stringify({ text }), signal,
     });
     if (!r.ok) throw new Error('space ' + r.status);
     const data = await r.json();
     const out = [];
     for (const t of (Array.isArray(data && data.tokens) ? data.tokens : [])) {
       if (t && t.sep) { out.push({ sep: true, word: t.word || '' }); continue; }
       out.push({ sep: false, word: (t && t.word) || '', voc: (t && t.voc) || (t && t.word) || '', lemma: '', dbinyan: '' });
     }
     return out;
   }
   ```
   and thread `env`: `analyze(text, env)` → `dicta(bare, dCtrl.signal, env)`, and call
   `analyze(text, env)` from the fetch handler.
3. `npx wrangler deploy`, then hit the Worker's `/` with Hebrew and confirm tokens come back.

## Cold starts

Free Spaces sleep after ~48 h idle → the first request after sleep takes 30-60 s (model reload),
which exceeds the Worker's 6 s upstream timeout. Mitigations, both already in place or cheap:
the front-end retries and the Worker caches results 7 days; add a Cloudflare **Cron Trigger** that
GETs `/health` every ~6 h to keep it warm.

## Fork note

This is **our** deployment, gated by a private `SPACE_KEY` and serving only our Worker. If you fork
or copy the ulpan-hebrew repo, **deploy your own Space** (it's free) and point `SPACE_URL` at it —
exactly as forks must deploy their own Cloudflare Worker (see the repo README).
