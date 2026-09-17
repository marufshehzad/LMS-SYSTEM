/**
 * UX fixes on the teacher's routine (#/routine), from the confirmed browser sweep.
 *
 *   8  An in-screen action rebuilt the view and keyboard focus fell to <body>:
 *      ArrowLeft/Right on the আজ / সপ্তাহ tabs worked once. The tab strip's
 *      own refocus and the shell's keepFocusWithin cover the tabs; the empty
 *      day's "সপ্তাহের রুটিন দেখুন" had no equivalent control to return to and
 *      left focus parked on the page.
 *  64  The screen's own "অফলাইন — … সংযোগ পেলে নিজেই হালনাগাদ হবে" banner
 *      stayed after the connection came back, a promise the screen never kept.
 *
 * And two minors in the same file:
 *  99  A 403 with a cached routine read as "অফলাইন" and showed the cached
 *      classes to the reader the server had just refused.
 * 101  The আজ / সপ্তাহ tabs stayed operable above the denied card.
 *
 * Every view is mounted into a container that keepFocusWithin watches, which
 * is how the shell mounts it (shell.ts renderRoute).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/#/routine' });
const g = globalThis as Record<string, unknown>;
g.HTMLElement = dom.window.HTMLElement;
for (const key of ['localStorage', 'location'] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

const { RoutineView } = await import('../src/routine-view.ts');
const { keepFocusWithin, focusIsLost } = await import('../src/ui/dom.ts');
const { todayLocalIso } = await import('../../../packages/ui-core/src/format.ts');

const doc = dom.window.document;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

const TODAY = todayLocalIso();
const DAY_KEY = `shikhon_routine_day_${TODAY}`;

const slot = (periodNo: number, subjectBn: string) => ({
  slotId: `s${periodNo}`, periodNo, startsAt: '07:00:00', endsAt: '07:40:00',
  slotKind: 'teaching', subjectBn, sectionLabel: 'নবম–ক', roomCode: '101',
  isSubstitution: false, coveringForBn: null, studentCount: 40,
  attendanceTaken: false, deliveryLogged: false,
});
const DAY = (subject = 'বাংলা') => ({ scope: 'day', date: TODAY, slots: [slot(1, subject)] });
const EMPTY_DAY = { scope: 'day', date: TODAY, slots: [] };
const WEEK = { scope: 'week', weekStart: TODAY, days: [{ date: TODAY, slots: [slot(1, 'গণিত')] }] };

type Answer = (url: string) => Response | Promise<Response>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;
const offline = (): never => { throw new TypeError('Failed to fetch'); };
/** Day and week both answered. */
const both = (day: unknown = DAY(), week: unknown = WEEK): Answer =>
  (url) => ok(url.includes('scope=week') ? week : day);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let root: HTMLElement;
const views: Array<{ destroy?: () => void }> = [];
const stops: Array<() => void> = [];

function mount(answer: Answer) {
  const urls: string[] = [];
  let current = answer;
  const auth = {
    role: 'teacher',
    authedFetch: async (url: string) => { urls.push(url); return current(url); },
  } as never;
  const view = new RoutineView({ root, doc, auth });
  views.push(view as unknown as { destroy?: () => void });
  return { view: view as unknown as { destroy(): void }, urls, answer: (a: Answer) => { current = a; } };
}

const text = () => (root.textContent ?? '').replace(/\s+/g, ' ');
const banner = () => root.querySelector('.routine-offline');
const modeTab = (id: 'day' | 'week') => root.querySelector<HTMLElement>(`.routine-mode #tab-${id}`);
const active = () => doc.activeElement as HTMLElement | null;
const key = (target: Element, k: string) =>
  target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const goOnline = () => dom.window.dispatchEvent(new dom.window.Event('online'));

beforeEach(() => {
  localStorage.clear();
  root = doc.createElement('main');
  root.id = 'shell-view';
  doc.body.append(root);
  // As the shell arms it for every route.
  stops.push(keepFocusWithin(root));
});

afterEach(() => {
  for (const v of views.splice(0)) v.destroy?.();
  while (stops.length) stops.pop()!();
  root.remove();
  doc.body.textContent = '';
});

/* ── 8: focus after an in-screen action ─────────────────────────────────── */

describe('8 — focus stays on the routine’s controls after they rebuild the view', () => {
  test('ArrowRight then ArrowLeft on আজ / সপ্তাহ: both keys work, focus never falls to <body>', async () => {
    const week = deferred<Response>();
    const m = mount((url) => (url.includes('scope=week') ? week.promise : ok(DAY())));
    await settle();
    modeTab('day')!.focus();

    key(modeTab('day')!, 'ArrowRight');
    assert.equal(active(), modeTab('week'), 'the rebuilt সপ্তাহ tab has focus while the week loads');
    week.resolve(ok(WEEK));
    await settle();
    assert.equal(active(), modeTab('week'), 'and still has it after the week arrives and the view rebuilds');
    assert.equal(modeTab('week')!.getAttribute('aria-selected'), 'true');
    assert.equal(focusIsLost(doc), false);

    // The second key is the one that did nothing: it went to <body>.
    key(active()!, 'ArrowLeft');
    await settle();
    assert.equal(modeTab('day')!.getAttribute('aria-selected'), 'true', 'the second arrow key switched back');
    assert.equal(active(), modeTab('day'));
    assert.ok(m.urls.some((u) => u.includes('scope=week')));
  });

  test('the empty day’s "সপ্তাহের রুটিন দেখুন" hands focus to the সপ্তাহ tab, not to the page', async () => {
    const week = deferred<Response>();
    mount((url) => (url.includes('scope=week') ? week.promise : ok(EMPTY_DAY)));
    await settle();
    const button = [...root.querySelectorAll<HTMLButtonElement>('.ui-state-empty button')]
      .find((b) => /সপ্তাহের রুটিন দেখুন/.test(b.textContent ?? ''));
    assert.ok(button, 'the empty day offers the week');
    button!.focus();
    button!.click();
    await settle();
    assert.equal(active(), modeTab('week'), 'focus is on the control that now says what is shown');
    week.resolve(ok(WEEK));
    await settle();
    assert.equal(active(), modeTab('week'), 'and stays there when the week arrives');
    assert.equal(focusIsLost(doc), false, 'never on <body>, never parked on the view');
  });

  test('a day tab in the phone’s week strip keeps focus through a reload', async () => {
    localStorage.setItem(`shikhon_routine_week_${TODAY}`, JSON.stringify(WEEK));
    const m = mount(both());
    await settle();
    modeTab('day')!.click();
    modeTab('week')!.click();
    await settle();
    const day = root.querySelector<HTMLElement>(`.routine-days #tab-${TODAY}`);
    assert.ok(day);
    day!.focus();
    // A reconnect re-reads the week (64) and rebuilds the whole view.
    m.answer(offline);
    modeTab('day')!.click();
    await settle();
    modeTab('week')!.click();
    await settle();
    assert.ok(banner(), 'offline, the cached week under the banner');
    root.querySelector<HTMLElement>(`.routine-days #tab-${TODAY}`)!.focus();
    m.answer(both());
    goOnline();
    await settle();
    assert.equal(banner(), null);
    assert.equal(active()?.id, `tab-${TODAY}`, 'the day tab has focus again after the rebuild');
    assert.ok(active()?.isConnected);
  });
});

/* ── 64: the screen's offline state ends when the connection returns ──────── */

describe('64 — the routine’s own offline banner goes when the connection comes back', () => {
  test('cached routine under the banner, then online: read again, fresh routine, banner gone', async () => {
    localStorage.setItem(DAY_KEY, JSON.stringify(DAY('পুরোনো বিষয়')));
    const m = mount(offline);
    await settle();
    assert.ok(banner(), 'offline: the banner');
    assert.match(text(), /পুরোনো বিষয়/, 'over the cached routine');
    const before = m.urls.length;

    m.answer(both(DAY('নতুন বিষয়')));
    goOnline();
    await settle();
    assert.equal(m.urls.length, before + 1, 'the routine was read again');
    assert.equal(banner(), null, 'the promise "সংযোগ পেলে নিজেই হালনাগাদ হবে" is kept');
    assert.match(text(), /নতুন বিষয়/, 'and the fresh routine replaced the cached one');
    assert.doesNotMatch(text(), /অফলাইন/);
  });

  test('while it reads again the cached routine stays up: no skeleton flash', async () => {
    localStorage.setItem(DAY_KEY, JSON.stringify(DAY('পুরোনো বিষয়')));
    const m = mount(offline);
    await settle();
    const again = deferred<Response>();
    m.answer(() => again.promise);
    goOnline();
    await settle();
    assert.match(text(), /পুরোনো বিষয়/);
    assert.equal(root.querySelector('.ui-skeleton, .skeleton, [aria-busy="true"]'), null);
    again.resolve(ok(DAY('নতুন বিষয়')));
    await settle();
    assert.equal(banner(), null);
  });

  test('nothing cached and no answer: the error state reads again on reconnect', async () => {
    const m = mount(offline);
    await settle();
    assert.match(text(), /রুটিন আনা গেল না/);
    m.answer(both());
    goOnline();
    await settle();
    assert.doesNotMatch(text(), /রুটিন আনা গেল না/);
    assert.match(text(), /বাংলা/);
  });

  test('a routine that is already current is not read again on "online"', async () => {
    const m = mount(both());
    await settle();
    const before = m.urls.length;
    goOnline();
    await settle();
    assert.equal(m.urls.length, before, 'no second request, no flash');
  });

  test('a refusal is not an outage: "online" does not retry a 403', async () => {
    const m = mount(() => fail(403));
    await settle();
    const before = m.urls.length;
    goOnline();
    await settle();
    assert.equal(m.urls.length, before);
  });

  test('an older read that fails AFTER the reconnect read succeeded does not bring the banner back', async () => {
    localStorage.setItem(DAY_KEY, JSON.stringify(DAY()));
    const m = mount(offline);
    await settle();
    assert.ok(banner(), 'the day is shown from the cache');

    // The teacher moves to the week while still offline; that read hangs.
    const stale = deferred<Response>();
    m.answer(() => stale.promise);
    modeTab('week')!.click();
    await settle();

    // The connection returns: the week is read again and answers.
    m.answer(both());
    goOnline();
    await settle();
    assert.equal(banner(), null, 'fresh week, no banner');
    assert.match(text(), /গণিত/);

    // Only now does the read started offline give up.
    stale.reject(new TypeError('Failed to fetch'));
    await settle();
    assert.equal(banner(), null, 'the stale failure is dropped, not painted over the fresh week');
    assert.match(text(), /গণিত/);
  });

  test('destroy() takes the listener off the window and nothing paints after it', async () => {
    localStorage.setItem(DAY_KEY, JSON.stringify(DAY()));
    const m = mount(offline);
    await settle();
    assert.ok(banner(), 'a screen that WOULD read again on online');
    m.view.destroy();
    const before = m.urls.length;
    m.answer(both());
    goOnline();
    await settle();
    assert.equal(m.urls.length, before, 'no read from a page that was left');
  });

  test('an answer that arrives after the page was left does not paint over the next page', async () => {
    const late = deferred<Response>();
    const m = mount(() => late.promise);
    await settle();
    m.view.destroy();
    // The shell empties its view and mounts the next route into it.
    root.textContent = '';
    root.append(doc.createTextNode('পরের পাতা'));
    late.resolve(ok(DAY()));
    await settle();
    assert.equal(root.textContent, 'পরের পাতা');
  });
});

/* ── minors 99 / 101: a refusal ─────────────────────────────────────────── */

describe('99 / 101 — a refused reader sees the denied card, not "অফলাইন", and no tabs', () => {
  test('403 with a cached routine: the denied state, not the cached classes under "অফলাইন"', async () => {
    localStorage.setItem(DAY_KEY, JSON.stringify(DAY('অন্যের ক্লাস')));
    mount(() => fail(403));
    await settle();
    assert.equal(banner(), null, 'a refusal is not an offline state');
    assert.ok(root.querySelector('.ui-state-denied'), 'the canonical denied card');
    assert.match(text(), /রুটিন দেখার অনুমতি আপনার নেই/);
    assert.doesNotMatch(text(), /অন্যের ক্লাস/, 'the cached routine is not this reader’s to see');
    assert.equal(localStorage.getItem(DAY_KEY), null, 'and it is not kept for the next visit either');
  });

  test('the আজ / সপ্তাহ tabs are not offered around the denied card', async () => {
    mount(() => fail(403));
    await settle();
    assert.ok(root.querySelector('.ui-state-denied'));
    assert.equal(root.querySelector('.routine-mode'), null, 'no control that can only lead back here');
    assert.equal(root.querySelectorAll('h1').length, 1, 'the page header stays');
  });

  test('an outage with a cached routine is still the offline state (unchanged)', async () => {
    localStorage.setItem(DAY_KEY, JSON.stringify(DAY('বাংলা')));
    mount(() => fail(503));
    await settle();
    assert.ok(banner());
    assert.match(text(), /বাংলা/);
    assert.ok(root.querySelector('.routine-mode'), 'the tabs are there when the routine is');
  });
});
