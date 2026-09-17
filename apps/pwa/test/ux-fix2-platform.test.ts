/**
 * UX sweep round 2, platform console group: R14, R15, R16.
 *
 *   R14  Enter inside an empty sign-in field that already had focus said
 *        nothing: focus did not move (so aria-describedby was never read),
 *        and the field's error line was neither an alert nor inside a live
 *        region — only aria-invalid changed.
 *   R15  After a keyboard page change focus goes to the page's h1, and the
 *        sheet's ring was drawn round the whole title row (about 970px wide at
 *        1280). The move stays; the name carries `plat-title`, which app.css
 *        sizes to its words (the CSS goes to the lead as data).
 *   R16  A failure card was built afresh, as an alert, on every redraw: every
 *        sidebar press while a load error stood announced it again, and one
 *        refusal on the provisioning list was reported as two alerts because
 *        the page went in empty and was filled in place.
 *
 * DOM tests, like the rest of the console's. "Announced" is read the way the
 * browser re-check reads it: a mutation that puts a visible alert on the page,
 * or changes the words inside one.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom: JSDOM;
let Console: new (root: HTMLElement) => unknown;
let OpsView: new (o: Record<string, unknown>) => unknown;

before(async () => {
  dom = new JSDOM('<!doctype html><html lang="bn"><body></body></html>',
    { url: 'https://platform.sikhon.systems/platform.html' });
  const g = globalThis as Record<string, unknown>;
  // platform.ts reads `document` and `sessionStorage` in field initialisers.
  g.document = dom.window.document;
  g.window = dom.window;
  g.HTMLElement = dom.window.HTMLElement;
  g.localStorage = dom.window.localStorage;
  g.sessionStorage = dom.window.sessionStorage;
  g.location = dom.window.location;
  g.fetch = async () => new Response('{}', { status: 200 });
  Console = (await import('../src/platform.ts') as {
    Console_: new (root: HTMLElement) => unknown }).Console_;
  OpsView = (await import('../src/platform-ops.ts') as {
    PlatformOpsView: new (o: Record<string, unknown>) => unknown }).PlatformOpsView;
});

const doc = (): Document => dom.window.document;

/** A fresh root per test: each console arms a focus keeper on its own root. */
function freshRoot(): HTMLElement {
  const root = doc().createElement('div');
  root.id = 'root';
  root.className = 'platform-shell';
  doc().body.replaceChildren(root);
  return root as unknown as HTMLElement;
}

beforeEach(() => {
  dom.window.sessionStorage.clear();
  freshRoot();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 1));
};

const PAGE = { page: 1, size: 25, total: 1, pages: 1, sort: 'name', dir: 'asc' };
const SUMMARY = {
  total: 258,
  attention: { critical: 3, warning: 9, info: 14 },
  access: { full: 240, readOnly: 12, none: 6 },
  billing: { trial: 30, active: 200, grace: 20, overdue: 8 },
  usage: { students: 84_000, users: 5_100, classes: 2_400, sections: 6_100, paid: 4_500_000 },
  quiet: 11, neverActive: 4, planUsage: { starter: 200 },
};
const SCHOOL = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'ek', nameBn: 'এক বিদ্যালয়',
  nameEn: 'Ek School', stream: 'bangla_medium', level: 'secondary', district: 'ঢাকা',
  status: 'active', access: 'full', opsState: 'active', billingState: 'active',
  stateReason: null, planCode: 'starter', planName: 'স্টার্টার', planPrice: '1000',
  billingCycle: 'monthly', studentCap: 500, studentCount: 10, userCount: 3,
  paidTotal: '1000', nextDueOn: null, graceUntil: null, trialEndsOn: null,
  createdAt: '2026-01-01T00:00:00Z', lastActiveAt: '2026-09-01T00:00:00Z',
  portals: {}, services: {},
};

type Answer = { status: number; body: unknown };
const healthy = (path: string): Answer => ({
  status: 200,
  body: path.startsWith('tenants') ? { tenants: [SCHOOL], page: PAGE }
    : path.startsWith('fleetsummary') ? SUMMARY
    : path.startsWith('catalogue') ? { plans: [], services: [] }
    : path.startsWith('audit') ? { entries: [] }
    : path.startsWith('operators') ? { operators: [] }
    : path.startsWith('readiness') ? { checks: [], ready: true, blockingRemaining: 0 }
    : {},
});
const refusing = (): Answer => ({
  status: 403, body: { error: 'forbidden', message: 'platform credentials required' },
});
const failing = (): Answer => ({
  status: 503, body: { error: 'no_api_in_static_preview' },
});

/**
 * The platform API. `answer` may be swapped mid-test; `hold`, when set, is a
 * promise every request waits on first (a load still on the wire).
 */
function platformApi(answer: (path: string) => Answer): {
  answer: (path: string) => Answer; hold: Promise<void> | null; asked: string[];
} {
  const api = { answer, hold: null as Promise<void> | null, asked: [] as string[] };
  (globalThis as Record<string, unknown>).fetch = async (url: unknown) => {
    const path = String(url).replace(/^.*\/api\/v1\/platform\//, '');
    api.asked.push(path);
    if (api.hold) await api.hold;
    const { status, body } = api.answer(path);
    return new Response(JSON.stringify(body), { status });
  };
  return api;
}

function signedIn(): void {
  dom.window.sessionStorage.setItem('shikhon_platform_token', 'op-token');
  dom.window.sessionStorage.setItem('shikhon_platform_key', 'op-key');
}

const root = (): HTMLElement => doc().getElementById('root') as unknown as HTMLElement;
const h1 = (): HTMLElement | null => root().querySelector('h1');
const active = (): Element | null => doc().activeElement;
const navRow = (label: string): HTMLButtonElement =>
  [...root().querySelectorAll<HTMLButtonElement>('nav.plat-nav .plat-nav-item')]
    .find((b) => b.textContent === label)!;
const buttonNamed = (label: string): HTMLButtonElement =>
  [...root().querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === label)!;

function signInForm(): { form: HTMLFormElement; token: HTMLInputElement;
  key: HTMLInputElement; submit: HTMLButtonElement } {
  const form = root().querySelector<HTMLFormElement>('form.plat-form')!;
  const [token, key] = [...form.querySelectorAll<HTMLInputElement>('input[type="password"]')];
  return { form, token: token!, key: key!, submit: form.querySelector('button[type="submit"]')! };
}
/** Enter inside a field: the form's submit, with focus left where it was. */
function pressEnter(form: HTMLFormElement): void {
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}
const errorLine = (input: HTMLInputElement): HTMLElement =>
  input.closest('.ui-field')!.querySelector<HTMLElement>('.ui-field-error')!;

/** Visible alerts on the page, as a reader could reach them. */
const shownAlerts = (scope: ParentNode = root()): HTMLElement[] =>
  [...scope.querySelectorAll<HTMLElement>('[role="alert"]')].filter((a) => !a.closest('[hidden]'));

/**
 * What a screen reader is handed, counted the way the browser re-check counts
 * it (scratchpad/ux/work/recheck-9710/lib.mjs): every mutation that adds a node
 * which is, is inside, or holds a visible alert — or changes words inside one.
 * Stricter than lib.mjs in one way: an alert under `aria-hidden` (the page
 * behind an open drawer — overlay.ts hides it) is not handed to a reader, so
 * it is not counted as said.
 */
function announcements(): { said: string[]; flush: () => Promise<string[]>; stop: () => void } {
  const said: string[] = [];
  const LIVE = '[aria-live]:not([aria-live=off]),[role=alert],[role=status],[role=log]';
  const record = (ms: MutationRecord[]): void => {
    for (const m of ms) {
      const nodes = m.type === 'childList' ? [...m.addedNodes] : [m.target];
      for (const n of nodes) {
        const e = (n.nodeType === 1 ? n : n.parentElement) as HTMLElement | null;
        if (!e || !e.isConnected) continue;
        const region = e.closest<HTMLElement>(LIVE) ?? e.querySelector<HTMLElement>('[role=alert]');
        if (region && !region.closest('[hidden]') && !region.closest('[aria-hidden="true"]')) {
          said.push(`${region.getAttribute('role') ?? 'live'}: ${(region.textContent ?? '').trim()}`);
        }
      }
    }
  };
  const mo = new dom.window.MutationObserver(record);
  mo.observe(doc().documentElement, { subtree: true, childList: true, characterData: true });
  return {
    said,
    flush: async () => { await settle(); record(mo.takeRecords()); return said.splice(0); },
    stop: () => mo.disconnect(),
  };
}

// ── R14 ───────────────────────────────────────────────────────────────────

describe('R14 — Enter in an empty sign-in field is said, with focus on that field', () => {
  test('THE ONE THAT MATTERS — Enter in the token field, both empty: focus stays, and both missing fields are announced', async () => {
    const api = platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.focus();
    const ann = announcements();
    pressEnter(f.form);

    // Focus did not move — so nothing is read through aria-describedby. The
    // words must be an alert, or the press says nothing at all.
    assert.equal(active(), f.token, 'focus is not on the invalid field');
    const line = errorLine(f.token);
    assert.equal(line.hidden, false);
    assert.equal(line.textContent, 'অপারেটর টোকেন দিন।');
    assert.equal(errorLine(f.key).hidden, false);
    assert.equal(errorLine(f.key).textContent, 'PLATFORM_API_KEY দিন।');

    // Round 3: said as ONE alert naming both (two alerts back to back let a
    // reader cut the first off). The key's error is not read by any focus
    // move at all, so it must be in what is said.
    const said = await ann.flush();
    ann.stop();
    const alerts = said.filter((s) => s.startsWith('alert:'));
    assert.equal(alerts.length, 1, `not one alert: ${JSON.stringify(said)}`);
    assert.match(alerts[0]!, /অপারেটর টোকেন/, `the token is not announced: ${JSON.stringify(said)}`);
    assert.match(alerts[0]!, /PLATFORM_API_KEY/, `the key is not announced: ${JSON.stringify(said)}`);
    assert.equal(api.asked.length, 0, 'an empty form was sent');
  });

  test('Enter in the empty key field after typing a token: focus stays on the key, its error is announced', async () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.value = 'tok';
    f.key.focus();
    const ann = announcements();
    pressEnter(f.form);

    assert.equal(active(), f.key, 'focus is not on the invalid field');
    const line = errorLine(f.key);
    assert.equal(line.hidden, false);
    assert.equal(f.key.getAttribute('aria-invalid'), 'true');
    // The filled field is neither marked nor an (empty) alert.
    assert.equal(errorLine(f.token).hidden, true);
    assert.deepEqual(shownAlerts(f.form).map((a) => a.textContent), ['PLATFORM_API_KEY দিন।']);

    const said = await ann.flush();
    ann.stop();
    assert.deepEqual(said, ['alert: PLATFORM_API_KEY দিন।']);
  });

  test('a second Enter in the still-empty field is said again', async () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.value = 'tok';
    f.key.focus();
    pressEnter(f.form);
    const ann = announcements();
    pressEnter(f.form);
    const said = await ann.flush();
    ann.stop();
    assert.equal(active(), f.key);
    assert.deepEqual(said, ['alert: PLATFORM_API_KEY দিন।'],
      'pressing Enter again in the empty field said nothing');
  });

  test('from প্রবেশ, focus moves to the first missing field (the move reads it too)', () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.submit.focus();
    pressEnter(f.form);
    assert.equal(active(), f.token);
    assert.match(f.token.getAttribute('aria-describedby') ?? '', new RegExp(errorLine(f.token).id));
  });

  test('typing clears the line, and leaves no empty alert behind', () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.focus();
    pressEnter(f.form);
    f.token.value = 'a';
    f.token.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(errorLine(f.token).hidden, true);
    assert.equal(errorLine(f.token).getAttribute('role'), null, 'an empty, hidden alert was left on the form');
    // Round 3: nor an alert still naming the token that has just been typed.
    assert.deepEqual(shownAlerts(f.form), [], 'a stale alert was left on the form');
    // The other field is still wrong, and still tied to its words.
    assert.equal(f.key.getAttribute('aria-invalid'), 'true');
    assert.equal(errorLine(f.key).hidden, false);
    assert.match(f.key.getAttribute('aria-describedby') ?? '', new RegExp(errorLine(f.key).id));
  });
});

// ── R15 ───────────────────────────────────────────────────────────────────

describe('R15 — the page name still takes focus, and carries the hook that sizes its ring', () => {
  test('THE ONE THAT MATTERS — a sidebar press lands on the section’s name, marked plat-title', async () => {
    platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    navRow('প্ল্যান').click();
    const h = h1()!;
    assert.equal(active(), h, 'the focus move was lost');
    assert.equal(h.getAttribute('tabindex'), '-1');
    assert.ok(h.classList.contains('plat-title'), 'the focused name has no plat-title hook for its ring');
  });

  test('every page name focus can land on has it: sign-in, sections, list, go-live, wizard', async () => {
    platformApi(healthy);
    new Console(root());
    assert.ok(h1()!.classList.contains('plat-title'), 'sign-in');
    const f = signInForm();
    f.token.value = 't'; f.key.value = 'k';
    f.submit.focus();
    pressEnter(f.form);
    await settle();
    assert.equal(active(), h1());
    assert.ok(h1()!.classList.contains('plat-title'), 'ফ্লিট after sign-in');
    for (const label of ['প্রতিষ্ঠান', 'অপারেটর', 'ড্যাশবোর্ড']) {
      navRow(label).click();
      assert.equal(active(), h1());
      assert.ok(h1()!.classList.contains('plat-title'), label);
    }
    buttonNamed('প্রভিশনিং তালিকা').click();
    await settle();
    assert.equal(h1()?.textContent, 'প্রতিষ্ঠানসমূহ');
    assert.ok(h1()!.classList.contains('plat-title'), 'provisioning list');
    buttonNamed('গো-লাইভ অবস্থা').click();
    await settle();
    assert.ok(h1()!.classList.contains('plat-title'), 'go-live');
    buttonNamed('তালিকায় ফিরুন').click();
    await settle();
    buttonNamed('নতুন প্রতিষ্ঠান').click();
    assert.match(h1()?.textContent ?? '', /^ধাপ/);
    assert.equal(active(), h1());
    assert.ok(h1()!.classList.contains('plat-title'), 'wizard');
    // Only the name: a title's classes are added to, never replaced.
    assert.equal(root().querySelectorAll('.plat-title').length, 1);
  });
});

// ── R16 ───────────────────────────────────────────────────────────────────

describe('R16 — a failure is announced once, when it is first shown', () => {
  const brokenCall = (fail: { code: string; message: string }) => async (): Promise<never> => {
    throw Object.assign(new Error(fail.message), { code: fail.code });
  };

  for (const [kind, fail, cardSel] of [
    ['a load error', { code: 'internal', message: 'internal error' }, '.ui-state-error'],
    ['a refusal', { code: 'forbidden', message: 'platform credentials required' }, '.ui-state-denied'],
  ] as Array<[string, { code: string; message: string }, string]>) {
    test(`THE ONE THAT MATTERS — ${kind}: every section shows it, only the first says it`, async () => {
      const v = new OpsView({
        root: root(), doc: doc(), call: brokenCall(fail),
        onOpenTenant: () => {}, onNewTenant: () => {},
      }) as { showSection(s: string): void };
      await settle();
      assert.equal(shownAlerts().length, 1, `${kind} was never announced`);
      const words = root().querySelector(cardSel)!.textContent;

      const ann = announcements();
      for (const s of ['plans', 'operators', 'institutions', 'dashboard', 'plans']) {
        v.showSection(s);
        const card = root().querySelector(cardSel);
        assert.ok(card, `${s}: the failure is no longer shown`);
        assert.equal(card.textContent, words, `${s}: the card’s words changed`);
        assert.deepEqual(shownAlerts(), [], `${s}: the same failure was announced again`);
      }
      assert.deepEqual(await ann.flush(), [], 'section changes re-announced the failure');
      ann.stop();
      // Still the canonical cards: the refusal is the shared note again, the
      // error keeps its retry.
      if (kind === 'a refusal') {
        assert.equal(root().querySelector(cardSel)!.getAttribute('role'), 'note');
      } else {
        assert.ok(buttonNamed('আবার চেষ্টা করুন'), 'the retry went with the alert');
      }
    });
  }

  test('a retry that fails again is a new failure, and is said again', async () => {
    new OpsView({
      root: root(), doc: doc(), call: brokenCall({ code: 'internal', message: 'internal error' }),
      onOpenTenant: () => {}, onNewTenant: () => {},
    });
    await settle();
    const ann = announcements();
    buttonNamed('আবার চেষ্টা করুন').click();
    await settle();
    assert.equal(shownAlerts().length, 1, 'a retry that failed again was not announced');
    assert.equal((await ann.flush()).filter((s) => s.startsWith('alert:')).length, 1);
    ann.stop();
  });

  test('a হালনাগাদ that fails after a good load is said', async () => {
    let fail = false;
    const v = new OpsView({
      root: root(), doc: doc(),
      call: async (path: string) => {
        if (fail) throw Object.assign(new Error('internal error'), { code: 'internal' });
        return healthy(path.replace(/^\//, '')).body;
      },
      onOpenTenant: () => {}, onNewTenant: () => {},
    }) as { showSection(s: string): void };
    await settle();
    fail = true;
    buttonNamed('হালনাগাদ').click();
    await settle();
    assert.equal(shownAlerts().length, 1, 'the failed refresh was not announced');
    v.showSection('plans');
    assert.equal(shownAlerts().length, 0, 'the failed refresh was announced again by a section change');
  });

  test('in the console: a sidebar press does not re-announce, and the provisioning list’s refusal is one alert', async () => {
    platformApi(refusing);
    signedIn();
    new Console(root());
    const ann = announcements();
    await settle();
    assert.equal((await ann.flush()).length, 1, 'the console’s refusal was not announced once');

    navRow('প্ল্যান').click();
    navRow('অপারেটর').click();
    assert.ok(root().querySelector('.ui-state-denied'), 'the refusal is no longer shown');
    assert.deepEqual(await ann.flush(), [], 'sidebar presses re-announced the refusal');

    buttonNamed('প্রভিশনিং তালিকা').click();
    const said = await ann.flush();
    assert.equal(said.length, 1, `one refusal on the provisioning list was reported ${said.length} times: ${JSON.stringify(said)}`);
    assert.match(said[0]!, /^alert: এই কাজটি করার অনুমতি আপনার নেই।/);
    ann.stop();
  });

  test('back to operations from the list: the failure it already said is put back quiet', async () => {
    platformApi(failing);
    signedIn();
    new Console(root());
    await settle();
    assert.equal(shownAlerts().length, 1);
    buttonNamed('প্রভিশনিং তালিকা').click();
    await settle();
    const ann = announcements();
    buttonNamed('অপারেশনস').click();
    assert.equal(h1()?.textContent, 'ফ্লিট');
    assert.ok(root().querySelector('.plat-ops .ui-state-error'), 'the operations failure is not shown');
    assert.deepEqual(shownAlerts(root().querySelector('.plat-ops')!), [],
      'putting operations back on the page announced its old failure again');
    assert.deepEqual(await ann.flush(), []);
    ann.stop();
  });

  /** Operations fails while the provisioning list is on screen. */
  async function failWhileAway(): Promise<void> {
    const api = platformApi(failing);
    let release!: () => void;
    api.hold = new Promise<void>((r) => { release = r; });
    signedIn();
    new Console(root());
    // Operations is still loading; the operator opens the provisioning list.
    buttonNamed('প্রভিশনিং তালিকা').click();
    api.answer = (p) => (p.startsWith('tenants?q') || p.startsWith('fleetsummary') ? healthy(p) : failing());
    release();
    api.hold = null;
    await settle();
    assert.equal(h1()?.textContent, 'প্রতিষ্ঠানসমূহ');
  }
  const opsAlerts = (): HTMLElement[] => shownAlerts(root().querySelector('.plat-ops')!);

  test('a failure that happened while operations was off the page is said when it is first shown (back link)', async () => {
    await failWhileAway();
    const ann = announcements();
    buttonNamed('অপারেশনস').click();
    assert.equal(opsAlerts().length, 1,
      'a failure never on the page before was put there without being announced');
    assert.equal((await ann.flush()).filter((s) => s.startsWith('alert:')).length, 1);
    // Heard now — so the next section change does not say it again.
    navRow('প্ল্যান').click();
    assert.equal(opsAlerts().length, 0);
    assert.deepEqual(await ann.flush(), []);
    ann.stop();
  });

  test('… and the same by a sidebar press, which puts operations back and redraws it in one go', async () => {
    await failWhileAway();
    const ann = announcements();
    navRow('প্ল্যান').click();
    assert.equal(h1()?.textContent, 'প্ল্যান');
    assert.equal(opsAlerts().length, 1,
      'putting operations back and redrawing it in the same press silenced a failure nobody had heard');
    assert.equal((await ann.flush()).filter((s) => s.startsWith('alert:')).length, 1);
    navRow('অপারেটর').click();
    assert.equal(opsAlerts().length, 0, 'the next press said it again');
    assert.deepEqual(await ann.flush(), []);
    ann.stop();
  });

  // ── behind a drawer ──────────────────────────────────────────────────
  //
  // openDrawer (ui/overlay.ts) sets aria-hidden on everything else in <body>
  // while it is open. A card drawn under it is on the page and connected, and
  // no reader is handed it — so it must not be counted as said, and it must
  // be said once the drawer is gone.

  const alertsIn = (said: string[]): string[] => said.filter((s) => s.startsWith('alert:'));
  const drawerButton = (label: string): HTMLButtonElement =>
    [...doc().querySelectorAll<HTMLButtonElement>('.ui-dialog button')]
      .find((b) => (b.textContent ?? '').trim() === label)!;
  /** Escape, the way a keyboard closes a drawer. */
  const escape = (): void => {
    doc().dispatchEvent(new dom.window.KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }));
  };
  /** A view whose /operator POST fails while `failSave` says so. */
  function operatorsView(state: { failSave: boolean }): { showSection(s: string): void } {
    return new OpsView({
      root: root(), doc: doc(),
      call: async (path: string) => {
        if (path === '/operator' && state.failSave) {
          throw Object.assign(new Error('fullName is required'), { code: 'invalid' });
        }
        return healthy(path.replace(/^\//, '')).body;
      },
      onOpenTenant: () => {}, onNewTenant: () => {},
    }) as { showSection(s: string): void };
  }

  // Round 3: a failure of the drawer's OWN save is no longer drawn behind it.
  // It is shown and said inside the open drawer (ux-fix3-platform, item 1);
  // what this test protects — the failed save is said exactly once, and never
  // again by closing the drawer or changing section — still holds.
  test('THE ONE THAT MATTERS — a save that fails in the operator drawer is said once, and not again when the drawer closes', async () => {
    const v = operatorsView({ failSave: true });
    await settle();
    v.showSection('operators');
    const ann = announcements();
    buttonNamed('অপারেটরের নাম যোগ করুন').click();
    drawerButton('সংরক্ষণ').click();
    await settle();
    assert.equal(root().getAttribute('aria-hidden'), 'true', 'the drawer did not hide the page');
    assert.ok(doc().querySelector('.ui-dialog .ui-state-error'), 'the failure is not shown in the drawer');
    const saidOpen = alertsIn(await ann.flush());
    assert.equal(saidOpen.length, 1,
      `a failed save was ${saidOpen.length ? `said ${saidOpen.length} times` : 'never said'} while the drawer is open`);
    assert.match(saidOpen[0]!, /অপারেটর সংরক্ষণ করা যায়নি।/);

    escape();
    assert.equal(doc().querySelector('.ui-dialog'), null, 'Escape did not close the drawer');
    assert.deepEqual(alertsIn(await ann.flush()), [], 'closing the drawer said it a second time');

    v.showSection('plans');
    assert.deepEqual(alertsIn(await ann.flush()), [], 'the section change said it a second time');
    ann.stop();
  });

  test('a load that fails while the operator drawer is open is said once, when it closes', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const v = new OpsView({
      root: root(), doc: doc(),
      call: async () => {
        await held;
        throw Object.assign(new Error('internal error'), { code: 'internal' });
      },
      onOpenTenant: () => {}, onNewTenant: () => {},
    }) as { showSection(s: string): void };
    // Still loading: the operator goes to অপারেটর and opens the drawer.
    v.showSection('operators');
    buttonNamed('অপারেটরের নাম যোগ করুন').click();
    const ann = announcements();
    release();
    await settle();
    assert.ok(root().querySelector('.ui-state-error'));
    assert.deepEqual(alertsIn(await ann.flush()), []);

    escape();
    const said = alertsIn(await ann.flush());
    assert.equal(said.length, 1, `the load failure was said ${said.length} times when the drawer closed`);
    assert.match(said[0]!, /তালিকা আনা যায়নি।/);
    v.showSection('dashboard');
    assert.deepEqual(alertsIn(await ann.flush()), []);
    ann.stop();
  });

  test('a failed save that a second save overcomes is not said as the drawer closes', async () => {
    const state = { failSave: true };
    const v = operatorsView(state);
    await settle();
    v.showSection('operators');
    buttonNamed('অপারেটরের নাম যোগ করুন').click();
    drawerButton('সংরক্ষণ').click();
    await settle();
    const ann = announcements();
    state.failSave = false;
    drawerButton('সংরক্ষণ').click();
    await settle();
    assert.equal(doc().querySelector('.ui-dialog'), null, 'the good save did not close the drawer');
    assert.equal(root().querySelector('.ui-state-error'), null);
    const said = await ann.flush();
    assert.deepEqual(alertsIn(said), [], `the overcome failure was said: ${JSON.stringify(said)}`);
    ann.stop();
  });

  test('in the console: operations put back behind an open drawer is said when the drawer closes, once', async () => {
    const { openDrawer } = await import('../src/ui/overlay.ts');
    await failWhileAway();
    // Any drawer at all: the page is hidden while it is open.
    const drawer = openDrawer(doc(), { title: 'ছাঁকনি', body: doc().createElement('p') });
    const ann = announcements();
    buttonNamed('অপারেশনস').click();
    assert.ok(root().querySelector('.plat-ops .ui-state-error'), 'the operations failure is not shown');
    assert.deepEqual(alertsIn(await ann.flush()), []);

    drawer.close();
    assert.equal(alertsIn(await ann.flush()).length, 1,
      'put back behind a drawer, the failure was counted as heard and never said');
    navRow('প্ল্যান').click();
    assert.deepEqual(alertsIn(await ann.flush()), [], 'the next press said it again');
    ann.stop();
  });

  test('signing out stops the thrown-away operations view listening for overlays', async () => {
    const d = doc();
    const live = new Set<unknown>();
    const add = d.addEventListener.bind(d);
    const remove = d.removeEventListener.bind(d);
    d.addEventListener = ((type: string, fn: unknown, o?: unknown) => {
      if (type === 'ui:overlay-closed') live.add(fn);
      return add(type, fn as EventListener, o as boolean);
    }) as typeof d.addEventListener;
    d.removeEventListener = ((type: string, fn: unknown, o?: unknown) => {
      if (type === 'ui:overlay-closed') live.delete(fn);
      return remove(type, fn as EventListener, o as boolean);
    }) as typeof d.removeEventListener;
    try {
      platformApi(healthy);
      signedIn();
      new Console(root());
      await settle();
      const ops = (): unknown[] => [...live].filter((fn) => String(fn).includes('sayUnheard'));
      assert.equal(ops().length, 1, 'the operations view does not listen for overlays closing');
      buttonNamed('সেশন শেষ').click();
      assert.ok(signInForm().form, 'not signed out');
      assert.deepEqual(ops(), [], 'the signed-out view is still listening on the document');
    } finally {
      // Own properties over the prototype's: removing them restores both.
      delete (d as unknown as Record<string, unknown>).addEventListener;
      delete (d as unknown as Record<string, unknown>).removeEventListener;
    }
  });
});
