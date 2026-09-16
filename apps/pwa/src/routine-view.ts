/**
 * Teacher's routine: a day view (default, today) and a week view, both
 * backed by GET /api/v1/rms/routine (services/rms-svc/api/routine.ts),
 * which itself wraps db's app.teacher_day() — substitutions the teacher is
 * covering are already merged in, marked isSubstitution.
 *
 * Same offline-cache-in-localStorage approach as roster-view.ts: read-mostly
 * reference data, not durable writes, so a synchronous cache is enough.
 *
 * ── Ata Ekta (02 Teacher §03, 13 Responsive ০৬) ─────────────────────────────
 * One white panel of period rows: start time, the section on the first line
 * and the subject under it, the room on the right; a break is a single muted
 * word on an inset row; the class running now carries a 4px rule. In the week
 * a phone gets the drawn segmented day strip — today preselected — over ONE
 * day's rows, and a desk gets the whole week as a grid. Both renderings are in
 * the DOM and the 1024px media query picks one.
 *
 * The আজ / সপ্তাহ tabs stay: they are what decides which request runs, and
 * this redesign changes no request (R3).
 */
import type { Auth } from './auth.ts';
import { bnNum } from './view-states.ts';
import { HttpStatus, statusOf } from './http-status.ts';
import { formatDayMonth, formatTime, todayLocalIso } from '../../../packages/ui-core/src/format.ts';
import {
  el, append, icon, pageHeader, sectionHeading, tabs, listSkeleton, emptyState, errorState,
  permissionState, permissionMessage, humanError, announce, numText, numClass,
} from './ui/index.ts';

export interface RoutineSlot {
  slotId: string;
  periodNo: number;
  startsAt: string;
  endsAt: string;
  slotKind: string;
  subjectBn: string | null;
  sectionLabel: string | null;
  roomCode: string | null;
  isSubstitution: boolean;
  coveringForBn: string | null;
  studentCount: number | null;
  attendanceTaken: boolean;
  deliveryLogged: boolean;
}

interface DayResponse { scope: 'day'; date: string; slots: RoutineSlot[] }
interface WeekResponse { scope: 'week'; weekStart: string; days: { date: string; slots: RoutineSlot[] }[] }

const DAY_CACHE_PREFIX = 'shikhon_routine_day_';
const WEEK_CACHE_PREFIX = 'shikhon_routine_week_';


export interface RoutineViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

type Mode = 'day' | 'week';

export class RoutineView {
  private readonly o: RoutineViewOptions;
  private mode: Mode = 'day';
  private date = todayLocalIso();
  private day: DayResponse | null = null;
  private week: WeekResponse | null = null;
  private offline = false;
  private loading = false;
  /** The day tab chosen in the phone's week strip; null means "today". */
  private weekDay: string | null = null;
  /**
   * Why each mode's last fetch failed when there was nothing cached to show
   * instead: the HTTP status, or 0 for a request that never got an answer.
   * Null when nothing failed. Kept per mode, so a day request that fails after
   * the teacher has already moved to the week cannot paint the week as an
   * error. It only decides which state is drawn — error, denied — and never
   * what is requested.
   */
  private failStatus: Record<Mode, number | null> = { day: null, week: null };

  constructor(options: RoutineViewOptions) {
    this.o = options;
    void this.load();
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

  private async load(): Promise<void> {
    this.failStatus[this.mode] = null;
    this.loading = true;
    this.render();

    if (this.mode === 'day') {
      const cacheKey = DAY_CACHE_PREFIX + this.date;
      const cached = this.cacheGet<DayResponse>(cacheKey);
      if (cached) this.day = cached;
      try {
        const res = await this.o.auth.authedFetch(`/api/v1/rms/routine?scope=day&date=${this.date}`);
        if (!res.ok) throw new HttpStatus(res.status);
        this.day = (await res.json()) as DayResponse;
        this.offline = false;
        this.cacheSet(cacheKey, this.day);
      } catch (err) {
        this.offline = this.day !== null;
        if (this.day === null) this.failStatus.day = failureStatus(err);
      }
    } else {
      const cacheKey = WEEK_CACHE_PREFIX + this.date;
      const cached = this.cacheGet<WeekResponse>(cacheKey);
      if (cached) this.week = cached;
      try {
        const res = await this.o.auth.authedFetch(`/api/v1/rms/routine?scope=week&weekStart=${this.date}`);
        if (!res.ok) throw new HttpStatus(res.status);
        this.week = (await res.json()) as WeekResponse;
        this.offline = false;
        this.cacheSet(cacheKey, this.week);
      } catch (err) {
        this.offline = this.week !== null;
        if (this.week === null) this.failStatus.week = failureStatus(err);
      }
    }

    this.loading = false;
    this.render();
  }

  /** The one mode-switch path: the আজ / সপ্তাহ tabs and the empty state's button. */
  private selectMode(id: Mode): void {
    if (this.mode === id) return;
    this.mode = id;
    announce(this.o.doc, id === 'day' ? 'আজকের রুটিন' : 'সাপ্তাহিক রুটিন');
    void this.load();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    append(root, pageHeader(d, {
      title: 'রুটিন',
      subtitle: this.mode === 'day'
        ? 'আজকের ক্লাস ও সময়সূচি — বদলি ক্লাস চিহ্নিত করা আছে।'
        : 'এই সপ্তাহের সব ক্লাস, দিন অনুযায়ী।',
    }));

    // A real tab strip: roving tabindex and arrow keys, instead of two
    // buttons wearing an `.active` class.
    append(root, tabs(d, {
      label: 'রুটিনের সময়সীমা',
      className: 'routine-mode',
      active: this.mode,
      items: [{ id: 'day', label: 'আজ' }, { id: 'week', label: 'সপ্তাহ' }],
      onSelect: (id) => this.selectMode(id as Mode),
    }));

    // Offline is a statement about the data, not a failure: a cached routine
    // is exactly as useful as a fresh one for knowing where to stand at 10am.
    // The shell's own banner, in the content (as the compose screen does).
    if (this.offline) {
      append(root, el(d, 'p', { className: 'offline-banner routine-offline' },
        icon(d, 'wifi-off', 'offline-icon'),
        el(d, 'span', {
          text: 'অফলাইন — সর্বশেষ সংরক্ষিত রুটিন দেখানো হচ্ছে। সংযোগ পেলে নিজেই হালনাগাদ হবে।',
        })));
    }

    const current = this.mode === 'day' ? this.day : this.week;
    if (this.loading && !current) {
      append(root, listSkeleton(d, 5));
      return;
    }

    // Nothing cached and the request failed: say which of the two it was,
    // rather than letting a refusal or an outage read as "no classes".
    const failed = this.failStatus[this.mode];
    if (!current && failed !== null) {
      if (failed === 403) {
        append(root, permissionState(d, {
          message: permissionMessage('রুটিন'), contact: 'প্রধান শিক্ষক',
        }));
      } else {
        const why = failed > 0
          ? humanError(null, failed)
          : 'ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।';
        append(root, errorState(d, `রুটিন আনা গেল না। ${why}`, () => void this.load()));
      }
      return;
    }

    if (this.mode === 'day') {
      this.renderDay(root, this.day?.slots ?? [], this.day?.date ?? this.date, false);
      return;
    }

    const days = this.week?.days ?? [];
    if (!days.some((x) => x.slots.length > 0)) {
      append(root, emptyState(d, {
        glyph: 'calendar',
        message: 'এই সপ্তাহের কোনো রুটিন এখনো তৈরি হয়নি।',
        detail: 'রুটিন প্রকাশ হলে এখানে দেখা যাবে।',
      }));
      return;
    }
    // The grid for a desk, the day strip for a phone. See the module header.
    append(root, this.weekGrid(days));
    const stack = el(d, 'div', { className: 'routine-week-stack' }, this.weekStrip(days));
    append(root, stack);
    // Only now is the strip laid out, so only now can today's tab be scrolled to.
    const strip = stack.querySelector<HTMLElement>('.routine-days');
    if (strip) revealSelectedTab(strip);
  }

  /**
   * 13 Responsive ০৬ — the phone's week: the segmented day strip over one
   * day's rows, today preselected.
   *
   * A tap repaints only this panel. Rebuilding the whole view would replay
   * the page's entrance animation on every day a teacher looks at, and would
   * drop keyboard focus out of the strip.
   */
  private weekStrip(days: Array<{ date: string; slots: RoutineSlot[] }>): HTMLElement {
    const d = this.o.doc;
    const panel = el(d, 'div', { className: 'routine-panel' });

    const paint = (moveFocus: boolean): void => {
      const today = todayLocalIso();
      // Every day the week response holds, the same days the desk grid has as
      // columns (R9: nothing is dropped on a phone). A day with no rows is not
      // evidence of a holiday: teacher_day() returns only THIS teacher's
      // periods, so a working day they are free on looks exactly like the
      // weekly holiday, and the response does not say which days the school
      // is shut. The free day says so in its panel instead of vanishing.
      const shown = days;
      const sel = shown.find((x) => x.date === this.weekDay)
        ?? shown.find((x) => x.date === today)
        ?? shown[0];
      panel.textContent = '';

      const strip = tabs(d, {
        label: 'সপ্তাহের দিন',
        className: 'routine-days',
        active: sel.date,
        items: shown.map((x) => ({ id: x.date, label: weekdayShortBn(x.date) })),
        onSelect: (id) => {
          if (id === sel.date) return;
          this.weekDay = id;
          announce(d, `${weekdayShortBn(id)} — ${formatDayMonth(id, 'bn')}`);
          paint(true);
        },
      });
      const panelId = 'routine-day-panel';
      for (const tab of Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]'))) {
        tab.setAttribute('aria-controls', panelId);
      }
      append(panel, strip);

      const tabpanel = el(d, 'div', {
        className: 'routine-day-panel',
        attrs: { id: panelId, role: 'tabpanel', 'aria-labelledby': `tab-${sel.date}` },
      });
      // The day's heading, as the stacked week had one per day: kept for
      // heading navigation and for the date the short tab label leaves out.
      // The drawn strip already names the day, so it is not shown twice.
      append(tabpanel, sectionHeading(d, {
        title: formatDayMonth(sel.date, 'bn'), className: 'ui-sr-only',
      }));
      this.renderDay(tabpanel, sel.slots, sel.date, true);
      append(panel, tabpanel);

      revealSelectedTab(strip);
      if (moveFocus) strip.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    };

    paint(false);
    return panel;
  }

  /**
   * The week as a school draws it: periods down the side, days across the top.
   *
   * A real `<table>` with `<th scope>` on BOTH axes, which is what lets a
   * screen reader say "বুধবার, ৩য় পিরিয়ড, গণিত" instead of reading forty
   * cells in a row. Same reasoning as the calendar's month grid.
   *
   * The period rows come from the union of every day's `periodNo`, because a
   * Thursday can be short and a grid built from one day's periods would drop
   * the rest of the week's last class.
   */
  private weekGrid(days: Array<{ date: string; slots: RoutineSlot[] }>): HTMLElement {
    const d = this.o.doc;
    const periods = [...new Set(days.flatMap((day) => day.slots.map((sl) => sl.periodNo)))]
      .sort((a, b) => a - b);

    // The time a period starts is the same all week, so it labels the row.
    const startOf = new Map<number, string>();
    for (const day of days) {
      for (const sl of day.slots) {
        if (!startOf.has(sl.periodNo)) startOf.set(sl.periodNo, sl.startsAt.slice(0, 5));
      }
    }

    const scroll = el(d, 'div', { className: 'table-scroll routine-week-scroll' });
    const table = el(d, 'table', { className: 'data-table routine-grid' });
    append(table, el(d, 'caption', {
      className: 'ui-sr-only', text: 'এই সপ্তাহের রুটিন — সারি পিরিয়ড, কলাম দিন',
    }));

    const thead = el(d, 'thead');
    const hrow = el(d, 'tr');
    append(hrow, el(d, 'th', { text: 'পিরিয়ড', attrs: { scope: 'col' } }));
    for (const day of days) {
      const date = formatDayMonth(day.date, 'bn');
      // The weekday heads the column as drawn; the date stays under it.
      append(hrow, el(d, 'th', { attrs: { scope: 'col' } },
        el(d, 'span', { className: 'routine-grid-day', text: weekdayShortBn(day.date) }),
        el(d, 'span', { className: 'routine-grid-date' }, ...numText(d, date))));
    }
    append(thead, hrow);
    append(table, thead);

    const tbody = el(d, 'tbody');
    for (const periodNo of periods) {
      const tr = el(d, 'tr');
      const start = startOf.get(periodNo);
      const no = bnNum(periodNo);
      const time = start ? formatTime(start, 'bn') : '';
      append(tr, el(d, 'th', { className: 'routine-grid-period', attrs: { scope: 'row' } },
        el(d, 'span', { className: numClass('routine-grid-no', no), text: no }),
        start
          ? el(d, 'span', { className: numClass('routine-grid-time', time), text: time })
          : null));

      for (const day of days) {
        const sl = day.slots.find((x) => x.periodNo === periodNo);
        const td = el(d, 'td', {
          className: 'routine-grid-cell',
          data: {
            kind: sl?.slotKind,
            substitution: sl?.isSubstitution ? 'true' : undefined,
          },
        });
        if (!sl) {
          // An empty cell is a free period, and saying so beats a blank a
          // reader has to interpret.
          append(td, el(d, 'span', { className: 'ui-sr-only', text: 'ক্লাস নেই' }));
        } else if (sl.slotKind !== 'teaching') {
          append(td, el(d, 'span', { className: 'routine-grid-kind' },
            ...numText(d, slotKindBn(sl.slotKind))));
        } else {
          append(td,
            el(d, 'span', { className: 'routine-grid-subject' }, ...numText(d, sl.subjectBn ?? '—')),
            sl.sectionLabel
              ? el(d, 'span', { className: 'routine-grid-meta' }, ...numText(d, sl.sectionLabel))
              : null,
            // The substitution mark carries the same word it does in the day
            // list, not a colour: a teacher reading the grid must not have to
            // learn a second vocabulary.
            sl.isSubstitution
              ? el(d, 'span', { className: 'routine-grid-sub', text: 'বদলি' })
              : null);
        }
        append(tr, td);
      }
      append(tbody, tr);
    }
    append(table, tbody);
    append(scroll, table);
    return scroll;
  }

  /**
   * One day's periods, as rows in the white panel (02 Teacher §03).
   *
   * `inPanel` is true inside the week strip, which is already the panel and
   * offers no way onward; in the day view the rows get their own panel, and
   * an empty day offers the week.
   */
  private renderDay(host: HTMLElement, slots: RoutineSlot[], date: string, inPanel: boolean): void {
    const d = this.o.doc;
    if (slots.length === 0) {
      append(host, emptyState(d, {
        glyph: 'clock',
        message: 'এই দিনে আপনার কোনো ক্লাস নেই।',
        action: inPanel
          ? undefined
          : { label: 'সপ্তাহের রুটিন দেখুন', onClick: () => this.selectMode('week') },
      }));
      return;
    }

    // The class running now, by the device clock, on today only. Worked out
    // once per render: the screen marks where to stand when it is opened.
    const clock = new Date();
    const nowHhmm = `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`;
    const isToday = date === todayLocalIso();

    const ul = el(d, 'ul', {
      className: 'routine-list', attrs: { 'aria-label': 'ক্লাসের তালিকা' },
    });
    for (const s of slots) {
      const teaching = s.slotKind === 'teaching';
      const isNow = isToday && teaching
        && s.startsAt.slice(0, 5) <= nowHhmm && nowHhmm < s.endsAt.slice(0, 5);
      const li = el(d, 'li', {
        className: 'routine-row',
        data: {
          kind: s.slotKind,
          substitution: s.isSubstitution ? 'true' : undefined,
          now: isNow ? 'true' : undefined,
        },
      });

      const time = formatTime(s.startsAt.slice(0, 5), 'bn');
      append(li, el(d, 'span', { className: numClass('routine-time', time), text: time }));

      const body = el(d, 'span', { className: 'routine-body' });
      if (teaching) {
        // The rule on the row is not the only sign: a screen reader hears it.
        if (isNow) append(body, el(d, 'span', { className: 'ui-sr-only', text: 'এখন চলছে — ' }));
        // Drawn order: the section first, the subject under it.
        const title = s.sectionLabel ?? s.subjectBn ?? '—';
        const sub = s.sectionLabel ? s.subjectBn : null;
        append(body, el(d, 'span', { className: 'routine-class' }, ...numText(d, title)));
        if (sub) append(body, el(d, 'span', { className: 'routine-subject' }, ...numText(d, sub)));
      } else {
        // A break is one muted word. A name the slot carries stays beside it.
        const kind = slotKindBn(s.slotKind);
        const label = s.subjectBn && s.subjectBn !== kind ? `${kind} · ${s.subjectBn}` : kind;
        append(body, el(d, 'span', { className: 'routine-kind' }, ...numText(d, label)));
      }
      if (s.isSubstitution) {
        // §"If a substitution exists, clearly explain why and what changed."
        // The old tag said "পরিবর্তী ক্লাস" — which names the fact and
        // answers none of the question a teacher standing in an unfamiliar
        // corridor is actually asking.
        append(body, el(d, 'span', { className: 'routine-sub-note' },
          icon(d, 'repeat', 'routine-sub-glyph'),
          el(d, 'span', {
            text: s.coveringForBn
              ? `${s.coveringForBn}-এর বদলি হিসেবে আপনি এই ক্লাসটি নিচ্ছেন।`
              : 'এটি আপনার নিজের ক্লাস নয় — বদলি হিসেবে নিচ্ছেন।',
          })));
      }
      append(li, body);

      // The room code is printed as the school wrote it on the door: an
      // identifier, like a roll, not a count.
      if (s.roomCode) {
        append(li, el(d, 'span', { className: 'routine-room' }, ...numText(d, `কক্ষ ${s.roomCode}`)));
      }

      append(ul, li);
    }
    append(host, inPanel ? ul : el(d, 'div', { className: 'routine-panel' }, ul));
  }
}

/**
 * Slot kinds, in Bangla.
 *
 * The old renderer printed `s.slotKind` straight into the subject line when
 * there was no subject — so a break rendered as the literal string "break" on
 * a Bangla screen.
 */
function slotKindBn(kind: string): string {
  switch (kind) {
    case 'break':     return 'বিরতি';
    case 'assembly':  return 'সমাবেশ';
    case 'prayer':    return 'নামাজ';
    case 'lunch':     return 'দুপুরের বিরতি';
    case 'free':      return 'ফাঁকা সময়';
    case 'teaching':  return 'ক্লাস';
    default:          return kind;
  }
}

/** Sunday-first, matching `Date#getDay` (0 = Sun), as calendar-view.ts keeps it. */
const WEEKDAY_SHORT_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];

/**
 * "2026-09-17" → "বৃহঃ". The local Date constructor, never an ISO parse: a
 * date-only ISO string is read as UTC midnight, which is a different weekday
 * for six hours of every Bangladesh morning (calendar-dates.test.ts).
 */
function weekdayShortBn(iso: string): string {
  const [y, m, day] = iso.split('-').map(Number);
  if (!y || !m || !day) return iso;
  return WEEKDAY_SHORT_BN[new Date(y, m - 1, day).getDay()];
}

/**
 * Seven day tabs at the 44px touch floor are wider than a 320px phone's panel,
 * so the strip scrolls sideways (.ui-tabs). This keeps the selected day — today,
 * on arrival — whole inside the strip rather than cut off at its edge. It moves
 * the strip's own horizontal scroll only, never the page. Detached or hidden
 * (the desk, where the stack is display:none), every rect is zero and it does
 * nothing.
 */
function revealSelectedTab(strip: HTMLElement): void {
  const tab = strip.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!tab) return;
  const s = strip.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  if (t.right > s.right) strip.scrollLeft += t.right - s.right;
  else if (t.left < s.left) strip.scrollLeft -= s.left - t.left;
}

/** The status behind a failed load: HTTP status, 401 for no session, 0 for no answer. */
function failureStatus(err: unknown): number {
  const status = statusOf(err);
  if (status !== undefined) return status;
  if ((err as { code?: unknown } | null)?.code === 'not_authenticated') return 401;
  return 0;
}
