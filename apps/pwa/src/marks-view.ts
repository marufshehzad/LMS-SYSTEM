/**
 * Offline-first marks entry (নম্বর tab).
 *
 * Read side: GET /api/v1/academics/exams?sectionId= feeds the exam-subject
 * picker; GET /api/v1/academics/marks?examSubjectId= feeds the entry grid,
 * cached in localStorage like roster-view.ts so the last-loaded sheet still
 * renders offline. Write side: the same outbox discipline as attendance —
 * each changed row becomes one `exam_mark` op (entity already supported by
 * the server applier, with optimistic concurrency on rowVersion), the UI
 * never awaits the network, and a published/locked exam renders read-only
 * because the server would conflict the write anyway.
 *
 * The section comes from shikhon_last_section (set by roster-view.ts) —
 * marks entry always follows "pick your section in the শিক্ষার্থী tab" first.
 *
 * ── Ata Ekta (02 Teacher §04, drawn at desktop) ────────────────────────────
 * One panel under the page header: the inset filter strip, the marks table
 * (roll · name · one right-aligned field per component · a live total), and a
 * footer bar that says what is held on this device. Below 1024px the same
 * table scrolls sideways with roll and name frozen (13 Responsive rule ০৩),
 * and the one primary moves from the header to the sticky footer (thumb
 * reach) — both copies are in the DOM, CSS shows one.
 */
import type { Auth } from './auth.ts';
import {
  formatCount, formatIdentifier, parseUserNumber, toBanglaDigits,
} from '../../../packages/ui-core/src/format.ts';
import { hasIcon } from './icon.ts';
import {
  el, append, icon, lang, numClass, numText, pageHeader, badge, statusBadge, button, setBusy,
  emptyState, errorState, permissionState, permissionMessageWithContact, toast, field,
  listSkeleton, focusIsLost, uid,
} from './ui/index.ts';

export interface ExamSubjectOption {
  examSubjectId: string;
  subject: { bn: string; en: string };
  cqMax: number;
  mcqMax: number;
  practicalMax: number;
  caMax: number;
  markingLocked: boolean;
}

export interface ExamSummary {
  id: string;
  nameBn: string;
  status: string;
  academicYearId: string;
  subjects: ExamSubjectOption[];
}

export interface MarkRow {
  rollNo: number;
  studentId: string;
  fullName: { bn: string | null; en: string | null };
  cqMarks: number | null;
  mcqMarks: number | null;
  practicalMarks: number | null;
  caMarks: number | null;
  isAbsent: boolean;
  rowVersion: number | null;
}

interface MarksResponse {
  academicYearId: string;
  examStatus: string;
  markingLocked: boolean;
  maxima: { cq: number; mcq: number; practical: number; ca: number };
  marks: MarkRow[];
}

type MarkKey = 'cqMarks' | 'mcqMarks' | 'practicalMarks' | 'caMarks';

/** Only what this view needs from the sync engine — keeps it testable. */
export interface MarksOutbox {
  enqueue(input: {
    entity: 'exam_mark';
    payload: unknown;
    baseVersion?: number;
  }): Promise<{ opId: string }>;
  flush(): Promise<unknown>;
}

export interface MarksViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  outbox: MarksOutbox;
}

/** A rejection that still knows its HTTP status. Explicit field: strip-only. */
class HttpStatus extends Error {
  status: number;
  constructor(status: number) { super(String(status)); this.status = status; }
}

const EXAMS_CACHE_PREFIX = 'shikhon_exams_cache_';
const MARKS_CACHE_PREFIX = 'shikhon_marks_cache_';

/** The footer note's glyph as drawn (lucide `save`). Until the set carries
 *  it, the "on this device" glyph stands in — never the unknown-icon dot. */
const SAVE_GLYPH = hasIcon('save') ? 'save' : 'smartphone';

const SAVE_LABEL = 'সব সংরক্ষণ';
const SAVING_LABEL = 'সংরক্ষণ হচ্ছে…';

export class MarksView {
  private readonly o: MarksViewOptions;
  private sectionId: string | null;
  private exams: ExamSummary[] = [];
  private selected: { exam: ExamSummary; subject: ExamSubjectOption } | null = null;
  private sheet: MarksResponse | null = null;
  private dirty = new Map<string, Partial<MarkRow>>();
  private offline = false;
  /** The server refused this read. Not an outage; no retry will help. */
  private denied = false;
  private loading = false;
  private savedAt = 0;
  private completeEl: HTMLElement | null = null;
  private activeKeys: MarkKey[] = [];

  /* Display state for the five states (§7) — no request logic reads these. */
  /** The exam list is on its way and nothing is cached to show meanwhile. */
  private loadingExams = false;
  /** The exam list could not be fetched and there is no cached copy. */
  private examsFailed = false;
  /** The chosen sheet could not be fetched and there is no cached copy. */
  private sheetFailed = false;
  /** Rows the last save put in the outbox, and whether it was offline. */
  private savedRows = 0;
  private savedOffline = false;
  /** Both copies of "সব সংরক্ষণ" (header ≥1024px, footer below). */
  private saveButtons: HTMLButtonElement[] = [];
  /** The footer note: pending changes, rows held on this device, or saved. */
  private noteEl: HTMLElement | null = null;
  /** The live "মোট" cell per student. */
  private totalEls = new Map<string, HTMLElement>();

  constructor(options: MarksViewOptions) {
    this.o = options;
    this.sectionId = localStorage.getItem('shikhon_last_section');
    void this.init();
  }

  private async init(): Promise<void> {
    if (!this.sectionId) {
      this.render();
      return;
    }
    const cached = this.cacheGet<ExamSummary[]>(EXAMS_CACHE_PREFIX + this.sectionId);
    if (cached) this.exams = cached;
    // Set before the first paint, so an empty cache draws the skeleton rather
    // than flashing "no exams" for the length of the request.
    this.loadingExams = true;
    this.examsFailed = false;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/exams?sectionId=${encodeURIComponent(this.sectionId)}`,
      );
      if (!res.ok) throw new HttpStatus(res.status);
      const body = (await res.json()) as { exams: ExamSummary[] };
      this.exams = body.exams;
      this.offline = false;
      this.denied = false;
      this.cacheSet(EXAMS_CACHE_PREFIX + this.sectionId, this.exams);
    } catch (err) {
      const status = err instanceof HttpStatus ? err.status : undefined;
      // A refusal is not an offline state. Showing a cached exam list under
      // "সর্বশেষ সংরক্ষিত" to somebody the server just refused says the
      // opposite of what the server said, and offers a retry that cannot work.
      this.denied = status === 403;
      if (this.denied) { this.exams = []; this.sheet = null; }
      this.offline = !this.denied && this.exams.length > 0;
      this.examsFailed = !this.denied && this.exams.length === 0;
    } finally {
      this.loadingExams = false;
    }
    this.render();
  }

  private cacheGet<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private cacheSet(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // best-effort cache
    }
  }

  /**
   * The newest sheet request. The picker keeps keyboard focus across its
   * re-render (the shell's keepFocusWithin), so ArrowDown on a closed select
   * steps through several subjects in a second, one request each, and their
   * replies can land in any order. Only the reply to the CURRENT choice may
   * paint; an older one would put another subject's marks under this
   * subject's name, and a save would send them as this subject's.
   */
  private sheetRequest = 0;

  private async loadSheet(examSubjectId: string): Promise<void> {
    const request = ++this.sheetRequest;
    this.loading = true;
    this.sheetFailed = false;
    this.dirty.clear();
    // This subject's cached copy, or nothing (the skeleton). Keeping the
    // previous subject's sheet while this one loads showed its rows as this
    // subject's, and offline with no cache it stayed there under "সর্বশেষ
    // সংরক্ষিত নম্বর" instead of the error state.
    this.sheet = this.cacheGet<MarksResponse>(MARKS_CACHE_PREFIX + examSubjectId);
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/marks?examSubjectId=${encodeURIComponent(examSubjectId)}`,
      );
      if (request !== this.sheetRequest) return;
      if (!res.ok) throw new HttpStatus(res.status);
      const body = (await res.json()) as MarksResponse;
      if (request !== this.sheetRequest) return;
      this.sheet = body;
      this.offline = false;
      this.denied = false;
      this.cacheSet(MARKS_CACHE_PREFIX + examSubjectId, this.sheet);
    } catch (err) {
      // A newer choice owns the screen now; its own request paints it.
      if (request !== this.sheetRequest) return;
      const status = err instanceof HttpStatus ? err.status : undefined;
      this.denied = status === 403;
      if (this.denied) this.sheet = null;
      this.offline = !this.denied && this.sheet !== null;
      this.sheetFailed = !this.denied && this.sheet === null;
    }
    this.loading = false;
    this.render();
  }

  private get readOnly(): boolean {
    const s = this.sheet;
    return !!s && (s.markingLocked || s.examStatus === 'published' || s.examStatus === 'locked');
  }

  /** One outbox op per changed student; UI acknowledges locally, always. */
  /**
   * True while a save is in flight.
   *
   * `dirty.size === 0` was the only guard, and it is cleared AFTER the
   * enqueue loop finishes — so two taps on a slow phone both passed it and
   * enqueued the same marks twice, with two different op ids. The outbox
   * de-duplicates by opId and these had none, so both would have posted.
   */
  private saving = false;

  private async save(): Promise<void> {
    if (this.saving) return;
    const sel = this.selected;
    const sheet = this.sheet;
    if (!sel || !sheet || this.dirty.size === 0) return;

    // Which copy was pressed, when it holds focus (Enter or Space, or a tap on
    // Android). The render below deletes it; see focusAfterSave.
    const d = this.o.doc;
    const pressed = this.saveButtons.find((b) => b === d.activeElement) ?? null;

    this.saving = true;
    this.paintSaveBar();
    try {
    let queued = 0;
    for (const [studentId, change] of this.dirty) {
      const row = sheet.marks.find((m) => m.studentId === studentId);
      if (!row) continue;
      const merged = { ...row, ...change };
      await this.o.outbox.enqueue({
        entity: 'exam_mark',
        baseVersion: row.rowVersion ?? undefined,
        payload: {
          examSubjectId: sel.subject.examSubjectId,
          studentId,
          academicYearId: sheet.academicYearId,
          cqMarks: merged.cqMarks,
          mcqMarks: merged.mcqMarks,
          practicalMarks: merged.practicalMarks,
          caMarks: merged.caMarks,
          isAbsent: merged.isAbsent,
        },
      });
      Object.assign(row, change);
      queued++;
    }
    this.dirty.clear();
    this.savedAt = Date.now();
    // What the footer note reports: "৪ সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে".
    this.savedRows = queued;
    this.savedOffline = !navigator.onLine;
    this.cacheSet(MARKS_CACHE_PREFIX + sel.subject.examSubjectId, sheet);
    // Fire-and-forget: offline failure is the normal case, not an error.
    void Promise.resolve(this.o.outbox.flush()).catch(() => {});
    toast(this.o.doc, {
      message: this.savedOffline
        ? 'নম্বর এই যন্ত্রে সংরক্ষিত — সংযোগ পেলে নিজেই জমা হবে'
        : 'নম্বর সংরক্ষিত — জমা হচ্ছে',
      tone: 'success',
    });
    } catch (err) {
      // The typed marks are still in `this.dirty` and still on screen: §13's
      // rule is that a recoverable failure never costs the user their input,
      // and re-rendering from `sheet` would discard exactly the numbers the
      // teacher just keyed in.
      toast(this.o.doc, {
        message: 'নম্বর সংরক্ষণ করা যায়নি। ঘরের নম্বরগুলো ঠিক আছে — আবার চেষ্টা করুন।',
        tone: 'error',
      });
      console.error('[marks] enqueue failed', err);
    } finally {
      this.saving = false;
    }
    // Still there when the enqueue finished: on the pressed copy, or dropped
    // by a browser that blurs a disabled control. Not if the person has since
    // moved on to a mark box — that focus is theirs, and the shell's keeper
    // follows it through the render.
    const copy = pressed && (d.activeElement === pressed || focusIsLost(d))
      ? pressed.dataset.focusKey ?? null
      : null;
    this.render();
    if (copy) this.focusAfterSave(copy);
  }

  /**
   * render() deleted the focused "সব সংরক্ষণ", so focus fell to <body> and
   * the next Tab began again at the top of the page (finding 67).
   *
   * - The save failed: the marks are still pending and the new copy is
   *   enabled. The shell's keepFocusWithin puts focus back on that copy, and
   *   this leaves it alone.
   * - It worked: the new copy is disabled (nothing left to save) and cannot
   *   take focus. Focus goes where the person was, onto the text that says
   *   what happened. Beside the phone's footer button that is the footer
   *   note ("সংরক্ষিত", "৪ সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে"). The
   *   desktop copy sits in the page header, so focus goes to the page
   *   heading: the next Tab reaches the exam picker, not the end of the
   *   sheet, and the toast announces the save.
   */
  private focusAfterSave(copy: string): void {
    const d = this.o.doc;
    if (!focusIsLost(d)) return;
    const again = this.saveButtons.find((b) => b.dataset.focusKey === copy);
    if (!again || !again.disabled) return;
    const target = copy === 'marks-save-bottom'
      ? this.noteEl
      : this.o.root.querySelector<HTMLElement>('h1');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    // The note is in the phone's sticky save bar, which sits inside the page's
    // scroll-padding-bottom (app.css `:root:has(.marks-savebar)`). A scrolling
    // focus would jump the sheet under the teacher's thumb although the note
    // is on screen, right beside the button just pressed. The heading may
    // scroll: it is where the desktop copy was.
    target.focus(copy === 'marks-save-bottom' ? { preventScroll: true } : undefined);
  }

  private markDirty(studentId: string, change: Partial<MarkRow>): void {
    this.dirty.set(studentId, { ...this.dirty.get(studentId), ...change });
    this.savedAt = 0;
    this.paintSaveBar();
  }

  /** Drop one field from a student's pending change (F-709: an over-max
   *  value is never queued), and forget the student entirely if nothing else
   *  is pending. */
  private clearDirtyField(studentId: string, key: MarkKey): void {
    const cur = this.dirty.get(studentId);
    if (!cur) return;
    delete (cur as Record<string, unknown>)[key];
    if (Object.keys(cur).length === 0) this.dirty.delete(studentId);
    this.savedAt = 0;
    this.paintSaveBar();
  }

  /** Flag or clear an over-max field. max=null clears. The message names the
   *  ceiling and says plainly that nothing was saved, so the number the
   *  teacher still sees in the box is not mistaken for a stored mark. */
  private fieldError(input: HTMLInputElement, max: number | null): void {
    const cell = input.parentElement;
    const existing = cell?.querySelector<HTMLElement>('.marks-error') ?? null;
    if (max === null) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      existing?.remove();
      return;
    }
    input.setAttribute('aria-invalid', 'true');
    const err = existing ?? this.o.doc.createElement('span');
    err.className = 'marks-error';
    err.setAttribute('role', 'alert');
    // Tied to its box, so returning to it reads why it is invalid (minor 14):
    // the alert is spoken once, as it appears, and never again.
    if (!err.id) err.id = uid('marks-err');
    input.setAttribute('aria-describedby', err.id);
    err.textContent = '';
    append(err, ...numText(this.o.doc, `সর্বোচ্চ ${formatCount(max, 'bn')} — সংরক্ষণ হয়নি`));
    if (!existing) cell?.append(err);
  }

  /** "am I done?" — how many students are accounted for (a mark in any active
   *  component, or marked absent), out of the section total. Reflects unsaved
   *  edits so the count moves as the teacher types.
   *
   *  The same pass paints each row's "মোট": the sum of the active components
   *  as they stand now, "—" for an absent student or an empty row. A rejected
   *  over-max value is not in `dirty`, so it is not summed — the same rule the
   *  counter keeps. Display only; nothing here is stored or sent. */
  private paintComplete(): void {
    const sheet = this.sheet;
    if (!sheet) return;
    const d = this.o.doc;
    const total = sheet.marks.length;
    let done = 0;
    for (const row of sheet.marks) {
      const m = { ...row, ...this.dirty.get(row.studentId) };
      const given = this.activeKeys.filter((k) => m[k] !== null && m[k] !== undefined);
      if (m.isAbsent || given.length > 0) done++;
      const cell = this.totalEls.get(row.studentId);
      if (cell) {
        const sum = given.reduce((s, k) => s + Number(m[k]), 0);
        const text = m.isAbsent || given.length === 0
          ? '—'
          : formatCount(Math.round(sum * 100) / 100, 'bn');
        cell.textContent = text;
        cell.className = numClass('marks-total', text);
      }
    }
    const counter = this.completeEl;
    if (!counter) return;
    counter.textContent = '';
    append(counter, ...numText(d,
      `নম্বর দেওয়া হয়েছে ${formatCount(done, 'bn')} / ${formatCount(total, 'bn')}`));
    counter.dataset.done = String(done === total);
  }

  /** Both save buttons, and the footer note, from the current state. */
  private paintSaveBar(): void {
    const d = this.o.doc;
    for (const btn of this.saveButtons) {
      setBusy(btn, this.saving);
      const label = btn.querySelector('.btn-label');
      if (label) label.textContent = this.saving ? SAVING_LABEL : SAVE_LABEL;
      if (!this.saving) btn.disabled = this.dirty.size === 0;
    }
    const note = this.noteEl;
    if (!note) return;
    let glyph = SAVE_GLYPH;
    let text: string;
    if (this.dirty.size > 0) {
      text = `${formatCount(this.dirty.size, 'bn')}টি পরিবর্তন`;
    } else if (this.savedAt && this.savedOffline) {
      text = `${formatCount(this.savedRows, 'bn')} সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে`;
    } else if (this.savedAt) {
      glyph = 'check';
      text = 'সংরক্ষিত';
    } else {
      // The picker's helper line, moved here: the drawn footer is where this
      // screen says what happens to marks when there is no connection.
      text = 'নম্বর দেওয়া অফলাইনেও কাজ করে — সংযোগ পেলে নিজেই জমা হবে।';
    }
    note.textContent = '';
    append(note, icon(d, glyph), el(d, 'span', { className: 'marks-note-text' }, ...numText(d, text)));
  }

  /** "সব সংরক্ষণ". Small in the desktop header as drawn; a full-width
   *  bottom bar button on a phone. */
  private saveButton(className: string, bottom: boolean): HTMLButtonElement {
    const btn = button(this.o.doc, {
      label: this.saving ? SAVING_LABEL : SAVE_LABEL,
      variant: 'primary',
      size: bottom ? 'md' : 'sm',
      block: bottom,
      className,
      disabled: this.dirty.size === 0,
      busy: this.saving,
      // Stable across renders while its label swaps to "সংরক্ষণ হচ্ছে…",
      // and tells the two copies apart (see focusAfterSave).
      attrs: { 'data-focus-key': className },
      onClick: () => { void this.save(); },
    });
    this.saveButtons.push(btn);
    return btn;
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    this.saveButtons = [];
    this.totalEls.clear();
    this.noteEl = null;
    this.completeEl = null;

    // The header bar (02 Teacher §04): title, then the sheet's state chip and
    // the small primary. The chip is "খসড়া" while marks can still change, and
    // the lock badge once the exam is published or locked.
    const sheetShown = !!(this.selected && this.sheet && !this.denied);
    const editable = sheetShown && !this.readOnly && (this.sheet?.marks.length ?? 0) > 0;
    const chip = !sheetShown
      ? undefined
      : this.readOnly
        ? badge(d, { label: 'প্রকাশিত — পরিবর্তন করা যাবে না', tone: 'info', glyph: 'lock' })
        : statusBadge(d, { state: 'draft', label: 'খসড়া' });
    append(root, pageHeader(d, {
      title: 'নম্বর এন্ট্রি',
      actions: chip ? [chip] : undefined,
      primary: editable ? this.saveButton('marks-save-top', false) : undefined,
    }));

    // §5 of the closure pass: ONE permission sentence across the product.
    // The same two sentences as before, now on the shared denied card.
    if (this.denied) {
      append(root, permissionState(d, { message: permissionMessageWithContact() }));
      return;
    }

    if (!this.sectionId) {
      append(root, emptyState(d, {
        message: 'আগে শিক্ষার্থী তালিকা থেকে একটি সেকশন বেছে নিন — তারপর সেই শাখার নম্বর দেওয়া যাবে।',
        action: { label: 'শিক্ষার্থী তালিকা', onClick: () => { location.hash = '/roster'; } },
      }));
      return;
    }

    // One panel: strips stacked on the table, states inside it (as dataTable
    // draws them) so the picker stays where the teacher left it.
    const panel = el(d, 'div', { className: 'card marks-sheet' });
    append(root, panel);

    // Offline is a statement about the data on screen, not a failure.
    if (this.offline) {
      append(panel, el(d, 'p', { className: 'offline-banner marks-offline' },
        icon(d, 'wifi-off', 'offline-icon'),
        el(d, 'span', {
          text: 'অফলাইন — সর্বশেষ সংরক্ষিত নম্বর দেখানো হচ্ছে। নতুন নম্বর এই যন্ত্রে জমা থাকবে।',
        })));
    }

    // One option per (exam, subject) pair, on the P2 field — so the control
    // carries a VISIBLE label. It had an `aria-label` only, which told a
    // screen reader what it was and a teacher nothing until they opened it.
    // The drawn strip shows the select unlabelled; R8 keeps the label, set
    // inline beside the select in the strip. Only the helper is visually
    // hidden: it still describes the select, and the same sentence is drawn
    // as the footer note's resting text and in the nothing-picked empty state.
    const options = this.exams.flatMap((exam) =>
      exam.subjects.map((subject) => ({
        value: subject.examSubjectId,
        label: `${exam.nameBn} — ${subject.subject.bn}`,
      })));
    const picker = field(d, {
      label: 'পরীক্ষা ও বিষয়',
      name: 'examSubject',
      kind: 'select',
      className: 'marks-filter',
      value: this.selected?.subject.examSubjectId ?? '',
      helper: 'নম্বর দেওয়া অফলাইনেও কাজ করে — সংযোগ পেলে নিজেই জমা হবে।',
      options: [
        // Once a subject is chosen the prompt cannot be chosen back: onChange
        // ignores '', so ArrowUp onto it left the select reading "নির্বাচন
        // করুন" over a sheet that was still open and still saved.
        { value: '', label: 'পরীক্ষা ও বিষয় নির্বাচন করুন', disabled: !!this.selected },
        ...options,
      ],
      onChange: (v) => {
        for (const exam of this.exams) {
          const subject = exam.subjects.find((sub) => sub.examSubjectId === v);
          if (subject) {
            this.selected = { exam, subject };
            void this.loadSheet(subject.examSubjectId);
            return;
          }
        }
      },
    });
    picker.root.querySelector('.ui-field-help')?.classList.add('ui-sr-only');
    const filters = el(d, 'div', { className: 'marks-filters' }, picker.root);
    append(panel, filters);

    if (this.examsFailed && this.exams.length === 0) {
      append(panel, errorState(d,
        'পরীক্ষার তালিকা আনা গেল না। ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।',
        () => { void this.init(); }));
      return;
    }
    if (this.loadingExams && this.exams.length === 0) {
      append(panel, listSkeleton(d, 5));
      return;
    }
    if (this.exams.length === 0 && !this.loading) {
      append(panel, emptyState(d, {
        glyph: 'award',
        message: 'এই সেকশনের জন্য কোনো পরীক্ষা পাওয়া যায়নি। পরীক্ষা তৈরি হলে '
          + 'এখানে নম্বর দেওয়া যাবে।',
      }));
      return;
    }
    const sel = this.selected;
    if (!sel) {
      append(panel, emptyState(d, {
        glyph: 'edit',
        message: 'পরীক্ষা ও বিষয় বেছে নিয়ে নম্বর দিন — অফলাইনেও কাজ করে।',
      }));
      return;
    }
    if (this.loading && !this.sheet) {
      append(panel, listSkeleton(d, 5));
      return;
    }
    const sheet = this.sheet;
    if (!sheet) {
      if (this.sheetFailed) {
        append(panel, errorState(d,
          'নম্বরের তালিকা আনা গেল না। ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।',
          () => { void this.loadSheet(sel.subject.examSubjectId); }));
      }
      return;
    }

    // §"published marks immutability". The gate existed; nothing said WHY the
    // inputs were dead, so a teacher trying to fix a typo met a form that
    // simply would not accept keystrokes.
    if (this.readOnly) {
      append(panel, el(d, 'p', { className: 'marks-lock' },
        icon(d, 'lock'),
        el(d, 'span', {
          text: 'এই পরীক্ষার ফলাফল প্রকাশিত হয়ে গেছে, তাই নম্বর আর পরিবর্তন করা যাবে না। '
            + 'সংশোধন প্রয়োজন হলে প্রধান শিক্ষকের সাথে যোগাযোগ করুন।',
        })));
    }

    if (sheet.marks.length === 0) {
      append(panel, emptyState(d, {
        glyph: 'users',
        message: 'এই পরীক্ষার তালিকায় কোনো শিক্ষার্থী নেই। শিক্ষার্থী তালিকায় সেকশনটি দেখে নিন।',
        action: { label: 'শিক্ষার্থী তালিকা', onClick: () => { location.hash = '/roster'; } },
      }));
      return;
    }

    const components = ([
      { key: 'cqMarks', label: 'CQ', en: true, max: sheet.maxima.cq },
      { key: 'mcqMarks', label: 'MCQ', en: true, max: sheet.maxima.mcq },
      { key: 'practicalMarks', label: 'ব্যবহারিক', en: false, max: sheet.maxima.practical },
      { key: 'caMarks', label: 'ধারাবাহিক', en: false, max: sheet.maxima.ca },
    ] as { key: MarkKey; label: string; en: boolean; max: number }[]).filter((c) => c.max > 0);
    this.activeKeys = components.map((c) => c.key);

    // Completeness counter, always visible: the teacher's answer to "have I
    // marked everyone?" (§7.2). At the end of the strip, above the rows.
    this.completeEl = el(d, 'p', {
      className: 'marks-complete', attrs: { 'aria-live': 'polite' },
    });
    append(filters, this.completeEl);

    const table = el(d, 'table', { className: 'ui-table marks-table' });
    append(table, el(d, 'caption', {
      className: 'ui-sr-only',
      text: `${sel.exam.nameBn} · ${sel.subject.subject.bn} — নম্বর`,
    }));

    const hrow = el(d, 'tr', {},
      el(d, 'th', { className: 'marks-col-roll', text: 'রোল', attrs: { scope: 'col' } }),
      el(d, 'th', { className: 'marks-col-name', text: 'নাম', attrs: { scope: 'col' } }));
    for (const comp of components) {
      // "CQ · ৫০" — the ceiling is in the header, so no field has to say it.
      append(hrow, el(d, 'th', { attrs: { scope: 'col' }, data: { numeric: 'true' } },
        comp.en ? lang(d, 'en', comp.label) : comp.label,
        ' · ',
        el(d, 'span', { className: 'n', text: formatCount(comp.max, 'bn') })));
    }
    append(hrow,
      el(d, 'th', { text: 'মোট', attrs: { scope: 'col' }, data: { numeric: 'true' } }),
      el(d, 'th', { className: 'marks-col-absent', text: 'অনুপস্থিত', attrs: { scope: 'col' } }));
    append(table, el(d, 'thead', {}, hrow));

    const tbody = el(d, 'tbody');
    for (const row of sheet.marks) {
      // What the boxes show is what a save would send: the sheet with this
      // student's pending change over it. A save that failed keeps the change
      // pending and redraws (its toast says "ঘরের নম্বরগুলো ঠিক আছে"), and a
      // slow reload redraws after the teacher typed into the cached copy.
      // Drawn from `row` alone, both emptied the boxes the teacher had just
      // filled while the change stayed queued to go out unseen.
      const shown: MarkRow = { ...row, ...this.dirty.get(row.studentId) };
      const name = row.fullName.bn || row.fullName.en || '—';
      // A roll number is an identifier: Latin, padded as the register is.
      const roll = formatIdentifier(String(row.rollNo).padStart(2, '0'));
      const tr = el(d, 'tr', { data: { key: row.studentId } },
        el(d, 'td', { className: numClass('marks-roll', roll), text: roll }),
        // The row header is the student: "আনিকা, CQ" rather than a bare value.
        el(d, 'th', { className: 'marks-name', attrs: { scope: 'row' } }, ...numText(d, name)));

      const rowInputs: HTMLInputElement[] = [];
      for (const comp of components) {
        const v = shown[comp.key];
        // type="text" + inputmode: the value is shown in Bangla digits, and
        // parseUserNumber reads either system back (type="number" can hold
        // neither ৪২ nor a mis-keyed value — it silently empties).
        const input = el(d, 'input', {
          className: 'marks-input n',
          attrs: {
            type: 'text',
            inputmode: 'decimal',
            autocomplete: 'off',
            'aria-label': `${name} — ${comp.label}, সর্বোচ্চ ${formatCount(comp.max, 'bn')}`,
          },
        });
        input.value = v === null || v === undefined ? '' : toBanglaDigits(v);
        input.disabled = this.readOnly || shown.isAbsent;
        input.addEventListener('input', () => {
          const raw = input.value.trim();
          if (raw === '') {
            this.fieldError(input, null);
            this.markDirty(row.studentId, { [comp.key]: null } as Partial<MarkRow>);
            this.paintComplete();
            return;
          }
          const n = parseUserNumber(raw);
          // F-709: a mark over the paper's ceiling (or negative / not a
          // number) is REJECTED inline and persists nothing. The old code
          // silently clamped 75 to 70 — so a teacher who typed 75 saved 70
          // and never knew. Now the field flags it and the value is not
          // recorded until it is corrected.
          if (n === null || n < 0 || n > comp.max) {
            this.fieldError(input, comp.max);
            this.clearDirtyField(row.studentId, comp.key);
            this.paintComplete();
            return;
          }
          this.fieldError(input, null);
          this.markDirty(row.studentId, { [comp.key]: n } as Partial<MarkRow>);
          this.paintComplete();
        });
        rowInputs.push(input);
        append(tr, el(d, 'td', { className: 'marks-cell', data: { numeric: 'true' } }, input));
      }

      const totalCell = el(d, 'td', { className: 'marks-total', data: { numeric: 'true' } });
      this.totalEls.set(row.studentId, totalCell);
      append(tr, totalCell);

      const cb = el(d, 'input', {
        attrs: { type: 'checkbox', 'aria-label': `${name} — অনুপস্থিত` },
      });
      cb.checked = shown.isAbsent;
      cb.disabled = this.readOnly;
      cb.addEventListener('change', () => {
        this.markDirty(row.studentId, { isAbsent: cb.checked });
        for (const inp of rowInputs) inp.disabled = cb.checked || this.readOnly;
        this.paintComplete();
      });
      append(tr, el(d, 'td', { className: 'marks-absent-cell' },
        el(d, 'label', { className: 'marks-absent' }, cb)));

      append(tbody, tr);
    }
    append(table, tbody);
    append(panel, el(d, 'div', { className: 'ui-table-scroll' }, table));

    if (!this.readOnly) {
      this.noteEl = el(d, 'p', { className: 'marks-note' });
      append(panel, el(d, 'div', { className: 'marks-savebar' },
        this.noteEl,
        this.saveButton('marks-save-bottom', true)));
    }

    this.paintSaveBar();
    this.paintComplete();
  }
}
