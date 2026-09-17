/**
 * UX sweep, round 2 — the roster's activation code (finding 8, part 1).
 *
 * 8 — at 375, pressing a row's "কোড" left keyboard focus parked on
 *     main#shell-view with no ring, and "বুঝেছি" did the same at every width.
 *     The shell's keeper (ui/dom.ts keepFocusWithin) returns focus to "the
 *     same control" after a rebuild, but the roster's dataTable renders every
 *     row twice — a table for a laptop, a list for a phone, one of them
 *     hidden by CSS — and once the issued-code card is inserted above the
 *     panel the two copies tie, so the keeper picks the first one: the hidden
 *     table's button, which cannot take focus. The dismissed card leaves
 *     nothing to match at all. The view now says where focus goes: onto the
 *     card that holds the new code (named and described, and announced once),
 *     back onto the VISIBLE copy of the row's কোড button on a refusal or when
 *     the card is dismissed — and never away from somewhere the person moved
 *     to on their own while the request was out.
 *
 * jsdom has no CSS, so the two widths are simulated the way a browser treats
 * a `display:none` subtree: nothing inside the hidden shape can take focus,
 * and it has no client rects.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { keepFocusWithin } from '../src/ui/dom.ts';
import { RosterView } from '../src/roster-view.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(0); };

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="shell-view"></main></body></html>',
    { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
});

/* ── the two widths ─────────────────────────────────────────────────────── */

const PHONE_HIDES = '[data-shape="table-list"] > .ui-table-scroll';
const DESK_HIDES = '[data-shape="table-list"] > .ui-list';
let restoreLayout: (() => void) | null = null;

/** Hide one of dataTable's two shapes, as the 1024px media query does. */
function layout(width: 375 | 1280): void {
  const hidden = width < 1024 ? PHONE_HIDES : DESK_HIDES;
  const HE = dom.window.HTMLElement.prototype;
  const EP = dom.window.Element.prototype;
  const focus = HE.focus;
  const rects = EP.getClientRects;
  HE.focus = function (this: HTMLElement, opts?: FocusOptions) {
    if (this.closest(hidden)) return;       // display:none cannot take focus
    return focus.call(this, opts);
  };
  EP.getClientRects = function (this: Element) {
    return (this.closest(hidden) ? [] : [{ width: 80, height: 44 }]) as unknown as DOMRectList;
  };
  restoreLayout = () => { HE.focus = focus; EP.getClientRects = rects; };
}

/* ── fixtures ───────────────────────────────────────────────────────────── */

const STUDENTS = [
  { rollNo: 1, studentId: 's-1', fullName: { bn: 'আনিকা', en: 'Anika' }, phone: null },
  { rollNo: 2, studentId: 's-2', fullName: { bn: 'বিজয়', en: 'Bijoy' }, phone: '01711000000' },
];
const SECTION = { id: 'sec-1', name: 'ক', shift: 'day', studentCount: 2,
  className: { bn: 'নবম', en: 'Nine' }, levelNo: 9, academicYearId: 'y-1' };

let stopKeeper: (() => void) | null = null;

beforeEach(() => {
  localStorage.clear();
  doc().body.innerHTML =
    '<nav><button id="outside" type="button">নোটিশ</button></nav><main id="shell-view"></main>';
});
afterEach(() => {
  stopKeeper?.(); stopKeeper = null;
  restoreLayout?.(); restoreLayout = null;
});

interface Reply { status?: number; body: Record<string, unknown> }

/**
 * Mounted the way the shell mounts it: the view's root IS the keeper's
 * container. `gate`, when given, holds the issue request until released.
 */
function mount(reply: () => Reply, gate?: Promise<void>): HTMLElement {
  localStorage.setItem('shikhon_sections_cache', JSON.stringify([SECTION]));
  localStorage.setItem('shikhon_last_section', 'sec-1');
  localStorage.setItem('shikhon_roster_cache_sec-1', JSON.stringify(STUDENTS));
  const root = doc().getElementById('shell-view') as HTMLElement;
  stopKeeper = keepFocusWithin(root);
  new RosterView({
    root, doc: doc(),
    auth: {
      authedFetch: async (url: string) => {
        if (url.includes('/sections')) {
          return { ok: true, status: 200, json: async () => ({ sections: [SECTION] }) } as unknown as Response;
        }
        if (url.includes('/roster')) {
          return { ok: true, status: 200, json: async () => ({ roster: STUDENTS }) } as unknown as Response;
        }
        if (gate) await gate;
        const r = reply();
        const status = r.status ?? 200;
        return { ok: status === 200, status, json: async () => r.body } as unknown as Response;
      },
    } as never,
  });
  return root;
}

const OK = (): Reply => ({ body: { code: 'ABCDEFGH', expiresAt: '2026-09-20T00:00:00Z' } });

/** A row's কোড button in one shape. */
function codeButton(root: HTMLElement, id: string, shape: 'list' | 'table'): HTMLButtonElement {
  const inShape = shape === 'list' ? '.ui-list' : '.ui-table-scroll';
  const b = [...root.querySelectorAll<HTMLButtonElement>(`${inShape} .roster-issue`)]
    .find((x) => x.closest<HTMLElement>('[data-key]')?.dataset.key === id);
  assert.ok(b, `a ${shape} কোড button for ${id}`);
  return b;
}

/** A keyboard press on a control: it has focus, then Enter activates it. */
function press(b: HTMLElement): void {
  b.focus();
  assert.equal(doc().activeElement, b, 'the control took focus before the press');
  b.click();
}

const active = () => doc().activeElement as HTMLElement | null;
const announced = () => [...doc().querySelectorAll('.ui-toast-host p')].map((p) => p.textContent);

function idText(ids: string | null): string {
  return (ids ?? '').split(/\s+/).filter(Boolean)
    .map((id) => doc().getElementById(id)?.textContent ?? '').join(' ');
}

/* ── tests ──────────────────────────────────────────────────────────────── */

describe('8 — focus after a row\'s কোড', () => {
  for (const width of [375, 1280] as const) {
    test(`at ${width}, a new code takes focus on its card, named, described and announced`, async () => {
      layout(width);
      const root = mount(OK);
      await settle();
      press(codeButton(root, 's-1', width < 1024 ? 'list' : 'table'));
      await settle();

      const card = root.querySelector<HTMLElement>('.issued-code-card');
      assert.ok(card, 'the card is on screen');
      assert.equal(active(), card, `focus is on the card, not ${active()?.tagName}#${active()?.id}`);
      assert.notEqual(active(), root, 'not parked on main#shell-view');
      assert.equal(card.getAttribute('tabindex'), '-1', 'focusable by script, not a Tab stop');
      // What a screen reader says on arriving there.
      assert.equal(idText(card.getAttribute('aria-labelledby')), 'আনিকা এর সক্রিয়ন কোড');
      assert.match(idText(card.getAttribute('aria-describedby')), /ABCD-EFGH/);
      assert.match(idText(card.getAttribute('aria-describedby')), /৭২ ঘণ্টা/);
      assert.deepEqual(announced(), ['আনিকা এর সক্রিয়ন কোড তৈরি হয়েছে']);
    });
  }

  test('the announcement is made once, not again on every later redraw', async () => {
    layout(375);
    const root = mount(OK);
    await settle();
    press(codeButton(root, 's-1', 'list'));
    await settle();
    assert.equal(announced().length, 1);

    // The section select redraws the screen twice (loading, then the list)
    // with the card still up: nothing new was created, so nothing is said.
    const select = root.querySelector<HTMLSelectElement>('select[name="section"]')!;
    select.value = 'sec-1';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    assert.ok(root.querySelector('.issued-code-card'), 'the card survives the redraw');
    assert.equal(announced().length, 1, `announced again: ${JSON.stringify(announced())}`);
  });

  for (const width of [375, 1280] as const) {
    test(`at ${width}, "বুঝেছি" puts focus back on the row's visible কোড button`, async () => {
      layout(width);
      const shape = width < 1024 ? 'list' : 'table';
      const root = mount(OK);
      await settle();
      press(codeButton(root, 's-2', shape));
      await settle();

      const ok = [...root.querySelectorAll<HTMLButtonElement>('.issued-code-card button')]
        .find((b) => b.textContent?.includes('বুঝেছি'))!;
      press(ok);
      await settle();

      assert.equal(root.querySelector('.issued-code-card'), null);
      assert.equal(active(), codeButton(root, 's-2', shape),
        `focus is on ${active()?.tagName}.${active()?.className}`);
      assert.equal((active() as HTMLButtonElement).disabled, false);
    });
  }

  test('with no layout to ask, "বুঝেছি" goes back to the rendering that was pressed', async () => {
    // No boxes for either copy (jsdom as it is; a layout not yet computed):
    // the list's button was pressed, so the list's copy — not the first one
    // in the DOM, the table's — gets focus back.
    const root = mount(OK);
    await settle();
    press(codeButton(root, 's-2', 'list'));
    await settle();
    press([...root.querySelectorAll<HTMLButtonElement>('.issued-code-card button')]
      .find((b) => b.textContent?.includes('বুঝেছি'))!);
    await settle();
    assert.equal(active(), codeButton(root, 's-2', 'list'),
      `focus is on ${active()?.tagName}.${active()?.className} in ${active()?.closest('.ui-list') ? 'list' : 'table'}`);
  });

  test('"বুঝেছি" when the search now hides that row goes to the section picker, not main', async () => {
    layout(375);
    const root = mount(OK);
    await settle();
    press(codeButton(root, 's-1', 'list'));
    await settle();
    // Search narrows the list to the other student while the card is up.
    const search = root.querySelector<HTMLInputElement>('.roster-bar input')!;
    search.value = 'বিজয়';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
    press([...root.querySelectorAll<HTMLButtonElement>('.issued-code-card button')]
      .find((b) => b.textContent?.includes('বুঝেছি'))!);
    await settle();
    assert.equal(root.querySelectorAll('.ui-list .roster-issue').length, 1, 'only বিজয় is listed');
    assert.equal(active(), root.querySelector('select[name="section"]'),
      `focus is on ${active()?.tagName}.${active()?.className}`);
  });

  test('"বুঝেছি" tapped while focus is outside the card leaves focus where it is', async () => {
    // A tap that does not focus the button (Safari), with focus in the nav.
    layout(375);
    const root = mount(OK);
    await settle();
    press(codeButton(root, 's-1', 'list'));
    await settle();
    const outside = doc().getElementById('outside') as HTMLButtonElement;
    outside.focus();
    [...root.querySelectorAll<HTMLButtonElement>('.issued-code-card button')]
      .find((b) => b.textContent?.includes('বুঝেছি'))!.click();
    await settle();
    assert.equal(root.querySelector('.issued-code-card'), null);
    assert.equal(active(), outside, 'not pulled into the list');
  });

  test('at 375, a refusal keeps focus on the row\'s visible কোড button', async () => {
    layout(375);
    const root = mount(() => ({ status: 403, body: { error: 'not_your_student' } }));
    await settle();
    press(codeButton(root, 's-1', 'list'));
    await settle();

    assert.equal(root.querySelector('.issued-code-card'), null);
    assert.match(root.querySelector('[role="alert"]')?.textContent ?? '', /শুধু নিজের শাখার/);
    assert.equal(active(), codeButton(root, 's-1', 'list'),
      `focus is on ${active()?.tagName}.${active()?.className}`);
  });

  test('focus the person moved elsewhere while the code was being made stays there', async () => {
    layout(375);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const root = mount(OK, gate);
    await settle();
    press(codeButton(root, 's-1', 'list'));
    await settle();

    const outside = doc().getElementById('outside') as HTMLButtonElement;
    outside.focus();
    release();
    await settle();

    assert.ok(root.querySelector('.issued-code-card'), 'the code still arrived');
    assert.equal(active(), outside, 'not pulled back into the view');
  });

  test('typing in the search while the code was being made keeps the search box', async () => {
    layout(375);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const root = mount(OK, gate);
    await settle();
    press(codeButton(root, 's-1', 'list'));
    await settle();

    const search = root.querySelector<HTMLInputElement>('input[type="search"], .ui-search-input')!;
    assert.ok(search, 'the search box');
    search.focus();
    release();
    await settle();

    assert.ok(root.querySelector('.issued-code-card'), 'the code still arrived');
    const now = active() as HTMLInputElement | null;
    assert.equal(now?.tagName, 'INPUT', `focus is on ${now?.tagName}.${now?.className}`);
    assert.ok(now?.closest('.roster-bar'), 'the roster\'s own search box');
  });
});
