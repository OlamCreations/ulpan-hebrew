# -*- coding: utf-8 -*-
"""Roots Atlas page generator. Per-root bilingual content JSON -> root-NNN-slug.html (fr) + -en.
Mirrors the hand-built model root-001-ktav-en.html. Generic binyan-voice labels and all UI
chrome live here, so per-root content stays minimal."""
import json, io, os, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# generic, transferable voice of each binyan (the specific meaning is carried by each verb's gloss)
VOICE = {
    "PA'AL":    {"en": "<b>simple active</b> — the plain action",            "fr": "<b>actif simple</b> — l'action nue"},
    "NIF'AL":   {"en": "<b>passive / middle</b> — it happens to the subject", "fr": "<b>passif / moyen</b> — l'action subie"},
    "PI'EL":    {"en": "<b>intensive / specialized</b> active",               "fr": "<b>actif intensif / spécialisé</b>"},
    "PU'AL":    {"en": "<b>passive</b> of the pi'el",                          "fr": "<b>passif</b> du pi'el"},
    "HIF'IL":   {"en": "<b>causative</b> — make someone do it",               "fr": "<b>causatif</b> — faire faire l'action"},
    "HUF'AL":   {"en": "<b>passive</b> of the hif'il",                         "fr": "<b>passif</b> du hif'il"},
    "HITPA'EL": {"en": "<b>reflexive / reciprocal</b> — to / on oneself",      "fr": "<b>réfléchi / réciproque</b> — sur soi, l'un l'autre"},
}
BN_LABEL = {"PA'AL": "Pa'al", "NIF'AL": "Nif'al", "PI'EL": "Pi'el", "PU'AL": "Pu'al",
            "HIF'IL": "Hif'il", "HUF'AL": "Huf'al", "HITPA'EL": "Hitpa'el"}

CHROME = {
    "en": {"back": "← Back to lessons", "home": "Home",
           "h_verb": "The verb across the binyanim (voices)",
           "p_verb": "The same root runs through the verb system. Each <strong>binyan</strong> is a voice: it bends the one idea into active, passive, causative or reciprocal. Tap to hear.",
           "h_words": "Words born from the root",
           "p_words": "Same root letters, different noun moulds (<em>mishkalim</em>). The mould tells you the <em>function</em>: who does it, the act of doing it, or the thing produced.",
           "h_decode": "Decode it yourself",
           "p_decode": "Strip the prefixes, suffixes and vowels. Three consonants remain, and the meaning lives there.",
           "count": "{n} words · 1 root · {v} verb-voices",
           "morph": "Morphology"},
    "fr": {"back": "← Retour aux leçons", "home": "Accueil",
           "h_verb": "Le verbe à travers les binyanim (voix)",
           "p_verb": "La même racine traverse tout le système verbal. Chaque <strong>binyan</strong> est une voix : il plie l'idée unique en actif, passif, causatif ou réciproque. Touche pour écouter.",
           "h_words": "Les mots nés de la racine",
           "p_words": "Mêmes lettres-racine, moules nominaux différents (<em>mishkalim</em>). Le moule dit la <em>fonction</em> : qui fait, l'acte de faire, ou la chose produite.",
           "h_decode": "Décode toi-même",
           "p_decode": "Retire les préfixes, les suffixes et les voyelles. Trois consonnes restent, et le sens vit là.",
           "count": "{n} mots · 1 racine · {v} voix verbales",
           "morph": "Morphologie"},
}

STYLE = """<style>
  .root-hero { display:flex; flex-wrap:wrap; align-items:center; gap:22px; background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:22px 26px; margin:16px 0 10px; }
  .root-hero .rh-letters { font-family:'Frank Ruhl Libre',serif; font-size:54px; font-weight:700; color:var(--accent); letter-spacing:10px; direction:rtl; line-height:1; }
  .root-hero .rh-meta { flex:1; min-width:220px; }
  .root-hero .rh-translit { color:var(--text-dim); font-size:15px; letter-spacing:2px; text-transform:uppercase; }
  .root-hero .rh-gloss { font-size:21px; color:var(--text); margin:4px 0 2px; }
  .root-hero .rh-count { display:inline-block; margin-top:8px; font-size:12px; color:var(--accent); border:1px solid var(--accent-dim); border-radius:20px; padding:3px 12px; }
  .binyan-row { display:grid; grid-template-columns: 92px 1.1fr 1fr auto; align-items:center; gap:14px; padding:12px 14px; border:1px solid var(--border); border-radius:8px; margin-bottom:8px; background:var(--bg-card); }
  .binyan-row .bn-badge { font-size:11px; letter-spacing:1px; text-transform:uppercase; color:var(--accent); border:1px solid var(--accent-dim); border-radius:5px; padding:4px 6px; text-align:center; font-weight:600; }
  .binyan-row .bn-he { font-family:'Frank Ruhl Libre',serif; font-size:27px; color:var(--text); direction:rtl; }
  .binyan-row .bn-he .tr { display:block; font-family:'Inter',sans-serif; font-size:12px; color:var(--text-dim); direction:ltr; letter-spacing:.5px; }
  .binyan-row .bn-voice { font-size:13px; color:var(--text-dim); }
  .binyan-row .bn-voice b { color:var(--text); font-weight:600; }
  .binyan-note { font-size:12.5px; color:var(--text-dim); margin:2px 4px 0; }
  .deriv-group h3 { font-size:13px; text-transform:uppercase; letter-spacing:1px; color:var(--accent); margin:18px 0 8px; }
  .deriv-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); gap:10px; }
  .deriv-card { border:1px solid var(--border); border-radius:8px; padding:12px 14px; background:var(--bg-card); position:relative; }
  .deriv-card .dc-he { font-family:'Frank Ruhl Libre',serif; font-size:26px; color:var(--text); direction:rtl; }
  .deriv-card .dc-tr { font-size:12px; color:var(--text-dim); letter-spacing:.5px; }
  .deriv-card .dc-gloss { font-size:14px; color:var(--text); margin-top:3px; }
  .deriv-card .dc-mould { display:inline-block; margin-top:7px; font-family:'Frank Ruhl Libre',serif; font-size:15px; color:var(--text-dim); border:1px dashed var(--border); border-radius:5px; padding:1px 8px; direction:rtl; }
  .deriv-card .icon-btn { position:absolute; top:10px; left:10px; }
  @media (max-width:640px){ .binyan-row { grid-template-columns: 70px 1fr auto; } .binyan-row .bn-voice { grid-column: 1 / -1; } }
</style>"""


def L(v, lang):
    return v[lang] if isinstance(v, dict) else v


def build(c, lang):
    ch = CHROME[lang]
    n = c["n"]
    rs = c["root_spaced"]
    nverbs = len(c["binyanim"])
    nwords = nverbs + sum(len(g["words"]) for g in c["groups"])
    # binyan rows (voice from generic map unless overridden)
    brows = []
    for b in c["binyanim"]:
        voice = L(b.get("voice", VOICE.get(b["bn"], {"en": "", "fr": ""})), lang)
        brows.append(
            f'    <div class="binyan-row">\n'
            f'      <div class="bn-badge">{BN_LABEL.get(b["bn"], b["bn"])}</div>\n'
            f'      <div class="bn-he">{b["he"]}<span class="tr">{b["tr"]}</span></div>\n'
            f'      <div class="bn-voice">{voice}<br><span style="color:var(--text)">{L(b["gloss"], lang)}</span></div>\n'
            f'      <button class="icon-btn" data-say="{b["he"]}" title="Listen">▶</button>\n'
            f'    </div>')
    groups_html = []
    for g in c["groups"]:
        cards = []
        for w in g["words"]:
            mould = ""
            if w.get("mould"):
                mould = f'\n      <span class="dc-mould" title="{L(w.get("mouldtip",""), lang)}">{w["mould"]}</span>'
            cards.append(
                f'    <div class="deriv-card">\n'
                f'      <button class="icon-btn" data-say="{w["he"]}" title="Listen">▶</button>\n'
                f'      <div class="dc-he">{w["he"]}</div>\n'
                f'      <div class="dc-tr">{w["tr"]}</div>\n'
                f'      <div class="dc-gloss">{L(w["gloss"], lang)}</div>{mould}\n'
                f'    </div>')
        groups_html.append(
            f'<div class="deriv-group">\n  <h3>{L(g["title"], lang)}</h3>\n'
            f'  <div class="deriv-grid">\n' + "\n".join(cards) + "\n  </div>\n</div>")
    # quiz JS
    qs = []
    for q in c["quiz"]:
        opts = json.dumps(L(q["options"], lang), ensure_ascii=False)
        he = f', he:{json.dumps(q["he"], ensure_ascii=False)}' if q.get("he") else ""
        qs.append('  { q:%s%s, options:%s, answer:%d, explain:%s }' % (
            json.dumps(L(q["q"], lang), ensure_ascii=False), he, opts, q["answer"],
            json.dumps(L(q.get("explain", ""), lang), ensure_ascii=False)))
    quiz_js = "[\n" + ",\n".join(qs) + "\n]"
    # hero play button: first verb, else first derived word
    hero_say = c["binyanim"][0]["he"] if c["binyanim"] else (c["groups"][0]["words"][0]["he"] if c.get("groups") and c["groups"][0]["words"] else "")
    # the verb section only renders if there are verbs
    verb_section = (f'<h2>{ch["h_verb"]}</h2>\n'
                    f'<p class="intro" style="margin-bottom:8px">{ch["p_verb"]}</p>\n\n'
                    f'<div class="binyan-rows">\n{chr(10).join(brows)}\n</div>\n'
                    f'<p class="binyan-note">{L(c["binyan_note"], lang)}</p>\n') if c["binyanim"] else (
                    f'<p class="binyan-note">{L(c["binyan_note"], lang)}</p>\n')
    title = f"Roots Atlas {n:02d} — {rs} ({L(c['field'], lang)})"
    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<script>(function(){{try{{if(localStorage.getItem('theme')!=='dark')document.documentElement.classList.add('light');}}catch(e){{}}}})();</script><link rel="stylesheet" href="style.css">
{STYLE}
</head>
<body>
<div class="container">

<a href="index.html" class="back">{ch["back"]}</a>

<header>
  <div>
    <h1>{L(c["h1"], lang)}</h1>
    <div class="subtitle">Roots Atlas {n:02d} · שֹׁרֶשׁ {rs} · {L(c["field_phrase"], lang)}</div>
  </div>
  <div class="nav">
    <a href="index.html">{ch["home"]}</a>
    <a href="#" class="active">{rs}</a>
    <a href="morpho-001-shoresh-en.html">{ch["morph"]}</a>
  </div>
</header>

<div class="root-hero">
  <div class="rh-letters">{rs}</div>
  <div class="rh-meta">
    <div class="rh-translit">{c["translit"]}</div>
    <div class="rh-gloss">{L(c["hero_gloss"], lang)}</div>
    <div class="rh-count">{ch["count"].format(n=nwords, v=nverbs)}</div>
  </div>
  <button class="icon-btn" data-say="{hero_say}" title="Hear the root">▶</button>
</div>

<p class="intro">
  {L(c["intro"], lang)}
</p>

{verb_section}
<h2>{ch["h_words"]}</h2>
<p class="intro" style="margin-bottom:6px">{ch["p_words"]}</p>

{chr(10).join(groups_html)}

<hr class="section-divider">

<h2>{ch["h_decode"]}</h2>
<p class="intro" style="margin-bottom:6px">{ch["p_decode"]}</p>

<footer>
  Roots Atlas {n:02d} · {rs} · <a href="index.html" style="color:var(--accent)">{ch["back"].replace("←","").strip()} →</a>
</footer>

</div>
<script src="app.js"></script>
<script>
document.querySelectorAll('.icon-btn[data-say]').forEach(b =>
  b.addEventListener('click', () => {{ try {{ speak(b.dataset.say, 0.85); }} catch(e){{}} }}));
addMiniQuiz({json.dumps(L(c['quiz_title'], lang), ensure_ascii=False)}, {quiz_js});
let _c=0; document.body.addEventListener('click', e => {{ if (e.target.closest('.icon-btn')) {{ _c++; if (_c>=10) try{{ markLessonDone('root-{n:03d}'); }}catch(_){{}} }} }});
</script>
</body>
</html>
"""


def main():
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(HERE, "content_roots", "*.json")))
    for f in files:
        c = json.load(io.open(f, encoding="utf-8"))
        for lang in ("fr", "en"):
            html = build(c, lang)
            suffix = "" if lang == "fr" else "-en"
            out = os.path.join(ROOT, f"root-{c['n']:03d}-{c['slug']}{suffix}.html")
            io.open(out, "w", encoding="utf-8").write(html)
            print(f"wrote {os.path.basename(out)} ({len(html)} bytes)")


if __name__ == "__main__":
    main()
