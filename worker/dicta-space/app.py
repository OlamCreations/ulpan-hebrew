"""Ulpan niqqud Space — self-hosted Dicta diacritizer.

Why this exists: Dicta's public load-balancer returns HTTP 503 to Cloudflare's shared Worker egress
IPs (an anti-datacenter block; browsers/curl get 200). Our niqqud/morphology Worker therefore can't
reach Dicta. This Space runs Dicta's OWN open model — `dicta-il/dictabert-large-char-menaked`,
CC-BY-4.0 — on Hugging Face (an AWS-range IP we own), so it can't be IP-blocked and the niqqud is
identical/SOTA. The Worker calls this Space instead of Dicta.

Scope: this returns VOCALIZATION (niqqud) only, as {word, voc} tokens + whitespace separators — the
exact minimum the Worker's breakdown needs to re-vocalize a card. Morphology (POS/gender/number/
person) still comes from UDPipe, which is not blocked. Verb binyan/lemma (Dicta's extra) is dropped
in this v1; add `dicta-il/dictabert-joint` here later for full parity.

Self-hosters: this is OUR deployment. If you fork the repo, deploy YOUR OWN Space (it's free) and
point the Worker's SPACE_URL at it — ours is gated by a private key and only serves our Worker.
"""
import os
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel

MODEL = "dicta-il/dictabert-large-char-menaked"
KEY = os.environ.get("SPACE_KEY", "")   # set as a private Space secret; the Worker sends it as X-Key

app = FastAPI(title="ulpan-niqqud")
_tok = None
_model = None


def _load():
    """Lazy-load the model on first use so the container boots fast; cached after."""
    global _tok, _model
    if _model is None:
        import torch  # noqa: F401  (ensures torch is importable before model load)
        from transformers import AutoModel, AutoTokenizer
        _tok = AutoTokenizer.from_pretrained(MODEL)
        _model = AutoModel.from_pretrained(MODEL, trust_remote_code=True)
        _model.eval()
    return _tok, _model


def _tokens(bare: str, voc: str):
    # Niqqud only ADDS marks — it never changes the word count — so whitespace-split words align 1:1
    # with the vocalized output. Emit word tokens + explicit space separators so the client can
    # reassemble the sentence exactly as it does for Dicta's output.
    bw, vw = bare.split(), voc.split()
    toks = []
    if len(bw) == len(vw):
        for i, (b, v) in enumerate(zip(bw, vw)):
            if i:
                toks.append({"sep": True, "word": " "})
            toks.append({"sep": False, "word": b, "voc": v})
    else:
        # Counts diverged (unexpected) — hand back the whole vocalized string as one token rather
        # than mis-align. The Worker still gets usable niqqud.
        toks.append({"sep": False, "word": bare, "voc": voc})
    return toks


class Body(BaseModel):
    text: str = ""


@app.get("/health")
def health():
    _load()
    return {"ok": True, "model": MODEL}


@app.post("/vocalize")
async def vocalize(body: Body, request: Request):
    if KEY and request.headers.get("x-key") != KEY:
        return Response('{"error":"forbidden"}', status_code=403, media_type="application/json")
    text = (body.text or "").strip()[:500]
    if not text:
        return {"tokens": []}
    tok, model = _load()
    import torch
    with torch.no_grad():
        # DictaBERT's char menaked model vocalizes a batch of sentences and returns a list of
        # vocalized strings. Handle the string-or-list shapes defensively.
        out = model.predict([text], tok)
    voc = out[0] if isinstance(out, (list, tuple)) and out else (out if isinstance(out, str) else text)
    # Strip any matres-lectionis / prefix markers some versions emit, keeping pure niqqud.
    voc = str(voc).replace("*", "").replace("|", "")
    return {"tokens": _tokens(text, voc)}
