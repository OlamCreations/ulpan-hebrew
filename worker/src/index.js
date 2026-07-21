// Ulpan morphology proxy. Both upstreams are CORS-blocked / not browser-callable, so this
// Worker relays them and returns clean per-word data for the word-by-word view:
//   - Dicta Nakdan  -> vocalization (niqqud) + root/lemma
//   - UDPipe (HTB)  -> part of speech, binyan, verb form, gender/number/person
// UDPipe is CC BY-NC-SA (non-commercial) — fine for a personal learning app.
const NAKDAN = 'https://nakdan-u1-0.loadbalancer.dicta.org.il/api';
const UDPIPE = 'https://lindat.mff.cuni.cz/services/udpipe/api/process';
const UPSTREAM_TIMEOUT = 6000;   // ms; a hung upstream degrades instead of hanging the request
const CACHE_TTL = 604800;        // 7 days — the vocabulary is effectively static

// Workers AI model for the "natural version" layer (/nat). Google Translate under the live
// translator produces literal calques on idiomatic phrases and gets register/gender wrong
// ("c'est ma professeure" -> masculine מורה). A 70B instruct model gives the idiomatic Hebrew a
// native actually says (זו מורתי). Measured: 8/10 phrases natural at temperature 0 with a strict
// "translate faithfully, do not invent" prompt; the 8B model is unusable and higher temperature
// hallucinates (savivon/dreidel for "tour du monde"). We take ONLY the consonantal Hebrew from
// it — its self-generated transliteration is wrong (yoter -> "odar") and its niqqud is patchy,
// so the client strips both and re-vocalizes through Dicta + translit.js like any other result.
const NAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const NAT_SYS = `You are a careful Hebrew translator for a French/English speaker learning Hebrew at ulpan. Translate the user's sentence FAITHFULLY into natural, modern spoken Israeli Hebrew. Preserve the exact meaning, register, gender and number — do not invent, add, or drop ideas. Prefer how a native Israeli actually says it over a word-for-word calque; if the phrase is idiomatic, give the idiomatic Hebrew, not the literal one.
Give up to 2 options, most natural first (a second only if it is a genuinely different, correct way to say it — e.g. a feminine-speaker form). Output ONLY these lines and nothing else, one option per line:
HEBREW | short note in French on register or usage
Do not number the lines. Do not write anything before or after the list.`;

// Word-by-word glossing IN CONTEXT (/gloss). The breakdown used to translate each word alone
// through Google, which on Hebrew homographs is a coin flip it kept losing: שְׁמִי -> "Semitic"
// (my name), הַאִם -> "the mother" (the yes/no particle), עוֹבֵר -> "fetus" (passes). Measured:
// sending the vocalized form changes nothing, so the cause is isolation, not vocalization —
// only the surrounding sentence can settle it. The client resolves everything it can from its
// own verified corpus first and asks here only for what is left.
//
// Same discipline as /nat: the model supplies ONLY the English gloss. Niqqud, transliteration,
// root and morphology keep coming from Dicta/UDPipe and translit.js, never from the LLM.
const GLOSS_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const GLOSS_SYS = `You gloss Hebrew words for a French/English speaker learning Hebrew at ulpan.
You are given one Hebrew sentence, then a list of words taken from it. For EACH listed word, give its meaning AS USED IN THAT SENTENCE — the sentence is the context that decides between readings of the same spelling.
Rules:
- 1 to 4 English words per gloss. No explanation, no grammar labels, no transliteration.
- For a verb, give it as English "to ..." or a plain conjugated sense (e.g. "buys", "will buy").
- For a function word with no English equivalent, describe its job in parentheses, e.g. "(direct object marker)" or "(yes/no question)".
- If a word is a name, output the name.
Output ONLY these lines, one per listed word, in the same order:
HEBREW WORD = gloss
Do not number the lines. Do not write anything before or after the list.`;

// CORS restricted to the app origins (still open to direct curl — that's a rate-limit concern,
// not a CORS one — but this stops other sites embedding the endpoint in visitors' browsers).
function allowOrigin(origin) {
  try {
    if (!origin) return 'https://olamcreations.github.io';
    const h = new URL(origin).hostname;
    // ONLY our Pages origin + local dev. This used to allow any *.github.io, but MORPH_URL is
    // hardcoded to this deployment in the (open-source) front-end, so a fork deployed to another
    // github.io could freeload on our Workers AI neuron budget from its visitors' browsers.
    // Self-hosters deploy their own Worker and point MORPH_URL at it (see README).
    if (h === 'olamcreations.github.io' || h === 'localhost' || h === '127.0.0.1') return origin;
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
const stripNiqqud = (s) => (s || '').replace(/[֑-ׇ]/g, '');
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
  // Both upstreams expect UNVOCALIZED modern Hebrew. Nakdan's whole job is to ADD niqqud, and
  // UDPipe's Hebrew model (HTB) is trained on unvocalized text, so feeding either one niqqud is
  // out of distribution. The breakdown asks about a card whose Hebrew is already vocalized, so
  // that is exactly what was being sent — and the morphology under every word paid for it.
  //
  // Measured against hand-written ground truth on 17 words of everyday sentences:
  //     bare input      17/17 correct part of speech
  //     vocalized input  9/16 — לֶחֶם (bread) tagged as an infinitive verb, טָרִי (fresh) as a
  //                      noun, בַּשּׁוּק (in the market) as an adverb, and one word dropped from
  //                      the tokenization entirely.
  const bare = stripNiqqud(text);
  /* UDPipe also tags noticeably worse when the sentence carries its final punctuation. Measured
     over 5 everyday sentences with hand-written ground truth: 79% with the trailing mark, 95%
     without, and the words that flip are ordinary content words in the MIDDLE of the sentence
     (לֶחֶם bread -> verb, טָרִי fresh -> adverb, בַּגִּנָּה in the garden -> adverb), not the token next
     to the punctuation. Token alignment is unaffected either way — parseUD already drops PUNCT
     rows — so this only changes the tagger's own analysis. Trailing only: internal commas were
     not measured and may well carry real syntactic signal. Dicta still gets the full text; it
     needs the punctuation to emit the separator tokens the client reassembles from. */
  const forTagging = bare.replace(/[.!?…]+\s*$/, '');
  const dCtrl = new AbortController(), uCtrl = new AbortController();
  const dT = setTimeout(() => dCtrl.abort(), UPSTREAM_TIMEOUT);
  const uT = setTimeout(() => uCtrl.abort(), UPSTREAM_TIMEOUT);
  const [dRes, uRes] = await Promise.allSettled([
    dicta(bare, dCtrl.signal).finally(() => clearTimeout(dT)),
    udpipe(forTagging, uCtrl.signal).finally(() => clearTimeout(uT))
  ]);
  if (dRes.status !== 'fulfilled') return null;
  const out = dRes.value;
  const ud = uRes.status === 'fulfilled' ? uRes.value : [];

  /* Stripping niqqud for the upstreams also throws away what the caller's niqqud already
     settled. Sending הַמּוֹרָה (the teacher, feminine) bare makes Dicta re-point it הַמּוֹרֶה —
     masculine, and tagged "m. sing." So: take morphology from the bare analysis, but give back
     the caller's own vocalization whenever it survives. That also protects hand-verified niqqud
     coming from the curated phrasebook, which is better than anything Dicta will guess.
     Only overridden when the consonants match exactly, so a token Dicta split or reordered is
     left alone rather than mislabelled with a neighbour's vowels. */
  if (HEB.test(text) && text !== bare) {
    const supplied = text.split(/\s+/).filter(Boolean);
    let si = 0;
    for (const tok of out) {
      if (tok.sep) continue;
      while (si < supplied.length && stripNiqqud(supplied[si]).replace(/[^֐-׿]/g, '') !== tok.word) si++;
      if (si >= supplied.length) break;
      // Take the Hebrew core only. Splitting on whitespace leaves the sentence's final period
      // glued to the last word, and copying that in wholesale put a "." inside the vocalized
      // form of every sentence-final word — the punctuation belongs to the separator token.
      const core = supplied[si].replace(/^[^֐-׿]+/, '').replace(/[^֐-׿]+$/, '');
      if (/[֑-ׇ]/.test(core)) tok.voc = core;
      si++;
    }
  }
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

// Natural-version translation via Workers AI. Returns only { he, note } per option: the Hebrew
// (which the client re-vocalizes through Dicta so the niqqud/translit come from the trusted path,
// not from the LLM) and a short French usage note. Bad/hallucinated lines are filtered out here —
// a line only survives if column 1 actually contains Hebrew letters and is not a duplicate of one
// already kept (by consonantal skeleton).
async function natTranslate(text, env) {
  if (!env || !env.AI) throw new Error('no AI binding');
  const r = await env.AI.run(NAT_MODEL, {
    messages: [{ role: 'system', content: NAT_SYS }, { role: 'user', content: text }],
    temperature: 0, max_tokens: 400
  });
  const raw = (r && (r.response || r.result || '')) || '';
  const seen = new Set();
  const options = [];
  for (let line of raw.split('\n')) {
    line = line.trim();
    if (line.indexOf('|') === -1) continue;
    const parts = line.split('|').map(s => s.trim());
    const he = (parts[0] || '').replace(/^\d+[.)]\s*/, '').trim();
    const note = (parts[1] || '').trim();
    if (!HEB.test(he)) continue;
    const skel = he.replace(/[֑-ׇ\s.,?!;:'"״׳()־-]/g, '');
    if (!skel || seen.has(skel)) continue;
    seen.add(skel);
    options.push({ he, note });
    if (options.length >= 2) break;   // top 2 only: the model ranks best-first and its rare
  }                                    // hallucinations land in the 3rd slot — cut the tail.
  return options;
}

// Gloss the given words in the context of the sentence. Returns { word: gloss } for the words
// the model actually answered — a missing word is left to the client's own fallback rather than
// filled with a guess. Keyed by the exact surface form the client sent, so a word appearing
// twice is asked once.
async function glossInContext(text, words, env) {
  if (!env || !env.AI) throw new Error('no AI binding');
  const uniq = [...new Set(words.filter(w => HEB.test(w)))].slice(0, 24);
  if (!uniq.length) return {};
  const prompt = 'Sentence: ' + text + '\nWords:\n' + uniq.join('\n');
  const r = await env.AI.run(GLOSS_MODEL, {
    messages: [{ role: 'system', content: GLOSS_SYS }, { role: 'user', content: prompt }],
    temperature: 0, max_tokens: 500
  });
  const raw = (r && (r.response || r.result || '')) || '';
  // Only accept lines naming a word we actually asked about: the model occasionally invents an
  // extra row, and an unrequested gloss would attach to nothing or, worse, to the wrong token.
  const asked = new Map(uniq.map(w => [w.replace(/[֑-ׇ]/g, ''), w]));
  const out = {};
  for (let line of raw.split('\n')) {
    line = line.trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const lhs = line.slice(0, eq).trim().replace(/^\d+[.)]\s*/, '');
    let gloss = line.slice(eq + 1).trim();
    const key = asked.get(lhs.replace(/[֑-ׇ]/g, ''));
    if (!key || out[key]) continue;
    // A gloss is a few words. Anything longer is the model explaining itself, which belongs
    // nowhere near a vocabulary cell.
    if (!gloss || gloss.length > 60 || HEB.test(gloss)) continue;
    gloss = gloss.replace(/\s+/g, ' ');
    out[key] = gloss;
  }
  return out;
}

// Anonymous usage analytics. The client batches events and POSTs them here (safelisted
// text/plain, no preflight, sendBeacon on page hide). We write one Analytics Engine data point
// per event: no cookies, no IP stored — country/device are derived, the only id is the client's
// random anon key (for DAU/retention counting), which the user can reset or disable.
function track(request, env) {
  return request.json().then(body => {
    const evs = Array.isArray(body && body.events) ? body.events.slice(0, 30) : [];
    const aid = ((body && body.aid) || 'anon').toString().slice(0, 32);
    const role = (body && body.owner) ? 'owner' : '';   // owner-tagged devices are excluded from the public report
    const country = (request.cf && request.cf.country) || request.headers.get('CF-IPCountry') || 'XX';
    const ua = request.headers.get('User-Agent') || '';
    const device = /Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile'
      : /iPad|Tablet/i.test(ua) ? 'tablet' : 'desktop';
    if (env && env.AE) {
      for (const ev of evs) {
        const e = ((ev && ev.e) || '').toString().slice(0, 40);
        if (!e) continue;
        try {
          env.AE.writeDataPoint({
            indexes: [aid],
            blobs: [e, ((ev.page) || '').toString().slice(0, 60), ((ev.detail) || '').toString().slice(0, 80),
              country, device, ((ev.lang) || '').toString().slice(0, 8), role],
            doubles: [Number(ev.val) || 0]
          });
        } catch (err) {}
      }
    }
  }).catch(() => {});
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

    // Analytics ingest — always 204 (never let tracking break or slow the app). Awaited (not
    // waitUntil) so the request body is read before we return; reading it afterwards can drop
    // the write. writeDataPoint itself is non-blocking, so this stays fast.
    if (new URL(request.url).pathname === '/track') {
      await track(request, env);
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // Natural-version layer: French/English -> idiomatic Hebrew via Workers AI. On-demand (the
    // client only calls it when the learner asks), cached 7 days (temperature 0 is deterministic,
    // and the neuron budget is real). Falls back to a 502 the client treats as "unavailable".
    if (new URL(request.url).pathname === '/nat') {
      let nb;
      try { nb = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }
      const nt = ((nb && nb.text) || '').toString().slice(0, 300);
      if (!nt.trim()) return json({ options: [] }, 200, origin);
      const nCache = caches.default;
      const nKey = new Request('https://nat.cache/v2/' + encodeURIComponent(nt));
      const nHit = await nCache.match(nKey);
      if (nHit) return new Response(await nHit.text(), { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
      let options;
      try { options = await natTranslate(nt, env); } catch (e) { return json({ error: 'ai unavailable' }, 502, origin); }
      const nPayload = JSON.stringify({ options });
      if (options.length && ctx && ctx.waitUntil) ctx.waitUntil(nCache.put(nKey, new Response(nPayload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL } })));
      return new Response(nPayload, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
    }

    // In-context word glossing for the breakdown. Cached 7 days on sentence + word list, like
    // /nat: temperature 0 makes it deterministic and the neuron budget is finite.
    if (new URL(request.url).pathname === '/gloss') {
      let gb;
      try { gb = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }
      const gText = ((gb && gb.text) || '').toString().slice(0, 500);
      const gWords = Array.isArray(gb && gb.words) ? gb.words.map(w => String(w).slice(0, 40)) : [];
      if (!gText.trim() || !gWords.length) return json({ glosses: {} }, 200, origin);
      const gCache = caches.default;
      const gKey = new Request('https://gloss.cache/v1/' + encodeURIComponent(gText + '||' + gWords.join('|')));
      const gHit = await gCache.match(gKey);
      if (gHit) return new Response(await gHit.text(), { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
      let glosses;
      try { glosses = await glossInContext(gText, gWords, env); } catch (e) { return json({ error: 'ai unavailable' }, 502, origin); }
      const gPayload = JSON.stringify({ glosses });
      if (Object.keys(glosses).length && ctx && ctx.waitUntil) ctx.waitUntil(gCache.put(gKey, new Response(gPayload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL } })));
      return new Response(gPayload, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
    }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }
    const text = ((body && body.text) || '').toString().slice(0, 500);
    if (!text.trim()) return json({ tokens: [] }, 200, origin);

    // Cache the computed payload (not the CORS-stamped Response) so the header stays per-origin.
    const cache = caches.default;
    const cacheKey = new Request('https://morph.cache/v7/' + encodeURIComponent(text));
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(await hit.text(), { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });

    const tokens = await analyze(text);
    if (tokens === null) return json({ error: 'upstream' }, 502, origin);
    const payload = JSON.stringify({ tokens });
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, new Response(payload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL } })));
    return new Response(payload, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
  }
};
