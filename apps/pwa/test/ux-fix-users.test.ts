/**
 * UX sweep — the users screen (group users).
 *
 * #/users mounts straight into the shell's view, and the shell arms
 * `keepFocusWithin` on that view for every route. These tests arm it the same
 * way (on the view root itself), so what they check is what a keyboard user
 * gets in the app: where focus lands after each action, not whether this
 * screen alone would manage without the shell.
 *
 *  - 38 / 58  every action rebuilt the screen and dropped focus to <body>;
 *             the create form opened without taking focus; confirming a
 *             deactivation lost the row and scrolled the page to the top.
 *  - 45       a failed activation code offered "আবার চেষ্টা করুন", which
 *             reloaded the user list instead, wiping the error.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { UsersView } from '../src/users-view.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';
import { closeAllOverlays } from '../src/ui/overlay.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0)); };

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
});

let stopKeeper: () => void = () => {};
beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<main id="root"></main>';
  // As shell.ts does for every route: the keeper watches the view the screen
  // mounts into.
  stopKeeper = keepFocusWithin(root());
});
afterEach(() => { stopKeeper(); });

interface Reply { status: number; body: unknown }
interface Call { url: string; method: string; body: unknown }

/**
 * A server the test can script per request. `hold` makes the next matching
 * request wait until `release()` — the in-flight moment the screen draws.
 */
function server(handler: (c: Call) => Reply) {
  const calls: Call[] = [];
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  const auth = {
    tenantId: 't-1', role: 'it_admin',
    authedFetch: async (url: string, init?: RequestInit) => {
      const c: Call = {
        url, method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(c);
      if (gate && c.method === 'GET') await gate;
      const r = handler(c);
      return {
        ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body,
      } as unknown as Response;
    },
  };
  return {
    auth, calls,
    /** Hold the next list reloads until release(). */
    holdLists() { gate = new Promise<void>((r) => { open = r; }); },
    release() { open?.(); gate = null; },
  };
}

const RAHIM = {
  id: 'u1', nameBn: 'রহিম স্যার', nameEn: null, phone: '+8801700000001',
  status: 'active', roles: ['class_teacher'], employeeCode: 'T-101', studentCode: null,
};
const KARIM = {
  id: 'u2', nameBn: 'করিম স্যার', nameEn: null, phone: '+8801700000002',
  status: 'active', roles: ['subject_teacher'], employeeCode: 'T-102', studentCode: null,
};

function mount(s: ReturnType<typeof server>) {
  return new UsersView({ root: root(), doc: doc(), auth: s.auth as never, canManage: true });
}

/** A control in the table shape (the first of the two shapes in the DOM). */
function rowButton(id: string, label: RegExp): HTMLButtonElement {
  const row = root().querySelector(`table [data-key="${id}"]`);
  assert.ok(row, `row ${id} is drawn`);
  const b = [...row.querySelectorAll('button')]
    .find((x) => label.test(x.getAttribute('aria-label') ?? x.textContent ?? ''));
  assert.ok(b, `row ${id} has a button matching ${label}`);
  return b as HTMLButtonElement;
}
const byText = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text) as
    HTMLButtonElement | undefined;
/** The create form's required fields, filled (requestSubmit validates them). */
function fill(form: HTMLFormElement): void {
  const set = (name: string, v: string) => {
    (form.querySelector(`[name="${name}"]`) as HTMLInputElement).value = v;
  };
  set('nameBn', 'করিম স্যার'); set('phone', '01700000002'); set('employeeCode', 'T-102');
}
/** Press as a keyboard user does: the control has focus, then it activates. */
function press(b: HTMLElement): void { b.focus(); b.click(); }
/**
 * Count the moments a text field is taken out of the page and the times focus
 * is put back on it. In a browser either one ends an Android keyboard's
 * composition — the Bangla word being typed — even when the value, focus and
 * caret all come back afterwards, which is all jsdom could otherwise see.
 */
function watchFocus(node: HTMLElement): () => { detached: number; refocused: number } {
  let detached = 0;
  let refocused = 0;
  const mo = new dom.window.MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.removedNodes) if (n === node || n.contains(node)) detached++;
    }
  });
  mo.observe(root(), { childList: true, subtree: true });
  const real = node.focus;
  node.focus = function (this: HTMLElement, o?: FocusOptions) { refocused++; real.call(this, o); };
  return () => { mo.disconnect(); node.focus = real; return { detached, refocused }; };
}

/* ── 38 / 58: the create form ───────────────────────────────────────────── */

describe('users — the create form takes focus and gives it back (38, 58)', () => {
  test('নতুন অ্যাকাউন্ট puts focus in the form’s first field; বাতিল returns it to the toggle', async () => {
    const s = server(() => ({ status: 200, body: { users: [RAHIM], truncated: false } }));
    mount(s);
    await settle();
    press(byText(root(), 'নতুন অ্যাকাউন্ট')!);
    await settle();
    assert.ok(root().querySelector('form.users-create'), 'the form opened');
    assert.equal(active(), root().querySelector('.users-create input[name="nameBn"]'),
      'focus is in the first field, so a screen reader hears the form open');

    press(byText(root(), 'বাতিল')!);
    await settle();
    assert.equal(root().querySelector('form.users-create'), null, 'the form closed');
    assert.equal(active(), byText(root(), 'নতুন অ্যাকাউন্ট'),
      'focus is back on the control that opens it');
  });

  test('the empty state’s নতুন যোগ করুন also puts focus in the form', async () => {
    const s = server(() => ({ status: 200, body: { users: [], truncated: false } }));
    mount(s);
    await settle();
    press(byText(root(), 'নতুন যোগ করুন')!);
    await settle();
    assert.equal(active(), root().querySelector('.users-create input[name="nameBn"]'));
  });

  test('a successful create closes the form and puts focus on what happened', async () => {
    let created = false;
    const s = server((c) => {
      if (c.method === 'POST') { created = true; return { status: 201, body: { nameBn: 'করিম স্যার' } }; }
      return { status: 200, body: { users: created ? [RAHIM, KARIM] : [RAHIM], truncated: false } };
    });
    mount(s);
    await settle();
    press(byText(root(), 'নতুন অ্যাকাউন্ট')!);
    const form = root().querySelector('form.users-create') as HTMLFormElement;
    fill(form);
    const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submit.focus();
    form.requestSubmit(submit);
    await settle();
    assert.equal(root().querySelector('form.users-create'), null, 'the form closed');
    const note = root().querySelector('.ui-success-note');
    assert.match(note?.textContent ?? '', /করিম স্যার যুক্ত হয়েছেন/);
    assert.equal(active(), note, 'focus is on the confirmation, which is read out');
    assert.notEqual(active(), doc().body);
  });

  test('a failed create keeps focus in the form and offers no list reload as its retry (45)', async () => {
    const s = server((c) => c.method === 'POST'
      ? { status: 409, body: { message: 'এই মোবাইল নম্বরে আগেই একটি অ্যাকাউন্ট আছে।' } }
      : { status: 200, body: { users: [RAHIM], truncated: false } });
    mount(s);
    await settle();
    press(byText(root(), 'নতুন অ্যাকাউন্ট')!);
    const form = root().querySelector('form.users-create') as HTMLFormElement;
    fill(form);
    const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    submit.focus();
    form.requestSubmit(submit);
    await settle();
    const lists = s.calls.filter((c) => c.method === 'GET').length;
    const err = root().querySelector('.users-note');
    assert.match(err?.textContent ?? '', /আগেই একটি অ্যাকাউন্ট আছে/);
    assert.equal(byText(err!, 'আবার চেষ্টা করুন'), undefined,
      'the form’s own submit is the retry; a button that reloads the list is not');
    assert.equal(s.calls.filter((c) => c.method === 'GET').length, lists);
    assert.equal(active(), root().querySelector('form.users-create button[type="submit"]'),
      'focus stays on the submit, next to what needs fixing');
  });

  test('a failed create hands back what was typed, not an empty form', async () => {
    const s = server((c) => c.method === 'POST'
      ? { status: 409, body: { message: 'এই মোবাইল নম্বরে আগেই একটি অ্যাকাউন্ট আছে।' } }
      : { status: 200, body: { users: [RAHIM], truncated: false } });
    mount(s);
    await settle();
    press(byText(root(), 'নতুন অ্যাকাউন্ট')!);
    const form = root().querySelector('form.users-create') as HTMLFormElement;
    fill(form);
    (form.querySelector('[name="nameEn"]') as HTMLInputElement).value = 'Karim';
    (form.querySelector('[name="roleCode"]') as HTMLSelectElement).value = 'accountant';
    // Enter in the last field, as the sweep did.
    const last = form.querySelector('[name="employeeCode"]') as HTMLInputElement;
    last.focus();
    form.requestSubmit();
    await settle();
    assert.match(root().querySelector('.users-note')?.textContent ?? '', /আগেই একটি অ্যাকাউন্ট আছে/);
    const now = root().querySelector('form.users-create') as HTMLFormElement;
    const val = (name: string) => (now.querySelector(`[name="${name}"]`) as HTMLInputElement).value;
    assert.equal(val('nameBn'), 'করিম স্যার', 'the name is still there');
    assert.equal(val('nameEn'), 'Karim');
    assert.equal(val('phone'), '01700000002', 'the number to correct is still there');
    assert.equal(val('employeeCode'), 'T-102');
    assert.equal(val('roleCode'), 'accountant');
    assert.equal(active(), now.querySelector('[name="employeeCode"]'),
      'focus stays in the field the person pressed Enter in');
    assert.deepEqual(s.calls.filter((c) => c.method === 'POST').map((c) => c.body), [{
      nameBn: 'করিম স্যার', nameEn: 'Karim', phone: '01700000002',
      roleCode: 'accountant', employeeCode: 'T-102',
    }]);
  });

  test('a second submit while the first create is still out sends nothing', async () => {
    let answer: (() => void) | null = null;
    const s = server(() => ({ status: 200, body: { users: [RAHIM], truncated: false } }));
    const inner = s.auth.authedFetch;
    s.auth.authedFetch = async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        s.calls.push({ url, method: 'POST', body: JSON.parse(String(init.body)) });
        await new Promise<void>((r) => { answer = r; });
        return { ok: true, status: 201, json: async () => ({ nameBn: 'করিম স্যার' }) } as unknown as Response;
      }
      return inner(url, init);
    };
    mount(s);
    await settle();
    press(byText(root(), 'নতুন অ্যাকাউন্ট')!);
    const form = root().querySelector('form.users-create') as HTMLFormElement;
    fill(form);
    form.requestSubmit();
    await settle();
    form.requestSubmit();
    await settle();
    assert.equal(s.calls.filter((c) => c.method === 'POST').length, 1, 'one account, not two');
    (answer as unknown as () => void)();
    await settle();
    assert.equal(root().querySelector('form.users-create'), null);
  });

  test('closing the form with বাতিল discards what was typed', async () => {
    const s = server(() => ({ status: 200, body: { users: [RAHIM], truncated: false } }));
    mount(s);
    await settle();
    press(byText(root(), 'নতুন অ্যাকাউন্ট')!);
    fill(root().querySelector('form.users-create') as HTMLFormElement);
    press(byText(root(), 'বাতিল')!);
    press(byText(root(), 'নতুন অ্যাকাউন্ট')!);
    assert.equal((root().querySelector('[name="nameBn"]') as HTMLInputElement).value, '');
  });

  test('typing in the form while the list is still loading is not wiped when it arrives', async () => {
    const s = server(() => ({ status: 200, body: { users: [RAHIM, KARIM], truncated: false } }));
    s.holdLists();
    mount(s);
    await settle();
    assert.ok(root().querySelector('.ui-list-skeleton'), 'the list is still loading');
    press(byText(root(), 'নতুন অ্যাকাউন্ট')!);
    const name = root().querySelector('[name="nameBn"]') as HTMLInputElement;
    assert.equal(active(), name);
    name.value = 'নাঈম';
    name.setSelectionRange(2, 2);
    const blurs = watchFocus(name);
    s.release();
    await settle();
    assert.ok(root().querySelector('table [data-key="u2"]'), 'the list arrived');
    assert.equal(root().querySelector('[name="nameBn"]'), name, 'the field is the same node');
    assert.deepEqual(blurs(), { detached: 0, refocused: 0 },
      'never taken out of the page, never refocused: a keyboard composing a word is not cut off');
    assert.equal(name.value, 'নাঈম');
    assert.equal(active(), name);
    assert.equal(name.selectionStart, 2, 'the caret did not move');
  });
});

/* ── 38 / 58: deactivation ──────────────────────────────────────────────── */

describe('users — confirming a deactivation keeps the person’s place (38, 58)', () => {
  test('focus returns to the same row, and the table stays on screen while the list reloads', async () => {
    let left = false;
    const s = server((c) => {
      if (c.method === 'PATCH') { left = true; return { status: 200, body: {} }; }
      return { status: 200, body: {
        users: [RAHIM, { ...KARIM, status: left ? 'left' : 'active' }], truncated: false,
      } };
    });
    mount(s);
    await settle();
    s.holdLists();
    press(rowButton('u2', /নিষ্ক্রিয় করুন/));
    const dialog = doc().querySelector('[role="alertdialog"]') as HTMLElement;
    assert.ok(dialog, 'the confirm opened');
    press(byText(dialog, 'নিষ্ক্রিয় করুন')!);
    await settle();
    // The list is reloading. A skeleton in the table's place shrinks the page
    // to the viewport and the browser clamps the scroll to the top.
    assert.ok(root().querySelector('table.ui-table [data-key="u2"]'),
      'the rows stay while the list refreshes');
    assert.equal(root().querySelector('.ui-list-skeleton'), null, 'no skeleton replaces them');
    s.release();
    await settle();
    assert.equal(doc().querySelector('[role="alertdialog"]'), null, 'the dialog closed');
    assert.notEqual(active(), doc().body, 'focus is not lost to <body>');
    assert.equal(active(), rowButton('u2', /আবার সক্রিয় করুন/),
      'focus is on the same person’s row, on the control that undoes it');
  });

  test('on a phone (the table shape hidden) focus returns to the row in the LIST', async () => {
    // jsdom has no layout, so the hidden shape is simulated: CSS hides the
    // table below 1024px, and a browser refuses focus to anything inside it.
    const proto = dom.window.HTMLElement.prototype;
    const real = proto.focus;
    proto.focus = function (this: HTMLElement, o?: FocusOptions) {
      if (this.closest('.ui-table-scroll')) return;
      real.call(this, o);
    };
    try {
      let left = false;
      const s = server((c) => {
        if (c.method === 'PATCH') { left = true; return { status: 200, body: {} }; }
        return { status: 200, body: {
          users: [RAHIM, { ...KARIM, status: left ? 'left' : 'active' }], truncated: false,
        } };
      });
      mount(s);
      await settle();
      const inList = (label: RegExp) => [...root().querySelectorAll<HTMLButtonElement>(
        '.ui-list [data-key="u2"] button')].find((b) => label.test(b.getAttribute('aria-label') ?? ''))!;
      press(inList(/নিষ্ক্রিয় করুন/));
      assert.equal(root().querySelector('.ui-success-note'), null,
        'no note yet: the one this action adds shifts everything below it');
      press(byText(doc().querySelector('[role="alertdialog"]')!, 'নিষ্ক্রিয় করুন')!);
      await settle();
      assert.ok(root().querySelector('.ui-success-note'));
      assert.equal(active(), inList(/আবার সক্রিয় করুন/),
        'focus is on the visible copy of the row’s control, not parked on the page');
    } finally {
      proto.focus = real;
    }
  });

  test('reactivating keeps focus on the row’s control through the busy render', async () => {
    let back = false;
    const s = server((c) => {
      if (c.method === 'PATCH') { back = true; return { status: 200, body: {} }; }
      return { status: 200, body: {
        users: [RAHIM, { ...KARIM, status: back ? 'active' : 'left' }], truncated: false,
      } };
    });
    mount(s);
    await settle();
    press(rowButton('u2', /আবার সক্রিয় করুন/));
    await settle();
    assert.equal(active(), rowButton('u2', /নিষ্ক্রিয় করুন/));
  });
});

/* ── 38 / 58 / 45: the activation code ──────────────────────────────────── */

describe('users — issuing an activation code (38, 58, 45)', () => {
  test('on success focus moves to the code; বুঝেছি returns it to that row’s কোড', async () => {
    const s = server((c) => c.url.includes('/auth/activate')
      ? { status: 200, body: { code: 'ABCD2345' } }
      : { status: 200, body: { users: [RAHIM, KARIM], truncated: false } });
    mount(s);
    await settle();
    press(rowButton('u2', /কোড/));
    await settle();
    const card = root().querySelector('.users-code') as HTMLElement;
    assert.ok(card, 'the code card is drawn');
    assert.equal(active(), card, 'focus is on the code, so it is seen and read');
    assert.match(card.getAttribute('aria-labelledby') ? doc().getElementById(
      card.getAttribute('aria-labelledby')!)?.textContent ?? '' : '', /করিম স্যার/,
      'named for the person the code belongs to');
    const described = (card.getAttribute('aria-describedby') ?? '').split(/\s+/)
      .map((id) => doc().getElementById(id)?.textContent ?? '').join(' ');
    assert.match(described, /ABCD-2345/, 'the code itself is part of what is read');

    press(byText(card, 'বুঝেছি')!);
    await settle();
    assert.equal(root().querySelector('.users-code'), null);
    assert.equal(active(), rowButton('u2', /কোড/), 'back on the row that got the code');
  });

  test('বুঝেছি with that row filtered away sends focus to the header’s নতুন অ্যাকাউন্ট, not <body>', async () => {
    const s = server((c) => {
      if (c.url.includes('/auth/activate')) return { status: 200, body: { code: 'ABCD2345' } };
      const onlyRahim = c.url.includes('role=class_teacher');
      return { status: 200, body: { users: onlyRahim ? [RAHIM] : [RAHIM, KARIM], truncated: false } };
    });
    mount(s);
    await settle();
    press(rowButton('u2', /কোড/));
    await settle();
    const sel = root().querySelector('select[name="role"]') as HTMLSelectElement;
    sel.focus();
    sel.value = 'class_teacher';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    assert.equal(root().querySelector('[data-key="u2"]'), null, 'করিম স্যার is filtered out');
    press(byText(root().querySelector('.users-code')!, 'বুঝেছি')!);
    await settle();
    assert.equal(active(), byText(root(), 'নতুন অ্যাকাউন্ট'));
  });

  test('আবার চেষ্টা করুন retries the CODE, not the list, and a second failure still says so', async () => {
    let attempts = 0;
    const s = server((c) => {
      if (c.url.includes('/auth/activate')) {
        attempts++;
        return attempts < 3
          ? { status: 503, body: { error: 'unavailable' } }
          : { status: 200, body: { code: 'WXYZ6789' } };
      }
      return { status: 200, body: { users: [RAHIM, KARIM], truncated: false } };
    });
    mount(s);
    await settle();
    press(rowButton('u2', /কোড/));
    await settle();
    const lists = () => s.calls.filter((c) => c.method === 'GET').length;
    const listsBefore = lists();

    let err = root().querySelector('.users-note') as HTMLElement;
    assert.match(err.textContent ?? '', /করিম স্যার এর কোড তৈরি করা যায়নি/,
      'the error names whose code failed');
    let retry = byText(err, 'আবার চেষ্টা করুন')!;
    assert.ok(retry, 'a server failure is retryable');
    assert.equal(active(), retry, 'focus goes to the failure, not to <body>');

    press(retry);
    await settle();
    assert.equal(attempts, 2, 'the retry asked for the code again');
    assert.equal(lists(), listsBefore, 'it did not reload the list');
    err = root().querySelector('.users-note') as HTMLElement;
    assert.ok(err, 'the second failure is still on screen');
    assert.match(err.querySelector('[role="alert"]')?.textContent ?? '', /কোড তৈরি করা যায়নি/);
    retry = byText(err, 'আবার চেষ্টা করুন')!;
    assert.equal(active(), retry);

    press(retry);
    await settle();
    assert.equal(attempts, 3);
    assert.equal(root().querySelector('.users-note'), null);
    assert.match(root().querySelector('.users-code')?.textContent ?? '', /WXYZ-6789/);
    assert.equal(active(), root().querySelector('.users-code'));
  });

  test('a lost connection is retried the same way', async () => {
    let attempts = 0;
    const s = server(() => ({ status: 200, body: { users: [RAHIM], truncated: false } }));
    const inner = s.auth.authedFetch;
    s.auth.authedFetch = async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/activate')) { attempts++; throw new TypeError('Failed to fetch'); }
      return inner(url, init);
    };
    mount(s);
    await settle();
    press(rowButton('u1', /কোড/));
    await settle();
    const err = root().querySelector('.users-note') as HTMLElement;
    assert.match(err.textContent ?? '', /সংযোগ/);
    press(byText(err, 'আবার চেষ্টা করুন')!);
    await settle();
    assert.equal(attempts, 2, 'the retry asked for the code again');
  });

  test('a failure no retry can fix offers none, and still gets focus', async () => {
    const s = server((c) => c.url.includes('/auth/activate')
      ? { status: 503, body: { error: 'activation_unconfigured' } }
      : { status: 200, body: { users: [RAHIM], truncated: false } });
    mount(s);
    await settle();
    press(rowButton('u1', /কোড/));
    await settle();
    const err = root().querySelector('.users-note') as HTMLElement;
    assert.match(err.textContent ?? '', /এই সুবিধাটি এখনো চালু হয়নি/);
    assert.equal(byText(err, 'আবার চেষ্টা করুন'), undefined);
    assert.equal(active(), err.querySelector('[role="alert"]'),
      'focus is on the message, so it is seen even from far down the list');
  });

  test('a refused request (4xx) is not offered a retry', async () => {
    const s = server((c) => c.url.includes('/auth/activate')
      ? { status: 404, body: { error: 'user_not_found' } }
      : { status: 200, body: { users: [RAHIM], truncated: false } });
    mount(s);
    await settle();
    press(rowButton('u1', /কোড/));
    await settle();
    const err = root().querySelector('.users-note') as HTMLElement;
    assert.match(err.textContent ?? '', /রহিম স্যার এর কোড তৈরি করা যায়নি/);
    assert.equal(byText(err, 'আবার চেষ্টা করুন'), undefined);
  });

  test('a failed LIST load still retries the list', async () => {
    let n = 0;
    const s = server(() => (++n === 1
      ? { status: 500, body: {} }
      : { status: 200, body: { users: [RAHIM], truncated: false } }));
    mount(s);
    await settle();
    const retry = byText(root(), 'আবার চেষ্টা করুন')!;
    assert.ok(retry, 'a failed load offers a retry');
    press(retry);
    await settle();
    assert.equal(n, 2);
    assert.ok(root().querySelector('table [data-key="u1"]'));
    assert.notEqual(active(), doc().body, 'focus is not lost to <body>');
  });
});

/* ── 38: the filters keep focus through their own reload ────────────────── */

describe('users — search and the role filter keep focus (38)', () => {
  test('changing the role keeps focus on the select, so the next ArrowDown works', async () => {
    const s = server(() => ({ status: 200, body: { users: [RAHIM], truncated: false } }));
    mount(s);
    await settle();
    const sel = root().querySelector('select[name="role"]') as HTMLSelectElement;
    sel.focus();
    sel.value = 'principal';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    const now = root().querySelector('select[name="role"]') as HTMLSelectElement;
    assert.equal(now, sel, 'the band is kept through the reload, not rebuilt');
    assert.equal(active(), now);
    assert.equal(now.value, 'principal');
    assert.match(s.calls.at(-1)?.url ?? '', /role=principal/);
  });

  test('searching with Enter keeps focus in the search box', async () => {
    const s = server(() => ({ status: 200, body: { users: [RAHIM], truncated: false } }));
    mount(s);
    await settle();
    const input = root().querySelector('input[name="q"]') as HTMLInputElement;
    input.focus();
    input.value = 'রহিম';
    (input.form as HTMLFormElement).requestSubmit();
    await settle();
    const now = root().querySelector('input[name="q"]') as HTMLInputElement;
    assert.equal(active(), now);
    assert.equal(now.value, 'রহিম');
  });

  test('a name typed while the list is loading survives the list arriving', async () => {
    const s = server(() => ({ status: 200, body: { users: [RAHIM], truncated: false } }));
    s.holdLists();
    mount(s);
    await settle();
    const input = root().querySelector('input[name="q"]') as HTMLInputElement;
    input.focus();
    input.value = 'কর';
    const blurs = watchFocus(input);
    s.release();
    await settle();
    assert.ok(root().querySelector('table [data-key="u1"]'), 'the list arrived');
    assert.equal(root().querySelector('input[name="q"]'), input, 'the box was not rebuilt');
    assert.deepEqual(blurs(), { detached: 0, refocused: 0 }, 'nor taken out of the page and put back');
    assert.equal(input.value, 'কর', 'the half-typed name is still there');
    assert.equal(active(), input);
  });

  test('two quick role changes: the list is the LAST role’s, whichever answer comes last', async () => {
    const PRINCIPAL = { ...KARIM, id: 'u9', nameBn: 'প্রধান', roles: ['principal'] };
    const ACCOUNTANT = { ...KARIM, id: 'u8', nameBn: 'হিসাব', roles: ['accountant'] };
    const pending: Array<{ url: string; answer: () => void }> = [];
    const auth = {
      tenantId: 't-1', role: 'it_admin',
      authedFetch: (url: string) => new Promise<Response>((resolve) => {
        const users = url.includes('role=principal') ? [PRINCIPAL]
          : url.includes('role=accountant') ? [ACCOUNTANT] : [RAHIM, KARIM];
        const answer = () => resolve({
          ok: true, status: 200, json: async () => ({ users, truncated: false }),
        } as unknown as Response);
        pending.push({ url, answer });
      }),
    };
    new UsersView({ root: root(), doc: doc(), auth: auth as never, canManage: true });
    pending.shift()!.answer();
    await settle();
    const sel = root().querySelector('select[name="role"]') as HTMLSelectElement;
    sel.focus();
    for (const v of ['principal', 'accountant']) {
      sel.value = v;
      sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }
    assert.deepEqual(pending.map((p) => /role=(\w+)/.exec(p.url)?.[1]), ['principal', 'accountant']);
    const [first, second] = pending.splice(0);
    second.answer();
    await settle();
    first.answer();
    await settle();
    assert.equal(sel.value, 'accountant');
    assert.ok(root().querySelector('table [data-key="u8"]'), 'the accountant is listed');
    assert.equal(root().querySelector('[data-key="u9"]'), null,
      'the slower, older answer did not replace the list under the select');
    assert.equal(active(), sel);
  });
});
