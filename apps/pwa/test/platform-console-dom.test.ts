/**
 * Two sentences the operator console has to say out loud.  (R-8 §9A, §11)
 *
 * Both of these are cases where the console was doing something reasonable
 * and not admitting it, which is the failure mode that produces a confident
 * operator and a wrong school.
 *
 *   §9A  Typing an existing teacher's number with "principal" selected
 *        changes that teacher's role. R-8's first pass added a confirmation
 *        panel naming the person — but it never named the CONSEQUENCE, and
 *        "are you sure?" without a stated outcome is how people click through.
 *
 *   §11  Provisioning classes 11–12 seeds a subject list that is ours, with
 *        codes we assigned. It is a decent starting point and it is not the
 *        board syllabus. A college registrar who assumes it was checked
 *        against a circular will build a year on it.
 *
 * These are DOM tests rather than assertions about a pure function because in
 * both cases the bug WAS the DOM: the fact existed in the response and in the
 * catalogue, and simply never reached a screen.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom: JSDOM;
let PlatformConsole: new (root: HTMLElement) => unknown;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://platform.sikhon.systems/platform.html' });
  const g = globalThis as Record<string, unknown>;
  // platform.ts captures `document` at field-initialiser time, so the globals
  // have to exist before the module is imported, not merely before the
  // constructor runs.
  g.document = dom.window.document;
  g.window = dom.window;
  g.HTMLElement = dom.window.HTMLElement;
  g.localStorage = dom.window.localStorage;
  g.sessionStorage = dom.window.sessionStorage;
  g.location = dom.window.location;
  g.fetch = async () => new Response('{}', { status: 200 });
  const mod = await import('../src/platform.ts') as {
    Console_: new (root: HTMLElement) => unknown;
  };
  PlatformConsole = mod.Console_;
});

beforeEach(() => {
  dom.window.document.getElementById('root')!.textContent = '';
});

/**
 * The console with no operator token, driven straight to the screen under
 * test. Reaching these screens through the wizard would need a live platform
 * API and a real tenant; what is being tested is what the screen SAYS, and
 * that is a pure function of the state it is given.
 */
function consoleAt(state: Record<string, unknown>): Document {
  const root = dom.window.document.getElementById('root')!;
  const c = new PlatformConsole(root as unknown as HTMLElement) as Record<string, unknown>;
  Object.assign(c, state);
  (c.render as () => void).call(c);
  return dom.window.document;
}

const WIZARD = { view: 'wizard', token: 'op-token', key: 'op-key' };

describe('R-8 §9A — the console says whose role it is about to change', () => {
  const conflict = {
    phone: '+8801711000111',
    existingName: 'রহিম আহমেদ',
    existingRoles: ['teacher'],
    requestedRole: 'principal',
    alreadyHasRole: false,
    message: 'এই নম্বরটি রহিম আহমেদ এর — তাঁকে নতুন ভূমিকা দেওয়া হবে। নিশ্চিত করুন।',
  };

  test('THE ONE THAT MATTERS — the new role is named, not merely implied', () => {
    const d = consoleAt({ ...WIZARD, step: 6, adminConflict: conflict });
    const line = d.querySelector('[data-consequence="role-change"]');
    assert.ok(line, 'the consequence line must be rendered');
    // The whole point: an operator reads this and knows a teacher is about to
    // stop being a teacher, without having to infer it from a button label.
    assert.match(line.textContent, /প্রধান শিক্ষক/);
    assert.match(line.textContent, /ভূমিকা/);
  });

  test('the person and their current role are still named', () => {
    const d = consoleAt({ ...WIZARD, step: 6, adminConflict: conflict });
    const panel = d.querySelector('[data-conflict="admin-exists"]');
    assert.ok(panel);
    assert.match(panel.textContent, /রহিম আহমেদ/);
    assert.match(panel.textContent, /শিক্ষক/);
  });

  test('both ways out are offered — this is a choice, not a warning', () => {
    const d = consoleAt({ ...WIZARD, step: 6, adminConflict: conflict });
    assert.ok(d.querySelector('[data-action="confirm-existing-admin"]'));
    assert.ok(d.querySelector('[data-action="cancel-existing-admin"]'));
  });

  test('re-issuing a code to someone who ALREADY has the role says no such thing', () => {
    // Nothing changes about this account, so a "their role will change"
    // sentence would be a lie — and a screen that cries wolf on the harmless
    // case is a screen nobody reads on the dangerous one.
    const d = consoleAt({
      ...WIZARD, step: 6,
      adminConflict: { ...conflict, existingRoles: ['principal'], alreadyHasRole: true },
    });
    assert.equal(d.querySelector('[data-consequence="role-change"]'), null);
    assert.ok(d.querySelector('[data-conflict="admin-exists"]'));
  });

  test('with no conflict the panel is absent entirely', () => {
    const d = consoleAt({ ...WIZARD, step: 6, adminConflict: null });
    assert.equal(d.querySelector('[data-conflict="admin-exists"]'), null);
  });
});

describe('Ata Ekta — the operator shell', () => {
  test('THE ONE THAT MATTERS — the console says whose tool it is, and never a school’s', () => {
    // D11. The black sidebar carries the platform wordmark; no tenant logo
    // or name is ever drawn in it.
    const d = consoleAt({ ...WIZARD, step: 0 });
    const side = d.querySelector('aside.plat-sidebar');
    assert.ok(side, 'there is no operator sidebar');
    assert.equal(side.getAttribute('aria-label'), 'অপারেটর মেনু');
    assert.equal(side.querySelector('.plat-wordmark')?.textContent, 'ShikhonBD');
    assert.equal(side.querySelector('img'), null, 'an image was drawn in the operator sidebar');
  });

  test('signed in, the four sections are real buttons and the current one is marked', () => {
    const d = consoleAt({ ...WIZARD, step: 0 });
    const rows = [...d.querySelectorAll('nav.plat-nav .plat-nav-item')];
    assert.deepEqual(rows.map((r) => r.textContent), ['ড্যাশবোর্ড', 'প্রতিষ্ঠান', 'প্ল্যান', 'অপারেটর']);
    for (const r of rows) assert.equal((r as HTMLButtonElement).type, 'button');
    // The wizard creates an institution, so the institutions row is current.
    const current = rows.filter((r) => r.getAttribute('aria-current') === 'page');
    assert.deepEqual(current.map((r) => r.textContent), ['প্রতিষ্ঠান']);
    assert.ok(d.querySelector('.plat-sidebar-foot button'), 'there is no way to end the session');
  });

  test('signed out, the sidebar offers nothing to navigate to', () => {
    const d = consoleAt({ view: 'list', token: '', key: '' });
    assert.equal(d.querySelector('nav.plat-nav'), null);
    assert.equal(d.querySelector('.plat-sidebar-foot'), null);
    assert.equal(d.querySelectorAll('h1').length, 1);
  });

  test('every screen has exactly one h1, from the shared page header', () => {
    for (const step of [0, 5, 6, 8]) {
      const d = consoleAt({ ...WIZARD, step, draft: {
        nameBn: 'ক', nameEn: 'K', stream: 'bangla_medium', level: 'secondary' } });
      const h1s = d.querySelectorAll('h1');
      assert.equal(h1s.length, 1, `step ${step} has ${h1s.length} h1`);
      assert.ok(h1s[0]!.closest('header.page-header'), `step ${step}'s h1 is not the page header`);
    }
  });

  test('the provisioning list names every column it draws', () => {
    // The slug cell had no header, so every header from the third column on
    // named its neighbour's cell to a screen reader.
    const d = consoleAt({
      view: 'list', token: 'op-token', key: 'op-key', loading: false, error: '',
      tenants: [{
        id: 't1', slug: 'ek', nameBn: 'এক', nameEn: 'Ek', stream: 'bangla_medium',
        level: 'secondary', district: null, status: 'active', planCode: 'pilot',
        studentCap: 500, studentCount: 10, trialEndsOn: null, createdAt: '2026-01-01',
        access: 'full', opsState: 'active', billingState: 'active', userCount: 2,
        classCount: 5, sectionCount: 5, lastActiveAt: null, severity: 'none',
      }],
      fleet: { page: 1, size: 25, total: 1, pages: 1, sort: 'name', dir: 'asc' },
    });
    const heads = d.querySelectorAll('.fleet-table thead th').length;
    const cells = d.querySelector('.fleet-table tbody tr')!.children.length;
    assert.equal(heads, cells, `${heads} headers over ${cells} cells`);
  });

  test('a refused credential on the provisioning list is the denied state, without a retry', () => {
    const d = consoleAt({
      view: 'list', token: 'op-token', key: 'op-key', loading: false,
      error: 'প্রতিষ্ঠানের তালিকা আনা যায়নি।', errorCode: 'forbidden', tenants: [],
    });
    assert.ok(d.querySelector('.ui-state-denied'));
    assert.doesNotMatch(d.getElementById('root')!.textContent ?? '', /আবার চেষ্টা করুন/);
  });
});

describe('Ata Ekta — a refusal ends with the session that met it', () => {
  // The denied state has no retry, and the operations view is kept across
  // shell re-renders. Before this, a refused credential followed by
  // "সেশন শেষ" and a good sign-in still said "অনুমতি নেই" on every sidebar
  // press, and the only way out was reloading the page.
  const PAGE = { page: 1, size: 25, total: 0, pages: 1, sort: 'name', dir: 'asc' };
  const SUMMARY = {
    total: 258,
    attention: { critical: 3, warning: 9, info: 14 },
    access: { full: 240, readOnly: 12, none: 6 },
    billing: { trial: 30, active: 200, grace: 20, overdue: 8 },
    usage: { students: 84_000, users: 5_100, classes: 2_400, sections: 6_100, paid: 4_500_000 },
    quiet: 11, neverActive: 4, planUsage: {},
  };

  /** A platform API that refuses or answers, switchable mid-test. */
  function platformApi(): { refuse: boolean; asked: string[] } {
    const api = { refuse: true, asked: [] as string[] };
    (globalThis as Record<string, unknown>).fetch = async (url: unknown) => {
      const path = String(url).replace(/^.*\/api\/v1\/platform\//, '');
      api.asked.push(path);
      if (api.refuse) {
        return new Response(JSON.stringify({ error: 'forbidden', message: 'forbidden' }),
          { status: 403 });
      }
      const body = path.startsWith('tenants') ? { tenants: [], page: PAGE }
        : path.startsWith('fleetsummary') ? SUMMARY
        : path.startsWith('catalogue') ? { plans: [], services: [] }
        : path.startsWith('audit') ? { entries: [] }
        : path.startsWith('operators') ? { operators: [] }
        : {};
      return new Response(JSON.stringify(body), { status: 200 });
    };
    return api;
  }

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 2));
  };
  const nav = (d: Document, label: string): HTMLButtonElement =>
    [...d.querySelectorAll<HTMLButtonElement>('nav.plat-nav .plat-nav-item')]
      .find((b) => b.textContent === label)!;

  async function signOutAndIn(d: Document): Promise<void> {
    d.querySelector<HTMLButtonElement>('.plat-sidebar-foot .plat-signout')!.click();
    const form = d.querySelector('form.plat-form')!;
    const [token, key] = [...form.querySelectorAll<HTMLInputElement>('input[type="password"]')];
    token!.value = 'good-token'; key!.value = 'good-key';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
  }

  async function withConsole(run: (d: Document, api: { refuse: boolean; asked: string[] }) =>
    Promise<void>): Promise<void> {
    const g = globalThis as Record<string, unknown>;
    const realFetch = g.fetch;
    const store = dom.window.sessionStorage;
    try {
      const api = platformApi();
      store.setItem('shikhon_platform_token', 'old-token');
      store.setItem('shikhon_platform_key', 'old-key');
      return await run(dom.window.document, api);
    } finally {
      g.fetch = realFetch;
      store.removeItem('shikhon_platform_token');
      store.removeItem('shikhon_platform_key');
    }
  }

  test('THE ONE THAT MATTERS — a refused credential, then a good sign-in, is not still refused', async () => {
    await withConsole(async (d, api) => {
      new PlatformConsole(d.getElementById('root') as unknown as HTMLElement);
      await settle();
      assert.ok(d.querySelector('.ui-state-denied'), 'the refused load must show the denied state');

      api.refuse = false;
      await signOutAndIn(d);
      const askedBefore = api.asked.length;

      for (const label of ['ড্যাশবোর্ড', 'প্রতিষ্ঠান', 'প্ল্যান', 'অপারেটর']) {
        nav(d, label).click();
        await settle();
        assert.equal(d.querySelector('.ui-state-denied'), null,
          `${label} still shows the last session's refusal`);
        assert.equal(nav(d, label).getAttribute('aria-current'), 'page');
      }
      // The operations view was rebuilt and asked again, with the new credential.
      assert.ok(api.asked.slice(askedBefore).includes('catalogue'),
        'operations did not load again after signing in');
    });
  });

  test('the next session gets its own answer — a refusal stays a refusal, and the last fleet is not shown', async () => {
    await withConsole(async (d, api) => {
      api.refuse = false;
      new PlatformConsole(d.getElementById('root') as unknown as HTMLElement);
      await settle();
      assert.equal(d.querySelector('.ui-state-denied'), null);
      assert.ok(d.querySelector('.ui-stat'), 'the first session reads the fleet');

      await signOutAndIn(d);
      api.refuse = true;
      nav(d, 'ড্যাশবোর্ড').click();
      await settle();
      assert.ok(d.querySelector('.ui-state-denied'), 'a refused credential must show the denied state');
      assert.equal(d.querySelector('.ui-stat'), null, 'the signed-out session’s fleet is still on screen');
      assert.doesNotMatch(d.getElementById('root')!.textContent ?? '', /আবার চেষ্টা করুন/);
    });
  });
});

describe('R-8 §11 — the HSC catalogue does not claim to be the board syllabus', () => {
  const draft = (level: string) => ({
    nameBn: 'মোহাম্মদপুর কলেজ', nameEn: 'Mohammadpur College',
    stream: 'bangla_medium', level,
  });

  test('THE ONE THAT MATTERS — provisioning a college says the list is ours', () => {
    const d = consoleAt({ ...WIZARD, step: 5, draft: draft('higher_secondary') });
    const note = d.querySelector('[data-notice="hsc-catalogue"]');
    assert.ok(note, 'the provenance notice must appear where 11–12 are seeded');
    // Three claims it has to make: the list is shikhonBD's, it is not the
    // board's, and it can be changed.
    assert.match(note.textContent, /shikhonBD/);
    assert.match(note.textContent, /বোর্ডের অফিসিয়াল সিলেবাস নয়/);
    assert.match(note.textContent, /সম্পাদনা/);
  });

  test('D11 — the platform brand is spelled shikhonBD on the platform surface', () => {
    const d = consoleAt({ ...WIZARD, step: 5, draft: draft('higher_secondary') });
    assert.match(d.querySelector('[data-notice="hsc-catalogue"]').textContent, /shikhonBD/);
  });

  test('a combined school-and-college is warned too — it reaches class 12', () => {
    const d = consoleAt({ ...WIZARD, step: 5, draft: draft('combined') });
    assert.ok(d.querySelector('[data-notice="hsc-catalogue"]'));
  });

  test('a secondary school is not — it never sees an HSC subject', () => {
    // The notice has to be absent here or it becomes furniture, and furniture
    // is not read.
    const d = consoleAt({ ...WIZARD, step: 5, draft: draft('secondary') });
    assert.equal(d.querySelector('[data-notice="hsc-catalogue"]'), null);
  });

  test('a madrasa at secondary level is not warned either', () => {
    const d = consoleAt({
      ...WIZARD, step: 5,
      draft: { ...draft('secondary'), stream: 'madrasah' },
    });
    assert.equal(d.querySelector('[data-notice="hsc-catalogue"]'), null);
  });
});
