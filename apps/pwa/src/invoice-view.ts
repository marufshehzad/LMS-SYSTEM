/**
 * ইনভয়েস তৈরি — the monthly billing run  (R-3, Part I)
 *
 * The second endpoint D13's audit found with no caller:
 * `POST /api/v1/finance/generate` builds a month's invoices from the school's
 * fee structures, and nothing in the app reached it. `fees-view` reads
 * invoices; nothing created them. R-2's invoice auto-notice to fee-paying
 * guardians therefore could not fire from the product either.
 *
 * ── Idempotency is the safety net, and it is stated ────────────────────
 * The endpoint is idempotent per (student, billing period): a student already
 * invoiced for 2026-03 is skipped, not double-billed. That is a property of
 * the SQL, not of this screen being careful, which is what makes it safe to
 * let a nervous accountant press the button twice. The screen says so out
 * loud, because otherwise the second press is the scariest thing in the
 * product.
 *
 * ── There is no dry run, and the screen does not pretend there is ──────
 * `generate` has no preview mode. Rather than inventing a client-side
 * estimate — which would be a second implementation of fee structures,
 * waivers and class-specific overrides, disagreeing with the real one on
 * exactly the students whose fees are unusual — the panel states what the
 * run does and what its idempotency guarantees, and the result reports what
 * was actually created. An estimate that is wrong about money is worse than
 * no estimate.
 *
 * ── Ata Ekta (07 Finance §02, IMPLEMENTATION §7, R11) ──────────────────
 * The bar is the title and one neutral chip naming the month being billed.
 * Under it, the `irreversiblePanel` every irreversible action shares: what
 * cannot be undone on --danger-tint, then §02's info strip (the idempotency
 * sentence), the month the run is for, the "কী হবে" checklist, and a foot
 * where "আমি বুঝেছি এটি ফেরানো যাবে না" unlocks the page's one primary. The
 * tick IS the confirmation; there is no second dialog after it. The tick
 * belongs to the month it was given for — changing the month clears it.
 *
 * The one real count this screen holds is how many of the chosen month's
 * invoices are already in the list it loaded, so that is the count the
 * checklist carries — as "অন্তত" when the list may have been cut short.
 * §02's per-head breakdown, totals and "৭৮৪টি" need the preview endpoint that
 * does not exist.
 *
 * Collection (B-48) stays here, drawn as 07 §03's payment sheet: who, the
 * balance as the figure, the amount, and how the money came.
 */
import { formatBdt, parseUserNumber } from '../../../packages/ui-core/src/format.ts';
import type { Auth } from './auth.ts';
import {
  skeleton, errorState, emptyState, successNote, bnNum, bnMonth,
} from './view-states.ts';
import {
  pageHeader, serverMessage, sectionHeading, button, dataTable, statusBadge, badge,
  field, setFieldError, clearFieldError, permissionState, permissionMessage,
  irreversiblePanel, el, append, clear, icon, uid, numText, focusIsLost,
  openDrawer, setOverlayBody, setBusy, announce,
  type OverlayHandle, type IrreversibleItem, type IrreversiblePanel,
} from './ui/index.ts';

interface InvoiceRow {
  id: string; invoiceNo: string; billingPeriod: string;
  totalAmount: string; balanceAmount: string; status: string;
}

/** GET /api/v1/finance/payments?invoiceId= — one bill as the counter needs it. */
interface CollectData {
  invoice: { invoiceNo: string; studentBn: string; balanceAmount: number; totalAmount: number };
  methods: { code: string; labelBn: string }[];
  receipts: { receiptNo: string; amount: number; methodBn: string }[];
}

export interface InvoiceViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /**
   * Whether to offer the generate control at all. The server is the gate
   * (BILLING_ROLES); this stops the screen offering a button that is
   * guaranteed to 403 — found in the browser, where a student was shown the
   * whole billing form because the invoice LIST is legitimately readable by
   * a guardian for their own child.
   */
  canGenerate: boolean;
}

/** 'YYYY-MM' for a Date, in the local calendar the school bills by. */
function periodOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The rows the list asks for. A list this long may have been cut short. */
const LIST_LIMIT = 20;

/** Who can run billing — the refusal names them. */
const BILLING_CONTACT = 'প্রধান শিক্ষক, প্রতিষ্ঠান মালিক ও হিসাবরক্ষক';

/** Said before the button, not after the second press. */
const IDEMPOTENT =
  'একই মাসে দুইবার চালালে কারও দ্বিতীয় ইনভয়েস তৈরি হবে না — ' +
  'যাদের ইনভয়েস আগেই আছে তাদের বাদ দেওয়া হয়।';

export class InvoiceView {
  private readonly o: InvoiceViewOptions;
  private recent: InvoiceRow[] = [];
  private loading = true;
  /** The LIST refused (403): drawn as the denied state where the list goes. */
  private denied = false;
  /** The LIST failed: drawn where the list goes, never as "no invoices yet". */
  private listError = '';
  /** A run failed: drawn above the panel. (A collection fails inside its own sheet.) */
  private error = '';
  /** That failure never reached the server. Nothing is queued. */
  private offline = false;
  private notice = '';
  private busy = false;
  private period = periodOf(new Date());
  /** "আমি বুঝেছি" — kept across the re-renders a run causes, cleared by a new month or a finished run. */
  private acknowledged = false;
  private chip: HTMLElement | null = null;
  private gate: IrreversiblePanel | null = null;
  private periodInput: HTMLElement | null = null;
  /** The outcome drawn by the last render — the failure if there is one, else the note. */
  private result: HTMLElement | null = null;

  constructor(options: InvoiceViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.denied = false; this.listError = '';
    this.error = ''; this.offline = false;
    // The tick acknowledged the counts it was shown. A reload can change them.
    this.acknowledged = false;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(`/api/v1/finance/invoices?limit=${LIST_LIMIT}`);
      if (res.status === 403) { this.denied = true; return; }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { invoices?: InvoiceRow[] };
      this.recent = body.invoices ?? [];
    } catch {
      this.listError = 'ইনভয়েস আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false; this.render();
    }
  }

  private async generate(): Promise<void> {
    // The last run's or collection's note is not this run's outcome: left in
    // place, it sat above a new failure saying the opposite.
    this.busy = true; this.error = ''; this.offline = false; this.notice = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/finance/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingPeriod: this.period }),
      });
      const body = await res.json() as {
        invoicesCreated?: number; notified?: number; message?: string; error?: string;
      };
      if (!res.ok) {
        // The tick stays: the primary is the retry once the cause is fixed.
        this.error = body.error === 'no_academic_year'
          ? 'এই মাসটি কোনো শিক্ষাবর্ষের মধ্যে পড়ে না।'
          : serverMessage(body, res.status, 'ইনভয়েস তৈরি করা যায়নি।', 'ইনভয়েস');
        return;
      }
      // finance-svc answers `invoicesCreated` (api/index.ts). This read
      // `invoiceCount`, which the server never sends, so every successful run
      // was reported as "nothing new" — including the month's first.
      const n = body.invoicesCreated ?? 0;
      // Zero is a real, common and correct outcome — it means everybody was
      // already billed for this month. Saying "0 invoices created" without
      // that sentence reads as a failure.
      this.notice = n === 0
        ? 'নতুন কোনো ইনভয়েস তৈরি হয়নি — এই মাসের জন্য সবার ইনভয়েস আগেই তৈরি হয়েছে।'
        : `${bnNum(n)} টি ইনভয়েস তৈরি হয়েছে` +
          (body.notified ? ` · ${bnNum(body.notified)} জন অভিভাবককে জানানো হয়েছে।` : '।');
      // A finished run is not an acknowledgement of the next one.
      this.acknowledged = false;
      // The reload draws the note at once; say it now, not after the list.
      const reloading = this.load();
      this.reveal();
      await reloading;
    } catch {
      this.error = 'সংযোগ নেই — ইনভয়েস তৈরি করা যায়নি।';
      this.offline = true;
    } finally {
      this.busy = false; this.render();
      this.reveal();
    }
  }

  /**
   * Take the person to what their action produced (findings 30, 31).
   *
   * The outcome is drawn at the top of the page, and on a phone the person
   * who pressed the button is scrolled far below it: the run's count, the
   * offline failure and the receipt number all landed above the viewport
   * while the pressed control was rebuilt out from under the focus. Focusing
   * the outcome scrolls it into view (clear of the sticky bar — `:root`
   * carries the scroll-padding) and has a screen reader read it, which a
   * freshly inserted polite live region often does not.
   *
   * Only when focus was lost. Somebody who moved on while the network was
   * slow — into the bell, another field — keeps their place.
   */
  private reveal(): void {
    const target = this.result;
    if (!target?.isConnected || !focusIsLost(this.o.doc)) return;
    target.focus();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    this.chip = null;
    this.gate = null;
    this.periodInput = null;
    this.result = null;

    // 07 §02's bar: the title, and one neutral chip naming the month billed.
    root.append(pageHeader(d, {
      title: 'ইনভয়েস তৈরি',
      actions: this.o.canGenerate ? [this.monthChip()] : undefined,
    }));

    if (!this.o.canGenerate) {
      // The refusal, and NOTHING under it.
      //
      // This first said "a reader who may not generate may still read what
      // was generated", and then the student pass showed a child their own
      // three invoices under the heading "সাম্প্রতিক ইনভয়েস" on a screen
      // called "ইনভয়েস তৈরি". A family reading its own bills has `#/fees`,
      // which is built for it; this screen is the monthly billing run.
      root.append(permissionState(d, {
        message: permissionMessage('ইনভয়েস তৈরি'),
        contact: BILLING_CONTACT,
      }));
      return;
    }

    // Focusable from script only (tabindex -1), so `reveal()` can take the
    // person to it; the focus key lets the shell's keeper find it again when
    // a reload rebuilds it.
    if (this.notice) {
      const note = successNote(d, this.notice);
      note.tabIndex = -1;
      note.dataset.focusKey = 'inv-notice';
      root.append(note);
      this.result = note;
    }
    if (this.error) {
      const alert = this.alert();
      alert.tabIndex = -1;
      alert.dataset.focusKey = 'inv-alert';
      root.append(alert);
      this.result = alert;
    }

    root.append(this.runForm());
    root.append(this.recentSection());
  }

  /** The chip in the bar. Replaced, not re-rendered, when the month changes. */
  private monthChip(): HTMLElement {
    this.chip = badge(this.o.doc, {
      label: bnMonth(this.period), tone: 'neutral', className: 'inv-month',
    });
    return this.chip;
  }

  /** A failed run, above the panel whose primary retries it. */
  private alert(): HTMLElement {
    const d = this.o.doc;
    if (this.offline) {
      // Said as offline, not as a fault. Finance writes are network-only, so
      // there is no queue and no count to show.
      return el(d, 'p', {
        className: 'offline-banner inv-alert', attrs: { role: 'alert' },
      }, icon(d, 'wifi-off', 'offline-icon'), el(d, 'span', {}, ...numText(d, this.error)));
    }
    const err = errorState(d, this.error,
      this.error.includes('অনুমতি') ? undefined : () => void this.load());
    err.classList.add('inv-alert');
    return err;
  }

  /** What the run will do, as far as this screen truly knows it. */
  private checklist(): IrreversibleItem[] {
    const month = bnMonth(this.period);
    let skip = 'যাদের এই মাসের ইনভয়েস আগেই আছে, তাদের নতুন ইনভয়েস হবে না';
    if (!this.loading && !this.denied && !this.listError) {
      const have = this.recent.filter((inv) => inv.billingPeriod === this.period).length;
      // Fewer rows than asked for means the list is the whole list, and its
      // count is exact. A full page may have been cut short: "at least".
      const complete = this.recent.length < LIST_LIMIT;
      if (have > 0) {
        skip = `এই মাসের ${complete ? '' : 'অন্তত '}${bnNum(have)} টি ইনভয়েস আগেই আছে — ` +
               'সেই শিক্ষার্থীদের নতুন ইনভয়েস হবে না';
      } else if (complete) {
        skip = 'এই মাসের কোনো ইনভয়েস আগে তৈরি হয়নি';
      }
    }
    return [
      // Enrolled AND carrying a monthly fee: the SQL bills nobody else.
      { text: `${month} মাসের জন্য মাসিক ফি ধার্য থাকা প্রত্যেক সক্রিয় শিক্ষার্থীর ` +
              'একটি করে ইনভয়েস তৈরি হবে',
        glyph: 'file-text' },
      { text: 'ফি নির্ধারণের চালু মাসিক ফি থেকে অঙ্ক বসবে, মওকুফ থাকলে তা বাদ যাবে',
        glyph: 'percent' },
      { text: skip, glyph: 'repeat' },
      { text: 'ফি পরিশোধের দায়িত্বে থাকা অভিভাবকদের জানানো হবে', glyph: 'bell' },
    ];
  }

  /**
   * A new month, without rebuilding the panel: the month input is being used
   * while this runs, and replacing it would drop the half-typed value and the
   * focus. The chip and the checklist follow it; the tick does not survive it.
   */
  private syncMonth(): void {
    const d = this.o.doc;
    const old = this.chip;
    if (old) old.replaceWith(this.monthChip());
    const gate = this.gate;
    if (!gate) return;
    const rows = gate.root.querySelectorAll<HTMLElement>('.irrev-item-text');
    this.checklist().forEach((item, i) => {
      const row = rows[i];
      if (!row) return;
      clear(row);
      append(row, ...numText(d, item.text));
    });
    gate.reset();
  }

  /** The generation panel: §7's barrier around §02's frame. */
  private runForm(): HTMLElement {
    const d = this.o.doc;
    const busy = this.busy;

    const period = field(d, {
      label: 'বিলিং মাস',
      name: 'period',
      kind: 'month',
      value: this.period,
      required: true,
      disabled: busy,
      onChange: (v) => { this.period = v; this.syncMonth(); },
    });
    this.periodInput = period.input;

    const go = button(d, {
      label: 'ইনভয়েস তৈরি করুন', variant: 'primary', type: 'submit', busy,
    });

    const gate = irreversiblePanel(d, {
      statement: 'তৈরি হওয়া ইনভয়েস আর ফেরানো যাবে না',
      detail: 'তৈরি হলেই বিল অভিভাবকদের অ্যাপে পৌঁছে যায় — কোনো ইনভয়েস এখান থেকে ' +
              'মুছে ফেলা বা বাতিল করা যায় না।',
      items: this.checklist(),
      confirm: go,
      actions: [go],
      className: 'inv-gate',
      onChange: (ticked) => { this.acknowledged = ticked; },
    });
    this.gate = gate;
    // A re-render (the run going busy, a failed run) keeps the tick.
    gate.input.checked = this.acknowledged;
    gate.input.disabled = busy;
    go.disabled = busy || !this.acknowledged;

    // §02's info strip, then the month the run is for (the band §02 gives
    // its stat strip), both before the checklist that depends on them.
    const body = gate.root.querySelector('.irrev-body');
    gate.root.insertBefore(el(d, 'div', { className: 'inv-note' },
      icon(d, 'info', 'ui-icon inv-note-glyph'),
      el(d, 'p', { className: 'inv-note-text', text: IDEMPOTENT })), body);
    gate.root.insertBefore(el(d, 'div', { className: 'inv-period' }, period.root), body);

    const form = el(d, 'form', { className: 'inv-run' }, gate.root);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.busy) return;
      this.period = period.value();
      if (!/^\d{4}-\d{2}$/.test(this.period)) {
        // Field-level: the month picker keeps whatever the person set while
        // they fix it, instead of the whole screen repainting under them.
        setFieldError(period.root, 'মাস বেছে নিন।');
        period.input.focus();
        return;
      }
      clearFieldError(period.root);
      // Enter in the month field submits even while the button is disabled.
      // Without the tick, the way forward is the box, not the run.
      if (!gate.acknowledged()) { gate.input.focus(); return; }
      void this.generate();
    });
    return form;
  }

  private recentSection(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div', { className: 'inv-recent' },
      sectionHeading(d, { title: 'সাম্প্রতিক ইনভয়েস' }));

    if (this.loading) { append(wrap, skeleton(d, 3)); return wrap; }
    if (this.denied) {
      append(wrap, permissionState(d, {
        message: permissionMessage('ইনভয়েস'), contact: BILLING_CONTACT,
      }));
      return wrap;
    }
    // A list that failed to load is not a school with no invoices.
    if (this.listError) {
      append(wrap, errorState(d, this.listError, () => void this.load()));
      return wrap;
    }
    if (this.recent.length === 0) {
      append(wrap, emptyState(d, {
        message: 'এখনো কোনো ইনভয়েস তৈরি হয়নি। মাস বেছে নিয়ে তৈরি করুন।',
        action: { label: 'মাস বেছে নিন', onClick: () => this.periodInput?.focus() },
      }));
      return wrap;
    }

    append(wrap, dataTable(d, {
      caption: 'সাম্প্রতিক ইনভয়েস',
      className: 'inv-table',
      rows: this.recent,
      rowKey: (inv) => inv.invoiceNo,
      columns: [
        { key: 'no', header: 'ইনভয়েস', mobile: 'title', cell: (inv) => inv.invoiceNo,
          width: 'minmax(0, 1.8fr)' },
        // Was `2026-08`, printed straight out of the database.
        { key: 'period', header: 'মাস', mobile: 'subtitle',
          cell: (inv) => bnMonth(inv.billingPeriod), width: 'minmax(0, 1.2fr)' },
        // Amounts printed exactly as the server sent them: decimal strings.
        { key: 'total', header: 'মোট', mobile: 'meta', numeric: true,
          cell: (inv) => this.figure('মোট', inv.totalAmount), width: 'minmax(0, 1.2fr)' },
        // The balance, not just the total. Without it a clerk who has just
        // taken ৳600 against a ৳1,500 bill sees the row unchanged and cannot
        // tell whether the money registered — the total never moves.
        { key: 'due', header: 'বকেয়া', mobile: 'meta', numeric: true,
          cell: (inv) => this.figure('বকেয়া', inv.balanceAmount), width: 'minmax(0, 1.2fr)' },
        { key: 'state', header: 'অবস্থা', mobile: 'status', width: '130px',
          cell: (inv) => statusBadge(d, {
            state: Number(inv.balanceAmount) <= 0 ? 'paid'
              : Number(inv.balanceAmount) < Number(inv.totalAmount) ? 'partial' : 'due',
            // Three states, not two: a bill with something paid against it is
            // neither settled nor untouched, and the office needs to see which
            // families have started paying.
            label: Number(inv.balanceAmount) <= 0 ? 'পরিশোধিত'
              : Number(inv.balanceAmount) < Number(inv.totalAmount) ? 'আংশিক' : 'বকেয়া',
          }) },
        // P-writers/B-48. Until this, an issued bill could never be marked
        // paid: the only receipt writer in the product was the MFS webhook and
        // POST /finance/pay is kill-switched. A school takes money at the
        // counter, so the counter is where the control belongs. Secondary:
        // the run above is this page's one primary, and a row action repeats.
        ...(this.o.canGenerate ? [{
          key: 'collect', header: 'ব্যবস্থা', mobile: 'status' as const,
          cell: (inv: InvoiceRow) => (Number(inv.balanceAmount) <= 0
            ? el(d, 'span', { className: 'inv-settled', text: '—' })
            : button(d, {
              label: 'আদায় লিখুন', size: 'sm', variant: 'secondary',
              disabled: this.busy,
              onClick: () => this.openCollect(inv),
            })),
        }] : []),
      ],
    }));
    return wrap;
  }

  /**
   * One money figure with its word (finding 34).
   *
   * On a phone both amounts share the row's meta line with no header row
   * above them, and "৳ 1,500.00 · ৳ 900.00" on a part-paid bill reads as
   * "900 paid". The word is for the eye: `aria-hidden`, because the list
   * already gives a screen reader the column name as a hidden prefix. The
   * desktop table hides it — its column header says it (`.inv-amt-word`
   * rule in app.css). Same pattern as fees-view and ledger-view.
   */
  private figure(word: string, amount: string): HTMLElement {
    const d = this.o.doc;
    return el(d, 'span', { className: 'inv-amt' },
      el(d, 'span', { className: 'inv-amt-word', text: `${word} `, attrs: { 'aria-hidden': 'true' } }),
      el(d, 'span', { className: 'n', text: formatBdt(amount) }));
  }

  /* ------------------------------------------------------------ payment */

  /**
   * Take a payment against one bill — 07 Finance §03's payment sheet.
   *
   * Opens on the server's own view of the invoice rather than the list row:
   * the list is a snapshot and somebody else may have collected since it was
   * drawn, so the balance shown here — and the balance the save is checked
   * against — is read fresh.
   *
   * The sheet opens at the tap and loads inside itself (finding 31). It used
   * to fetch first and open after, so a slow counter connection showed
   * nothing at all, and a failed fetch was written to the PAGE's error slot:
   * drawn above the viewport, pushing the list the clerk was reading down,
   * with focus dropped to <body> and a retry that reloaded the list instead
   * of the bill. Loading, the failure and its retry now all happen where the
   * tap happened.
   */
  private openCollect(inv: InvoiceRow): void {
    const d = this.o.doc;
    let handle: OverlayHandle;
    /** Set once the bill has loaded; the primary does nothing before that. */
    let submit: (() => Promise<void>) | null = null;
    const cancel = button(d, {
      label: 'বাতিল', variant: 'secondary', onClick: () => handle.close(),
    });
    const save = button(d, {
      label: 'জমা নিন ও রসিদ দিন', variant: 'primary', disabled: true,
      onClick: () => { void submit?.(); },
    });
    handle = openDrawer(d, {
      title: 'আদায় লিখুন',
      body: skeleton(d, 3),
      actions: [cancel, save],
      className: 'inv-pay-sheet',
    });

    const fill = async (retry: boolean): Promise<void> => {
      if (retry) {
        submit = null;
        save.hidden = false;
        // The retry replaces the button that was pressed. Hold focus on the
        // sheet meanwhile, never on the page behind the scrim.
        if (handle.el.querySelector('.ui-dialog-body')?.contains(d.activeElement)) handle.el.focus();
        setOverlayBody(handle, skeleton(d, 3));
      }

      let data: CollectData | null = null;
      let problem = 'বিলের তথ্য আনা যায়নি — সংযোগ পেলে আবার চেষ্টা করুন।';
      let refused = false;
      try {
        const res = await this.o.auth.authedFetch(
          `/api/v1/finance/payments?invoiceId=${encodeURIComponent(inv.id)}`);
        if (res.ok) {
          data = await res.json() as CollectData;
        } else {
          const out = await res.json().catch(() => ({})) as { message?: unknown; error?: unknown };
          problem = serverMessage(out, res.status, 'বিলের তথ্য আনা যায়নি।', 'বিলের তথ্য');
          refused = res.status === 401 || res.status === 403;
        }
      } catch { /* `problem` already says it */ }

      // Closed while it loaded: there is nothing left to fill.
      if (!handle.el.isConnected) return;
      const waiting = d.activeElement === handle.el || focusIsLost(d);
      if (!data) {
        // Nothing can be saved against a bill that did not load.
        save.hidden = true;
        const err = errorState(d, problem, refused ? undefined : () => void fill(true));
        setOverlayBody(handle, err);
        if (waiting) (err.querySelector<HTMLElement>('button') ?? handle.el).focus();
        return;
      }
      const pay = this.payForm(inv, data, save, handle);
      setOverlayBody(handle, pay.body);
      submit = pay.submit;
      save.disabled = false;
      // After a retry, where the sheet itself held focus: its first control,
      // as when it first opened.
      if (waiting) handle.el.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    };
    void fill(false);
  }

  /** The payment form for a loaded bill, and what its primary does. */
  private payForm(
    inv: InvoiceRow, data: CollectData, save: HTMLButtonElement, handle: OverlayHandle,
  ): { body: HTMLElement; submit: () => Promise<void> } {
    const d = this.o.doc;
    const form = el(d, 'div', { className: 'inv-pay' });
    const errLine = el(d, 'p', {
      className: 'ui-field-error', attrs: { role: 'alert', hidden: 'hidden' },
    });

    // Who is paying, and for which bill.
    const who = el(d, 'div', { className: 'inv-pay-who' },
      el(d, 'p', { className: 'inv-pay-name' }, ...numText(d, data.invoice.studentBn)),
      el(d, 'p', { className: 'inv-pay-meta' }, ...numText(d,
        `${data.invoice.invoiceNo} · ${bnMonth(inv.billingPeriod)} · ` +
        `মোট ${formatBdt(String(data.invoice.totalAmount))}`)));

    // The balance is the figure the clerk is here for.
    const due = [
      el(d, 'p', { className: 'ui-field-label', text: 'বকেয়া' }),
      el(d, 'p', {
        className: 'inv-pay-due n', text: formatBdt(String(data.invoice.balanceAmount)),
      }),
    ];

    const amount = field(d, {
      label: 'কত টাকা নিলেন', name: 'amount', kind: 'number', required: true,
      value: String(data.invoice.balanceAmount),
      attrs: { min: 1, max: data.invoice.balanceAmount, step: 1 },
    });

    // Server-supplied, from the mfs_provider enum — never a hard-coded list.
    // One choice among several, laid out as the sheet's grid of buttons; the
    // first the server sends is chosen, as the select it replaced chose it.
    const methodId = uid('inv-method');
    let methodCode = data.methods[0]?.code ?? '';
    const methodButtons: HTMLButtonElement[] = [];
    const methods = el(d, 'div', {
      className: 'inv-pay-methods', attrs: { role: 'group', 'aria-labelledby': methodId },
    });
    data.methods.forEach((m, i) => {
      const b = button(d, {
        label: m.labelBn, variant: 'secondary',
        attrs: { 'aria-pressed': i === 0 ? 'true' : 'false' },
        onClick: () => {
          methodCode = m.code;
          for (const other of methodButtons) {
            other.setAttribute('aria-pressed', other === b ? 'true' : 'false');
          }
        },
      });
      methodButtons.push(b);
      methods.append(b);
    });

    const reference = field(d, {
      label: 'রেফারেন্স', name: 'reference',
      helper: 'ঐচ্ছিক — চেক নম্বর বা ট্রানজেকশন আইডি।',
      attrs: { maxlength: 120 },
    });

    append(form, errLine, who, ...due, amount.root,
      el(d, 'p', { className: 'ui-field-label', text: 'কীভাবে', attrs: { id: methodId } }),
      methods, reference.root);

    if (data.receipts.length > 0) {
      append(form,
        el(d, 'p', { className: 'ui-field-label', text: 'আগের রসিদ' }),
        el(d, 'ul', { className: 'inv-pay-receipts' },
          ...data.receipts.map((r) => el(d, 'li', { className: 'inv-pay-receipt' },
            ...numText(d, `${r.receiptNo} — ${formatBdt(String(r.amount))} (${r.methodBn})`)))));
    }

    const submit = async (): Promise<void> => {
      errLine.setAttribute('hidden', 'hidden');
      // Finding 28. The field is type=text inputmode=numeric on purpose, so a
      // Bangla keyboard types ৫০০ and the sheet itself writes the balance as
      // "1,250". `Number()` made both NaN, JSON wrote NaN as null, and the
      // server refused "zero" while the field plainly showed ৫০০.
      const taka = parseUserNumber(amount.input.value);
      if (taka === null || taka <= 0) {
        setFieldError(amount.root, taka === null
          ? 'টাকার অঙ্ক সংখ্যায় লিখুন।'
          : 'টাকার অঙ্ক শূন্যের বেশি হতে হবে।');
        amount.input.focus();
        return;
      }
      clearFieldError(amount.root);
      setBusy(save, true);
      let msg = '';
      let issued: { receiptNo?: string; ledgerPosted?: boolean } = {};
      try {
        const res = await this.o.auth.authedFetch('/api/v1/finance/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: inv.id,
            amount: taka,
            method: methodCode,
            reference: reference.input.value.trim() || undefined,
          }),
        });
        const out = await res.json().catch(() => ({})) as
          { message?: string; receiptNo?: string; ledgerPosted?: boolean };
        if (!res.ok) msg = out.message ?? 'টাকা জমা নেওয়া যায়নি।';
        else issued = out;
      } catch {
        msg = 'সংযোগ নেই — টাকা জমা নেওয়া হয়নি।';
      }
      setBusy(save, false);
      // A refusal keeps the drawer open with the amount intact: the server
      // names the balance when it refuses an overpayment, and the clerk
      // needs the figure they typed still in front of them (B-60).
      if (msg) {
        clear(errLine);
        append(errLine, ...numText(d, msg));
        errLine.removeAttribute('hidden');
        announce(d, msg, true);
        return;
      }
      handle.close();
      // The receipt number is what the clerk hands the payer. It is set
      // before the reload so the reload's first paint already carries it, and
      // brought into view there (finding 31) rather than after the list.
      this.notice = `রসিদ ${issued.receiptNo ?? ''} দেওয়া হয়েছে।`
        // Honest when the books were skipped: the receipt is valid, the
        // ledger row is not there, and an accountant should know now rather
        // than at reconciliation.
        + (issued.ledgerPosted === false
          ? ' হিসাবের খাতা এখনো তৈরি হয়নি — লেজারে ওঠেনি।' : '');
      const reloading = this.load();
      this.reveal();
      await reloading;
      this.reveal();
    };
    return { body: form, submit };
  }
}
