/**
 * One contact rule, across every route that can answer with a phone. (B-56)
 *
 * The defect this pins was not a missing check — it was three checks that
 * disagreed, each defensible on its own screen:
 *
 *   `/academics/students/history`  gated on a local role list
 *   `/academics/roster`            gated on NOTHING — `requireStaff` only,
 *                                  whose blocklist is `{student, guardian}`,
 *                                  so a subject teacher received the child's
 *                                  phone number
 *   `/ops/guardians?studentId=`    gated harder, on the three roles that may
 *                                  EDIT a guardianship
 *
 * A subject teacher was refused a number on one screen and handed it on
 * another. Neither screen was wrong about its own rule; there was no rule.
 *
 * ── Why this asserts on the BODY, never on the screen ──────────────────
 * D13: a value that ships in the response and is hidden in the UI is still
 * one devtools tab away. Every assertion below reads what the handler
 * returned.
 *
 *   DATABASE_URL=postgres://… node --test services/academics-svc/test/contact-privacy.test.ts
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createDb, type Db, type TenantContext } from '../../../packages/server-core/src/db.ts';
import {
  installTestKeys, call, lockFixtures, unlockFixtures, asBootstrap,
} from '../../../packages/server-core/test/harness.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL ? 'DATABASE_URL not set' : false;

const T      = '7b140000-0000-4000-8000-0000000000a0';
const HEAD   = '7b140000-0000-4000-8000-0000000000a1';
const IT     = '7b140000-0000-4000-8000-0000000000a2';
const CLASST = '7b140000-0000-4000-8000-0000000000a3';
const SUBJT  = '7b140000-0000-4000-8000-0000000000a4';
const STU    = '7b140000-0000-4000-8000-0000000000a5';
const GUARD  = '7b140000-0000-4000-8000-0000000000a6';
const YEAR   = '7b140000-0000-4000-8000-0000000000c1';
const CLS    = '7b140000-0000-4000-8000-0000000000d1';
const SEC    = '7b140000-0000-4000-8000-0000000000e1';

/** The student's own number. If this string appears, the gate let it out. */
const STUDENT_PHONE = '+8801711000555';

let db: Db;
let tokens: Record<string, string> = {};
let roster: typeof import('../api/roster.ts').default;
let history: typeof import('../api/studenthistory.ts').default;

const ctx: TenantContext = { tenantId: T, userId: HEAD, role: 'principal' };

async function drop(): Promise<void> {
  await asBootstrap(db, ctx, async (c) => {
    await c.query('DELETE FROM tenants WHERE id = $1', [T]);
  });
}

const phoneFor = (id: string): string =>
  `+88017${String(parseInt(id.slice(-4), 16) % 100000000).padStart(8, '0')}`;

before(async () => {
  if (skip) return;
  await installTestKeys();
  await lockFixtures(DATABASE_URL!);
  db = createDb(DATABASE_URL!);
  roster = (await import('../api/roster.ts')).default;
  history = (await import('../api/studenthistory.ts')).default;
  await drop();

  await asBootstrap(db, ctx, async (c) => {
    await c.query(
      `INSERT INTO tenants (id, slug, name_bn, name_en, stream, level)
       VALUES ($1,'b56-contact','বি৫৬','B56','bangla_medium','secondary')`, [T]);
    for (const [id, name, role] of [
      [HEAD, 'প্রধান', 'principal'], [IT, 'আইটি', 'it_admin'],
      [CLASST, 'শ্রেণি শিক্ষক', 'class_teacher'],
      [SUBJT, 'বিষয় শিক্ষক', 'subject_teacher'],
      [GUARD, 'অভিভাবক', 'guardian'],
    ] as Array<[string, string, string]>) {
      await c.query(
        `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
         VALUES ($1,$2,$3,$3,$4,'active')`, [id, T, name, phoneFor(id)]);
      await c.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,$3)`, [T, id, role]);
    }
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'ছাত্র','Student',$3,'active')`, [STU, T, STUDENT_PHONE]);
    await c.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'student')`, [T, STU]);
    await c.query(
      `INSERT INTO student_profiles (user_id, tenant_id, student_code, admission_date, lifecycle_status)
       VALUES ($1,$2,'B56-1','2026-01-05','enrolled')`, [STU, T]);
    await c.query(
      `INSERT INTO academic_years (id, tenant_id, label, starts_on, ends_on, is_current)
       VALUES ($1,$2,'2026','2026-01-01','2026-12-31',true)`, [YEAR, T]);
    await c.query(
      `INSERT INTO classes (id, tenant_id, level_no, name_bn, name_en, stream)
       VALUES ($1,$2,9,'নবম','Nine','bangla_medium')`, [CLS, T]);
    await c.query(
      `INSERT INTO sections (id, tenant_id, class_id, academic_year_id, name, student_count, class_teacher_id)
       VALUES ($1,$2,$3,$4,'ক',1,$5)`, [SEC, T, CLS, YEAR, CLASST]);
    await c.query(
      `INSERT INTO enrolments (tenant_id, student_id, section_id, academic_year_id, roll_no, status)
       VALUES ($1,$2,$3,$4,1,'active')`, [T, STU, SEC, YEAR]);
    await c.query(
      `INSERT INTO guardianships (tenant_id, student_id, guardian_id, relation, is_primary, receives_sms)
       VALUES ($1,$2,$3,'father',true,true)`, [T, STU, GUARD]);
  });

  const { signAccessToken } = await import('../../../packages/server-core/src/jwt.ts');
  const mk = (sub: string, role: string) =>
    signAccessToken({ tid: T, sub, role, roles: [role] });
  tokens = {
    principal: await mk(HEAD, 'principal'),
    it_admin: await mk(IT, 'it_admin'),
    class_teacher: await mk(CLASST, 'class_teacher'),
    subject_teacher: await mk(SUBJT, 'subject_teacher'),
    student: await mk(STU, 'student'),
    guardian: await mk(GUARD, 'guardian'),
  };
});

after(async () => {
  if (skip) return;
  await drop();
  await db.end();
  await unlockFixtures();
});

/** The six roles the brief names, and whether each may see a child's number. */
const MATRIX: Array<[string, boolean]> = [
  ['principal', true],
  ['it_admin', true],
  ['class_teacher', true],       // responsible for the child
  ['subject_teacher', false],    // teaches them a subject; reaching the family is not their job
  ['student', true],             // their own number
  ['guardian', true],            // their own child's
];

describe('B-56 — one contact rule on /academics/roster', { skip }, () => {
  const get = (token: string) =>
    call(roster, { url: `/api/v1/academics/roster?sectionId=${SEC}`, token });

  test('THE ONE THAT MATTERS — a subject teacher reads the roster and gets no number', async () => {
    // Before this, `requireStaff` was the only check and its blocklist is
    // `{student, guardian}` — so every teaching role received the phone.
    const r = await get(tokens.subject_teacher);
    assert.equal(r.status, 200, 'a subject teacher must still READ the roster');
    const body = r.body as { roster: Array<{ fullName: unknown; phone: string | null }> };
    assert.equal(body.roster.length, 1, 'the roster itself was withheld');
    assert.equal(body.roster[0].phone, null, 'the student’s phone reached a subject teacher');
    // Nulled in the body, not hidden in the UI.
    assert.doesNotMatch(r.raw, /\+8801711000555/, 'the number is still in the response');
  });

  test('the class teacher, who is responsible for the child, still gets it', async () => {
    const r = await get(tokens.class_teacher);
    assert.equal(r.status, 200);
    const body = r.body as { roster: Array<{ phone: string | null }> };
    assert.equal(body.roster[0].phone, STUDENT_PHONE,
      'the class teacher lost the number they need to call a parent');
  });

  test('every role in the matrix gets the documented answer', async () => {
    for (const [role, maySee] of MATRIX) {
      if (role === 'student' || role === 'guardian') continue;  // refused the route itself
      const r = await get(tokens[role]);
      assert.equal(r.status, 200, `${role} could not read the roster`);
      const body = r.body as { roster: Array<{ phone: string | null }> };
      assert.equal(body.roster[0].phone, maySee ? STUDENT_PHONE : null,
        `${role} got the wrong answer for a student's phone`);
    }
  });

  test('a student and a guardian are refused the roster route outright', async () => {
    // Not a contact question — a roster is a staff surface.
    for (const role of ['student', 'guardian']) {
      assert.equal((await get(tokens[role])).status, 403, role);
    }
  });
});

describe('B-56 — the same rule on /academics/students/history', { skip }, () => {
  const get = (token: string) =>
    call(history, { url: `/api/v1/academics/students/history?studentId=${STU}`, token });

  test('THE ONE THAT MATTERS — roster and history now agree about a subject teacher', async () => {
    // This is the whole defect: two routes, one question, two answers.
    const onHistory = await get(tokens.subject_teacher);
    const onRoster = await call(roster, {
      url: `/api/v1/academics/roster?sectionId=${SEC}`, token: tokens.subject_teacher });

    const h = onHistory.body as { student?: { phone: string | null } };
    const rs = onRoster.body as { roster: Array<{ phone: string | null }> };
    assert.equal(h.student?.phone ?? null, null);
    assert.equal(rs.roster[0].phone, null);
    for (const r of [onHistory, onRoster]) {
      assert.doesNotMatch(r.raw, /\+8801711000555/);
    }
  });

  test('and they agree about a class teacher too', async () => {
    const h = (await get(tokens.class_teacher)).body as { student?: { phone: string | null } };
    assert.equal(h.student?.phone, STUDENT_PHONE);
  });

  test('the permissions flag the client reads matches the value it was sent', async () => {
    // The screen decides what to render from `permissions.contact`. If that
    // said `true` while the value was nulled, the UI would show an empty
    // field where a number belongs and nobody would know which was wrong.
    for (const [role, maySee] of MATRIX) {
      const r = await get(tokens[role]);
      if (r.status !== 200) continue;
      const b = r.body as { permissions?: { contact: boolean }; student?: { phone: string | null } };
      assert.equal(b.permissions?.contact, maySee, `${role}: flag disagrees with policy`);
      // `!== null` would let `undefined` read as "has a value", which is how
      // the first version of this assertion passed while the key it read did
      // not exist. Compare the value itself.
      assert.equal(b.student?.phone ?? null, maySee ? STUDENT_PHONE : null,
        `${role}: value disagrees with the flag`);
    }
  });
});
