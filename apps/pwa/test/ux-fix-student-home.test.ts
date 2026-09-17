/**
 * ux-fix 65 — the student home must never state a false "nothing today".
 *
 * When `/academics/myroutine` or `/academics/next` did not answer (offline
 * with nothing cached, a 5xx during a deploy, a body that would not parse),
 * the screen turned the null into an empty list and said "আজ কোনো ক্লাস
 * নেই।", read ০ for today's classes and "এই মুহূর্তে জমা দেওয়ার কিছু নেই।" —
 * the same screen as a holiday. A student could skip class or homework on it.
 * The whole-screen error it had for "everything failed" was dead code, and
 * nothing reloaded when the connection came back.
 *
 * What is pinned here:
 *   * a failed block says it could not be read, with a retry, and never its
 *     empty sentence; the figure it feeds reads "—", not ০;
 *   * a failure is not a refusal and not an empty answer;
 *   * when every drawn block failed, one error stands for the screen;
 *   * retry and the connection coming back both ask again;
 *   * a screen the shell has already replaced never paints over the next one.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { StudentHomeView } from '../src/student-home-view.ts';

let dom: JSDOM;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
                  { url: 'http://localhost/' });
  (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true }, configurable: true, writable: true,
  });
});

const setOnline = (on: boolean) => {
  (globalThis.navigator as { onLine: boolean }).onLine = on;
};

const SLOTS = [
  { slotId: 'a', periodNo: 1, startsAt: '08:00', endsAt: '08:45',
    subjectBn: 'বাংলা', roomCode: '১০১', teacherNameBn: 'নাজমা', isSubstitution: false },
  { slotId: 'b', periodNo: 2, startsAt: '11:00', endsAt: '11:45',
    subjectBn: 'গণিত', roomCode: '১০২', teacherNameBn: 'রফিক', isSubstitution: false },
];
const DUE = [
  { kind: 'assignment', titleBn: 'গণিত — অনুশীলনী ৪.২', whyBn: 'আজই জমা দিতে হবে',
    route: 'assignments', refId: 'a1', urgency: 'high' },
  { kind: 'redo_practice', titleBn: 'ভগ্নাংশ', whyBn: 'আবার চেষ্টা করো',
    route: 'learn', refId: 't1', urgency: 'medium' },
];
const AT_1115 = () => new Date('2026-09-01T11:15:00');

/** How one endpoint answers: a body, a status, a throw, or unparseable JSON. */
type Answer = unknown | { __status: number } | 'throw' | 'badjson';

const OK: Record<string, Answer> = {
  myroutine: { slots: SLOTS },
  next: { suggestions: DUE },
  attendance: { totals: { present: 18, late: 0, absent: 1, excused: 0, halfDay: 0,
                          counted: 19, attendedPercent: 95 } },
  results: { results: [] },
  inbox: { notices: [], unread: 0 },
};

/** A stub whose answers can be changed between requests. */
function stubAuth(answers: Record<string, Answer>, seen: string[] = []) {
  return {
    authedFetch: async (url: string) => {
      seen.push(url);
      const key = Object.keys(answers).find((k) => url.includes(k));
      const a = key ? answers[key] : {};
      if (a === 'throw') throw new TypeError('Failed to fetch');
      if (a === 'badjson') {
        return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } } as unknown as Response;
      }
      const status = (a as { __status?: number } | null)?.__status;
      if (status) return { ok: false, status, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => a } as unknown as Response;
    },
  } as unknown as ConstructorParameters<typeof StudentHomeView>[0]['auth'];
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

async function mount(answers: Record<string, Answer>, seen: string[] = []) {
  const root = dom.window.document.getElementById('root') as HTMLElement;
  root.textContent = '';
  const view = new StudentHomeView({
    root, doc: dom.window.document, auth: stubAuth(answers, seen),
    displayName: 'রাফি', go: () => {}, now: AT_1115,
  });
  await settle();
  return { root, view };
}

function stat(root: HTMLElement, label: string): string | null | undefined {
  const cell = [...root.querySelectorAll('.sh-stats .ui-stat')]
    .find((c) => c.querySelector('.ui-stat-label')?.textContent === label);
  assert.ok(cell, `the "${label}" stat must exist`);
  return cell.querySelector('.ui-stat-value')?.textContent;
}

const retries = (el: Element) => [...el.querySelectorAll('button')]
  .filter((b) => b.textContent === 'আবার চেষ্টা করুন') as HTMLButtonElement[];

describe('ux-fix 65 — a failed block is not an empty day', () => {
  beforeEach(() => setOnline(true));

  test('a 5xx on the routine and the homework says so, not "no class" / "nothing due"', async () => {
    const { root } = await mount({ ...OK, myroutine: { __status: 503 }, next: { __status: 502 } });
    const text = root.textContent ?? '';
    assert.doesNotMatch(text, /আজ কোনো ক্লাস নেই/, 'a failed routine is not a day without classes');
    assert.doesNotMatch(text, /জমা দেওয়ার কিছু নেই/, 'a failed list is not "nothing to hand in"');
    assert.equal(root.querySelectorAll('.ui-state-empty').length, 0);

    const card = root.querySelector('.sh-now-empty .ui-state-error');
    assert.ok(card, 'the class card shows an error state');
    assert.match(card.textContent ?? '', /আজকের রুটিন আনা যায়নি।/);
    assert.match(card.textContent ?? '', /সার্ভারে সমস্যা হয়েছে/);
    assert.equal(retries(card).length, 1, 'the card offers a retry');

    const due = root.querySelector('section.sh-due') as HTMLElement;
    assert.ok(due, 'the due panel keeps its heading');
    const dueErr = due.querySelector('.ui-state-error');
    assert.ok(dueErr, 'the due panel shows an error state');
    assert.match(dueErr.textContent ?? '', /জমা দেওয়ার কাজের তালিকা আনা যায়নি।/);
    assert.equal(retries(dueErr).length, 1);

    assert.equal(stat(root, 'আজকের ক্লাস'), '—', 'an unknown count is not ০');
    assert.equal(stat(root, 'হাজিরা'), '৯৫%', 'the block that answered still shows');
    assert.equal(root.querySelector('.sh-day'), null, 'no empty or endless-skeleton timetable');
    assert.equal(root.querySelector('.sh-study'), null, 'no study list from a failed answer');
    assert.equal(root.querySelectorAll('[aria-busy="true"], .is-skeleton').length, 0, 'no skeleton left after boot');
    // Two retries on one screen go back to the one that was pressed.
    const keys = retries(root).map((b) => b.dataset.focusKey);
    assert.equal(new Set(keys).size, 2, 'each retry has its own focus key');
    assert.ok(keys.every(Boolean));
  });

  test('offline with nothing cached names the connection in the block', async () => {
    setOnline(false);
    const { root } = await mount({ ...OK, myroutine: 'throw', next: 'throw' });
    const card = root.querySelector('.sh-now-empty .ui-state-error');
    assert.ok(card);
    assert.match(card.textContent ?? '', /ইন্টারনেট সংযোগ নেই/);
    assert.doesNotMatch(root.textContent ?? '', /আজ কোনো ক্লাস নেই|জমা দেওয়ার কিছু নেই/);
  });

  test('an answer that will not parse is a failure too, not an empty list', async () => {
    const { root } = await mount({ ...OK, myroutine: 'badjson' });
    assert.ok(root.querySelector('.sh-now-empty .ui-state-error'));
    assert.doesNotMatch(root.textContent ?? '', /আজ কোনো ক্লাস নেই/);
    assert.equal(stat(root, 'আজকের ক্লাস'), '—');
  });

  test('a real empty day still says so — the fix does not hide a true holiday', async () => {
    const { root } = await mount({ ...OK, myroutine: { slots: [] }, next: { suggestions: [] } });
    assert.match(root.querySelector('.sh-now-empty')?.textContent ?? '', /আজ কোনো ক্লাস নেই/);
    assert.equal(stat(root, 'আজকের ক্লাস'), '০');
    assert.match(root.querySelector('.sh-due')?.textContent ?? '', /জমা দেওয়ার কিছু নেই/);
    assert.equal(root.querySelectorAll('.ui-state-error').length, 0);
  });

  test('a refusal stays a refusal beside a failure: no retry on the locked block', async () => {
    const { root } = await mount({
      ...OK, myroutine: { __status: 403 }, next: { __status: 500 },
    });
    const card = root.querySelector('.sh-now-empty');
    assert.ok(card?.querySelector('.ui-state-denied'));
    assert.equal(retries(card as Element).length, 0);
    assert.ok(root.querySelector('.sh-due .ui-state-error'));
  });

  test('every drawn block failed: one error stands for the screen', async () => {
    setOnline(false);
    const { root } = await mount({
      ...OK, myroutine: 'throw', next: 'throw', attendance: 'throw',
      // The inbox is not drawn on this screen, so its answer must not decide.
      inbox: { notices: [{ id: 'n1', titleBn: 'ছুটি', publishedAt: '2026-09-01', readAt: null }], unread: 1 },
    });
    assert.equal(root.querySelectorAll('.ui-state-error').length, 1);
    assert.equal(root.querySelector('.sh-now, .sh-now-empty, .sh-due, .sh-stats'), null);
    assert.match(root.textContent ?? '', /ইন্টারনেট সংযোগ নেই/);
    assert.equal(retries(root).length, 1);
    assert.equal(root.querySelectorAll('h1').length, 1);
  });
});

describe('ux-fix 65 — asking again', () => {
  beforeEach(() => setOnline(true));

  test('the block retry asks again and draws the answer', async () => {
    const answers = { ...OK, myroutine: { __status: 503 } as Answer };
    const seen: string[] = [];
    const { root } = await mount(answers, seen);
    const before = seen.filter((u) => u.includes('myroutine')).length;
    answers.myroutine = { slots: SLOTS };
    retries(root.querySelector('.sh-now-empty') as Element)[0].click();
    await settle();
    assert.equal(seen.filter((u) => u.includes('myroutine')).length, before + 1);
    assert.equal(root.querySelector('.sh-now h2')?.textContent, 'গণিত');
    assert.equal(stat(root, 'আজকের ক্লাস'), '২');
    assert.equal(root.querySelectorAll('.ui-state-error').length, 0);
  });

  test('the whole-screen retry recovers the whole screen', async () => {
    const answers: Record<string, Answer> = { ...OK, myroutine: 'throw', next: 'throw', attendance: 'throw' };
    const { root } = await mount(answers);
    Object.assign(answers, OK);
    retries(root)[0].click();
    await settle();
    assert.ok(root.querySelector('.sh-now'));
    assert.equal(root.querySelector('.sh-due .ui-list-title')?.textContent, 'গণিত — অনুশীলনী ৪.২');
    assert.equal(root.querySelectorAll('.ui-state-error').length, 0);
  });

  test('the connection coming back reloads a failed block by itself', async () => {
    setOnline(false);
    const answers: Record<string, Answer> = { ...OK, myroutine: 'throw', next: 'throw' };
    const { root } = await mount(answers);
    assert.ok(root.querySelector('.ui-state-error'));
    Object.assign(answers, OK);
    setOnline(true);
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await settle();
    assert.equal(root.querySelectorAll('.ui-state-error').length, 0);
    assert.equal(root.querySelector('.sh-now h2')?.textContent, 'গণিত');
    assert.equal(root.querySelectorAll('.sh-due .ui-list-item').length, 1);
  });

  test('coming back online with nothing failed does not refetch', async () => {
    const seen: string[] = [];
    await mount({ ...OK }, seen);
    const n = seen.length;
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await settle();
    assert.equal(seen.length, n);
  });

  test('a screen the shell replaced never reloads or paints into the next route', async () => {
    setOnline(false);
    const seen: string[] = [];
    const { root } = await mount({ ...OK, myroutine: 'throw', next: 'throw' }, seen);
    // The shell empties the same element and mounts another route into it.
    root.textContent = '';
    root.append(dom.window.document.createElement('section'));
    const n = seen.length;
    setOnline(true);
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await settle();
    assert.equal(seen.length, n, 'no request from a screen that is gone');
    assert.equal(root.querySelector('.page-header'), null);
    assert.equal(root.children.length, 1);
  });

  test('a replaced screen takes its online listener away with it', async () => {
    // The shell's home route keeps no instance to call destroy() on, so each
    // visit home would otherwise leave one more listener on the window.
    setOnline(false);
    const { root, view } = await mount({ ...OK, myroutine: 'throw' });
    root.textContent = '';
    root.append(dom.window.document.createElement('section'));
    const removed: unknown[] = [];
    const win = dom.window as unknown as { removeEventListener: (...a: unknown[]) => void };
    const original = win.removeEventListener;
    win.removeEventListener = function (this: unknown, ...a: unknown[]) {
      removed.push(a[1]);
      return original.apply(this, a as never);
    };
    try {
      setOnline(true);
      dom.window.dispatchEvent(new dom.window.Event('online'));
      await settle();
    } finally {
      win.removeEventListener = original;
    }
    const listener = (view as unknown as { onOnline: unknown }).onOnline;
    assert.ok(removed.includes(listener), 'the stale screen detached its own listener');
  });

  test('a slow answer that lands after navigation does not paint over the next route', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const root = dom.window.document.getElementById('root') as HTMLElement;
    root.textContent = '';
    const auth = {
      authedFetch: async (url: string) => {
        if (url.includes('myroutine')) await gate;
        const key = Object.keys(OK).find((k) => url.includes(k));
        return { ok: true, status: 200, json: async () => (key ? OK[key] : {}) } as unknown as Response;
      },
    } as unknown as ConstructorParameters<typeof StudentHomeView>[0]['auth'];
    new StudentHomeView({ root, doc: dom.window.document, auth, go: () => {}, now: AT_1115 });
    await settle();
    root.textContent = '';
    const other = dom.window.document.createElement('section');
    other.className = 'other-route';
    root.append(other);
    release();
    await settle();
    assert.equal(root.querySelector('.page-header'), null);
    assert.equal(root.firstElementChild, other);
  });

  test('an answer from a load a retry replaced does not overwrite the newer one', async () => {
    // 2G: the routine request is still hanging when the homework fails and
    // the student taps its retry. The retry's routine answers; then the old
    // request finally fails. The old failure must not replace the class card.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let routineCalls = 0;
    let nextCalls = 0;
    const root = dom.window.document.getElementById('root') as HTMLElement;
    root.textContent = '';
    const auth = {
      authedFetch: async (url: string) => {
        if (url.includes('myroutine') && ++routineCalls === 1) {
          await gate;
          return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
        }
        if (url.includes('next') && ++nextCalls === 1) {
          return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
        }
        const key = Object.keys(OK).find((k) => url.includes(k));
        return { ok: true, status: 200, json: async () => (key ? OK[key] : {}) } as unknown as Response;
      },
    } as unknown as ConstructorParameters<typeof StudentHomeView>[0]['auth'];
    new StudentHomeView({ root, doc: dom.window.document, auth, go: () => {}, now: AT_1115 });
    await settle();
    const dueRetry = retries(root.querySelector('.sh-due') as Element)[0];
    assert.ok(dueRetry, 'the homework failed while the routine is still pending');
    dueRetry.click();
    await settle();
    assert.equal(root.querySelector('.sh-now h2')?.textContent, 'গণিত');
    release();
    await settle();
    assert.equal(root.querySelector('.sh-now h2')?.textContent, 'গণিত',
      'the stale failure is dropped');
    assert.equal(root.querySelectorAll('.ui-state-error').length, 0);
  });

  test('destroy() stops every later paint and the online listener', async () => {
    setOnline(false);
    const seen: string[] = [];
    const { root, view } = await mount({ ...OK, myroutine: 'throw' }, seen);
    view.destroy();
    const n = seen.length;
    setOnline(true);
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await settle();
    assert.equal(seen.length, n);
    assert.ok(root.querySelector('.sh-now-empty .ui-state-error'), 'left as it was');
  });
});
