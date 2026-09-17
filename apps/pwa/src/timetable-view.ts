/**
 * "প্রকাশিত রুটিন" — the published timetable, for whoever is reading it.  (P9-8)
 *
 * One screen and one grid for all eight audiences, because there is one
 * routine. A principal picking a room, a teacher opening their own week and a
 * guardian looking at their child are asking the same question with a
 * different WHERE clause, and the server answers it in one shape.
 *
 * ── The picker is the server's list, not this file's ─────────────────────
 * `offered` comes back with the scopes this caller may actually ask for,
 * built from the same role list and the same `app.my_section_ids()` /
 * `app.my_ward_ids()` the filters use. A picker assembled here from
 * `auth.role` would be a second opinion about permission, and the first time
 * the two disagreed a person would be offered a view the server refuses.
 *
 * ── Draft is not a state this screen has ─────────────────────────────────
 * The endpoint reads `status = 'active'` and nothing else, so there is no
 * branch here that could show one. "No published routine yet" is a real and
 * common state — a school in its first week — and it says what to do rather
 * than looking broken.
 *
 * ── Density ──────────────────────────────────────────────────────────────
 * A section's cell holds one lesson; the institution's holds sixteen. Rather
 * than two components, every cell holds a LIST and shows the first few with
 * a count for the rest — so the same grid reads sensibly whether it is one
 * student's Tuesday or a whole school's.
 *
 * ── Ata Ekta (06 Routine §06, 13 Responsive ০৬) ──────────────────────────
 * One white panel: the view tabs (the server's `offered`, drawn as the
 * segmented strip), the "which one" select, then each shift's week. The week
 * is drawn twice and CSS shows one: the full grid from 1024px, and on a phone
 * the segmented day tabs over that one day's rows, today preselected. Both
 * come from the same rows and the same `lessonParts()`, so nothing a desk
 * shows is missing on a phone. Switching day is presentational — it reads
 * the week already in memory and never asks the server again.
 */
import {
  el, append, pageHeader, button, sectionHeading, tabs, list, listItem,
  permissionState, deniedMessage, deniedContact, openDrawer, announce,
  listSkeleton, emptyState, errorState, field, inlineLoader, numText, numClass,
  type OverlayHandle,
} from './ui/index.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import { formatCount, formatDayMonth, toBanglaDigits, formatClockRange, ordinalBn, formatAcademicYear } from '../../../packages/ui-core/src/format.ts';
import type { Auth } from './auth.ts';

export interface Lesson {
  routineId: string;
  dayOfWeek: number;
  periodNo: number;
  startsAt: string;
  endsAt: string;
  subjectBn: string | null;
  teacherBn: string | null;
  roomBn: string | null;
  sectionLabel: string | null;
  classBn: string | null;
  classLevel: number | null;
  isParallel: boolean;
}
export interface RoutineHead {
  id: string; version: number; shift: string; shiftBn: string;
  nameBn: string; publishedAt: string | null; yearLabel: string;
}
export interface Period {
  routineId: string; periodNo: number; labelBn: string; startsAt: string; endsAt: string;
  /** 'teaching', or the break the school observes at this hour. */
  kind: string;
}
export interface Offer {
  scope: string;
  labelBn: string;
  options?: Array<{ id: string; labelBn: string }>;
}
export interface TimetablePayload {
  ok?: boolean;
  scope: string;
  published: boolean;
  titleBn: string;
  subtitleBn: string;
  routines: RoutineHead[];
  periods: Period[];
  lessons: Lesson[];
  days: Array<{ dow: number; bn: string }>;
  offered: Offer[];
  counts: { sections: number; teachers: number; rooms: number; classes: number };
}

export interface TimetableViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Where "রুটিন তৈরি করুন" sends a coordinator with nothing published. */
  onNavigate?: (path: string) => void;
  /** Opening scope, for a deep link. */
  scope?: string;
  id?: string;
}

/** How many lessons a single cell prints before it counts the rest. */
const PER_CELL = 3;

/** One row of a shift's day: a taught hour carries its ordinal, a break does not. */
interface Row { p: Period; ordinal: string | null }

/** The names a lesson shows, the same on the desk grid and the phone list. */
interface LessonParts { what: string[]; teacher: string | null; room: string | null; parallel: boolean }

/** Scroll a tab strip just enough that its selected tab is in view. */
function revealSelectedTab(strip: HTMLElement): void {
  const tab = strip.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!tab) return;
  const s = strip.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  if (t.right > s.right) strip.scrollLeft += t.right - s.right;
  else if (t.left < s.left) strip.scrollLeft -= s.left - t.left;
}

const dateBn = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            + `-${String(d.getDate()).padStart(2, '0')}`;
  return `${formatDayMonth(ymd, 'bn')} ${formatCount(d.getFullYear(), 'bn')}`;
};

export class TimetableView {
  private readonly o: TimetableViewOptions;
  private scope: string;
  private id: string;

  private data: TimetablePayload | null = null;
  private loading = true;
  private denied = false;
  private deniedErr: unknown = null;
  private error = '';
  /** The phone's selected day for each shift, by routine id. View-local. */
  private readonly dayByRoutine = new Map<string, number>();
  /** A view tab asked for the reload: put keyboard focus back on the strip. */
  private refocusScope = false;

  constructor(options: TimetableViewOptions) {
    this.o = options;
    this.scope = options.scope ?? '';
    this.id = options.id ?? '';
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.render();
    try {
      const qs = new URLSearchParams();
      // With neither set, the server answers from this reader's own menu.
      // Nothing here guesses a scope: a guess would be a second opinion
      // about permission, and the endpoint already holds the first.
      if (this.scope) qs.set('scope', this.scope);
      if (this.id) qs.set('id', this.id);
      const res = await this.o.auth.authedFetch(
        `/api/v1/rms/timetable${qs.toString() ? `?${qs}` : ''}`);
      await refuseUnlessOk(res);
      const b = await res.json() as TimetablePayload & { id?: string };
      this.data = b;
      this.scope = b.scope;
      if (typeof b.id === 'string') this.id = b.id;
      this.error = '';
    } catch (err) {
      if (isDenied(err)) { this.denied = true; this.deniedErr = err; }
      else {
        this.error = navigator.onLine
          ? 'রুটিন আনা যায়নি — একটু পরে আবার চেষ্টা করুন।'
          : 'সংযোগ নেই — সংযোগ পেলে রুটিন দেখা যাবে।';
      }
    } finally {
      this.loading = false; this.render();
    }
  }

  private pick(scope: string, id: string): void {
    this.scope = scope; this.id = id;
    this.denied = false; this.deniedErr = null;
    void this.load();
  }

  /* ------------------------------------------------------------- render */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    const ready = Boolean(this.data?.published)
      && !this.loading && !this.error && !this.denied;
    root.append(pageHeader(d, {
      title: 'প্রকাশিত রুটিন',
      subtitle: this.data?.published
        ? `${this.data.titleBn} · ${this.data.subtitleBn}`
        : 'প্রতিষ্ঠানের চালু ক্লাস রুটিন',
      // P9-9 §2. The print action sits with the routine it prints, not on a
      // separate documents screen — a coordinator who is looking at ষষ্ঠ-ক's
      // week and wants it on the noticeboard should not have to go and find
      // it again somewhere else. 06 Routine draws it in the screen's bar as
      // the one small outline button; this screen has no primary.
      //
      // No glyph: the icon set has no printer, and the fallback for an
      // unknown name is a dot — worse than a plain labelled button. নথি ও ছাপা's
      // own print button is unglyphed for the same reason.
      actions: ready
        ? [button(d, { label: 'ছাপুন', variant: 'secondary', size: 'sm',
                       onClick: () => this.openPrint() })]
        : undefined,
    }));

    if (this.denied) {
      this.refocusScope = false;
      root.append(permissionState(d, {
        message: deniedMessage(this.deniedErr),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }
    if (this.loading) { root.append(listSkeleton(d, 3)); return; }
    if (this.error) {
      this.refocusScope = false;
      root.append(errorState(d, this.error, () => { void this.load(); }));
      return;
    }
    if (!this.data) return;

    const panel = this.panel();
    root.append(panel);
    // Only now is the strip laid out. A school's seven views overflow a
    // phone and scroll; the one showing must not be the one scrolled away.
    for (const strip of Array.from(panel.querySelectorAll<HTMLElement>('.tt-tabs'))) {
      revealSelectedTab(strip);
    }
    if (this.refocusScope) {
      this.refocusScope = false;
      panel.querySelector<HTMLElement>('.tt-scope-tabs [aria-selected="true"]')?.focus();
    }
  }

  /** The one white surface: view tabs, which one, then the week or its absence. */
  private panel(): HTMLElement {
    const d = this.o.doc;
    const data = this.data!;
    const panel = el(d, 'div', { className: 'ui-data tt-panel' });
    const body = el(d, 'div', { className: 'tt-body' });

    if (data.offered.length > 1) {
      // The select's own first-match: a scope offered twice shows its first.
      const at = Math.max(0, data.offered.findIndex((o) => o.scope === this.scope));
      const current = data.offered[at];
      append(panel, this.scopeTabs(at));
      body.id = 'tt-scope-panel';
      body.setAttribute('role', 'tabpanel');
      body.setAttribute('aria-labelledby', `tab-scope-${at}`);
      // A scope with a list needs a second choice; one without (the whole
      // institution) does not, and drawing an empty picker beside it would be
      // a control that does nothing.
      if (current.options && current.options.length > 0) {
        append(body, this.whichSelect(current));
      }
    }

    if (!data.published) {
      append(body, this.nothingPublished());
    } else {
      const labelled = data.routines.length > 1;
      data.routines.forEach((r, i) => append(body, this.shiftBlock(r, i, labelled)));
      append(body, this.footnote());
    }
    append(panel, body);
    return panel;
  }

  /** §15 — a real and ordinary state, with the way out. */
  private nothingPublished(): HTMLElement {
    const d = this.o.doc;
    return emptyState(d, {
      glyph: 'clock',
      message: 'এখনো কোনো রুটিন প্রকাশ করা হয়নি। প্রকাশ হলে এখানে দেখা যাবে।',
      ...(this.o.onNavigate
        ? { action: { label: 'রুটিন তৈরি ও প্রকাশ',
                      onClick: () => this.o.onNavigate?.('routinepublish') } }
        : {}),
    });
  }

  /**
   * The scopes this reader may ask for — the server's list, verbatim, as the
   * segmented view strip 06 Routine draws (শ্রেণি · শাখা · শিক্ষক · কক্ষ).
   *
   * It was a select, and it keeps the select's semantics exactly: a choice
   * other than the one showing asks the server again for the FIRST offer of
   * that scope, with that offer's first option — which is what a select whose
   * option values are scopes did.
   */
  private scopeTabs(at: number): HTMLElement {
    const d = this.o.doc;
    const data = this.data!;
    const strip = tabs(d, {
      label: 'কার রুটিন',
      className: 'tt-tabs tt-scope-tabs',
      active: `scope-${at}`,
      items: data.offered.map((o, i) => ({ id: `scope-${i}`, label: o.labelBn })),
      onSelect: (id) => {
        const i = Number(id.slice('scope-'.length));
        if (i === at) return;
        const picked = data.offered[i];
        if (!picked) return;
        const next = data.offered.find((o) => o.scope === picked.scope) ?? picked;
        this.refocusScope = true;
        this.pick(next.scope, next.options?.[0]?.id ?? '');
      },
    });
    for (const tab of Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]'))) {
      tab.setAttribute('aria-controls', 'tt-scope-panel');
    }
    return strip;
  }

  /** Which class, room or teacher. Drawn without a visible label; it keeps one for a reader. */
  private whichSelect(current: Offer): HTMLElement {
    const d = this.o.doc;
    const options = current.options ?? [];
    const f = field(d, {
      label: 'কোনটি', name: 'subject', kind: 'select', className: 'tt-which',
      value: this.id || options[0]?.id,
      options: options.map((x) => ({ value: x.id, label: x.labelBn })),
      onChange: (v) => this.pick(current.scope, v),
    });
    f.root.querySelector('.ui-field-label')?.classList.add('ui-sr-only');
    // R6. An option cannot hold a span, so only a wholly numeric label ("১০১")
    // takes the numeral face; a room called "১০১ নম্বর কক্ষ" stays as it is.
    for (const opt of Array.from(f.root.querySelectorAll('option'))) {
      const cls = numClass('', opt.textContent ?? '');
      if (cls) opt.className = cls;
    }
    return f.root;
  }

  /**
   * The server's counts and the routine's edition, as a quiet line under the
   * week. Not drawn in 06 Routine, and kept: the counts are the server's,
   * counted on ids (see below), and B-116's year is pinned to this screen.
   */
  private footnote(): HTMLElement {
    const d = this.o.doc;
    const data = this.data!;
    const foot = el(d, 'div', { className: 'tt-foot' });
    // The server's counts, on ids. Counting the rendered labels here made a
    // twenty-section school report four, because every class has a 'ক'.
    const n = data.counts ?? { sections: 0, teachers: 0, rooms: 0, classes: 0 };
    append(foot, el(d, 'p', { className: 'tt-note' }, ...numText(d,
      `মোট ক্লাস ${formatCount(data.lessons.length, 'bn')}টি`
      + ` · শাখা ${formatCount(n.sections, 'bn')}টি`
      + ` · শিক্ষক ${formatCount(n.teachers, 'bn')} জন`
      + ` · কক্ষ ${formatCount(n.rooms, 'bn')}টি`)));

    const r = data.routines[0];
    if (r) {
      append(foot, el(d, 'p', { className: 'tt-note' }, ...numText(d,
        // B-116. The version beside it was already Bangla and the year was
        // not, on the same line. Digits only — a school that labels its
        // session '2026-27' gets ২০২৬-২৭, not a rewritten label.
        `${formatAcademicYear(r.yearLabel)} শিক্ষাবর্ষ · সংস্করণ ${formatCount(r.version, 'bn')}`
        + ` · প্রকাশ: ${dateBn(r.publishedAt)}`)));
    }
    return foot;
  }

  /**
   * One shift's week.
   *
   * A two-shift school gets two grids and not one: morning period 8 and day
   * period 1 are different numbers over the same clock time, so a single
   * table keyed on period number would put two different hours in one row.
   */
  private shiftBlock(r: RoutineHead, index: number, labelled: boolean): HTMLElement {
    const d = this.o.doc;
    const data = this.data!;
    const block = el(d, 'div', { className: 'tt-shift' });
    // A heading only when there is more than one shift to tell apart.
    if (labelled) append(block, sectionHeading(d, { title: `${r.shiftBn} শিফট` }));

    const periods = data.periods.filter((p) => p.routineId === r.id);
    if (periods.length === 0) {
      append(block, emptyState(d, { message: 'এই শিফটের ঘণ্টার সময়সূচি পাওয়া যায়নি।' }));
      return block;
    }

    const byCell = new Map<string, Lesson[]>();
    for (const l of data.lessons) {
      if (l.routineId !== r.id) continue;
      const k = `${l.dayOfWeek}|${l.periodNo}`;
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k)!.push(l);
    }

    // The ordinal counts TAUGHT hours, not template rows: `period_no` is a
    // position in the day and tiffin holds one, so numbering by it put '৬'
    // over the hour the school calls ৫ম. Counting here keeps the screen and
    // the printed sheet saying the same thing, which is the whole reason
    // they share one read.
    //
    // §5. Tiffin, assembly and জোহর are rows of this week, not gaps in it.
    // The read used to filter them out entirely; a school builds its day
    // around the break, and a grid of nine unbroken hours is not the day
    // anybody in the building actually works.
    let taught = 0;
    const rows: Row[] = periods.map((p) => ((p.kind ?? 'teaching') === 'teaching'
      ? { p, ordinal: ordinalBn(++taught) }
      : { p, ordinal: null }));

    append(block, this.weekGrid(r, rows, byCell));
    if (data.days.length > 0) append(block, this.dayBlock(r, index, labelled, rows, byCell));
    return block;
  }

  /** The desk's week: periods down the side, days across the top. */
  private weekGrid(r: RoutineHead, rows: Row[], byCell: Map<string, Lesson[]>): HTMLElement {
    const d = this.o.doc;
    const data = this.data!;
    const scroll = el(d, 'div', { className: 'ui-table-scroll tt-week' });
    const table = el(d, 'table', { className: 'routine-grid tt-grid' });
    append(table, el(d, 'caption', {
      className: 'ui-sr-only',
      text: `${r.shiftBn} শিফটের সাপ্তাহিক রুটিন — সারিতে পিরিয়ড, কলামে দিন`,
    }));

    const hrow = el(d, 'tr');
    // The corner is drawn empty; a reader still gets the column's name.
    append(hrow, el(d, 'th', { attrs: { scope: 'col' } },
      el(d, 'span', { className: 'ui-sr-only', text: 'পিরিয়ড' })));
    for (const day of data.days) {
      append(hrow, el(d, 'th', { text: day.bn, attrs: { scope: 'col' } }));
    }
    append(table, el(d, 'thead', {}, hrow));

    const tbody = el(d, 'tbody');
    for (const { p, ordinal } of rows) {
      // The SAME formatter the printed sheet uses. A 24-hour '১৪:০০' sitting
      // beside a period is read as a period number, and a screen that says
      // one thing while the paper printed from it says another is the
      // divergence this whole read exists to prevent.
      const clock = formatClockRange(p.startsAt, p.endsAt, 'bn');
      // Its own class, not `routine-slot-meta`: that one also carries teacher
      // and room NAMES. This span is a clock time and nothing else.
      const time = el(d, 'span', { className: 'routine-grid-time' }, ...numText(d, clock));
      const th = el(d, 'th', { className: 'routine-grid-period', attrs: { scope: 'row' } });

      if (ordinal === null) {
        const band = el(d, 'tr', { className: 'tt-band' });
        append(th, time);
        append(band, th);
        // 06 Routine draws the break as one quiet cell under every day.
        const label = toBanglaDigits(p.labelBn);
        for (let i = 0; i < data.days.length; i += 1) {
          append(band, el(d, 'td', { className: 'tt-band-cell' }, ...numText(d, label)));
        }
        append(tbody, band);
        continue;
      }

      // The ordinal is not drawn; it stays the row header's spoken name, so
      // "৩য় পিরিয়ড" is still what a screen reader hears for this hour.
      append(th,
        el(d, 'span', { className: 'routine-grid-no ui-sr-only' },
          ...numText(d, `${ordinal} পিরিয়ড`)),
        ' ',
        time);
      const tr = el(d, 'tr', {}, th);
      for (const day of data.days) {
        const td = el(d, 'td', { className: 'routine-cell' });
        const here = byCell.get(`${day.dow}|${p.periodNo}`) ?? [];
        if (here.length === 0) {
          append(td, el(d, 'span', { className: 'routine-slot-empty', text: '—' }));
        } else {
          for (const l of here.slice(0, PER_CELL)) {
            append(td, this.cell(l, day.bn, p, ordinal));
          }
          if (here.length > PER_CELL) {
            append(td, el(d, 'span', { className: 'routine-slot-meta' },
              ...numText(d, `আরও ${formatCount(here.length - PER_CELL, 'bn')}টি`)));
          }
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
   * 13 Responsive ০৬ — the phone's week: the segmented day strip over one
   * day's rows, today preselected.
   *
   * A tap repaints only this block, from the week already in memory. Nothing
   * is fetched: the day is a way of looking at what arrived, not a new
   * question for the server.
   */
  private dayBlock(
    r: RoutineHead, index: number, labelled: boolean,
    rows: Row[], byCell: Map<string, Lesson[]>,
  ): HTMLElement {
    const d = this.o.doc;
    const data = this.data!;
    const wrap = el(d, 'div', { className: 'tt-day' });
    const panelId = `tt-day-panel-${index}`;
    const prefix = `day-${index}-`;

    const paint = (moveFocus: boolean): void => {
      const dows = data.days.map((x) => x.dow);
      let sel = this.dayByRoutine.get(r.id);
      if (sel === undefined || !dows.includes(sel)) {
        // `getDay()` and the server's `dow` share one convention: 0 = রবি.
        const today = new Date().getDay();
        sel = dows.includes(today) ? today : dows[0];
        this.dayByRoutine.set(r.id, sel);
      }
      const chosen = sel;
      const day = data.days.find((x) => x.dow === chosen) ?? data.days[0];
      wrap.textContent = '';

      const strip = tabs(d, {
        label: labelled ? `${r.shiftBn} শিফট — সপ্তাহের দিন` : 'সপ্তাহের দিন',
        className: 'tt-tabs tt-day-tabs',
        active: `${prefix}${chosen}`,
        items: data.days.map((x) => ({ id: `${prefix}${x.dow}`, label: x.bn })),
        onSelect: (id) => {
          const dow = Number(id.slice(prefix.length));
          if (dow === chosen || !dows.includes(dow)) return;
          this.dayByRoutine.set(r.id, dow);
          announce(d, `${data.days.find((x) => x.dow === dow)?.bn ?? ''}বারের রুটিন`);
          paint(true);
        },
      });
      for (const tab of Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]'))) {
        tab.setAttribute('aria-controls', panelId);
      }

      const tabpanel = el(d, 'div', {
        className: 'tt-day-panel',
        attrs: { id: panelId, role: 'tabpanel', 'aria-labelledby': `tab-${prefix}${chosen}` },
      }, list(d, `${day.bn}বারের ক্লাস`, ...this.dayRows(chosen, rows, byCell)));

      append(wrap, strip, tabpanel);
      if (moveFocus) {
        revealSelectedTab(strip);
        strip.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
      }
    };

    paint(false);
    return wrap;
  }

  /** One day's rows: time · subject (teacher) · room, a break on its own ground. */
  private dayRows(dow: number, rows: Row[], byCell: Map<string, Lesson[]>): HTMLElement[] {
    const d = this.o.doc;
    const out: HTMLElement[] = [];
    for (const { p, ordinal } of rows) {
      const clock = formatClockRange(p.startsAt, p.endsAt, 'bn');
      const spoken = ordinal ? `${ordinal} পিরিয়ড, ` : '';
      /**
       * The time column. A second lesson in the same hour leaves it visually
       * empty — the hour is printed once — but still says it to a reader, so
       * every row is whole on its own.
       */
      const add = (item: HTMLElement, showTime: boolean): void => {
        const time = el(d, 'span', { className: 'tt-day-time' });
        if (showTime) {
          if (spoken) append(time, el(d, 'span', { className: 'ui-sr-only' }, ...numText(d, spoken)));
          append(time, ...numText(d, clock));
        } else {
          append(time, el(d, 'span', { className: 'ui-sr-only' }, ...numText(d, `${spoken}${clock}`)));
        }
        item.querySelector('.ui-list-hit')?.prepend(time);
        out.push(item);
      };

      if (ordinal === null) {
        add(listItem(d, { title: toBanglaDigits(p.labelBn), className: 'tt-day-break' }), true);
        continue;
      }
      const here = byCell.get(`${dow}|${p.periodNo}`) ?? [];
      if (here.length === 0) {
        add(listItem(d, { title: '—' }), true);
        continue;
      }
      here.slice(0, PER_CELL).forEach((l, k) => {
        const x = this.lessonParts(l);
        const meta = [x.teacher, x.parallel ? 'বিভাজিত ক্লাস' : null].filter(Boolean).join(' · ');
        add(listItem(d, {
          title: x.what.join(' · '),
          meta: meta || undefined,
          status: x.room ? el(d, 'span', { className: 'ui-list-meta', text: x.room }) : undefined,
        }), k === 0);
      });
      if (here.length > PER_CELL) {
        add(listItem(d, { title: `আরও ${formatCount(here.length - PER_CELL, 'bn')}টি` }), false);
      }
    }
    return out;
  }

  /**
   * §2 — preview, then print.  (P9-9)
   *
   * The document is fetched with `authedFetch` so it travels with the
   * caller's bearer token, then rendered into a sandboxed `srcdoc` iframe.
   * Pointing the iframe at the endpoint URL instead would send a plain
   * browser request with no Authorization header — it would 401, and the
   * "fix" for that is a document URL that works without the app.
   *
   * The thing on screen IS the thing that prints: `contentWindow.print()`
   * prints exactly the previewed document, so the preview cannot drift from
   * the output the way a lookalike would. Same mechanism as নথি ও ছাপা,
   * deliberately — a second print path is a second one to get wrong.
   */
  private openPrint(): void {
    const d = this.o.doc;
    const body = el(d, 'div', { className: 'ui-stack tt-print' });
    const slot = el(d, 'div', { className: 'ui-stack' });
    body.append(el(d, 'p', {
      className: 'ui-card-note',
      // §15. Say the rule rather than let somebody wonder why the draft they
      // just edited is not on the sheet.
      text: 'শুধু প্রকাশিত রুটিন ছাপা যায় — খসড়া বা পর্যালোচনায় থাকা রুটিন নয়।',
    }));
    body.append(slot);

    let handle: OverlayHandle | undefined;
    const printBtn = button(d, {
      label: 'ছাপুন', variant: 'primary', disabled: true,
      onClick: () => {
        const frame = slot.querySelector('iframe');
        const win = (frame as HTMLIFrameElement | null)?.contentWindow;
        if (!win) return;
        // Focus first: some browsers ignore print() on a background frame.
        win.focus();
        win.print();
      },
    });

    handle = openDrawer(d, {
      title: 'রুটিন ছাপুন',
      body,
      actions: [
        button(d, { label: 'বন্ধ করুন', variant: 'secondary',
                    onClick: () => handle?.close() }),
        printBtn,
      ],
    });

    slot.append(inlineLoader(d, 'ছাপার নমুনা তৈরি হচ্ছে'));
    void (async () => {
      const qs = new URLSearchParams({ type: 'routine_sheet', scope: this.scope });
      if (this.id) qs.set('id', this.id);
      try {
        const res = await this.o.auth.authedFetch(`/api/v1/ops/document?${qs}`);
        if (!res.ok) {
          const b = await res.json().catch(() => ({})) as { message?: string };
          slot.textContent = '';
          slot.append(el(d, 'p', {
            className: 'ui-note-warn', attrs: { role: 'status' },
            text: b.message ?? 'ছাপার নমুনা তৈরি করা যায়নি।',
          }));
          return;
        }
        const html = await res.text();
        slot.textContent = '';
        const frame = d.createElement('iframe');
        frame.className = 'doc-preview';
        frame.title = 'রুটিন — ছাপার নমুনা';
        // `allow-scripts` is deliberately absent: the document is
        // server-generated markup in which every interpolated value is
        // escaped, and with no script permission nothing in it can execute
        // even if that escaping were ever wrong. `allow-same-origin` IS
        // granted, because the print button calls `contentWindow.print()`
        // from the parent and an opaque origin would block it.
        frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
        frame.srcdoc = html;
        slot.append(frame);
        printBtn.disabled = false;
        announce(d, 'ছাপার নমুনা প্রস্তুত');
      } catch {
        slot.textContent = '';
        slot.append(el(d, 'p', {
          className: 'ui-note-warn', attrs: { role: 'status' },
          text: navigator.onLine
            ? 'ছাপার নমুনা তৈরি করা যায়নি।'
            : 'সংযোগ নেই — ছাপার নমুনা আনতে ইন্টারনেট লাগবে।',
        }));
      }
    })();
  }

  /**
   * What a lesson names, given whose routine is on screen. One answer for
   * the grid cell and the phone row, so the two never show different things.
   */
  private lessonParts(l: Lesson): LessonParts {
    const what = [l.subjectBn ?? 'ক্লাস'];
    // The section only when the reader is looking at more than one — on a
    // section's own grid every cell would repeat it.
    if (this.scope !== 'section' && this.scope !== 'student' && l.sectionLabel) {
      what.push(`${l.classBn ?? ''}-${l.sectionLabel}`.replace(/^-/, ''));
    }
    return {
      what,
      // The teacher, unless this IS the teacher's own grid.
      teacher: this.scope !== 'teacher' ? l.teacherBn : null,
      room: this.scope !== 'room' ? l.roomBn : null,
      parallel: l.isParallel,
    };
  }

  /**
   * One lesson.
   *
   * A `div`, not a `button`: nothing here is clickable, and a control that
   * does nothing when pressed is worse than a plain cell. The accessible name
   * carries the day and hour because a screen reader moving through a table
   * cell by cell has no other way to know which one it is in.
   */
  private cell(l: Lesson, dayBn: string, p: Period, ordinal: string): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div', { className: 'routine-slot' });
    wrap.setAttribute('data-filled', 'true');

    const x = this.lessonParts(l);
    append(wrap, el(d, 'span', { className: 'routine-slot-subject' },
      ...numText(d, x.what.join(' · '))));
    for (const meta of [x.teacher, x.room, x.parallel ? 'বিভাজিত ক্লাস' : null]) {
      if (meta) append(wrap, el(d, 'span', { className: 'routine-slot-meta' }, ...numText(d, meta)));
    }

    // The SAME ordinal and the SAME clock the row header carries. This
    // label used to count `period_no`, so a screen-reader user heard
    // “৬ নম্বর পিরিয়ড” for the hour everyone else called ৫ম — the same
    // off-by-one as the printed sheet, one layer down where nobody looks.
    wrap.setAttribute('aria-label', [
      `${dayBn}বার`,
      `${ordinal} পিরিয়ড`,
      formatClockRange(l.startsAt, l.endsAt, 'bn'),
      ...x.what,
      l.teacherBn ?? '',
      l.roomBn ?? '',
    ].filter(Boolean).join(', '));
    return wrap;
  }
}
