/**
 * GET /api/v1/academics/export?dataset=students — data portability.  (P11)
 *
 * The Master Plan's whole statement of P11 is one sentence: *"portability.
 * Data export, which does not exist in any form today and is the clearest
 * customer-trust gap."* Until this file, the only file this product ever
 * handed a school was the error list from a FAILED import — a list of their
 * own mistakes, and nothing else.
 *
 * ── The contract, decided before any of it was written ──────────────────
 * A streamed CSV per dataset, not one archive. Three reasons, all from this
 * repository rather than from preference:
 *
 *   1. Object storage is stubbed (B-17) and returns 503. An archive has to
 *      be assembled somewhere, and the only honest somewhere today is
 *      memory. Adding a storage provider to make export "look complete" is
 *      exactly what the brief forbids.
 *   2. Nothing in the Master Plan asks for an archive. It asks for export.
 *   3. A CSV opens in the software a Bangladeshi school office actually
 *      runs. A zip of nine CSVs is one more step between a head teacher and
 *      their data, and the step is where people stop.
 *
 * The offboarding case — "the school is leaving" — is served by a manifest
 * over these same endpoints rather than by a second mechanism. Same rows,
 * same authorization, one audit entry per dataset either way.
 *
 * ── Where the tenant comes from ─────────────────────────────────────────
 * `claims.tid`, the signed token, and nowhere else. Not the query string,
 * not the body, not a header, not the filename. This is the first feature
 * whose output leaves as a file, so the isolation is worth stating: the
 * query below has no tenant predicate at all — `withTenant` sets
 * `app.current_tenant()` and RLS answers. A caller who forges a tenant id
 * changes nothing, because nothing reads it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleCsvExport, cell, type ExportClient, type ExportDataset,
} from '../../../packages/server-core/src/export-dataset.ts';

/**
 * Who may export the institution.
 *
 * Narrower than who may READ the same rows on a screen, deliberately. A
 * class teacher reads their own section's roster all day; that is their job.
 * Taking the whole school out as a file is a different act with a different
 * blast radius, and §22's answer is the head and the IT admin. Nobody gains
 * data because export exists.
 */
const EXPORT_ROLES = ['principal', 'school_owner', 'it_admin'];

/* ── Bangla vocabularies ──────────────────────────────────────────────── */

/** `enrolments.status` — the CHECK constraint's five words, in Bangla. */
const ENROLMENT_BN: Record<string, string> = {
  active: 'সক্রিয়', transferred: 'স্থানান্তরিত', left: 'চলে গেছে',
  promoted: 'উত্তীর্ণ', detained: 'অকৃতকার্য',
};

/** `student_profiles.lifecycle_status` — a different six-word vocabulary. */
const LIFECYCLE_BN: Record<string, string> = {
  enrolled: 'ভর্তি', promoted: 'পরবর্তী শ্রেণিতে', transferred_out: 'ছাড়পত্র নিয়েছে',
  dropped_out: 'ঝরে পড়েছে', graduated: 'উত্তীর্ণ', alumni: 'প্রাক্তন',
};

const GENDER_BN: Record<string, string> = {
  male: 'ছেলে', female: 'মেয়ে', other: 'অন্যান্য',
};

const SHIFT_BN: Record<string, string> = {
  morning: 'সকাল', day: 'দিবা', evening: 'সন্ধ্যা', single: 'একক',
};

/** A code the school has never seen is shown as itself, not as blank. */
const bnOf = (map: Record<string, string>, v: string | null): string =>
  v ? (map[v] ?? v) : '';


/** `attendance_status` — the enum's five values. */
const ATTENDANCE_BN: Record<string, string> = {
  present: 'উপস্থিত', absent: 'অনুপস্থিত', late: 'দেরিতে',
  excused: 'ছুটি মঞ্জুর', half_day: 'অর্ধদিবস',
};

/** `exam_status` — the enum's six values. */
const EXAM_STATUS_BN: Record<string, string> = {
  planned: 'পরিকল্পিত', ongoing: 'চলমান', marking: 'নম্বর দেওয়া হচ্ছে',
  moderation: 'যাচাই চলছে', published: 'প্রকাশিত', locked: 'চূড়ান্ত',
};

/* ── students ─────────────────────────────────────────────────────────── */

interface StudentExportRow {
  student_code: string | null;
  full_name_bn: string | null;
  full_name_en: string | null;
  father_name_bn: string | null;
  mother_name_bn: string | null;
  date_of_birth: string | null;
  gender: string | null;
  class_name: string | null;
  section_name: string | null;
  roll_no: number | null;
  shift: string | null;
  year_label: string | null;
  admission_date: string | null;
  board_registration_no: string | null;
  board_roll_no: string | null;
  blood_group: string | null;
  enrolment_status: string | null;
  lifecycle_status: string | null;
}

/**
 * Column headings, in the school's own language.
 *
 * A head teacher opens this in Excel and has to recognise their school. No
 * `user_id`, no `section_id`, no `tenant_id` — a uuid tells a school nothing
 * and tells anyone who obtains the file something about our internals. The
 * student's own code is the identifier that means something on both sides,
 * and it is the one the school already prints on admit cards.
 *
 * TWO status columns, because there are two facts and they use different
 * words. The first draft COALESCEd them, which meant a student with no
 * current enrolment displayed their LIFECYCLE word under a heading every
 * other row used for enrolment — and the two vocabularies even share
 * "promoted" with different meanings.
 */
const STUDENT_HEADERS = [
  'শিক্ষার্থী আইডি', 'নাম', 'নাম (ইংরেজি)', 'পিতার নাম', 'মাতার নাম',
  'জন্ম তারিখ', 'লিঙ্গ', 'শ্রেণি', 'শাখা', 'রোল', 'শিফট', 'শিক্ষাবর্ষ',
  'ভর্তির তারিখ', 'বোর্ড রেজিস্ট্রেশন', 'বোর্ড রোল', 'রক্তের গ্রুপ',
  'ভর্তি অবস্থা', 'শিক্ষার্থীর অবস্থা',
];

/**
 * Every student the school has, ONCE, with their most relevant enrolment.
 *
 * ── Why a LATERAL and not a join ────────────────────────────────────────
 * The first version was `LEFT JOIN enrolments e ON e.student_id = sp.user_id
 * AND e.status = 'active'`, which is wrong in a way the development fixture
 * cannot show. `enrolments` is unique on
 * `(tenant_id, academic_year_id, student_id)` — one row per student per
 * YEAR — so nothing stops a student holding an active enrolment in 2025 and
 * another in 2026. That join emits them twice, and an export whose entire
 * purpose is a faithful copy would have quietly doubled some children and
 * not others.
 *
 * It was not caught by a test. The fixture has exactly one active enrolment
 * per student, so the bug was invisible there; it was found by reading the
 * constraint before trusting the row counts.
 *
 * The LATERAL picks exactly one: the current academic year if the student is
 * in it, otherwise their most recent. One row per student, always, which is
 * also what makes the row-count check in the test suite mean something.
 *
 * ── Why LEFT and not INNER ──────────────────────────────────────────────
 * A student admitted but not yet placed in a section, and a student who has
 * left, both still belong to the school and both must appear in the school's
 * own copy of its data. An inner join would silently shorten the file, and a
 * portability export that omits people is worse than none.
 *
 * ── No tenant predicate ─────────────────────────────────────────────────
 * `withTenant` has set `app.current_tenant()` and the RLS policies on
 * `users`, `student_profiles`, `enrolments` and `sections` decide the rows.
 */
const students: ExportDataset<StudentExportRow> = {
  headers: STUDENT_HEADERS,

  async select(client: ExportClient): Promise<StudentExportRow[]> {
    const { rows } = await client.query<StudentExportRow>(
      `SELECT sp.student_code,
            u.full_name_bn, u.full_name_en,
            u.father_name_bn, u.mother_name_bn,
            u.date_of_birth::text        AS date_of_birth,
            u.gender::text               AS gender,
            c.name_bn                    AS class_name,
            s.name                       AS section_name,
            e.roll_no,
            s.shift::text                AS shift,
            ay.label                     AS year_label,
            sp.admission_date::text      AS admission_date,
            sp.board_registration_no,
            sp.board_roll_no,
            sp.blood_group,
            e.status               AS enrolment_status,
            sp.lifecycle_status
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id AND u.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT en.section_id, en.roll_no, en.status, en.academic_year_id
           FROM enrolments en
           JOIN academic_years y ON y.id = en.academic_year_id
          WHERE en.student_id = sp.user_id
          ORDER BY y.is_current DESC, y.starts_on DESC, en.enrolled_on DESC
          LIMIT 1
       ) e ON TRUE
       LEFT JOIN sections s   ON s.id = e.section_id
       LEFT JOIN classes  c   ON c.id = s.class_id
       LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
      ORDER BY c.level_no NULLS LAST, s.name NULLS LAST, e.roll_no NULLS LAST,
               u.full_name_bn`);
    return rows;
  },

  row: (r) => [
    cell(r.student_code), cell(r.full_name_bn), cell(r.full_name_en),
    cell(r.father_name_bn), cell(r.mother_name_bn), cell(r.date_of_birth),
    bnOf(GENDER_BN, r.gender), cell(r.class_name), cell(r.section_name),
    cell(r.roll_no), bnOf(SHIFT_BN, r.shift), cell(r.year_label),
    cell(r.admission_date), cell(r.board_registration_no),
    cell(r.board_roll_no), cell(r.blood_group),
    // An empty enrolment cell is the honest answer for a student who is not
    // currently placed, and it is visibly different from a lifecycle word.
    bnOf(ENROLMENT_BN, r.enrolment_status),
    bnOf(LIFECYCLE_BN, r.lifecycle_status),
  ],
};


/* ── attendance (§11) ─────────────────────────────────────────────────── */

interface AttendanceRow {
  taken_on: string | null;
  class_name: string | null; section_name: string | null;
  period_no: number | null; subject_name: string | null;
  student_code: string | null; student_name: string | null;
  roll_no: number | null;
  status: string | null; minutes_late: number | null; remark: string | null;
  marked_by_name: string | null;
}

const attendance: ExportDataset<AttendanceRow> = {
  headers: [
    'তারিখ', 'শ্রেণি', 'শাখা', 'পিরিয়ড', 'বিষয়',
    'শিক্ষার্থী আইডি', 'শিক্ষার্থীর নাম', 'রোল',
    'অবস্থা', 'কত মিনিট দেরি', 'মন্তব্য', 'যিনি নিয়েছেন',
  ],

  /**
   * The attendance that was actually TAKEN.  §11.
   *
   * Explicitly `attendance_records`, and explicitly NOT the `attendance_
   * sheet` document. That document is the blank-grid paper fallback — its
   * own comment in `documents.ts` says so — and it contains no attendance
   * at all. The FINAL-OWNER audit named exactly this trap: a school handed
   * an "attendance export" that turned out to be an empty printable grid
   * would have been given nothing while believing they had everything.
   *
   * One row per student per session, which is the grain the data has. The
   * session carries the date, period and subject; the record carries what
   * happened to one child.
   */
  async select(client: ExportClient): Promise<AttendanceRow[]> {
    const { rows } = await client.query<AttendanceRow>(
      `SELECT ar.taken_on::text AS taken_on,
              c.name_bn         AS class_name,
              s.name            AS section_name,
              ses.period_no,
              sub.name_bn       AS subject_name,
              sp.student_code,
              u.full_name_bn    AS student_name,
              e.roll_no,
              ar.status::text   AS status,
              ar.minutes_late, ar.remark,
              m.full_name_bn    AS marked_by_name
         FROM attendance_records ar
         JOIN users u ON u.id = ar.student_id AND u.deleted_at IS NULL
         LEFT JOIN student_profiles sp ON sp.user_id = ar.student_id
         LEFT JOIN attendance_sessions ses ON ses.id = ar.session_id
         LEFT JOIN subjects sub ON sub.id = ses.subject_id
         LEFT JOIN sections s ON s.id = ar.section_id
         LEFT JOIN classes  c ON c.id = s.class_id
         LEFT JOIN enrolments e ON e.student_id = ar.student_id
                               AND e.section_id = ar.section_id
         LEFT JOIN users m ON m.id = ar.marked_by AND m.deleted_at IS NULL
        ORDER BY ar.taken_on DESC, c.level_no NULLS LAST, s.name NULLS LAST,
                 e.roll_no NULLS LAST`);
    return rows;
  },

  row: (r) => [
    cell(r.taken_on), cell(r.class_name), cell(r.section_name),
    cell(r.period_no), cell(r.subject_name),
    cell(r.student_code), cell(r.student_name), cell(r.roll_no),
    bnOf(ATTENDANCE_BN, r.status), cell(r.minutes_late), cell(r.remark),
    cell(r.marked_by_name),
  ],
};

/* ── results (§12) ────────────────────────────────────────────────────── */

interface ResultRow {
  year_label: string | null;
  exam_name: string | null; exam_status: string | null;
  exam_published_at: string | null;
  class_name: string | null; section_name: string | null;
  student_code: string | null; student_name: string | null;
  roll_no: number | null;
  subject_name: string | null;
  cq_marks: string | null; mcq_marks: string | null;
  practical_marks: string | null; ca_marks: string | null;
  total_marks: string | null;
  grade_letter: string | null; grade_point: string | null;
  is_absent: boolean | null;
}

const results: ExportDataset<ResultRow> = {
  headers: [
    'শিক্ষাবর্ষ', 'পরীক্ষা', 'পরীক্ষার অবস্থা', 'প্রকাশের তারিখ',
    'শ্রেণি', 'শাখা', 'শিক্ষার্থী আইডি', 'শিক্ষার্থীর নাম', 'রোল',
    'বিষয়', 'সৃজনশীল', 'নৈর্ব্যক্তিক', 'ব্যবহারিক', 'ধারাবাহিক',
    'মোট নম্বর', 'গ্রেড', 'গ্রেড পয়েন্ট', 'অনুপস্থিত',
  ],

  /**
   * Per-subject marks, which is the grain that can be recomputed from.
   *
   * `exam_results` holds the derived per-student totals — GPA, rank,
   * pass/fail — and `exam_marks` holds what was actually entered. §12 asks
   * for "enough structure to reconstruct the result history", and the
   * component marks are that: a GPA can be recomputed from subjects, and
   * subjects cannot be recovered from a GPA.
   *
   * UNPUBLISHED exams are included, with their status named. The marks are
   * the school's own work whether or not a head has pressed publish, and an
   * export that showed only published results would hand back a term with
   * the marking still in progress silently missing.
   */
  async select(client: ExportClient): Promise<ResultRow[]> {
    const { rows } = await client.query<ResultRow>(
      `SELECT ay.label            AS year_label,
              ex.name_bn          AS exam_name,
              ex.status::text     AS exam_status,
              ex.published_at::text AS exam_published_at,
              c.name_bn           AS class_name,
              s.name              AS section_name,
              sp.student_code,
              u.full_name_bn      AS student_name,
              e.roll_no,
              sub.name_bn         AS subject_name,
              em.cq_marks::text, em.mcq_marks::text,
              em.practical_marks::text, em.ca_marks::text,
              em.total_marks::text,
              em.grade_letter, em.grade_point::text,
              em.is_absent
         FROM exam_marks em
         JOIN exam_subjects es ON es.id = em.exam_subject_id
         JOIN exams ex         ON ex.id = es.exam_id
         JOIN users u          ON u.id = em.student_id AND u.deleted_at IS NULL
         LEFT JOIN subjects sub ON sub.id = es.subject_id
         LEFT JOIN student_profiles sp ON sp.user_id = em.student_id
         LEFT JOIN academic_years ay ON ay.id = em.academic_year_id
         LEFT JOIN enrolments e ON e.student_id = em.student_id
                               AND e.academic_year_id = em.academic_year_id
         LEFT JOIN sections s ON s.id = e.section_id
         LEFT JOIN classes  c ON c.id = s.class_id
        ORDER BY ay.label DESC, ex.name_bn, c.level_no NULLS LAST,
                 s.name NULLS LAST, e.roll_no NULLS LAST, sub.name_bn`);
    return rows;
  },

  row: (r) => [
    cell(r.year_label), cell(r.exam_name), bnOf(EXAM_STATUS_BN, r.exam_status),
    cell(r.exam_published_at),
    cell(r.class_name), cell(r.section_name),
    cell(r.student_code), cell(r.student_name), cell(r.roll_no),
    cell(r.subject_name),
    cell(r.cq_marks), cell(r.mcq_marks), cell(r.practical_marks),
    cell(r.ca_marks), cell(r.total_marks),
    cell(r.grade_letter), cell(r.grade_point),
    r.is_absent === null ? '' : (r.is_absent ? 'হ্যাঁ' : 'না'),
  ],
};

export default async function handler(
  req: IncomingMessage, res: ServerResponse,
): Promise<void> {
  return handleCsvExport(req, res, {
    roles: EXPORT_ROLES,
    datasets: {
      students, attendance, results,
    } as unknown as Record<string, ExportDataset<never>>,
  });
}
