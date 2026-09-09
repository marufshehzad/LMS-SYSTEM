/**
 * Session and device management.  (B-120)
 *
 * The capability is small; what it touches is not. A revoke that only hides
 * a row on a screen is worse than nothing, because the person who used it
 * believes the stolen phone is out. So every assertion below ends at the
 * REFRESH endpoint: the question is never "did the list change", it is
 * "can that device still get a token".
 *
 * ── The race this is shaped around ──────────────────────────────────────
 * `refresh.ts` rotates — each refresh inserts a new `user_sessions` row and
 * revokes the old one. A signed-in phone is therefore a CHAIN whose live
 * head moves every few minutes, and revoking by row id would race that
 * chain: the id the screen listed is stale by the time the button is
 * pressed, the UPDATE matches nothing, and the phone keeps working while
 * the screen says it stopped. Revocation is by `device_id`, which is stable
 * across the chain, and the test below rotates first on purpose.
 *
 *   DATABASE_URL=postgres://… node --test services/identity-svc/test/sessions.test.ts
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createDb, type Db, type TenantContext } from '../../../packages/server-core/src/db.ts';
import {
  installTestKeys, call, lockFixtures, unlockFixtures, asBootstrap,
} from '../../../packages/server-core/test/harness.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL ? 'DATABASE_URL not set' : false;

const T_A   = '7b180000-0000-4000-8000-0000000000a0';
const T_B   = '7b180000-0000-4000-8000-0000000000b0';
const HEAD  = '7b180000-0000-4000-8000-0000000000a1';
const TEACH = '7b180000-0000-4000-8000-0000000000a2';
const HEAD_B= '7b180000-0000-4000-8000-0000000000b1';

const PHONE_DESK = 'desk-device';
const PHONE_MOB  = 'mobile-device';
const PHONE_LOST = 'lost-device';

let db: Db;
let sessions: typeof import('../api/sessions.ts').default;
let refresh: typeof import('../api/refresh.ts').default;
let tokens: Record<string, string> = {};

const ctxA: TenantContext = { tenantId: T_A, userId: HEAD, role: 'principal' };
const ctxB: TenantContext = { tenantId: T_B, userId: HEAD_B, role: 'principal' };

async function drop(): Promise<void> {
  for (const ctx of [ctxA, ctxB]) {
    await asBootstrap(db, ctx, async (c) => {
      await c.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
    });
  }
}

const phoneFor = (id: string): string =>
  `+88017${String(parseInt(id.slice(-4), 16) % 100000000).padStart(8, '0')}`;

/**
 * Put a live session in the table and hand back its refresh token.
 *
 * Written directly rather than through OTP, because the login path needs a
 * real code and an SMS provider, and what is under test here is what happens
 * to a session AFTER it exists.
 */
async function makeSession(
  tenantId: string, userId: string, deviceId: string, label: string,
): Promise<string> {
  const token = `refresh-${deviceId}-${Math.random().toString(36).slice(2)}`;
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(token).digest();
  await asBootstrap(db, { tenantId, userId, role: 'principal' }, async (c) => {
    await c.query(
      `INSERT INTO user_sessions (tenant_id, user_id, refresh_token_hash, device_id,
                                  device_label, user_agent, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + interval '30 days')`,
      [tenantId, userId, hash, deviceId, label,
       'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36']);
  });
  return token;
}

const liveDevices = async (userId: string, tenantId: string): Promise<string[]> => {
  const { rows } = await asBootstrap(db, { tenantId, userId, role: 'principal' },
    async (c) => c.query<{ device_id: string }>(
      `SELECT DISTINCT device_id FROM user_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY device_id`, [userId]));
  return rows.map((r) => r.device_id);
};

/** The only question that matters: can this device still get a token? */
const canRefresh = async (tenantId: string, token: string, deviceId: string): Promise<boolean> => {
  const r = await call(refresh, {
    method: 'POST', url: '/api/v1/auth/refresh',
    body: { tenantId, refreshToken: token, deviceId },
  });
  return r.status === 200;
};

before(async () => {
  if (skip) return;
  await installTestKeys();
  await lockFixtures(DATABASE_URL!);
  db = createDb(DATABASE_URL!);
  sessions = (await import('../api/sessions.ts')).default;
  refresh = (await import('../api/refresh.ts')).default;
  await drop();

  for (const [t, slug, head] of [
    [T_A, 'b120-a', HEAD], [T_B, 'b120-b', HEAD_B],
  ] as Array<[string, string, string]>) {
    await asBootstrap(db, { tenantId: t, userId: head, role: 'principal' }, async (c) => {
      await c.query(
        `INSERT INTO tenants (id, slug, name_bn, name_en, stream, level)
         VALUES ($1,$2,'বি১২০','B120','bangla_medium','secondary')`, [t, slug]);
      await c.query(
        `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
         VALUES ($1,$2,'প্রধান','Head',$3,'active')`, [head, t, phoneFor(head)]);
      await c.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'principal')`,
        [t, head]);
    });
  }
  await asBootstrap(db, ctxA, async (c) => {
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'শিক্ষক','Teacher',$3,'active')`, [TEACH, T_A, phoneFor(TEACH)]);
    await c.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'class_teacher')`,
      [T_A, TEACH]);
  });

  const { signAccessToken } = await import('../../../packages/server-core/src/jwt.ts');
  tokens = {
    head: await signAccessToken({ tid: T_A, sub: HEAD, role: 'principal', roles: ['principal'] }),
    teacher: await signAccessToken({ tid: T_A, sub: TEACH, role: 'class_teacher', roles: ['class_teacher'] }),
    headB: await signAccessToken({ tid: T_B, sub: HEAD_B, role: 'principal', roles: ['principal'] }),
  };
});

after(async () => {
  if (skip) return;
  await drop();
  await db.end();
  await unlockFixtures();
});

const listFor = (token: string, deviceId = PHONE_DESK) => call(sessions, {
  url: `/api/v1/auth/sessions?deviceId=${encodeURIComponent(deviceId)}`, token });

const revoke = (token: string, deviceId: string) => call(sessions, {
  method: 'POST', url: '/api/v1/auth/sessions/revoke', token, body: { deviceId } });

const revokeOthers = (token: string, deviceId: string) => call(sessions, {
  method: 'POST', url: '/api/v1/auth/sessions/revoke-others', token, body: { deviceId } });

interface Listed { sessions: Array<{ deviceId: string; label: string; current: boolean }> }

describe('B-120 §2 — the list', { skip }, () => {
  test('shows this account’s devices, marks the current one, and leaks nothing', async () => {
    await makeSession(T_A, HEAD, PHONE_DESK, '');
    await makeSession(T_A, HEAD, PHONE_MOB, '');

    const r = await listFor(tokens.head, PHONE_DESK);
    assert.equal(r.status, 200);
    const body = r.body as unknown as Listed;
    assert.equal(body.sessions.length, 2);
    assert.equal(body.sessions.filter((s) => s.current).length, 1, 'exactly one current');
    assert.ok(body.sessions.find((s) => s.deviceId === PHONE_DESK)!.current);

    // §2: never a token, a hash, or the stored IP.
    assert.doesNotMatch(r.raw, /refresh-|token|hash|secret|ip_address|inet/i);
    // The label is a family, not a fingerprint.
    assert.match(body.sessions[0].label, /Chrome · Windows|অজানা/);
    assert.doesNotMatch(r.raw, /Mozilla\/5\.0|537\.36/, 'the raw user agent was echoed');
  });

  test('a device with no usable label still gets a name', async () => {
    // "Unknown device" is a device somebody may still want to end.
    await asBootstrap(db, ctxA, async (c) => {
      await c.query(
        `UPDATE user_sessions SET user_agent = NULL, device_label = NULL
          WHERE user_id = $1 AND device_id = $2`, [HEAD, PHONE_MOB]);
    });
    const body = (await listFor(tokens.head)).body as unknown as Listed;
    assert.equal(body.sessions.find((s) => s.deviceId === PHONE_MOB)!.label, 'অজানা ডিভাইস');
  });
});

describe('B-120 §3 — revoking actually revokes', { skip }, () => {
  test('THE ONE THAT MATTERS — a revoked device cannot refresh', async () => {
    const lost = await makeSession(T_A, HEAD, PHONE_LOST, 'পুরনো ফোন');
    assert.equal(await canRefresh(T_A, lost, PHONE_LOST), true, 'setup: it should work first');

    const r = await revoke(tokens.head, PHONE_LOST);
    assert.equal(r.status, 200);
    assert.equal((r.body as { revoked: number }).revoked >= 1, true);

    // The whole point. Not "is it hidden" — can it still get a token.
    assert.equal(await canRefresh(T_A, lost, PHONE_LOST), false,
      'a revoked device could still refresh');

    // WHICH refusal, not merely that it was refused.  (B-121)
    //
    // The PWA decides from this status whether to end the session or to
    // treat the failure as transient, so the exact code is a contract
    // between the two. `refresh.ts` finds the session with
    // `… AND revoked_at IS NULL`, so a revoked device misses the row exactly
    // as a dead or already-rotated token does: 401, not 403. B-121 relied on
    // that being true; this is where it is proven rather than read.
    const refused = await call(refresh, {
      method: 'POST', url: '/api/v1/auth/refresh',
      body: { tenantId: T_A, refreshToken: lost, deviceId: PHONE_LOST },
    });
    assert.equal(refused.status, 401, 'a revoked device must be refused with 401');
    assert.equal((refused.body as { error: string }).error, 'invalid_refresh_token');
  });

  test('THE RACE — revoking survives a rotation between listing and pressing', async () => {
    // `refresh` rotates: the row id a screen listed is already revoked by
    // the time somebody clicks. Revoking by row id would silently no-op
    // here. Revoking by device does not.
    const t0 = await makeSession(T_A, HEAD, PHONE_LOST, 'পুরনো ফোন');
    const rot = await call(refresh, {
      method: 'POST', url: '/api/v1/auth/refresh',
      body: { tenantId: T_A, refreshToken: t0, deviceId: PHONE_LOST } });
    assert.equal(rot.status, 200, 'setup: the rotation should succeed');
    const t1 = (rot.body as { refreshToken: string }).refreshToken;

    await revoke(tokens.head, PHONE_LOST);
    assert.equal(await canRefresh(T_A, t1, PHONE_LOST), false,
      'the rotated head of the chain survived a revoke');
  });

  test('revoke is idempotent — a second press is not an error', async () => {
    const again = await revoke(tokens.head, PHONE_LOST);
    assert.equal(again.status, 200);
    assert.equal((again.body as { revoked: number }).revoked, 0);
  });

  test('revoke-others keeps the caller’s device and ends the rest', async () => {
    await makeSession(T_A, HEAD, PHONE_DESK, '');
    await makeSession(T_A, HEAD, PHONE_MOB, '');
    const keep = await makeSession(T_A, HEAD, PHONE_DESK, '');

    const r = await revokeOthers(tokens.head, PHONE_DESK);
    assert.equal(r.status, 200);

    const left = await liveDevices(HEAD, T_A);
    assert.deepEqual(left, [PHONE_DESK], `expected only the kept device, got ${left.join(',')}`);
    // And the device the person is holding still works.
    assert.equal(await canRefresh(T_A, keep, PHONE_DESK), true,
      'revoke-others signed out the device that asked');
  });

  test('a device id that is not mine revokes nothing', async () => {
    const r = await revoke(tokens.head, 'some-device-that-is-not-mine');
    assert.equal(r.status, 200);
    assert.equal((r.body as { revoked: number }).revoked, 0);
  });
});

describe('B-120 §4 — a deactivated account cannot refresh', { skip }, () => {
  test('THE ONE THAT MATTERS — status left/suspended kills refresh, even after rotation', async () => {
    // Already true (M1) and asserted here because it is the other half of
    // "a session is not a standing permission".
    const t0 = await makeSession(T_A, HEAD, 'deactivation-device', '');
    const rot = await call(refresh, {
      method: 'POST', url: '/api/v1/auth/refresh',
      body: { tenantId: T_A, refreshToken: t0, deviceId: 'deactivation-device' } });
    const t1 = (rot.body as { refreshToken: string }).refreshToken;

    for (const status of ['suspended', 'left']) {
      await asBootstrap(db, ctxA, async (c) => {
        await c.query(`UPDATE users SET status = $2::user_status WHERE id = $1`, [HEAD, status]);
      });
      assert.equal(await canRefresh(T_A, t1, 'deactivation-device'), false,
        `a ${status} account could still refresh`);
    }
    await asBootstrap(db, ctxA, async (c) => {
      await c.query(`UPDATE users SET status = 'active' WHERE id = $1`, [HEAD]);
    });
  });
});

describe('B-120 §5/§6 — authorization and tenant isolation', { skip }, () => {
  test('an unauthenticated caller gets nothing', async () => {
    assert.equal((await call(sessions, { url: '/api/v1/auth/sessions' })).status, 401);
  });

  test('THE ONE THAT MATTERS — a list is only ever your OWN devices', async () => {
    // Not a role question. A principal and a class teacher each see exactly
    // themselves, and no parameter widens it — there is no user parameter to
    // pass, which is the strongest form of the check.
    await makeSession(T_A, TEACH, 'teacher-device', '');
    const mine = (await listFor(tokens.teacher, 'teacher-device')).body as unknown as Listed;
    assert.deepEqual(mine.sessions.map((s) => s.deviceId), ['teacher-device']);

    const head = (await listFor(tokens.head)).body as unknown as Listed;
    assert.ok(!head.sessions.some((s) => s.deviceId === 'teacher-device'),
      'the head can see a teacher’s device');
  });

  test('a teacher cannot revoke the head’s device', async () => {
    await makeSession(T_A, HEAD, 'head-only-device', '');
    const r = await revoke(tokens.teacher, 'head-only-device');
    assert.equal(r.status, 200);
    assert.equal((r.body as { revoked: number }).revoked, 0, 'a teacher revoked another user’s session');
    assert.ok((await liveDevices(HEAD, T_A)).includes('head-only-device'));
  });

  test('tenant B cannot see or end tenant A’s sessions', async () => {
    await makeSession(T_B, HEAD_B, 'b-device', '');
    const bList = (await listFor(tokens.headB, 'b-device')).body as unknown as Listed;
    assert.deepEqual(bList.sessions.map((s) => s.deviceId), ['b-device']);

    // Even naming A's device exactly — the id is not a secret, and that is
    // the point: knowing it must not be enough.
    const r = await revoke(tokens.headB, 'head-only-device');
    assert.equal((r.body as { revoked: number }).revoked, 0);
    assert.ok((await liveDevices(HEAD, T_A)).includes('head-only-device'),
      'tenant B ended a session in tenant A');
  });
});

describe('B-120 §12 — the revoke is recorded', { skip }, () => {
  test('an audit row names the device and the count, and no token', async () => {
    await makeSession(T_A, HEAD, 'audited-device', '');
    await revoke(tokens.head, 'audited-device');

    const { rows } = await asBootstrap(db, ctxA, async (c) => c.query<{
      actor_id: string; after_state: { device?: string; sessions?: number } | null }>(
      `SELECT actor_id::text, after_state FROM audit.activity_log
        WHERE tenant_id = $1 AND action = 'identity.session.revoke'
        ORDER BY created_at DESC LIMIT 1`, [T_A]));
    assert.equal(rows.length, 1, 'the revoke left no audit entry');
    assert.equal(rows[0].actor_id, HEAD);
    assert.equal(rows[0].after_state?.device, 'audited-device');
    assert.ok((rows[0].after_state?.sessions ?? 0) > 0);
    assert.doesNotMatch(JSON.stringify(rows[0].after_state), /refresh-|hash|token/i);
  });
});
