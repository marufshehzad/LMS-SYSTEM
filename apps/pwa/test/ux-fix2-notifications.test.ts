/**
 * UX sweep round 2 — নোটিফিকেশন (group notifications), finding 47's remainder.
 *
 * Round 1 gave the demo a push status, so the screen no longer fails there.
 * Two defects in the screen itself were left, and both reach the live product:
 *
 * 1. A failed load stacked three states: the error card, then the banner
 *    "এই সার্ভারে এখনো নোটিফিকেশন চালু করা হয়নি", then the "কোনো যন্ত্র যুক্ত
 *    নেই" empty table. With no status, the screen read the server as not set
 *    up and the device list as empty — two claims it did not know to be true.
 *    A failure shows the error and its retry, and nothing else.
 * 2. On a server without push keys, an IT admin was told to tell the IT
 *    admin. Who can fix it depends on who is reading.
 *
 * The view is mounted inside `main#shell-view` with the shell's focus keeper
 * armed, as app.ts mounts it, so the retry's focus is held the way it ships.
 */
import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { NotificationsView } from '../src/notifications-view.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const text = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ');

before(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://school.example/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, 'localStorage',
    { value: dom.window.localStorage, configurable: true });
});

let stopKeeper: () => void = () => {};
afterEach(() => { stopKeeper(); stopKeeper = () => {}; });

/** A window with every push capability, so `state()` depends on the server alone. */
const fakeWin = (): Window => ({
  isSecureContext: true,
  navigator: { userAgent: 'test', serviceWorker: {} },
  PushManager: function () {},
  Notification: { permission: 'default' },
}) as unknown as Window;

type Status = { enabled: boolean; publicKey: string | null; devices: unknown[] } | null;

/** A PushClient stand-in whose status answers can be scripted call by call. */
function scriptedClient(answers: Array<Status | Error>, over: Record<string, unknown> = {}) {
  const calls = { status: 0 };
  const client = {
    permission: () => 'default',
    supported: () => true,
    status: async () => {
      const a = answers[Math.min(calls.status, answers.length - 1)];
      calls.status += 1;
      if (a instanceof Error) throw a;
      return a;
    },
    isSubscribed: async () => false,
    enable: async () => ({ ok: true as const }),
    disable: async () => true,
    forget: async () => true,
    ...over,
  };
  return { client, calls };
}

const OFF: Status = { enabled: true, publicKey: 'BKEY', devices: [] };
const UNCONFIGURED: Status = { enabled: false, publicKey: null, devices: [] };

function mount(o: { client?: unknown; role?: string; authedFetch?: (p: string) => Promise<Response> }) {
  doc().body.innerHTML = '<main id="shell-view" tabindex="-1"><div id="view"></div></main>';
  const main = doc().getElementById('shell-view') as HTMLElement;
  const root = doc().getElementById('view') as HTMLElement;
  stopKeeper = keepFocusWithin(main);
  const auth = {
    role: o.role ?? 'principal',
    roles: [o.role ?? 'principal'],
    authedFetch: o.authedFetch ?? (async () => new Response('{}')),
  };
  new NotificationsView({
    root, doc: doc(), auth: auth as never,
    ...(o.client ? { client: o.client as never } : {}),
    win: fakeWin(),
  });
  return root;
}

/** Everything a failed load must NOT also claim. */
function assertOnlyTheError(root: HTMLElement): void {
  assert.equal(root.querySelectorAll('.ui-state-error').length, 1, 'exactly one error card');
  assert.match(text(root), /আনা যায়নি/);
  assert.ok(root.querySelector('.ui-state-error button'), 'the error offers a retry');
  assert.equal(root.querySelector('[data-push-state]'), null,
    'no push banner: without a status the server is not known to be unconfigured');
  assert.doesNotMatch(text(root), /চালু করা হয়নি/);
  assert.equal(root.querySelector('table.ui-table, .ui-table'), null,
    'no device table: the list is not known to be empty');
  assert.doesNotMatch(text(root), /কোনো যন্ত্র যুক্ত নেই/);
  assert.doesNotMatch(text(root), /আপনার যন্ত্রসমূহ/);
  assert.doesNotMatch(text(root), /আইটি অ্যাডমিন/);
  assert.equal(root.querySelectorAll('h1').length, 1, 'the page keeps its one h1');
}

describe('finding 47 — a failed load shows the error and nothing else', () => {
  test('the status fetch answers nothing (a non-OK response, or unreadable JSON)', async () => {
    const { client } = scriptedClient([null]);
    const root = mount({ client });
    await settle();
    assertOnlyTheError(root);
  });

  test('the status fetch throws', async () => {
    const { client } = scriptedClient([new Error('offline')]);
    const root = mount({ client });
    await settle();
    assertOnlyTheError(root);
  });

  test('the browser repro: the real client, with Response.json failing', async () => {
    // What the re-check did in the page: the request succeeds, the body does
    // not parse. No injected client — the view's own PushClient reads it.
    const root = mount({
      authedFetch: async () => ({
        ok: true, status: 200,
        json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
      }) as unknown as Response,
    });
    await settle();
    assertOnlyTheError(root);
  });

  test('retry recovers into the full screen, and focus stays on the page', async () => {
    const { client, calls } = scriptedClient([null, null, OFF]);
    const root = mount({ client });
    await settle();
    assertOnlyTheError(root);

    // A retry that fails again is still the error alone — not the error with
    // yesterday's banner under it — and the keeper hands focus back to the
    // retry control rather than dropping it on <body>.
    const retry1 = root.querySelector<HTMLButtonElement>('.ui-state-error button')!;
    retry1.focus();
    retry1.click();
    await settle();
    assert.equal(calls.status, 2);
    assertOnlyTheError(root);
    const again = root.querySelector<HTMLButtonElement>('.ui-state-error button')!;
    assert.equal(doc().activeElement, again, 'focus follows the retry button through the rebuild');

    again.click();
    await settle();
    assert.equal(calls.status, 3);
    assert.equal(root.querySelector('.ui-state-error'), null, 'the error is gone once it loads');
    assert.equal(root.querySelector('[data-push-state]')?.getAttribute('data-push-state'), 'off');
    assert.match(text(root), /কোনো যন্ত্র যুক্ত নেই/);
  });

  test('an ACTION failing keeps the screen: the status it shows is still true', async () => {
    // The guard on the fix's reach. Only a failed load empties the screen;
    // "বন্ধ করা যায়নি" after a good load must not take the banner away.
    const { client } = scriptedClient([OFF], {
      isSubscribed: async () => true,
      permission: () => 'granted',
      disable: async () => false,
    });
    const root = mount({ client });
    await settle();
    assert.equal(root.querySelector('[data-push-state]')?.getAttribute('data-push-state'), 'on');
    const off = [...root.querySelectorAll('button')].find((b) => /বন্ধ করুন/.test(b.textContent ?? ''));
    assert.ok(off, 'the on state offers the way back');
    off.click();
    await settle();
    assert.match(text(root), /বন্ধ করা যায়নি/);
    assert.ok(root.querySelector('[data-push-state]'), 'the banner stays after an action error');
    assert.match(text(root), /আপনার যন্ত্রসমূহ/, 'the device list stays after an action error');
  });
});

describe('finding 47 — who is told to fix a server without push keys', () => {
  const unconfigured = async (role: string) => {
    const { client } = scriptedClient([UNCONFIGURED]);
    const root = mount({ client, role });
    await settle();
    const banner = root.querySelector('[data-push-state]');
    assert.equal(banner?.getAttribute('data-push-state'), 'unconfigured', role);
    assert.equal(root.querySelectorAll('button').length, 0, `${role}: no button that cannot work`);
    return text(banner!);
  };

  test('an IT admin is not told to contact the IT admin', async () => {
    const copy = await unconfigured('it_admin');
    assert.doesNotMatch(copy, /আইটি অ্যাডমিন/);
    // It says where the switch actually is, and that nothing is lost meanwhile.
    assert.match(copy, /সার্ভার/);
    assert.match(copy, /অ্যাপ থেকে চালু হয় না/);
    assert.match(copy, /এসএমএস/);
    assert.doesNotMatch(copy, /ShikhonBD/i, 'D11: the operator is not named on a tenant screen');
  });

  test('other school staff are still pointed at the IT admin', async () => {
    for (const role of ['principal', 'school_owner', 'class_teacher', 'accountant']) {
      const copy = await unconfigured(role);
      assert.match(copy, /আইটি অ্যাডমিনকে জানাতে পারেন/, role);
    }
  });

  test('a guardian or student hears that messages still arrive, not a contact they lack', async () => {
    for (const role of ['guardian', 'student']) {
      const copy = await unconfigured(role);
      assert.doesNotMatch(copy, /আইটি অ্যাডমিন/, role);
      assert.match(copy, /এসএমএস/, role);
    }
  });

  test('the copy differs by role, and the title stays the state', async () => {
    const it = await unconfigured('it_admin');
    const staff = await unconfigured('principal');
    const family = await unconfigured('guardian');
    assert.equal(new Set([it, staff, family]).size, 3);
    for (const c of [it, staff, family]) assert.match(c, /এই সার্ভারে এখনো নোটিফিকেশন চালু করা হয়নি/);
  });
});
