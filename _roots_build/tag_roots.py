# -*- coding: utf-8 -*-
"""Tag app vocab with roots via pealim, disambiguated by the app's own gloss.
Caches every fetched page to disk (gentle on pealim, resumable)."""
import sys, os, io, json, time, re, urllib.parse, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_pealim as sp

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)

STOP = set("to the of a an and or in on at by for is are be that this it its as with".split())
def toks(s):
    return set(w for w in re.findall(r"[a-z]+", s.lower()) if w not in STOP and len(w) > 2)

def cget(url):
    key = hashlib.md5(url.encode()).hexdigest()
    p = os.path.join(CACHE, key + ".html")
    if os.path.exists(p):
        return io.open(p, encoding="utf-8").read()
    last = None
    for attempt in range(4):
        try:
            h = sp.get(url)
            io.open(p, "w", encoding="utf-8").write(h)
            time.sleep(0.5)
            return h
        except Exception as ex:
            last = ex
            time.sleep(2 * (attempt + 1))  # backoff
    print(f"    !! giving up on {url}: {last}", flush=True)
    return ""  # transient failure -> treat as no result, do NOT cache

def tag(cons, gloss):
    h = cget("https://www.pealim.com/search/?q=" + urllib.parse.quote(cons))
    hrefs = {m for m in re.findall(r'href="(/dict/\d+[^"#]*)"', h)}
    gt = toks(gloss)
    cands = []
    for href in hrefs:
        try:
            e = sp.parse_entry_html(cget("https://www.pealim.com" + href), href)
        except Exception:
            continue
        if not e["root"]:
            continue
        cands.append(e)
        # early exit: strong gloss overlap -> this is the right sense, stop fetching
        if len(gt & toks(e["meaning"])) >= 1:
            return {"root": e["root"], "pos": e["pos"], "binyan": e["binyan"],
                    "meaning": e["meaning"], "n_cands": len(cands), "conf": "high"}
    if not cands:
        return None
    best = max(cands, key=lambda e: 1 if e["pos"] == "Verb" else 0)
    return {"root": best["root"], "pos": best["pos"], "binyan": best["binyan"],
            "meaning": best["meaning"], "n_cands": len(cands), "conf": "low"}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "sample"
    vocab = json.load(io.open(os.path.join(HERE, "vocab_gloss.json"), encoding="utf-8"))
    if mode == "sample":
        sample = json.load(io.open(os.path.join(HERE, "sample60.json"), encoding="utf-8"))
        keys = [k for k in sample if k in vocab]
    else:
        keys = sorted(vocab)
    outpath = os.path.join(HERE, f"roots_tagged_{mode}.json")
    out = {}
    if mode != "sample" and os.path.exists(outpath):  # resume
        out = json.load(io.open(outpath, encoding="utf-8")).get("tags", {})
        print(f"resuming: {len(out)} already done", flush=True)
    hi = lo = miss = 0
    for i, k in enumerate(keys):
        if k in out:
            continue
        r = tag(k, vocab[k]["gloss"])
        out[k] = r
        if not r: miss += 1
        elif r["conf"] == "high": hi += 1
        else: lo += 1
        if mode != "sample" and i % 150 == 0:
            json.dump({"tags": out, "vocab": vocab}, io.open(outpath, "w", encoding="utf-8"), ensure_ascii=False)
            print(f"  {i}/{len(keys)} done={len(out)} (hi={hi} lo={lo} miss={miss})", flush=True)
    json.dump({"tags": out, "vocab": vocab}, io.open(outpath, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"\n{mode}: {len(keys)} words | high-conf={hi} low-conf={lo} miss={miss} | tagged={hi+lo} ({100*(hi+lo)//len(keys)}%)")
    if mode == "sample":
        for k in keys:
            r = out[k]
            g = vocab[k]["gloss"][:26]
            if r:
                print(f"  {k:<10} -> {r['root']:<7} [{r['conf']:<4}] pealim:{r['meaning'][:26]:<26} | app:{g}")
            else:
                print(f"  {k:<10} -> —       (no pealim entry)        | app:{g}")
