/**
 * UX sweep — নোটিশ inbox (group inbox), findings 22 and 57.
 *
 * A keyboard or screen-reader user opened a notice with Enter and lost focus
 * to <body>: the list rebuilt under them, a second Enter did nothing, and the
 * way back was a Tab per row. "সব পড়া হয়েছে" removed itself and took focus
 * with it, and nothing said the notices had been marked read.
 *
 * Opening and closing is held by the shell's focus keeper (keepFocusWithin on
 * main#shell-view), so these tests mount the inbox inside a real Shell, as
 * app.ts does, rather than bare. What the inbox itself owes is a stable row
 * identity for that keeper, one render per press, and — where the pressed
 * control is gone for good — a deliberate place for focus and a sentence.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { Shell, type ShellRoute } from '../src/shell.ts';
import { InboxView, type InboxNotice } from '../src/inbox-view.ts';
import { focusIsLost } from '../src/ui/dom.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'https://school.example/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.location = dom.window.location;
  Object.defineProperty(globalThis, 'navigator',
    { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, 'localStorage',
    { value: dom.window.localStorage, configurable: true });
  g.document = dom.window.document;
  g.CSS = dom.window.CSS;
  g.addEventListener = dom.window.addEventListener.bind(dom.window);
  g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
  g.matchMedia = (q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  });
});

let shell: Shell | null = null;

beforeEach(() => {
  doc().body.innerHTML = '<main id="root"></main>';
  dom.window.location.hash = '#/inbox';
});

afterEach(() => {
  shell?.destroy();
  shell = null;
});

const notice = (i: number, over: Partial<InboxNotice> = {}): InboxNotice => ({
  receiptId: `r${i}`,
  noticeId: `n${i}`,
  title: `নোটিশ ${i}`,
  body: `নোটিশ ${i}-এর পুরো লেখা।`,
  category: 'general',
  deliveredAt: new Date().toISOString(),
  readAt: null,
  aboutStudent: null,
  ...over,
});

function fakeAuth(payload: { unread: number; notices: InboxNotice[] }) {
  const posts: string[] = [];
  return {
    posts,
    authedFetch: async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(String(init.body));
      return new Response(JSON.stringify(init?.method === 'POST' ? {} : payload), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

/** The inbox mounted the way app.ts mounts it: a hidden route of the shell. */
async function mountInbox(payload: { unread: number; notices: InboxNotice[] }) {
  const auth = fakeAuth(payload);
  let unread = -1;
  const routes: ShellRoute[] = [
    { path: 'home', labelBn: 'হোম', glyph: 'home', mount: (c) => { c.textContent = 'home'; } },
    {
      path: 'inbox', labelBn: 'নোটিশ', glyph: 'bell', hidden: true,
      mount: (c) => {
        new InboxView({
          root: c, doc: doc(), auth: auth as never,
          onUnreadChange: (n) => { unread = n; },
        });
      },
    },
  ];
  shell = new Shell({
    root: doc().getElementById('root')!, doc: doc(), routes, defaultPath: 'home',
    displayName: 'অভিভাবক', onLogout: () => {},
  });
  await tick(5);
  const view = doc().getElementById('shell-view') as HTMLElement;
  assert.ok(view.querySelector('.notice-head'), 'the inbox rendered inside the shell');
  return { auth, view, unread: () => unread };
}

const heads = (view: HTMLElement) =>
  [...view.querySelectorAll<HTMLButtonElement>('.notice-head')];
const titleOf = (node: Element | null) =>
  node?.closest('.notice-card')?.querySelector('.notice-title')?.textContent ?? null;

describe('opening a notice from the keyboard (findings 22, 57)', () => {
  test('focus stays on the same notice through open and close, so Enter closes it again', async () => {
    const { view } = await mountInbox({
      unread: 3, notices: [notice(1), notice(2), notice(3)],
    });

    const second = heads(view)[1];
    second.focus();
    second.click();                      // Enter on a <button> is a click
    await tick();

    const opened = doc().activeElement as HTMLElement;
    assert.equal(second.isConnected, false, 'the list was rebuilt (the case under test)');
    assert.equal(focusIsLost(doc()), false, 'focus fell to <body> or was parked on the page');
    assert.ok(opened.classList.contains('notice-head'), 'focus is on a notice head');
    assert.equal(titleOf(opened), 'নোটিশ 2', 'the head of the notice just opened');
    assert.equal(opened.getAttribute('aria-expanded'), 'true');
    assert.ok(opened.closest('.notice-card')!.querySelector('.notice-body'));

    // The second Enter, where the person still is.
    opened.click();
    await tick();
    const closed = doc().activeElement as HTMLElement;
    assert.equal(focusIsLost(doc()), false);
    assert.equal(titleOf(closed), 'নোটিশ 2');
    assert.equal(closed.getAttribute('aria-expanded'), 'false');
    assert.equal(view.querySelector('.notice-body'), null, 'closed again');
  });

  test('every row carries an identity that survives its own text changing', async () => {
    // The head's text loses its preview line when opened, so text cannot say
    // which rebuilt button is "the same one". The keeper's explicit door is a
    // row key plus a fixed focus key (keepFocusWithin's contract).
    const { view } = await mountInbox({ unread: 2, notices: [notice(1), notice(2)] });
    const cards = [...view.querySelectorAll<HTMLElement>('.notice-card')];
    assert.deepEqual(cards.map((c) => c.getAttribute('data-key')), ['n1', 'n2']);
    for (const h of heads(view)) assert.equal(h.getAttribute('data-focus-key'), 'notice-head');

    heads(view)[0].click();
    await tick();
    const reopened = view.querySelector<HTMLElement>('.notice-card[data-key="n1"] .notice-head')!;
    assert.equal(reopened.getAttribute('aria-expanded'), 'true');
    assert.equal(reopened.getAttribute('data-focus-key'), 'notice-head');
  });

  test('a notice sent twice: focus stays on the copy that was opened, not its twin', async () => {
    // A school re-sends a notice, and two rows read exactly alike. Told apart
    // by text alone, the keeper would see the opened head's text change (its
    // preview line goes) and its closed twin still carrying the old text,
    // and hand focus to the twin: the next Enter opens a second copy instead
    // of closing this one. The row key is what keeps them apart.
    const at = new Date().toISOString();
    const same = { title: 'বেতন জমার শেষ তারিখ', body: 'এই মাসের বেতন ২০ তারিখের মধ্যে।', deliveredAt: at };
    const { view } = await mountInbox({
      unread: 2, notices: [notice(1, same), notice(2, same)],
    });

    heads(view)[0].focus();
    heads(view)[0].click();
    await tick();

    const active = doc().activeElement as HTMLElement;
    assert.equal(focusIsLost(doc()), false);
    assert.equal(active.closest('.notice-card')?.getAttribute('data-key'), 'n1',
      'focus moved to the other copy of the notice');
    assert.equal(active.getAttribute('aria-expanded'), 'true');

    active.click();                      // the second Enter closes it
    await tick();
    assert.equal(view.querySelector('.notice-body'), null, 'both copies are closed');
    assert.equal((doc().activeElement as HTMLElement).closest('.notice-card')?.getAttribute('data-key'), 'n1');
  });

  test('one press rebuilds the list once, not twice', async () => {
    const { view, auth, unread } = await mountInbox({ unread: 1, notices: [notice(1)] });
    const obs = new dom.window.MutationObserver(() => {});
    obs.observe(view, { childList: true });
    heads(view)[0].click();
    const clears = obs.takeRecords().filter((r) => r.removedNodes.length > 1).length;
    obs.disconnect();
    assert.equal(clears, 1, 'markRead and the click handler each rebuilt fifty rows');

    // Still read, still recorded, still reported — in that one render.
    assert.equal(view.querySelector('.notice-card.unread'), null);
    assert.equal(unread(), 0);
    await tick();
    assert.match(auth.posts.join(), /"noticeId":"n1"/);
  });
});

describe('সব পড়া হয়েছে (findings 22, 57)', () => {
  const allRead = (view: HTMLElement) => [...view.querySelectorAll('button')]
    .find((b) => b.textContent === 'সব পড়া হয়েছে') as HTMLButtonElement | undefined;

  test('focus moves on to the first notice instead of being lost with the button', async () => {
    const { view, unread } = await mountInbox({
      unread: 2, notices: [notice(1), notice(2)],
    });
    const btn = allRead(view)!;
    btn.focus();
    btn.click();
    await tick();

    assert.equal(allRead(view), undefined, 'the button goes once nothing is unread');
    assert.equal(unread(), 0);
    assert.equal(focusIsLost(doc()), false,
      'focus fell to <body> or was parked on main#shell-view');
    assert.equal(doc().activeElement, heads(view)[0], 'the next stop Tab would have made');
  });

  test('says in words that everything was marked read', async () => {
    const { view } = await mountInbox({ unread: 2, notices: [notice(1), notice(2)] });
    const btn = allRead(view)!;
    btn.focus();
    btn.click();
    const said = [...doc().querySelectorAll('[role="status"], [aria-live]')]
      .map((n) => n.textContent ?? '');
    assert.ok(said.some((t) => t.includes('সব নোটিশ পড়া হয়েছে')),
      `nothing announced; live regions held: ${JSON.stringify(said)}`);
  });

  test('does not pull focus when the press never gave the button focus', async () => {
    // A tap on iOS does not focus a button. Focus that was not in the inbox
    // is not the inbox's to move.
    const { view } = await mountInbox({ unread: 1, notices: [notice(1)] });
    (doc().activeElement as HTMLElement | null)?.blur();
    allRead(view)!.click();
    await tick();
    assert.notEqual(doc().activeElement, heads(view)[0]);
  });
});
