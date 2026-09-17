/**
 * UX sweep — ফি নির্ধারণ (#/feestructures), group feestructures.
 *
 *   4  — a figure typed in Bangla digits went out as null: an edited price
 *        was kept, a due day or cap was cleared, and the screen said "saved".
 *   29 — the search box took one letter: every keystroke rebuilt the whole
 *        screen, the box included. The exam register (#/exams,
 *        exams-view.ts) had the same defect and is covered at the end.
 *   37 — after a save, a refusal or a delete, keyboard focus fell to <body>.
 *
 * The view is mounted the way the shell mounts it: `keepFocusWithin` armed on
 * its container first (shell.ts arms it on main#shell-view for every route).
 *
 * jsdom does not do Chrome's "focus fixup": a focused button that becomes
 * disabled keeps focus there. `emulateFocusFixup` does what Chrome does —
 * disabling the focused control drops focus to <body> — because that drop is
 * exactly what finding 37 is about.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { FeeStructuresView } from '../src/fee-structures-view.ts';
import { ExamsView } from '../src/exams-view.ts';
import { keepFocusWithin, focusIsLost } from '../src/ui/dom.ts';
import { closeAllOverlays } from '../src/ui/overlay.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;
const settle = async () => { for (let i = 0; i < 16; i++) await new Promise((r) => setTimeout(r, 0)); };

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
});

let stopKeeper: () => void = () => {};
let stopFixup: () => void = () => {};

beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<main id="root"></main>';
  stopKeeper = keepFocusWithin(root());
  stopFixup = emulateFocusFixup();
});
afterEach(() => { stopKeeper(); stopFixup(); closeAllOverlays(); });

/** Chrome: a focused control that becomes disabled loses focus to <body>. */
function emulateFocusFixup(): () => void {
  const mo = new dom.window.MutationObserver(() => {
    const a = doc().activeElement as HTMLButtonElement | null;
    if (!a || a === doc().body || !a.disabled) return;
    // jsdom's blur() ignores an element that cannot take focus, and a
    // disabled button cannot — so it is enabled for the blur alone.
    a.disabled = false;
    a.blur();
    a.disabled = true;
  });
  mo.observe(doc().body, { attributes: true, attributeFilter: ['disabled'], subtree: true });
  return () => mo.disconnect();
}

type Row = {
  id: string; feeHeadId: string; headBn: string; headCode: string; frequency: string;
  headActive: boolean; classId: string | null; classBn: string | null; amount: number;
  lateFeePerDay: number | null; lateFeeCap: number | null; dueDayOfMonth: number | null;
  billedByMonthlyRun: boolean;
};
const row = (id: string, headBn: string, classBn: string | null, amount: number): Row => ({
  id, feeHeadId: 'h-1', headBn, headCode: 'TUITION', frequency: 'monthly', headActive: true,
  classId: classBn ? 'c-1' : null, classBn, amount,
  lateFeePerDay: 10, lateFeeCap: 200, dueDayOfMonth: 10, billedByMonthlyRun: true,
});

/**
 * A stand-in for /api/v1/finance/feestructures that keeps what it is sent,
 * and refuses writes while `refuse` is set.
 */
function server(rows: Row[]) {
  const store = { rows: [...rows], sent: [] as Array<{ method: string; body: Record<string, unknown> | null }>,
    refuse: null as null | { status: number; message: string } };
  const auth = {
    authedFetch: async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      const json = (status: number, body: unknown) =>
        ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
      if (method === 'GET') {
        return json(200, {
          canManage: true,
          academicYearId: 'y-1',
          years: [{ id: 'y-1', label: '২০২৬', isCurrent: true }],
          classes: [{ id: 'c-1', nameBn: 'নবম' }],
          heads: [{ id: 'h-1', code: 'TUITION', nameBn: 'মাসিক বেতন', frequency: 'monthly', isActive: true }],
          structures: store.rows,
        });
      }
      const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : null;
      store.sent.push({ method, body });
      if (store.refuse) return json(store.refuse.status, { message: store.refuse.message });
      if (method === 'DELETE') {
        const id = new URL(url, 'http://x').searchParams.get('id');
        store.rows = store.rows.filter((r) => r.id !== id);
      } else if (method === 'POST' && body) {
        store.rows.push({ ...row(`s-${store.rows.length + 9}`, 'মাসিক বেতন', null, Number(body.amount)) });
      }
      return json(200, { headBn: 'মাসিক বেতন' });
    },
  } as never;
  return { store, auth };
}

async function mount(rows: Row[]) {
  const s = server(rows);
  new FeeStructuresView({ root: root(), doc: doc(), auth: s.auth });
  await settle();
  return s.store;
}

const dialog = () => doc().querySelector<HTMLElement>('.ui-dialog');
const buttonIn = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent?.trim() === label);
/**
 * A keyboard press: focus the control, activate it, and let the page settle
 * as it does between one key and the next (two presses never share a task).
 */
const press = async (b: HTMLButtonElement | undefined) => {
  assert.ok(b, 'button not rendered');
  b.focus();
  b.click();
  await settle();
};
const input = (name: string) => {
  const i = doc().querySelector<HTMLInputElement>(`.ui-dialog input[name="${name}"]`);
  assert.ok(i, `input ${name} not rendered`);
  return i;
};
const type = (i: HTMLInputElement, value: string) => {
  i.value = value;
  i.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
};
/** The first row's button in the desktop table (the list repeats it). */
const rowButton = (id: string, label: string) => {
  const tr = root().querySelector(`tr[data-key="${id}"]`);
  assert.ok(tr, `row ${id} not rendered`);
  return buttonIn(tr, label);
};

/* ── 4: figures in either numeral system ──────────────────────────────────── */

describe('finding 4 — Bangla digits are read as numbers, never sent as null', () => {
  test('an edit typed in Bangla digits sends those numbers', async () => {
    const store = await mount([row('s-1', 'মাসিক বেতন', null, 1250)]);
    await press(rowButton('s-1', 'সম্পাদনা'));
    type(input('amount'), '১৫০০');
    type(input('dueDayOfMonth'), '১৫');
    type(input('lateFeePerDay'), '২০');
    type(input('lateFeeCap'), '৩০০');
    await press(buttonIn(dialog()!, 'সংরক্ষণ করুন'));

    assert.equal(store.sent.length, 1, 'the PATCH was sent');
    assert.deepEqual(store.sent[0].body, {
      amount: 1500, dueDayOfMonth: 15, lateFeePerDay: 20, lateFeeCap: 300, id: 's-1',
    });
    assert.equal(dialog(), null, 'an accepted save closes the drawer');
  });

  test('a new fee typed in Bangla digits is not refused as empty', async () => {
    const store = await mount([]);
    await press(buttonIn(root(), 'নতুন ফি'));
    const head = doc().querySelector<HTMLSelectElement>('.ui-dialog select[name="feeHeadId"]')!;
    head.value = 'h-1';
    type(input('amount'), '১২৫০');
    type(input('dueDayOfMonth'), '১০');
    type(input('lateFeePerDay'), '৫');
    type(input('lateFeeCap'), '১,০০০');
    await press(buttonIn(dialog()!, 'নির্ধারণ করুন'));

    assert.equal(store.sent.length, 1);
    const b = store.sent[0].body!;
    assert.equal(b.amount, 1250);
    assert.equal(b.dueDayOfMonth, 10);
    assert.equal(b.lateFeePerDay, 5);
    assert.equal(b.lateFeeCap, 1000);
  });

  test('something that is not a number is refused on the box, and nothing is sent', async () => {
    const store = await mount([row('s-1', 'মাসিক বেতন', null, 1250)]);
    await press(rowButton('s-1', 'সম্পাদনা'));
    type(input('dueDayOfMonth'), 'দশ');
    await press(buttonIn(dialog()!, 'সংরক্ষণ করুন'));

    assert.equal(store.sent.length, 0, 'an unreadable due day must not go out as null (it cleared the due day)');
    assert.ok(dialog(), 'the drawer stays open');
    const due = input('dueDayOfMonth');
    assert.equal(due.getAttribute('aria-invalid'), 'true');
    assert.equal(due.value, 'দশ', 'what was typed is kept');
    const err = due.closest('.ui-field')!.querySelector('.ui-field-error')!;
    assert.equal(err.hasAttribute('hidden'), false);
    assert.match(err.textContent ?? '', /শেষ তারিখ/);
    assert.equal(active(), due, 'focus goes to the box that is wrong');

    // Fixing it clears the error and the save goes through.
    type(due, '১২');
    assert.equal(due.hasAttribute('aria-invalid'), false);
    await press(buttonIn(dialog()!, 'সংরক্ষণ করুন'));
    assert.equal(store.sent.length, 1);
    assert.equal(store.sent[0].body!.dueDayOfMonth, 12);
  });

  test('an emptied amount is refused, not saved as ৳0', async () => {
    const store = await mount([row('s-1', 'মাসিক বেতন', null, 1250)]);
    await press(rowButton('s-1', 'সম্পাদনা'));
    type(input('amount'), '');
    await press(buttonIn(dialog()!, 'সংরক্ষণ করুন'));

    assert.equal(store.sent.length, 0);
    const amount = input('amount');
    assert.equal(amount.getAttribute('aria-invalid'), 'true');
    assert.match(amount.closest('.ui-field')!.textContent ?? '', /টাকার অঙ্ক লিখুন।/);
    assert.equal(active(), amount);
  });

  test('the optional boxes keep their meaning when left empty', async () => {
    const store = await mount([row('s-1', 'মাসিক বেতন', null, 1250)]);
    await press(rowButton('s-1', 'সম্পাদনা'));
    type(input('dueDayOfMonth'), '');
    type(input('lateFeePerDay'), '');
    type(input('lateFeeCap'), '');
    await press(buttonIn(dialog()!, 'সংরক্ষণ করুন'));

    assert.deepEqual(store.sent[0].body, {
      amount: 1250, dueDayOfMonth: null, lateFeePerDay: 0, lateFeeCap: null, id: 's-1',
    });
  });
});

/* ── 29: the search box survives typing ───────────────────────────────────── */

describe('finding 29 — the search box is not rebuilt while someone types', () => {
  test('three letters stay in the same box, with focus, and the list filters', async () => {
    await mount([
      row('s-1', 'মাসিক বেতন', 'নবম', 1250),
      row('s-2', 'ভর্তি ফি', 'দশম', 3000),
      row('s-3', 'পরীক্ষার ফি', null, 500),
    ]);
    const box = root().querySelector<HTMLInputElement>('input[name="q"]')!;
    const header = root().querySelector('.page-header');
    box.focus();
    for (const ch of ['ন', 'ব', 'ম']) {
      const cur = active() as HTMLInputElement;
      type(cur, cur.value + ch);
      await settle();
    }

    assert.equal(box.isConnected, true, 'the box itself was replaced under the keystroke');
    assert.equal(active(), box, 'focus left the box');
    assert.equal(box.value, 'নবম');
    assert.equal(root().querySelector('.page-header'), header, 'the header was rebuilt by a keystroke');
    const keys = [...root().querySelectorAll('tr[data-key]')].map((t) => t.getAttribute('data-key'));
    assert.deepEqual(keys, ['s-1'], 'the list filters to the matching row');

    type(box, 'কিছুই না');
    await settle();
    assert.match(root().querySelector('.fs-frame')!.textContent ?? '', /এই নামে কোনো ফি পাওয়া যায়নি।/);
    type(box, '');
    await settle();
    assert.equal(root().querySelectorAll('tr[data-key]').length, 3);
    assert.equal(active(), box);
  });
});

/* ── 37: focus after a save, a refusal and a delete ───────────────────────── */

describe('finding 37 — focus keeps its place after a finance action', () => {
  test('a refused save leaves focus inside the drawer, on the button pressed', async () => {
    const store = await mount([]);
    store.refuse = { status: 409, message: 'এই শিক্ষাবর্ষে এই ফি-এর জন্য একই শ্রেণিতে আগে থেকেই একটি নির্ধারণ আছে।' };
    await press(buttonIn(root(), 'নতুন ফি'));
    const head = doc().querySelector<HTMLSelectElement>('.ui-dialog select[name="feeHeadId"]')!;
    head.value = 'h-1';
    type(input('amount'), '1500');
    const save = buttonIn(dialog()!, 'নির্ধারণ করুন')!;
    await press(save);

    assert.equal(store.sent.length, 1);
    assert.ok(dialog(), 'the drawer stays open on a refusal');
    assert.equal(active(), save, 'focus fell out of the drawer while it stayed open');
    assert.ok(dialog()!.contains(active()));

    // Escape then returns focus to the (rebuilt) নতুন ফি, not <body>.
    doc().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    assert.equal(dialog(), null);
    assert.equal(active()?.textContent?.trim(), 'নতুন ফি');
    assert.equal(active()?.isConnected, true);
  });

  test('an accepted new fee returns focus to নতুন ফি', async () => {
    await mount([row('s-1', 'মাসিক বেতন', null, 1250)]);
    await press(buttonIn(root(), 'নতুন ফি'));
    const head = doc().querySelector<HTMLSelectElement>('.ui-dialog select[name="feeHeadId"]')!;
    head.value = 'h-1';
    type(input('amount'), '800');
    await press(buttonIn(dialog()!, 'নির্ধারণ করুন'));

    assert.equal(dialog(), null);
    assert.equal(focusIsLost(doc()), false, 'focus was lost after the save');
    assert.equal(active()?.textContent?.trim(), 'নতুন ফি');
  });

  test('the first fee, saved from the empty state, does not lose focus', async () => {
    await mount([]);
    await press(buttonIn(root(), 'প্রথম ফি নির্ধারণ করুন'));
    const head = doc().querySelector<HTMLSelectElement>('.ui-dialog select[name="feeHeadId"]')!;
    head.value = 'h-1';
    type(input('amount'), '800');
    await press(buttonIn(dialog()!, 'নির্ধারণ করুন'));

    assert.equal(dialog(), null);
    assert.equal(root().querySelectorAll('tr[data-key]').length, 1, 'the new fee is listed');
    assert.equal(focusIsLost(doc()), false, 'the empty state’s button is gone and focus went nowhere');
    assert.equal(active()?.textContent?.trim(), 'নতুন ফি');
  });

  test('an accepted edit returns focus to that row’s সম্পাদনা', async () => {
    await mount([row('s-1', 'মাসিক বেতন', null, 1250), row('s-2', 'ভর্তি ফি', null, 3000)]);
    await press(rowButton('s-2', 'সম্পাদনা'));
    type(input('amount'), '3500');
    await press(buttonIn(dialog()!, 'সংরক্ষণ করুন'));

    assert.equal(dialog(), null);
    assert.equal(active()?.textContent?.trim(), 'সম্পাদনা');
    assert.equal(active()?.closest('[data-key]')?.getAttribute('data-key'), 's-2');
  });

  test('a delete puts focus on নতুন ফি, never on <body> or the bare page', async () => {
    const store = await mount([row('s-1', 'মাসিক বেতন', null, 1250), row('s-2', 'ভর্তি ফি', null, 3000)]);
    await press(rowButton('s-2', 'সরান'));
    assert.ok(dialog(), 'the confirm opened');
    await press(buttonIn(dialog()!, 'সরান'));

    assert.deepEqual(store.sent.map((s) => s.method), ['DELETE']);
    assert.equal(dialog(), null);
    assert.equal(root().querySelector('tr[data-key="s-2"]'), null, 'the row is gone');
    assert.equal(focusIsLost(doc()), false, 'focus was lost after the delete');
    assert.equal(active()?.textContent?.trim(), 'নতুন ফি');
  });

  test('a refused delete returns focus to that row’s সরান', async () => {
    const store = await mount([row('s-1', 'মাসিক বেতন', null, 1250)]);
    store.refuse = { status: 409, message: 'এই ফি এখন সরানো যাবে না।' };
    await press(rowButton('s-1', 'সরান'));
    await press(buttonIn(dialog()!, 'সরান'));

    assert.equal(dialog(), null);
    assert.match(root().textContent ?? '', /এই ফি এখন সরানো যাবে না।/);
    assert.equal(active()?.textContent?.trim(), 'সরান');
    assert.equal(active()?.closest('[data-key]')?.getAttribute('data-key'), 's-1');
  });

  test('closing the drawer without saving still returns focus to its opener', async () => {
    await mount([row('s-1', 'মাসিক বেতন', null, 1250)]);
    const opener = buttonIn(root(), 'নতুন ফি')!;
    await press(opener);
    await press(buttonIn(dialog()!, 'বাতিল'));
    assert.equal(active(), opener);
  });
});

/* ── 29, second half: the exam register's search box (exams-view.ts) ──────── */

describe('finding 29 (exams-view.ts) — the exam search box is not rebuilt while someone types', () => {
  const TREE = {
    years: [{ id: 'y-1', label: '২০২৬', isCurrent: true }],
    year: { id: 'y-1', label: '২০২৬', isCurrent: true },
    classes: [],
  };
  const exam = (id: string, nameBn: string, nameEn: string, examType: string) => ({
    id, nameBn, nameEn, examType, status: 'planned',
    startsOn: '2026-06-01', endsOn: '2026-06-10', weightPercent: 20, isGpaBearing: true,
    paperCount: 12, sectionCount: 1, markCount: 0,
  });
  const EXAMS = {
    canManage: true,
    examTypes: ['monthly', 'half_yearly', 'annual'],
    exams: [
      exam('e-1', 'মাসিক পরীক্ষা', 'Monthly', 'monthly'),
      exam('e-2', 'অর্ধবার্ষিক পরীক্ষা', 'Half yearly', 'half_yearly'),
      exam('e-3', 'বার্ষিক পরীক্ষা', 'Annual', 'annual'),
    ],
  };
  async function mountExams() {
    const auth = {
      authedFetch: async (url: string) => {
        const payload = url.includes('/hierarchy') ? TREE : EXAMS;
        return {
          ok: true, status: 200,
          clone: () => ({ json: async () => payload }),
          json: async () => payload,
        } as unknown as Response;
      },
    } as never;
    new ExamsView({ root: root(), doc: doc(), auth });
    await settle();
  }
  const keys = () => [...root().querySelectorAll('tr[data-key]')].map((t) => t.getAttribute('data-key'));

  test('four keystrokes stay in the same box, with focus, and the register filters', async () => {
    await mountExams();
    const box = root().querySelector<HTMLInputElement>('input[name="q"]')!;
    const year = root().querySelector<HTMLSelectElement>('select[name="year"]');
    const header = root().querySelector('.page-header');
    assert.ok(box && year && header, 'the strip and header rendered');
    assert.deepEqual(keys(), ['e-1', 'e-2', 'e-3']);

    box.focus();
    for (const ch of ['অ', 'র', '্', 'ধ']) {
      const cur = active() as HTMLInputElement;
      type(cur, cur.value + ch);
      await settle();
    }

    assert.equal(box.isConnected, true, 'the box itself was replaced under the keystroke');
    assert.equal(active(), box, 'focus left the box');
    assert.equal(box.value, 'অর্ধ');
    assert.equal(root().querySelector('.page-header'), header, 'the header was rebuilt by a keystroke');
    assert.equal(root().querySelector('select[name="year"]'), year, 'the year select was rebuilt by a keystroke');
    assert.deepEqual(keys(), ['e-2'], 'the register filters to the matching exam');
    // The table stays a direct child of the card, where `.exams-register>.ui-data` styles it.
    assert.ok(root().querySelector('.exams-register > .ui-data'), 'the table left the card');
    assert.ok(root().querySelector('.exams-register > .exams-foot'), 'the footer note is still drawn');

    type(box, 'কিছুই না');
    await settle();
    const card = root().querySelector('.exams-register')!;
    assert.match(card.textContent ?? '', /এই নামে কোনো পরীক্ষা পাওয়া যায়নি।/);
    assert.equal(card.firstElementChild?.contains(box), true, 'the strip stays above the empty state');
    assert.equal(card.querySelectorAll('.exams-filters').length, 1, 'the strip was drawn twice');

    type(box, '');
    await settle();
    assert.deepEqual(keys(), ['e-1', 'e-2', 'e-3']);
    assert.equal(card.querySelectorAll('.ui-data').length, 1, 'an old table was left behind');
    assert.equal(active(), box);
  });
});
