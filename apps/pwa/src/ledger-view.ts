/**
 * Ledger (লেজার ও পুনর্মিলন) — PRD §4 double-entry ledger view.
 *
 * Reads GET /api/v1/finance/ledger when authenticated as accountant-level;
 * falls back to demo data otherwise. This is the surface that proves receipts
 * + ledger posting are actually happening, since the writes live inside the
 * webhook processor.
 *
 * Ata Ekta (07 Finance §04), top to bottom:
 *   - the header: "লেজার", and a danger chip counting the MFS channels whose
 *     reconciliation does not match — only when one does not;
 *   - one flush panel: a four-cell strip (ডেবিট · ক্রেডিট · মিলেছে · অমিল),
 *     one flat table of the recent entries' lines, and — when something does
 *     not match — a danger-tint note saying in one sentence per channel how
 *     much did not match and where;
 *   - under it, "MFS পুনর্মিলন": one row per channel with its posted and
 *     reconciled amounts and a মিলেছে/অমিল status, matched channels included.
 *     The design does not draw it; the strip's totals replaced the old
 *     per-channel cards, and without it a matched channel's figures would
 *     leave the screen;
 *   - the chart of accounts below that, which the design does not draw either
 *     but which is this screen's data and stays.
 *
 * Every figure is one the payload carries or a sum of rows on this screen.
 * The design's receipt counts, settlement dates, per-row match chips and CSV
 * export have no source here and are not imitated.
 */
import {
  formatBdt, formatCount, formatDayMonth, toBanglaDigits, todayLocalIso,
} from '../../../packages/ui-core/src/format.ts';
import type { Auth } from './auth.ts';
import {
  pageHeader, sectionHeading, dataTable, statRow, statCard, statusBadge, listSkeleton,
  permissionState, permissionMessage, el, numText, uid,
} from './ui/index.ts';
import { errorState } from './view-states.ts';
import { isDenied } from './http-status.ts';

/** The account types this chart uses, in words rather than in English keys. */
const ACCOUNT_TYPE_BN: Record<string, string> = {
  asset: 'সম্পদ',
  liability: 'দায়',
  income: 'আয়',
  expense: 'ব্যয়',
  equity: 'মূলধন',
};

interface AccountBalance {
  code: string;
  nameBn: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  balance: string;
}

interface LedgerBatch {
  batchId: string;
  entryDate: string;
  memo: string;
  lines: { accountCode: string; debit: string; credit: string }[];
}

interface LedgerPayload {
  accounts: AccountBalance[];
  batches: LedgerBatch[];
  reconciliation: { provider: string; posted: string; reconciled: string }[];
}

/** One line of one batch — a row of the entries table. */
interface EntryRow {
  key: string;
  entryDate: string;
  memo: string;
  accountCode: string;
  debit: string;
  credit: string;
}

/**
 * R-8 audit — the THIRD private money formatter found in this pass, and on the
 * surface where it mattered most: a double-entry ledger whose debits and
 * credits an accounts clerk reconciles against a bank statement. Bangla digits
 * are the wrong choice there for the same reason they are wrong on a receipt.
 * One formatter now, in ui-core.
 */
const taka = formatBdt;

/**
 * An amount as whole paisa. Sums and differences of money are done in
 * integers, so ৳ 0.10 + ৳ 0.20 is ৳ 0.30 and a matched channel never shows a
 * ৳ 0.00 "mismatch" from float noise.
 */
function paisa(amount: string): number {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Paisa back to the money formatter. */
const takaOf = (p: number): string => taka(p / 100);

export interface LedgerViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

export class LedgerView {
  private readonly o: LedgerViewOptions;
  private data: LedgerPayload | null = null;
  private loading = true;
  /** The server refused. No retry can help, and no data may be shown. */
  private denied = false;
  private error = '';

  constructor(options: LedgerViewOptions) {
    this.o = options;
    // The loading state is drawn now, not after the answer: the shell empties
    // the view before mounting, so until this the screen stayed blank for the
    // whole round trip and the skeleton below was never seen.
    this.render();
    void this.load();
  }

  /**
   * P5. A refusal renders a refusal.
   *
   * This method used to answer a 403 with `this.data = DEMO` — a complete,
   * plausible chart of accounts and three double-entry batches in taka, under
   * one quiet line saying they were samples. Two rules at once: B-30's "a
   * refusal is not a data state", and the standing rule against faking
   * production state. A school's coordinator opening this saw numbers that
   * looked exactly like their books and were not.
   *
   * Nothing is fabricated here now. The demo's own fixture lives in
   * `demo.ts`, gated to the roles `LEDGER_ROLES` allows, like every other
   * screen's demo data.
   */
  private async load(): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/finance/ledger');
      if (isDenied(res)) { this.denied = true; }
      else if (res.ok) { this.data = (await res.json()) as LedgerPayload; }
      else { this.error = 'হিসাব আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।'; }
    } catch {
      this.error = 'সংযোগ নেই — হিসাব আনা যায়নি।';
    }
    this.loading = false;
    this.render();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // A channel is unmatched when what was posted and what was reconciled
    // differ. Only a loaded ledger has any, so the refusal, error and loading
    // renders show the title alone.
    const recon = this.data?.reconciliation ?? [];
    const unmatched = recon.filter((r) => paisa(r.posted) !== paisa(r.reconciled));

    root.append(pageHeader(d, {
      title: 'লেজার',
      actions: this.data && unmatched.length
        ? [statusBadge(d, {
          state: 'unmatched',
          label: `${formatCount(unmatched.length, 'bn')} অমিল`,
          tone: 'danger',
        })]
        : undefined,
    }));

    if (this.denied) {
      root.append(permissionState(d, {
        message: permissionMessage('লেজার ও পুনর্মিলন'),
        contact: 'প্রধান শিক্ষক, প্রতিষ্ঠান মালিক ও হিসাবরক্ষক',
      }));
      return;
    }
    if (this.error) { root.append(errorState(d, this.error, () => void this.load())); return; }
    if (this.loading || !this.data) { root.append(listSkeleton(d, 4)); return; }

    const data = this.data;

    // ── Recent entries, one row per line ──
    // The design reads double entry as one table: each line is a debit or a
    // credit, and a batch's lines sit next to each other. The line index is in
    // the key because a batch may post two lines to the same account.
    const entries: EntryRow[] = data.batches.flatMap((b) => b.lines.map((l, i) => ({
      key: `${b.batchId}-${i}-${l.accountCode}`,
      entryDate: b.entryDate,
      memo: b.memo,
      accountCode: l.accountCode,
      debit: l.debit,
      credit: l.credit,
    })));
    const nameOf = new Map(data.accounts.map((a) => [a.code, a.nameBn]));

    const headingId = uid('ledger');
    const panel = el(d, 'section', {
      className: 'ledger-panel', attrs: { 'aria-labelledby': headingId },
    }, el(d, 'h2', {
      className: 'ui-sr-only', text: 'সারাংশ ও সাম্প্রতিক এন্ট্রি', attrs: { id: headingId },
    }));
    root.append(panel);

    // ── The strip: what the entries below add up to, and what matched ──
    // ডেবিট and ক্রেডিট are the sums of the lines in the table under them —
    // the note says so, because the server sends the recent batches, not the
    // whole ledger. মিলেছে and অমিল are money, from the reconciliation the
    // payload carries per channel. Colour only where the figure means
    // something, and always with the word beside it.
    if (entries.length || recon.length) {
      const debit = entries.reduce((s, e) => s + paisa(e.debit), 0);
      const credit = entries.reduce((s, e) => s + paisa(e.credit), 0);
      const matched = recon.reduce((s, r) => s + paisa(r.reconciled), 0);
      const gap = unmatched.reduce((s, r) => s + Math.abs(paisa(r.posted) - paisa(r.reconciled)), 0);
      const noRecon = 'এখনো কোনো MFS লেনদেন নেই';
      panel.append(el(d, 'div', { className: 'ledger-stats' }, statRow(d,
        statCard(d, { label: 'ডেবিট', value: takaOf(debit), note: 'নিচের এন্ট্রিগুলোর যোগফল' }),
        statCard(d, { label: 'ক্রেডিট', value: takaOf(credit), note: 'নিচের এন্ট্রিগুলোর যোগফল' }),
        statCard(d, {
          label: 'মিলেছে',
          value: takaOf(matched),
          tone: matched > 0 ? 'success' : undefined,
          note: recon.length ? 'MFS লেনদেনে' : noRecon,
        }),
        statCard(d, {
          label: 'অমিল',
          value: takaOf(gap),
          tone: gap > 0 ? 'danger' : undefined,
          note: unmatched.length
            ? unmatched.map((r) => r.provider).join(' · ')
            : recon.length ? 'সব মাধ্যমে মিলেছে' : noRecon,
        }),
      )));
    }

    // Day and month, as the design writes it. The year joins only when an
    // entry is not from this year, so a January screen never passes last
    // December off as this one.
    const thisYear = todayLocalIso().slice(0, 4);
    const withYear = entries.some((e) => e.entryDate.slice(0, 4) !== thisYear);
    const day = (iso: string): string => {
      const short = formatDayMonth(iso, 'bn');
      return withYear && /^\d{4}-/.test(iso) ? `${short} ${toBanglaDigits(iso.slice(0, 4))}` : short;
    };
    // On a phone the two amounts sit on one meta line with no header row
    // above them, so each carries its word. `aria-hidden`: a reader already
    // hears the column name from the list's own hidden prefix. The desktop
    // table hides the word — its header says it. A line posts to one side
    // only; the empty side is `is-none`, a dash in the table, and left off the
    // phone's meta line, where "ক্রেডিট —" would be a third item saying nothing.
    const amount = (word: string, value: string): HTMLElement => {
      const has = paisa(value) > 0;
      return el(d, 'span', { className: has ? 'ledger-amt' : 'ledger-amt is-none' },
        el(d, 'span', { className: 'ledger-dir', text: `${word} `, attrs: { 'aria-hidden': 'true' } }),
        ...(has ? numText(d, taka(value)) : ['—']));
    };

    panel.append(dataTable(d, {
      caption: 'সাম্প্রতিক এন্ট্রি — ডেবিট ও ক্রেডিট',
      rows: entries,
      rowKey: (e) => e.key,
      empty: {
        glyph: 'book',
        message: 'এখনো কোনো এন্ট্রি নেই।',
        detail: 'আদায় লেখা হলে এখানে তার ডেবিট ও ক্রেডিট দেখা যাবে।',
      },
      columns: [
        { key: 'date', header: 'তারিখ', mobile: 'subtitle', width: 'minmax(0, 1fr)',
          cell: (e) => el(d, 'time', { attrs: { datetime: e.entryDate } }, ...numText(d, day(e.entryDate))) },
        { key: 'memo', header: 'বিবরণ', mobile: 'title', width: 'minmax(0, 2fr)',
          cell: (e) => e.memo || '—' },
        { key: 'acct', header: 'হিসাব', mobile: 'meta', width: 'minmax(0, 1.4fr)',
          cell: (e) => nameOf.get(e.accountCode) || e.accountCode },
        { key: 'dr', header: 'ডেবিট', mobile: 'meta', numeric: true, width: 'minmax(0, 1.1fr)',
          cell: (e) => amount('ডেবিট', e.debit) },
        { key: 'cr', header: 'ক্রেডিট', mobile: 'meta', numeric: true, width: 'minmax(0, 1.1fr)',
          cell: (e) => amount('ক্রেডিট', e.credit) },
      ],
    }));

    // ── What did not match, in words ──
    // The design's promise: not only how many, but how much and through which
    // channel. One sentence per channel. The server sends no settlement date
    // or receipt count, so the sentence does not invent one.
    if (unmatched.length) {
      panel.append(el(d, 'div', { className: 'ledger-mismatch', attrs: { role: 'note' } },
        ...unmatched.map((r) => {
          const diff = paisa(r.posted) - paisa(r.reconciled);
          const sentence = diff > 0
            ? `${r.provider}-এ ${takaOf(diff)} এখনো মেলেনি — পোস্ট হয়েছে ${taka(r.posted)}, মিলেছে ${taka(r.reconciled)}। মিলিয়ে দেখুন।`
            : `${r.provider}-এ পোস্ট হওয়া অঙ্কের চেয়ে ${takaOf(-diff)} বেশি মিলেছে — পোস্ট হয়েছে ${taka(r.posted)}, মিলেছে ${taka(r.reconciled)}। মিলিয়ে দেখুন।`;
          return el(d, 'p', { className: 'ledger-mismatch-text' }, ...numText(d, sentence));
        })));
    }

    // ── Every channel, matched or not ──
    // The strip gives the totals and the note speaks only of what did not
    // match; this is where each channel's own posted and reconciled amounts
    // stay visible, a fully matched one included. Neither figure can be read
    // off the chart of accounts below: a balance also counts hand-entered
    // collections, and Upay, bank and cheque have no account of their own.
    // On a phone the two amounts share a meta line with no header row, so
    // each carries its word, as in the entries table. The taka sign and its
    // figure are one unit, so a wrapping meta line breaks before the amount,
    // never between "৳" and the digits.
    const figure = (word: string, value: string): HTMLElement =>
      el(d, 'span', { className: 'ledger-amt' },
        el(d, 'span', { className: 'ledger-dir', text: `${word} `, attrs: { 'aria-hidden': 'true' } }),
        el(d, 'span', { className: 'ledger-fig' }, ...numText(d, taka(value))));
    root.append(sectionHeading(d, { title: 'MFS পুনর্মিলন' }));
    root.append(dataTable(d, {
      caption: 'MFS পুনর্মিলন — মাধ্যম অনুযায়ী',
      className: 'ledger-recon',
      rows: recon,
      rowKey: (r) => r.provider,
      empty: {
        glyph: 'wallet',
        message: 'এখনো কোনো MFS লেনদেন নেই।',
        detail: 'bKash, Nagad বা Rocket-এ টাকা এলে এখানে প্রতিটি মাধ্যমের পোস্ট হওয়া ও মেলানো অঙ্ক দেখা যাবে।',
      },
      columns: [
        { key: 'provider', header: 'মাধ্যম', mobile: 'title', width: 'minmax(0, 1.4fr)',
          cell: (r) => r.provider },
        { key: 'posted', header: 'পোস্ট হয়েছে', mobile: 'meta', numeric: true, width: 'minmax(0, 1.2fr)',
          cell: (r) => figure('পোস্ট হয়েছে', r.posted) },
        { key: 'reconciled', header: 'মিলেছে', mobile: 'meta', numeric: true, width: 'minmax(0, 1.2fr)',
          cell: (r) => figure('মিলেছে', r.reconciled) },
        { key: 'state', header: 'অবস্থা', mobile: 'status', width: 'minmax(0, 1fr)',
          cell: (r) => (paisa(r.posted) === paisa(r.reconciled)
            ? statusBadge(d, { state: 'matched', label: 'মিলেছে', tone: 'success' })
            : statusBadge(d, { state: 'unmatched', label: 'অমিল', tone: 'danger' })) },
      ],
    }));

    // ── Chart of accounts ──
    // Not drawn in 07 Finance §04, but it is this screen's data: it stays,
    // under the designed panel.
    root.append(sectionHeading(d, { title: 'হিসাব-তালিকা' }));
    root.append(dataTable(d, {
      caption: 'হিসাব-তালিকা',
      rows: data.accounts,
      rowKey: (a) => a.code,
      empty: { glyph: 'book', message: 'হিসাব-তালিকায় এখনো কোনো হিসাব নেই।' },
      columns: [
        { key: 'code', header: 'কোড', mobile: 'meta', cell: (a) => a.code,
          width: 'minmax(0, 1.2fr)' },
        { key: 'name', header: 'হিসাব', mobile: 'title', cell: (a) => a.nameBn,
          width: 'minmax(0, 2fr)' },
        { key: 'type', header: 'ধরন', mobile: 'subtitle',
          cell: (a) => ACCOUNT_TYPE_BN[a.type] ?? a.type, width: 'minmax(0, 1fr)' },
        { key: 'bal', header: 'ব্যালেন্স', mobile: 'meta', numeric: true,
          cell: (a) => el(d, 'span', {}, ...numText(d, taka(a.balance))), width: 'minmax(0, 1.2fr)' },
      ],
    }));
  }

}
