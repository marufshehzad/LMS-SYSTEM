/**
 * ফলাফল প্রকাশ — the result-publishing workflow  (R-3, Part H)
 *
 * `POST /api/v1/academics/publish` has existed since the assessment phase and
 * had **no caller anywhere in the app**. D13's audit found it: `results-view`
 * reads published results, and nothing in the product published them. Which
 * also meant R-2's results auto-notice could only fire from an API client.
 * This is the missing screen.
 *
 * ── Publishing is not a button, it is a review ─────────────────────────
 *     পরীক্ষা → ফলাফল → যাচাই → প্রকাশ → নিশ্চিতকরণ
 *
 * Because publication is irreversible in a way most mutations are not: the
 * `block_published_mark_update` trigger makes every mark immutable afterwards,
 * and corrections then require an approved `mark_corrections` row. A school
 * that publishes with three subjects unmarked has not made a mistake it can
 * quietly fix.
 *
 * So the screen shows completeness BEFORE the button, per subject, and the
 * barrier names what is missing rather than asking "are you sure?".
 *
 * ── Ata Ekta (05 Principal §05, IMPLEMENTATION §7, R11) ─────────────────
 * The drawing is one exam: the bar names it in a neutral chip, then the
 * `irreversiblePanel` — what cannot be undone on --danger-tint, the
 * "প্রকাশের আগে যাচাই" checklist with the payload's real counts, and a foot
 * where "আমি বুঝেছি এটি ফেরানো যাবে না" unlocks the one primary. The tick IS
 * the confirmation; there is no second dialog after it.
 *
 * When more than one exam is waiting, a tab strip over the exams already
 * loaded chooses which one the panel shows — so the page never carries more
 * than one primary button (R5), and each exam keeps its own tick.
 *
 * ── It does not compute anything ───────────────────────────────────────
 * Grades, GPA, ranks and the guardian notice all happen inside the endpoint's
 * single transaction, using the board-rule functions from migration 005. This
 * view sends an exam id and reports what came back. Recomputing a GPA here to
 * show a preview would be a second implementation of the board's rules, and
 * the two would disagree on the child whose result was borderline.
 */
import type { Auth } from './auth.ts';
import {
  skeleton, errorState, emptyState, successNote, bnNum,
} from './view-states.ts';
import {
  pageHeader, sectionHeading, card, button, dataTable, statusBadge, badge,
  tabs, irreversiblePanel, permissionState, el, icon,
  type IrreversibleItem,
} from './ui/index.ts';

interface ExamRow {
  examId: string;
  examNameBn: string;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  subjects: {
    examSubjectId: string; subjectBn: string; sectionName: string | null;
    enrolled: number; marked: number;
  }[];
}

export interface PublishViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/**
 * How far along an exam is, for choosing which waiting exam the tab strip
 * opens on. `exam_status` order from migration 005; an exam still being
 * marked is closer to publication than one not yet sat.
 */
const STAGE = ['planned', 'ongoing', 'marking', 'moderation'];

export class PublishView {
  private readonly o: PublishViewOptions;
  private exams: ExamRow[] = [];
  private loading = true;
  private denied = false;
  private error = '';
  /** A publish that never reached the server: said as offline, not as a fault. */
  private offline = false;
  private notice = '';
  private busy = '';
  private expanded = new Set<string>();
  /** Exams whose "আমি বুঝেছি" box is ticked — survives the view's re-render. */
  private acked = new Set<string>();
  /** The waiting exam the panel shows when there is more than one. */
  private selected = '';
  /** A control the last render replaced under the user's focus. */
  private refocus: { kind: 'tab' | 'toggle'; id: string } | null = null;

  constructor(options: PublishViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.denied = false; this.error = ''; this.offline = false;
    // A tick acknowledges the counts it was given. A reload can change them.
    this.acked.clear();
    this.render();
    try {
      // GET on the publish endpoint itself — publication readiness lives
      // with publication, not with the section-scoped marks-entry read.
      const res = await this.o.auth.authedFetch('/api/v1/academics/publish');
      if (res.status === 403) { this.denied = true; return; }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { exams?: ExamRow[] };
      this.exams = body.exams ?? [];
    } catch {
      this.error = 'পরীক্ষার তালিকা আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false; this.render();
    }
  }

  private async publish(exam: ExamRow): Promise<void> {
    this.busy = exam.examId; this.error = ''; this.offline = false; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId: exam.examId }),
      });
      const body = await res.json() as {
        resultsPublished?: number; notified?: number; message?: string; error?: string;
      };
      if (!res.ok) {
        this.error = body.error === 'already_published'
          ? 'এই পরীক্ষার ফলাফল ইতিমধ্যে প্রকাশিত।'
          : body.message ?? 'ফলাফল প্রকাশ করা যায়নি।';
        return;
      }
      // Naming the notified count matters: it is the visible proof that R-2's
      // machinery ran, and it is the number a head teacher will be asked
      // about when a guardian says they were not told.
      this.notice =
        `${bnNum(body.resultsPublished ?? 0)} জনের ফলাফল প্রকাশিত হয়েছে` +
        (body.notified ? ` · ${bnNum(body.notified)} জনকে জানানো হয়েছে।` : '।');
      await this.load();
    } catch {
      // Nothing is queued: publication happens online or not at all. The tick
      // stays, so the primary is the retry once the connection is back.
      this.error = 'সংযোগ নেই — ফলাফল প্রকাশ করা যায়নি।';
      this.offline = true;
    } finally {
      this.busy = ''; this.render();
    }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    const pending = this.exams.filter((e) => e.status !== 'published');
    const published = this.exams.filter((e) => e.status === 'published');
    const ready = !this.loading && !this.denied;

    // 05 §05's bar: the title, and one neutral chip naming the exam being
    // published. With several waiting, the tab strip names them instead.
    root.append(pageHeader(d, {
      title: 'ফলাফল প্রকাশ',
      actions: ready && pending.length === 1
        ? [badge(d, { label: pending[0].examNameBn, tone: 'neutral', className: 'pub-exam-chip' })]
        : undefined,
    }));

    if (this.notice) root.append(successNote(d, this.notice));

    if (this.denied) {
      root.append(permissionState(d, {
        message: 'ফলাফল প্রকাশের অনুমতি আপনার নেই।',
        contact: 'প্রধান শিক্ষক',
      }));
      return;
    }

    if (this.error) {
      if (this.offline) {
        root.append(el(d, 'p', {
          className: 'offline-banner pub-alert', attrs: { role: 'alert' },
        }, icon(d, 'wifi-off', 'offline-icon'), el(d, 'span', { text: this.error })));
      } else {
        const err = errorState(d, this.error, () => void this.load());
        err.classList.add('pub-alert');
        root.append(err);
      }
      // A list that failed to load is not a school with no exams.
      if (this.exams.length === 0 && !this.loading) return;
    }

    if (this.loading) { root.append(skeleton(d, 3)); return; }

    if (this.exams.length === 0) {
      root.append(emptyState(d, {
        glyph: 'clipboard',
        message: 'এই শিক্ষাবর্ষে কোনো পরীক্ষা তৈরি হয়নি। পরীক্ষা ও নম্বর যোগ হলে এখানে প্রকাশ করা যাবে।',
        action: { label: 'পরীক্ষা তৈরি করুন', onClick: () => this.go('exams') },
      }));
      return;
    }

    if (pending.length === 0) {
      root.append(emptyState(d, {
        glyph: 'award',
        message: 'প্রকাশের অপেক্ষায় কোনো পরীক্ষা নেই।',
        action: { label: 'ফলাফল দেখুন', onClick: () => this.go('results') },
      }));
    } else {
      const exam = this.current(pending);
      const multi = pending.length > 1;
      if (multi) {
        root.append(tabs(d, {
          label: 'প্রকাশের অপেক্ষায় পরীক্ষা',
          className: 'pub-tabs',
          active: exam.examId,
          items: pending.map((e) => ({ id: e.examId, label: e.examNameBn })),
          onSelect: (id) => {
            if (id === this.selected) return;
            this.selected = id;
            this.refocus = { kind: 'tab', id };
            this.render();
          },
        }));
      }
      root.append(el(d, 'div', {
        className: 'pub-stage',
        attrs: multi ? { role: 'tabpanel', 'aria-labelledby': `tab-${exam.examId}` } : {},
      }, this.publishPanel(exam)));
    }

    if (published.length > 0) {
      root.append(el(d, 'div', { className: 'pub-published' },
        sectionHeading(d, { title: 'প্রকাশিত' }),
        ...published.map((e) => this.publishedCard(e))));
    }

    this.restoreFocus();
  }

  /** The waiting exam on show: the chosen one, else the one furthest along. */
  private current(pending: ExamRow[]): ExamRow {
    const chosen = pending.find((e) => e.examId === this.selected);
    if (chosen) return chosen;
    let best = pending[0];
    for (const e of pending) {
      if (STAGE.indexOf(e.status) > STAGE.indexOf(best.status)) best = e;
    }
    this.selected = best.examId;
    return best;
  }

  /** The exam's irreversible panel: warning, real counts, tick, primary. */
  private publishPanel(exam: ExamRow): HTMLElement {
    const d = this.o.doc;
    const id = exam.examId;
    const busy = this.busy === id;
    const total = exam.subjects.length;
    const totalEnrolled = exam.subjects.reduce((n, s) => n + s.enrolled, 0);
    const totalMarked = exam.subjects.reduce((n, s) => n + s.marked, 0);
    const incomplete = exam.subjects.filter((s) => s.marked < s.enrolled);
    const complete = total - incomplete.length;

    // 05 §05's checklist, from the GET payload only. Its "গ্রেড হিসাব" and
    // "এসএমএস খরচ" rows have no source here: grades are computed inside the
    // publish transaction, and the payload carries no recipient or cost.
    const items: IrreversibleItem[] = [];
    if (total === 0) {
      items.push({
        text: 'এই পরীক্ষায় কোনো বিষয় যুক্ত করা হয়নি',
        meta: `${bnNum(0)} বিষয়`, tone: 'warn',
      });
    } else if (incomplete.length === 0) {
      items.push({
        text: 'সব বিষয়ের নম্বর দেওয়া হয়েছে',
        meta: `${bnNum(complete)} / ${bnNum(total)} বিষয়`, tone: 'success',
      });
    } else {
      items.push({
        text: 'নম্বর সম্পূর্ণ হয়েছে',
        meta: `${bnNum(complete)} / ${bnNum(total)} বিষয়`, tone: 'warn', glyph: 'clock',
      });
    }
    const allMarked = totalEnrolled > 0 && totalMarked >= totalEnrolled;
    items.push({
      text: 'নম্বর দেওয়া হয়েছে',
      meta: `${bnNum(totalMarked)} / ${bnNum(totalEnrolled)}`,
      tone: allMarked ? 'success' : 'warn',
      glyph: allMarked ? undefined : 'clock',
    });
    if (incomplete.length > 0) {
      // The part that is wrong, with its number, before the button.
      items.push({
        text: 'নম্বর বাকি',
        meta: `${bnNum(incomplete.length)} টি বিষয়ে`, tone: 'danger',
      });
    }

    const open = this.expanded.has(id);
    // The drawing's secondary sits here. It is the per-subject view — the
    // "validate" step, visible before the button and never reported after it.
    const toggle = button(d, {
      label: open ? 'বিষয়ভিত্তিক অবস্থা লুকান' : 'বিষয়ভিত্তিক অবস্থা দেখুন',
      variant: 'secondary',
      attrs: { 'aria-expanded': String(open), 'data-pub-toggle': id },
      onClick: () => this.toggle(id),
    });

    const publishBtn = button(d, {
      label: 'প্রকাশ করুন',
      variant: 'primary',
      busy,
      onClick: () => {
        if (!this.acked.has(id) || this.busy) return;
        void this.publish(exam);
      },
    });

    const gate = irreversiblePanel(d, {
      statement: 'প্রকাশের পর নম্বর আর বদলানো যাবে না',
      detail: 'প্রকাশ হলেই শিক্ষার্থী ও তাদের অভিভাবক ফল দেখতে পাবেন এবং তাদের জানানো হবে।',
      listLabel: 'প্রকাশের আগে যাচাই',
      items,
      confirm: publishBtn,
      actions: [toggle, publishBtn],
      className: 'pub-irrev',
      onChange: (ticked) => {
        if (ticked) this.acked.add(id); else this.acked.delete(id);
      },
    });
    gate.root.dataset.exam = id;
    // A re-render (the subject toggle, a failed publish) keeps the tick.
    gate.input.checked = this.acked.has(id);
    gate.input.disabled = busy;
    publishBtn.disabled = busy || !gate.input.checked;

    if (open) gate.root.querySelector('.irrev-body')?.append(this.subjectTable(exam));
    return gate.root;
  }

  /** History. Not drawn in 05 §05; kept as the card it has always been. */
  private publishedCard(exam: ExamRow): HTMLElement {
    const d = this.o.doc;
    const totalEnrolled = exam.subjects.reduce((n, s) => n + s.enrolled, 0);
    const totalMarked = exam.subjects.reduce((n, s) => n + s.marked, 0);
    const open = this.expanded.has(exam.examId);

    const toggle = button(d, {
      label: open ? 'বিষয়ভিত্তিক অবস্থা লুকান' : 'বিষয়ভিত্তিক অবস্থা দেখুন',
      variant: 'ghost', size: 'sm',
      attrs: { 'aria-expanded': String(open), 'data-pub-toggle': exam.examId },
      onClick: () => this.toggle(exam.examId),
    });

    return card(d, {
      title: exam.examNameBn,
      subtitle: `${bnNum(exam.subjects.length)} বিষয় · নম্বর দেওয়া হয়েছে ` +
                `${bnNum(totalMarked)} / ${bnNum(totalEnrolled)}`,
      glyph: 'award',
      action: statusBadge(d, { state: 'published', label: 'প্রকাশিত' }),
      headingLevel: 3,
      className: 'pub-card',
    }, toggle, open ? this.subjectTable(exam) : null);
  }

  /** Per-subject completeness: a table at desktop, a list on a phone. */
  private subjectTable(exam: ExamRow): HTMLElement {
    const d = this.o.doc;
    return dataTable(d, {
      caption: `${exam.examNameBn} — বিষয়ভিত্তিক অবস্থা`,
      rows: exam.subjects,
      rowKey: (sub) => `${sub.subjectBn}-${sub.sectionName ?? ''}`,
      empty: { message: 'এই পরীক্ষায় কোনো বিষয় যুক্ত করা হয়নি।' },
      className: 'pub-subjects',
      columns: [
        { key: 'subject', header: 'বিষয়', mobile: 'title',
          cell: (sub) => sub.subjectBn, width: 'minmax(0, 2fr)' },
        { key: 'section', header: 'সেকশন', mobile: 'subtitle',
          cell: (sub) => sub.sectionName || '—', width: 'minmax(0, 1fr)' },
        { key: 'done', header: 'নম্বর দেওয়া', mobile: 'meta', numeric: true,
          cell: (sub) => `${bnNum(sub.marked)} / ${bnNum(sub.enrolled)}`,
          width: 'minmax(0, 1.2fr)' },
        { key: 'state', header: 'অবস্থা', mobile: 'status', width: '130px',
          cell: (sub) => (sub.marked < sub.enrolled
            ? statusBadge(d, { state: 'partial', label: 'অসম্পূর্ণ' })
            : statusBadge(d, { state: 'published', label: 'সম্পূর্ণ' })) },
      ],
    });
  }

  private toggle(id: string): void {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this.refocus = { kind: 'toggle', id };
    this.render();
  }

  /**
   * The render replaces every node, including the control that was just
   * pressed. Put focus back on its replacement, so a keyboard user is not
   * thrown to the top of the page by opening a table.
   */
  private restoreFocus(): void {
    const want = this.refocus;
    this.refocus = null;
    if (!want) return;
    const selector = want.kind === 'tab' ? '[role="tab"]' : '[data-pub-toggle]';
    for (const node of this.o.root.querySelectorAll<HTMLElement>(selector)) {
      const key = want.kind === 'tab' ? node.dataset.id : node.dataset.pubToggle;
      if (key === want.id) { node.focus(); return; }
    }
  }

  /** The empty states' next step: a route this role already has beside publish. */
  private go(path: string): void {
    const w = this.o.doc.defaultView;
    if (w) w.location.hash = `#/${path}`;
  }
}
