// Ulpan morphology proxy. Both upstreams are CORS-blocked / not browser-callable, so this
// Worker relays them and returns clean per-word data for the word-by-word view:
//   - Dicta Nakdan  -> vocalization (niqqud) + root/lemma
//   - UDPipe (HTB)  -> part of speech, binyan, verb form, gender/number/person
// UDPipe is CC BY-NC-SA (non-commercial) — fine for a personal learning app.
const NAKDAN = 'https://nakdan-u1-0.loadbalancer.dicta.org.il/api';
const UDPIPE = 'https://lindat.mff.cuni.cz/services/udpipe/api/process';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

const POS_LABEL = { PRON: 'pronoun', VERB: 'verb', NOUN: 'noun', PROPN: 'proper noun', ADJ: 'adjective',
  ADV: 'adverb', ADP: 'preposition', DET: 'article', NUM: 'number', CCONJ: 'conjunction', SCONJ: 'conjunction',
  AUX: 'auxiliary', PART: 'particle', INTJ: 'interjection' };
const BINYAN_LABEL = { PAAL: "Pa'al", NIFAL: "Nif'al", PIEL: "Pi'el", PUAL: "Pu'al", HIFIL: "Hif'il",
  HUFAL: "Huf'al", HITPAEL: "Hitpa'el" };

const feat = (feats, key) => { const m = feats && feats.match(new RegExp(key + '=([^|]+)')); return m ? m[1] : ''; };
function verbForm(feats) {
  const t = feat(feats, 'Tense'), vf = feat(feats, 'VerbForm'), mood = feat(feats, 'Mood');
  if (mood === 'Imp') return 'imperative';
  if (vf === 'Inf') return 'infinitive';
  if (t === 'Past') return 'past';
  if (t === 'Fut' || t === 'Future') return 'future';
  if (vf === 'Part' || t === 'Pres') return 'present';
  return '';
}

// CoNLL-U -> one entry per surface word; multiword tokens (prefix splits) fold into their
// content sub-token so a word like בבית keeps its noun morphology.
function parseUD(conllu) {
  const rows = (conllu || '').split('\n').filter(l => l && l[0] !== '#').map(l => l.split('\t'));
  const words = [];
  let k = 0;
  while (k < rows.length) {
    const cols = rows[k];
    const id = cols[0] || '';
    if (id.indexOf('-') !== -1) {
      const [a, b] = id.split('-').map(Number);
      const n = b - a + 1;
      const parts = rows.slice(k + 1, k + 1 + n);
      const head = parts.find(p => ['VERB', 'NOUN', 'PROPN', 'ADJ', 'PRON', 'NUM', 'ADV'].indexOf(p[3]) !== -1) || parts[parts.length - 1] || cols;
      words.push({ surface: cols[1], pos: head[3], feats: head[5], lemma: head[2] });
      k += 1 + n;
    } else {
      words.push({ surface: cols[1], pos: cols[3], feats: cols[5], lemma: cols[2] });
      k += 1;
    }
  }
  return words;
}

function morphOf(ud) {
  const out = {};
  out.pos = POS_LABEL[ud.pos] || (ud.pos ? ud.pos.toLowerCase() : '');
  if (ud.pos === 'VERB' || ud.pos === 'AUX') {
    out.binyan = BINYAN_LABEL[feat(ud.feats, 'HebBinyan')] || '';
    out.form = verbForm(ud.feats);
  }
  const g = feat(ud.feats, 'Gender'), n = feat(ud.feats, 'Number'), p = feat(ud.feats, 'Person');
  const gnp = [];
  if (g && g !== 'Fem,Masc') gnp.push(g === 'Fem' ? 'f.' : g === 'Masc' ? 'm.' : g.toLowerCase());
  if (n) gnp.push(n === 'Sing' ? 'sing.' : n === 'Plur' ? 'pl.' : n.toLowerCase());
  if (p && p.indexOf(',') === -1) gnp.push(p + (p === '1' ? 'st' : p === '2' ? 'nd' : 'rd') + ' pers.');
  out.gnp = gnp.join(' ');
  return out;
}

async function dicta(text) {
  // addmorph:true makes each option an array [vocalized, [[morphId, lemma, ...], ...]] — we read
  // the vocalized form and the first lemma (root). With it false the options are bare strings.
  const payload = { task: 'nakdan', data: text, genre: 'modern', addmorph: true,
    keepqq: false, nodageshdefault: false, patachma: false, keepmetagim: true };
  const r = await fetch(NAKDAN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error('nakdan ' + r.status);
  const toks = await r.json();
  const out = [];
  for (const t of (Array.isArray(toks) ? toks : [])) {
    if (t && t.sep) { out.push({ sep: true, word: t.word || '' }); continue; }
    const opt = t && Array.isArray(t.options) && t.options[0];
    // Dicta marks prefix boundaries with '|' (לְ|בֵית); drop it for a clean vocalized form.
    const voc = (((opt && opt[0]) || (t && t.word) || '')).replace(/\|/g, '');
    const lemma = (opt && Array.isArray(opt[1]) && opt[1][0] && opt[1][0][1]) || '';
    out.push({ sep: false, word: (t && t.word) || '', voc, lemma });
  }
  return out;
}

async function udpipe(text) {
  const form = new URLSearchParams();
  form.set('tokenizer', ''); form.set('tagger', ''); form.set('model', 'hebrew'); form.set('data', text);
  const r = await fetch(UDPIPE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (!r.ok) throw new Error('udpipe ' + r.status);
  const j = await r.json();
  return parseUD(j && j.result);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const text = ((body && body.text) || '').toString().slice(0, 500);
    if (!text.trim()) return json({ tokens: [] });

    const [dRes, uRes] = await Promise.allSettled([dicta(text), udpipe(text)]);
    if (dRes.status !== 'fulfilled') return json({ error: 'upstream' }, 502);
    const out = dRes.value;
    const ud = uRes.status === 'fulfilled' ? uRes.value : [];

    // Attach UDPipe morphology to each content word, in order.
    let ui = 0;
    for (const tok of out) {
      if (tok.sep) continue;
      const u = ud[ui++];
      if (u) Object.assign(tok, morphOf(u));
    }
    return json({ tokens: out });
  }
};
