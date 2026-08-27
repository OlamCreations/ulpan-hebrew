/* tr-route-test.mjs — la route /tr, testée sans Cloudflare et sans réseau.
 *
 * Pourquoi pas `wrangler dev` : il exige un compte pour la liaison AI, et le premier test à
 * écrire est justement celui du chemin où l'upstream répond mal. On importe donc le module et
 * on lui donne un `env` fabriqué : chaque upstream est un bouchon dont on choisit la réponse,
 * ce qui permet de tester les cas qu'on ne peut pas provoquer à la demande sur le vrai service
 * (429, réponse sans hébreu, corps HTML).
 *
 * L'invariant central, celui qu'aucun des deux upstreams ne vérifiait avant aujourd'hui :
 * UNE TRADUCTION VERS L'HÉBREU QUI NE CONTIENT AUCUNE LETTRE HÉBRAÏQUE N'EST PAS UNE TRADUCTION.
 * Les deux échouent en douceur en renvoyant l'entrée, et la carte affichait alors le mot de
 * l'apprenant dans la case du résultat, avec l'apparence d'une réponse.
 *
 * Usage : node test/tr-route-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* --mutate-from / --mutate-to : casse le Worker EN MEMOIRE pour la matrice de cassures. Deux
   arguments separes, jamais un separateur unique : « => » est la fleche des fonctions
   JavaScript et couperait au mauvais endroit. Si le motif est absent, on ARRETE — une mutation
   qui ne s'applique pas rend un vert indiscernable de « l'assertion tient ». */
const argOf = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/index.js');
let code = fs.readFileSync(SRC, 'utf8');
const MF = argOf('--mutate-from');
if (MF) {
  if (!code.includes(MF)) { console.error('ARRET : motif de mutation absent : ' + JSON.stringify(MF)); process.exit(3); }
  code = code.replace(MF, argOf('--mutate-to') || '');
  console.log('[MUTATION] ' + JSON.stringify(MF));
}
const worker = (await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))).default;
console.log('WORKER CHARGE');

// ------------------------------------------------------------------ le faux environnement

/* `caches.default` n'existe pas dans Node. Un cache qui ne garde rien conviendrait pour la
   plupart des assertions, mais pas pour celle qui vérifie qu'une réponse EST mise en cache —
   on en fait donc un vrai petit magasin, et on peut l'inspecter. */
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

/* Le limiteur est un Durable Object ; ici on le rend toujours permissif, sauf quand un test
   demande explicitement un refus. Le limiteur a sa propre sonde (tools/limiter-check.mjs) : le
   mêler à celle-ci mesurerait deux choses à la fois et ne dirait laquelle a échoué. */
/* Le contrat est LU dans allow() (src/index.js), pas supposé : le Durable Object rend le TEXTE
   « 1 » pour autoriser, n'importe quoi d'autre pour refuser. Ma première version rendait du JSON
   {ok:true}, ce qui se lit comme un refus — et les dix assertions rendaient 429, ce qui avait
   l'air d'un limiteur trop strict dans le code testé. Un bouchon écrit d'après ce qu'on imagine
   de l'interface teste l'imagination. */
const limiterStub = (allow = true) => ({
  idFromName: () => ({}),
  get: () => ({ fetch: async () => new Response(allow ? '1' : '0') }),
});

let lastUpstream = null;
function makeEnv({ googleKey = null, googleReply = null, aiReply = null, allow = true } = {}) {
  globalThis.fetch = async (url, init) => {
    lastUpstream = String(url);
    if (String(url).includes('translation.googleapis.com')) {
      if (googleReply === 'http-error') return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({
        data: { translations: [{ translatedText: googleReply, detectedSourceLanguage: 'fr' }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('appel réseau non prévu par ce test : ' + url);
  };
  return {
    GOOGLE_TRANSLATE_KEY: googleKey,
    LIMITER: limiterStub(allow),
    AI: { run: async () => ({ response: aiReply }) },
  };
}

const post = (path, body, origin = 'https://ulpan-etzion.pages.dev') =>
  new Request('https://w.example' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });

// ------------------------------------------------------------------ assertions

let pass = 0, fail = 0;
const results = [];
async function check(name, fn) {
  store.clear(); lastUpstream = null;
  try {
    const problems = await fn();
    if (problems && problems.length) { fail++; results.push([name, problems]); }
    else { pass++; results.push([name, null]); }
  } catch (e) {
    fail++; results.push([name, ['exception : ' + e.message]]);
  }
}

// T1 — Google répond correctement : on rend son hébreu, et on dit quel moteur a répondu.
await check('T1 Google rend de l\'hébreu -> la carte l\'obtient', async () => {
  const r = await worker.fetch(post('/tr', { text: 'bonjour', to: 'he' }), makeEnv({ googleKey: 'k', googleReply: 'שלום' }), ctx);
  const j = await r.json();
  const p = [];
  if (r.status !== 200) p.push('statut ' + r.status);
  if (j.he !== 'שלום') p.push('he=' + JSON.stringify(j.he));
  if (j.engine !== 'google') p.push('engine=' + j.engine);
  return p;
});

// T2 — L'INVARIANT. Google échoue en douceur en renvoyant l'entrée : ce n'est pas une traduction.
await check('T2 une "traduction" sans hébreu est refusée, pas affichée', async () => {
  const r = await worker.fetch(post('/tr', { text: 'bonjour', to: 'he' }), makeEnv({ googleKey: 'k', googleReply: 'bonjour' }), ctx);
  const j = await r.json();
  return j.he === '' ? [] : [`a rendu ${JSON.stringify(j.he)} — le mot de l'apprenant recopié dans la case du résultat`];
});

// T3 — Le repli : sans clé, on passe par le modèle, et le même invariant s'applique.
await check('T3 sans clé, le modèle prend le relais', async () => {
  const r = await worker.fetch(post('/tr', { text: 'hello', to: 'he' }), makeEnv({ aiReply: 'שלום' }), ctx);
  const j = await r.json();
  const p = [];
  if (j.he !== 'שלום') p.push('he=' + JSON.stringify(j.he));
  if (j.engine !== 'workers-ai') p.push('engine=' + j.engine);
  return p;
});

// T4 — Le modèle bavarde malgré la consigne : on garde la première ligne, sans habillage.
await check('T4 le bavardage du modèle est retiré', async () => {
  const r = await worker.fetch(post('/tr', { text: 'hello', to: 'he' }),
    makeEnv({ aiReply: '"שלום"\nThis is the standard greeting in Hebrew.' }), ctx);
  const j = await r.json();
  return j.he === 'שלום' ? [] : [`a rendu ${JSON.stringify(j.he)}`];
});

// T5 — Le sens demandé en anglais ne peut pas être de l'hébreu (l'invariant, dans l'autre sens).
await check('T5 un sens demandé en anglais ne peut pas être hébreu', async () => {
  const r = await worker.fetch(post('/tr', { text: 'ספר', to: 'en', from: 'he' }), makeEnv({ googleKey: 'k', googleReply: 'ספר' }), ctx);
  const j = await r.json();
  return j.he === '' ? [] : [`a rendu ${JSON.stringify(j.he)}`];
});

// T6 — CORS : kita10 est autorisé, un site tiers ne l'est pas.
await check('T6 CORS autorise kita10 et refuse un tiers', async () => {
  const env = makeEnv({ googleKey: 'k', googleReply: 'שלום' });
  const ok = await worker.fetch(post('/tr', { text: 'x', to: 'he' }, 'https://ulpan-etzion.pages.dev'), env, ctx);
  const bad = await worker.fetch(post('/tr', { text: 'y', to: 'he' }, 'https://pirate.example'), env, ctx);
  const p = [];
  if (ok.headers.get('Access-Control-Allow-Origin') !== 'https://ulpan-etzion.pages.dev') {
    p.push('kita10 refusé : ' + ok.headers.get('Access-Control-Allow-Origin'));
  }
  if (bad.headers.get('Access-Control-Allow-Origin') === 'https://pirate.example') {
    p.push('un site tiers a été autorisé');
  }
  return p;
});

// T7 — Le cache : la deuxième requête identique ne touche plus l'upstream.
await check('T7 la deuxième requête identique ne rappelle pas l\'upstream', async () => {
  const env = makeEnv({ googleKey: 'k', googleReply: 'שלום' });
  await worker.fetch(post('/tr', { text: 'bonjour', to: 'he' }), env, ctx);
  lastUpstream = null;
  const r2 = await worker.fetch(post('/tr', { text: 'bonjour', to: 'he' }), env, ctx);
  const j = await r2.json();
  const p = [];
  if (j.he !== 'שלום') p.push('la réponse en cache est fausse : ' + JSON.stringify(j.he));
  if (lastUpstream) p.push('a rappelé ' + lastUpstream);
  return p;
});

// T8 — Un upstream en panne rend 502, pas une carte vide silencieuse.
await check('T8 un upstream en panne rend 502', async () => {
  const r = await worker.fetch(post('/tr', { text: 'bonjour', to: 'he' }), makeEnv({ googleKey: 'k', googleReply: 'http-error' }), ctx);
  return r.status === 502 ? [] : ['statut ' + r.status];
});

// T9 — Entrée vide : réponse vide, pas d'appel réseau, pas d'erreur.
await check('T9 une entrée vide ne coûte aucun appel', async () => {
  const r = await worker.fetch(post('/tr', { text: '   ', to: 'he' }), makeEnv({ googleKey: 'k', googleReply: 'שלום' }), ctx);
  const j = await r.json();
  const p = [];
  if (j.he !== '') p.push('he=' + JSON.stringify(j.he));
  if (lastUpstream) p.push('a appelé ' + lastUpstream);
  return p;
});

// T10 — Les entités HTML de l'API Google sont décodées (elle en rend même en format=text).
await check('T10 les entités HTML sont décodées', async () => {
  const r = await worker.fetch(post('/tr', { text: 'the hospital', to: 'fr', from: 'en' }),
    makeEnv({ googleKey: 'k', googleReply: 'l&#39;hôpital' }), ctx);
  const j = await r.json();
  return j.he === "l'hôpital" ? [] : [`a rendu ${JSON.stringify(j.he)}`];
});

// ------------------------------------------------------------------ contrôle négatif
const before = fail;
await check('[contrôle négatif] doit ÉCHOUER', async () => ['échec volontaire']);
const canFail = fail === before + 1;
fail = before;
results.pop();

for (const [name, problems] of results) {
  if (problems) { console.log(`ÉCHEC  ${name}`); for (const p of problems) console.log(`        - ${p}`); }
  else console.log(`ok     ${name}`);
}
console.log('\n' + '-'.repeat(66));
console.log(`${pass}/${pass + fail} assertions`);
console.log(`contrôle négatif : ${canFail ? 'la suite sait rougir' : 'LA SUITE NE PEUT PAS ÉCHOUER'}`);
process.exit(fail === 0 && canFail ? 0 : 1);
