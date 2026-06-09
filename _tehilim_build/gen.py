# -*- coding: utf-8 -*-
"""Tehilim page generator. Reads per-psalm JSON, emits tehilim-NNN.html (fr) + -en (en).
Head + chord-JS footer are spliced verbatim from the artisanal tehilim-001 model so every
new psalm is byte-structurally identical to #1. Only the body content varies per psalm/lang.
"""
import json, io, os, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def read(p):
    return io.open(p, encoding="utf-8").read()

HEAD = read(os.path.join(HERE, "shell_head.html"))
SCRIPT = read(os.path.join(HERE, "shell_script.html"))

# Fixed UI chrome captured verbatim from tehilim-001 (FR) and tehilim-001-en (EN).
CHROME = {
    "en": {
        "back": "← Back to lessons",
        "home": "Home",
        "chord_label": "♫ Guitar suggestion — hover a chord to explore or change",
        "tuning_label": "♪ Tuning",
        "opt_half": "½ step down (Eb…)",
        "opt_full": "Whole step down (D G C F A D)",
        "opt_custom": "Custom…",
        "tuning_ph": "e.g. D A D G A D",
        "av_title": "Active voicings · printable",
        "print_btn": "🖶 print",
        "av_hint": "The voicing displayed for each chord is the one you selected in its popup. Navigate with the popup arrows to change.",
        "chant_h3": "♫ For singing with guitar",
        "pardes_h3": "♦ PARDES analysis — פרדס",
        "pardes_intro": 'The four levels of Jewish reading of the sacred text: פשט Peshat (literal meaning), רמז Remez (symbolic allusion), דרש Drash (midrashic interpretation), סוד Sod (mystical meaning). The word פרדס means "orchard" — each level is a fruit.',
        "footer_link": "Back to lessons →",
    },
    "fr": {
        "back": "← Retour aux leçons",
        "home": "Accueil",
        "chord_label": "♫ Suggestion guitare — survole un accord pour explorer ou modifier",
        "tuning_label": "♪ Accordage",
        "opt_half": "½ ton plus bas (Eb…)",
        "opt_full": "1 ton plus bas (D G C F A D)",
        "opt_custom": "Personnalisé…",
        "tuning_ph": "ex: D A D G A D",
        "av_title": "Doigtés actifs · imprimable",
        "print_btn": "🖶 imprimer",
        "av_hint": "Le doigté affiché par accord est celui que tu as sélectionné dans son popup. Navigue avec les flèches du popup pour changer.",
        "chant_h3": "♫ Pour le chant à la guitare",
        "pardes_h3": "♦ Analyse PARDES — פרדס",
        "pardes_intro": "Les quatre niveaux de lecture juive du texte sacré : פשט Peshat (sens littéral), רמז Remez (allusion symbolique), דרש Drash (interprétation midrashique), סוד Sod (sens mystique). Le mot פרדס signifie « verger » — chaque niveau est un fruit.",
        "footer_link": "Retour aux leçons →",
    },
}

TUNING_OPTS = """      <option value="standard">Standard (E A D G B E)</option>
      <option value="drop-d">Drop D (D A D G B E)</option>
      <option value="dadgad">DADGAD (D A D G A D)</option>
      <option value="open-d">Open D (D A D F# A D)</option>
      <option value="open-g">Open G (D G D G B D)</option>
      <option value="open-c">Open C (C G C G C E)</option>
      <option value="half-down">{opt_half}</option>
      <option value="full-down">{opt_full}</option>
      <option value="custom">{opt_custom}</option>"""


def chord_span(c):
    return f'<span class="chord" data-chord="{c}">{c}</span>'


def progression_html(chords):
    # group 8 chords into 4 bars of 2, double-space between pair, matching model
    bars = []
    for i in range(0, len(chords), 2):
        pair = chords[i:i + 2]
        bars.append("  ".join(chord_span(c) for c in pair))
    return "| " + " | ".join(bars) + " |"


def render_word(w):
    return (f'      <div class="word"><div class="he">{w["he"]}</div>'
            f'<div class="tr">{w["tr"]}</div>'
            f'<div class="fr">{w[LANG]}</div></div>')


def render_stich(s):
    words = "\n".join(render_word(w) for w in s["words"])
    return (f'  <div class="stich">\n'
            f'    <div class="stich-words">\n{words}\n    </div>\n'
            f'    <div class="stich-translation">{s["trans"][LANG]}</div>\n'
            f'  </div>')


def render_verse(v):
    full = "<br>\n  ".join(v["full"])
    stichs = "\n\n".join(render_stich(s) for s in v["stichs"])
    return (f'<!-- VERSET {v["num"]} -->\n'
            f'<div class="verse">\n'
            f'  <span class="verse-num">{v["num"]}</span>\n'
            f'  <div class="verse-full">{full}</div>\n\n'
            f'{stichs}\n\n'
            f'  <div class="verse-summary">\n    {v["summary"][LANG]}\n  </div>\n'
            f'</div>')


def render_pardes(levels):
    out = []
    for lv in levels:
        out.append(f'  <div class="pardes-level">\n'
                   f'    <h4>{lv["h4"]}</h4>\n'
                   f'    <p>{lv["p"]}</p>\n'
                   f'  </div>')
    return "\n\n".join(out)


def build(psalm, lang):
    global LANG
    LANG = lang
    c = CHROME[lang]
    n = psalm["n"]
    incipit = psalm["incipit"]
    head = (HEAD
            .replace('<html lang="en">', f'<html lang="{lang}">')
            .replace('<title>Tehilim 1 — אַשְׁרֵי הָאִישׁ</title>',
                     f'<title>Tehilim {n} — {incipit}</title>'))
    verses = "\n\n\n".join(render_verse(v) for v in psalm["verses"])
    chant_li = "\n".join(f'    <li>{li}</li>' for li in psalm["chant_li"][lang])
    tuning = TUNING_OPTS.format(opt_half=c["opt_half"], opt_full=c["opt_full"], opt_custom=c["opt_custom"])
    body = f'''<body><div class="container">

<a href="index.html" class="back">{c["back"]}</a>

<header>
  <div>
    <h1>Tehilim {n} — {psalm["h1"][lang]}</h1>
    <div class="subtitle">תְּהִלִּים {psalm["letter"]} · {incipit}</div>
  </div>
  <div class="nav"><a href="index.html">{c["home"]}</a><a href="#" class="active">Ps {n}</a></div>
</header>

<div class="t-intro">
  {psalm["intro"][lang]}
</div>

<div class="t-chord">
  <div class="label-row">
    <span class="label">{c["chord_label"]}</span>
  </div>
  <div class="tuning-row">
    <span class="tuning-label">{c["tuning_label"]}</span>
    <select id="tuning-preset">
{tuning}
    </select>
    <input id="tuning-custom" type="text" placeholder="{c["tuning_ph"]}" hidden>
    <span class="tuning-current" id="tuning-current">E A D G B E</span>
  </div>
  <div class="progression" id="progression-display">{progression_html(psalm["progression_chords"])}</div>
  <div class="meta-line">{psalm["meta_line"][lang]}</div>
</div>

<div class="active-voicings" id="active-voicings">
  <div class="av-title">{c["av_title"]}
    <button id="print-btn" class="link-btn" type="button">{c["print_btn"]}</button>
  </div>
  <div class="voicings-grid" id="active-voicings-grid"></div>
  <div class="av-hint">{c["av_hint"]}</div>
</div>


<div class="verses-grid">
{verses}
</div><!-- /.verses-grid -->


<div class="chant-tip">
  <h3>{c["chant_h3"]}</h3>
  <ul>
{chant_li}
  </ul>
</div>

<div class="pardes-card">
  <h3>{c["pardes_h3"]}</h3>
  <div class="pardes-intro">{c["pardes_intro"]}</div>

{render_pardes(psalm["pardes"][lang])}
</div>

<footer>Tehilim {n} · {incipit} · <a href="index.html" style="color:var(--accent)">{c["footer_link"]}</a></footer>

</div>

'''
    # default_progression injection into the shared script
    script = SCRIPT.replace("const DEFAULT_PROGRESSION = '| Am Am | Em Em | Am Dm | Em Am |';",
                            f"const DEFAULT_PROGRESSION = '{psalm['default_progression']}';")
    return head + "\n" + body + script


def main():
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(HERE, "content", "ps*.json")))
    for f in files:
        psalm = json.load(io.open(f, encoding="utf-8"))
        n = psalm["n"]
        if n == 1:
            print("skip ps1 (artisanal original, never overwrite)")
            continue
        for lang in ("fr", "en"):
            html = build(psalm, lang)
            suffix = "" if lang == "fr" else "-en"
            out = os.path.join(ROOT, f"tehilim-{n:03d}{suffix}.html")
            io.open(out, "w", encoding="utf-8").write(html)
            print(f"wrote {os.path.basename(out)} ({len(html)} bytes)")


if __name__ == "__main__":
    main()
