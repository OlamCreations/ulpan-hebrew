"""Ulpan niqqud Space — self-hosted Dicta diacritizer, demo + API in one.

Why this exists: Dicta's public load-balancer returns HTTP 503 to Cloudflare's shared Worker egress
IPs (an anti-datacenter block; browsers/curl get 200). Our niqqud/morphology Worker therefore can't
reach Dicta. This Space runs Dicta's OWN open model — `dicta-il/dictabert-large-char-menaked`,
CC-BY-4.0 — on Hugging Face (an AWS-range IP we own), so it can't be IP-blocked and the niqqud is
identical/SOTA.

This one app serves two things on the same port:
  * `/`          — a Gradio demo: type unpointed Hebrew, see it vocalized.
  * `/vocalize`  — a JSON API the Worker calls: {text} -> {tokens:[{word,voc}|{sep}]}, key-gated.

Scope: VOCALIZATION (niqqud) only. Morphology (POS/gender/number/person) still comes from UDPipe,
which is not blocked. Verb binyan/lemma (Dicta's extra) is dropped in this v1; add
`dicta-il/dictabert-joint` here later for full parity.

Self-hosters: this is OUR deployment. If you fork the repo, deploy YOUR OWN Space (it's free) and
point the Worker's SPACE_URL at it — ours is gated by a private key and only serves our Worker.
"""
import os
import gradio as gr
from fastapi import FastAPI, Request, Response
from pydantic import BaseModel

MODEL = "dicta-il/dictabert-large-char-menaked"
KEY = os.environ.get("SPACE_KEY", "")   # set as a private Space secret; the Worker sends it as X-Key

_tok = None
_model = None


def _load():
    """Lazy-load the model on first use so the container boots fast; cached after."""
    global _tok, _model
    if _model is None:
        import torch  # noqa: F401
        from transformers import AutoModel, AutoTokenizer
        _tok = AutoTokenizer.from_pretrained(MODEL)
        _model = AutoModel.from_pretrained(MODEL, trust_remote_code=True)
        _model.eval()
    return _tok, _model


def _vocalize(text: str) -> str:
    """Run the model, return the vocalized string (pure niqqud, markers stripped)."""
    text = (text or "").strip()[:500]
    if not text:
        return ""
    tok, model = _load()
    import torch
    with torch.no_grad():
        # DictaBERT's char menaked model vocalizes a batch and returns a list of vocalized strings.
        out = model.predict([text], tok)
    voc = out[0] if isinstance(out, (list, tuple)) and out else (out if isinstance(out, str) else text)
    return str(voc).replace("*", "").replace("|", "")


def _tokens(bare: str, voc: str):
    # Niqqud only ADDS marks — never changes word count — so whitespace-split words align 1:1 with
    # the vocalized output. Emit word tokens + explicit space separators so the client reassembles
    # the sentence exactly as it does for Dicta's output.
    bw, vw = bare.split(), voc.split()
    toks = []
    if len(bw) == len(vw):
        for i, (b, v) in enumerate(zip(bw, vw)):
            if i:
                toks.append({"sep": True, "word": " "})
            toks.append({"sep": False, "word": b, "voc": v})
    else:
        toks.append({"sep": False, "word": bare, "voc": voc})   # counts diverged — safe fallback
    return toks


# --- API (what the Worker calls) --------------------------------------------------------------
app = FastAPI(title="ulpan-niqqud")


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
    return {"tokens": _tokens(text, _vocalize(text))}


# --- Demo (what a visitor sees) ---------------------------------------------------------------
demo = gr.Interface(
    fn=_vocalize,
    inputs=gr.Textbox(label="Hebrew (unpointed)", rtl=True, lines=2, placeholder="שלום עולם"),
    outputs=gr.Textbox(label="Vocalized (niqqud)", rtl=True, lines=2),
    title="Ulpan Niqqud — Hebrew diacritizer",
    description=(
        "Adds niqqud (vowel points) to unpointed Hebrew, using Dicta's open model "
        "`dictabert-large-char-menaked` (CC-BY-4.0). Powers the ulpan-hebrew live-translator breakdown."
    ),
    examples=[["שלום עולם"], ["מה שלומך היום"], ["אני רוצה ללמוד עברית"]],
    allow_flagging="never",
)

# Mount the Gradio UI at "/" on the same FastAPI app so one port serves both the demo and the API.
app = gr.mount_gradio_app(app, demo, path="/")
