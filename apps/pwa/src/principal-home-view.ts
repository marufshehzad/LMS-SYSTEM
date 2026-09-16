/**
 * আজকের অবস্থা — the principal's home.  (P5 · Ata Ekta 05 Principal §01)
 *
 * What a head teacher opens at 8am, standing in a corridor with a phone, and
 * what the same person reads at 10am on a desktop in the office. One DOM; the
 * 1024px breakpoint decides how it lies out.
 *
 * ── Top to bottom, as 05 Principal §01 draws it ────────────────────────────
 *   1. The page header: "আজকের অবস্থা", today's date, and the page's one
 *      primary, "নোটিশ পাঠান".
 *   2. The stat strip, in a white band: শিক্ষার্থী · আজ উপস্থিত · আজ অনুপস্থিত
 *      · বকেয়া. Each figure is coloured by what it means, never for show.
 *   3. Two panels on a 1px line: "এখনই দেখা দরকার" — the page's main job, one
 *      sentence per open item, because the sentence is the decision — and
 *      today's absentees.
 *   4. Below, in the same panel language: exams, recent notices, the fee
 *      position. The design does not draw them; they stay because they are
 *      how a principal reaches publish, inbox and fees from home.
 *
 * An empty queue is one calm sentence, not four zeroes: "everything is
 * assigned" is information, four ০s is noise.
 *
 * ── What is deliberately NOT here ──────────────────────────────────────────
 * No charts. 04-UIUX prohibits client-side charting on the device floor, and
 * the brief says not to invent analytics to fill space. Nothing on this screen
 * is a trend: every figure is either today's, or a queue with this person's
 * name on it.
 *
 * Not the design's staff-absence figure, nor its per-class attendance bars:
 * `/api/v1/ops/dashboard` carries neither, and a screen that drew them would
 * be drawing numbers it does not have.
 *
 * No platform or subscription information of any kind. School tuition is not
 * ShikhonBD's own commercial relationship with the school, D16 puts that in
 * the Platform Console, and P5 must not blur the two.
 *
 * ── Two content decisions carried over from R-3, because they were right ───
 * **"Nobody has taken attendance yet" is not 0%.** The API returns
 * `percent: null` until a session is marked, and a dashboard that renders that
 * as 0% at 8:05 puts a head teacher on the phone to a class teacher who has
 * done nothing wrong.
 *
 * For the same reason the register count is a neutral NOTE under the figure
 * ("২২ / ২৬ সেকশন"), never a row in "এখনই দেখা দরকার" and never part of its
 * all-clear. `sessionsTaken` counts every session taken today — one per
 * period in a period-wise school — and `sectionsExpected` is every section in
 * the year with no school-day check, so their difference is not a number of
 * sections: it would shout "২৬টি সেকশন" all Friday, and fall silent in a
 * period-wise school while most registers are still open.
 *
 * **The fee figures are absent, not hidden.** `finance` is null in the
 * response for a role that may not see money — there is no CSS here doing the
 * hiding, because a hidden card with the numbers still in the response body
 * is the frontend-filtering pattern D13 rules out.
 */
import type { Auth } from './auth.ts';
import {
  el, append, statCard, statRow, button, pageHeader, sectionHeading,
  statusBadge, list, listItem, emptyState, errorState, numText,
  permissionState, permissionMessage, humanError, dataTable,
} from './ui/index.ts';
import type { CardTone } from './ui/index.ts';
import { refuseUnlessOk, isDenied, statusOf } from './http-status.ts';
import {
  formatCount, formatBdt, formatIdentifier, formatDayMonth, todayLocalIso, toBanglaDigits,
} from '../../../packages/ui-core/src/format.ts';

const bn = (n: number): string => formatCount(n, 'bn');

export interface DashboardPayload {
  year: { id: string; label: string } | null;
  needsSetup: boolean;
  counts?: { students: number; teachers: number; sections: number; classes: number };
  attendanceToday?: {
    present: number; marked: number; percent: number | null;
    sessionsTaken: number; sectionsExpected: number;
  };
  absentToday?: {
    total: number;
    shown: Array<{
      studentId: string; nameBn: string; rollNo: number;
      section: string | null; classBn: string | null;
    }>;
  };
  upcomingExams?: Array<{ id: string; nameBn: string; startsOn: string; status: string }>;
  recentNotices?: Array<{
    id: string; title: string; category: string;
    publishedAt: string; recipientCount: number;
  }>;
  pending?: {
    sectionsWithoutClassTeacher: number;
    subjectsWithoutTeacher: number;
    examsAwaitingPublication: number;
    studentsWithoutSection: number;
  };
  /**
   * Money as STRINGS, all the way from `numeric(12,2)`. The endpoint sums the
   * outstanding total in PostgreSQL rather than subtracting in JS on purpose —
   * a school's fee balance must not round-trip through a float — and the field
   * names here are the endpoint's, checked against it. The first draft of this
   * screen invented `collectedThisMonth` and `invoicesDue`, and rendered
   * "undefinedটি ইনভয়েস বাকি" on the principal's dashboard.
   */
  finance?: {
    invoiced: string; collected: string; outstanding: string; unpaidCount: number;
  } | null;
}

export interface PrincipalHomeOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Still passed by app.ts; the design's header carries no greeting. */
  displayName?: string;
  go: (path: string) => void;
  now?: () => Date;
}

export class PrincipalHomeView {
  private readonly o: PrincipalHomeOptions;
  private data: DashboardPayload | null = null;
  private loading = true;
  private denied = false;
  private errText = '';

  constructor(options: PrincipalHomeOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private now(): Date { return this.o.now ? this.o.now() : new Date(); }

  private async load(): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/dashboard');
      await refuseUnlessOk(res);
      this.data = (await res.json()) as DashboardPayload;
      this.denied = false;
      this.errText = '';
    } catch (err) {
      if (isDenied(err)) { this.denied = true; this.data = null; }
      else this.errText = humanError(navigator.onLine ? null : 'offline', statusOf(err));
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', 'bn');

    // "১৫ সেপ্টেম্বর ২০২৬" — day, month, year; no weekday, no greeting.
    const iso = todayLocalIso(this.now());
    append(root, pageHeader(d, {
      title: 'আজকের অবস্থা',
      actions: [el(d, 'time', {
        className: 'ph-date n',
        attrs: { datetime: iso },
        text: `${formatDayMonth(iso, 'bn')} ${toBanglaDigits(iso.slice(0, 4))}`,
      })],
      // The page's one accent. Not offered to someone the server has just
      // refused: a door beside a "you may not" is a contradiction.
      primary: this.denied ? undefined : button(d, {
        label: 'নোটিশ পাঠান', variant: 'primary', size: 'sm',
        onClick: () => this.o.go('compose'),
      }),
    }));

    if (this.denied) {
      append(root, permissionState(d, {
        message: permissionMessage('প্রতিষ্ঠানের সারসংক্ষেপ'),
        contact: 'আইটি অ্যাডমিন',
      }));
      return;
    }
    if (this.loading && !this.data) { append(root, this.skeleton()); return; }
    if (this.errText && !this.data) {
      append(root, errorState(d, this.errText, () => {
        this.errText = ''; this.loading = true; this.render(); void this.load();
      }));
      return;
    }
    if (!this.data) return;

    // A school with no academic year cannot be summarised, and saying "০ জন
    // শিক্ষার্থী" would be a true number that reads as a broken screen.
    if (this.data.needsSetup) {
      append(root, emptyState(d, {
        message: 'এই বছরের শিক্ষাবর্ষ এখনো তৈরি হয়নি — সেটি না থাকলে শ্রেণি, '
          + 'সেকশন বা ভর্তি কিছুই শুরু করা যায় না।',
        action: { label: 'একাডেমিক কাঠামো', onClick: () => this.o.go('academic') },
      }));
      return;
    }

    append(root,
      el(d, 'div', { className: 'ph-board' },
        el(d, 'div', { className: 'ph-band' }, this.strip()),
        el(d, 'div', { className: 'ph-grid' }, this.attention(), this.absentees())),
      el(d, 'div', { className: 'ph-board ph-more' },
        el(d, 'div', { className: 'ph-grid' }, ...this.secondary())));
  }

  /** The page's own shape, in shimmer, while the dashboard is on its way. */
  private skeleton(): HTMLElement {
    const d = this.o.doc;
    const cell = (): HTMLElement => el(d, 'div', { className: 'ui-stat' },
      el(d, 'div', { className: 'ui-stat-text' },
        el(d, 'span', { className: 'skel skel-bar is-short' }),
        el(d, 'span', { className: 'skel ph-skel-value' })));
    const panel = (): HTMLElement => el(d, 'div', { className: 'ph-panel' },
      el(d, 'span', { className: 'skel skel-bar is-short ph-skel-head' }),
      el(d, 'span', { className: 'skel skel-bar ph-skel-line' }),
      el(d, 'span', { className: 'skel skel-bar ph-skel-line' }),
      el(d, 'span', { className: 'skel skel-bar is-short ph-skel-line' }));
    return el(d, 'div', {
      className: 'is-skeleton ph-board ph-skeleton',
      attrs: { 'aria-busy': 'true', 'aria-label': 'লোড হচ্ছে' },
    },
    el(d, 'div', { className: 'ph-band' },
      el(d, 'div', { className: 'ui-stat-row', data: { count: 4 } },
        cell(), cell(), cell(), cell())),
    el(d, 'div', { className: 'ph-grid' }, panel(), panel()));
  }

  /**
   * 2. The stat strip. Four figures, no glyphs. The one note is attendance's:
   * how many registers the percentage is over, and — before any — why there
   * is no figure. A tone colours the figure only where it carries meaning, and
   * the label beside it says what.
   */
  private strip(): HTMLElement {
    const d = this.o.doc;
    const data = this.data;
    const a = data?.attendanceToday;
    const absent = data?.absentToday;
    const f = data?.finance;
    // null is "nobody has taken it yet" and is a different statement from
    // 0%. The screen must not render them the same way.
    const taken = a?.percent !== null && a?.percent !== undefined;
    const pct = taken ? a!.percent! : 0;
    // Before anyone marks a register, "০ absent" is the same lie as "0%".
    const absentKnown = Boolean(absent) && (taken || (absent?.total ?? 0) > 0);
    // The denominator, said as a plain fact and not as a task (see the header).
    // No-break spaces: in half a 320px phone the note wraps, and it must wrap
    // at the "·", not between "০ /" and "২৬ সেকশন".
    const registers = a
      ? `${bn(a.sessionsTaken)}\u00a0/\u00a0${bn(a.sectionsExpected)}\u00a0সেকশন` : undefined;

    return statRow(d,
      statCard(d, {
        label: 'শিক্ষার্থী',
        value: bn(data?.counts?.students ?? 0),
        onClick: () => this.o.go('students'),
      }),
      statCard(d, {
        label: 'আজ উপস্থিত',
        // Not a figure yet, so the figure slot holds a dash and the words go
        // underneath — in the text face, not the numeral face.
        value: taken ? `${bn(pct)}%` : '—',
        note: taken ? registers
          : registers ? `এখনো নেওয়া হয়নি · ${registers}` : 'এখনো নেওয়া হয়নি',
        tone: attendanceTone(taken ? pct : null),
        onClick: () => this.o.go('academic'),
      }),
      statCard(d, {
        label: 'আজ অনুপস্থিত',
        value: absentKnown ? bn(absent!.total) : '—',
        tone: absentKnown && absent!.total > 0 ? 'danger' : undefined,
      }),
      // Absent, not hidden, for a role the server does not send it to.
      f ? breakAtGroups(statCard(d, {
        label: 'বকেয়া',
        value: formatBdt(Number(f.outstanding)),
        tone: Number(f.outstanding) > 0 ? 'warn' : undefined,
        onClick: () => this.o.go('fees'),
      })) : null);
  }

  /**
   * 3a. এখনই দেখা দরকার — one sentence per open item, each a way to the
   * screen that closes it. A zero is not a task, so it is not a row.
   *
   * No attendance row: the payload cannot say how many sections are still
   * unmarked, nor whether today is a school day (see the header).
   */
  private attention(): HTMLElement | null {
    const d = this.o.doc;
    const p = this.data?.pending;
    // Without the queue in the payload there is nothing true to say — least
    // of all "everything is assigned".
    if (!p) return null;

    const rows: Array<{ text: string; route: string }> = [];
    if (p.sectionsWithoutClassTeacher > 0) {
      rows.push({ text: `${bn(p.sectionsWithoutClassTeacher)}টি সেকশনে শ্রেণি শিক্ষক নির্ধারণ করা হয়নি`,
        route: 'academic' });
    }
    if (p.subjectsWithoutTeacher > 0) {
      rows.push({ text: `${bn(p.subjectsWithoutTeacher)}টি বিষয়ে শিক্ষক নির্ধারণ করা হয়নি`,
        route: 'academic' });
    }
    if (p.studentsWithoutSection > 0) {
      rows.push({ text: `${bn(p.studentsWithoutSection)} জন শিক্ষার্থী কোনো সেকশনে নেই`,
        route: 'students' });
    }
    if (p.examsAwaitingPublication > 0) {
      rows.push({ text: `${bn(p.examsAwaitingPublication)}টি পরীক্ষার ফলাফল প্রকাশের অপেক্ষায়`,
        route: 'publish' });
    }

    const panel = el(d, 'section', { className: 'ph-panel' });
    append(panel, sectionHeading(d, { title: 'এখনই দেখা দরকার', className: 'ph-panel-head' }));

    if (rows.length === 0) {
      // One calm line, not four zeroes. It names only what the queue checks:
      // attendance is not in it, so the all-clear does not vouch for it.
      append(panel, el(d, 'p', {
        className: 'ph-calm',
        text: 'সব কিছু নির্ধারিত আছে — শিক্ষক, সেকশন ও ফলাফল প্রকাশে কোথাও কিছু বাকি নেই।',
      }));
      return panel;
    }

    const ul = list(d, 'এখনই দেখা দরকার', ...rows.map((r) => listItem(d, {
      title: r.text,
      onClick: () => this.o.go(r.route),
    })));
    ul.classList.add('ph-attention');
    append(panel, ul);
    return panel;
  }

  /**
   * 3b. Today's absentees. The design's per-class bars need figures the
   * endpoint does not send; this is the attendance data it does.
   */
  private absentees(): HTMLElement {
    const d = this.o.doc;
    const a = this.data?.attendanceToday;
    const absent = this.data?.absentToday;
    const taken = a?.percent !== null && a?.percent !== undefined;

    const panel = el(d, 'section', { className: 'ph-panel' });
    append(panel, sectionHeading(d, { title: 'আজ অনুপস্থিত শিক্ষার্থী', className: 'ph-panel-head' }));

    // P7-0. A TABLE, carried over from `institution` when the two dashboards
    // were merged. It is the one thing that screen did better: an office
    // reading down a column of roll numbers to phone six families is
    // comparing, and a stack of list items makes them read one name per line
    // across the whole width.
    if (absent && absent.shown.length > 0) {
      append(panel, dataTable(d, {
        caption: 'আজ অনুপস্থিত শিক্ষার্থী',
        rows: absent.shown,
        rowKey: (st) => st.studentId,
        columns: [
          // Roll stays Latin — it is an identifier, read down a phone to the
          // class teacher, not a count.
          { key: 'roll', header: 'রোল', mobile: 'meta', numeric: true,
            cell: (st) => formatIdentifier(st.rollNo), width: '90px' },
          { key: 'name', header: 'নাম', mobile: 'title', cell: (st) => st.nameBn,
            width: 'minmax(0, 2fr)' },
          { key: 'class', header: 'শ্রেণি', mobile: 'subtitle',
            cell: (st) => st.classBn, width: 'minmax(0, 1.2fr)' },
          { key: 'section', header: 'সেকশন', mobile: 'meta',
            cell: (st) => st.section, width: '110px' },
        ],
      }));
      if (absent.total > absent.shown.length) {
        // Never imply the list is the whole list.
        append(panel, el(d, 'p', { className: 'ph-note' }, ...numText(d,
          `আরও ${bn(absent.total - absent.shown.length)} জন অনুপস্থিত — `
          + 'সম্পূর্ণ তালিকা শ্রেণিভিত্তিক হাজিরায়।')));
      }
    } else if (absent && absent.total > 0) {
      append(panel, el(d, 'p', { className: 'ph-note' }, ...numText(d,
        `আজ ${bn(absent.total)} জন অনুপস্থিত — সম্পূর্ণ তালিকা শ্রেণিভিত্তিক হাজিরায়।`)));
    } else if (!taken) {
      append(panel, el(d, 'p', {
        className: 'ph-note',
        text: 'হাজিরা নেওয়া শুরু হলে অনুপস্থিত শিক্ষার্থীদের নাম এখানে আসবে।',
      }));
    } else {
      append(panel, el(d, 'p', { className: 'ph-note', text: 'আজ কোনো শিক্ষার্থী অনুপস্থিত নেই।' }));
    }
    return panel;
  }

  /** 4. What can be acted on: exams, notices, money — in the same panels. */
  private secondary(): HTMLElement[] {
    const d = this.o.doc;
    const panels: HTMLElement[] = [];

    const exams = this.data?.upcomingExams ?? [];
    const examPanel = el(d, 'section', { className: 'ph-panel' });
    append(examPanel, sectionHeading(d, {
      title: 'পরীক্ষা',
      className: 'ph-panel-head',
      action: button(d, { label: 'ফলাফল প্রকাশ', variant: 'ghost', size: 'sm',
        onClick: () => this.o.go('publish') }),
    }));
    append(examPanel, exams.length === 0
      ? emptyState(d, {
        message: 'সামনে কোনো পরীক্ষা নির্ধারিত নেই।',
        action: { label: 'পরীক্ষা ব্যবস্থাপনা', onClick: () => this.o.go('exams') },
      })
      : list(d, 'আসন্ন পরীক্ষা', ...exams.map((e) => listItem(d, {
          title: e.nameBn,
          subtitle: bnDate(e.startsOn),
          glyph: 'clipboard',
          status: statusBadge(d, EXAM_STATE[e.status] ?? { state: 'pending', label: e.status }),
          onClick: () => this.o.go('publish'),
        }))));
    panels.push(examPanel);

    const notices = this.data?.recentNotices ?? [];
    const noticePanel = el(d, 'section', { className: 'ph-panel' });
    append(noticePanel, sectionHeading(d, {
      title: 'সাম্প্রতিক নোটিশ',
      className: 'ph-panel-head',
      action: button(d, { label: 'সব দেখুন', variant: 'ghost', size: 'sm',
        onClick: () => this.o.go('inbox') }),
    }));
    // No button of its own: the next action is the header's "নোটিশ পাঠান".
    append(noticePanel, notices.length === 0
      ? emptyState(d, { message: 'সম্প্রতি কোনো নোটিশ প্রকাশ হয়নি।' })
      : list(d, 'সাম্প্রতিক নোটিশ', ...notices.map((n) => listItem(d, {
          title: n.title,
          subtitle: `${bnDate(n.publishedAt)} · ${bn(n.recipientCount)} জনের কাছে`,
          glyph: 'bell',
          onClick: () => this.o.go('inbox'),
        }))));
    panels.push(noticePanel);

    // Absent, not hidden, for a role the server does not send it to. The
    // outstanding figure is in the strip; this is the rest of the position.
    const f = this.data?.finance;
    if (f) {
      const money = el(d, 'section', { className: 'ph-panel' });
      append(money, sectionHeading(d, {
        title: 'ফি',
        className: 'ph-panel-head',
        action: button(d, { label: 'ফি ব্যবস্থাপনা', variant: 'ghost', size: 'sm',
          onClick: () => this.o.go('fees') }),
      }));
      append(money, statRow(d, statCard(d, {
        // The academic YEAR, not the month: that is the window the endpoint
        // sums over, and a label that says otherwise is a wrong number
        // dressed as a right one.
        label: 'এ বছর আদায়',
        value: formatBdt(Number(f.collected)),
        note: `মোট ইনভয়েস ${formatBdt(Number(f.invoiced))} · ${bn(f.unpaidCount)}টি ইনভয়েস বাকি`,
      })));
      panels.push(money);
    }
    return panels;
  }
}

/**
 * Today's attendance, by meaning: ৯০% and over is a good morning (--ok),
 * under ৭৫% is an absence problem (--danger), between is worth a look. Not
 * taken yet is no colour at all — the words say it.
 */
function attendanceTone(percent: number | null): CardTone | undefined {
  if (percent === null) return undefined;
  if (percent >= 90) return 'success';
  if (percent >= 75) return 'warn';
  return 'danger';
}

/**
 * "৳ 12,55,000.00" in half a 320px phone does not fit at the sheet's figure
 * size. Let it wrap at a lakh/thousand group rather than mid-digit: a `<wbr>`
 * after each comma. Text nodes only, so textContent — and what a screen
 * reader says — is exactly the formatted amount.
 */
function breakAtGroups(stat: HTMLElement): HTMLElement {
  const value = stat.querySelector('.ui-stat-value');
  const text = value?.textContent ?? '';
  if (!value || !text.includes(',')) return stat;
  const doc = stat.ownerDocument;
  value.textContent = '';
  text.split(',').forEach((part, i, all) => {
    value.append(doc.createTextNode(i < all.length - 1 ? `${part},` : part));
    if (i < all.length - 1) value.append(doc.createElement('wbr'));
  });
  return stat;
}

const EXAM_STATE: Record<string,{ state: 'due' | 'pending' | 'published'; label: string }> = {
  scheduled: { state: 'pending', label: 'নির্ধারিত' },
  ongoing: { state: 'due', label: 'চলছে' },
  marking: { state: 'due', label: 'নম্বর দেওয়া হচ্ছে' },
  published: { state: 'published', label: 'প্রকাশিত' },
};

const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই',
  'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

function bnDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatCount(d.getDate(), 'bn')} ${MONTHS[d.getMonth()]}`;
}
