# -*- coding: utf-8 -*-
"""Validate all root content JSON, generate pages, refresh index (count, bar, cards)."""
import json, io, glob, os, re, subprocess, sys, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
def cons(s): return ''.join(c for c in unicodedata.normalize('NFC', s) if 'א' <= c <= 'ת')

# 1. validate
bad = []
for f in sorted(glob.glob(os.path.join(HERE, 'content_roots', '*.json'))):
    slug = os.path.basename(f)[:-5]
    try: c = json.load(io.open(f, encoding='utf-8'))
    except Exception as e: bad.append((slug, 'JSONERR')); continue
    if not all(k in c for k in ['n','root','root_spaced','slug','translit','field','field_phrase','h1','hero_gloss','intro','binyanim','binyan_note','groups','quiz_title','quiz']):
        bad.append((slug, 'KEYS')); continue
    if len(c['quiz']) != 5: bad.append((slug, f"quiz{len(c['quiz'])}")); continue
    if not c['binyanim'] and not c['groups']: bad.append((slug, 'EMPTY')); continue
    used = [b['he'] for b in c['binyanim']] + [w['he'] for g in c['groups'] for w in g['words']]
    fp = os.path.join(HERE, 'families', c['root'] + '.json')
    if os.path.exists(fp):
        miss = set(cons(m['lemma']) for m in json.load(io.open(fp, encoding='utf-8'))['members']) - set(cons(x) for x in used)
        if miss and slug != 'ktav': bad.append((slug, f'miss{len(miss)}'))
if bad:
    print('VALIDATION ISSUES:', bad); sys.exit(1)

# 2. generate
subprocess.run([sys.executable, os.path.join(HERE, 'gen_root.py')], check=True, stdout=subprocess.DEVNULL)

# 3. index: count, bar, cards
metas = []
for f in glob.glob(os.path.join(HERE, 'content_roots', '*.json')):
    c = json.load(io.open(f, encoding='utf-8'))
    metas.append((c['n'], c['slug'], c['root_spaced'], c['field']['en'], c['translit']))
cards = []
for n, slug, rs, field, tr in sorted(metas):
    cards.append(f' <a href="root-{n:03d}-{slug}-en.html" class="tehilim-card">\n <div class="ps">Root {n}</div>\n <div class="he">{rs}</div>\n <div class="ti">{field} · {tr.replace(" · ", "")}</div>\n </a>')
nn = len(metas)
idx = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
idx = re.sub(r'(id="cat-roots".*?<span class="mega-cat-stat">)\d+ / 250', lambda m: m.group(1) + f'{nn} / 250', idx, flags=re.S, count=1)
idx = re.sub(r'(id="cat-roots".*?mega-cat-bar-fill" style="width:)[\d.]+%', lambda m: m.group(1) + str(round(nn/250*100, 1)) + '%', idx, flags=re.S, count=1)
m = re.search(r'(<section class="mega-cat" id="cat-roots">.*?<div class="tehilim-grid">\n).*?(\n </div>\n</section>)', idx, re.S)
idx = idx[:m.start()] + m.group(1) + "\n".join(cards) + m.group(2) + idx[m.end():]
io.open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(idx)
print(f'OK: {nn} roots validated, generated, indexed ({round(nn/250*100,1)}%)')
