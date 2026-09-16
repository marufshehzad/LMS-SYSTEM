/**
 * "রুটিন তৈরি করুন" — READY → GENERATE → RESULT for a whole institution.
 *
 * P9-3. The screen the whole phase exists for: a coordinator presses one
 * button and their school has a timetable. Four decisions shape it.
 *
 * ── The verdict is one sentence, and it is the server's ────────────────────
 * `summary.verdictBn` is rendered, never composed here. A browser that
 * assembled its own sentence from the counters would drift from the numbers
 * beside it the first time either changed, and this screen's entire value is
 * that a head teacher can believe the sentence at the top of it.
 *
 * ── No fabricated progress ─────────────────────────────────────────────────
 * `POST /rms/generate` is one blocking request. There is no stream, no job
 * id, no percentage — so this shows an ELAPSED SECOND COUNT, which is true,
 * and says in words that the server is doing the whole job in one go. A
 * progress bar creeping to 90% and sitting there is a lie a person learns to
 * distrust, and once they distrust the waiting they distrust the result.
 * `ui/feedback.ts:progress` is deliberately not imported.
 *
 * Ata Ekta (06 Routine §03) draws the wait as a bar, a big figure and the
 * rules being kept. The bar is kept as a SWEEP that fills nothing — it says
 * "working", never "68%" — and hides under reduced motion, where a frozen
 * sweep would read as a position. The big figure is the elapsed count. The
 * rules are the ones the solver really applies while placing (services/
 * rms-svc/src/solve.ts); the weekly cap is only checked afterwards, and the
 * row says so rather than showing a tick it has not earned.
 *
 * ── A hard conflict outranks everything ────────────────────────────────────
 * The teacher and room exclusion constraints only bind an ACTIVE routine, so
 * a draft can hold a clash that publish will refuse. The server counts them
 * from the stored rows; if the count is non-zero this screen leads with that
 * and says the routine cannot be published, because "সব ২৩৬০টি পিরিয়ড বসানো
 * হয়েছে" would be true and would send someone to publish a routine that
 * cannot be published.
 *
 * ── Unplaced demand is a to-do list, not an error ──────────────────────────
 * Every unplaced row names the class, the subject, the teacher and how many
 * periods are missing, with the reason in a sentence — because the four
 * reasons send a coordinator to four different places, and "generation
 * failed" sends them nowhere. A partial routine is a usable routine with
 * work left, and it is presented that way.
 */
import {
  el, icon, numText, pageHeader, card, button, buttonRow, statusBadge, badge,
  statRow, statCard, list, listItem, permissionState, deniedMessage, deniedContact,
  announce, listSkeleton, errorState, openDrawer, successNote, field,
  type ButtonVariant,
} from './ui/index.ts';
import { refuseUnlessOk, isDenied, HttpStatus } from './http-status.ts';
import type { Auth } from './auth.ts';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bn = (n: number): string => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
const SHIFT_BN: Record<string, string> = {
  morning: 'সকাল', day: 'দিবা', evening: 'সান্ধ্য', single: 'একক',
};

/**
 * 06 Routine §03 "যা মানা হচ্ছে" — while the request is open.
 *
 * Not a verdict per rule: nothing comes back until the run ends, so no row
 * can say "held" or "broken" with a count. What each row CAN say truthfully
 * is when the solver applies it. `placing`: teacher and room double-booking
 * and capability rooms are decided slot by slot as lessons are placed.
 * `after`: the weekly cap is a soft rule, evaluated on the finished routine
 * (soft-constraints.ts 'teacher_weekly_cap'). The design's fifth row, "টানা
 * তিন পিরিয়ডের বেশি নয়", has no rule behind it in the solver and is not shown.
 */
const RUN_RULES: ReadonlyArray<{ textBn: string; when: 'placing' | 'after' }> = [
  { textBn: 'একজন শিক্ষক একসাথে দুই জায়গায় নয়', when: 'placing' },
  { textBn: 'একটি কক্ষে একসাথে দুই ক্লাস নয়', when: 'placing' },
  { textBn: 'শিক্ষকের সাপ্তাহিক সীমা', when: 'after' },
  { textBn: 'ব্যবহারিক ক্লাস ল্যাবে', when: 'placing' },
];

interface Step {
  id: string; titleBn: string; state: 'ok' | 'warn' | 'blocked';
  detailBn: string; done: number; total: number;
}
interface Unplaced {
  /** P9-5 §16. Where to open the editor, so the coordinator lands in the
   *  week they were just reading about. */
  sectionId?: string;
  sectionName: string; subjectBn: string; teacherBn: string | null;
  required: number; placed: number; missing: number;
  reason: string; reasonBn: string;
}
interface Shortage { capability: string; detailBn: string }
interface ShiftResult {
  shift: string; routineId: string; version: number; created: boolean;
  totalDemand: number; placed: number;
  unplaced: Unplaced[];
  /** A count. The sentences live in `explanations`, grouped. */
  softViolations: number;
  shortages: Shortage[];
  solverSeconds: number;
  /** B-108. The live version this draft was copied from, or null if fresh. */
  copiedFromVersion?: number | null;
  copiedSlots?: number;
}
interface Summary {
  totalDemand: number; placed: number; unplacedPeriods: number;
  unplacedDemands: number; softViolations: number; hardConflicts: number;
  shortages: Shortage[]; solverSeconds: number; totalSeconds: number;
  verdictBn: string;
}
/** P9-4. One finding, ready to render — the server composed every sentence. */
export interface Explanation {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  titleBn: string;
  whatBn: string;
  whyBn: string;
  affectedBn: string[];
  currentBn: string;
  impactBn: string;
  suggestions: Array<{ textBn: string; evidenceBn: string }>;
}

interface GenerateResult {
  shifts: ShiftResult[];
  summary: Summary;
  explanations?: Explanation[];
  severity?: { error: number; warning: number; info: number };
}

/**
 * §4/§14. The severity, as a WORD as well as a colour.
 *
 * A red dot is invisible to a screen reader and to the eight percent of men
 * who cannot separate it from the amber one, so the label carries the
 * meaning and the colour only reinforces it.
 */
/** How many rows of one severity to print before folding the rest into a count. */
const ROWS_SHOWN = 25;

const SEVERITY_BN: Record<Explanation['severity'], string> = {
  error: 'ঠিক করা দরকার', warning: 'সতর্কতা', info: 'তথ্য',
};
const SEVERITY_TONE: Record<Explanation['severity'],
  { state: 'blocked' | 'pending' | 'active'; tone: 'danger' | 'warn' | 'info' }> = {
  error: { state: 'blocked', tone: 'danger' },
  warning: { state: 'pending', tone: 'warn' },
  info: { state: 'active', tone: 'info' },
};
interface PriorRun {
  routineId: string; shift: string; version: number; status: string;
  slots: number; solverSeconds: number | null; generatedAt: string | null;
}

export interface RoutineGenerateViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  yearId?: string;
  /** Where "প্রস্তুতি সম্পূর্ণ করুন" and "বিস্তারিত ব্যাখ্যা" send people. */
  onNavigate?: (path: string) => void;
  /** Injectable so the elapsed counter is testable without a real clock. */
  now?: () => number;
}

export class RoutineGenerateView {
  private readonly o: RoutineGenerateViewOptions;
  private readonly now: () => number;
  private yearId = '';

  private steps: Step[] = [];
  private canGenerate = false;
  private prior: PriorRun[] = [];
  private result: GenerateResult | null = null;

  private loading = true;
  private running = false;
  private startedAt = 0;
  private elapsed = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** The running frame's big figure, so a tick changes one text node. */
  private elapsedEl: HTMLElement | null = null;

  /**
   * B-108. What a replacement draft is built FROM, when the school already
   * has a live routine. 'current' copies it (pins and all) and lets the
   * solver top up; 'inputs' starts from the academic demand.
   */
  private baseline: 'current' | 'inputs' = 'current';

  private denied = false;
  private deniedErr: unknown = null;
  private error = '';
  /** Set when a run was refused; keeps the retry button honest about why. */
  private failure: 'not_ready' | 'validation' | 'server' | 'offline' | null = null;

  constructor(options: RoutineGenerateViewOptions) {
    this.o = options;
    this.now = options.now ?? Date.now;
    this.yearId = options.yearId ?? '';
    void this.start();
  }

  /** Stop the elapsed counter when the router swaps this view out. */
  destroy(): void { this.stopTicker(); }

  private async start(): Promise<void> {
    // Foundations §04: the skeleton from the first frame. Without this the
    // view stayed blank for the whole academic-year fetch.
    this.render();
    if (!this.yearId) {
      try {
        const res = await this.o.auth.authedFetch('/api/v1/academics/hierarchy');
        await refuseUnlessOk(res);
        const b = await res.json() as
          { years?: Array<{ id: string; isCurrent?: boolean }>; year?: { id: string } };
        this.yearId = b.years?.find((y) => y.isCurrent)?.id ?? b.years?.[0]?.id
          ?? b.year?.id ?? '';
      } catch (err) {
        this.absorb(err, 'শিক্ষাবর্ষ আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।');
        this.loading = false; this.render(); return;
      }
    }
    await this.load();
  }

  /**
   * Readiness and any previous run, together.
   *
   * Both, always: a coordinator arriving after a refresh must see the result
   * they generated ten minutes ago, and a coordinator arriving for the first
   * time must see what is still missing. Which of those they are is not
   * knowable before both answers are in.
   */
  private async load(): Promise<void> {
    this.loading = true; this.render();
    const year = encodeURIComponent(this.yearId);
    try {
      const [setup, runs] = await Promise.all([
        this.o.auth.authedFetch(`/api/v1/rms/setup?yearId=${year}`),
        this.o.auth.authedFetch(`/api/v1/rms/generate?yearId=${year}`),
      ]);
      await refuseUnlessOk(setup);
      const s = await setup.json() as { steps?: Step[]; canGenerate?: boolean };
      this.steps = s.steps ?? [];
      this.canGenerate = Boolean(s.canGenerate);

      // A prior run that cannot be read is not a reason to hide the button.
      if (runs.ok) {
        this.prior = ((await runs.json()) as { runs?: PriorRun[] }).runs ?? [];
      }
      this.error = ''; this.failure = null;
    } catch (err) {
      this.absorb(err, 'প্রস্তুতির তথ্য আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।');
    } finally {
      this.loading = false; this.render();
    }
  }

  private absorb(err: unknown, fallbackBn: string): void {
    if (isDenied(err)) { this.denied = true; this.deniedErr = err; return; }
    this.error = fallbackBn;
  }

  private startTicker(): void {
    this.stopTicker();
    this.startedAt = this.now();
    this.elapsed = 0;
    this.ticker = setInterval(() => {
      this.elapsed = Math.floor((this.now() - this.startedAt) / 1000);
      // Only the figure changes. Rebuilding the page every second replayed
      // the shell's entrance animation on every piece of it, restarted the
      // bar's sweep before it could cross, and re-created the status region
      // a screen reader was listening to.
      if (this.elapsedEl?.isConnected) this.elapsedEl.textContent = bn(this.elapsed);
      else this.render();
    }, 1000);
  }

  /** The load error's "আবার চেষ্টা করুন": the same two reads, run again. */
  private retryLoad(): void {
    this.error = '';
    this.loading = true;
    void this.start();
  }

  private stopTicker(): void {
    if (this.ticker !== null) { clearInterval(this.ticker); this.ticker = null; }
  }

  /**
   * The one action.
   *
   * Every failure below leaves the screen saying something a person can act
   * on. §3 forbids the bare "Generation failed." — a coordinator who is told
   * only that has no next step, and the four causes have four different ones.
   */
  private async generate(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.error = ''; this.failure = null;
    this.startTicker();
    this.render();
    announce(this.o.doc, 'রুটিন তৈরি শুরু হয়েছে');

    try {
      const res = await this.o.auth.authedFetch('/api/v1/rms/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Only when there IS something to copy. Sending 'current' with
        // nothing live is harmless but meaningless, and a request that says
        // what it means is easier to read in a log six months later.
        body: JSON.stringify(this.live().length > 0
          ? { yearId: this.yearId, baseline: this.baseline }
          : { yearId: this.yearId }),
      });
      if (res.status === 403) { await refuseUnlessOk(res); }

      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) { this.refused(res.status, body); return; }

      this.result = body as unknown as GenerateResult;
      // The readiness panel and the prior-run list are both stale now.
      await this.load();
      announce(this.o.doc, (this.result.summary?.verdictBn ?? 'রুটিন তৈরি হয়েছে'));
      return;
    } catch (err) {
      if (err instanceof HttpStatus && err.status === 403) {
        this.denied = true; this.deniedErr = err;
      } else {
        this.failure = 'offline';
        this.error = 'সার্ভারে পৌঁছানো যায়নি। সংযোগ ফিরলে আবার চেষ্টা করুন।';
      }
    } finally {
      this.running = false;
      this.stopTicker();
      this.render();
    }
  }

  /** Turn a refusal into the sentence and the next step it implies. */
  private refused(status: number, body: Record<string, unknown>): void {
    const message = typeof body.message === 'string' ? body.message : '';
    const code = typeof body.error === 'string' ? body.error : '';

    if (status === 409 && code === 'not_ready') {
      // The server's list wins over the one this screen loaded, because it
      // is the one the refusal was actually made on.
      const steps = Array.isArray(body.steps) ? body.steps as Step[] : [];
      if (steps.length > 0) {
        const byId = new Map(steps.map((s) => [s.id, s]));
        this.steps = this.steps.map((s) => byId.get(s.id) ?? s);
        for (const s of steps) if (!this.steps.some((x) => x.id === s.id)) this.steps.push(s);
      }
      this.canGenerate = false;
      this.failure = 'not_ready';
      this.error = message || 'কিছু ধাপ এখনও বাকি আছে।';
      return;
    }
    if (status === 400) {
      this.failure = 'validation';
      this.error = message || 'তথ্যে সমস্যা আছে — প্রস্তুতির ধাপগুলো দেখে নিন।';
      return;
    }
    this.failure = 'server';
    this.error = message
      || 'সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন — আগের কাজ হারায়নি, '
       + 'দ্বিতীয়বার চাপলে বাকি অংশটুকুই বসবে।';
  }

  /* ────────────────────────────── rendering ───────────────────────────── */

  /*
   * Ata Ekta — 06 Routine §03, and the rest of this route in that file's
   * vocabulary (§01 checklist rows and a footer with the primary, §04 stat
   * strip, reason rows and note panel). Each panel is a FRAME: the sheet's
   * `.card` with a 2px rule under its head, edge-to-edge blocks separated by
   * 1px lines, and a 2px-ruled footer holding the buttons — least important
   * first, so the primary ends the row on a desk and the column on a phone.
   *
   * The page title is `pageHeader`'s h1 (lead decision 1); a frame's head is
   * its own h2/h3 and never repeats it. One `btn-primary` at a time — see
   * `primaryOwner`.
   */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    this.elapsedEl = null;
    root.append(pageHeader(d, {
      title: 'রুটিন তৈরি করুন',
      subtitle: 'পুরো প্রতিষ্ঠানের সাপ্তাহিক ক্লাস রুটিন — এক ধাপে',
      // §03's bar chip, right-aligned in the header's cluster as drawn.
      actions: this.running && !this.denied
        ? [statusBadge(d, { state: 'running', label: 'চলছে', tone: 'info' })]
        : undefined,
    }));

    if (this.denied) {
      root.append(permissionState(d, {
        message: deniedMessage(this.deniedErr, 'রুটিন তৈরি'),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }
    if (this.loading && !this.running) { root.append(listSkeleton(d, 3)); return; }
    if (this.running) { root.append(this.runningFrame()); return; }

    // Nothing was read at all. Not the readiness frame: "সব প্রয়োজনীয় তথ্য
    // পাওয়া গেছে" over a step list that never arrived is a claim about data
    // this screen has not seen (Foundations §04 error state).
    if (this.loadFailed() && this.steps.length === 0 && !this.result) {
      root.append(errorState(d, this.error, () => this.retryLoad()));
      return;
    }

    if (this.error) root.append(this.problemFrame());
    // B-108 §15. The live routine, said plainly and BEFORE the button, so
    // nobody presses it believing this week's timetable is about to change.
    if (this.live().length > 0) root.append(this.liveFrame(), this.baselineFrame());
    root.append(this.actionFrame());
    if (this.result) root.append(...this.resultFrames());
    else if (this.prior.some((r) => r.status !== 'active')) root.append(this.priorFrame());
  }

  /** A read failed (as opposed to a run being refused). */
  private loadFailed(): boolean {
    return Boolean(this.error) && this.failure === null;
  }

  /**
   * The page's ONE primary (§3: the accent appears on one button). The step
   * the coordinator is on decides which: before a result, making one; with a
   * result carrying a hard conflict, the editor that fixes it; otherwise the
   * review before publishing. Every other action on the page is secondary.
   */
  private primaryOwner(): 'generate' | 'conflict' | 'publish' {
    if (!this.result) return 'generate';
    return this.result.summary.hardConflicts > 0 ? 'conflict' : 'publish';
  }

  private variantFor(owner: 'generate' | 'conflict' | 'publish'): ButtonVariant {
    return this.primaryOwner() === owner ? 'primary' : 'secondary';
  }

  /** A frame: the sheet's card, head ruled off, blocks appended by the caller. */
  private frame(o: {
    title?: string; action?: HTMLElement; level?: 2 | 3; className?: string;
  }): HTMLElement {
    return card(this.o.doc, {
      title: o.title, action: o.action, headingLevel: o.level,
      className: ['rgen-frame', o.className ?? ''].filter(Boolean).join(' '),
    });
  }

  private block(...children: Array<HTMLElement | null>): HTMLElement {
    return el(this.o.doc, 'div', { className: 'rgen-block' }, ...children);
  }

  private foot(...children: Array<HTMLElement | null>): HTMLElement {
    return el(this.o.doc, 'div', { className: 'rgen-foot' }, ...children);
  }

  /** A paragraph of caller text, with its numbers in the numeral face (R6). */
  private para(className: string, text: string): HTMLElement {
    return el(this.o.doc, 'p', { className }, ...numText(this.o.doc, text));
  }

  /** §04's note panel: a tint, a 4px rail, and the words. */
  private note(tone: 'warn' | 'danger', ...children: HTMLElement[]): HTMLElement {
    return el(this.o.doc, 'div', { className: 'rgen-note', data: { tone } }, ...children);
  }

  /**
   * §03 — generating. The elapsed count, a sweep that claims no position,
   * and the rules the solver is applying. No percentage, no estimate, no
   * "বাতিল": the request cannot be cancelled once sent.
   */
  private runningFrame(): HTMLElement {
    const d = this.o.doc;
    const frame = this.frame({ className: 'rgen-run' });

    const figure = el(d, 'span', { className: 'rgen-run-figure n', text: bn(this.elapsed) });
    this.elapsedEl = figure;
    frame.append(el(d, 'div', { className: 'rgen-run-progress' },
      el(d, 'div', { className: 'rgen-run-track', attrs: { 'aria-hidden': 'true' } },
        el(d, 'span', { className: 'rgen-run-fill' })),
      el(d, 'p', { className: 'rgen-run-figures' },
        figure, ' ',
        el(d, 'span', { className: 'rgen-run-unit', text: 'সেকেন্ড চলছে' }), ' ',
        // The announcement. Its words never change while the run lasts, so a
        // reader hears it once rather than a count every second.
        el(d, 'span', {
          className: 'rgen-run-what', text: 'রুটিন তৈরি হচ্ছে', attrs: { role: 'status' },
        })),
      // Honest about the shape of the wait, because there is no percentage to
      // give and a made-up one would be worse than none.
      el(d, 'p', {
        className: 'rgen-run-why',
        text: 'সার্ভার পুরো কাজটি একবারেই করছে, তাই কত শতাংশ হয়েছে তা বলা যাচ্ছে না। '
            + 'বড় প্রতিষ্ঠানে কয়েক সেকেন্ড লাগতে পারে। পাতা বন্ধ করবেন না।',
      })));

    frame.append(el(d, 'div', { className: 'rgen-run-rules' },
      el(d, 'h2', { className: 'label rgen-eyebrow', text: 'যা মানা হচ্ছে' }),
      el(d, 'ul', { className: 'rgen-rules' }, ...RUN_RULES.map((r) =>
        el(d, 'li', { className: 'rgen-rule', data: { when: r.when } },
          icon(d, r.when === 'placing' ? 'check' : 'clock', 'ui-icon rgen-rule-glyph'),
          el(d, 'span', { className: 'rgen-rule-text', text: r.textBn }),
          r.when === 'after'
            ? el(d, 'span', { className: 'rgen-rule-meta', text: 'শেষে যাচাই' })
            : null)))));
    return frame;
  }

  /** §3 — validation-failure, server-error, offline, not-ready, and a failed read. */
  private problemFrame(): HTMLElement {
    const d = this.o.doc;
    const frame = this.frame({
      title: this.failure === 'not_ready' ? 'এখনই তৈরি করা যাবে না' : 'সমস্যা হয়েছে',
    });
    // Offline is a --warn-tint banner (Foundations §04); a step still to do is
    // work left, not a failure. A refusal or a server fault is the danger one.
    const tone = this.failure === 'not_ready' || this.failure === 'offline' ? 'warn' : 'danger';
    const block = this.block(this.note(tone,
      this.para('rgen-note-text', this.error),
      ...(this.failure === 'not_ready'
        ? [el(d, 'p', {
          className: 'rgen-note-sub',
          text: 'নিচের ধাপগুলো শেষ হলে বোতামটি নিজে থেকেই চালু হবে।',
        })]
        : [])));

    // The error state's way out is a ghost button (lead decision 7). A run
    // that failed is retried by running it; a read that failed, by reading.
    const retry = this.failure === 'server' || this.failure === 'offline'
      ? () => void this.generate()
      : this.loadFailed() ? () => this.retryLoad() : null;
    if (retry) {
      block.append(buttonRow(d, button(d, {
        label: 'আবার চেষ্টা করুন', variant: 'ghost', onClick: retry,
      })));
    }
    frame.append(block);
    return frame;
  }

  /** The readiness frame and the one button (§01's checklist and footer). */
  private actionFrame(): HTMLElement {
    const d = this.o.doc;
    const blocked = this.steps.filter((s) => s.state === 'blocked');
    const warned = this.steps.filter((s) => s.state === 'warn');
    const done = this.steps.filter((s) => s.state === 'ok').length;

    const frame = this.frame({
      title: 'তৈরি করুন',
      // §01's bar chip: how many steps are complete, as a count with its word.
      action: this.steps.length > 0
        ? statusBadge(d, {
          state: done === this.steps.length ? 'active' : 'partial',
          label: `${bn(done)} / ${bn(this.steps.length)} ধাপ`,
        })
        : undefined,
    });

    const block = this.block(this.para('rgen-lead', blocked.length > 0
      ? `${bn(blocked.length)}টি ধাপ বাকি — সেগুলো ছাড়া রুটিন তৈরি করা যাবে না।`
      : 'সব প্রয়োজনীয় তথ্য পাওয়া গেছে।'));
    if (blocked.length === 0 && warned.length > 0) {
      block.append(this.para('rgen-sub',
        `${bn(warned.length)}টি ঐচ্ছিক বিষয় বাকি — রুটিন তৈরি হবে, `
        + 'তবে সেগুলো দিলে ফলাফল আরও ভালো হয়।'));
    }
    frame.append(block);

    if (blocked.length > 0) {
      const rows = list(d, 'বাকি ধাপ', ...blocked.map((s) => listItem(d, {
        title: s.titleBn, subtitle: s.detailBn, glyph: 'alert-circle', className: 'rgen-step',
      })));
      rows.classList.add('rgen-list');
      frame.append(rows);
    }

    const go = button(d, {
      label: this.live().length > 0
        ? 'নতুন খসড়া তৈরি করুন'
        : this.prior.length > 0 ? 'আবার তৈরি করুন' : 'রুটিন তৈরি করুন',
      variant: this.variantFor('generate'),
      disabled: !this.canGenerate,
      onClick: () => void this.generate(),
    });
    const foot = this.foot();
    if (this.prior.length > 0) {
      // Idempotency, said out loud. The commonest fear at this button is
      // that a second press will produce a second timetable.
      //
      // B-108. With a routine already LIVE that sentence stops being true —
      // pressing does make a new draft, which is the whole point — so the
      // note says which of the two is happening rather than reassuring a
      // coordinator about the wrong one.
      foot.append(el(d, 'p', {
        className: 'rgen-foot-note',
        text: this.live().length > 0
          ? 'চালু রুটিনটি অপরিবর্তিত থাকবে। একটি নতুন খসড়া তৈরি হবে, '
            + 'যেটি আপনি দেখে নিয়ে তবেই প্রকাশ করবেন।'
          : 'আবার চাপলে নতুন রুটিন তৈরি হবে না — যেগুলো এখনও বসেনি, '
            + 'শুধু সেগুলোই বসানোর চেষ্টা হবে।',
      }));
    }
    foot.append(buttonRow(d, button(d, {
      label: 'প্রস্তুতি দেখুন', variant: 'secondary',
      onClick: () => this.o.onNavigate?.('routinesetup'),
    }), go));
    frame.append(foot);
    return frame;
  }

  /* ─────────────────────────────── result ─────────────────────────────── */

  /**
   * §4/§12 — the findings, separated by severity, or a calm success state.
   *
   * A school with nothing wrong must not be handed a panel of empty headings
   * to read. The `info` rows still show, because "০ সমস্যা" means "০ of the
   * rules we checked" and saying which rules were not checked is what makes
   * the clean report believable — but they sit under a success note rather
   * than under a warning.
   */
  private findingsFrame(items: Explanation[], summary: Summary): HTMLElement {
    const d = this.o.doc;
    const frame = this.frame({ title: 'কী পাওয়া গেল' });
    const block = this.block();
    frame.append(block);
    const errors = items.filter((i) => i.severity === 'error');
    const warnings = items.filter((i) => i.severity === 'warning');
    const infos = items.filter((i) => i.severity === 'info');

    // "No problems found" is a CLAIM, and it is checked against the summary
    // before it is made. An empty list is not the same as a clean run: a
    // response from an older build, or one that lost its explanations on the
    // way, would produce an empty array beside twelve unplaced periods — and
    // the reassuring sentence would be the only thing on screen that was
    // wrong. Caught by a P9-3 fixture that predates this field.
    const clean = summary.unplacedPeriods === 0 && summary.hardConflicts === 0;
    if (items.length === 0 && !clean) {
      block.append(
        this.para('rgen-lead', 'এই ফলাফলের ব্যাখ্যা পাওয়া যায়নি।'),
        this.para('rgen-sub',
          `উপরের সংখ্যাগুলো অনুযায়ী ${bn(summary.unplacedPeriods)}টি পিরিয়ড বাকি আছে — `
          + 'কারণ জানতে আবার তৈরি করুন।'));
      return frame;
    }

    if (errors.length === 0 && warnings.length === 0) {
      block.append(successNote(d, 'কোনো সমস্যা পাওয়া যায়নি — রুটিনটি ব্যবহারের জন্য প্রস্তুত।'));
    } else {
      block.append(this.para('rgen-lead', [
        errors.length > 0 ? `${bn(errors.length)}টি বিষয় ঠিক করা দরকার` : '',
        warnings.length > 0 ? `${bn(warnings.length)}টি সতর্কতা` : '',
      ].filter(Boolean).join(' · ')));
      if (errors.length === 0) {
        // The distinction §4 exists for: nothing here blocks anything.
        block.append(this.para('rgen-sub',
          'কোনোটিই রুটিন ব্যবহারে বাধা দেয় না — ঠিক করলে ফলাফল আরও ভালো হবে।'));
      }
    }

    for (const [heading, group] of [
      ['ঠিক করা দরকার', errors],
      ['সতর্কতা', warnings],
      ['যা যাচাই করা হয়নি', infos],
    ] as const) {
      if (group.length === 0) continue;
      // §04's list eyebrow. Still an h3 under the frame's h2.
      block.append(el(d, 'h3', { className: 'label rgen-eyebrow' },
        ...numText(d, `${heading} — ${bn(group.length)}টি`)));
      const rows = el(d, 'ul', { className: 'gen-findings' });
      // A backstop, not the mechanism. The server groups the repetitive
      // findings already; this exists so that a category nobody has grouped
      // yet cannot put 1,500 interactive rows on a phone — which the
      // 80-section benchmark did before the grouping landed.
      for (const item of group.slice(0, ROWS_SHOWN)) rows.append(this.findingRow(item));
      block.append(rows);
      if (group.length > ROWS_SHOWN) {
        block.append(this.para('rgen-sub',
          `আরও ${bn(group.length - ROWS_SHOWN)}টি একই ধরনের বিষয় আছে।`));
      }
    }
    return frame;
  }

  /** One finding: a severity word, the sentence, and a way into the detail. */
  private findingRow(item: Explanation): HTMLElement {
    const d = this.o.doc;
    const li = el(d, 'li', { className: 'gen-finding', data: { severity: item.severity } });
    const tone = SEVERITY_TONE[item.severity];
    // The button IS the row, so the whole line is one tap target on a phone
    // and one stop for a keyboard.
    const open = el(d, 'button', {
      className: 'gen-finding-open',
      attrs: { type: 'button', 'aria-label': `${SEVERITY_BN[item.severity]}: ${item.titleBn}` },
    });
    open.append(statusBadge(d, { state: tone.state, label: SEVERITY_BN[item.severity],
                                 tone: tone.tone }));
    open.append(el(d, 'span', { className: 'gen-finding-title' }, ...numText(d, item.titleBn)));
    open.append(el(d, 'span', { className: 'gen-finding-more', text: 'কেন?' }));
    open.addEventListener('click', () => this.openExplanation(item));
    li.append(open);
    return li;
  }

  /**
   * §6 — the focused panel: কারণ → বর্তমান অবস্থা → প্রভাব → সম্ভাব্য সমাধান.
   *
   * `openDrawer` owns the dialog semantics, the focus trap and the return of
   * focus to the row that opened it, so none of that is re-implemented here.
   * Every sentence is the server's; nothing on this screen composes an
   * explanation, because a browser-side rewrite is how a claim drifts away
   * from the evidence that justified it.
   */
  private openExplanation(item: Explanation): void {
    const d = this.o.doc;
    const body = el(d, 'div', { className: 'rgen-explain' });
    const tone = SEVERITY_TONE[item.severity];
    body.append(el(d, 'div', {}, statusBadge(d, {
      state: tone.state, label: SEVERITY_BN[item.severity], tone: tone.tone,
    })));

    const section = (headingBn: string, ...children: HTMLElement[]) => {
      body.append(el(d, 'h3', { className: 'label rgen-eyebrow', text: headingBn }));
      for (const c of children) body.append(c);
    };

    section('কারণ',
      this.para('rgen-lead', item.whatBn),
      this.para('rgen-sub', item.whyBn));

    if (item.affectedBn.length > 0) {
      // §05's name chips: neutral, because being named is not a verdict.
      const who = el(d, 'ul', { className: 'gen-affected' });
      for (const a of item.affectedBn) {
        who.append(el(d, 'li', {}, badge(d, { label: a, tone: 'neutral' })));
      }
      section('কারা জড়িত', who);
    }

    section('বর্তমান অবস্থা', this.para('rgen-sub', item.currentBn));
    section('প্রভাব', this.para('rgen-sub', item.impactBn));

    if (item.suggestions.length > 0) {
      // Why each is worth trying HERE sits under it. Without it a suggestion
      // is advice; with it, it is an argument.
      section('সম্ভাব্য সমাধান', list(d, 'সম্ভাব্য সমাধান', ...item.suggestions.map((s) =>
        listItem(d, { title: s.textBn, subtitle: s.evidenceBn, className: 'rgen-suggestion' }))));
    } else {
      // Saying so beats an empty heading, and beats inventing one.
      section('সম্ভাব্য সমাধান', this.para('rgen-sub',
        'এই তথ্য থেকে নিশ্চিত কোনো সমাধান বলা যাচ্ছে না।'));
    }

    openDrawer(d, { title: item.titleBn, body });
  }

  private resultFrames(): HTMLElement[] {
    const d = this.o.doc;
    const r = this.result as GenerateResult;
    const s = r.summary;
    const out: HTMLElement[] = [];

    // §04: the bar says the run finished; the verdict sentence and the stat
    // strip say how it went, each figure coloured by what it means (lead
    // decision 6) and never by colour alone.
    const result = this.frame({
      title: 'ফলাফল',
      action: statusBadge(d, { state: 'active', label: 'তৈরি সম্পন্ন', tone: 'success' }),
    });
    result.append(
      this.block(el(d, 'p', {
        className: 'rgen-verdict',
        data: { tone: s.hardConflicts > 0 ? 'danger' : s.unplacedPeriods > 0 ? 'warn' : 'success' },
      }, ...numText(d, s.verdictBn))),
      this.block(statRow(d,
        statCard(d, {
          label: 'সাজানো হয়েছে', value: `${bn(s.placed)} / ${bn(s.totalDemand)}`,
          note: `${r.shifts.map((x) => SHIFT_BN[x.shift] ?? x.shift).join(' · ')} শিফট`,
          tone: s.unplacedPeriods === 0 ? 'success' : undefined,
        }),
        statCard(d, {
          label: 'ফাঁকা রয়ে গেছে', value: bn(s.unplacedPeriods),
          note: s.unplacedPeriods === 0 ? 'সবগুলো বসেছে' : `${bn(s.unplacedDemands)}টি বিষয়ে`,
          tone: s.unplacedPeriods === 0 ? 'success' : 'warn',
        }),
        statCard(d, {
          label: 'সংঘর্ষ', value: bn(s.hardConflicts),
          note: s.hardConflicts === 0
            ? 'একই সময়ে দুই জায়গায় কেউ নেই'
            : 'এই রুটিন প্রকাশ করা যাবে না',
          tone: s.hardConflicts === 0 ? 'success' : 'danger',
        }),
        statCard(d, {
          label: 'নরম শর্তে ছাড়', value: bn(s.softViolations),
          note: 'ভালো হতে পারত, কিন্তু আটকায়নি',
        }),
        statCard(d, {
          label: 'সময় লেগেছে', value: `${bn(Math.round(s.totalSeconds))} সেকেন্ড`,
          note: `সমাধানে ${bn(Math.round(s.solverSeconds * 10) / 10)} সেকেন্ড`,
        }))));
    out.push(result);

    // P9-4. ONE list of problems, not three. The unplaced rows, the room
    // shortages, the soft trades and the optional gaps were separate sections
    // saying overlapping things; a coordinator had to read all of them to
    // learn what to do first. `explanations` is that list, already ordered,
    // already worded, already ranked by severity.
    out.push(this.findingsFrame(r.explanations ?? [], s));

    if (s.hardConflicts > 0) {
      // The one finding that also needs a control: the editor is where it
      // gets fixed, and a routine carrying one cannot be published.
      const conflict = this.frame({ title: 'সংঘর্ষ রয়ে গেছে' });
      conflict.append(
        this.block(this.note('danger', el(d, 'p', {
          className: 'rgen-note-text',
          text: 'রুটিন সম্পাদনা পাতায় গিয়ে সংঘর্ষগুলো সরালে প্রকাশ করা যাবে।',
        }))),
        this.foot(buttonRow(d, button(d, {
          label: 'রুটিন সম্পাদনা', variant: this.variantFor('conflict'),
          onClick: () => this.o.onNavigate?.('routineeditor'),
        }))));
      out.push(conflict);
    }

    r.shifts.forEach((shift, i) => out.push(this.shiftFrame(shift, i)));
    return out;
  }

  private shiftFrame(shift: ShiftResult, index: number): HTMLElement {
    const d = this.o.doc;
    const name = SHIFT_BN[shift.shift] ?? shift.shift;
    const frame = this.frame({
      title: `${name} শিফট`, level: 3,
      action: shift.unplaced.length === 0
        ? statusBadge(d, { state: 'active', label: 'সম্পূর্ণ', tone: 'success' })
        : statusBadge(d, { state: 'partial', label: 'আংশিক', tone: 'warn' }),
    });
    const block = this.block();

    // B-108. Where these lessons came from. Without it a coordinator opens a
    // draft they have never edited and finds five hundred placements in it.
    if (shift.copiedFromVersion != null) {
      block.append(this.para('rgen-sub',
        `সংস্করণ ${bn(shift.copiedFromVersion)} থেকে `
        + `${bn(shift.copiedSlots ?? 0)}টি ক্লাস কপি করা হয়েছে — `
        + 'পিন করা ক্লাসসহ। চালু রুটিনটি অপরিবর্তিত আছে।'));
    }

    block.append(this.para('rgen-meta',
      `${bn(shift.placed)} / ${bn(shift.totalDemand)} পিরিয়ড · সংস্করণ ${bn(shift.version)}`));

    if (shift.unplaced.length > 0) {
      // The rows themselves live in "কী পাওয়া গেল", once, with their
      // reasons and their fixes. Repeating them per shift gave a coordinator
      // the same list twice and no way to tell which copy was the real one.
      block.append(this.para('rgen-sub',
        `${bn(shift.unplaced.length)}টি বিষয়ে পিরিয়ড বাকি আছে — `
        + 'কারণ ও সমাধান উপরের তালিকায়।'));
    }
    frame.append(block);

    // §04's footer: the other ways out first, the step after this one last.
    frame.append(this.foot(buttonRow(d,
      button(d, {
        label: 'রুটিন সম্পাদনা', variant: 'secondary',
        // P9-5 §16. The first unplaced demand names a section; opening the
        // editor there puts the coordinator in the week they were just
        // reading about rather than in whichever one the picker defaults to.
        onClick: () => this.o.onNavigate?.(
          shift.unplaced[0]?.sectionId
            ? `routineeditor?sectionId=${shift.unplaced[0].sectionId}`
            : 'routineeditor'),
      }),
      button(d, {
        label: 'বিস্তারিত ব্যাখ্যা', variant: 'secondary',
        onClick: () => this.o.onNavigate?.(`generation?routineId=${shift.routineId}`),
      }),
      button(d, {
        // P9-7. The step after this one. "দেখুন" rather than "প্রকাশ করুন",
        // because it opens a review — a routine with a conflict goes there
        // to be told why it cannot be published, which is a real destination.
        // Every shift's button opens the same review, so only the first one
        // carries the accent.
        label: 'প্রকাশের জন্য দেখুন',
        variant: index === 0 ? this.variantFor('publish') : 'secondary',
        onClick: () => this.o.onNavigate?.('routinepublish'),
      }))));
    return frame;
  }

  /** The routines the school is actually running right now. */
  private live(): PriorRun[] {
    return this.prior.filter((r) => r.status === 'active');
  }

  /**
   * B-108 §15. "This is what the school is using, and it is not what you are
   * about to change."
   *
   * Placed above the button rather than below the result, because the
   * misunderstanding it prevents happens at the moment of pressing. A
   * coordinator who believes Generate rewrites the live timetable will not
   * press it at all — and one who believes it does not, when it does, has
   * already broken three thousand people's week.
   */
  private liveFrame(): HTMLElement {
    const d = this.o.doc;
    const frame = this.frame({ title: 'বর্তমানে চালু রুটিন' });
    const rows = list(d, 'চালু রুটিন', ...this.live().map((run) => listItem(d, {
      title: `${SHIFT_BN[run.shift] ?? run.shift} শিফট — সংস্করণ ${bn(run.version)}`,
      subtitle: `${bn(run.slots)}টি পিরিয়ড · শিক্ষক ও শিক্ষার্থীরা এটিই দেখছেন`,
      glyph: 'check-circle', className: 'rgen-live',
    })));
    rows.classList.add('rgen-list');
    frame.append(rows, this.block(el(d, 'p', {
      className: 'rgen-sub',
      text: 'নতুন খসড়া তৈরি করলে এই রুটিনটি বদলাবে না। নতুনটি প্রকাশ করার '
          + 'পরেই কেবল এটি বাতিল হবে।',
    })));
    return frame;
  }

  /** B-108 §2/§5 — what the replacement is built from. */
  private baselineFrame(): HTMLElement {
    const d = this.o.doc;
    const frame = this.frame({ title: 'কোথা থেকে শুরু' });
    frame.append(this.block(
      field(d, {
        label: 'নতুন খসড়া কীভাবে শুরু হবে',
        name: 'baseline',
        kind: 'select',
        value: this.baseline,
        options: [
          { value: 'current', label: 'চালু রুটিনটি নকল করে — তারপর যেটুকু দরকার বদলাব' },
          { value: 'inputs', label: 'একদম নতুন করে — এখনকার শিক্ষক ও বিষয়ের তালিকা থেকে' },
        ],
        onChange: (v) => {
          this.baseline = v === 'inputs' ? 'inputs' : 'current';
          this.render();
        },
      }).root,
      el(d, 'p', {
        className: 'rgen-sub',
        text: this.baseline === 'current'
          ? 'চালু রুটিনের সব ক্লাস — পিন করা ক্লাসসহ — নতুন খসড়ায় কপি হবে। '
            + 'কিছু বাকি থাকলে সেটুকু বসিয়ে দেওয়া হবে।'
          : 'পিন করা ক্লাসগুলো নতুন খসড়ায় থাকবে না। শিক্ষক বা বিষয়ের তালিকা '
            + 'বড় রকম বদলালে এটিই বেছে নিন।',
      })));
    return frame;
  }

  /** §13 — a run from before this page was opened. */
  private priorFrame(): HTMLElement {
    const d = this.o.doc;
    // B-108. The live routine has its own frame above and is NOT something
    // "আবার তৈরি করলে পূরণ হবে" — saying that about a published timetable is
    // the exact misunderstanding §15 exists to prevent.
    const runs = this.prior.filter((r) => r.status !== 'active');
    const frame = this.frame({ title: 'আগের ফলাফল' });
    frame.append(this.block(el(d, 'p', {
      className: 'rgen-sub',
      text: 'আগে তৈরি করা খসড়া রুটিন পাওয়া গেছে। আবার তৈরি করলে এগুলোই পূরণ হবে।',
    })));
    const rows = list(d, 'আগের খসড়া', ...runs.map((run) => listItem(d, {
      title: `${SHIFT_BN[run.shift] ?? run.shift} শিফট — ${bn(run.slots)}টি পিরিয়ড বসানো আছে`,
      subtitle: `সংস্করণ ${bn(run.version)}`
        + (run.solverSeconds === null
          ? '' : ` · ${bn(Math.round(run.solverSeconds * 10) / 10)} সেকেন্ডে তৈরি`),
    })));
    rows.classList.add('rgen-list');
    frame.append(rows, this.foot(buttonRow(d, ...runs.map((run) => button(d, {
      label: `${SHIFT_BN[run.shift] ?? run.shift} — বিস্তারিত`,
      variant: 'secondary',
      onClick: () => this.o.onNavigate?.(`generation?routineId=${run.routineId}`),
    })))));
    return frame;
  }
}
