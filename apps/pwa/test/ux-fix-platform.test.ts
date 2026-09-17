/**
 * UX sweep, platform console group: findings 68–72.
 *
 *   68  A first load that failed drew the section under the error card as if
 *       it had loaded: every figure ০, "সব ঠিক আছে — কোনো প্রতিষ্ঠানে বকেয়া
 *       নেই…", "কোনো প্ল্যান নেই".
 *   69  A mistyped token or key was stored and treated as a sign-in; the
 *       refusal never named them; "সেশন শেষ" left the session's error on the
 *       fresh form; sign-in fetched the list and the summary twice.
 *   70  That refusal was never announced (role=note, focus on <body>).
 *   71  The sign-in check redrew the page: focus fell to <body>, and the error
 *       was tied to no field.
 *   72  Every console action redrew the page and dropped focus to <body>.
 *
 * DOM tests, like the rest of the console's: each defect was what the page
 * did, not what a function returned.
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

/**
 * A fresh root for every test. Each console arms a focus keeper on its root
 * and never disarms it; a root of its own keeps one test's keeper out of the
 * next test's focus.
 */
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

/** The platform API, answering however the test says, and remembering what it was asked. */
function platformApi(answer: (path: string) => Answer):
  { answer: (path: string) => Answer; asked: Array<{ path: string; key: string }> } {
  const api = { answer, asked: [] as Array<{ path: string; key: string }> };
  (globalThis as Record<string, unknown>).fetch = async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1\/platform\//, '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    api.asked.push({ path, key: headers['X-Platform-Key'] ?? '' });
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
const text = (): string => root().textContent ?? '';
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
function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}
/** The text an element's aria-describedby points at. */
function describedBy(input: HTMLElement): string {
  return (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    .map((id) => doc().getElementById(id)?.textContent ?? '').join(' ');
}

// ── 68 ────────────────────────────────────────────────────────────────────

describe('68 — a first load that failed is an error, not an empty or healthy fleet', () => {
  const broken = async (): Promise<never> => {
    throw Object.assign(new Error('internal error'), { code: 'internal' });
  };

  for (const [tab, calm] of [
    ['dashboard', /সব ঠিক আছে/],
    ['plans', /কোনো প্ল্যান নেই/],
    ['operators', /কোনো অপারেটরের নাম রাখা হয়নি/],
    ['institutions', /কোনো প্রতিষ্ঠান নেই/],
  ] as Array<[string, RegExp]>) {
    test(`${tab}: the error and its retry, and nothing drawn from what was never read`, async () => {
      const v = new OpsView({
        root: root(), doc: doc(), call: broken, onOpenTenant: () => {}, onNewTenant: () => {},
      }) as { showSection(s: string): void };
      await settle();
      v.showSection(tab);
      assert.ok(root().querySelector('.ui-state-error'), 'the failure is not shown');
      assert.match(text(), /আবার চেষ্টা করুন/, 'the failure lost its retry');
      assert.equal(root().querySelector('.ui-stat'), null, 'figures were drawn over a failed load');
      assert.doesNotMatch(text(), calm, 'a failed load was drawn as an empty or healthy section');
      assert.equal(root().querySelector('.plat-filter-band'), null,
        'filter tabs with ০ counts were drawn over a failed load');
      assert.equal(h1()?.textContent, { dashboard: 'ফ্লিট', plans: 'প্ল্যান',
        operators: 'অপারেটর', institutions: 'প্রতিষ্ঠান' }[tab], 'the section bar is still drawn');
    });
  }

  test('a refresh that fails AFTER a good load keeps the real figures under the error', async () => {
    let fail = false;
    new OpsView({
      root: root(), doc: doc(),
      call: async (path: string) => {
        if (fail) return broken();
        return healthy(path.replace(/^\//, '')).body;
      },
      onOpenTenant: () => {}, onNewTenant: () => {},
    });
    await settle();
    fail = true;
    buttonNamed('হালনাগাদ').click();
    await settle();
    assert.ok(root().querySelector('.ui-state-error'), 'the failed refresh is not shown');
    const total = [...root().querySelectorAll('.ui-stat')]
      .find((c) => c.querySelector('.ui-stat-label')?.textContent === 'প্রতিষ্ঠান');
    assert.equal(total?.querySelector('.ui-stat-value')?.textContent, '২৫৮',
      'figures that WERE read were taken off the screen by a failed refresh');
  });

  test('the provisioning list draws no ০ severity counts over a failure that read nothing', () => {
    const c = new Console(root()) as Record<string, unknown>;
    Object.assign(c, { view: 'list', token: 't', key: 'k', loading: false,
      error: 'প্রতিষ্ঠানের তালিকা আনা যায়নি।', errorCode: '', summary: null, tenants: [] });
    (c.render as () => void).call(c);
    assert.ok(root().querySelector('.ui-state-error'));
    assert.equal(root().querySelector('.fleet-bands'), null,
      '"জরুরি ০টি" was drawn above a failed load');

    // …and still draws them when the counts were read.
    Object.assign(c, { summary: SUMMARY });
    (c.render as () => void).call(c);
    assert.ok(root().querySelector('.fleet-bands'), 'real counts were hidden by an unrelated error');
  });
});

// ── 69 / 70 ───────────────────────────────────────────────────────────────

describe('69/70 — a refused token and key are a failed sign-in, said and announced', () => {
  test('THE ONE THAT MATTERS — a refused pair stays on the form, is stored nowhere, and is announced', async () => {
    const api = platformApi(refusing);
    new Console(root());
    const f = signInForm();
    f.token.value = 'bad-token'; f.key.value = 'bad-key';
    f.submit.focus();
    submit(f.form);
    await settle();

    assert.equal(dom.window.sessionStorage.getItem('shikhon_platform_token'), null,
      'a refused token was stored');
    assert.equal(dom.window.sessionStorage.getItem('shikhon_platform_key'), null,
      'a refused key was stored');
    assert.equal(root().querySelector('nav.plat-nav'), null,
      'a refused pair drew the signed-in console');
    assert.equal(h1()?.textContent, 'অপারেটর সাইন-ইন');
    assert.equal(signInForm().form, f.form, 'the form was rebuilt');
    assert.equal(f.token.value, 'bad-token', 'what was typed is gone');

    const alert = f.form.querySelector('[role="alert"]');
    assert.ok(alert, 'the refusal is not announced');
    assert.match(alert.textContent ?? '', /টোকেন বা কী গ্রহণ করা হয়নি/);
    for (const input of [f.token, f.key]) {
      assert.equal(input.getAttribute('aria-invalid'), 'true');
      assert.match(describedBy(input), /টোকেন বা কী গ্রহণ করা হয়নি/,
        'the field is not tied to the refusal');
    }
    assert.equal(active(), f.token, 'focus did not go back to the token');
    assert.equal(f.submit.disabled, false, 'প্রবেশ stayed busy');

    // The server was asked with what was typed, and asked nothing else.
    assert.deepEqual(api.asked.map((a) => a.path), ['readiness']);
    assert.equal(api.asked[0]!.key, 'bad-key');
  });

  test('editing either field clears the refusal', async () => {
    platformApi(refusing);
    new Console(root());
    const f = signInForm();
    f.token.value = 'bad-token'; f.key.value = 'bad-key';
    submit(f.form);
    await settle();
    assert.ok(f.form.querySelector('[role="alert"]'));
    f.key.value = 'good-key';
    f.key.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(f.form.querySelector('[role="alert"]'), null);
    assert.equal(f.token.getAttribute('aria-invalid'), null);
    assert.equal(f.key.getAttribute('aria-invalid'), null);
  });

  test('a good pair enters the console and loads it once, not twice', async () => {
    const api = platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.value = 'good-token'; f.key.value = 'good-key';
    submit(f.form);
    await settle();
    assert.ok(root().querySelector('nav.plat-nav'), 'a good pair did not enter the console');
    assert.equal(dom.window.sessionStorage.getItem('shikhon_platform_key'), 'good-key');
    const count = (p: string) => api.asked.filter((a) => a.path.startsWith(p)).length;
    assert.equal(count('fleetsummary'), 1, 'the fleet summary was fetched twice on sign-in');
    assert.equal(count('tenants'), 2, 'the provisioning list was fetched for a view not on screen');
  });

  test('a failure that is not a refusal still opens the console, which shows it with its retry', async () => {
    platformApi(failing);
    new Console(root());
    const f = signInForm();
    f.token.value = 't'; f.key.value = 'k';
    submit(f.form);
    await settle();
    assert.ok(root().querySelector('nav.plat-nav'));
    assert.ok(root().querySelector('.ui-state-error'));
    assert.match(text(), /আবার চেষ্টা করুন/);
    assert.equal(root().querySelector('.ui-stat'), null);
  });

  test('a refusal inside the console names the token and key and the way out, and is announced', async () => {
    platformApi(refusing);
    signedIn();
    new Console(root());
    await settle();
    const card = root().querySelector('.ui-state-denied');
    assert.ok(card, 'the refusal state is not drawn');
    assert.ok(card.closest('[role="alert"]'), 'the refusal is never announced');
    // B-30's sentence stays the title.
    assert.equal(card.querySelector('.ui-state-title')?.textContent, 'এই কাজটি করার অনুমতি আপনার নেই।');
    assert.match(card.textContent ?? '', /টোকেন বা কী/);
    assert.match(card.textContent ?? '', /সেশন শেষ/);
    assert.doesNotMatch(text(), /আবার চেষ্টা করুন/, 'a refusal offered a retry');

    // The provisioning list says the same.
    buttonNamed('প্রভিশনিং তালিকা').click();
    await settle();
    const listCard = root().querySelector('.ui-state-denied');
    assert.ok(listCard?.closest('[role="alert"]'), 'the list’s refusal is never announced');
    assert.match(listCard?.textContent ?? '', /সেশন শেষ/);
  });

  test('সেশন শেষ leaves nothing from the session on the fresh form', async () => {
    platformApi(refusing);
    signedIn();
    new Console(root());
    await settle();
    // The provisioning list's own load fails, which is what used to leave
    // "প্রতিষ্ঠানের তালিকা আনা যায়নি। platform credentials required" behind.
    buttonNamed('প্রভিশনিং তালিকা').click();
    await settle();
    buttonNamed('সেশন শেষ').click();
    assert.equal(h1()?.textContent, 'অপারেটর সাইন-ইন');
    assert.equal(root().querySelector('[role="alert"]'), null, 'an alert from the session survived');
    assert.equal(root().querySelector('.ui-state'), null, 'a state card from the session survived');
    assert.doesNotMatch(text(), /platform credentials required/);
  });
});

// ── 71 ────────────────────────────────────────────────────────────────────

describe('71 — the sign-in check keeps the form, the focus, and says which field', () => {
  test('both empty: nothing rebuilt, both fields marked, focus on the token', async () => {
    const api = platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.submit.focus();
    submit(f.form);
    assert.equal(signInForm().form, f.form, 'the form was rebuilt');
    assert.ok(f.submit.isConnected, 'the button that was pressed was destroyed');
    assert.equal(active(), f.token, 'focus was not put on the empty token field');
    assert.equal(f.token.getAttribute('aria-invalid'), 'true');
    assert.match(describedBy(f.token), /অপারেটর টোকেন দিন/);
    assert.equal(f.key.getAttribute('aria-invalid'), 'true');
    assert.match(describedBy(f.key), /PLATFORM_API_KEY দিন/);
    await settle();
    assert.equal(api.asked.length, 0, 'an empty form was sent');
  });

  test('only the key missing: only the key is marked, and focus goes to it', () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.value = 'abc';
    f.token.focus();
    submit(f.form);
    assert.equal(active(), f.key);
    assert.equal(f.key.getAttribute('aria-invalid'), 'true');
    assert.equal(f.token.getAttribute('aria-invalid'), null, 'a filled field was marked wrong');
    assert.equal(f.token.value, 'abc');
    assert.doesNotMatch(text(), /দুটোই দিতে হবে/);
  });
});

// ── 72 ────────────────────────────────────────────────────────────────────

describe('72 — a console action never leaves focus on <body>', () => {
  test('THE ONE THAT MATTERS — a sidebar press moves focus to the section’s name, and keeps the sidebar', async () => {
    platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    const plans = navRow('প্ল্যান');
    plans.focus();
    plans.click();
    assert.equal(active(), h1(), 'focus did not move into the new section');
    assert.equal(h1()?.textContent, 'প্ল্যান');
    assert.equal(navRow('প্ল্যান'), plans, 'the sidebar was rebuilt under the press');
    assert.equal(plans.getAttribute('aria-current'), 'page');
    await settle();
    assert.equal(active(), h1());
  });

  test('from the provisioning list, a sidebar press lands on the section’s name too', async () => {
    platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    buttonNamed('প্রভিশনিং তালিকা').click();
    await settle();
    assert.equal(h1()?.textContent, 'প্রতিষ্ঠানসমূহ');
    assert.equal(active(), h1(), 'opening the provisioning list left focus behind');
    navRow('ড্যাশবোর্ড').click();
    assert.equal(active(), h1());
    assert.equal(h1()?.textContent, 'ফ্লিট');
  });

  test('হালনাগাদ keeps focus on হালনাগাদ through the reload', async () => {
    platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    const refresh = buttonNamed('হালনাগাদ');
    refresh.focus();
    refresh.click();
    await settle();
    assert.notEqual(active(), doc().body, 'focus fell to <body>');
    assert.equal((active()?.textContent ?? '').trim(), 'হালনাগাদ');
  });

  test('a retry that works puts focus on the page’s name, not on the whole console', async () => {
    const api = platformApi(failing);
    signedIn();
    new Console(root());
    await settle();
    const retry = buttonNamed('আবার চেষ্টা করুন');
    assert.ok(retry);
    api.answer = healthy;
    retry.focus();
    retry.click();
    await settle();
    assert.ok(root().querySelector('.ui-stat'), 'the retry did not load');
    assert.equal(active(), h1(), 'focus was left on <body> or parked on the console');
  });

  test('a retry that fails again goes back to the retry', async () => {
    platformApi(failing);
    signedIn();
    new Console(root());
    await settle();
    const retry = buttonNamed('আবার চেষ্টা করুন');
    retry.focus();
    retry.click();
    await settle();
    assert.equal((active()?.textContent ?? '').trim(), 'আবার চেষ্টা করুন');
  });

  test('signing in puts focus on the console’s first page name', async () => {
    platformApi(healthy);
    new Console(root());
    const f = signInForm();
    f.token.value = 'good-token'; f.key.value = 'good-key';
    f.submit.focus();
    submit(f.form);
    await settle();
    assert.equal(h1()?.textContent, 'ফ্লিট');
    assert.equal(active(), h1());
  });

  test('সেশন শেষ puts focus on the sign-in page’s name', async () => {
    platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    const out = buttonNamed('সেশন শেষ');
    out.focus();
    out.click();
    assert.equal(h1()?.textContent, 'অপারেটর সাইন-ইন');
    assert.equal(active(), h1());
  });

  test('sorting the provisioning list keeps focus on the column that was pressed, though its name changed', async () => {
    // The server answers with the order it applied, so the header's words
    // and aria-label change on every press.
    const api = platformApi(healthy);
    api.answer = (path: string) => {
      if (!path.startsWith('tenants')) return healthy(path);
      const q = new URLSearchParams(path.split('?')[1] ?? '');
      return { status: 200, body: { tenants: [SCHOOL],
        page: { ...PAGE, sort: q.get('sort') ?? 'name', dir: q.get('dir') ?? 'asc' } } };
    };
    signedIn();
    new Console(root());
    await settle();
    buttonNamed('প্রভিশনিং তালিকা').click();
    await settle();
    const sortName = (): HTMLButtonElement =>
      root().querySelector<HTMLButtonElement>('button.fleet-sort')!;
    const before = sortName().getAttribute('aria-label');
    sortName().focus();
    sortName().click();                      // name asc → desc
    await settle();
    assert.notEqual(sortName().getAttribute('aria-label'), before, 'the test did not change the name');
    assert.equal(active(), sortName(), 'sorting lost the column that was pressed');
  });

  test('when the pressed control is gone after a redraw, focus goes to the page’s name, not the whole console', async () => {
    platformApi(healthy);
    signedIn();
    const c = new Console(root()) as Record<string, unknown>;
    await settle();
    buttonNamed('প্রভিশনিং তালিকা').click();
    await settle();
    const card = root().querySelector<HTMLButtonElement>('.fleet-card button')!;
    card.focus();
    // A redraw of the same page on which that control no longer exists.
    Object.assign(c, { tenants: [] });
    (c.render as () => void).call(c);
    await settle();
    assert.equal(active(), h1(), 'focus was parked on the console, where Tab starts at the sidebar');
  });

  test('the operations search keeps its field while the query runs, and shows the answer', async () => {
    const api = platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    navRow('প্রতিষ্ঠান').click();
    await settle();

    // Hold the search's requests until the test lets them through.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const answered = api.answer;
    const g = globalThis as Record<string, unknown>;
    const through = g.fetch as (u: unknown, i?: RequestInit) => Promise<Response>;
    g.fetch = async (u: unknown, i?: RequestInit) => { await gate; return through(u, i); };
    api.answer = (path: string) => path.startsWith('tenants?q=')
      ? { status: 200, body: { tenants: [{ ...SCHOOL, id: '22222222-2222-4222-8222-222222222222',
          nameBn: 'মনিপুর উচ্চ বিদ্যালয়' }], page: PAGE } }
      : answered(path);

    const q = root().querySelector<HTMLInputElement>('input[name="q"]')!;
    q.focus();
    q.value = 'মনি';
    q.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));   // the debounce
    await settle();
    assert.equal(root().querySelector('input[name="q"]'), q, 'the search field was taken off the page while it searched');
    assert.equal(active(), q, 'focus left the search field while it searched');
    assert.equal(root().querySelector('.plat-loading'), null, 'the page was replaced by a skeleton');

    release();
    await settle();
    assert.equal(root().querySelector('input[name="q"]'), q, 'the search field was rebuilt by its answer');
    assert.equal(active(), q);
    assert.equal(q.value, 'মনি');
    assert.match(text(), /মনিপুর উচ্চ বিদ্যালয়/, 'the answer was not shown');
    assert.ok(api.asked.some((a) => a.path.startsWith('tenants?q=%E0%A6%AE')), 'the search was not sent');
    g.fetch = through;
  });

  test('an older search answer that arrives last does not replace the newer one', async () => {
    const api = platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    navRow('প্রতিষ্ঠান').click();
    await settle();

    const g = globalThis as Record<string, unknown>;
    const through = g.fetch as (u: unknown, i?: RequestInit) => Promise<Response>;
    let releaseOld: () => void = () => {};
    const oldGate = new Promise<void>((r) => { releaseOld = r; });
    g.fetch = async (u: unknown, i?: RequestInit) => {
      if (String(u).includes('q=old')) await oldGate;
      return through(u, i);
    };
    const named = (nameBn: string) => ({ status: 200, body: { tenants: [{ ...SCHOOL, nameBn }], page: PAGE } });
    const base = api.answer;
    api.answer = (path: string) => path.startsWith('tenants?q=old') ? named('পুরোনো উত্তর')
      : path.startsWith('tenants?q=new') ? named('নতুন উত্তর') : base(path);

    const q = root().querySelector<HTMLInputElement>('input[name="q"]')!;
    const type = async (v: string): Promise<void> => {
      q.value = v;
      q.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    };
    await type('old');
    await type('new');
    await settle();
    releaseOld();
    await settle();
    assert.match(text(), /নতুন উত্তর/);
    assert.doesNotMatch(text(), /পুরোনো উত্তর/, 'a stale answer replaced the newer one');
    g.fetch = through;
  });

  test('a wizard check that redraws the step keeps focus on পরবর্তী; the next step takes it to its name', async () => {
    platformApi(healthy);
    const c = new Console(root()) as Record<string, unknown>;
    Object.assign(c, { view: 'wizard', token: 't', key: 'k', step: 0 });
    (c.render as () => void).call(c);
    const next = buttonNamed('পরবর্তী →');
    next.focus();
    next.click();                          // both names empty: the step redraws with an error
    await settle();
    assert.match(text(), /বাংলা নাম দিন/);
    assert.equal((active()?.textContent ?? '').trim(), 'পরবর্তী →', 'focus fell out of the step');

    const inputs = [...root().querySelectorAll<HTMLInputElement>('.plat-form-band input')];
    inputs[0]!.value = 'মনিপুর উচ্চ বিদ্যালয়';
    inputs[1]!.value = 'Monipur High School';
    buttonNamed('পরবর্তী →').click();
    assert.match(h1()?.textContent ?? '', /ঠিকানা ও স্লাগ/);
    assert.equal(active(), h1(), 'a new step left focus behind');
  });
});

// ── Minors in the console's own files ─────────────────────────────────────

describe('minor 109 — the console has an offline state', () => {
  const setOnline = (on: boolean): void => {
    Object.defineProperty(dom.window.navigator, 'onLine', { configurable: true, get: () => on });
    dom.window.dispatchEvent(new dom.window.Event(on ? 'online' : 'offline'));
  };

  test('THE ONE THAT MATTERS — with the network gone the sign-in page says so, and the banner goes when it is back', () => {
    platformApi(healthy);
    new Console(root());
    const banner = (): HTMLElement | null => root().querySelector<HTMLElement>('.offline-banner');
    assert.ok(banner(), 'the console has no offline banner');
    assert.equal(banner()!.hidden, true, 'the banner shows while online');
    try {
      setOnline(false);
      assert.equal(banner()!.hidden, false, 'going offline did not show the banner');
      assert.equal(banner()!.getAttribute('role'), 'status');
      assert.match(banner()!.textContent ?? '', /ইন্টারনেট নেই/);
    } finally {
      setOnline(true);
    }
    assert.equal(banner()!.hidden, true, 'coming back online left the banner up');
  });

  test('the banner stays through a redraw into the console', async () => {
    platformApi(failing);
    try {
      setOnline(false);
      signedIn();
      new Console(root());
      await settle();
      const banner = root().querySelector<HTMLElement>('.platform-main .offline-banner');
      assert.ok(banner, 'the signed-in console lost the banner');
      assert.equal(banner.hidden, false);
    } finally {
      setOnline(true);
    }
  });
});

describe('minor 108 — a sidebar row reached by Tab is scrolled into view', () => {
  test('focusing a row asks for it to be brought fully into view', async () => {
    platformApi(healthy);
    signedIn();
    new Console(root());
    await settle();
    const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
    const had = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView');
    const original = proto.scrollIntoView;
    const calls: Array<{ el: unknown; arg: unknown }> = [];
    proto.scrollIntoView = function (this: unknown, arg: unknown) { calls.push({ el: this, arg }); };
    try {
      const row = navRow('অপারেটর');
      row.focus();
      const call = calls.find((c) => c.el === row);
      assert.ok(call, 'a focused row was not scrolled into view');
      assert.deepEqual(call.arg, { block: 'nearest', inline: 'nearest' });
    } finally {
      if (had) proto.scrollIntoView = original; else delete proto.scrollIntoView;
    }
  });
});

describe('minor 107 — the English in the sign-in labels is marked English', () => {
  test('super_admin JWT and PLATFORM_API_KEY carry lang="en", and the labels read the same', () => {
    platformApi(healthy);
    new Console(root());
    const labels = [...root().querySelectorAll('.ui-field-label')];
    assert.equal(labels[0]?.textContent, 'অপারেটর টোকেন (super_admin JWT)');
    assert.equal(labels[0]?.querySelector('[lang="en"]')?.textContent, 'super_admin JWT');
    assert.equal(labels[1]?.textContent, 'PLATFORM_API_KEY');
    assert.equal(labels[1]?.querySelector('[lang="en"]')?.textContent, 'PLATFORM_API_KEY');
    // Still the inputs' names.
    const { token, key } = signInForm();
    assert.equal(doc().querySelector(`label[for="${token.id}"]`), labels[0]);
    assert.equal(doc().querySelector(`label[for="${key.id}"]`), labels[1]);
  });
});
