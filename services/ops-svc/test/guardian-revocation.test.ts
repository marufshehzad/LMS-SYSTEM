/**
 * A revoked guardianship stays revoked.  (B-56, pre-pilot hardening)
 *
 * B-7 made a guardianship END rather than be deleted, because the record of
 * who could act for a child during a period has to survive. The ending is
 * only worth anything if it holds.
 *
 * ── The path this pins ──────────────────────────────────────────────────
 * `app.set_guardian_permissions` upserts with
 * `ON CONFLICT (tenant_id, student_id, guardian_id) WHERE revoked_at IS NULL`.
 * The conflict target is a PARTIAL index, so a pair whose only row is
 * revoked does not conflict — and the statement INSERTS a new, live
 * guardianship instead of updating anything.
 *
 * `PATCH /ops/guardians` then reached it through a pre-check that selected
 * the link without `revoked_at IS NULL`, so a revoked row satisfied the 404
 * guard and fell straight through. An admin editing an SMS toggle on a row
 * their screen still showed would have silently restored a person's access
 * to a child, with no restore decision and no distinct audit action.
 *
 * ── What was already right, and is asserted here so it stays right ──────
 * `guardianship_hide_revoked` (RLS) hides revoked links from every role
 * except the three that administer them, and SMS dispatch runs as
 * `system_ingest` — so a revoked guardian cannot be texted. That is not a
 * new fix; it is a property worth a test before a pilot.
 *
 *   DATABASE_URL=postgres://… node --test services/ops-svc/test/guardian-revocation.test.ts
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createDb, type Db, type TenantContext } from '../../../packages/server-core/src/db.ts';
import {
  installTestKeys, call, lockFixtures, unlockFixtures, asBootstrap,
} from '../../../packages/server-core/test/harness.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL ? 'DATABASE_URL not set' : false;

const T      = '7b150000-0000-4000-8000-0000000000a0';
const HEAD   = '7b150000-0000-4000-8000-0000000000a1';
const CLASST = '7b150000-0000-4000-8000-0000000000a2';
const STU    = '7b150000-0000-4000-8000-0000000000a3';
const GUARD  = '7b150000-0000-4000-8000-0000000000a4';

let db: Db;
let tokens: Record<string, string> = {};
let guardians: typeof import('../api/guardians.ts').default;

const ctx: TenantContext = { tenantId: T, userId: HEAD, role: 'principal' };

async function drop(): Promise<void> {
  await asBootstrap(db, ctx, async (c) => {
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
  });
}

const phoneFor = (id: string): string =>
  `+88017${String(parseInt(id.slice(-4), 16) % 100000000).padStart(8, '0')}`;

/**
 * Put the pair back to exactly one LIVE link, whatever the last test did.
 *
 * By UPDATE, never DELETE. `guardianship_delete_scope` is `USING (false)` —
 * nothing in this product may delete a guardianship, which is precisely
 * B-7's point and precisely what the first version of this helper assumed
 * it could do. The DELETE silently removed nothing and the INSERT then hit
 * `uq_guardianship_active`, which is the schema being right and the fixture
 * being wrong.
 */
async function resetLink(): Promise<void> {
  await asBootstrap(db, ctx, async (c) => {
    // ORDER MATTERS. Revoke the extras FIRST, then un-revoke the original:
    // `uq_guardianship_active` allows only one live row per pair, so
    // un-revoking while a resurrection artifact is still live is refused.
    await c.query(
      `UPDATE guardianships
          SET revoked_at = now(), revoked_by = $3, revoked_reason = 'ফিক্সচার'
        WHERE student_id = $1 AND guardian_id = $2 AND revoked_at IS NULL
          AND id <> (SELECT id FROM guardianships
                      WHERE student_id = $1 AND guardian_id = $2
                      ORDER BY created_at LIMIT 1)`, [STU, GUARD, HEAD]);
    await c.query(
      `UPDATE guardianships
          SET revoked_at = NULL, revoked_by = NULL, revoked_reason = NULL,
              relation = 'father', is_primary = true,
              receives_sms = true, can_pay_fees = true
        WHERE student_id = $1 AND guardian_id = $2
          AND id = (SELECT id FROM guardianships
                     WHERE student_id = $1 AND guardian_id = $2
                     ORDER BY created_at LIMIT 1)`, [STU, GUARD]);
  });
}

async function revokeLink(): Promise<void> {
  await asBootstrap(db, ctx, async (c) => {
    await c.query(
      `UPDATE guardianships SET revoked_at = now(), revoked_by = $1,
                                revoked_reason = 'পরীক্ষা'
        WHERE student_id = $2 AND guardian_id = $3 AND revoked_at IS NULL`,
      [HEAD, STU, GUARD]);
  });
}

const liveCount = async (): Promise<number> => {
  const { rows } = await asBootstrap(db, ctx, async (c) => c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM guardianships
      WHERE student_id = $1 AND guardian_id = $2 AND revoked_at IS NULL`, [STU, GUARD]));
  return Number(rows[0].n);
};

before(async () => {
  if (skip) return;
  await installTestKeys();
  await lockFixtures(DATABASE_URL!);
  db = createDb(DATABASE_URL!);
  guardians = (await import('../api/guardians.ts')).default;
  await drop();

  await asBootstrap(db, ctx, async (c) => {
    await c.query(
      `INSERT INTO tenants (id, slug, name_bn, name_en, stream, level)
       VALUES ($1,'b56-revoke','বি৫৬আর','B56R','bangla_medium','secondary')`, [T]);
    for (const [id, name, role] of [
      [HEAD, 'প্রধান', 'principal'], [CLASST, 'শ্রেণি শিক্ষক', 'class_teacher'],
      [GUARD, 'অভিভাবক', 'guardian'], [STU, 'ছাত্র', 'student'],
    ] as Array<[string, string, string]>) {
      await c.query(
        `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
         VALUES ($1,$2,$3,$3,$4,'active')`, [id, T, name, phoneFor(id)]);
      await c.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,$3)`, [T, id, role]);
    }
    await c.query(
      `INSERT INTO student_profiles (user_id, tenant_id, student_code, admission_date, lifecycle_status)
       VALUES ($1,$2,'B56R-1','2026-01-05','enrolled')`, [STU, T]);
    // The one link every test starts from. `resetLink` only ever UPDATEs —
    // nothing may DELETE a guardianship — so the row has to be created once,
    // here.
    await c.query(
      `INSERT INTO guardianships (tenant_id, student_id, guardian_id, relation,
                                  is_primary, receives_sms, can_pay_fees)
       VALUES ($1,$2,$3,'father',true,true,true)`, [T, STU, GUARD]);
  });

  const { signAccessToken } = await import('../../../packages/server-core/src/jwt.ts');
  tokens = {
    principal: await signAccessToken({ tid: T, sub: HEAD, role: 'principal', roles: ['principal'] }),
    class_teacher: await signAccessToken({ tid: T, sub: CLASST, role: 'class_teacher', roles: ['class_teacher'] }),
  };
});

after(async () => {
  if (skip) return;
  await drop();
  await db.end();
  await unlockFixtures();
});

const patch = (token: string) => call(guardians, {
  method: 'PATCH', token,
  url: '/api/v1/ops/guardians',
  body: {
    studentId: STU, guardianId: GUARD, relation: 'father',
    isPrimary: true, receivesSms: true, canPayFees: true,
  },
});

describe('B-56 — a revoked guardianship cannot be resurrected', { skip }, () => {
  test('THE ONE THAT MATTERS — PATCH on a revoked link does not restore access', async () => {
    await resetLink();
    await revokeLink();
    assert.equal(await liveCount(), 0, 'setup: the link should be revoked');

    const r = await patch(tokens.principal);

    // The count is what decides it. A 200 that inserted a second, live row
    // is the failure — the revoked row is still there and the person is
    // reachable again.
    assert.equal(await liveCount(), 0,
      'a revoked guardianship was resurrected — the guardian can act for the child again');
    assert.equal(r.status, 409, 'the refusal must be visible, not silent');
    assert.equal((r.body as { error: string }).error, 'link_revoked');
  });

  test('the revoked row itself is untouched — B-7 keeps the history', async () => {
    const { rows } = await asBootstrap(db, ctx, async (c) => c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM guardianships
        WHERE student_id = $1 AND guardian_id = $2 AND revoked_at IS NOT NULL`, [STU, GUARD]));
    assert.equal(Number(rows[0].n), 1, 'the revocation record was destroyed');
  });

  test('a LIVE link still edits normally — the guard is not a blanket refusal', async () => {
    await resetLink();
    const r = await patch(tokens.principal);
    assert.equal(r.status, 200, 'editing a live guardianship broke');
    assert.equal(await liveCount(), 1, 'editing a live link changed the number of links');
  });

  test('editing a live link never creates a second one', async () => {
    await resetLink();
    await patch(tokens.principal);
    await patch(tokens.principal);
    assert.equal(await liveCount(), 1, 'repeated edits multiplied the link');
  });
});

describe('B-56 — a revoked link is invisible where it must be', { skip }, () => {
  test('a class teacher cannot see a revoked guardianship at all', async () => {
    // `guardianship_hide_revoked` is the RLS policy that does this, so the
    // handler forgetting a WHERE clause would still not leak it.
    await resetLink();
    await revokeLink();
    const r = await call(guardians, {
      url: `/api/v1/ops/guardians?studentId=${STU}`, token: tokens.class_teacher });
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.raw, /অভিভাবক/, 'a revoked guardian is visible to a class teacher');
  });

  test('SMS dispatch cannot target a revoked guardian', async () => {
    // Dispatch runs as `system_ingest`, which the policy excludes. Asserted
    // through the same role rather than by reading the policy text.
    const sys: TenantContext = { tenantId: T, userId: '', role: 'system_ingest' };
    const { rows } = await db.withTenant(sys, async (c) => c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM guardianships
        WHERE student_id = $1 AND receives_sms = true`, [STU]));
    assert.equal(Number(rows[0].n), 0,
      'a revoked guardian is still reachable by the SMS fan-out');
  });

  test('an admin CAN still see it — that is how it gets audited or re-linked', async () => {
    const r = await call(guardians, {
      url: `/api/v1/ops/guardians?studentId=${STU}`, token: tokens.principal });
    assert.equal(r.status, 200);
    assert.match(r.raw, /অভিভাবক/, 'an admin lost sight of the revoked link');
  });
});
