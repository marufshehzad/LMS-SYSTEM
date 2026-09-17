/**
 * UX sweep, round 3 — the roster's কোড failure, where the teacher is looking.
 *
 * At 375, pressing row ৬'s "কোড" while offline put focus back on that row's
 * button (page scrolled to 421), but the failure — "সংযোগ পাওয়া যায়নি।", an
 * error card with role="alert" — was drawn above the whole panel, 148px above
 * the top of the viewport. A screen reader heard it; a sighted teacher saw
 * nothing change. The cause: a কোড failure shared `errorMsg` with the load
 * failures, and `render()` draws that above the panel, far from any row.
 *
 * Now a কোড failure is its own state, drawn AT the row whose button was
 * pressed — a line under the row on a phone, under the button in its cell on a
 * laptop — describing that button, announced once, and scrolled on screen the
 * shortest way when focus is put back there. A row the search hides, or a
 * section changed while the request was out, gets the sentence over the rows,
 * naming the child. Load failures keep their card above the panel.
 *
 * jsdom has no CSS, so the two widths are simulated the way a browser treats
 * a `display:none` subtree (as ux-fix2-roster does): nothing inside the hidden
 * shape can take focus, and it has no client rects.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { keepFocusWithin } from '../src/ui/dom.ts';
import { RosterView } from '../src/roster-view.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(0); };

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

/* ── the two widths, and the scroll ─────────────────────────────────────── */

const PHONE_HIDES = '[data-shape="table-list"] > .ui-table-scroll';
const DESK_HIDES = '[data-shape="table-list"] > .ui-list';
const restores: Array<() => void> = [];

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
  restores.push(() => { HE.focus = focus; EP.getClientRects = rects; });
}

interface ScrollCall { el: Element; opts: unknown; active: Element | null }

/** Record every scrollIntoView, and where focus was when it happened. */
function watchScroll(): ScrollCall[] {
  const calls: ScrollCall[] = [];
  const EP = dom.window.Element.prototype as unknown as Record<string, unknown>;
  const had = Object.getOwnPropertyDescriptor(EP, 'scrollIntoView');
  Object.defineProperty(EP, 'scrollIntoView', {
    configurable: true, writable: true,
    value(this: Element, opts?: unknown) {
      calls.push({ el: this, opts, active: doc().activeElement });
    },
  });
  restores.push(() => {
    if (had) Object.defineProperty(EP, 'scrollIntoView', had);
    else delete EP.scrollIntoView;
  });
  return calls;
}

/* ── fixtures ───────────────────────────────────────────────────────────── */

const NAMES = ['আরিফুল', 'সুমাইয়া', 'তানভীর', 'নুসরাত', 'রাকিব', 'ফারিয়া', 'সাকিব', 'মিম'];
const STUDENTS = NAMES.map((bn, i) => ({
  rollNo: i + 1, studentId: `s-${i + 1}`, fullName: { bn, en: null }, phone: null,
}));
const SECTION = { id: 'sec-1', name: 'ক', shift: 'day', studentCount: STUDENTS.length,
  className: { bn: 'নবম', en: 'Nine' }, levelNo: 9, academicYearId: 'y-1' };
const EMPTY_SECTION = { ...SECTION, id: 'sec-2', name: 'খ', studentCount: 0 };

let stopKeeper: (() => void) | null = null;

beforeEach(() => {
  localStorage.clear();
  doc().body.innerHTML =
    '<nav><button id="outside" type="button">নোটিশ</button></nav><main id="shell-view"></main>';
});
afterEach(() => {
  stopKeeper?.(); stopKeeper = null;
  while (restores.length) restores.pop()!();
});

/** What the issue POST does: answer, or throw the way fetch does offline. */
type Issue = () => { status?: number; body: Record<string, unknown> } | 'offline';

const OFFLINE: Issue = () => 'offline';
const OK: Issue = () => ({ body: { code: 'ABCDEFGH', expiresAt: '2026-09-20T00:00:00Z' } });

/**
 * Mounted the way the shell mounts it: the view's root IS the keeper's
 * container. `gate`, when given, holds each issue request until released.
 * `sectionsFail`: the sections read answers 500 and nothing is cached for it.
 */
function mount(issue: { current: Issue }, o: { gate?: Promise<void>; sectionsFail?: boolean } = {}): HTMLElement {
  if (!o.sectionsFail) {
    localStorage.setItem('shikhon_sections_cache', JSON.stringify([SECTION, EMPTY_SECTION]));
  }
  localStorage.setItem('shikhon_last_section', 'sec-1');
  localStorage.setItem('shikhon_roster_cache_sec-1', JSON.stringify(STUDENTS));
  const root = doc().getElementById('shell-view') as HTMLElement;
  stopKeeper = keepFocusWithin(root);
  const res = (status: number, body: unknown) =>
    ({ ok: status === 200, status, json: async () => body }) as unknown as Response;
  new RosterView({
    root, doc: doc(),
    auth: {
      authedFetch: async (url: string) => {
        if (url.includes('/sections')) {
          return o.sectionsFail ? res(500, {}) : res(200, { sections: [SECTION, EMPTY_SECTION] });
        }
        if (url.includes('/roster')) {
          return res(200, { roster: url.includes('sec-2') ? [] : STUDENTS });
        }
        if (o.gate) await o.gate;
        const r = issue.current();
        if (r === 'offline') throw new TypeError('Failed to fetch');
        return res(r.status ?? 200, r.body);
      },
    } as never,
  });
  return root;
}

type Shape = 'list' | 'table';

/** A row in one shape: the phone's <li> or the laptop's <tr>. */
function row(root: HTMLElement, id: string, shape: Shape): HTMLElement {
  const inShape = shape === 'list' ? '.ui-list > li' : '.ui-table-scroll tbody > tr';
  const r = [...root.querySelectorAll<HTMLElement>(inShape)].find((x) => x.dataset.key === id);
  assert.ok(r, `a ${shape} row for ${id}`);
  return r;
}

function codeButton(root: HTMLElement, id: string, shape: Shape): HTMLButtonElement {
  const b = row(root, id, shape).querySelector<HTMLButtonElement>('.roster-issue');
  assert.ok(b, `a ${shape} কোড button for ${id}`);
  return b;
}

/** A keyboard press on a control: it has focus, then Enter activates it. */
function press(b: HTMLElement): void {
  b.focus();
  assert.equal(doc().activeElement, b, 'the control took focus before the press');
  b.click();
}

function type(root: HTMLElement, text: string): void {
  const search = root.querySelector<HTMLInputElement>('.roster-bar input')!;
  search.focus();
  search.value = text;
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

const active = () => doc().activeElement as HTMLElement | null;
const text = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
const MSG = 'সংযোগ পাওয়া যায়নি।';

/** Is `a` before `b` in document order? */
function before_(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Everything in the view that says the message, outside the rows. */
function saidAbovePanel(root: HTMLElement): Element[] {
  const panel = root.querySelector('.roster-panel')!;
  return [...root.querySelectorAll('[role="alert"], .ui-state, .roster-note')]
    .filter((n) => text(n).includes(MSG) && !panel.contains(n));
}

/* ── tests ──────────────────────────────────────────────────────────────── */

describe('R8 — a কোড failure is drawn where the teacher is looking', () => {
  for (const [width, shape] of [[375, 'list'], [1280, 'table']] as const) {
    test(`at ${width}, offline: the failure sits in row ৬, under the button focus returns to`, async () => {
      layout(width);
      const root = mount({ current: OFFLINE });
      await settle();
      press(codeButton(root, 's-6', shape));
      await settle();

      // Not above the panel, where at 375 it was 148px above the viewport.
      assert.deepEqual(saidAbovePanel(root).map((n) => n.className), [],
        'the failure is not drawn above the panel');

      const here = row(root, 's-6', shape);
      const button = codeButton(root, 's-6', shape);
      const note = here.querySelector<HTMLElement>('.roster-issue-note');
      assert.ok(note, `the failure is inside row ৬ of the ${shape}`);
      assert.equal(text(note), MSG);
      assert.equal(note.getAttribute('role'), 'alert', 'announced when it appears');
      assert.ok(before_(button, note), 'drawn after (under) the button, in reading order');
      if (shape === 'table') {
        assert.equal(note.closest('td'), button.closest('td'), 'in the কোড cell, beside its button');
      }

      // Focus is back on the visible button, and the button says why.
      assert.equal(active(), button, `focus is on ${active()?.tagName}.${active()?.className}`);
      const described = button.getAttribute('aria-describedby');
      assert.ok(described, 'the button is described by the failure');
      assert.equal(doc().getElementById(described), note, 'by THIS row\'s visible note');

      // Only row ৬ says it.
      const shownIn = [...root.querySelectorAll<HTMLElement>(
        shape === 'list' ? '.ui-list > li' : '.ui-table-scroll tbody > tr')]
        .filter((r) => r.querySelector('.roster-issue-note')).map((r) => r.dataset.key);
      assert.deepEqual(shownIn, ['s-6']);
    });
  }

  test('a refusal is drawn at its row too, in the server\'s words', async () => {
    layout(375);
    const root = mount({ current: () => ({ status: 403, body: { error: 'not_your_student' } }) });
    await settle();
    press(codeButton(root, 's-3', 'list'));
    await settle();
    assert.match(text(row(root, 's-3', 'list').querySelector('.roster-issue-note')),
      /শুধু নিজের শাখার শিক্ষার্থীর জন্য/);
    assert.equal(root.querySelector('.roster-note'), null, 'no card above the panel');
  });

  test('at 375, the visible note is scrolled on screen the shortest way, and focus stays put', async () => {
    layout(375);
    const calls = watchScroll();
    const root = mount({ current: OFFLINE });
    await settle();
    press(codeButton(root, 's-8', 'list'));
    await settle();

    const note = row(root, 's-8', 'list').querySelector('.roster-issue-note');
    const onNotes = calls.filter((c) => (c.el as Element).classList.contains('roster-issue-note'));
    assert.equal(onNotes.length, 1, `scrolled ${onNotes.length} notes`);
    assert.equal(onNotes[0].el, note, 'the copy CSS renders, not the hidden table copy');
    assert.deepEqual(onNotes[0].opts, { block: 'nearest', inline: 'nearest' },
      'the shortest way: never past it, never to the top');
    assert.equal(onNotes[0].active, codeButton(root, 's-8', 'list'),
      'focus was already back on the button when it scrolled');
    assert.equal(active(), codeButton(root, 's-8', 'list'), 'and it is still there');
  });

  test('somebody who moved on while the request was out keeps their place, and still hears it', async () => {
    layout(375);
    const calls = watchScroll();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const root = mount({ current: OFFLINE }, { gate });
    await settle();
    press(codeButton(root, 's-6', 'list'));
    await settle();
    const outside = doc().getElementById('outside') as HTMLButtonElement;
    outside.focus();
    release();
    await settle();

    const note = row(root, 's-6', 'list').querySelector('.roster-issue-note');
    assert.ok(note, 'the failure is at its row');
    assert.equal(note.getAttribute('role'), 'alert', 'announced');
    assert.equal(active(), outside, 'focus not pulled back');
    assert.equal(calls.filter((c) => (c.el as Element).classList.contains('roster-issue-note')).length, 0,
      'the page is not scrolled under them');
  });

  test('announced once: typing in the search keeps it at the row without saying it again', async () => {
    layout(375);
    const root = mount({ current: OFFLINE });
    await settle();
    press(codeButton(root, 's-6', 'list'));
    await settle();
    assert.equal(row(root, 's-6', 'list').querySelector('.roster-issue-note')?.getAttribute('role'), 'alert');

    // Every keystroke rebuilds the rows. "ফারিয়া" still matches.
    type(root, 'ফার');
    await settle();
    const note = row(root, 's-6', 'list').querySelector('.roster-issue-note');
    assert.ok(note, 'still on screen at its row');
    assert.equal(text(note), MSG);
    assert.equal(note.getAttribute('role'), null, 'not a new alert on every keystroke');
    assert.equal(root.querySelectorAll('[role="alert"]').length, 0);
    assert.equal(codeButton(root, 's-6', 'list').getAttribute('aria-describedby'), note.id,
      'the button is still described by it');
  });

  test('a row the search hides when the failure comes: said over the rows, naming the child', async () => {
    layout(375);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const root = mount({ current: OFFLINE }, { gate });
    await settle();
    press(codeButton(root, 's-6', 'list'));
    await settle();
    type(root, 'মিম');            // only row ৮ is left
    await settle();
    release();
    await settle();

    assert.equal(root.querySelectorAll('.ui-list > li').length, 1);
    const over = root.querySelector<HTMLElement>('.roster-body > .roster-issue-note');
    assert.ok(over, 'the failure is said at the top of the rows');
    assert.equal(text(over), `ফারিয়া এর সক্রিয়ন কোড: ${MSG}`);
    assert.equal(over.getAttribute('role'), 'alert', 'and announced');
    assert.ok(before_(over, root.querySelector('.roster-data')!), 'over the rows');
    assert.deepEqual(saidAbovePanel(root), []);

    // The row comes back: the sentence goes back to it, not said again.
    type(root, '');
    await settle();
    assert.equal(root.querySelector('.roster-body > .roster-issue-note'), null);
    const back = row(root, 's-6', 'list').querySelector('.roster-issue-note');
    assert.ok(back, 'back at row ৬');
    assert.equal(back.getAttribute('role'), null);
  });

  test('a section changed while the request was out: said in the panel, naming the child', async () => {
    layout(375);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const root = mount({ current: OFFLINE }, { gate });
    await settle();
    press(codeButton(root, 's-6', 'list'));
    await settle();
    const select = root.querySelector<HTMLSelectElement>('select[name="section"]')!;
    select.value = 'sec-2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    release();
    await settle();

    const over = root.querySelector<HTMLElement>('.roster-body > .roster-issue-note');
    assert.ok(over, 'the failure is said where the rows would be');
    assert.equal(text(over), `ফারিয়া এর সক্রিয়ন কোড: ${MSG}`);
    assert.equal(over.getAttribute('role'), 'alert');
    assert.deepEqual(saidAbovePanel(root), []);
  });

  test('the next press starts clean, and a section change drops a failure about rows now gone', async () => {
    layout(375);
    const issue = { current: OFFLINE };
    const root = mount(issue);
    await settle();
    press(codeButton(root, 's-6', 'list'));
    await settle();
    assert.ok(root.querySelector('.roster-issue-note'));

    issue.current = OK;
    press(codeButton(root, 's-2', 'list'));
    await settle();
    assert.equal(root.querySelector('.roster-issue-note'), null, 'a code came: no stale failure');
    assert.equal(codeButton(root, 's-6', 'list').getAttribute('aria-describedby'), null);

    issue.current = OFFLINE;
    press(codeButton(root, 's-4', 'list'));
    await settle();
    assert.ok(row(root, 's-4', 'list').querySelector('.roster-issue-note'));
    const select = root.querySelector<HTMLSelectElement>('select[name="section"]')!;
    select.value = 'sec-2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    assert.equal(root.querySelector('.roster-issue-note'), null);
  });

  test('a LOAD failure with a roster on screen still says so above the panel, with its retry', async () => {
    layout(375);
    const root = mount({ current: OFFLINE }, { sectionsFail: true });
    await settle();
    const card = root.querySelector<HTMLElement>('.roster-note');
    assert.ok(card, 'the load failure card');
    assert.ok(before_(card, root.querySelector('.roster-panel')!), 'above the panel');
    assert.ok([...card.querySelectorAll('button')].some((b) => text(b) === 'আবার চেষ্টা করুন'));

    // A কোড failure meanwhile goes to its row; it does not replace the card.
    press(codeButton(root, 's-6', 'list'));
    await settle();
    assert.ok(row(root, 's-6', 'list').querySelector('.roster-issue-note'));
    assert.ok(root.querySelector('.roster-note'), 'the load failure is still said');
  });
});
