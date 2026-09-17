/**
 * UX sweep, round 3 — group "assignments-staff"
 * (apps/pwa/src/assignments-view.ts, apps/pwa/src/staff-attendance-view.ts).
 *
 *   1  assignments-view put focus on the page's h1 by giving it tabindex -1
 *      and nothing else. The global `[tabindex]:focus-visible` rule then drew
 *      a 2px accent box round the whole title row (~990px at 1280), where the
 *      shell's keeper and learn draw the light landing style, and the
 *      tabindex stayed on the h1 after focus left. The title is now a landing
 *      exactly as ui/dom.ts makes one: tabindex -1 and LANDING_CLASS, both
 *      only while it holds focus.
 *   2  #/staffattendance opened by a guardian or a student still drew the date
 *      picker and its help line ("অন্য দিনের হাজিরা দেখতে বা সংশোধন করতে তারিখ
 *      বদলান।") above "শিক্ষকদের হাজিরা এই অ্যাকাউন্ট থেকে দেখা যায় না।". A
 *      reader who cannot see the register gets no picker, no help line and
 *      no day for a register to belong to.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { AssignmentsView } from '../src/assignments-view.ts';
import { StaffAttendanceView } from '../src/staff-attendance-view.ts';
import { keepFocusWithin, focusIsLost, LANDING_CLASS } from '../src/ui/dom.ts';

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
const h1 = () => root().querySelector('h1') as HTMLElement;
const soon = () => new Date(Date.now() + 2 * 864e5).toISOString();

type Res = { ok: boolean; status: number; json: () => Promise<unknown> };
const res = (status: number, body: unknown): Res =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

/** Enter on a button: the browser fires click on the focused control. */
function press(b: HTMLElement): void { b.focus(); b.click(); }

async function withKeeper(fn: () => Promise<void>): Promise<void> {
  const stop = keepFocusWithin(root());
  try { await fn(); } finally { stop(); }
}

/** A landing, as ui/dom.ts makes one: focusable, out of the Tab order, light style. */
function assertLanding(node: HTMLElement, what: string): void {
  assert.equal(node.getAttribute('tabindex'), '-1', `${what}: focusable, out of the Tab order`);
  assert.ok(node.classList.contains(LANDING_CLASS), `${what}: carries ${LANDING_CLASS}, not the global ring`);
}
function assertNotLanding(node: HTMLElement, what: string): void {
  assert.equal(node.hasAttribute('tabindex'), false, `${what}: no tabindex left behind`);
  assert.equal(node.classList.contains(LANDING_CLASS), false, `${what}: no landing class left behind`);
}

/* ══ 1. assignments: the title is a landing ═══════════════════════════════ */

const item = (id: string, title: string) => ({
  id, titleBn: title, dueAt: soon(), status: 'open', maxMarks: '10.00',
  subjectBn: 'গণিত', sectionName: 'ক', submissionCount: 1, ungradedCount: 1, mySubmission: null,
});
const LIST = () => [item('a-1', 'অনুশীলনী ১'), item('a-2', 'উৎপাদক বিশ্লেষণ')];
const detail = (id: string, title: string) => ({
  assignment: {
    id, titleBn: title, instructionsBn: null, maxMarks: '10.00', dueAt: soon(),
    allowsLate: true, status: 'open', subjectBn: 'গণিত', sectionName: 'ক',
  },
  submissions: [],
});

type Fetch = (url: string) => Res | Promise<Res>;

function mountAssignments(role: string, fetch: Fetch) {
  const auth = { role, userId: 'u-1', authedFetch: async (url: string) => fetch(url) } as never;
  const outbox = { enqueue: async () => ({ opId: 'op' }), flush: async () => {} } as never;
  return new AssignmentsView({ root: root(), doc: doc(), auth, outbox });
}

const standard: Fetch = (url) => {
  if (url.includes('assignmentId=')) return res(200, detail('a-2', 'উৎপাদক বিশ্লেষণ'));
  return res(200, { assignments: LIST() });
};

function rowOpen(id: string, shape: 'ui-list-hit' | 'ui-row-open'): HTMLButtonElement {
  const host = [...root().querySelectorAll<HTMLElement>('[data-key]')]
    .find((n) => n.dataset.key === id && n.querySelector(`button.${shape}`));
  assert.ok(host, `row ${id} is drawn with a ${shape}`);
  return host!.querySelector(`button.${shape}`) as HTMLButtonElement;
}
const backLinkEl = () => root().querySelector('button.ui-back') as HTMLButtonElement;

describe('assignments: the focused title is a landing, not a ringed box (round 3, item 1)', () => {
  test('the class the view uses is the one app.css gives the light landing style', () => {
    assert.equal(LANDING_CLASS, 'ui-focus-landing');
    const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
    const rule = css.match(/\.ui-focus-landing\[tabindex\]:focus-visible\s*\{([^}]*)\}/);
    assert.ok(rule, 'app.css styles the landing class');
    assert.match(rule![1], /outline:\s*none/, 'and that style replaces the accent ring');
  });

  for (const keeper of [true, false]) {
    test(`opening an assignment: the detail's h1 is a landing while it holds focus${keeper ? ' (keeper armed)' : ''}`, async () => {
      const run = async () => {
        const view = mountAssignments('class_teacher', standard);
        await settle();
        press(rowOpen('a-2', 'ui-row-open'));
        await settle();
        assert.equal(h1().textContent, 'উৎপাদক বিশ্লেষণ', 'the detail is open');
        assert.equal(active(), h1(), 'focus is on the title');
        assertLanding(h1(), 'the focused title');
        assert.equal(focusIsLost(doc()), false, 'a landing the view chose is not lost focus');
        view.destroy();
      };
      if (keeper) await withKeeper(run); else await run();
    });
  }

  for (const keeper of [true, false]) {
    test(`once focus leaves the title, its tabindex and class go with it${keeper ? ' (keeper armed)' : ''}`, async () => {
      const run = async () => {
        const view = mountAssignments('student', standard);
        await settle();
        press(rowOpen('a-2', 'ui-list-hit'));
        await settle();
        const title = h1();
        assert.equal(active(), title);
        backLinkEl().focus();   // Shift+Tab to "সব কাজ"
        assert.equal(active(), backLinkEl());
        assert.equal(h1(), title, 'the same title is still on the page');
        assertNotLanding(title, 'the title after focus left');
        view.destroy();
      };
      if (keeper) await withKeeper(run); else await run();
    });
  }

  test('while the assignment loads, the title over the skeleton is a landing, and so is the loaded one', async () => {
    await withKeeper(async () => {
      const read = deferred<Res>();
      const view = mountAssignments('student', (url) => url.includes('assignmentId=') ? read.promise : standard(url));
      await settle();
      press(rowOpen('a-2', 'ui-list-hit'));
      await settle();
      assert.ok(root().querySelector('.is-skeleton'), 'still loading');
      assert.equal(active(), h1());
      assertLanding(h1(), 'the loading title');

      read.resolve(res(200, detail('a-2', 'উৎপাদক বিশ্লেষণ')));
      await settle();
      assert.equal(h1().textContent, 'উৎপাদক বিশ্লেষণ');
      assert.equal(active(), h1());
      assertLanding(h1(), 'the loaded title');
      view.destroy();
    });
  });

  test('a list that could be read on retry lands on the list title the same way', async () => {
    await withKeeper(async () => {
      const next = deferred<Res>();
      let reads = 0;
      const view = mountAssignments('student', () => {
        reads += 1;
        if (reads === 1) throw new TypeError('Failed to fetch');
        return next.promise;
      });
      await settle();
      const again = root().querySelector('.ui-state-error .ui-state-action') as HTMLButtonElement;
      assert.ok(again, 'nothing cached: the error card');
      press(again);
      await settle();
      assert.equal(active(), h1(), 'the title holds focus over the skeleton');
      assertLanding(h1(), 'the list title over the skeleton');
      next.resolve(res(200, { assignments: LIST() }));
      await settle();
      assert.ok(root().querySelector('[data-key="a-1"]'), 'the list is on screen');
      assert.equal(active(), h1());
      assertLanding(h1(), 'the list title');
      view.destroy();
    });
  });

  test('a blur while the title is still focused (the window lost focus) keeps the landing', async () => {
    const view = mountAssignments('student', standard);
    await settle();
    press(rowOpen('a-2', 'ui-list-hit'));
    await settle();
    assert.equal(active(), h1());
    // Another app took the window: blur reaches the element, activeElement does not change.
    h1().dispatchEvent(new dom.window.FocusEvent('blur'));
    assert.equal(active(), h1());
    assertLanding(h1(), 'the title when the window comes back');
    view.destroy();
  });

  test('a title that refuses focus is left as it was drawn', async () => {
    const proto = dom.window.HTMLElement.prototype;
    const real = proto.focus;
    proto.focus = function (this: HTMLElement, o?: FocusOptions) {
      if (this.tagName === 'H1') return;
      real.call(this, o);
    };
    try {
      const view = mountAssignments('student', standard);
      await settle();
      press(rowOpen('a-2', 'ui-list-hit'));
      await settle();
      assert.equal(h1().textContent, 'উৎপাদক বিশ্লেষণ');
      assert.notEqual(active(), h1());
      assertNotLanding(h1(), 'a title that never took focus');
      view.destroy();
    } finally { proto.focus = real; }
  });

  test('the row focus returns to on the list is a control, not a landing', async () => {
    const view = mountAssignments('student', standard);
    await settle();
    press(rowOpen('a-2', 'ui-list-hit'));
    await settle();
    press(backLinkEl());
    await settle();
    const row = rowOpen('a-2', 'ui-list-hit');
    assert.equal(active(), row);
    assert.equal(row.classList.contains(LANDING_CLASS), false);
    assertNotLanding(h1(), 'the list title nobody focused');
    view.destroy();
  });
});

/* ══ 2. staff attendance: no picker for a reader who cannot see the register ═ */

const HELP = 'অন্য দিনের হাজিরা দেখতে বা সংশোধন করতে তারিখ বদলান।';
const FAMILY_MESSAGE = 'শিক্ষকদের হাজিরা এই অ্যাকাউন্ট থেকে দেখা যায় না।';

const register = (canMark: boolean, teachers: unknown[]) => ({
  date: '2026-09-17', canMark, total: teachers.length, marked: 0, away: 0, teachers,
});
const TEACHER = {
  teacherId: 't-1', name: { bn: 'রহিম উদ্দিন', en: null }, roleCode: 'subject_teacher',
  status: null, reason: null, markedAt: null, markedBy: null,
};

function mountStaff(role: string, fetch: () => Res | Promise<Res>) {
  const auth = { role, userId: 'u-1', authedFetch: async () => fetch() } as never;
  return new StaffAttendanceView({ root: root(), doc: doc(), auth });
}

const picker = () => root().querySelector('input[name="date"]');
const headerDay = () => root().querySelector('time.staff-att-date-text');
const text = () => root().textContent ?? '';

describe('staff attendance: a family gets no date picker and no help line (round 3, item 2)', () => {
  for (const role of ['guardian', 'student']) {
    test(`${role}: none while the register is read, and none beside the answer`, async () => {
      const read = deferred<Res>();
      mountStaff(role, () => read.promise);
      assert.equal(picker(), null, 'no date picker over the skeleton');
      assert.equal(root().querySelector('.staff-att-date'), null);
      assert.doesNotMatch(text(), new RegExp(HELP), 'no help line over the skeleton');

      read.resolve(res(200, register(false, [])));
      await settle();
      assert.match(text(), new RegExp(FAMILY_MESSAGE), 'the sentence that is true for them');
      assert.equal(picker(), null, 'no date picker beside it');
      assert.equal(root().querySelector('.staff-att-date'), null);
      assert.doesNotMatch(text(), new RegExp(HELP), 'no promise to see or correct another day');
      assert.doesNotMatch(text(), /তারিখ/, 'no date label either');
      assert.equal(headerDay(), null, 'no day for a register they cannot see');
      assert.equal(h1().textContent, 'শিক্ষক হাজিরা', 'the page is still named');
    });
  }

  test('a family whose read failed gets the retry, still without a picker', async () => {
    mountStaff('guardian', () => { throw new TypeError('Failed to fetch'); });
    await settle();
    assert.ok(root().querySelector('.ui-state-error'), 'the error card');
    assert.equal(picker(), null);
    assert.doesNotMatch(text(), new RegExp(HELP));
  });

  test('a principal still gets the picker, its help line and the day', async () => {
    mountStaff('principal', () => res(200, register(true, [TEACHER])));
    assert.ok(picker(), 'the picker is there while the register is read');
    await settle();
    assert.ok(root().querySelector('.staff-att-table'), 'the register');
    assert.ok(picker(), 'the picker');
    assert.match(text(), new RegExp(HELP), 'its help line');
    assert.ok(headerDay(), 'the day in the title bar');
  });

  test('read-only staff (a class teacher) still get the picker to read another day', async () => {
    mountStaff('class_teacher', () => res(200, register(false, [TEACHER])));
    await settle();
    assert.ok(root().querySelector('.staff-att-table'));
    assert.ok(picker());
    assert.match(text(), new RegExp(HELP));
    assert.ok(headerDay());
  });

  test('staff with a register that really is empty keep the picker and are told no teachers were added', async () => {
    mountStaff('principal', () => res(200, register(true, [])));
    await settle();
    assert.match(text(), /এই প্রতিষ্ঠানে এখনো কোনো শিক্ষক যোগ করা হয়নি।/);
    assert.ok(picker());
  });

  test('a refusal still draws no picker', async () => {
    mountStaff('accountant', () => res(403, { message: 'no' }));
    await settle();
    assert.equal(picker(), null);
    assert.equal(headerDay(), null);
  });
});
