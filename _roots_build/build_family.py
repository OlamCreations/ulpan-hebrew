# -*- coding: utf-8 -*-
"""Build a clean dictionary-lemma family for a root: app-vocab candidates ∪ pealim
(root-search + see-also), deduped by pealim entry id, each verified root==target.
Reuses the disk cache from tag_roots."""
import sys, os, io, json, re, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape_pealim as sp
import tag_roots as tr  # for cget (cached, resilient)

HERE = os.path.dirname(os.path.abspath(__file__))

def hrefs_for_query(q):
    h = tr.cget("https://www.pealim.com/search/?q=" + urllib.parse.quote(q))
    return {m for m in re.findall(r'href="(/dict/\d+[^"#]*)"', h)}

def build(root, app_words):
    # seed hrefs: from each app word's search + from the root search itself
    seeds = set(hrefs_for_query(root))
    for w in app_words:
        seeds |= hrefs_for_query(w)
    # BFS over see-also to complete the family
    seen, members = set(), {}
    queue = list(seeds)
    while queue:
        href = queue.pop(0)
        if href in seen:
            continue
        seen.add(href)
        h = tr.cget("https://www.pealim.com" + href)
        if not h:
            continue
        e = sp.parse_entry_html(h, href)
        if e["root"] != root:
            continue
        lemma = sp.page_lemma(h, e["pos"])
        if lemma and href not in members:
            members[href] = {"lemma": lemma, "pos": e["pos"], "binyan": e["binyan"], "meaning": e["meaning"]}
        for sa in sp.see_also(h):
            if sa not in seen:
                queue.append(sa)
    border = {"PA'AL": 0, "NIF'AL": 1, "PI'EL": 2, "PU'AL": 3, "HIF'IL": 4, "HUF'AL": 5, "HITPA'EL": 6, "": 9}
    out = sorted(members.values(), key=lambda m: (0 if m["pos"] == "Verb" else 1, border.get(m["binyan"], 9), len(m["lemma"])))
    return {"root": root, "members": out}

if __name__ == "__main__":
    from collections import defaultdict
    d = json.load(io.open(os.path.join(HERE, "roots_tagged_all.json"), encoding="utf-8"))
    byroot = defaultdict(list)
    for k, v in d["tags"].items():
        if v:
            byroot[v["root"]].append(k)
    roots = sys.argv[1:] or ["כתב", "ספר", "ישב"]
    os.makedirs(os.path.join(HERE, "families"), exist_ok=True)
    for r in roots:
        fp = os.path.join(HERE, "families", f"{r}.json")
        if os.path.exists(fp):  # resumable: skip already-built families
            print(f"=== {r}: cached, skip ===", flush=True)
            continue
        fam = build(r, byroot.get(r, []))
        json.dump(fam, io.open(fp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"=== {r}: {len(fam['members'])} clean lemmas (from {len(byroot.get(r,[]))} app words) ===", flush=True)
