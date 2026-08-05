// Ulpan morphology proxy. Both upstreams are CORS-blocked / not browser-callable, so this
// Worker relays them and returns clean per-word data for the word-by-word view:
//   - Dicta Nakdan  -> vocalization (niqqud) + root/lemma
//   - UDPipe (HTB)  -> part of speech, binyan, verb form, gender/number/person
// UDPipe is CC BY-NC-SA (non-commercial) — fine for a personal learning app.
// Dicta's load-balancer intermittently returns 5xx to Cloudflare's shared egress IPs while serving
// normal clients fine (observed: u1-0 -> 503 from the Worker, 200 from a browser). Try each node in
// turn so one flaky node doesn't take the breakdown down.
const NAKDAN_HOSTS = [
  'https://nakdan-u1-0.loadbalancer.dicta.org.il/api',
  'https://nakdan-2-0.loadbalancer.dicta.org.il/api',
];
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
HEBREW | short note in English on register or usage
Do not number the lines. Do not write anything before or after the list.`;

// Gendered / numbered variants (/form). Hebrew agrees with the person speaking AND the person
// spoken to, so "I want a coffee" has no single translation: a man says אני רוצה, a woman אני רוצה
// pronounced rotza, and "do you want" changes again with who is being asked. Google returns one
// arbitrary reading and never says which. This endpoint takes the sentence plus a requested gender
// and number and returns that reading.
//
// Same discipline as /nat and /gloss: the model supplies ONLY the consonantal Hebrew. The niqqud —
// which for the commonest case (רוצה) is the ONLY thing separating the two forms — comes from Dicta
// via the `prefer` path above, never from the model.
const FORM_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const FORM_SYS = `You are a careful Hebrew translator for a French/English speaker learning Hebrew at ulpan. Translate the user's sentence into natural, modern spoken Israeli Hebrew, in the grammatical form requested.
The request names a GENDER and a NUMBER. Apply them to the participant of the sentence whose Hebrew actually changes: the speaker (1st person) or the person being addressed (2nd person).
Rules:
- Preserve the meaning EXACTLY. Only grammatical agreement changes. Do not add, drop or embellish.
- NEVER change who is speaking or who is being addressed. "do you want" stays second person; do not turn it into "I want". Only the agreement may move.
- Give EXACTLY ONE option. One line, never two.
- If the sentence cannot change for this request (no 1st or 2nd person, nothing that agrees), return the sentence unchanged and write exactly "invariable" as the note.
- The note is French, 5 words maximum, and must name WHO carries the requested form. Examples: "femme qui parle", "homme qui parle", "on s'adresse a une femme", "on s'adresse a plusieurs hommes", "invariable".
Output ONLY these lines and nothing else, one option per line:
HEBREW | note
Do not number the lines. Do not write anything before or after the list.`;
const FORM_LABEL = { m: 'masculine', f: 'feminine' };
const NUM_LABEL = { sg: 'singular', pl: 'plural' };

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
    const u = new URL(origin);
    const h = u.hostname;
    // ONLY our Pages origin (https) + local dev. This used to allow any *.github.io, but MORPH_URL is
    // hardcoded to this deployment in the (open-source) front-end, so a fork deployed to another
    // github.io could freeload on our Workers AI neuron budget from its visitors' browsers.
    // Self-hosters deploy their own Worker and point MORPH_URL at it (see README).
    if (h === 'olamcreations.github.io' && u.protocol === 'https:') return origin;
    if (h === 'localhost' || h === '127.0.0.1') return origin;
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

// The same morph id also carries gender and number, which is what lets us ask Dicta for the
// FEMININE pointing of a word instead of always taking its first guess. Bit 21 = masculine,
// bit 22 = feminine (both set = the analysis itself is ambiguous, so we return nothing rather
// than pick), and bits 24-27 hold the number: 1 singular, 2 plural, 3 dual.
//
// Read off a labelled set and then checked against a HELD-OUT one (different words, none used to
// find the bits): gender 16/17, number 17/17. The one gender miss is the pronoun אַתְּ, which Dicta
// tags masculine — harmless here, because אתה/את differ in their consonants and so never reach the
// option-picking path below. On the class that path exists for — words whose masculine and feminine
// are spelled IDENTICALLY without niqqud (רוצה rotze/rotza, קונה, עושה, שותה, גרה, מורה) — 6/6.
function decodeGN(midStr) {
  try {
    const b = BigInt(midStr);
    const f = (b >> 22n) & 1n, m = (b >> 21n) & 1n;
    const n = Number((b >> 24n) & 0x0fn);
    return { g: (f && m) ? '' : f ? 'f' : m ? 'm' : '', n: n === 1 ? 'sg' : n === 2 ? 'pl' : n === 3 ? 'du' : '' };
  } catch (e) { return { g: '', n: '' }; }
}

// Which of Dicta's readings of ONE word to show, given a requested gender/number.
//
// Dicta ranks its options by likelihood and we normally take the first. That default silently
// answers "masculine" for every word whose two genders share a spelling: asked for the feminine
// of "je veux un café", the sentence comes back רוֹצֶה / "rotze" — masculine niqqud and masculine
// pronunciation under a card labelled feminine, which teaches the learner the error out loud.
// The feminine reading is usually already in the list (רוֹצָה, opt 1); it just needs picking.
//
// A guard keeps this from becoming a corruption engine, because every word of the sentence passes
// through it — including ones with a gender of their own. קָפֶה (coffee) is masculine and must stay
// masculine in a feminine speaker's sentence, yet Dicta will happily also offer קֻפָּה (a till,
// feminine) for the same three letters; taking "the first feminine reading" would serve the learner
// "I want a cash register".
//
// What separates a real inflection from a different word turns out to be visible in the pointing
// itself. The feminine of this whole class is made by changing the LAST vowel and nothing else:
//     קוֹנֶה -> קוֹנָה     שׁוֹתֶה -> שׁוֹתָה     מוֹרֶה -> מוֹרָה
// whereas the impostors diverge earlier, at the first vowel or on a dagesh:
//     קָפֶה  -> קֻפָּה
// So an alternative is accepted only if it is the same word up to its final vowel. Lemma equality
// was tried first and is NOT usable: Dicta lemmatises the masculine to the root (שׁתי) and the
// feminine to the dictionary form (שׁוֹתֶה), so the honest pairs disagree there.
//
// Beyond the first few readings Dicta is into rare and archaic ones, so the search stops early, and
// anything that fails a guard falls back to reading 0. Abstention, never a guess: showing the
// masculine when we are unsure is a missing feature, showing the wrong word is a taught error.
const VOWELS = /[ְ-ׇֻ]/g;
const MARKS = /[֑-ֽ֯]/g;                 // cantillation + meteg: Dicta display noise
function stemKey(voc) {
  const s = (voc || '').replace(MARKS, '').replace(/\|/g, '');
  // Split into consonants carrying their own points, then blank the points of the last two: that
  // is exactly the span a gender ending occupies (נֶה vs נָה), and no more.
  const units = s.match(/[א-ת][^א-ת]*/g) || [];
  return units.map((u, i) => i >= units.length - 2 ? u.replace(VOWELS, '') : u).join('');
}
function pickOption(options, prefer) {
  if (!prefer || !prefer.g || !Array.isArray(options) || options.length < 2) return 0;
  const a0 = Array.isArray(options[0] && options[0][1]) && options[0][1][0];
  if (!a0) return 0;
  const base = decodeGN(a0[0]);
  // A word with no gender of its own has no agreement to change. Dicta reports exactly that for
  // adverbs, prepositions and question words, and the rule below would otherwise trade one for a
  // homograph that does have a gender: asked for the feminine, אֵיפֹה ("where") came back אֵיפָה — the
  // ephah, a biblical unit of measure. It passes the stem test because the two differ precisely
  // where a gender ending sits, so this is the guard that catches it. Nothing to inflect, no change.
  if (!base.g) return 0;
  if (base.g === prefer.g && (!prefer.n || !base.n || base.n === prefer.n)) return 0;
  const stem0 = stemKey(options[0][0]);
  const limit = Math.min(options.length, 5);
  // Two passes: an exact gender+number match first, then gender alone. The number rarely needs
  // deciding here (a Hebrew plural changes the consonants, so it never reaches this function), and
  // insisting on it would drop a correct feminine over a number Dicta simply did not label.
  for (const strict of [true, false]) {
    for (let i = 1; i < limit; i++) {
      const a = Array.isArray(options[i] && options[i][1]) && options[i][1][0];
      if (!a) continue;
      const gn = decodeGN(a[0]);
      if (gn.g !== prefer.g) continue;
      if (strict && prefer.n && gn.n && gn.n !== prefer.n) continue;
      if (stemKey(options[i][0]) !== stem0) continue;   // same word up to its final vowel, or nothing
      return i;
    }
  }
  return 0;
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

// UDPipe's own Person feature on a future-tense verb is not trustworthy: measured against 18
// hand-labelled future/past/present forms (script kept out of the repo), UDPipe answers Person=3
// for אֶקְנֶה ("I will buy", in "מחר אני אקנה ספר חדש" — the exact sentence from the bug report)
// even though the sentence's own subject is אני, and it answers Person=3 for BOTH תִּקְנֶה/היא
// ("she will buy") and תִּקְנֶה/אתה ("you(m.) will buy") — the identical word getting the identical
// tag regardless of which one is the true subject proves it is a fixed default on that form, not a
// real resolution. Person accuracy over the 18-item set: 14/18 (77.8%) before this function existed.
//
// The future-tense person PREFIX, though, is a closed morphological rule and doesn't need UDPipe
// at all: א = 1st sing., נ = 1st plur., י = 3rd (sing. or plur. — never ambiguous, since Hebrew has
// no other use of a bare yod prefix on a future verb). ת is genuinely ambiguous — it marks 2nd
// person (m. or f.) AND 3rd fem. sing. with identical consonants (תִּקְנֶה is both "you(m.) will buy"
// and "she will buy") — resolving that needs the sentence's syntactic subject, which this endpoint
// does not parse for dependencies, so it is left blank rather than guessed, per the assignment's
// own rule: an honest blank beats a confident error in a teaching app.
function futurePersonFromPrefix(surface) {
  // A leading vav is the "and" conjunction fused onto the word, not part of the tense prefix
  // (מוקנה-style roots don't otherwise begin the future stem with ו) — strip one before reading
  // the person letter.
  const w = stripNiqqud(surface || '').replace(/^ו/, '');
  const c = w[0];
  if (c === 'א') return '1';
  if (c === 'נ') return '1';
  if (c === 'י') return '3';
  return ''; // ת (2nd person or 3rd fem. sing.) or an unrecognized prefix: no guess
}

function morphOf(ud) {
  const out = {};
  // Never surface a "punct"/other bogus tag on a token that is actually Hebrew letters.
  if (HEB.test(ud.surface) && (ud.pos === 'PUNCT' || ud.pos === 'X' || ud.pos === 'SYM')) return out;
  out.pos = POS_LABEL[ud.pos] || (ud.pos ? ud.pos.toLowerCase() : '');
  let isFutureVerb = false;
  if (ud.pos === 'VERB' || ud.pos === 'AUX') {
    out.binyan = BINYAN_LABEL[feat(ud.feats, 'HebBinyan')] || '';
    out.form = verbForm(ud.feats);
    isFutureVerb = out.form === 'future';
  }
  const g = feat(ud.feats, 'Gender'), n = feat(ud.feats, 'Number');
  // Only future-tense verbs get the prefix-derived override; every other tense/POS keeps UDPipe's
  // own Person feature exactly as before (past tense measured reliable: 2/2 on the ground-truth
  // set; present and imperative don't mark person in Hebrew and UDPipe already reflects that).
  const p = isFutureVerb ? futurePersonFromPrefix(ud.surface) : feat(ud.feats, 'Person');
  const gnp = [];
  // Hebrew verbs do not inflect for gender in the 1st person — אֶקְנֶה and קָנִיתִי are the same
  // whoever says them. UDPipe emits Gender=Masc anyway, which the breakdown was surfacing as
  // "m. sing. 1st pers." and quietly teaching a distinction the language does not make.
  const genderless = p === '1' && (ud.pos === 'VERB' || ud.pos === 'AUX');
  if (g && g !== 'Fem,Masc' && !genderless) gnp.push(g === 'Fem' ? 'f.' : g === 'Masc' ? 'm.' : g.toLowerCase());
  if (n) gnp.push(n === 'Sing' ? 'sing.' : n === 'Plur' ? 'pl.' : n.toLowerCase());
  if (p && p.indexOf(',') === -1) gnp.push(p + (p === '1' ? 'st' : p === '2' ? 'nd' : 'rd') + ' pers.');
  out.gnp = gnp.join(' ');
  return out;
}

async function dicta(text, signal, prefer) {
  const payload = { task: 'nakdan', data: text, genre: 'modern', addmorph: true,
    keepqq: false, nodageshdefault: false, patachma: false, keepmetagim: true };
  const body = JSON.stringify(payload);
  // Browser-like headers: Dicta's LB 503's the Worker's default egress fingerprint but serves the
  // same request from a browser, so present as one (real UA + Origin/Referer of the Dicta web app).
  const dictaHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Origin': 'https://nakdan.dicta.org.il',
    'Referer': 'https://nakdan.dicta.org.il/',
  };
  let toks = null, lastStatus = 0;
  for (const url of NAKDAN_HOSTS) {
    let r;
    try { r = await fetch(url, { method: 'POST', headers: dictaHeaders, body, signal }); }
    catch (e) { lastStatus = 'net'; continue; }          // network error / abort → try next node
    if (!r.ok) { lastStatus = r.status; continue; }        // 5xx on this node → try next
    toks = await r.json();
    break;
  }
  if (toks === null) throw new Error('nakdan ' + lastStatus);
  const out = [];
  for (const t of (Array.isArray(toks) ? toks : [])) {
    if (t && t.sep) { out.push({ sep: true, word: t.word || '' }); continue; }
    const opts = t && Array.isArray(t.options) ? t.options : null;
    const opt = opts && opts[pickOption(opts, prefer)];
    // Dicta marks prefix boundaries with '|' (לְ|בֵית); drop it for a clean vocalized form.
    const voc = (((opt && opt[0]) || (t && t.word) || '')).replace(/\|/g, '');
    const a0 = opt && Array.isArray(opt[1]) && opt[1][0];
    const lemma = (a0 && a0[1]) || '';
    const dbinyan = decodeBinyan(a0 && a0[0]);
    out.push({ sep: false, word: (t && t.word) || '', voc, lemma, dbinyan, dgn: decodeGN(a0 && a0[0]) });
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

async function analyze(text, prefer) {
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
    dicta(bare, dCtrl.signal, prefer).finally(() => clearTimeout(dT)),
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
  // Skipped when a gender was requested: the caller's own niqqud would overwrite the very reading
  // the request just selected. Asking for a form and supplying a pointing are contradictory
  // instructions, and the explicit request is the one that wins.
  if (HEB.test(text) && text !== bare && !(prefer && prefer.g)) {
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
    // UDPipe reads the BARE sentence, so on a word carrying a requested gender it goes on reporting
    // the default reading: the breakdown of a feminine variant showed רוֹצָה labelled "m. sing." —
    // the label contradicting the word above it.
    //
    // The label is taken from Dicta only when the reading on screen actually carries the gender that
    // was asked for. That covers both the word we re-pointed ourselves and the word Dicta already
    // had right from context (in את רוצה קפה the pronoun settles רוֹצָה, so nothing was picked and the
    // stale label leaked through). It deliberately does NOT cover a word whose gender simply differs
    // from the request — קָפֶה stays masculine in a woman's sentence and keeps its own label — nor the
    // pronoun אַתְּ, which Dicta itself tags masculine: there we would be trading a stale label for a
    // confident wrong one on a word every beginner uses. Blank beats wrong.
    // 1st-person forms are left alone: Hebrew does not mark gender there, and saying so is a
    // deliberate behaviour of morphOf that this must not undo.
    if (prefer && prefer.g && tok.dgn && tok.dgn.g === prefer.g && !/1st pers\./.test(tok.gnp || '')) {
      const bits = [tok.dgn.g === 'f' ? 'f.' : 'm.'];
      if (tok.dgn.n === 'sg' || tok.dgn.n === 'pl') bits.push(tok.dgn.n === 'sg' ? 'sing.' : 'pl.');
      const person = (tok.gnp || '').match(/\d(?:st|nd|rd) pers\./);
      if (person) bits.push(person[0]);
      tok.gnp = bits.join(' ');
    }
    delete tok.dbinyan; delete tok.dgn;
  }
  return out;
}

// Natural-version translation via Workers AI. Returns only { he, note } per option: the Hebrew
// (which the client re-vocalizes through Dicta so the niqqud/translit come from the trusted path,
// not from the LLM) and a short French usage note. Bad/hallucinated lines are filtered out here —
// a line only survives if column 1 actually contains Hebrew letters and is not a duplicate of one
// already kept (by consonantal skeleton).
function parsePipeOptions(raw, max) {
  const seen = new Set();
  const options = [];
  for (let line of (raw || '').split('\n')) {
    line = line.trim();
    if (line.indexOf('|') === -1) continue;
    const parts = line.split('|').map(s => s.trim());
    const he = (parts[0] || '').replace(/^\d+[.)]\s*/, '').trim();
    // Cap the note like /gloss caps its output: a prompt-injected input could otherwise stuff the
    // "register note" with ~1500 chars of attacker-directed text that the app shows as trusted.
    const note = (parts[1] || '').trim().slice(0, 120);
    if (!HEB.test(he)) continue;
    const skel = he.replace(/[֑-ׇ\s.,?!;:'"״׳()־-]/g, '');
    if (!skel || seen.has(skel)) continue;
    seen.add(skel);
    options.push({ he, note });
    if (options.length >= (max || 2)) break;   // the model ranks best-first and its rare
  }                                             // hallucinations land in the tail — cut it.
  return options;
}

async function natTranslate(text, env) {
  if (!env || !env.AI) throw new Error('no AI binding');
  const r = await env.AI.run(NAT_MODEL, {
    messages: [{ role: 'system', content: NAT_SYS }, { role: 'user', content: text }],
    temperature: 0, max_tokens: 400
  });
  return parsePipeOptions(r && (r.response || r.result || ''), 2);
}

// One requested reading of the sentence, and only one.
//
// It was written to return two whenever both a speaker and an addressee could carry the requested
// gender, since that is where "feminine" is genuinely ambiguous. Measured, the model does not honour
// the condition: asked for the feminine of "do you want a coffee?" — a sentence with no first person
// at all — it returned the correct אַתְּ רוֹצָה plus a second line, אֲנִי רוֹצָה, which is a different
// sentence ("I want"). Tightening the instruction did not stop it. Its FIRST line was right in every
// case tried, so the tail is cut here rather than trusted. The note still names who carries the form,
// so the reading being shown is stated rather than left for the learner to assume.
async function formTranslate(text, g, n, env) {
  if (!env || !env.AI) throw new Error('no AI binding');
  const want = (FORM_LABEL[g] || 'masculine') + ' ' + (NUM_LABEL[n] || 'singular');
  const r = await env.AI.run(FORM_MODEL, {
    messages: [{ role: 'system', content: FORM_SYS },
      { role: 'user', content: 'Sentence: ' + text + '\nRequested form: ' + want }],
    temperature: 0, max_tokens: 400
  });
  return parsePipeOptions(r && (r.response || r.result || ''), 1);
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

// Named exports for tools/form-test.mjs. The runtime only ever reads `default`, so exporting the
// pure decision functions costs nothing and means the test exercises the SHIPPED code rather than
// a copy of it that can drift away from it silently.
export { decodeGN, pickOption, parsePipeOptions };

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

    const path = new URL(request.url).pathname;
    const isAI = path === '/nat' || path === '/gloss' || path === '/form';

    // Reject oversized bodies before reading/parsing/joining them — an unbounded words[] on /gloss
    // could otherwise materialize past the isolate memory limit and kill the worker.
    const clen = +request.headers.get('Content-Length');
    if (clen > 10000) return json({ error: 'too large' }, 413, origin);

    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    // Per-IP rate limit. AI paths (Llama 70B) fail CLOSED if the limiter errors — an unmetered path
    // to a 70B model lets one IP drain the daily neuron allowance in under an hour. Cheap paths fail
    // open (availability over strictness). AI paths also get a second, much tighter budget.
    if (env && env.RL) {
      try { const { success } = await env.RL.limit({ key: ip }); if (!success) return json({ error: 'rate limited' }, 429, origin); }
      catch (e) { if (isAI) return json({ error: 'rate limited' }, 429, origin); }
    }
    if (isAI && env && env.RL_AI) {
      try { const { success } = await env.RL_AI.limit({ key: ip }); if (!success) return json({ error: 'rate limited' }, 429, origin); }
      catch (e) { return json({ error: 'rate limited' }, 429, origin); }
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
      /* v3, not v2: the prompt above used to ask for the register note in French, inside an
       * app whose every other string is English. Bumping the key is not tidiness — the responses
       * are cached for seven days, so leaving it at v2 would have kept serving the French notes
       * to everyone who had already asked, and the fix would have looked like it did nothing. */
      const nKey = new Request('https://nat.cache/v3/' + encodeURIComponent(nt));
      const nHit = await nCache.match(nKey);
      if (nHit) return new Response(await nHit.text(), { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
      let options;
      try { options = await natTranslate(nt, env); } catch (e) { return json({ error: 'ai unavailable' }, 502, origin); }
      const nPayload = JSON.stringify({ options });
      if (options.length && ctx && ctx.waitUntil) ctx.waitUntil(nCache.put(nKey, new Response(nPayload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL } })));
      return new Response(nPayload, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
    }

    // Gendered / numbered variant of the sentence. Cached 7 days on text + requested form, like
    // /nat: temperature 0 makes it deterministic and the neuron budget is finite.
    if (path === '/form') {
      let fb;
      try { fb = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }
      const fText = ((fb && fb.text) || '').toString().slice(0, 300);
      const fG = (fb && fb.gender) === 'f' ? 'f' : 'm';
      const fN = (fb && fb.number) === 'pl' ? 'pl' : 'sg';
      if (!fText.trim()) return json({ options: [] }, 200, origin);
      const fCache = caches.default;
      const fKey = new Request('https://form.cache/v3/' + fG + fN + '/' + encodeURIComponent(fText));
      const fHit = await fCache.match(fKey);
      if (fHit) return new Response(await fHit.text(), { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
      let fOpts;
      try { fOpts = await formTranslate(fText, fG, fN, env); } catch (e) { return json({ error: 'ai unavailable' }, 502, origin); }
      const fPayload = JSON.stringify({ options: fOpts });
      if (fOpts.length && ctx && ctx.waitUntil) ctx.waitUntil(fCache.put(fKey, new Response(fPayload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL } })));
      return new Response(fPayload, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
    }

    // In-context word glossing for the breakdown. Cached 7 days on sentence + word list, like
    // /nat: temperature 0 makes it deterministic and the neuron budget is finite.
    if (new URL(request.url).pathname === '/gloss') {
      let gb;
      try { gb = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }
      const gText = ((gb && gb.text) || '').toString().slice(0, 500);
      // Cap the array BEFORE mapping/joining/keying — glossInContext caps internally, but the pre-cap
      // map + join + encodeURIComponent on an unbounded array is itself the allocation risk.
      const gWords = Array.isArray(gb && gb.words) ? gb.words.slice(0, 24).map(w => String(w).slice(0, 40)) : [];
      if (!gText.trim() || !gWords.length) return json({ glosses: {} }, 200, origin);
      const gCache = caches.default;
      // JSON-encode the key so a literal '|' inside a word can't collide two distinct requests.
      const gKey = new Request('https://gloss.cache/v2/' + encodeURIComponent(JSON.stringify([gText, gWords])));
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
    // Requested reading, when the caller wants a specific gender/number rather than Dicta's first
    // guess. Absent = the previous behaviour exactly.
    const pg = body && body.prefer && body.prefer.g;
    const prefer = (pg === 'm' || pg === 'f')
      ? { g: pg, n: (body.prefer.n === 'sg' || body.prefer.n === 'pl') ? body.prefer.n : '' } : null;

    // Cache the computed payload (not the CORS-stamped Response) so the header stays per-origin.
    // The requested form is PART of the key: without it the masculine pointing already in cache
    // would be handed straight back to the request that just asked for the feminine one.
    const cache = caches.default;
    const pfx = prefer ? (prefer.g + (prefer.n || '') + '/') : '';
    const cacheKey = new Request('https://morph.cache/v11/' + pfx + encodeURIComponent(text));
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(await hit.text(), { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });

    const tokens = await analyze(text, prefer);
    if (tokens === null) return json({ error: 'upstream' }, 502, origin);
    const payload = JSON.stringify({ tokens });
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, new Response(payload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL } })));
    return new Response(payload, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
  }
};
