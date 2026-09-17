/**
 * The student's home screen. (UI integration plan, P4 · Ata Ekta 03 Student §01)
 *
 * §1: "A Student portal must NOT look like an administrative database."
 * 03 Student opens with the three questions a student brings to this screen —
 * what am I in now, what do I have to hand in, how am I doing — and draws
 * the blocks that answer them first, in this order:
 *
 *   1. the greeting and the student's name        (the page header)
 *   2. the class happening now, or the next one   (`nowCard`)
 *   3. the figures: today's classes · attendance  (`stats`)
 *   4. what has to be handed in                   (`due`)
 *
 * "বাকি সব তার পরে" — everything else comes after. Two things this screen
 * already had are still the student's only way to reach them, so they follow
 * the drawn blocks rather than disappearing:
 *
 *   5. the whole day's timetable, every period    (`day`)
 *   6. what to study next — practice, a topic to finish, a new chapter
 *                                                  (`study`)
 *
 * The student tab bar has no routine route, and no other screen a student
 * reaches reads the practice suggestions, so dropping either would take it
 * away from the student altogether.
 *
 * ── Today's class: the card this screen was built around ───────────────────
 * For the whole of P4 the product could not answer it: `GET /rms/routine`
 * wraps `app.teacher_day(claims.sub, …)`, so a student calling it received
 * their own — empty — TEACHING day. Rather than invent a plausible timetable
 * on the client (fabricated curriculum data, which §10 forbids) P4 shipped
 * without it and wrote the gap down.
 *
 * B-15 closed it properly: `app.student_day` (migration 049) and
 * `GET /academics/myroutine`, section-scoped, parallel-block filtered by what
 * this student actually takes, substitutions resolved to whoever is really
 * taking the period. Not a widening of the teacher endpoint — a sibling, for a
 * different reader asking a different question.
 *
 * ── The requests ────────────────────────────────────────────────────────────
 *   `GET /academics/myroutine`   today's classes, current and next (B-15)
 *   `GET /academics/next`        at most three suggestions, ranked server
 *                                side: homework due inside three days and not
 *                                yet submitted (at most two), then practice,
 *                                a topic to finish or a new chapter. For a
 *                                student this is the only screen that shows
 *                                either kind.
 *   `GET /academics/attendance`  the month's own attendance (F-806)
 *   `GET /academics/results`     the most recent PUBLISHED result
 *   `GET /ops/inbox`             notices addressed to this student (R-2)
 *
 * The last two are still requested exactly as before — the redesign changes
 * what is drawn, not what is fetched (Ata Ekta R3) — though 03 Student §01
 * draws neither; results and notices are one tap away on the tab bar and the
 * bell.
 *
 * Each block renders as soon as its own request lands. On a 2 G connection
 * sequential requests would be seconds of blank screen; independent ones mean
 * the screen fills in as the answers arrive and a slow inbox never holds up
 * the homework that is due today.
 */
import type { Auth } from './auth.ts';
import {
  el, append, uid, numText, statRow, statCard, pageHeader, sectionHeading,
  statusBadge, list, listItem, listSkeleton, emptyState, errorState,
  permissionState, deniedMessage, deniedContact, humanError,
} from './ui/index.ts';
import { bnNum } from './view-states.ts';
import { formatCount } from '../../../packages/ui-core/src/format.ts';

export interface Suggestion {
  kind: string;
  titleBn: string;
  whyBn: string;
  route: string;
  refId: string;
  urgency: 'high' | 'medium' | 'low';
}

interface AttendanceTotals {
  present: number; late: number; absent: number; excused: number;
  halfDay: number; counted: number; attendedPercent: number | null;
}

interface RecentResult {
  examNameBn: string; gpa: string | null; letterGrade: string | null;
  rankInSection: number | null; publishedAt: string | null;
}

interface NoticeRow { id: string; titleBn: string; publishedAt: string; readAt: string | null }

/** One period of the student's own day. Mirrors StudentSlot on the server. */
export interface RoutineSlot {
  slotId: string;
  periodNo: number;
  /** 'HH:MM', already trimmed server-side. */
  startsAt: string;
  endsAt: string;
  subjectBn: string | null;
  roomCode: string | null;
  teacherNameBn: string | null;
  isSubstitution: boolean;
}

export interface StudentHomeOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  displayName?: string;
  go: (path: string) => void;
  now?: () => Date;
}

/** The blocks a refusal — or a failed request — can land on. */
type Block = 'routine' | 'next' | 'attendance';

/**
 * A request for a block that did not answer: thrown, offline, a 5xx, a body
 * that would not parse. Kept apart from a refusal (retrying a refusal is
 * futile) and, above all, apart from an empty answer: "the routine could not
 * be read" must never be drawn as "no class today".
 */
interface Failure { status?: number }

/** A 403, kept as the server said it so the sentence can name the right errand. */
interface Refusal {
  err: { code: unknown; reasonBn: unknown };
  message: string;
  contact: string | undefined;
}

/** 03 Student §01's salutation, over the name. */
const SALUTATION = 'আসসালামু আলাইকুম';

export class StudentHomeView {
  private readonly o: StudentHomeOptions;
  private slots: RoutineSlot[] | null = null;
  private next: Suggestion[] | null = null;
  private totals: AttendanceTotals | null = null;
  private result: RecentResult | null = null;
  private notices: NoticeRow[] = [];
  private unread = 0;
  private refused: Partial<Record<Block, Refusal>> = {};
  /** Blocks whose request did not answer, in the load that is current. */
  private failures: Partial<Record<Block, Failure>> = {};
  private failed = false;
  private errText = '';
  private booted = false;
  /** Bumped per load, so an answer from a load a retry replaced is dropped. */
  private seq = 0;
  private destroyed = false;
  /**
   * The header of the last paint. While it is still a child of the root, the
   * root is this screen's; once the shell has emptied the root for another
   * route (it reuses the same element), nothing here may paint into it.
   */
  private painted: HTMLElement | null = null;

  constructor(options: StudentHomeOptions) {
    this.o = options;
    this.render();
    // A block that failed while the connection was down reloads when it comes
    // back, rather than holding its error until the student navigates away.
    this.o.doc.defaultView?.addEventListener('online', this.onOnline);
    void this.load();
  }

  /**
   * Nothing from this screen paints after it. The listener also detaches
   * itself the first time it fires after the screen has left the root, since
   * the shell's home route does not keep this instance to call this.
   */
  destroy(): void {
    this.destroyed = true;
    this.seq++;
    this.o.doc.defaultView?.removeEventListener('online', this.onOnline);
  }

  private readonly onOnline = (): void => {
    if (!this.owns()) { this.destroy(); return; }
    const f = this.failures;
    if (this.failed || f.routine || f.next || f.attendance) this.reload();
  };

  private owns(): boolean {
    return !this.destroyed && (this.painted === null || this.painted.parentNode === this.o.root);
  }

  private now(): Date { return this.o.now ? this.o.now() : new Date(); }

  /* ── data ───────────────────────────────────────────────────────────── */

  /** Ask again: the retry buttons and the connection coming back. */
  private reload(): void {
    if (!this.owns()) return;
    this.failed = false;
    this.booted = false;
    this.failures = {};
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    const seq = ++this.seq;
    const current = (): boolean => seq === this.seq && !this.destroyed;
    this.refused = {};
    this.failures = {};
    // Independent requests. One slow answer must not hold the others back,
    // so each repaints when it lands rather than awaiting the set.
    //
    // A 403 is still a null here — nothing about what is fetched or how the
    // blocks read their data changes — but it is also written down, so the
    // block it belongs to can say "not for you" rather than "nothing due"
    // (§7: denied is never a blank or an empty list). Any other failure is
    // written down too, so the block says it could not be read — a null
    // turned into an empty list read "no class today" and "nothing to hand
    // in" to a student whose request had simply failed.
    const get = async <T>(path: string, block?: Block, subject?: string): Promise<T | null> => {
      try {
        const res = await this.o.auth.authedFetch(path);
        if (!res.ok) {
          if (res.status === 403 && block) {
            let body: { error?: unknown; message?: unknown } | null = null;
            try { body = await res.json(); } catch { /* a refusal with no body */ }
            const err = { code: body?.error, reasonBn: body?.message };
            if (current()) {
              this.refused[block] = {
                err, message: deniedMessage(err, subject), contact: deniedContact(err),
              };
            }
          } else if (block && current()) {
            this.failures[block] = { status: res.status };
          }
          return null;
        }
        return (await res.json()) as T;
      } catch {
        if (block && current()) this.failures[block] = {};
        return null;
      }
    };

    const jobs = [
      // B-15. First in the list because it is first on the screen, and its own
      // request because a slow inbox must not delay "where do I have to be".
      // A failed or refused answer stays null — never [], which means "no
      // classes today" — and the block reads which it was.
      get<{ slots: RoutineSlot[] }>('/api/v1/academics/myroutine', 'routine', 'আজকের রুটিন')
        .then((b) => { if (!current()) return; this.slots = b ? (b.slots ?? []) : null; this.repaint(); }),
      get<{ suggestions: Suggestion[] }>('/api/v1/academics/next', 'next', 'জমা দেওয়ার কাজ')
        .then((b) => { if (!current()) return; this.next = b ? (b.suggestions ?? []) : null; this.repaint(); }),
      get<{ totals: AttendanceTotals }>('/api/v1/academics/attendance?months=1', 'attendance', 'হাজিরা')
        .then((b) => { if (!current()) return; this.totals = b?.totals ?? null; this.repaint(); }),
      get<{ results: RecentResult[] }>('/api/v1/academics/results')
        .then((b) => { if (!current()) return; this.result = b?.results?.[0] ?? null; this.repaint(); }),
      get<{ notices: NoticeRow[]; unread: number }>('/api/v1/ops/inbox?limit=3')
        .then((b) => { if (!current()) return; this.notices = b?.notices ?? []; this.unread = b?.unread ?? 0; this.repaint(); }),
    ];

    await Promise.all(jobs);
    if (!current()) return;
    this.booted = true;
    // Every block this screen draws failed: that is an error worth a screen,
    // one answer rather than three copies of it. One failure among several
    // is not — the block that failed shows its own state, with its own retry.
    const f = this.failures;
    this.failed = !!(f.routine && f.next && f.attendance);
    if (this.failed) this.errText = this.failText(f.routine);
    this.repaint();
  }

  /** The plain sentence for a failure: offline, the server, or neither. */
  private failText(failure: Failure | undefined): string {
    return humanError(navigator.onLine ? null : 'offline', failure?.status);
  }

  private repaint(): void { if (this.owns()) this.render(); }

  /**
   * The error card with its retry. Two can be on screen at once (the class
   * card and the due panel) with the same label, so each retry carries its
   * own focus key: the one pressed is the one focus goes back to.
   */
  private retryable(message: string, focusKey: string): HTMLElement {
    const state = errorState(this.o.doc, message, () => this.reload());
    state.querySelector('button')?.setAttribute('data-focus-key', focusKey);
    return state;
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // 03 Student §01: the salutation and the student's name, no date line.
    // The name is the page's one h1 and the salutation its sub-line; the
    // header itself stays the sheet's (Wave 2 lead decision 1).
    this.painted = pageHeader(d, this.o.displayName
      ? { title: this.o.displayName, subtitle: SALUTATION }
      : { title: SALUTATION });
    append(root, this.painted);

    if (!this.booted && this.next === null && this.totals === null) {
      // Foundations §04: grey rows, never a spinner.
      append(root, listSkeleton(d, 4));
      return;
    }
    const r = this.refused;
    if (r.routine && r.next && r.attendance) {
      // Every block this screen draws was refused: one answer, not three
      // copies of it, and no retry — retrying a refusal is futile.
      const err = r.next.err;
      append(root, permissionState(d, {
        message: deniedMessage(err), contact: deniedContact(err),
      }));
      return;
    }
    if (this.failed) {
      append(root, this.retryable(this.errText, 'sh-retry'));
      return;
    }

    append(root, this.nowCard(), this.stats(), this.due(), this.day(), this.study());
  }

  /**
   * Which period is running now, and — when none is — which comes next.
   * -1 for either when there is none. `now` comes from the injectable clock,
   * so "which period is current" is a fact of a test, not of the hour it runs.
   */
  private periods(slots: RoutineSlot[]): { currentIdx: number; nextIdx: number } {
    const mins = this.now().getHours() * 60 + this.now().getMinutes();
    const at = (t: string): number => {
      const [h, m] = t.split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };
    const currentIdx = slots.findIndex(
      (s) => mins >= at(s.startsAt) && mins < at(s.endsAt));
    const nextIdx = currentIdx >= 0
      ? -1
      : slots.findIndex((s) => at(s.startsAt) > mins);
    return { currentIdx, nextIdx };
  }

  /**
   * The class happening NOW — or, between periods, the next one.
   *
   * A student glancing at their phone in a corridor is asking "which room",
   * and the answer is one card, not a timetable to read down. The timetable
   * itself follows further down (`day`).
   */
  private nowCard(): HTMLElement {
    const d = this.o.doc;
    const stateSlot = (child: HTMLElement) => el(d, 'div', { className: 'sh-now-empty' }, child);

    if (this.refused.routine) return stateSlot(permissionState(d, this.refused.routine));

    if (this.failures.routine) {
      // Not "no class today": the routine was not read, and the card says
      // that, with the way to ask again.
      return stateSlot(this.retryable(
        `আজকের রুটিন আনা যায়নি। ${this.failText(this.failures.routine)}`, 'sh-retry-routine'));
    }

    if (this.slots === null) {
      // The card's own shell around one grey row, so nothing jumps when the
      // routine lands.
      return el(d, 'div', { className: 'card sh-now' }, listSkeleton(d, 1));
    }

    if (!this.slots.length) {
      // A holiday, a weekend, or a routine that has not been published. The
      // screen says the true thing it knows and does not guess which.
      return stateSlot(emptyState(d, { message: 'আজ কোনো ক্লাস নেই।' }));
    }

    const { currentIdx, nextIdx } = this.periods(this.slots);
    const idx = currentIdx >= 0 ? currentIdx : nextIdx;

    if (idx < 0) {
      return stateSlot(emptyState(d, { message: 'আজকের সব ক্লাস শেষ হয়েছে।' }));
    }

    const s = this.slots[idx];
    const lead = currentIdx >= 0 ? 'এখন ক্লাস' : 'পরবর্তী ক্লাস';
    const where = whereBn(s);

    // The sheet's card shell. The accent stays off its ground (R5): the one
    // accent belongs to a primary button and the active tab, and this screen
    // has no primary.
    return el(d, 'section', { className: 'card sh-now', data: { now: String(currentIdx >= 0) } },
      el(d, 'p', { className: 'sh-now-when' },
        `${lead} · `, el(d, 'span', { className: 'n', text: bnTime(s.startsAt) })),
      el(d, 'h2', { className: 'sh-now-subject' },
        ...numText(d, s.subjectBn ?? 'বিষয় নির্ধারিত হয়নি')),
      where ? el(d, 'p', { className: 'sh-now-where' }, ...numText(d, where)) : null);
  }

  /**
   * The figures a student actually asks about, in one strip.
   *
   * 03 Student §01 draws a third cell, "জমা বাকি" — how much homework is
   * still to hand in. It is left out on purpose. The only source this screen
   * has is `/academics/next`, which returns at most TWO assignments, only
   * those due inside the next three days, and none that are already overdue.
   * Counted as "pending", five unsubmitted pieces would read ২ and an overdue
   * one would read ০ — a false figure stated as a plain fact (Ata Ekta R3:
   * do not fake it). The homework it does know about is listed, row by row,
   * in the panel below.
   *
   * Tones carry meaning only (lead decision 6), always under the words of
   * their label: the month's attendance in --ok at 80% or more, --warn below.
   */
  private stats(): HTMLElement {
    const d = this.o.doc;
    const slotsN = this.refused.routine || this.slots === null
      ? '—' : formatCount(this.slots.length, 'bn');
    const pct = this.totals?.attendedPercent;
    const hasPct = pct !== null && pct !== undefined;

    const row = statRow(d,
      statCard(d, { label: 'আজকের ক্লাস', value: slotsN }),
      statCard(d, {
        label: 'হাজিরা',
        value: hasPct ? `${formatCount(pct, 'bn')}%` : '—',
        tone: hasPct ? (pct >= 80 ? 'success' : 'warn') : undefined,
        onClick: () => this.o.go('my-attendance'),
      }));
    row.classList.add('sh-stats');
    return row;
  }

  /**
   * What has to be handed in — the screen's reason to exist.
   *
   * The server already ranks these, so the client neither re-sorts nor
   * invents a rule. When nothing is due the panel says so rather than
   * disappearing: "nothing is due" is information a student came for, and an
   * absent block reads as a screen that failed to load.
   */
  private due(): HTMLElement {
    const d = this.o.doc;
    const id = uid('sh-due');
    const wrap = el(d, 'section', {
      className: 'card sh-due', attrs: { 'aria-labelledby': id },
    }, el(d, 'h2', { className: 'label sh-due-head', text: 'আজ জমা দিতে হবে', attrs: { id } }));

    if (this.refused.next) {
      append(wrap, permissionState(d, this.refused.next));
      return wrap;
    }
    if (this.failures.next) {
      // Not "nothing to hand in": the list was not read.
      append(wrap, this.retryable(
        `জমা দেওয়ার কাজের তালিকা আনা যায়নি। ${this.failText(this.failures.next)}`, 'sh-retry-next'));
      return wrap;
    }
    if (this.next === null) {
      append(wrap, listSkeleton(d, 2));
      return wrap;
    }

    const items = this.next.filter((s) => s.kind === 'assignment');
    if (!items.length) {
      append(wrap, emptyState(d, {
        message: 'এই মুহূর্তে জমা দেওয়ার কিছু নেই।',
        detail: 'তিন দিনের মধ্যে জমা দিতে হবে এমন কোনো কাজ নেই। পড়াশোনা চালিয়ে যাও।',
        glyph: 'check-circle',
        action: { label: 'পড়াশোনায় যাও', onClick: () => this.o.go('learn') },
      }));
      return wrap;
    }

    append(wrap, list(d, 'আজ জমা দিতে হবে', ...items.map((s) => listItem(d, {
      title: s.titleBn,
      // The server's own sentence — "আজই জমা দিতে হবে" or "N দিনের মধ্যে …" —
      // in Bangla digits. Today in --danger, later in --warn: the words say
      // it, the colour only echoes them.
      status: bnNum(s.whyBn),
      statusTone: s.whyBn.startsWith('আজ') ? 'danger' : 'warn',
      onClick: () => this.o.go(s.route),
    }))));
    return wrap;
  }

  /**
   * The whole day, every period in order — after the drawn blocks.
   *
   * The card above answers "which room now"; this answers "what is my day",
   * and it is the only place a student can read it: the student tab bar has
   * no routine route. It reads the same `/academics/myroutine` answer the
   * card does — nothing more is fetched.
   *
   * When the routine is refused or could not be read, or the day has no
   * classes, the card's slot already says so; a second copy of the same
   * sentence here would be noise, so the section is left out rather than
   * repeated.
   */
  private day(): HTMLElement | null {
    const d = this.o.doc;
    if (this.refused.routine || this.failures.routine) return null;
    const wrap = el(d, 'section', { className: 'sh-day' },
      sectionHeading(d, { title: 'আজকের রুটিন' }));

    if (this.slots === null) {
      append(wrap, listSkeleton(d, 3));
      return wrap;
    }
    if (!this.slots.length) return null;

    const { currentIdx, nextIdx } = this.periods(this.slots);
    append(wrap, list(d, 'আজকের রুটিন', ...this.slots.map((s, i) => listItem(d, {
      title: s.subjectBn ?? 'বিষয় নির্ধারিত হয়নি',
      subtitle: `${periodBn(s.periodNo)} পিরিয়ড · ${bnTime(s.startsAt)}–${bnTime(s.endsAt)}`,
      meta: whereBn(s) || undefined,
      // A word, never a tint alone: this list is read at a glance in a
      // corridor between periods. The same two states the list always used.
      status: i === currentIdx
        ? statusBadge(d, { state: 'due', label: 'এখন চলছে' })
        : i === nextIdx
          ? statusBadge(d, { state: 'pending', label: 'পরবর্তী' })
          : undefined,
    }))));
    return wrap;
  }

  /**
   * What to study next: practice answered wrong, a topic to finish, a new
   * chapter — the suggestions that are not homework.
   *
   * They come in the same `/academics/next` answer as the homework above, and
   * this is the only screen a student reaches that reads it; `পড়াশোনা` does
   * not. Ranked server side, so the client neither re-sorts nor invents a
   * rule.
   *
   * Left out while that answer is loading, refused or failed (the panel above
   * already shows the skeleton, the refusal or the error) and when there is
   * nothing to suggest — the panel's empty state already names the way on to
   * পড়াশোনা.
   */
  private study(): HTMLElement | null {
    const d = this.o.doc;
    if (this.refused.next || this.failures.next || this.next === null) return null;
    const items = this.next.filter((s) => s.kind !== 'assignment');
    if (!items.length) return null;
    return el(d, 'section', { className: 'sh-study' },
      sectionHeading(d, { title: 'এখন যা দরকার' }),
      list(d, 'এখন যা দরকার', ...items.map((s) => listItem(d, {
        title: s.titleBn,
        subtitle: bnNum(s.whyBn),
        onClick: () => this.o.go(s.route),
      }))));
  }
}

/**
 * "কক্ষ ১০৪ · রেহানা পারভীন" — the room and who is taking the period.
 *
 * The substitution rides with the NAME it qualifies: "who is taking this" and
 * "when is this" are different facts, and a covered period that is running
 * now must still say it is covered — that is the one moment the student needs
 * to know. With no name at all, the substitution is still sayable.
 */
function whereBn(s: RoutineSlot): string {
  const teacher = s.teacherNameBn
    ? (s.isSubstitution ? `${s.teacherNameBn} (বদলি)` : s.teacherNameBn)
    : (s.isSubstitution ? 'বদলি শিক্ষক' : null);
  return [s.roomCode ? `কক্ষ ${s.roomCode}` : null, teacher]
    .filter(Boolean).join(' · ');
}

/**
 * Bangla ordinals. NOT `formatCount(n) + 'ম'`, which is how the first draft
 * of the day's list produced "২ম পিরিয়ড" — the suffix differs per number and
 * only 1, 5, 7 and 8 take ম, so the bug is invisible in a screenshot of period
 * one. Beyond the table it degrades to the plain number rather than guessing
 * a suffix: "১৫" is honest where "১৫ম" would be invented grammar.
 */
const PERIOD_BN = [
  '', '১ম', '২য়', '৩য়', '৪র্থ', '৫ম', '৬ষ্ঠ', '৭ম', '৮ম', '৯ম', '১০ম',
  '১১তম', '১২তম',
];

export function periodBn(n: number): string {
  return PERIOD_BN[n] ?? formatCount(n, 'bn');
}

/**
 * 'HH:MM' in Bangla digits. Times are read, not cross-checked against a paper
 * register, so unlike a roll number they are localised — `formatIdentifier`
 * exists for the opposite case and this is deliberately not it.
 */
export function bnTime(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return `${formatCount(Number(h), 'bn')}:${(m ?? '00').replace(/\d/g,
    (x) => '০১২৩৪৫৬৭৮৯'[Number(x)])}`;
}
