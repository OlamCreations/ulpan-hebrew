// Ulpan morphology proxy — relays Dicta Nakdan (CORS-blocked in the browser) and adds CORS,
// so the ulpan front can get per-word vocalization + root (lemma) for the word-by-word view.
const NAKDAN = 'https://nakdan-u1-0.loadbalancer.dicta.org.il/api';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
    const text = ((body && body.text) || '').toString().slice(0, 500);
    if (!text.trim()) return json({ tokens: [] });

    const payload = { task: 'nakdan', data: text, genre: 'modern', addmorph: true,
      keepqq: false, nodageshdefault: false, patachma: false, keepmetagim: true };
    let toks;
    try {
      const r = await fetch(NAKDAN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) return json({ error: 'nakdan ' + r.status }, 502);
      toks = await r.json();
    } catch (e) { return json({ error: 'upstream' }, 502); }

    const out = [];
    for (const t of (Array.isArray(toks) ? toks : [])) {
      if (t && t.sep) { out.push({ sep: true, word: t.word || '' }); continue; }
      const opt = t && Array.isArray(t.options) && t.options[0];
      const voc = (opt && opt[0]) || (t && t.word) || '';
      // opt[1] = [[morphId, lemma, isInflection], ...]; the first entry's lemma is the root/base.
      const lemma = (opt && Array.isArray(opt[1]) && opt[1][0] && opt[1][0][1]) || '';
      out.push({ sep: false, word: (t && t.word) || '', voc, lemma });
    }
    return json({ tokens: out });
  }
};
