/**
 * UX sweep, round 2 — focus and the shell (group focus-shell).
 *
 *   R8 / 8 / 12 / 37 / 67  When a rebuild leaves nothing equivalent to the
 *        control that had focus (a chapter opened, a detail and its back
 *        link, the next practice question, a retry that worked), focus lands
 *        on a HEADING — the new page's h1, or on the same page the nearest
 *        heading before the control — not on main#shell-view with no ring.
 *        The heading gets tabindex -1 and its own light focus class while it
 *        holds focus. It is brought into view only after a keyboard press.
 *   8 (roster কোড at 375)  a row control drawn twice (table + phone list,
 *        one hidden by CSS): a copy that refuses focus is skipped for the
 *        next, instead of parking focus on main.
 *   R5   the attendance leave guard puts the address back without growing
 *        history, so after বাতিল then বাদ দিন the next back goes to the page
 *        before, not to a blank register.
 *   contract  autoFlush dispatches `shikhon:outbox` { pending, inflight } on
 *        the document after every flush attempt and progress report.
 *   32   #/assignments promises offline keeping only to a student.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { keepFocusWithin, focusIsLost, el, LANDING_CLASS } from '../src/ui/dom.ts';
import { closeAllOverlays } from '../src/ui/overlay.ts';
import { Shell, autoFlush, type ShellRoute } from '../src/shell.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };
let reveals: Element[] = [];

before(() => {
  dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.location = dom.window.location;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, 'localStorage',
    { value: dom.window.localStorage, configurable: true });
  g.document = dom.window.document;
  g.addEventListener = dom.window.addEventListener.bind(dom.window);
  g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
  g.matchMedia = (q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  });
  // jsdom has no layout and no scrollIntoView: record who asked to be shown.
  (dom.window.HTMLElement.prototype as unknown as { scrollIntoView: (o?: unknown) => void })
    .scrollIntoView = function (this: Element) { reveals.push(this); };
});

beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<main id="root"></main>';
  reveals = [];
});

const host = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;
const press = (target: HTMLElement, kind: 'key' | 'pointer') => {
  target.dispatchEvent(kind === 'key'
    ? new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    : new dom.window.Event('pointerdown', { bubbles: true }));
};

/* ── R8 / 8 / 12 / 37 / 67: where focus lands when nothing matches ─────── */

describe('keepFocusWithin lands on a heading, not on the container', () => {
  /** A learn-like view: the chapter list, and a chapter page it opens. */
  function learn(root: HTMLElement) {
    const d = doc();
    let open: string | null = null;
    let loading = true;
    const render = () => {
      root.textContent = '';
      if (!open) {
        root.append(
          el(d, 'header', { className: 'page-header' }, el(d, 'h1', { text: 'পড়াশোনা' })),
          el(d, 'h2', { className: 'ui-sr-only', text: 'পদার্থবিজ্ঞান' }),
          el(d, 'ul', {}, ...['অধ্যায় ১', 'অধ্যায় ২'].map((name) => {
            const b = el(d, 'button', { className: 'chapter-card', text: name });
            b.addEventListener('click', () => { open = name; loading = true; render(); });
            return el(d, 'li', { data: { key: name } }, b);
          })));
        return;
      }
      const back = el(d, 'button', { className: 'ui-back', text: 'সব অধ্যায়' });
      back.addEventListener('click', () => { open = null; render(); });
      root.append(back,
        el(d, 'header', { className: 'page-header' }, el(d, 'h1', { text: open })),
        loading ? el(d, 'div', { className: 'ui-skeleton' })
          : el(d, 'ul', {}, el(d, 'li', {}, el(d, 'button', { text: 'বেগ ও ত্বরণ' }))));
    };
    render();
    return {
      render,
      loaded: () => { loading = false; render(); },
      chapter: (i: number) => root.querySelectorAll<HTMLButtonElement>('.chapter-card')[i],
    };
  }

  test('opening a chapter lands on the new page’s h1, with tabindex -1 and the landing class', async () => {
    const root = host();
    const view = learn(root);
    const stop = keepFocusWithin(root);
    const card = view.chapter(1);
    card.focus();
    press(card, 'key');
    card.click();
    await tick();
    const h1 = root.querySelector('h1') as HTMLElement;
    assert.equal(h1.textContent, 'অধ্যায় ২');
    assert.equal(active(), h1, 'focus is on the chapter’s title, not parked on the view');
    assert.notEqual(active(), root);
    assert.equal(h1.getAttribute('tabindex'), '-1', 'a script-only focus target, never a Tab stop');
    assert.ok(h1.classList.contains(LANDING_CLASS), 'the light landing focus style, not the ring box');
    assert.deepEqual(reveals, [h1], 'a keyboard person is shown where focus went');
    // The landing is still a placeholder a view may improve on.
    assert.equal(focusIsLost(doc()), true);
    stop();
  });

  test('the back link lands on the list’s h1', async () => {
    const root = host();
    const view = learn(root);
    const stop = keepFocusWithin(root);
    view.chapter(0).click();
    view.loaded();
    const back = root.querySelector('.ui-back') as HTMLButtonElement;
    back.focus();
    back.click();
    await tick();
    assert.equal(active(), root.querySelector('h1'));
    assert.equal(active()?.textContent, 'পড়াশোনা');
    stop();
  });

  test('skeleton → data replaces the landing heading: focus lands on the new one, without scrolling again', async () => {
    const root = host();
    const view = learn(root);
    const stop = keepFocusWithin(root);
    const card = view.chapter(0);
    card.focus();
    press(card, 'key');
    card.click();
    await tick();
    const first = root.querySelector('h1') as HTMLElement;
    assert.equal(active(), first);
    view.loaded();   // the fetch answered: the whole page is drawn again
    await tick();
    const second = root.querySelector('h1') as HTMLElement;
    assert.notEqual(second, first);
    assert.equal(active(), second, 'not <body>, not the view');
    assert.equal(reveals.length, 1, 'only the first landing may scroll');
    stop();
  });

  test('a touch or mouse press lands focus but never scrolls the page', async () => {
    const root = host();
    const view = learn(root);
    const stop = keepFocusWithin(root);
    const card = view.chapter(0);
    card.focus();
    press(card, 'pointer');
    card.click();
    await tick();
    assert.equal(active(), root.querySelector('h1'));
    assert.deepEqual(reveals, []);
    stop();
  });

  test('same page rebuilt in place: the nearest heading before the control (the practice card)', async () => {
    const root = host();
    const d = doc();
    let q = 1;
    root.append(
      el(d, 'header', { className: 'page-header' }, el(d, 'h1', { text: 'বেগ ও ত্বরণ' })),
      el(d, 'article', {}, el(d, 'h2', { text: 'ত্বরণ কী' }), el(d, 'p', { text: 'পাঠ' })));
    const practice = el(d, 'div');
    root.append(el(d, 'section', { className: 'prac-wrap' },
      el(d, 'div', { className: 'ui-section-head' }, el(d, 'h2', { text: 'অনুশীলন' })), practice));
    // practice-view's card: the verdict sits above the actions once an
    // answer is checked, so the next question's actions stand one place up.
    const draw = (revealed: boolean) => {
      practice.textContent = '';
      practice.append(el(d, 'p', { text: `প্রশ্ন ${q}` }));
      if (revealed) {
        const next = el(d, 'button', { text: 'পরের প্রশ্ন →' });
        next.addEventListener('click', () => { q += 1; draw(false); });
        practice.append(el(d, 'div', { className: 'prac-verdict', text: 'ঠিক হয়েছে' }),
          el(d, 'div', { className: 'prac-actions' }, next));
      } else {
        practice.append(el(d, 'div', { className: 'prac-actions' },
          el(d, 'button', { text: 'যাচাই করো', attrs: { disabled: true } })));
      }
    };
    draw(true);
    const stop = keepFocusWithin(root);
    const next = practice.querySelector('button') as HTMLButtonElement;
    next.focus();
    next.click();
    await tick();
    assert.equal(active()?.textContent, 'অনুশীলন',
      'the practice section’s own heading, not the lesson title a screen above');
    stop();
  });

  test('a screen-reader-only heading is never a landing (no ring anybody could see)', async () => {
    const root = host();
    const d = doc();
    const draw = (hint: boolean) => {
      root.textContent = '';
      root.append(el(d, 'h1', { text: 'শিক্ষার্থী' }), el(d, 'h2', { className: 'ui-sr-only', text: 'নবম-ক' }));
      if (hint) {
        const ok = el(d, 'button', { text: 'বুঝেছি' });
        ok.addEventListener('click', () => draw(false));
        root.append(el(d, 'section', {}, ok));
      }
      root.append(el(d, 'ul', {}, el(d, 'li', {}, 'রাফি')));
    };
    draw(true);
    const stop = keepFocusWithin(root);
    const ok = root.querySelector('button') as HTMLButtonElement;
    ok.focus();
    ok.click();
    await tick();
    assert.equal(active(), root.querySelector('h1'));
    stop();
  });

  test('the landing gives back its tabindex and class once focus moves on; a view’s own tabindex stays', async () => {
    const root = host();
    const d = doc();
    const draw = (own: boolean) => {
      root.textContent = '';
      const h1 = el(d, 'h1', { text: 'বাড়ির কাজ' });
      if (own) h1.setAttribute('tabindex', '-1');
      const retry = el(d, 'button', { text: 'আবার চেষ্টা করুন' });
      retry.addEventListener('click', () => {
        root.textContent = '';
        root.append(h1, el(d, 'ul', {}, el(d, 'li', {}, el(d, 'button', { text: 'গণিত' }))));
      });
      root.append(h1, retry);
    };
    for (const own of [false, true]) {
      draw(own);
      const stop = keepFocusWithin(root);
      const retry = root.querySelector('button') as HTMLButtonElement;
      retry.focus();
      retry.click();
      await tick();
      const h1 = root.querySelector('h1') as HTMLElement;
      assert.equal(active(), h1, 'a retry that worked lands on the title');
      (root.querySelector('li button') as HTMLElement).focus();
      assert.equal(h1.classList.contains(LANDING_CLASS), false);
      assert.equal(h1.getAttribute('tabindex'), own ? '-1' : null,
        own ? 'the view’s tabindex is the view’s' : 'a title is not left a focus target');
      assert.equal(focusIsLost(doc()), false, 'focus the person moved is not lost');
      stop();
    }
  });

  test('while focus waits on the landing, the control coming back gets it again', async () => {
    const root = host();
    const d = doc();
    const draw = (withButton: boolean) => {
      root.textContent = '';
      root.append(el(d, 'h1', { text: 'কক্ষ' }));
      if (withButton) root.append(el(d, 'button', { text: 'কক্ষ যোগ করুন', data: { action: 'add' } }));
    };
    draw(true);
    const stop = keepFocusWithin(root);
    (root.querySelector('button') as HTMLElement).focus();
    draw(false);
    await tick();
    assert.equal(active(), root.querySelector('h1'));
    draw(true);
    await tick();
    assert.equal(active(), root.querySelector('button'), 'back on the control, not left on the title');
    stop();
  });

  test('with no heading at all, the container still takes focus — never <body>', async () => {
    const root = host();
    root.append(el(doc(), 'button', { text: 'ক' }));
    const stop = keepFocusWithin(root);
    (root.querySelector('button') as HTMLElement).focus();
    root.textContent = '';
    root.append(el(doc(), 'p', { text: 'খালি' }));
    await tick();
    assert.equal(active(), root);
    assert.equal(focusIsLost(doc()), true);
    stop();
  });
});

/* ── 8: a control drawn twice, one copy hidden ──────────────────────────── */

describe('keepFocusWithin tries each copy of a control drawn twice (finding 8, roster কোড)', () => {
  test('a copy that refuses focus is skipped for the one that takes it', async () => {
    const root = host();
    const d = doc();
    const copy = (hidden: boolean) => {
      const b = el(d, 'button', { text: 'কোড', className: hidden ? 'is-hidden' : '' });
      // A `display: none` copy in a browser: focus() does nothing.
      if (hidden) b.focus = () => {};
      return b;
    };
    const draw = () => {
      root.textContent = '';
      root.append(el(d, 'h1', { text: 'শিক্ষার্থী' }),
        // The list copy first in the DOM and the table copy second, as the
        // tracked (list) copy's old place is nearest the table copy's new one.
        el(d, 'div', {}, el(d, 'table', {}, el(d, 'tbody', {},
          el(d, 'tr', { data: { key: 's1' } }, el(d, 'td', {}, copy(true)))))),
        el(d, 'ul', {}, el(d, 'li', { data: { key: 's1' } }, copy(false))));
    };
    root.append(el(d, 'h1', { text: 'শিক্ষার্থী' }),
      el(d, 'div', {}, el(d, 'ul', {}, el(d, 'li', { data: { key: 's1' } },
        el(d, 'button', { text: 'কোড' })))));
    const stop = keepFocusWithin(root);
    (root.querySelector('li button') as HTMLElement).focus();
    draw();
    await tick();
    assert.equal(active()?.textContent, 'কোড', 'focus is on the row’s কোড, not the view or its title');
    assert.equal(active()?.closest('li')?.getAttribute('data-key'), 's1');
    stop();
  });

  test('with layout, a copy that is not rendered is not even tried', async () => {
    const root = host();
    const d = doc();
    const rects = (n: number) => () => ({ length: n }) as unknown as DOMRectList;
    root.getClientRects = rects(1);
    const tried: string[] = [];
    const draw = () => {
      root.textContent = '';
      const hidden = el(d, 'button', { text: 'কোড', data: { copy: 'table' } });
      hidden.getClientRects = rects(0);
      const shown = el(d, 'button', { text: 'কোড', data: { copy: 'list' } });
      shown.getClientRects = rects(1);
      for (const b of [hidden, shown]) {
        const real = b.focus.bind(b);
        b.focus = (o?: FocusOptions) => { tried.push(b.dataset.copy!); real(o); };
      }
      root.append(el(d, 'h1', { text: 'শিক্ষার্থী' }),
        el(d, 'div', { data: { key: 's1' } }, hidden), el(d, 'div', { data: { key: 's1' } }, shown));
    };
    draw();
    const stop = keepFocusWithin(root);
    (root.querySelector('[data-copy="table"]') as HTMLElement).focus();
    tried.length = 0;
    draw();
    await tick();
    assert.deepEqual(tried, ['list']);
    assert.equal(active()?.getAttribute('data-copy'), 'list');
    stop();
  });
});

/* ── R5: the leave guard does not grow history ──────────────────────────── */

describe('the leave guard puts the address back without adding history (R5)', () => {
  let live: Shell | null = null;
  // A failed assertion must not leave a guarded shell answering the next test's hashchanges.
  afterEach(() => { live?.destroy(); live = null; });
  const view = () => host().querySelector('#shell-view')?.textContent ?? '';
  const mount = (routes: ShellRoute[]) => {
    live?.destroy();
    live = new Shell({
      root: host(), doc: doc(), routes, defaultPath: routes[0].path,
      displayName: 'রহিম', onLogout: () => {},
    });
    return live;
  };
  const page = (path: string, more: Partial<ShellRoute> = {}): ShellRoute => ({
    path, labelBn: path, glyph: 'home',
    mount: (c) => { c.append(el(doc(), 'h1', { text: `view:${path}` })); },
    ...more,
  });
  const walk = async (hash: string) => { dom.window.location.hash = hash; await settle(); };
  const navNumber = () => (dom.window.history.state as Record<string, unknown> | null)?.shikhonNav;
  const dialogButtons = () => {
    const dialog = doc().querySelector('.ui-scrim [role="alertdialog"]');
    assert.ok(dialog, 'the unsaved-work question is on screen');
    return [...dialog.querySelectorAll<HTMLButtonElement>('button')];
  };

  test('back, বাতিল, back, বাদ দিন: on the page before, and the next back goes further back', async () => {
    let dirty = false;
    await walk('#/home');
    mount([page('home'), page('routine'),
      page('attendance', { hasUnsavedChanges: () => dirty })]);
    await settle();
    await walk('#/routine');
    await walk('#/attendance');
    assert.match(view(), /view:attendance/);
    const length = dom.window.history.length;
    dirty = true;   // the register is marked

    dom.window.history.back();
    await settle();
    dialogButtons()[0].click();   // বাতিল
    await settle();
    assert.equal(dom.window.location.hash, '#/attendance', 'the address is put back');
    assert.match(view(), /view:attendance/);
    assert.equal(dom.window.history.length, length, 'no entry was added');

    dom.window.history.back();
    await settle();
    const buttons = dialogButtons();
    buttons[buttons.length - 1].click();   // বাদ দিন
    await settle();
    assert.match(view(), /view:routine/, 'the back press went through');
    assert.equal(dom.window.location.hash, '#/routine');
    assert.equal(dom.window.history.length, length, 'still no entry added');

    dirty = false;
    dom.window.history.back();
    await settle();
    assert.match(view(), /view:home/, 'the next back is the page before routine, not a blank register');
  });

  test('a tab pressed with unsaved work: one new entry at most, as if nothing had asked', async () => {
    let dirty = false;
    await walk('#/home');
    mount([page('home'), page('attendance', { hasUnsavedChanges: () => dirty })]);
    await settle();
    await walk('#/attendance');
    const length = dom.window.history.length;
    dirty = true;

    await walk('#/home');   // the হোম tab
    assert.equal(dom.window.location.hash, '#/attendance', 'the address is put back');
    assert.match(view(), /view:attendance/);
    assert.equal(dom.window.history.length, length + 1, 'the held tab added no more than its own entry');

    const buttons = dialogButtons();
    buttons[buttons.length - 1].click();   // বাদ দিন
    await settle();
    assert.match(view(), /view:home/);
    assert.equal(dom.window.location.hash, '#/home');
    assert.equal(dom.window.history.length, length + 1, 'exactly the tab’s one entry');

    dirty = false;
    dom.window.history.back();
    await settle();
    assert.match(view(), /view:attendance/, 'back from home is the page the tab left');
  });

  // Review of round 2: the held tab's own entry was pointed back at
  // #/attendance, so two #/attendance entries sat side by side and the next
  // back press moved between them with no hashchange — nothing happened.
  test('a tab held, then বাতিল: no copy of the register is left behind, so one back press leaves it', async () => {
    let dirty = false;
    await walk('#/home');
    mount([page('home'), page('routine'), page('attendance', { hasUnsavedChanges: () => dirty })]);
    await settle();
    await walk('#/routine');
    await walk('#/attendance');
    const length = dom.window.history.length;
    dirty = true;

    await walk('#/home');   // the হোম tab
    dialogButtons()[0].click();   // বাতিল
    await settle();
    assert.equal(dom.window.location.hash, '#/attendance', 'the address is put back');
    assert.match(view(), /view:attendance/);
    assert.ok(dom.window.history.length <= length + 1, 'the tab added no more than its own entry');
    assert.equal(typeof (dom.window.history.state as Record<string, unknown> | null)?.shikhonNav, 'number',
      'on screen is the register’s own numbered entry, not the tab’s entry pointed back at it');

    dirty = false;   // say the register was then submitted
    dom.window.history.back();
    await settle();
    assert.equal(dom.window.location.hash, '#/routine', 'ONE back press leaves the register');
    assert.match(view(), /view:routine/);
  });

  test('বাদ দিন pressed before the step back has even arrived: the tab still goes through, once', async () => {
    let dirty = false;
    await walk('#/home');
    mount([page('home'), page('attendance', { hasUnsavedChanges: () => dirty })]);
    await settle();
    await walk('#/attendance');
    const length = dom.window.history.length;
    dirty = true;

    dom.window.location.hash = '#/home';   // the হোম tab
    // Answer the moment the question appears: the shell's step back to the
    // register is still queued.
    for (let i = 0; i < 20 && !doc().querySelector('.ui-scrim [role="alertdialog"]'); i++) await tick();
    const buttons = dialogButtons();
    buttons[buttons.length - 1].click();   // বাদ দিন
    await settle();
    assert.match(view(), /view:home/);
    assert.equal(dom.window.location.hash, '#/home');
    assert.equal(dom.window.history.length, length + 1, 'exactly the tab’s one entry');

    dirty = false;
    dom.window.history.back();
    await settle();
    assert.match(view(), /view:attendance/, 'back from home is the page the tab left');
  });

  test('the held navigation delivered twice while the step back travels is undone once, not twice', async () => {
    let dirty = false;
    await walk('#/home');
    mount([page('home'), page('routine'), page('attendance', { hasUnsavedChanges: () => dirty })]);
    await settle();
    await walk('#/routine');
    await walk('#/attendance');
    dirty = true;
    // jsdom folds two queued go(-1) calls into one traversal; a browser need
    // not, so count the steps the shell asks for.
    const h = dom.window.history as History & { go: (d?: number) => void };
    const steps: number[] = [];
    const realGo = h.go.bind(h);
    h.go = (d?: number) => { steps.push(d ?? 0); realGo(d); };

    try {
      dom.window.location.hash = '#/home';   // the হোম tab …
      dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));   // … and a second hashchange for it
      await settle();
    } finally {
      delete (h as { go?: unknown }).go;
    }
    assert.deepEqual(steps, [-1], 'one step back, not two');
    assert.equal(dom.window.location.hash, '#/attendance');
    assert.match(view(), /view:attendance/);
    assert.equal(doc().querySelectorAll('.ui-scrim [role="alertdialog"]').length, 1, 'asked once');
    dialogButtons()[0].click();   // বাতিল
    await settle();
    dirty = false;
    dom.window.history.back();
    await settle();
    assert.match(view(), /view:routine/, 'the entries behind the register are untouched');
  });

  test('a register shown as the default route (empty hash) gets its own address back', async () => {
    let dirty = false;
    await walk('#/home');
    dom.window.location.hash = '';
    await settle();
    mount([page('attendance', { hasUnsavedChanges: () => dirty }), page('home')]);
    await settle();
    assert.match(view(), /view:attendance/);
    const length = dom.window.history.length;
    dirty = true;

    await walk('#/home');
    assert.equal(dom.window.location.hash, '#/attendance', 'the address names the page on screen');
    assert.match(view(), /view:attendance/);
    assert.ok(dom.window.history.length <= length + 1);
  });

  test('a navigation that REPLACED the register’s entry is put back in place: nothing added, nothing shown on the way', async () => {
    let dirty = false;
    let routineMounts = 0;
    await walk('#/home');
    mount([page('home'),
      page('routine', { mount: (c) => { routineMounts++; c.append(el(doc(), 'h1', { text: 'view:routine' })); } }),
      page('attendance', { hasUnsavedChanges: () => dirty })]);
    await settle();
    await walk('#/routine');
    await walk('#/attendance');
    const length = dom.window.history.length;
    const mounted = routineMounts;
    const number = navNumber();
    dirty = true;

    dom.window.location.replace('#/home');
    await settle();
    assert.equal(dom.window.location.hash, '#/attendance', 'the address is put back');
    assert.match(view(), /view:attendance/);
    assert.equal(dom.window.history.length, length, 'a replace added nothing, and neither did putting it back');
    assert.equal(navNumber(), number, 'the entry put back carries the register’s number again');
    assert.equal(routineMounts, mounted, 'the entry before was never drawn while the shell found its way back');
    assert.equal(doc().querySelectorAll('.ui-scrim [role="alertdialog"]').length, 1, 'asked once');

    dialogButtons()[0].click();   // বাতিল
    await settle();
    dirty = false;
    dom.window.history.back();
    await settle();
    assert.match(view(), /view:routine/, 'one back press leaves the register');
  });

  test('a replaced entry, then বাদ দিন: the target takes that entry’s place', async () => {
    let dirty = false;
    await walk('#/home');
    mount([page('home'), page('routine'), page('attendance', { hasUnsavedChanges: () => dirty })]);
    await settle();
    await walk('#/routine');
    await walk('#/attendance');
    const length = dom.window.history.length;
    dirty = true;

    dom.window.location.replace('#/home');
    await settle();
    const buttons = dialogButtons();
    buttons[buttons.length - 1].click();   // বাদ দিন
    await settle();
    assert.match(view(), /view:home/);
    assert.equal(dom.window.location.hash, '#/home');
    assert.equal(dom.window.history.length, length);
    dirty = false;
    dom.window.history.back();
    await settle();
    assert.match(view(), /view:routine/, 'the register’s entry was replaced, as the navigation asked');
  });

  describe('where the Navigation API says what the navigation was', () => {
    type Nav = EventTarget & { readonly currentEntry: { index: number } };
    let hashchanges = 0;
    const count = () => { hashchanges++; };
    // jsdom has no Navigation API. A browser fires `navigate` on it BEFORE the
    // move, with the kind of navigation and where it goes.
    const fire = (navigationType: string, hash: string, index = -1) => {
      const nav = (dom.window as unknown as { navigation: Nav }).navigation;
      const e = new dom.window.Event('navigate') as Event & Record<string, unknown>;
      e.navigationType = navigationType;
      e.destination = { url: new URL(hash, dom.window.location.href).href, index };
      nav.dispatchEvent(e);
    };
    const current = () =>
      (dom.window as unknown as { _sessionHistory: { _currentIndex: number } })._sessionHistory._currentIndex;
    beforeEach(() => {
      const nav = new dom.window.EventTarget();
      Object.defineProperty(nav, 'currentEntry', { get: () => ({ index: current() }) });
      Object.defineProperty(dom.window, 'navigation', { value: nav, configurable: true });
      hashchanges = 0;
      dom.window.addEventListener('hashchange', count);
    });
    afterEach(() => {
      dom.window.removeEventListener('hashchange', count);
      delete (dom.window as unknown as { navigation?: unknown }).navigation;
    });
    const register = async (dirtyNow: () => boolean) => {
      await walk('#/home');
      mount([page('home'), page('routine'), page('attendance', { hasUnsavedChanges: dirtyNow })]);
      await settle();
      await walk('#/routine');
      await walk('#/attendance');
      hashchanges = 0;
    };

    test('a push is undone by exactly one step back', async () => {
      let dirty = false;
      await register(() => dirty);
      const length = dom.window.history.length;
      dirty = true;
      fire('push', '#/home', -1);
      await walk('#/home');
      assert.equal(dom.window.location.hash, '#/attendance');
      assert.equal(hashchanges, 2, 'the tab, and the one step back — no checking trip');
      assert.ok(dom.window.history.length <= length + 1);
      dialogButtons()[0].click();
      await settle();
      dirty = false;
      dom.window.history.back();
      await settle();
      assert.match(view(), /view:routine/);
    });

    test('a replace is put back in place, without travelling at all', async () => {
      let dirty = false;
      await register(() => dirty);
      const length = dom.window.history.length;
      const number = navNumber();
      dirty = true;
      fire('replace', '#/home', -1);
      dom.window.location.replace('#/home');
      await settle();
      assert.equal(dom.window.location.hash, '#/attendance');
      assert.match(view(), /view:attendance/);
      assert.equal(hashchanges, 1, 'only the replace itself');
      assert.equal(dom.window.history.length, length);
      assert.equal(navNumber(), number, 'the entry put back carries the register’s number again');

      // Counted from that number, two back presses each travel one entry.
      dom.window.history.back();
      await settle();
      dialogButtons()[0].click();   // বাতিল
      await settle();
      assert.equal(dom.window.location.hash, '#/attendance');
      assert.equal(navNumber(), number, 'the step forward came back to the same numbered entry');
      dirty = false;
      dom.window.history.back();
      await settle();
      assert.match(view(), /view:routine/);
    });

    test('a back press to an entry the shell never numbered is undone by stepping forward', async () => {
      let dirty = false;
      await walk('#/before');   // an entry from before the shell started
      await walk('#/attendance');
      mount([page('before'), page('attendance', { hasUnsavedChanges: () => dirty })]);
      await settle();
      const length = dom.window.history.length;
      dirty = true;
      fire('traverse', '#/before', current() - 1);
      dom.window.history.back();
      await settle();
      assert.equal(dom.window.location.hash, '#/attendance', 'stepped forward again, not further back');
      assert.match(view(), /view:attendance/);
      assert.equal(dom.window.history.length, length);
      assert.equal(typeof (dom.window.history.state as Record<string, unknown> | null)?.shikhonNav, 'number',
        'back on the register’s own entry, not the earlier entry pointed at the register');
      const buttons = dialogButtons();
      buttons[buttons.length - 1].click();   // বাদ দিন
      await settle();
      assert.match(view(), /view:before/);
      assert.equal(dom.window.location.hash, '#/before');
      assert.equal(dom.window.history.length, length);
    });
  });

  test('a guard that resumes before it even returns lets the navigation through', async () => {
    await walk('#/editor');
    mount([page('editor', { guardLeave: (resume) => { resume(); return true; } }), page('elsewhere')]);
    await settle();
    await walk('#/elsewhere');
    assert.match(view(), /view:elsewhere/, 'the page itself, not a sidebar label');
    assert.equal(dom.window.location.hash, '#/elsewhere');
  });
});

/* ── contract: the outbox event ─────────────────────────────────────────── */

describe('autoFlush tells the page what is waiting (shikhon:outbox)', () => {
  const running: Array<{ stop(): void }> = [];
  const listeners: Array<(e: Event) => void> = [];
  afterEach(() => {
    for (const f of running.splice(0)) f.stop();
    for (const l of listeners.splice(0)) doc().removeEventListener('shikhon:outbox', l);
  });
  test('after the boot flush, after each progress report, and never after stop', async () => {
    const seen: Array<{ pending: number; inflight: number }> = [];
    const listen = (e: Event) => { seen.push((e as CustomEvent).detail); };
    doc().addEventListener('shikhon:outbox', listen);
    listeners.push(listen);
    let pending = 1;
    const f = autoFlush({
      flush: async () => { pending = 0; },
      state: async () => ({ pending, inflight: 0 }),
      doc: doc(),
      registerSync: () => {},
      retryMs: 60_000,
    });
    running.push(f);
    await tick();
    assert.deepEqual(seen, [{ pending: 0, inflight: 0 }], 'the boot flush attempt reports the queue it left');

    f.progress({ pending: 2, inflight: 1 });
    assert.deepEqual(seen.at(-1), { pending: 2, inflight: 1 }, 'a progress report is passed on as it is');
    f.progress({ pending: 3 });
    assert.deepEqual(seen.at(-1), { pending: 3, inflight: 0 }, 'inflight is always a number');

    dom.window.dispatchEvent(new dom.window.Event('online'));
    await tick();
    assert.equal(seen.length, 4, 'the flush on reconnect reports too');

    f.stop();
    f.progress({ pending: 5, inflight: 0 });
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await tick();
    assert.equal(seen.length, 4, 'a stopped flusher (logout) says nothing more');
    doc().removeEventListener('shikhon:outbox', listen);
  });

  test('a failed flush attempt still reports what is left', async () => {
    const seen: number[] = [];
    const listen = (e: Event) => { seen.push((e as CustomEvent).detail.pending); };
    doc().addEventListener('shikhon:outbox', listen);
    listeners.push(listen);
    const f = autoFlush({
      flush: async () => { throw new Error('offline after all'); },
      state: async () => ({ pending: 1, inflight: 0 }),
      doc: doc(),
      registerSync: () => {},
      retryMs: 60_000,
    });
    running.push(f);
    await tick();
    assert.deepEqual(seen, [1]);
    f.stop();
    doc().removeEventListener('shikhon:outbox', listen);
  });
});

/* ── 32: who is promised that work is kept offline ──────────────────────── */

describe('app.ts: #/assignments queues offline only for a student (finding 32)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
  const block = (path: string): string => {
    const at = src.search(new RegExp(`path: '${path}',\\r?\\n\\s*labelBn:`));
    assert.ok(at >= 0, `no route ${path}`);
    const rest = src.slice(at);
    const next = rest.search(/\r?\n {6}\{/);
    return next < 0 ? rest : rest.slice(0, next);
  };

  test('the flag follows the role, not the route', () => {
    assert.match(block('assignments'), /queuesOffline: auth\.role === 'student',/);
    assert.doesNotMatch(block('assignments'), /queuesOffline: true/,
      'a teacher grading offline was told the grade was kept on the device');
  });

  test('the shell tells a teacher on that route that saving needs a connection', async () => {
    for (const [role, promise] of [['student', true], ['class_teacher', false]] as const) {
      const shell = new Shell({
        root: host(), doc: doc(), defaultPath: 'assignments', displayName: 'রহিম', onLogout: () => {},
        routes: [
          { path: 'assignments', labelBn: 'বাড়ির কাজ', glyph: 'clipboard', mount: () => {},
            queuesOffline: role === 'student' },
          { path: 'attendance', labelBn: 'হাজিরা', glyph: 'check-square', mount: () => {},
            queuesOffline: true },
        ],
      });
      try {
        dom.window.location.hash = '#/assignments';
        await settle();
        const text = host().querySelector('.offline-banner')?.textContent ?? '';
        if (promise) assert.match(text, /জমা থাকছে/, role);
        else assert.match(text, /সংযোগ লাগবে/, role);
      } finally {
        shell.destroy();
      }
    }
  });
});
