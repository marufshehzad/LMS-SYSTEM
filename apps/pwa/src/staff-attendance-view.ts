/**
 * শিক্ষক হাজিরা — the staff register.  (M6)
 *
 * The register every school already keeps in a book by the office door, and
 * the one piece of data the substitute finder was missing: it has excluded
 * absent teachers since migration 006, and until migration 063 nothing in the
 * product could say who was absent.
 *
 * ── One screen, one decision per row ────────────────────────────────────
 * A date at the top and a list of teachers under it, each with one three-way
 * choice. No bulk actions, no "mark all present", no leave-balance column. A
 * head teacher does this once each morning against a list of thirty names,
 * and the fastest version of that is three fat targets per row, not a
 * workflow.
 *
 * ── Ata Ekta (05 Principal §06) ─────────────────────────────────────────
 * The drawn frame is a title bar with the day on the right, a band of four
 * counts, and the register flush under it. The band and the table are one
 * white panel here for the same reason. The drawing has no controls — it is
 * the register as read — so the three choices are the one thing added to it,
 * drawn as the segmented control from 00 Foundations §04 (ink frame, the
 * chosen segment filled with ink). The accent is never a row's answer: that
 * is `--accent` on thirty rows, and §3 gives it to one primary button.
 *
 * ── Marking is immediate, and says so ───────────────────────────────────
 * There is no save button. Each choice POSTs on press and the row shows what
 * the server came back with — not what was clicked. A register that showed
 * the optimistic answer would show a mark that failed, which is worse than
 * showing nothing on a screen whose whole job is to be believed.
 *
 * ── Today is a Dhaka today ──────────────────────────────────────────────
 * `todayLocalIso()`, never `toISOString().slice(0,10)`. Between midnight and
 * 6am Dhaka the UTC date names YESTERDAY, and the register's key is
 * (teacher, date) — so an early-morning mark would silently overwrite the
 * previous day. P7 found exactly that on a form with the same shape.
 */
import type { Auth } from './auth.ts';
import { skeleton, errorState, emptyState, successNote, bnNum } from './view-states.ts';
import { ROLE_BN } from './ui/roles.ts';
import { pageHeader } from './ui/page-header.ts';
import { todayLocalIso, formatDayMonth } from '../../../packages/ui-core/src/format.ts';
import {
  el, append, field, dataTable, statCard, statRow, numText,
  statusBadge, permissionState, permissionMessage,
} from './ui/index.ts';
import type { Column } from './ui/index.ts';

interface TeacherRow {
  teacherId: string;
  name: { bn: string | null; en: string | null };
  roleCode: string;
  status: string | null;
  reason: string | null;
  markedAt: string | null;
  markedBy: string | null;
}

interface RegisterBody {
  date: string;
  canMark: boolean;
  total: number;
  marked: number;
  away: number;
  teachers: TeacherRow[];
}

export interface StaffAttendanceViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/**
 * The three states, in the order the office thinks about them. `present`
 * first because it is the answer for most of the list.
 */
const CHOICES: Array<{ value: string; label: string }> = [
  { value: 'present',  label: 'উপস্থিত' },
  { value: 'absent',   label: 'অনুপস্থিত' },
  { value: 'on_leave', label: 'ছুটি' },
];

const STATUS_BN: Record<string, string> = {
  present: 'উপস্থিত', absent: 'অনুপস্থিত', on_leave: 'ছুটি',
};

export class StaffAttendanceView {
  private date = todayLocalIso();
  private data: RegisterBody | null = null;
  private loading = true;
  private denied = false;
  private error = '';
  private notice = '';
  /** The teacher whose row is mid-request, so only that row is disabled. */
  private busy = '';
  /** Reason text per teacher, kept while the drawer-less row is being edited. */
  private reasons = new Map<string, string>();

  /**
   * Declared as a field and assigned in the body, not as a parameter
   * property.
   *
   * `constructor(private readonly o: …)` is valid TypeScript and this repo
   * cannot run it: node executes `.ts` in strip-only mode, which removes
   * types without emitting the implicit `this.o = o`, and refuses the
   * syntax outright rather than producing a silently broken object. The
   * shipped bundle was fine because esbuild compiles it properly — so the
   * only symptom was that no test could import this file at all, and the
   * suite stayed green by never touching it.
   */
  private readonly o: StaffAttendanceViewOptions;

  constructor(o: StaffAttendanceViewOptions) {
    this.o = o;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/ops/staff-attendance?date=${encodeURIComponent(this.date)}`);
      if (res.status === 403) { this.denied = true; this.loading = false; this.render(); return; }
      if (!res.ok) throw new Error(String(res.status));
      this.data = await res.json() as RegisterBody;
      this.reasons.clear();
      for (const t of this.data.teachers) if (t.reason) this.reasons.set(t.teacherId, t.reason);
    } catch {
      this.error = 'হাজিরা তালিকা আনা যায়নি।';
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async mark(teacherId: string, status: string): Promise<void> {
    this.busy = teacherId;
    this.notice = '';
    this.error = '';
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/staff-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId, date: this.date, status,
          // A reason belongs to being away. Sending one with `present` would
          // leave "অসুস্থ" attached to a teacher who came in.
          reason: status === 'present' ? '' : (this.reasons.get(teacherId) ?? ''),
        }),
      });
      const body = await res.json() as { message?: string; nameBn?: string; status?: string; reason?: string | null };
      if (!res.ok) {
        this.error = body.message ?? 'হাজিরা লেখা যায়নি।';
        return;
      }
      // Take the server's answer, not the button that was pressed.
      const row = this.data?.teachers.find((t) => t.teacherId === teacherId);
      if (row && this.data) {
        const wasAway = row.status === 'absent' || row.status === 'on_leave';
        const isAway = body.status === 'absent' || body.status === 'on_leave';
        if (row.status === null) this.data.marked += 1;
        if (wasAway && !isAway) this.data.away -= 1;
        if (!wasAway && isAway) this.data.away += 1;
        row.status = body.status ?? null;
        row.reason = body.reason ?? null;
      }
      this.notice = `${body.nameBn ?? 'শিক্ষক'} — ${STATUS_BN[body.status ?? ''] ?? ''} লেখা হয়েছে।`;
    } catch {
      this.error = 'হাজিরা লেখা যায়নি।';
    } finally {
      this.busy = '';
      this.render();
    }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // A family is shown no register at all (see `family`), so, like a
    // refusal, it gets no day for a register to belong to and no picker.
    const noRegister = this.denied || this.family;

    // 05 Principal §06: the title, and on the right the day the register is
    // for — day and month, no year, in the text colour of a caption. No
    // subtitle: the drawn bar has none. Not shown beside a refusal, where
    // there is no register for the day to belong to.
    root.append(pageHeader(d, {
      title: 'শিক্ষক হাজিরা',
      actions: noRegister ? undefined : [el(d, 'time', {
        className: 'staff-att-date-text',
        attrs: { datetime: this.date },
      }, ...numText(d, formatDayMonth(this.date, 'bn')))],
    }));

    // The refusal is the whole answer, and it comes before any control. A
    // date box and thirty rows of buttons above a 403 is an invitation to a
    // second refusal.
    if (this.denied) {
      root.append(permissionState(d, {
        message: permissionMessage('শিক্ষক হাজিরা'),
        contact: 'প্রধান শিক্ষক, প্রতিষ্ঠান মালিক ও আইটি অ্যাডমিন',
      }));
      return;
    }

    if (this.notice) root.append(successNote(d, this.notice));
    if (this.error) root.append(errorState(d, this.error, () => void this.load()));

    // Not drawn — the frame shows only today — but viewing and correcting
    // another day is half of what this screen is for, so the picker stays,
    // capped to the width a date needs. Not for a family: every day's
    // register is equally closed to them, and "change the date to see or
    // correct another day" promised them something no date gives.
    if (!noRegister) {
      root.append(field(d, {
        label: 'তারিখ',
        name: 'date',
        kind: 'date',
        value: this.date,
        helper: 'অন্য দিনের হাজিরা দেখতে বা সংশোধন করতে তারিখ বদলান।',
        className: 'staff-att-date',
        onChange: (v) => { if (!v) return; this.date = v; void this.load(); },
      }).root);
    }

    if (this.loading) { root.append(skeleton(d, 5)); return; }

    const data = this.data;
    if (!data) return;

    if (data.teachers.length === 0) {
      // "No teachers have been added" was a false statement about a family's
      // school (see `family`); say what is true for them instead.
      root.append(emptyState(d, this.family
        ? {
          glyph: 'users',
          message: 'শিক্ষকদের হাজিরা এই অ্যাকাউন্ট থেকে দেখা যায় না।',
          detail: 'এই খাতা বিদ্যালয়ের অফিস রাখে। কোনো শিক্ষকের বিষয়ে জানতে বিদ্যালয়ে যোগাযোগ করুন।',
        }
        : {
          glyph: 'users',
          message: 'এই প্রতিষ্ঠানে এখনো কোনো শিক্ষক যোগ করা হয়নি।',
          detail: 'শিক্ষকের অ্যাকাউন্ট যোগ হলে এখানে তাঁদের হাজিরা নেওয়া যাবে।',
        }));
      return;
    }

    // Read-only staff get the register without the choices. The server has
    // already said `canMark: false`, so this is not hidden UI standing in for
    // authorization — it is the screen agreeing with the answer it was given.
    const canMark = data.canMark;

    const columns: Array<Column<TeacherRow>> = [
      {
        key: 'name', header: 'নাম', mobile: 'title',
        cell: (t) => this.nameOf(t),
        width: 'minmax(0, 2fr)',
      },
      {
        key: 'role', header: 'ভূমিকা', mobile: 'subtitle',
        cell: (t) => ROLE_BN[t.roleCode] ?? t.roleCode,
      },
      // Read-only staff see the reason as text. For anybody who can mark,
      // the box and the choices are ONE cell: they are written in one
      // request, and on a phone the table collapses to a card where two
      // separate meta items are joined by a "·" — a stray dot beside a text
      // input, which reads as a defect.
      canMark
        ? { key: 'actions', header: 'চিহ্নিত করুন', mobile: 'meta', cell: (t) => this.markCell(t) }
        : { key: 'reason', header: 'কারণ', mobile: 'meta', cell: (t) => t.reason ?? '—' },
      // Last, as drawn: the answer sits at the right-hand edge of its row.
      // The drawn header is blank; it keeps a word here because a column
      // header with no name is a column a screen reader cannot announce.
      {
        key: 'status', header: 'অবস্থা', mobile: 'status',
        cell: (t) => this.statusChip(t),
      },
    ];

    root.append(el(d, 'div', { className: 'staff-att-panel' },
      this.summary(data),
      dataTable(d, {
        caption: 'শিক্ষকের হাজিরা তালিকা',
        className: 'staff-att-table',
        rows: data.teachers,
        rowKey: (t) => t.teacherId,
        columns,
      })));
  }

  /**
   * A student or guardian, who cannot read this register. The GET is not
   * role-gated, and `users_scope` hides the staff from a family: one who
   * opens this by its URL gets an empty register from every school, for any
   * date, full of teachers or not. Known from the role before the read, so
   * the date picker is never drawn for them, not even over the skeleton.
   */
  private get family(): boolean {
    return ['student', 'guardian'].includes(this.o.auth.role);
  }

  private nameOf(t: TeacherRow): string {
    return t.name.bn ?? t.name.en ?? 'নাম নেই';
  }

  /**
   * The four counts the drawn band carries: everyone, then the three answers.
   * No glyphs, and a figure takes its meaning's colour only when there is
   * something to mean — a red "০ অনুপস্থিত" is an alarm with nothing behind it.
   *
   * The three answers are counted from the rows on screen, so they move with
   * every mark the same moment the row does. Teachers nobody has marked yet
   * are real, and belong to none of the three: while any are left, the total
   * says how many, which is the one thing the office still has to do.
   *
   * statCard/statRow rather than a row of spans: the first draft used two
   * class names this codebase does not have (`ui-filter-bar`, `ui-stack`), so
   * the counts rendered with no gap at all and read as "৫চিহ্নিত: ১". An
   * invented class name fails silently, which is exactly why the components
   * exist.
   */
  private summary(data: RegisterBody): HTMLElement {
    const d = this.o.doc;
    const count = (status: string) => data.teachers.filter((t) => t.status === status).length;
    const present = count('present');
    const absent = count('absent');
    const leave = count('on_leave');
    const left = data.total - data.marked;
    return el(d, 'div', { className: 'staff-att-band' }, statRow(d,
      statCard(d, {
        label: 'মোট শিক্ষক', value: bnNum(data.total),
        note: left > 0 ? `বাকি ${bnNum(left)} জন চিহ্নিত হয়নি` : undefined,
      }),
      statCard(d, { label: 'উপস্থিত', value: bnNum(present), tone: present > 0 ? 'success' : undefined }),
      statCard(d, { label: 'অনুপস্থিত', value: bnNum(absent), tone: absent > 0 ? 'danger' : undefined }),
      statCard(d, { label: 'ছুটি', value: bnNum(leave), tone: leave > 0 ? 'info' : undefined })));
  }

  /** The row's answer, as the drawn chip: উপস্থিত ok, অনুপস্থিত danger, ছুটি info. */
  private statusChip(t: TeacherRow): HTMLElement {
    const d = this.o.doc;
    // Not "present". An unmarked teacher is a teacher nobody has looked at
    // yet, and the substitute finder treats it that way too.
    if (t.status === null) return statusBadge(d, { state: 'pending', label: 'চিহ্নিত হয়নি' });
    return statusBadge(d, {
      state: t.status,
      label: STATUS_BN[t.status] ?? t.status,
      // ছুটি is §3's info meaning. STATUS in ui/badge.ts has no `on_leave`
      // key yet, and without one an unknown state paints neutral; the tone
      // is passed until the key exists, then this line is dead weight.
      tone: t.status === 'on_leave' ? 'info' : undefined,
    });
  }

  private reasonBox(t: TeacherRow): HTMLElement {
    // Optional, and only meaningful when somebody is away — but it must be
    // fillable BEFORE a choice is pressed, because the mark and the reason
    // are written in one request.
    const f = field(this.o.doc, {
      label: `${this.nameOf(t)}: কারণ`,
      name: `reason-${t.teacherId}`,
      value: this.reasons.get(t.teacherId) ?? '',
      placeholder: 'কারণ (ঐচ্ছিক)',
      attrs: { maxlength: 200 },
      disabled: this.busy === t.teacherId,
      onInput: (v) => { this.reasons.set(t.teacherId, v); },
    });
    // A row has no room for a label over its box. The <label for> stays, so
    // the box keeps its name (with whose reason it is, which a column of
    // thirty identical "কারণ" did not say); the placeholder carries the word.
    f.root.querySelector('.ui-field-label')?.classList.add('ui-sr-only');
    return f.root;
  }

  /** The reason and the three choices, together, because they are one write. */
  private markCell(t: TeacherRow): HTMLElement {
    const wrap = el(this.o.doc, 'div', { className: 'staff-att-mark' });
    append(wrap, this.reasonBox(t), this.choices(t));
    return wrap;
  }

  /**
   * One of three, as a segmented control. The current answer is the pressed
   * segment — `aria-pressed` for a reader, the ink fill for the eye — so the
   * row reads as an answer rather than as three open questions. Pressing the
   * chosen one again is allowed: it is how a reason typed afterwards is saved.
   */
  private choices(t: TeacherRow): HTMLElement {
    const d = this.o.doc;
    const group = el(d, 'div', {
      className: 'staff-att-seg',
      attrs: { role: 'group', 'aria-label': `${this.nameOf(t)}: হাজিরা` },
    });
    for (const c of CHOICES) {
      const b = el(d, 'button', {
        className: 'staff-att-choice',
        text: c.label,
        attrs: {
          type: 'button',
          'aria-pressed': t.status === c.value ? 'true' : 'false',
          disabled: this.busy === t.teacherId,
        },
        data: { choice: c.value },
      });
      b.addEventListener('click', () => { void this.mark(t.teacherId, c.value); });
      group.append(b);
    }
    return group;
  }
}
