/**
 * Class performance and students who may need support — wireframe §7.5,
 * F-1501 and F-1502. Drawn in Ata Ekta 02 Teacher §06 (desktop).
 *
 * See services/academics-svc/api/classperf.ts for why the question-level
 * panel is sourced from practice rather than from the exam, and for the
 * four structural consequences of F-1502's "soft signal, never a label".
 * This file's job is to not undo any of them in the markup.
 *
 * Three things here are deliberate and easy to "fix" into a violation:
 *
 *  • The attention list is not sorted, filtered or badged by severity. No
 *    red for the worst child. The signals carry their own numbers, and
 *    that is the whole of the emphasis.
 *
 *  • Every student's signals are shown in full. A "+২ আরও" affordance
 *    would turn the panel into a summary of a child, which is a label.
 *
 *  • The heading is §7.5's exact phrasing — "সহায়তা প্রয়োজন হতে পারে",
 *    may need support. Not "দুর্বল শিক্ষার্থী", not "ঝুঁকিতে". The
 *    conditional is the point, and it is why the panel can exist at all.
 *    That includes the class-level count in the stat strip: the design's
 *    "সহায়তা লাগবে" is the verdict form, so the count carries the
 *    conditional label and no colour.
 *
 * ── Ata Ekta §06 ─────────────────────────────────────────────────────────
 * The drawing is one desk: a title bar with the exam as a neutral chip, a
 * stat strip, then a panel with an eyebrow, one bar per row and a callout
 * sentence that writes the conclusion so the teacher does not have to. The
 * picker, the practice panel and the attention panel are not drawn and take
 * the same panel treatment. What is not built, and why, is in the unit's
 * `deferred` record: the drawn four whole-exam figures and chapter axes are
 * not in this payload, and রপ্তানি has no function behind it.
 */
import type { Auth } from './auth.ts';
import {
  pageHeader, card as uiCard, dataTable, field, statRow, statCard, listSkeleton, el,
  badge, numText, uid, permissionState, permissionMessage, serverMessage, deniedContact,
  type Child,
} from './ui/index.ts';
import { emptyState, errorState } from './view-states.ts';
import { toBanglaDigits, formatIdentifier } from '../../../packages/ui-core/src/format.ts';

type Choice = { examSubjectId: string; label: string };
type Component = { key: string; labelBn: string; max: number; average: number | null; percent: number | null };
type Question = { questionNo: number; kind: string; stemBn: string; chapterBn: string; attempts: number; wrongPercent: number };
type Attention = { studentId: string; nameBn: string; rollNo: number; signals: string[] };
type Thresholds = { attendanceFloorPercent: number; streakDays: number; markDropPoints: number; windowDays: number };
type Analysis = {
  header: { examSubjectId: string; label: string };
  coverage: { marked: number; enrolled: number; absent: number };
  components: Component[];
  practice: { questions: Question[]; reteach: { chapterBn: string; questionCount: number } | null; source: string };
  attention: Attention[];
  thresholds: Thresholds;
};
type Payload = { choices: Choice[]; analysis: Analysis | null };

export interface ClassPerfViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

const LAST_KEY = 'shikhon_last_perf_exam';
const TITLE = 'শ্রেণির ফলাফল বিশ্লেষণ';
/** What a refusal names — "শ্রেণির বিশ্লেষণ দেখার অনুমতি আপনার নেই।" (B-30). */
const SUBJECT = 'শ্রেণির বিশ্লেষণ';
/**
 * Half the component's own maximum. The only threshold this screen draws,
 * and it earns its colour because NCTB pass marks are per component: a
 * class under 50 on CQ is heading for component failures whatever the
 * totals say.
 */
const LOW_PERCENT = 50;

export class ClassPerfView {
  private readonly o: ClassPerfViewOptions;
  private choices: Choice[] = [];
  private analysis: Analysis | null = null;
  private selected = '';
  private loading = true;
  private failed = false;
  private denied = false;
  private deniedMsg = '';
  private deniedWho: string | undefined = undefined;

  constructor(options: ClassPerfViewOptions) {
    this.o = options;
    // Explicit null check. '' is a real "nothing chosen yet" and
    // localStorage returning null must not be coerced into it silently.
    const stored = localStorage.getItem(LAST_KEY);
    this.selected = stored === null ? '' : stored;
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.failed = false;
    this.denied = false;
    this.render();
    try {
      const qs = this.selected ? `?examSubjectId=${encodeURIComponent(this.selected)}` : '';
      const res = await this.o.auth.authedFetch(`/api/v1/academics/classperf${qs}`);
      if (res.status === 403) {
        // A refusal is not a failed fetch: retrying it is futile, and the
        // person needs to know who can help — or, for a school without the
        // reports module, that nobody at the school can.
        const b = await res.json().catch(() => ({})) as { error?: string; message?: string };
        this.deniedMsg = serverMessage(b, 403, permissionMessage(SUBJECT), SUBJECT);
        this.deniedWho = deniedContact({ code: b.error });
        this.denied = true;
      } else {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Payload;
        this.choices = body.choices;
        this.analysis = body.analysis;
      }
    } catch {
      this.failed = true;
    }
    this.loading = false;
    this.render();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // §06's bar: the title, and on the right the exam being read as a
    // neutral chip. Only while an analysis is actually on screen — a chip
    // over a skeleton or a refusal would name an exam nobody is looking at.
    const shown = !this.loading && !this.failed && !this.denied ? this.analysis : null;
    root.append(pageHeader(d, {
      title: TITLE,
      actions: shown
        ? [badge(d, { label: shown.header.label, tone: 'neutral', className: 'perf-exam' })]
        : undefined,
    }));

    if (this.loading) { root.append(listSkeleton(d, 3)); return; }
    if (this.denied) {
      // The whole answer. No picker and no retry under it.
      root.append(permissionState(d, { message: this.deniedMsg, contact: this.deniedWho }));
      return;
    }
    if (this.failed) {
      root.append(errorState(d, 'বিশ্লেষণ আনা যায়নি। সংযোগ পেলে আবার চেষ্টা করুন।',
        () => void this.load()));
      return;
    }
    if (this.choices.length === 0) {
      root.append(emptyState(d, {
        message: 'এখনো কোনো পরীক্ষার নম্বর দেওয়া হয়নি। নম্বর দেওয়া শেষ হলে এখানে '
          + 'শ্রেণির বিশ্লেষণ দেখা যাবে।',
      }));
      return;
    }

    root.append(this.picker());

    if (!this.analysis) {
      root.append(emptyState(d, {
        message: 'উপরের তালিকা থেকে শ্রেণি ও পরীক্ষা বেছে নিলে বিশ্লেষণ দেখা যাবে।',
      }));
      return;
    }
    const a = this.analysis;
    root.append(this.stats(a));
    root.append(this.componentPanel(a.components));
    root.append(this.practicePanel(a.practice));
    root.append(this.attentionPanel(a.attention, a.thresholds, a.coverage.enrolled));
  }

  private picker(): HTMLElement {
    // A visible label, not an `aria-label`. The old control announced itself
    // to a screen reader and told a sighted teacher nothing until they opened
    // it — which on this screen is the difference between "an exam" and
    // "which exam am I looking at".
    const f = field(this.o.doc, {
      label: 'শ্রেণি ও পরীক্ষা',
      name: 'examSubject',
      kind: 'select',
      value: this.selected,
      helper: 'বাছাই মনে রাখা হয় — পরের বার এই পাতাতেই ফিরে আসবেন।',
      options: [
        { value: '', label: '— শ্রেণি ও পরীক্ষা বেছে নিন —' },
        ...this.choices.map((c) => ({ value: c.examSubjectId, label: c.label })),
      ],
      onChange: (v) => {
        this.selected = v;
        localStorage.setItem(LAST_KEY, this.selected);
        void this.load();
      },
      className: 'perf-picker',
    });
    return f.root;
  }

  /**
   * The stat strip. Every average below is over the marked students only.
   * Saying so once, up front, is cheaper than a footnote on each number, and
   * it stops a half-marked exam from reading as a bad result.
   */
  private stats(a: Analysis): HTMLElement {
    const d = this.o.doc;
    const c = a.coverage;
    const all = c.marked >= c.enrolled;
    // Figures, because the whole screen is qualified by them: an average over
    // 12 of 40 children is not the class's average, and a teacher must see
    // that before reading anything below. A tone only where the note beside
    // it says what the colour means.
    return statRow(d,
      statCard(d, {
        label: 'নম্বর দেওয়া হয়েছে', value: `${bn(c.marked)} / ${bn(c.enrolled)}`,
        tone: all ? 'success' : 'warn',
        note: all ? 'সবার নম্বর আছে' : 'নিচের সব গড় কেবল এদের নিয়ে',
      }),
      statCard(d, {
        label: 'অনুপস্থিত', value: `${bn(c.absent)} জন`,
        tone: c.absent > 0 ? 'warn' : undefined,
        note: c.absent > 0 ? 'হিসাবের বাইরে' : undefined,
      }),
      // F-1502: a count of the class, never of a child, and never coloured.
      statCard(d, {
        label: 'সহায়তা প্রয়োজন হতে পারে', value: `${bn(a.attention.length)} জন`,
        note: 'কেবল ইঙ্গিত — রায় নয়',
      }),
    );
  }

  /** Exam component averages. Real exam data, so it leads. */
  private componentPanel(components: Component[]): HTMLElement {
    const title = 'পরীক্ষার অংশভিত্তিক ফল';
    if (components.length === 0) {
      return this.panel(title, this.note('এই পরীক্ষার কোনো নম্বর পাওয়া যায়নি।'));
    }
    const d = this.o.doc;
    const bars = el(d, 'div', { className: 'perf-bars' },
      ...components.map((c) => this.bar(c)));
    return this.panel(title, bars, this.weakest(components));
  }

  private bar(c: Component): HTMLElement {
    const d = this.o.doc;
    const low = c.percent !== null && c.percent < LOW_PERCENT;

    const fill = el(d, 'span', { className: 'perf-bar-fill' });
    // A null average means nobody holds a mark for this component — an
    // empty track, not a zero-width bar labelled ০%.
    fill.style.width = `${c.percent ?? 0}%`;
    if (low) fill.dataset.tone = 'low';
    // The figure beside it says everything the length does.
    const track = el(d, 'span', { className: 'perf-bar-track', attrs: { 'aria-hidden': 'true' } }, fill);

    const value = el(d, 'span', {
      className: 'perf-bar-value',
      data: { level: c.percent === null ? 'none' : low ? 'low' : undefined },
    });
    if (c.percent === null) {
      value.append(el(d, 'span', { className: 'perf-bar-pct', text: '—' }));
    } else {
      // §06 draws one bold figure coloured like its bar. The average over the
      // component's own maximum stays beside it, quieter — the percentage
      // alone hides whether "৪৫%" is 11 of 25 or 45 of 100.
      value.append(
        el(d, 'span', { className: 'perf-bar-pct n', text: `${bn(c.percent)}%` }),
        ' ',
        el(d, 'span', { className: 'perf-bar-avg n', text: `গড় ${bn(c.average ?? 0)}/${bn(c.max)}` }),
      );
    }

    return el(d, 'div', { className: 'perf-bar' },
      el(d, 'span', { className: 'perf-bar-label' }, ...numText(d, c.labelBn)),
      track, value);
  }

  /**
   * §06's callout: the sentence that writes the conclusion. It restates, in
   * words, the one threshold the bars already colour — so the red is never
   * the only thing saying "below half" — and names the weakest part. Nothing
   * below half, nothing to conclude, no callout.
   */
  private weakest(components: Component[]): HTMLElement | null {
    const low = components.filter(
      (c): c is Component & { percent: number } => c.percent !== null && c.percent < LOW_PERCENT);
    if (low.length === 0) return null;
    const w = low.reduce((min, c) => (c.percent < min.percent ? c : min));
    const measured = components.filter((c) => c.percent !== null).length;

    let text: string;
    if (low.length === 1) {
      text = measured > 1
        ? `${w.labelBn} অংশে গড় ${bn(w.percent)}% — এই পরীক্ষার সবচেয়ে দুর্বল অংশ, পূর্ণমানের অর্ধেকের কম।`
        : `${w.labelBn} অংশে গড় ${bn(w.percent)}% — পূর্ণমানের অর্ধেকের কম।`;
    } else {
      text = `${joinBn(low.map((c) => c.labelBn))} — এই ${bn(low.length)}টি অংশে গড় পূর্ণমানের অর্ধেকের কম। `
        + `সবচেয়ে দুর্বল ${w.labelBn}, গড় ${bn(w.percent)}%।`;
    }
    const d = this.o.doc;
    return el(d, 'p', { className: 'perf-callout' }, ...numText(d, text));
  }

  /**
   * §7.5's question-level panel. Labelled অনুশীলন in the heading and again
   * in the note, because a teacher who reads these as exam questions is
   * reading about a self-selected cohort and does not know it.
   */
  private practicePanel(p: Analysis['practice']): HTMLElement {
    const d = this.o.doc;
    const title = 'অনুশীলনে যে প্রশ্নগুলো সবচেয়ে বেশি ভুল হয়েছে';
    const source = this.note('অনুশীলনের উত্তর থেকে — পরীক্ষার খাতা থেকে নয়। যারা অনুশীলন করেছে কেবল তাদের হিসাব।');

    if (p.questions.length === 0) {
      return this.panel(title, source,
        this.note('এই বিষয়ে যথেষ্ট অনুশীলন হয়নি, তাই প্রশ্নভিত্তিক হিসাব দেওয়া যাচ্ছে না।'));
    }

    // The wrong-percentage is what this panel is FOR, so it is a sortable
    // column rather than the third clause of a sentence.
    const table = dataTable(d, {
      caption: 'অনুশীলনে সবচেয়ে বেশি ভুল হওয়া প্রশ্ন',
      // On a phone the question is the list title, and the sheet clamps a
      // list title to one line. These rows open nothing, so a clamped stem
      // could never be read in full, and the stem is the whole panel.
      // `perf-table` scopes the rule that lets the title wrap (13 Responsive:
      // nothing is dropped on a phone).
      className: 'perf-table',
      rows: p.questions,
      rowKey: (q) => String(q.questionNo),
      columns: [
        { key: 'q', header: 'প্রশ্ন', mobile: 'title',
          cell: (q) => `প্রশ্ন ${bn(q.questionNo)} — ${q.stemBn}`,
          width: 'minmax(0, 3fr)' },
        { key: 'ch', header: 'অধ্যায়', mobile: 'subtitle', cell: (q) => q.chapterBn,
          width: 'minmax(0, 1.4fr)' },
        { key: 'wrong', header: 'ভুল', mobile: 'meta', numeric: true,
          cell: (q) => `${bn(q.wrongPercent)}%`, width: '110px' },
        { key: 'n', header: 'কতজন করেছে', mobile: 'meta', numeric: true,
          cell: (q) => bn(q.attempts), width: '130px' },
      ],
    });

    // This panel's conclusion, in the callout shape §06 gives a conclusion.
    const hint = p.reteach
      ? el(d, 'p', { className: 'perf-reteach' }, ...numText(d,
        `${p.reteach.chapterBn} — এই অধ্যায়ের ${bn(p.reteach.questionCount)}টি প্রশ্নে বেশি ভুল হয়েছে। পুনরায় আলোচনা করা যেতে পারে।`))
      : null;
    return this.panel(title, source, table, hint);
  }

  /**
   * F-1502. The heading, the stated method and the absence of any ranking
   * are the feature; the list itself is almost incidental.
   */
  private attentionPanel(rows: Attention[], t: Thresholds, enrolled: number): HTMLElement {
    const d = this.o.doc;
    const title = 'যাদের সহায়তা প্রয়োজন হতে পারে';

    // The method is printed so a teacher can disagree with it. A signal
    // whose derivation is hidden is an accusation.
    const method = this.note(
      'এটি কেবল একটি ইঙ্গিত — কোনো রায় নয়, এবং কোথাও সংরক্ষণ করা হয় না। '
      + `হিসাব: গত ${bn(t.windowDays)} দিনে হাজিরা ${bn(t.attendanceFloorPercent)}%-এর কম, `
      + `অথবা টানা ${bn(t.streakDays)} দিন অনুপস্থিত, `
      + `অথবা গত পরীক্ষার চেয়ে নম্বর ${bn(t.markDropPoints)}% বা তার বেশি কম।`,
    );

    if (rows.length === 0) {
      return this.panel(title, method, this.note('এই মুহূর্তে কারও ক্ষেত্রে এই ইঙ্গিতগুলো মেলেনি।'));
    }

    // If half the class trips the thresholds, the honest reading is that
    // something happened to the class, not to the children — a lost
    // fortnight, a teacher on leave. Saying so stops a teacher working
    // down thirty names one at a time looking for thirty causes.
    const wide = enrolled > 0 && rows.length * 2 >= enrolled
      ? el(d, 'p', { className: 'perf-wide-note' }, ...numText(d,
        `শ্রেণির ${bn(rows.length)} জন — প্রায় অর্ধেক বা তার বেশি — এই ইঙ্গিতে পড়েছে। `
        + 'এটি সাধারণত এক-একজনের নয়, পুরো শ্রেণির কোনো ঘটনার ইঙ্গিত।'))
      : null;

    const table = dataTable(d, {
      caption: 'যাদের সহায়তা প্রয়োজন হতে পারে',
      // Same reason as the practice table: a static row, so a long name
      // wraps on a phone instead of ending in "…".
      className: 'perf-table',
      rows,
      rowKey: (r) => String(r.rollNo),
      columns: [
        // A roll is an identifier, read against the paper register: Latin.
        { key: 'roll', header: 'রোল', mobile: 'meta', numeric: true,
          cell: (r) => formatIdentifier(r.rollNo), width: '90px' },
        { key: 'name', header: 'নাম', mobile: 'title', cell: (r) => r.nameBn,
          width: 'minmax(0, 1.6fr)' },
        // Every signal, in full. A count would turn a list of reasons into a
        // score, and a score is the ranking this feature deliberately has not
        // got.
        { key: 'why', header: 'কেন', mobile: 'subtitle', width: 'minmax(0, 3fr)',
          cell: (r) => el(d, 'ul', { className: 'perf-att-signals' },
            ...r.signals.map((sig) => el(d, 'li', { text: sig }))) },
      ],
    });
    return this.panel(title, method, wide, table);
  }

  /**
   * One §06 panel: a flat surface whose heading is the drawn eyebrow. Still
   * an <h2>, so the outline stays page title → panel, and the section still
   * names itself for a reader.
   */
  private panel(title: string, ...body: Child[]): HTMLElement {
    const d = this.o.doc;
    const id = uid('perf');
    const heading = el(d, 'h2', { className: 'label perf-eyebrow', attrs: { id } }, ...numText(d, title));
    const section = uiCard(d, { className: 'perf-card' }, heading, ...body);
    section.setAttribute('aria-labelledby', id);
    return section;
  }

  private note(text: string): HTMLElement {
    return el(this.o.doc, 'p', { className: 'ui-card-note perf-note' }, ...numText(this.o.doc, text));
  }
}

function bn(n: number): string {
  return toBanglaDigits(n);
}

/** "ক", "ক ও খ", "ক, খ ও গ". */
function joinBn(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ও ${items[items.length - 1]}`;
}
