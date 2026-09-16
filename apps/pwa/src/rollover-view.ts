/**
 * বার্ষিক উন্নয়ন — the year-end promotion  (R-3, Part G)
 *
 * The single most consequential button in the product: it moves every child in
 * the school into next year, once, and there is no undo.
 *
 *     ২০২৬ → ২০২৭ প্রস্তুত → পূর্বরূপ → পর্যালোচনা → নিশ্চিতকরণ
 *
 * ── Three steps, and the middle one exists for a reason ────────────────
 * Preview is read-only and can be run all day. "Plan" freezes the counts into
 * `year_rollovers`, and only then is the commit button offered. That is so the
 * numbers on the confirmation are the numbers the DATABASE agreed to a moment
 * ago, not numbers this browser remembered from a request made before somebody
 * else enrolled three students.
 *
 * ── Blocked students stop everything, by design ────────────────────────
 * `app.commit_rollover` refuses while any student is blocked rather than
 * skipping them, because a rollover that quietly left thirty children behind
 * is discovered in March by a teacher whose register is short. This screen
 * shows them by name, with the blocker, ABOVE the button — so the refusal is
 * something a head teacher resolves rather than something they hit.
 *
 * ── Nothing here is destructive to history ─────────────────────────────
 * The old enrolment row is closed ('promoted', with an end date), never
 * deleted. Last year's roll numbers, sections and results stay exactly where
 * they are, which is what makes the ten-year student history possible. The
 * screen says this, because "promote every student" sounds like it overwrites.
 *
 * ── Ata Ekta (08 Admin & IT §03, 13 Responsive ০৫, IMPLEMENTATION §7) ──
 * The bar is the page header with the year pair as a neutral chip. Below it
 * the wizard strip (full step names at ≥1024px, current step + "ধাপ x / n" +
 * a segmented bar on a phone), the year pair, and then ONE irreversible panel
 * (`ui/irreversible.ts`): what cannot be undone on --danger-tint, the "কী হবে"
 * checklist with the preview's real counts, the blocked students by name, the
 * per-student list behind its toggle, and a foot where "আমি বুঝেছি এটি ফেরানো
 * যাবে না" gates "উন্নয়ন শুরু করুন". The click still opens the confirmation it
 * always had, now `confirmOverlay`.
 *
 * The list toggle sits in the body, directly above the list it opens — never
 * in the foot beside the primary. Opening it moves a keyboard or screen-reader
 * reader forward INTO the names, and the focus restored to the rebuilt toggle
 * does not scroll past a list that can run to hundreds of rows.
 */
import type { Auth } from './auth.ts';
import {
  skeleton, errorState, emptyState, successNote, bnNum,
} from './view-states.ts';
import { pageHeader, sectionHeading } from './ui/page-header.ts';
import { el, icon, numText } from './ui/dom.ts';
import { button } from './ui/button.ts';
import { badge, statusBadge, type BadgeTone } from './ui/badge.ts';
import { dataTable } from './ui/table.ts';
import { field } from './ui/field.ts';
import { confirmOverlay } from './ui/overlay.ts';
import { irreversiblePanel, type IrreversibleItem } from './ui/irreversible.ts';
import { permissionState, permissionMessage } from './ui/feedback.ts';
import {
  formatAcademicYear, formatIdentifier, levelNameBn,
} from '../../../packages/ui-core/src/format.ts';

interface Preview {
  years: { id: string; label: string; isCurrent: boolean }[];
  needsTargetYear: boolean;
  fromYear?: { id: string; label: string } | null;
  toYear?: { id: string; label: string } | null;
  summary: { considered: number; promote: number; repeat: number; graduate: number; blocked: number } | null;
  students: {
    studentId: string; nameBn: string; fromLevel: number; fromSection: string;
    fromRoll: number; action: string; toLevel: number | null;
    toSection: string | null; toRoll: number | null; blockerBn: string | null;
  }[];
  existing: {
    id: string; status: string;
    planned: { considered: number; promote: number; repeat: number; graduate: number; blocked: number };
    actual: { promoted: number; repeated: number; graduated: number; committedAt: string | null } | null;
  } | null;
}

type Summary = NonNullable<Preview['summary']>;
type Student = Preview['students'][number];

export interface RolloverViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Only principal/school_owner may plan or commit. Advisory; RLS is the gate. */
  canCommit: boolean;
}

const ACTION_BN: Record<string, string> = {
  promote: 'উন্নীত',
  repeat: 'একই শ্রেণিতে',
  graduate: 'উত্তীর্ণ (বিদায়)',
  blocked: 'আটকে আছে',
};

/** The decision column's chip. Colour with the word beside it, never alone. */
const ACTION_TONE: Record<string, BadgeTone> = {
  promote: 'success',
  repeat: 'warn',
  graduate: 'info',
  blocked: 'danger',
};

const STEPS = ['পূর্বরূপ', 'পরিকল্পনা', 'নিশ্চিতকরণ'] as const;

/** 08 §03's panel title, verbatim. */
const STATEMENT = 'এটি বছরের সবচেয়ে বড় পরিবর্তন';
/**
 * 08 §03's sentence, minus the two clauses the system does not do
 * ("পুরনো রুটিন বন্ধ হবে", "আগে একটি ব্যাকআপ নেওয়া হবে") — a false consequence
 * on an irreversible screen is worse than a missing one. What IS true, and
 * what this screen has always said, takes their place.
 */
const DETAIL =
  'সব শিক্ষার্থী পরের শ্রেণিতে যাবে, নতুন শিক্ষাবর্ষ খুলবে। ' +
  'এটি একবারই করা যায় — আগের বছরের ভর্তি, রোল ও ফলাফলের রেকর্ড অপরিবর্তিত থাকবে।';

const READ_ONLY_NOTE = 'উন্নয়ন সম্পন্ন করার অনুমতি কেবল প্রধান শিক্ষক ও প্রতিষ্ঠান মালিকের।';
const COMMITTED_NOTE = 'এই দুই বছরের উন্নয়ন ইতিমধ্যে সম্পন্ন হয়েছে।';
const BLOCKED_NOTE = 'আটকে থাকা শিক্ষার্থীদের সমাধান না হওয়া পর্যন্ত এটি করা যাবে না।';

export class RolloverView {
  private readonly o: RolloverViewOptions;
  private data: Preview | null = null;
  private from = '';
  private to = '';
  private loading = true;
  private error = '';
  private notice = '';
  private busy = false;
  private showList = false;
  /** A 403 on the preview: the refusal is the whole answer. */
  private denied = false;
  /** The tick in "আমি বুঝেছি…", kept across render()'s rebuild of the root. */
  private acknowledged = false;

  constructor(options: RolloverViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.error = ''; this.denied = false; this.render();
    try {
      const qs = this.from && this.to
        ? `?from=${encodeURIComponent(this.from)}&to=${encodeURIComponent(this.to)}`
        : '';
      const res = await this.o.auth.authedFetch(`/api/v1/ops/rollover${qs}`);
      if (res.status === 403) { this.denied = true; return; }
      if (!res.ok) throw new Error(String(res.status));
      this.data = (await res.json()) as Preview;
      // Default the two years sensibly: current → the next one after it.
      if (!this.from && this.data.years.length >= 2) {
        const cur = this.data.years.find((y) => y.isCurrent) ?? this.data.years[0];
        const idx = this.data.years.findIndex((y) => y.id === cur.id);
        // years arrive newest-first, so "next year" is the entry before it.
        const next = this.data.years[idx - 1];
        if (next) { this.from = cur.id; this.to = next.id; await this.load(); return; }
      }
    } catch {
      this.error = 'তথ্য আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false; this.render();
    }
  }

  private async plan(): Promise<void> {
    this.busy = true; this.error = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromYearId: this.from, toYearId: this.to }),
      });
      const body = await res.json() as { message?: string };
      if (!res.ok) { this.error = body.message ?? 'পরিকল্পনা সংরক্ষণ করা যায়নি।'; return; }
      this.notice = 'পরিকল্পনা সংরক্ষিত হয়েছে। এবার নিশ্চিত করুন।';
      this.acknowledged = false;
      await this.load();
    } catch {
      this.error = 'সংযোগ নেই — পরিকল্পনা সংরক্ষণ করা যায়নি।';
    } finally {
      this.busy = false; this.render();
    }
  }

  private async commit(rolloverId: string): Promise<void> {
    this.busy = true; this.error = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rolloverId }),
      });
      const body = await res.json() as {
        promoted?: number; repeated?: number; graduated?: number;
        message?: string; hint?: string;
      };
      if (!res.ok) {
        // The database's own refusal message is more useful than anything
        // this screen could invent — it names the blocked students.
        this.error = body.message ?? 'উন্নয়ন সম্পন্ন করা যায়নি।';
        return;
      }
      this.notice =
        `সম্পন্ন — ${bnNum(body.promoted ?? 0)} জন উন্নীত, ` +
        `${bnNum(body.repeated ?? 0)} জন একই শ্রেণিতে, ` +
        `${bnNum(body.graduated ?? 0)} জন উত্তীর্ণ। আগের বছরের রেকর্ড অপরিবর্তিত।`;
      this.acknowledged = false;
      await this.load();
    } catch {
      this.error = 'সংযোগ নেই — উন্নয়ন সম্পন্ন করা যায়নি।';
    } finally {
      this.busy = false; this.render();
    }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // 08 §03's bar: the title, and the year pair as a neutral chip on the
    // right. No subtitle — its sentence lives in the panel and checklist now.
    const years = this.yearLabels();
    root.append(pageHeader(d, {
      title: 'বার্ষিক উন্নয়ন',
      actions: years
        ? [badge(d, { label: `${years.from} → ${years.to}`, tone: 'neutral', className: 'roll-pair' })]
        : undefined,
    }));

    // A refusal is the whole answer: nothing below it could be true for
    // this person, and no retry — retrying a refusal is futile.
    if (this.denied) {
      root.append(permissionState(d, {
        message: permissionMessage('বার্ষিক উন্নয়ন'),
        contact: 'প্রধান শিক্ষক',
      }));
      return;
    }

    if (this.notice) root.append(successNote(d, this.notice));
    if (this.error) {
      const err = errorState(d, this.error,
        this.error.includes('অনুমতি') ? undefined : () => void this.load());
      err.classList.add('roll-error');
      root.append(err);
    }
    if (this.loading) { root.append(skeleton(d, 4)); return; }
    if (!this.data) return;

    if (this.data.needsTargetYear) {
      root.append(emptyState(d, {
        glyph: 'calendar',
        message: 'উন্নয়নের জন্য দুইটি শিক্ষাবর্ষ দরকার — বর্তমান এবং পরবর্তী। ' +
                 'পরের বছরের শিক্ষাবর্ষ ও সেকশন তৈরি হলে এখানে পূর্বরূপ দেখা যাবে।',
        action: { label: 'একাডেমিক কাঠামোতে যান', onClick: () => this.goAcademic() },
      }));
      return;
    }

    root.append(...this.steps());
    root.append(this.yearPicker());

    const s = this.data.summary;
    if (!s) return;

    if (s.considered === 0) {
      root.append(emptyState(d, {
        glyph: 'users',
        message: 'উন্নয়নের জন্য কোনো সক্রিয় শিক্ষার্থী পাওয়া যায়নি।',
        action: { label: 'একাডেমিক কাঠামোতে যান', onClick: () => this.goAcademic() },
      }));
      return;
    }

    root.append(this.data.existing?.status === 'committed' ? this.done() : this.gate(s));
  }

  private goAcademic(): void {
    const w = this.o.doc.defaultView;
    if (w) w.location.hash = '#/academic';
  }

  /** The chosen pair, read as a person reads a year. Null until both resolve. */
  private yearLabels(): { from: string; to: string } | null {
    const data = this.data;
    if (!data) return null;
    const from = data.years.find((y) => y.id === this.from)?.label ?? data.fromYear?.label;
    const to = data.years.find((y) => y.id === this.to)?.label ?? data.toYear?.label;
    if (!from || !to) return null;
    return { from: formatAcademicYear(from), to: formatAcademicYear(to) };
  }

  /**
   * 13 Responsive ০৫. Both forms stay in the DOM and the 1024px query shows
   * one: every step name side by side on a desktop (05 importWizard's
   * strip), the current step + "ধাপ x / n" + a segmented bar on a phone.
   */
  private steps(): HTMLElement[] {
    const d = this.o.doc;
    const status = this.data?.existing?.status;
    const committed = status === 'committed';
    const cur = committed ? STEPS.length - 1 : status === 'planned' ? 1 : 0;

    const strip = el(d, 'ol', { className: 'roll-steps', attrs: { 'aria-label': 'উন্নয়নের ধাপ' } });
    STEPS.forEach((label, i) => {
      const state = committed || i < cur ? 'done' : i === cur ? 'current' : 'todo';
      const mark = state === 'done'
        ? el(d, 'span', { className: 'roll-step-mark' },
          icon(d, 'check'),
          el(d, 'span', { className: 'ui-sr-only', text: 'সম্পন্ন: ' }))
        : el(d, 'span', { className: 'roll-step-mark n', text: `${bnNum(i + 1)}.` });
      strip.append(el(d, 'li', {
        className: 'roll-step',
        data: { state },
        attrs: { 'aria-current': state === 'current' ? 'step' : null },
      }, mark, el(d, 'span', { className: 'roll-step-label', text: label })));
    });

    const compact = el(d, 'div', {
      className: 'roll-steps-compact', attrs: { role: 'group', 'aria-label': 'উন্নয়নের ধাপ' },
    },
      el(d, 'p', { className: 'roll-steps-head' },
        el(d, 'span', { className: 'roll-steps-name', text: STEPS[cur] }),
        el(d, 'span', { className: 'roll-steps-count' },
          ...numText(d, `ধাপ ${bnNum(cur + 1)} / ${bnNum(STEPS.length)}`))),
      el(d, 'div', { className: 'roll-steps-bar', attrs: { 'aria-hidden': 'true' } },
        ...STEPS.map((_, i) => el(d, 'span', {
          className: 'roll-steps-seg',
          data: { on: committed || i <= cur ? 'true' : undefined },
        }))));

    return [strip, compact];
  }

  private yearPicker(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div', { className: 'roll-years' });
    const options = (this.data?.years ?? []).map((y) => ({
      value: y.id,
      label: formatAcademicYear(y.label) + (y.isCurrent ? ' (চলতি)' : ''),
    }));

    for (const [labelBn, which] of [['যে বছর থেকে', 'from'], ['যে বছরে', 'to']] as const) {
      const f = field(d, {
        label: labelBn,
        name: which,
        kind: 'select',
        options,
        value: which === 'from' ? this.from : this.to,
        className: 'roll-year',
        onChange: (v) => {
          if (which === 'from') this.from = v; else this.to = v;
          this.notice = '';
          this.acknowledged = false;
          void this.load();
        },
      });
      // A year is a figure (R6). `is-num` is what lets `.n` win on an input.
      f.input.classList.add('n', 'is-num');
      wrap.append(f.root);
    }
    return wrap;
  }

  /**
   * The irreversible panel (§7, R11) for a pair not yet committed.
   *
   * The foot changes with the step, the panel does not — the person reads the
   * same consequences, the blocked names and the list whether they are saving
   * the plan, confirming it, or may only look:
   *   plan      → "পরিকল্পনা সংরক্ষণ করুন" alone. No tick: saving a plan is not
   *               the thing that cannot be undone.
   *   confirm   → "আমি বুঝেছি…", then "উন্নয়ন শুরু করুন".
   *   read-only → why there is no button, and nothing to press.
   * The drawn secondary slot ("ব্যাকআপ নামান") stays empty: there is no backup.
   */
  private gate(s: Summary): HTMLElement {
    const d = this.o.doc;
    const data = this.data!;
    const existing = data.existing;
    const blocked = data.students.filter((st) => st.action === 'blocked');
    const years = this.yearLabels();

    // The drawing says "দশম শ্রেণি". Which class graduates is the highest one
    // the school teaches, so it is read from the students who graduate.
    const gradLevels = [...new Set(
      data.students.filter((st) => st.action === 'graduate').map((st) => st.fromLevel))];
    const gradClass = gradLevels.length === 1 ? `${levelNameBn(gradLevels[0])} শ্রেণি` : 'শেষ শ্রেণি';

    const items: IrreversibleItem[] = [
      { text: `${bnNum(s.promote)} জন শিক্ষার্থী পরের শ্রেণিতে উঠবে`, tone: 'success', glyph: 'arrow-up' },
      { text: `${bnNum(s.graduate)} জন ${gradClass} শেষ করে প্রাক্তন হবে`, tone: 'info', glyph: 'log-out' },
      { text: `${bnNum(s.repeat)} জন একই শ্রেণিতে থাকবে — ফলাফলের ভিত্তিতে`, tone: 'warn', glyph: 'rotate-ccw' },
      {
        text: years ? `নতুন শিক্ষাবর্ষ ${years.to} খুলবে` : 'নতুন শিক্ষাবর্ষ খুলবে',
        tone: 'success', glyph: 'calendar',
      },
      {
        text: years
          ? `${years.from}-এর রুটিন ও নম্বর সংরক্ষিত থাকবে`
          : 'আগের বছরের রুটিন ও নম্বর সংরক্ষিত থাকবে',
        glyph: 'archive',
      },
    ];
    if (s.blocked > 0) {
      items.push({
        text: `${bnNum(s.blocked)} জন আটকে আছে — সমাধান না হলে উন্নয়ন শুরু করা যাবে না`,
        tone: 'danger', glyph: 'alert-triangle',
      });
    }

    let panel: HTMLElement;

    if (!this.o.canCommit) {
      const gate = irreversiblePanel(d, {
        statement: STATEMENT, detail: DETAIL, items, className: 'roll-gate',
      });
      gate.root.dataset.step = 'read';
      // Nothing to acknowledge: this person is offered no action.
      gate.root.querySelector('.irrev-ack')?.replaceWith(this.footNote(READ_ONLY_NOTE));
      panel = gate.root;
    } else if (existing?.status === 'planned') {
      const stopped = () => this.busy || s.blocked > 0;
      const go = button(d, {
        label: 'উন্নয়ন শুরু করুন',
        variant: 'primary',
        busy: this.busy,
        onClick: () => {
          if (stopped() || !this.acknowledged) return;
          const h = confirmOverlay(d, {
            title: 'বার্ষিক উন্নয়ন নিশ্চিত করুন',
            body:
              `${bnNum(s.considered)} জন শিক্ষার্থীর মধ্যে ` +
              `${bnNum(s.promote)} জন উন্নীত হবে, ${bnNum(s.repeat)} জন একই শ্রেণিতে থাকবে, ` +
              `${bnNum(s.graduate)} জন উত্তীর্ণ হয়ে বিদায় নেবে। ` +
              'এটি একবারই করা যায়। আগের বছরের ভর্তি, রোল ও ফলাফলের রেকর্ড অপরিবর্তিত থাকবে।',
            confirmLabel: 'সম্পন্ন করুন',
            danger: true,
            onConfirm: () => this.commit(existing.id),
          });
          h.el.classList.add('roll-confirm');
        },
      });
      const gate = irreversiblePanel(d, {
        statement: STATEMENT,
        detail: DETAIL,
        items,
        confirm: go,
        actions: [go],
        className: 'roll-gate',
        onChange: (ticked) => {
          this.acknowledged = ticked;
          // Updated in place, not re-rendered, so focus stays on the box.
          go.disabled = stopped() || !ticked;
        },
      });
      gate.root.dataset.step = 'confirm';
      // A blocked student stops the commit whatever the tick says, so the
      // box cannot be ticked while one is — and the reason sits under the
      // button, beside the names above it.
      gate.input.checked = this.acknowledged && s.blocked === 0;
      gate.input.disabled = stopped();
      go.disabled = stopped() || !gate.input.checked;
      if (s.blocked > 0) {
        gate.root.dataset.blocked = 'true';
        gate.root.querySelector('.irrev-foot')?.append(this.footNote(BLOCKED_NOTE, true));
      }
      panel = gate.root;
    } else {
      const plan = button(d, {
        label: 'পরিকল্পনা সংরক্ষণ করুন',
        variant: 'primary',
        busy: this.busy,
        disabled: this.busy || s.considered === 0,
        onClick: () => void this.plan(),
      });
      const gate = irreversiblePanel(d, {
        statement: STATEMENT, detail: DETAIL, items, actions: [plan], className: 'roll-gate',
      });
      gate.root.dataset.step = 'plan';
      gate.root.querySelector('.irrev-ack')?.remove();
      panel = gate.root;
    }

    // Blocked students first and by name, ABOVE the button — they are the
    // thing that has to be resolved, and a count is how they get missed.
    // Then the toggle and, under it, the list it opens: still above the foot.
    const body = panel.querySelector('.irrev-body');
    if (blocked.length > 0) body?.append(this.blockedBlock(blocked));
    body?.append(this.listBlock());
    return panel;
  }

  /** A pair already committed: what happened, and the list. No panel — nothing is left to undo. */
  private done(): HTMLElement {
    const d = this.o.doc;
    const actual = this.data?.existing?.actual;
    const wrap = el(d, 'section', {
      className: 'roll-done', attrs: { 'aria-label': 'বার্ষিক উন্নয়ন' },
    });
    if (actual) {
      wrap.append(successNote(d,
        `সম্পন্ন — ${bnNum(actual.promoted)} উন্নীত · ` +
        `${bnNum(actual.repeated)} পুনরাবৃত্তি · ${bnNum(actual.graduated)} উত্তীর্ণ`));
    }
    wrap.append(this.footNote(this.o.canCommit ? COMMITTED_NOTE : READ_ONLY_NOTE));
    wrap.append(this.listBlock());
    return wrap;
  }

  private footNote(text: string, full = false): HTMLElement {
    return el(this.o.doc, 'p', { className: full ? 'roll-foot-note is-full' : 'roll-foot-note', text });
  }

  private blockedBlock(blocked: Student[]): HTMLElement {
    const d = this.o.doc;
    return el(d, 'div', { className: 'roll-blocked' },
      sectionHeading(d, { title: `${bnNum(blocked.length)} জন শিক্ষার্থী আটকে আছে` }),
      el(d, 'p', {
        className: 'roll-blocked-why',
        text: 'এদের সমাধান না হওয়া পর্যন্ত উন্নয়ন শুরু করা যাবে না — কাউকে বাদ দিয়ে করা হয় না।',
      }),
      dataTable<Student>(d, {
        caption: 'আটকে থাকা শিক্ষার্থী',
        rows: blocked,
        rowKey: (st) => st.studentId,
        className: 'roll-table',
        columns: [
          { key: 'name', header: 'নাম', mobile: 'title', cell: (st) => st.nameBn },
          {
            key: 'from', header: 'শ্রেণি · রোল', mobile: 'subtitle',
            cell: (st) => `${bnNum(st.fromLevel)} ${st.fromSection} · রোল ${formatIdentifier(st.fromRoll)}`,
          },
          { key: 'why', header: 'কারণ', mobile: 'meta', cell: (st) => st.blockerBn ?? 'কারণ জানা যায়নি' },
        ],
      }));
  }

  /**
   * The disclosure, then what it discloses — in that order in the DOM (R8).
   * Opening it leaves focus on the toggle with the names directly after it.
   */
  private listBlock(): HTMLElement {
    return el(this.o.doc, 'div', { className: 'roll-list' },
      this.listToggle(),
      this.showList ? this.studentList() : null);
  }

  private listToggle(): HTMLButtonElement {
    return button(this.o.doc, {
      label: this.showList ? 'তালিকা লুকান' : 'শিক্ষার্থীভিত্তিক তালিকা দেখুন',
      variant: 'secondary',
      attrs: { 'aria-expanded': String(this.showList), 'data-roll-toggle': 'true' },
      onClick: () => {
        this.showList = !this.showList;
        this.render();
        // The rebuild replaced the button; put focus back on its successor.
        this.o.root.querySelector<HTMLElement>('[data-roll-toggle]')?.focus();
      },
    });
  }

  /**
   * The named list. F-1605 calls the rollover "guided" precisely so a head
   * teacher can read down it rather than trust a count — and print it.
   */
  private studentList(): HTMLElement {
    const d = this.o.doc;
    return dataTable<Student>(d, {
      caption: 'শিক্ষার্থীভিত্তিক তালিকা',
      rows: this.data?.students ?? [],
      rowKey: (st) => st.studentId,
      className: 'roll-table',
      columns: [
        { key: 'name', header: 'নাম', mobile: 'title', cell: (st) => st.nameBn },
        {
          key: 'from', header: 'বর্তমান', mobile: 'subtitle',
          cell: (st) => `${bnNum(st.fromLevel)} ${st.fromSection} · ${formatIdentifier(st.fromRoll)}`,
        },
        {
          key: 'action', header: 'সিদ্ধান্ত', mobile: 'status',
          cell: (st) => statusBadge(d, {
            state: st.action,
            label: ACTION_BN[st.action] ?? st.action,
            tone: ACTION_TONE[st.action] ?? 'neutral',
          }),
        },
        {
          key: 'to', header: 'নতুন', mobile: 'meta',
          cell: (st) => (st.toSection
            ? `${bnNum(st.toLevel ?? '')} ${st.toSection} · ${formatIdentifier(st.toRoll ?? '')}`
            : st.blockerBn ?? '—'),
        },
      ],
    });
  }
}
