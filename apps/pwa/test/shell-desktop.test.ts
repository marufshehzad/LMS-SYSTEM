/**
 * The application shell. (P1-A/B/D)
 *
 * The shell is the one component every screen is inside, so its failures are
 * never local: a sidebar that loses its active state is wrong on forty pages,
 * and a profile menu that cannot be closed traps focus on all of them.
 *
 * These are DOM tests, not layout tests — jsdom has no layout engine and
 * cannot tell whether the sidebar is 240px or gone. What is asserted here is
 * the STRUCTURE both layouts are built from, which is what an accessibility
 * tree and a keyboard actually walk. The geometry (breakpoints, overflow,
 * contrast, tap targets) is measured in a real browser and recorded in the
 * PHASE_LOG entry; neither check can stand in for the other.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { Shell, type ShellRoute } from '../src/shell.ts';
import { navFor } from '../src/ui/nav.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.location = dom.window.location;
  // `navigator` is a getter-only global in Node 24, so plain assignment
  // throws. The shell reads navigator.onLine for the offline banner.
  Object.defineProperty(globalThis, 'navigator',
    { value: dom.window.navigator, configurable: true });
  // Same trap: Node 24 ships its own `localStorage` global, so `g.localStorage
  // = …` fails silently and the assignment appears to work. The shell's writes
  // are inside try/catch (private-browsing mode), so the failure surfaced as
  // "the theme was never stored" rather than as an error.
  Object.defineProperty(globalThis, 'localStorage',
    { value: dom.window.localStorage, configurable: true });
  // `applyTheme` writes data-theme on the document element, and the module
  // reads the bare global, not the `doc` the shell was handed.
  g.document = dom.window.document;
  g.addEventListener = dom.window.addEventListener.bind(dom.window);
  g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
  // jsdom's matchMedia never matches, so the rail reads its stored preference
  // — the branch these tests exercise. The viewport branch is a browser check.
  g.matchMedia = (q: string) => ({
    matches: false, media: q,
    addEventListener() {}, removeEventListener() {},
  });
});

beforeEach(() => {
  root().textContent = '';
  dom.window.location.hash = '';
  try { dom.window.localStorage.clear(); } catch { /* ignore */ }
});

/** A route for every path a role's navigation mentions, plus extras. */
function routesFor(role: string): ShellRoute[] {
  const paths = new Set([
    ...navFor(role).groups.flatMap((g) => g.items.map((i) => i.path)),
    ...navFor(role).tabs,
    'home',
  ]);
  return [...paths].map((path) => ({
    path, labelBn: path, glyph: 'home',
    mount: (c: HTMLElement) => { c.textContent = `view:${path}`; },
  }));
}

function mount(opts: Partial<Parameters<typeof Shell.prototype.constructor>[0]> = {}): Shell {
  const role = (opts as { role?: string }).role;
  return new Shell({
    root: root(), doc: doc(), routes: routesFor(role ?? ''), defaultPath: 'home',
    displayName: 'রহিম উদ্দিন', onLogout: () => {},
    institution: { name: 'শাহজালাল আদর্শ উচ্চ বিদ্যালয়' },
    bell: { onOpen: () => {} },
    ...(opts as object),
  } as ConstructorParameters<typeof Shell>[0]);
}

describe('P1 — both navigations exist in one DOM', () => {
  test('THE ONE THAT MATTERS — sidebar and bottom bar are present together', () => {
    // The layout is chosen by CSS, not by JavaScript. If the shell ever
    // started rendering only one, every resize would remount the current
    // route and drop the user's focus and scroll position — and a rotated
    // phone would lose a half-entered attendance register.
    mount({ role: 'class_teacher' });
    assert.ok(root().querySelector('.d-sidebar'), 'desktop sidebar missing');
    assert.ok(root().querySelector('.shell-tabbar'), 'mobile bottom bar missing');
    assert.ok(root().querySelector('.shell-topbar'), 'top bar missing');
  });

  test('the two navigations have different accessible names', () => {
    // Both are in the tree; a screen reader meets whichever CSS reveals.
    // Two landmarks called "প্রধান মেনু" would be indistinguishable if a
    // future rule ever showed both.
    mount({ role: 'class_teacher' });
    const names = [...root().querySelectorAll('nav')]
      .map((n) => n.getAttribute('aria-label'));
    assert.equal(new Set(names).size, names.length, `duplicate nav labels: ${names}`);
  });

  test('the content region is a <main>, focusable but not tabbable', () => {
    mount({ role: 'class_teacher' });
    const view = root().querySelector('.shell-view') as HTMLElement;
    assert.equal(view.tagName, 'MAIN');
    assert.equal(view.tabIndex, -1);
  });

  test('a skip link is the first thing a keyboard reaches', () => {
    mount({ role: 'principal' });
    const first = root().querySelector('.shell')?.firstElementChild;
    assert.equal(first?.className, 'skip-link',
      'without this, reaching content past a 20-row sidebar costs 20 tabs');
  });
});

describe('P1 — the sidebar is the role’s, and never a dead link', () => {
  test('THE ONE THAT MATTERS — a row is only rendered if its route exists', () => {
    // A nav row whose route is unregistered is a link to nothing, and
    // esbuild tree-shakes the view out of the bundle as unreferenced. Both
    // times that shipped, the menu entry looked perfectly fine.
    const routes: ShellRoute[] = [
      { path: 'home', labelBn: 'হোম', glyph: 'home', mount: () => {} },
    ];
    new Shell({
      root: root(), doc: doc(), routes, defaultPath: 'home',
      displayName: 'x', onLogout: () => {}, role: 'principal',
    });
    const rendered = [...root().querySelectorAll('.dnav')]
      .map((a) => (a as HTMLElement).dataset.path);
    assert.deepEqual(rendered, ['home'],
      'the sidebar rendered rows for routes that do not exist');
  });

  test('each role gets its own grouped sidebar', () => {
    for (const role of ['class_teacher', 'student', 'guardian', 'principal', 'it_admin']) {
      root().textContent = '';
      mount({ role });
      const rows = [...root().querySelectorAll('.dnav')]
        .map((a) => (a as HTMLElement).dataset.path);
      assert.deepEqual(rows, navFor(role).groups.flatMap((g) => g.items.map((i) => i.path)),
        `${role}'s sidebar does not match its model`);
      assert.ok(root().querySelectorAll('.d-nav-label').length >= 2,
        `${role}'s sidebar is ungrouped`);
    }
  });

  test('an IT admin’s sidebar has no attendance row', () => {
    mount({ role: 'it_admin' });
    const rows = [...root().querySelectorAll('.dnav')]
      .map((a) => (a as HTMLElement).dataset.path);
    assert.ok(!rows.includes('attendance'));
    assert.ok(rows.includes('more'), 'but everything is still reachable');
  });

  test('with no role the sidebar still navigates', () => {
    // Demo previews and the older callers. An empty sidebar is worse than a
    // flat one, and this is the branch a caller that predates P1 takes.
    mount({});
    assert.ok(root().querySelectorAll('.dnav').length > 0);
  });

  test('every row carries a title, so the icon rail has tooltips', () => {
    mount({ role: 'principal' });
    for (const a of root().querySelectorAll('.dnav')) {
      assert.ok(a.getAttribute('title'), 'a collapsed rail leaves only the title');
    }
  });
});

describe('P1 — the active route is marked in every navigation at once', () => {
  test('THE ONE THAT MATTERS — sidebar and tab agree on where you are', () => {
    // They are separate elements for the same route. Marking one and not the
    // other means the answer to "which page am I on" depends on the width of
    // the window, which is the question navigation exists to answer.
    mount({ role: 'class_teacher' });
    dom.window.location.hash = '#/roster';
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));

    const side = root().querySelector('.dnav[data-path="roster"]');
    const tab = root().querySelector('.shell-tab[data-path="roster"]');
    assert.ok(side && tab, 'roster should appear in both navigations');
    assert.equal(side.getAttribute('aria-current'), 'page');
    assert.equal(tab.getAttribute('aria-current'), 'page');
    assert.ok(side.classList.contains('active'));
    assert.ok(tab.classList.contains('active'));

    // …and exactly one row per navigation is current. (The breadcrumb's last
    // crumb is also aria-current="page" — that is the standard pattern for a
    // breadcrumb and is counted separately.)
    assert.equal(root().querySelectorAll('.dnav[aria-current="page"]').length, 1);
    assert.equal(root().querySelectorAll('.shell-tab[aria-current="page"]').length, 1);
  });

  test('the breadcrumb names the section and the page', () => {
    mount({ role: 'class_teacher' });
    dom.window.location.hash = '#/attendance';
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    const parts = [...root().querySelectorAll('.shell-crumb-part')]
      .map((e) => e.textContent);
    assert.deepEqual(parts, ['দৈনন্দিন', 'হাজিরা']);
    const last = root().querySelectorAll('.shell-crumb-part');
    assert.equal(last[last.length - 1].getAttribute('aria-current'), 'page');
  });

  test('a hash with a query still resolves its route', () => {
    // The generation screen is reached as #/generation?routineId=…, and
    // `resolvePath` compared the whole fragment before P1 split it.
    const routes: ShellRoute[] = [
      { path: 'home', labelBn: 'হোম', glyph: 'home', mount: (c) => { c.textContent = 'home'; } },
      { path: 'generation', labelBn: 'ফলাফল', glyph: 'settings',
        mount: (c) => { c.textContent = 'generation'; } },
    ];
    new Shell({ root: root(), doc: doc(), routes, defaultPath: 'home',
                displayName: 'x', onLogout: () => {} });
    dom.window.location.hash = '#/generation?routineId=abc';
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    assert.equal(root().querySelector('.shell-view')?.textContent, 'generation');
  });
});

describe('P1 — the profile menu', () => {
  test('THE ONE THAT MATTERS — Escape closes it and returns focus', () => {
    // A menu that cannot be dismissed from the keyboard is a focus trap on
    // every screen in the product, because this control is in the chrome.
    mount({ role: 'principal' });
    const btn = root().querySelector('.shell-avatar') as HTMLButtonElement;
    btn.click();
    assert.ok(root().querySelector('.shell-menu'), 'menu should open');
    assert.equal(btn.getAttribute('aria-expanded'), 'true');

    doc().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(root().querySelector('.shell-menu'), null, 'Escape must close it');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(doc().activeElement, btn, 'focus must come back to the trigger');
  });

  test('a click outside closes it', () => {
    mount({ role: 'principal' });
    (root().querySelector('.shell-avatar') as HTMLButtonElement).click();
    assert.ok(root().querySelector('.shell-menu'));
    doc().body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(root().querySelector('.shell-menu'), null);
  });

  test('a click inside does not', () => {
    mount({ role: 'principal' });
    (root().querySelector('.shell-avatar') as HTMLButtonElement).click();
    const menu = root().querySelector('.shell-menu') as HTMLElement;
    menu.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(root().querySelector('.shell-menu'), 'the menu closed on its own contents');
  });

  test('navigating away closes it', () => {
    // Otherwise it floats over the next screen, anchored to nothing.
    mount({ role: 'class_teacher' });
    (root().querySelector('.shell-avatar') as HTMLButtonElement).click();
    dom.window.location.hash = '#/roster';
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    assert.equal(root().querySelector('.shell-menu'), null);
  });

  test('it carries the person, the role and a way out', () => {
    mount({ role: 'it_admin' });
    (root().querySelector('.shell-avatar') as HTMLButtonElement).click();
    const menu = root().querySelector('.shell-menu') as HTMLElement;
    assert.match(menu.textContent ?? '', /রহিম উদ্দিন/);
    assert.match(menu.textContent ?? '', /আইটি অ্যাডমিন/, 'the role must not render as it_admin');
    assert.ok(menu.querySelector('.shell-logout'));
    assert.equal(menu.getAttribute('role'), 'menu');
  });

  test('the profile menu offers no theme choice (§5)', () => {
    // It used to carry a follow-phone / light / dark radio group. Ata Ekta has
    // no dark mode, so the control was removed from buildProfileMenu() rather
    // than left offering a single option.
    mount({ role: 'student' });
    (root().querySelector('.shell-avatar') as HTMLButtonElement).click();
    const menu = root().querySelector('.shell-menu') as HTMLElement;
    assert.ok(menu, 'the menu still opens');
    assert.equal(menu.querySelectorAll('.shell-theme, .theme-option').length, 0);
    assert.equal(menu.querySelectorAll('[role="radiogroup"]').length, 0);
    assert.ok(menu.querySelector('.shell-logout'), 'sign-out is still there');
  });

  test('a device that once chose dark is returned to light and forgets it', async () => {
    // A phone that picked dark before the redesign still holds shikhon_theme.
    // applyTheme() pins light and clears the dead key, so it does not linger.
    dom.window.localStorage.setItem('shikhon_theme', 'dark');
    doc().documentElement.setAttribute('data-theme', 'dark');
    const { applyTheme } = await import('../src/ui/theme.ts');
    applyTheme();
    assert.equal(dom.window.localStorage.getItem('shikhon_theme'), null);
    assert.equal(doc().documentElement.getAttribute('data-theme'), 'light');
  });
});

describe('P1 — the institution, the bell and the demo marker', () => {
  test('the school’s identity appears in both plates', () => {
    mount({ role: 'principal' });
    const names = [...root().querySelectorAll('.shell-org-name')]
      .map((e) => e.textContent);
    assert.equal(names.length, 2, 'sidebar brand and mobile header');
    assert.ok(names.every((n) => n === 'শাহজালাল আদর্শ উচ্চ বিদ্যালয়'));
  });

  test('setInstitution patches both, without remounting the route', () => {
    const shell = mount({ role: 'principal' });
    dom.window.location.hash = '#/students';
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    const before = root().querySelector('.shell-view')?.textContent;

    shell.setInstitution({ name: 'মোহাম্মদপুর কলেজ' });
    assert.deepEqual([...root().querySelectorAll('.shell-org-name')].map((e) => e.textContent),
      ['মোহাম্মদপুর কলেজ', 'মোহাম্মদপুর কলেজ']);
    assert.equal(root().querySelector('.shell-view')?.textContent, before,
      'the mounted route must survive a branding update');
  });

  test('the monogram takes a whole Bangla grapheme, not a half one', () => {
    // `'ক্ষুদ্র'[0]` is 'ক' with the conjunct's other half orphaned into the
    // next slot. A school whose name begins with a conjunct would show a
    // broken cluster in the chrome of every screen.
    const shell = mount({ role: 'student' });
    shell.setInstitution({ name: 'ক্ষুদ্র বিদ্যালয়' });
    const mark = root().querySelector('.shell-org-mark');
    assert.ok(mark);
    assert.ok((mark.textContent ?? '').length > 1,
      `expected a full grapheme cluster, got ${JSON.stringify(mark.textContent)}`);
  });

  test('a logo replaces the monogram rather than sitting beside it', () => {
    const shell = mount({ role: 'student' });
    shell.setInstitution({ name: 'ঢাকা কলেজ', logoUrl: 'https://cdn.example/l.png' });
    for (const org of root().querySelectorAll('.shell-org')) {
      assert.ok(org.querySelector('.shell-org-logo'));
      assert.equal(org.querySelector('.shell-org-mark'), null);
    }
  });

  test('the unread badge counts, hides at zero and caps at ৯+', () => {
    const shell = mount({ role: 'guardian' });
    const badge = root().querySelector('.shell-bell-badge') as HTMLElement;
    shell.setUnread(0);
    assert.equal(badge.hidden, true, 'a badge reading zero is noise');
    shell.setUnread(3);
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, '৩');
    shell.setUnread(42);
    assert.equal(badge.textContent, '৯+', 'three digits do not fit a 20px badge');
    assert.match(root().querySelector('.shell-bell')?.getAttribute('aria-label') ?? '', /পড়া হয়নি/);
  });

  test('a demo says so, and a real session never does', () => {
    // §31/§30. A demo that looks exactly like the product is a trust problem
    // the moment somebody screenshots it.
    mount({ role: 'class_teacher', demo: true } as never);
    assert.ok(root().querySelector('.shell-demobar'), 'demo must be marked in the chrome');
    assert.match(root().querySelector('.shell-demobar')?.textContent ?? '', /ডেমো/);

    root().textContent = '';
    mount({ role: 'class_teacher' });
    assert.equal(root().querySelector('.shell-demobar'), null,
      'a school must never see a demo marker');
  });
});

describe('P1 — the icon rail', () => {
  test('the stored preference is applied on construction', () => {
    dom.window.localStorage.setItem('shikhon_sidebar_rail', 'on');
    mount({ role: 'principal' });
    assert.equal(root().querySelector('.shell')?.getAttribute('data-rail'), 'on');
  });

  test('the toggle flips it and remembers', () => {
    mount({ role: 'principal' });
    const shell = root().querySelector('.shell') as HTMLElement;
    assert.equal(shell.dataset.rail, 'off');
    (root().querySelector('.d-rail-toggle') as HTMLButtonElement).click();
    assert.equal(shell.dataset.rail, 'on');
    assert.equal(dom.window.localStorage.getItem('shikhon_sidebar_rail'), 'on');
    (root().querySelector('.d-rail-toggle') as HTMLButtonElement).click();
    assert.equal(shell.dataset.rail, 'off');
  });

  test('the toggle says which way it goes', () => {
    mount({ role: 'principal' });
    const btn = root().querySelector('.d-rail-toggle') as HTMLButtonElement;
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.match(btn.getAttribute('aria-label') ?? '', /সংকুচিত/);
    btn.click();
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.match(btn.getAttribute('aria-label') ?? '', /চওড়া/);
  });
});

describe('Ata Ekta — the chrome as 01 Shell draws it', () => {
  test('the breadcrumb separates section and page with a slash, hidden from readers', () => {
    mount({ role: 'class_teacher' });
    dom.window.location.hash = '#/attendance';
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    const seps = [...root().querySelectorAll('.shell-crumb-sep')];
    assert.equal(seps.length, 1);
    assert.equal(seps[0].textContent, '/');
    assert.equal(seps[0].getAttribute('aria-hidden'), 'true',
      'a reader hears "দৈনন্দিন, হাজিরা", not "slash"');
  });

  test('THE ONE THAT MATTERS — the নোটিশ row and the bell show the same unread count', () => {
    // Two badges for one number. If only one were driven, the sidebar would
    // say "৩" while the bell said nothing — or the reverse.
    const shell = mount({ role: 'class_teacher' });
    const row = root().querySelector('.dnav[data-path="inbox"]') as HTMLElement;
    const count = row.querySelector('.dnav-count') as HTMLElement;
    assert.ok(count, 'the নোটিশ row carries a count');
    assert.equal(count.hidden, true, 'nothing reported yet, nothing shown');
    assert.ok(count.classList.contains('n'), 'a count is a number (R6)');
    assert.equal(count.getAttribute('aria-hidden'), 'true');

    shell.setUnread(3);
    assert.equal(count.hidden, false);
    assert.equal(count.textContent, '৩');
    assert.match(row.getAttribute('aria-label') ?? '', /৩টি পড়া হয়নি/,
      'the row’s name carries the count in Bangla digits, since the badge is hidden from readers');

    shell.setUnread(42);
    assert.equal(count.textContent, '৯+');

    shell.setUnread(0);
    assert.equal(count.hidden, true);
    assert.equal(row.getAttribute('aria-label'), null, 'at zero the row is just "নোটিশ" again');
    // Only the inbox row carries one.
    assert.equal(root().querySelectorAll('.dnav-count').length, 1);
  });

  test('the bell badge is set in the numeral face', () => {
    mount({ role: 'guardian' });
    assert.ok(root().querySelector('.shell-bell-badge')?.classList.contains('n'));
  });

  test('the unlabelled tail group gets a blank label row that readers skip', () => {
    mount({ role: 'class_teacher' });
    const groups = [...root().querySelectorAll('.d-nav-group')];
    const tail = groups[groups.length - 1];
    assert.equal((tail.querySelector('.dnav') as HTMLElement).dataset.path, 'more');
    const label = tail.firstElementChild as HTMLElement;
    assert.ok(label.classList.contains('d-nav-label'));
    assert.equal(label.textContent?.trim(), '');
    assert.equal(label.getAttribute('aria-hidden'), 'true');
    // Named groups keep real, readable labels.
    for (const g of groups.slice(0, -1)) {
      const l = g.querySelector('.d-nav-label');
      assert.ok((l?.textContent ?? '').trim(), 'a named group lost its label');
      assert.equal(l?.getAttribute('aria-hidden'), null);
    }
  });

  test('the sidebar account row ends in a decorative log-out glyph; the phone avatar does not', () => {
    mount({ role: 'principal' });
    const glyph = root().querySelector('.d-profile .d-profile-glyph');
    assert.ok(glyph, 'the §খ foot draws a log-out glyph');
    assert.equal(glyph.getAttribute('aria-hidden'), 'true');
    assert.equal(root().querySelector('.shell-avatar .d-profile-glyph'), null);
    // It still opens the menu rather than signing out on one click.
    assert.equal(root().querySelector('.d-profile')?.getAttribute('aria-haspopup'), 'menu');
  });

  test('the offline banner speaks the design copy and states the queue', () => {
    const shell = mount({ role: 'class_teacher' });
    const banner = root().querySelector('.offline-banner') as HTMLElement;
    assert.equal(banner.getAttribute('role'), 'status');
    assert.match(banner.textContent ?? '', /ইন্টারনেট নেই — কাজ চালিয়ে যান, সব এই যন্ত্রে জমা থাকছে/);
    const pending = banner.querySelector('.offline-pending') as HTMLElement;
    assert.equal(pending.hidden, true, 'no count reported, no figure');
    shell.setPending(3);
    assert.equal(pending.hidden, false);
    assert.equal(pending.textContent, '৩টি অপেক্ষমাণ');
    assert.equal(pending.querySelector('.n')?.textContent, '৩', 'the figure sits in the numeral face');
    shell.setPending(0);
    assert.equal(pending.hidden, true);
  });

  test('a number in a school’s name is set in the numeral face, and the name is unchanged', () => {
    const shell = mount({ role: 'student' });
    shell.setInstitution({ name: '১ নং সরকারি প্রাথমিক বিদ্যালয়' });
    for (const el of root().querySelectorAll('.shell-org-name')) {
      assert.equal(el.textContent, '১ নং সরকারি প্রাথমিক বিদ্যালয়');
      assert.equal(el.querySelector('.n')?.textContent, '১');
    }
    for (const mark of root().querySelectorAll('.shell-org-mark')) {
      assert.ok(mark.classList.contains('n'), 'a one-digit monogram is a number too');
    }
    shell.setInstitution({ name: 'ঢাকা কলেজ' });
    for (const mark of root().querySelectorAll('.shell-org-mark')) {
      assert.ok(!mark.classList.contains('n'), 'a letter monogram keeps the text face');
    }
  });
});

describe('Ata Ekta — on a phone the account menu is a sheet (13 Responsive ০৭)', () => {
  /** Pretend the viewport is narrower than the one breakpoint. */
  const atPhoneWidth = (body: () => void) => {
    const g = globalThis as Record<string, unknown>;
    const desktop = g.matchMedia;
    // Only the sheet's own query matches. The rail's forcing query
    // ((min-width:1024px) and (max-width:1279px)) must still read false, or
    // this would silently be testing a different layout.
    g.matchMedia = (q: string) => ({
      matches: /max-width:\s*1023/.test(q), media: q,
      addEventListener() {}, removeEventListener() {},
    });
    try { body(); } finally { g.matchMedia = desktop; }
  };

  test('THE ONE THAT MATTERS — the tap that closes the sheet does nothing else', () => {
    // Below 1024 the menu is a full-width sheet over a dimmed page, and
    // tapping the dim area is how a sheet is dismissed. The dimming is
    // painted as a box-shadow, which no finger can land on, so the tap
    // continues to whatever it covered — a bottom tab, which navigates.
    // Closing a sheet would move the person to a page they never asked for.
    atPhoneWidth(() => {
      const shell = mount({ role: 'class_teacher' });
      (root().querySelector('.shell-avatar') as HTMLButtonElement).click();
      assert.ok(root().querySelector('.shell-menu'), 'the sheet should open');

      const tab = root().querySelector('.shell-tab[data-path="roster"]') as HTMLElement;
      const before = dom.window.location.hash;
      const tap = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
      tab.dispatchEvent(tap);

      assert.equal(root().querySelector('.shell-menu'), null,
        'the tap must still dismiss the sheet');
      assert.equal(tap.defaultPrevented, true, 'and must not also act on the target');
      assert.equal(dom.window.location.hash, before,
        'the tab under the scrim must not navigate');
      shell.destroy();
    });
  });

  test('Escape still closes it and still returns focus at phone width', () => {
    // The dismissal that a keyboard has. Absorbing the tap must not cost it.
    atPhoneWidth(() => {
      const shell = mount({ role: 'class_teacher' });
      const btn = root().querySelector('.shell-avatar') as HTMLButtonElement;
      btn.click();
      doc().dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(root().querySelector('.shell-menu'), null);
      assert.equal(doc().activeElement, btn);
      shell.destroy();
    });
  });

  test('on desktop the click outside is NOT swallowed', () => {
    // The desktop menu is a dropdown with no scrim. It never claimed the rest
    // of the page, so taking the click away from what was under it would be a
    // behaviour change of its own.
    const shell = mount({ role: 'class_teacher' });
    (root().querySelector('.shell-avatar') as HTMLButtonElement).click();
    assert.ok(root().querySelector('.shell-menu'));
    const row = root().querySelector('.dnav[data-path="roster"]') as HTMLElement;
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    row.dispatchEvent(click);
    assert.equal(root().querySelector('.shell-menu'), null, 'it still closes');
    assert.equal(click.defaultPrevented, false, 'and the row under it still works');
    shell.destroy();
  });
});

describe('P1 — nothing in the chrome is nameless', () => {
  test('every control has an accessible name', () => {
    // The bottom tabs already needed explicit aria-labels: their child spans
    // alone leave some readers, and headless tools, with an empty name.
    mount({ role: 'principal', demo: true } as never);
    (root().querySelector('.shell-avatar') as HTMLButtonElement).click();
    const nameless = [...root().querySelectorAll('button, a[href], select')]
      .filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
                        || (el.textContent ?? '').trim() || el.getAttribute('title')))
      .map((el) => el.className);
    assert.deepEqual(nameless, []);
  });
});

describe('Ata Ekta §7 — the queue figure has a source, not just a slot', () => {
  test('app.ts reports the outbox size to the banner, on boot and on change', async () => {
    // setPending() is presentation. Without a caller it would sit at zero for
    // ever and the offline banner would say nothing about the work waiting —
    // which is the one thing §7 asks the offline state to say.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    assert.match(src, /onProgress: \(st\) => reportQueue\?\.\(st\)/,
      'the engine emits every change into the reporter');
    assert.match(src, /reportQueue = \(st\) => \{ built\.setPending\(st\.pending \+ st\.inflight\); \}/,
      'and the reporter is the shell banner');
    assert.match(src, /engine\.state\(\)\.then\(reportQueue\)/, 'with the boot value too');
  });
});
