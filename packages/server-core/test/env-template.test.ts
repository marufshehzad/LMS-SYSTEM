/**
 * The production env template must document what a running service reads.
 * (P13)
 *
 * An operator provisions production from `deploy/env.example`. A variable a
 * service reads and the template omits does not fail loudly — the deployment
 * starts and behaves however the fallback happens to behave. The P13 audit
 * found five of them, and the most consequential was `SMS_WORKER_TENANT_IDS`:
 * empty means the worker drains no school's queue at all, which from the
 * outside is indistinguishable from a broken aggregator.
 *
 * Scope is deliberately narrow — `services/` and `packages/`, the code that
 * runs in production. `scripts/` is excluded: those are developer tools with
 * their own arguments (PROBE_*, DRILL_*, PG_*), and demanding they appear in a
 * server's environment file would be noise that trains people to ignore this
 * test.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// fileURLToPath, not URL.pathname: this repo's path contains spaces.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'functions']);

/** Variables the platform or Node provides — nobody sets these by hand. */
const AMBIENT = new Set([
  'NODE_ENV', 'CI', 'PATH', 'HOME', 'PWD', 'TZ', 'NODE_OPTIONS',
  'CONTEXT', 'VERCEL_ENV', 'NETLIFY', 'AWS_REGION',
  // Set per-invocation by the test harness, never by a deployment.
  'DATABASE_URL_TEST', 'PG_CONTAINER',
]);

function envNamesIn(dir: string, out: Map<string, string[]>): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { envNamesIn(p, out); continue; }
    if (!/\.(ts|mjs|js)$/.test(name) || /\.test\.(ts|mjs|js)$/.test(name)) continue;
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) {
      const rel = p.slice(ROOT.length + 1).replace(/\\/g, '/');
      if (!out.has(m[1])) out.set(m[1], []);
      if (!out.get(m[1])!.includes(rel)) out.get(m[1])!.push(rel);
    }
  }
}

describe('P13 — deploy/env.example', () => {
  test('THE ONE THAT MATTERS — every variable a service reads is documented', () => {
    const used = new Map<string, string[]>();
    envNamesIn(join(ROOT, 'services'), used);
    envNamesIn(join(ROOT, 'packages'), used);

    const tmpl = readFileSync(join(ROOT, 'deploy', 'env.example'), 'utf8');
    // Commented lines count: `# SMS_PROVIDER=` documents the variable and
    // says it is off, which is exactly what an operator needs to know.
    const documented = new Set(
      [...tmpl.matchAll(/^#?\s*([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]));

    const missing = [...used.keys()]
      .filter((k) => !documented.has(k) && !AMBIENT.has(k))
      .sort();

    assert.deepEqual(missing, [],
      'read by a service, absent from deploy/env.example:\n  '
      + missing.map((k) => `${k}  (${used.get(k)!.slice(0, 2).join(', ')})`).join('\n  '));
  });

  test('the guard can fail — an undocumented name is detected', () => {
    // Negative control. Without it this passes just as happily against a
    // regex that stopped matching anything.
    const tmpl = 'DATABASE_URL=\n# SMS_PROVIDER=\n';
    const documented = new Set(
      [...tmpl.matchAll(/^#?\s*([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]));
    assert.equal(documented.has('DATABASE_URL'), true);
    assert.equal(documented.has('SMS_PROVIDER'), true, 'a commented line still documents');
    assert.equal(documented.has('NOT_IN_TEMPLATE'), false);
  });

  test('the variables that gate production behaviour are present', () => {
    const tmpl = readFileSync(join(ROOT, 'deploy', 'env.example'), 'utf8');
    // Named individually because each one has burned somebody: the allowlist
    // is what stands between a pilot and texting nine hundred guardians, and
    // the worker list empty means nothing sends at all.
    for (const key of ['SMS_TEST_RECIPIENTS', 'SMS_WORKER_TENANT_IDS',
      'WILDCARD_DNS_READY', 'VAPID_PUBLIC_KEY', 'JWT_PRIVATE_KEY', 'PLATFORM_API_KEY']) {
      assert.match(tmpl, new RegExp(`^#?\\s*${key}=`, 'm'), `${key} must be documented`);
    }
  });
});
