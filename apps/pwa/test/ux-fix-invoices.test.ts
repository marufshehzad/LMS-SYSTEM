/**
 * UX sweep — ইনভয়েস তৈরি and its payment sheet (group invoices).
 *
 * Each block names the confirmed finding it closes:
 *
 *   28  an amount typed in Bangla digits (or "1,250") was sent as null
 *   30  the billing run's result was drawn above the viewport, focus on <body>
 *   31  the payment sheet's failed load and its receipt number, both off-screen
 *   34  the phone list's two money figures had no visible words
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { InvoiceView } from '../src/invoice-view.ts';
import { closeAllOverlays } from '../src/ui/overlay.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;
/** Enough macrotask turns for a fetch, a reload and their renders to land. */
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'https://school.example/app' });
  const g = globalThis as Record<string, unknown>;
  for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLButtonElement',
    'HTMLFormElement', 'KeyboardEvent', 'Event', 'Node'] as const) {
    g[k] = (dom.window as unknown as Record<string, unknown>)[k];
  }
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: dom.window.location, configurable: true });
});

beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<div id="shell-view"><main id="root"></main></div>';
});

type Reply = { status?: number; body?: unknown } | 'throw';
type Route = Reply | ((init?: RequestInit) => Reply | Promise<Reply>);

/** An Auth stand-in whose routes may answer late, fail, or answer per method. */
function fakeAuth(routes: Record<string, Route>) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  return {
    calls,
    role: 'accountant',
    tenantId: 't1',
    authedFetch: async (path: string, init?: RequestInit) => {
      calls.push({
        path, method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const key = Object.keys(routes)
        .filter((k) => path.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
      const route = key ? routes[key] : { status: 404, body: { error: 'not_found' } };
      const reply = typeof route === 'function' ? await route(init) : route;
      if (reply === 'throw') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

/** A promise the test resolves when it chooses. */
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const DUE = {
  id: 'inv-1', invoiceNo: 'INV-2026-08-00001', billingPeriod: '2026-08',
  totalAmount: '1500.00', balanceAmount: '900.00', status: 'partial',
};
const PAID = {
  id: 'inv-2', invoiceNo: 'INV-2026-08-00002', billingPeriod: '2026-08',
  totalAmount: '750.00', balanceAmount: '0.00', status: 'paid',
};
const BILL = {
  invoice: { invoiceNo: DUE.invoiceNo, studentBn: 'রাফি আহমেদ', balanceAmount: 900, totalAmount: 1500 },
  methods: [{ code: 'cash', labelBn: 'নগদ' }, { code: 'bkash', labelBn: 'বিকাশ' }],
  receipts: [],
};

function mount(auth: ReturnType<typeof fakeAuth>): void {
  new InvoiceView({ root: root(), doc: doc(), auth: auth as never, canGenerate: true });
}

const dialog = () => doc().querySelector<HTMLElement>('[role="dialog"]');
const collectButton = () => [...root().querySelectorAll<HTMLButtonElement>('button')]
  .find((b) => b.textContent?.trim() === 'আদায় লিখুন')!;
const saveButton = () => [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  .find((b) => b.textContent?.includes('জমা নিন ও রসিদ দিন'))!;

async function openSheet(): Promise<void> {
  const b = collectButton();
  b.focus();
  b.click();
  await settle();
}

/* ── 28: the amount a clerk types is the amount sent ─────────────────────── */

describe('payment amount accepts what a Bangla keyboard types (finding 28)', () => {
  function payAuth() {
    return fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [DUE] } },
      '/api/v1/finance/payments': (init) => (init?.method === 'POST'
        ? { body: { receiptNo: 'RCP-2026-09-00001', ledgerPosted: true } }
        : { body: BILL }),
    });
  }
  const posts = (auth: ReturnType<typeof fakeAuth>) =>
    auth.calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/finance/payments');

  for (const [typed, taka] of [['৫০০', 500], ['1,250', 1250], ['১,২৫০', 1250], ['500', 500]] as const) {
    test(`"${typed}" is sent as ${taka}, not null`, async () => {
      const auth = payAuth();
      mount(auth);
      await settle();
      await openSheet();
      const input = dialog()!.querySelector<HTMLInputElement>('input[name="amount"]')!;
      input.value = typed;
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      saveButton().click();
      await settle();
      const sent = posts(auth);
      assert.equal(sent.length, 1, 'the payment was sent');
      assert.equal((sent[0].body as { amount: unknown }).amount, taka);
    });
  }

  for (const [typed, why] of [['', 'empty'], ['পাঁচশো', 'words'], ['0', 'zero'], ['০', 'Bangla zero']] as const) {
    test(`an amount that is ${why} is stopped at the field, not sent`, async () => {
      const auth = payAuth();
      mount(auth);
      await settle();
      await openSheet();
      const input = dialog()!.querySelector<HTMLInputElement>('input[name="amount"]')!;
      input.value = typed;
      saveButton().click();
      await settle();
      assert.equal(posts(auth).length, 0, 'nothing reaches the server to be refused as "zero"');
      assert.equal(input.getAttribute('aria-invalid'), 'true', 'the field itself says what is wrong');
      const err = doc().getElementById(input.getAttribute('aria-describedby')!.split(' ').pop()!)!;
      assert.equal(err.hidden, false);
      assert.match(err.textContent ?? '', /টাকার অঙ্ক/);
      assert.equal(active(), input, 'focus goes to the field to fix');
      assert.ok(dialog(), 'the sheet stays open with what was typed');
      assert.equal(input.value, typed);
    });
  }
});

/* ── 30: the billing run's outcome is brought to the person ──────────────── */

describe('the billing run shows its result where the person is (finding 30)', () => {
  const runForm = () => root().querySelector('form.inv-run') as HTMLFormElement;
  async function tickAndRun(): Promise<HTMLButtonElement> {
    const box = runForm().querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change'));
    const go = [...runForm().querySelectorAll<HTMLButtonElement>('button[type="submit"]')]
      .find((b) => b.textContent === 'ইনভয়েস তৈরি করুন')!;
    go.focus();
    go.click();
    return go;
  }

  test('a successful run moves focus to the count, off <body>', async () => {
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [] } },
      '/api/v1/finance/generate': { body: { invoicesCreated: 236, notified: 198 } },
    });
    mount(auth);
    await settle();
    await tickAndRun();
    await settle();
    const note = root().querySelector<HTMLElement>('.ui-success-note')!;
    assert.match(note.textContent ?? '', /২৩৬ টি ইনভয়েস তৈরি হয়েছে/);
    assert.equal(active(), note, 'focus scrolls the result into view and reads it out');
    assert.equal(note.tabIndex, -1, 'focusable from script only, not a tab stop');
  });

  test('the count is shown before a slow list reload finishes', async () => {
    const reload = later<Reply>();
    let lists = 0;
    const auth = fakeAuth({
      '/api/v1/finance/invoices': () => (++lists === 1 ? { body: { invoices: [] } } : reload.promise),
      '/api/v1/finance/generate': { body: { invoicesCreated: 3 } },
    });
    mount(auth);
    await settle();
    await tickAndRun();
    await settle();
    const note = root().querySelector<HTMLElement>('.ui-success-note');
    assert.ok(note, 'the note is drawn while the list reloads');
    assert.equal(active(), note);
    reload.resolve({ body: { invoices: [] } });
    await settle();
    assert.equal(active(), root().querySelector('.ui-success-note'), 'and focus follows it through the reload');
  });

  test('an offline failure moves focus to the failure', async () => {
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [] } },
      '/api/v1/finance/generate': 'throw',
    });
    mount(auth);
    await settle();
    await tickAndRun();
    await settle();
    const alert = root().querySelector<HTMLElement>('.inv-alert')!;
    assert.match(alert.textContent ?? '', /সংযোগ নেই — ইনভয়েস তৈরি করা যায়নি/);
    assert.equal(active(), alert);
  });

  test('a refused run moves focus to the refusal, and an old note does not sit above it', async () => {
    let runs = 0;
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [] } },
      '/api/v1/finance/generate': () => (++runs === 1
        ? { body: { invoicesCreated: 2 } }
        : { status: 400, body: { error: 'no_academic_year' } }),
    });
    mount(auth);
    await settle();
    await tickAndRun();
    await settle();
    await tickAndRun();
    await settle();
    assert.equal(root().querySelector('.ui-success-note'), null,
      'the last run\'s success is not this run\'s outcome');
    const alert = root().querySelector<HTMLElement>('.inv-alert')!;
    assert.match(alert.textContent ?? '', /শিক্ষাবর্ষের/);
    assert.equal(active(), alert);
  });

  test('inside the shell\'s focus keeper, focus still lands on the result', async () => {
    const stop = keepFocusWithin(doc().getElementById('shell-view') as HTMLElement);
    try {
      const auth = fakeAuth({
        '/api/v1/finance/invoices': { body: { invoices: [] } },
        '/api/v1/finance/generate': { body: { invoicesCreated: 5, notified: 4 } },
      });
      mount(auth);
      await settle();
      await tickAndRun();
      await settle();
      assert.equal(active(), root().querySelector('.ui-success-note'));
    } finally { stop(); }
  });

  test('somebody who moved on while the run was slow keeps their place', async () => {
    const answer = later<Reply>();
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [] } },
      '/api/v1/finance/generate': () => answer.promise,
    });
    mount(auth);
    await settle();
    await tickAndRun();
    await settle(2);
    const elsewhere = doc().createElement('button');
    doc().body.append(elsewhere);
    elsewhere.focus();
    answer.resolve({ body: { invoicesCreated: 1 } });
    await settle();
    assert.equal(active(), elsewhere, 'the result does not steal focus from the bell or another field');
  });
});

/* ── 31: the payment sheet loads, fails and succeeds where the tap was ───── */

describe('the payment sheet says what happened where the clerk is (finding 31)', () => {
  test('the sheet opens at the tap and loads inside itself', async () => {
    const bill = later<Reply>();
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [DUE] } },
      '/api/v1/finance/payments': (init) => (init?.method === 'POST' ? { body: {} } : bill.promise),
    });
    mount(auth);
    await settle();
    await openSheet();
    assert.ok(dialog(), 'a slow connection still shows that the tap worked');
    assert.ok(dialog()!.querySelector('.is-skeleton'), 'loading is a skeleton in the sheet');
    assert.equal(saveButton().disabled, true, 'nothing can be saved against a bill not yet read');
    saveButton().click();
    await settle(2);
    assert.equal(auth.calls.filter((c) => c.method === 'POST').length, 0);

    bill.resolve({ body: BILL });
    await settle();
    assert.ok(dialog()!.querySelector('input[name="amount"]'), 'the form arrives in the open sheet');
    assert.equal(saveButton().disabled, false);
    assert.equal(dialog()!.contains(active()), true, 'focus stayed in the sheet');
  });

  for (const [how, reply] of [['a network failure', 'throw'], ['a server failure', { status: 500, body: {} }]] as const) {
    test(`${how} is shown in the sheet, not above the page`, async () => {
      const auth = fakeAuth({
        '/api/v1/finance/invoices': { body: { invoices: [DUE] } },
        '/api/v1/finance/payments': reply as Reply,
      });
      mount(auth);
      await settle();
      const listTop = root().querySelector('.inv-recent');
      const before = [...root().children].indexOf(listTop!);
      await openSheet();

      assert.ok(dialog(), 'the tap visibly did something');
      const err = dialog()!.querySelector<HTMLElement>('.ui-state-error');
      assert.ok(err, 'the failure is in the sheet');
      assert.match(err!.textContent ?? '', /বিলের তথ্য আনা যায়নি/);
      assert.equal(root().querySelector('.inv-alert'), null, 'nothing is inserted above the page');
      assert.equal([...root().children].indexOf(root().querySelector('.inv-recent')!), before,
        'the list the clerk was reading does not jump');
      assert.equal(saveButton().hidden, true, 'no primary for a bill that did not load');
      assert.notEqual(active(), doc().body, 'focus is not dropped');
    });
  }

  test('its retry reloads the bill, not the invoice list, and keeps focus in the sheet', async () => {
    let tries = 0;
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [DUE] } },
      '/api/v1/finance/payments': () => (++tries === 1 ? 'throw' : { body: BILL }),
    });
    mount(auth);
    await settle();
    await openSheet();
    const lists = auth.calls.filter((c) => c.path.startsWith('/api/v1/finance/invoices')).length;
    const retry = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'আবার চেষ্টা করুন')!;
    retry.focus();
    retry.click();
    assert.equal(dialog()!.contains(active()), true, 'while it reloads, focus waits in the sheet');
    await settle();
    assert.equal(tries, 2, 'the bill was asked for again');
    assert.equal(auth.calls.filter((c) => c.path.startsWith('/api/v1/finance/invoices')).length, lists,
      'the list was not reloaded instead');
    assert.ok(dialog()!.querySelector('input[name="amount"]'));
    assert.equal(saveButton().hidden, false);
    assert.equal(saveButton().disabled, false);
    assert.equal(dialog()!.contains(active()), true, 'focus is on a control in the sheet, not the page behind');
  });

  test('a refusal offers no retry that can only be refused again', async () => {
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [DUE] } },
      '/api/v1/finance/payments': { status: 403, body: { error: 'forbidden' } },
    });
    mount(auth);
    await settle();
    await openSheet();
    const err = dialog()!.querySelector<HTMLElement>('.ui-state-error')!;
    assert.match(err.textContent ?? '', /অনুমতি/);
    assert.equal([...err.querySelectorAll('button')].length, 0);
  });

  test('closing the sheet while it loads leaves nothing behind', async () => {
    const bill = later<Reply>();
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [DUE] } },
      '/api/v1/finance/payments': () => bill.promise,
    });
    mount(auth);
    await settle();
    await openSheet();
    closeAllOverlays();
    bill.resolve({ body: BILL });
    await settle();
    assert.equal(dialog(), null);
    assert.equal(root().querySelector('.inv-alert'), null);
  });

  test('the receipt number is brought into view and focused after a payment', async () => {
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { body: { invoices: [DUE, PAID] } },
      '/api/v1/finance/payments': (init) => (init?.method === 'POST'
        ? { body: { receiptNo: 'RCP-2026-09-00001', ledgerPosted: true } }
        : { body: BILL }),
    });
    mount(auth);
    await settle();
    await openSheet();
    saveButton().click();
    await settle();
    assert.equal(dialog(), null, 'the sheet closed');
    const note = root().querySelector<HTMLElement>('.ui-success-note')!;
    assert.match(note.textContent ?? '', /রসিদ RCP-2026-09-00001 দেওয়া হয়েছে/);
    assert.equal(active(), note, 'the clerk is taken to the number they hand the payer');
  });

  test('inside the shell\'s focus keeper, a payment still ends on the receipt', async () => {
    const stop = keepFocusWithin(doc().getElementById('shell-view') as HTMLElement);
    try {
      const auth = fakeAuth({
        '/api/v1/finance/invoices': { body: { invoices: [DUE] } },
        '/api/v1/finance/payments': (init) => (init?.method === 'POST'
          ? { body: { receiptNo: 'RCP-2026-09-00002', ledgerPosted: true } }
          : { body: BILL }),
      });
      mount(auth);
      await settle();
      await openSheet();
      saveButton().click();
      await settle();
      assert.equal(active(), root().querySelector('.ui-success-note'));
    } finally { stop(); }
  });
});

/* ── 34: the phone list names its two figures ────────────────────────────── */

describe('the phone list says which figure is মোট and which is বকেয়া (finding 34)', () => {
  /** What a sighted reader sees: the text without the visually-hidden spans. */
  const seen = (node: Element) => {
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('.ui-sr-only').forEach((n) => n.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  };

  test('each money figure on the meta line carries its word', async () => {
    mount(fakeAuth({ '/api/v1/finance/invoices': { body: { invoices: [DUE, PAID] } } }));
    await settle();
    const metas = [...root().querySelectorAll('.ui-list .ui-list-meta')];
    assert.equal(metas.length, 2);
    assert.match(seen(metas[0]), /মোট ৳ 1,500\.00/);
    assert.match(seen(metas[0]), /বকেয়া ৳ 900\.00/);
    assert.match(seen(metas[1]), /মোট ৳ 750\.00/);
    assert.match(seen(metas[1]), /বকেয়া ৳ 0\.00/);
  });

  test('the word is for the eye: a screen reader hears the column name once', async () => {
    mount(fakeAuth({ '/api/v1/finance/invoices': { body: { invoices: [DUE] } } }));
    await settle();
    const words = [...root().querySelectorAll('.ui-list .inv-amt-word')];
    assert.equal(words.length, 2);
    for (const w of words) assert.equal(w.getAttribute('aria-hidden'), 'true');
    // The list's own hidden prefix is still there for the reader.
    const prefixes = [...root().querySelectorAll('.ui-list .ui-list-meta .ui-sr-only')].map((n) => n.textContent);
    assert.deepEqual(prefixes, ['মোট: ', 'বকেয়া: ']);
  });

  test('the figure keeps the number face, and the desktop word is marked for its table rule', async () => {
    mount(fakeAuth({ '/api/v1/finance/invoices': { body: { invoices: [DUE] } } }));
    await settle();
    const figure = root().querySelector('.ui-list .inv-amt .n');
    assert.equal(figure?.textContent, '৳ 1,500.00');
    // app.css hides `.inv-table .ui-table .inv-amt-word`: the column header says it there.
    const tableWord = root().querySelector('.inv-table .ui-table td[data-col="total"] .inv-amt-word');
    assert.ok(tableWord, 'the table cell carries the same hook the stylesheet hides');
  });
});
