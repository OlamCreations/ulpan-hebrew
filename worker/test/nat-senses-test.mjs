/* nat-senses-test.mjs — /nat carries who speaks and who is addressed; /senses lists the meanings
 * of one word. Tested without Cloudflare and without network, like tr-route-test.mjs: the module
 * is imported with a fabricated env whose AI binding records what it was asked.
 *
 * Why these assertions exist (11.10.2026, Jonas's screenshots): « j'aime avoir un plan » came
 * back as a woman speaking, and « tu as des plans » came back twice (לָךְ then לְךָ) while the
 * page knew the addressee. The genders never reached the model. A cache keyed on the text alone
 * would have kept serving the ungendered answer for seven days after the fix.
 *
 * Usage : node test/nat-senses-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/index.js');
const code = fs.readFileSync(SRC, 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))).default;

const store = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      const hit = store.get(typeof req === 'string' ? req : req.url);
      return hit ? new Response(hit, { headers: { 'Content-Type': 'application/json' } }) : undefined;
    },
    async put(req, res) { store.set(typeof req === 'string' ? req : req.url, await res.text()); },
  },
};
const ctx = { waitUntil: p => p };
const limiterStub = () => ({ idFromName: () => ({}), get: () => ({ fetch: async () => new Response('1') }) });
const calls = [];
function makeEnv(aiReply) {
  globalThis.fetch = async (url) => { throw new Error('appel réseau non prévu par ce test : ' + url); };
  return {
    GOOGLE_TRANSLATE_KEY: 'k',
    LIMITER: limiterStub(),
    AI: { run: async (model, args) => { calls.push({ model, args }); return { response: aiReply }; } },
  };
}
const post = (p, body) => new Request('https://w.example' + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ulpan-etzion.pages.dev' }, body: JSON.stringify(body),
});
const sys = () => calls.length ? calls[calls.length - 1].args.messages[0].content : '';

let pass = 0, fail = 0;
const results = [];
async function check(name, fn) {
  store.clear(); calls.length = 0;
  try {
    const problems = await fn();
    if (problems && problems.length) { fail++; results.push([name, problems]); } else { pass++; results.push([name, null]); }
  } catch (e) { fail++; results.push([name, ['exception : ' + e.message]]); }
}

const NAT_REPLY = 'אני אוהב להיות מוכן מראש | everyday\nאני אוהבת להיות מוכנה מראש | woman speaking';

await check('N1 /nat tells the model who speaks and who is addressed', async () => {
  const r = await worker.fetch(post('/nat', { text: "j'aime avoir un plan", lang: 'fr', speaker: 'm', to: 'f' }), makeEnv(NAT_REPLY), ctx);
  const j = await r.json();
  const s = sys();
  const p = [];
  if (r.status !== 200) p.push('status ' + r.status);
  if (!/SPEAKER \(first person\) is a man/.test(s)) p.push('speaker missing from the prompt');
  if (!/ADDRESSED \(second person\) is one woman/.test(s)) p.push('addressee missing from the prompt');
  if (!/written in French/.test(s)) p.push('note language missing from the prompt');
  if (!j.options || j.options.length !== 2) p.push('options: ' + JSON.stringify(j));
  return p;
});

await check('N2 unknown genders fall back to the masculine, never to an empty slot', async () => {
  await worker.fetch(post('/nat', { text: 'merci', speaker: 'x', to: 'zz' }), makeEnv(NAT_REPLY), ctx);
  const s = sys();
  const p = [];
  if (!/SPEAKER \(first person\) is not stated \(use masculine forms\)/.test(s)) p.push('speaker fallback: ' + s.slice(0, 80));
  if (!/ADDRESSED \(second person\) is not stated/.test(s)) p.push('addressee fallback');
  if (!/written in English/.test(s)) p.push('note language fallback');
  return p;
});

await check('N3 the cache separates the genders: a man and a woman asking the same text get two answers', async () => {
  const env = makeEnv(NAT_REPLY);
  await worker.fetch(post('/nat', { text: 'je suis fatigué', speaker: 'm' }), env, ctx);
  await worker.fetch(post('/nat', { text: 'je suis fatigué', speaker: 'f' }), env, ctx);
  await worker.fetch(post('/nat', { text: 'je suis fatigué', speaker: 'f' }), env, ctx);
  const p = [];
  if (calls.length !== 2) p.push('model called ' + calls.length + ' times, expected 2 (m, f, f-cached)');
  if (![...store.keys()].every(k => k.startsWith('https://nat.cache/v5/'))) p.push('cache key not v5: ' + [...store.keys()].join(' '));
  return p;
});

await check('S1 /senses lists the distinct meanings of one word, most common first, capped', async () => {
  const reply = 'כוס | verre à boire\nמשקפיים | lunettes\nזכוכית | matière verre\nכוסית | petit verre\nחמישי | de trop';
  const r = await worker.fetch(post('/senses', { word: 'verre', lang: 'fr' }), makeEnv(reply), ctx);
  const j = await r.json();
  const p = [];
  if (r.status !== 200) p.push('status ' + r.status);
  if (!j.senses || j.senses.length !== 4) p.push('senses: ' + JSON.stringify(j));
  else {
    if (j.senses[0].he !== 'כוס' || j.senses[0].gloss !== 'verre à boire') p.push('first sense: ' + JSON.stringify(j.senses[0]));
    if (j.senses[1].he !== 'משקפיים') p.push('second sense: ' + JSON.stringify(j.senses[1]));
  }
  if (!/French-Hebrew dictionary/.test(sys())) p.push('prompt not in the learner language');
  return p;
});

await check('S2 /senses refuses a sentence, Hebrew, and an empty word without paying the model', async () => {
  const env = makeEnv('כוס | verre');
  const p = [];
  for (const body of [{ word: 'un verre de vin' }, { word: 'כוס' }, { word: '   ' }, {}]) {
    const r = await worker.fetch(post('/senses', body), env, ctx);
    const j = await r.json();
    if (r.status !== 200 || !j.senses || j.senses.length) p.push('body ' + JSON.stringify(body) + ' -> ' + r.status + ' ' + JSON.stringify(j));
  }
  if (calls.length) p.push('model called ' + calls.length + ' times');
  return p;
});

await check('S3 the second ask of a word comes from the cache', async () => {
  const env = makeEnv('כוס | verre à boire');
  await worker.fetch(post('/senses', { word: 'Verre', lang: 'fr' }), env, ctx);
  await worker.fetch(post('/senses', { word: 'verre', lang: 'fr' }), env, ctx);
  return calls.length === 1 ? [] : ['model called ' + calls.length + ' times'];
});

await check('S4 a model that answers with no Hebrew gives an empty list, not an error', async () => {
  const r = await worker.fetch(post('/senses', { word: 'xyzzy', lang: 'en' }), makeEnv('I do not know this word.'), ctx);
  const j = await r.json();
  return r.status === 200 && j.senses && j.senses.length === 0 ? [] : ['got ' + r.status + ' ' + JSON.stringify(j)];
});

console.log('\n' + '-'.repeat(66));
for (const [name, problems] of results) {
  console.log((problems ? 'FAIL   ' : 'ok     ') + name);
  if (problems) for (const x of problems) console.log('         - ' + x);
}
console.log(`${pass}/${pass + fail} assertions`);
process.exit(fail ? 1 : 0);
