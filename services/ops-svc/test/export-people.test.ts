/**
 * The staff and guardian exports.  (P11 §8, §9, §22, §23, §26)
 *
 * Same discipline as the students suite: the assertions read the FILE, not
 * the status code, because a 200 carrying another school's staff list is
 * indistinguishable from success until something opens the bytes.
 *
 * Two things here that students could not test:
 *
 *   §8  a phone policy. `staff_profiles.bank_account_ciphertext` exists on
 *       the same table as everything the export DOES carry, so "no secret in
 *       the file" is a live question rather than a formality.
 *   §9  a relationship. `guardianships` is one row per LINK, so a guardian
 *       with two children must appear twice and a revoked link must appear
 *       at all — B-7 made the ending recordable precisely so it survives.
 *
 *   DATABASE_URL=postgres://… node --test services/ops-svc/test/export-people.test.ts
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createDb, type Db, type TenantContext } from '../../../packages/server-core/src/db.ts';
import {
  installTestKeys, call, lockFixtures, unlockFixtures, asBootstrap,
} from '../../../packages/server-core/test/harness.ts';
import { parseCsv } from '../../../packages/server-core/src/csv.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL ? 'DATABASE_URL not set' : false;

const T_A     = '7b120000-0000-4000-8000-0000000000a0';
const T_B     = '7b120000-0000-4000-8000-0000000000b0';
const HEAD_A  = '7b120000-0000-4000-8000-0000000000a1';
const HEAD_B  = '7b120000-0000-4000-8000-0000000000b1';
const TEACH_A = '7b120000-0000-4000-8000-0000000000a2';
const GUARD_A = '7b120000-0000-4000-8000-0000000000a3';
const STU_A1  = '7b120000-0000-4000-8000-0000000000a4';
/** A second child for the same guardian — §9's "one row per link". */
const STU_A2  = '7b120000-0000-4000-8000-0000000000a5';
const TEACH_B = '7b120000-0000-4000-8000-0000000000b2';

const YEAR_A  = '7b120000-0000-4000-8000-0000000000c1';
const YEAR_B  = '7b120000-0000-4000-8000-0000000000c2';
const CLS_A   = '7b120000-0000-4000-8000-0000000000d1';
const CLS_B   = '7b120000-0000-4000-8000-0000000000d2';
const SEC_A   = '7b120000-0000-4000-8000-0000000000e1';
const SEC_B   = '7b120000-0000-4000-8000-0000000000e2';

let db: Db;
let tokens: Record<string, string> = {};
let exportData: typeof import('../api/export.ts').default;

const ctxA: TenantContext = { tenantId: T_A, userId: HEAD_A, role: 'principal' };
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

before(async () => {
  if (skip) return;
  await installTestKeys();
  await lockFixtures(DATABASE_URL!);
  db = createDb(DATABASE_URL!);
  exportData = (await import('../api/export.ts')).default;
  await drop();

  await asBootstrap(db, ctxA, async (c) => {
    await c.query(
      `INSERT INTO tenants (id, slug, name_bn, name_en, stream, level)
       VALUES ($1,'p11-people-a','এ স্কুল','A','bangla_medium','secondary')`, [T_A]);
    // The head has NO staff_profiles row — the onboarding wizard creates one
    // that way, and the export must still list them.
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'প্রধান এ','Head A',$3,'active')`, [HEAD_A, T_A, phoneFor(HEAD_A)]);
    await c.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'principal')`,
      [T_A, HEAD_A]);

    // A teacher with TWO roles, to prove the aggregation does not duplicate.
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'শিক্ষক এ','Teacher A',$3,'active')`, [TEACH_A, T_A, phoneFor(TEACH_A)]);
    for (const r of ['class_teacher', 'subject_teacher']) {
      await c.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,$3)`,
        [T_A, TEACH_A, r]);
    }
    await c.query(
      `INSERT INTO staff_profiles (user_id, tenant_id, employee_code, joining_date, designation_bn)
       VALUES ($1,$2,'EMP-A-1','2024-01-10','সহকারী শিক্ষক')`, [TEACH_A, T_A]);

    await c.query(
      `INSERT INTO academic_years (id, tenant_id, label, starts_on, ends_on, is_current)
       VALUES ($1,$2,'2026','2026-01-01','2026-12-31',true)`, [YEAR_A, T_A]);
    await c.query(
      `INSERT INTO classes (id, tenant_id, level_no, name_bn, name_en, stream)
       VALUES ($1,$2,9,'নবম','Nine','bangla_medium')`, [CLS_A, T_A]);
    await c.query(
      `INSERT INTO sections (id, tenant_id, class_id, academic_year_id, name, student_count, class_teacher_id)
       VALUES ($1,$2,$3,$4,'ক',0,$5)`, [SEC_A, T_A, CLS_A, YEAR_A, TEACH_A]);

    // One guardian, TWO children, and the second link revoked.
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'অভিভাবক এ','Guardian A',$3,'active')`, [GUARD_A, T_A, phoneFor(GUARD_A)]);
    await c.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'guardian')`,
      [T_A, GUARD_A]);
    for (const [id, name, code] of [
      [STU_A1, 'ছাত্র এক', 'A-1'], [STU_A2, 'ছাত্র দুই', 'A-2'],
    ] as Array<[string, string, string]>) {
      await c.query(
        `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
         VALUES ($1,$2,$3,$3,$4,'active')`, [id, T_A, name, phoneFor(id)]);
      await c.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'student')`,
        [T_A, id]);
      await c.query(
        `INSERT INTO student_profiles (user_id, tenant_id, student_code, admission_date, lifecycle_status)
         VALUES ($1,$2,$3,'2026-01-05','enrolled')`, [id, T_A, code]);
      await c.query(
        `INSERT INTO enrolments (tenant_id, student_id, section_id, academic_year_id, roll_no, status)
         VALUES ($1,$2,$3,$4,$5,'active')`,
        [T_A, id, SEC_A, YEAR_A, id === STU_A1 ? 1 : 2]);
    }
    await c.query(
      `INSERT INTO guardianships (tenant_id, student_id, guardian_id, relation, is_primary, receives_sms)
       VALUES ($1,$2,$3,'father',true,true)`, [T_A, STU_A1, GUARD_A]);
    await c.query(
      `INSERT INTO guardianships (tenant_id, student_id, guardian_id, relation, is_primary,
                                  receives_sms, revoked_at, revoked_by, revoked_reason)
       VALUES ($1,$2,$3,'father',false,false, now(), $4, 'পরীক্ষা')`,
      [T_A, STU_A2, GUARD_A, HEAD_A]);
  });

  await asBootstrap(db, ctxB, async (c) => {
    await c.query(
      `INSERT INTO tenants (id, slug, name_bn, name_en, stream, level)
       VALUES ($1,'p11-people-b','বি স্কুল','B','bangla_medium','secondary')`, [T_B]);
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'প্রধান বি','Head B',$3,'active')`, [HEAD_B, T_B, phoneFor(HEAD_B)]);
    await c.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'principal')`,
      [T_B, HEAD_B]);
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'বি-স্কুলের শিক্ষক','Teacher B',$3,'active')`,
      [TEACH_B, T_B, phoneFor(TEACH_B)]);
    await c.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'subject_teacher')`,
      [T_B, TEACH_B]);
    await c.query(
      `INSERT INTO academic_years (id, tenant_id, label, starts_on, ends_on, is_current)
       VALUES ($1,$2,'2026','2026-01-01','2026-12-31',true)`, [YEAR_B, T_B]);
    await c.query(
      `INSERT INTO classes (id, tenant_id, level_no, name_bn, name_en, stream)
       VALUES ($1,$2,9,'নবম','Nine','bangla_medium')`, [CLS_B, T_B]);
    await c.query(
      `INSERT INTO sections (id, tenant_id, class_id, academic_year_id, name, student_count)
       VALUES ($1,$2,$3,$4,'ক',0)`, [SEC_B, T_B, CLS_B, YEAR_B]);
  });

  const { signAccessToken } = await import('../../../packages/server-core/src/jwt.ts');
  tokens = {
    headA: await signAccessToken({ tid: T_A, sub: HEAD_A, role: 'principal', roles: ['principal'] }),
    headB: await signAccessToken({ tid: T_B, sub: HEAD_B, role: 'principal', roles: ['principal'] }),
    teachA: await signAccessToken({ tid: T_A, sub: TEACH_A, role: 'class_teacher', roles: ['class_teacher'] }),
  };
});

after(async () => {
  if (skip) return;
  await drop();
  await db.end();
  await unlockFixtures();
});

async function exportCsv(token: string, dataset: string) {
  const r = await call(exportData, { url: `/api/v1/ops/export?dataset=${dataset}`, token });
  return { r, csv: r.status === 200 ? parseCsv(r.raw) : null };
}

describe('P11 §8 — the staff export', { skip }, () => {
  test('THE ONE THAT MATTERS — this school’s staff and no other school’s', async () => {
    const { r, csv } = await exportCsv(tokens.headA, 'teachers');
    assert.equal(r.status, 200);
    const names = csv!.rows.map((x) => x.cells['নাম']);
    assert.ok(names.includes('শিক্ষক এ'));
    assert.ok(!names.includes('বি-স্কুলের শিক্ষক'), 'B’s teacher is in A’s file');
    assert.doesNotMatch(r.raw, /বি-স্কুলের/);
  });

  test('the head teacher is listed even with no staff_profiles row', async () => {
    // The onboarding wizard creates a principal with a role and no profile.
    // Keying the export off `staff_profiles` would omit them from their own
    // school's list of its own staff.
    const { csv } = await exportCsv(tokens.headA, 'teachers');
    assert.ok(csv!.rows.some((x) => x.cells['নাম'] === 'প্রধান এ'),
      'the head is missing from the staff export');
  });

  test('a two-role teacher is ONE row, with both roles named in Bangla', async () => {
    const { csv } = await exportCsv(tokens.headA, 'teachers');
    const rows = csv!.rows.filter((x) => x.cells['নাম'] === 'শিক্ষক এ');
    assert.equal(rows.length, 1, `two roles produced ${rows.length} rows`);
    assert.match(rows[0].cells['ভূমিকা'], /শ্রেণি শিক্ষক/);
    assert.match(rows[0].cells['ভূমিকা'], /বিষয় শিক্ষক/);
  });

  test('students and guardians are not staff', async () => {
    const { csv } = await exportCsv(tokens.headA, 'teachers');
    const names = csv!.rows.map((x) => x.cells['নাম']);
    assert.ok(!names.includes('ছাত্র এক'), 'a student is in the staff file');
    assert.ok(!names.includes('অভিভাবক এ'), 'a guardian is in the staff file');
  });

  test('no bank account, no hash, no uuid', async () => {
    // `bank_account_ciphertext` sits on the same table as everything this
    // export DOES carry, so this is a live question, not a formality.
    const { r } = await exportCsv(tokens.headA, 'teachers');
    assert.doesNotMatch(r.raw, /bank|ciphertext|password|hash|secret|token/i);
    assert.doesNotMatch(r.raw, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
  });
});

describe('P11 §9 — the guardian export', { skip }, () => {
  test('THE ONE THAT MATTERS — one row per LINK, not per guardian', async () => {
    // A guardian with two children is two rows. Collapsing to one adult
    // would lose which permissions apply to which child.
    const { csv } = await exportCsv(tokens.headA, 'guardians');
    const mine = csv!.rows.filter((x) => x.cells['অভিভাবকের নাম'] === 'অভিভাবক এ');
    assert.equal(mine.length, 2, `expected 2 links, got ${mine.length}`);
    assert.deepEqual(
      mine.map((x) => x.cells['শিক্ষার্থীর নাম']).sort(),
      ['ছাত্র এক', 'ছাত্র দুই']);
  });

  test('a revoked link is present and says so — B-7’s whole point', async () => {
    // The record of who could act for a child during a period must survive.
    // An export that dropped revoked rows hands back a history with the
    // endings removed.
    const { csv } = await exportCsv(tokens.headA, 'guardians');
    const revoked = csv!.rows.find((x) => x.cells['শিক্ষার্থীর নাম'] === 'ছাত্র দুই');
    assert.ok(revoked, 'the revoked link vanished from the export');
    assert.equal(revoked!.cells['অবস্থা'], 'প্রত্যাহৃত');
    const live = csv!.rows.find((x) => x.cells['শিক্ষার্থীর নাম'] === 'ছাত্র এক');
    assert.equal(live!.cells['অবস্থা'], 'সক্রিয়');
  });

  test('per-link permissions are words, not flags', async () => {
    const { csv } = await exportCsv(tokens.headA, 'guardians');
    const live = csv!.rows.find((x) => x.cells['শিক্ষার্থীর নাম'] === 'ছাত্র এক')!;
    assert.equal(live.cells['প্রধান অভিভাবক'], 'হ্যাঁ');
    assert.equal(live.cells['এসএমএস পান'], 'হ্যাঁ');
    assert.equal(live.cells['সম্পর্ক'], 'পিতা');
  });

  test('B’s head sees none of A’s families', async () => {
    const { r, csv } = await exportCsv(tokens.headB, 'guardians');
    assert.equal(r.status, 200);
    assert.equal(csv!.rows.length, 0, 'B has no guardianships and got rows');
    assert.doesNotMatch(r.raw, /অভিভাবক এ|ছাত্র/);
  });
});

describe('P11 §22/§27 — authorization and refusals', { skip }, () => {
  test('a class teacher may not export either dataset', async () => {
    for (const d of ['teachers', 'guardians']) {
      assert.equal((await exportCsv(tokens.teachA, d)).r.status, 403, d);
    }
  });

  test('an unknown dataset names what is available', async () => {
    const r = await call(exportData, {
      url: '/api/v1/ops/export?dataset=payroll', token: tokens.headA });
    assert.equal(r.status, 400);
    assert.match((r.body as { message: string }).message, /teachers/);
  });

  test('an empty result is a valid file with a header, not an error', async () => {
    // §27: an empty dataset is not a failure. B has staff but no guardians.
    const { r, csv } = await exportCsv(tokens.headB, 'guardians');
    assert.equal(r.status, 200);
    assert.equal(r.raw.charCodeAt(0), 0xfeff);
    assert.ok(csv!.headers.includes('অভিভাবকের নাম'));
  });
});
