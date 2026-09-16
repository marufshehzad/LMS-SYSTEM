/**
 * My attendance — F-806
 *
 * "Own attendance record by month and subject, with a visible distinction
 * between excused and unexcused."
 *
 * That distinction is the screen. A child with eight excused absences for a
 * documented illness and a child with eight unexcused ones are in
 * completely different situations, and a single percentage tells a guardian
 * nothing about which. So excused is never folded into the headline figure
 * and never rendered in the same colour as an unexcused absence — it gets
 * its own word, its own tone (--info, never --danger) and its own count.
 *
 * ── Ata Ekta: 03 Student §04 ──────────────────────────────────────────────
 * The design draws four things, top to bottom: a three-cell stat strip for
 * the month (rate, absent, late), the month as an eyebrow, a seven-column
 * calendar with one square per day coloured by its status, and a legend in
 * words. That block comes first. The month history, the per-subject counts
 * and the dated register follow it as tables — not drawn, but they are
 * F-806's data, and nothing is dropped (IMPLEMENTATION §6).
 *
 * ── What the calendar can and cannot say ──────────────────────────────────
 * The API sends the exceptions (`recent`: every non-present record, newest
 * first, capped at 60) and per-month COUNTS — no list of present days and no
 * school calendar. So a day is coloured only when a record says what happened
 * on it. A past day with no record is drawn neutral, not green: it may be a
 * present day, a Friday or a holiday, and a green square would state a
 * presence nobody recorded.
 */
import type { Auth } from './auth.ts';
import { formatCount, todayLocalIso } from '../../../packages/ui-core/src/format.ts';
import { pageHeader } from './ui/page-header.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import {
  permissionState, deniedMessage, deniedContact, sectionHeading, dataTable,
  statusBadge, statCard, statRow, emptyState, errorState, el, icon, uid, numText,
  type BadgeTone, type Column,
} from './ui/index.ts';

const bn = (n: number): string => formatCount(n, 'bn');

interface MonthRow {
  month: string; present: number; late: number; absent: number;
  excused: number; halfDay: number;
}
interface SubjectRow {
  subjectBn: string | null; present: number; late: number;
  absent: number; excused: number;
}
interface RecentRow {
  takenOn: string; status: string; minutesLate: number | null;
  remark: string | null; subjectBn: string | null;
}
interface Payload {
  totals: {
    present: number; late: number; absent: number; excused: number;
    halfDay: number; counted: number; attendedPercent: number | null;
  };
  byMonth: MonthRow[];
  bySubject: SubjectRow[];
  recent: RecentRow[];
}

const CACHE_KEY = 'shikhon_my_attendance';

/**
 * Every state has a word — the legend's word — and the tone IMPLEMENTATION §3
 * gives it: উপস্থিত --ok, দেরি --warn, অনুপস্থিত --danger, ছুটি --info.
 * Colour is never the only carrier (F-812): the register's badge says the
 * word, and a calendar square says it to a screen reader.
 */
const STATUS: Record<string, { bn: string; tone: BadgeTone }> = {
  present:  { bn: 'উপস্থিত',   tone: 'success' },
  late:     { bn: 'দেরি',      tone: 'warn' },
  absent:   { bn: 'অনুপস্থিত', tone: 'danger' },
  excused:  { bn: 'ছুটি',      tone: 'info' },
  half_day: { bn: 'অর্ধদিবস',  tone: 'warn' },
};

/**
 * Where attendance is taken per subject, one day holds several records. The
 * square shows the one that matters most: an absence outranks a late arrival,
 * and anything outranks approved leave.
 */
const DAY_RANK: Record<string, number> = { absent: 4, late: 3, half_day: 2, excused: 1 };

/** The drawn legend, in the drawn order. */
const LEGEND = ['present', 'absent', 'late', 'excused'] as const;

/**
 * The attendance rate of one month — the API's own formula: present and late
 * were in the room, a half day is half, and excused is out of the denominator
 * rather than counted as a miss.
 */
function rate(m: MonthRow): number | null {
  const counted = m.present + m.late + m.absent + m.halfDay;
  return counted > 0
    ? Math.round(((m.present + m.late + m.halfDay * 0.5) / counted) * 100)
    : null;
}

const MONTH_BN = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন',
                  'জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_BN[Number(m) - 1] ?? ym} ${formatCount(Number(y), 'bn')}`;
}

export interface MyAttendanceViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

export class MyAttendanceView {
  private readonly o: MyAttendanceViewOptions;
  private data: Payload | null = null;
  private loading = true;
  private offline = false;
  private error = false;
  private denied = false;
  /** B-84. The refusal itself, so the screen can say which kind it was. */
  private deniedErr: unknown = null;

  constructor(options: MyAttendanceViewOptions) {
    this.o = options;
    this.data = this.readCache();
    this.loading = this.data === null;
    this.render();
    void this.load();
  }

  private readCache(): Payload | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as Payload) : null;
    } catch { return null; }
  }

  private async load(): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/attendance');
      await refuseUnlessOk(res);
      this.data = (await res.json()) as Payload;
      this.offline = false; this.error = false;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(this.data)); } catch { /* quota */ }
    } catch (err) {
      if (isDenied(err)) {
        this.denied = true;
        this.deniedErr = err; this.data = null; this.offline = false;
        try { localStorage.removeItem(CACHE_KEY); } catch { /* private mode */ }
        return;
      }
      if (this.data) this.offline = true; else this.error = true;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', 'bn');

    const header = pageHeader(d, {
      title: 'আমার হাজিরা',
      subtitle: 'মাস ও বিষয় অনুযায়ী নিজের উপস্থিতির হিসাব',
    });
    root.append(header);

    if (this.offline) {
      // The sheet's offline banner (--warn-tint, §7), in the content column:
      // the figures under it are real but may be stale. This screen only
      // reads, so nothing is queued and there is no waiting count to show.
      root.append(el(d, 'p', {
        className: 'offline-banner myatt-offline', attrs: { role: 'status' },
      }, icon(d, 'wifi-off', 'offline-icon'),
         el(d, 'span', { text: 'অফলাইন — সংরক্ষিত হিসাব দেখানো হচ্ছে' })));
    }

    // B-30. A refusal outranks the offline banner, the skeleton and the
    // empty state: nothing is loading, there is nothing to show, and
    // calling it "offline" is the lie this item exists to remove.
    if (this.denied) {
      root.append(permissionState(d, {
        message: deniedMessage(this.deniedErr, 'আমার হাজিরা'),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }

    if (this.loading && !this.data) { this.skeleton(root); return; }
    if (this.error && !this.data)   { this.showError(root); return; }
    if (!this.data || this.data.totals.counted === 0) { this.empty(root); return; }

    root.append(this.current(this.data));
    if (this.data.byMonth.length) root.append(this.months(this.data.byMonth));
    if (this.data.bySubject.length) root.append(this.subjects(this.data.bySubject));
    if (this.data.recent.length) root.append(this.register(this.data.recent));
  }

  /**
   * The drawn block: stat strip, month eyebrow, day calendar, legend.
   *
   * The month is this month when it has records. Early in a month, or over a
   * holiday, it has none, and a strip of dashes would hide last month's real
   * figures — so the latest month with records stands in, and the strip's
   * label names it instead of saying "এ মাসে".
   */
  private current(p: Payload): HTMLElement {
    const d = this.o.doc;
    const today = todayLocalIso();
    const nowYm = today.slice(0, 7);
    const row = p.byMonth.find((m) => m.month === nowYm) ?? p.byMonth[0] ?? null;
    const ym = row?.month ?? nowYm;

    // With no month rows at all the only figures are the totals, so the strip
    // says so rather than pinning them to a month they were not counted in.
    const label = !row ? 'মোট'
      : ym === nowYm ? 'এ মাসে'
      : MONTH_BN[Number(ym.slice(5, 7)) - 1] ?? ym;
    const pct = row ? rate(row) : p.totals.attendedPercent;
    const absent = row ? row.absent : p.totals.absent;
    const late = row ? row.late : p.totals.late;

    // Tones carry meaning only, with the label beside them. The rate turns
    // --danger below 75%, where a school starts intervening; a zero absence
    // or late count stays ink, because a red "০" reads as an alarm.
    const stats = statRow(d,
      statCard(d, {
        label,
        value: pct === null ? '—' : `${bn(pct)}%`,
        tone: pct === null ? undefined : pct >= 75 ? 'success' : 'danger',
      }),
      statCard(d, { label: 'অনুপস্থিত', value: bn(absent), tone: absent > 0 ? 'danger' : undefined }),
      statCard(d, { label: 'দেরি', value: bn(late), tone: late > 0 ? 'warn' : undefined }));
    stats.classList.add('myatt-stats');

    const hid = uid('myatt-month');
    const heading = el(d, 'h2', { className: 'label myatt-month', attrs: { id: hid } },
      ...numText(d, monthLabel(ym)));

    // The worst record of each day, for this month only.
    const byDay = new Map<number, string>();
    for (const r of p.recent) {
      if (!r.takenOn.startsWith(`${ym}-`)) continue;
      const rank = DAY_RANK[r.status];
      if (!rank) continue;
      const day = Number(r.takenOn.slice(8, 10));
      const prev = byDay.get(day);
      if (!prev || rank > DAY_RANK[prev]) byDay.set(day, r.status);
    }

    // Day ১ in the first column, no weekday row — as drawn. An ordered list,
    // named by the month above it, so a reader hears "সেপ্টেম্বর ২০২৬, list,
    // ৩০ items" and then each day with its status word.
    const [y, mo] = ym.split('-').map(Number);
    const last = new Date(y, mo, 0).getDate();
    const days = Number.isFinite(last) ? last : 0;
    const cal = el(d, 'ol', { className: 'myatt-cal', attrs: { 'aria-labelledby': hid } });
    for (let n = 1; n <= days; n++) {
      const iso = `${ym}-${String(n).padStart(2, '0')}`;
      const status = byDay.get(n) ?? (iso > today ? 'future' : 'none');
      const word = STATUS[status]?.bn;
      cal.append(el(d, 'li', {
        className: 'myatt-day n',
        data: { status },
        attrs: { 'aria-current': iso === today ? 'date' : null },
      }, bn(n), word ? el(d, 'span', { className: 'ui-sr-only', text: ` — ${word}` }) : null));
    }

    const key = el(d, 'ul', { className: 'myatt-key', attrs: { 'aria-label': 'রঙের অর্থ' } });
    for (const k of LEGEND) {
      key.append(el(d, 'li', { className: 'myatt-key-item' },
        el(d, 'span', { className: 'myatt-swatch', data: { status: k }, attrs: { 'aria-hidden': 'true' } }),
        STATUS[k].bn));
    }

    // Not drawn. Said in words, because "excused does not count against you"
    // is the question a guardian actually opened this screen to answer.
    const note = p.totals.excused > 0
      ? el(d, 'p', { className: 'myatt-note', text: 'অনুমোদিত ছুটি উপস্থিতির হারে গণনা করা হয়নি।' })
      : null;

    return el(d, 'section', { className: 'myatt-now', attrs: { 'aria-labelledby': hid } },
      stats, heading, cal, key, note);
  }

  /**
   * A count with its word, for a table that is a list on a phone.
   *
   * On a phone the columns become one meta line, where the header is only a
   * screen-reader prefix — so the word is drawn beside the figure there
   * ("অনুপস্থিত ২ · দেরি ১"). On a desktop the column header says it, and the
   * sheet rule `.ui-table .myatt-word` hides the repeat. aria-hidden: the
   * hidden header prefix already names the figure for a reader.
   */
  private count(word: string, n: number): HTMLElement {
    const d = this.o.doc;
    return el(d, 'span', {},
      el(d, 'span', { className: 'myatt-word', text: `${word} `, attrs: { 'aria-hidden': 'true' } }),
      el(d, 'span', { className: 'n', text: bn(n) }));
  }

  private months(rows: MonthRow[]): HTMLElement {
    const d = this.o.doc;
    const columns: Array<Column<MonthRow>> = [
      { key: 'month', header: 'মাস', mobile: 'title', width: 'minmax(0, 1.6fr)',
        cell: (m) => monthLabel(m.month) },
      // Below 75% is where a school starts intervening; the figure is stated
      // either way, so the rate needs no colour to be read.
      { key: 'rate', header: 'হার', mobile: 'status', numeric: true, width: '88px',
        cell: (m) => { const r = rate(m); return r === null ? '—' : `${bn(r)}%`; } },
      { key: 'absent', header: 'অনুপস্থিত', mobile: 'meta', numeric: true, width: '104px',
        cell: (m) => this.count('অনুপস্থিত', m.absent) },
      { key: 'late', header: 'দেরি', mobile: 'meta', numeric: true, width: '88px',
        cell: (m) => this.count('দেরি', m.late) },
      { key: 'excused', header: 'ছুটি', mobile: 'meta', numeric: true, width: '88px',
        cell: (m) => this.count('ছুটি', m.excused) },
    ];
    // A half day is rare; a column of zeros for it would be noise.
    if (rows.some((m) => m.halfDay > 0)) {
      columns.push({ key: 'half_day', header: 'অর্ধদিবস', mobile: 'meta', numeric: true, width: '96px',
        cell: (m) => this.count('অর্ধদিবস', m.halfDay) });
    }
    return el(d, 'section', { className: 'myatt-section' },
      sectionHeading(d, { title: 'মাস অনুযায়ী' }),
      dataTable(d, {
        caption: 'মাস অনুযায়ী হাজিরার হার',
        rows,
        rowKey: (m) => m.month,
        columns,
      }));
  }

  private subjects(rows: SubjectRow[]): HTMLElement {
    const d = this.o.doc;
    return el(d, 'section', { className: 'myatt-section' },
      sectionHeading(d, { title: 'বিষয় অনুযায়ী' }),
      dataTable(d, {
        caption: 'বিষয় অনুযায়ী হাজিরা',
        rows,
        rowKey: (s) => s.subjectBn ?? '—',
        columns: [
          { key: 'subject', header: 'বিষয়', mobile: 'title', width: 'minmax(0, 1.6fr)',
            cell: (s) => s.subjectBn ?? '—' },
          { key: 'present', header: 'উপস্থিত', mobile: 'meta', numeric: true, width: '96px',
            cell: (s) => this.count('উপস্থিত', s.present) },
          { key: 'late', header: 'দেরি', mobile: 'meta', numeric: true, width: '88px',
            cell: (s) => this.count('দেরি', s.late) },
          { key: 'absent', header: 'অনুপস্থিত', mobile: 'meta', numeric: true, width: '104px',
            cell: (s) => this.count('অনুপস্থিত', s.absent) },
          { key: 'excused', header: 'ছুটি', mobile: 'meta', numeric: true, width: '88px',
            cell: (s) => this.count('ছুটি', s.excused) },
        ],
      }));
  }

  /** The dates themselves. A guardian wants "which days", not a percentage. */
  private register(rows: RecentRow[]): HTMLElement {
    const d = this.o.doc;
    // A table. "Which days, and was it late or excused" is four facts per
    // row, and this rendered as `.att-entry` strips 1110px wide — so a
    // guardian comparing seven dates read one date per full screen width.
    return el(d, 'section', { className: 'myatt-section' },
      sectionHeading(d, { title: 'অনুপস্থিতির তালিকা' }),
      dataTable(d, {
        caption: 'দিন অনুযায়ী হাজিরার রেকর্ড',
        rows,
        rowKey: (r) => `${r.takenOn}-${r.subjectBn ?? ''}`,
        columns: [
          { key: 'day', header: 'তারিখ', mobile: 'title', width: 'minmax(0, 1.6fr)',
            cell: (r) => new Date(r.takenOn).toLocaleDateString('bn-BD', {
              day: 'numeric', month: 'short', weekday: 'short',
            }) },
          // The legend's word on the legend's tone: a guardian who cannot see
          // colour still tells late from absent, and leave from both.
          { key: 'state', header: 'অবস্থা', mobile: 'status', width: '150px',
            cell: (r) => {
              const meta = STATUS[r.status] ?? { bn: r.status, tone: 'neutral' as BadgeTone };
              return statusBadge(d, { state: r.status, label: meta.bn, tone: meta.tone });
            } },
          { key: 'late', header: 'দেরি', mobile: 'meta', numeric: true, width: '120px',
            cell: (r) => (r.status === 'late' && r.minutesLate
              ? `${bn(r.minutesLate)} মিনিট` : '—') },
          { key: 'subject', header: 'বিষয়', mobile: 'subtitle', width: 'minmax(0, 1.4fr)',
            cell: (r) => r.subjectBn || '—' },
        ],
      }));
  }

  /** The shape of what is coming — strip, month, day squares — never a spinner. */
  private skeleton(root: HTMLElement): void {
    const d = this.o.doc;
    const cell = (): HTMLElement => el(d, 'div', { className: 'ui-stat' },
      el(d, 'div', { className: 'ui-stat-text' },
        el(d, 'span', { className: 'skel skel-bar is-short' }),
        el(d, 'span', { className: 'skel myatt-skel-value' })));
    const strip = el(d, 'div', { className: 'ui-stat-row myatt-stats', data: { count: 3 } },
      cell(), cell(), cell());
    const grid = el(d, 'div', { className: 'myatt-cal', attrs: { 'aria-hidden': 'true' } });
    for (let i = 0; i < 30; i++) grid.append(el(d, 'span', { className: 'skel myatt-skel-day' }));
    root.append(el(d, 'div', {
      className: 'is-skeleton myatt-now myatt-skeleton',
      attrs: { 'aria-busy': 'true', 'aria-label': 'লোড হচ্ছে' },
    }, strip, el(d, 'span', { className: 'skel skel-bar is-short myatt-month' }), grid));
  }

  /** A student cannot cause attendance to be taken, so this names who does. */
  private empty(root: HTMLElement): void {
    root.append(emptyState(this.o.doc, {
      glyph: 'calendar',
      message: 'এখনো কোনো হাজিরা নেওয়া হয়নি। শিক্ষক ক্লাসে হাজিরা নিলে এখানে দিন অনুযায়ী দেখা যাবে।',
    }));
  }

  private showError(root: HTMLElement): void {
    root.append(errorState(this.o.doc,
      'হাজিরার হিসাব আনা গেল না। ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।',
      () => { this.loading = true; this.error = false; this.render(); void this.load(); }));
  }
}
