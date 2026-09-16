/**
 * Guardian — আমার সন্তান. F-1001, F-1002, F-203; drawn as Ata Ekta 04 §02.
 *
 *   আমার সন্তান                                (page header)
 *   ┌ আনিকা ────────┬ বিজয় ─────────┐         (child strip, 2–3 children)
 *   │ নবম–ক         │ ষষ্ঠ–খ          │
 *   ┌──────────────────────────────────┐
 *   │ (আ)  আনিকা রহমান                 │         identity
 *   │      নবম–ক · রোল 1               │
 *   ├────────────────┬─────────────────┤
 *   │ এ মাসে হাজিরা   │ GPA             │         four figures, 2 × 2
 *   │ ৯৪%            │ ৪.৫৬            │
 *   ├────────────────┼─────────────────┤
 *   │ বকেয়া          │ মেধাক্রম         │
 *   │ ৳ 2,500.00     │ ৭/৫২            │
 *   ├────────────────┴─────────────────┤
 *   │ [ ফি পরিশোধ করুন ] [ মার্কশিট দেখুন ] │   two actions, neither the accent
 *   └──────────────────────────────────┘
 *
 * §9.1's rule is a warning about the reader, not the data: "This persona
 * has the lowest technical comfort in the product and may use the app four
 * times a year — it must survive being forgotten."
 *
 * Everything here follows from that sentence.
 *
 * The switcher sits above the panel and renders even while the child's
 * detail is still loading, so the first thing on screen is the thing the
 * guardian came to change.
 *
 * ── The four figures ──────────────────────────────────────────────────────
 * 04 §02 draws "চারটি সংখ্যা" in a 2 × 2 grid: এ মাসে হাজিরা · গড় নম্বর ·
 * বকেয়া · জমা বাকি. The ward payload has no average mark and no pending-work
 * count, so those two slots carry the two result figures this screen has
 * always shown — the GPA and the rank with its cohort. Nothing is invented,
 * and the drawn 2 × 2 is what a guardian with all three modules sees. A cell
 * whose module the school does not run is omitted; 13 Responsive rule ০২
 * (in the stat row component) stacks an odd count as rows, never 1 + 2.
 *
 * Every state carries a word. "আজ ✓ উপস্থিত" not a green dot; "২টি বিল সময়
 * পেরিয়েছে" not only a red number. Somebody who opens this four times a year has
 * no memory of what the colours meant last time.
 *
 * ── The two actions ───────────────────────────────────────────────────────
 * 04 §02 ends on two equal secondary buttons. The drawn pair (call the
 * teacher, apply for leave) needs a teacher's number and a leave flow that do
 * not exist; the slot holds the two navigations this screen already had —
 * the fee screen (§9.1: payment is one tap from home) and the mark sheet. No
 * accent: this page draws no primary button.
 *
 * Framework-free manual DOM, same as every other view here.
 */
import type { Auth } from './auth.ts';
import { formatCount, formatBdt, formatDayMonth, toBanglaDigits }
  from '../../../packages/ui-core/src/format.ts';
import {
  el, append, icon, button, statCard, statRow, pageHeader,
  listSkeleton, emptyState, errorState, humanError, permissionState, permissionMessage,
} from './ui/index.ts';
import { childSelector, childIdentity, type ChildOption } from './ui/child-selector.ts';

const bn = (n: number): string => formatCount(n, 'bn');

export interface WardSummary {
  studentId: string;
  nameBn: string;
  sectionLabel: string;
  rollNo: number;
  relationBn: string;
}

export interface WardHome extends WardSummary {
  /**
   * `null` when the SCHOOL does not have that module (B-53), as opposed to
   * the inner fields being null when the school has it and there is nothing
   * in it yet. A guardian is never told which modules their school bought —
   * that is a commercial fact between the school and us — so an absent block
   * simply means an absent figure.
   */
  attendance: {
    todayStatus: string | null;
    monthPercent: number | null;
    present: number; absent: number; late: number; halfDay: number; excused: number;
  } | null;
  fees: { outstanding: number; earliestDue: string | null; overdueCount: number } | null;
  result: {
    examNameBn: string; gpa: number | null;
    rankInSection: number | null; sectionSize: number | null;
  } | null;
}

export interface GuardianViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Navigates to the fee screen. §9.1: payment is one tap from home. */
  onOpenFees?: (studentId: string) => void;
  /** Navigates to the published mark sheet. */
  onOpenResults?: (studentId: string) => void;
}

/** Attendance states, each with a glyph AND a word (F-812). */
const TODAY: Record<string, { glyph: string; labelBn: string }> = {
  present:  { glyph: '✓', labelBn: 'উপস্থিত' },
  late:     { glyph: '◔', labelBn: 'দেরিতে এসেছে' },
  half_day: { glyph: '◑', labelBn: 'অর্ধদিবস' },
  absent:   { glyph: '✗', labelBn: 'অনুপস্থিত' },
  excused:  { glyph: '⌾', labelBn: 'ছুটি মঞ্জুর' },
};

const ENDPOINT = '/api/v1/academics/ward';
/** A rejection that still knows its HTTP status. Explicit field: strip-only. */
export class HttpStatus extends Error {
  status: number;
  constructor(status: number) { super(String(status)); this.status = status; }
}

/** Shared with the guardian home, which reads the same ward payload. */
export const CACHE_KEY = 'shikhon_guardian_home';

export class GuardianView {
  private readonly o: GuardianViewOptions;
  private wards: WardSummary[] = [];
  private selected: string | null = null;
  private home: WardHome | null = null;
  private loading = true;
  private offline = false;
  private error = false;
  /** The HTTP status behind `error`, so a 403 can say so. */
  private errStatus: number | undefined;

  constructor(options: GuardianViewOptions) {
    this.o = options;
    // Cache first. This persona is the likeliest to open the app on a
    // borrowed phone with a bad connection, and a blank screen would be
    // read as "the school has nothing for me".
    const cached = this.readCache();
    if (cached) {
      this.wards = cached.wards;
      this.home = cached.home;
      this.selected = cached.home?.studentId ?? cached.wards[0]?.studentId ?? null;
      this.loading = false;
    }
    this.render();
    void this.load();
  }

  private readCache(): { wards: WardSummary[]; home: WardHome | null } | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as { wards: WardSummary[]; home: WardHome | null }) : null;
    } catch {
      return null;
    }
  }

  private async load(studentId?: string): Promise<void> {
    const target = studentId ?? this.selected;
    try {
      const res = await this.o.auth.authedFetch(
        target ? `${ENDPOINT}?studentId=${encodeURIComponent(target)}` : ENDPOINT);
      if (!res.ok) throw new HttpStatus(res.status);
      const body = (await res.json()) as { wards: WardSummary[]; student: WardHome | null };
      this.wards = body.wards;
      this.home = body.student;
      this.offline = false;
      this.error = false;
      this.errStatus = undefined;

      // With no child chosen the first request only returns the list, so
      // pick one and fetch it. A guardian with one child must never have
      // to choose it.
      if (!body.student && body.wards.length > 0) {
        this.selected = body.wards[0].studentId;
        this.loading = true;
        this.render();
        await this.load(this.selected);
        return;
      }
      this.selected = body.student?.studentId ?? null;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ wards: this.wards, home: this.home }));
      } catch { /* quota */ }
    } catch (err) {
      const status = err instanceof HttpStatus ? err.status : undefined;
      this.errStatus = status;
      // Cached data plus a banner beats an error page: last week's
      // attendance is still worth reading, and the fee balance changes
      // slowly. But NOT for a 403 — showing a cached child to somebody the
      // server has just refused is the opposite of what the refusal meant,
      // and no retry will change it.
      if (status === 403) { this.home = null; this.wards = []; this.error = true; }
      else if (this.home) this.offline = true;
      else this.error = true;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private select(studentId: string): void {
    if (studentId === this.selected) return;
    this.selected = studentId;
    this.home = null;
    this.loading = true;
    this.render();
    void this.load(studentId);
  }

  // ── rendering ───────────────────────────────────────────────────────
  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', 'bn');

    // The page names itself the way the guardian's other tabs (ফলাফল, বেতন)
    // do, so moving between them does not change what the top of a page is.
    append(root, pageHeader(d, {
      title: 'আমার সন্তান',
      subtitle: 'আজকের হাজিরা, ফলাফল ও বকেয়া ফি — এক নজরে।',
    }));

    // The selector first and always, even mid-load: §9.1 calls it "the single
    // most-used control here", and it is what the guardian opened the app to
    // use. It renders nothing at all for a single child — a control with one
    // option teaches people their tap did nothing.
    const switcher = childSelector(d, {
      children: this.wards.map(toChildOption),
      selectedId: this.selected,
      onSelect: (id) => this.select(id),
    });
    switcher?.classList.add('ward-switch');
    append(root, switcher);

    if (this.error) {
      // The status, not just the connectivity: a guardian who reaches a screen
      // that is not theirs is told so, instead of being offered a retry that
      // cannot work.
      // B-30. A refusal gets the permission state, NOT the error state: the
      // error state's whole shape is a sentence plus a retry button, and a
      // retry after a 403 is a button that cannot work. Found in a browser —
      // the message was already right and the button was still there.
      if (this.errStatus === 403) {
        append(root, permissionState(d, {
          message: permissionMessage('সন্তানের তথ্য'),
          contact: 'প্রধান শিক্ষক',
        }));
        return;
      }
      append(root, errorState(d, humanError(
        navigator.onLine ? null : 'offline', this.errStatus), () => {
        this.error = false; this.loading = true; this.render(); void this.load();
      }));
      return;
    }
    if (this.offline) {
      // Cached data under the --warn-tint banner (§7) beats an error page:
      // last week's attendance is still worth reading and the fee balance
      // changes slowly. This screen only reads, so nothing is queued and there
      // is no waiting count to show.
      append(root, el(d, 'p', {
        className: 'offline-banner ward-offline', attrs: { role: 'status' },
      }, icon(d, 'wifi-off', 'offline-icon'),
         el(d, 'span', {
           text: 'অফলাইন — সর্বশেষ সংরক্ষিত তথ্য দেখানো হচ্ছে। সংযোগ পেলে নিজেই হালনাগাদ হবে।',
         })));
    }

    if (this.loading && !this.home) { append(root, listSkeleton(d, 3)); return; }
    if (!this.home) {
      append(root, emptyState(d, {
        glyph: 'users',
        // Says what to do. A guardian whose child is not linked cannot fix it
        // from this screen, and pretending otherwise wastes their afternoon.
        message: 'আপনার সাথে কোনো শিক্ষার্থী যুক্ত নেই। বিদ্যালয়ের অফিসে যোগাযোগ করুন।',
      }));
      return;
    }

    const h = this.home;
    const identity = childIdentity(d, toChildOption(h));
    identity.classList.add('ward-id');
    // One white panel, sections split by a hairline (04 §02): whose child,
    // the figures, then what to do next.
    append(root, el(d, 'div', { className: 'ward-panel' },
      identity,
      this.figures(h),
      this.actions(h)));
  }

  /**
   * The figures, in the order 04 §02 draws its grid: attendance, marks, dues,
   * then the fourth slot.
   *
   * Never a bare number: the label says what it counts, and every figure that
   * carries a tone also carries its meaning in words — the tone colours the
   * number, it is not the message.
   */
  private figures(h: WardHome): HTMLElement | null {
    const d = this.o.doc;
    const cells: HTMLElement[] = [];
    const tag = (cell: HTMLElement, cls: string): HTMLElement => {
      cell.classList.add(cls);
      return cell;
    };

    // Each cell is omitted entirely when the school does not run that module.
    // Rendering "০%" or "✓ বকেয়া নেই" instead would be a claim about the
    // child, made out of the absence of a purchase.
    if (h.attendance) {
      const state = TODAY[h.attendance.todayStatus ?? ''] ?? null;
      const month = h.attendance.monthPercent;
      // Silence is not absence: an unmarked register says so.
      const today = state ? `আজ ${state.glyph} ${state.labelBn}` : 'আজ হাজিরা নেওয়া হয়নি';
      cells.push(tag(statCard(d, {
        label: 'এ মাসে হাজিরা',
        value: month === null ? '—' : `${bn(month)}%`,
        note: month === null ? `এ মাসের হিসাব নেই · ${today}` : today,
        // No tone. 04 §02 draws its ৯৬% in --ok, but nothing here says when a
        // month is good: a green that ৭৮% and ৪০% would wear alike carries no
        // meaning, and a tone must (§3, lead decision 6).
      }), 'ward-stat-att'));
    }

    const r = h.result;
    if (r) {
      cells.push(tag(statCard(d, {
        label: 'GPA',
        // As the results screen writes it: two places, Bangla digits.
        value: r.gpa === null ? '—' : toBanglaDigits(r.gpa.toFixed(2)),
        // Which exam — a GPA with no exam beside it answers nothing.
        note: r.examNameBn,
      }), 'ward-stat-gpa'));
    }

    if (h.fees) {
      const fees = h.fees;
      const owed = fees.outstanding;
      cells.push(tag(statCard(d, {
        label: 'বকেয়া',
        value: owed === 0 ? '✓ বকেয়া নেই' : formatBdt(owed),
        note: owed === 0
          ? 'সব পরিশোধিত'
          : fees.overdueCount > 0
            ? `${bn(fees.overdueCount)}টি বিল সময় পেরিয়েছে`
            : fees.earliestDue
              ? `${formatDayMonth(fees.earliestDue, 'bn')} শেষ তারিখ`
              : '',
        // --danger is বকেয়া, --ok is পরিশোধিত (§3) — both with words.
        tone: owed === 0 ? 'success' : 'danger',
        onClick: this.o.onOpenFees ? () => this.o.onOpenFees?.(h.studentId) : undefined,
      }), 'ward-stat-fees'));
    }

    // A rank without its cohort is a number a guardian cannot read. §9.1
    // draws "মেধাক্রম ৭/৫২" for exactly that reason, so without the cohort
    // there is no rank at all.
    if (r && r.rankInSection !== null && r.sectionSize !== null) {
      cells.push(tag(statCard(d, {
        label: 'মেধাক্রম',
        value: `${bn(r.rankInSection)}/${bn(r.sectionSize)}`,
      }), 'ward-stat-rank'));
    }

    if (!cells.length) return null;
    const row = statRow(d, ...cells);
    row.classList.add('ward-stats');
    return row;
  }

  /** The two equal secondary actions under the figures (04 §02). */
  private actions(h: WardHome): HTMLElement | null {
    const d = this.o.doc;
    // No finance module, no fee button. It would open a screen the server
    // refuses, and a guardian tapping "ফি পরিশোধ করুন" and reaching an error
    // learns that the app is broken rather than that their school does not
    // use this part of it.
    //
    // §9.1 labels this "বিকাশে ফি পরিশোধ করুন". MFS checkout (F-1005) is not
    // built, so naming bKash here would promise a flow that does not exist.
    // This opens the fee screen, which does — one tap from home, as §9.1
    // requires, without the lie.
    const fees = h.fees
      ? button(d, {
          label: h.fees.outstanding > 0 ? 'ফি পরিশোধ করুন' : 'ফি ও রসিদ দেখুন',
          variant: 'secondary', glyph: 'wallet',
          disabled: !this.o.onOpenFees,
          onClick: () => this.o.onOpenFees?.(h.studentId),
        })
      : null;
    // Published is the only result a guardian ever sees — the endpoint
    // returns nothing else — so there is a sheet to open whenever there is a
    // result.
    const sheet = h.result && this.o.onOpenResults
      ? button(d, {
          label: 'মার্কশিট দেখুন', variant: 'secondary', glyph: 'file-text',
          onClick: () => this.o.onOpenResults?.(h.studentId),
        })
      : null;
    if (!fees && !sheet) return null;
    return el(d, 'div', { className: 'ward-cta' }, fees, sheet);
  }
}

/**
 * A ward summary as the selector's option.
 *
 * One mapping, used by the selector, the identity block and the sheet, so the
 * three cannot name the same child differently — which is the specific way a
 * "which child am I looking at" bug appears.
 */
export function toChildOption(w: WardSummary): ChildOption {
  return {
    studentId: w.studentId,
    nameBn: w.nameBn,
    sectionLabel: w.sectionLabel,
    rollNo: w.rollNo,
    relationBn: w.relationBn,
  };
}
