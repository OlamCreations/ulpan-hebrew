// Ulpan morphology proxy. Both upstreams are CORS-blocked / not browser-callable, so this
// Worker relays them and returns clean per-word data for the word-by-word view:
//   - Dicta Nakdan  -> vocalization (niqqud) + root/lemma
//   - UDPipe (HTB)  -> part of speech, binyan, verb form, gender/number/person
// UDPipe is CC BY-NC-SA (non-commercial) — fine for a personal learning app.
const NAKDAN = 'https://nakdan-u1-0.loadbalancer.dicta.org.il/api';
const UDPIPE = 'https://lindat.mff.cuni.cz/services/udpipe/api/process';
const UPSTREAM_TIMEOUT = 6000;   // ms; a hung upstream degrades instead of hanging the request
const CACHE_TTL = 604800;        // 7 days — the vocabulary is effectively static

// CORS restricted to the app origins (still open to direct curl — that's a rate-limit concern,
// not a CORS one — but this stops other sites embedding the endpoint in visitors' browsers).
function allowOrigin(origin) {
  try {
    if (!origin) return 'https://olamcreations.github.io';
    const h = new URL(origin).hostname;
    if (/\.github\.io$/.test(h) || h === 'localhost' || h === '127.0.0.1') return origin;
  } catch (e) {}
  return 'https://olamcreations.github.io';
}
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': allowOrigin(origin),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff'
  };
}
const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });

const POS_LABEL = { PRON: 'pronoun', VERB: 'verb', NOUN: 'noun', PROPN: 'proper noun', ADJ: 'adjective',
  ADV: 'adverb', ADP: 'preposition', DET: 'article', NUM: 'number', CCONJ: 'conjunction', SCONJ: 'conjunction',
  AUX: 'auxiliary', PART: 'particle', INTJ: 'interjection' };
const BINYAN_LABEL = { PAAL: "Pa'al", NIFAL: "Nif'al", PIEL: "Pi'el", PUAL: "Pu'al", HIFIL: "Hif'il",
  HUFAL: "Huf'al", HITPAEL: "Hitpa'el" };

// Dicta encodes binyan in bits 51-53 of its morph id (0 = not a verb). Dicta is Hebrew-native
// and gets irregular verbs right where UDPipe fails (הלך as Pa'al not Hif'il, אלמד as a verb
// not a proper noun), so it's authoritative for binyan. (Its tense byte is not cleanly
// decodable — mixes conjugation class — so tense stays with UDPipe.)
const DBINYAN = { 1: "Pa'al", 2: "Nif'al", 3: "Hif'il", 4: "Huf'al", 5: "Pi'el", 6: "Pu'al", 7: "Hitpa'el" };
function decodeBinyan(midStr) {
  try { return DBINYAN[Number((BigInt(midStr) >> 51n) & 7n)] || ''; } catch (e) { return ''; }
}

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
// content sub-token so a word like בבית keeps its noun morphology. PUNCT tokens are dropped:
// Dicta already folds punctuation into its separator tokens, so keeping them here would shift
// the per-word alignment by one for every following word.
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
      if (cols[3] !== 'PUNCT') words.push({ surface: cols[1], pos: cols[3], feats: cols[5], lemma: cols[2] });
      k += 1;
    }
  }
  return words;
}

const HEB = /[֐-׿]/;
function morphOf(ud) {
  const out = {};
  // Never surface a "punct"/other bogus tag on a token that is actually Hebrew letters.
  if (HEB.test(ud.surface) && (ud.pos === 'PUNCT' || ud.pos === 'X' || ud.pos === 'SYM')) return out;
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

async function dicta(text, signal) {
  const payload = { task: 'nakdan', data: text, genre: 'modern', addmorph: true,
    keepqq: false, nodageshdefault: false, patachma: false, keepmetagim: true };
  const r = await fetch(NAKDAN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  if (!r.ok) throw new Error('nakdan ' + r.status);
  const toks = await r.json();
  const out = [];
  for (const t of (Array.isArray(toks) ? toks : [])) {
    if (t && t.sep) { out.push({ sep: true, word: t.word || '' }); continue; }
    const opt = t && Array.isArray(t.options) && t.options[0];
    // Dicta marks prefix boundaries with '|' (לְ|בֵית); drop it for a clean vocalized form.
    const voc = (((opt && opt[0]) || (t && t.word) || '')).replace(/\|/g, '');
    const a0 = opt && Array.isArray(opt[1]) && opt[1][0];
    const lemma = (a0 && a0[1]) || '';
    const dbinyan = decodeBinyan(a0 && a0[0]);
    out.push({ sep: false, word: (t && t.word) || '', voc, lemma, dbinyan });
  }
  return out;
}

async function udpipe(text, signal) {
  const form = new URLSearchParams();
  form.set('tokenizer', ''); form.set('tagger', ''); form.set('model', 'hebrew'); form.set('data', text);
  const r = await fetch(UDPIPE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal });
  if (!r.ok) throw new Error('udpipe ' + r.status);
  const j = await r.json();
  return parseUD(j && j.result);
}

async function analyze(text) {
  const dCtrl = new AbortController(), uCtrl = new AbortController();
  const dT = setTimeout(() => dCtrl.abort(), UPSTREAM_TIMEOUT);
  const uT = setTimeout(() => uCtrl.abort(), UPSTREAM_TIMEOUT);
  const [dRes, uRes] = await Promise.allSettled([
    dicta(text, dCtrl.signal).finally(() => clearTimeout(dT)),
    udpipe(text, uCtrl.signal).finally(() => clearTimeout(uT))
  ]);
  if (dRes.status !== 'fulfilled') return null;
  const out = dRes.value;
  const ud = uRes.status === 'fulfilled' ? uRes.value : [];
  let ui = 0;
  for (const tok of out) {
    if (tok.sep) continue;
    const w = ud[ui++];
    const um = w ? morphOf(w) : {};
    if (tok.dbinyan) {
      // Dicta says verb (with this binyan); trust it over UDPipe for pos+binyan, keep UDPipe's
      // tense (form) and gender/number/person.
      tok.pos = 'verb'; tok.binyan = tok.dbinyan; tok.form = um.form || ''; tok.gnp = um.gnp || '';
    } else {
      Object.assign(tok, um);
    }
    delete tok.dbinyan;
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

    // Per-IP rate limit (native binding) — stops scripted abuse of the public endpoint.
    if (env && env.RL) {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      try { const { success } = await env.RL.limit({ key: ip }); if (!success) return json({ error: 'rate limited' }, 429, origin); } catch (e) {}
    }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }
    const text = ((body && body.text) || '').toString().slice(0, 500);
    if (!text.trim()) return json({ tokens: [] }, 200, origin);

    // Cache the computed payload (not the CORS-stamped Response) so the header stays per-origin.
    const cache = caches.default;
    const cacheKey = new Request('https://morph.cache/v3/' + encodeURIComponent(text));
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(await hit.text(), { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });

    const tokens = await analyze(text);
    if (tokens === null) return json({ error: 'upstream' }, 502, origin);
    const payload = JSON.stringify({ tokens });
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, new Response(payload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL } })));
    return new Response(payload, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
  }
};
