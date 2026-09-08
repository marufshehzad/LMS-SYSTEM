/**
 * The fees export.  (P11 §13, §22, §26)
 *
 * Two things distinguish this dataset from the others and both are tested
 * here rather than assumed:
 *
 *   1. Money must be ADDABLE. Every screen shows "১,৫০০ টাকা" through
 *      `formatBdt`, and the first thing a school does with a fees export is
 *      sum a column. Bangla digits with a unit sum to zero.
 *   2. An invoice has many lines and many receipts. Joining either would
 *      multiply the bill, and the total column would then sum to several
 *      times the school's actual billing — a number a head teacher acts on.
 *
 *   DATABASE_URL=postgres://… node --test services/finance-svc/test/export-fees.test.ts
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

const T_A    = '7b130000-0000-4000-8000-0000000000a0';
const T_B    = '7b130000-0000-4000-8000-0000000000b0';
const HEAD_A = '7b130000-0000-4000-8000-0000000000a1';
const HEAD_B = '7b130000-0000-4000-8000-0000000000b1';
const ACCT_A = '7b130000-0000-4000-8000-0000000000a6';
const STU_A  = '7b130000-0000-4000-8000-0000000000a2';
const STU_B  = '7b130000-0000-4000-8000-0000000000b2';
const YEAR_A = '7b130000-0000-4000-8000-0000000000c1';
const YEAR_B = '7b130000-0000-4000-8000-0000000000c2';
const INV_A  = '7b130000-0000-4000-8000-0000000000f1';
const HEAD_TUITION = '7b130000-0000-4000-8000-0000000000a3';
const HEAD_EXAM    = '7b130000-0000-4000-8000-0000000000a4';

let db: Db;
let tokens: Record<string, string> = {};
let exportData: typeof import('../api/export.ts').default;

const ctxA: TenantContext = { tenantId: T_A, userId: HEAD_A, role: 'principal' };
const ctxB: TenantContext = { tenantId: T_B, userId: HEAD_B, role: 'principal' };

/**
 * Finance rows first, then the tenant.
 *
 * `payment_receipts.tenant_id` does NOT cascade — deleting a school while a
 * receipt exists is refused, which is the schema protecting a financial
 * record from a careless parent delete. Correct, and it means this teardown
 * has to name the tables rather than lean on the cascade the other suites
 * get away with.
 */
async function drop(): Promise<void> {
  for (const ctx of [ctxA, ctxB]) {
    await asBootstrap(db, ctx, async (c) => {
      for (const t of ['payment_receipts', 'invoice_lines', 'invoices', 'fee_heads']) {
        await c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [ctx.tenantId]);
      }
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
       VALUES ($1,'p11-fee-a','এ স্কুল','A','bangla_medium','secondary')`, [T_A]);
    for (const [id, name, role] of [
      [HEAD_A, 'প্রধান এ', 'principal'], [ACCT_A, 'হিসাবরক্ষক এ', 'accountant'],
      [STU_A, 'ছাত্র এ', 'student'],
    ] as Array<[string, string, string]>) {
      await c.query(
        `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
         VALUES ($1,$2,$3,$3,$4,'active')`, [id, T_A, name, phoneFor(id)]);
      await c.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,$3)`,
        [T_A, id, role]);
    }
    await c.query(
      `INSERT INTO student_profiles (user_id, tenant_id, student_code, admission_date, lifecycle_status)
       VALUES ($1,$2,'FEE-A-1','2026-01-05','enrolled')`, [STU_A, T_A]);
    await c.query(
      `INSERT INTO academic_years (id, tenant_id, label, starts_on, ends_on, is_current)
       VALUES ($1,$2,'2026','2026-01-01','2026-12-31',true)`, [YEAR_A, T_A]);

    // ONE invoice: two lines, two receipts. A join on either would emit four
    // rows for one bill.
    await c.query(
      `INSERT INTO invoices (id, tenant_id, invoice_no, student_id, academic_year_id,
                             billing_period, issued_on, due_on, subtotal, waiver_total,
                             late_fee, total_amount, paid_amount, status)
       -- balance_amount is a GENERATED column: the database derives it from
       -- total minus paid, and setting it here is refused. That is the schema
       -- being right - a balance that can disagree with its own inputs is a
       -- number a school reconciles against and loses.
       VALUES ($1,$2,'INV-A-001',$3,$4,'2026-03','2026-03-01','2026-03-10',
               1500.00, 0.00, 0.00, 1500.00, 1000.00, 'partly_paid')`,
      [INV_A, T_A, STU_A, YEAR_A]);
    await c.query(
      `INSERT INTO fee_heads (id, tenant_id, code, name_bn, name_en, frequency)
       VALUES ($1,$2,'TUITION','টিউশন ফি','Tuition','monthly')`, [HEAD_TUITION, T_A]);
    await c.query(
      // net_amount is generated too (amount minus waiver).
      `INSERT INTO invoice_lines (tenant_id, invoice_id, fee_head_id, description_bn,
                                  amount, waiver_amount)
       VALUES ($1,$2,$3,'টিউশন ফি',1200.00,0.00)`, [T_A, INV_A, HEAD_TUITION]);
    await c.query(
      `INSERT INTO fee_heads (id, tenant_id, code, name_bn, name_en, frequency)
       VALUES ($1,$2,'EXAM','পরীক্ষার ফি','Exam','one_time')`, [HEAD_EXAM, T_A]);
    await c.query(
      // fee_head_id is NOT NULL: every line belongs to a head, which is what
      // makes the ledger's accounts reconcile.
      `INSERT INTO invoice_lines (tenant_id, invoice_id, fee_head_id, description_bn,
                                  amount, waiver_amount)
       VALUES ($1,$2,$3,'পরীক্ষার ফি',300.00,0.00)`, [T_A, INV_A, HEAD_EXAM]);
    for (const [no, amt, method] of [
      ['RCT-A-1', '600.00', 'bkash'], ['RCT-A-2', '400.00', 'cash'],
    ] as Array<[string, string, string]>) {
      await c.query(
        `INSERT INTO payment_receipts (tenant_id, receipt_no, invoice_id, student_id,
                                       amount, method, signature)
         VALUES ($1,$2,$3,$4,$5,$6::mfs_provider,'SIGNATURE-MUST-NOT-EXPORT')`,
        [T_A, no, INV_A, STU_A, amt, method]);
    }
  });

  await asBootstrap(db, ctxB, async (c) => {
    await c.query(
      `INSERT INTO tenants (id, slug, name_bn, name_en, stream, level)
       VALUES ($1,'p11-fee-b','বি স্কুল','B','bangla_medium','secondary')`, [T_B]);
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'প্রধান বি','Head B',$3,'active')`, [HEAD_B, T_B, phoneFor(HEAD_B)]);
    await c.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'principal')`,
      [T_B, HEAD_B]);
    await c.query(
      `INSERT INTO users (id, tenant_id, full_name_bn, full_name_en, phone_e164, status)
       VALUES ($1,$2,'বি-স্কুলের ছাত্র','Student B',$3,'active')`,
      [STU_B, T_B, phoneFor(STU_B)]);
    await c.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_code) VALUES ($1,$2,'student')`,
      [T_B, STU_B]);
    await c.query(
      `INSERT INTO academic_years (id, tenant_id, label, starts_on, ends_on, is_current)
       VALUES ($1,$2,'2026','2026-01-01','2026-12-31',true)`, [YEAR_B, T_B]);
    await c.query(
      `INSERT INTO invoices (tenant_id, invoice_no, student_id, academic_year_id,
                             due_on, total_amount, paid_amount, status)
       VALUES ($1,'INV-B-001',$2,$3,'2026-03-10', 999.00, 0.00, 'issued')`,
      [T_B, STU_B, YEAR_B]);
  });

  const { signAccessToken } = await import('../../../packages/server-core/src/jwt.ts');
  tokens = {
    headA: await signAccessToken({ tid: T_A, sub: HEAD_A, role: 'principal', roles: ['principal'] }),
    headB: await signAccessToken({ tid: T_B, sub: HEAD_B, role: 'principal', roles: ['principal'] }),
    acctA: await signAccessToken({ tid: T_A, sub: ACCT_A, role: 'accountant', roles: ['accountant'] }),
    stuA: await signAccessToken({ tid: T_A, sub: STU_A, role: 'student', roles: ['student'] }),
  };
});

after(async () => {
  if (skip) return;
  await drop();
  await db.end();
  await unlockFixtures();
});

async function exportCsv(token: string) {
  const r = await call(exportData, { url: '/api/v1/finance/export?dataset=fees', token });
  return { r, csv: r.status === 200 ? parseCsv(r.raw) : null };
}

describe('P11 §13 — the fees export', { skip }, () => {
  test('THE ONE THAT MATTERS — one row per invoice, not per line or receipt', async () => {
    // Two lines and two receipts on one bill. A join on either emits four
    // rows, and the total column then sums to four times the school's real
    // billing.
    const { r, csv } = await exportCsv(tokens.headA);
    assert.equal(r.status, 200);
    const mine = csv!.rows.filter((x) => x.cells['ইনভয়েস নম্বর'] === 'INV-A-001');
    assert.equal(mine.length, 1, `one invoice produced ${mine.length} rows`);
    // …and both lines and both receipts are still present, in their own cells.
    assert.match(mine[0].cells['ফি খাত'], /টিউশন ফি/);
    assert.match(mine[0].cells['ফি খাত'], /পরীক্ষার ফি/);
    assert.match(mine[0].cells['রসিদ নম্বর'], /RCT-A-1/);
    assert.match(mine[0].cells['রসিদ নম্বর'], /RCT-A-2/);
  });

  test('money is a number a spreadsheet can add', async () => {
    // `formatBdt` would produce "১,৫০০ টাকা", which sums to zero.
    const { csv } = await exportCsv(tokens.headA);
    const row = csv!.rows.find((x) => x.cells['ইনভয়েস নম্বর'] === 'INV-A-001')!;
    for (const col of ['মোট', 'পরিশোধিত', 'বকেয়া']) {
      assert.match(row.cells[col], /^\d+(\.\d+)?$/, `${col} is not an addable number`);
    }
    assert.equal(Number(row.cells['মোট']), 1500);
    assert.equal(Number(row.cells['পরিশোধিত']), 1000);
    assert.equal(Number(row.cells['বকেয়া']), 500);
    // The unit lives in its own column rather than inside the number.
    assert.equal(row.cells['মুদ্রা'], 'BDT');
  });

  test('the payment method is a Bangla word', async () => {
    const { csv } = await exportCsv(tokens.headA);
    const row = csv!.rows.find((x) => x.cells['ইনভয়েস নম্বর'] === 'INV-A-001')!;
    assert.match(row.cells['পরিশোধের মাধ্যম'], /বিকাশ/);
    assert.match(row.cells['পরিশোধের মাধ্যম'], /নগদ/);
  });

  test('THE RECEIPT SIGNATURE NEVER LEAVES', async () => {
    // `payment_receipts.signature` is verification material and sits on the
    // same row as the receipt number the export DOES carry.
    const { r } = await exportCsv(tokens.headA);
    assert.doesNotMatch(r.raw, /SIGNATURE-MUST-NOT-EXPORT/, 'a receipt signature was exported');
    assert.doesNotMatch(r.raw, /signature|mfs_transaction|pdf_object_key/i);
    assert.doesNotMatch(r.raw, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i);
  });

  test('one school’s billing never appears in another’s file', async () => {
    const a = await exportCsv(tokens.headA);
    const b = await exportCsv(tokens.headB);
    assert.doesNotMatch(a.r.raw, /INV-B-001|বি-স্কুলের/, 'B’s invoice is in A’s file');
    assert.doesNotMatch(b.r.raw, /INV-A-001|ছাত্র এ/, 'A’s invoice is in B’s file');
  });
});

describe('P11 §22 — who may export the money', { skip }, () => {
  test('the accountant may — this is their surface', async () => {
    // The one role added here and nowhere else. They already read the same
    // rows through the ledger; a finance export the finance person cannot
    // take is a rule with no purpose.
    assert.equal((await exportCsv(tokens.acctA)).r.status, 200);
  });

  test('a student may not export the school’s billing', async () => {
    assert.equal((await exportCsv(tokens.stuA)).r.status, 403);
  });
});
