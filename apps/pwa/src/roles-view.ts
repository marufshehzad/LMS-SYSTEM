/**
 * Roles & Access (ভূমিকা ও অ্যাক্সেস) — 08 Admin & IT §05.
 *
 * A static, read-only role × capability matrix: ten roles down, five
 * capabilities across, a check where the role is allowed and a minus where it
 * is not. It explains what each role may do; it changes nothing. Permissions
 * are changed on the users screen, and they are enforced by the endpoint
 * guards and RLS on the server — never by what this page, or the sidebar,
 * draws. Nothing is fetched: the view renders synchronously from the
 * precached bundle.
 *
 * The layout is the design's. The VALUES are the server's: the page tells a
 * principal "this page decides what is permitted", so a cell that disagrees
 * with the enforced allowlist is a false security fact, and the drawing does
 * not get to overrule the gate. Each column below names the gate it mirrors.
 * If a gate changes, change the matrix in the same commit.
 */
import { pageHeader, dataTable, badge, roleLabel, el, icon } from './ui/index.ts';
import { formatCount } from '../../../packages/ui-core/src/format.ts';

export interface RolesViewOptions {
  root: HTMLElement;
  doc: Document;
}

type Cap = 'attendance' | 'marks' | 'publish' | 'money' | 'settings';

/**
 * The five questions every role is compared on, in the design's column order.
 * Each is ONE named act, not a whole area — "anything touching money" would
 * tick almost every staff row and stop answering anything.
 *
 * - হাজিরা   mark a student's attendance: `attendance_write_scope` and
 *            `attendance_sessions_scope` WITH CHECK, db/migrations/
 *            010_rls_policies.sql:177-196 — principal, academic_coordinator,
 *            or a teacher of that section (`app.my_section_ids()`, 010:98-108).
 *            Staff attendance (063, MARK_ROLES) is a different register.
 * - নম্বর    enter exam marks: `marks_write_scope`, 010:213-220 — principal,
 *            academic_coordinator, or a teacher of that section.
 * - প্রকাশ   publish results: PUBLISH_ROLES, services/academics-svc/api/
 *            publish.ts:35 — principal, school_owner, academic_coordinator.
 * - টাকা     bill, collect, keep the ledger: BILLING_ROLES and LEDGER_ROLES,
 *            services/finance-svc/api/index.ts:200 and :355; COLLECT_ROLES,
 *            payments.ts:53 — principal, school_owner, accountant. Setting up
 *            fee heads (FEE_ADMIN_ROLES, feestructures.ts:72) is not this act.
 * - সেটিংস   change the school's settings: SETTINGS_ROLES, services/ops-svc/
 *            api/settings.ts:50, mirrored by MANAGE_SETTINGS in app.ts —
 *            principal, school_owner, it_admin, academic_coordinator.
 */
const CAPS: { key: Cap; header: string }[] = [
  { key: 'attendance', header: 'হাজিরা' },
  { key: 'marks',      header: 'নম্বর' },
  { key: 'publish',    header: 'প্রকাশ' },
  { key: 'money',      header: 'টাকা' },
  { key: 'settings',   header: 'সেটিংস' },
];

interface MatrixRow { code: string; allow: Cap[] }

/**
 * The rows in the design's order (not rank order — keep it), with the values
 * the gates above enforce. Two departures from the drawing, both because the
 * drawing is wrong about the server:
 * - academic_coordinator may change সেটিংস (SETTINGS_ROLES); the drawing
 *   showed a minus.
 * - school_owner is drawn nowhere, but holds publish, money and settings
 *   rights. It sits beside the principal, and with it the table has the ten
 *   rows the design's own chip counts.
 * A teacher's হাজিরা and নম্বর are for the sections they teach, a dept_head's
 * the same way; the matrix answers "may this role do it", not "where".
 */
const MATRIX: MatrixRow[] = [
  { code: 'class_teacher',        allow: ['attendance', 'marks'] },
  { code: 'subject_teacher',      allow: ['attendance', 'marks'] },
  { code: 'dept_head',            allow: ['attendance', 'marks'] },
  { code: 'accountant',           allow: ['money'] },
  { code: 'academic_coordinator', allow: ['attendance', 'marks', 'publish', 'settings'] },
  { code: 'principal',            allow: ['attendance', 'marks', 'publish', 'money', 'settings'] },
  { code: 'school_owner',         allow: ['publish', 'money', 'settings'] },
  { code: 'it_admin',             allow: ['settings'] },
  { code: 'student',              allow: [] },
  { code: 'guardian',             allow: [] },
];

/**
 * One capability cell: a check (allowed) or a minus (not). The glyph is
 * aria-hidden, so the word beside it is what a screen reader hears — the
 * shape, not only the colour, carries the meaning on screen.
 */
function mark(d: Document, allowed: boolean): HTMLElement {
  return el(d, 'span', { className: 'roles-mark', data: { allowed: allowed ? 'true' : 'false' } },
    allowed ? icon(d, 'check') : icon(d, 'minus'),
    el(d, 'span', { className: 'ui-sr-only', text: allowed ? 'অনুমোদিত' : 'অনুমোদিত নয়' }));
}

export class RolesView {
  constructor(o: RolesViewOptions) {
    const d = o.doc;
    o.root.textContent = '';

    // Title left, one neutral chip at the right edge — the design bar has no
    // subtitle and no button. `actions`, not `badge`: the badge slot sits
    // beside the title. badge() wraps the count in `.n` itself (R6). The count
    // is the table's own, so the chip cannot claim a role the table lacks.
    o.root.append(pageHeader(d, {
      title: 'ভূমিকা ও অ্যাক্সেস',
      actions: [badge(d, { label: `${formatCount(MATRIX.length, 'bn')} ভূমিকা · RLS`, tone: 'neutral' })],
    }));

    // A matrix is the original tabular data: the row × column relationship IS
    // the information, so it stays a table at every width (13 Responsive
    // rule ০৩) — the list dataTable also emits is hidden by the screen's CSS.
    const matrix = dataTable<MatrixRow>(d, {
      caption: 'ভূমিকা ও অনুমতির ছক',
      className: 'roles-matrix',
      rows: MATRIX,
      rowKey: (r) => r.code,
      columns: [
        // roleLabel: the one vocabulary, so the users list, the audit log and
        // the profile menu name a role exactly as this page does.
        { key: 'role', header: 'ভূমিকা', mobile: 'title', cell: (r) => roleLabel(r.code) },
        ...CAPS.map((c) => ({
          key: c.key,
          header: c.header,
          mobile: 'meta' as const,
          cell: (r: MatrixRow) => mark(d, r.allow.includes(c.key)),
        })),
      ],
    });

    // The info band is the top of the same white panel as the table, with no
    // gap between them, so it goes inside the table's shell, before the table.
    matrix.prepend(el(d, 'p', {
      className: 'roles-note',
      attrs: { role: 'note' },
      text: 'সাইডবার ঠিক করে কী দরকারি, এই পাতা ঠিক করে কী অনুমোদিত। ' +
            'অনুমতি সবসময় সার্ভারে যাচাই হয় — পর্দায় লুকানো মানে নিরাপত্তা নয়। ' +
            // Kept although the drawing dropped it: tenant isolation is the one
            // promise on this page that no role, setting or owner can change,
            // and a school reading "who may see what" is owed that sentence.
            'অন্য বিদ্যালয়ের কোনো সারি কখনো দৃশ্যমান হয় না — এটি কোনো সেটিং নয়, বন্ধ করার উপায় নেই।',
    }));
    o.root.append(matrix);
  }
}
