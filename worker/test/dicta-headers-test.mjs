/* dicta-headers-test.mjs — what the Worker sends to Dicta Nakdan, tested without the network.
 *
 * Two properties:
 *   1. The Worker does not borrow anyone's identity: no browser User-Agent, no Origin or Referer
 *      of the Dicta web app. It sends its JSON with a Content-Type and nothing pretending otherwise.
 *   2. The fallback between the Nakdan nodes still works: a 503 from the first node sends the same
 *      request to the next one, and a 503 from every node ends in a 502 {error:'upstream'}.
 *
 * Same method as tr-route-test.mjs: the module is imported from its source, every upstream is a
 * stub. --src <file> tests another copy of the Worker (used to show the test fails on the old one).
 *
 * Usage: node test/dicta-headers-test.mjs [--src path/to/index.js]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argOf = (n) => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const SRC = argOf('--src') || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/index.js');
const code = fs.readFileSync(SRC, 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))).default;

const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { const h = store.get(typeof req === 'string' ? req : req.url); return h ? new Response(h) : undefined; },
    async put(req, res) { store.set(typeof req === 'string' ? req : req.url, await res.text()); },
  },
};
const ctx = { waitUntil: (p) => p };
const env = { LIMITER: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response('1') }) } };

let calls = [];
function stubFetch(nakdanStatuses) {
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('dicta.org.il')) {
      calls.push({ url: u, headers: Object.fromEntries(new Headers(init.headers || {}).entries()) });
      const status = nakdanStatuses[n++] ?? 503;
      return status === 200
        ? new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response('busy', { status });
    }
    if (u.includes('udpipe')) return new Response(JSON.stringify({ result: '' }), { status: 200 });
    throw new Error('unexpected network call in this test: ' + u);
  };
}
const post = (text) => new Request('https://w.example/', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8912' },
  body: JSON.stringify({ text }),
});

let fail = 0;
const report = (name, problems) => {
  if (problems.length) fail++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.length ? '\n       ' + problems.join('\n       ') : ''}`);
};

// T1: first node 503, second 200 -> answered, and no borrowed identity on either call.
store.clear(); calls = []; stubFetch([503, 200]);
{
  const r = await worker.fetch(post('test one'), env, ctx);
  const p = [];
  if (r.status !== 200) p.push('status ' + r.status + ', expected 200 after the fallback');
  if (calls.length !== 2) p.push(calls.length + ' Nakdan calls, expected 2 (503 then the next node)');
  else if (calls[0].url === calls[1].url) p.push('the retry went to the same node');
  for (const c of calls) {
    for (const h of ['user-agent', 'origin', 'referer']) if (h in c.headers) p.push(`${h} sent to ${c.url}: ${c.headers[h]}`);
    if (!(c.headers['content-type'] || '').includes('application/json')) p.push('no JSON content-type to ' + c.url);
  }
  report('T1 503 then 200: fallback to the next node, no User-Agent/Origin/Referer', p);
}

// T2: every node 503 -> 502 upstream, after trying each node once.
store.clear(); calls = []; stubFetch([503, 503, 503]);
{
  const r = await worker.fetch(post('test two'), env, ctx);
  const p = [];
  if (r.status !== 502) p.push('status ' + r.status + ', expected 502');
  const body = await r.json().catch(() => ({}));
  if (body.error !== 'upstream') p.push('body ' + JSON.stringify(body));
  if (calls.length < 2 || new Set(calls.map((c) => c.url)).size !== calls.length) p.push(`${calls.length} calls, expected each node once`);
  report('T2 every node 503: 502 {error:"upstream"}, each node tried once', p);
}

console.log(fail ? `${fail} of 2 failed` : '2/2 assertions');
process.exit(fail ? 1 : 0);
