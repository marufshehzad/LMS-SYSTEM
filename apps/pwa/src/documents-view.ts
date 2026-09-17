/**
 * নথি ও ছাপা — choose a document, preview it, print it.  (R-5)
 *
 * The master plan's exit criterion is a workflow, not an endpoint: "a guardian
 * pays; the office prints a receipt with the school's logo, watermark and
 * signature. Term ends; report cards print for a whole section in one go."
 *
 *     ধরন বেছে নিন → রেকর্ড বেছে নিন → পূর্বরূপ → ছাপুন
 *
 * ── Why the preview is an iframe ────────────────────────────────────────
 * The server returns a COMPLETE standalone page: its own `@page{size:A4}`,
 * its own watermark layer, its own print rules. Injecting that into the app's
 * DOM would put A4 page geometry and a full-page watermark inside a phone
 * shell, and the app's stylesheet would fight the document's.
 *
 * An iframe keeps them apart, and — the part that matters — it means the
 * thing on screen IS the thing that prints. `iframe.contentWindow.print()`
 * prints exactly the previewed document, so the preview cannot drift from the
 * output the way a lookalike would.
 *
 * ── Why srcdoc and not a URL ────────────────────────────────────────────
 * The document is fetched with `authedFetch`, so it travels with the caller's
 * bearer token. Pointing an iframe at the endpoint URL would send a plain
 * browser request with no Authorization header — it would 401, and "fixing"
 * that would mean a cookie or a token in a query string, i.e. a document URL
 * that works without the app. §15 of the brief is explicit that arbitrary
 * document URLs must not bypass authorization; fetching then rendering into
 * `srcdoc` is how this endpoint never needs one.
 *
 * ── Bulk ────────────────────────────────────────────────────────────────
 * A section's report cards are ONE request returning ONE page of forty
 * documents, each with its own letterhead and a page break before it. The
 * office presses print once. Forty requests and forty print dialogues is not
 * a bulk feature.
 *
 * ── Ata Ekta (04 Guardian §05 · 05 Principal §07) ──────────────────────
 * Both designs draw only the first step, the choice of document, and they
 * draw it at two widths from the same parts: a glyph, the document's name
 * over one line saying when it is given, and a trailing mark. So the picker
 * is ONE `list()` of `listItem()` rows and CSS decides the shape — below
 * 1024px the guardian's flat 62px rows with a download arrow, at 1024px and
 * up the principal's two-column hairline grid with a printer. No cards, no
 * badges, no chevrons: neither drawing has one.
 *
 * The record pickers, the preview and the print step are not drawn anywhere.
 * They are built from 14 Components parts (sectionHeading, field, list,
 * button, the states) rather than the legacy system-row / roster-row markup.
 *
 * ── A family's report card and admit card (UX findings 13, 19) ──────────
 * The office prints a section at a time: class/section tree, exam list,
 * roster. All three are staff-only reads (hierarchy.ts requireStaff,
 * publish.ts PUBLISH_ROLES), so a student or guardian who tapped প্রগতি পত্র
 * met "একাডেমিক কাঠামো দেখার অনুমতি আপনার নেই।" and never reached the
 * document the endpoint would have given them. A family asks for ONE child's
 * card, so its step is built from reads a family is allowed: the guardian's
 * wards (/academics/ward — a student is their own child), the child's
 * published results for a report card (/academics/results, what ফলাফল reads),
 * and the school calendar's exam periods for an admit card (/ops/calendar,
 * open to every member). ops/document's ACCESS and `app.can_see_student`
 * still decide what comes back.
 *
 * ── Focus (UX finding 24) ───────────────────────────────────────────────
 * Every action rebuilds the root. The shell's keepFocusWithin puts focus
 * back on the SAME control after a rebuild, and the stable keys below
 * (data-focus-key, data-key, data-id, data-student-id) are what it matches
 * on. What it cannot know is where focus belongs when the control is gone
 * for good: a document row is replaced by that document's first choice, the
 * crumb by the document row it led away from, and a preview's button by
 * ছাপুন, the next thing to do. `refocus` says which, and `placeFocus()` acts
 * on it only when focus was actually lost.
 */
import {
  formatBdt, formatIdentifier, todayLocalIso,
} from '../../../packages/ui-core/src/format.ts';
import type { Auth } from './auth.ts';
import { hasIcon } from './icon.ts';
import {
  errorState, emptyState, successNote, bnNum, bnDate,
} from './view-states.ts';
import {
  permissionMessage, permissionState, pageHeader, sectionHeading, list, listItem,
  field, button, buttonRow, badge, el, icon, uid, numText, hasDigit, numClass,
  listSkeleton, announce, focusIsLost, childSelector, childIdentity,
  type ChildOption,
} from './ui/index.ts';

export type DocKind =
  | 'fee_receipt' | 'report_card' | 'admit_card'
  | 'id_card' | 'transfer_certificate' | 'attendance_sheet';

interface DocSpec {
  kind: DocKind;
  labelBn: string;
  descBn: string;
  /** What has to be chosen before this can be produced. */
  needs: 'receipt' | 'exam+students' | 'students' | 'student' | 'section';
  bulk: boolean;
  /** The glyph the design draws beside it — see `drawn()`. */
  glyph: string;
}

/**
 * The design's glyph when the icon set carries it, else the nearest one it
 * does. `credit-card`, `receipt` and `printer` are drawn but not yet in
 * icon.ts; until they are, a row shows the stand-in rather than the
 * unknown-icon dot, and switches to the drawn glyph the moment the set gains
 * it. `undefined` as the stand-in means no glyph at all.
 */
function drawn(name: string, standIn?: string): string | undefined {
  return hasIcon(name) ? name : standIn;
}

/**
 * The six the designs name, in 05 Principal §07's order, with its glyphs and
 * its condition lines — except where the drawn line says something the
 * server does not do. The admit card prints no photo (the photo box is the ID
 * card's), a transfer certificate is issued whatever is owed (it prints
 * whether dues are cleared), and no count of report cards exists before a
 * section is chosen, so those three keep true words. প্রত্যয়নপত্র (05 §07)
 * has no document kind or endpoint and is not offered; পরিচয়পত্র, which the
 * code has and the design does not draw, takes its place.
 */
const DOCS: DocSpec[] = [
  { kind: 'report_card', labelBn: 'প্রগতি পত্র', descBn: 'লোগো ও স্বাক্ষরসহ',
    glyph: 'file-text', needs: 'exam+students', bulk: true },
  { kind: 'admit_card', labelBn: 'প্রবেশপত্র', descBn: 'পরীক্ষার সূচি ও আসন নম্বর',
    glyph: drawn('credit-card', 'clipboard')!, needs: 'exam+students', bulk: true },
  { kind: 'fee_receipt', labelBn: 'বেতনের রসিদ', descBn: 'পরিশোধিত ইনভয়েসের বিপরীতে',
    glyph: drawn('receipt', 'wallet')!, needs: 'receipt', bulk: false },
  { kind: 'id_card', labelBn: 'পরিচয়পত্র', descBn: 'শিক্ষার্থীর আইডি কার্ড',
    glyph: 'user', needs: 'students', bulk: true },
  { kind: 'transfer_certificate', labelBn: 'ছাড়পত্র', descBn: 'প্রতিষ্ঠান ত্যাগের প্রত্যয়নপত্র',
    glyph: 'log-out', needs: 'student', bulk: false },
  { kind: 'attendance_sheet', labelBn: 'হাজিরা খাতা', descBn: 'মাসভিত্তিক — ছাপার জন্য',
    glyph: 'check-square', needs: 'section', bulk: false },
];

/**
 * 04 Guardian §05 draws a family's three in its own order — the mark sheet,
 * then the receipt, then the admit card — where the principal's grid puts the
 * receipt third. Same rows, re-arranged for the roles that page is drawn for.
 */
const FAMILY_ORDER: DocKind[] = ['report_card', 'fee_receipt', 'admit_card'];
const FAMILY_ROLES = new Set(['guardian', 'student']);

/**
 * How the school calendar names an exam period: `exam:<exams.id>`
 * (ops-svc/api/calendar.ts). A single paper is `exam-subject:<id>` and is
 * not an exam an admit card can be asked for.
 */
const CALENDAR_EXAM = 'exam:';
/** How far ahead an admit card's exam may be. The calendar reads ≤ 400 days. */
const ADMIT_AHEAD_DAYS = 365;

/** Something a keyboard reaches, for the first control of a new step. */
const FOCUSABLE = 'button, select, input, textarea, a[href], [tabindex]';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface TreeSection {
  id: string; name: string; studentCount: number;
}
interface Tree {
  classes: {
    levelNo: number; nameBn: string;
    groups: { groupBn: string; sections: TreeSection[] }[];
  }[];
}
interface RosterStudent { studentId: string; rollNo: number; nameBn: string }
interface ExamOption { examId: string; examNameBn: string; status: string }
interface ReceiptRow {
  id: string; receiptNo: string; amount: string; issuedAt: string; studentNameBn?: string | null;
}

export interface DocumentsViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /**
   * Which document kinds to offer. Advisory: the endpoint's own ACCESS list
   * and RLS are the enforcement, and a kind offered in error produces a clean
   * 403 rather than a document.
   */
  allowed: DocKind[];
}

export class DocumentsView {
  private readonly o: DocumentsViewOptions;

  private kind: DocKind | null = null;
  private tree: Tree | null = null;
  private exams: ExamOption[] = [];
  private receipts: ReceiptRow[] = [];
  private roster: RosterStudent[] = [];

  private sectionId = '';
  private examId = '';
  private receiptId = '';
  private selected = new Set<string>();

  private previewHtml = '';
  private loading = false;
  private generating = false;
  private error = '';
  private notice = '';
  /** The refusal last read out, so a re-render does not say it twice. */
  private announcedRefusal = '';

  /**
   * A missing choice ("পরীক্ষা বেছে নিন।"), said beside the button that needs
   * it. Not `error`: that draws a load-failure card with a retry, and
   * retrying a choice nobody has made is a button that cannot work.
   */
  private invalid = '';
  /** Which request `error` came from, so its retry repeats THAT request. */
  private failedAt: 'load' | 'roster' | 'generate' = 'load';

  /** A guardian's children (ChildOption shape of /academics/ward). */
  private wards: ChildOption[] = [];
  /** The one child a family's document is for. A student is their own. */
  private childId = '';
  /** A family's exam list is being read again for another child. */
  private examsLoading = false;
  /** Bumped per exam read, so a slow answer for the previous child is dropped. */
  private examsSeq = 0;

  /** Where focus goes once the next complete render is on screen. */
  private refocus: 'step' | 'kind' | 'print' | null = null;
  /** The document row focus returns to after going back. */
  private lastKind: DocKind | null = null;

  constructor(options: DocumentsViewOptions) {
    this.o = options;
    this.render();
  }

  private spec(): DocSpec | null {
    return DOCS.find((d) => d.kind === this.kind) ?? null;
  }

  /**
   * A student or guardian asking for a report card or an admit card: one
   * child's, never a section's. See the file header (findings 13, 19).
   */
  private familyFlow(): boolean {
    return FAMILY_ROLES.has(this.o.auth.role) && this.spec()?.needs === 'exam+students';
  }

  // ── loading ───────────────────────────────────────────────────────────

  private async pick(kind: DocKind): Promise<void> {
    this.kind = kind;
    this.previewHtml = ''; this.error = ''; this.notice = ''; this.invalid = '';
    // A new document starts with nothing chosen. A section kept from the
    // last document drew its select filled in over an empty roster ("এই
    // শাখায় কোনো শিক্ষার্থী নেই"), and a kept exam could be one the new
    // select does not offer — shown as "বেছে নিন…" and still sent.
    this.selected.clear(); this.roster = []; this.receiptId = '';
    this.sectionId = ''; this.examId = ''; this.exams = [];
    this.examsLoading = false;
    this.failedAt = 'load';
    this.refocus = 'step';
    this.loading = true; this.render();
    try {
      const need = this.spec()!.needs;
      if (need === 'receipt') {
        const res = await this.o.auth.authedFetch('/api/v1/finance/receipts?limit=30');
        // B-30: one pattern, from permissionMessage(). The SUBJECT is kept —
        // "রসিদ দেখার অনুমতি আপনার নেই।" tells a person what they cannot see
        // and the bare form does not. What is unified is the shape.
        if (res.status === 403) { this.error = permissionMessage('রসিদ'); return; }
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { receipts?: ReceiptRow[] };
        this.receipts = body.receipts ?? [];
      } else if (this.familyFlow()) {
        await this.loadFamily();
      } else {
        const res = await this.o.auth.authedFetch('/api/v1/academics/hierarchy');
        if (res.status === 403) { this.error = permissionMessage('একাডেমিক কাঠামো'); return; }
        if (!res.ok) throw new Error(String(res.status));
        this.tree = (await res.json()) as Tree;
        if (need === 'exam+students') {
          const ex = await this.o.auth.authedFetch('/api/v1/academics/publish');
          if (ex.ok) {
            const b = (await ex.json()) as { exams?: ExamOption[] };
            this.exams = b.exams ?? [];
          } else {
            // A class teacher may print report cards and cannot read the
            // publish-readiness list. Not an error — the exam picker just
            // has nothing to offer, and the empty state says so.
            this.exams = [];
          }
        }
      }
    } catch {
      this.error = 'তালিকা আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false; this.render();
    }
  }

  private async loadRoster(sectionId: string): Promise<void> {
    this.sectionId = sectionId;
    this.selected.clear();
    this.previewHtml = ''; this.invalid = ''; this.error = '';
    this.loading = true; this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/hierarchy?sectionId=${encodeURIComponent(sectionId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { roster?: RosterStudent[] };
      this.roster = body.roster ?? [];
      // A whole section is the common case, so it is the default; unticking
      // is easier than ticking forty boxes.
      for (const s of this.roster) this.selected.add(s.studentId);
    } catch {
      this.error = 'শিক্ষার্থীর তালিকা আনা যায়নি।';
      this.failedAt = 'roster';
    } finally {
      this.loading = false; this.render();
    }
  }

  /**
   * A family's step: whose document, then which exam. Never the section
   * tree, the publish list or a roster — see the file header.
   */
  private async loadFamily(): Promise<void> {
    if (this.o.auth.role === 'guardian') {
      const res = await this.o.auth.authedFetch('/api/v1/academics/ward');
      if (res.status === 403) { this.error = permissionMessage('সন্তানের তথ্য'); return; }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { wards?: ChildOption[] };
      this.wards = (body.wards ?? []).map((w) => ({
        studentId: w.studentId, nameBn: w.nameBn, sectionLabel: w.sectionLabel,
        rollNo: w.rollNo, relationBn: w.relationBn,
      }));
      // The child chosen for the last document stays chosen for this one.
      if (!this.wards.some((w) => w.studentId === this.childId)) {
        this.childId = this.wards[0]?.studentId ?? '';
      }
    } else {
      this.wards = [];
      this.childId = this.o.auth.userId;
    }
    this.selected.clear();
    if (!this.childId) return;
    this.selected.add(this.childId);
    const seq = ++this.examsSeq;
    const exams = await this.familyExams(this.childId);
    if (seq !== this.examsSeq) return;
    if (exams) this.exams = exams;
  }

  /**
   * The exams a family may ask a card for. `null` when the read was refused,
   * with `error` already saying what.
   */
  private async familyExams(childId: string): Promise<ExamOption[] | null> {
    const auth = this.o.auth;
    if (this.kind === 'report_card') {
      // What ফলাফল reads. A family sees a result only once it is published
      // (results_scope), which is exactly when a report card may be printed.
      // A student asks without an id, as results-view does.
      const who = auth.role === 'guardian' ? `?studentId=${encodeURIComponent(childId)}` : '';
      const res = await auth.authedFetch(`/api/v1/academics/results${who}`);
      if (res.status === 403) { this.error = permissionMessage('ফলাফল'); return null; }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        results?: { examId: string; examNameBn: string; publishedAt?: string | null }[];
      };
      return (body.results ?? []).map((r) => ({
        examId: r.examId, examNameBn: r.examNameBn,
        status: r.publishedAt ? 'published' : 'draft',
      }));
    }
    // An admit card is for an exam still ahead or under way: the exam periods
    // on the school calendar, which every member of the school may read.
    const from = todayLocalIso();
    const to = addDays(from, ADMIT_AHEAD_DAYS);
    const res = await auth.authedFetch(`/api/v1/ops/calendar?kind=exam&from=${from}&to=${to}`);
    // A school without the calendar has no list to offer. Not a refusal of
    // the admit card itself, so the empty state says so, not a lock.
    if (res.status === 403) return [];
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { entries?: { id: string; titleBn: string }[] };
    const exams: ExamOption[] = [];
    for (const e of body.entries ?? []) {
      if (!e.id.startsWith(CALENDAR_EXAM)) continue;
      const examId = e.id.slice(CALENDAR_EXAM.length);
      if (!examId || exams.some((x) => x.examId === examId)) continue;
      exams.push({ examId, examNameBn: e.titleBn, status: 'scheduled' });
    }
    return exams;
  }

  /** A guardian switches child. Their report card exams are that child's. */
  private async chooseChild(studentId: string): Promise<void> {
    if (studentId === this.childId) return;
    this.childId = studentId;
    this.selected.clear(); this.selected.add(studentId);
    this.previewHtml = ''; this.notice = ''; this.invalid = '';
    // An admit card's exams are the school's, the same for every child.
    if (this.kind !== 'report_card') { this.render(); return; }
    this.examId = '';
    const seq = ++this.examsSeq;
    this.examsLoading = true; this.render();
    try {
      const exams = await this.familyExams(studentId);
      if (seq !== this.examsSeq) return;
      this.exams = exams ?? [];
    } catch {
      if (seq !== this.examsSeq) return;
      this.exams = [];
      this.error = 'তালিকা আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
      this.failedAt = 'load';
    } finally {
      if (seq === this.examsSeq) { this.examsLoading = false; this.render(); }
    }
  }

  private queryFor(): URLSearchParams | null {
    const q = new URLSearchParams({ type: this.kind ?? '' });
    switch (this.spec()?.needs) {
      case 'receipt':
        if (!this.receiptId) { this.invalid = 'একটি রসিদ বেছে নিন।'; return null; }
        q.set('receiptId', this.receiptId);
        break;
      case 'exam+students':
        if (!this.examId) { this.invalid = 'পরীক্ষা বেছে নিন।'; return null; }
        q.set('examId', this.examId);
        if (this.selected.size === 0) { this.invalid = 'অন্তত একজন শিক্ষার্থী বেছে নিন।'; return null; }
        q.set('studentIds', [...this.selected].join(','));
        break;
      case 'students':
        if (this.selected.size === 0) { this.invalid = 'অন্তত একজন শিক্ষার্থী বেছে নিন।'; return null; }
        q.set('studentIds', [...this.selected].join(','));
        break;
      case 'student':
        if (this.selected.size !== 1) { this.invalid = 'একজন শিক্ষার্থী বেছে নিন।'; return null; }
        q.set('studentId', [...this.selected][0]);
        break;
      case 'section':
        if (!this.sectionId) { this.invalid = 'শাখা বেছে নিন।'; return null; }
        q.set('sectionId', this.sectionId);
        break;
    }
    return q;
  }

  private async generate(): Promise<void> {
    this.error = ''; this.notice = ''; this.invalid = '';
    const q = this.queryFor();
    if (!q) { this.render(); return; }

    this.generating = true; this.previewHtml = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch(`/api/v1/ops/document?${q}`);
      if (!res.ok) {
        // The endpoint answers JSON on failure and HTML on success.
        let message = 'নথি তৈরি করা যায়নি।';
        try {
          const body = await res.json() as { message?: string };
          if (body.message) message = body.message;
        } catch { /* a non-JSON failure keeps the default */ }
        this.error = res.status === 403
          ? 'এই নথি তৈরির অনুমতি আপনার নেই।'
          : message;
        this.failedAt = 'generate';
        this.refocus = 'step';
        return;
      }
      this.previewHtml = await res.text();
      const n = this.count();
      this.notice = n > 1
        ? `${bnNum(n)} টি নথি তৈরি হয়েছে — নিচে দেখে নিয়ে ছাপুন।`
        : 'নথি তৈরি হয়েছে — দেখে নিয়ে ছাপুন।';
      // The preview's button is now "আবার তৈরি করুন"; ছাপুন is what is next.
      this.refocus = 'print';
    } catch {
      this.error = 'সংযোগ নেই — নথি তৈরি করা যায়নি।';
      this.failedAt = 'generate';
      this.refocus = 'step';
    } finally {
      this.generating = false; this.render();
      // The note is a freshly inserted live region, which a screen reader
      // does not reliably read. Said once, politely, through the shared host.
      if (this.notice) announce(this.o.doc, this.notice);
    }
  }

  /** The exams the picker offers: a report card only for a published one. */
  private usableExams(): ExamOption[] {
    return this.kind === 'report_card'
      ? this.exams.filter((e) => e.status === 'published')
      : this.exams;
  }

  /** Every section in the tree, as the picker names it. */
  private sectionOptions(): { id: string; label: string; n: number }[] {
    const options: { id: string; label: string; n: number }[] = [];
    for (const lvl of this.tree?.classes ?? []) {
      for (const g of lvl.groups) {
        for (const s of g.sections) {
          options.push({
            id: s.id,
            label: `${lvl.nameBn} · ${g.groupBn} · ${s.name}`,
            n: s.studentCount,
          });
        }
      }
    }
    return options;
  }

  /**
   * The step has nothing to choose from, so there is nothing to preview.
   * Its empty state names the way on; a primary beside it only led to "একটি
   * রসিদ বেছে নিন।" about a list the screen had just said was empty.
   */
  private nothingToChoose(): boolean {
    const need = this.spec()!.needs;
    if (need === 'receipt') return this.receipts.length === 0;
    if (this.familyFlow()) {
      return this.examsLoading || !this.childId || this.usableExams().length === 0;
    }
    if (need === 'exam+students' && this.usableExams().length === 0) return true;
    if (this.sectionOptions().length === 0) return true;
    return need !== 'section' && !!this.sectionId && this.roster.length === 0;
  }

  /** How many documents this run produces, for the confirmation copy. */
  private count(): number {
    switch (this.spec()?.needs) {
      case 'exam+students':
      case 'students': return this.selected.size;
      case 'student': return 1;
      default: return 1;
    }
  }

  private print(): void {
    const frame = this.o.root.querySelector('iframe');
    const win = (frame as HTMLIFrameElement | null)?.contentWindow;
    if (!win) {
      this.error = 'পূর্বরূপ প্রস্তুত নয় — আবার তৈরি করুন।';
      this.failedAt = 'generate';
      this.refocus = 'step';
      this.render();
      return;
    }
    // Focus first: some browsers ignore print() on a background frame.
    win.focus();
    win.print();
  }

  // ── render ────────────────────────────────────────────────────────────

  /** Back to the choice of document — the first crumb's reset, reused. */
  private back(): void {
    this.lastKind = this.kind;
    this.kind = null; this.previewHtml = ''; this.error = ''; this.notice = ''; this.invalid = '';
    this.refocus = 'kind';
    this.render();
  }

  private render(): void {
    this.draw();
    this.placeFocus();
  }

  /**
   * Finding 24. After a step change the control the person used is gone for
   * good, so the shell's keeper has nothing to return focus to. Put it on
   * what replaced it — but only once the step is on screen, and only when
   * focus really was lost: somebody who tabbed elsewhere while the list
   * loaded keeps their place. `focusIsLost`, not `activeElement === body`:
   * inside the shell, lost focus waits on the view itself.
   */
  private placeFocus(): void {
    const want = this.refocus;
    if (!want || this.loading || this.generating || this.examsLoading) return;
    this.refocus = null;
    const d = this.o.doc;
    if (!focusIsLost(d)) return;
    const root = this.o.root;

    let target: HTMLElement | null = null;
    if (want === 'print') {
      target = root.querySelector<HTMLElement>('[data-focus-key="doc-print"]');
    } else if (want === 'kind' && this.lastKind) {
      target = root.querySelector<HTMLElement>(
        `.doc-kinds [data-key="${this.lastKind}"] .ui-list-hit`);
    }
    target ??= this.firstControl();
    if (!target) {
      // Nothing to operate (a lock with no picker): the page's own heading,
      // never <body>.
      target = root.querySelector<HTMLElement>('h1');
      if (target && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    }
    target?.focus();
  }

  /**
   * The first thing to operate below the page header: the new step's select,
   * its first row, a retry, or an empty state's way on. A roving tab strip's
   * unselected tabs (tabindex -1) are not stops.
   */
  private firstControl(): HTMLElement | null {
    const root = this.o.root;
    const header = root.querySelector('.page-header');
    for (const node of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (header?.contains(node)) continue;
      if (node.getAttribute('tabindex') === '-1') continue;
      if ((node as HTMLButtonElement).disabled) continue;
      return node;
    }
    return null;
  }

  private draw(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    root.append(pageHeader(d, {
      title: 'নথি ও ছাপা',
      // 05 Principal §07's bar is the title alone. Once a document is chosen
      // the line under it says what that document is.
      subtitle: this.kind ? this.spec()!.descBn : undefined,
      // The chosen document as a real crumb, so the way back is a control and
      // not a sentence.
      crumbs: this.kind
        ? [
            { label: 'নথি ও ছাপা', onClick: () => this.back() },
            { label: this.spec()!.labelBn },
          ]
        : undefined,
    }));

    if (this.notice) root.append(successNote(d, this.notice));
    const refused = this.error.includes('অনুমতি');
    if (!refused) this.announcedRefusal = '';
    if (this.error) {
      if (refused) {
        // A refusal is a lock, never a red alarm with a retry: retrying a
        // permission failure is the definition of futile. The sentence stays
        // the canonical one the fetch already chose (B-30).
        //
        // No "who to ask" line. This screen keeps only the status, not the
        // server's error code, so it cannot tell a refused ROLE from a school
        // whose plan lacks the module (403 service_unavailable / tenant_blocked)
        // — and sending a guardian to the head teacher about the second is the
        // B-84 defect deniedContact() exists to prevent. Reported as a bug;
        // once the code is kept, pass `contact: deniedContact({ code })`.
        const denied = permissionState(d, { message: this.error });
        denied.classList.add('doc-state');
        root.append(denied, this.typePicker());
        // permissionState is a calm role="note", not a live region, and the
        // root was just rebuilt under the person's focus. errorState's
        // role="alert" used to read the refusal out; this keeps that.
        if (this.announcedRefusal !== this.error) {
          announce(d, this.error, true);
          this.announcedRefusal = this.error;
        }
        return;
      }
      const failed = errorState(d, this.error, () => {
        this.error = '';
        // The retry is gone once pressed; focus goes to what comes back.
        this.refocus = 'step';
        if (!this.kind) { this.render(); return; }
        // Repeat the request that failed. A failed preview retried by
        // re-reading the lists threw away every choice already made.
        if (this.failedAt === 'generate') void this.generate();
        else if (this.failedAt === 'roster' && this.sectionId) void this.loadRoster(this.sectionId);
        else void this.pick(this.kind);
      });
      failed.classList.add('doc-state');
      root.append(failed);
    }

    if (!this.kind) { root.append(this.typePicker()); return; }

    if (this.loading) { root.append(listSkeleton(d, 3)); return; }

    // The lists never arrived, so the error card and its retry are the whole
    // step. Drawn under it, each picker's empty state made a claim about data
    // nobody read: an offline parent was told "আপনার সাথে কোনো শিক্ষার্থী যুক্ত
    // নেই", an offline office "কোনো শাখা তৈরি হয়নি".
    if (this.error && this.failedAt === 'load') return;

    root.append(this.selectors());
    if (!this.nothingToChoose()) root.append(this.actions());
    if (this.previewHtml) root.append(this.preview());
  }

  /**
   * The choice of document. One DOM for both drawings:
   *
   *   ul.ui-list.doc-kinds > li.ui-list-item.doc-kind > button.ui-list-hit
   *     span.ui-list-glyph · div.ui-list-main (title, meta) ·
   *     span.ui-list-status > span.doc-go (download ‖ printer) · chevron
   *
   * Below 1024px CSS shows the download arrow (04 §05); at 1024px and up the
   * list becomes a two-column grid and shows the printer (05 §07). Both
   * trailing glyphs are decoration — the row's name is its title.
   */
  private typePicker(): HTMLElement {
    const d = this.o.doc;

    const offered = DOCS.filter((s) => this.o.allowed.includes(s.kind));
    if (offered.length === 0) {
      // Not "nothing here yet": nothing will ever be here for this role, so
      // it is the refusal state, not the empty one.
      const denied = permissionState(d, {
        message: 'আপনার ভূমিকার জন্য কোনো নথি তৈরির অনুমতি নেই।',
      });
      denied.classList.add('doc-state');
      return denied;
    }
    if (FAMILY_ROLES.has(this.o.auth.role)) {
      const at = (k: DocKind) => {
        const i = FAMILY_ORDER.indexOf(k);
        return i < 0 ? FAMILY_ORDER.length : i;
      };
      offered.sort((a, b) => at(a.kind) - at(b.kind));
    }

    const printGlyph = drawn('printer', 'download')!;
    const rows = offered.map((spec) => {
      const li = listItem(d, {
        title: spec.labelBn,
        meta: spec.descBn,
        glyph: spec.glyph,
        className: 'doc-kind',
        onClick: () => void this.pick(spec.kind),
        status: el(d, 'span', { className: 'doc-go' },
          icon(d, 'download', 'ui-icon doc-go-m'),
          icon(d, printGlyph, 'ui-icon doc-go-d')),
      });
      // The row's stable name: where focus returns after going back, and the
      // identity the shell's focus keeper matches across a rebuild.
      li.dataset.key = spec.kind;
      // Named by its title and described by its condition line, as the
      // interactive card was — not both run together as one long name.
      const hit = li.querySelector<HTMLElement>('.ui-list-hit');
      const title = li.querySelector<HTMLElement>('.ui-list-title');
      const meta = li.querySelector<HTMLElement>('.ui-list-meta');
      if (hit && title) {
        title.id = uid('doc');
        hit.setAttribute('aria-labelledby', title.id);
        if (meta) {
          meta.id = uid('doc');
          hit.setAttribute('aria-describedby', meta.id);
        }
      }
      return li;
    });
    const kinds = list(d, 'নথির ধরন', ...rows);
    kinds.classList.add('doc-kinds');
    return kinds;
  }

  private selectors(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div', { className: 'doc-steps' });
    const need = this.spec()!.needs;

    if (need === 'receipt') { wrap.append(this.receiptPicker()); return wrap; }

    if (this.familyFlow()) { this.familySteps(wrap); return wrap; }

    if (need === 'exam+students') {
      wrap.append(this.examPicker());
      // With no exam to print for, a section and a roster are choices that
      // lead nowhere; the exam step's empty state is the whole step.
      if (this.usableExams().length === 0) return wrap;
    }
    wrap.append(this.sectionPicker());
    if (need !== 'section') wrap.append(this.studentPicker());
    return wrap;
  }

  /** A family's step: which child (a guardian with several), then the exam. */
  private familySteps(wrap: HTMLElement): void {
    const d = this.o.doc;
    if (!this.childId) {
      wrap.append(this.stepEmpty({
        glyph: 'users',
        message: 'আপনার সাথে কোনো শিক্ষার্থী যুক্ত নেই। বিদ্যালয়ের অফিসে যোগাযোগ করুন।',
        action: { label: 'অন্য নথি বেছে নিন', onClick: () => this.back() },
      }));
      return;
    }
    if (this.o.auth.role === 'guardian') {
      // Never make a parent wonder which child the card is for: the names
      // side by side when there are several, the one child named when not.
      const switcher = childSelector(d, {
        children: this.wards,
        selectedId: this.childId,
        onSelect: (id) => void this.chooseChild(id),
      });
      const one = this.wards.find((w) => w.studentId === this.childId);
      const who = switcher ?? (one ? childIdentity(d, one) : null);
      if (who) { who.classList.add('doc-child'); wrap.append(who); }
    }
    if (this.examsLoading) { wrap.append(listSkeleton(d, 1)); return; }
    wrap.append(this.examPicker());
  }

  private receiptPicker(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div');
    wrap.append(sectionHeading(d, { title: 'রসিদ বেছে নিন' }));

    if (this.receipts.length === 0) {
      wrap.append(this.stepEmpty({
        glyph: 'wallet',
        message: 'এখনো কোনো পরিশোধের রসিদ নেই। ফি জমা হলে এখানে রসিদ দেখা যাবে।',
        action: { label: 'অন্য নথি বেছে নিন', onClick: () => this.back() },
      }));
      return wrap;
    }

    const rows = this.receipts.map((r) => {
      const chosen = r.id === this.receiptId;
      // listItem sets every number in the numeral face where it stands — the
      // receipt number, the date, the amount — so the words beside them keep
      // the text face.
      const li = listItem(d, {
        title: r.receiptNo,
        meta: `${bnDate(r.issuedAt)} · ${formatBdt(r.amount)}`
          + (r.studentNameBn ? ` · ${r.studentNameBn}` : ''),
        // The chosen row says so in a word, not only in its shade.
        status: chosen ? badge(d, { label: 'বাছাই করা', tone: 'neutral' }) : undefined,
        onClick: () => {
          this.receiptId = r.id; this.previewHtml = ''; this.error = ''; this.invalid = '';
          this.render();
        },
      });
      // The row's identity for the shell's focus keeper: the badge changes
      // the button's text, the receipt does not change.
      li.dataset.id = r.id;
      if (chosen) li.querySelector('.ui-list-hit')?.setAttribute('aria-current', 'true');
      return li;
    });
    const receipts = list(d, 'রসিদ', ...rows);
    receipts.classList.add('doc-receipts');
    wrap.append(receipts);
    return wrap;
  }

  /** An empty step, spaced like the steps around it. */
  private stepEmpty(o: Parameters<typeof emptyState>[1]): HTMLElement {
    const node = emptyState(this.o.doc, o);
    node.classList.add('doc-state');
    return node;
  }

  private examPicker(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div');

    // A report card is only meaningful for a published exam; the endpoint
    // refuses otherwise, so the picker does not offer it. Empty is judged on
    // what is OFFERED: exams that are all unpublished used to draw a select
    // holding nothing but "বেছে নিন…".
    const usable = this.usableExams();
    if (usable.length === 0) {
      wrap.append(this.stepEmpty({
        glyph: 'clipboard',
        message: this.kind === 'report_card'
          ? 'প্রকাশিত ফলাফলসহ কোনো পরীক্ষা পাওয়া যায়নি। ফলাফল প্রকাশের পর প্রগতি পত্র তৈরি করা যাবে।'
          : this.familyFlow()
            ? 'সামনে কোনো পরীক্ষা পাওয়া যায়নি। পরীক্ষার তারিখ ঘোষণা হলে প্রবেশপত্র তৈরি করা যাবে।'
            : 'কোনো পরীক্ষা পাওয়া যায়নি।',
        action: { label: 'অন্য নথি বেছে নিন', onClick: () => this.back() },
      }));
      return wrap;
    }

    const f = field(d, {
      label: 'পরীক্ষা',
      name: 'examId',
      kind: 'select',
      value: this.examId,
      options: [
        { value: '', label: 'বেছে নিন…' },
        ...usable.map((e) => ({ value: e.examId, label: e.examNameBn })),
      ],
      onChange: (v) => { this.examId = v; this.previewHtml = ''; this.invalid = ''; this.render(); },
    });
    // An <option> cannot hold a span, so the control carries `n` when any
    // exam name has a year in it.
    if (usable.some((e) => hasDigit(e.examNameBn))) f.input.classList.add('n');
    wrap.append(f.root);
    return wrap;
  }

  private sectionPicker(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div');

    const options = this.sectionOptions();
    if (options.length === 0) {
      wrap.append(this.stepEmpty({
        glyph: 'layers',
        message: 'কোনো শাখা তৈরি হয়নি। একাডেমিক কাঠামোতে শাখা তৈরি করুন।',
        action: { label: 'অন্য নথি বেছে নিন', onClick: () => this.back() },
      }));
      return wrap;
    }

    const f = field(d, {
      label: 'শ্রেণি ও শাখা',
      name: 'sectionId',
      kind: 'select',
      value: this.sectionId,
      options: [
        { value: '', label: 'বেছে নিন…' },
        ...options.map((o) => ({ value: o.id, label: `${o.label} (${bnNum(o.n)} জন)` })),
      ],
      onChange: (v) => { if (v) void this.loadRoster(v); },
    });
    // Every option carries a head count; an <option> cannot hold a span.
    f.input.classList.add('n');
    wrap.append(f.root);
    return wrap;
  }

  private studentPicker(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div');
    if (!this.sectionId) return wrap;

    const single = this.spec()!.needs === 'student';

    let selectAll: HTMLElement | undefined;
    if (!single && this.roster.length) {
      const everyone = this.selected.size === this.roster.length;
      selectAll = button(d, {
        label: everyone ? 'সবার নির্বাচন বাতিল' : 'সবাইকে নির্বাচন করুন',
        variant: 'ghost',
        size: 'sm',
        // Its label flips on every press; the key does not.
        attrs: { 'data-focus-key': 'doc-select-all' },
        onClick: () => {
          if (everyone) this.selected.clear();
          else for (const s of this.roster) this.selected.add(s.studentId);
          this.previewHtml = ''; this.invalid = ''; this.render();
        },
      });
    }
    wrap.append(sectionHeading(d, {
      title: single ? 'শিক্ষার্থী' : `শিক্ষার্থী · ${bnNum(this.selected.size)} নির্বাচিত`,
      action: selectAll,
    }));

    if (this.roster.length === 0) {
      // The roster never arrived: the error card above says so, and "no
      // students in this section" under it would be a false statement.
      if (this.error && this.failedAt === 'roster') return wrap;
      // No action: the section field just above is the next thing to do.
      wrap.append(this.stepEmpty({ glyph: 'users', message: 'এই শাখায় কোনো শিক্ষার্থী নেই।' }));
      return wrap;
    }

    const rows = this.roster.map((s) => {
      const box = el(d, 'input', {
        attrs: {
          type: single ? 'radio' : 'checkbox',
          name: single ? 'doc-student' : null,
          'aria-label': s.nameBn,
        },
      });
      box.checked = this.selected.has(s.studentId);
      box.addEventListener('change', () => {
        if (single) { this.selected.clear(); if (box.checked) this.selected.add(s.studentId); }
        else if (box.checked) this.selected.add(s.studentId);
        else this.selected.delete(s.studentId);
        this.previewHtml = ''; this.invalid = '';
        this.render();
      });
      // The whole row is the box's label, so the tap target is the row and
      // not an 18px square. The roll is an identifier and stays Latin, the
      // way the paper register prints it. `data-student-id` is the row the
      // shell's focus keeper returns to: two children can share a name.
      const roll = formatIdentifier(s.rollNo);
      return el(d, 'li', { className: 'ui-list-item', data: { studentId: s.studentId } },
        el(d, 'label', { className: 'ui-list-hit doc-pick' },
          box,
          el(d, 'span', { className: numClass('ui-list-glyph doc-roll', roll), text: roll }),
          el(d, 'div', { className: 'ui-list-main' },
            el(d, 'span', { className: 'ui-list-title' }, ...numText(d, s.nameBn)))));
    });
    const students = list(d, 'শিক্ষার্থী', ...rows);
    students.classList.add('doc-students');
    wrap.append(students);
    return wrap;
  }

  private actions(): HTMLElement {
    const d = this.o.doc;
    const row = buttonRow(d);
    row.classList.add('doc-actions');

    const n = this.count();
    // A family's card is one child's; "১ জন নির্বাচিত" would describe a
    // choice they never made.
    if (this.spec()!.bulk && !this.familyFlow() && this.selected.size > 0) {
      // The count the brief asks for, said before the button rather than
      // discovered from a print dialogue with forty pages in it.
      row.append(el(d, 'p', { className: 'doc-count' },
        ...numText(d, `${bnNum(n)} জন নির্বাচিত · ${bnNum(n)} টি নথি তৈরি হবে`)));
    }

    if (this.invalid) {
      // Beside the button that asked for it, in the field-error voice, and
      // with no retry: the fix is a choice above, not another attempt.
      row.append(el(d, 'p', {
        className: 'ui-field-error doc-invalid', attrs: { role: 'alert' },
      }, ...numText(d, this.invalid)));
    }

    // One accent button at a time, and it is the one this step exists for:
    // before a preview, making one; after it, printing it. DOM order is
    // priority order, so the row ends on the primary.
    row.append(button(d, {
      label: this.generating
        ? (n > 1 ? `${bnNum(n)} টি তৈরি হচ্ছে…` : 'তৈরি হচ্ছে…')
        : (this.previewHtml ? 'আবার তৈরি করুন' : 'পূর্বরূপ দেখুন'),
      variant: this.previewHtml ? 'secondary' : 'primary',
      busy: this.generating,
      // Three labels, one control: the key the shell's focus keeper follows.
      attrs: { 'data-focus-key': 'doc-generate' },
      onClick: () => void this.generate(),
    }));

    if (this.previewHtml) {
      row.append(button(d, {
        label: 'ছাপুন',
        variant: 'primary',
        glyph: drawn('printer'),
        attrs: { 'data-focus-key': 'doc-print' },
        onClick: () => this.print(),
      }));
    }
    return row;
  }

  private preview(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', { className: 'doc-preview-wrap' });
    wrap.append(sectionHeading(d, { title: 'পূর্বরূপ' }));

    // Say where the PDF comes from: this product has no PDF renderer and no
    // bucket, and a school looking for a "Download PDF" button should be
    // told where the file actually comes from rather than left hunting.
    wrap.append(el(d, 'p', {
      className: 'doc-preview-note',
      text: 'ছাপার সময় "Save as PDF" বেছে নিলে পিডিএফ ফাইল সংরক্ষণ করা যাবে।',
    }));

    const frame = d.createElement('iframe');
    // `doc-frame` scopes this view's frame rules, so the carried
    // `.doc-preview` the timetable's print preview still uses is untouched.
    frame.className = 'doc-preview doc-frame';
    frame.title = `${this.spec()?.labelBn ?? 'নথি'} — পূর্বরূপ`;
    // Sandboxed, and `allow-scripts` is deliberately absent: the document is
    // server-generated markup in which every interpolated value is escaped,
    // and with no script permission nothing in it can execute even if that
    // escaping were ever wrong. Defence that does not depend on the
    // escaping being right.
    //
    // `allow-same-origin` IS granted, because the print button calls
    // `contentWindow.print()` from the parent and an opaque origin would
    // block it. Same-origin without scripts is the safe half of the pair —
    // it grants the parent a handle, not the frame a capability.
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.srcdoc = this.previewHtml;
    wrap.append(frame);
    return wrap;
  }
}
