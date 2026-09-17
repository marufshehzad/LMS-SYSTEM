/**
 * UX sweep — the shared JavaScript fixes (group infra-js).
 *
 * Each block names the confirmed finding it closes. The behaviour lives in
 * ui/dom.ts (keepFocusWithin), ui/overlay.ts (closeAllOverlays), ui/filter.ts
 * (tabs refocus), shell.ts (route-change cleanup, the unsaved-work question,
 * the offline sentence, the account menu, the skip link, autoFlush) and
 * app.ts (the route table's wiring).
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { keepFocusWithin, focusIsLost, el } from '../src/ui/dom.ts';
import { openOverlay, closeAllOverlays } from '../src/ui/overlay.ts';
import { tabs } from '../src/ui/filter.ts';
import { Shell, autoFlush, type ShellRoute } from '../src/shell.ts';
import { RoutineEditorView } from '../src/routine-editor-view.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let fakeNavigator: { onLine: boolean };

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.location = dom.window.location;
  fakeNavigator = { onLine: true };
  Object.defineProperty(globalThis, 'navigator', { value: fakeNavigator, configurable: true });
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

beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<main id="root"></main>';
  dom.window.location.hash = '';
  fakeNavigator.onLine = true;
});

const host = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;

/* ── 8 / 12: focus survives a re-render ─────────────────────────────────── */

describe('keepFocusWithin (findings 8, 12)', () => {
  test('a view that rebuilds on a button press keeps focus on the equivalent button', async () => {
    const root = host();
    let count = 0;
    const render = () => {
      root.textContent = '';
      const b = el(doc(), 'button', { text: `আরও দেখুন`, attrs: { type: 'button' } });
      b.addEventListener('click', () => { count++; render(); });
      root.append(el(doc(), 'p', { text: `${count}` }), b);
    };
    render();
    const stop = keepFocusWithin(root);
    const first = root.querySelector('button')!;
    first.focus();
    first.click();
    await tick();
    const now = active();
    assert.notEqual(now, doc().body, 'focus fell to <body>');
    assert.notEqual(now, first, 'the old button is gone');
    assert.equal(now, root.querySelector('button'), 'focus is on the rebuilt button');
    stop();
  });

  test('an input rebuilt while typing keeps focus and caret', async () => {
    const root = host();
    let value = '';
    const render = () => {
      root.textContent = '';
      const input = el(doc(), 'input', { attrs: { type: 'search', name: 'q', id: 'f-9' } });
      input.value = value;
      input.addEventListener('input', () => { value = input.value; render(); });
      root.append(input);
    };
    render();
    const stop = keepFocusWithin(root);
    const input = root.querySelector('input')!;
    input.focus();
    input.value = 'রাফি';
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await tick();
    const now = active() as HTMLInputElement;
    assert.equal(now?.tagName, 'INPUT', 'focus is back in the field');
    assert.notEqual(now, input);
    assert.equal(now.value, 'রাফি');
    assert.equal(now.selectionStart, 2, 'the caret is where it was');
    assert.equal(now.selectionEnd, 2);
    stop();
  });

  test('a row button in a rebuilt list goes back to the same row', async () => {
    const root = host();
    const ids = ['s1', 's2', 's3'];
    const render = () => {
      root.textContent = '';
      const ul = el(doc(), 'ul');
      for (const id of ids) {
        const b = el(doc(), 'button', { text: 'খুলুন', attrs: { type: 'button' } });
        b.addEventListener('click', () => { ids.reverse(); render(); });
        ul.append(el(doc(), 'li', { data: { id } }, b));
      }
      root.append(ul);
    };
    render();
    const stop = keepFocusWithin(root);
    const second = root.querySelector('[data-id="s3"] button') as HTMLButtonElement;
    second.focus();
    second.click();   // rebuilds, in reverse order: s3 is now the first row
    await tick();
    assert.equal(active()?.closest('li')?.getAttribute('data-id'), 's3',
      'focus went to the same student, not the same position');
    stop();
  });

  test('a deliberate focus move is never overridden', async () => {
    const root = host();
    const outside = el(doc(), 'button', { text: 'বাইরে' });
    doc().body.append(outside);
    root.append(el(doc(), 'button', { text: 'ভিতরে' }));
    const stop = keepFocusWithin(root);
    (root.querySelector('button') as HTMLElement).focus();
    outside.focus();
    root.textContent = '';
    root.append(el(doc(), 'button', { text: 'ভিতরে' }));
    await tick();
    assert.equal(active(), outside, 'focus stayed where the person put it');

    // A blur to the page background is deliberate too.
    const inner = root.querySelector('button') as HTMLElement;
    inner.focus();
    inner.blur();
    await tick();
    root.textContent = '';
    root.append(el(doc(), 'button', { text: 'ভিতরে' }));
    await tick();
    assert.equal(active(), doc().body, 'a deliberate blur is left alone');
    stop();
  });

  test('when nothing matches, the container takes focus — never <body>', async () => {
    const root = host();
    root.append(el(doc(), 'button', { text: 'সব পড়া হয়েছে' }));
    const stop = keepFocusWithin(root);
    (root.querySelector('button') as HTMLElement).focus();
    root.textContent = '';
    root.append(el(doc(), 'p', { text: 'কিছু নেই' }));
    await tick();
    assert.equal(active(), root);
    assert.equal(root.getAttribute('tabindex'), '-1');

    // …and when the control comes back on a later rebuild, focus follows it.
    root.append(el(doc(), 'button', { text: 'সব পড়া হয়েছে' }));
    await tick();
    assert.equal(active(), root.querySelector('button'));
    stop();
  });

  test('a button never hands focus to a text field (no keyboard pops up)', async () => {
    const root = host();
    root.append(el(doc(), 'div', {}, el(doc(), 'button', { text: 'ক' })));
    const stop = keepFocusWithin(root);
    (root.querySelector('button') as HTMLElement).focus();
    root.textContent = '';
    root.append(el(doc(), 'div', {}, el(doc(), 'input', { attrs: { type: 'text' } })));
    await tick();
    assert.notEqual(active()?.tagName, 'INPUT');
    stop();
  });

  test('it waits while an overlay is open, then returns focus to the rebuilt opener', async () => {
    const root = host();
    const render = () => {
      root.textContent = '';
      root.append(el(doc(), 'button', { text: 'ফিল্টার', data: { action: 'filter' } }));
    };
    render();
    const stop = keepFocusWithin(root);
    (root.querySelector('button') as HTMLElement).focus();
    const h = openOverlay(doc(), { title: 'ছাঁকনি', body: 'x' });
    render();   // the list behind the sheet re-renders
    await tick();
    assert.ok(h.el.contains(active()), 'the overlay keeps focus while it is open');
    h.close();
    await tick();
    assert.equal(active(), root.querySelector('button'), 'focus came back to the new opener');
    stop();
  });

  test('typing into a field its own listener rebuilds keeps the letters in order (browser event order)', async () => {
    // A real keystroke runs microtasks between listeners, so the observer
    // restores focus right after the field's own `input` listener rebuilt the
    // root — before any bubbling listener further out has seen the event.
    // Modelled here without events: change value and caret, rebuild, settle.
    // The pattern is exams-view / fee-structures-view's search box
    // (`onInput: v => { this.search = v; this.render(); }`).
    const root = host();
    let value = '';
    const render = () => {
      root.textContent = '';
      const input = el(doc(), 'input', { attrs: { type: 'search', name: 'q' } });
      input.value = value;
      root.append(el(doc(), 'label', { text: 'খুঁজুন' }), input);
    };
    render();
    const stop = keepFocusWithin(root);
    (root.querySelector('input') as HTMLInputElement).focus();
    for (const ch of ['র', 'হ', 'ি', 'ম']) {
      const cur = active() as HTMLInputElement;
      assert.equal(cur?.tagName, 'INPUT', 'focus stayed in the field');
      const pos = cur.selectionStart ?? cur.value.length;
      cur.value = cur.value.slice(0, pos) + ch + cur.value.slice(pos);
      cur.setSelectionRange(pos + 1, pos + 1);
      value = cur.value;
      render();   // the field's own listener
      await tick();
    }
    const now = active() as HTMLInputElement;
    assert.equal(now.value, 'রহিম', 'the letters came out in the order they were typed');
    assert.equal(now.selectionStart, 4, 'the caret follows the last letter');
    stop();
  });

  test('the caret is read in the capture phase, before the field’s own listener can rebuild it', () => {
    // In a browser, a bubbling listener on the container runs only AFTER the
    // observer has restored focus, so the caret it reads is a keystroke late.
    const root = host();
    const seen = new Map<string, unknown>();
    const add = root.addEventListener.bind(root);
    root.addEventListener = ((type: string, fn: EventListener, opts?: unknown) => {
      seen.set(type, opts);
      return add(type, fn, opts as boolean);
    }) as typeof root.addEventListener;
    const stop = keepFocusWithin(root);
    for (const type of ['input', 'keyup', 'select', 'pointerup']) {
      const o = seen.get(type);
      assert.ok(o === true || (typeof o === 'object' && o !== null
        && (o as { capture?: boolean }).capture === true), `${type} is listened for in capture`);
    }
    stop();
  });

  test('a control that comes back disabled (busy render) is waited for, not parked on', async () => {
    const root = host();
    let busy = false;
    let label = 'জমা দিন';
    const render = () => {
      root.textContent = '';
      const b = el(doc(), 'button', { text: label, attrs: { type: 'button' } });
      b.disabled = busy;
      root.append(el(doc(), 'ul', {},
        el(doc(), 'li', { data: { id: 's6' } }, el(doc(), 'button', { text: 'অন্য' })),
        el(doc(), 'li', { data: { id: 's7' } }, b)));
    };
    render();
    const stop = keepFocusWithin(root);
    (root.querySelector('[data-id="s7"] button') as HTMLElement).focus();
    busy = true;
    render();
    await tick();
    assert.equal(active(), doc().body, 'a busy render leaves focus where the browser put it');
    assert.equal(focusIsLost(doc()), true);
    busy = false;
    label = 'জমা হয়েছে';   // a different label, the same place
    render();
    await tick();
    assert.equal(active(), root.querySelector('[data-id="s7"] button'),
      'the re-enabled control gets focus back — not the container, not another row');
    stop();
  });

  test('a view’s own “focus fell to body, put it back” repair still runs after a busy render', async () => {
    // routine-editor-view.ts render(): restoreFocus(… || activeElement === body).
    const root = host();
    let busy = false;
    const render = () => {
      root.textContent = '';
      const h = el(doc(), 'h1', { text: 'বিস্তারিত', attrs: { tabindex: '-1' } });
      const b = el(doc(), 'button', {
        text: busy ? 'পাঠানো হচ্ছে' : 'পাঠান', attrs: { type: 'button' },
      });
      b.disabled = busy;
      root.append(h, el(doc(), 'div', { data: { id: 'x' } }, b));
      if (!busy && doc().activeElement === doc().body) h.focus();
    };
    render();
    const stop = keepFocusWithin(root);
    (root.querySelector('button') as HTMLElement).focus();
    busy = true;
    render();
    await tick();
    busy = false;
    render();
    await tick();
    assert.equal(active(), root.querySelector('h1'), 'the view put focus where it wanted it');
    stop();
  });

  test('focusIsLost: <body>, or focus the keeper parked on its container', async () => {
    const root = host();
    const outside = el(doc(), 'button', { text: 'বাইরে' });
    doc().body.append(outside);
    root.append(el(doc(), 'button', { text: 'সব পড়া হয়েছে' }));
    const stop = keepFocusWithin(root);
    (root.querySelector('button') as HTMLElement).focus();
    assert.equal(focusIsLost(doc()), false);
    root.textContent = '';
    root.append(el(doc(), 'p', { text: 'কিছু নেই' }));
    await tick();
    assert.equal(active(), root, 'parked on the container');
    assert.equal(focusIsLost(doc()), true, 'parked focus counts as lost');
    outside.focus();
    assert.equal(focusIsLost(doc()), false);
    root.focus();   // the person (a skip link) put it there: not lost
    assert.equal(focusIsLost(doc()), false);
    outside.blur();
    stop();
  });

  test('the routine editor’s moved class keeps focus on its new cell (R8, keeper armed on the view root)', async () => {
    const section = 'cccccccc-0000-4000-8000-00000000000a';
    const grid = {
      sectionId: section,
      routine: {
        id: 'dddddddd-0000-4000-8000-00000000000b', nameBn: 'খসড়া', shift: 'single',
        status: 'draft', version: 1, publishedAt: null, editable: true, sectionLabel: 'নবম-ক',
      },
      days: [{ dow: 0, bn: 'রবি' }, { dow: 1, bn: 'সোম' }],
      periods: [
        { periodNo: 1, labelBn: '১ম', startsAt: '09:00', endsAt: '09:45', kind: 'teaching' },
        { periodNo: 2, labelBn: '২য়', startsAt: '09:45', endsAt: '10:30', kind: 'teaching' },
      ],
      slots: [{
        id: 'eeeeeeee-0000-4000-8000-00000000000c', dayOfWeek: 0, periodNo: 1,
        subjectBn: 'গণিত', teacherName: 'রফিক স্যার', roomName: 'কক্ষ ১',
        isDouble: false, doubleGroupId: null, parallelPool: null, isPinned: false,
        rowVersion: 7, teacherId: 'aaaaaaaa-0000-4000-8000-00000000000e',
      }],
      undo: [], subjects: [], teachers: [], rooms: [],
    };
    let release: () => void = () => {};
    const auth = {
      role: 'principal',
      authedFetch: async (url: string, init?: { method?: string }) => {
        if (init?.method === 'POST') {
          await new Promise<void>((r) => { release = r; });   // the network
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        if (url.includes('/academics/sections')) {
          return { ok: true, status: 200, json: async () => ({
            sections: [{ id: section, name: 'ক', className: { bn: 'নবম' } }],
          }) };
        }
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(grid)) };
      },
    };
    const settle = async () => { for (let i = 0; i < 16; i++) await tick(); };
    const root = host();
    const stop = keepFocusWithin(root);
    new RoutineEditorView({ root, doc: doc(), auth } as unknown as
      ConstructorParameters<typeof RoutineEditorView>[0]);
    await settle();
    const cellAt = (k: string) => root.querySelector(`button[data-cell="${k}"]`) as HTMLButtonElement;
    assert.ok(cellAt('0-1') && cellAt('0-2'), 'the grid is drawn');
    cellAt('0-1').focus();
    cellAt('0-1').click();   // pick up the class
    await settle();
    cellAt('0-2').focus();
    cellAt('0-2').click();   // put it down: a busy render, then the POST
    await settle();
    assert.notEqual(active(), root, 'a busy render does not park focus on the view');
    release();
    await settle();
    assert.equal(active(), cellAt('0-2'), 'focus is on the cell the class was moved to');
    stop();
  });

  test('the disposer stops it', async () => {
    const root = host();
    root.append(el(doc(), 'button', { text: 'ক' }));
    const stop = keepFocusWithin(root);
    (root.querySelector('button') as HTMLElement).focus();
    stop();
    root.textContent = '';
    root.append(el(doc(), 'button', { text: 'ক' }));
    await tick();
    assert.equal(active(), doc().body);
  });
});

describe('tabs() refocuses a strip its caller rebuilt (finding 8)', () => {
  test('ArrowRight twice moves twice, even though every press rebuilds the strip', () => {
    const root = host();
    let current = 'a';
    const render = () => {
      root.textContent = '';
      root.append(tabs(doc(), {
        label: 'দেখা', active: current,
        items: [{ id: 'a', label: 'ক' }, { id: 'b', label: 'খ' }, { id: 'c', label: 'গ' }],
        onSelect: (id) => { current = id; render(); },
      }));
    };
    render();
    (doc().getElementById('tab-a') as HTMLElement).focus();
    const press = () => active()!.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    press();
    assert.equal(active()?.id, 'tab-b', 'first press');
    press();
    assert.equal(current, 'c', 'the second press still reached the strip');
    assert.equal(active()?.id, 'tab-c');
    assert.equal(active()?.getAttribute('tabindex'), '0', 'roving tabindex intact');
  });
});

/* ── 14: overlays do not survive navigation ─────────────────────────────── */

const mountShell = (routes: ShellRoute[], extra: Record<string, unknown> = {}) => new Shell({
  root: host(), doc: doc(), routes, defaultPath: routes[0].path,
  displayName: 'রহিম', onLogout: () => {}, ...extra,
});
const go = async (path: string) => {
  dom.window.location.hash = `#/${path}`;
  dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
  await tick(5);
};
const simple = (path: string, more: Partial<ShellRoute> = {}): ShellRoute => ({
  path, labelBn: path, glyph: 'home',
  mount: (c) => { c.append(el(doc(), 'h1', { text: `view:${path}` })); },
  ...more,
});

describe('closeAllOverlays (finding 14)', () => {
  test('closes every open overlay and restores the page', () => {
    const page = el(doc(), 'div');
    doc().body.append(page);
    let closed = 0;
    openOverlay(doc(), { title: 'এক', body: 'x', onClose: () => { closed++; } });
    openOverlay(doc(), { title: 'দুই', body: 'y', onClose: () => { closed++; } });
    closeAllOverlays();
    assert.equal(doc().querySelectorAll('.ui-scrim').length, 0);
    assert.equal(closed, 2);
    assert.equal(page.hasAttribute('aria-hidden'), false);
  });

  test('a sheet open on one route is gone on the next (Android back)', async () => {
    const shell = mountShell([simple('fees'), simple('home')]);
    await tick(5);
    openOverlay(doc(), { title: 'INV-2026-08-00001', body: 'x' });
    await go('home');
    assert.equal(doc().querySelector('.ui-scrim'), null, 'the sheet stayed over হোম');
    assert.equal(host().querySelector('main')?.getAttribute('aria-hidden'), null);
    shell.destroy();
  });

  test('a confirm dialog carries its consequence sentence as its description (minor 91)', async () => {
    const { confirmOverlay } = await import('../src/ui/overlay.ts');
    const h = confirmOverlay(doc(), {
      title: 'নিষ্ক্রিয় করা নিশ্চিত করুন', body: 'আর প্রবেশ করতে পারবেন না।',
      confirmLabel: 'নিষ্ক্রিয় করুন', onConfirm: () => {},
    });
    const id = h.el.getAttribute('aria-describedby');
    assert.ok(id);
    assert.equal(doc().getElementById(id!)?.textContent, 'আর প্রবেশ করতে পারবেন না।');
    h.close();
  });
});

/* ── 52: the unsaved-work question ──────────────────────────────────────── */

describe('ShellRoute.hasUnsavedChanges (finding 52)', () => {
  test('leaving with unsaved work asks first; Cancel stays, বাদ দিন leaves', async () => {
    let dirty = true;
    const shell = mountShell([
      simple('attendance', {
        hasUnsavedChanges: () => dirty,
        unsavedPrompt: { title: 'হাজিরা জমা দেওয়া হয়নি' },
      }),
      simple('home'),
    ]);
    await tick(5);
    await go('home');
    const dialog = doc().querySelector('.ui-scrim [role="alertdialog"]') as HTMLElement;
    assert.ok(dialog, 'the question is asked');
    assert.match(dialog.textContent ?? '', /হাজিরা জমা দেওয়া হয়নি/);
    assert.equal(dom.window.location.hash, '#/attendance', 'the address bar is put back');
    assert.match(host().textContent ?? '', /view:attendance/, 'the register is still mounted');

    // A second back press while asking does not stack a second question.
    await go('home');
    assert.equal(doc().querySelectorAll('.ui-scrim').length, 1);

    const [cancel] = [...dialog.querySelectorAll('button')];
    cancel.click();
    await tick(5);
    assert.equal(doc().querySelector('.ui-scrim'), null);
    assert.match(host().textContent ?? '', /view:attendance/);

    await go('home');
    const again = doc().querySelector('.ui-scrim [role="alertdialog"]') as HTMLElement;
    const buttons = [...again.querySelectorAll('button')];
    buttons[buttons.length - 1].click();   // বাদ দিন
    await tick(30);
    assert.match(host().textContent ?? '', /view:home/, 'confirmed: the navigation went through');
    assert.equal(doc().querySelector('.ui-scrim'), null);

    // Nothing unsaved: no question at all.
    dirty = false;
    await go('attendance');
    await go('home');
    assert.equal(doc().querySelector('.ui-scrim'), null);
    assert.match(host().textContent ?? '', /view:home/);
    shell.destroy();
  });
});

/* ── 32: the offline sentence depends on the route ──────────────────────── */

describe('offline banner sentence (finding 32)', () => {
  test('only a queueing route promises the work is kept on the device', async () => {
    const shell = mountShell([
      simple('attendance', { queuesOffline: true }),
      simple('invoices'),
    ]);
    await tick(5);
    const text = () => host().querySelector('.offline-banner')?.textContent ?? '';
    assert.match(text(), /কাজ চালিয়ে যান, সব এই যন্ত্রে জমা থাকছে/);
    await go('invoices');
    assert.doesNotMatch(text(), /জমা থাকছে/, 'finance must not be told its work is kept');
    assert.match(text(), /সংযোগ লাগবে/);
    shell.destroy();
  });
});

/* ── 61 / 62: the account menu ──────────────────────────────────────────── */

describe('account menu (findings 61, 62)', () => {
  test('desktop: clicking into a text field keeps focus in the field', async () => {
    const shell = mountShell([{
      path: 'users', labelBn: 'users', glyph: 'users',
      mount: (c) => { c.append(el(doc(), 'input', { attrs: { type: 'search' } })); },
    }]);
    await tick(5);
    (host().querySelector('.d-profile') as HTMLButtonElement).click();
    assert.ok(host().querySelector('.shell-menu'));
    const input = host().querySelector('#shell-view input') as HTMLInputElement;
    input.focus();   // mousedown already moved focus
    input.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    assert.equal(host().querySelector('.shell-menu'), null, 'the menu closed');
    assert.equal(active(), input, 'focus was pulled back to the account button');
    shell.destroy();
  });

  test('phone: the sheet traps Tab, hides the page, and Escape returns focus', async () => {
    const g = globalThis as Record<string, unknown>;
    const desktop = g.matchMedia;
    g.matchMedia = (q: string) => ({
      matches: /max-width:\s*1023/.test(q), media: q,
      addEventListener() {}, removeEventListener() {},
    });
    try {
      const shell = mountShell([simple('home')]);
      await tick(5);
      const avatar = host().querySelector('.shell-avatar') as HTMLButtonElement;
      avatar.focus();
      avatar.click();
      const menu = host().querySelector('.shell-menu') as HTMLElement;
      assert.equal(menu.getAttribute('role'), 'dialog');
      assert.equal(menu.getAttribute('aria-modal'), 'true');
      const logout = menu.querySelector('.shell-logout') as HTMLElement;
      assert.equal(active(), logout);
      assert.equal(host().querySelector('#shell-view')?.getAttribute('aria-hidden'), 'true',
        'the page behind is hidden from readers');

      for (const shiftKey of [false, true]) {
        const tab = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
        logout.dispatchEvent(tab);
        assert.equal(tab.defaultPrevented, true, 'Tab may not leave the sheet');
        assert.equal(active(), logout);
      }

      doc().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(host().querySelector('.shell-menu'), null);
      assert.equal(active(), avatar);
      assert.equal(host().querySelector('#shell-view')?.getAttribute('aria-hidden'), null,
        'the page is readable again');
      shell.destroy();
    } finally {
      g.matchMedia = desktop;
    }
  });

  test('desktop: Tab out of the dropdown closes it', async () => {
    const shell = mountShell([simple('home')]);
    await tick(5);
    (host().querySelector('.d-profile') as HTMLButtonElement).click();
    const logout = host().querySelector('.shell-logout') as HTMLElement;
    logout.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(host().querySelector('.shell-menu'), null);
    shell.destroy();
  });
});

/* ── 60: the skip link ──────────────────────────────────────────────────── */

describe('skip link (finding 60)', () => {
  test('focuses main without letting the browser scroll it under the topbar', async () => {
    const shell = mountShell([simple('home')]);
    await tick(5);
    const view = host().querySelector('#shell-view') as HTMLElement;
    const calls: unknown[] = [];
    const real = view.focus.bind(view);
    view.focus = (o?: FocusOptions) => { calls.push(o); real(o); };
    (host().querySelector('.skip-link') as HTMLElement).click();
    assert.equal(active(), view);
    assert.deepEqual(calls, [{ preventScroll: true }]);
    shell.destroy();
  });
});

/* ── focus across a route change ────────────────────────────────────────── */

describe('shell wires keepFocusWithin on the view', () => {
  test('an in-view rebuild keeps focus; a route change still lands on main', async () => {
    let n = 0;
    const renderA = (c: HTMLElement) => {
      c.textContent = '';
      const b = el(doc(), 'button', { text: 'আবার চেষ্টা করুন' });
      b.addEventListener('click', () => { n++; renderA(c); });
      c.append(el(doc(), 'p', { text: String(n) }), b);
    };
    const shell = mountShell([
      { path: 'a', labelBn: 'a', glyph: 'home', mount: renderA },
      { path: 'b', labelBn: 'b', glyph: 'home', mount: (c) => {
        c.append(el(doc(), 'button', { text: 'আবার চেষ্টা করুন' }));
      } },
    ]);
    await tick(5);
    const view = host().querySelector('#shell-view') as HTMLElement;
    const btn = view.querySelector('button') as HTMLButtonElement;
    btn.focus();
    btn.click();
    await tick();
    assert.equal(active(), view.querySelector('button'), 'retry keeps focus');

    await go('b');
    assert.equal(active(), view, 'the new page starts at main, not on a look-alike button');
    shell.destroy();
  });
});

/* ── 6 / 51: queued work is sent by itself ──────────────────────────────── */

describe('autoFlush (findings 6, 51)', () => {
  test('flushes at boot, on online, and when the app becomes visible', async () => {
    let flushes = 0;
    const f = autoFlush({
      flush: async () => { flushes++; },
      state: async () => ({ pending: 0 }),
      doc: doc(),
      registerSync: () => {},
    });
    await tick();
    assert.equal(flushes, 1, 'a queue left from before is drained at boot');

    dom.window.dispatchEvent(new dom.window.Event('online'));
    await tick();
    assert.equal(flushes, 2, 'the connection came back');

    Object.defineProperty(doc(), 'visibilityState', { value: 'visible', configurable: true });
    doc().dispatchEvent(new dom.window.Event('visibilitychange'));
    await tick();
    assert.equal(flushes, 3, 'the phone came out of the pocket');

    f.stop();
    dom.window.dispatchEvent(new dom.window.Event('online'));
    doc().dispatchEvent(new dom.window.Event('visibilitychange'));
    await tick();
    assert.equal(flushes, 3, 'stopped means stopped (logout)');
  });

  test('offline it does not try; while work waits online it retries, and asks for Background Sync', async () => {
    fakeNavigator.onLine = false;
    let flushes = 0;
    let pending = 1;
    let syncs = 0;
    const f = autoFlush({
      flush: async () => { flushes++; if (flushes >= 3) pending = 0; },
      state: async () => ({ pending }),
      doc: doc(),
      retryMs: 5,
      registerSync: () => { syncs++; },
    });
    await tick();
    assert.equal(flushes, 0, 'no flush with no connection');

    f.progress({ pending: 1 });   // a save queued while offline
    assert.equal(syncs, 1, 'Background Sync is requested for queued work');

    fakeNavigator.onLine = true;
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await tick(60);
    assert.equal(flushes, 3, 'a failed first flush is retried until the queue drains');
    await tick(30);
    assert.equal(flushes, 3, 'and the retries stop once nothing waits');
    f.stop();
  });
});

/* ── app.ts wiring (6, 18, 21, 32, 52, 64) ──────────────────────────────── */

describe('app.ts route table wiring', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
  const routeBlock = (path: string): string => {
    // The route table's entry, not the dashboard CARD map: a route's path is
    // followed on the next line by its labelBn.
    const at = src.search(new RegExp(`path: '${path}',\\r?\\n\\s*labelBn:`));
    assert.ok(at >= 0, `no route ${path}`);
    const rest = src.slice(at);
    const next = rest.search(/\r?\n {6}\{/);
    return next < 0 ? rest : rest.slice(0, next);
  };

  test('6/51 — the engine is flushed automatically and stopped with the shell', () => {
    assert.match(src, /autoFlush\(\{\s*flush: \(\) => engine\.flush\(\),\s*state: \(\) => engine\.state\(\)/);
    assert.match(src, /flusher\?\.progress\(st\)/);
    assert.match(src, /built\.onDestroy\(\(\) => \{[^}]*flusher\?\.stop\(\)/);
  });

  test('18 — the guardian’s fee button carries the child, and the route passes it on', () => {
    assert.match(src, /onOpenFees: \(studentId\) => \{\s*location\.hash = `#\/fees\?studentId=\$\{encodeURIComponent\(studentId\)\}`/);
    const fees = routeBlock('fees');
    assert.match(fees, /get\('studentId'\)/);
    assert.match(fees, /studentId \}/);
  });

  test('21 — only a student is given the study-next loader', () => {
    assert.doesNotMatch(src, /\['student', 'guardian'\]\.includes\(auth\.role\)/);
    assert.match(src, /const learner = auth\.role === 'student';/);
  });

  test('32 — exactly the queueing routes say so', () => {
    for (const p of ['attendance', 'marks', 'assignments', 'learn']) {
      assert.match(routeBlock(p), /queuesOffline: true/, p);
    }
    for (const p of ['fees', 'invoices', 'feestructures', 'publish']) {
      assert.doesNotMatch(routeBlock(p), /queuesOffline/, p);
    }
  });

  test('52 — attendance asks before its register is thrown away', () => {
    assert.match(routeBlock('attendance'), /hasUnsavedChanges: \(\) =>[\s\S]*hasUnsavedChanges\?\.\(\)/);
  });

  test('64 — the four views that listen for the connection are destroyed on leave', () => {
    for (const p of ['routine', 'fees', 'assignments', 'results']) {
      assert.match(routeBlock(p), /unmount: \(\) => \{ destroyView\(/, p);
    }
  });
});
