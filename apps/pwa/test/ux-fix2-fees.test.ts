/**
 * UX sweep, round 2 — the fee screen (group fees, src/fees-view.ts).
 *
 *   37 (#/fees half) — "সব ইনভয়েস দেখুন" in the office filter's empty state
 *        removed the focused button with the rows it swapped out. Focus fell to
 *        <body> and the shell's keeper parked it on main#shell-view, with no
 *        ring anywhere. setFilter now puts focus on the chip it pressed.
 *   18 (remainder) — the guardian's panel said "১টি বিল সময় পেরিয়েছে" and the
 *        fee screen, a tap later, called the same bill বকেয়া. Nothing on the
 *        server writes the `overdue` status, so a bill past its date must be
 *        read as overdue from the date, by the panel's own rule.
 *   18 (review) — with that, a part-paid late bill's family phone row read
 *        "৳ 1,250.00 · মেয়াদোত্তীর্ণ": its total beside the red word, the rows
 *        adding up to more than the hero, the payment nowhere on the row. The
 *        family row's figure is now what the bill still owes, "বাকি ৳ 250.00".
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { todayLocalIso } from '../../../packages/ui-core/src/format.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// Imported after the globals exist (demo.ts reads location and localStorage).
let FeesView: typeof import('../src/fees-view.ts').FeesView;
let keepFocusWithin: typeof import('../src/ui/dom.ts').keepFocusWithin;
let focusIsLost: typeof import('../src/ui/dom.ts').focusIsLost;
let closeAllOverlays: typeof import('../src/ui/overlay.ts').closeAllOverlays;
let DemoAuth: typeof import('../src/demo.ts').DemoAuth;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
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
  ({ keepFocusWithin, focusIsLost } = await import('../src/ui/dom.ts'));
  ({ closeAllOverlays } = await import('../src/ui/overlay.ts'));
  ({ DemoAuth } = await import('../src/demo.ts'));
});

const live: Array<{ destroy(): void }> = [];
const stops: Array<() => void> = [];
afterEach(() => {
  for (const v of live.splice(0)) v.destroy();
  for (const s of stops.splice(0)) s();
});

beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<main id="root"></main>';
  localStorage.clear();
});

const root = () => doc().getElementById('root') as HTMLElement;
const text = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();

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
  studentId?: string; period?: string; dueOn: string; balance: string; status?: string;
}): Json {
  const period = o.period ?? '2026-08';
  return {
    id, invoiceNo: `INV-${period}-${id}`, studentId: o.studentId, billingPeriod: period,
    issuedOn: `${period}-01`, dueOn: o.dueOn,
    totalAmount: '1250.00', paidAmount: (1250 - Number(o.balance)).toFixed(2),
    balanceAmount: o.balance, status: o.status ?? 'issued',
    lines: [{ descriptionBn: 'মাসিক বেতন', amount: '1250.00', waiverAmount: '0.00', netAmount: '1250.00' }],
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

/* ── 37 ───────────────────────────────────────────────────────────────── */

describe('37 — the office filter keeps focus on a control after the rows are swapped', () => {
  // No part-paid bill, so আংশিক shows the empty state and its action.
  const BILLS = [
    invoice('i1', { dueOn: day(10), balance: '1250.00' }),
    invoice('i2', { period: '2026-07', dueOn: day(-40), balance: '0.00', status: 'paid' }),
  ];
  const chip = (id: string) => root().querySelector<HTMLButtonElement>(`.fees-filter-opt[data-filter="${id}"]`)!;
  const emptyAction = () => [...root().querySelectorAll<HTMLButtonElement>('.fees-sheet .ui-state-action')]
    .find((b) => text(b) === 'সব ইনভয়েস দেখুন');

  async function toPartialEmpty(): Promise<HTMLButtonElement> {
    mount('accountant', BILLS);
    await settle();
    chip('partial').focus();
    chip('partial').click();
    await settle();
    const action = emptyAction();
    assert.ok(action, 'আংশিক shows the empty state with its action');
    return action;
  }

  test('"সব ইনভয়েস দেখুন" puts focus on the সব chip, with the shell’s keeper armed', async () => {
    stops.push(keepFocusWithin(root()));
    const action = await toPartialEmpty();
    action.focus();
    assert.equal(doc().activeElement, action);
    action.click();
    await settle();

    const all = chip('all');
    assert.equal(all.getAttribute('aria-pressed'), 'true');
    assert.equal(doc().activeElement, all,
      `focus is on ${doc().activeElement?.tagName}#${(doc().activeElement as HTMLElement)?.id} — not the chosen chip`);
    assert.equal(focusIsLost(doc()), false, 'focus parked on the view counts as lost');
    // The rows really were swapped: the action is gone, the invoices are back.
    assert.equal(emptyAction(), undefined);
    assert.equal(action.isConnected, false);
    assert.ok(root().querySelector('.fees-sheet .ui-list-item'));
  });

  test('the same without a keeper: focus is on the chip, not on <body>', async () => {
    const action = await toPartialEmpty();
    action.focus();
    action.click();
    await settle();
    assert.equal(doc().activeElement, chip('all'));
  });

  test('pressing a chip leaves focus on that chip', async () => {
    stops.push(keepFocusWithin(root()));
    mount('accountant', BILLS);
    await settle();
    chip('paid').focus();
    chip('paid').click();
    await settle();
    assert.equal(chip('paid').getAttribute('aria-pressed'), 'true');
    assert.equal(doc().activeElement, chip('paid'));
  });

  test('a filter change does not pull focus from a control outside the sheet', async () => {
    mount('accountant', BILLS);
    await settle();
    const outside = doc().createElement('button');
    outside.textContent = 'বাইরে';
    doc().body.append(outside);
    outside.focus();
    chip('paid').click();
    await settle();
    assert.equal(chip('paid').getAttribute('aria-pressed'), 'true');
    assert.equal(doc().activeElement, outside);
  });
});

/* ── 18 ───────────────────────────────────────────────────────────────── */

describe('18 — a bill past its due date reads as overdue, as the guardian panel says', () => {
  /** Status badges in the phone list (the table repeats them for the desk). */
  const listBadges = (scope: ParentNode = root()) =>
    [...scope.querySelectorAll('.ui-list .fees-status .ui-status')] as HTMLElement[];

  test('an unpaid bill past its date: মেয়াদোত্তীর্ণ, danger, with a glyph — not বকেয়া', async () => {
    mount('student', [invoice('late', { dueOn: day(-5), balance: '1250.00' })]);
    await settle();
    const [b] = listBadges();
    assert.equal(text(b), 'মেয়াদোত্তীর্ণ');
    assert.equal(b.dataset.tone, 'danger');
    assert.ok(b.querySelector('.ui-badge-glyph'), 'trouble carries a glyph, not colour alone');
    // The desk table says the same word.
    assert.equal(text(root().querySelector('.ui-table .fees-status .ui-status')), 'মেয়াদোত্তীর্ণ');
  });

  test('a part-paid bill past its date is overdue too; bills not yet due, paid or waived are not', async () => {
    mount('student', [
      invoice('part-late', { period: '2026-06', dueOn: day(-20), balance: '250.00', status: 'partly_paid' }),
      invoice('due-ahead', { period: '2026-09', dueOn: day(7), balance: '1250.00' }),
      invoice('due-today', { period: '2026-10', dueOn: day(0), balance: '1250.00' }),
      invoice('part-ahead', { period: '2026-11', dueOn: day(9), balance: '250.00', status: 'partly_paid' }),
      invoice('paid-late', { period: '2026-05', dueOn: day(-60), balance: '0.00', status: 'paid' }),
      invoice('waived-late', { period: '2026-04', dueOn: day(-90), balance: '1250.00', status: 'waived' }),
    ]);
    await settle();
    const words = Object.fromEntries([...root().querySelectorAll('.ui-list .ui-list-item')]
      .map((li) => [(li as HTMLElement).dataset.key, text(li.querySelector('.fees-status .ui-status'))]));
    assert.deepEqual(words, {
      'part-late': 'মেয়াদোত্তীর্ণ',
      'due-ahead': 'বকেয়া',
      // Due today is not yet late: the panel counts `due_on < today`.
      'due-today': 'বকেয়া',
      'part-ahead': 'আংশিক পরিশোধিত',
      'paid-late': 'পরিশোধিত',
      'waived-late': 'মওকুফ',
    });
  });

  test('the hero says how many bills are late, in the panel’s own sentence', async () => {
    mount('student', [
      invoice('late', { dueOn: day(-5), balance: '1250.00' }),
      invoice('ahead', { period: '2026-09', dueOn: day(12), balance: '1250.00' }),
    ]);
    await settle();
    const note = root().querySelector('.fees-due-note');
    assert.equal(text(note), '১টি বিল সময় পেরিয়েছে');
    assert.equal(note?.querySelector('.n')?.textContent, '১', 'the count is in the numeral face (R6)');
  });

  test('nothing late: the hero keeps the next due date', async () => {
    mount('student', [invoice('ahead', { dueOn: day(12), balance: '1250.00' })]);
    await settle();
    const note = text(root().querySelector('.fees-due-note'));
    assert.match(note, /^শেষ তারিখ /);
    assert.doesNotMatch(note, /পেরিয়েছে/);
    assert.equal(text(root().querySelector('.ui-list .fees-status .ui-status')), 'বকেয়া');
  });

  test('the drawer’s due date says the date has gone', async () => {
    mount('student', [
      invoice('late', { dueOn: day(-5), balance: '1250.00' }),
      invoice('ahead', { period: '2026-09', dueOn: day(12), balance: '1250.00' }),
    ]);
    await settle();
    const open = (key: string) => root()
      .querySelector<HTMLElement>(`.ui-list .ui-list-item[data-key="${key}"] .ui-list-hit`)!.click();
    const dueFact = () => {
      const keys = [...doc().querySelectorAll('.ui-scrim .ui-facts .ui-facts-key')];
      return text(keys.find((k) => text(k) === 'শেষ তারিখ')?.nextElementSibling);
    };

    open('late');
    await settle();
    assert.match(dueFact(), / · সময় পেরিয়েছে$/);
    closeAllOverlays();
    await settle();

    open('ahead');
    await settle();
    assert.doesNotMatch(dueFact(), /পেরিয়েছে/);
  });

  test('a guardian of two: the late child’s row says so, the other child’s does not', async () => {
    const ANIKA = { studentId: 's-anika', nameBn: 'আনিকা রহমান', sectionLabel: 'নবম–ক' };
    const BIJOY = { studentId: 's-bijoy', nameBn: 'বিজয় রহমান', sectionLabel: 'ষষ্ঠ–খ' };
    mount('guardian', [
      invoice('a8', { studentId: 's-anika', dueOn: day(-5), balance: '1250.00' }),
      invoice('b8', { studentId: 's-bijoy', dueOn: day(5), balance: '1250.00' }),
    ], [ANIKA, BIJOY]);
    await settle();
    const kids = [...root().querySelectorAll('.fees-kids .ui-list-item')].map(text);
    assert.equal(kids.length, 2);
    assert.match(kids[0], /আনিকা রহমান.*নবম–ক · ১টি বিল সময় পেরিয়েছে.*৳ 1,250\.00/);
    assert.match(kids[1], /বিজয় রহমান.*ষষ্ঠ–খ.*৳ 1,250\.00/);
    assert.doesNotMatch(kids[1], /পেরিয়েছে/);
  });

  test('the accountant’s desk reads the same bill the same way, and বকেয়া still lists it', async () => {
    mount('accountant', [
      invoice('late', { dueOn: day(-5), balance: '1250.00' }),
      invoice('ahead', { period: '2026-09', dueOn: day(5), balance: '1250.00' }),
    ]);
    await settle();
    const words = [...root().querySelectorAll('.ui-list .ui-list-item')]
      .map((li) => [(li as HTMLElement).dataset.key, text(li.querySelector('.fees-status .ui-status'))]);
    assert.deepEqual(Object.fromEntries(words), { late: 'মেয়াদোত্তীর্ণ', ahead: 'বকেয়া' });
  });

  test('in the demo, each child’s late bills on the fee screen are the count on that child’s panel', async () => {
    // The two screens a guardian moves between, fed by the same in-page API.
    localStorage.setItem('shikhon_demo_role', 'guardian');
    const demo = new DemoAuth();
    const view = new FeesView({ root: root(), doc: doc(), auth: demo as never });
    live.push(view);
    await settle(40);
    const wards = (await (await demo.authedFetch('/api/v1/academics/ward')).json()) as {
      wards: Array<{ studentId: string; nameBn: string }>;
    };
    assert.ok(wards.wards.length >= 2, 'the demo guardian has two children');
    const heads = [...root().querySelectorAll('.fees-kid-head')];
    for (const w of wards.wards) {
      const home = (await (await demo.authedFetch(
        `/api/v1/academics/ward?studentId=${encodeURIComponent(w.studentId)}`)).json()) as {
        student: { fees: { overdueCount: number } | null };
      };
      const head = heads.find((h) => text(h).startsWith(w.nameBn));
      assert.ok(head, `${w.nameBn} has a heading on the fee screen`);
      const late = listBadges(head.nextElementSibling as Element)
        .filter((b) => text(b) === 'মেয়াদোত্তীর্ণ').length;
      assert.equal(late, home.student.fees?.overdueCount ?? 0,
        `${w.nameBn}: the panel counts ${home.student.fees?.overdueCount}, the fee screen marks ${late}`);
    }
  });
});

/* ── 18, review: a part-paid late bill must not hide its payment ─────── */

describe('18 (review) — a part-paid bill past its date keeps its payment on the family phone', () => {
  /** What the eye sees in a node: the other rendering's twin removed. */
  function shown(node: Element | null | undefined, hide: string): string {
    if (!node) return '';
    const c = node.cloneNode(true) as Element;
    for (const x of c.querySelectorAll(hide)) x.remove();
    return text(c);
  }
  /** Each family phone row: its amount slot and its status word, as seen. */
  const phone = (scope: ParentNode = root()) =>
    Object.fromEntries([...scope.querySelectorAll('.ui-list-item')]
      // Not the children's due rows (.fees-kids): the invoice rows only.
      .filter((li) => li.closest('.fees-sheet > .ui-data > .ui-list')).map((li) => {
      const [amount, status] = [...li.querySelectorAll(':scope > .ui-list-hit > .ui-list-status')];
      return [(li as HTMLElement).dataset.key, {
        amount: shown(amount, '.fees-table-only'),
        word: text(status?.querySelector('.ui-status')),
      }];
    }));
  /** "৳ 1,250.00" → paisa. */
  const toPaisa = (s: string) => {
    const m = /৳\s*([\d,]+\.\d{2})/.exec(s);
    assert.ok(m, `a money figure in "${s}"`);
    return Math.round(Number(m[1].replace(/,/g, '')) * 100);
  };
  const OWING = new Set(['বকেয়া', 'মেয়াদোত্তীর্ণ', 'আংশিক পরিশোধিত']);

  // The reviewer's case: June ৳ 1,250.00 with ৳ 1,000.00 paid, its date gone;
  // September not yet due; July paid.
  const BILLS = [
    invoice('jun', { period: '2026-06', dueOn: day(-20), balance: '250.00', status: 'partly_paid' }),
    invoice('sep', { period: '2026-09', dueOn: day(8), balance: '1250.00' }),
    invoice('jul', { period: '2026-07', dueOn: day(-50), balance: '0.00', status: 'paid' }),
  ];

  test('the late part-paid row reads "বাকি ৳ 250.00 · মেয়াদোত্তীর্ণ", not its total', async () => {
    mount('student', BILLS);
    await settle();
    const rows = phone();
    assert.deepEqual(rows.jun, { amount: 'বাকি ৳ 250.00', word: 'মেয়াদোত্তীর্ণ' });
    // Bills with nothing paid, or nothing owed, keep the bill's total.
    assert.deepEqual(rows.sep, { amount: '৳ 1,250.00', word: 'বকেয়া' });
    assert.equal(rows.jul.amount, '৳ 1,250.00');
    // The figure is in the numeral face; the word is not part of the figure.
    const slot = root().querySelector('.ui-list-item[data-key="jun"] .fees-left')!;
    assert.equal(slot.querySelector('.fees-amount.n')?.textContent, '৳ 250.00');
    assert.equal(slot.querySelector('.fees-left-word')?.textContent?.trim(), 'বাকি');
  });

  test('every owing row’s figure adds up to the hero’s এখন বকেয়া', async () => {
    mount('student', BILLS);
    await settle();
    const hero = toPaisa(text(root().querySelector('.fees-due-amount')));
    assert.equal(hero, 150000);
    const owed = Object.values(phone()).filter((r) => OWING.has(r.word))
      .reduce((s, r) => s + toPaisa(r.amount), 0);
    assert.equal(owed, hero, `the rows add up to ${owed / 100}, the hero says ${hero / 100}`);
  });

  test('a part-paid bill not yet due says বাকি too, under its আংশিক পরিশোধিত badge', async () => {
    mount('student', [
      invoice('nov', { period: '2026-11', dueOn: day(9), balance: '400.00', status: 'partly_paid' }),
    ]);
    await settle();
    assert.deepEqual(phone().nov, { amount: 'বাকি ৳ 400.00', word: 'আংশিক পরিশোধিত' });
    assert.equal(toPaisa(text(root().querySelector('.fees-due-amount'))), 40000);
  });

  test('the desk table keeps the total under মোট, beside জমা and বকেয়া', async () => {
    mount('student', BILLS);
    await settle();
    const tr = root().querySelector('.ui-table tr[data-key="jun"]')!;
    const cell = (col: string) => shown(tr.querySelector(`[data-col="${col}"]`), '.fees-list-only');
    assert.equal(cell('total'), '৳ 1,250.00');
    assert.equal(cell('paid'), '৳ 1,000.00');
    assert.equal(cell('balance'), '৳ 250.00');
    // Round 3 (ux-fix3-fees): the late part-paid bill's status keeps the word
    // আংশিক পরিশোধিত beside its মেয়াদোত্তীর্ণ badge.
    assert.equal(text(tr.querySelector('[data-col="status"] .ui-status')), 'মেয়াদোত্তীর্ণ');
    assert.equal(cell('status'), 'মেয়াদোত্তীর্ণ, আংশিক পরিশোধিত');
  });

  test('a guardian of two: each child’s rows add up to that child’s due row, and all to the hero', async () => {
    const ANIKA = { studentId: 's-anika', nameBn: 'আনিকা রহমান', sectionLabel: 'নবম–ক' };
    const BIJOY = { studentId: 's-bijoy', nameBn: 'বিজয় রহমান', sectionLabel: 'ষষ্ঠ–খ' };
    mount('guardian', [
      invoice('a6', { studentId: 's-anika', period: '2026-06', dueOn: day(-20), balance: '250.00', status: 'partly_paid' }),
      invoice('a9', { studentId: 's-anika', period: '2026-09', dueOn: day(8), balance: '1250.00' }),
      invoice('b7', { studentId: 's-bijoy', period: '2026-07', dueOn: day(-50), balance: '600.00', status: 'partly_paid' }),
      invoice('b8', { studentId: 's-bijoy', period: '2026-08', dueOn: day(-50), balance: '0.00', status: 'paid' }),
    ], [ANIKA, BIJOY]);
    await settle();
    const kidRows = [...root().querySelectorAll('.fees-kids .ui-list-item')];
    const heads = [...root().querySelectorAll('.fees-kid-head')];
    let all = 0;
    for (const [i, name] of ['আনিকা রহমান', 'বিজয় রহমান'].entries()) {
      const head = heads.find((h) => text(h).startsWith(name))!;
      const rows = Object.values(phone(head.nextElementSibling as Element)).filter((r) => OWING.has(r.word));
      const sum = rows.reduce((s, r) => s + toPaisa(r.amount), 0);
      const due = toPaisa(text(kidRows[i].querySelector('.fees-kid-owed')));
      assert.equal(sum, due, `${name}: rows add up to ${sum / 100}, the due row says ${due / 100}`);
      all += sum;
    }
    assert.equal(all, toPaisa(text(root().querySelector('.fees-due-amount'))));
    assert.equal(phone(heads[1].nextElementSibling as Element).b7.amount, 'বাকি ৳ 600.00');
  });

  test('the office layout is unchanged: no বাকি in its rows, the balance on its own line', async () => {
    mount('accountant', BILLS);
    await settle();
    assert.equal(root().querySelector('.fees-left'), null);
    const li = root().querySelector('.ui-list-item[data-key="jun"]')!;
    assert.equal(text(li.querySelector('.fees-balance')), '৳ 250.00');
  });
});
