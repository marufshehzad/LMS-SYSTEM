/**
 * UX sweep, round 3 — the fee screen (group fees, src/fees-view.ts).
 *
 *   1 — At 320px, a family phone row with the wider মেয়াদোত্তীর্ণ badge
 *       broke its month in two ("আগস্ট" / "২০২৬"). The row's title box was
 *       `flex: 1 1 0%` with `min-width: 0`: of month, amount and badge, the
 *       month was the one thing allowed to shrink, so it did. The family row
 *       now keeps its title at its own width (it shrinks only past the whole
 *       row) and lets the status wrap under the amount instead. Measured in
 *       Chrome at 320, 344, 360 and 375: the month is one line at every width,
 *       rows that fit keep one line, no overflow. The fix is CSS, returned to
 *       the lead as data; these tests read the cascade from public/app.css in
 *       jsdom, so they pass once that CSS is merged and fail without it.
 *   2 — In the office layout, under the আংশিক filter, a part-paid bill past
 *       its due date showed only মেয়াদোত্তীর্ণ: the word আংশিক was nowhere on
 *       the rows that filter listed. The status now keeps আংশিক পরিশোধিত as a
 *       word under the overdue badge, on the office phone row and in every
 *       desk table. The family phone row already says it with "বাকি ৳ …".
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

import { todayLocalIso } from '../../../packages/ui-core/src/format.ts';

const APP_CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.css'), 'utf8');

let dom: JSDOM;
const doc = () => dom.window.document;
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// Imported after the globals exist (demo.ts reads location and localStorage).
let FeesView: typeof import('../src/fees-view.ts').FeesView;
let closeAllOverlays: typeof import('../src/ui/overlay.ts').closeAllOverlays;

before(async () => {
  dom = new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  // The real stylesheet, so a computed style is the cascade the phone gets
  // (jsdom applies selectors and specificity; it skips @media blocks, and no
  // rule read here lives in one).
  const style = dom.window.document.createElement('style');
  style.textContent = APP_CSS;
  dom.window.document.head.append(style);
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.Event = dom.window.Event;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  g.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  ({ FeesView } = await import('../src/fees-view.ts'));
  ({ closeAllOverlays } = await import('../src/ui/overlay.ts'));
});

const live: Array<{ destroy(): void }> = [];
afterEach(() => { for (const v of live.splice(0)) v.destroy(); });

beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<main id="root"></main>';
  localStorage.clear();
});

const root = () => doc().getElementById('root') as HTMLElement;
const text = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
const css = (n: Element) => dom.window.getComputedStyle(n);

/** What the eye reads in a node: screen-reader-only text and the other rendering's twin removed. */
function seen(node: Element | null | undefined, hide: string): string {
  if (!node) return '';
  const c = node.cloneNode(true) as Element;
  for (const x of c.querySelectorAll(`.ui-sr-only, ${hide}`)) x.remove();
  return text(c);
}

type Json = Record<string, unknown>;
function auth(role: string, routes: Record<string, unknown>) {
  return {
    role,
    authedFetch: async (url: string) => {
      const body = routes[url.split('?')[0]];
      if (body === undefined) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    },
  } as never;
}

/** A date `days` from today, on the reader's calendar (negative: gone). */
function day(days: number): string {
  const t = new Date();
  t.setDate(t.getDate() + days);
  return todayLocalIso(t);
}

function invoice(id: string, o: {
  studentId?: string; period?: string | null; dueOn: string; total?: string; paid?: string; balance: string;
  status?: string; no?: string;
}): Json {
  const period = o.period === undefined ? '2026-08' : o.period;
  const total = o.total ?? '1250.00';
  return {
    id, invoiceNo: o.no ?? `INV-${period ?? '2026-10'}-${id}`, studentId: o.studentId, billingPeriod: period,
    issuedOn: `${period ?? '2026-10'}-01`, dueOn: o.dueOn,
    totalAmount: total, paidAmount: o.paid ?? (Number(total) - Number(o.balance)).toFixed(2),
    balanceAmount: o.balance, status: o.status ?? 'issued',
    lines: [{ descriptionBn: 'মাসিক বেতন', amount: total, waiverAmount: '0.00', netAmount: total }],
  };
}

function mount(role: string, invoices: Json[], wards?: Json[]) {
  const view = new FeesView({
    root: root(), doc: doc(),
    auth: auth(role, {
      '/api/v1/finance/invoices': { invoices },
      '/api/v1/academics/ward': { wards: wards ?? [], student: null },
      '/api/v1/finance/receipts': { receipts: [] },
    }),
  });
  live.push(view);
  return view;
}

const chip = (id: string) => root().querySelector<HTMLButtonElement>(`.fees-filter-opt[data-filter="${id}"]`)!;
/** The phone list's invoice rows (not a guardian's per-child due rows). */
const phoneRows = () => [...root().querySelectorAll<HTMLElement>('.fees-sheet > .ui-data > .ui-list > .ui-list-item')];
const phoneRow = (key: string) => phoneRows().find((li) => li.dataset.key === key);
const tableRow = (key: string) => root().querySelector<HTMLElement>(`.fees-sheet .ui-table tr[data-key="${key}"]`);

/* ── 2 ────────────────────────────────────────────────────────────────── */

describe('2 — a part-paid bill past its date says আংশিক as well as মেয়াদোত্তীর্ণ', () => {
  // The recheck's bill: ৳ 1,100.00 with ৳ 850.00 paid, its date gone. Beside
  // it a part-paid bill not yet due, and an unpaid late one.
  const BILLS = [
    invoice('p8', { no: 'INV-2026-08-00002', dueOn: day(-5), total: '1100.00', balance: '250.00', status: 'partly_paid' }),
    invoice('p9', { no: 'INV-2026-09-00003', period: '2026-09', dueOn: day(9), total: '1100.00', balance: '400.00', status: 'partly_paid' }),
    invoice('q8', { no: 'INV-2026-08-00001', dueOn: day(-5), balance: '1250.00' }),
  ];

  async function officePartial(): Promise<void> {
    mount('accountant', BILLS);
    await settle();
    chip('partial').click();
    await settle();
    assert.equal(chip('partial').getAttribute('aria-pressed'), 'true');
  }

  test('every row the আংশিক filter lists says আংশিক, on the phone and at the desk', async () => {
    await officePartial();
    const phone = phoneRows();
    assert.deepEqual(phone.map((li) => li.dataset.key), ['p8', 'p9']);
    for (const li of phone) {
      assert.match(seen(li, '.fees-table-only'), /আংশিক/, `phone row ${li.dataset.key} reads "${seen(li, '.fees-table-only')}"`);
    }
    for (const key of ['p8', 'p9']) {
      assert.match(seen(tableRow(key), '.fees-list-only'), /আংশিক/, `desk row ${key} reads "${seen(tableRow(key), '.fees-list-only')}"`);
    }
  });

  test('the late one keeps its overdue badge, with the word আংশিক পরিশোধিত under it', async () => {
    await officePartial();
    for (const scope of [phoneRow('p8'), tableRow('p8')]) {
      const status = scope!.querySelector('.fees-status')!;
      const badge = status.querySelector('.ui-status') as HTMLElement;
      assert.equal(text(badge), 'মেয়াদোত্তীর্ণ');
      assert.equal(badge.dataset.tone, 'danger');
      assert.ok(badge.querySelector('.ui-badge-glyph'), 'trouble carries a glyph');
      const also = status.querySelector('.fees-status-also') as HTMLElement;
      assert.ok(also, 'a second word beside the badge');
      assert.equal(seen(also, '.none'), 'আংশিক পরিশোধিত');
      // A word, not a colour: it is not a second tinted badge.
      assert.equal(also.closest('.ui-status'), null);
      assert.equal(also.dataset.tone, undefined);
      // Read aloud as two words with a pause, not "মেয়াদোত্তীর্ণআংশিক".
      assert.equal(text(status), 'মেয়াদোত্তীর্ণ, আংশিক পরিশোধিত');
    }
    // The phone row's button is the row's spoken name: it carries both.
    assert.match(text(phoneRow('p8')!.querySelector('.ui-list-hit')), /মেয়াদোত্তীর্ণ, আংশিক পরিশোধিত/);
    // Shown on the office phone: nothing marks it for the table only.
    assert.equal(phoneRow('p8')!.querySelector('.fees-status-also.fees-table-only'), null);
  });

  test('no word is doubled: a part-paid bill not yet due and an unpaid late bill say one thing', async () => {
    mount('accountant', BILLS);
    await settle();
    chip('all').click();
    await settle();
    for (const scope of [phoneRow('p9'), tableRow('p9')]) {
      assert.equal(text(scope!.querySelector('.fees-status')), 'আংশিক পরিশোধিত');
      assert.equal(scope!.querySelector('.fees-status-also'), null);
    }
    for (const scope of [phoneRow('q8'), tableRow('q8')]) {
      assert.equal(text(scope!.querySelector('.fees-status')), 'মেয়াদোত্তীর্ণ');
      assert.equal(scope!.querySelector('.fees-status-also'), null);
    }
  });

  test('a late bill with a payment recorded says it too, whatever its stored status', async () => {
    mount('accountant', [
      invoice('x8', { dueOn: day(-5), total: '1100.00', balance: '600.00', status: 'issued' }),
    ]);
    await settle();
    assert.equal(text(phoneRow('x8')!.querySelector('.fees-status')), 'মেয়াদোত্তীর্ণ, আংশিক পরিশোধিত');
  });

  test('the family desk table says both; the family phone row keeps "বাকি ৳ 250.00" and no second word', async () => {
    mount('student', [
      invoice('jun', { period: '2026-06', dueOn: day(-20), balance: '250.00', status: 'partly_paid' }),
    ]);
    await settle();
    const cell = tableRow('jun')!.querySelector('[data-col="status"]')!;
    assert.equal(seen(cell.querySelector('.ui-status'), '.fees-list-only'), 'মেয়াদোত্তীর্ণ');
    assert.equal(seen(cell.querySelector('.fees-status-also'), '.fees-list-only'), 'আংশিক পরিশোধিত');
    assert.equal(text(cell), 'মেয়াদোত্তীর্ণ, আংশিক পরিশোধিত');
    const li = phoneRow('jun')!;
    const also = li.querySelector('.fees-status-also')!;
    assert.ok(also.classList.contains('fees-table-only'));
    // The sheet's existing rule hides a table-only node in the list.
    assert.equal(css(also).display, 'none');
    assert.match(seen(li, '.fees-table-only'), /বাকি ৳ 250\.00/);
  });

  test('app.css stacks the two words: under the badge in the office phone row and in the desk table', async () => {
    await officePartial();
    const phone = phoneRow('p8')!.querySelector('.fees-status')!;
    assert.equal(css(phone).display, 'inline-flex');
    assert.equal(css(phone).flexDirection, 'column');
    assert.equal(css(phone).alignItems, 'flex-end', 'right-aligned in the phone row’s status slot');
    const desk = tableRow('p8')!.querySelector('.fees-status')!;
    assert.equal(css(desk).display, 'inline-flex');
    assert.equal(css(desk).flexDirection, 'column');
    assert.equal(css(desk).alignItems, 'flex-start', 'left-aligned under the অবস্থা header');
    const also = phoneRow('p8')!.querySelector('.fees-status-also')!;
    assert.equal(css(also).fontWeight, '400');
    assert.equal(css(also).whiteSpace, 'nowrap');
    // A single-state status is left as the sheet draws it.
    assert.notEqual(css(phoneRow('p9')!.querySelector('.fees-status')!).flexDirection, 'column');
  });
});

/* ── 1 ────────────────────────────────────────────────────────────────── */

describe('1 — a family phone row keeps its month on one line and wraps the status instead', () => {
  const ANIKA = { studentId: 's-anika', nameBn: 'আনিকা রহমান', sectionLabel: 'নবম–ক' };
  const BIJOY = { studentId: 's-bijoy', nameBn: 'বিজয় রহমান', sectionLabel: 'ষষ্ঠ–খ' };

  function familyRowLayout(li: HTMLElement) {
    const hit = li.querySelector(':scope > .ui-list-hit')!;
    const main = hit.querySelector(':scope > .ui-list-main')!;
    return { hit: css(hit), main: css(main) };
  }

  test('the late month row: the title is not the thing that shrinks, and the status wraps to the right', async () => {
    mount('student', [
      invoice('aug', { dueOn: day(-5), balance: '1250.00' }),
      invoice('jul', { period: '2026-07', dueOn: day(-40), balance: '0.00', status: 'paid' }),
    ]);
    await settle();
    for (const key of ['aug', 'jul']) {
      const { hit, main } = familyRowLayout(phoneRow(key)!);
      assert.equal(hit.flexWrap, 'wrap', `${key}: the row lets its status move under the amount`);
      assert.equal(hit.justifyContent, 'flex-end', `${key}: a wrapped status sits at the right, under the amount`);
      assert.equal(main.flexShrink, '0', `${key}: the month does not shrink below its own width`);
      assert.equal(main.flexBasis, 'auto', `${key}: the month starts from its own width, not from 0`);
      assert.equal(main.maxWidth, '100%', `${key}: a title wider than the whole row still wraps inside it`);
    }
    // The title itself is untouched: same size and weight (no smaller font).
    const title = phoneRow('aug')!.querySelector('.ui-list-title')!;
    assert.equal(css(title).fontSize, '14.5px');
  });

  test('a guardian’s rows under each child get the same layout; the per-child due rows do not', async () => {
    mount('guardian', [
      invoice('a8', { studentId: 's-anika', dueOn: day(-5), balance: '1250.00' }),
      invoice('b8', { studentId: 's-bijoy', dueOn: day(-5), total: '1100.00', balance: '250.00', status: 'partly_paid' }),
    ], [ANIKA, BIJOY]);
    await settle();
    for (const key of ['a8', 'b8']) {
      const { hit, main } = familyRowLayout(phoneRow(key)!);
      assert.equal(hit.flexWrap, 'wrap', key);
      assert.equal(main.flexShrink, '0', key);
    }
    const kid = root().querySelector('.fees-kids .ui-list-item')!;
    assert.ok(kid);
    assert.notEqual(css(kid.querySelector('.ui-list-hit')!).flexWrap, 'wrap');
  });

  test('the office rows are left as they were', async () => {
    mount('accountant', [invoice('q8', { dueOn: day(-5), balance: '1250.00' })]);
    await settle();
    const hit = phoneRow('q8')!.querySelector('.ui-list-hit')!;
    assert.notEqual(css(hit).flexWrap, 'wrap');
    assert.notEqual(css(hit.querySelector('.ui-list-main')!).flexShrink, '0');
  });
});
