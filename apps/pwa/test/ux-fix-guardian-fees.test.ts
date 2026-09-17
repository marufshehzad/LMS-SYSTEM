/**
 * UX sweep — the guardian and fee screens (group guardian-fees).
 *
 * Each block names the confirmed finding it closes:
 *   18 — a guardian of two children could not tell whose bill was whose;
 *   20 — the child strip lost keyboard focus, and a slow answer could put the
 *        previous child back;
 *   64 — the screen's own offline banner stayed after the connection returned;
 *   minor 67 — on a phone the invoice drawer's cards had no visible name.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { FeesView } from '../src/fees-view.ts';
import { GuardianView, CACHE_KEY as WARD_CACHE } from '../src/guardian-view.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';
import { closeAllOverlays } from '../src/ui/overlay.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
let fakeNavigator: { onLine: boolean };

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.document = dom.window.document;
  fakeNavigator = { onLine: true };
  Object.defineProperty(globalThis, 'navigator', { value: fakeNavigator, configurable: true });
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  g.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
});

/** Every view a test made, destroyed after it so its listeners do not leak into the next. */
const live: Array<{ destroy(): void }> = [];
afterEach(() => { for (const v of live.splice(0)) v.destroy(); });

beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<main id="root"></main>';
  localStorage.clear();
  dom.window.sessionStorage.clear();
  fakeNavigator.onLine = true;
});

const root = () => doc().getElementById('root') as HTMLElement;
const text = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
const goOnline = () => dom.window.dispatchEvent(new dom.window.Event('online'));

type Json = Record<string, unknown>;
/**
 * A fetch routed by path. `net.down` throws like a dead connection; a route
 * can be a function (to see the URL) or a status number.
 */
function server(routes: Record<string, unknown | ((url: string) => unknown)>) {
  const net = { down: false, seen: [] as string[] };
  const auth = (role: string) => ({
    role,
    authedFetch: async (url: string) => {
      net.seen.push(url);
      if (net.down) throw new TypeError('Failed to fetch');
      const path = url.split('?')[0];
      const r = routes[path];
      const body = typeof r === 'function' ? await (r as (u: string) => unknown)(url) : r;
      if (typeof body === 'number') {
        return { ok: false, status: body, json: async () => ({}) } as unknown as Response;
      }
      if (body === undefined) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    },
  }) as never;
  return { net, auth };
}

/* ── fixtures ─────────────────────────────────────────────────────────── */

const ANIKA = { studentId: 's-anika', nameBn: 'আনিকা রহমান', sectionLabel: 'নবম–ক', rollNo: 1, relationBn: 'মা' };
const BIJOY = { studentId: 's-bijoy', nameBn: 'বিজয় রহমান', sectionLabel: 'ষষ্ঠ–খ', rollNo: 12, relationBn: 'মা' };

function invoice(id: string, studentId: string | undefined, period: string, balance: string, status = 'issued'): Json {
  return {
    id, invoiceNo: `INV-${period}-${id}`, studentId, billingPeriod: period,
    issuedOn: `${period}-01`, dueOn: `${period}-10`,
    totalAmount: '1250.00', paidAmount: (1250 - Number(balance)).toFixed(2),
    balanceAmount: balance, status,
    lines: [{ descriptionBn: 'মাসিক বেতন', amount: '1250.00', waiverAmount: '0.00', netAmount: '1250.00' }],
  };
}

/** Two children, both billed ৳ 1,250.00 for August — the rows that used to be identical. */
const TWO_KIDS = [
  invoice('a8', 's-anika', '2026-08', '1250.00'),
  invoice('b8', 's-bijoy', '2026-08', '1250.00'),
  invoice('a7', 's-anika', '2026-07', '0.00', 'paid'),
  invoice('b7', 's-bijoy', '2026-07', '250.00', 'partly_paid'),
];

function mountFees(o: {
  role?: string; invoices?: unknown; wards?: unknown; studentId?: string; receipts?: unknown;
  /** Start with the connection down. */
  offline?: boolean;
}) {
  const s = server({
    '/api/v1/finance/invoices': o.invoices === undefined ? { invoices: TWO_KIDS } : o.invoices,
    '/api/v1/academics/ward': o.wards === undefined ? { wards: [ANIKA, BIJOY], student: null } : o.wards,
    '/api/v1/finance/receipts': o.receipts ?? { receipts: [] },
  });
  s.net.down = !!o.offline;
  const view = new FeesView({
    root: root(), doc: doc(), auth: s.auth(o.role ?? 'guardian'), studentId: o.studentId,
  });
  live.push(view);
  return { ...s, view };
}

/** The phone rows: what a screen reader says for each (the row button's text). */
const phoneRows = () => [...root().querySelectorAll('.fees-sheet > .ui-data .ui-list-hit')].map(text);
const headings = () => [...root().querySelectorAll('.fees-kid-head')].map(text);

/* ── 18 ───────────────────────────────────────────────────────────────── */

describe('18 — a guardian of two children sees whose bill is whose', () => {
  test('each child’s months are under that child’s name, and no two phone rows read alike', async () => {
    mountFees({});
    await settle();
    assert.deepEqual(headings(), ['আনিকা রহমান · নবম–ক', 'বিজয় রহমান · ষষ্ঠ–খ']);
    const rows = phoneRows();
    assert.equal(rows.length, 4);
    assert.equal(new Set(rows).size, rows.length, `identical rows: ${rows.join(' | ')}`);
    for (const r of rows.slice(0, 2)) assert.match(r, /আনিকা রহমান/);
    for (const r of rows.slice(2)) assert.match(r, /বিজয় রহমান/);
    // The desktop table and the phone list are named by the child too.
    const captions = [...root().querySelectorAll('.fees-sheet caption')].map(text);
    assert.deepEqual(captions, ['আনিকা রহমান — ইনভয়েসের তালিকা', 'বিজয় রহমান — ইনভয়েসের তালিকা']);
    // The heading level sits under the sheet's h2.
    assert.equal(root().querySelectorAll('.fees-sheet h2').length, 1);
  });

  test('under the total, one row per child with what that child owes (04 Guardian §04)', async () => {
    mountFees({});
    await settle();
    assert.match(text(root().querySelector('.fees-due-label')), /মোট বকেয়া · ২ সন্তান/);
    assert.equal(text(root().querySelector('.fees-due-amount')), '৳ 2,750.00');
    const kids = [...root().querySelectorAll('.fees-kids .ui-list-item')].map(text);
    assert.equal(kids.length, 2);
    assert.match(kids[0], /আনিকা রহমান.*নবম–ক.*৳ 1,250\.00/);
    assert.match(kids[1], /বিজয় রহমান.*ষষ্ঠ–খ.*৳ 1,500\.00/);
    // Money is a figure in the numeral face (R6), Latin per formatBdt.
    const owed = root().querySelector('.fees-kids .fees-kid-owed');
    assert.ok(owed?.classList.contains('n'));
  });

  test('a child who owes nothing is told so in words, not by a missing row', async () => {
    mountFees({ invoices: { invoices: [
      invoice('a8', 's-anika', '2026-08', '1250.00'),
      invoice('b8', 's-bijoy', '2026-08', '0.00', 'paid'),
    ] } });
    await settle();
    const kids = [...root().querySelectorAll('.fees-kids .ui-list-item')].map(text);
    assert.equal(kids.length, 2);
    assert.match(kids[1], /বিজয় রহমান.*বকেয়া নেই/);
  });

  test('the drawer’s title names the child, and the invoice number stays in its facts', async () => {
    mountFees({});
    await settle();
    const bijoyAugust = [...root().querySelectorAll<HTMLElement>('.fees-sheet > .ui-data .ui-list-hit')][2];
    bijoyAugust.click();
    await settle();
    assert.equal(text(doc().querySelector('.ui-dialog-title')), 'বিজয় রহমান · আগস্ট ২০২৬');
    const facts = text(doc().querySelector('.ui-scrim .ui-facts'));
    assert.match(facts, /ইনভয়েস\s*INV-2026-08-b8/);
  });

  test('the child whose ফি পরিশোধ করুন was pressed comes first', async () => {
    mountFees({ studentId: 's-bijoy' });
    await settle();
    assert.deepEqual(headings(), ['বিজয় রহমান · ষষ্ঠ–খ', 'আনিকা রহমান · নবম–ক']);
    assert.match(text(root().querySelector('.fees-kids .ui-list-item')), /বিজয় রহমান/);
  });

  test('a pressed child with no bill leads with a sentence, not with a sibling’s bills', async () => {
    mountFees({
      studentId: 's-bijoy',
      invoices: { invoices: [invoice('a8', 's-anika', '2026-08', '1250.00')] },
    });
    await settle();
    assert.deepEqual(headings(), ['বিজয় রহমান · ষষ্ঠ–খ', 'আনিকা রহমান · নবম–ক']);
    const first = root().querySelector('.fees-kid-head')?.nextElementSibling;
    assert.match(text(first), /এই সন্তানের কোনো ইনভয়েস পাওয়া যায়নি/);
  });

  test('offline, the names come from what আমার সন্তান saved', async () => {
    localStorage.setItem(WARD_CACHE, JSON.stringify({ wards: [ANIKA, BIJOY], home: null }));
    mountFees({ wards: 503 });
    await settle();
    assert.deepEqual(headings(), ['আনিকা রহমান · নবম–ক', 'বিজয় রহমান · ষষ্ঠ–খ']);
  });

  test('with no names anywhere, the two children are still two different headings', async () => {
    mountFees({ wards: 503 });
    await settle();
    assert.deepEqual(headings(), ['সন্তান ১', 'সন্তান ২']);
    const rows = phoneRows();
    assert.equal(new Set(rows).size, rows.length);
  });

  test('names that arrive after the bills are painted in', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mountFees({ wards: async () => { await gate; return { wards: [ANIKA, BIJOY], student: null }; } });
    await settle();
    assert.deepEqual(headings(), ['সন্তান ১', 'সন্তান ২']);
    release();
    await settle();
    assert.deepEqual(headings(), ['আনিকা রহমান · নবম–ক', 'বিজয় রহমান · ষষ্ঠ–খ']);
  });

  test('one child, a student, or bills that do not say whose: the layout is as it was', async () => {
    // One child.
    let m = mountFees({ wards: { wards: [ANIKA], student: null },
      invoices: { invoices: [TWO_KIDS[0], TWO_KIDS[2]] } });
    await settle();
    assert.equal(root().querySelector('.fees-kid-head'), null);
    assert.equal(root().querySelector('.fees-kids'), null);
    assert.match(text(root().querySelector('.fees-due-label')), /^এখন বকেয়া$/);
    m.view.destroy();

    // A student: their own bills, and nobody else's names are asked for.
    root().textContent = '';
    m = mountFees({ role: 'student' });
    await settle();
    assert.equal(root().querySelector('.fees-kid-head'), null);
    assert.ok(!m.net.seen.some((u) => u.includes('/academics/ward')), 'a student never reads the ward list');
    m.view.destroy();

    // Bills without a studentId (an old cache) are not guessed at.
    root().textContent = '';
    m = mountFees({ invoices: { invoices: TWO_KIDS.map((i) => ({ ...i, studentId: undefined })) } });
    await settle();
    assert.equal(root().querySelector('.fees-kid-head'), null);
    m.view.destroy();
  });

  test('an accountant’s office layout is untouched by a studentId', async () => {
    const m = mountFees({ role: 'accountant', studentId: 's-bijoy' });
    await settle();
    assert.equal(root().querySelector('.fees-kid-head'), null);
    assert.ok(root().querySelector('.fees-sheet.is-office'));
    assert.ok(!m.net.seen.some((u) => u.includes('/academics/ward')));
  });
});

/* ── minor 67 ─────────────────────────────────────────────────────────── */

describe('minor 67 — on a phone the invoice drawer names its cards', () => {
  test('the drawer names its cards: the lines, and the receipts once they arrive', async () => {
    mountFees({
      role: 'student',
      invoices: { invoices: [invoice('p7', 's-anika', '2026-07', '0.00', 'paid')] },
      receipts: { receipts: [{ receiptNo: 'RCP-2026-07-00012', amount: '1250.00', method: 'bkash', issuedAt: '2026-07-08T10:12:00Z' }] },
    });
    await settle();
    (root().querySelector('.fees-sheet > .ui-data .ui-list-hit') as HTMLElement).click();
    await settle();
    const body = doc().querySelector('.ui-scrim .ui-card-form')!;
    // Visible headings (not the tables' screen-reader-only captions), each
    // directly before the card it names, under the drawer's h2.
    const heads = [...body.querySelectorAll('h3.fees-detail-head')];
    assert.deepEqual(heads.map(text), ['খাতওয়ারি হিসাব', 'রসিদ']);
    for (const h of heads) {
      assert.ok(!h.classList.contains('ui-sr-only'));
      assert.ok(h.nextElementSibling?.classList.contains('ui-data'), `${text(h)} is not over its card`);
    }
    assert.match(text(heads[1].nextElementSibling), /RCP-2026-07-00012/);
  });

  test('no receipt, no receipt heading', async () => {
    mountFees({ role: 'student', invoices: { invoices: [invoice('i8', 's-anika', '2026-08', '1250.00')] } });
    await settle();
    (root().querySelector('.fees-sheet > .ui-data .ui-list-hit') as HTMLElement).click();
    await settle();
    const heads = [...doc().querySelectorAll('.ui-scrim h3.fees-detail-head')].map(text);
    assert.deepEqual(heads, ['খাতওয়ারি হিসাব']);
  });
});

/* ── 64 ───────────────────────────────────────────────────────────────── */

describe('64 — the fee screen’s offline banner goes when the connection comes back', () => {
  const CACHED = [invoice('old', 's-anika', '2026-07', '1250.00')];
  const FRESH = { invoices: [invoice('new', 's-anika', '2026-08', '1250.00')] };

  test('offline shows the cache under a banner; online fetches again and the banner goes', async () => {
    localStorage.setItem('shikhon_invoices_cache', JSON.stringify(CACHED));
    const m = mountFees({ role: 'student', invoices: FRESH, offline: true });
    await settle();
    assert.ok(root().querySelector('.fees-offline'), 'offline banner while the fetch fails');
    assert.match(text(root()), /জুলাই ২০২৬/);

    m.net.down = false;
    goOnline();
    await settle();
    assert.equal(root().querySelector('.fees-offline'), null, 'the banner is gone once back online');
    assert.match(text(root()), /আগস্ট ২০২৬/, 'and the list is the fresh one');
    m.view.destroy();
  });

  test('a screen that is already current is not fetched again', async () => {
    const m = mountFees({ role: 'student', invoices: FRESH });
    await settle();
    const before = m.net.seen.length;
    goOnline();
    await settle();
    assert.equal(m.net.seen.length, before);
    m.view.destroy();
  });

  test('destroy() stops listening, and a late answer never paints over the next screen', async () => {
    localStorage.setItem('shikhon_invoices_cache', JSON.stringify(CACHED));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const m = mountFees({ role: 'student', invoices: async () => { await gate; return FRESH; } });
    await settle();
    m.view.destroy();
    root().textContent = 'অন্য পাতা';
    release();
    await settle();
    assert.equal(text(root()), 'অন্য পাতা', 'the late answer painted over another route');

    const before = m.net.seen.length;
    goOnline();
    await settle();
    assert.equal(m.net.seen.length, before, 'a destroyed view still listened for online');
  });

  test('an open drawer still waiting for its receipts gets them when the connection returns', async () => {
    localStorage.setItem('shikhon_invoices_cache', JSON.stringify([invoice('p7', 's-anika', '2026-07', '0.00', 'paid')]));
    const m = mountFees({
      role: 'student',
      invoices: { invoices: [invoice('p7', 's-anika', '2026-07', '0.00', 'paid')] },
      receipts: { receipts: [{ receiptNo: 'RCP-2026-07-00012', amount: '1250.00', method: 'bkash', issuedAt: '2026-07-08T10:12:00Z' }] },
      offline: true,
    });
    await settle();
    (root().querySelector('.fees-sheet > .ui-data .ui-list-hit') as HTMLElement).click();
    await settle();
    assert.match(text(doc().querySelector('.ui-scrim')), /রসিদ আনা হচ্ছে/);

    m.net.down = false;
    goOnline();
    await settle();
    const drawer = text(doc().querySelector('.ui-scrim'));
    assert.match(drawer, /RCP-2026-07-00012/);
    assert.doesNotMatch(drawer, /রসিদ আনা হচ্ছে/);
    m.view.destroy();
  });
});

describe('64 (same defect) — the আমার সন্তান banner promises a refresh, and now keeps it', () => {
  const HOME = {
    ...ANIKA,
    attendance: { todayStatus: 'present', monthPercent: 94, present: 17, absent: 1, late: 0, halfDay: 0, excused: 2 },
    fees: { outstanding: 1250, earliestDue: '2026-08-10', overdueCount: 0 },
    result: null,
  };

  function mountGuardian() {
    localStorage.setItem(WARD_CACHE, JSON.stringify({ wards: [ANIKA, BIJOY], home: HOME }));
    const s = server({ '/api/v1/academics/ward': { wards: [ANIKA, BIJOY], student: HOME } });
    s.net.down = true;
    const view = new GuardianView({ root: root(), doc: doc(), auth: s.auth('guardian'), onOpenFees: () => {} });
    live.push(view);
    return { ...s, view };
  }

  test('online again: fetched, and the banner goes', async () => {
    const m = mountGuardian();
    await settle();
    assert.ok(root().querySelector('.ward-offline'));
    m.net.down = false;
    goOnline();
    await settle();
    assert.equal(root().querySelector('.ward-offline'), null);
    m.view.destroy();
  });

  test('a page the guardian has left is not painted when the connection returns', async () => {
    const m = mountGuardian();
    await settle();
    root().textContent = 'অন্য পাতা';   // the shell mounted another route in the same view
    m.net.down = false;
    const before = m.net.seen.length;
    goOnline();
    await settle();
    assert.equal(text(root()), 'অন্য পাতা');
    assert.equal(m.net.seen.length, before, 'no fetch for a page nobody is looking at');
    // And it stopped listening.
    goOnline();
    await settle();
    assert.equal(m.net.seen.length, before);
  });
});

/* ── 20 ───────────────────────────────────────────────────────────────── */

describe('20 — the child strip keeps its place under the keyboard', () => {
  const KIDS = [
    ANIKA, BIJOY,
    { studentId: 's-chaya', nameBn: 'ছায়া রহমান', sectionLabel: 'তৃতীয়–ক', rollNo: 4, relationBn: 'মা' },
    { studentId: 's-dipu', nameBn: 'দীপু রহমান', sectionLabel: 'প্রথম–খ', rollNo: 9, relationBn: 'মা' },
  ];
  const home = (w: typeof ANIKA) => ({ ...w, attendance: null, fees: null, result: null });

  /** The ward endpoint, answering each child when the test says so. */
  function wardServer(wards: typeof KIDS, hold = new Set<string>()) {
    const waiting = new Map<string, () => void>();
    const s = server({
      '/api/v1/academics/ward': async (url: string) => {
        const id = /studentId=([^&]+)/.exec(url)?.[1];
        const w = wards.find((x) => x.studentId === id);
        if (id && hold.has(id)) await new Promise<void>((r) => waiting.set(id, r));
        return { wards, student: w ? home(w) : null };
      },
    });
    return { ...s, release: (id: string) => waiting.get(id)?.(), waiting };
  }

  const selected = () => root().querySelector<HTMLElement>('.ui-child-opt[aria-selected="true"]');
  const active = () => doc().activeElement as HTMLElement;
  const press = (key: string) => active().dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  test('ArrowRight, Home and End each move the child AND keep focus on its tab (keeper armed, as in the shell)', async () => {
    const s = wardServer(KIDS.slice(0, 3));
    const stop = keepFocusWithin(root());
    const view = new GuardianView({ root: root(), doc: doc(), auth: s.auth('guardian') });
    live.push(view);
    await settle();
    selected()!.focus();

    press('ArrowRight');
    await settle();
    assert.equal(selected()?.dataset.id, 's-bijoy');
    assert.equal(active(), selected(), 'focus fell off the strip after ArrowRight');

    press('End');
    await settle();
    assert.equal(selected()?.dataset.id, 's-chaya');
    assert.equal(active(), selected());

    press('Home');
    await settle();
    assert.equal(selected()?.dataset.id, 's-anika');
    assert.equal(active(), selected());
    stop();
    view.destroy();
  });

  test('two quick ArrowRights reach the third child even when the second child’s answer is slower', async () => {
    const s = wardServer(KIDS.slice(0, 3), new Set(['s-bijoy']));
    const stop = keepFocusWithin(root());
    const view = new GuardianView({ root: root(), doc: doc(), auth: s.auth('guardian') });
    live.push(view);
    await settle();
    selected()!.focus();

    press('ArrowRight');           // → বিজয়, whose answer is held
    await settle();
    press('ArrowRight');           // → ছায়া, answered at once
    await settle();
    assert.equal(selected()?.dataset.id, 's-chaya');

    s.release('s-bijoy');          // বিজয়'s answer lands last
    await settle();
    assert.equal(selected()?.dataset.id, 's-chaya', 'a stale answer put the previous child back');
    assert.match(text(root().querySelector('.ui-child-identity')), /ছায়া রহমান/);
    assert.equal(active(), selected());
    stop();
    view.destroy();
  });

  test('four or more: the picker button has a stable focus key, and focus comes back to it after choosing', async () => {
    const s = wardServer(KIDS);
    const stop = keepFocusWithin(root());
    const view = new GuardianView({ root: root(), doc: doc(), auth: s.auth('guardian') });
    live.push(view);
    await settle();
    const picker = root().querySelector<HTMLElement>('.ui-child-button')!;
    assert.equal(picker.getAttribute('data-focus-key'), 'ward-child-picker');
    picker.focus();
    picker.click();
    await settle();
    const rows = [...doc().querySelectorAll<HTMLElement>('.ui-child-row')];
    assert.equal(rows.length, 4);
    rows[2].click();
    await settle(30);
    const now = root().querySelector<HTMLElement>('.ui-child-button')!;
    assert.match(now.getAttribute('aria-label') ?? '', /ছায়া রহমান/);
    assert.equal(active(), now);
    stop();
    view.destroy();
  });
});
