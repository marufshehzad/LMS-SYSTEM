/**
 * GET /api/v1/ops/export?dataset=… — data portability, ops side.  (P11)
 *
 * The datasets this service owns: the people who work at the school, the
 * families attached to its students, and (later in §30) its structure,
 * notices and activity history.
 *
 * The flow — authorization, tenant resolution, streaming, the audit entry —
 * lives in `handleCsvExport`. A dataset here is a declaration and is never
 * handed the chance to read a tenant from the request. The queries carry no
 * tenant predicate at all: `withTenant` sets `app.current_tenant()` and RLS
 * decides the rows.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleCsvExport, cell, type ExportClient, type ExportDataset,
} from '../../../packages/server-core/src/export-dataset.ts';

/**
 * Who may export the institution.
 *
 * The same three the academics exporter uses, and the same three that already
 * read the audit trail (`AUDIT_READERS`). Taking the school out as a file is
 * a head-teacher and IT-admin act; nobody gains data because export exists.
 */
const EXPORT_ROLES = ['principal', 'school_owner', 'it_admin'];

/** A code the school has never seen is shown as itself, not as blank. */
const bnOf = (map: Record<string, string>, v: string | null): string =>
  v ? (map[v] ?? v) : '';

const ROLE_BN: Record<string, string> = {
  principal: 'প্রধান শিক্ষক', school_owner: 'প্রতিষ্ঠান কর্তৃপক্ষ',
  academic_coordinator: 'একাডেমিক সমন্বয়ক', it_admin: 'আইটি অ্যাডমিন',
  accountant: 'হিসাবরক্ষক', class_teacher: 'শ্রেণি শিক্ষক',
  subject_teacher: 'বিষয় শিক্ষক', dept_head: 'বিভাগীয় প্রধান',
  guardian: 'অভিভাবক', student: 'শিক্ষার্থী',
};

/**
 * `user_status` — the enum's five values, checked against the type rather
 * than guessed. The first draft carried `inactive`, which is not a value
 * this enum has, and omitted `invited` and `deleted`, which are.
 */
const USER_STATUS_BN: Record<string, string> = {
  invited: 'আমন্ত্রিত', active: 'কর্মরত', suspended: 'স্থগিত',
  left: 'চলে গেছেন', deleted: 'মুছে ফেলা',
};

const RELATION_BN: Record<string, string> = {
  father: 'পিতা', mother: 'মাতা', guardian: 'অভিভাবক', brother: 'ভাই',
  sister: 'বোন', uncle: 'চাচা/মামা', aunt: 'চাচি/মামি', other: 'অন্যান্য',
};

/** Bangla for a boolean the school reads as a policy, not a flag. */
const yesNo = (v: boolean | null): string => (v === null ? '' : v ? 'হ্যাঁ' : 'না');

/* ── teachers and staff (§8) ──────────────────────────────────────────── */

interface StaffRow {
  employee_code: string | null;
  full_name_bn: string | null; full_name_en: string | null;
  phone: string | null; email: string | null;
  designation_bn: string | null;
  roles: string | null;
  joining_date: string | null; employment_type: string | null;
  highest_degree: string | null;
  status: string | null;
  sections_led: string | null;
  subjects_taught: string | null;
}

const teachers: ExportDataset<StaffRow> = {
  headers: [
    'কর্মচারী আইডি', 'নাম', 'নাম (ইংরেজি)', 'মোবাইল', 'ইমেইল', 'পদবি',
    'ভূমিকা', 'যোগদানের তারিখ', 'নিয়োগের ধরন', 'সর্বোচ্চ ডিগ্রি', 'অবস্থা',
    'শ্রেণি শিক্ষক', 'যে বিষয় পড়ান',
  ],

  /**
   * Everyone who works at the school, with what they do.
   *
   * ── Who counts as staff ───────────────────────────────────────────────
   * Anyone holding a role that is not `student` or `guardian`. Not "everyone
   * with a `staff_profiles` row": that table is optional — a principal
   * created through the onboarding wizard has a `user_roles` row and no
   * profile — so keying off it would silently omit the head teacher from
   * the school's list of its own staff.
   *
   * ── Roles are aggregated, not joined ──────────────────────────────────
   * A teacher who is also a department head has two `user_roles` rows. A
   * plain join emits them twice; `string_agg` puts both in one cell, which
   * is what a school means by "their role".
   *
   * ── What is deliberately absent ───────────────────────────────────────
   * `bank_account_ciphertext` is on `staff_profiles` and is never selected.
   * Nor is anything from `users` that is encrypted or hashed. §8 asks for
   * "contact where permitted", and the three roles allowed to run this
   * export are exactly the three `MAY_SEE_CONTACT` already admits, so the
   * phone is theirs to see.
   */
  async select(client: ExportClient): Promise<StaffRow[]> {
    const { rows } = await client.query<StaffRow>(
      `SELECT sp.employee_code,
              u.full_name_bn, u.full_name_en,
              u.phone_e164 AS phone, u.email,
              sp.designation_bn,
              (SELECT string_agg(DISTINCT ur2.role_code, ' / ' ORDER BY ur2.role_code)
                 FROM user_roles ur2
                WHERE ur2.user_id = u.id) AS roles,
              sp.joining_date::text AS joining_date,
              sp.employment_type, sp.highest_degree,
              u.status::text AS status,
              (SELECT string_agg(c.name_bn || ' ' || s.name, ', ' ORDER BY c.name_bn, s.name)
                 FROM sections s JOIN classes c ON c.id = s.class_id
                WHERE s.class_teacher_id = u.id) AS sections_led,
              (SELECT string_agg(DISTINCT sub.name_bn, ', ' ORDER BY sub.name_bn)
                 FROM section_subject_teachers sst
                 JOIN subjects sub ON sub.id = sst.subject_id
                WHERE sst.teacher_id = u.id) AS subjects_taught
         FROM users u
         LEFT JOIN staff_profiles sp ON sp.user_id = u.id
        WHERE u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_roles ur
                       WHERE ur.user_id = u.id
                         AND ur.role_code NOT IN ('student', 'guardian'))
        ORDER BY u.full_name_bn`);
    return rows;
  },

  row: (r) => [
    cell(r.employee_code), cell(r.full_name_bn), cell(r.full_name_en),
    cell(r.phone), cell(r.email), cell(r.designation_bn),
    // Each code translated on its own, so a two-role person reads as two
    // Bangla words rather than one untranslated string.
    (r.roles ?? '').split(' / ').filter(Boolean)
      .map((c) => bnOf(ROLE_BN, c)).join(' / '),
    cell(r.joining_date), cell(r.employment_type), cell(r.highest_degree),
    bnOf(USER_STATUS_BN, r.status),
    cell(r.sections_led), cell(r.subjects_taught),
  ],
};

/* ── guardians (§9) ───────────────────────────────────────────────────── */

interface GuardianRow {
  full_name_bn: string | null; full_name_en: string | null;
  phone: string | null; email: string | null;
  student_code: string | null; student_name: string | null;
  class_name: string | null; section_name: string | null;
  relation: string | null;
  is_primary: boolean | null;
  receives_sms: boolean | null; can_pay_fees: boolean | null;
  status: string | null;
}

const guardians: ExportDataset<GuardianRow> = {
  headers: [
    'অভিভাবকের নাম', 'নাম (ইংরেজি)', 'মোবাইল', 'ইমেইল',
    'শিক্ষার্থী আইডি', 'শিক্ষার্থীর নাম', 'শ্রেণি', 'শাখা',
    'সম্পর্ক', 'প্রধান অভিভাবক', 'এসএমএস পান', 'ফি দিতে পারেন', 'অবস্থা',
  ],

  /**
   * One row per LINK, not per guardian.
   *
   * A guardian with three children is three rows, and that is the shape the
   * data actually has — `guardianships` is the relationship table, and
   * collapsing it to one row per adult would lose which permissions apply to
   * which child. `receives_sms` and `can_pay_fees` are per link.
   *
   * ── Revoked links are INCLUDED, and say so ────────────────────────────
   * B-7 made a guardianship endable rather than deletable, precisely because
   * the record of who could act for a child during a period must survive.
   * An export that silently dropped revoked rows would hand the school a
   * history with the endings removed. The status column carries the answer.
   */
  async select(client: ExportClient): Promise<GuardianRow[]> {
    const { rows } = await client.query<GuardianRow>(
      `SELECT g.full_name_bn, g.full_name_en,
              g.phone_e164 AS phone, g.email,
              sp.student_code,
              st.full_name_bn AS student_name,
              c.name_bn       AS class_name,
              s.name          AS section_name,
              gs.relation, gs.is_primary, gs.receives_sms, gs.can_pay_fees,
              CASE WHEN gs.revoked_at IS NULL THEN 'active' ELSE 'revoked' END AS status
         FROM guardianships gs
         JOIN users g  ON g.id  = gs.guardian_id AND g.deleted_at IS NULL
         JOIN users st ON st.id = gs.student_id  AND st.deleted_at IS NULL
         LEFT JOIN student_profiles sp ON sp.user_id = gs.student_id
         LEFT JOIN LATERAL (
           SELECT en.section_id FROM enrolments en
             JOIN academic_years y ON y.id = en.academic_year_id
            WHERE en.student_id = gs.student_id
            ORDER BY y.is_current DESC, y.starts_on DESC
            LIMIT 1
         ) e ON TRUE
         LEFT JOIN sections s ON s.id = e.section_id
         LEFT JOIN classes  c ON c.id = s.class_id
        ORDER BY g.full_name_bn, st.full_name_bn`);
    return rows;
  },

  row: (r) => [
    cell(r.full_name_bn), cell(r.full_name_en), cell(r.phone), cell(r.email),
    cell(r.student_code), cell(r.student_name),
    cell(r.class_name), cell(r.section_name),
    bnOf(RELATION_BN, r.relation),
    yesNo(r.is_primary), yesNo(r.receives_sms), yesNo(r.can_pay_fees),
    r.status === 'revoked' ? 'প্রত্যাহৃত' : 'সক্রিয়',
  ],
};

export default async function handler(
  req: IncomingMessage, res: ServerResponse,
): Promise<void> {
  return handleCsvExport(req, res, {
    roles: EXPORT_ROLES,
    datasets: { teachers, guardians } as unknown as Record<string, ExportDataset<never>>,
  });
}
