// Dicta relay — Deno Deploy.
//
// Why this exists: Dicta's load-balancer returns HTTP 503 to Cloudflare's shared Worker egress IPs
// while serving the identical request 200 to browsers/curl (an anti-datacenter-scraping block on the
// Cloudflare range). Our niqqud/morphology Worker (worker/src/index.js) therefore can't reach Dicta.
// Deno Deploy runs on GCP-range IPs — outside Cloudflare's range — so this tiny relay forwards the
// Worker's exact Dicta payload from a non-blocked IP and returns Dicta's JSON array UNCHANGED, so the
// Worker's option-parsing / decodeBinyan need zero edits.
//
// Deploy (needs a free Deno Deploy account):
//   1. Set SECRET below to a long random string (e.g. `crypto.randomUUID()` output).
//   2. Deploy this file (Deno Deploy playground, or `deployctl deploy`, or link a GitHub repo).
//   3. Point the Worker at it: in worker/src/index.js set
//        NAKDAN_HOSTS = ['https://YOUR-APP.deno.dev/<SECRET>']
//      then `cd worker && npx wrangler deploy`.
//
// Deploy-test (proves the GCP IP isn't also blocked — the one empirical unknown):
//   curl -X POST https://YOUR-APP.deno.dev/<SECRET> -H 'content-type: application/json' \
//     -d '{"task":"nakdan","data":"שלום המורה לחם","genre":"modern","addmorph":true,"keepqq":false,"nodageshdefault":false,"patachma":false,"keepmetagim":true}'
//   → expect a JSON array of vocalized tokens. If it 503s too, Dicta blocks datacenters broadly →
//     fall back to self-hosting dicta-il/dictabert-large-char-menaked on a free HF Space.

const SECRET = "REPLACE_WITH_LONG_RANDOM";   // shared secret path segment — stops open-proxy abuse

// Try each Dicta node so one flaky node doesn't take the breakdown down.
const NODES = [
  "https://nakdan-u1-0.loadbalancer.dicta.org.il/api",
  "https://nakdan-2-0.loadbalancer.dicta.org.il/api",
];

// Present as a browser (real UA + the Dicta web app's Origin/Referer) — harmless, and covers the case
// where Dicta also filters on those.
const DICTA_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Origin": "https://nakdan.dicta.org.il",
  "Referer": "https://nakdan.dicta.org.il/",
};

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== `/${SECRET}`) {
    return new Response("nope", { status: 403 });
  }
  const body = await req.text();
  if (body.length > 10_000) return new Response(JSON.stringify({ error: "too large" }), { status: 413 });

  let last: number | string = 502;
  for (const node of NODES) {
    try {
      const r = await fetch(node, { method: "POST", headers: DICTA_HEADERS, body });
      if (!r.ok) { last = r.status; continue; }
      return new Response(r.body, {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    } catch {
      last = 502;
    }
  }
  return new Response(JSON.stringify({ error: `dicta ${last}` }), { status: 502 });
});
