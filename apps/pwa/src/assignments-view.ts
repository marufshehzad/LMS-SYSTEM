/**
 * Assignments (বাড়ির কাজ) — homework inbox and submission.
 *
 * One view, two audiences, because the underlying object is the same and
 * splitting them would duplicate the list/detail plumbing:
 *
 *   student — inbox sorted by urgency, tap to read and write an answer
 *   staff   — same list with submission counts, tap to review and grade
 *
 * Submissions go through the offline outbox, never a direct POST: a
 * student typing an answer on a phone with no signal must not lose it.
 * Grading is a normal authenticated POST — a teacher marking work is at a
 * desk far more often than not, and grading offline would risk two
 * teachers' marks silently diverging.
 *
 * ── Ata Ekta (02 Teacher §05, 03 Student §03) ─────────────────────────────
 * The list is drawn at phone width: a three-tab strip sitting directly on a
 * list of three-line rows — "বিষয় — কাজ", then the section (teacher) or the
 * due time (student), then the submission count and due chip (teacher) or
 * the urgency chip (student). It is still ONE `dataTable` declaration, so the
 * desktop table and the phone rows cannot drift apart; `.assign-data` places
 * the phone row's parts. The detail screen is not drawn, and is built from
 * the shared parts only: backLink, pageHeader, field, button, statusBadge.
 */
import type { Auth } from './auth.ts';
import { formatIdentifier } from '../../../packages/ui-core/src/format.ts';
import {
  planCompression, checkMedia, formatDuration, MEDIA_PROBLEM_BN, MAX_VOICE_MS,
  type MediaDraft,
} from '../../../packages/ui-core/src/media.ts';
import { emptyState, errorState, successNote, bnDateTime, type EmptyOptions } from './view-states.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import {
  pageHeader, backLink, permissionState, deniedMessage, deniedContact, dataTable,
  statusBadge, badge, tabs, listSkeleton, button, field, el, icon, numText,
  type Column,
} from './ui/index.ts';

/**
 * F-902 kill switch. Mirrors SUBMISSION_MEDIA_ENABLED in the sync applier
 * and SCRIPT_STORAGE_ENABLED in scripts.ts: this deployment has no object
 * storage, so captured bytes would have nowhere to go. Flip both when an
 * R2/S3 credential lands.
 */
export const SUBMISSION_MEDIA_ENABLED = false;


interface Assignment {
  id: string;
  titleBn: string;
  dueAt: string;
  status: string;
  maxMarks: string | null;
  subjectBn: string;
  sectionName: string;
  submissionCount: number;
  ungradedCount: number;
  mySubmission: { submittedAt: string; marksAwarded: string | null; gradedAt: string | null } | null;
}

interface Submission {
  id: string;
  studentId: string;
  fullNameBn: string | null;
  rollNo: number | null;
  bodyBn: string | null;
  submittedAt: string;
  isLate: boolean;
  marksAwarded: string | null;
  feedbackBn: string | null;
  gradedAt: string | null;
  gradedByName: string | null;
  /** F-103. Must be echoed back when grading, or the server refuses. */
  rowVersion: number;
}

/**
 * F-103. What the server returns when someone else graded the same script
 * first. Held in view state until a teacher resolves it — the client never
 * picks a winner either.
 */
interface GradeConflict {
  submissionId: string;
  currentRowVersion: number;
  yours: { marksAwarded: number; feedbackBn: string | null };
  theirs: {
    marksAwarded: string | null;
    feedbackBn: string | null;
    gradedAt: string | null;
    gradedByName: string | null;
  };
}

interface Detail {
  assignment: {
    id: string; titleBn: string; instructionsBn: string | null;
    maxMarks: string | null; dueAt: string; allowsLate: boolean;
    status: string; subjectBn: string; sectionName: string;
  };
  submissions: Submission[];
}

export interface AssignmentsOutbox {
  enqueue(input: { entity: 'assignment_submission'; payload: unknown }): Promise<{ opId: string }>;
  flush(): Promise<unknown>;
}

export interface AssignmentsViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  outbox: AssignmentsOutbox;
}

type Bucket = 'pending' | 'submitted' | 'graded';

const CACHE_KEY = 'shikhon_assignments_cache';

const BN: Record<string, string> = { '0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯' };
function bn(s: string | number | null | undefined): string {
  if (s === null || s === undefined || s === '') return '—';
  return String(s).replace(/[0-9]/g, (d) => BN[d] ?? d);
}

/** "৩ দিন বাকি" / "আজ শেষ" / "২ দিন দেরি" — urgency in words, not a raw date. */
function dueLabel(dueAt: string): { text: string; state: 'overdue' | 'today' | 'soon' | 'later' } {
  const ms = Date.parse(dueAt) - Date.now();
  const days = Math.floor(ms / 86400000);
  if (ms < 0) {
    const late = Math.abs(days) || 1;
    return { text: `${bn(late)} দিন পার`, state: 'overdue' };
  }
  if (days === 0) return { text: 'আজ শেষ', state: 'today' };
  if (days <= 2) return { text: `${bn(days)} দিন বাকি`, state: 'soon' };
  return { text: `${bn(days)} দিন বাকি`, state: 'later' };
}

/** The drawn row title: "গণিত — অনুশীলনী ৪.২" (02 Teacher §05, 03 Student §03). */
function rowTitle(a: Assignment): string {
  return a.subjectBn ? `${a.subjectBn} — ${a.titleBn}` : a.titleBn;
}

const ERROR_TAIL = 'ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।';

export class AssignmentsView {
  private readonly o: AssignmentsViewOptions;
  private list: Assignment[] = [];
  /**
   * Wireframe §6.6's [ বাকি ] [ জমা ] [ মূল্যায়িত ] filter. A student with
   * twenty assignments across a term opens this screen to answer one
   * question — "what do I still owe?" — and an undifferentiated list makes
   * them scan every card to find out.
   */
  private filter: Bucket = 'pending';
  private detail: Detail | null = null;
  private openId: string | null = null;
  private loading = true;
  private offline = false;
  /**
   * The first list load failed and there was no cached copy to fall back on.
   * Without it, "could not reach the server" rendered as "you have no
   * homework" — the empty state, which is a statement about the data.
   */
  private failed = false;
  /**
   * The server refused this read (403). Distinct from `offline`, and the
   * distinction is the point: an outage is temporary and a refusal is not,
   * so this state offers no retry and shows no cached data (B-30).
   */
  private denied = false;
  /** B-84. The refusal itself, so the screen can say which kind it was. */
  private deniedErr: unknown = null;
  /** The detail read was refused — the same B-30 distinction, one level down. */
  private detailDeniedErr: unknown = null;
  private notice: string | null = '';
  /** What `notice` means, so a confirmation never wears a warning's colour. */
  private noticeTone: 'success' | 'error' = 'error';
  private draft = '';
  private draftStatusEl: HTMLElement | null = null;
  /** F-902. Set when a photo or voice answer has been captured for this assignment. */
  private mediaDraft: MediaDraft & { objectKey: string } | null = null;
  private mediaNotice = '';
  private recorder: MediaRecorder | null = null;
  private recStartedAt = 0;
  /** F-103. Non-null while a grading race is waiting on a human. */
  private conflict: GradeConflict | null = null;

  /** Per-assignment autosave key (§6.6: "drafts autosave continuously"). */
  private draftKey(assignmentId: string): string {
    return `shikhon_assign_draft_${assignmentId}`;
  }

  constructor(options: AssignmentsViewOptions) {
    this.o = options;
    void this.loadList();
  }

  private get isStaff(): boolean {
    return !['student', 'guardian'].includes(this.o.auth.role);
  }

  private async loadList(): Promise<void> {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) { this.list = JSON.parse(raw) as Assignment[]; this.loading = false; }
    } catch { /* cache is a nicety */ }
    this.render();

    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/assignments');
      await refuseUnlessOk(res);
      const body = (await res.json()) as { assignments: Assignment[] };
      this.list = body.assignments;
      this.offline = false;
      this.failed = false;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(this.list)); } catch { /* ignore */ }
    } catch (err) {
      if (isDenied(err)) {
        this.denied = true;
        this.deniedErr = err; this.list = []; this.offline = false; this.failed = false;
        try { localStorage.removeItem(CACHE_KEY); } catch { /* private mode */ }
        this.loading = false; this.render(); return;
      }
      this.offline = this.list.length > 0;
      this.failed = this.list.length === 0;
    }
    this.loading = false;
    this.render();
  }

  private async openDetail(id: string): Promise<void> {
    this.openId = id;
    this.detail = null;
    this.detailDeniedErr = null;
    this.notice = '';
    this.draft = '';
    this.loading = true;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/assignments?assignmentId=${encodeURIComponent(id)}`,
      );
      await refuseUnlessOk(res);
      this.detail = (await res.json()) as Detail;
      // Pre-fill with the student's existing answer so editing is natural.
      const mine = this.detail.submissions.find((s) => s.studentId === this.o.auth.userId);
      if (mine?.bodyBn) this.draft = mine.bodyBn;
      // A locally-autosaved draft is unsent work in progress — it wins over
      // the last submitted body, because it is what the student was in the
      // middle of writing when the tab closed or the phone died.
      try {
        const saved = localStorage.getItem(this.draftKey(id));
        if (saved !== null) this.draft = saved;
      } catch { /* private mode — fall back to in-memory draft */ }
      this.offline = false;
    } catch (err) {
      if (isDenied(err)) this.detailDeniedErr = err;
      else this.offline = true;
    }
    this.loading = false;
    this.render();
  }

  private async submit(): Promise<void> {
    // F-902. A photo or a spoken answer is a complete submission on its own —
    // a student who photographs a page of working has not failed to answer.
    if (!this.detail || (!this.draft.trim() && !this.mediaDraft)) return;
    try {
      const m = this.mediaDraft;
      await this.o.outbox.enqueue({
        entity: 'assignment_submission',
        payload: {
          assignmentId: this.detail.assignment.id,
          bodyBn: this.draft.trim() || null,
          ...(m ? {
            mediaKey: m.objectKey, mediaKind: m.kind, mediaBytes: m.bytes,
            mediaDurationMs: m.durationMs ?? null, mediaSha256: m.sha256 ?? null,
          } : {}),
        },
      });
      void Promise.resolve(this.o.outbox.flush()).catch(() => {});
      // Submitted: the autosaved draft has served its purpose. Clear it so a
      // stale draft can never resurrect over the answer that was actually
      // sent. (A later edit starts a fresh draft, and a fresh version.)
      try { localStorage.removeItem(this.draftKey(this.detail.assignment.id)); } catch { /* ignore */ }
      this.notice = 'জমা হয়েছে (অফলাইন হলে সংযোগ ফিরলে পাঠানো হবে)';
      this.noticeTone = 'success';
    } catch {
      this.notice = 'জমা দেওয়া যায়নি — আবার চেষ্টা করুন।';
      this.noticeTone = 'error';
    }
    this.render();
  }

  /**
   * Photograph a page of handwritten work.
   *
   * The compression ladder in ui-core/media decides the trade; this method
   * only supplies the encoder and reports the outcome. A camera JPEG is
   * routinely 4 MB and will not complete an upload on 3G, so nothing is
   * accepted until it is under 250 KB — and if it never gets there, the
   * student is told to retake it rather than handed a queued upload that
   * will fail hours later.
   */
  private async capturePhoto(assignmentId: string): Promise<void> {
    this.mediaNotice = '';
    const d = this.o.doc;
    const input = d.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // Prefers the rear camera on a phone; on a desktop it is an ordinary
    // file picker, which is what a teacher testing the flow will get.
    input.setAttribute('capture', 'environment');
    const file: File | null = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.click();
    });
    if (!file) return;

    try {
      const bitmap = await createImageBitmap(file);
      let lastBlob: Blob | null = null;
      const plan = await planCompression(async (longestEdge, quality) => {
        const scale = Math.min(1, longestEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = d.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return 0;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        lastBlob = await new Promise<Blob | null>((r) =>
          canvas.toBlob((b) => r(b), 'image/jpeg', quality));
        return lastBlob?.size ?? 0;
      });
      if (!plan || !lastBlob) {
        this.mediaNotice = MEDIA_PROBLEM_BN.too_large;
        this.render();
        return;
      }
      await this.holdMedia(assignmentId, lastBlob, { kind: 'photo', bytes: plan.bytes });
    } catch {
      this.mediaNotice = MEDIA_PROBLEM_BN.empty;
      this.render();
    }
  }

  /**
   * A spoken answer. Capped at 90 seconds by a timer as well as by
   * validation, because a phone that goes into a pocket mid-recording
   * would otherwise produce a file no 3G connection will ever send.
   */
  private async toggleVoice(assignmentId: string): Promise<void> {
    this.mediaNotice = '';
    if (this.recorder) { this.recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      this.recStartedAt = Date.now();
      rec.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
      rec.addEventListener('stop', () => {
        // Release the microphone. A PWA holding the mic open after
        // recording shows a permanent recording indicator, which reads as
        // the app listening to a child's home.
        for (const t of stream.getTracks()) t.stop();
        const durationMs = Date.now() - this.recStartedAt;
        this.recorder = null;
        void this.holdMedia(assignmentId, new Blob(chunks, { type: rec.mimeType }),
                            { kind: 'voice', bytes: chunks.reduce((n, c) => n + c.size, 0), durationMs });
      });
      rec.start();
      this.recorder = rec;
      globalThis.setTimeout(() => { if (this.recorder === rec) rec.stop(); }, MAX_VOICE_MS);
      this.render();
    } catch {
      this.mediaNotice = 'মাইক্রোফোন ব্যবহারের অনুমতি পাওয়া যায়নি।';
      this.render();
    }
  }

  /**
   * Validate, hash, and hold a capture until the student presses submit.
   *
   * The object key is built from ids only — never a filename. A camera
   * supplies names, and a name lands in every bucket listing and access log
   * that touches the object; a photo of a child's homework should not
   * announce whose it is.
   */
  private async holdMedia(assignmentId: string, blob: Blob, draft: MediaDraft): Promise<void> {
    const sha256 = await sha256Hex(await blob.arrayBuffer());
    const problem = checkMedia({ ...draft, sha256 });
    if (problem) {
      this.mediaNotice = MEDIA_PROBLEM_BN[problem];
      this.render();
      return;
    }
    const ext = draft.kind === 'photo' ? 'jpg' : 'webm';
    this.mediaDraft = { ...draft, sha256, objectKey: `submissions/${assignmentId}/${sha256}.${ext}` };
    this.render();
  }

  private async grade(
    submissionId: string,
    marks: number,
    feedback: string,
    rowVersion: number,
  ): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/assignments', {
        method: 'POST',
        // F-103: rowVersion is what the screen was showing. Without it the
        // server rejects the write rather than silently overwriting.
        body: JSON.stringify({ submissionId, marksAwarded: marks, feedbackBn: feedback, rowVersion }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; message?: string; conflict?: GradeConflict;
      };
      if (res.ok && body.ok) {
        this.conflict = null;
        this.notice = 'নম্বর সংরক্ষিত';
        this.noticeTone = 'success';
        if (this.openId) void this.openDetail(this.openId);
        return;
      }
      if (res.status === 409 && body.conflict) {
        // Not an error to dismiss — a decision to put in front of a person.
        this.conflict = body.conflict;
        this.notice = null;
        this.render();
        return;
      }
      this.notice = body.error === 'marks_exceed_max'
        ? 'নম্বর সর্বোচ্চ নম্বরের চেয়ে বেশি হতে পারে না।'
        : body.error === 'row_version_required'
          ? 'তালিকাটি পুরোনো — আবার লোড করে চেষ্টা করুন।'
          : 'সংরক্ষণ করা যায়নি।';
      this.noticeTone = 'error';
    } catch {
      this.notice = 'সংযোগে সমস্যা হয়েছে।';
      this.noticeTone = 'error';
    }
    this.render();
  }

  /**
   * The conflict card. Shows both marks side by side with the other
   * teacher's name, and offers exactly two choices — keep theirs, or
   * replace with mine. There is no "merge" and no automatic winner: this is
   * a child's grade, and a person decides whose mark stands.
   */
  private renderConflict(root: HTMLElement): void {
    const c = this.conflict;
    if (!c) return;
    const d = this.o.doc;

    const card = el(d, 'section', {
      className: 'card grade-conflict',
      attrs: { role: 'alertdialog', 'aria-label': 'নম্বরে দ্বন্দ্ব' },
    });
    card.append(el(d, 'h3', { text: 'এই খাতাটি ইতিমধ্যে অন্য কেউ দেখেছেন' }));
    card.append(el(d, 'p', {
      className: 'conflict-who',
      text: c.theirs.gradedByName
        ? `${c.theirs.gradedByName} নম্বর দিয়েছেন।`
        : 'অন্য একজন শিক্ষক নম্বর দিয়েছেন।',
    }));

    const table = el(d, 'dl', { className: 'conflict-compare' });
    const addRow = (label: string, mark: string, note: string | null) => {
      table.append(
        el(d, 'dt', { text: label }),
        el(d, 'dd', {}, ...numText(d, note ? `${mark} — ${note}` : mark)),
      );
    };
    addRow('তাঁদের নম্বর', bn(c.theirs.marksAwarded ?? '—'), c.theirs.feedbackBn);
    addRow('আপনার নম্বর', bn(c.yours.marksAwarded), c.yours.feedbackBn);
    card.append(table);

    const keep = button(d, {
      label: 'তাঁদেরটি রাখুন',
      variant: 'secondary',
      onClick: () => {
        this.conflict = null;
        this.notice = 'আগের নম্বরই রাখা হয়েছে।';
        this.noticeTone = 'success';
        if (this.openId) void this.openDetail(this.openId);
      },
    });
    const replace = button(d, {
      label: 'আমারটি দিয়ে বদলান',
      variant: 'primary',
      onClick: () => {
        // Re-submits against the version the server just reported, so this
        // is a deliberate overwrite of a known value — not a blind retry.
        void this.grade(
          c.submissionId,
          c.yours.marksAwarded,
          c.yours.feedbackBn ?? '',
          c.currentRowVersion,
        );
      },
    });

    card.append(el(d, 'div', { className: 'conflict-actions' }, keep, replace));
    root.append(card);
  }

  /* -------------------------------------------------------------- render */

  private render(): void {
    if (this.openId) { this.renderDetail(); return; }
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    const header = pageHeader(d, {
      title: 'বাড়ির কাজ',
      subtitle: this.isStaff ? 'দেওয়া কাজ ও জমা পড়া উত্তর' : 'তোমার জমা দিতে হবে যেসব',
    });
    root.append(header);

    // B-30. A refusal outranks the offline banner, the skeleton and the
    // empty state: nothing is loading, there is nothing to show, and
    // calling it "offline" is the lie this item exists to remove.
    if (this.denied) {
      root.append(permissionState(d, {
        message: deniedMessage(this.deniedErr, 'বাড়ির কাজ'),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }

    // Could not load, and nothing cached to show instead. Not the empty
    // state: "you have no homework" would be a claim about data never seen.
    if (this.failed) {
      root.append(errorState(d, `বাড়ির কাজের তালিকা আনা গেল না। ${ERROR_TAIL}`, () => {
        this.failed = false;
        this.loading = true;
        void this.loadList();
      }));
      return;
    }

    // Offline is a statement about the DATA, not a failure: yesterday's
    // homework list is exactly as useful as today's for knowing what is due.
    if (this.offline) {
      root.append(el(d, 'p', {
        className: 'offline-banner assign-offline', attrs: { role: 'status' },
      }, icon(d, 'wifi-off', 'offline-icon'),
         el(d, 'span', { text: 'অফলাইন — সংরক্ষিত তালিকা দেখানো হচ্ছে' })));
    }
    if (this.loading && this.list.length === 0) { root.append(listSkeleton(d, 4)); return; }
    if (this.list.length === 0) {
      root.append(emptyState(d, {
        glyph: 'clipboard',
        message: this.isStaff
          ? 'এখনো কোনো কাজ দেওয়া হয়নি। কাজ দিলে জমা ও মূল্যায়ন এখানে দেখা যাবে।'
          : 'এখন কোনো বাড়ির কাজ নেই। শিক্ষক কাজ দিলে এখানে দেখা যাবে।',
      }));
      return;
    }

    root.append(this.filterBar());

    const shown = this.list.filter((a) => this.matchesFilter(a));

    // ONE column definition, two audiences. A student compares due dates; a
    // teacher compares how many submissions are still unmarked. Rendering
    // both from one call is what keeps the two from drifting apart.
    //
    // The `mobile` roles ARE the drawn phone row: title "বিষয় — কাজ"; line
    // two the section (teacher) or the due time (student); line three the
    // submission count and the due chip (teacher) or the urgency chip
    // (student). The subject leads the title, so it has no column of its own.
    const title: Column<Assignment> = {
      key: 'title', header: 'কাজ', mobile: 'title', width: 'minmax(0, 2.4fr)',
      cell: (a) => rowTitle(a),
    };
    const columns: Array<Column<Assignment>> = this.isStaff
      ? [
          title,
          { key: 'section', header: 'শাখা', mobile: 'subtitle', width: 'minmax(0, 1fr)',
            cell: (a) => `শাখা ${a.sectionName}` },
          // The marking state lives in these words — "৬ দেখা বাকি" / "সব দেখা" —
          // so the phone row needs no separate state chip.
          { key: 'subs', header: 'জমা', mobile: 'meta', width: 'minmax(0, 1.6fr)',
            cell: (a) => this.countCell(a) },
          { key: 'due', header: 'শেষ তারিখ', mobile: 'status', width: '150px',
            cell: (a) => badge(d, { label: dueLabel(a.dueAt).text, tone: 'neutral' }) },
        ]
      : [
          title,
          { key: 'due', header: 'শেষ তারিখ', mobile: 'subtitle', width: 'minmax(0, 1.4fr)',
            cell: (a) => bnDateTime(a.dueAt) },
          { key: 'state', header: 'অবস্থা', mobile: 'status', width: '150px',
            cell: (a) => this.stateBadge(a) },
        ];

    root.append(dataTable(d, {
      caption: this.isStaff ? 'দেওয়া কাজের তালিকা' : 'বাড়ির কাজের তালিকা',
      className: this.isStaff ? 'assign-data' : 'assign-data is-student',
      rows: shown,
      rowKey: (a) => a.id,
      onRowClick: (a) => { void this.openDetail(a.id); },
      empty: this.emptyForFilter(),
      columns,
    }));
  }

  /**
   * The teacher's count, with its meaning in words beside the colour:
   * "২৪ জমা · ৬ দেখা বাকি" (warn), "১১ জমা · সব দেখা" (ok), "এখনো জমা নেই".
   */
  private countCell(a: Assignment): HTMLElement {
    const d = this.o.doc;
    const text = a.submissionCount === 0
      ? 'এখনো জমা নেই'
      : a.ungradedCount > 0
        ? `${bn(a.submissionCount)} জমা · ${bn(a.ungradedCount)} দেখা বাকি`
        : `${bn(a.submissionCount)} জমা · সব দেখা`;
    const tone = a.submissionCount === 0 ? 'neutral' : a.ungradedCount > 0 ? 'warn' : 'success';
    return el(d, 'span', { className: 'assign-count', data: { tone } }, ...numText(d, text));
  }

  /**
   * What a student's row state IS, in their own terms — debt, not progress.
   *
   * Mapped onto the SHARED status vocabulary, so an overdue assignment tints
   * like an overdue invoice rather than like homework only. "আজ শেষ" is drawn
   * red (03 Student §03), so it is `due` in the danger tone: the clock glyph
   * and the words still carry it.
   */
  private stateBadge(a: Assignment): HTMLElement {
    const d = this.o.doc;
    const sub = a.mySubmission;
    if (sub) {
      // A submitted assignment is no longer urgent, whatever the clock says.
      return sub.gradedAt
        ? statusBadge(d, {
            state: 'published',
            label: `${bn(sub.marksAwarded)}${a.maxMarks ? `/${bn(a.maxMarks)}` : ''}`,
          })
        : statusBadge(d, { state: 'invited', label: 'জমা হয়েছে' });
    }
    const due = dueLabel(a.dueAt);
    if (due.state === 'today') return statusBadge(d, { state: 'due', tone: 'danger', label: due.text });
    const STATE: Record<'overdue' | 'soon' | 'later', string> = {
      overdue: 'overdue', soon: 'due', later: 'pending',
    };
    return statusBadge(d, { state: STATE[due.state], label: due.text });
  }

  private renderDetail(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    root.append(backLink(d, 'সব কাজ', () => {
      this.openId = null; this.detail = null; this.notice = ''; this.conflict = null;
      this.detailDeniedErr = null;
      void this.loadList();
    }));

    // Loading, refused and failed are three different sentences. A failed
    // read used to leave the skeleton up forever.
    if (this.loading || this.detailDeniedErr || !this.detail) {
      root.append(pageHeader(d, { title: 'বাড়ির কাজ' }));
      if (this.loading) {
        root.append(listSkeleton(d, 3));
      } else if (this.detailDeniedErr) {
        root.append(permissionState(d, {
          message: deniedMessage(this.detailDeniedErr, 'বাড়ির কাজ'),
          contact: deniedContact(this.detailDeniedErr),
        }));
      } else {
        root.append(errorState(d, `কাজটি আনা গেল না। ${ERROR_TAIL}`, () => {
          if (this.openId) void this.openDetail(this.openId);
        }));
      }
      return;
    }

    const a = this.detail.assignment;
    const due = dueLabel(a.dueAt);
    root.append(pageHeader(d, {
      title: a.titleBn,
      subtitle: `${a.subjectBn} · ${due.text}${a.maxMarks ? ` · সর্বোচ্চ ${bn(a.maxMarks)}` : ''}`,
    }));

    // Directly under the title: an unresolved conflict is the only thing on
    // this screen that is waiting on the teacher.
    this.renderConflict(root);

    if (a.instructionsBn) {
      root.append(
        el(d, 'p', { className: 'label assign-eyebrow', text: 'নির্দেশনা' }),
        el(d, 'div', { className: 'card assign-instructions' }, ...numText(d, a.instructionsBn)),
      );
    }

    if (this.notice) root.append(this.noticeEl(this.notice));

    if (this.isStaff) { this.renderSubmissionList(root); return; }

    /* ------------------------------------------------------ student answer */
    const mine = this.detail.submissions.find((s) => s.studentId === this.o.auth.userId);

    if (mine?.gradedAt) {
      // The result, flush left and in ink: a mark is not good or bad news by
      // itself, so it takes no semantic colour — the words say what it is.
      root.append(el(d, 'div', { className: 'card assign-graded' },
        el(d, 'p', { className: 'label assign-score-label', text: 'প্রাপ্ত নম্বর' }),
        el(d, 'p', {
          className: 'assign-score n',
          text: `${bn(mine.marksAwarded)}${a.maxMarks ? ` / ${bn(a.maxMarks)}` : ''}`,
        }),
        mine.feedbackBn
          ? el(d, 'p', { className: 'assign-feedback' }, ...numText(d, mine.feedbackBn))
          : null));
      root.append(
        el(d, 'p', { className: 'label assign-eyebrow', text: 'তোমার উত্তর' }),
        el(d, 'div', { className: 'card assign-instructions' }, ...numText(d, mine.bodyBn ?? '')),
      );
      return;
    }

    const closed = !a.allowsLate && Date.parse(a.dueAt) < Date.now();
    if (closed) {
      root.append(el(d, 'p', { className: 'assign-note', attrs: { role: 'status' } },
        icon(d, 'clock'),
        el(d, 'span', { text: 'সময় শেষ — এই কাজটি আর জমা নেওয়া হচ্ছে না।' })));
      return;
    }

    const assignmentId = a.id;
    const answer = field(d, {
      label: 'তোমার উত্তর',
      name: 'answer',
      kind: 'textarea',
      value: this.draft,
      placeholder: 'এখানে লেখো…',
      attrs: { rows: 8 },
      onInput: (value) => {
        this.draft = value;
        // Autosave continuously (§6.6). localStorage is synchronous and an
        // answer is a few KB — a student on a dying battery or a flaky signal
        // must not lose typed work to a backgrounded, evicted tab. An emptied
        // field clears the key, so "I deleted it" is not later "restored".
        try {
          if (value) localStorage.setItem(this.draftKey(assignmentId), value);
          else localStorage.removeItem(this.draftKey(assignmentId));
        } catch { /* private mode / quota — the in-memory draft still holds */ }
        if (this.draftStatusEl) this.draftStatusEl.textContent = value ? 'খসড়া সংরক্ষিত' : '';
      },
    });
    answer.input.classList.add('assign-answer');

    // Reassures the student their work is kept even before they submit —
    // the whole point of autosave is that they can trust leaving the screen.
    const status = el(d, 'span', {
      className: 'assign-draft-status',
      attrs: { 'aria-live': 'polite' },
      text: this.draft ? 'খসড়া সংরক্ষিত' : '',
    });
    this.draftStatusEl = status;
    answer.root.append(status);

    // The page's one primary, last in the card — where the thumb already is.
    const send = button(d, {
      label: mine ? 'উত্তর হালনাগাদ করো' : 'জমা দাও',
      variant: 'primary',
      block: true,
      onClick: () => { void this.submit(); },
    });

    const form = el(d, 'div', { className: 'card card-form assign-form' }, answer.root);
    const media = this.renderCapture(a.id);
    if (media) form.append(media);
    form.append(send);
    root.append(form);
  }

  /**
   * F-902. Photo of handwritten work, or a spoken answer.
   *
   * Returns null when the deployment has no object storage, which is the
   * current state: the bytes would name a blob that can never be fetched.
   * Rendering a disabled camera button instead would be worse than
   * rendering nothing — it advertises a capability the school does not
   * have and invites a student to lose work discovering that.
   *
   * The sync applier refuses media independently (SUBMISSION_MEDIA_ENABLED
   * there), so this is presentation, not enforcement.
   */
  private renderCapture(assignmentId: string): HTMLElement | null {
    if (!SUBMISSION_MEDIA_ENABLED) return null;
    const d = this.o.doc;
    const row = el(d, 'div', { className: 'assign-capture' },
      button(d, {
        label: 'ছবি তোলো', variant: 'secondary', glyph: 'camera',
        onClick: () => { void this.capturePhoto(assignmentId); },
      }),
      button(d, {
        label: this.recorder ? 'রেকর্ডিং থামাও' : 'বলে উত্তর দাও', variant: 'secondary',
        onClick: () => { void this.toggleVoice(assignmentId); },
      }));

    if (this.mediaDraft) {
      const heldText = this.mediaDraft.kind === 'photo'
        ? `ছবি যুক্ত হয়েছে (${bn(Math.round(this.mediaDraft.bytes / 1024))} কিলোবাইট)`
        : `রেকর্ডিং যুক্ত হয়েছে (${formatDuration(this.mediaDraft.durationMs ?? 0)})`;
      row.append(
        el(d, 'p', { className: 'assign-capture-held' }, ...numText(d, heldText)),
        button(d, {
          label: 'সরাও', variant: 'ghost',
          onClick: () => { this.mediaDraft = null; this.render(); },
        }),
      );
    }
    if (this.mediaNotice) {
      row.append(el(d, 'p', {
        className: 'inline-notice is-danger', attrs: { role: 'alert' },
      }, ...numText(d, this.mediaNotice)));
    }
    return row;
  }

  private renderSubmissionList(root: HTMLElement): void {
    const d = this.o.doc;
    const subs = this.detail?.submissions ?? [];
    if (subs.length === 0) {
      root.append(emptyState(d, {
        glyph: 'clipboard',
        message: 'এখনো কেউ জমা দেয়নি। কেউ জমা দিলে এখানে নাম ও উত্তর দেখা যাবে।',
      }));
      return;
    }

    const ul = el(d, 'ul', { className: 'sub-list', attrs: { 'aria-label': 'জমা পড়া উত্তর' } });
    for (const s of subs) {
      const name = s.fullNameBn ?? '—';
      const li = el(d, 'li', { className: 'sub-item' });

      // Roll first, as on every roster row; an identifier, so Latin digits.
      const who = el(d, 'span', { className: 'sub-who' },
        s.rollNo ? el(d, 'span', { className: 'sub-roll n', text: formatIdentifier(s.rollNo) }) : null,
        name);
      const state = s.gradedAt
        ? statusBadge(d, { state: 'published', label: `${bn(s.marksAwarded)} নম্বর` })
        : s.isLate
          ? statusBadge(d, { state: 'late', label: 'দেরিতে জমা' })
          : statusBadge(d, { state: 'pending', label: 'অদেখা' });
      li.append(el(d, 'div', { className: 'sub-head' }, who, state));
      li.append(el(d, 'p', { className: 'sub-body' }, ...numText(d, s.bodyBn ?? '(ছবি)')));

      if (!s.gradedAt) {
        const mark = el(d, 'input', {
          className: 'ui-input n is-num sub-mark',
          attrs: {
            type: 'number', min: '0', step: '0.5', placeholder: 'নম্বর',
            'aria-label': `${name} — নম্বর`,
          },
        });
        const fb = el(d, 'input', {
          className: 'ui-input sub-feedback',
          attrs: { type: 'text', placeholder: 'মন্তব্য (ঐচ্ছিক)', 'aria-label': `${name} — মন্তব্য` },
        });
        // Secondary, not primary: one of these sits on every unmarked row,
        // and the screen keeps a single accent button.
        const save = button(d, {
          label: 'দাও',
          variant: 'secondary',
          size: 'sm',
          onClick: () => {
            const m = Number(mark.value);
            if (!Number.isFinite(m) || m < 0) {
              this.notice = 'সঠিক নম্বর দিন।';
              this.noticeTone = 'error';
              this.render();
              return;
            }
            void this.grade(s.id, m, fb.value.trim(), s.rowVersion);
          },
        });
        li.append(el(d, 'div', { className: 'sub-grade-row' }, mark, fb, save));
      } else if (s.feedbackBn) {
        li.append(el(d, 'p', { className: 'assign-feedback' }, ...numText(d, s.feedbackBn)));
      }
      ul.append(li);
    }
    root.append(ul);
  }

  /**
   * A write's outcome, in the colour of what happened: the shared success
   * note (ok strip, check glyph) or the shared error card. Both were one
   * warn-toned banner, so "নম্বর সংরক্ষিত" looked like a warning.
   */
  private noticeEl(text: string): HTMLElement {
    const d = this.o.doc;
    if (this.noticeTone === 'success') {
      const ok = successNote(d, text);
      ok.setAttribute('role', 'status');
      return ok;
    }
    const err = errorState(d, text);
    err.classList.add('assign-notice');
    return err;
  }

  /** Which bucket an assignment falls in, from the student's point of view. */
  private matchesFilter(a: Assignment): boolean {
    if (this.isStaff) {
      // Staff read the same three buckets as marking progress, not as debt.
      if (this.filter === 'pending')   return a.ungradedCount > 0;
      if (this.filter === 'submitted') return a.submissionCount > 0;
      return a.submissionCount > 0 && a.ungradedCount === 0;
    }
    const sub = a.mySubmission;
    if (this.filter === 'pending')   return sub === null;
    if (this.filter === 'submitted') return sub !== null && !sub.gradedAt;
    return sub !== null && !!sub.gradedAt;
  }

  private countFor(f: Bucket): number {
    const was = this.filter;
    this.filter = f;
    const n = this.list.filter((a) => this.matchesFilter(a)).length;
    this.filter = was;
    return n;
  }

  /** The three buckets in the order the design draws them, with their words. */
  private buckets(): Array<[Bucket, string]> {
    // Teacher (02 Teacher §05): the review queue is the middle tab and the
    // default. Student (03 Student §03): what is still owed comes first.
    return this.isStaff
      ? [['submitted', 'জমা হয়েছে'], ['pending', 'জমা দেখা বাকি'], ['graded', 'দেখা শেষ']]
      : [['pending', 'জমা দিতে হবে'], ['submitted', 'জমা দিয়েছি'], ['graded', 'নম্বর পেয়েছি']];
  }

  /**
   * A segmented control, not a dropdown: three options that must all be
   * visible and reachable in one tap. Each tab carries its count, so the
   * student knows there is nothing under a tab before opening it.
   */
  private filterBar(): HTMLElement {
    // The P2 tab strip, which carries a roving tabindex and arrow keys. The
    // hand-rolled `.seg-bar` had `role=tab` and neither, so a keyboard user
    // met three stops that behaved like buttons wearing tab clothing.
    // Each tab keeps its count: knowing a tab is empty before opening it is
    // the whole reason the count is there.
    return tabs(this.o.doc, {
      label: 'বাড়ির কাজের অবস্থা',
      className: this.isStaff ? 'assign-tabs' : 'assign-tabs is-student',
      active: this.filter,
      items: this.buckets().map(([id, label]) => ({ id, label, count: this.countFor(id) })),
      onSelect: (id) => {
        if (id === this.filter) return;
        this.filter = id as Bucket;
        this.render();
      },
    });
  }

  /**
   * The empty state for the CURRENT filter, as `emptyState`'s options.
   *
   * Handed to `dataTable`, which renders it inside the table and keeps the
   * header — because "nothing is pending" and "this class has no homework"
   * look identical once the column headings are gone.
   *
   * The glyph was a literal `⃝` (U+20DD COMBINING ENCLOSING CIRCLE) typed as
   * text, which renders as a stray ring on most Android fonts. "Nothing
   * pending" is good news and gets the tick; the rest get a real icon.
   *
   * The way out (00 Foundations §04: say what is missing, then the next
   * action) is the next bucket that HAS work in it — the same switch as
   * tapping that tab, over rows already loaded.
   */
  private emptyForFilter(): EmptyOptions {
    const staff = this.isStaff;
    const copy: Record<Bucket, [string, string]> = staff
      ? {
          pending: ['সব খাতা দেখা হয়েছে।', 'নতুন জমা এলে এখানে দেখা যাবে।'],
          submitted: ['এখনো কেউ জমা দেয়নি।', 'শিক্ষার্থীরা জমা দিলে এখানে দেখা যাবে।'],
          graded: ['এখনো কিছু মূল্যায়ন করা হয়নি।', 'কোনো কাজের সব খাতা দেখা হলে এখানে আসবে।'],
        }
      : {
          pending: ['কোনো কাজ বাকি নেই।', 'নতুন কাজ এলে এখানে দেখা যাবে।'],
          submitted: ['জমা দেওয়া কোনো কাজ নেই।', 'জমা দেওয়া কাজ নম্বর পাওয়া পর্যন্ত এখানে থাকে।'],
          graded: ['এখনো কোনো কাজ মূল্যায়িত হয়নি।', 'শিক্ষক নম্বর দিলে এখানে দেখা যাবে।'],
        };
    const goTo: Record<Bucket, string> = staff
      ? { submitted: 'জমা পড়া কাজ দেখুন', pending: 'দেখা বাকি কাজ দেখুন', graded: 'দেখা শেষ কাজ দেখুন' }
      : { pending: 'জমা দিতে হবে এমন কাজ দেখো', submitted: 'জমা দেওয়া কাজ দেখো', graded: 'নম্বর পাওয়া কাজ দেখো' };

    const next = this.buckets()
      .map(([id]) => id)
      .find((id) => id !== this.filter && this.countFor(id) > 0);
    const [message, detail] = copy[this.filter];
    return {
      glyph: this.filter === 'pending' ? 'check-square' : 'clipboard',
      message,
      detail,
      action: next
        ? { label: goTo[next], onClick: () => { this.filter = next; this.render(); } }
        : undefined,
    };
  }
}

/** Content hash, so a retry after a dropped connection is the same object. */
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
