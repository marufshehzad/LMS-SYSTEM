/**
 * Fees view (বেতন tab): invoices + digital receipts.
 *
 * GET /api/v1/finance/invoices feeds the list; tapping an invoice opens its
 * line items in a drawer and lazily fetches GET /api/v1/finance/receipts for
 * it. Same offline-cache-in-localStorage approach as roster-view.ts.
 *
 * Who sees what is decided by RLS (invoice_scope in
 * db/migrations/010_rls_policies.sql, through app.can_see_student): a
 * student sees their own, a guardian their wards', a class or subject
 * teacher the students of their own sections, and accountant, principal and
 * owner — and, through can_see_student's ELSE branch, every other staff role
 * (coordinator, dept head, librarian …) — the whole school's, newest 100.
 * Somebody whose scope holds no invoice gets the empty state, which says so
 * instead of pretending it's an error.
 *
 * ── Ata Ekta: two drawings, one screen ─────────────────────────────────────
 * The design draws this route twice, for two audiences:
 *
 *   FAMILY (03 Student §05, 04 Guardian §04) — a phone. What is owed comes
 *   first, on the red ground, then the months as a list of rows.
 *
 *   OFFICE (07 Finance §03) — a desk. A status filter with বকেয়া already
 *   chosen, then the table with জমা and বকেয়া columns.
 *
 * Which one is drawn is a PRESENTATION choice made from the role, exactly as
 * app.ts chooses `canGenerate` for the invoices screen. What anyone can SEE
 * is still RLS: the office layout over a guardian's rows would show the same
 * rows, only arranged for a desk.
 *
 * The family layout is for the FAMILY roles only, not for "everyone who is
 * not finance staff". Its hero adds every open balance up and calls the sum
 * এখন বকেয়া — true only when the rows are the reader's own bills or their
 * children's. A teacher or coordinator reading the invoices of other
 * families would be told those families' debts are theirs, and the family
 * rows (month · amount, no invoice number) would all look alike. Every other
 * reader gets the office layout: no hero, each row named by its number.
 */
import { formatBdt, formatCount } from '../../../packages/ui-core/src/format.ts';
import type { Auth } from './auth.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import {
  permissionState, deniedMessage, deniedContact, pageHeader, dataTable, statusBadge,
  openDrawer, setOverlayBody, listSkeleton, errorState, announce, el, append, icon, uid,
  numText, type OverlayHandle, type Column,
} from './ui/index.ts';
import type { EmptyOptions } from './view-states.ts';
import { bnDate, bnMonth } from './view-states.ts';

interface InvoiceLine {
  descriptionBn: string;
  amount: string;
  waiverAmount: string;
  netAmount: string;
}

interface Invoice {
  id: string;
  invoiceNo: string;
  /**
   * The API has always returned it. Optional because a cache written before
   * this field was read does not carry it. Only ever COUNTED (how many
   * children owe) — a uuid is never shown.
   */
  studentId?: string;
  billingPeriod: string | null;
  issuedOn: string;
  dueOn: string;
  totalAmount: string;
  paidAmount: string;
  balanceAmount: string;
  status: string;
  lines: InvoiceLine[];
}

interface Receipt {
  receiptNo: string;
  amount: string;
  method: string;
  issuedAt: string;
}

const CACHE_KEY = 'shikhon_invoices_cache';

/**
 * The shared badge vocabulary, so an unpaid invoice tints like every other
 * overdue thing in the product rather than like fees only.
 */
const BADGE_STATE: Record<string, string> = {
  issued: 'due',
  partly_paid: 'partial',
  paid: 'paid',
  overdue: 'overdue',
  waived: 'draft',
  cancelled: 'draft',
};

const STATUS_BN: Record<string, string> = {
  issued: 'বকেয়া',
  partly_paid: 'আংশিক পরিশোধিত',
  paid: 'পরিশোধিত',
  overdue: 'মেয়াদোত্তীর্ণ',
  waived: 'মওকুফ',
  cancelled: 'বাতিল',
};

/**
 * How a receipt was paid, in words. The receipts endpoint returns the enum
 * (`cash`, `bkash`), and the drawer printed it raw onto a Bangla screen.
 * These are the labels finance-svc/api/payments.ts METHOD_BN writes on the
 * receipt itself, so the drawer and the printed receipt say the same word.
 */
const METHOD_BN: Record<string, string> = {
  cash: 'নগদ', cheque: 'চেক', bank_transfer: 'ব্যাংক ট্রান্সফার',
  bkash: 'বিকাশ', nagad: 'নগদ (Nagad)', rocket: 'রকেট', upay: 'উপায়',
};

/**
 * The people who make invoices. Mirrors GENERATE_INVOICES in app.ts and
 * COLLECT_ROLES in finance-svc payments.ts. Used only for copy: the empty
 * state tells THEM to create the month's invoices, which nobody else can.
 * Presentation only — see the header comment.
 */
const FINANCE_STAFF = new Set(['principal', 'school_owner', 'accountant']);

/**
 * The family layout's audience: people whose invoices are their own bills or
 * their children's, so a summed balance is truly what THEY owe. Anyone else
 * (a teacher, a coordinator, an unknown role) gets the office layout without
 * the finance-staff copy — see the header comment.
 */
const FAMILY = new Set(['student', 'guardian']);

/** Statuses after which nothing more is owed, whatever the balance says. */
const CLOSED = new Set(['paid', 'waived', 'cancelled']);

/** Still owes money: a balance on an invoice that is not closed. */
function owes(inv: Invoice): boolean {
  return Number(inv.balanceAmount) > 0 && !CLOSED.has(inv.status);
}

/**
 * 07 Finance §03's filter row. A view over the rows already loaded — nothing
 * is fetched when it changes. বকেয়া includes a part-paid invoice, because a
 * part-paid family still owes; আংশিক is that subset on its own.
 */
type FeesFilter = 'all' | 'due' | 'paid' | 'partial';
const FILTERS: ReadonlyArray<{ id: FeesFilter; label: string; match: (i: Invoice) => boolean; none: string }> = [
  { id: 'all', label: 'সব', match: () => true, none: '' },
  { id: 'due', label: 'বকেয়া', match: owes,
    none: 'এই তালিকায় বকেয়া থাকা কোনো ইনভয়েস নেই।' },
  { id: 'paid', label: 'পরিশোধিত', match: (i) => i.status === 'paid',
    none: 'এই তালিকায় পরিশোধিত কোনো ইনভয়েস নেই।' },
  { id: 'partial', label: 'আংশিক', match: (i) => i.status === 'partly_paid',
    none: 'এই তালিকায় আংশিক পরিশোধিত কোনো ইনভয়েস নেই।' },
];

/**
 * R-8 audit. This file used to carry its own `money()`, rendering Bangla
 * digits — so a parent read **৳ ১,২৫০** here and **৳ 1,250.00** on the receipt
 * printed for the same invoice. Two formatters, one decision, two answers.
 * There is now one, in ui-core, and the reasoning lives with it.
 */
const money = formatBdt;

export interface FeesViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

export class FeesView {
  private readonly o: FeesViewOptions;
  private invoices: Invoice[] = [];
  private receipts = new Map<string, Receipt[]>();
  private expanded: string | null = null;
  /** The open invoice drawer, so a late receipt can fill it without a repaint. */
  private drawer: OverlayHandle | null = null;
  private offline = false;
  /**
   * The server refused this read (403). Distinct from `offline`, and the
   * distinction is the point: an outage is temporary and a refusal is not,
   * so this state offers no retry and shows no cached data (B-30).
   */
  private denied = false;
  /** B-84. The refusal itself, so the screen can say which kind it was. */
  private deniedErr: unknown = null;
  private loading = true;
  /**
   * A failure with nothing cached to show — not an empty list. It used to
   * fall through to the empty state, which told a family they had no
   * invoices when the truth was that none could be fetched.
   */
  private error = false;
  /** The office filter. বকেয়া is chosen first (07 Finance §03's note). */
  private filter: FeesFilter = 'due';
  /** The office table and chips, so a filter swaps rows without a repaint. */
  private rowsEl: HTMLElement | null = null;
  private chips: HTMLButtonElement[] = [];

  constructor(options: FeesViewOptions) {
    this.o = options;
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        this.invoices = JSON.parse(raw) as Invoice[];
        this.loading = false;
      }
    } catch { /* cache is a nicety */ }
    this.render();

    try {
      const res = await this.o.auth.authedFetch('/api/v1/finance/invoices');
      await refuseUnlessOk(res);
      const body = (await res.json()) as { invoices: Invoice[] };
      this.invoices = body.invoices;
      this.offline = false;
      this.error = false;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(this.invoices)); } catch { /* best-effort */ }
    } catch (err) {
      if (isDenied(err)) {
        // Fees are the most sensitive thing on a student's phone after
        // results: a stale invoice list left on screen after a refusal is
        // somebody's money.
        this.denied = true;
        this.deniedErr = err; this.invoices = []; this.offline = false;
        try { localStorage.removeItem(CACHE_KEY); } catch { /* private mode */ }
        // These two have no `finally { render() }`, so a bare return
        // computed the denied state and never painted it.
        this.loading = false; this.render(); return;
      }
      this.offline = this.invoices.length > 0;
      this.error = this.invoices.length === 0;
    }
    this.loading = false;
    this.render();
  }

  /** The error state's retry: the same fetch again, from the top. */
  private retry(): void {
    this.error = false;
    this.loading = true;
    void this.init();
  }

  /**
   * Open one invoice.
   *
   * A DRAWER, not an inline expansion. The list is now a table, and a table
   * row cannot hold a second table of line items and receipts — and on a
   * phone an expansion pushes every other invoice off the screen, which is
   * the thing a parent is comparing against. (On a phone the drawer rises
   * as a bottom sheet — 13 Responsive ০৭, done by the overlay's own CSS.)
   */
  private async toggle(invoiceId: string): Promise<void> {
    this.expanded = invoiceId;
    const inv = this.invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    // The title's figures are put in the numeral face by openDrawer itself.
    const handle = openDrawer(this.o.doc, {
      title: inv.billingPeriod
        ? `${inv.invoiceNo} · ${bnMonth(inv.billingPeriod)}`
        : inv.invoiceNo,
      body: this.detail(inv),
      onClose: () => { this.expanded = null; },
    });
    this.drawer = handle;
    if (!this.receipts.has(invoiceId)) {
      try {
        const res = await this.o.auth.authedFetch(
          `/api/v1/finance/receipts?invoiceId=${encodeURIComponent(invoiceId)}`,
        );
        if (res.ok) {
          const body = (await res.json()) as { receipts: Receipt[] };
          this.receipts.set(invoiceId, body.receipts);
          // Re-fill the drawer in place. Re-rendering the whole screen would
          // close it under the reader's finger.
          if (this.expanded === invoiceId) setOverlayBody(handle, this.detail(inv));
        }
      } catch { /* offline — the lines still show; only receipts are missing */ }
    }
  }

  /** A money figure: one element, wholly in the numeral face (R6). */
  private figure(amount: string | number, className = ''): HTMLElement {
    return el(this.o.doc, 'span', {
      className: ['n fees-amount', className].filter(Boolean).join(' '),
      text: money(amount),
    });
  }

  /** One invoice's lines, due date and receipts. Drawer body. */
  private detail(inv: Invoice): HTMLElement {
    const d = this.o.doc;
    const host = el(d, 'div', { className: 'ui-card-form' });

    append(host, dataTable(d, {
      caption: `${inv.invoiceNo} — খাতওয়ারি`,
      rows: inv.lines,
      rowKey: (l) => l.descriptionBn,
      columns: [
        { key: 'what', header: 'খাত', mobile: 'title', cell: (l) => l.descriptionBn,
          width: 'minmax(0, 2fr)' },
        { key: 'amount', header: 'টাকা', mobile: 'meta', numeric: true,
          cell: (l) => (Number(l.waiverAmount) > 0
            ? el(d, 'span', {},
              this.figure(l.netAmount), ' (মওকুফ ', this.figure(l.waiverAmount), ')')
            : this.figure(l.amount)),
          width: 'minmax(0, 1.4fr)' },
      ],
    }));

    const dl = el(d, 'dl', { className: 'ui-facts' });
    append(dl,
      el(d, 'dt', { className: 'ui-facts-key', text: 'মোট' }),
      el(d, 'dd', { className: 'ui-facts-val n', text: money(inv.totalAmount) }),
      el(d, 'dt', { className: 'ui-facts-key', text: 'পরিশোধিত' }),
      el(d, 'dd', { className: 'ui-facts-val n', text: money(inv.paidAmount) }),
      el(d, 'dt', { className: 'ui-facts-key', text: 'বকেয়া' }),
      el(d, 'dd', { className: 'ui-facts-val n', text: money(inv.balanceAmount) }),
      // Was `শেষ তারিখ: 2026-08-10` — an ISO date on a Bangla screen.
      el(d, 'dt', { className: 'ui-facts-key', text: 'শেষ তারিখ' }),
      el(d, 'dd', { className: 'ui-facts-val' }, ...numText(d, bnDate(inv.dueOn))));
    append(host, dl);

    const receipts = this.receipts.get(inv.id);
    if (receipts && receipts.length > 0) {
      append(host, dataTable(d, {
        caption: `${inv.invoiceNo} — রসিদ`,
        rows: receipts,
        rowKey: (r) => r.receiptNo,
        columns: [
          { key: 'no', header: 'রসিদ', mobile: 'title', cell: (r) => r.receiptNo,
            width: 'minmax(0, 1.6fr)' },
          { key: 'how', header: 'মাধ্যম', mobile: 'subtitle',
            cell: (r) => METHOD_BN[r.method] ?? r.method, width: 'minmax(0, 1fr)' },
          { key: 'amt', header: 'টাকা', mobile: 'meta', numeric: true,
            cell: (r) => this.figure(r.amount), width: 'minmax(0, 1fr)' },
        ],
      }));
    } else if (Number(inv.paidAmount) > 0) {
      append(host, el(d, 'p', { className: 'ui-card-note', text: 'রসিদ আনা হচ্ছে…' }));
    }
    return host;
  }

  /**
   * The due hero. 03 Student §05: "বকেয়া থাকলে লাল পটভূমিতে অঙ্কটাই আগে" —
   * one child owing reads এখন বকেয়া; a guardian with two children owing
   * reads the total and the count (04 Guardian §04). Nothing owed, no hero:
   * the design draws only the owing case.
   *
   * The sum is in paisa, so ৳ 1,200.10 + ৳ 1,200.20 is not a float's
   * approximation of it.
   *
   * Family roles only. For a teacher or coordinator the rows are other
   * families' bills, and a total labelled এখন বকেয়া over them would be false
   * (and a sum of at most 100 rows). The check is here as well as at the
   * call, so no future caller can put the hero in front of the wrong reader.
   */
  private dueSummary(): HTMLElement | null {
    if (!FAMILY.has(this.o.auth.role)) return null;
    const d = this.o.doc;
    const open = this.invoices.filter(owes);
    if (!open.length) return null;
    const owedPaisa = open.reduce((s, i) => s + Math.round(Number(i.balanceAmount) * 100), 0);
    const children = new Set(open.map((i) => i.studentId).filter(Boolean)).size;
    const multi = children > 1;
    const earliest = open.map((i) => i.dueOn).filter(Boolean)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    const label = multi ? `মোট বকেয়া · ${formatCount(children, 'bn')} সন্তান` : 'এখন বকেয়া';
    const labelId = uid('fees-due');
    return el(d, 'section', {
      className: multi ? 'fees-due is-multi' : 'fees-due',
      attrs: { 'aria-labelledby': labelId },
    },
      el(d, 'p', { className: 'fees-due-label', attrs: { id: labelId } }, ...numText(d, label)),
      el(d, 'p', { className: 'fees-due-amount n', text: money(owedPaisa / 100) }),
      // The drawn late-fee sentence is fee policy the invoice does not carry;
      // the due date is the fact that exists, in the drawer's own words.
      earliest
        ? el(d, 'p', { className: 'fees-due-note' }, ...numText(d, `শেষ তারিখ ${bnDate(earliest)}`))
        : null);
  }

  /**
   * The invoice table and its phone list, from one column set.
   *
   * On a phone the two audiences want different rows (13 Responsive ০১):
   * a family reads month · amount · ✓ (03 Student §05), the office reads
   * invoice · month · what is still owed. Nothing is dropped: every hidden
   * column is in the row's drawer (মোট / পরিশোধিত / বকেয়া), and all of it is
   * in the desktop table.
   *
   * `office` is the LAYOUT (every reader who is not family), not "finance
   * staff" — a teacher reading many families' rows needs the invoice number
   * as the row's name just as an accountant does.
   */
  private table(office: boolean, rows: Invoice[], empty: EmptyOptions): HTMLElement {
    const d = this.o.doc;
    const columns: Array<Column<Invoice>> = [
      { key: 'no', header: 'ইনভয়েস', mobile: office ? 'title' : 'hidden',
        cell: (inv) => inv.invoiceNo, width: 'minmax(0, 1.6fr)' },
      // Was `2026-08` — a database key printed at a parent. An invoice with
      // no billing month is named by its number in the phone's title, where
      // the invoice column is hidden, and by a dash in the table's মাস column.
      { key: 'period', header: 'মাস', mobile: office ? 'subtitle' : 'title',
        width: 'minmax(0, 1.2fr)',
        cell: (inv) => (inv.billingPeriod
          ? bnMonth(inv.billingPeriod)
          : el(d, 'span', {},
            el(d, 'span', { className: 'fees-list-only', text: inv.invoiceNo }),
            el(d, 'span', { className: 'fees-table-only', text: '—' }))) },
      { key: 'total', header: 'মোট', numeric: true, mobile: office ? 'hidden' : 'status',
        cell: (inv) => this.figure(inv.totalAmount), width: 'minmax(0, 1fr)' },
      { key: 'paid', header: 'জমা', numeric: true, mobile: 'hidden',
        cell: (inv) => this.figure(inv.paidAmount), width: 'minmax(0, 1fr)' },
      { key: 'balance', header: 'বকেয়া', numeric: true, mobile: office ? 'meta' : 'hidden',
        width: 'minmax(0, 1fr)',
        cell: (inv) => el(d, 'span', {},
          // On the office phone the figure stands alone on its line; the word
          // is for the eye (the list already reads the header to a screen
          // reader), and the table's column header does this job on a desk.
          el(d, 'span', { className: 'fees-list-only', text: 'বকেয়া ', attrs: { 'aria-hidden': 'true' } }),
          el(d, 'span', {
            className: 'n fees-amount fees-balance',
            text: money(inv.balanceAmount),
            data: { owed: owes(inv) ? 'true' : undefined },
          })) },
      { key: 'status', header: 'অবস্থা', mobile: 'status', width: '150px',
        cell: (inv) => {
          const paid = inv.status === 'paid';
          return el(d, 'span', { className: 'fees-status' },
            statusBadge(d, {
              state: BADGE_STATE[inv.status] ?? 'pending',
              label: STATUS_BN[inv.status] ?? inv.status,
              className: paid ? 'fees-paid-word' : undefined,
            }),
            // 03 Student §05 marks a paid month with a green check. The
            // word stays for a screen reader; CSS shows the mark only in the
            // family's phone list, and the badge everywhere else.
            paid
              ? el(d, 'span', { className: 'fees-paid-mark' },
                icon(d, 'check'), el(d, 'span', { className: 'ui-sr-only', text: 'পরিশোধিত' }))
              : null);
        } },
    ];
    return dataTable(d, {
      caption: 'ইনভয়েসের তালিকা',
      rows,
      rowKey: (inv) => inv.id,
      onRowClick: (inv) => { void this.toggle(inv.id); },
      empty,
      columns,
    });
  }

  /**
   * No invoice at all. Says who would see one, and what would make one. The
   * "create them" sentence is for finance staff only: a teacher or librarian
   * on the office layout cannot open the ইনভয়েস তৈরি page, so they get the
   * sentence about who sees invoices instead.
   */
  private noInvoices(): EmptyOptions {
    return FINANCE_STAFF.has(this.o.auth.role)
      ? { glyph: 'wallet',
          message: 'এখনো কোনো ইনভয়েস তৈরি হয়নি। “ইনভয়েস তৈরি” পাতা থেকে মাসের ইনভয়েস তৈরি করুন।' }
      : { glyph: 'wallet',
          message: 'কোনো ইনভয়েস পাওয়া যায়নি। অভিভাবক নিজের সন্তানের এবং ' +
                   'হিসাবরক্ষক সবার ইনভয়েস দেখতে পান।' };
  }

  /** FAMILY: the due hero, then the months — one panel (03 §05, 04 §04). */
  private familySheet(): HTMLElement {
    const d = this.o.doc;
    return el(d, 'div', { className: 'fees-sheet is-family' },
      this.dueSummary(),
      // 03 Student §05's eyebrow bar over the rows. A real h2, so heading
      // navigation reaches the list. Not "আগের রসিদ": the rows are every
      // invoice, owed ones included, and that heading would say otherwise.
      el(d, 'h2', { className: 'label fees-list-head', text: 'ইনভয়েস ও রসিদ' }),
      this.table(false, this.invoices, this.noInvoices()));
  }

  /** OFFICE: the status filter over the table (07 Finance §03). */
  private officeSheet(): HTMLElement {
    const d = this.o.doc;
    const bar = el(d, 'div', {
      className: 'fees-filter', attrs: { role: 'group', 'aria-label': 'অবস্থা অনুযায়ী ছাঁকুন' },
    });
    this.chips = FILTERS.map((f) => {
      const b = el(d, 'button', {
        className: 'fees-filter-opt',
        text: f.label,
        attrs: { type: 'button', 'aria-pressed': String(f.id === this.filter) },
        data: { filter: f.id },
      });
      b.addEventListener('click', () => this.setFilter(f.id));
      return b;
    });
    append(bar, ...this.chips);
    this.rowsEl = this.officeRows();
    return el(d, 'div', { className: 'fees-sheet is-office' }, bar, this.rowsEl);
  }

  private officeRows(): HTMLElement {
    const f = FILTERS.find((x) => x.id === this.filter) ?? FILTERS[0];
    return this.table(true, this.invoices.filter(f.match), {
      glyph: 'wallet',
      message: f.none,
      action: { label: 'সব ইনভয়েস দেখুন', onClick: () => this.setFilter('all') },
    });
  }

  /**
   * Swap the rows in place. A repaint of the screen would take focus off the
   * chip the person just pressed; this keeps it there and says what changed.
   */
  private setFilter(id: FeesFilter): void {
    if (id === this.filter && this.rowsEl) return;
    this.filter = id;
    for (const c of this.chips) c.setAttribute('aria-pressed', String(c.dataset.filter === id));
    const next = this.officeRows();
    if (this.rowsEl?.isConnected) this.rowsEl.replaceWith(next);
    this.rowsEl = next;
    const f = FILTERS.find((x) => x.id === id) ?? FILTERS[0];
    const count = this.invoices.filter(f.match).length;
    announce(this.o.doc, `${formatCount(count, 'bn')}টি ইনভয়েস দেখানো হচ্ছে`);
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    this.rowsEl = null;
    this.chips = [];

    // B-30. A refusal outranks the offline banner, the skeleton and the
    // empty state: nothing is loading, there is nothing to show, and calling
    // it "offline" is the lie that item exists to remove.
    if (this.denied) {
      root.append(pageHeader(d, { title: 'বেতন ও ফি' }));
      root.append(permissionState(d, {
        message: deniedMessage(this.deniedErr, 'বেতন ও ফি'),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }

    root.append(pageHeader(d, {
      title: 'বেতন ও ফি',
      subtitle: 'ইনভয়েস, মওকুফ ও ডিজিটাল রসিদ',
    }));

    if (this.loading) { root.append(listSkeleton(d, 3)); return; }

    if (this.error) {
      root.append(errorState(d,
        'বেতন ও ফির তথ্য আনা গেল না। ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।',
        () => this.retry()));
      return;
    }

    if (this.offline) {
      // A --warn-tint banner above the cached list (§7), not a grey chip
      // beside the title. This screen only reads, so nothing is queued and
      // there is no count to show.
      root.append(el(d, 'p', { className: 'offline-banner fees-offline', attrs: { role: 'status' } },
        icon(d, 'wifi-off', 'offline-icon'),
        el(d, 'span', { text: 'অফলাইন — সর্বশেষ সংরক্ষিত ইনভয়েস দেখানো হচ্ছে' })));
    }

    // Family roles get the family sheet and its hero; every other reader —
    // finance staff, teachers and coordinators reading other families' rows,
    // an unknown role — gets the office sheet, which has no hero.
    const family = FAMILY.has(this.o.auth.role);
    if (!this.invoices.length) {
      // The empty state stands on its own: no hero, no filter over nothing.
      root.append(this.table(!family, [], this.noInvoices()));
      return;
    }
    root.append(family ? this.familySheet() : this.officeSheet());
  }
}
