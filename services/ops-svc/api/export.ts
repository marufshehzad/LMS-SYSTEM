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
// The SAME redactor the audit VIEWER uses. A second one written beside it
// is how a masked phone stops being masked in one of the two places — and
// the export is the copy that leaves the building.
import { redact } from './audit.ts';

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

const STREAM_BN: Record<string, string> = {
  bangla_medium: 'বাংলা মাধ্যম', english_version: 'ইংরেজি ভার্সন',
  english_medium: 'ইংরেজি মাধ্যম', madrasah: 'মাদ্রাসা', technical: 'কারিগরি',
};

const SHIFT_BN: Record<string, string> = {
  morning: 'সকাল', day: 'দিবা', evening: 'সন্ধ্যা', single: 'একক',
};

/** `notice_status` — the enum's four values. */
const NOTICE_STATUS_BN: Record<string, string> = {
  draft: 'খসড়া', scheduled: 'নির্ধারিত', published: 'প্রকাশিত', archived: 'সংরক্ষিত',
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


/* ── structure (§10) ──────────────────────────────────────────────────── */

interface StructureRow {
  year_label: string | null; year_start: string | null; year_end: string | null;
  is_current: boolean | null;
  level_no: number | null; class_bn: string | null; class_en: string | null;
  stream: string | null; group_name: string | null;
  section_name: string | null; shift: string | null;
  capacity: number | null; student_count: number | null;
  class_teacher: string | null; room_name: string | null;
}

const structure: ExportDataset<StructureRow> = {
  headers: [
    'শিক্ষাবর্ষ', 'বর্ষ শুরু', 'বর্ষ শেষ', 'চলতি বর্ষ',
    'শ্রেণি নম্বর', 'শ্রেণি', 'শ্রেণি (ইংরেজি)', 'শাখা/স্ট্রিম', 'গ্রুপ',
    'সেকশন', 'শিফট', 'ধারণক্ষমতা', 'বর্তমান শিক্ষার্থী',
    'শ্রেণি শিক্ষক', 'কক্ষ',
  ],

  /**
   * The school's shape, one row per SECTION.
   *
   * §10 asks for years, classes, sections, groups and streams and for the
   * relationships to survive. A section is the leaf of that hierarchy, so a
   * section-centric sheet carries every level above it on the same line —
   * which is what makes it reconstructible in a spreadsheet, where a reader
   * cannot follow a foreign key.
   *
   * Denormalised on purpose. Five separate CSVs would be normalised, exactly
   * reconstructible, and useless to the head teacher who opens one to see
   * what their school looks like.
   *
   * A year with no classes yet still appears: this is the file a school
   * checks its own setup against, and an empty year is a fact about the
   * setup rather than a row to hide.
   */
  async select(client: ExportClient): Promise<StructureRow[]> {
    const { rows } = await client.query<StructureRow>(
      `SELECT y.label            AS year_label,
              y.starts_on::text  AS year_start,
              y.ends_on::text    AS year_end,
              y.is_current,
              c.level_no,
              c.name_bn          AS class_bn,
              c.name_en          AS class_en,
              c.stream::text     AS stream,
              c."group"          AS group_name,
              s.name             AS section_name,
              s.shift::text      AS shift,
              s.capacity, s.student_count,
              t.full_name_bn     AS class_teacher,
              r.name_bn          AS room_name
         FROM academic_years y
         LEFT JOIN sections s ON s.academic_year_id = y.id
         LEFT JOIN classes  c ON c.id = s.class_id
         LEFT JOIN users    t ON t.id = s.class_teacher_id AND t.deleted_at IS NULL
         LEFT JOIN rooms    r ON r.id = s.home_room_id
        ORDER BY y.starts_on DESC, c.level_no NULLS LAST, s.name NULLS LAST`);
    return rows;
  },

  row: (r) => [
    cell(r.year_label), cell(r.year_start), cell(r.year_end), yesNo(r.is_current),
    cell(r.level_no), cell(r.class_bn), cell(r.class_en),
    bnOf(STREAM_BN, r.stream), cell(r.group_name),
    cell(r.section_name), bnOf(SHIFT_BN, r.shift),
    cell(r.capacity), cell(r.student_count),
    cell(r.class_teacher), cell(r.room_name),
  ],
};

/* ── notices (§14) ────────────────────────────────────────────────────── */

interface NoticeRow {
  title: string | null; body: string | null;
  category: string | null;
  audience_type: string | null; audience_count: number | null;
  status: string | null;
  send_sms: boolean | null; send_inapp: boolean | null;
  recipient_count: number | null;
  publish_at: string | null; published_at: string | null;
  created_at: string | null; created_by_name: string | null;
}

const notices: ExportDataset<NoticeRow> = {
  headers: [
    'শিরোনাম', 'বিবরণ', 'ধরন', 'কারা পাবে', 'অবস্থা',
    'এসএমএস', 'অ্যাপে', 'প্রাপকের সংখ্যা',
    'প্রকাশের সময়', 'প্রকাশিত হয়েছে', 'তৈরি', 'তৈরি করেছেন',
  ],

  /**
   * Every notice the school has written, including the drafts.
   *
   * A draft is the school's own text and belongs to them; an export that
   * kept only what was published would silently drop work in progress.
   *
   * The BODY is included in full. It is the notice — a "notices export"
   * carrying titles only would be an index, not the content, and the point
   * of portability is that the school keeps what they wrote. `csvCell`
   * handles the line breaks a notice body is full of.
   */
  async select(client: ExportClient): Promise<NoticeRow[]> {
    const { rows } = await client.query<NoticeRow>(
      `SELECT n.title, n.body, n.category::text AS category,
              n.audience->>'type'   AS audience_type,
              CASE WHEN jsonb_typeof(n.audience->'ids') = 'array'
                   THEN jsonb_array_length(n.audience->'ids') END AS audience_count,
              n.status::text        AS status,
              n.send_sms, n.send_inapp, n.recipient_count,
              n.publish_at::text    AS publish_at,
              n.published_at::text  AS published_at,
              n.created_at::text    AS created_at,
              u.full_name_bn        AS created_by_name
         FROM notices n
         LEFT JOIN users u ON u.id = n.created_by AND u.deleted_at IS NULL
        ORDER BY n.created_at DESC`);
    return rows;
  },

  row: (r) => [
    cell(r.title), cell(r.body), cell(r.category),
    // NOT the raw `audience` jsonb. It is `{"ids": [...], "type": "section"}`
    // — the ids are uuids, and §6 keeps uuids out of a file that gets mailed
    // between offices. The school is told WHAT kind of audience and HOW MANY,
    // which is the part they can act on.
    audienceCell(r.audience_type, r.audience_count),
    bnOf(NOTICE_STATUS_BN, r.status),
    yesNo(r.send_sms), yesNo(r.send_inapp), cell(r.recipient_count),
    cell(r.publish_at), cell(r.published_at), cell(r.created_at),
    cell(r.created_by_name),
  ],
};

/* ── audit / activity history (§15 — closes B-11's export half) ───────── */

interface AuditRow {
  created_at: string | null;
  actor_name: string | null; actor_role: string | null;
  action: string | null; entity_type: string | null;
  before_state: unknown; after_state: unknown;
}

const audit: ExportDataset<AuditRow> = {
  headers: [
    'সময়', 'কে', 'ভূমিকা', 'কাজ', 'কীসের উপর', 'আগে', 'পরে',
  ],

  /**
   * The school's own activity history.  B-11, export half.
   *
   * B-11 paired "audit export" with "actor-name resolution" and the second
   * half was already false when the row was written — `audit.ts` has
   * resolved names since 2026-08-29. Only the export was ever missing, and
   * this is it.
   *
   * ── The redaction is the viewer's, not a copy of it ───────────────────
   * `before_state` and `after_state` are arbitrary JSON, and some of it is
   * a phone number or a date of birth. The audit VIEWER masks those by key
   * name; this export imports that same function rather than restating the
   * rule, because the file is the copy that leaves the building and a
   * second redactor is how the two drift apart.
   *
   * The entity ID is deliberately not a column: it is a uuid, it means
   * nothing to a school, and §6 keeps uuids out of exports.
   */
  async select(client: ExportClient): Promise<AuditRow[]> {
    const { rows } = await client.query<AuditRow>(
      `SELECT a.created_at::text AS created_at,
              u.full_name_bn     AS actor_name,
              a.actor_role, a.action, a.entity_type,
              a.before_state, a.after_state
         FROM audit.activity_log a
         LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.created_at DESC`);
    return rows;
  },

  row: (r) => [
    cell(r.created_at),
    // "নাম নেই" rather than blank: an empty cell reads as "nobody did this".
    r.actor_name ? r.actor_name : 'নাম নেই',
    bnOf(ROLE_BN, r.actor_role),
    cell(r.action), cell(r.entity_type),
    jsonCell(r.before_state), jsonCell(r.after_state),
  ],
};

/** `audience.type` in the school's words. */
const AUDIENCE_BN: Record<string, string> = {
  all: 'সবাই', section: 'নির্দিষ্ট সেকশন', class: 'নির্দিষ্ট শ্রেণি',
  role: 'নির্দিষ্ট ভূমিকা', user: 'নির্দিষ্ট ব্যক্তি', exam: 'পরীক্ষা-সংক্রান্ত',
};

function audienceCell(type: string | null, count: number | null): string {
  if (!type) return '';
  const label = AUDIENCE_BN[type] ?? type;
  return count === null || count === undefined ? label : `${label} (${count})`;
}

/**
 * A JSON state column, redacted and flattened to something readable.
 *
 * `{"a":1}` in a spreadsheet cell is not information a head teacher can
 * use, so the object becomes `key: value` pairs. The redaction runs FIRST —
 * flattening a masked value is fine, masking a flattened string is not,
 * because by then the key that identified it as a phone number is gone.
 */
/**
 * Internal identifiers, masked by SHAPE rather than by key name.
 *
 * The viewer's `redact` masks by key (`phone`, `nid`, `email`…), which is
 * the right rule for the values it was written for and does not cover this:
 * an audit state carries `teacherId`, `sectionId`, `roomId` and their
 * values are uuids. Nothing in the key name says "identifier" — `teacherId`
 * looks as innocuous as `reason` — so a name-based rule cannot catch them.
 *
 * Found by fetching a real audit export in a browser and grepping the bytes,
 * not by a test: the suite's own seeded row had no uuid in it, so every
 * assertion passed against a file that was clean only because the fixture
 * was. §6 keeps uuids out of exports, and this is the last place one hid.
 *
 * `•••` rather than dropping the pair, so the school can still see THAT a
 * teacher was involved in the change without being handed our primary key.
 */
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const safe = redact(v);
  if (typeof safe !== 'object') return String(safe);
  return Object.entries(safe as Record<string, unknown>)
    .map(([k, val]) => {
      const text = typeof val === 'object' && val !== null
        ? JSON.stringify(val) : String(val);
      // Applied to the rendered text, so a uuid nested inside a stringified
      // object is caught as well as a bare one.
      return `${k}: ${text.replace(new RegExp(UUID_VALUE.source, 'gi'), '•••')}`;
    })
    .join('; ');
}


/* ── offboarding (§16) ────────────────────────────────────────────────── */

interface OffboardRow {
  dataset: string; title: string; rows: string; where: string;
}

/**
 * "The school is leaving." — what there is, how much, and where to get it.
 *
 * ── Why a manifest and not an archive ───────────────────────────────────
 * §0's contract is a streamed CSV per dataset, and §16 asks for the
 * offboarding case to be "explicit and safe" with "deterministic contents"
 * — not for a second mechanism. So this is the INDEX to the exports rather
 * than a bundle of them: one row per dataset, its row count as it stands
 * right now, and the exact address to fetch it from.
 *
 * That buys three things an archive would not. The counts are a checklist a
 * departing school can tick off against what they actually received. The
 * addresses are the same authorized endpoints, so nothing about offboarding
 * gets its own weaker path. And no part of it needs object storage, which
 * is stubbed (B-17) — assembling a zip in memory to look complete is
 * precisely what the brief forbids.
 *
 * ── It exports. It does not deactivate. ─────────────────────────────────
 * §16 is explicit that export and suspension are separate operations, and
 * nothing here writes to `tenants`, `tenant_operations` or any lifecycle
 * column. A school can take their data and stay; a school can be suspended
 * and still take their data. Coupling the two would mean a head teacher
 * asking for a copy of their own roster and losing their login.
 *
 * ── The counts are the counts, at the moment they were asked for ────────
 * They are read in the same transaction as one another, so the manifest is
 * internally consistent. It is not a promise about a file fetched an hour
 * later — a school that enrols a student between the manifest and the
 * download will find one more row than the manifest said, and that is the
 * truth rather than a defect.
 */
const offboarding: ExportDataset<OffboardRow> = {
  headers: ['ডেটাসেট', 'কী আছে', 'বর্তমান সারি', 'কোথা থেকে নামাবেন'],

  async select(client: ExportClient): Promise<OffboardRow[]> {
    const { rows } = await client.query<OffboardRow>(
      `SELECT * FROM (VALUES
         ('students',   'শিক্ষার্থীর তালিকা ও ভর্তির তথ্য',
          (SELECT count(*) FROM student_profiles)::text,
          '/api/v1/academics/export?dataset=students'),
         ('teachers',   'শিক্ষক ও কর্মীর তালিকা',
          (SELECT count(*) FROM users u WHERE u.deleted_at IS NULL
             AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
                          AND ur.role_code NOT IN ('student','guardian')))::text,
          '/api/v1/ops/export?dataset=teachers'),
         ('guardians',  'অভিভাবক ও সম্পর্ক',
          (SELECT count(*) FROM guardianships)::text,
          '/api/v1/ops/export?dataset=guardians'),
         ('structure',  'শিক্ষাবর্ষ, শ্রেণি ও সেকশন',
          (SELECT count(*) FROM sections)::text,
          '/api/v1/ops/export?dataset=structure'),
         ('attendance', 'হাজিরার সব রেকর্ড',
          (SELECT count(*) FROM attendance_records)::text,
          '/api/v1/academics/export?dataset=attendance'),
         ('results',    'পরীক্ষার নম্বর ও ফলাফল',
          (SELECT count(*) FROM exam_marks)::text,
          '/api/v1/academics/export?dataset=results'),
         ('fees',       'ইনভয়েস, পরিশোধ ও বকেয়া',
          (SELECT count(*) FROM invoices)::text,
          '/api/v1/finance/export?dataset=fees'),
         ('notices',    'প্রতিষ্ঠানের সব নোটিশ',
          (SELECT count(*) FROM notices)::text,
          '/api/v1/ops/export?dataset=notices'),
         ('audit',      'কে কখন কী পরিবর্তন করেছেন',
          (SELECT count(*) FROM audit.activity_log)::text,
          '/api/v1/ops/export?dataset=audit')
       ) AS t(dataset, title, rows, where_url)
       ORDER BY 1`);
    return rows.map((r) => ({
      dataset: (r as unknown as Record<string, string>).dataset,
      title: (r as unknown as Record<string, string>).title,
      rows: (r as unknown as Record<string, string>).rows,
      where: (r as unknown as Record<string, string>).where_url,
    }));
  },

  row: (r) => [cell(r.dataset), cell(r.title), cell(r.rows), cell(r.where)],
};

export default async function handler(
  req: IncomingMessage, res: ServerResponse,
): Promise<void> {
  return handleCsvExport(req, res, {
    roles: EXPORT_ROLES,
    datasets: {
      teachers, guardians, structure, notices, audit, offboarding,
    } as unknown as Record<string, ExportDataset<never>>,
  });
}
