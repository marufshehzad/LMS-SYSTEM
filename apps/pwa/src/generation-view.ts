/**
 * Routine generation result — F-503, F-505, wireframe §8.2, 06 Routine §04
 *
 *   রুটিন ফলাফল                                         [তৈরি সম্পন্ন]
 *   ┌ সাজানো হয়েছে ┬ ফাঁকা রয়ে গেছে ┬ সংঘর্ষ ┬ সময় লেগেছে ┐
 *   │  ৪১৪ / ৪২০   │       ৬        │   ০    │   ৫২ সে    │
 *   ৬টি পিরিয়ড বসানো যায়নি
 *   ▌ "chemistry_lab" কক্ষে ১২টি পিরিয়ড দরকার; ১টি কক্ষে ৮টি খালি
 *   যা ছাড় দিতে হয়েছে · ৭টি
 *   রফিক ইসলাম — সাপ্তাহিক ২৬ পিরিয়ড     যোগ্য গণিত শিক্ষক কম
 *   যা যাচাই করা হয়নি · কেন এই বরাদ্দ? [ স্লট বেছে নিন ]
 *   [ আবার চালান ] [ বাতিল ]                          [ গ্রহণ করুন ]
 *
 * The screen where a coordinator decides whether to accept a machine's
 * timetable for 1,200 children. Three things it must not do.
 *
 * It must not bury the trade-offs. The stats band says how much was placed,
 * how much was not, and how many conflicts remain; the soft-constraint count
 * heads its own list immediately under it — before the accept button, not
 * behind a disclosure. "Nothing is silently accepted" is a layout requirement
 * as much as a data one.
 *
 * It must not show a clean report that isn't. When rules could not be
 * evaluated the screen says which, because "০ সংঘর্ষ" otherwise means
 * "০ of the rules I happen to check" and reads as a guarantee.
 *
 * It must not explain a slot until asked. §8.2 makes the explanation a
 * deliberate act — pick a slot, read why. Rendering 300 justifications
 * nobody requested is how a screen becomes unreadable.
 */
import type { Auth } from './auth.ts';
import { errorState } from './view-states.ts';
import { formatCount } from '../../../packages/ui-core/src/format.ts';
import { pageHeader } from './ui/page-header.ts';
import {
  el, numText, hasDigit, serverMessage, statRow, statCard, listSkeleton, button,
  statusBadge, emptyState, permissionState, deniedMessage, deniedContact, humanError,
} from './ui/index.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';

const bn = (n: number): string => formatCount(n, 'bn');

/** 0 = Sunday, matching routine_slots.day_of_week. */
const DAY_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];

export interface SoftViolation {
  code: string;
  detailBn: string;
  causeBn?: string;
}

export interface GenSlot {
  id: string;
  dayOfWeek: number;
  periodNo: number;
  startsAt: string;
  sectionLabel: string;
  subjectBn: string;
  teacherNameBn: string;
  roomCode: string | null;
}

export interface Explanation {
  slotId: string;
  sectionLabel: string;
  subjectBn: string;
  dayOfWeek: number;
  periodNo: number;
  teacherWhyBn: string;
  roomWhyBn: string | null;
}

export interface CapabilityShortage {
  capability: string;
  demandedPeriods: number;
  capableRooms: number;
  freePeriods: number;
  detailBn: string;
}

interface Report {
  routine: {
    id: string; nameBn: string; status: string; objectiveScore: number | null;
    /** How long the solver ran. The API has always sent it; null for a hand-made routine. */
    solverSeconds?: number | null;
  };
  hardViolations: number;
  soft: SoftViolation[];
  unplaced: Array<{ missing: number; reason: string }>;
  notEvaluated: Array<{ ruleBn: string; whyBn: string }>;
  shortages: CapabilityShortage[];
  slots: GenSlot[];
}

export interface GenerationViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  routineId: string;
  /** Re-runs the solver. 06 Routine §04's [ আবার চালান ]. */
  onRegenerate?: (routineId: string) => void;
}

const ENDPOINT = '/api/v1/rms/generation';
const SOFT_SHOWN = 8;

export class GenerationView {
  private readonly o: GenerationViewOptions;
  /**
   * The one child this view puts in the shell. Every re-render replaces what
   * is INSIDE it, so the shell's entrance motion (`.shell-view > *`) plays
   * once when the screen opens — not again on every slot pick, "আরও দেখুন"
   * or busy toggle.
   */
  private readonly host: HTMLElement;
  private data: Report | null = null;
  private explanation: Explanation | null = null;
  private loading = true;
  private busy = false;
  private error: string | null = null;
  private denied = false;
  private deniedErr: unknown = null;
  private expanded = false;

  constructor(options: GenerationViewOptions) {
    this.o = options;
    this.host = el(options.doc, 'div', { className: 'gen-view' });
    options.root.textContent = '';
    options.root.append(this.host);
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch(
        `${ENDPOINT}?routineId=${encodeURIComponent(this.o.routineId)}`);
      // B-30: a refusal is not an outage. It must not read as "could not
      // load" with a retry that can never succeed.
      await refuseUnlessOk(res);
      this.data = (await res.json()) as Report;
      this.error = null;
      this.denied = false;
    } catch (err) {
      if (isDenied(err)) {
        this.denied = true;
        this.deniedErr = err;
        this.error = null;
      } else {
        this.error = typeof navigator !== 'undefined' && navigator.onLine === false
          ? humanError('offline')
          : 'ফলাফল লোড হয়নি।';
      }
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async explain(slotId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(`${ENDPOINT}?slotId=${encodeURIComponent(slotId)}`);
      if (!res.ok) throw new Error(String(res.status));
      this.explanation = (await res.json()) as Explanation;
      this.error = null;
    } catch {
      this.error = 'ব্যাখ্যা পাওয়া যায়নি।';
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async act(action: 'accept' | 'discard'): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ routineId: this.o.routineId, action }),
      });
      const body = (await res.json()) as { status?: string; message?: string };
      if (!res.ok) {
        // The server's refusal names a teacher or a room. That text is the
        // whole value of the failure, so it is shown verbatim rather than
        // replaced with "could not publish".
        this.error = serverMessage(body, res.status, 'কাজটি সম্পন্ন হয়নি।');
      } else if (this.data) {
        this.data.routine.status = body.status ?? this.data.routine.status;
      }
    } catch {
      this.error = 'সংযোগ পাওয়া যায়নি।';
    } finally {
      this.busy = false;
      this.render();
      void this.load();
    }
  }

  // ── rendering ───────────────────────────────────────────────────────
  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    const host = this.host;
    host.textContent = '';
    root.setAttribute('lang', 'bn');

    const r = this.data;
    const published = r?.routine.status === 'active';

    // 06 Routine §04's title bar: the title on the left, the state chip on
    // the right — the header's right-hand cluster, where the drawing puts it.
    host.append(pageHeader(d, {
      title: 'রুটিন ফলাফল',
      subtitle: this.loading ? 'লোড হচ্ছে…' : (r?.routine.nameBn ?? ''),
      actions: !this.loading && r && !this.denied && !this.error ? [this.stateChip(r)] : undefined,
    }));

    // Opened without ?routineId= — there is no result without a routine to
    // be the result of. Say so and point at where one is made, rather than
    // letting the request fail and calling it an error.
    if (!this.o.routineId) {
      host.append(emptyState(d, {
        glyph: 'clock',
        message: 'কোনো রুটিন বাছা হয়নি।',
        detail: 'রুটিন তৈরি করুন পাতায় একটি রুটিন তৈরি করলে তার ফলাফল এখানে দেখা যাবে।',
        action: {
          label: 'রুটিন তৈরি করুন',
          onClick: () => { location.hash = '#/routinegenerate'; },
        },
      }));
      return;
    }

    if (this.denied) {
      host.append(permissionState(d, {
        message: deniedMessage(this.deniedErr),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }

    // An error is the whole answer: with no report loaded there is nothing
    // to render underneath it but a blank.
    if (this.error) {
      host.append(errorState(d, this.error, () => void this.load()));
      return;
    }

    if (this.loading) { host.append(listSkeleton(d, 4)); return; }
    if (!r) return;

    // One white panel, as the drawing frames it: stats band, content, footer.
    const panel = el(d, 'section', { className: 'card gen-result' });
    panel.append(this.counters(r));
    // Above the trade list: a shortage is why periods are missing, and a
    // coordinator reading "৪টি পিরিয়ড বসানো যায়নি" without it has to guess.
    const unplaced = this.unplacedBlock(r);
    if (unplaced) panel.append(unplaced);
    panel.append(r.soft.length > 0 ? this.tradeList(r) : this.cleanNote());
    if (r.notEvaluated.length > 0) panel.append(this.notEvaluated(r));
    panel.append(this.explainPanel(r));
    if (!published) panel.append(this.actions());
    host.append(panel);
  }

  /** The routine's state, in the words the rest of the routine screens use. */
  private stateChip(r: Report): HTMLElement {
    const d = this.o.doc;
    switch (r.routine.status) {
      case 'active':
        return statusBadge(d, { state: 'published', label: 'প্রকাশিত' });
      case 'superseded':
        return statusBadge(d, { state: 'retired', tone: 'neutral', label: 'বাতিল — নতুন রুটিন চালু' });
      case 'archived':
        return statusBadge(d, { state: 'archived', tone: 'neutral', label: 'সংরক্ষিত' });
      default:
        // A draft (or one sent for review) is a finished run: 06 §04's chip.
        return statusBadge(d, { state: 'generated', tone: 'success', label: 'তৈরি সম্পন্ন' });
    }
  }

  /**
   * 06 Routine §04's stats band. Four figures a coordinator DECIDES on, and
   * a decision is made from a comparison, not from four sentences. The
   * figure is coloured by what it means, never for decoration.
   */
  private counters(r: Report): HTMLElement {
    const d = this.o.doc;
    const placed = r.slots.length;
    const missing = r.unplaced.reduce((sum, u) => sum + u.missing, 0);
    const seconds = r.routine.solverSeconds;
    const row = statRow(d,
      statCard(d, {
        label: 'সাজানো হয়েছে', value: `${bn(placed)} / ${bn(placed + missing)}`,
        // Green only when it is the whole demand. "১ / ৩" is not good news.
        ...(missing === 0 ? { tone: 'success' as const } : {}),
      }),
      statCard(d, {
        label: 'ফাঁকা রয়ে গেছে', value: bn(missing),
        tone: missing > 0 ? 'warn' : 'success',
      }),
      statCard(d, {
        // P9-4: a real count of teacher, room and section overlaps — a draft
        // is not protected by the exclusion constraints, so zero is measured,
        // not promised.
        label: 'সংঘর্ষ', value: bn(r.hardViolations),
        tone: r.hardViolations > 0 ? 'danger' : 'success',
      }),
      // A routine the solver did not make has no run time; the cell is left
      // out rather than filled with a figure nobody measured.
      seconds !== null && seconds !== undefined
        ? statCard(d, { label: 'সময় লেগেছে', value: `${bn(Math.round(seconds))} সে` })
        : null,
    );
    return el(d, 'div', { className: 'gen-stats' }, row);
  }

  /** An eyebrow heading, with its numbers in the numeral face. */
  private head(text: string): HTMLElement {
    return el(this.o.doc, 'h2', { className: 'label gen-head' }, ...numText(this.o.doc, text));
  }

  /**
   * What could not be placed, and — F-503 / §8.2 — why: "Infeasibility
   * reports the binding shortage in resource terms the coordinator can act
   * on — not 'no solution found'."
   *
   * The shortage is the block somebody screenshots and takes to a budget
   * meeting, so it is the drawing's warn callout: one plain statement per
   * resource, with the two numbers in it.
   */
  private unplacedBlock(r: Report): HTMLElement | null {
    const d = this.o.doc;
    const missing = r.unplaced.reduce((sum, u) => sum + u.missing, 0);
    if (missing === 0 && r.shortages.length === 0) return null;

    const box = el(d, 'section', { className: 'gen-block gen-unplaced' });
    // Distinct from a soft trade: an unplaced period is a class that does not
    // happen, not a preference given up — so it is stated on its own.
    box.append(this.head(missing > 0 ? `${bn(missing)}টি পিরিয়ড বসানো যায়নি` : 'কেন বসানো যায়নি'));

    if (r.shortages.length > 0) {
      const ul = el(d, 'ul', { className: 'gen-shortage-list' });
      for (const s of r.shortages) {
        ul.append(el(d, 'li', {},
          el(d, 'span', { className: 'gen-trade-what' }, ...numText(d, s.detailBn))));
      }
      box.append(el(d, 'div', { className: 'gen-shortage' }, ul));
    }
    return box;
  }

  private tradeList(r: Report): HTMLElement {
    const d = this.o.doc;
    const box = el(d, 'section', { className: 'gen-block' });
    // The count heads the list it counts, above the accept button.
    box.append(this.head(`যা ছাড় দিতে হয়েছে · ${bn(r.soft.length)}টি`));

    const ul = el(d, 'ul', { className: 'gen-trades' });
    const shown = this.expanded ? r.soft : r.soft.slice(0, SOFT_SHOWN);
    for (const v of shown) {
      const li = el(d, 'li', {},
        el(d, 'span', { className: 'gen-trade-what' }, ...numText(d, v.detailBn)));
      if (v.causeBn) {
        // The cause is what turns a complaint into an argument for a hire.
        li.append(this.why(v.causeBn));
      }
      ul.append(li);
    }
    box.append(ul);

    if (!this.expanded && r.soft.length > SOFT_SHOWN) {
      // Never a bare "···": the count is what tells a coordinator whether
      // this is a tidy routine or a bad one.
      box.append(button(d, {
        label: `আরও ${bn(r.soft.length - SOFT_SHOWN)}টি দেখুন`,
        variant: 'ghost',
        className: 'gen-more',
        onClick: () => { this.expanded = true; this.render(); },
      }));
    }
    return box;
  }

  /**
   * The reason column. The drawing separates fact and reason by position
   * alone; a screen reader gets no position, so it hears the dash the eye
   * does not need.
   */
  private why(text: string): HTMLElement {
    const d = this.o.doc;
    return el(d, 'span', { className: 'gen-trade-why' },
      el(d, 'span', { className: 'ui-sr-only', text: '— ' }),
      ...numText(d, text));
  }

  /** A routine that gave nothing up says so, rather than showing an empty list. */
  private cleanNote(): HTMLElement {
    const d = this.o.doc;
    return el(d, 'section', { className: 'gen-block' },
      this.head('যা ছাড় দিতে হয়েছে'),
      el(d, 'p', { className: 'gen-none', text: 'কিছু ছাড় দিতে হয়নি' }));
  }

  private notEvaluated(r: Report): HTMLElement {
    const d = this.o.doc;
    const box = el(d, 'section', { className: 'gen-block gen-unchecked' });
    box.append(this.head('যা যাচাই করা হয়নি'));
    // Its own class, not only gen-trades: these are rules that did not run,
    // not trades that were made, and a selector that cannot tell them apart
    // would let an un-run rule be counted as a violation.
    const ul = el(d, 'ul', { className: 'gen-trades gen-unchecked-list' });
    for (const n of r.notEvaluated) {
      ul.append(el(d, 'li', {},
        el(d, 'span', { className: 'gen-trade-what' }, ...numText(d, n.ruleBn)),
        this.why(n.whyBn)));
    }
    box.append(ul);
    return box;
  }

  private explainPanel(r: Report): HTMLElement {
    const d = this.o.doc;
    const box = el(d, 'section', { className: 'gen-block' });
    box.append(this.head('কেন এই বরাদ্দ?'));

    const select = d.createElement('select');
    select.className = r.slots.length > 0 ? 'ui-select gen-slot-select n' : 'ui-select gen-slot-select';
    select.setAttribute('aria-label', 'স্লট বেছে নিন');
    const blank = d.createElement('option');
    blank.value = '';
    blank.textContent = 'স্লট বেছে নিন';
    select.append(blank);
    for (const s of r.slots) {
      const opt = d.createElement('option');
      opt.value = s.id;
      const label = `${DAY_BN[s.dayOfWeek]} · পিরিয়ড ${bn(s.periodNo)} · `
                  + `${s.sectionLabel} · ${s.subjectBn}`;
      opt.textContent = label;
      // An <option> holds text only, so it is the smallest element its
      // number can be marked on.
      if (hasDigit(label)) opt.className = 'n';
      if (this.explanation?.slotId === s.id) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      if (select.value) void this.explain(select.value);
      else { this.explanation = null; this.render(); }
    });
    box.append(select);

    if (this.explanation) {
      const e = this.explanation;
      const card = el(d, 'div', { className: 'gen-explain', attrs: { role: 'status' } });
      card.append(el(d, 'p', { className: 'gen-explain-head' },
        ...numText(d, `${DAY_BN[e.dayOfWeek]} · পিরিয়ড ${bn(e.periodNo)} · `
                    + `${e.sectionLabel} · ${e.subjectBn}`)));
      card.append(el(d, 'p', { className: 'gen-explain-line' }, ...numText(d, e.teacherWhyBn)));
      if (e.roomWhyBn) {
        card.append(el(d, 'p', { className: 'gen-explain-line' }, ...numText(d, e.roomWhyBn)));
      }
      box.append(card);
    }
    return box;
  }

  /**
   * 06 Routine §04's footer: the alternatives on the left, the one primary
   * at the right end. Only rendered while the routine is not yet live — a
   * published routine has nothing left to accept, discard or re-run, and its
   * state is the chip in the header.
   */
  private actions(): HTMLElement {
    const d = this.o.doc;
    return el(d, 'div', { className: 'gen-foot action-row' },
      button(d, {
        label: 'আবার চালান', variant: 'secondary',
        disabled: this.busy || !this.o.onRegenerate,
        onClick: () => { this.o.onRegenerate?.(this.o.routineId); },
      }),
      button(d, {
        label: 'বাতিল', variant: 'secondary',
        disabled: this.busy,
        onClick: () => { void this.act('discard'); },
      }),
      button(d, {
        label: 'গ্রহণ করুন', variant: 'primary',
        disabled: this.busy,
        onClick: () => { void this.act('accept'); },
      }));
  }
}
