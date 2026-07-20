#!/usr/bin/env node
/*
 * serve.mjs — local dev server that behaves like GitHub Pages.
 *
 * `python -m http.server` was close enough while the site was flat, but it answers its own
 * plain 404 body. Pages serves /404.html instead, which is exactly the mechanism the
 * legacy-URL shim depends on — so testing redirects locally needs a server that does the same.
 *
 *   node tools/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8899;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // normalize() collapses any ../ so a request cannot escape the repo root
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  try {
    const s = await stat(join(ROOT, rel)).catch(() => null);
    if (s && s.isDirectory()) rel = join(rel, 'index.html');
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    // The Pages behaviour that matters: unknown path -> 404.html, which runs the legacy shim.
    try {
      const body = await readFile(join(ROOT, '404.html'));
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT} (404 -> 404.html, like GitHub Pages)`));
