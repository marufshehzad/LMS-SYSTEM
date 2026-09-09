/**
 * A dead session is not a network error.  (B-121)
 *
 * The observed failure: an expired access token whose refresh token had also
 * been rotated fell through `authedFetch` as a thrown `AuthError`, every view
 * caught it with its generic handler, and the person got "কিছু সমস্যা হয়েছে।
 * আবার চেষ্টা করুন।" above a retry that could never succeed — because the
 * credential, not the network, was finished.
 *
 * ── The dangerous half of the fix ───────────────────────────────────────
 * The obvious repair is "clear the session when refresh fails", and that is
 * a worse bug: a 500 during a bad minute would sign out every device that
 * happened to refresh, and each one would need a new OTP. So the tests that
 * matter most here are the NEGATIVE ones — a 500, a 503 and an offline
 * `fetch` that throws must all leave the session exactly where it was.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom: JSDOM;
let Auth: typeof import('../src/auth.ts').Auth;

const TENANT = '7c9b0000-0000-4000-8000-00000000bea0';
const USER = { id: 'u1', fullNameBn: 'প', fullNameEn: 'P', role: 'principal', roles: ['principal'] };

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://school.test/app' });
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.localStorage = dom.window.localStorage;
  g.Headers = dom.window.Headers ?? Headers;
  Auth = (await import('../src/auth.ts')).Auth;
});

beforeEach(() => { dom.window.localStorage.clear(); });

/** A session already past its access-token expiry, so any call refreshes. */
function seedExpiredAccessToken(): void {
  dom.window.localStorage.setItem('shikhon_auth', JSON.stringify({
    tenantId: TENANT,
    accessToken: 'stale-access-token',
    refreshToken: 'the-refresh-token',
    expiresAt: Date.now() - 60_000,
    user: USER,
  }));
}

interface Built {
  auth: InstanceType<typeof Auth>;
  ended: string[];
  calls: number;
}

/** An Auth whose refresh answers however the test says. */
function build(respond: () => Promise<Response> | Response): Built {
  seedExpiredAccessToken();
  const ended: string[] = [];
  let calls = 0;
  const g = globalThis as Record<string, unknown>;
  g.fetch = async (url: string) => {
    if (String(url).includes('/auth/refresh')) { calls++; return respond(); }
    return new Response('{}', { status: 200 });
  };
  const auth = new Auth({
    apiBase: '', deviceId: 'dev-1',
    onSessionEnded: (r: string) => { ended.push(r); },
  });
  const built: Built = { auth, ended, get calls() { return calls; } } as Built;
  return built;
}

const stored = (): unknown => {
  const raw = dom.window.localStorage.getItem('shikhon_auth');
  return raw ? JSON.parse(raw) : null;
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('B-121 — a refused credential ends the session', () => {
  test('THE ONE THAT MATTERS — a 401 ends it, clears storage, and says which ending', async () => {
    const b = build(() => json(401, { error: 'invalid_refresh_token' }));
    await assert.rejects(() => b.auth.authedFetch('/api/v1/ops/dashboard'));
    assert.deepEqual(b.ended, ['expired'], 'the shell was not told the session ended');
    assert.equal(stored(), null, 'the dead session is still in localStorage');
    assert.equal(b.auth.isLoggedIn(), false);
  });

  test('a rotated refresh token is the same ending', async () => {
    // Rotation makes the previous token invalid; the server answers 401 for
    // it exactly as it does for an expired one.
    const b = build(() => json(401, { error: 'invalid_refresh_token' }));
    await assert.rejects(() => b.auth.authedFetch('/api/v1/ops/dashboard'));
    assert.deepEqual(b.ended, ['expired']);
  });

  test('a device revoked from the নিরাপত্তা screen ends the session too', async () => {
    // B-120's revoke path, pinned to what the SERVER actually sends.
    //
    // `refresh.ts` looks the token up with `… AND revoked_at IS NULL AND
    // expires_at > now()`, so a revoked session misses the row exactly as a
    // dead or already-rotated one does: `401 invalid_refresh_token`. There
    // is no `session_revoked` response, and an earlier draft of this file
    // asserted one — a test passing against a reply the server cannot
    // produce, proving a branch nothing could reach.
    const b = build(() => json(401, { error: 'invalid_refresh_token' }));
    await assert.rejects(() => b.auth.authedFetch('/api/v1/ops/dashboard'));
    assert.deepEqual(b.ended, ['expired'], 'a revoked device must still end the session');
  });

  test('a deactivated account gets its own sentence, not a login prompt', async () => {
    // Telling somebody whose account was suspended to "log in again" sends
    // them round a loop the office has to break.
    const b = build(() => json(403, { error: 'account_not_active' }));
    await assert.rejects(() => b.auth.authedFetch('/api/v1/ops/dashboard'));
    assert.deepEqual(b.ended, ['account_inactive']);
  });

  test('no_active_role is the office\'s problem too, not a sign-in prompt', async () => {
    // The other 403 `refresh.ts` can throw. Mapping 403 to "this device was
    // revoked" — the obvious way to make a `revoked` reason reachable —
    // would tell somebody whose ROLE was removed that their phone had been
    // signed out, and send them to re-login instead of to the office.
    const b = build(() => json(403, { error: 'no_active_role' }));
    await assert.rejects(() => b.auth.authedFetch('/api/v1/ops/dashboard'));
    assert.deepEqual(b.ended, ['account_inactive']);
  });
});

describe('B-121 — a transient failure is NOT a logout', () => {
  test('THE ONE THAT MATTERS — a 500 leaves the session exactly where it was', async () => {
    // The dangerous half. Clearing on any non-2xx would sign out every
    // device that refreshed during a bad minute, each needing a new OTP.
    const b = build(() => json(500, { error: 'internal_error' }));
    const res = await b.auth.authedFetch('/api/v1/ops/dashboard');
    assert.equal(res.status, 200, 'the request should still have been attempted');
    assert.deepEqual(b.ended, [], 'a server error was treated as a logout');
    assert.notEqual(stored(), null, 'a server error cleared the session');
    assert.equal(b.auth.isLoggedIn(), true);
  });

  test('a 503 is the same — a deploy is not a sign-out', async () => {
    const b = build(() => json(503, { error: 'unavailable' }));
    await b.auth.authedFetch('/api/v1/ops/dashboard');
    assert.deepEqual(b.ended, []);
    assert.notEqual(stored(), null);
  });

  test('offline — a thrown fetch keeps the session and the stale token', async () => {
    const b = build(() => { throw new TypeError('Failed to fetch'); });
    const res = await b.auth.authedFetch('/api/v1/ops/dashboard');
    assert.equal(res.status, 200);
    assert.deepEqual(b.ended, [], 'being offline signed the teacher out');
    assert.notEqual(stored(), null);
  });

  test('a valid session refreshes and stays valid — no ending is announced', async () => {
    const b = build(() => json(200, {
      accessToken: 'fresh', refreshToken: 'rotated', expiresIn: 900,
    }));
    await b.auth.authedFetch('/api/v1/ops/dashboard');
    assert.deepEqual(b.ended, []);
    const s = stored() as { accessToken: string; refreshToken: string };
    assert.equal(s.accessToken, 'fresh', 'the rotated token was not stored');
    assert.equal(s.refreshToken, 'rotated');
    assert.equal(b.auth.isLoggedIn(), true);
  });
});
