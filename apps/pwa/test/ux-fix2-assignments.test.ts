/**
 * UX sweep, round 2 — group "assignments" (apps/pwa/src/assignments-view.ts).
 *
 * Finding 67 (assignments part) and finding 12 (assignments part), with R8:
 * opening an assignment and the "সব কাজ" back link each delete the control
 * that was pressed. The shell's focus keeper can only bring focus back to the
 * same control, which is not on the new page, so focus waited on
 * main#shell-view: no ring, nothing announced. Now opening lands on the
 * detail's title, and going back lands on the row that was opened.
 *
 * The view is mounted the way app.ts mounts it — its root IS main#shell-view,
 * the keeper's container — and most cases run with the keeper armed, as in
 * the app, because the keeper is what parked focus on <main>.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AssignmentsView } from '../src/assignments-view.ts';
import { keepFocusWithin, focusIsLost } from '../src/ui/dom.ts';

let dom: JSDOM;
const doc = () => dom.window.document;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="shell-view"></main></body></html>',
    { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
});

beforeEach(() => {
  doc().body.innerHTML = '<nav><button id="nav-home" type="button">হোম</button></nav><main id="shell-view"></main>';
  localStorage.clear();
  Object.defineProperty(dom.window.navigator, 'onLine', { value: true, configurable: true });
});

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const root = () => doc().getElementById('shell-view') as HTMLElement;
const active = () => doc().activeElement as HTMLElement;
const soon = () => new Date(Date.now() + 2 * 864e5).toISOString();

type Res = { ok: boolean; status: number; json: () => Promise<unknown> };
const res = (status: number, body: unknown): Res =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body });

const item = (id: string, title: string, mine: unknown = null) => ({
  id, titleBn: title, dueAt: soon(), status: 'open', maxMarks: '10.00',
  subjectBn: 'গণিত', sectionName: 'ক', submissionCount: 1, ungradedCount: 1, mySubmission: mine,
});
const LIST = () => [item('a-1', 'অনুশীলনী ১'), item('a-2', 'উৎপাদক বিশ্লেষণ'), item('a-3', 'অনুশীলনী ৩')];

const detail = (id: string, title: string) => ({
  assignment: {
    id, titleBn: title, instructionsBn: null, maxMarks: '10.00', dueAt: soon(),
    allowsLate: true, status: 'open', subjectBn: 'গণিত', sectionName: 'ক',
  },
  submissions: [],
});

/** A request the test answers when it chooses to. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

type Fetch = (url: string) => Res | Promise<Res>;

function mount(role: string, fetch: Fetch) {
  const auth = { role, userId: 'u-1', authedFetch: async (url: string) => fetch(url) } as never;
  const outbox = { enqueue: async () => ({ opId: 'op' }), flush: async () => {} } as never;
  return new AssignmentsView({ root: root(), doc: doc(), auth, outbox });
}

const standard: Fetch = (url) => {
  if (url.includes('assignmentId=a-2')) return res(200, detail('a-2', 'উৎপাদক বিশ্লেষণ'));
  if (url.includes('assignmentId=')) return res(200, detail('a-1', 'অনুশীলনী ১'));
  return res(200, { assignments: LIST() });
};

/** A row's open control, in the phone shape or the desktop table's chevron. */
function rowOpen(id: string, shape: 'ui-list-hit' | 'ui-row-open'): HTMLButtonElement {
  const host = [...root().querySelectorAll<HTMLElement>('[data-key]')]
    .find((n) => n.dataset.key === id && n.querySelector(`button.${shape}`));
  assert.ok(host, `row ${id} is drawn with a ${shape}`);
  return host!.querySelector(`button.${shape}`) as HTMLButtonElement;
}
const backLinkEl = () => root().querySelector('button.ui-back') as HTMLButtonElement;
const h1 = () => root().querySelector('h1') as HTMLElement;
/** Enter on a button: the browser fires click on the focused control. */
function press(b: HTMLElement): void { b.focus(); b.click(); }

/** Run with the shell's keeper armed, as in the app. */
async function withKeeper(fn: () => Promise<void>): Promise<void> {
  const stop = keepFocusWithin(root());
  try { await fn(); } finally { stop(); }
}

/* ── opening an assignment ────────────────────────────────────────────── */

describe('opening an assignment puts focus on its title (finding 67, 12, R8)', () => {
  for (const keeper of [true, false]) {
    test(`Enter on a phone row lands on the detail's h1, not <main>${keeper ? ' (keeper armed)' : ''}`, async () => {
      const run = async () => {
        const view = mount('student', standard);
        await settle();
        press(rowOpen('a-2', 'ui-list-hit'));
        await settle();
        assert.equal(h1().textContent, 'উৎপাদক বিশ্লেষণ', 'the detail is open');
        assert.equal(active(), h1(), 'focus is on the opened page\'s title');
        assert.notEqual(active(), root(), 'not parked on main#shell-view');
        assert.equal(focusIsLost(doc()), false, 'the page\'s own test says focus is not lost');
        assert.equal(h1().getAttribute('tabindex'), '-1', 'focusable, and out of the Tab order');
        view.destroy();
      };
      if (keeper) await withKeeper(run); else await run();
    });
  }

  test('while the assignment loads, focus waits on the title, not on <main>', async () => {
    await withKeeper(async () => {
      const read = deferred<Res>();
      const view = mount('student', (url) => url.includes('assignmentId=') ? read.promise : standard(url));
      await settle();
      press(rowOpen('a-2', 'ui-row-open'));
      await settle();
      assert.ok(root().querySelector('.is-skeleton'), 'still loading');
      assert.equal(active(), h1(), 'the loading title holds focus');
      assert.notEqual(active(), root());

      read.resolve(res(200, detail('a-2', 'উৎপাদক বিশ্লেষণ')));
      await settle();
      assert.equal(h1().textContent, 'উৎপাদক বিশ্লেষণ');
      assert.equal(active(), h1(), 'and moves to the loaded title');
      view.destroy();
    });
  });

  test('focus the person moved while it loaded is left where they put it', async () => {
    await withKeeper(async () => {
      const read = deferred<Res>();
      const view = mount('student', (url) => url.includes('assignmentId=') ? read.promise : standard(url));
      await settle();
      press(rowOpen('a-2', 'ui-list-hit'));
      await settle();
      backLinkEl().focus();   // Shift+Tab to "সব কাজ" during a slow read
      read.resolve(res(200, detail('a-2', 'উৎপাদক বিশ্লেষণ')));
      await settle();
      assert.equal(h1().textContent, 'উৎপাদক বিশ্লেষণ');
      assert.equal(active(), backLinkEl(), 'still on the back link, not pulled to the title');
      view.destroy();
    });
  });

  test('a press while focus is outside the screen does not pull focus in', async () => {
    const read = deferred<Res>();
    const view = mount('student', (url) => url.includes('assignmentId=') ? read.promise : standard(url));
    await settle();
    const nav = doc().getElementById('nav-home') as HTMLButtonElement;
    nav.focus();
    rowOpen('a-2', 'ui-list-hit').click();
    await settle();
    assert.equal(active(), nav, 'focus stays in the shell\'s nav while it loads');
    // The shell's own focus leaves the nav (a drawer closing) during the read:
    // that is the shell's business, not a reason for this screen to take it.
    nav.blur();
    read.resolve(res(200, detail('a-2', 'উৎপাদক বিশ্লেষণ')));
    await settle();
    assert.equal(h1().textContent, 'উৎপাদক বিশ্লেষণ');
    assert.equal(active(), doc().body, 'the screen did not claim focus it never had');
    view.destroy();
  });

  test('a re-read on reconnect leaves focus alone', async () => {
    await withKeeper(async () => {
      let up = false;
      const view = mount('student', (url) => {
        if (url.includes('assignmentId=') && !up) throw new TypeError('Failed to fetch');
        return standard(url);
      });
      await settle();
      press(rowOpen('a-2', 'ui-list-hit'));
      await settle();
      assert.ok(root().querySelector('.ui-state-error'), 'the read failed');
      backLinkEl().focus();
      up = true;
      dom.window.dispatchEvent(new dom.window.Event('online'));
      await settle();
      assert.equal(h1().textContent, 'উৎপাদক বিশ্লেষণ', 'reloaded on its own');
      assert.equal(active(), backLinkEl(), 'nobody pressed anything, so focus did not move');
      view.destroy();
    });
  });

  test('retrying a failed read: a second failure lands on the retry, a success on the title', async () => {
    await withKeeper(async () => {
      let fails = 2;
      const view = mount('student', (url) => {
        if (url.includes('assignmentId=') && fails-- > 0) throw new TypeError('Failed to fetch');
        return standard(url);
      });
      await settle();
      press(rowOpen('a-2', 'ui-list-hit'));
      await settle();
      assert.equal(active(), h1(), 'a failed open still lands on the page title');

      const again = () => root().querySelector('.ui-state-error .ui-state-action') as HTMLButtonElement;
      const first = again();
      press(first);
      await settle();
      assert.notEqual(again(), first, 'the error card was drawn again');
      assert.equal(active(), again(), 'failed again: on the new retry, ready to press again');

      press(again());
      await settle();
      assert.equal(h1().textContent, 'উৎপাদক বিশ্লেষণ');
      assert.equal(active(), h1(), 'it worked: on the title');
      view.destroy();
    });
  });
});

/* ── going back ───────────────────────────────────────────────────────── */

describe('"সব কাজ" returns focus to the row that was opened (finding 67, 12, R8)', () => {
  for (const keeper of [true, false]) {
    test(`phone row: back lands on the same row's button${keeper ? ' (keeper armed)' : ''}`, async () => {
      const run = async () => {
        const view = mount('student', standard);
        await settle();
        press(rowOpen('a-2', 'ui-list-hit'));
        await settle();
        press(backLinkEl());
        await settle();
        assert.equal(h1().textContent, 'বাড়ির কাজ', 'the list is back');
        assert.equal(active(), rowOpen('a-2', 'ui-list-hit'), 'on the row that was opened — not row 1, not <main>');
        assert.equal(focusIsLost(doc()), false);
        view.destroy();
      };
      if (keeper) await withKeeper(run); else await run();
    });
  }

  test('desktop table: back lands on that row\'s chevron, the shape it was opened from', async () => {
    await withKeeper(async () => {
      const view = mount('student', standard);
      await settle();
      press(rowOpen('a-2', 'ui-row-open'));
      await settle();
      press(backLinkEl());
      await settle();
      assert.equal(active(), rowOpen('a-2', 'ui-row-open'));
      view.destroy();
    });
  });

  test('the teacher\'s back link does the same (R8, 1280)', async () => {
    await withKeeper(async () => {
      const view = mount('class_teacher', standard);
      await settle();
      // The teacher's default tab is "জমা দেখা বাকি"; every row here has one unmarked.
      press(rowOpen('a-3', 'ui-row-open'));
      await settle();
      press(backLinkEl());
      await settle();
      assert.equal(active(), rowOpen('a-3', 'ui-row-open'));
      view.destroy();
    });
  });

  test('a hidden shape refuses focus, and the visible one takes it', async () => {
    // Opened by a tap that did not focus the row (focus on <body>), so the
    // shape is not known; below 1024px the table's chevron is display:none.
    const proto = dom.window.HTMLElement.prototype;
    const real = proto.focus;
    proto.focus = function (this: HTMLElement, o?: FocusOptions) {
      if (this.classList.contains('ui-row-open')) return;
      real.call(this, o);
    };
    try {
      const view = mount('student', standard);
      await settle();
      rowOpen('a-2', 'ui-list-hit').click();
      await settle();
      assert.equal(active(), h1(), 'a tap opens onto the title too');
      press(backLinkEl());
      await settle();
      assert.equal(active(), rowOpen('a-2', 'ui-list-hit'));
      view.destroy();
    } finally { proto.focus = real; }
  });

  test('the list is drawn at once and read again: focus stays on that row through the re-read', async () => {
    // Without the keeper: the view itself carries focus across the rebuild.
    const list = deferred<Res>();
    let reads = 0;
    const view = mount('student', (url) => {
      if (url.includes('assignmentId=')) return standard(url);
      reads += 1;
      return reads === 1 ? res(200, { assignments: LIST() }) : list.promise;
    });
    await settle();
    press(rowOpen('a-2', 'ui-list-hit'));
    await settle();
    press(backLinkEl());
    await settle();
    assert.equal(reads, 2, 'the list is being read again');
    const first = rowOpen('a-2', 'ui-list-hit');
    assert.equal(active(), first, 'on the row while the list is re-read');

    list.resolve(res(200, { assignments: LIST() }));
    await settle();
    assert.notEqual(rowOpen('a-2', 'ui-list-hit'), first, 'the list was rebuilt');
    assert.equal(active(), rowOpen('a-2', 'ui-list-hit'), 'and focus is on the rebuilt row');
    view.destroy();
  });

  test('a row that has left the tab (just submitted) falls back to the list title', async () => {
    await withKeeper(async () => {
      let submitted = false;
      const view = mount('student', (url) => {
        if (url.includes('assignmentId=')) return standard(url);
        const rows = LIST();
        if (submitted) rows[1] = item('a-2', 'উৎপাদক বিশ্লেষণ', { submittedAt: soon(), marksAwarded: null, gradedAt: null });
        return res(200, { assignments: rows });
      });
      await settle();
      press(rowOpen('a-2', 'ui-list-hit'));
      await settle();
      submitted = true;
      localStorage.clear();
      press(backLinkEl());
      await settle();
      assert.equal(root().querySelector('[data-key="a-2"]'), null, 'a-2 is under "জমা দিয়েছি" now');
      assert.equal(active(), h1(), 'on the list title, not another assignment\'s row');
      view.destroy();
    });
  });

  test('a read that resolves after the screen is gone moves no focus', async () => {
    const list = deferred<Res>();
    let reads = 0;
    const view = mount('student', (url) => {
      if (url.includes('assignmentId=')) return standard(url);
      reads += 1;
      return reads === 1 ? res(200, { assignments: LIST() }) : list.promise;
    });
    await settle();
    press(rowOpen('a-2', 'ui-list-hit'));
    await settle();
    press(backLinkEl());
    await settle();
    view.destroy();
    active().blur();
    assert.equal(active(), doc().body, 'focus is lost, which is when a goal would act');
    list.resolve(res(200, { assignments: LIST() }));
    await settle();
    assert.equal(active(), doc().body, 'an unmounted screen does not take focus');
  });
});

/* ── retrying the list ─────────────────────────────────────────────────── */

describe('retrying a list that could not be read (finding 12)', () => {
  test('the title holds focus over the skeleton; a second failure lands on the retry, a success on the title', async () => {
    await withKeeper(async () => {
      let next = deferred<Res>();
      let reads = 0;
      const view = mount('student', () => {
        reads += 1;
        if (reads === 1) throw new TypeError('Failed to fetch');
        return next.promise;
      });
      await settle();
      const again = () => root().querySelector('.ui-state-error .ui-state-action') as HTMLButtonElement;
      assert.ok(again(), 'nothing cached: the error card');

      press(again());
      await settle();
      assert.ok(root().querySelector('.is-skeleton'), 'loading');
      assert.equal(active(), h1(), 'the title holds focus over the skeleton, not <main>');
      next.reject(new TypeError('Failed to fetch'));
      await settle();
      assert.equal(active(), again(), 'failed again: on the retry');

      next = deferred<Res>();
      press(again());
      await settle();
      next.resolve(res(200, { assignments: LIST() }));
      await settle();
      assert.ok(root().querySelector('[data-key="a-1"]'), 'the list is on screen');
      assert.equal(active(), h1(), 'it worked: on the title');
      view.destroy();
    });
  });
});

/* ── the empty tab's way out ──────────────────────────────────────────── */

describe('the empty state\'s "show the other tab" lands on that tab (finding 12)', () => {
  test('focus goes to the tab it selected, not <main>', async () => {
    await withKeeper(async () => {
      const done = { submittedAt: soon(), marksAwarded: null, gradedAt: null };
      const view = mount('student', () => res(200, { assignments: [item('a-1', 'অনুশীলনী ১', done)] }));
      await settle();
      const action = root().querySelector('.ui-state-empty button') as HTMLButtonElement;
      assert.ok(action, '"জমা দিতে হবে" is empty and offers the next tab');
      press(action);
      await settle();
      const tab = root().querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
      assert.equal(tab.dataset.id, 'submitted');
      assert.equal(active(), tab, 'on the tab now showing');
      view.destroy();
    });
  });
});
