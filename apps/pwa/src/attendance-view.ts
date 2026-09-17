/**
 * The attendance register, rendered — path খ, exception mode.
 *
 * Deliberately framework-free: the whole critical path is budgeted at 180 KB
 * gzipped. It binds an AttendanceGrid (state) to a SyncEngine (durability)
 * and never awaits the network before the register is safe on the device.
 *
 * ── What changed with Ata Ekta (IMPLEMENTATION §8, the one behaviour change)
 *   * Nobody starts marked. `AttendanceGrid` still initialises every entry at
 *     `present`, so "unset" is DERIVED from `touched` — see `shown()`. Nothing
 *     a teacher sees and nothing that is sent may read a raw `e.status`,
 *     `grid.counts().present/absent/late`, `grid.ariaLabel()` or an unfiltered
 *     `grid.toPayload().records`: every one of those counts an untouched child
 *     as present.
 *   * `grid.cycle()` is gone. A row tap only opens that row's three-button
 *     switch (উপস্থিত / অনুপস্থিত / দেরি); tapping the pressed option is a
 *     true no-op. A stray tap while scrolling cannot record anything.
 *   * `markAllPresent()` is the prominent bulk action.
 *   * Three guards ship with it: (1) unmarked students block "দেখে জমা দিন";
 *     (2) every change has a 5-second undo in the existing role=status host;
 *     (3) a confirm sheet names every absentee and late arrival, with the SMS
 *     consequence, before anything is enqueued.
 *   * A save sends ONLY the students the teacher marked. The server accepts a
 *     partial register and writes no row for an omitted student, so "left
 *     blank" genuinely means "in no tally" — never a fabricated present (which
 *     hides an absence) nor a fabricated absent (which texts a guardian).
 */
import {
  AttendanceGrid, type Student, type GridEntry, type AttendanceStatus,
} from '../../../packages/ui-core/src/attendance-grid.ts';
import { formatCount, formatDayMonth, formatIdentifier, formatTime } from '../../../packages/ui-core/src/format.ts';
import {
  el, append, icon, uid, button, badge, numText, progress, openOverlay, onClickBusy, announce,
  focusIsLost, type OverlayHandle, type BadgeTone,
} from './ui/index.ts';

export interface SaveResult {
  opId: string;
  queued: boolean;
  /**
   * Resolves when the background flush attempt settles (success OR failure).
   * The UI ignores it — that is the point of the design — but a "sync now"
   * button, or a test, needs to know when the attempt finished. Without this
   * the engine's single-flight mutex silently collapses a caller's own flush
   * into the one already running.
   */
  flushed: Promise<void>;
}

/** Only what this view needs from @shikhon/offline — keeps it testable. */
export interface OutboxLike {
  enqueue(input: {
    entity: 'attendance_session';
    opId?: string;
    payload: unknown;
  }): Promise<{ opId: string }>;
  /**
   * `ignoreBackoff`: a person asked to send now ("আবার পাঠান"), so ops still
   * waiting out a failed attempt's backoff go too. Automatic sends omit it.
   */
  flush(options?: { ignoreBackoff?: boolean }): Promise<unknown>;
  state(): Promise<{
    pending: number; failed: number; conflicts: number; lastSyncAt?: number;
    /** Ops being sent right now (the sync engine reports them apart from pending). */
    inflight?: number;
  }>;
}

export interface AttendanceViewOptions {
  root: HTMLElement;
  doc: Document;
  students: Student[];
  section: { id: string; labelBn: string; academicYearId: string };
  takenOn: string;
  periodNo?: number | null;
  subjectBn?: string;
  locale?: 'bn' | 'en';
  outbox: OutboxLike;
  newId: () => string;
  now?: () => number;
  /**
   * Suppress this view's own header (`<h1>হাজিরা</h1>`, subtitle and sync
   * chip). `attendance-screen.ts` owns the page header and the sync line.
   */
  embedded?: boolean;
  /**
   * What the confirm sheet's "জমা দিন" runs. The screen passes its
   * single-flight submit, which calls `closeConfirm()` BEFORE its toast (the
   * page is aria-hidden while the sheet is open). Resolve `false` — or reject
   * — to keep the sheet open with the marks intact; the sheet then shows the
   * failure in its own role=alert line and refocuses "জমা দিন". Without it,
   * the sheet calls `save()` directly and announces the result after closing.
   */
  onConfirm?: () => Promise<boolean>;
  /**
   * Restore a register: the records of a queued payload, as studentId →
   * status. Students listed come back marked; everyone else comes back unset.
   * Because a payload holds only marked students, the round trip is exact.
   * No caller wires a draft store today (out of scope, R3).
   */
  initial?: Record<string, AttendanceStatus>;
  /**
   * The saved register's delivery changed (for instance it reached the server
   * in a background flush). The screen repaints its sync line, so the line
   * above never still says "১টি অপেক্ষমাণ" under a footer that says sent.
   */
  onDeliveryChange?: () => void;
}

/** `save()` with nobody marked. An empty register would count as "taken". */
export class NothingMarkedError extends Error {
  readonly code = 'nothing_marked';
  constructor() { super('nothing_marked: no student has been marked'); }
}

type Shown = AttendanceStatus | 'unset';

/**
 * Where a saved register stands, as far as the queue can say: "sending" while
 * this view's own flush runs, "waiting" while it is still queued after that,
 * then "sent", "failed" (parked by the engine) or "unknown" (the queue could
 * not be read before the enqueue, so a parked op cannot be attributed).
 */
type Delivery = 'sending' | 'sent' | 'waiting' | 'failed' | 'unknown';

/** The one rule: an untouched student is unset, whatever the grid defaults to. */
const shown = (e: GridEntry): Shown => (e.touched ? e.status : 'unset');

/** Worded chip per marked status. ছুটি only ever arrives restored. */
const CHIP: Record<AttendanceStatus, [string, BadgeTone]> = {
  present: ['এসেছে', 'success'],
  absent: ['আসেনি', 'danger'],
  late: ['দেরি', 'warn'],
  excused: ['ছুটি', 'info'],
};

/** Exactly three tap targets. Excused is set elsewhere — never a fourth. */
const CHOICES: Array<[Exclude<AttendanceStatus, 'excused'>, string, string]> = [
  ['present', 'উপস্থিত', 'Present'],
  ['absent', 'অনুপস্থিত', 'Absent'],
  ['late', 'দেরি', 'Late'],
];

const SPOKEN_BN: Record<Shown, string> = {
  present: 'উপস্থিত', absent: 'অনুপস্থিত', late: 'দেরি', excused: 'ছুটি', unset: 'চিহ্নিত হয়নি',
};
const SPOKEN_EN: Record<Shown, string> = {
  present: 'present', absent: 'absent', late: 'late', excused: 'excused', unset: 'not marked',
};

/** Counts are Bangla (R6). */
const bn = (n: number): string => formatCount(n, 'bn');

/** The device's wall-clock time of a save, as the teacher's phone shows it: `১০:৪২`. */
const clock = (ms: number): string => {
  const t = new Date(ms);
  return formatTime(`${t.getHours()}:${t.getMinutes()}`, 'bn');
};

const UNDO_SECONDS = 5;

/**
 * How often a saved-but-not-yet-sent register re-reads the queue. The shell's
 * auto-flush sends it in the background (on reconnect, on return to the app,
 * every 30 s) without telling this view, so without a re-read the footer would
 * keep saying "এখনো পাঠানো হয়নি" after it arrived. One count read.
 */
const SAVED_RECHECK_MS = 10_000;

/**
 * A click with `detail === 0` came from the keyboard (Space/Enter on a native
 * button) or an assistive technology, not a pointer. Those users sit many Tab
 * stops away from the undo button, so their undo window does not time out.
 */
const fromKeyboard = (ev: Event | undefined): boolean =>
  !!ev && typeof (ev as MouseEvent).detail === 'number' && (ev as MouseEvent).detail === 0;

/** The undo shortcut: Ctrl+Z, or Cmd+Z on a Mac. No Shift (that is redo). */
const isUndoKey = (ev: KeyboardEvent): boolean =>
  (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && (ev.key === 'z' || ev.key === 'Z');

interface RowRefs {
  row: HTMLLIElement;
  hit: HTMLButtonElement;
  state: HTMLElement;
  sw: HTMLElement;
  opts: Map<AttendanceStatus, HTMLButtonElement>;
}

type UndoTarget = { kind: 'single'; studentId: string } | { kind: 'bulk' };

interface Tally {
  total: number; marked: number; unmarked: number;
  present: number; absent: number; late: number; excused: number;
  /** Marked, and not present. */
  exceptions: number;
}

export class AttendanceView {
  private readonly o: AttendanceViewOptions;
  private readonly grid: AttendanceGrid;
  private readonly locale: 'bn' | 'en';
  private rows = new Map<string, RowRefs>();
  private chipEl: HTMLElement | null = null;
  private bulkBtn!: HTMLButtonElement;
  private progressHost!: HTMLElement;
  private footer!: HTMLElement;
  private footerBody!: HTMLElement;
  private footerKey = '';
  private guardText: HTMLElement | null = null;
  private goBtn: HTMLButtonElement | null = null;
  private undoEl!: HTMLElement;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private undoLeft = 0;
  private undoHover = false;
  private undoFocus = false;
  private undoTarget: UndoTarget | null = null;
  /** The pending undo was made from the keyboard: it waits, it never expires. */
  private undoKeyboard = false;
  private openId: string | null = null;
  /** Guard 1 raised by "দেখে জমা দিন"; lowered once nobody is unmarked. */
  private guardRaised = false;
  /**
   * The row a Space/Enter keydown already toggled. Its keyboard-generated
   * click (detail 0) is swallowed so the row does not toggle twice.
   */
  private keyToggled: string | null = null;
  private sheet: OverlayHandle | null = null;
  /**
   * The register as last saved (its marks, and when), or null before any
   * save. While the marks on screen still equal these, the footer says so and
   * offers no "দেখে জমা দিন": the same register sent twice is a second op in
   * the queue and the same SMS sentence again, for nothing.
   */
  private saved: {
    key: string; at: number;
    /**
     * Failed + conflicted ops in the queue just before this register was
     * enqueued, or null if the queue could not be read. The engine parks
     * those ops for good (nothing in the app retries or discards them), so an
     * old one says nothing about this register: only growth past this count
     * does.
     */
    parkedBefore: number | null;
  } | null = null;
  /** Whether that saved register has left the device, as far as the queue says. */
  private delivery: Delivery = 'sending';
  /** This view's own flush for the latest save has not settled yet. */
  private flushing = false;
  private savedText: HTMLElement | null = null;
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AttendanceViewOptions) {
    this.o = options;
    this.locale = options.locale ?? 'bn';
    this.grid = new AttendanceGrid({
      students: options.students,
      initial: options.initial,
      onChange: () => this.onGridChange(),
    });
    this.render();
  }

  /* ------------------------------------------------------------ render */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', this.locale);
    const bnUi = this.locale === 'bn';

    if (!this.o.embedded) {
      const header = el(d, 'header', { className: 'att-header' });
      const h1 = el(d, 'h1', { text: bnUi ? 'হাজিরা' : 'Attendance' });
      const subText = [
        this.o.section.labelBn,
        this.o.subjectBn,
        formatDayMonth(this.o.takenOn, this.locale),
      ].filter(Boolean).join(' · ');
      const sub = el(d, 'p', { className: 'att-sub' }, ...numText(d, subText));
      this.chipEl = el(d, 'span', { className: 'sync-chip', attrs: { 'aria-live': 'polite' } });
      append(header, h1, sub, this.chipEl);
      root.append(header);
    }

    const total = this.grid.entriesInOrder().length;

    // Bulk panel — markAllPresent() promoted; the function is unchanged.
    this.bulkBtn = button(d, {
      label: `${bn(total)} জনকে উপস্থিত ধরুন`,
      variant: 'success',
      block: true,
      attrs: { 'data-action': 'mark-all' },
      onClick: (ev) => this.markAll(fromKeyboard(ev)),
    });
    const bulk = el(d, 'section', { className: 'att-bulk', attrs: { 'aria-label': 'একবারে সবাই' } },
      el(d, 'p', {
        className: 'att-bulk-note',
        text: 'ক্লাসে চোখ বুলিয়ে নিন। সবাই থাকলে একবার চাপুন, তারপর যারা নেই শুধু তাদের চিহ্নিত করুন।',
      }),
      this.bulkBtn);

    // The live tally. Replaces the old .att-counts region (R8).
    this.progressHost = el(d, 'div', { className: 'att-progress', attrs: { 'aria-live': 'polite' } });

    const list = el(d, 'ul', {
      className: 'att-list',
      attrs: { 'aria-label': bnUi ? 'শিক্ষার্থী তালিকা' : 'Student list' },
    });
    for (const e of this.grid.entriesInOrder()) list.append(this.buildRow(e));

    // Footer: "দেখে জমা দিন" or the Guard 1 panel, plus the Guard 2 host.
    this.footer = el(d, 'footer', { className: 'att-footer' });
    this.footerBody = el(d, 'div', { className: 'att-footer-body' });
    this.undoEl = el(d, 'div', {
      className: 'att-undo', attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.undoEl.hidden = true;
    // WCAG 2.2.1: the countdown pauses while the toast is being used — a mouse
    // resting on it, or focus inside it. Pointer events, not mouse events: a
    // finger's tap fires a compatibility `mouseenter` and never the matching
    // `mouseleave`, so touching the toast's text froze the countdown and left
    // the toast over the last rows until the next tap somewhere else.
    const win = d.defaultView as (Window & typeof globalThis) | null;
    if (win && typeof win.PointerEvent === 'function') {
      this.undoEl.addEventListener('pointerenter', (ev) => {
        if ((ev as PointerEvent).pointerType === 'mouse') this.undoHover = true;
      });
      this.undoEl.addEventListener('pointerleave', () => { this.undoHover = false; });
    } else {
      this.undoEl.addEventListener('mouseenter', () => { this.undoHover = true; });
      this.undoEl.addEventListener('mouseleave', () => { this.undoHover = false; });
    }
    this.undoEl.addEventListener('focusin', () => { this.undoFocus = true; });
    this.undoEl.addEventListener('focusout', (ev) => {
      const next = (ev as FocusEvent).relatedTarget as Node | null;
      if (!next || !this.undoEl.contains(next)) this.undoFocus = false;
    });
    append(this.footer, this.undoEl, this.footerBody);

    // Guard 2 for keyboard and screen-reader users: the undo button sits after
    // every row, often dozens of Tab stops from the control that made the
    // change. Ctrl/Cmd+Z undoes from anywhere in the register, and is stated
    // in the toast's accessible text and in aria-keyshortcuts.
    root.addEventListener('keydown', (ev) => {
      const k = ev as KeyboardEvent;
      if (!isUndoKey(k) || !this.undoTarget || this.sheet) return;
      k.preventDefault();
      this.undo();
    });

    root.append(bulk, this.progressHost, list, this.footer);
    this.paintBulk();
    this.paintProgress();
    this.paintFooter();
    void this.paintChip();
  }

  private buildRow(e: GridEntry): HTMLLIElement {
    const d = this.o.doc;
    const s = shown(e);
    const swId = `att-sw-${e.studentId}`;
    const name = this.nameOf(e);

    const row = el(d, 'li', { className: 'att-row', data: { studentId: e.studentId, status: s } });
    const hit = el(d, 'button', {
      className: 'att-row-hit',
      attrs: {
        type: 'button', 'aria-expanded': 'false', 'aria-controls': swId,
        'aria-label': this.rowLabel(e),
      },
    });
    const roll = formatIdentifier(e.rollNo);
    const state = el(d, 'span', { className: 'att-state', attrs: { 'aria-hidden': 'true' } });
    append(hit,
      el(d, 'span', { className: 'att-roll n', text: roll, attrs: { 'aria-hidden': 'true' } }),
      el(d, 'span', { className: 'att-name', text: name, attrs: { 'aria-hidden': 'true' } }),
      state);
    this.paintState(state, s);

    const sw = el(d, 'div', {
      className: 'att-switch',
      attrs: {
        id: swId, role: 'group',
        'aria-label': this.locale === 'bn'
          ? `রোল ${roll}, ${name} — অবস্থা বাছুন`
          : `Roll ${roll}, ${name} — choose status`,
      },
    });
    sw.hidden = true;
    const opts = new Map<AttendanceStatus, HTMLButtonElement>();
    for (const [value, labelBn, labelEn] of CHOICES) {
      const b = button(d, {
        label: this.locale === 'bn' ? labelBn : labelEn,
        variant: 'secondary',
        className: 'att-opt',
        attrs: {
          'data-status': value,
          'aria-pressed': String(e.touched && e.status === value),
        },
        onClick: (ev) => this.choose(e.studentId, value, fromKeyboard(ev)),
      });
      opts.set(value, b);
      sw.append(b);
    }
    sw.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key !== 'Escape') return;
      ev.preventDefault();
      this.closeRow(e.studentId);
      this.focusHit(e.studentId);
    });

    hit.addEventListener('click', (ev) => {
      if (this.keyToggled === e.studentId && (ev as MouseEvent).detail === 0) {
        this.keyToggled = null;
        return;
      }
      this.toggleRow(e.studentId);
    });
    hit.addEventListener('keydown', (ev) => this.onRowKey(ev as KeyboardEvent, e.studentId));
    hit.addEventListener('keyup', () => {
      // A native Space activation fires its click after keyup's listeners;
      // clear the swallow flag only once that click has had its chance.
      if (this.keyToggled) setTimeout(() => { this.keyToggled = null; }, 0);
    });

    row.append(hit, sw);
    this.rows.set(e.studentId, { row, hit, state, sw, opts });
    return row;
  }

  private nameOf(e: GridEntry): string {
    return this.locale === 'bn' ? e.nameBn : (e.nameEn ?? e.nameBn);
  }

  /** Roll (Latin identifier), name, and the status in words — never colour alone. */
  private rowLabel(e: GridEntry): string {
    const s = shown(e);
    const roll = formatIdentifier(e.rollNo);
    return this.locale === 'bn'
      ? `রোল ${roll}, ${e.nameBn}, ${SPOKEN_BN[s]}`
      : `Roll ${roll}, ${e.nameEn ?? e.nameBn}, ${SPOKEN_EN[s]}`;
  }

  private paintState(node: HTMLElement, s: Shown): void {
    const d = this.o.doc;
    node.textContent = '';
    if (s === 'unset') {
      append(node, el(d, 'span', {
        className: 'att-unset', text: this.locale === 'bn' ? 'চিহ্নিত হয়নি' : 'Not marked',
      }));
    } else {
      append(node, badge(d, { label: CHIP[s][0], tone: CHIP[s][1], className: 'att-chip' }));
    }
  }

  /* ----------------------------------------------------------- updates */

  private onGridChange(): void {
    if (this.isSaved()) this.guardRaised = false;
    for (const e of this.grid.entriesInOrder()) {
      const r = this.rows.get(e.studentId);
      if (!r) continue;
      const s = shown(e);
      if (r.row.dataset.status !== s) {
        r.row.dataset.status = s;
        this.paintState(r.state, s);
      }
      r.hit.setAttribute('aria-label', this.rowLabel(e));
      for (const [value, b] of r.opts) {
        b.setAttribute('aria-pressed', String(e.touched && e.status === value));
      }
    }
    this.paintBulk();
    this.paintProgress();
    this.paintFooter();
  }

  /** Every figure the teacher sees comes from here, never from grid.counts(). */
  private tally(): Tally {
    const t: Tally = {
      total: 0, marked: 0, unmarked: 0, present: 0, absent: 0, late: 0, excused: 0, exceptions: 0,
    };
    for (const e of this.grid.entriesInOrder()) {
      t.total++;
      if (!e.touched) { t.unmarked++; continue; }
      t.marked++;
      t[e.status]++;
      if (e.status !== 'present') t.exceptions++;
    }
    return t;
  }

  /** The marks a save would send, as one comparable string. Unmarked students are not in it. */
  private marksKey(): string {
    return this.grid.entriesInOrder()
      .filter((e) => e.touched)
      .map((e) => `${e.studentId}:${e.status}`)
      .join('|');
  }

  /** The marks on screen are exactly the register last saved. */
  private isSaved(): boolean {
    return this.saved !== null && this.saved.key === this.marksKey();
  }

  /**
   * Marks on screen that no save holds: leaving now would lose them. Nobody
   * marked is nothing to lose, and a register changed and then changed back
   * to what was saved has nothing unsaved either.
   */
  hasUnsavedChanges(): boolean {
    const key = this.marksKey();
    return key !== '' && key !== this.saved?.key;
  }

  /**
   * With everyone marked, "all present" could only erase exceptions — so it
   * is disabled. aria-disabled, not `disabled`: the teacher's focus is on this
   * very button when the press marks the last students, and a disabled button
   * drops focus to the page.
   */
  private paintBulk(): void {
    const off = this.tally().unmarked === 0;
    if (off) this.bulkBtn.setAttribute('aria-disabled', 'true');
    else this.bulkBtn.removeAttribute('aria-disabled');
  }

  private paintProgress(): void {
    const d = this.o.doc;
    const t = this.tally();
    const done = t.unmarked === 0;
    const label = done
      ? `সবাই চিহ্নিত · ${bn(t.exceptions)} জন ব্যতিক্রম`
      : `${bn(t.marked)} / ${bn(t.total)} জন চিহ্নিত — ${bn(t.unmarked)} জন বাকি`;
    this.progressHost.dataset.tone = done ? 'ok' : this.guardRaised ? 'warn' : 'neutral';
    this.progressHost.textContent = '';
    append(this.progressHost, progress(d, { value: t.marked, max: Math.max(t.total, 1), label }));
  }

  private paintFooter(): void {
    const d = this.o.doc;
    const t = this.tally();
    const saved = this.isSaved();
    if (saved) this.guardRaised = false;
    if (this.guardRaised && t.unmarked === 0) this.guardRaised = false;
    const key = saved ? 'saved'
      : this.guardRaised ? (t.marked > 0 ? 'blocked-anyway' : 'blocked') : 'ready';

    if (key === this.footerKey) {
      // Same controls: update the numbers in place so a focused button survives.
      if (this.guardRaised && this.guardText && this.goBtn) {
        this.guardText.textContent = '';
        append(this.guardText, ...numText(d, this.guardSentence(t.unmarked)));
        relabel(d, this.goBtn, `বাকি ${bn(t.unmarked)} জনে যান`);
      }
      return;
    }

    const hadFocus = this.footerBody.contains(d.activeElement);
    this.footerKey = key;
    this.footerBody.textContent = '';
    this.guardText = null;
    this.goBtn = null;
    this.savedText = null;
    let focusTarget: HTMLElement;

    if (saved) {
      // After a submit the register used to look exactly like one never
      // submitted: the toast went after four seconds and the same primary
      // stayed, one tap from sending it again. The footer now says, for as
      // long as the marks are unchanged, that this register is saved, when,
      // and whether it has left the device. Changing any mark brings
      // "দেখে জমা দিন" back.
      this.footer.dataset.state = 'saved';
      this.savedText = el(d, 'p', {
        className: 'att-saved-text',
        attrs: { tabindex: '-1', 'aria-live': 'polite', 'data-focus-key': 'att-saved' },
      });
      this.paintSavedText();
      focusTarget = this.savedText;
      append(this.footerBody, this.savedText);
    } else if (!this.guardRaised) {
      this.footer.dataset.state = 'ready';
      focusTarget = button(d, {
        label: 'দেখে জমা দিন', variant: 'primary', block: true,
        attrs: { 'data-action': 'review' },
        onClick: () => this.review(),
      });
      append(this.footerBody, focusTarget);
    } else {
      this.footer.dataset.state = 'blocked';
      const textId = uid('att-guard');
      this.guardText = el(d, 'p', { className: 'att-guard-text', attrs: { id: textId } },
        ...numText(d, this.guardSentence(t.unmarked)));
      this.goBtn = button(d, {
        label: `বাকি ${bn(t.unmarked)} জনে যান`,
        variant: 'secondary',
        className: 'att-guard-go',
        attrs: { 'data-action': 'next-unmarked', 'aria-describedby': textId },
        onClick: () => this.goToUnmarked(),
      });
      focusTarget = this.goBtn;
      const actions = el(d, 'div', { className: 'att-guard-actions' }, this.goBtn);
      // "তবুও জমা" only when there is something to submit: an empty register
      // is never offered.
      if (t.marked > 0) {
        append(actions, button(d, {
          label: 'তবুও জমা', variant: 'secondary', className: 'att-guard-anyway',
          attrs: { 'data-action': 'submit-anyway' },
          onClick: () => this.openConfirm(true),
        }));
      }
      append(this.footerBody, this.guardText, actions);
    }
    if (hadFocus) focusTarget.focus();
  }

  private guardSentence(unmarked: number): string {
    return `${bn(unmarked)} জনকে এখনো চিহ্নিত করা হয়নি — খালি রেখে জমা দিলে তারা কোনো হিসাবেই থাকবে না।`;
  }

  /**
   * The saved footer's words. "জমা হয়েছে" only once nothing is waiting in the
   * queue (pending or in flight) and no op has been parked (failed or in
   * conflict) since this register was enqueued. Until then it says what is
   * certainly true: saved on this device. (The queue is the teacher's whole
   * outbox, so another unsent op keeps this at "not yet sent": it can be
   * late to say "sent", never early.)
   */
  private paintSavedText(): void {
    const node = this.savedText;
    const s = this.saved;
    if (!node || !s) return;
    const d = this.o.doc;
    const t = this.tally();
    const time = clock(s.at);
    const head = this.delivery === 'sent'
      ? `হাজিরা জমা হয়েছে · ${time}`
      : this.delivery === 'failed'
        ? `হাজিরা এই যন্ত্রে সংরক্ষিত · ${time} — পাঠানো যায়নি`
        : this.delivery === 'waiting'
          ? `হাজিরা এই যন্ত্রে সংরক্ষিত · ${time} — এখনো পাঠানো হয়নি`
          // The queue cannot say which way it went: only what is certain.
          : this.delivery === 'unknown'
            ? `হাজিরা এই যন্ত্রে সংরক্ষিত · ${time}`
            : `হাজিরা সংরক্ষিত · ${time} — পাঠানো হচ্ছে`;
    const parts = [`${bn(t.present)} জন উপস্থিত`];
    if (t.absent) parts.push(`${bn(t.absent)} জন আসেনি`);
    if (t.late) parts.push(`${bn(t.late)} জন দেরিতে`);
    if (t.excused) parts.push(`${bn(t.excused)} জন ছুটিতে`);
    if (t.unmarked) parts.push(`${bn(t.unmarked)} জন চিহ্নিত হয়নি`);
    // For the stylesheet: an --ok rule beside the words once it has arrived.
    node.dataset.delivery = this.delivery;
    node.textContent = '';
    append(node,
      el(d, 'span', { className: 'att-saved-head' }, ...numText(d, head)),
      el(d, 'span', { className: 'att-saved-tally' }, ...numText(d, parts.join(' · '))));
  }

  /**
   * Re-read the queue and say whether the saved register has left the device.
   * The view calls it when its own flush settles; the screen calls it each
   * time it repaints its sync line (connectivity, retry). Before this view's
   * flush has settled a non-empty queue is still "sending", not "not sent".
   *
   * The queue reports counts only, so the verdict is read from them:
   *   · anything pending or in flight: not yet — read again in 10 s;
   *   · nothing waiting, and no more parked (failed or conflicted) ops than
   *     just before the enqueue: it arrived;
   *   · nothing waiting, and more parked ops than before: it was refused and
   *     the engine parked it.
   * The engine never removes a parked op by itself, and nothing in the app
   * retries or discards one. Comparing with the whole count instead would let
   * one old refusal, from any screen, make every later register read "not
   * sent" forever — and keep reading the queue every 10 s to say so.
   * A verdict is final: the queue is not read again for this register.
   */
  async refreshSaved(): Promise<void> {
    const saved = this.saved;
    const decided = () => this.delivery === 'sent' || this.delivery === 'failed'
      || this.delivery === 'unknown';
    if (!saved || decided()) return;
    let s: Awaited<ReturnType<OutboxLike['state']>>;
    try { s = await this.o.outbox.state(); } catch { return; }
    if (this.saved !== saved || decided()) return;
    const waiting = (s.pending ?? 0) + (s.inflight ?? 0);
    const parked = (s.failed ?? 0) + (s.conflicts ?? 0);
    let next: Delivery;
    if (waiting > 0) {
      this.scheduleRecheck();
      next = this.flushing ? this.delivery : 'waiting';
    } else if (parked === 0 || (saved.parkedBefore !== null && parked <= saved.parkedBefore)) {
      next = 'sent';
    } else {
      // More parked ops than before. Counts cannot name the op, so another of
      // this teacher's ops refused in the same window would read the same;
      // that is rare, and this line never says "arrived" for a refusal.
      // With no count from before the enqueue, it cannot tell at all.
      next = saved.parkedBefore === null ? 'unknown' : 'failed';
    }
    if (next === this.delivery) return;
    this.delivery = next;
    this.paintSavedText();
    this.o.onDeliveryChange?.();
  }

  /** Read the queue again later, while this register is on screen and still waiting in it. */
  private scheduleRecheck(): void {
    if (this.recheckTimer !== null) return;
    const t = setTimeout(() => {
      this.recheckTimer = null;
      if (!this.footer.isConnected) return;
      void this.refreshSaved();
    }, SAVED_RECHECK_MS);
    // Never what keeps a test process (or a closing page) alive.
    (t as { unref?: () => void }).unref?.();
    this.recheckTimer = t;
  }

  /**
   * Focus the saved line, if this register has one. The screen's "আবার পাঠান"
   * sits in a sync line that disappears once the queue empties, taking focus
   * with it; the saved line — now reading "জমা হয়েছে" — is where it belongs.
   */
  focusSaved(): boolean {
    const node = this.savedText;
    if (!node?.isConnected) return false;
    node.focus({ preventScroll: true });
    return this.o.doc.activeElement === node;
  }

  /** The chip: queued-op count and last sync. Never blocks anything. */
  async paintChip(): Promise<void> {
    if (!this.chipEl) return;
    const s = await this.o.outbox.state();
    const chip = this.chipEl;
    chip.textContent = '';
    let text: string;
    if (s.pending === 0 && s.failed === 0) {
      text = this.locale === 'bn' ? 'সিঙ্ক হয়েছে' : 'Synced';
      chip.dataset.state = 'synced';
    } else if (s.failed > 0) {
      text = this.locale === 'bn' ? `${formatCount(s.failed, 'bn')}টি পাঠানো যায়নি` : `${s.failed} could not sync`;
      chip.dataset.state = 'failed';
    } else {
      text = this.locale === 'bn' ? `${formatCount(s.pending, 'bn')}টি অপেক্ষমাণ` : `${s.pending} queued`;
      chip.dataset.state = 'queued';
    }
    append(chip, ...numText(this.o.doc, text));
  }

  /* ------------------------------------------------------------ marking */

  private markAll(keyboard = false): void {
    const before = this.tally();
    if (before.unmarked === 0) return;           // aria-disabled
    this.grid.markAllPresent();
    const line = `${bn(before.total)} জনকে উপস্থিত ধরা হয়েছে`;
    // The overwrite is the one fact that makes this press worth undoing, so it
    // gets its own wrapping line — never the ellipsised name line.
    const detail = before.exceptions > 0
      ? `${bn(before.exceptions)} জনের আগের চিহ্ন বদলে উপস্থিত হয়েছে`
      : undefined;
    this.showUndo(line, { kind: 'bulk' }, keyboard, detail);
  }

  private choose(studentId: string, status: AttendanceStatus, keyboard = false): void {
    const e = this.grid.entriesInOrder().find((x) => x.studentId === studentId);
    if (!e) return;
    if (e.touched && e.status === status) return;   // a re-tap records nothing
    this.grid.set(studentId, status);
    this.closeRow(studentId);
    // The toast first, THEN the scroll: the root scroll-padding that clears
    // the toast only applies while it is shown. Scrolled the other way round,
    // the row just marked landed 22px under its own toast.
    this.showUndo(`${this.nameOf(e)} — ${CHIP[status][0]}`, { kind: 'single', studentId }, keyboard);
    this.focusHit(studentId);
  }

  private toggleRow(studentId: string): void {
    if (this.openId === studentId) this.closeRow(studentId);
    else this.openRow(studentId);
  }

  private openRow(studentId: string): void {
    if (this.openId && this.openId !== studentId) this.closeRow(this.openId);
    const r = this.rows.get(studentId);
    if (!r) return;
    r.sw.hidden = false;
    r.hit.setAttribute('aria-expanded', 'true');
    r.row.classList.add('is-open');
    this.openId = studentId;
    // A tap on a row low on the screen opened its three buttons under the
    // sticky footer and nothing moved: the tap seemed to do nothing, and the
    // next tap landed on "দেখে জমা দিন". 'nearest' scrolls only when the
    // buttons are covered, and only as far as the root scroll-padding this
    // screen sets for the footer, the tab bar and the undo toast.
    if (typeof r.row.scrollIntoView === 'function') r.row.scrollIntoView({ block: 'nearest' });
  }

  private closeRow(studentId: string): void {
    const r = this.rows.get(studentId);
    if (r) {
      r.sw.hidden = true;
      r.hit.setAttribute('aria-expanded', 'false');
      r.row.classList.remove('is-open');
    }
    if (this.openId === studentId) this.openId = null;
  }

  /** Open a row, bring it into view, and focus its pressed (or first) option. */
  private focusRowChoice(studentId: string): void {
    const r = this.rows.get(studentId);
    if (!r) return;
    this.openRow(studentId);
    const pressed = [...r.opts.values()].find((b) => b.getAttribute('aria-pressed') === 'true');
    (pressed ?? r.opts.get('present'))?.focus({ preventScroll: true });
    if (typeof r.row.scrollIntoView === 'function') r.row.scrollIntoView({ block: 'center' });
  }

  /**
   * Focus a row's hit and bring it clear of the sticky footer, the undo toast
   * and the tab bar. The browser's own focus scroll ignores those overlays
   * (it only scrolls when the target leaves the viewport); scrollIntoView
   * honours the root scroll-padding the stylesheet sets for this screen.
   * WCAG 2.4.11 Focus Not Obscured.
   */
  private focusHit(studentId: string): void {
    const r = this.rows.get(studentId);
    if (!r) return;
    r.hit.focus({ preventScroll: true });
    if (typeof r.row.scrollIntoView === 'function') r.row.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------ guard 1 + 3 */

  private review(): void {
    if (this.tally().unmarked > 0) {
      this.guardRaised = true;
      this.paintProgress();
      this.paintFooter();
      this.goBtn?.focus();
      return;
    }
    this.openConfirm(false);
  }

  private goToUnmarked(): void {
    const first = this.grid.entriesInOrder().find((e) => !e.touched);
    if (first) this.focusRowChoice(first.studentId);
  }

  private openConfirm(includeUnset: boolean): void {
    const d = this.o.doc;
    if (this.sheet) return;
    const t = this.tally();
    if (t.marked === 0) return;
    this.hideUndo();
    if (this.openId) this.closeRow(this.openId);

    const entries = this.grid.entriesInOrder();
    const okId = uid('att-confirm-ok');
    const smsId = uid('att-confirm-sms');
    const by = (s: Shown) => entries.filter((e) => shown(e) === s);

    let handle!: OverlayHandle;
    // Guard 3 is the last look before an SMS that cannot be recalled, so a
    // screen-reader user Tabbing through it must hear WHO and WHAT: roll, name
    // and the state being confirmed, not a bare name on every button.
    const change = (e: GridEntry, stateWord: string) => button(d, {
      label: 'বদলান', variant: 'ghost', className: 'att-confirm-change',
      ariaLabel: `রোল ${formatIdentifier(e.rollNo)}, ${this.nameOf(e)}, ${stateWord} — বদলান`,
      onClick: () => {
        handle.close();
        this.focusRowChoice(e.studentId);
      },
    });
    // A real heading (h3 under the sheet's title) names each group, and the
    // list is labelled by it, so the grouping exists in code, not only in type.
    const group = (tone: string, heading: string, stateWord: string, list: GridEntry[]) => {
      const headId = uid('att-confirm-group');
      return el(d, 'section', { className: 'att-confirm-group', data: { tone } },
        el(d, 'h3', { className: 'att-confirm-heading', data: { tone }, attrs: { id: headId } },
          ...numText(d, heading)),
        el(d, 'ul', { className: 'att-confirm-list', attrs: { 'aria-labelledby': headId } },
          ...list.map((e) => el(d, 'li', { className: 'att-confirm-row' },
            el(d, 'span', { className: 'att-confirm-roll n', text: formatIdentifier(e.rollNo) }),
            el(d, 'span', { className: 'att-confirm-name', text: this.nameOf(e) }),
            change(e, stateWord)))));
    };

    const subText = [this.o.section.labelBn, this.o.subjectBn, formatDayMonth(this.o.takenOn, 'bn')]
      .filter(Boolean).join(' · ');
    const body: HTMLElement[] = [
      el(d, 'p', { className: 'att-confirm-sub' }, ...numText(d, subText)),
      el(d, 'div', { className: 'att-confirm-ok', attrs: { id: okId } },
        icon(d, 'check-square'),
        el(d, 'span', {}, ...numText(d, `${bn(t.present)} জন উপস্থিত`))),
    ];
    if (t.absent > 0) body.push(group('danger', `${bn(t.absent)} জন আসেনি`, 'আসেনি', by('absent')));
    if (t.late > 0) body.push(group('warn', `${bn(t.late)} জন দেরিতে`, 'দেরি', by('late')));
    if (t.excused > 0) body.push(group('info', `${bn(t.excused)} জন ছুটিতে`, 'ছুটি', by('excused')));
    if (includeUnset && t.unmarked > 0) {
      body.push(group('neutral',
        `${bn(t.unmarked)} জন চিহ্নিত হয়নি — এদের হাজিরা জমা হবে না`, 'চিহ্নিত হয়নি', by('unset')));
    }
    const sms = t.absent + t.late;   // the server texts guardians for both
    if (sms > 0) {
      body.push(el(d, 'div', { className: 'att-confirm-sms', attrs: { id: smsId } },
        icon(d, 'message'),
        el(d, 'span', {}, ...numText(d, `${bn(sms)} জন শিক্ষার্থীর অভিভাবকের কাছে এসএমএস যাবে`))));
    }

    const back = button(d, {
      label: 'ফিরে যান', variant: 'secondary', onClick: () => handle.close(),
    });
    const submit = button(d, {
      label: 'জমা দিন', variant: 'primary', attrs: { 'data-action': 'save' },
    });
    // What pressing it does, read when focus lands on it: the present count
    // and — the part that cannot be recalled — how many guardians get an SMS.
    submit.setAttribute('aria-describedby', sms > 0 ? `${okId} ${smsId}` : okId);
    // The outcome of a failed submit, inside the sheet. The page behind is
    // aria-hidden while the sheet is open, so a toast there is never heard.
    // The alert region exists (empty) from the start: a region already in the
    // tree when its text arrives is what readers reliably announce.
    const error = el(d, 'p', { className: 'att-confirm-error', attrs: { role: 'alert' } });
    body.push(error);
    onClickBusy(submit, async () => {
      error.textContent = '';
      let ok = false;
      try {
        ok = this.o.onConfirm ? await this.o.onConfirm() : (await this.save(), true);
      } catch (err) {
        // The screen's submit catches its own failures; standalone, log it.
        console.error('[attendance] save failed', err);
        ok = false;
      }
      if (ok) {
        // Close first, THEN say what happened: an announcement made while the
        // page is still aria-hidden is lost. (The screen closes the sheet
        // itself before its toast; close() is idempotent.)
        handle.close();
        if (!this.o.onConfirm) {
          setTimeout(() => announce(d, 'হাজিরা এই যন্ত্রে সংরক্ষিত'), 0);
        }
        return;
      }
      append(error, ...numText(d, 'হাজিরা সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।'));
      // setBusy disabled the focused button, which drops focus to <body> —
      // outside the trap. onClickBusy re-enables it after this returns, so
      // focus it on the next task, while the sheet is still open.
      setTimeout(() => {
        if (this.sheet === handle && submit.isConnected) submit.focus();
      }, 0);
    });

    // Dismissible (×, Escape, scrim) — every way out is "ফিরে যান", never a
    // submit. The × is the first control, so it takes initial focus and a
    // habitual Enter closes rather than submits.
    handle = openOverlay(d, {
      title: 'জমা দেওয়ার আগে দেখুন',
      kind: 'auto',
      className: 'att-confirm',
      body,
      actions: [back, submit],
      onClose: () => {
        this.sheet = null;
        // A save replaced the sheet's opener ("দেখে জমা দিন") with the saved
        // line, so the overlay's own focus return had nothing to land on.
        if (this.footerKey === 'saved' && this.savedText?.isConnected && focusIsLost(d)) {
          this.savedText.focus({ preventScroll: true });
        }
      },
    });
    this.sheet = handle;
  }

  /* ------------------------------------------------------------ guard 2 */

  /** Close the confirm sheet, if open. The screen calls it once a save is safe. */
  closeConfirm(): void {
    this.sheet?.close();
  }

  private showUndo(line: string, target: UndoTarget, keyboard = false, detail?: string): void {
    const d = this.o.doc;
    this.clearUndoTimer();
    this.undoTarget = target;
    this.undoKeyboard = keyboard;
    this.undoEl.textContent = '';
    this.undoHover = false;
    this.undoFocus = false;
    this.undoLeft = UNDO_SECONDS;
    const count = el(d, 'span', {
      className: 'att-undo-time n', attrs: { 'aria-hidden': 'true' },
    });
    const undo = el(d, 'button', {
      className: 'ui-toast-action att-undo-btn',
      attrs: { type: 'button', 'aria-keyshortcuts': 'Control+Z Meta+Z' },
      text: 'ফিরিয়ে নিন',
    });
    undo.addEventListener('click', () => this.undo());
    append(this.undoEl, el(d, 'div', { className: 'ui-toast' },
      el(d, 'span', { className: 'ui-toast-text' },
        el(d, 'span', { className: 'att-undo-name' }, ...numText(d, line)),
        ...(detail
          ? [el(d, 'span', { className: 'att-undo-detail' },
              el(d, 'span', { className: 'ui-sr-only', text: ' — ' }),
              ...numText(d, detail))]
          : []),
        count,
        el(d, 'span', { className: 'ui-sr-only', text: 'ফিরিয়ে নিতে Ctrl+Z চাপুন' })),
      undo));
    this.undoEl.dataset.expires = String(!keyboard);
    this.undoEl.dataset.kind = target.kind;
    this.undoEl.hidden = false;
    if (keyboard) {
      // No countdown: the window stays open until the next change, a submit
      // or a save (WCAG 2.2.1 — the time limit is turned off for the users
      // who cannot reach the button inside it).
      count.textContent = 'Ctrl+Z চাপলেও ফিরবে';
      return;
    }
    this.paintUndoCount();
    this.tickUndo();
  }

  private paintUndoCount(): void {
    const c = this.undoEl.querySelector('.att-undo-time');
    if (c) c.textContent = `${bn(this.undoLeft)} সেকেন্ড`;
  }

  private tickUndo(): void {
    if (this.undoKeyboard) return;             // a keyboard undo never expires
    this.undoTimer = setTimeout(() => {
      this.undoTimer = null;
      if (!this.undoHover && !this.undoFocus) {
        this.undoLeft--;
        if (this.undoLeft <= 0) { this.hideUndo(); return; }
        this.paintUndoCount();
      }
      this.tickUndo();
    }, 1000);
  }

  private clearUndoTimer(): void {
    if (this.undoTimer) { clearTimeout(this.undoTimer); this.undoTimer = null; }
  }

  private hideUndo(): void {
    this.clearUndoTimer();
    this.undoTarget = null;
    this.undoKeyboard = false;
    this.undoEl.textContent = '';
    this.undoEl.hidden = true;
  }

  private undo(): void {
    const target = this.undoTarget;
    if (!target) return;
    this.grid.undo();
    this.hideUndo();
    announce(this.o.doc, 'ফিরিয়ে নেওয়া হয়েছে');
    if (target.kind === 'single') this.focusHit(target.studentId);
    else this.bulkBtn.focus();
  }

  /* -------------------------------------------------------------- save */

  /**
   * Writes to the outbox and returns. The network is attempted afterwards and
   * is allowed to fail — that is the whole point of the design.
   *
   * Only marked students are sent. An unmarked student gets no record: not a
   * default present, not a default absent. With nobody marked it rejects
   * before enqueue — the server would accept `records: []` and count a
   * register that was never taken.
   */
  async save(): Promise<SaveResult> {
    const marked = new Set(this.grid.entriesInOrder().filter((e) => e.touched).map((e) => e.studentId));
    if (marked.size === 0) throw new NothingMarkedError();
    // What is being sent, taken with the payload: the footer's "saved" state
    // compares the screen against THIS, not against marks made during the wait.
    const key = this.marksKey();

    const sessionId = this.o.newId();
    const full = this.grid.toPayload({
      sessionId,
      sectionId: this.o.section.id,
      academicYearId: this.o.section.academicYearId,
      takenOn: this.o.takenOn,
      periodNo: this.o.periodNo ?? null,
      mode: this.o.periodNo == null ? 'section_daily' : 'period_wise',
    });
    const payload = { ...full, records: full.records.filter((r) => marked.has(r.studentId)) };

    // The parked (failed or conflicted) ops already in the queue, so a later
    // read can tell this register's refusal from an old one (refreshSaved).
    let parkedBefore: number | null = null;
    try {
      const before = await this.o.outbox.state();
      parkedBefore = (before.failed ?? 0) + (before.conflicts ?? 0);
    } catch { /* unreadable: the footer will not claim either way */ }

    const op = await this.o.outbox.enqueue({
      entity: 'attendance_session',
      opId: sessionId,           // op id IS the session id — one row, one op
      payload,
    });

    const at = (this.o.now ?? Date.now)();
    this.grid.markSaved(at);
    // markSaved empties the grid's undo stack, so the window is closed.
    this.hideUndo();
    const saved = { key, at, parkedBefore };
    this.saved = saved;
    this.delivery = 'sending';
    this.flushing = true;
    this.guardRaised = false;
    this.paintProgress();
    this.paintFooter();

    // Fire-and-forget from the UI's perspective. A rejection here is normal
    // offline and must not surface as an unhandled rejection or an error toast.
    const flushed = Promise.resolve(this.o.outbox.flush())
      .catch(() => {})
      .then(() => { if (this.saved === saved) this.flushing = false; })
      .then(() => this.paintChip())
      .then(() => this.refreshSaved());

    await this.paintChip();

    return { opId: op.opId, queued: true, flushed };
  }

  /* ------------------------------------------------------- keyboard a11y */

  private onRowKey(ev: KeyboardEvent, studentId: string): void {
    const order = this.grid.entriesInOrder().map((e) => e.studentId);
    const i = order.indexOf(studentId);
    let next = -1;

    switch (ev.key) {
      case ' ': case 'Enter':
        ev.preventDefault();
        this.keyToggled = studentId;
        this.toggleRow(studentId);
        return;
      // One column now; Left/Right kept as ±1 (IMPLEMENTATION §8: keep the
      // arrow navigation).
      case 'ArrowDown': case 'ArrowRight': next = i + 1; break;
      case 'ArrowUp': case 'ArrowLeft': next = i - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = order.length - 1; break;
      default: return;
    }
    ev.preventDefault();
    if (next < 0 || next >= order.length) return;
    this.focusHit(order[next]);
  }

  /* ------------------------------------------------------------ testing */

  get state() {
    return this.grid.snapshot();
  }
}

/** Replace a button()'s label, keeping its element (and focus) intact. */
function relabel(doc: Document, btn: HTMLButtonElement, label: string): void {
  const fresh = button(doc, { label }).querySelector('.btn-label');
  const old = btn.querySelector('.btn-label');
  if (fresh && old) old.replaceWith(fresh);
}
