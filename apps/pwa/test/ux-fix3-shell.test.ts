/**
 * UX sweep, round 3 — the shell (group shell).
 *
 *   1  STALE VIEW. Every route mounted into main#shell-view itself, and a view
 *      clears and redraws its root when a read comes back. A read that came
 *      back after the person had left drew the old page over the new one: a
 *      student opened an assignment on a slow link, tapped হোম, and 2.6s
 *      later #/home showed the assignment. Each navigation now mounts into a
 *      fresh `.shell-route` container inside main, so a late render lands in a
 *      node the next navigation already took out of the document. main stays
 *      the landmark, the focus target and the focus keeper's container, and a
 *      mount that finishes after it was replaced moves neither focus nor
 *      scroll.
 *   2  #/marks asks before typed marks are thrown away, the way #/attendance
 *      does: by a sidebar link, a tab, or back (app.ts wires the view's
 *      `hasUnsavedChanges()` and a prompt into the route).
 *   3  Back pressed with a sheet open (attendance's "জমা দেওয়ার আগে দেখুন",
 *      marks' paper-switch question, the phone account sheet) stacked the
 *      leave question on top of it. The sheet is closed first; বাতিল keeps the
 *      person on the page, with their work, and focus back where it was.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

import { el } from '../src/ui/dom.ts';
import { closeAllOverlays } from '../src/ui/overlay.ts';
import { Shell, type ShellRoute } from '../src/shell.ts';
import { MarksView } from '../src/marks-view.ts';
import { AttendanceScreen } from '../src/attendance-screen.ts';
import type { OutboxLike } from '../src/attendance-view.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
let scrolls = 0;

before(() => {
  dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.CSS = dom.window.CSS;
  g.location = dom.window.location;
  Object.defineProperty(dom.window.navigator, 'onLine', { value: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'localStorage',
    { value: dom.window.localStorage, configurable: true });
  g.document = dom.window.document;
  g.addEventListener = dom.window.addEventListener.bind(dom.window);
  g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
  g.scrollTo = () => { scrolls++; };
  phone(false);
});

/** matchMedia: a phone (below the 1024px breakpoint) or a desktop. */
function phone(on: boolean): void {
  (globalThis as Record<string, unknown>).matchMedia = (q: string) => ({
    matches: on && /max-width:\s*1023/.test(q), media: q, addEventListener() {}, removeEventListener() {},
  });
}

let live: Shell | null = null;
beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<main id="root"></main>';
  dom.window.localStorage.clear();
  scrolls = 0;
});
// A failed assertion must not leave a shell answering the next test's hashchanges.
afterEach(() => { live?.destroy(); live = null; closeAllOverlays(); phone(false); });

const host = () => doc().getElementById('root') as HTMLElement;
const main = () => host().querySelector('#shell-view') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;
const walk = async (hash: string) => { dom.window.location.hash = hash; await settle(); };
const click = (node: Element) =>
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

function mountShell(routes: ShellRoute[], defaultPath = routes[0].path): Shell {
  live?.destroy();
  live = new Shell({
    root: host(), doc: doc(), routes, defaultPath, displayName: 'রহিম', onLogout: () => {},
  });
  return live;
}
const page = (path: string, more: Partial<ShellRoute> = {}): ShellRoute => ({
  path, labelBn: path, glyph: 'home',
  mount: (c) => {
    c.append(el(doc(), 'h1', { text: `view:${path}` }),
      el(doc(), 'button', { text: `button:${path}`, attrs: { type: 'button' } }));
  },
  ...more,
});
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const scrims = () => [...doc().querySelectorAll('.ui-scrim')];
const question = () => doc().querySelector<HTMLElement>('.ui-scrim [role="alertdialog"]');
const answer = (label: string) =>
  [...(question()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

/* ── app.ts, read as text (it boots the app on import) ────────────────── */

const APP = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
/** The route table's entry for `path` (a route's path is followed by its labelBn). */
function routeBlock(path: string): string {
  const at = APP.search(new RegExp(`path: '${path}',\\r?\\n\\s*labelBn:`));
  assert.ok(at >= 0, `no route ${path}`);
  const rest = APP.slice(at);
  const next = rest.search(/\r?\n {6}\{/);
  return next < 0 ? rest : rest.slice(0, next);
}
/** A route's `unsavedPrompt`, as app.ts words it. */
function promptOf(path: string): { title: string; body: string; confirmLabel: string } {
  const m = /unsavedPrompt: \{\s*title: '([^']+)',\s*body: '([^']+)',\s*confirmLabel: '([^']+)'/
    .exec(routeBlock(path));
  assert.ok(m, `the ${path} route has no unsavedPrompt`);
  return { title: m[1], body: m[2], confirmLabel: m[3] };
}

/* ── 1: a page left before its read came back ─────────────────────────── */

describe('1 — a view whose read resolves after the person left never draws over the next page', () => {
  test('THE ONE THAT MATTERS — the late render lands in a detached container, home stays home', async () => {
    const read = deferred();
    let root: HTMLElement | null = null;
    // An assignments-like view: the list now, the detail when its read returns,
    // redrawn the way every view redraws — clear the root, append.
    const assignments = page('assignments', {
      mount: (c) => {
        root = c;
        c.append(el(doc(), 'h1', { text: 'বাড়ির কাজ' }));
        void read.promise.then(() => {
          c.textContent = '';
          c.append(el(doc(), 'h1', { text: 'গতির সমীকরণ — অনুশীলনী ৫.২' }), el(doc(), 'textarea'));
        });
      },
    });
    await walk('#/home');
    mountShell([page('home'), assignments]);
    await settle();
    await walk('#/assignments');
    await walk('#/home');
    assert.match(main().textContent ?? '', /view:home/);

    read.resolve();
    await settle();
    assert.equal(dom.window.location.hash, '#/home');
    assert.match(main().textContent ?? '', /view:home/, 'home was replaced by the page the person left');
    assert.doesNotMatch(main().textContent ?? '', /গতির সমীকরণ/, 'the old detail was drawn over home');
    assert.equal(main().querySelector('textarea'), null);
    assert.ok(root, 'the view was mounted');
    assert.notEqual(root, main(), 'a view is never given main itself');
    assert.equal(root!.isConnected, false, 'the late render went into a node out of the document');
  });

  test('a real view: the marks sheet whose exam list arrives after leaving does not replace home', async () => {
    const exams = deferred();
    dom.window.localStorage.setItem('shikhon_last_section', 'sec-1');
    const marks = page('marks', {
      mount: (c) => {
        new MarksView({
          root: c, doc: doc(),
          auth: {
            authedFetch: async (url: string) => {
              if (url.includes('/exams')) await exams.promise;
              return ok(url.includes('/exams') ? { exams: [EXAM] } : SHEET());
            },
          } as never,
          outbox: { enqueue: async () => ({ opId: 'op' }), flush: async () => {} } as never,
        });
      },
    });
    await walk('#/home');
    mountShell([page('home'), marks]);
    await settle();
    await walk('#/marks');
    assert.match(main().textContent ?? '', /নম্বর এন্ট্রি/, 'the sheet is loading');
    await walk('#/home');

    exams.resolve();
    await settle();
    assert.match(main().textContent ?? '', /view:home/);
    assert.doesNotMatch(main().textContent ?? '', /নম্বর এন্ট্রি/, 'the marks sheet was drawn over home');
    assert.equal(main().querySelector('[name="examSubject"]'), null);
  });

  test('a mount that finishes after it was replaced moves neither focus nor scroll', async () => {
    const loaded = deferred();
    const learn = page('learn', {
      mount: async (c) => {
        await loaded.promise;
        c.append(el(doc(), 'h1', { text: 'পড়াশোনা' }));
      },
    });
    await walk('#/home');
    mountShell([page('home'), learn]);
    await settle();
    await walk('#/learn');   // still mounting
    await walk('#/home');
    const btn = main().querySelector('button') as HTMLButtonElement;
    btn.focus();
    assert.equal(active(), btn);
    scrolls = 0;

    loaded.resolve();
    await settle();
    assert.equal(active(), btn, 'the stale mount pulled focus off home onto main');
    assert.equal(scrolls, 0, 'the stale mount scrolled the new page to the top');
    assert.doesNotMatch(main().textContent ?? '', /পড়াশোনা/);
  });

  test('main stays the landmark and focus target; each page gets a fresh container as main’s only child', async () => {
    const given: HTMLElement[] = [];
    const a = page('a', {
      mount: (c) => {
        given.push(c);
        c.append(el(doc(), 'h1', { text: 'view:a' }),
          el(doc(), 'button', { text: 'আবার চেষ্টা করুন', attrs: { type: 'button' } }));
      },
    });
    await walk('#/home');
    mountShell([page('home'), a]);
    await settle();
    await walk('#/a');
    await walk('#/home');
    await walk('#/a');

    const view = main();
    assert.equal(view.tagName, 'MAIN');
    assert.equal(view.tabIndex, -1);
    assert.equal(given.length, 2);
    assert.notEqual(given[0], given[1], 'the same route mounted twice shares one container');
    assert.equal(given[0].isConnected, false, 'the old container is gone from the document');
    assert.equal(view.children.length, 1, 'one container at a time');
    assert.equal(view.firstElementChild, given[1]);
    assert.ok(given[1].classList.contains('shell-route'));
    assert.equal(active(), view, 'a route change still puts focus on main');

    // The focus keeper is still armed on main and follows the page inside the
    // container: a rebuild keeps focus on the equivalent control.
    const btn = view.querySelector('button') as HTMLButtonElement;
    btn.focus();
    given[1].textContent = '';
    given[1].append(el(doc(), 'h1', { text: 'view:a' }),
      el(doc(), 'button', { text: 'আবার চেষ্টা করুন', attrs: { type: 'button' } }));
    await tick();
    assert.equal(active(), view.querySelector('button'), 'a rebuild inside the container lost focus');
  });

  test('the skip link still lands on main', async () => {
    await walk('#/home');
    mountShell([page('home')]);
    await settle();
    click(host().querySelector('.skip-link')!);
    assert.equal(active(), main());
  });
});

/* ── 2: #/marks asks before leaving ───────────────────────────────────── */

const subject = (id: string, bn: string) => ({
  examSubjectId: id, subject: { bn, en: bn }, cqMax: 70, mcqMax: 30, practicalMax: 0, caMax: 0,
  markingLocked: false,
});
const EXAM = {
  id: 'ex-1', nameBn: '১ম সাময়িক', status: 'draft', academicYearId: 'yr-1',
  subjects: [subject('es-1', 'পদার্থবিজ্ঞান'), subject('es-2', 'রসায়ন')],
};
const markRow = (n: number, bn: string) => ({
  rollNo: n, studentId: `s-${n}`, fullName: { bn, en: null }, cqMarks: null, mcqMarks: null,
  practicalMarks: null, caMarks: null, isAbsent: false, rowVersion: 1,
});
const SHEET = () => ({
  academicYearId: 'yr-1', examStatus: 'draft', markingLocked: false,
  maxima: { cq: 70, mcq: 30, practical: 0, ca: 0 },
  marks: [markRow(1, 'আনিকা'), markRow(2, 'বিজয়')],
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('2 — #/marks asks before typed marks are thrown away', () => {
  test('app.ts wires the marks view into the route, as attendance is wired', () => {
    const block = routeBlock('marks');
    assert.match(block, /marksView = new MarksView\(/, 'the route keeps the view it mounted');
    assert.match(block, /hasUnsavedChanges: \(\) => Boolean\(marksView\?\.hasUnsavedChanges\(\)\)/,
      'the route asks the view whether marks are unsaved');
    const p = promptOf('marks');
    assert.match(p.title, /নম্বর/);
    assert.match(p.body, /চলে গেলে/);
    assert.equal(p.confirmLabel, promptOf('attendance').confirmLabel, 'the same danger answer as attendance');
    assert.match(block, /unmount: \(\) => \{ destroyView\(marksView\); marksView = null; \}/,
      'a view that was left is neither asked nor kept listening');
    assert.match(APP, /let marksView: MarksView \| null = null;/);
  });

  /** The marks route as app.ts builds it, around a real MarksView. */
  async function openMarks(typed = true) {
    dom.window.localStorage.setItem('shikhon_last_section', 'sec-1');
    let view: MarksView | null = null;
    let unmounts = 0;
    const marks: ShellRoute = {
      path: 'marks', labelBn: 'নম্বর', glyph: 'edit', hidden: true, queuesOffline: true,
      mount: (c) => {
        view = new MarksView({
          root: c, doc: doc(),
          auth: { authedFetch: async (url: string) => ok(url.includes('/exams') ? { exams: [EXAM] } : SHEET()) } as never,
          outbox: { enqueue: async () => ({ opId: 'op' }), flush: async () => {} } as never,
        });
      },
      unmount: () => { view?.destroy(); view = null; unmounts++; },
      hasUnsavedChanges: () => Boolean(view?.hasUnsavedChanges()),
      unsavedPrompt: promptOf('marks'),
    };
    await walk('#/home');
    mountShell([page('home'), page('attendance'), marks]);
    await settle();
    await walk('#/marks');
    const picker = () => main().querySelector('[name="examSubject"]') as HTMLSelectElement;
    const choose = (value: string) => {
      picker().value = value;
      picker().dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    };
    choose('es-1');
    await settle();
    const box = () => main().querySelector('.marks-input') as HTMLInputElement;
    if (typed) {
      box().value = '১৪';
      box().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    }
    assert.equal(view!.hasUnsavedChanges(), typed, 'a typed mark, and only a typed mark, is unsaved');
    return { box, picker, choose, unmounts: () => unmounts };
  }

  const expectAsked = () => {
    assert.equal(scrims().length, 1, 'exactly one sheet on screen');
    assert.ok(question(), 'leaving with typed marks did not ask');
    assert.match(question()!.textContent ?? '', new RegExp(promptOf('marks').title));
    assert.equal(dom.window.location.hash, '#/marks', 'the address is put back while asking');
  };

  test('a sidebar link asks; বাতিল keeps the sheet and the typed mark', async () => {
    const m = await openMarks();
    click(host().querySelector('.dnav[data-path="home"]')!);
    // jsdom follows a fragment link as a browser does; if it did not, the
    // shell would never have been asked and the next line would catch it.
    await settle();
    expectAsked();
    click(answer('বাতিল'));
    await settle();
    assert.equal(question(), null);
    assert.equal(dom.window.location.hash, '#/marks');
    assert.equal(m.box().value, '১৪', 'the typed mark survived');
    assert.equal(m.unmounts(), 0, 'the sheet was never unmounted');
  });

  test('a tab asks; বাদ দিন goes', async () => {
    const m = await openMarks();
    click(host().querySelector('.shell-tab[data-path="home"]')!);
    await settle();
    expectAsked();
    click(answer(promptOf('marks').confirmLabel));
    await settle();
    assert.equal(dom.window.location.hash, '#/home');
    assert.match(main().textContent ?? '', /view:home/);
    assert.equal(m.unmounts(), 1);
  });

  test('back asks; বাতিল stays on the sheet', async () => {
    const m = await openMarks();
    dom.window.history.back();
    await settle();
    expectAsked();
    click(answer('বাতিল'));
    await settle();
    assert.equal(dom.window.location.hash, '#/marks');
    assert.equal(m.box().value, '১৪');
  });

  test('back with the paper-switch question open: that question closes, the leave question asks alone', async () => {
    const m = await openMarks();
    m.choose('es-2');
    assert.equal(scrims().length, 1);
    assert.match(question()!.textContent ?? '', /বিষয় বদলালে/, 'the paper-switch question is open');

    dom.window.history.back();
    await settle();
    expectAsked();
    assert.doesNotMatch(question()!.textContent ?? '', /বিষয় বদলালে/, 'the switch question is still stacked under it');
    click(answer('বাতিল'));
    await settle();
    assert.equal(scrims().length, 0);
    assert.equal(dom.window.location.hash, '#/marks');
    assert.equal(m.picker().value, 'es-1', 'still on the paper that holds the marks');
    assert.equal(m.box().value, '১৪', 'the typed mark survived both questions');
  });

  test('nothing typed: leaving does not ask', async () => {
    await openMarks(false);
    await walk('#/home');
    assert.equal(question(), null);
    assert.match(main().textContent ?? '', /view:home/);
  });
});

/* ── 3: back with the attendance review sheet open ────────────────────── */

const SECTIONS = [
  { id: 's1', name: 'ক', shift: 'morning', studentCount: 2,
    className: { bn: 'নবম শ্রেণি', en: 'Class 9' }, levelNo: 9, academicYearId: 'y1' },
];
const ROSTER = [
  { studentId: 'a1', rollNo: 1, fullName: { bn: 'আনিকা রহমান', en: 'Anika' }, phone: null },
  { studentId: 'a2', rollNo: 2, fullName: { bn: 'আরিফ হোসেন', en: 'Arif' }, phone: null },
];

describe('3 — back with a sheet open closes the sheet before asking', () => {
  /** The attendance route as app.ts builds it, around a real AttendanceScreen. */
  async function openRegister() {
    let screen: AttendanceScreen | null = null;
    let unmounts = 0;
    const outbox = {
      async enqueue(input: { opId?: string }) { return { opId: input.opId ?? 'op' }; },
      async flush() { return undefined; },
      async state() { return { pending: 0, failed: 0, conflicts: 0 }; },
    } as unknown as OutboxLike;
    const attendance: ShellRoute = {
      path: 'attendance', labelBn: 'হাজিরা', glyph: 'check-square', queuesOffline: true,
      mount: (c) => {
        screen = new AttendanceScreen({
          root: c, doc: doc(), outbox, takenOn: '2026-09-17', newId: () => 'session-1',
          auth: {
            authedFetch: async (path: string) => ok(path.startsWith('/api/v1/academics/sections')
              ? { sections: SECTIONS } : { roster: ROSTER }),
          } as never,
        });
      },
      unmount: () => { screen?.destroy(); screen = null; unmounts++; },
      hasUnsavedChanges: () => Boolean(screen?.hasUnsavedChanges()),
      unsavedPrompt: promptOf('attendance'),
    };
    await walk('#/home');
    mountShell([page('home'), attendance]);
    await settle();
    await walk('#/attendance');
    await settle();
    const act = (a: string) => main().querySelector<HTMLButtonElement>(`[data-action="${a}"]`);
    click(act('mark-all')!);
    const review = act('review')!;
    review.focus();
    click(review);
    assert.ok(doc().querySelector('.att-confirm'), 'the review sheet is open');
    return { review, unmounts: () => unmounts, screen: () => screen };
  }
  const statuses = () => [...main().querySelectorAll<HTMLElement>('.att-row')].map((r) => r.dataset.status);

  test('THE ONE THAT MATTERS — one sheet at a time: the review sheet closes, then the question', async () => {
    await openRegister();
    dom.window.history.back();
    await settle();
    assert.equal(doc().querySelector('.att-confirm'), null, 'the review sheet is still open under the question');
    assert.equal(scrims().length, 1, 'two sheets stacked');
    assert.ok(question());
    assert.match(question()!.textContent ?? '', new RegExp(promptOf('attendance').title));
    assert.equal(dom.window.location.hash, '#/attendance');
  });

  test('বাতিল keeps the person on the register, marks and all, with focus back on its button', async () => {
    const r = await openRegister();
    const before = statuses();
    dom.window.history.back();
    await settle();
    click(answer('বাতিল'));
    await settle();
    assert.equal(scrims().length, 0);
    assert.equal(dom.window.location.hash, '#/attendance');
    assert.equal(r.unmounts(), 0, 'the register was unmounted');
    assert.deepEqual(statuses(), before, 'the marks survived');
    assert.equal(r.screen()!.hasUnsavedChanges(), true);
    assert.equal(active(), r.review, 'focus is back on "দেখে জমা দিন", not on <body>');
    assert.equal(host().getAttribute('aria-hidden'), null, 'the page is readable again');
  });

  test('a second back while the question is open leaves that question alone', async () => {
    await openRegister();
    dom.window.history.back();
    await settle();
    const first = question();
    assert.ok(first);
    dom.window.history.back();
    await settle();
    assert.equal(question(), first, 'the leave question was closed and asked again');
    assert.equal(scrims().length, 1);
  });

  test('বাদ দিন leaves the register', async () => {
    const r = await openRegister();
    dom.window.history.back();
    await settle();
    click(answer(promptOf('attendance').confirmLabel));
    await settle();
    assert.equal(dom.window.location.hash, '#/home');
    assert.match(main().textContent ?? '', /view:home/);
    assert.equal(r.unmounts(), 1);
    assert.equal(scrims().length, 0);
  });

  test('the phone account sheet is closed before asking, too', async () => {
    phone(true);
    let dirty = false;
    await walk('#/home');
    mountShell([page('home'), page('attendance', { hasUnsavedChanges: () => dirty })]);
    await settle();
    await walk('#/attendance');
    dirty = true;
    click(host().querySelector('.shell-avatar')!);
    assert.equal(host().querySelector('.shell-menu')?.getAttribute('role'), 'dialog', 'the account sheet is open');

    dom.window.history.back();
    await settle();
    assert.equal(host().querySelector('.shell-menu'), null, 'the account sheet stayed open under the question');
    assert.equal(scrims().length, 1);
    assert.ok(question());
    click(answer('বাতিল'));
    await settle();
    assert.equal(dom.window.location.hash, '#/attendance');
    assert.equal(host().querySelector('[aria-hidden="true"].shell-main'), null, 'the page is readable again');
  });
});
