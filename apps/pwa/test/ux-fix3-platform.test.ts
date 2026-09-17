/**
 * UX sweep round 3, platform console group.
 *
 *   1  A failed সংরক্ষণ in the operators drawer (a 500) showed nothing inside
 *      the open drawer. The page's failure card was drawn BEHIND it, on a page
 *      the drawer had made aria-hidden: a sighted operator saw nothing happen,
 *      and a reader heard it only once the drawer was closed
 *      (r16-375-drawer-save-fail.png). Now the failure is shown and said
 *      inside the drawer, which stays open with what was typed, and focus
 *      stays in it.
 *   2  Enter on the sign-in form with both fields empty fired two assertive
 *      alerts back to back ("অপারেটর টোকেন দিন।", then "PLATFORM_API_KEY
 *      দিন।"), and a reader may cut the first off. Now one alert per check
 *      names every missing field, and focus goes to the first one.
 *   3  After a keyboard page change focus lands on the page's h1. It carried
 *      only `plat-title`, so the sheet's `[tabindex]:focus-visible` ring still
 *      drew a 2px accent box round it. It now carries the focus keeper's
 *      LANDING_CLASS, whose style is an underline and no ring — the same as
 *      every heading the app shell lands focus on.
 *
 * DOM tests, like the rest of the console's. "Said" is read the way the
 * browser re-check reads it: a mutation that puts a visible alert on the page,
 * or changes the words inside one — and, as in ux-fix2-platform, never one
 * under `aria-hidden`, which no reader is handed.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let dom: JSDOM;
let Console: new (root: HTMLElement) => unknown;
let OpsView: new (o: Record<string, unknown>) => unknown;
let LANDING_CLASS: string;

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
  LANDING_CLASS = (await import('../src/ui/dom.ts')).LANDING_CLASS;
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
  total: 1,
  attention: { critical: 0, warning: 0, info: 0 },
  access: { full: 1, readOnly: 0, none: 0 },
  billing: { trial: 0, active: 1, grace: 0, overdue: 0 },
  usage: { students: 10, users: 3, classes: 1, sections: 1, paid: 1000 },
  quiet: 0, neverActive: 0, planUsage: { starter: 1 },
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
const OPERATOR = {
  id: 'op-1', fullName: 'রহিম উদ্দিন', email: 'r@example.org', note: '',
  status: 'active', actions: 3, lastSeenAt: null,
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
    : path.startsWith('operations') ? {
      operations: { tenantId: SCHOOL.id, nameBn: SCHOOL.nameBn }, services: [], payments: [] }
    : {},
});

function platformApi(answer: (path: string) => Answer): { asked: string[] } {
  const api = { asked: [] as string[] };
  (globalThis as Record<string, unknown>).fetch = async (url: unknown) => {
    const path = String(url).replace(/^.*\/api\/v1\/platform\//, '');
    api.asked.push(path);
    const { status, body } = answer(path);
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

/** Visible alerts, as a reader could reach them. */
const shownAlerts = (scope: ParentNode = root()): HTMLElement[] =>
  [...scope.querySelectorAll<HTMLElement>('[role="alert"]')].filter((a) => !a.closest('[hidden]'));

/**
 * What a screen reader is handed: every mutation that adds a node which is, is
 * inside, or holds a visible alert — or changes words inside one. An alert
 * under `aria-hidden` (the page behind an open drawer) is not handed to a
 * reader, so it is not counted as said.
 */
function announcements(): { flush: () => Promise<string[]>; stop: () => void } {
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
    flush: async () => { await settle(); record(mo.takeRecords()); return said.splice(0); },
    stop: () => mo.disconnect(),
  };
}
const alertsIn = (said: string[]): string[] => said.filter((s) => s.startsWith('alert:'));

// ── 1. a failed save in the operators drawer ─────────────────────────────

describe('1 — a failed সংরক্ষণ is shown and said inside the open operators drawer', () => {
  const dialog = (): HTMLElement | null => doc().querySelector<HTMLElement>('.ui-dialog');
  const drawerButton = (label: string): HTMLButtonElement =>
    [...doc().querySelectorAll<HTMLButtonElement>('.ui-dialog button')]
      .find((b) => (b.textContent ?? '').trim() === label)!;
  const drawerInput = (name: string): HTMLInputElement =>
    dialog()!.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const escape = (): void => {
    doc().dispatchEvent(new dom.window.KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }));
  };

  type SaveAnswer = () => Promise<unknown>;
  /**
   * The operations view on অপারেটর. `/operator` answers with `state.save`;
   * every other request is a healthy load. `saves` counts the POSTs.
   */
  async function operatorsView(state: { save: SaveAnswer; saves?: number },
    operators: unknown[] = []): Promise<{ showSection(s: string): void }> {
    state.saves = 0;
    const v = new OpsView({
      root: root(), doc: doc(),
      call: async (path: string) => {
        if (path === '/operator') { state.saves! += 1; return state.save(); }
        if (path === '/operators') return { operators };
        return healthy(path.replace(/^\//, '')).body;
      },
      onOpenTenant: () => {}, onNewTenant: () => {},
    }) as { showSection(s: string): void };
    await settle();
    v.showSection('operators');
    return v;
  }
  const serverError = async (): Promise<never> => {
    throw Object.assign(new Error('internal error'), { code: 'internal' });
  };
  /** Open the add drawer the way a keyboard does: focus the button, press it. */
  function openAdd(): HTMLButtonElement {
    const opener = buttonNamed('অপারেটরের নাম যোগ করুন');
    opener.focus();
    opener.click();
    assert.ok(dialog(), 'the drawer did not open');
    return opener;
  }
  function type(name: string, value: string): void {
    const i = drawerInput(name);
    i.value = value;
    i.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }

  test('THE ONE THAT MATTERS — a 500: the drawer stays open, the failure is in it, said once, with what was typed', async () => {
    await operatorsView({ save: serverError });
    openAdd();
    type('id', 'sub-42');
    type('fullName', 'পরীক্ষা অপারেটর');
    const save = drawerButton('সংরক্ষণ');
    save.focus();
    const ann = announcements();
    save.click();
    await settle();

    assert.ok(dialog(), 'a failed save closed the drawer');
    const card = dialog()!.querySelector<HTMLElement>('.ui-state-error');
    assert.ok(card, 'the failure is not shown inside the open drawer');
    assert.match(card.textContent ?? '', /অপারেটর সংরক্ষণ করা যায়নি।/);
    assert.ok(card.querySelector('[role="alert"]'), 'the failure in the drawer is not an alert');
    assert.equal(card.closest('[aria-hidden="true"]'), null, 'the failure is where no reader is handed it');

    // Nothing drawn behind the drawer, where nobody could see or hear it.
    assert.equal(root().querySelector('.ui-state-error'), null,
      'the failure card was drawn on the page behind the drawer');

    const said = alertsIn(await ann.flush());
    assert.equal(said.length, 1, `said ${said.length} times while the drawer is open: ${JSON.stringify(said)}`);
    assert.match(said[0]!, /অপারেটর সংরক্ষণ করা যায়নি।/);

    // What was typed is still there, and focus is still in the drawer.
    assert.equal(drawerInput('id').value, 'sub-42');
    assert.equal(drawerInput('fullName').value, 'পরীক্ষা অপারেটর');
    assert.equal(active(), save, 'focus is not on the সংরক্ষণ that was pressed');
    assert.equal(save.disabled, false, 'সংরক্ষণ stayed busy after the failure');
    assert.equal(save.getAttribute('aria-busy'), null);
    ann.stop();
  });

  test('closing the drawer after the failure says nothing more and leaves no card behind', async () => {
    const v = await operatorsView({ save: serverError });
    const opener = openAdd();
    drawerButton('সংরক্ষণ').click();
    await settle();
    const ann = announcements();
    escape();
    assert.equal(dialog(), null, 'Escape did not close the drawer');
    assert.deepEqual(alertsIn(await ann.flush()), [],
      'the failure already said in the drawer was said again when it closed');
    assert.equal(root().querySelector('.ui-state-error'), null,
      'a card about a form that is gone was left on the page');
    assert.ok(opener.isConnected, 'the page was redrawn under the drawer');
    assert.equal(active(), opener, 'focus did not go back to the button that opened the drawer');
    v.showSection('plans');
    assert.deepEqual(alertsIn(await ann.flush()), []);
    ann.stop();
  });

  test('a second failed press is said again, and the drawer holds one card, not two', async () => {
    await operatorsView({ save: serverError });
    openAdd();
    drawerButton('সংরক্ষণ').click();
    await settle();
    const ann = announcements();
    drawerButton('সংরক্ষণ').click();
    await settle();
    assert.equal(dialog()!.querySelectorAll('.ui-state').length, 1, 'failure cards piled up in the drawer');
    assert.equal(alertsIn(await ann.flush()).length, 1, 'the second failure was not said');
    ann.stop();
  });

  test('focus that fell out of the drawer while সংরক্ষণ was busy goes back to it', async () => {
    let fail!: () => void;
    const state = {
      save: () => new Promise((_, reject) => {
        fail = () => reject(Object.assign(new Error('internal error'), { code: 'internal' }));
      }),
    };
    await operatorsView(state);
    openAdd();
    const save = drawerButton('সংরক্ষণ');
    save.focus();
    save.click();
    await settle();
    // Busy while on the wire: a second press sends nothing.
    assert.equal(save.disabled, true, 'সংরক্ষণ is not busy while the save is on the wire');
    save.click();
    await settle();
    assert.equal((state as { saves?: number }).saves, 1, 'a press while busy sent a second save');
    // A browser drops focus from a control that becomes disabled (Chrome moves
    // it to <body>, outside the dialog). jsdom does not, and will not blur a
    // disabled control either, so do what Chrome does.
    assert.equal(active(), save);
    save.disabled = false;
    save.blur();
    save.disabled = true;
    assert.equal(active(), doc().body);
    fail();
    await settle();
    assert.equal(active(), save, 'focus was left outside the drawer after the failure');
  });

  test('a refusal on save is the canonical refusal card, inside the drawer', async () => {
    await operatorsView({
      save: async () => { throw Object.assign(new Error('platform credentials required'), { code: 'forbidden' }); },
    });
    openAdd();
    const ann = announcements();
    drawerButton('সংরক্ষণ').click();
    await settle();
    const card = dialog()!.querySelector('.ui-state-denied');
    assert.ok(card, 'the refusal is not shown inside the drawer');
    assert.match(card.textContent ?? '', /এই কাজটি করার অনুমতি আপনার নেই।/);
    assert.equal(root().querySelector('.ui-state-denied, .ui-state-error'), null, 'the refusal was drawn behind the drawer');
    assert.equal(alertsIn(await ann.flush()).length, 1);
    ann.stop();
  });

  test('revoking from an existing operator’s drawer fails the same way', async () => {
    await operatorsView({ save: serverError }, [OPERATOR]);
    const row = [...root().querySelectorAll<HTMLElement>('.ui-list-hit')]
      .find((r) => (r.textContent ?? '').includes(OPERATOR.fullName))!;
    row.click();
    assert.ok(dialog(), 'the operator’s drawer did not open');
    const revoke = drawerButton('প্রত্যাহার');
    revoke.focus();
    revoke.click();
    await settle();
    assert.ok(dialog(), 'a failed revoke closed the drawer');
    assert.ok(dialog()!.querySelector('.ui-state-error'), 'the failed revoke is not shown in the drawer');
    assert.equal(root().querySelector('.ui-state-error'), null);
    assert.equal(active(), revoke);
  });

  test('closed while the save is on the wire: the failure goes on the page, and is said there', async () => {
    let fail!: () => void;
    await operatorsView({
      save: () => new Promise((_, reject) => {
        fail = () => reject(Object.assign(new Error('internal error'), { code: 'internal' }));
      }),
    });
    openAdd();
    drawerButton('সংরক্ষণ').click();
    await settle();
    escape();
    assert.equal(dialog(), null);
    const ann = announcements();
    fail();
    await settle();
    assert.ok(root().querySelector('.ui-state-error'), 'a failure nobody could see any more was dropped');
    const said = alertsIn(await ann.flush());
    assert.equal(said.length, 1, `said ${said.length} times`);
    assert.match(said[0]!, /অপারেটর সংরক্ষণ করা যায়নি।/);
    ann.stop();
  });

  test('a good save still closes the drawer, says nothing alarming and lists the operator', async () => {
    await operatorsView({ save: async () => ({}) });
    openAdd();
    const ann = announcements();
    drawerButton('সংরক্ষণ').click();
    await settle();
    assert.equal(dialog(), null, 'a good save did not close the drawer');
    assert.match(root().textContent ?? '', /অপারেটর সংরক্ষণ হয়েছে।/);
    assert.deepEqual(alertsIn(await ann.flush()), []);
    ann.stop();
  });
});

// ── 2. one alert for an empty sign-in ────────────────────────────────────

describe('2 — Enter on an empty sign-in says one sentence, and focus goes to the first missing field', () => {
  function signInForm(): { form: HTMLFormElement; token: HTMLInputElement;
    key: HTMLInputElement; submit: HTMLButtonElement } {
    const form = root().querySelector<HTMLFormElement>('form.plat-form')!;
    const [token, key] = [...form.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    return { form, token: token!, key: key!, submit: form.querySelector('button[type="submit"]')! };
  }
  /** Enter inside a field: the form's submit, with focus left where it was. */
  const pressEnter = (form: HTMLFormElement): void => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  };
  const errorLine = (input: HTMLInputElement): HTMLElement =>
    input.closest('.ui-field')!.querySelector<HTMLElement>('.ui-field-error')!;

  test('THE ONE THAT MATTERS — both empty, Enter in the token field: ONE alert, naming both', async () => {
    const api = platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.focus();
    const ann = announcements();
    pressEnter(f.form);

    const said = alertsIn(await ann.flush());
    ann.stop();
    assert.equal(said.length, 1, `an empty form fired ${said.length} alerts: ${JSON.stringify(said)}`);
    assert.equal(said[0], 'alert: অপারেটর টোকেন ও PLATFORM_API_KEY দিন।');
    assert.equal(shownAlerts(f.form).length, 1, 'more than one alert stands on the form');

    // Focus on the first invalid field; both still marked, each with its own words.
    assert.equal(active(), f.token);
    for (const [input, words] of [[f.token, 'অপারেটর টোকেন দিন।'], [f.key, 'PLATFORM_API_KEY দিন।']] as const) {
      assert.equal(input.getAttribute('aria-invalid'), 'true');
      assert.equal(errorLine(input).hidden, false);
      assert.equal(errorLine(input).textContent, words);
      assert.match(input.getAttribute('aria-describedby') ?? '', new RegExp(errorLine(input).id));
      assert.equal(errorLine(input).closest('[role="alert"],[aria-live]'), null,
        'a field’s own line is an alert again: two alerts per press');
    }
    assert.equal(api.asked.length, 0, 'an empty form was sent');
  });

  test('from প্রবেশ: focus moves to the token field, and one alert is said', async () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.submit.focus();
    const ann = announcements();
    pressEnter(f.form);
    assert.equal(active(), f.token, 'focus did not go to the first missing field');
    assert.equal(alertsIn(await ann.flush()).length, 1);
    ann.stop();
  });

  test('the key’s name inside the sentence is read in an English voice', () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    pressEnter(f.form);
    const [alert] = shownAlerts(f.form);
    assert.ok(alert, 'nothing was said');
    const en = [...alert.querySelectorAll('[lang="en"]')].map((e) => e.textContent);
    assert.deepEqual(en, ['PLATFORM_API_KEY']);
  });

  test('only one missing: the sentence names only that one', async () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.key.value = 'k';
    f.token.focus();
    const ann = announcements();
    pressEnter(f.form);
    assert.deepEqual(alertsIn(await ann.flush()), ['alert: অপারেটর টোকেন দিন।']);
    assert.equal(active(), f.token);
    ann.stop();
  });

  test('pressing again is said again, and the form still holds one alert', async () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.focus();
    pressEnter(f.form);
    const ann = announcements();
    pressEnter(f.form);
    assert.equal(alertsIn(await ann.flush()).length, 1, 'a second Enter said nothing');
    assert.equal(shownAlerts(f.form).length, 1, 'alerts piled up on the form');
    ann.stop();
  });

  test('typing takes the sentence away: no stale alert naming a field that is filled', () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.focus();
    pressEnter(f.form);
    f.token.value = 'a';
    f.token.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.deepEqual(shownAlerts(f.form), [], 'the sentence naming the token stayed after it was typed');
    // The key is still wrong, and still tied to its words.
    assert.equal(f.key.getAttribute('aria-invalid'), 'true');
    assert.match(f.key.getAttribute('aria-describedby') ?? '', new RegExp(errorLine(f.key).id));
  });
});

// ── 3. the page name lands with the keeper's landing style ───────────────

describe('3 — the page name focus lands on carries LANDING_CLASS, not the ring', () => {
  test('THE ONE THAT MATTERS — a sidebar press lands on the section’s name, with LANDING_CLASS', async () => {
    platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    navRow('প্ল্যান').focus();
    navRow('প্ল্যান').click();
    const h = h1()!;
    assert.equal(active(), h, 'the focus move was lost');
    assert.equal(h.getAttribute('tabindex'), '-1');
    assert.ok(h.classList.contains(LANDING_CLASS),
      `the focused name has no ${LANDING_CLASS}: the sheet's ring draws round it`);
  });

  test('the landing style is the one that takes the ring away (app.css)', () => {
    const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
    const rule = new RegExp(`\\.${LANDING_CLASS}\\[tabindex\\]:focus-visible\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(rule, `app.css has no .${LANDING_CLASS}[tabindex]:focus-visible rule`);
    assert.match(rule[1]!, /outline:\s*none/);
  });

  test('every page name focus can land on has it: sign-in, sections, a school, list, go-live, wizard', async () => {
    platformApi(healthy);
    new Console(root());
    const has = (where: string): void => {
      const h = h1();
      assert.ok(h, `${where}: no h1`);
      assert.ok(h.classList.contains(LANDING_CLASS), `${where}: no ${LANDING_CLASS}`);
      assert.equal(root().querySelectorAll(`.${LANDING_CLASS}`).length, 1, `${where}: not only the name`);
    };
    has('sign-in');
    const form = root().querySelector<HTMLFormElement>('form.plat-form')!;
    const [token, key] = [...form.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    token!.value = 't'; key!.value = 'k';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(active(), h1());
    has('ফ্লিট after sign-in');
    for (const label of ['প্রতিষ্ঠান', 'অপারেটর', 'প্ল্যান', 'ড্যাশবোর্ড']) {
      navRow(label).click();
      assert.equal(active(), h1(), label);
      has(label);
    }
    buttonNamed('প্রভিশনিং তালিকা').click();
    await settle();
    has('provisioning list');
    buttonNamed('গো-লাইভ অবস্থা').click();
    await settle();
    has('go-live');
    buttonNamed('তালিকায় ফিরুন').click();
    await settle();
    buttonNamed('নতুন প্রতিষ্ঠান').click();
    assert.match(h1()?.textContent ?? '', /^ধাপ/);
    has('wizard');
  });

  test('a school’s page in operations: its name takes focus with LANDING_CLASS', async () => {
    const v = new OpsView({
      root: root(), doc: doc(),
      call: async (path: string) => healthy(path.replace(/^\//, '')).body,
      onOpenTenant: () => {}, onNewTenant: () => {},
    }) as { openDetail(id: string, focus?: boolean): Promise<void> };
    await settle();
    await v.openDetail(SCHOOL.id);
    await settle();
    const h = root().querySelector<HTMLElement>('.plat-bar h1')!;
    assert.equal(active(), h, 'focus is not on the school’s name');
    assert.ok(h.classList.contains(LANDING_CLASS));
  });

  test('the class stays after focus leaves, so the next landing is styled too', async () => {
    platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    navRow('অপারেটর').click();
    const h = h1()!;
    assert.equal(active(), h);
    navRow('প্ল্যান').focus();
    h.dispatchEvent(new dom.window.FocusEvent('blur'));
    assert.ok(h.classList.contains(LANDING_CLASS), 'leaving the name took its landing style away');
  });
});
