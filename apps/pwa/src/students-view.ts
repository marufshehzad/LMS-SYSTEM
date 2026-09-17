/**
 * শিক্ষার্থী খুঁজুন — global student search, and one child's whole history.  (R-6)
 *
 * The master plan's exit criterion is a sentence about a person: "principal
 * types an old ID or a name; the student's full multi-year history appears".
 * This screen is that sentence.
 *
 *     খুঁজুন → তালিকা → একজনকে খুলুন → বছরওয়ারি ইতিহাস
 *
 * ── Two loads, not one ──────────────────────────────────────────────────
 * §15 of the brief, and it is the whole performance design: the search
 * returns a COMPACT row per student — name, code, latest class/section/roll,
 * status — and nothing else. A result list that carried each child's four
 * years of enrolment, attendance and results would do twenty-five students'
 * worth of history work to render one screen, and the person wanted one of
 * them. Opening a student is the second load.
 *
 * ── One route, two states ───────────────────────────────────────────────
 * The list and the detail live in one view rather than two routes, because
 * the back button has to return to the SEARCH RESULTS and not to an empty
 * search box. A hash route would lose the query; keeping both states here
 * means `ফলাফলে ফিরুন` returns to exactly what was on screen.
 *
 * ── Current versus historical ───────────────────────────────────────────
 * §6 asks for these to be visibly different, and the timeline makes it
 * structural rather than cosmetic: the year whose enrolment is `active` is
 * rendered as the current row with its own heading, and every other year is
 * history. That flag comes from the server (`isCurrent`), computed from
 * `enrolments.status`, so a graduated child correctly has NO current row —
 * rather than the app assuming the last one must be.
 *
 * ── Ata Ekta (05 Principal §03) ─────────────────────────────────────────
 * The search is ONE panel, as drawn: an inset filter strip (the search box
 * and the status select), the result table, and the footer with the count and
 * আগে / পরে. Every state — shimmer rows, the empty and error cards, a refusal
 * — replaces the table inside that same panel, under the strip. The one
 * student is not drawn in 05; it is built from the 14 Components parts the
 * handoff names for it: backLink, tabs, and the timeline "শিক্ষার্থীর
 * বছরওয়ারি ইতিহাস".
 */
import type { Auth } from './auth.ts';
import { skeleton, errorState, emptyState, bnNum, bnDate } from './view-states.ts';
import {
  el, append, numText, numClass, hasDigit,
  dataTable, statusBadge, searchField, filterBar, tabs, pagination, timeline,
  list, listItem, button, backLink, sectionHeading, listSkeleton,
  permissionState, serverMessage, announce, focusIsLost,
} from './ui/index.ts';
import { pageHeader } from './ui/page-header.ts';
import {
  formatAcademicYear, formatBdt, formatIdentifier,
} from '../../../packages/ui-core/src/format.ts';

export interface StudentsViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/**
 * The lifecycle values `student_profiles.lifecycle_status` actually permits.
 *
 * R-6's brief named six English words — Active, Transferred, Withdrawn,
 * Graduated, Archived, Alumni — and the column's CHECK permits six different
 * ones. The brief also says to reuse the existing model, so these are the
 * column's, with the Bangla a school would use. 'Archived' has no equivalent
 * and is not invented.
 */
const STATUS_BN: Record<string, string> = {
  enrolled: 'অধ্যয়নরত',
  promoted: 'উন্নীত',
  transferred_out: 'ছাড়পত্র নিয়েছে',
  dropped_out: 'ঝরে পড়েছে',
  graduated: 'উত্তীর্ণ',
  alumni: 'প্রাক্তন শিক্ষার্থী',
};

const ENROLMENT_STATUS_BN: Record<string, string> = {
  active: 'চলমান',
  promoted: 'উন্নীত',
  transferred: 'বদলি',
  left: 'ছেড়েছে',
  detained: 'একই শ্রেণিতে',
};

/**
 * The chip a lifecycle gets. 05 §03 draws two: a student still in the school
 * (ok ground, "চলমান") and everyone else (neutral inset, "প্রাক্তন"). The word
 * is always STATUS_BN's, so colour never carries the meaning alone.
 *
 * The mapping this replaced compared against 'active' and 'passed_out', which
 * the column never holds — so every enrolled child wore a red alert badge.
 */
function lifecycleState(s: string): string {
  return s === 'enrolled' || s === 'promoted' ? 'active' : 'draft';
}

/** The timeline dot for one year's enrolment. The status word sits beside it. */
const ENROLMENT_TONE: Record<string, string> = {
  active: 'success',
  promoted: 'success',
  detained: 'warn',
  transferred: 'neutral',
  left: 'neutral',
};

interface SearchResult {
  id: string;
  name: { bn: string; en: string | null };
  studentCode: string;
  lifecycleStatus: string;
  latest: {
    yearLabel: string; classBn: string | null; groupBn: string | null;
    section: string | null; rollNo: number | null; isCurrent: boolean;
  } | null;
}

interface SearchPayload {
  total: number; limit: number; offset: number;
  matchedOn: string | null;
  students: SearchResult[];
}

interface HistoryPayload {
  student: {
    id: string; name: { bn: string; en: string | null }; studentCode: string;
    lifecycleStatus: string; admissionDate: string; graduatedOn: string | null;
    bloodGroup: string | null; fatherNameBn: string | null;
    motherNameBn: string | null; dateOfBirth: string | null; phone: string | null;
    boardRegistrationNo: string | null; boardRollNo: string | null;
  };
  enrolments: {
    yearLabel: string; classBn: string; classEn: string; levelNo: number;
    groupBn: string; section: string; shift: string; rollNo: number;
    status: string; enrolledOn: string; endedOn: string | null; isCurrent: boolean;
  }[];
  attendance: {
    yearLabel: string; present: number; absent: number; late: number;
    excused: number; halfDay: number; total: number; percent: number | null;
  }[];
  results: {
    yearLabel: string; examBn: string; totalMarks: string | null;
    totalMax: string | null; percentage: string | null; gpa: string | null;
    letterGrade: string | null; isPass: boolean; rankInSection: number | null;
  }[];
  fees: {
    years: { yearLabel: string; invoices: number; billed: string; paid: string; due: string }[];
    receipts: { id: string; receiptNo: string; issuedAt: string; amount: string;
                method: string; invoiceNo: string }[];
  } | null;
  documents: string[];
  certificates: string[];
  permissions: { fees: boolean; contact: boolean };
}

const DOC_LABEL_BN: Record<string, string> = {
  fee_receipt: 'ফি রসিদ',
  report_card: 'প্রগতি পত্র',
  admit_card: 'প্রবেশপত্র',
  id_card: 'পরিচয়পত্র',
  transfer_certificate: 'ছাড়পত্র',
};

type Tab = 'profile' | 'enrolments' | 'attendance' | 'results' | 'fees' | 'documents';

const TAB_BN: Record<Tab, string> = {
  profile: 'পরিচিতি',
  enrolments: 'ভর্তির ইতিহাস',
  attendance: 'হাজিরা',
  results: 'ফলাফল',
  fees: 'ফি',
  documents: 'নথি',
};

export class StudentsView {
  private readonly o: StudentsViewOptions;
  private readonly doc: Document;

  private q = '';
  private status = '';
  private searching = false;
  private searchError = '';
  /** The search was refused (401/403): a sentence, not an error with a retry. */
  private searchDenied = false;
  private payload: SearchPayload | null = null;
  /** Distinguishes "not searched yet" from "searched and found nobody". */
  private searched = false;

  private openId: string | null = null;
  private history: HistoryPayload | null = null;
  private historyLoading = false;
  private historyError = '';
  /** The history load was refused (401/403). */
  private historyDenied = false;
  private tab: Tab = 'enrolments';

  /**
   * Where focus goes once the render that answers an action has settled.
   *
   * Every render empties the view, so the control just used is destroyed.
   * The shell's focus keeper finds the same control again when one exists
   * (the search box, its button, the status select, a tab), but opening a
   * student and going back swap the whole screen: there is no "same control"
   * to return to, and focus used to wait on the page itself, with nothing
   * read out. `record` puts it on the student's name once the record is
   * drawn (ফলাফলে ফিরুন while it loads, or when it fails); a row puts it back
   * on the result that was opened. `filters` is for the buttons that remove
   * a filter and so remove themselves (a chip, সব সরান, ছাঁকনি সরান): focus
   * goes to the status filter they changed. `page` is আগে / পরে: the button
   * pressed comes back disabled on the first or last page, where focus would
   * wait on nothing, so it goes to the other one.
   */
  private focusAfter:
    'record' | 'filters' | { row: string } | { page: 'prev' | 'next' } | null = null;
  /** The shape of the result control that opened the record: table or list. */
  private openedFrom: 'ui-row-open' | 'ui-list-hit' | null = null;

  /** Bumped per request so a slow first search cannot overwrite a fast second. */
  private seq = 0;
  /** The same for a record: bumped by each opening and by ফলাফলে ফিরুন. */
  private openSeq = 0;

  constructor(o: StudentsViewOptions) {
    this.o = o;
    this.doc = o.doc;
    this.render();
  }

  // ── Data ──────────────────────────────────────────────────────────────

  private async runSearch(offset = 0): Promise<void> {
    const text = this.q.trim();
    if (!text && !this.status) {
      this.searchError = 'অনুসন্ধানের জন্য অন্তত ২টি অক্ষর লিখুন।';
      this.searchDenied = false;
      this.payload = null; this.searched = false; this.render();
      return;
    }
    if (text && text.length < 2) {
      this.searchError = 'অনুসন্ধানের জন্য অন্তত ২টি অক্ষর লিখুন।';
      this.searchDenied = false;
      this.payload = null; this.searched = false; this.render();
      return;
    }

    const mine = ++this.seq;
    this.searching = true; this.searchError = ''; this.searchDenied = false; this.render();
    // What the answer says aloud. The count line under the table is built
    // fresh with its words already in it, which a screen reader does not
    // reliably read; a search that only changes the page tells nobody else.
    let found = '';
    try {
      const p = new URLSearchParams();
      if (text) p.set('q', text);
      if (this.status) p.set('status', this.status);
      p.set('offset', String(offset));
      const res = await this.o.auth.authedFetch(`/api/v1/academics/students/search?${p}`);
      if (mine !== this.seq) return;      // a newer search already answered
      if (!res.ok) {
        let body: { message?: unknown; error?: unknown } | null = null;
        try {
          body = await res.json() as typeof body;
        } catch { /* a non-JSON failure keeps the default */ }
        // The server's own words only when they were written for this
        // reader (serverMessage): an English validation line or a role list
        // never reaches the screen, and a refusal is the canonical sentence.
        this.searchDenied = res.status === 401 || res.status === 403;
        this.searchError = serverMessage(body, res.status,
          'শিক্ষার্থীদের তথ্য লোড করা যায়নি। আবার চেষ্টা করুন।', 'শিক্ষার্থীর তথ্য');
        this.payload = null;
        return;
      }
      this.payload = await res.json() as SearchPayload;
      this.searched = true;
      found = foundSentence(this.payload);
    } catch {
      if (mine !== this.seq) return;
      this.searchError = 'সংযোগ নেই — শিক্ষার্থীদের তথ্য লোড করা যায়নি।';
      this.payload = null;
    } finally {
      if (mine === this.seq) {
        this.searching = false;
        this.render();
        // An error card is its own alert (role="alert"). A refusal's card is
        // a note, which nothing reads out, so the refusal is said here too.
        if (found) announce(this.doc, found);
        else if (this.searchDenied) announce(this.doc, this.searchError);
      }
    }
  }

  private async open(id: string): Promise<void> {
    const mine = ++this.openSeq;
    // Only the newest opening may answer. A record the person left with
    // ফলাফলে ফিরুন, or replaced by opening another student, arrives into
    // nothing: it must not draw the wrong child's name (and take the focus
    // meant for the right one), nor rebuild the search box under typing.
    const stale = () => mine !== this.openSeq;
    this.openId = id;
    this.history = null;
    this.historyError = '';
    this.historyDenied = false;
    this.historyLoading = true;
    this.tab = 'enrolments';
    this.focusAfter = 'record';
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/students/history?studentId=${encodeURIComponent(id)}`);
      if (stale()) return;
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          let body: { message?: unknown; error?: unknown } | null = null;
          try {
            body = await res.json() as typeof body;
          } catch { /* a non-JSON refusal still gets the canonical sentence */ }
          if (stale()) return;
          this.historyDenied = true;
          this.historyError = serverMessage(body, res.status,
            'শিক্ষার্থীর তথ্য লোড করা যায়নি। আবার চেষ্টা করুন।', 'শিক্ষার্থীর তথ্য');
          return;
        }
        this.historyError = res.status === 404
          ? 'শিক্ষার্থী পাওয়া যায়নি।'
          : 'শিক্ষার্থীর তথ্য লোড করা যায়নি। আবার চেষ্টা করুন।';
        return;
      }
      const history = await res.json() as HistoryPayload;
      if (stale()) return;
      this.history = history;
    } catch {
      if (stale()) return;
      this.historyError = 'সংযোগ নেই — শিক্ষার্থীর তথ্য লোড করা যায়নি।';
    } finally {
      if (!stale()) {
        this.historyLoading = false;
        this.render();
        // Focus waits on ফলাফলে ফিরুন, which says nothing about why: a
        // refusal's card is a note, not an alert, so it is said aloud.
        if (this.historyDenied) announce(this.doc, this.historyError);
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  private render(): void {
    const d = this.doc;
    // Read before the rebuild: was the person on this screen (or nowhere)?
    // Focus they took somewhere else — the sidebar, the bell — while a record
    // was loading is theirs, and is not pulled back.
    const lost = focusIsLost(d);
    const focusHere = lost || this.o.root.contains(d.activeElement);
    this.o.root.replaceChildren();

    // P12-2. The shared header, not a hand-rolled `h2`.
    //
    // This screen built its own `<h2 class="page-header">`, which is why it
    // was the only one of the shell's 24 routes with no `<h1>` at all: a
    // screen-reader user landing here got no page heading, and the document
    // outline started at level 2. The class was already the shared one, so
    // the look does not change — only the element, and the fact that it now
    // comes from the same place every other screen's header comes from.
    this.o.root.append(pageHeader(d, {
      title: 'শিক্ষার্থী খুঁজুন',
      subtitle: 'আইডি, নাম বা মোবাইল দিয়ে যেকোনো শিক্ষার্থীর তথ্য ও ইতিহাস দেখুন।',
    }));

    if (this.openId) this.renderDetail();
    else this.renderSearch();
    this.settleFocus(focusHere, lost);
  }

  /** Carries out `focusAfter` once the render it waited for is on screen. */
  private settleFocus(focusHere: boolean, lost: boolean): void {
    const want = this.focusAfter;
    if (!want) return;
    const root = this.o.root;
    if (want === 'record') {
      if (!this.openId) { this.focusAfter = null; return; }
      // Still loading: keep the intent for the render that brings the record.
      if (!this.historyLoading) this.focusAfter = null;
      if (!focusHere) return;
      // The student's name says which record opened, and the next Tab goes
      // on to the tabs. While it loads, or when it could not load, the way
      // back is the one control there is.
      const target = this.historyLoading
        ? null
        : root.querySelector<HTMLElement>('#stu-record-name');
      (target ?? root.querySelector<HTMLElement>('.ui-back'))?.focus();
      return;
    }
    if (typeof want === 'object' && 'page' in want) {
      // The shimmer while the page loads has no pager: wait for the answer.
      if (this.searching) return;
      this.focusAfter = null;
      // Only focus that went nowhere is placed. Someone who moved on to the
      // search box while the page loaded keeps their place.
      if (this.openId || !lost) return;
      // The strip's two buttons, আগে then পরে. The one pressed when it is
      // still live (the shell's keeper would find it too), else the other.
      const btns = [...root.querySelectorAll<HTMLButtonElement>('.stu-search .ui-page-btn')];
      const pressed = btns[want.page === 'next' ? 1 : 0];
      (pressed && !pressed.disabled ? pressed : btns.find((b) => !b.disabled))?.focus();
      return;
    }
    this.focusAfter = null;
    if (this.openId || !focusHere) return;
    if (want === 'filters') {
      // The select on a desktop; below 1024 the select is hidden and the
      // ছাঁকনি button stands for it.
      const shapes = [...root.querySelectorAll<HTMLElement>(
        '.stu-filters select[name="status"], .stu-filters .ui-filters-open')];
      (shapes.find((c) => c.getClientRects().length > 0) ?? shapes[0])?.focus();
      return;
    }
    // Back on the result that was opened, in whichever shape is on screen:
    // the table's open button on a desktop, the list row on a phone.
    const controls: HTMLElement[] = [];
    for (const row of root.querySelectorAll<HTMLElement>('[data-key]')) {
      if (row.dataset.key !== want.row) continue;
      for (const c of row.querySelectorAll<HTMLElement>('button.ui-row-open, button.ui-list-hit')) {
        controls.push(c);
      }
    }
    const shown = controls.find((c) => c.getClientRects().length > 0);
    const opener = this.openedFrom;
    (shown ?? controls.find((c) => opener !== null && c.classList.contains(opener)) ?? controls[0])
      ?.focus();
  }

  private renderSearch(): void {
    const d = this.doc;

    // 05 §03: one panel — the inset strip, then whatever answers it.
    const panel = el(d, 'section', {
      className: 'card stu-search', attrs: { 'aria-label': 'শিক্ষার্থী অনুসন্ধান' },
    });

    // No visible label and no "খুঁজুন" bar, as drawn: the full description is
    // the box's accessible name, and Enter or the search glyph submits.
    // Searching on submit only, never per keystroke (§19, R-6).
    //
    // The box's clear (x) calls onSearch('') too. Here clearing only empties
    // the box, as the browser's own search-field clear always did: it sends
    // nothing, and the results on screen stay. A capture listener on the form
    // runs before the clear button's own handler, so it can mark the call.
    let clearing = false;
    const search = searchField(d, {
      label: 'আইডি, নাম, মোবাইল বা রেজিস্ট্রেশন নম্বর',
      placeholder: 'স্থায়ী আইডি বা নাম',
      value: this.q,
      onSearch: (q) => {
        this.q = q;
        if (clearing) { clearing = false; return; }
        void this.runSearch();
      },
    });
    search.root.addEventListener('click', (e) => {
      if ((e.target as Element | null)?.closest?.('.ui-search-clear')) clearing = true;
    }, true);
    // What is typed is kept as it is typed, so a status change searches with
    // it and a re-render never loses it.
    search.input.addEventListener('input', () => { this.q = search.input.value; });
    const submit = search.root.querySelector<HTMLButtonElement>('.ui-search-submit');
    // The glyph button is the search action, not a second copy of the box's
    // description: the field shares its label with the button it makes.
    submit?.setAttribute('aria-label', 'খুঁজুন');
    if (this.searching && submit) {
      // A search in flight cannot be sent again with Enter: a form whose
      // submit control is disabled does not submit implicitly.
      submit.disabled = true; submit.setAttribute('aria-busy', 'true');
    }

    // The select slot of the strip. It is the status filter this screen has
    // always had; its label is visually hidden, so the first option names it.
    const filters = filterBar(d, {
      label: 'শিক্ষার্থী ছাঁকনি',
      filters: [{
        id: 'status', label: 'অবস্থা', value: this.status,
        options: [
          { value: '', label: 'সব অবস্থা' },
          ...Object.entries(STATUS_BN).map(([value, label]) => ({ value, label })),
        ],
      }],
      onChange: (_id, value) => {
        this.status = value; this.focusFilterIfButtonGoes(); void this.runSearch();
      },
      onClearAll: () => { this.status = ''; this.focusFilterIfButtonGoes(); void this.runSearch(); },
    });

    // The search box is NOT the bar's `extra`: below 1024px the bar's inline
    // part is hidden, and the box would be hidden with it.
    append(panel, el(d, 'div', { className: 'stu-filters' }, search.root, filters));
    this.o.root.append(panel);

    if (this.searching) { panel.append(listSkeleton(d, 4)); return; }

    if (this.searchDenied) {
      // No retry: asking again does not change who is asking.
      panel.append(permissionState(d, { message: this.searchError }));
      return;
    }

    if (this.searchError) {
      panel.append(errorState(d, this.searchError, () => void this.runSearch()));
      return;
    }

    if (!this.searched || !this.payload) {
      // Not an error and not empty: nothing has been asked yet. Saying so
      // beats an empty panel that looks like a failed search.
      panel.append(emptyState(d, {
        glyph: 'search',
        message: 'স্থায়ী আইডি, নাম বা মোবাইল নম্বর দিয়ে খুঁজুন। '
               + 'প্রাক্তন শিক্ষার্থীরাও পাওয়া যাবে।',
      }));
      return;
    }

    const p = this.payload;
    if (p.students.length === 0) {
      // The way out is the one the strip already offers — the filter chip's
      // clear — repeated where the eye is, and only when text remains to
      // search with once the filter is gone.
      const canClear = Boolean(this.status && this.q.trim().length >= 2);
      panel.append(emptyState(d, {
        glyph: 'users',
        message: 'কোনো শিক্ষার্থী পাওয়া যায়নি।',
        detail: this.status
          ? 'বানান দেখুন, অথবা অবস্থা ছাঁকনি সরিয়ে আবার খুঁজুন।'
          : 'আইডি বা নামের বানান দেখে আবার খুঁজুন।',
        action: canClear
          ? { label: 'ছাঁকনি সরান', onClick: () => {
            this.status = ''; this.focusAfter = 'filters'; void this.runSearch();
          } }
          : undefined,
      }));
      return;
    }

    const table = dataTable(d, {
      caption: 'শিক্ষার্থী অনুসন্ধানের ফলাফল',
      rows: p.students,
      rowKey: (r) => r.id,
      onRowClick: (r) => {
        // Which of the two shapes was used, for ফলাফলে ফিরুন to land on.
        const used = (this.doc.activeElement as Element | null)
          ?.closest?.('.ui-row-open, .ui-list-hit') ?? null;
        this.openedFrom = used && this.o.root.contains(used)
          ? (used.classList.contains('ui-list-hit') ? 'ui-list-hit' : 'ui-row-open')
          : null;
        void this.open(r.id);
      },
      columns: [
        // The name stays FIRST, although 05 §03 draws আইডি first: the first
        // column is the row header, and it names each row's open button. A
        // reader tabbing down the results hears "রাফি হাসান: খুলুন", not a
        // Latin code spelled out letter by letter (R8 keeps the guarantee).
        { key: 'name', header: 'নাম', mobile: 'title',
          cell: (r) => r.name.bn },
        { key: 'code', header: 'আইডি', mobile: 'subtitle',
          // The school's own permanent code, never the uuid — this is the
          // string an office reads down a phone. An identifier stays Latin
          // (R-8) and is one figure, so the whole code takes the numeral face.
          cell: (r) => el(d, 'span', { className: 'n', text: r.studentCode }) },
        // Words with a roll inside: the table sets the digits in the numeral
        // face where they stand, and the words stay in the text face.
        { key: 'where', header: 'শ্রেণি', mobile: 'meta',
          cell: (r) => whereOf(r) },
        { key: 'status', header: 'অবস্থা', mobile: 'status',
          cell: (r) => statusBadge(d, {
            state: lifecycleState(r.lifecycleStatus),
            label: STATUS_BN[r.lifecycleStatus] ?? r.lifecycleStatus,
          }) },
      ],
    });
    panel.append(table);

    // The footer: "৭৮৪টির মধ্যে ১–২০" and আগে / পরে. Offsets are always whole
    // pages, so the two buttons reach exactly the offsets they always did, and
    // পরে is live exactly while rows remain beyond this page.
    const limit = Math.max(1, p.limit);
    const page = Math.floor(p.offset / limit) + 1;
    const hasMore = p.offset + p.students.length < p.total;
    const summary = rangeSummary(p);
    const pager = pagination(d, {
      page,
      pageCount: Math.max(Math.ceil(p.total / limit), hasMore ? page + 1 : page),
      summary,
      onGo: (n) => {
        this.focusAfter = { page: n > page ? 'next' : 'prev' };
        void this.runSearch((n - 1) * limit);
      },
    });
    // One page: no buttons to press, but the count still closes the panel.
    panel.append(pager ?? el(d, 'div', { className: 'ui-pagination' },
      el(d, 'span', {
        className: 'ui-page-pos n', text: summary, attrs: { 'aria-live': 'polite' },
      })));
  }

  // `resultRow` is gone: the search result is a desktop TABLE and a phone
  // list now, from one column definition (P2 `dataTable`). At 1440 the old
  // markup was a single stacked column — a phone layout on an office screen,
  // which §4 forbids.

  // ── The one student ───────────────────────────────────────────────────

  private renderDetail(): void {
    const d = this.doc;

    const opened = this.openId;
    this.o.root.append(backLink(d, 'ফলাফলে ফিরুন', () => {
      // A record still on its way is dropped when it arrives (see open()).
      this.openSeq++;
      this.openId = null; this.history = null; this.historyLoading = false;
      this.historyError = ''; this.historyDenied = false;
      this.focusAfter = opened ? { row: opened } : null;
      this.render();
    }));

    // Every state sits in the record's own panel, where the record will be.
    if (this.historyLoading) {
      this.o.root.append(el(d, 'div', { className: 'card stu-record' }, skeleton(d, 6)));
      return;
    }
    if (this.historyDenied) {
      this.o.root.append(el(d, 'div', { className: 'card stu-record' },
        permissionState(d, { message: this.historyError })));
      return;
    }
    if (this.historyError) {
      const id = this.openId;
      this.o.root.append(el(d, 'div', { className: 'card stu-record' },
        errorState(d, this.historyError, () => { if (id) void this.open(id); })));
      return;
    }
    const h = this.history;
    if (!h) return;

    // The page keeps its one h1; the student is the h2 of one record panel.
    const rec = el(d, 'section', {
      className: 'card stu-record', attrs: { 'aria-labelledby': 'stu-record-name' },
    });
    const head = el(d, 'div', { className: 'stu-record-head' },
      el(d, 'div', { className: 'stu-record-titles' },
        el(d, 'h2', {
          className: 'stu-record-name', text: h.student.name.bn,
          // Focusable by script only, so opening a student reads the name.
          attrs: { id: 'stu-record-name', tabindex: '-1' },
        }),
        el(d, 'p', { className: 'stu-record-code n', text: h.student.studentCode })),
      statusBadge(d, {
        state: lifecycleState(h.student.lifecycleStatus),
        label: STATUS_BN[h.student.lifecycleStatus] ?? h.student.lifecycleStatus,
      }));

    // The fees tab is not rendered disabled for a role that may not see
    // fees — it is not rendered at all. A greyed-out tab tells a class
    // teacher that a balance exists and that they are not trusted with it,
    // which is worse than not mentioning money.
    const items = (Object.keys(TAB_BN) as Tab[])
      .filter((t) => t !== 'fees' || h.permissions.fees)
      .map((t) => ({ id: t, label: TAB_BN[t] }));
    const strip = tabs(d, {
      items,
      active: this.tab,
      label: 'শিক্ষার্থীর তথ্য',
      className: 'stu-tabs',
      onSelect: (id) => {
        this.tab = id as Tab;
        this.render();
        // The strip was rebuilt under the focus; put it back on the tab, so
        // the arrow keys keep walking the strip.
        d.getElementById(`tab-${id}`)?.focus();
      },
    });

    const panel = el(d, 'div', {
      className: 'stu-panel',
      attrs: { role: 'tabpanel', 'aria-labelledby': `tab-${this.tab}` },
    });

    append(rec, head, strip, panel);
    this.o.root.append(rec);

    switch (this.tab) {
      case 'profile':    this.renderProfile(panel, h); break;
      case 'enrolments': this.renderTimeline(panel, h); break;
      case 'attendance': this.renderAttendance(panel, h); break;
      case 'results':    this.renderResults(panel, h); break;
      case 'fees':       this.renderFees(panel, h); break;
      case 'documents':  this.renderDocuments(panel, h); break;
    }

    // The strip is new on every render and starts scrolled to its left end,
    // so a tab chosen near the right end would drop back out of view.
    revealTab(strip, strip.querySelector<HTMLElement>('[aria-selected="true"]'));
  }

  private renderProfile(panel: HTMLElement, h: HistoryPayload): void {
    const d = this.doc;
    const s = h.student;
    // The third flag marks an identifier: one figure, Latin (R-8), numeral
    // face as a whole. A date is words with numbers in them.
    const rows: [string, string | null, boolean?][] = [
      ['নাম', s.name.bn],
      ['ইংরেজি নাম', s.name.en],
      ['আইডি', s.studentCode, true],
      ['অবস্থা', STATUS_BN[s.lifecycleStatus] ?? s.lifecycleStatus],
      ['ভর্তির তারিখ', bnDate(s.admissionDate)],
      ['উত্তীর্ণ', s.graduatedOn ? bnDate(s.graduatedOn) : null],
      ['পিতা', s.fatherNameBn],
      ['মাতা', s.motherNameBn],
      ['জন্মতারিখ', s.dateOfBirth ? bnDate(s.dateOfBirth) : null],
      ['রক্তের গ্রুপ', s.bloodGroup],
      ['মোবাইল', s.phone, true],
      ['বোর্ড রেজি.', s.boardRegistrationNo, true],
    ];
    const dl = el(d, 'dl', { className: 'ui-facts' });
    for (const [k, v, identifier] of rows) {
      if (v == null || v === '') continue;
      append(dl,
        el(d, 'dt', { className: 'ui-facts-key', text: k }),
        figure(d, 'dd', 'ui-facts-val', v, identifier));
    }
    panel.append(dl);

    if (!h.permissions.contact) {
      panel.append(el(d, 'p', {
        className: 'stu-note', text: 'যোগাযোগ ও ব্যক্তিগত তথ্য দেখার অনুমতি আপনার নেই।',
      }));
    }
  }

  /**
   * The timeline — R-6's core acceptance requirement.
   *
   * Current and historical are separated by a heading rather than by a colour,
   * because §6 asks a person to be able to tell them apart and a tint is not
   * a distinction on a cheap phone in daylight.
   */
  private renderTimeline(panel: HTMLElement, h: HistoryPayload): void {
    const d = this.doc;
    if (h.enrolments.length === 0) {
      panel.append(emptyState(d, {
        glyph: 'layers',
        message: 'এই শিক্ষার্থীর কোনো ভর্তির তথ্য নেই।',
      }));
      return;
    }

    type Enrolment = HistoryPayload['enrolments'][number];
    // 14 Components §04: the year above a sentence, a dot, a rail.
    const entry = (e: Enrolment) => ({
      when: formatAcademicYear(e.yearLabel),
      // A roll is an identifier, Latin as in the search result (R-8).
      title: [e.classBn, e.groupBn, `শাখা ${e.section}`, `রোল ${formatIdentifier(e.rollNo)}`]
        .filter(Boolean).join(' · '),
      detail: (ENROLMENT_STATUS_BN[e.status] ?? e.status)
        + (e.endedOn ? ` · ${bnDate(e.endedOn)} পর্যন্ত` : ''),
      tone: ENROLMENT_TONE[e.status] ?? 'neutral',
    });
    const block = (title: string, rows: Enrolment[]) => el(d, 'div', { className: 'stu-block' },
      sectionHeading(d, { title, level: 3 }),
      timeline(d, { label: title, entries: rows.map(entry) }));

    const current = h.enrolments.filter((e) => e.isCurrent);
    const past = h.enrolments.filter((e) => !e.isCurrent);

    if (current.length > 0) panel.append(block('বর্তমান ভর্তি', current));
    if (past.length > 0) {
      // Newest first in the past list: the year someone is looking for is
      // usually the most recent one they remember.
      panel.append(block(
        current.length > 0 ? 'পূর্ববর্তী বছরসমূহ' : 'ভর্তির ইতিহাস', [...past].reverse()));
    }
  }

  private renderAttendance(panel: HTMLElement, h: HistoryPayload): void {
    const d = this.doc;
    if (h.attendance.length === 0) {
      panel.append(emptyState(d, {
        glyph: 'check-square', message: 'এই শিক্ষার্থীর হাজিরার কোনো তথ্য নেই।',
      }));
      return;
    }
    type Year = HistoryPayload['attendance'][number];
    const count = (key: 'present' | 'absent' | 'late' | 'excused', header: string) => ({
      key, header, numeric: true, mobile: 'meta' as const,
      cell: (a: Year) => this.labelled(header, bnNum(a[key])),
    });
    panel.append(dataTable(d, {
      caption: 'বছরওয়ারি হাজিরা',
      rows: h.attendance,
      rowKey: (a) => a.yearLabel,
      columns: [
        { key: 'year', header: 'শিক্ষাবর্ষ', mobile: 'title',
          cell: (a) => formatAcademicYear(a.yearLabel) },
        count('present', 'উপস্থিত'),
        count('absent', 'অনুপস্থিত'),
        count('late', 'দেরি'),
        count('excused', 'ছুটি'),
        { key: 'percent', header: 'শতকরা', numeric: true, mobile: 'status',
          cell: (a) => (a.percent == null ? '—' : `${bnNum(a.percent)}%`) },
      ],
    }));
  }

  private renderResults(panel: HTMLElement, h: HistoryPayload): void {
    const d = this.doc;
    if (h.results.length === 0) {
      panel.append(emptyState(d, {
        glyph: 'award',
        message: 'প্রকাশিত কোনো ফলাফল নেই। অপ্রকাশিত ফলাফল এখানে দেখানো হয় না।',
      }));
      return;
    }
    panel.append(dataTable(d, {
      caption: 'প্রকাশিত ফলাফল',
      rows: h.results,
      rowKey: (r) => `${r.yearLabel}·${r.examBn}`,
      columns: [
        { key: 'year', header: 'শিক্ষাবর্ষ', mobile: 'subtitle',
          cell: (r) => formatAcademicYear(r.yearLabel) },
        { key: 'exam', header: 'পরীক্ষা', mobile: 'title',
          cell: (r) => r.examBn },
        { key: 'marks', header: 'নম্বর', numeric: true, mobile: 'meta',
          cell: (r) => this.labelled('নম্বর',
            r.totalMarks && r.totalMax ? `${bnNum(r.totalMarks)}/${bnNum(r.totalMax)}` : '—') },
        { key: 'gpa', header: 'জিপিএ', numeric: true, mobile: 'meta',
          cell: (r) => this.labelled('জিপিএ', r.gpa ? bnNum(r.gpa) : '—') },
        { key: 'grade', header: 'গ্রেড', mobile: 'meta',
          cell: (r) => this.labelled('গ্রেড', r.letterGrade ?? '—') },
        { key: 'outcome', header: 'ফলাফল', mobile: 'status',
          cell: (r) => statusBadge(d, {
            state: r.isPass ? 'published' : 'failed',
            label: r.isPass ? 'উত্তীর্ণ' : 'অনুত্তীর্ণ',
          }) },
      ],
    }));
  }

  private renderFees(panel: HTMLElement, h: HistoryPayload): void {
    const d = this.doc;
    const f = h.fees;
    if (!f || (f.years.length === 0 && f.receipts.length === 0)) {
      panel.append(emptyState(d, {
        glyph: 'wallet', message: 'এই শিক্ষার্থীর কোনো ফি-র তথ্য নেই।',
      }));
      return;
    }
    // Money through formatBdt, as on every other finance screen: Latin
    // (R-8), with its separators ("৳ 14,400.00", not "৳ 14400.00").
    if (f.years.length > 0) {
      panel.append(el(d, 'div', { className: 'stu-block' },
        sectionHeading(d, { title: 'বছরওয়ারি', level: 3 }),
        dataTable(d, {
          caption: 'বছরওয়ারি ফি',
          className: 'stu-fees',
          rows: f.years,
          rowKey: (y) => y.yearLabel,
          columns: [
            { key: 'year', header: 'শিক্ষাবর্ষ', mobile: 'title',
              cell: (y) => formatAcademicYear(y.yearLabel) },
            { key: 'billed', header: 'বিল', numeric: true, mobile: 'meta',
              cell: (y) => this.labelled('বিল', this.money(y.billed)) },
            { key: 'paid', header: 'জমা', numeric: true, mobile: 'meta',
              cell: (y) => this.labelled('জমা', this.money(y.paid)) },
            // Not `numeric`: on a phone that sets the whole status slot, word
            // and all, in the numeral face. `.stu-fees` right-aligns it instead,
            // and only the figure takes `n`. The phone reads its word aloud —
            // a status slot has no hidden header in front of it.
            { key: 'due', header: 'বকেয়া', mobile: 'status',
              cell: (y) => this.labelled('বকেয়া', this.money(y.due), true) },
          ],
        })));
    }
    if (f.receipts.length > 0) {
      panel.append(el(d, 'div', { className: 'stu-block' },
        sectionHeading(d, { title: 'রসিদ', level: 3 }),
        dataTable(d, {
          caption: 'রসিদ',
          rows: f.receipts,
          rowKey: (r) => r.id,
          columns: [
            { key: 'receipt', header: 'রসিদ', mobile: 'title',
              cell: (r) => el(d, 'span', { className: 'n', text: r.receiptNo }) },
            { key: 'date', header: 'তারিখ', mobile: 'subtitle',
              cell: (r) => bnDate(r.issuedAt) },
            { key: 'amount', header: 'টাকা', numeric: true, mobile: 'status',
              cell: (r) => this.money(r.amount) },
          ],
        })));
    }
  }

  /**
   * What this person may PRINT for this child — not a list of stored files.
   *
   * R-5 generates documents on demand and there is no object store, so there
   * are no document URLs to expose here and §10's rule is satisfied by there
   * being nothing to leak. The button hands the work to the R-5 screen, which
   * re-authorises the request itself.
   */
  private renderDocuments(panel: HTMLElement, h: HistoryPayload): void {
    const d = this.doc;
    const all = [...h.documents, ...h.certificates];
    if (all.length === 0) {
      // Nothing is offered because nothing is permitted — a refusal, so it
      // reads as one rather than as an empty drawer.
      panel.append(permissionState(d, {
        message: 'এই শিক্ষার্থীর জন্য নথি তৈরির অনুমতি আপনার নেই।',
      }));
      return;
    }

    append(panel,
      el(d, 'p', {
        className: 'stu-note', text: 'প্রতিষ্ঠানের লেটারহেডে যেসব নথি আপনি তৈরি করতে পারেন:',
      }),
      list(d, 'তৈরি করা যায় এমন নথি',
        ...all.map((t) => listItem(d, { title: DOC_LABEL_BN[t] ?? t, glyph: 'file-text' }))),
      el(d, 'div', { className: 'action-row' },
        button(d, {
          label: 'নথি ও ছাপা খুলুন', variant: 'secondary',
          onClick: () => { location.hash = '#/documents'; },
        })));
  }

  // ── Small builders ────────────────────────────────────────────────────

  /**
   * A figure with its column's word in front. The desktop table has a header
   * row and hides the word (`.stu-panel .ui-table .stu-cell-word`); the phone
   * list shows it, so "১৮০ · ৫ · ২ · ১" reads as what each number is. In the
   * phone's meta line the word is aria-hidden, because the list already
   * announces the header before the value; `announce` keeps it for a status
   * slot, which has no header in front of it.
   *
   * The word and its figure are one unit on the line (`.stu-pair` is an
   * inline-block): the phone's meta line breaks at its " · " between pairs,
   * not between "জমা" and "৳ 13,200.00". A pair wider than the whole line
   * still wraps inside itself rather than overflow.
   */
  private labelled(word: string, value: string | HTMLElement, announce = false): HTMLElement {
    const d = this.doc;
    return el(d, 'span', { className: 'stu-pair' },
      el(d, 'span', {
        className: 'stu-cell-word', text: `${word} `,
        attrs: { 'aria-hidden': announce ? null : 'true' },
      }),
      value);
  }

  /**
   * A filter chip or সব সরান was pressed: it is not drawn again once its
   * filter is gone, so there is no same control for focus to return to. The
   * select itself (or the phone's sheet) is left to the shell's keeper.
   */
  private focusFilterIfButtonGoes(): void {
    const a = this.doc.activeElement;
    if (a && this.o.root.contains(a) && a.matches('.ui-filter-chip, .ui-filter-clear')) {
      this.focusAfter = 'filters';
    }
  }

  /**
   * One amount, as one unbreakable figure: a line never breaks after the ৳
   * (`.stu-money` is `white-space: nowrap`). A receipt's amount stands alone
   * in its slot; a year's amounts sit in a `.stu-pair` with their word.
   */
  private money(amount: string): HTMLElement {
    return el(this.doc, 'span', { className: 'stu-money', text: formatBdt(amount) });
  }
}

/** "৭৮৪টির মধ্যে ১–২০": the result page's place in the whole answer. */
function rangeSummary(p: SearchPayload): string {
  return `${bnNum(p.total)}টির মধ্যে ${bnNum(p.offset + 1)}–${bnNum(p.offset + p.students.length)}`;
}

/** What a finished search says aloud. */
function foundSentence(p: SearchPayload): string {
  if (p.students.length === 0) return 'কোনো শিক্ষার্থী পাওয়া যায়নি।';
  const found = `${bnNum(p.total)} জন শিক্ষার্থী পাওয়া গেছে`;
  return p.total > p.students.length ? `${found}, দেখানো হচ্ছে ${rangeSummary(p)}` : found;
}

/**
 * Scroll a tab strip sideways just enough that `tab` is wholly inside it,
 * with a little of its neighbour showing, so the strip visibly goes on.
 * Only the strip scrolls: `scrollIntoView` would move the page as well. A
 * strip that fits (the phone's wrapped grid) is left alone.
 */
function revealTab(strip: HTMLElement, tab: HTMLElement | null): void {
  if (!tab || strip.scrollWidth <= strip.clientWidth) return;
  const PEEK = 24;
  const s = strip.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  if (t.right > s.right) strip.scrollLeft += t.right - s.right + PEEK;
  else if (t.left < s.left) strip.scrollLeft -= s.left - t.left + PEEK;
}

/**
 * An element holding `text` with its numbers in the numeral face (R6).
 * An identifier is one figure and takes `n` whole; otherwise text that is only
 * a number takes `n` itself and a number inside words gets its own span.
 */
function figure<K extends keyof HTMLElementTagNameMap>(
  d: Document, tag: K, className: string, text: string, identifier = false,
): HTMLElementTagNameMap[K] {
  if (!hasDigit(text)) return el(d, tag, { className, text });
  if (identifier) return el(d, tag, { className: `${className} n`, text });
  const whole = numClass(className, text);
  return whole !== className
    ? el(d, tag, { className: whole, text })
    : el(d, tag, { className }, ...numText(d, text));
}

/** Where a student is, in words. Shared by the table and the list. */
function whereOf(s: SearchResult): string {
  if (!s.latest) return 'কোনো ভর্তির তথ্য নেই';
  const parts = [
    s.latest.classBn,
    s.latest.groupBn,
    s.latest.section ? `শাখা ${s.latest.section}` : null,
    // A roll is an identifier read down a phone, so it stays Latin — the one
    // number on this row that is not localised.
    s.latest.rollNo != null ? `রোল ${s.latest.rollNo}` : null,
  ].filter(Boolean);
  // A past year is named; the current one is not, because "this year" is the
  // default a reader already assumes.
  return (s.latest.isCurrent ? '' : `${formatAcademicYear(s.latest.yearLabel)} · `) + parts.join(' · ');
}
