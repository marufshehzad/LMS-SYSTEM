/**
 * The VPS deployment must not be weaker than the Netlify one.  (P13)
 *
 * `netlify.toml` has set security headers for `/*` since P-ops. Production is
 * not Netlify — it is Caddy in front of `deploy/server.mjs`, and that file set
 * only `X-Content-Type-Options`. The P13 audit read the headers back off the
 * live `https://sikhon.systems` and got exactly one of them, which is how a
 * protection can be "configured" for two years and never once be served.
 *
 * Two deployment paths mean two chances to forget. This test makes the weaker
 * one fail the build rather than the audit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// fileURLToPath, not URL.pathname: this repo's path contains spaces.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const server = readFileSync(join(ROOT, 'deploy', 'server.mjs'), 'utf8');
const netlify = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');

describe('P13 — production security headers', () => {
  test('THE ONE THAT MATTERS — the VPS server sets every header Netlify does', () => {
    // Whatever netlify.toml protects for `/*`, the VPS path must protect too.
    const netlifyGlobal = netlify.split('for = "/*"')[1] ?? '';
    const wanted = [...netlifyGlobal.matchAll(/^\s*([A-Za-z-]+)\s*=/gm)]
      .map((m) => m[1])
      .filter((h) => /^(X-|Referrer|Strict|Content-Security)/i.test(h));

    assert.ok(wanted.length >= 3, `expected netlify.toml to set several headers, found ${wanted.length}`);

    const missing = wanted.filter((h) => !new RegExp(`['"]${h}['"]`, 'i').test(server));
    assert.deepEqual(missing, [],
      `deploy/server.mjs is weaker than netlify.toml — missing: ${missing.join(', ')}`);
  });

  test('HSTS is set, because production is HTTPS behind Caddy', () => {
    assert.match(server, /Strict-Transport-Security/,
      'the VPS serves over TLS; HSTS belongs there');
    assert.match(server, /max-age=\d{6,}/, 'HSTS max-age should be substantial');
  });

  test('HSTS does NOT claim subdomains until the wildcard certificate exists', () => {
    // Deliberate, and the order matters: a browser that has seen
    // `includeSubDomains` refuses a subdomain served without TLS, and
    // remembers for a year. It goes in with WILDCARD_DNS_READY, not before.
    //
    // Checked against the header VALUE, not the file: this repo has already
    // shipped a CI guard that failed on its own explanatory comment, and the
    // comment above says `includeSubDomains` three lines up.
    const value = /['"]Strict-Transport-Security['"]\s*:\s*['"]([^'"]+)['"]/.exec(server)?.[1];
    assert.ok(value, 'Strict-Transport-Security must be set as a header value');
    assert.doesNotMatch(value, /includeSubDomains/,
      'includeSubDomains must wait for the wildcard certificate (P13-3)');
  });

  test('the guard can fail — a missing header is detected', () => {
    // Negative control: the same comparison against a server that sets none.
    const bare = 'const server = createServer(() => {});';
    const missing = ['X-Frame-Options', 'Referrer-Policy']
      .filter((h) => !new RegExp(`['"]${h}['"]`, 'i').test(bare));
    assert.deepEqual(missing, ['X-Frame-Options', 'Referrer-Policy']);
  });
});
