/**
 * My results — F-805, wireframe §6.5 · Ata Ekta 03 Student §04, 04 Guardian §03
 *
 * The drawn screen: one panel, the GPA large on an --ok ground (the student's
 * first question), the change since the last exam in an info strip, then one
 * row per subject — name, total, grade. Around it, the pieces §6.5 makes
 * load-bearing and the drawing leaves out: the exam selector (in the page
 * header), the publication date (in the hero), the component breakdown, the
 * optional-subject footnote and the trend across terms.
 *
 * Three rules from §6.5, each load-bearing:
 *
 *   The component breakdown (CQ / MCQ / practical / CA) is ALWAYS visible.
 *   It is the board's own structure. A single total hides which half of the
 *   paper went wrong, which is the only actionable thing on the screen. On a
 *   phone it is each row's meta line; on a desktop, its own columns.
 *
 *   The optional-subject footnote is MANDATORY — "the rule most commonly
 *   misunderstood, and showing it prevents a support call." A student
 *   seeing a 64 counted differently from their other 64 needs the sentence
 *   next to it, not in a help article.
 *
 *   Results are strictly read-only and never visible before the school
 *   publishes. That is enforced by results_scope in the database, not here;
 *   this view could not show an unpublished result if it tried.
 */
import type { Auth } from './auth.ts';
import { hasIcon } from './icon.ts';
import { formatCount, toBanglaDigits, ordinalBn } from '../../../packages/ui-core/src/format.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import { bnDate } from './view-states.ts';
import {
  permissionState, deniedMessage, deniedContact, pageHeader, field, statusBadge,
  listSkeleton, emptyState, errorState, dataTable, sectionHeading,
  el, icon, uid, numText, numClass, type Column,
} from './ui/index.ts';

interface SubjectRow {
  subjectBn: string;
  cqMarks: string | null;
  mcqMarks: string | null;
  practicalMarks: string | null;
  caMarks: string | null;
  totalMarks: string | null;
  gradeLetter: string | null;
  gradePoint: string | null;
  isAbsent: boolean;
  componentFailed?: boolean;
  requirementType: string | null;
}

interface Result {
  examId: string;
  examNameBn: string;
  examType: string;
  totalMarks: string | null;
  totalMax: string | null;
  percentage: string | null;
  gpa: string | null;
  letterGrade: string | null;
  subjectsFailed: number;
  isPass: boolean;
  rankInSection: number | null;
  publishedAt: string | null;
  subjects: SubjectRow[];
}

const CACHE_KEY = 'shikhon_results_cache';

const bn = (n: number | string | null | undefined): string =>
  n === null || n === undefined || n === '' ? '—' : formatCount(Number(n), 'bn');

/** Marks and GPA render as written on the tabulation sheet — no rounding. */
const mark = (s: string | null): string =>
  s === null || s === '' ? '—' : formatCount(Number(Number(s).toFixed(Number(s) % 1 ? 2 : 0)), 'bn');

/**
 * A GPA as the design draws it: two places, Bangla digits ("৪.৬৭"). It is a
 * figure read beside Bangla marks and a Bangla rank, not an identifier.
 */
const gpaBn = (gpa: string | null): string =>
  gpa ? toBanglaDigits(Number(gpa).toFixed(2)) : '—';

/** "৪র্থ"; past the named ordinals, "১৩তম" rather than a bare "১৩". */
const rankBn = (n: number): string => (n <= 12 ? ordinalBn(n) : `${toBanglaDigits(n)}তম`);

/**
 * What a subject's grade letter means, for its colour (03 Student §04: A+/A
 * on --ok, A- on --warn). The letter itself is the word; a component failure
 * is also stated in the মন্তব্য column, never by the colour alone (F-812).
 */
function gradeMeaning(s: SubjectRow): 'ok' | 'warn' | 'danger' | 'none' {
  if (s.isAbsent) return 'none';
  if (s.componentFailed) return 'danger';
  if (s.gradePoint === null || s.gradePoint === '') return 'none';
  const gp = Number(s.gradePoint);
  if (!Number.isFinite(gp)) return 'none';
  if (gp >= 4) return 'ok';
  return gp > 0 ? 'warn' : 'danger';
}

export interface ResultsViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /**
   * Whose results. A guardian opens a CHILD's mark sheet, and the API reads
   * the caller's own id when none is given — a guardian has no results of
   * their own, so without this the screen said "nothing published" to every
   * parent. Absent for a student reading their own.
   */
  studentId?: string;
}

export class ResultsView {
  private readonly o: ResultsViewOptions;
  private readonly cacheKey: string;
  private results: Result[] = [];
  private selected: string | null = null;
  private loading = true;
  private offline = false;
  /**
   * The read failed and there is nothing cached to fall back on. Without
   * this an outage fell through to the EMPTY state and told a family that
   * nothing had been published — a false statement about their child.
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

  constructor(options: ResultsViewOptions) {
    this.o = options;
    // One cache per child: a guardian with two children must never be shown
    // the other child's marks while the network is slow. Still `shikhon_`
    // prefixed, so logout's purge clears every one of them.
    this.cacheKey = options.studentId ? `${CACHE_KEY}_${options.studentId}` : CACHE_KEY;
    this.results = this.readCache();
    this.selected = this.results[0]?.examId ?? null;
    this.loading = this.results.length === 0;
    this.render();
    void this.load();
  }

  private readCache(): Result[] {
    try {
      const raw = localStorage.getItem(this.cacheKey);
      const p = raw ? (JSON.parse(raw) as Result[]) : [];
      return Array.isArray(p) ? p : [];
    } catch { return []; }
  }

  private async load(): Promise<void> {
    try {
      const who = this.o.studentId ? `?studentId=${encodeURIComponent(this.o.studentId)}` : '';
      const res = await this.o.auth.authedFetch(`/api/v1/academics/results${who}`);
      await refuseUnlessOk(res);
      const body = (await res.json()) as { results?: Result[] };
      this.results = body.results ?? [];
      this.selected = this.selected && this.results.some((r) => r.examId === this.selected)
        ? this.selected
        : this.results[0]?.examId ?? null;
      this.offline = false;
      this.failed = false;
      try { localStorage.setItem(this.cacheKey, JSON.stringify(this.results)); } catch { /* quota */ }
    } catch (err) {
      if (isDenied(err)) {
        this.denied = true;
        this.deniedErr = err; this.results = []; this.offline = false;
        try { localStorage.removeItem(this.cacheKey); } catch { /* private mode */ }
        return;
      }
      if (this.results.length > 0) this.offline = true;
      else this.failed = true;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /** The error state's "আবার চেষ্টা করুন": the same read, run again. */
  private retry(): void {
    this.failed = false;
    this.loading = true;
    this.render();
    void this.load();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', 'bn');

    // The exam selector from §6.5's "[ প্রথম সাময়িক ▾ ]". A <select> rather
    // than a custom menu: it is one control, it works offline, and the native
    // picker is the one control every Android user already knows. Now a
    // `field()`, so it carries a visible label rather than an `aria-label`
    // only a screen reader ever meets.
    const picker = this.results.length > 1
      ? field(d, {
          label: 'পরীক্ষা',
          name: 'exam',
          kind: 'select',
          value: this.selected ?? undefined,
          className: 'exam-select-field',
          options: this.results.map((r) => ({ value: r.examId, label: r.examNameBn })),
          onChange: (v) => { this.selected = v; this.render(); },
        })
      : null;

    root.append(pageHeader(d, {
      title: 'ফলাফল',
      subtitle: 'প্রকাশিত পরীক্ষার ফলাফল ও মার্কশিট',
      actions: picker ? [picker.root] : undefined,
    }));

    // B-30. A refusal outranks the offline banner, the skeleton and the
    // empty state: nothing is loading, there is nothing to show, and
    // calling it "offline" is the lie this item exists to remove.
    if (this.denied) {
      root.append(permissionState(d, {
        message: deniedMessage(this.deniedErr, 'ফলাফল'),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }

    // Foundations §04: three grey rows, never a spinner.
    if (this.loading && this.results.length === 0) { root.append(listSkeleton(d, 3)); return; }

    if (this.failed && this.results.length === 0) {
      root.append(errorState(d,
        'ফলাফল আনা গেল না। ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।',
        () => this.retry()));
      return;
    }

    if (this.results.length === 0) {
      // Honest about WHY it is empty: a result exists but is not published
      // yet, and the family cannot see it until the school says so.
      root.append(emptyState(d, {
        glyph: 'award',
        message: 'এখনো কোনো ফলাফল প্রকাশিত হয়নি। স্কুল প্রকাশ করলে এখানে দেখা যাবে।',
      }));
      return;
    }

    const r = this.results.find((x) => x.examId === this.selected) ?? this.results[0];
    if (this.offline) {
      // A --warn-tint banner above the cached sheet (§7), not a grey chip
      // beside the title. This screen only reads, so nothing is queued and
      // there is no count to show.
      root.append(el(d, 'p', { className: 'offline-banner result-offline' },
        icon(d, 'wifi-off', 'offline-icon'),
        el(d, 'span', { text: 'অফলাইন — সংরক্ষিত ফলাফল' })));
    }
    root.append(this.sheet(r));
    const note = this.optionalFootnote(r);
    if (note) root.append(note);
    if (this.results.length > 1) root.append(this.trend());
  }

  /**
   * Hero, change strip and subject rows as ONE panel (03 §04, 04 §03): the
   * rounded shell clips the hero's ground, and the rows run straight on
   * under it. Named by the exam it shows.
   */
  private sheet(r: Result): HTMLElement {
    const d = this.o.doc;
    const examId = uid('result-exam');
    return el(d, 'section', { className: 'result-sheet', attrs: { 'aria-labelledby': examId } },
      this.summary(r, examId),
      this.trendNote(r),
      this.table(r));
  }

  /**
   * The hero: exam name, then GPA · grade · rank on one baseline, then the
   * publication date. A pass sits on --ok; a fail turns the ground --danger
   * and says so in words, with a count — never as colour the reader has to
   * interpret (F-812).
   */
  private summary(r: Result, examId: string): HTMLElement {
    const d = this.o.doc;
    const gpa = gpaBn(r.gpa);
    const rank = r.rankInSection ? `শ্রেণিতে ${rankBn(r.rankInSection)}` : null;
    const fail = r.subjectsFailed > 0
      ? `${bn(r.subjectsFailed)} বিষয়ে অকৃতকার্য`
      : 'অকৃতকার্য';
    return el(d, 'div', {
      className: 'result-hero', data: { outcome: r.isPass ? 'pass' : 'fail' },
    },
      el(d, 'p', { className: 'result-hero-exam', attrs: { id: examId } },
        ...numText(d, r.examNameBn)),
      el(d, 'div', { className: 'result-hero-row' },
        // The drawing prints the figures bare; the words a screen reader
        // needs to know which figure is which stay, visually hidden.
        el(d, 'span', { className: 'result-hero-gpa' },
          el(d, 'span', { className: 'ui-sr-only', text: 'GPA ', attrs: { lang: 'en' } }),
          el(d, 'span', { className: numClass('', gpa), text: gpa })),
        el(d, 'span', { className: 'result-hero-grade' },
          el(d, 'span', { className: 'ui-sr-only', text: 'গ্রেড ' }),
          r.letterGrade ?? '—'),
        rank ? el(d, 'span', { className: 'result-hero-rank' }, ...numText(d, rank)) : null),
      r.publishedAt
        ? el(d, 'p', { className: 'result-hero-date' },
            ...numText(d, `প্রকাশিত: ${bnDate(r.publishedAt)}`))
        : null,
      r.isPass
        ? null
        : el(d, 'p', { className: 'result-hero-fail' },
            icon(d, 'alert-triangle'),
            el(d, 'span', {}, ...numText(d, fail))));
  }

  /**
   * 04 Guardian §03's strip — "গত পরীক্ষার চেয়ে ০.২১ বেড়েছে". Derived from
   * the previous published exam, which this view already holds (the list is
   * newest first). Nothing to compare, nothing shown.
   */
  private trendNote(r: Result): HTMLElement | null {
    const d = this.o.doc;
    const i = this.results.indexOf(r);
    const prev = i >= 0 ? this.results[i + 1] : undefined;
    if (!prev || !r.gpa || !prev.gpa) return null;
    const now = Number(r.gpa);
    const was = Number(prev.gpa);
    if (!Number.isFinite(now) || !Number.isFinite(was)) return null;
    const delta = Math.round((now - was) * 100) / 100;
    const by = toBanglaDigits(Math.abs(delta).toFixed(2));
    const text = delta > 0
      ? `গত পরীক্ষার চেয়ে ${by} বেড়েছে`
      : delta < 0 ? `গত পরীক্ষার চেয়ে ${by} কমেছে` : 'গত পরীক্ষার সমান';
    // Drawn only where the set carries the glyph: a fall has no
    // trending-down in icon.ts yet, and the words carry it meanwhile.
    const glyph = delta > 0 ? 'trending-up' : delta < 0 ? 'trending-down' : '';
    return el(d, 'p', { className: 'result-trend-note' },
      glyph && hasIcon(glyph) ? icon(d, glyph) : null,
      el(d, 'span', {}, ...numText(d, text)));
  }

  /**
   * The subject rows. One declaration, two renderings (13 Responsive ০১):
   * on a phone each subject is the drawn row — name, total, grade — with the
   * component marks as its meta line; on a desktop, a table with a column
   * per component. Absent and component failure are stated in words.
   */
  private table(r: Result): HTMLElement {
    const d = this.o.doc;
    const anyPractical = r.subjects.some((s) => s.practicalMarks !== null);
    const anyCa = r.subjects.some((s) => s.caMarks !== null);
    const anyNote = r.subjects.some((s) => s.isAbsent || s.componentFailed);

    const figure = (className: string, text: string) =>
      el(d, 'span', { className: numClass(className, text), text });
    // One component mark. The visible label is for the phone's meta line,
    // where no header row names the figure; it is aria-hidden because the
    // list already gives a reader the column header, and hidden in the
    // desktop table, whose header says it.
    const part = (label: string, pick: (s: SubjectRow) => string | null) => (s: SubjectRow) =>
      el(d, 'span', { className: 'result-part' },
        el(d, 'span', {
          className: 'result-part-label', text: `${label} `, attrs: { 'aria-hidden': 'true' },
        }),
        figure('', s.isAbsent ? '—' : mark(pick(s))));

    const columns: Array<Column<SubjectRow>> = [
      {
        key: 'subject', header: 'বিষয়', mobile: 'title',
        // The superscript ⁴ the wireframe ties to the footnote below.
        cell: (s) => el(d, 'span', {}, s.subjectBn,
          s.requirementType === 'optional' ? el(d, 'sup', { className: 'n', text: '৪' }) : null),
      },
      { key: 'cq', header: 'CQ', numeric: true, mobile: 'meta', cell: part('CQ', (s) => s.cqMarks) },
      { key: 'mcq', header: 'MCQ', numeric: true, mobile: 'meta', cell: part('MCQ', (s) => s.mcqMarks) },
    ];
    if (anyPractical) {
      columns.push({
        key: 'practical', header: 'ব্যা.', numeric: true, mobile: 'meta',
        cell: part('ব্যা.', (s) => s.practicalMarks),
      });
    }
    if (anyCa) {
      columns.push({
        key: 'ca', header: 'ধারা.', numeric: true, mobile: 'meta',
        cell: part('ধারা.', (s) => s.caMarks),
      });
    }
    columns.push(
      {
        key: 'total', header: 'মোট', numeric: true, mobile: 'status',
        cell: (s) => figure('result-total', s.isAbsent ? '—' : mark(s.totalMarks)),
      },
      {
        key: 'grade', header: 'গ্রেড', mobile: 'status',
        cell: (s) => el(d, 'span', {
          className: 'result-grade',
          data: { grade: gradeMeaning(s) },
          text: s.isAbsent ? '—' : (s.gradeLetter ?? '—'),
        }),
      },
    );
    if (anyNote) {
      // Component failure is why a good total can still be a fail. It is
      // stated, not implied by a colour.
      columns.push({
        key: 'note', header: 'মন্তব্য', mobile: 'subtitle',
        cell: (s) => (s.isAbsent
          ? statusBadge(d, { state: 'absent', label: 'অনুপস্থিত' })
          : s.componentFailed
            ? statusBadge(d, { state: 'failed', label: 'উপাদানে অকৃতকার্য' })
            : null),
      });
    }

    return dataTable<SubjectRow>(d, {
      className: 'result-subjects',
      columns,
      rows: r.subjects,
      rowKey: (s) => s.subjectBn,
      caption: `${r.examNameBn} — বিষয়ভিত্তিক নম্বর`,
      empty: { glyph: 'award', message: 'এই পরীক্ষার বিষয়ভিত্তিক নম্বর এখনো আসেনি।' },
    });
  }

  /**
   * §6.5: "The optional-subject footnote is mandatory: it is the rule most
   * commonly misunderstood, and showing it prevents a support call."
   */
  private optionalFootnote(r: Result): HTMLElement | null {
    if (!r.subjects.some((s) => s.requirementType === 'optional')) return null;
    return el(this.o.doc, 'p', { className: 'result-optional-note' },
      ...numText(this.o.doc,
        '৪ চতুর্থ বিষয় — নির্ধারিত সীমার অতিরিক্ত গ্রেড পয়েন্ট মোট GPA-তে যোগ হয়েছে, '
        + 'এবং এই বিষয়টি বিষয়সংখ্যার হিসাবে ধরা হয়নি।'));
  }

  /** Trend across terms — §6.5's প্রবণতা row. Oldest first, so it reads left to right. */
  private trend(): HTMLElement {
    const d = this.o.doc;
    const list = el(d, 'ol', { className: 'result-history-list' });
    for (const r of [...this.results].reverse()) {
      const current = r.examId === this.selected;
      const gpa = gpaBn(r.gpa);
      list.append(el(d, 'li', {
        className: 'result-history-point',
        data: { current: current ? 'true' : undefined },
        attrs: { 'aria-current': current ? 'true' : null },
      },
        el(d, 'span', { className: numClass('result-history-gpa', gpa), text: gpa }),
        el(d, 'span', { className: 'result-history-exam' }, ...numText(d, r.examNameBn))));
    }
    return el(d, 'section', { className: 'result-history' },
      sectionHeading(d, { title: 'প্রবণতা' }),
      list);
  }
}
