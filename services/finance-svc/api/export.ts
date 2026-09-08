/**
 * GET /api/v1/finance/export?dataset=fees — data portability, money.  (P11)
 *
 * One row per INVOICE, which is the grain a school reads its own billing in:
 * a bill was raised for a child, some of it was paid, this much is left.
 *
 * ── Money is a NUMBER here, not a formatted string ──────────────────────
 * Every screen in this product shows money through `formatBdt`, which
 * produces "১,৫০০ টাকা" — Bangla digits, a thousands separator and a unit.
 * That is right on a screen and wrong in a spreadsheet: the school's first
 * act on a fees export is to sum a column, and `১,৫০০ টাকা` is text that
 * sums to zero.
 *
 * So the amounts are plain decimals (`1500.00`) and the currency is its own
 * column. `csvCell` leaves a purely numeric value untouched, so the sheet
 * gets numbers it can add. This is the one place the display contract is
 * deliberately NOT followed, and the reason is that the file is not a
 * display.
 *
 * ── What is deliberately absent ─────────────────────────────────────────
 * `payment_receipts` carries `signature`, `mfs_transaction_id` and
 * `pdf_object_key`. The first is verification material, the second belongs
 * to the payment gateway, and the third is an internal storage key for an
 * object store that does not exist yet (B-17). §13 forbids all three:
 * "Do NOT expose secrets or internal accounting implementation details."
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleCsvExport, cell, type ExportClient, type ExportDataset,
} from '../../../packages/server-core/src/export-dataset.ts';

/**
 * Who may export the school's money.
 *
 * The accountant is added to the three the other services allow, and only
 * here: the fee ledger is their surface, and a finance export that the
 * person who runs finance cannot take is a rule with no purpose. They gain
 * nothing they cannot already read — `MAY_SEE_FEES` has admitted them since
 * R-3.
 */
const EXPORT_ROLES = ['principal', 'school_owner', 'it_admin', 'accountant'];

/** `invoice_status` — the enum's seven values. */
const INVOICE_BN: Record<string, string> = {
  draft: 'খসড়া', issued: 'ইস্যু করা', partly_paid: 'আংশিক পরিশোধিত',
  paid: 'পরিশোধিত', overdue: 'বকেয়া', waived: 'মওকুফ', cancelled: 'বাতিল',
};

const METHOD_BN: Record<string, string> = {
  cash: 'নগদ', bkash: 'বিকাশ', nagad: 'নগদ (Nagad)', rocket: 'রকেট',
  bank: 'ব্যাংক', cheque: 'চেক', card: 'কার্ড', other: 'অন্যান্য',
};

const bnOf = (map: Record<string, string>, v: string | null): string =>
  v ? (map[v] ?? v) : '';

interface FeeRow {
  invoice_no: string | null;
  student_code: string | null; student_name: string | null;
  class_name: string | null; section_name: string | null;
  year_label: string | null; billing_period: string | null;
  issued_on: string | null; due_on: string | null;
  subtotal: string | null; waiver_total: string | null; late_fee: string | null;
  total_amount: string | null; paid_amount: string | null;
  balance_amount: string | null;
  currency: string | null; status: string | null;
  heads: string | null;
  receipts: string | null; methods: string | null; last_paid_at: string | null;
  notes: string | null;
}

const fees: ExportDataset<FeeRow> = {
  headers: [
    'ইনভয়েস নম্বর', 'শিক্ষার্থী আইডি', 'শিক্ষার্থীর নাম', 'শ্রেণি', 'শাখা',
    'শিক্ষাবর্ষ', 'বিলিং সময়কাল', 'ইস্যুর তারিখ', 'শেষ তারিখ',
    'উপমোট', 'মওকুফ', 'বিলম্ব ফি', 'মোট', 'পরিশোধিত', 'বকেয়া', 'মুদ্রা',
    'অবস্থা', 'ফি খাত', 'রসিদ নম্বর', 'পরিশোধের মাধ্যম', 'সর্বশেষ পরিশোধ',
    'মন্তব্য',
  ],

  /**
   * Every invoice, with what it was for and what has been paid against it.
   *
   * The fee HEADS and the RECEIPTS are aggregated into their own cells
   * rather than joined. A three-line invoice paid in two instalments is
   * still ONE bill; joining either would emit six rows for it and make the
   * "মোট" column sum to six times the school's actual billing — a number a
   * head teacher would act on.
   *
   * Cancelled and waived invoices are included, with their status named.
   * They are part of the school's billing history and an export that showed
   * only live bills would not reconcile against their own ledger.
   */
  async select(client: ExportClient): Promise<FeeRow[]> {
    const { rows } = await client.query<FeeRow>(
      `SELECT i.invoice_no,
              sp.student_code,
              u.full_name_bn      AS student_name,
              c.name_bn           AS class_name,
              s.name              AS section_name,
              ay.label            AS year_label,
              i.billing_period,
              i.issued_on::text   AS issued_on,
              i.due_on::text      AS due_on,
              i.subtotal::text, i.waiver_total::text, i.late_fee::text,
              i.total_amount::text, i.paid_amount::text, i.balance_amount::text,
              i.currency, i.status::text AS status,
              (SELECT string_agg(COALESCE(fh.name_bn, il.description_bn)
                                 || ' (' || il.net_amount::text || ')', '; '
                                 ORDER BY fh.name_bn)
                 FROM invoice_lines il
                 LEFT JOIN fee_heads fh ON fh.id = il.fee_head_id
                WHERE il.invoice_id = i.id) AS heads,
              (SELECT string_agg(pr.receipt_no, '; ' ORDER BY pr.issued_at)
                 FROM payment_receipts pr WHERE pr.invoice_id = i.id) AS receipts,
              (SELECT string_agg(DISTINCT pr.method::text, '; ')
                 FROM payment_receipts pr WHERE pr.invoice_id = i.id) AS methods,
              (SELECT max(pr.issued_at)::text
                 FROM payment_receipts pr WHERE pr.invoice_id = i.id) AS last_paid_at,
              i.notes
         FROM invoices i
         JOIN users u ON u.id = i.student_id AND u.deleted_at IS NULL
         LEFT JOIN student_profiles sp ON sp.user_id = i.student_id
         LEFT JOIN sections s ON s.id = i.section_id
         LEFT JOIN classes  c ON c.id = s.class_id
         LEFT JOIN academic_years ay ON ay.id = i.academic_year_id
        ORDER BY i.issued_on DESC, i.invoice_no`);
    return rows;
  },

  row: (r) => [
    cell(r.invoice_no), cell(r.student_code), cell(r.student_name),
    cell(r.class_name), cell(r.section_name), cell(r.year_label),
    cell(r.billing_period), cell(r.issued_on), cell(r.due_on),
    // Plain decimals — see the file header. A spreadsheet must be able to
    // add these.
    cell(r.subtotal), cell(r.waiver_total), cell(r.late_fee),
    cell(r.total_amount), cell(r.paid_amount), cell(r.balance_amount),
    cell(r.currency ?? 'BDT'),
    bnOf(INVOICE_BN, r.status),
    cell(r.heads), cell(r.receipts),
    (r.methods ?? '').split('; ').filter(Boolean)
      .map((m) => bnOf(METHOD_BN, m)).join('; '),
    cell(r.last_paid_at), cell(r.notes),
  ],
};

export default async function handler(
  req: IncomingMessage, res: ServerResponse,
): Promise<void> {
  return handleCsvExport(req, res, {
    roles: EXPORT_ROLES,
    datasets: { fees } as unknown as Record<string, ExportDataset<never>>,
  });
}
