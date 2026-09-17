/**
 * Substitution finder (বদলি শিক্ষক) — the RMS §5 engine as a page.
 *
 * Flow: pick a date → the user's own teaching slots that day (from
 * GET /api/v1/rms/routine, the same source as the routine tab) → tap a slot
 * → POST /api/v1/rms/substitute ranks free, subject-matched candidates →
 * one tap assigns (coordinator-level roles; the server's 403 is surfaced
 * plainly for everyone else, and the check_substitute_free DB trigger keeps
 * a stale list from ever double-booking anyone).
 *
 * ── Ata Ekta (02 Teacher §07, drawn on a phone) ────────────────────────────
 * A --danger-tint band says how many periods still need someone; under it one
 * block per period — time, section and subject on one line, the period's
 * state beneath. The band and the blocks are one panel, with no gap between.
 *
 * The drawing also puts each period's top candidate on the block itself as a
 * one-tap green button. That needs a candidate search for every period on
 * load, which this screen does not make, so the candidates stay one tap away
 * in the drawer — where, as the design's note says, the subject match comes
 * first and is the green button.
 */
import type { Auth } from './auth.ts';
import type { RoutineSlot } from './routine-view.ts';
import { formatTime, todayLocalIso } from '../../../packages/ui-core/src/format.ts';
import {
  pageHeader, field, dataTable, statusBadge, button, listSkeleton, openDrawer,
  setOverlayBody, el, append, numText, list, listItem, emptyState, errorState,
  permissionState, permissionMessage, type OverlayHandle,
} from './ui/index.ts';
import { bnDate, bnNum, successNote } from './view-states.ts';

interface Candidate {
  teacherId: string;
  fullName: { bn: string | null; en: string | null };
  rank: number;
  matchScore: number;
  matchReasons: string[];
}

export interface SubstituteViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/**
 * Which state a notice is, and whose. The page owns a failed or refused day;
 * the drawer owns a failed or refused search or assignment. Each renders where
 * the person is looking — a drawer's failure used to print on the page behind
 * the drawer's scrim, where readers could not reach it, beside a stale table.
 */
type NoticeKind =
  | 'none'
  | 'loadError' | 'loadDenied'
  | 'findError' | 'findDenied'
  | 'assignError' | 'assignDenied';

/** The empty day's way out: straight to the date control, its picker open where the browser has one. */
function pickAnotherDay(input: HTMLElement): void {
  input.focus();
  try { (input as HTMLInputElement).showPicker?.(); } catch { /* focus alone still gets them there */ }
}

export class SubstituteView {
  private readonly o: SubstituteViewOptions;
  private date = todayLocalIso();
  private slots: RoutineSlot[] = [];
  private selectedSlot: RoutineSlot | null = null;
  private candidates: Candidate[] = [];
  private busy = false;
  private notice = '';
  private noticeKind: NoticeKind = 'none';
  /** The open candidate drawer, so a result can fill it without a repaint. */
  private drawer: OverlayHandle | null = null;
  /** Which periods already have a substitute, so the table says so. */
  private readonly assignedSlots = new Set<string>();
  private assignedTo: string | null = null;

  constructor(options: SubstituteViewOptions) {
    this.o = options;
    void this.loadSlots();
  }

  private async loadSlots(): Promise<void> {
    this.busy = true;
    // A new day is a new set of periods: a drawer left open over it would be
    // staffing a period that is no longer on screen.
    this.drawer?.close();
    this.drawer = null;
    this.selectedSlot = null;
    this.candidates = [];
    this.assignedTo = null;
    this.notice = '';
    this.noticeKind = 'none';
    // The loading state is the skeleton, not the previous day's periods
    // standing under the new date.
    this.slots = [];
    this.render();
    try {
      const res = await this.o.auth.authedFetch(`/api/v1/rms/routine?scope=day&date=${this.date}`);
      if (res.status === 403) {
        // A refusal is not a connection problem, and retrying it is futile.
        this.noticeKind = 'loadDenied';
      } else {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { slots: RoutineSlot[] };
        this.slots = body.slots.filter((s) => s.slotKind === 'teaching' && !s.isSubstitution);
      }
    } catch {
      this.slots = [];
      this.notice = 'রুটিন আনা যায়নি — সংযোগ দেখুন।';
      this.noticeKind = 'loadError';
    }
    this.busy = false;
    this.render();
  }

  private async findCandidates(slot: RoutineSlot): Promise<void> {
    this.selectedSlot = slot;
    this.candidates = [];
    this.assignedTo = null;
    this.busy = true;
    this.notice = '';
    this.noticeKind = 'none';
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/rms/substitute', {
        method: 'POST',
        body: JSON.stringify({ slotId: slot.slotId, date: this.date }),
      });
      const body = (await res.json().catch(() => ({}))) as { candidates?: Candidate[]; error?: string };
      if (res.ok && body.candidates) {
        // No one free is the drawer's own empty state — not a second notice.
        this.candidates = body.candidates;
      } else if (res.status === 403) {
        this.notice = 'বদলি খোঁজা শুধু সমন্বয়কারী/অধ্যক্ষ পর্যায়ের জন্য।';
        this.noticeKind = 'findDenied';
      } else {
        // The error card carries its own "আবার চেষ্টা করুন" button.
        this.notice = 'প্রার্থী খোঁজা যায়নি।';
        this.noticeKind = 'findError';
      }
    } catch {
      this.notice = 'প্রার্থী খোঁজা যায়নি — সংযোগ দেখুন।';
      this.noticeKind = 'findError';
    }
    this.busy = false;
    this.render();
  }

  private async assign(candidate: Candidate): Promise<void> {
    const slot = this.selectedSlot;
    if (!slot || this.busy) return;
    this.busy = true;
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/rms/substitute', {
        method: 'POST',
        body: JSON.stringify({
          slotId: slot.slotId,
          date: this.date,
          assign: true,
          substituteTeacherId: candidate.teacherId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) {
        this.assignedTo = candidate.fullName.bn || candidate.fullName.en || candidate.teacherId;
        // The table behind the drawer says so too, so a coordinator staffing
        // six periods can see which are done without closing anything.
        this.assignedSlots.add(slot.slotId);
        this.notice = '';
        this.noticeKind = 'none';
      } else if (body.error === 'substitute_conflict') {
        this.notice = 'এই শিক্ষক ইতিমধ্যে ব্যস্ত হয়ে গেছেন — অন্য কাউকে বেছে নিন।';
        await this.findCandidates(slot);
        return;
      } else if (res.status === 403) {
        this.notice = 'বদলি নির্ধারণ শুধু সমন্বয়কারী/অধ্যক্ষ পর্যায়ের জন্য।';
        this.noticeKind = 'assignDenied';
      } else {
        this.notice = 'নির্ধারণ করা যায়নি। আবার চেষ্টা করুন।';
        this.noticeKind = 'assignError';
      }
    } catch {
      this.notice = 'সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।';
      this.noticeKind = 'assignError';
    }
    this.busy = false;
    this.render();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    root.append(pageHeader(d, {
      title: 'বদলি শিক্ষক',
      subtitle: 'অনুপস্থিতির দিনে ফাঁকা ও বিষয়-মিল শিক্ষক খুঁজুন',
    }));

    // A refusal is the whole page. A date control above it would only fetch
    // the same refusal for another day: the server refuses the reader, not
    // the date.
    if (this.noticeKind === 'loadDenied') {
      root.append(permissionState(d, {
        message: permissionMessage('রুটিন'), contact: 'প্রধান শিক্ষক',
      }));
      return;
    }

    // A labelled field. This was a bare `<input type=date>` with no name of
    // any kind, on the screen whose entire question is which day. field()
    // sets a date control in the numeral face (`n is-num`).
    const day = field(d, {
      label: 'কোন দিনের জন্য',
      name: 'day',
      kind: 'date',
      value: this.date,
      helper: 'ওই দিনের রুটিন থেকে পিরিয়ডগুলো আসবে।',
      className: 'subst-date',
      onChange: (v) => {
        if (!v) return;
        this.date = v;
        void this.loadSlots();
      },
    });
    root.append(day.root);

    if (this.busy && this.slots.length === 0) {
      root.append(el(d, 'div', { className: 'subst-panel' }, listSkeleton(d, 4)));
      return;
    }

    // Failed is a state of its own (denied returned above). A failed load
    // does not know whether the day has classes, so it never also says it
    // has none. It keeps the date control: another day may well load.
    if (this.noticeKind === 'loadError') {
      root.append(errorState(d, this.notice, () => { void this.loadSlots(); }));
      return;
    }

    const panel = el(d, 'div', { className: 'subst-panel' });

    // The band: how many periods on this day still have nobody. It goes
    // when there are no periods (the empty state speaks) or when every one
    // is covered (there is nothing left to warn about).
    const needing = this.slots.filter((s) => !this.assignedSlots.has(s.slotId)).length;
    if (needing > 0) {
      append(panel, el(d, 'div', { className: 'subst-alert' },
        el(d, 'p', { className: 'subst-alert-title' }, ...numText(d, bnDate(this.date))),
        el(d, 'p', { className: 'subst-alert-count' },
          ...numText(d, `${bnNum(needing)}টি ক্লাসে বদলি দরকার`))));
    }

    append(panel, dataTable(d, {
      className: 'subst-day',
      caption: `${bnDate(this.date)} — এই দিনের পিরিয়ড`,
      rows: this.slots,
      rowKey: (sl) => sl.slotId,
      onRowClick: (sl) => { void this.findCandidates(sl); },
      empty: {
        glyph: 'clock',
        message: 'এই দিনে আপনার কোনো ক্লাস নেই।',
        action: { label: 'অন্য তারিখ বেছে নিন', onClick: () => pickAnotherDay(day.input) },
      },
      // On a phone a period reads as the design's block: time, section,
      // subject on one line (title → subtitle → meta, in DOM order), its
      // state under them. The desktop header order is unchanged.
      columns: [
        { key: 'time', header: 'সময়', mobile: 'title',
          cell: (sl) => formatTime(sl.startsAt.slice(0, 5), 'bn'), width: '120px' },
        { key: 'subject', header: 'বিষয়', mobile: 'meta',
          cell: (sl) => sl.subjectBn ?? '—', width: 'minmax(0, 2fr)' },
        { key: 'section', header: 'শাখা', mobile: 'subtitle',
          cell: (sl) => sl.sectionLabel ?? '—', width: 'minmax(0, 1.4fr)' },
        { key: 'state', header: 'অবস্থা', mobile: 'status', width: '160px',
          cell: (sl) => (this.assignedSlots.has(sl.slotId)
            ? statusBadge(d, { state: 'published', label: 'বদলি নির্ধারিত' })
            : statusBadge(d, { state: 'pending', label: 'বদলি লাগবে' })) },
      ],
    }));
    root.append(panel);

    // The drawer is filled from the same render pass that draws the table,
    // so a result landing mid-search reaches it without a second code path.
    if (this.selectedSlot) this.renderCandidates();
  }

  /**
   * Candidates for ONE period, in a drawer.
   *
   * A drawer rather than a second full screen: the coordinator is staffing a
   * day, and replacing the day with a candidate list makes them remember
   * which period they were on. Everything that was on the old candidate
   * screen is here, plus the period itself as the drawer's own title.
   */
  private renderCandidates(): void {
    const d = this.o.doc;
    const sl = this.selectedSlot;
    if (!sl) return;

    const body = el(d, 'div', { className: 'ui-card-form' });

    if (this.assignedTo) {
      append(body, successNote(d, `${this.assignedTo} কে বদলি নির্ধারণ করা হয়েছে।`));
    } else if (this.busy) {
      append(body, listSkeleton(d, 3));
    } else if (this.noticeKind === 'findDenied' || this.noticeKind === 'assignDenied') {
      append(body, permissionState(d, { message: this.notice, contact: 'প্রধান শিক্ষক' }));
    } else if (this.noticeKind === 'findError') {
      append(body, errorState(d, this.notice, () => { void this.findCandidates(sl); }));
    } else {
      // No retry on a failed assignment: pressing নির্ধারণ again is the retry,
      // and the list it needs stays right under the message.
      if (this.noticeKind === 'assignError') append(body, errorState(d, this.notice));
      append(body, this.candidateList(d));
    }

    if (this.drawer) {
      setOverlayBody(this.drawer, body);
      this.keepFocusInDrawer(this.drawer);
    } else {
      this.drawer = openDrawer(d, {
        // The period as the design's block names it: time · section · subject.
        title: [formatTime(sl.startsAt.slice(0, 5), 'bn'), sl.sectionLabel, sl.subjectBn]
          .filter(Boolean).join(' · '),
        body,
        onClose: () => {
          this.drawer = null;
          this.selectedSlot = null;
          this.assignedTo = '';
          this.notice = '';
          this.noticeKind = 'none';
          this.render();
        },
      });
    }
  }

  /**
   * Focus stays inside the open drawer when its body is swapped.
   *
   * Assigning, or retrying a failed search, replaces the body while the
   * drawer stays open. That removes the control that had focus (নির্ধারণ,
   * আবার চেষ্টা করুন), and the browser drops focus to <body>. That is
   * outside the dialog. The overlay's Tab trap only wraps at the dialog's
   * first and last items, so from <body> the next Tab walked into the page
   * behind the scrim, which is aria-hidden. The shell's focus keeper does not
   * step in while an overlay is open, so the screen does it here: the dialog's
   * first control, as the overlay picks on open. That is ✕, where the trap
   * holds in both directions.
   */
  private keepFocusInDrawer(drawer: OverlayHandle): void {
    const d = this.o.doc;
    if (drawer.el.contains(d.activeElement)) return;
    const first = drawer.el.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    (first ?? drawer.el).focus();
  }

  /**
   * The ranked candidates, as rows — a drawer is narrow at every width, so it
   * is a list on a desktop too, where a four-column table used to squeeze two
   * names into 150px.
   *
   * The server's first candidate, when it teaches this subject, is the green
   * button the design draws ("বিষয় মিল" first — usually the right answer).
   * Every other row's button is the outline one. No accent anywhere: the
   * screen has no primary action of its own.
   */
  private candidateList(d: Document): HTMLElement {
    if (!this.candidates.length) {
      return emptyState(d, {
        glyph: 'users',
        message: 'এই সময়ে কোনো শিক্ষক ফাঁকা নেই। অন্য পিরিয়ড দেখুন বা রুটিন বদলান।',
        action: { label: 'পিরিয়ডের তালিকায় ফিরুন', onClick: () => { this.drawer?.close(); } },
      });
    }
    return list(d, 'সম্ভাব্য বদলি শিক্ষক', ...this.candidates.map((c, i) => {
      // WHY this teacher is suggested. A ranked list with no stated reason is
      // a ranking a coordinator cannot disagree with.
      const subjectMatch = c.matchReasons.includes('subject_expertise');
      return listItem(d, {
        title: c.fullName.bn || c.fullName.en || '—',
        subtitle: subjectMatch ? 'বিষয় মিল · এই সময়ে ফাঁকা' : 'এই সময়ে ফাঁকা',
        meta: `ক্রম ${bnNum(c.rank)}`,
        status: el(d, 'div', { className: 'ui-row-actions' }, button(d, {
          label: 'নির্ধারণ',
          variant: i === 0 && subjectMatch ? 'success' : 'secondary',
          size: 'sm',
          ariaLabel: `${c.fullName.bn || c.fullName.en || 'এই শিক্ষক'}-কে বদলি নির্ধারণ করুন`,
          disabled: this.busy,
          onClick: () => { void this.assign(c); },
        })),
      });
    }));
  }
}
