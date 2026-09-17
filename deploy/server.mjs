/**
 * Production HTTP server for a single-VPS deployment.  (added for sikhon.systems)
 *
 * The product was built for serverless (Vercel/Netlify), where the platform
 * routes each request to a bundled function and serves apps/pwa/public itself.
 * On a plain VPS there is no platform, so this file is the one piece of glue
 * that reproduces both: it serves the three static surfaces and routes
 * /api/v1/<svc>/** to the same service dispatcher the edge would have called.
 *
 * ── Why this is the SAME code path that was tested ──────────────────────
 * It is a hardened promotion of `.claude/static-server.mjs`, which mounted the
 * real TypeScript dispatchers and was the workhorse behind every R-7/R-8
 * browser acceptance and the 29/29 security probe. The routing here is
 * byte-for-byte the same decision (service = the third path segment), so what
 * ran green locally is what runs in production — nothing is re-approximated.
 *
 * ── Behind Caddy ────────────────────────────────────────────────────────
 * Caddy terminates TLS for sikhon.systems and reverse-proxies to HOST:PORT
 * here. Caddy sets X-Forwarded-For, and server-core's clientIp() reads it, so
 * per-IP rate limiting sees the real client rather than the proxy. This server
 * therefore binds to a private interface and never speaks TLS itself.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(REPO_ROOT, 'apps', 'pwa', 'public');

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4100);

/* ── The API, mounted once at boot ──────────────────────────────────────────
 * Same mapping as the static preview: the URL's service segment picks the
 * dispatcher, and the dispatcher parses its own sub-route from req.url exactly
 * as it does on the edge. Core services must load; the two optional ones (ai,
 * ans — both feature-flagged off for a pilot) may fail to import without
 * taking the site down, so they are tried and skipped on error.
 */
const CORE = {
  platform:  'services/platform-svc/api/index.ts',
  academics: 'services/academics-svc/api/index.ts',
  ops:       'services/ops-svc/api/index.ts',
  auth:      'services/identity-svc/api/index.ts',   // 'auth' segment → identity-svc
  sync:      'services/sync-svc/api/index.ts',
  rms:       'services/rms-svc/api/index.ts',
  finance:   'services/finance-svc/api/index.ts',
  sms:       'services/sms-svc/api/index.ts',
};
const OPTIONAL = {
  ai:  'services/ai-svc/api/index.ts',
  ans: 'services/ans-svc/api/index.ts',
};

const handlers = {};
async function mount(map, required) {
  for (const [seg, rel] of Object.entries(map)) {
    try {
      handlers[seg] = (await import(new URL('../' + rel, import.meta.url))).default;
    } catch (err) {
      if (required) throw new Error(`failed to mount required service '${seg}': ${err.message}`);
      console.warn(`[server] optional service '${seg}' not mounted: ${err.message}`);
    }
  }
}
await mount(CORE, true);
await mount(OPTIONAL, false);
console.log(`[server] mounted: ${Object.keys(handlers).sort().join(', ')}`);

/* ── Static serving ─────────────────────────────────────────────────────── */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * app.js / platform.js / sw.js are rebuilt IN PLACE on every deploy (no
 * content hash in the name), so they must never be cached hard or a redeploy
 * would not reach a returning device. The service worker especially: a cached
 * sw.js is a stuck app. Images/fonts/css are safe to cache for an hour.
 */
function cacheFor(ext, path) {
  if (path === '/sw.js') return 'no-cache';
  if (ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.webmanifest') return 'no-cache';
  if (ext === '.png' || ext === '.webp' || ext === '.svg' || ext === '.ico'
      || ext === '.css' || ext === '.woff2' || ext === '.woff') return 'public, max-age=3600';
  return 'no-cache';
}

/**
 * Security headers for everything this server returns.  (P13)
 *
 * `netlify.toml` has set these for `/*` since P-ops, but production is not
 * Netlify — it is Caddy in front of this file, and this file set only
 * `X-Content-Type-Options`. The P13 audit read the live headers back off
 * `https://sikhon.systems` and found exactly that one, so the other three were
 * being set on a host the product is not served from.
 *
 * ── Why HSTS without `includeSubDomains`, for now ───────────────────────
 * The subdomain model needs `*.sikhon.systems` to be HTTPS, so
 * `includeSubDomains` is where this ends up. It is not set YET because the
 * wildcard certificate does not exist yet: a browser that has seen the
 * directive refuses a subdomain served without TLS, and it remembers for a
 * year. Add it in the same change that turns `WILDCARD_DNS_READY` on, once a
 * subdomain has actually been served over HTTPS — not before.
 *
 * ── Why no Content-Security-Policy here ─────────────────────────────────
 * A CSP is the one header on this list that can break a working application,
 * and it cannot be written responsibly from the outside: it has to be derived
 * from what the app actually loads and then verified in a browser. Adding a
 * guessed policy to a live deployment would be the opposite of what this
 * phase is for. Tracked as P13-11 rather than shipped blind.
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
};

const server = createServer(async (req, res) => {
  // Applied to every response including the API's, so a handler cannot forget
  // them. `setHeader` before `writeHead` merges rather than replaces, so an
  // endpoint that deliberately sets its own (document.ts uses SAMEORIGIN so a
  // school can preview a printable in a frame) still wins.
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://internal').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad request');
    return;
  }

  /* ── API ── the third segment names the service ── */
  if (path.startsWith('/api/')) {
    const svc = path.split('/')[3] ?? '';
    const h = handlers[svc];
    if (!h) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_such_service', service: svc }));
      return;
    }
    try {
      await h(req, res);
    } catch (err) {
      console.error(`[server] ${svc} threw:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      } else {
        res.end();
      }
    }
    return;
  }

  /* ── The three surfaces (R-1-A), exactly as vercel.json rewrites them ── */
  if (path === '/') path = '/index.html';
  else if (path === '/app' || path.startsWith('/app/')) path = '/app.html';
  else if (path === '/demo') path = '/app.html';
  else if (path === '/platform' || path.startsWith('/platform/')) path = '/platform.html';
  else if (path === '/design') path = '/design.html';
  else if (path === '/offline') path = '/offline.html';

  // Contain traversal: normalise, strip any leading ../, and confirm the
  // resolved path stays inside PUBLIC.
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const full = join(PUBLIC, rel);
  if (!full.startsWith(PUBLIC)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
    return;
  }

  try {
    const info = await stat(full);
    if (info.isDirectory()) throw new Error('is a directory');
    const body = await readFile(full);
    const ext = extname(full);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': cacheFor(ext, path),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    // Unknown non-API path: fall back to the marketing shell so a deep link
    // (or a stray segment) lands somewhere real rather than on a bare 404.
    try {
      const body = await readFile(join(PUBLIC, 'index.html'));
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[server] shikhon web on http://${HOST}:${PORT}  (public: ${PUBLIC})`);
});

// A clean stop on SIGTERM so systemd restarts/redeploys don't drop in-flight
// requests mid-write.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
