/**
 * UX sweep — শিক্ষার্থী খুঁজুন (group students).
 *
 * 27 — the screen's core loop (search, filter, open, back) left keyboard and
 *      screen-reader users with focus on nothing and nothing read out. The
 *      shell's focus keeper (ui/dom.ts keepFocusWithin, armed on the view the
 *      same way here) already returns focus to the SAME control after a
 *      rebuild; opening a student and going back swap the whole screen, so
 *      the view says where focus goes, and a finished search is announced.
 * 36 — the profile's fee tab printed the server's raw figure ("৳ 14400.00")
 *      where every finance screen uses formatBdt, and a tab chosen near the
 *      right end of a sideways-scrolling strip fell back out of view when the
 *      record was rebuilt. A year's word and its amount ("জমা ৳ 13,200.00")
 *      are kept as one unit on the phone's line.
 * 27 (same loop) — a record that answered after the person went back, or
 *      after they opened someone else, redrew the screen: the wrong child's
 *      name took the focus meant for the right one, or the search box was
 *      rebuilt under the typing.
 * minor 14 — the search glyph button was named after the box, not the action.
 * minor 63 — the enrolment timeline printed the roll in Bangla digits; a
 *      roll is an identifier and stays Latin, as in the search result.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { keepFocusWithin } from '../src/ui/dom.ts';
import { closeAllOverlays } from '../src/ui/overlay.ts';
import { StudentsView } from '../src/students-view.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.location = dom.window.location;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  g.document = dom.window.document;
  g.CSS = dom.window.CSS;
});

let stopKeeper: (() => void) | null = null;
beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<nav><button id="outside" type="button">নোটিশ</button></nav><main id="root"></main>';
});
afterEach(() => { stopKeeper?.(); stopKeeper = null; });

const host = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;

/* ── fixtures ────────────────────────────────────────────────────────────── */

interface Stu { id: string; name: string; code: string }
const STUDENTS: Stu[] = [
  { id: 'aaaa-1', name: 'আরিফুল ইসলাম', code: 'STU-10000000' },
  { id: 'bbbb-2', name: 'রাফি হাসান', code: 'STU-10000001' },
  { id: 'cccc-3', name: 'নুসরাত জাহান', code: 'STU-10000002' },
];

function searchBody(o: { total?: number; offset?: number; list?: Stu[] } = {}) {
  const list = o.list ?? STUDENTS;
  return {
    total: o.total ?? list.length, limit: 20, offset: o.offset ?? 0, matchedOn: null,
    students: list.map((s) => ({
      id: s.id, name: { bn: s.name, en: null }, studentCode: s.code,
      lifecycleStatus: 'enrolled',
      latest: { yearLabel: '2026', classBn: 'অষ্টম শ্রেণি', groupBn: null, section: 'ক', rollNo: 30, isCurrent: true },
    })),
  };
}

function historyBody(s: Stu) {
  return {
    student: {
      id: s.id, name: { bn: s.name, en: null }, studentCode: s.code,
      lifecycleStatus: 'enrolled', admissionDate: '2024-01-05', graduatedOn: null,
      bloodGroup: null, fatherNameBn: null, motherNameBn: null, dateOfBirth: null,
      phone: null, boardRegistrationNo: null, boardRollNo: null,
    },
    enrolments: [
      { yearLabel: '2026', classBn: 'অষ্টম শ্রেণি', classEn: 'Eight', levelNo: 8, groupBn: '',
        section: 'ক', shift: 'day', rollNo: 30, status: 'active', enrolledOn: '2026-01-01',
        endedOn: null, isCurrent: true },
      { yearLabel: '2025', classBn: 'সপ্তম শ্রেণি', classEn: 'Seven', levelNo: 7, groupBn: '',
        section: 'খ', shift: 'day', rollNo: 4, status: 'promoted', enrolledOn: '2025-01-01',
        endedOn: '2025-12-31', isCurrent: false },
    ],
    attendance: [], results: [],
    fees: {
      years: [{ yearLabel: '2027', invoices: 12, billed: '14400.00', paid: '13200.00', due: '1200.00' }],
      receipts: [{ id: 'r1', receiptNo: 'RCP-0001', issuedAt: '2027-02-01', amount: '1300.00',
        method: 'cash', invoiceNo: 'INV-0001' }],
    },
    documents: ['fee_receipt'], certificates: [],
    permissions: { fees: true, contact: true },
  };
}

/** A history request that answers only when the test says so. */
interface Gate { release: (status?: number) => void }

/** Every history request, each held until the test releases that one. */
type Held = { id: string; release: (status?: number) => void }[];

function fakeAuth(o: {
  search?: (url: string) => unknown; searchStatus?: number; gate?: Gate; held?: Held;
} = {}) {
  let pending: ((status: number) => void) | null = null;
  if (o.gate) o.gate.release = (status = 200) => { pending?.(status); };
  return {
    authedFetch: async (url: string) => {
      if (url.includes('/students/search')) {
        await tick(2);
        const body = o.search ? o.search(url) : searchBody();
        return new Response(JSON.stringify(body), { status: o.searchStatus ?? 200 });
      }
      const id = new URL(url, 'http://x').searchParams.get('studentId');
      const s = STUDENTS.find((x) => x.id === id) ?? STUDENTS[0];
      const held = o.held;
      const status = held
        ? await new Promise<number>((r) => { held.push({ id: s.id, release: (st = 200) => r(st) }); })
        : o.gate
          ? await new Promise<number>((r) => { pending = r; })
          : (await tick(2), 200);
      return status === 200
        ? new Response(JSON.stringify(historyBody(s)), { status })
        : new Response(JSON.stringify({ error: 'boom' }), { status });
    },
  };
}

/** Mounted the way the shell mounts it: the view's root is the keeper's container. */
function mount(auth: ReturnType<typeof fakeAuth>): HTMLElement {
  const root = host();
  stopKeeper = keepFocusWithin(root);
  new StudentsView({ root, doc: doc(), auth: auth as never });
  return root;
}

async function searchFor(root: HTMLElement, text = 'আরিফ'): Promise<HTMLInputElement> {
  const input = root.querySelector<HTMLInputElement>('input.ui-search-input')!;
  input.focus();
  input.value = text;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.form!.requestSubmit();
  await tick(20);
  return input;
}

/** A row's open control in one shape: the table's tr or the list's li. */
const rowControl = (root: HTMLElement, id: string, cls: 'ui-row-open' | 'ui-list-hit') =>
  [...root.querySelectorAll<HTMLElement>('[data-key]')]
    .filter((r) => r.dataset.key === id)
    .map((r) => r.querySelector<HTMLButtonElement>(`button.${cls}`))
    .find(Boolean)!;

/* ── 27 ──────────────────────────────────────────────────────────────────── */

describe('27 — search, filter, open and back keep focus and say what happened', () => {
  test('central keeper covers this screen: Enter in the box keeps focus on the rebuilt box', async () => {
    const root = mount(fakeAuth());
    const old = root.querySelector('input.ui-search-input');
    await searchFor(root);
    assert.equal(root.querySelectorAll('.ui-row-open').length, 3, 'results are drawn');
    assert.notEqual(active(), old, 'the box was rebuilt');
    assert.equal(active(), root.querySelector('input.ui-search-input'),
      'focus is on the rebuilt search box, not on <body> or the page');
  });

  test('central keeper covers this screen: the search button and the status select', async () => {
    const root = mount(fakeAuth());
    await searchFor(root);
    const submit = root.querySelector<HTMLButtonElement>('.ui-search-submit')!;
    submit.focus();
    submit.click();
    await tick(20);
    assert.ok(active()?.classList.contains('ui-search-submit'),
      `focus returned to the search button (was ${active()?.tagName})`);

    const sel = root.querySelector<HTMLSelectElement>('select[name="status"]')!;
    sel.focus();
    sel.value = 'enrolled';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick(20);
    assert.equal(active()?.tagName, 'SELECT', 'focus returned to the status select');
    assert.equal((active() as HTMLSelectElement).value, 'enrolled');
  });

  test('a finished search is announced, with the page when there are more', async () => {
    const root = mount(fakeAuth());
    await searchFor(root);
    const said = () => [...doc().querySelectorAll('.ui-toast-host .ui-sr-only')]
      .map((n) => n.textContent ?? '');
    assert.deepEqual(said(), ['৩ জন শিক্ষার্থী পাওয়া গেছে']);
  });

  test('a paged answer names the page; an empty answer says nobody was found', async () => {
    let body: unknown = searchBody({ total: 784, offset: 20 });
    const root = mount(fakeAuth({ search: () => body }));
    await searchFor(root);
    const last = () => [...doc().querySelectorAll('.ui-toast-host .ui-sr-only')].at(-1)?.textContent;
    assert.equal(last(), '৭৮৪ জন শিক্ষার্থী পাওয়া গেছে, দেখানো হচ্ছে ৭৮৪টির মধ্যে ২১–২৩');

    body = searchBody({ list: [] });
    await searchFor(root, 'কেউ নেই');
    assert.equal(last(), 'কোনো শিক্ষার্থী পাওয়া যায়নি।');
  });

  test('opening a result by keyboard: the way back while it loads, then the student\'s name', async () => {
    const gate: Gate = { release: () => {} };
    const root = mount(fakeAuth({ gate }));
    await searchFor(root);
    const open = rowControl(root, 'bbbb-2', 'ui-row-open');
    open.focus();
    open.click();
    await tick();
    assert.ok(active()?.classList.contains('ui-back'),
      `while loading, focus is on ফলাফলে ফিরুন (was ${active()?.tagName}.${active()?.className})`);

    gate.release();
    await tick(10);
    const name = root.querySelector<HTMLElement>('#stu-record-name')!;
    assert.equal(name.tagName, 'H2', 'the page keeps its one h1; the student is the h2');
    assert.equal(name.getAttribute('tabindex'), '-1', 'focusable by script, not a Tab stop');
    assert.equal(active(), name, 'focus is on the opened student\'s name');
    assert.equal(root.querySelectorAll('h1').length, 1);
  });

  test('a record that fails to load leaves focus on the way back', async () => {
    const gate: Gate = { release: () => {} };
    const root = mount(fakeAuth({ gate }));
    await searchFor(root);
    const open = rowControl(root, 'aaaa-1', 'ui-row-open');
    open.focus();
    open.click();
    await tick();
    gate.release(500);
    await tick(10);
    assert.ok(root.querySelector('.ui-state-error'), 'the error card is drawn');
    assert.ok(active()?.classList.contains('ui-back'),
      `focus is on ফলাফলে ফিরুন (was ${active()?.tagName}.${active()?.className})`);
  });

  test('a refused search and a refused record are said aloud (their cards are notes, not alerts)', async () => {
    const said = () => [...doc().querySelectorAll('.ui-toast-host .ui-sr-only')]
      .map((n) => n.textContent ?? '');

    const refused = mount(fakeAuth({ searchStatus: 403, search: () => ({ error: 'forbidden' }) }));
    await searchFor(refused);
    const card = refused.querySelector('.ui-state-denied');
    assert.ok(card, 'the refusal card is drawn');
    const sentence = card.querySelector('.ui-state-msg, p, h2, h3')?.textContent
      ?? card.textContent ?? '';
    assert.ok(said().some((s) => s.length > 0 && sentence.includes(s)),
      `the refusal is announced (said: ${JSON.stringify(said())}, card: ${sentence})`);
    stopKeeper?.(); stopKeeper = null;

    doc().body.innerHTML = '<main id="root"></main>';
    const gate: Gate = { release: () => {} };
    const root = mount(fakeAuth({ gate }));
    await searchFor(root);
    const before = said().length;
    const open = rowControl(root, 'aaaa-1', 'ui-row-open');
    open.focus();
    open.click();
    await tick();
    gate.release(403);
    await tick(10);
    const denied = root.querySelector('.stu-record .ui-state-denied');
    assert.ok(denied, 'the record\'s refusal card is drawn');
    const now = said().slice(before);
    assert.equal(now.length, 1, `one announcement for the refusal (said: ${JSON.stringify(now)})`);
    assert.ok((denied.textContent ?? '').includes(now[0]), `${now[0]} is the card's sentence`);
    assert.ok(active()?.classList.contains('ui-back'), 'focus waits on ফলাফলে ফিরুন');
  });

  test('focus the person moved out of the screen while loading is not pulled back', async () => {
    const gate: Gate = { release: () => {} };
    const root = mount(fakeAuth({ gate }));
    await searchFor(root);
    const open = rowControl(root, 'bbbb-2', 'ui-row-open');
    open.focus();
    open.click();
    await tick();
    const outside = doc().getElementById('outside')!;
    outside.focus();
    gate.release();
    await tick(10);
    assert.ok(root.querySelector('#stu-record-name'), 'the record is drawn');
    assert.equal(active(), outside, 'focus stays where the person put it');
  });

  test('ফলাফলে ফিরুন returns focus to the result that was opened (desktop table)', async () => {
    const root = mount(fakeAuth());
    await searchFor(root);
    const open = rowControl(root, 'cccc-3', 'ui-row-open');
    open.focus();
    open.click();
    await tick(20);
    const back = root.querySelector<HTMLButtonElement>('.ui-back')!;
    back.focus();
    back.click();
    await tick();
    assert.ok(root.querySelector('.stu-search'), 'the results are back');
    assert.equal(active(), rowControl(root, 'cccc-3', 'ui-row-open'),
      `focus is on row 3's open button (was ${active()?.tagName}.${active()?.className})`);
  });

  test('ফলাফলে ফিরুন returns focus to the result that was opened (phone list)', async () => {
    const root = mount(fakeAuth());
    await searchFor(root);
    const hit = rowControl(root, 'bbbb-2', 'ui-list-hit');
    hit.focus();
    hit.click();
    await tick(20);
    const back = root.querySelector<HTMLButtonElement>('.ui-back')!;
    back.focus();
    back.click();
    await tick();
    assert.equal(active(), rowControl(root, 'bbbb-2', 'ui-list-hit'),
      `focus is on row 2 of the list (was ${active()?.tagName}.${active()?.className})`);
  });

  test('a filter chip, সব সরান and ছাঁকনি সরান remove themselves: focus goes to the status filter', async () => {
    let body: unknown = searchBody();
    const root = mount(fakeAuth({ search: () => body }));
    await searchFor(root);
    const status = () => root.querySelector<HTMLSelectElement>('.stu-filters select[name="status"]')!;
    const setStatus = async (v: string) => {
      const sel = status();
      sel.focus();
      sel.value = v;
      sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await tick(20);
    };

    for (const cls of ['ui-filter-chip', 'ui-filter-clear']) {
      await setStatus('enrolled');
      const btn = root.querySelector<HTMLButtonElement>(`.${cls}`)!;
      assert.ok(btn, `${cls} is drawn while a filter is on`);
      btn.focus();
      btn.click();
      await tick();
      assert.equal(active(), status(), `after ${cls}, focus is on the status select (was ${active()?.tagName}.${active()?.className})`);
      await tick(20);
      assert.equal(root.querySelector(`.${cls}`), null, `${cls} is gone`);
      assert.equal(active(), status(), `after ${cls} and the results, focus is still on the status select`);
    }

    body = searchBody({ list: [] });
    await setStatus('alumni');
    const clear = [...root.querySelectorAll<HTMLButtonElement>('.ui-state button')]
      .find((b) => b.textContent === 'ছাঁকনি সরান')!;
    assert.ok(clear, 'the empty state offers ছাঁকনি সরান');
    clear.focus();
    clear.click();
    await tick(20);
    assert.equal(status().value, '');
    assert.equal(active(), status(), `after ছাঁকনি সরান, focus is on the status select (was ${active()?.tagName}.${active()?.className})`);
  });

  test('a record left with ফলাফলে ফিরুন before it arrives does not redraw the search under the person', async () => {
    const held: Held = [];
    const root = mount(fakeAuth({ held }));
    await searchFor(root);
    const open = rowControl(root, 'aaaa-1', 'ui-row-open');
    open.focus();
    open.click();
    await tick();
    assert.equal(held.length, 1, 'the record is on its way');
    const back = root.querySelector<HTMLButtonElement>('.ui-back')!;
    back.focus();
    back.click();
    await tick();
    assert.equal(active(), rowControl(root, 'aaaa-1', 'ui-row-open'), 'back on the result');

    // The person starts typing a new search; the old record then arrives.
    const input = root.querySelector<HTMLInputElement>('input.ui-search-input')!;
    input.focus();
    input.value = 'নুস';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    held[0].release();
    await tick(10);
    assert.equal(root.querySelector('#stu-record-name'), null, 'the left record is not drawn');
    assert.equal(root.querySelector('input.ui-search-input'), input,
      'the search box was not rebuilt under the typing');
    assert.equal(active(), input);
    assert.equal(input.value, 'নুস');
  });

  test('opening another student before the first answers: only the second is drawn and focused', async () => {
    const held: Held = [];
    const root = mount(fakeAuth({ held }));
    await searchFor(root);
    const first = rowControl(root, 'aaaa-1', 'ui-row-open');
    first.focus();
    first.click();
    await tick();
    const back = root.querySelector<HTMLButtonElement>('.ui-back')!;
    back.focus();
    back.click();
    await tick();
    const second = rowControl(root, 'bbbb-2', 'ui-row-open');
    second.focus();
    second.click();
    await tick();
    assert.deepEqual(held.map((h) => h.id), ['aaaa-1', 'bbbb-2']);

    held[0].release();
    await tick(10);
    assert.equal(root.querySelector('#stu-record-name'), null,
      'আরিফুল ইসলাম\'s late answer is not drawn as রাফি হাসান\'s record');
    assert.ok(active()?.classList.contains('ui-back'),
      `still loading: focus waits on ফলাফলে ফিরুন (was ${active()?.tagName}.${active()?.className})`);

    held[1].release();
    await tick(10);
    const name = root.querySelector<HTMLElement>('#stu-record-name')!;
    assert.equal(name.textContent, 'রাফি হাসান');
    assert.equal(active(), name, 'focus is on the student that was opened');
  });

  test('আগে / পরে: focus stays on the pager, on the other button when the pressed one ends disabled', async () => {
    const offsetOf = (url: string) => Number(new URL(url, 'http://x').searchParams.get('offset') ?? 0);
    const root = mount(fakeAuth({ search: (url) => searchBody({ total: 43, offset: offsetOf(url) }) }));
    await searchFor(root);
    const btn = (label: string) =>
      root.querySelector<HTMLButtonElement>(`.ui-page-btn[aria-label="${label}"]`)!;

    btn('পরের পাতা').focus();
    btn('পরের পাতা').click();
    await tick(20);
    assert.match(root.querySelector('.ui-page-pos')!.textContent ?? '', /২১–২৩/);
    assert.equal(active(), btn('পরের পাতা'), `page 2: focus on পরে (was ${active()?.tagName}.${active()?.className})`);

    btn('পরের পাতা').click();
    await tick(20);
    assert.match(root.querySelector('.ui-page-pos')!.textContent ?? '', /৪১–৪৩/);
    assert.equal(btn('পরের পাতা').disabled, true, 'the last page: পরে is disabled');
    assert.equal(active(), btn('আগের পাতা'),
      `the last page: focus on আগে, not waiting on the page (was ${active()?.tagName}.${active()?.className})`);
  });

  test('আগে / পরে: someone who moved to the search box while the page loaded keeps their place', async () => {
    const offsetOf = (url: string) => Number(new URL(url, 'http://x').searchParams.get('offset') ?? 0);
    const root = mount(fakeAuth({ search: (url) => searchBody({ total: 43, offset: offsetOf(url) }) }));
    await searchFor(root);
    const next = root.querySelector<HTMLButtonElement>('.ui-page-btn[aria-label="পরের পাতা"]')!;
    next.focus();
    next.click();
    root.querySelector<HTMLInputElement>('input.ui-search-input')!.focus();
    await tick(20);
    assert.ok(active()?.matches('input.ui-search-input'),
      `focus stays in the search box (was ${active()?.tagName}.${active()?.className})`);
  });

  test('a tab switch inside the record still keeps focus on the tab', async () => {
    const root = mount(fakeAuth());
    await searchFor(root);
    const open = rowControl(root, 'aaaa-1', 'ui-row-open');
    open.focus();
    open.click();
    await tick(20);
    const tab = doc().getElementById('tab-profile')!;
    tab.focus();
    tab.click();
    await tick();
    assert.equal(active(), doc().getElementById('tab-profile'));
    assert.equal(active()?.getAttribute('aria-selected'), 'true');
  });
});

/* ── minor 14 ────────────────────────────────────────────────────────────── */

describe('minor 14 — the search button is named for what it does', () => {
  test('the glyph button says খুঁজুন; the box keeps its description', () => {
    const root = mount(fakeAuth());
    const submit = root.querySelector('.ui-search-submit')!;
    assert.equal(submit.getAttribute('aria-label'), 'খুঁজুন');
    const input = root.querySelector('input.ui-search-input')!;
    const label = root.querySelector(`label[for="${input.id}"]`)!;
    assert.equal(label.textContent, 'আইডি, নাম, মোবাইল বা রেজিস্ট্রেশন নম্বর');
  });
});

/* ── 36 and minor 63 ─────────────────────────────────────────────────────── */

async function openRecord(root: HTMLElement, id = 'bbbb-2'): Promise<void> {
  await searchFor(root, 'রাফি');
  const open = rowControl(root, id, 'ui-row-open');
  open.focus();
  open.click();
  await tick(20);
}

describe('36 — the profile\'s fee tab and tab strip', () => {
  test('every amount goes through formatBdt, one unbreakable figure each', async () => {
    const root = mount(fakeAuth());
    await openRecord(root);
    const tab = doc().getElementById('tab-fees')!;
    tab.click();
    await tick();
    const panel = root.querySelector('.stu-panel')!;
    const text = panel.textContent ?? '';
    for (const figure of ['৳ 14,400.00', '৳ 13,200.00', '৳ 1,200.00', '৳ 1,300.00']) {
      assert.ok(text.includes(figure), `${figure} is shown`);
    }
    assert.doesNotMatch(text, /৳ \d{4,}\./, 'no amount without its thousands separator');
    const money = [...panel.querySelectorAll('.stu-money')].map((n) => n.textContent);
    // billed, paid, due and the receipt — in the table and the list alike
    assert.equal(money.length, 8);
    assert.ok(money.every((m) => /^৳ [\d,]+\.\d{2}$/.test(m ?? '')), money.join(' | '));
  });

  test('a year\'s word and its amount are one unit on the line ("জমা ৳ 13,200.00")', async () => {
    const root = mount(fakeAuth());
    await openRecord(root);
    doc().getElementById('tab-fees')!.click();
    await tick();
    const years = root.querySelector('.stu-fees')!;
    const figures = [...years.querySelectorAll('.stu-money')];
    // billed, paid and due, in the table and the phone list
    assert.equal(figures.length, 6);
    const pairs = figures.map((m) => m.closest('.stu-pair')?.textContent ?? '(no pair)');
    assert.deepEqual([...pairs].sort(), [
      'বিল ৳ 14,400.00', 'জমা ৳ 13,200.00', 'বকেয়া ৳ 1,200.00',
      'বিল ৳ 14,400.00', 'জমা ৳ 13,200.00', 'বকেয়া ৳ 1,200.00',
    ].sort());
    for (const m of figures) {
      const pair = m.closest('.stu-pair')!;
      assert.ok(pair.querySelector('.stu-cell-word'), 'the word sits inside the same pair');
    }
  });

  test('a tab chosen past the strip\'s right edge is scrolled into view after the rebuild', async () => {
    const root = mount(fakeAuth());
    await openRecord(root);

    // The sweep's numbers at 375: strip 21..354 (client 333, scroll 423), ফি at 344..389.
    const P = dom.window.HTMLElement.prototype;
    const saved = {
      sw: Object.getOwnPropertyDescriptor(P, 'scrollWidth') ?? Object.getOwnPropertyDescriptor(dom.window.Element.prototype, 'scrollWidth'),
      cw: Object.getOwnPropertyDescriptor(P, 'clientWidth') ?? Object.getOwnPropertyDescriptor(dom.window.Element.prototype, 'clientWidth'),
      sl: Object.getOwnPropertyDescriptor(P, 'scrollLeft') ?? Object.getOwnPropertyDescriptor(dom.window.Element.prototype, 'scrollLeft'),
      rect: P.getBoundingClientRect,
    };
    const left = new WeakMap<Element, number>();
    const isStrip = (e: Element) => e.classList.contains('stu-tabs');
    Object.defineProperty(P, 'scrollWidth', { configurable: true, get() { return isStrip(this) ? 423 : 0; } });
    Object.defineProperty(P, 'clientWidth', { configurable: true, get() { return isStrip(this) ? 333 : 0; } });
    Object.defineProperty(P, 'scrollLeft', {
      configurable: true,
      get() { return left.get(this) ?? 0; },
      set(v: number) { left.set(this, v); },
    });
    const TABS: Record<string, [number, number]> = {
      'tab-profile': [21, 90], 'tab-enrolments': [90, 190], 'tab-attendance': [190, 267],
      'tab-results': [267, 344], 'tab-fees': [344, 389], 'tab-documents': [389, 440],
    };
    const rect = (l: number, r: number) =>
      ({ left: l, right: r, top: 0, bottom: 44, width: r - l, height: 44, x: l, y: 0, toJSON() {} }) as DOMRect;
    P.getBoundingClientRect = function (this: HTMLElement) {
      // The strip's own box stays put; its tabs move left as it scrolls.
      if (isStrip(this)) return rect(21, 354);
      const strip = this.closest('.stu-tabs');
      const shift = strip ? (left.get(strip) ?? 0) : 0;
      const [l, r] = TABS[this.id] ?? [0, 0];
      return rect(l - shift, r - shift);
    };
    try {
      const fees = doc().getElementById('tab-fees')!;
      fees.focus();
      fees.click();
      await tick();
      const strip = root.querySelector<HTMLElement>('.stu-tabs')!;
      const tab = doc().getElementById('tab-fees')!;
      assert.equal(tab.getAttribute('aria-selected'), 'true');
      const s = strip.getBoundingClientRect();
      const t = tab.getBoundingClientRect();
      assert.ok(strip.scrollLeft > 0, 'the rebuilt strip scrolled');
      assert.ok(t.left >= s.left && t.right <= s.right,
        `ফি is wholly inside the strip (tab ${t.left}..${t.right}, strip ${s.left}..${s.right})`);
      assert.equal(active(), tab, 'focus is still on the chosen tab');
    } finally {
      for (const [k, d] of [['scrollWidth', saved.sw], ['clientWidth', saved.cw], ['scrollLeft', saved.sl]] as const) {
        if (d) Object.defineProperty(P, k, d); else delete (P as unknown as Record<string, unknown>)[k];
      }
      P.getBoundingClientRect = saved.rect;
    }
  });

  test('a strip that fits is not scrolled', async () => {
    const root = mount(fakeAuth());
    await openRecord(root);
    const fees = doc().getElementById('tab-fees')!;
    fees.click();
    await tick();
    assert.equal(root.querySelector<HTMLElement>('.stu-tabs')!.scrollLeft, 0);
  });
});

describe('minor 63 — a roll is an identifier and stays Latin in the enrolment history', () => {
  test('the timeline reads রোল 30 and রোল 4, not Bangla digits', async () => {
    const root = mount(fakeAuth());
    await openRecord(root);
    const titles = [...root.querySelectorAll('.ui-timeline-title')].map((n) => n.textContent ?? '');
    assert.equal(titles.length, 2);
    assert.ok(titles[0].includes('রোল 30'), titles[0]);
    assert.ok(titles[1].includes('রোল 4'), titles[1]);
    assert.ok(titles.every((t) => !/রোল [০-৯]/.test(t)), titles.join(' | '));
  });
});
