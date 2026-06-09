# -*- coding: utf-8 -*-
"""Scrape verified Hebrew root families from pealim.com.
Per root: search -> collect /dict/ entries -> fetch each -> extract
{lemma (vocalized), pos, binyan, root, meaning, key_form}. Keep only entries
whose root matches the target. Output JSON per root. Niqqud comes from pealim
(verified), never invented. Gentle: sleeps between requests.
"""
import urllib.request, urllib.parse, re, io, json, os, sys, time

UA = {"User-Agent": "Mozilla/5.0 (ulpan-hebrew root atlas; educational)"}
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "families")
os.makedirs(OUT, exist_ok=True)

def get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")

def strip(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = (s.replace("&amp;", "&").replace("&#8206;", "").replace("&rlm;", "")
           .replace("&#128266;", "").replace("&nbsp;", " ").replace("&#8207;", ""))
    return re.sub(r"\s+", " ", s).strip()

def norm_root(s):
    # "כ - ת - ב" -> "כתב"
    return "".join(c for c in s if "א" <= c <= "ת")

def search_family(root):
    url = "https://www.pealim.com/search/?q=" + urllib.parse.quote(root)
    h = get(url)
    # unique /dict/NNN-slug/ + the menukad headword for each
    seen = {}
    for href, men in re.findall(r'href="(/dict/\d+[^"#]*)"[^>]*>\s*<span class="menukad"[^>]*>(.*?)</span>', h, re.S):
        lemma = strip(men)
        if href not in seen and lemma:
            seen[href] = lemma
    return seen  # {href: lemma}

def parse_entry_html(h, href):
    # pealim packs pos+binyan+root into one meta string: "Verb – PA'AL | Root: כ - ת - ב | Infinitive: ..."
    metam = re.search(r'content="([^"]*\|\s*Root:[^"]*)"', h)
    meta = (metam.group(1).replace("&apos;", "'").replace("&amp;", "&")) if metam else ""
    parts = [p.strip() for p in meta.split("|")]
    head = parts[0] if parts else ""               # "Verb – PA'AL" or "Noun" or "Adjective"
    posm = re.search(r"\b(Verb|Noun|Adjective|Adverb|Preposition|Particle|Numeral|Pronoun)\b", head)
    pos = posm.group(1) if posm else ""
    binm = re.search(r"(PA'AL|PI'EL|HIF'IL|NIF'AL|HITPA'EL|PU'AL|HUF'AL)", head)
    binyan = binm.group(1) if binm else ""
    rootm = re.search(r"Root:\s*([^|]+)", meta)
    root = norm_root(rootm.group(1)) if rootm else ""
    # meaning sits in: Meaning</h3><div class="lead">to write</div>
    mm = re.search(r'>Meaning</h\d>\s*<div class="lead">(.*?)</div>', h, re.S)
    meaning = strip(mm.group(1)) if mm else ""
    return {"href": href, "root": root, "pos": pos, "binyan": binyan, "meaning": meaning}

def _pure_he(t):
    # a clean single Hebrew lemma: only Hebrew letters/niqqud (+ optional maqaf), no latin, no spaces
    core = t.replace("־", "")
    return bool(core) and all("א" <= c <= "ת" or "֑" <= c <= "ׇ" for c in core)

def infinitive(h):
    # verbs: pealim meta carries "Infinitive: &amp;#128266; לִכְתֹּב ~ ..." (skip entity junk to first Hebrew run)
    m = re.search(r"Infinitive:[^֐-׿]{0,40}([֐-׿]+)", h)
    return strip(m.group(1)) if m else ""

def page_lemma(h, pos=None):
    if pos == "Verb":
        inf = infinitive(h)
        if inf:
            return inf
    # else: first clean single-word .menukad that is NOT the root display "כ - ת - ב"
    for men in re.findall(r'class="menukad"[^>]*>(.*?)</span>', h, re.S):
        t = strip(men)
        if _pure_he(t) and " - " not in t:
            return t
    return ""

def see_also(h):
    # same-root links in the "See also" block
    i = h.find("See also")
    if i < 0:
        return []
    return list({href for href in re.findall(r'href="(/dict/\d+[^"#]*)"', h[i:i + 2000])})

def scrape_root(root):
    # BFS over same-root links, seeded by search results
    queue = list(search_family(root).items())   # [(href, lemma)]
    seen = set()
    members = []
    while queue:
        href, lemma = queue.pop(0)
        if href in seen:
            continue
        seen.add(href)
        try:
            h = get("https://www.pealim.com" + href)
        except Exception as ex:
            print(f"    ! {href}: {ex}"); continue
        e = parse_entry_html(h, href)
        time.sleep(0.6)
        if e["root"] != root:
            continue
        if not lemma:
            lemma = page_lemma(h)
        members.append({"lemma": lemma, **e})
        for sa in see_also(h):
            if sa not in seen:
                queue.append((sa, ""))
    # order: verbs (by binyan order) then nouns/adjectives
    border = {"PA'AL": 0, "NIF'AL": 1, "PI'EL": 2, "PU'AL": 3, "HIF'IL": 4, "HUF'AL": 5, "HITPA'EL": 6, "": 9}
    members.sort(key=lambda m: (0 if m["pos"] == "Verb" else 1, border.get(m["binyan"], 9), m["lemma"]))
    return {"root": root, "members": members}

if __name__ == "__main__":
    roots = sys.argv[1:] or ["כתב", "אכל", "למד", "שמר", "אמר", "הלך", "ישב", "עשה", "ראה", "ידע", "דבר", "נתן"]
    for r in roots:
        print(f"root {r} ...")
        data = scrape_root(r)
        json.dump(data, io.open(os.path.join(OUT, f"{r}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  -> {len(data['members'])} verified members")
        time.sleep(1.0)
