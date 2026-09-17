/**
 * শিক্ষাপঞ্জি — the academic calendar  (R-4, docs/11-MASTER-PLAN.md)
 *
 * `calendar_days` has existed since migration 003 and has never had a screen,
 * while already being load-bearing: sms-svc reads it to suppress attendance
 * and notice SMS on holidays. This is the screen.
 *
 * ── Every role sees it; four roles can change it ────────────────────────
 * A school calendar a guardian cannot open is not a school calendar — ঈদের
 * ছুটি is exactly the thing a family plans around. So the read is universal
 * and only the controls are gated, by the server (migration 043's RESTRICTIVE
 * policies) with `canManage` deciding whether a button is drawn at all.
 *
 * ── The weekend comes from the tenant, never from a constant ────────────
 * `tenants.weekend_days` arrives in the response (0=Sun … 6=Sat). Monipur
 * runs {5,6}; many Madrasah run {5}. The month grid marks whatever it is
 * told — on the column header, in each day's `data-state` and in each day's
 * accessible name — and there is no Friday in this file.
 *
 * ── Ata Ekta (04 Guardian §05 mobile, 09 Comms §03 desktop) ─────────────
 * One DOM, CSS decides at 1024px. The week starts শনি at both widths. Below
 * it: a month row (chevron · month · chevron), one-letter weekday labels,
 * square day cells FILLED with the colour of their event kind, a key, and the
 * upcoming list. From 1024px: the month sits in the page header as a chip,
 * weekday names are full, and each cell stays white with a small coloured
 * label per event. Every kind has one colour everywhere it appears — cell,
 * label, key swatch, upcoming date, card glyph and badge.
 *
 * ── Colour is never the only carrier (R-4, R8) ──────────────────────────
 * The drawings mark a day by fill alone. Two of those fills have opposite
 * effects — a holiday silences the day's SMS, a working weekend sends it —
 * and red, amber and green collapse into one olive for a colour-blind head
 * teacher. So on top of the drawn fill, CSS keys a SHAPE on `data-state`: a
 * holiday has a heavy bottom rule, a working weekend a heavy top rule, and a
 * plain weekend a grey ground. The key draws the same shapes beside their
 * words, and the upcoming list writes the kind out.
 *
 * ── Exams are drawn, not owned ──────────────────────────────────────────
 * Entries arriving with `editable: false` come from `exams` and
 * `exam_subjects` at read time. They render in the grid and open in the day
 * panel like anything else, and they carry no edit or delete control — the
 * routine screen is where an exam date changes. Copying them into
 * `calendar_days` would have made a second source of truth that goes stale
 * the first time a coordinator moves a paper.
 *
 * ── Offline ─────────────────────────────────────────────────────────────
 * READS are stale-while-revalidate in the service worker, exactly like the
 * inbox and the routine: a teacher opening the calendar on a dead link sees
 * the month they last loaded. WRITES are online-only and deliberately not
 * queued through the IndexedDB outbox — the outbox exists for attendance and
 * marks, which a teacher genuinely takes in a room with no signal. An IT
 * admin declaring next month's holiday from a corridor with no bars, to be
 * applied whenever the phone reconnects, is not a workflow; and a queued
 * holiday is one that silently suppresses SMS on a day nobody has agreed to
 * yet. See docs/07 §9g.
 */
import type { Auth } from './auth.ts';
import {
  skeleton, errorState, emptyState, successNote, bnNum, bnDate,
} from './view-states.ts';
import { pageHeader } from './ui/page-header.ts';
import { permissionMessage, permissionState, serverMessage,
  sectionHeading, card, button, iconButton, buttonRow, badge, statusBadge, field,
  setFieldError, clearFieldError, confirmOverlay, list, el, append, numText, numClass,
  type BadgeTone, type CardTone,
} from './ui/index.ts';

/**
 * One colour per kind (09 Comms §03: "প্রতিটি ঘটনার রং নির্দিষ্ট"), used the
 * same way by the badge here and by the grid fill, the desktop label, the key
 * swatch and the upcoming date in app.css (`--cal-tone`). ছুটি is drawn red;
 * the red that may carry meaning is --danger — the accent belongs to the one
 * primary button (R5). খোলা takes the drawn green slot.
 */
const KIND_TONE: Record<string, BadgeTone> = {
  holiday: 'danger',
  event: 'info',
  exam: 'warn',
  working_weekend: 'success',
  ramadan_schedule: 'neutral',
};
/** The same colours on an entry card's glyph square. No tone is neutral. */
const CARD_TONE: Record<string, CardTone | undefined> = {
  holiday: 'danger',
  event: 'info',
  exam: 'warn',
  working_weekend: 'success',
};

/**
 * The key is fixed, in the drawn order — ছুটি, অনুষ্ঠান, পরীক্ষা, then the
 * green slot — so a colour is always explained whether or not this month uses
 * it. A kind outside these four is keyed only in a month that has one.
 */
const LEGEND_KINDS = ['holiday', 'event', 'exam', 'working_weekend'];

/**
 * Which kind fills a phone-width day cell when a day has several. Holiday
 * first — the same precedence as `dayState()` and the SMS sender: a day the
 * school has shut is shut, whatever else is on it.
 */
const DOMINANT_ORDER = ['holiday', 'exam', 'working_weekend', 'event', 'ramadan_schedule'];

function dominantKind(entries: CalendarEntry[]): string | null {
  for (const k of DOMINANT_ORDER) if (entries.some((e) => e.kind === k)) return k;
  return entries[0]?.kind ?? null;
}

export interface CalendarEntry {
  id: string;
  day: string;
  kind: string;
  titleBn: string;
  descriptionBn: string | null;
  appliesToShifts: string[] | null;
  academicYearId?: string;
  yearLabel?: string;
  createdByNameBn?: string | null;
  source: string;
  editable: boolean;
}

export interface CalendarPayload {
  range: { from: string; to: string };
  weekendDays: number[];
  shifts: string[];
  years: { id: string; label: string; isCurrent: boolean; startsOn: string; endsOn: string }[];
  currentYearId: string | null;
  entries: CalendarEntry[];
}

export interface CalendarViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Whether to offer the controls. The server and RLS are the gate. */
  canManage: boolean;
}

export const KIND_BN: Record<string, string> = {
  holiday: 'ছুটি',
  exam: 'পরীক্ষা',
  event: 'অনুষ্ঠান',
  ramadan_schedule: 'রমজানের সময়সূচি',
  working_weekend: 'খোলা',
};

const SHIFT_BN: Record<string, string> = {
  morning: 'সকাল', day: 'দিবা', evening: 'সন্ধ্যা', single: 'একক',
};

/**
 * Weekday names INDEXED by `weekend_days`' numbering (0=Sun … 6=Sat), so the
 * tenant's weekend is looked up, never assumed. The DISPLAY order is
 * `COLUMN_DOW`: Saturday first, as both drawings start the week.
 */
const WEEKDAY_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];
/** The phone's one-letter labels (04 Guardian §05), same indexing. */
const WEEKDAY_SHORT_BN = ['র', 'সো', 'ম', 'বু', 'বৃ', 'শু', 'শ'];
/** Column order: শনি রবি সোম মঙ্গল বুধ বৃহঃ শুক্র. */
const COLUMN_DOW = [6, 0, 1, 2, 3, 4, 5];
const MONTH_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

/** 'YYYY-MM-DD' in UTC — the same calendar the server stores dates in. */
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The day `by` days after an ISO date — calendar arithmetic, no clock. */
function shiftIso(day: string, by: number): string {
  const [y, m, dd] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + by));
  return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

/** One row of the upcoming list: an entry, or the same entry on consecutive days. */
interface Run { entry: CalendarEntry; from: string; to: string }

/**
 * Consecutive days carrying the same kind and title, as one run — the drawn
 * "১৮–২০ অর্ধবার্ষিক পরীক্ষা" rather than three identical rows. Presentation
 * only: the rows are the ones already loaded, in the server's day order, and
 * the day panel still lists every entry on every day.
 */
function runsOf(entries: CalendarEntry[]): Run[] {
  const runs: Run[] = [];
  const open = new Map<string, Run>();
  for (const e of entries) {
    const key = JSON.stringify([e.kind, e.titleBn]);
    const run = open.get(key);
    if (run && run.to === e.day) continue;
    if (run && shiftIso(run.to, 1) === e.day) { run.to = e.day; continue; }
    const next: Run = { entry: e, from: e.day, to: e.day };
    runs.push(next);
    open.set(key, next);
  }
  return runs;
}

export class CalendarView {
  private readonly o: CalendarViewOptions;
  private data: CalendarPayload | null = null;
  private loading = true;
  private error = '';
  private notice = '';
  private busy = false;

  /** The month on screen, as year and 0-based month. */
  private year: number;
  private month: number;
  private selectedDay: string | null = null;
  private kindFilter = '';
  private editing: CalendarEntry | null = null;
  private creating = false;

  constructor(options: CalendarViewOptions) {
    this.o = options;
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    this.render();
    void this.load();
  }

  // ── data ──────────────────────────────────────────────────────────────

  private rangeOfMonth(): { from: string; to: string } {
    const last = new Date(Date.UTC(this.year, this.month + 1, 0)).getUTCDate();
    return { from: iso(this.year, this.month, 1), to: iso(this.year, this.month, last) };
  }

  private async load(): Promise<void> {
    this.loading = true; this.error = ''; this.render();
    try {
      const { from, to } = this.rangeOfMonth();
      const qs = new URLSearchParams({ from, to });
      if (this.kindFilter) qs.set('kind', this.kindFilter);
      const res = await this.o.auth.authedFetch(`/api/v1/ops/calendar?${qs}`);
      if (res.status === 403) { this.error = permissionMessage('শিক্ষাপঞ্জি'); return; }
      if (!res.ok) throw new Error(String(res.status));
      this.data = (await res.json()) as CalendarPayload;
    } catch {
      this.error = 'শিক্ষাপঞ্জি আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false; this.render();
    }
  }

  private async save(payload: Record<string, unknown>, editingId: string | null): Promise<void> {
    this.busy = true; this.error = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/calendar', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { ...payload, id: editingId } : payload),
      });
      const body = await res.json() as { notified?: number; message?: string };
      if (!res.ok) {
        this.error = serverMessage(body, res.status, 'সংরক্ষণ করা যায়নি।', 'শিক্ষাপঞ্জি');
        return;
      }
      this.notice = (editingId ? 'পরিবর্তন সংরক্ষিত হয়েছে।' : 'শিক্ষাপঞ্জিতে যুক্ত হয়েছে।')
        + (body.notified ? ` ${bnNum(body.notified)} জনকে জানানো হয়েছে।` : '');
      this.editing = null; this.creating = false;
      await this.load();
    } catch {
      this.error = 'সংযোগ নেই — সংরক্ষণ করা যায়নি।';
    } finally {
      this.busy = false; this.render();
    }
  }

  private async remove(entry: CalendarEntry): Promise<void> {
    this.busy = true; this.error = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/ops/calendar?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      const body = await res.json() as { message?: string };
      if (!res.ok) {
        this.error = res.status === 403
          ? 'এই এন্ট্রি পরিবর্তনের অনুমতি আপনার নেই।'
          : serverMessage(body, res.status, 'মুছে ফেলা যায়নি।', 'শিক্ষাপঞ্জি');
        return;
      }
      this.notice = `"${entry.titleBn}" শিক্ষাপঞ্জি থেকে সরানো হয়েছে।`;
      await this.load();
    } catch {
      this.error = 'সংযোগ নেই — মুছে ফেলা যায়নি।';
    } finally {
      this.busy = false; this.render();
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private entriesOn(day: string): CalendarEntry[] {
    return (this.data?.entries ?? []).filter((e) => e.day === day);
  }

  private isWeekend(dow: number): boolean {
    return (this.data?.weekendDays ?? []).includes(dow);
  }

  private isHoliday(day: string): boolean {
    return this.entriesOn(day).some((e) => e.kind === 'holiday');
  }

  /**
   * A weekend the school has declared a working day.  (R-4.1)
   *
   * The same precedence the SMS sender applies in
   * `sms-svc/src/dispatch.ts::nonWorkingReasonFor`: a holiday on the same
   * date wins, because a school that has declared one has made the more
   * specific statement. Keeping the two in step matters — a cell that says
   * "খোলা" while the sender suppresses the SMS is the calendar lying about
   * what the system will do.
   */
  private isWorkingWeekend(day: string, dow: number): boolean {
    if (!this.isWeekend(dow)) return false;
    if (this.isHoliday(day)) return false;
    return this.entriesOn(day).some((e) => e.kind === 'working_weekend');
  }

  /** The three states a cell can be in, for the label and the legend. */
  private dayState(day: string, dow: number): 'holiday' | 'working_weekend' | 'weekend' | 'normal' {
    if (this.isHoliday(day)) return 'holiday';
    if (this.isWorkingWeekend(day, dow)) return 'working_weekend';
    if (this.isWeekend(dow)) return 'weekend';
    return 'normal';
  }

  private todayIso(): string {
    const t = new Date();
    return iso(t.getFullYear(), t.getMonth(), t.getDate());
  }

  private step(by: number): void {
    const d = new Date(Date.UTC(this.year, this.month + by, 1));
    this.year = d.getUTCFullYear();
    this.month = d.getUTCMonth();
    this.selectedDay = null;
    this.editing = null; this.creating = false; this.notice = '';
    void this.load();
  }

  private goToday(): void {
    const t = new Date();
    this.year = t.getFullYear(); this.month = t.getMonth();
    this.selectedDay = this.todayIso();
    void this.load();
  }

  /**
   * The same entry was also on the day before — a continuation day of a
   * multi-day run, which the desktop cell labels "—" as drawn rather than
   * repeating the title in every cell of the run.
   */
  private continues(e: CalendarEntry): boolean {
    return this.entriesOn(shiftIso(e.day, -1))
      .some((p) => p.kind === e.kind && p.titleBn === e.titleBn);
  }

  // ── render ────────────────────────────────────────────────────────────

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    const denied = this.error.includes('অনুমতি');
    const ready = !this.loading && this.data !== null && !denied;

    // Desktop bar (09 Comms §03): title, the month chip, then the one primary.
    // The chip's arrows and আজ are not drawn but are how the month changes;
    // on a phone the chip hides and the month row below carries the arrows.
    // The primary is offered only when the form it opens can be drawn, and
    // not while that form is open, so a single primary is on screen at once.
    root.append(pageHeader(d, {
      title: 'শিক্ষাপঞ্জি',
      actions: [this.monthControls(), button(d, {
        label: 'আজ', variant: 'ghost', size: 'sm', onClick: () => this.goToday(),
      })],
      primary: this.o.canManage && ready && !this.creating && !this.editing
        ? this.createButton()
        : undefined,
    }));

    if (this.notice) root.append(successNote(d, this.notice));
    if (this.error) {
      // A refusal is the whole answer; a grid underneath it would say
      // "nothing is scheduled", which is a different and untrue claim.
      if (denied) {
        root.append(this.monthNav(), permissionState(d, { message: this.error }));
        return;
      }
      root.append(errorState(d, this.error, () => void this.load()));
    }

    if (ready) {
      root.append(this.filters());
      if (this.creating || this.editing) root.append(this.form());
    }

    // The month row sits directly above the grid, as drawn.
    root.append(this.monthNav());

    if (this.loading) { root.append(skeleton(d, 3)); return; }
    if (!this.data) return;

    root.append(el(d, 'div', { className: 'cal-board' }, this.grid(), this.legend()));
    root.append(this.dayPanel());
    root.append(this.upcoming());
  }

  /**
   * A month arrow. Named by MONTH, not "previous": identical "আগের" buttons
   * on one screen are identical announcements.
   */
  private stepButton(by: -1 | 1): HTMLButtonElement {
    const d = this.o.doc;
    return by < 0
      ? iconButton(d, {
        glyph: 'chevron-left',
        label: `আগের মাস — ${MONTH_BN[(this.month + 11) % 12]}`,
        onClick: () => this.step(-1),
      })
      : iconButton(d, {
        glyph: 'chevron-right',
        label: `পরের মাস — ${MONTH_BN[(this.month + 1) % 12]}`,
        onClick: () => this.step(1),
      });
  }

  /** Desktop (≥1024px): arrows around the neutral month chip, in the header. */
  private monthControls(): HTMLElement {
    const d = this.o.doc;
    return el(d, 'div', { className: 'cal-month-ctl' },
      this.stepButton(-1),
      badge(d, {
        label: `${MONTH_BN[this.month]} ${bnNum(this.year)}`,
        tone: 'neutral', className: 'cal-month-chip',
      }),
      this.stepButton(1));
  }

  /** Phone (<1024px): chevron · centred month · chevron, above the grid. */
  private monthNav(): HTMLElement {
    const d = this.o.doc;
    return el(d, 'div', { className: 'cal-nav' },
      this.stepButton(-1),
      el(d, 'p', { className: 'cal-nav-month' },
        ...numText(d, `${MONTH_BN[this.month]} ${bnNum(this.year)}`)),
      this.stepButton(1));
  }

  private createButton(): HTMLButtonElement {
    const d = this.o.doc;
    return button(d, {
      label: 'নতুন ঘটনা', variant: 'primary', size: 'sm',
      onClick: () => {
        this.creating = true; this.editing = null; this.notice = ''; this.render();
      },
    });
  }

  private filters(): HTMLElement {
    const d = this.o.doc;
    const wrap = d.createElement('div');
    // The existing segmented control (.seg-bar/.seg-opt), not a new one —
    // drawn as the 14 Components §03 chip row through `.cal-filter`.
    wrap.className = 'seg-bar cal-filter';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'ধরন অনুযায়ী ছাঁকুন');

    const mk = (value: string, labelBn: string): void => {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'seg-opt';
      // Selection is a filled block plus aria-pressed, never colour alone.
      b.setAttribute('data-active', String(this.kindFilter === value));
      b.setAttribute('aria-pressed', String(this.kindFilter === value));
      b.textContent = labelBn;
      b.addEventListener('click', () => {
        this.kindFilter = this.kindFilter === value ? '' : value;
        this.selectedDay = null;
        void this.load();
      });
      wrap.append(b);
    };
    mk('', 'সব');
    for (const k of ['holiday', 'working_weekend', 'exam']) mk(k, KIND_BN[k]);
    return wrap;
  }

  /**
   * The month grid. A table, not a div soup: a calendar IS tabular data, and
   * `<th scope="col">` on the weekday row is what lets a screen reader say
   * "বুধবার, ১০" instead of reading a wall of numbers.
   *
   * Seven fixed columns that share the width, Saturday first. Nothing inside
   * a cell can widen its column, so the month never scrolls sideways at 320px.
   */
  private grid(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div', { className: 'cal-scroll' });

    const table = el(d, 'table', { className: 'cal-grid' });
    table.append(el(d, 'caption', { className: 'ui-sr-only' },
      ...numText(d, `${MONTH_BN[this.month]} ${bnNum(this.year)} মাসের শিক্ষাপঞ্জি`)));

    const thead = d.createElement('thead');
    const hr = d.createElement('tr');
    for (const dow of COLUMN_DOW) {
      const th = d.createElement('th');
      th.scope = 'col';
      // The full name is the header a reader hears at both widths; the
      // one-letter form is what a phone shows, and is hidden from readers.
      th.append(
        el(d, 'span', { className: 'cal-wd-full', text: WEEKDAY_BN[dow] }),
        el(d, 'span', {
          className: 'cal-wd-short', text: WEEKDAY_SHORT_BN[dow], attrs: { 'aria-hidden': 'true' },
        }),
      );
      if (this.isWeekend(dow)) th.classList.add('cal-weekend');
      hr.append(th);
    }
    thead.append(hr);
    table.append(thead);

    const tbody = d.createElement('tbody');
    const first = new Date(Date.UTC(this.year, this.month, 1)).getUTCDay();
    const days = new Date(Date.UTC(this.year, this.month + 1, 0)).getUTCDate();
    const today = this.todayIso();

    let cell = 0;
    let tr = d.createElement('tr');
    // Blanks before the 1st, counted from Saturday: a month starting on a
    // Saturday (6) has none, one starting on a Sunday (0) has one.
    const lead = (first + 1) % 7;
    for (; cell < lead; cell++) tr.append(d.createElement('td'));

    for (let day = 1; day <= days; day++, cell++) {
      if (cell % 7 === 0 && cell > 0) { tbody.append(tr); tr = d.createElement('tr'); }
      const dayIso = iso(this.year, this.month, day);
      const dow = (first + day - 1) % 7;
      const entries = this.entriesOn(dayIso);

      const state = this.dayState(dayIso, dow);

      const td = d.createElement('td');
      td.className = 'cal-cell';
      // `data-state` carries the ONE answer — holiday, working weekend,
      // weekend or normal — rather than two classes a reader has to combine.
      // A working weekend is still a weekend column; what changes is that
      // this particular date is open, so it must not look shut.
      // CSS draws each state as a shape as well as a colour from this one
      // attribute: a grey ground for the weekend, a heavy bottom rule for a
      // holiday, a heavy top rule for a working weekend.
      td.setAttribute('data-state', state);
      if (this.isWeekend(dow)) td.classList.add('cal-weekend');
      if (state === 'holiday') td.classList.add('cal-holiday');
      if (state === 'working_weekend') td.classList.add('cal-working');
      if (dayIso === today) td.classList.add('cal-today');
      if (dayIso === this.selectedDay) td.classList.add('cal-selected');
      // The kind whose colour fills the cell on a phone. The words are in the
      // accessible name below, the key, and the day panel.
      const dk = dominantKind(entries);
      if (dk) td.setAttribute('data-kind', dk);

      const btn = d.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      // The accessible name carries what the visual marker carries, so a
      // shaded holiday is not information only a sighted user gets — and a
      // working weekend has to SAY it is open, because the column around it
      // still reads as the weekend.
      const parts = [`${bnNum(day)} ${MONTH_BN[this.month]}`];
      if (state === 'weekend') parts.push('সাপ্তাহিক ছুটি');
      if (state === 'working_weekend') parts.push('সাপ্তাহিক ছুটির দিনে খোলা');
      for (const e of entries) parts.push(`${KIND_BN[e.kind] ?? e.kind}: ${e.titleBn}`);
      btn.setAttribute('aria-label', parts.join(' · '));
      if (dayIso === this.selectedDay) btn.setAttribute('aria-current', 'date');

      btn.append(el(d, 'span', { className: 'cal-num n', text: bnNum(day) }));

      if (entries.length > 0) {
        // The desktop cell's event labels, in the kind's colour (a phone
        // hides them; its cell is filled instead). Capped at three: a fourth
        // label in a 62px cell is noise, and every entry is in the accessible
        // name and the day panel either way. aria-hidden, because the name
        // already says all of it.
        btn.append(el(d, 'span', { className: 'cal-dots', attrs: { 'aria-hidden': 'true' } },
          ...entries.slice(0, 3).map((e) => el(d, 'span', {
            className: 'cal-dot', data: { kind: e.kind },
          }, ...numText(d, this.continues(e) ? '—' : e.titleBn)))));
      }

      btn.addEventListener('click', () => {
        this.selectedDay = this.selectedDay === dayIso ? null : dayIso;
        this.render();
      });
      td.append(btn);
      tr.append(td);
    }
    while (cell % 7 !== 0) { tr.append(d.createElement('td')); cell++; }
    tbody.append(tr);
    table.append(tbody);
    wrap.append(table);
    return wrap;
  }

  /**
   * The key: a swatch and one word per kind, in the drawn order, then the
   * tenant's weekend.
   *
   * Every colour the grid can use is written out in words here, because a
   * filled cell on a phone says its kind by colour — and colour is never the
   * only carrier. The swatches carry the cells' shapes too (CSS), so the
   * holiday's bottom rule and the working weekend's top rule sit beside
   * their words. The kinds are fixed (see LEGEND_KINDS), so a person learns
   * them once rather than month by month.
   *
   * The weekend is keyed whenever the tenant has one. It is the state every
   * other mark is read against — a green "খোলা" Saturday means nothing unless
   * the Saturdays around it visibly are not — and a school with no weekend
   * has nothing to explain.
   */
  private legend(): HTMLElement {
    const d = this.o.doc;
    const present = new Set((this.data?.entries ?? []).map((e) => e.kind));
    const kinds = [
      ...LEGEND_KINDS,
      ...Object.keys(KIND_BN).filter((k) => !LEGEND_KINDS.includes(k) && present.has(k)),
    ];
    const item = (swatch: { kind?: string; state?: string }, word: string) =>
      el(d, 'li', { className: 'cal-legend-item' },
        el(d, 'span', {
          className: 'cal-legend-swatch', data: swatch, attrs: { 'aria-hidden': 'true' },
        }),
        el(d, 'span', { text: word }));
    return el(d, 'ul', { className: 'cal-legend', attrs: { 'aria-label': 'রঙের অর্থ' } },
      ...kinds.map((k) => item({ kind: k }, KIND_BN[k])),
      (this.data?.weekendDays.length ?? 0) > 0
        ? item({ state: 'weekend' }, 'সাপ্তাহিক ছুটি')
        : null);
  }

  /** What is on the selected day, or a prompt to pick one. */
  private dayPanel(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', {
      className: 'cal-day-panel', attrs: { 'aria-live': 'polite' },
    });

    if (!this.selectedDay) {
      wrap.append(el(d, 'p', {
        className: 'cal-hint', text: 'বিস্তারিত দেখতে একটি তারিখে চাপ দিন।',
      }));
      return wrap;
    }

    wrap.append(sectionHeading(d, { title: bnDate(this.selectedDay) }));

    const entries = this.entriesOn(this.selectedDay);
    if (entries.length === 0) {
      wrap.append(emptyState(d, {
        message: 'এই দিনে কোনো কিছু নির্ধারিত নেই।',
        action: this.o.canManage
          ? { label: 'এই দিনে এন্ট্রি যোগ করুন', onClick: () => {
              this.creating = true; this.editing = null; this.render();
            } }
          : undefined,
      }));
      return wrap;
    }

    for (const e of entries) wrap.append(this.entryCard(e));
    return wrap;
  }

  private entryCard(e: CalendarEntry): HTMLElement {
    const d = this.o.doc;
    const notes: string[] = [];
    if (e.kind === 'working_weekend') {
      notes.push('এই দিনটি সাপ্তাহিক ছুটি হলেও স্বাভাবিক কর্মদিবস হিসেবে গণ্য হবে — ' +
                 'হাজিরা ও নোটিশের এসএমএস যথারীতি যাবে।');
    }
    const meta: string[] = [];
    if (e.appliesToShifts?.length) {
      meta.push(`কেবল ${e.appliesToShifts.map((sh) => SHIFT_BN[sh] ?? sh).join(', ')} শিফট`);
    }
    if (!e.editable) {
      // Say WHERE it comes from, so nobody hunts for an edit button that will
      // never be here.
      meta.push('পরীক্ষার সূচি থেকে — পরিবর্তন করতে পরীক্ষার রুটিনে যান');
    } else if (e.createdByNameBn) {
      meta.push(`যোগ করেছেন ${e.createdByNameBn}`);
    }

    // Text nodes only (numText), never innerHTML: typed by a person at the
    // school and rendered in every reader's browser.
    const note = (text: string) => el(d, 'p', { className: 'ui-card-note' }, ...numText(d, text));
    const host = card(d, {
      title: e.titleBn,
      glyph: e.kind === 'exam' ? 'award' : 'calendar',
      // The kind's own colour, as in the grid and the key.
      tone: CARD_TONE[e.kind],
      headingLevel: 3,
      action: statusBadge(d, {
        state: e.kind, label: KIND_BN[e.kind] ?? e.kind, tone: KIND_TONE[e.kind] ?? 'neutral',
      }),
    },
      e.descriptionBn ? note(e.descriptionBn) : null,
      ...notes.map(note),
      meta.length ? note(meta.join(' · ')) : null,
    );

    if (this.o.canManage && e.editable) {
      append(host, buttonRow(d,
        button(d, {
          label: 'সম্পাদনা', variant: 'ghost', size: 'sm', glyph: 'edit',
          ariaLabel: `${e.titleBn} সম্পাদনা করুন`,
          disabled: this.busy,
          onClick: () => {
            this.editing = e; this.creating = false; this.notice = ''; this.render();
          },
        }),
        button(d, {
          // Destructive, so it looks destructive (14 Components §01).
          label: 'মুছে ফেলুন', variant: 'danger', size: 'sm',
          ariaLabel: `${e.titleBn} শিক্ষাপঞ্জি থেকে সরান`,
          disabled: this.busy,
          onClick: () => {
            // §7: a destructive action states its consequence in the shared
            // overlay — a bottom sheet on a phone, a dialog from 1024px.
            confirmOverlay(d, {
              title: 'শিক্ষাপঞ্জি থেকে সরানো',
              // Both of these kinds change whether messages go out that day,
              // in opposite directions. Saying only "this will be removed"
              // leaves the office to discover the effect from a parent's
              // complaint.
              body: e.kind === 'holiday'
                ? `"${e.titleBn}" (${bnDate(e.day)}) সরানো হবে। ছুটি সরালে ওই দিনের ` +
                  'হাজিরার এসএমএস আবার পাঠানো হবে।'
                : e.kind === 'working_weekend'
                  ? `"${e.titleBn}" (${bnDate(e.day)}) সরানো হবে। এরপর দিনটি আবার ` +
                    'সাপ্তাহিক ছুটি হিসেবে গণ্য হবে এবং ওই দিনের এসএমএস বন্ধ থাকবে।'
                  : `"${e.titleBn}" (${bnDate(e.day)}) শিক্ষাপঞ্জি থেকে সরানো হবে।`,
              confirmLabel: 'সরান',
              danger: true,
              onConfirm: () => this.remove(e),
            });
          },
        }),
      ));
    }
    return host;
  }

  /**
   * The next things coming, across the whole month on screen: a bordered
   * list of the day (in the kind's colour) and the title, as drawn — plus the
   * kind in words under the title, which the drawing leaves to colour alone
   * and R5 does not. The full date is in each row's name for a reader, since
   * the bare day number is what a sighted reader gets.
   */
  private upcoming(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', { className: 'cal-upcoming' },
      el(d, 'h2', { className: 'ui-sr-only', text: 'আসন্ন' }));

    const today = this.todayIso();
    const next = runsOf((this.data?.entries ?? []).filter((e) => e.day >= today))
      .slice(0, 6);

    if (next.length === 0) {
      wrap.append(emptyState(d, {
        message: (this.data?.entries.length ?? 0) > 0
          ? 'এই মাসে আর কিছু বাকি নেই।'
          : this.kindFilter
            ? 'এই ধরনের কিছু এই মাসে নির্ধারিত নেই।'
            : 'এই মাসে কোনো কিছু নির্ধারিত নেই।',
        action: this.o.canManage && !this.kindFilter
          ? { label: 'এন্ট্রি যোগ করুন', onClick: () => {
              this.creating = true; this.editing = null; this.render();
            } }
          : undefined,
      }));
      return wrap;
    }

    // The day of the month, as drawn. An exam period that began in an earlier
    // month arrives dated on its first day, so a day outside the month on
    // screen carries its month too ("২৫/৯") rather than posing as this one's.
    const dayNum = (day: string) => {
      const n = bnNum(Number(day.slice(8, 10)));
      return day.slice(0, 7) === iso(this.year, this.month, 1).slice(0, 7)
        ? n : `${n}/${bnNum(Number(day.slice(5, 7)))}`;
    };
    wrap.append(list(d, 'আসন্ন', ...next.map(({ entry: e, from, to }) => {
      const date = from === to ? dayNum(from) : `${dayNum(from)}–${dayNum(to)}`;
      const spoken = from === to ? bnDate(from) : `${bnDate(from)} থেকে ${bnDate(to)}`;
      return el(d, 'li', { className: 'ui-list-item' },
        el(d, 'button', {
          className: 'ui-list-hit',
          attrs: { type: 'button' },
          on: { click: () => { this.selectedDay = from; this.render(); } },
        },
          el(d, 'span', {
            className: numClass('cal-up-date', date), text: date,
            data: { kind: e.kind }, attrs: { 'aria-hidden': 'true' },
          }),
          el(d, 'span', { className: 'ui-list-main' },
            el(d, 'span', { className: 'ui-list-title' }, ...numText(d, e.titleBn)),
            el(d, 'span', { className: 'ui-sr-only' }, ...numText(d, ` — ${spoken}`)),
            // The word beside the coloured date: the kind is never colour alone.
            el(d, 'span', { className: 'ui-list-sub', text: KIND_BN[e.kind] ?? e.kind }))));
    })));
    return wrap;
  }

  /**
   * The create/edit form.
   *
   * Deliberately has no start/end time: nothing in this product reads one.
   * The SMS suppression asks "is this day a holiday", attendance asks the
   * same, and the grid draws a day cell. A time the office filled in that no
   * part of the system honoured would be worse than its absence, because they
   * would plan around it.
   */
  private form(): HTMLElement {
    const d = this.o.doc;
    const e = this.editing;
    const form = el(d, 'form', { className: 'ui-card ui-card-form' });

    append(form, el(d, 'h3', {
      className: 'ui-card-title', text: e ? 'এন্ট্রি সম্পাদনা' : 'নতুন এন্ট্রি',
    }));

    const kind = field(d, {
      label: 'ধরন', name: 'kind', kind: 'select', required: true,
      value: e?.kind ?? 'holiday',
      options: Object.entries(KIND_BN).map(([k, labelBn]) => ({ value: k, label: labelBn })),
    });
    const title = field(d, {
      label: 'শিরোনাম', name: 'titleBn', required: true,
      value: e?.titleBn ?? '', attrs: { maxlength: 120 },
      helper: 'ক্যালেন্ডারের ঘরে এই লেখাটিই দেখা যাবে।',
    });
    const desc = field(d, {
      label: 'বিবরণ', name: 'descriptionBn', kind: 'textarea',
      value: e?.descriptionBn ?? '', attrs: { rows: 3 },
      helper: 'ঐচ্ছিক।',
    });
    const day = field(d, {
      label: 'তারিখ', name: 'day', kind: 'date', required: true,
      value: e?.day ?? this.selectedDay ?? this.todayIso(),
    });
    append(form, kind.root, title.root, desc.root, day.root);

    // The audience this schema has. Only offered when the school actually
    // runs more than one shift — a single-shift school choosing "which
    // shift" is a question with one answer.
    const shifts = this.data?.shifts ?? [];
    let shiftBoxes: HTMLInputElement[] = [];
    if (shifts.length > 1) {
      const group = el(d, 'fieldset', { className: 'ui-fieldset' });
      append(group, el(d, 'legend', {
        className: 'ui-field-label', text: 'কোন শিফটে প্রযোজ্য (খালি রাখলে সব শিফটে)',
      }));
      shiftBoxes = shifts.map((sh) => {
        const cb = el(d, 'input', { className: 'ui-check-box' }) as HTMLInputElement;
        cb.type = 'checkbox';
        cb.value = sh;
        cb.checked = e?.appliesToShifts?.includes(sh) ?? false;
        append(group, el(d, 'label', { className: 'sms-toggle' },
          el(d, 'span', { className: 'ui-check' }, cb),
          el(d, 'span', { text: SHIFT_BN[sh] ?? sh })));
        return cb;
      });
      append(form, group);
    }

    // Notify through R-2. Never a second pipeline.
    const notify = el(d, 'input', { className: 'ui-check-box' }) as HTMLInputElement;
    notify.type = 'checkbox';
    const sms = el(d, 'input', { className: 'ui-check-box' }) as HTMLInputElement;
    sms.type = 'checkbox';
    sms.disabled = true;
    append(form,
      el(d, 'label', { className: 'sms-toggle' },
        el(d, 'span', { className: 'ui-check' }, notify),
        el(d, 'span', { text: 'সবাইকে নোটিশ পাঠান' })),
      el(d, 'label', { className: 'sms-toggle' },
        el(d, 'span', { className: 'ui-check' }, sms),
        el(d, 'span', { text: 'এসএমএসও পাঠান' })),
      el(d, 'p', {
        className: 'ui-card-note',
        text: 'নোটিশ সবার নোটিফিকেশনে যাবে। এসএমএস খরচসাপেক্ষ — ' +
              'শুধু জরুরি ঘোষণায় ব্যবহার করুন।',
      }));

    notify.addEventListener('change', () => {
      sms.disabled = !notify.checked;
      if (!notify.checked) sms.checked = false;
    });

    append(form, buttonRow(d,
      button(d, {
        label: 'বাতিল', variant: 'secondary',
        onClick: () => { this.creating = false; this.editing = null; this.render(); },
      }),
      button(d, {
        label: 'সংরক্ষণ করুন', variant: 'primary', type: 'submit', busy: this.busy,
      }),
    ));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      // Each message in its OWN field. The single error line at the top of
      // this form once said "শিরোনাম লিখুন" while the cursor sat in the date.
      clearFieldError(title.root);
      clearFieldError(day.root);
      if (!title.value().trim()) {
        setFieldError(title.root, 'শিরোনাম লিখুন।');
        title.input.focus();
        return;
      }
      if (!day.value()) {
        setFieldError(day.root, 'তারিখ দিন।');
        day.input.focus();
        return;
      }
      const chosen = shiftBoxes.filter((b) => b.checked).map((b) => b.value);
      const payload: Record<string, unknown> = {
        kind: kind.value(),
        titleBn: title.value().trim(),
        descriptionBn: desc.value().trim(),
        day: day.value(),
        appliesToShifts: chosen.length ? chosen : null,
        notify: notify.checked,
        sendSms: sms.checked,
      };
      const go = () => void this.save(payload, e?.id ?? null);

      // Notifying is the irreversible half: a notice cannot be recalled once
      // it is in nine hundred people's bells.
      if (notify.checked) {
        confirmOverlay(d, {
          title: 'নোটিশ পাঠানো নিশ্চিত করুন',
          body: `"${title.value().trim()}" সম্পর্কে প্রতিষ্ঠানের সবাইকে নোটিশ যাবে` +
                (sms.checked ? ', এবং অভিভাবকদের এসএমএসও যাবে' : '') +
                '। নোটিশ পাঠানোর পর ফিরিয়ে নেওয়া যায় না।',
          confirmLabel: 'পাঠান',
          danger: true,
          onConfirm: () => this.save(payload, e?.id ?? null),
        });
      } else {
        go();
      }
    });

    return form;
  }
}
