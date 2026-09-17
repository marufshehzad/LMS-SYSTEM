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
import { formatIdentifier, parseUserNumber } from '../../../packages/ui-core/src/format.ts';
import {
  planCompression, checkMedia, formatDuration, MEDIA_PROBLEM_BN, MAX_VOICE_MS,
  type MediaDraft,
} from '../../../packages/ui-core/src/media.ts';
import { emptyState, errorState, successNote, bnDateTime, type EmptyOptions } from './view-states.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import {
  pageHeader, backLink, permissionState, deniedMessage, deniedContact, dataTable,
  statusBadge, badge, tabs, listSkeleton, button, field, el, icon, numText,
  focusIsLost, serverMessage,
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

/**
 * A grading attempt that did not land, held until the teacher acts on it.
 *
 * It belongs to ONE row. The old notice was a card above the whole list, so
 * a teacher grading row 20 saw nothing happen beside the row, and the render
 * that drew the card also emptied every mark box on the page.
 */
interface GradeError {
  submissionId: string;
  text: string;
  /** The mark itself is what is wrong: the box is flagged and takes focus. */
  invalid: boolean;
  /** A failure a second attempt can fix (no connection, a 5xx): what to send again. */
  retry: { marks: number; feedback: string; rowVersion: number } | null;
  /** Where the attempt was made, so the sentence appears beside it. */
  from: 'row' | 'conflict';
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

/**
 * Where keyboard focus goes once a change the person asked for is drawn.
 *
 * Opening an assignment, going back to the list and retrying a read each
 * delete the control that was pressed. The shell's focus keeper can only
 * return focus to that SAME control, and it is not in the new page, so focus
 * waited on `main#shell-view` with no ring and nothing announced: a
 * screen-reader user heard nothing about the page they had just opened. Only
 * this view knows what the new page is, so it says where focus lands:
 *
 *   row     the assignment to return to on the list; null: the page title
 *   retry   the change was a retry, so a second failure lands on the retry
 *   hold    where focus waits while the change loads (the page title)
 */
interface FocusGoal {
  row: string | null;
  retry: boolean;
  hold: HTMLElement | null;
}

/** The two shapes of a list row's open control: the phone row and the table's chevron. */
const ROW_OPEN = ['ui-list-hit', 'ui-row-open'] as const;

const CACHE_KEY = 'shikhon_assignments_cache';

const BN: Record<string, string> = { '0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯' };
function bn(s: string | number | null | undefined): string {
  if (s === null || s === undefined || s === '') return '—';
  return String(s).replace(/[0-9]/g, (d) => BN[d] ?? d);
}

/**
 * A mark as it is read: "১০", "৮.৫" — not the column's "১০.০০". The server
 * sends numeric(…, 2) as text, and the trailing zeros said nothing but
 * made "সর্বোচ্চ ১০.০০" look like money.
 */
function markText(s: string | number | null | undefined): string {
  if (s === null || s === undefined || s === '') return '—';
  const n = Number(s);
  return bn(Number.isFinite(n) ? String(n) : s);
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
  /**
   * What `notice` means, so a confirmation never wears a warning's colour.
   * `queued` is an answer kept on this device for want of a connection: not
   * a failure, and not yet a delivery either.
   */
  private noticeTone: 'success' | 'error' | 'queued' = 'error';
  /**
   * What the teacher has typed into each unmarked row, by submission id.
   * Every render rebuilds the list, so without this a failed save, a
   * validation message or a conflict emptied every mark box on the page.
   */
  private gradeInputs = new Map<string, { mark: string; feedback: string }>();
  /**
   * Grading attempts that did not land, by submission id, each shown beside
   * its own row. Several at once is the normal case on a failing connection.
   */
  private gradeErrors = new Map<string, GradeError>();
  /**
   * The failure that has just happened. Only its sentence is a live alert:
   * every render re-inserts the others, and re-announcing all of them after
   * each save would bury the one that is news.
   */
  private announceError: string | null = null;
  /** The row whose mark was just saved, which says so in place. */
  private gradeSaved: string | null = null;
  /** Rows with a save on the wire: a double tap must not send the mark twice. */
  private grading = new Set<string>();
  /** Removed in destroy(). */
  private readonly onOnline = (): void => { this.reconnected(); };
  private draft = '';
  private draftStatusEl: HTMLElement | null = null;
  /** F-902. Set when a photo or voice answer has been captured for this assignment. */
  private mediaDraft: MediaDraft & { objectKey: string } | null = null;
  private mediaNotice = '';
  private recorder: MediaRecorder | null = null;
  private recStartedAt = 0;
  /** F-103. Non-null while a grading race is waiting on a human. */
  private conflict: GradeConflict | null = null;
  /** The focus change in progress (see FocusGoal). A newer action replaces it. */
  private focusGoal: FocusGoal | null = null;
  /**
   * Which shape of row the open assignment was opened from, so going back
   * returns focus to that one: the other shape is hidden at this width and
   * cannot take focus.
   */
  private openedVia: (typeof ROW_OPEN)[number] | null = null;

  /** Per-assignment autosave key (§6.6: "drafts autosave continuously"). */
  private draftKey(assignmentId: string): string {
    return `shikhon_assign_draft_${assignmentId}`;
  }

  constructor(options: AssignmentsViewOptions) {
    this.o = options;
    // The screen's own "অফলাইন — সংরক্ষিত তালিকা" banner is set by a read,
    // so only another read can clear it. Without this it stayed up after the
    // connection came back, over a list nobody was going to refresh.
    this.o.doc.defaultView?.addEventListener('online', this.onOnline);
    void this.loadList();
  }

  /** app.ts calls this when the route unmounts. */
  destroy(): void {
    this.o.doc.defaultView?.removeEventListener('online', this.onOnline);
    // A read still on the wire must not move focus on the next route's page.
    this.focusGoal = null;
  }

  /* ---------------------------------------------------------------- focus */

  /**
   * Start a focus change for an action the person just took on this screen.
   * Only when focus is in the screen (or already lost): a re-read nobody
   * pressed for, or a press while focus is elsewhere, moves nothing.
   */
  private claimFocus(row: string | null, retry = false): FocusGoal | null {
    const d = this.o.doc;
    const active = d.activeElement;
    const inView = focusIsLost(d) || (active !== null && this.o.root.contains(active));
    this.focusGoal = inView ? { row, retry, hold: null } : null;
    return this.focusGoal;
  }

  /**
   * Focus is still where the goal left it, or lost: the person has not moved
   * on while the change loaded. Asked BEFORE the render that ends the change,
   * because that render deletes the element focus is waiting on.
   */
  private stillHeld(goal: FocusGoal | null): boolean {
    if (!goal || this.focusGoal !== goal) return false;
    const d = this.o.doc;
    return focusIsLost(d) || (goal.hold !== null && d.activeElement === goal.hold);
  }

  /**
   * After a render: put focus on the goal's target in what was just drawn.
   * `done` ends the goal (the change's last render); `held` is stillHeld()
   * from before that render.
   */
  private landFocus(goal: FocusGoal | null, done = false, held = true): void {
    if (!goal || this.focusGoal !== goal) return;
    if (done) this.focusGoal = null;
    const d = this.o.doc;
    // Focus that is somewhere real (the shell's nav, a control the person
    // reached while this loaded) is theirs.
    if (!held || !focusIsLost(d)) return;
    const root = this.o.root;
    const targets: HTMLElement[] = [];
    if (!this.openId && goal.row !== null) {
      // The row that was opened, in the shape it was opened from first.
      const hits = [...root.querySelectorAll<HTMLElement>('[data-key]')]
        .filter((n) => n.dataset.key === goal.row)
        .flatMap((n) => [...n.querySelectorAll<HTMLElement>(ROW_OPEN.map((c) => `button.${c}`).join(','))]);
      const via = this.openedVia;
      if (via) hits.sort((a, b) => Number(b.classList.contains(via)) - Number(a.classList.contains(via)));
      targets.push(...hits);
    }
    if (goal.retry) {
      const again = root.querySelector<HTMLElement>('.ui-state-error .ui-state-action');
      if (again) targets.push(again);
    }
    // The page title: what a route change announces, and the top of the new
    // page for the next Tab. tabindex -1 takes it out of the Tab order.
    const title = root.querySelector<HTMLElement>('h1');
    if (title) {
      if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
      targets.push(title);
    }
    for (const t of targets) {
      // A hidden shape (the table below 1024px) refuses focus; try the next.
      try { t.focus(); } catch { /* detached */ }
      if (d.activeElement === t) { goal.hold = t; return; }
    }
  }

  /** The row control focus is on, if it is one: which shape the person opened from. */
  private rowShape(): (typeof ROW_OPEN)[number] | null {
    const active = this.o.doc.activeElement;
    if (!active || !this.o.root.contains(active)) return null;
    return ROW_OPEN.find((c) => active.classList.contains(c)) ?? null;
  }

  /**
   * The connection is back. Re-read only what was read from the cache or
   * failed for want of a connection: a screen that is already current does
   * not flash a skeleton, and an open answer or typed mark is left alone.
   */
  private reconnected(): void {
    if (this.denied || this.loading) return;
    if (this.openId) {
      // A detail that could not be read is the error card; read it again.
      if (this.offline && !this.detail && !this.detailDeniedErr) void this.openDetail(this.openId);
      return;
    }
    if (this.failed) {
      // As the error card's own retry does: no cached list, so a skeleton.
      this.failed = false;
      this.loading = true;
      void this.loadList();
      return;
    }
    if (this.offline) void this.loadList();
  }

  private get isStaff(): boolean {
    return !['student', 'guardian'].includes(this.o.auth.role);
  }

  /** `goal`: where focus lands once the list is drawn (see FocusGoal). */
  private async loadList(goal: FocusGoal | null = null): Promise<void> {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) { this.list = JSON.parse(raw) as Assignment[]; this.loading = false; }
    } catch { /* cache is a nicety */ }
    this.render();
    // The cached row, or the title over the skeleton, while the list is read.
    this.landFocus(goal);

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
        this.loading = false;
        const held = this.stillHeld(goal);
        this.render();
        this.landFocus(goal, true, held);
        return;
      }
      this.offline = this.list.length > 0;
      this.failed = this.list.length === 0;
    }
    this.loading = false;
    const held = this.stillHeld(goal);
    this.render();
    this.landFocus(goal, true, held);
  }

  /**
   * `keepNotice`: a re-read that follows an outcome the teacher must still
   * see ("আগের নম্বরই রাখা হয়েছে।"). Clearing it here erased that sentence
   * before it was ever drawn.
   */
  private async openDetail(
    id: string,
    o: {
      keepNotice?: boolean;
      /**
       * The person asked for this (a row, a retry, a choice on the conflict
       * card), so focus moves to the opened page's title. Not for a re-read
       * on reconnect, which must leave focus where it is.
       */
      focus?: 'title' | 'retry';
    } = {},
  ): Promise<void> {
    if (this.openId !== id) {
      // Typed marks and their messages belong to one assignment's rows.
      this.gradeInputs.clear();
      this.gradeErrors.clear();
      this.gradeSaved = null;
    }
    let goal: FocusGoal | null = null;
    if (o.focus) {
      if (!this.openId) this.openedVia = this.rowShape();
      goal = this.claimFocus(null, o.focus === 'retry');
    }
    this.openId = id;
    this.detail = null;
    this.detailDeniedErr = null;
    if (!o.keepNotice) this.notice = '';
    this.draft = '';
    this.loading = true;
    this.render();
    // The title over the skeleton, so the wait is not spent on <main>.
    this.landFocus(goal);
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
    const held = this.stillHeld(goal);
    this.render();
    this.landFocus(goal, true, held);
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
      // The screen knows whether it is offline, so it says which one
      // happened instead of "(অফলাইন হলে …)" in the colour of a delivery.
      if (this.o.doc.defaultView?.navigator.onLine === false) {
        this.notice = 'তোমার উত্তর এই যন্ত্রে রাখা আছে — সংযোগ ফিরলে নিজেই জমা হবে।';
        this.noticeTone = 'queued';
      } else {
        this.notice = 'জমা হয়েছে।';
        this.noticeTone = 'success';
      }
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
    from: 'row' | 'conflict' = 'row',
  ): Promise<void> {
    // One save per row at a time. A second tap while the first is on the wire
    // sent the old rowVersion again, and came back as a "conflict" with the
    // teacher's own first write.
    if (this.grading.has(submissionId)) return;
    this.grading.add(submissionId);
    let res: Response | null = null;
    let body: {
      ok?: boolean; error?: string; message?: string; conflict?: GradeConflict; rowVersion?: number;
    } = {};
    try {
      res = await this.o.auth.authedFetch('/api/v1/academics/assignments', {
        method: 'POST',
        // F-103: rowVersion is what the screen was showing. Without it the
        // server rejects the write rather than silently overwriting.
        body: JSON.stringify({ submissionId, marksAwarded: marks, feedbackBn: feedback, rowVersion }),
      });
      body = (await res.json().catch(() => ({}))) as typeof body;
    } catch {
      res = null;
    } finally {
      this.grading.delete(submissionId);
    }
    // What the page shows now, after the wait — not when the tap happened.
    const before = this.aboveListKey();

    if (res?.ok && body.ok) {
      // A conflict card about ANOTHER row is still waiting on the teacher.
      if (this.conflict?.submissionId === submissionId) this.conflict = null;
      this.notice = '';
      this.gradeErrors.delete(submissionId);
      this.gradeInputs.delete(submissionId);
      // The server has confirmed this write and echoed the row's new
      // version, so the row is updated in place. Re-reading the assignment
      // put a skeleton up after every mark: the page shrank, the scroll
      // position went back to the top, and the teacher had to find row 20
      // again for row 21.
      const s = this.detail?.submissions.find((x) => x.id === submissionId);
      if (s) {
        s.marksAwarded = String(marks);
        s.feedbackBn = feedback || null;
        s.gradedAt = new Date().toISOString();
        s.rowVersion = typeof body.rowVersion === 'number' ? body.rowVersion : s.rowVersion + 1;
      }
      // "নম্বর সংরক্ষিত" stands beside the newest save only.
      const prev = this.gradeSaved;
      this.gradeSaved = submissionId;
      if (prev && prev !== submissionId) this.rowPart(prev, '.sub-grade-saved')?.remove();
      this.redraw(submissionId, before);
      // The দাও button has gone with the row's form, so focus goes to the
      // "saved" note in its place rather than to nobody. From the conflict
      // card at the top the row may be far down, so that one scrolls.
      if (focusIsLost(this.o.doc)) {
        this.rowPart(submissionId, '.sub-grade-saved')?.focus({ preventScroll: from === 'row' });
      }
      return;
    }
    if (res?.status === 409 && body.conflict) {
      // Not an error to dismiss — a decision to put in front of a person.
      this.conflict = body.conflict;
      this.notice = null;
      this.gradeErrors.delete(submissionId);
      this.render();
      return;
    }
    const invalid = !!res && (body.error === 'marks_exceed_max' || body.error === 'invalid_marks');
    const failure: GradeError = res
      ? {
          submissionId, from, invalid,
          text: body.error === 'marks_exceed_max'
            ? 'নম্বর সর্বোচ্চ নম্বরের চেয়ে বেশি হতে পারে না।'
            : body.error === 'invalid_marks'
              ? 'সঠিক নম্বর দিন।'
              : body.error === 'row_version_required'
                ? 'তালিকাটি পুরোনো — আবার লোড করে চেষ্টা করুন।'
                // The public preview's own sentence ("এটি প্রদর্শনী সংস্করণ — …"),
                // which is not a permission problem and must not read as one.
                : body.error === 'demo_read_only' && typeof body.message === 'string' && /[ঀ-৿]/.test(body.message)
                  ? body.message
                  // A refusal, or the server's Bangla sentence; generic otherwise.
                  : serverMessage(body, res.status, 'নম্বর সংরক্ষণ করা যায়নি।'),
          // A 5xx can pass on a second try; a refusal or a bad request cannot.
          retry: res.status >= 500 ? { marks, feedback, rowVersion } : null,
        }
      : {
          submissionId, from, invalid: false,
          text: `নম্বর পাঠানো যায়নি। ${ERROR_TAIL}`,
          retry: { marks, feedback, rowVersion },
        };
    // Only this row's sentence changes, so only this row is drawn again, and
    // the shell's focus keeper returns focus to the same দাও in it.
    this.gradeErrors.set(submissionId, failure);
    this.announceError = submissionId;
    this.redraw(submissionId, before);
    // Into the box the sentence is about — unless the teacher has already
    // moved on to another row while this one was on the wire.
    if (failure.invalid && failure.from === 'row' && focusIsLost(this.o.doc)) this.focusMark(submissionId);
  }

  /**
   * Show a grading outcome. When nothing above the list changes, only that
   * submission's row is built again. A whole-page render also rebuilt every
   * OTHER row's mark and comment boxes: the values came back, but on an
   * Android keyboard rebuilding a field ends the word being composed in it,
   * and a teacher on 3G is typing into the next row while this one saves.
   */
  private redraw(submissionId: string, before: string): void {
    const s = this.detail?.submissions.find((x) => x.id === submissionId);
    const old = this.rowEl(submissionId);
    if (!this.openId || this.loading || !this.detail || !s || !old || this.aboveListKey() !== before) {
      this.render();
      return;
    }
    if (this.announceError === submissionId) {
      // Only the newest failure is a live alert (see announceError).
      for (const p of this.o.root.querySelectorAll('.sub-grade-error [role="alert"]')) p.removeAttribute('role');
    }
    old.replaceWith(this.submissionItem(s, this.detail.assignment.maxMarks));
    this.announceError = null;
  }

  /**
   * What renderDetail draws between the header and the submission list — the
   * conflict card, the notice, and the errors that cannot sit in a row — as
   * one comparable value.
   */
  private aboveListKey(): string {
    return JSON.stringify([
      this.conflict,
      this.notice || '',
      this.notice ? this.noticeTone : '',
      this.detachedErrors().map((e) => [e.submissionId, e.text, e.retry !== null]),
    ]);
  }

  /**
   * Grading errors shown as a card above the list: a save made from the
   * conflict card, or a row that is no longer open for marking and so cannot
   * hold its own message.
   */
  private detachedErrors(): GradeError[] {
    const subs = this.detail?.submissions ?? [];
    return [...this.gradeErrors.values()].filter((ge) => !(ge.from === 'row'
      && subs.some((s) => s.id === ge.submissionId && !s.gradedAt)));
  }

  /** One submission's row, by id. */
  private rowEl(submissionId: string): HTMLElement | null {
    for (const li of this.o.root.querySelectorAll<HTMLElement>('.sub-item')) {
      if (li.dataset.id === submissionId) return li;
    }
    return null;
  }

  /** An element inside one submission's row, by selector. */
  private rowPart(submissionId: string, selector: string): HTMLElement | null {
    return this.rowEl(submissionId)?.querySelector<HTMLElement>(selector) ?? null;
  }

  /** Put the teacher back in the mark box the message is about. */
  private focusMark(submissionId: string): void {
    this.rowPart(submissionId, '.sub-mark')?.focus();
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
    addRow('তাঁদের নম্বর', markText(c.theirs.marksAwarded), c.theirs.feedbackBn);
    addRow('আপনার নম্বর', markText(c.yours.marksAwarded), c.yours.feedbackBn);
    card.append(table);

    const keep = button(d, {
      label: 'তাঁদেরটি রাখুন',
      variant: 'secondary',
      onClick: () => {
        this.conflict = null;
        this.notice = 'আগের নম্বরই রাখা হয়েছে।';
        this.noticeTone = 'success';
        this.gradeErrors.delete(c.submissionId);
        // The row now holds their mark, so what was typed into it is moot.
        this.gradeInputs.delete(c.submissionId);
        if (this.openId) void this.openDetail(this.openId, { keepNotice: true, focus: 'title' });
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
          'conflict',
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
        const goal = this.claimFocus(null, true);
        this.failed = false;
        this.loading = true;
        void this.loadList(goal);
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
      onRowClick: (a) => { void this.openDetail(a.id, { focus: 'title' }); },
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
            label: `${markText(sub.marksAwarded)}${a.maxMarks ? `/${markText(a.maxMarks)}` : ''}`,
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
      // Back to the row that was opened, as a browser's back returns to the
      // link that was followed — not to <main>, and not to the top of the list.
      const goal = this.claimFocus(this.openId);
      this.openId = null; this.detail = null; this.notice = ''; this.conflict = null;
      this.detailDeniedErr = null;
      this.gradeInputs.clear(); this.gradeErrors.clear(); this.gradeSaved = null;
      void this.loadList(goal);
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
          if (this.openId) void this.openDetail(this.openId, { focus: 'retry' });
        }));
      }
      return;
    }

    const a = this.detail.assignment;
    const due = dueLabel(a.dueAt);
    root.append(pageHeader(d, {
      title: a.titleBn,
      subtitle: `${a.subjectBn} · ${due.text}${a.maxMarks ? ` · সর্বোচ্চ ${markText(a.maxMarks)}` : ''}`,
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

    // A save made from the conflict card is answered beside the card, and a
    // row that is no longer open for marking cannot hold its own message.
    for (const ge of this.detachedErrors()) {
      const retry = ge.retry;
      const card = errorState(d, ge.text, retry
        ? () => { void this.grade(ge.submissionId, retry.marks, retry.feedback, retry.rowVersion, ge.from); }
        : undefined);
      card.classList.add('assign-notice');
      root.append(card);
    }

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
          text: `${markText(mine.marksAwarded)}${a.maxMarks ? ` / ${markText(a.maxMarks)}` : ''}`,
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

    const maxMarks = this.detail?.assignment.maxMarks ?? null;
    const ul = el(d, 'ul', { className: 'sub-list', attrs: { 'aria-label': 'জমা পড়া উত্তর' } });
    for (const s of subs) ul.append(this.submissionItem(s, maxMarks));
    root.append(ul);
    // Announced once, on the render the failure caused.
    this.announceError = null;
  }

  /**
   * One submission's row: who, the answer, and either the grading form or
   * the mark. Built on its own so a grading outcome can replace just this
   * row (see redraw()).
   */
  private submissionItem(s: Submission, maxMarks: string | null): HTMLElement {
    const d = this.o.doc;
    const name = s.fullNameBn ?? '—';
    // data-id: the row's identity across renders, so the shell's focus
    // keeper sends focus back to THIS row's দাও, not the first one's.
    const li = el(d, 'li', { className: 'sub-item', data: { id: s.id } });

    // Roll first, as on every roster row; an identifier, so Latin digits.
    const who = el(d, 'span', { className: 'sub-who' },
      s.rollNo ? el(d, 'span', { className: 'sub-roll n', text: formatIdentifier(s.rollNo) }) : null,
      name);
    const state = s.gradedAt
      ? statusBadge(d, { state: 'published', label: `${markText(s.marksAwarded)} নম্বর` })
      : s.isLate
        ? statusBadge(d, { state: 'late', label: 'দেরিতে জমা' })
        : statusBadge(d, { state: 'pending', label: 'অদেখা' });
    li.append(el(d, 'div', { className: 'sub-head' }, who, state));
    li.append(el(d, 'p', { className: 'sub-body' }, ...numText(d, s.bodyBn ?? '(ছবি)')));

    if (!s.gradedAt) {
      const typed = this.gradeInputs.get(s.id);
      const found = this.gradeErrors.get(s.id);
      const err = found?.from === 'row' ? found : null;
      const errId = `sub-grade-error-${s.id}`;
      // type="text" + inputmode, as the marks sheet does: type="number"
      // reads an empty box as a valid 0, and on some keyboards drops a
      // Bangla ৮ without a word. parseUserNumber reads either digit system.
      const mark = el(d, 'input', {
        className: 'ui-input n is-num sub-mark',
        attrs: {
          type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'নম্বর',
          'aria-label': `${name} — নম্বর`,
        },
      });
      const fb = el(d, 'input', {
        className: 'ui-input sub-feedback',
        attrs: { type: 'text', placeholder: 'মন্তব্য (ঐচ্ছিক)', 'aria-label': `${name} — মন্তব্য` },
      });
      mark.value = typed?.mark ?? '';
      fb.value = typed?.feedback ?? '';
      if (err?.invalid) {
        // The sheet's error look (.ui-input.is-error), and the sentence is
        // read out with the box, not only once as it appears.
        mark.classList.add('is-error');
        mark.setAttribute('aria-invalid', 'true');
        mark.setAttribute('aria-describedby', errId);
      }

      let errEl: HTMLElement | null = null;
      const remember = (clearsInvalid: boolean) => () => {
        this.gradeInputs.set(s.id, { mark: mark.value, feedback: fb.value });
        // Cleared while the teacher fixes it, as a field's error is: a
        // sentence that stays reads as "still wrong". A retry would now
        // send stale values, so any edit takes that away too.
        const cur = this.gradeErrors.get(s.id);
        if (cur?.from === 'row' && (clearsInvalid || !cur.invalid)) {
          this.gradeErrors.delete(s.id);
          errEl?.remove();
          errEl = null;
          mark.classList.remove('is-error');
          mark.removeAttribute('aria-invalid');
          mark.removeAttribute('aria-describedby');
          save.removeAttribute('aria-describedby');
        }
      };
      // Secondary, not primary: one of these sits on every unmarked row,
      // and the screen keeps a single accent button.
      const save = button(d, {
        label: 'দাও',
        variant: 'secondary',
        size: 'sm',
        onClick: () => {
          const raw = mark.value.trim();
          const m = parseUserNumber(raw);
          const max = maxMarks === null ? NaN : Number(maxMarks);
          // Checked here, before anything is sent: an empty box used to go
          // out as marksAwarded 0, which the server stores as a real zero.
          const problem = raw === ''
            ? 'নম্বর লিখুন।'
            : m === null || m < 0
              ? 'সঠিক নম্বর দিন।'
              : Number.isFinite(max) && m > max
                ? `নম্বর সর্বোচ্চ ${markText(maxMarks)}-এর বেশি হতে পারে না।`
                : null;
          if (problem !== null || m === null) {
            const before = this.aboveListKey();
            this.gradeInputs.set(s.id, { mark: mark.value, feedback: fb.value });
            this.gradeErrors.set(s.id, {
              submissionId: s.id, text: problem ?? 'সঠিক নম্বর দিন।',
              invalid: true, retry: null, from: 'row',
            });
            this.announceError = s.id;
            this.redraw(s.id, before);
            this.focusMark(s.id);
            return;
          }
          void this.grade(s.id, m, fb.value.trim(), s.rowVersion);
        },
      });
      mark.addEventListener('input', remember(true));
      fb.addEventListener('input', remember(false));
      li.append(el(d, 'div', { className: 'sub-grade-row' }, mark, fb, save));

      if (err) {
        // A failure that is not about the mark is read with the button that
        // failed, which is where the focus keeper returns focus.
        if (!err.invalid) save.setAttribute('aria-describedby', errId);
        // The alert holds the words only; the retry is a control beside it.
        errEl = el(d, 'div', { className: 'sub-grade-error' },
          el(d, 'p', {
            className: 'ui-field-error',
            attrs: { id: errId, role: this.announceError === s.id ? 'alert' : null },
          }, ...numText(d, err.text)));
        const retry = err.retry;
        if (retry) {
          errEl.append(button(d, {
            label: 'আবার চেষ্টা করুন',
            variant: 'ghost',
            size: 'sm',
            onClick: () => { void this.grade(s.id, retry.marks, retry.feedback, retry.rowVersion); },
          }));
        }
        li.append(errEl);
      }
    } else {
      if (s.feedbackBn) {
        li.append(el(d, 'p', { className: 'assign-feedback' }, ...numText(d, s.feedbackBn)));
      }
      if (this.gradeSaved === s.id) {
        // Where the দাও button was, and focusable so focus has somewhere to
        // be once that button is gone (see grade()).
        const saved = successNote(d, 'নম্বর সংরক্ষিত');
        saved.classList.add('sub-grade-saved');
        saved.setAttribute('role', 'status');
        saved.setAttribute('tabindex', '-1');
        saved.setAttribute('data-focus-key', 'grade-saved');
        li.append(saved);
      }
    }
    return li;
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
    if (this.noticeTone === 'queued') {
      // The screen's own warn strip (as "সময় শেষ" uses): kept, not yet sent.
      return el(d, 'p', { className: 'assign-note', attrs: { role: 'status' } },
        icon(d, 'clock'), el(d, 'span', {}, ...numText(d, text)));
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
        ? {
            label: goTo[next],
            onClick: () => {
              this.filter = next;
              this.render();
              // The button went with the empty state. The person is now on
              // the tab it chose, so focus is too — not parked on <main>.
              if (focusIsLost(this.o.doc)) {
                this.o.root.querySelector<HTMLElement>('.assign-tabs [role="tab"][aria-selected="true"]')?.focus();
              }
            },
          }
        : undefined,
    };
  }
}

/** Content hash, so a retry after a dropped connection is the same object. */
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
