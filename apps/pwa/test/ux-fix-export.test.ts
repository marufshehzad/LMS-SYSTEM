/**
 * UX sweep — the export screen (group export).
 *
 * #/export mounts straight into the shell's view, and the shell arms
 * `keepFocusWithin` on that view for every route. These tests arm it the same
 * way, so where focus lands is what a keyboard user gets in the app.
 *
 *  - 44       pressing নামান on a row below the fold showed nothing: the
 *             result was drawn above the intro, off screen; the card pushed
 *             the list down under the finger; the error had no retry.
 *  - 60, 101  (minors) the refusal pointed an accountant, a student and a
 *             guardian at a roster page they do not have.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ExportView } from '../src/export-view.ts';
import { keepFocusWithin, focusIsLost } from '../src/ui/dom.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0)); };

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
  // The download itself: jsdom cannot navigate to a blob URL, and the file
  // name is what the tests want from it.
  dom.window.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    downloads.push(this.download);
  };
});

const downloads: string[] = [];
let stopKeeper: () => void = () => {};
beforeEach(() => {
  downloads.length = 0;
  doc().body.innerHTML = '<main id="root"></main>';
  // As shell.ts does for every route.
  stopKeeper = keepFocusWithin(root());
});
afterEach(() => { stopKeeper(); });

interface Reply { status: number; filename?: string; throws?: boolean }

/** A server the test scripts per request; `hold()` keeps the next one in flight. */
function server(replies: Reply[], role = 'it_admin') {
  const urls: string[] = [];
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  const auth = {
    role,
    authedFetch: async (url: string) => {
      urls.push(url);
      if (gate) await gate;
      const r = replies.shift() ?? { status: 500 };
      if (r.throws) throw new TypeError('Failed to fetch');
      const headers = new Headers(r.filename
        ? { 'content-disposition': `attachment; filename="${r.filename}"` } : {});
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers,
        blob: async () => new Blob(['a,b\n']),
      } as unknown as Response;
    },
  };
  return {
    auth,
    urls,
    hold() { gate = new Promise<void>((res) => { open = res; }); },
    release() { const o = open; gate = null; open = null; o?.(); },
  };
}

const mount = (s: ReturnType<typeof server>) =>
  new ExportView({ root: root(), doc: doc(), auth: s.auth as never });

const rowOf = (key: string) =>
  root().querySelector<HTMLElement>(`.export-files [data-key="${key}"]`);
const goOf = (key: string) =>
  rowOf(key)?.querySelector<HTMLButtonElement>('.ui-list-status button') ?? null;

/* ── 44: the result belongs to the row that was pressed ────────────────── */

describe('export result is drawn at the pressed row (finding 44)', () => {
  test('a failed file shows its error inside that row, not above the intro', async () => {
    const s = server([{ status: 404 }]);
    mount(s);
    goOf('audit')!.click();
    await settle();

    const err = root().querySelector<HTMLElement>('.ui-state-error');
    assert.ok(err, 'the failure is shown');
    assert.equal(err.closest('[data-key]')?.getAttribute('data-key'), 'audit',
      'the error sits in the কার্যবিবরণী row');
    // Nothing is inserted before the list any more — that is what pushed the
    // rows down under the finger.
    for (const child of Array.from(root().children)) {
      assert.ok(!child.matches('.ui-state, .ui-success-note, .export-result'),
        `a result was drawn at the top of the screen: ${child.className}`);
    }
    assert.equal(root().querySelectorAll('.ui-state-error').length, 1);
    assert.match(err.textContent ?? '', /ফাইল তৈরি করা যায়নি/);
  });

  test('a delivered file shows its note inside that row, with the server\'s file name', async () => {
    const s = server([{ status: 200, filename: 'audit-2026-09-17.csv' }]);
    mount(s);
    goOf('audit')!.click();
    await settle();

    assert.deepEqual(downloads, ['audit-2026-09-17.csv']);
    const note = root().querySelector<HTMLElement>('.ui-success-note');
    assert.ok(note, 'the success note is shown');
    assert.equal(note.closest('[data-key]')?.getAttribute('data-key'), 'audit');
    assert.match(note.textContent ?? '', /কার্যবিবরণী ফাইল নামানো হয়েছে/);
    assert.equal(note.getAttribute('aria-live'), 'polite', 'still announced');
  });

  test('pressing another file clears the old message and keeps one result on screen', async () => {
    const s = server([{ status: 404 }, { status: 200, filename: 'notices.csv' }]);
    mount(s);
    goOf('students')!.click();
    await settle();
    assert.ok(rowOf('students')!.querySelector('.ui-state-error'));

    goOf('notices')!.click();
    await settle();
    assert.equal(root().querySelectorAll('.ui-state-error').length, 0, 'the stale error is gone');
    assert.ok(rowOf('notices')!.querySelector('.ui-success-note'));
  });

  test('the error offers আবার চেষ্টা করুন, and it asks for the SAME file again', async () => {
    const s = server([{ status: 500 }, { status: 200, filename: 'audit.csv' }]);
    mount(s);
    goOf('audit')!.click();
    await settle();

    const retry = rowOf('audit')!.querySelector<HTMLButtonElement>('.ui-state-action');
    assert.ok(retry, 'the error has a retry button');
    assert.equal(retry.textContent, 'আবার চেষ্টা করুন');
    retry.click();
    await settle();

    assert.equal(s.urls.length, 2);
    assert.equal(s.urls[1], s.urls[0], 'the retry fetched the file that failed');
    assert.match(s.urls[1], /dataset=audit/);
    assert.ok(rowOf('audit')!.querySelector('.ui-success-note'));
  });

  test('a network failure also offers the retry', async () => {
    const s = server([{ status: 0, throws: true }]);
    mount(s);
    goOf('fees')!.click();
    await settle();
    const err = rowOf('fees')!.querySelector('.ui-state-error');
    assert.match(err?.textContent ?? '', /ইন্টারনেট সংযোগ/);
    assert.ok(err?.querySelector('.ui-state-action'), 'retry after a dropped connection');
  });

  test('a refusal has no retry: pressing again cannot change a 403', async () => {
    const s = server([{ status: 403 }]);
    mount(s);
    goOf('audit')!.click();
    await settle();
    const err = rowOf('audit')!.querySelector('.ui-state-error');
    assert.match(err?.textContent ?? '', /অনুমতি আপনার নেই/);
    assert.equal(err?.querySelector('.ui-state-action'), null);
  });

  test('while a file is made every নামান is disabled and only its own is busy', async () => {
    const s = server([{ status: 200, filename: 'audit.csv' }]);
    mount(s);
    s.hold();
    goOf('audit')!.click();
    await settle();
    const buttons = Array.from(root().querySelectorAll<HTMLButtonElement>('.export-files button'));
    assert.equal(buttons.length, 10);
    assert.ok(buttons.every((b) => b.disabled), 'a second press would start a second query');
    assert.equal(goOf('audit')!.getAttribute('aria-label'), 'কার্যবিবরণী — ফাইল তৈরি হচ্ছে…');
    s.release();
    await settle();
    assert.ok(Array.from(root().querySelectorAll<HTMLButtonElement>('.export-files button'))
      .every((b) => !b.disabled));
  });
});

describe('focus and scroll after a press (finding 44)', () => {
  test('focus comes back to the pressed file\'s button, not <body> or the first row', async () => {
    const s = server([{ status: 404 }]);
    mount(s);
    s.hold();
    goOf('audit')!.focus();
    goOf('audit')!.click();
    await settle();
    s.release();
    await settle();

    const a = active();
    assert.ok(!focusIsLost(doc()), `focus was lost (on ${a?.tagName})`);
    assert.equal(a?.getAttribute('data-focus-key'), 'export-audit');
    assert.equal(a?.getAttribute('aria-label'), 'কার্যবিবরণী — CSV নামান');
    assert.equal(a, goOf('audit'), 'the live button, not a detached one');
  });

  test('after আবার চেষ্টা করুন succeeds, focus is on that file\'s button, not lost', async () => {
    // Found by name, not by the row's data-key: the row identity is what this
    // test is about.
    const audit = () => root().querySelector<HTMLButtonElement>(
      'button[aria-label="কার্যবিবরণী — CSV নামান"]');
    const s = server([{ status: 500 }, { status: 200, filename: 'audit.csv' }]);
    mount(s);
    audit()!.click();
    await settle();

    const retry = root().querySelector<HTMLButtonElement>('.ui-state-action')!;
    retry.focus();
    retry.click();
    await settle();

    assert.ok(root().querySelector('.ui-success-note'), 'the second try delivered');
    assert.ok(!focusIsLost(doc()), 'the retry button vanished and took focus with it');
    assert.equal(active(), audit());
  });

  test('the pressed row is scrolled into view with its message', async () => {
    const calls: Array<{ key: string | undefined; opts: unknown }> = [];
    const proto = dom.window.Element.prototype as unknown as Record<string, unknown>;
    proto.scrollIntoView = function scrollIntoView(this: HTMLElement, opts: unknown) {
      calls.push({ key: this.dataset?.key, opts });
    };
    try {
      const s = server([{ status: 404 }]);
      mount(s);
      goOf('offboarding')!.click();
      await settle();
      assert.equal(calls.length, 1);
      assert.equal(calls[0].key, 'offboarding');
      assert.deepEqual(calls[0].opts, { block: 'nearest' },
        'nearest: no jump when the row and its message already show');
    } finally {
      delete proto.scrollIntoView;
    }
  });

  test('the pressed row does not slide when an earlier message above it is removed', async () => {
    // A small layout model: each row is 72px, each message above a row adds
    // 133px (the measured error card), and the page scrolls on the window.
    // A row drawn since the last settle is still in the shell's `rise`
    // entrance animation, which getBoundingClientRect sees as 8px lower —
    // the view must measure layout, not the animated box.
    let scrollY = 0;
    const scrolls: number[] = [];
    const settled = new WeakSet<Element>();
    const layoutTop = (node: Element) => {
      const rows = Array.from(node.ownerDocument.querySelectorAll('.export-files > li'));
      const i = rows.indexOf(node);
      if (i < 0) return 0;
      const above = Array.from(node.ownerDocument.querySelectorAll('.ui-state-error, .ui-success-note'))
        // eslint-disable-next-line no-bitwise
        .filter((m) => (m.compareDocumentPosition(node) & 4) !== 0 && !m.contains(node));
      return 300 + i * 72 + above.length * 133;
    };
    const onScreen = (key: string) => layoutTop(rowOf(key)!) - scrollY;
    const settleAll = async () => {
      await settle();
      for (const li of Array.from(root().querySelectorAll('.export-files > li'))) settled.add(li);
    };

    const proto = dom.window.HTMLElement.prototype;
    const eproto = dom.window.Element.prototype;
    const offsetTop = Object.getOwnPropertyDescriptor(proto, 'offsetTop')!;
    const rect = eproto.getBoundingClientRect;
    const win = dom.window as unknown as { scrollBy: (x: number, y: number) => void };
    const originalScrollBy = win.scrollBy;
    Object.defineProperty(proto, 'offsetTop', {
      configurable: true, get(this: Element) { return layoutTop(this); },
    });
    eproto.getBoundingClientRect = function animated(this: Element) {
      const top = layoutTop(this) - scrollY + (settled.has(this) ? 0 : 8);
      return { top, bottom: top + 72, left: 0, right: 375, width: 375, height: 72, x: 0, y: top,
        toJSON() { return this; } } as DOMRect;
    };
    win.scrollBy = (_x: number, y: number) => { scrollY += y; scrolls.push(y); };
    try {
      const s = server([{ status: 404 }, { status: 404 }]);
      mount(s);
      goOf('students')!.click();
      await settleAll();
      assert.ok(rowOf('students')!.querySelector('.ui-state-error'));

      const before = onScreen('audit');
      s.hold();
      goOf('audit')!.click();
      await settleAll();
      assert.equal(onScreen('audit'), before,
        'the busy render removed the old card and the row moved under the finger');
      s.release();
      await settleAll();
      assert.equal(onScreen('audit'), before, 'the result render moved the row');
      assert.deepEqual(scrolls, [-133], 'one correction, the height of the removed card');
    } finally {
      Object.defineProperty(proto, 'offsetTop', offsetTop);
      eproto.getBoundingClientRect = rect;
      win.scrollBy = originalScrollBy;
    }
  });

  test('a file that finishes after the person left and came back does not touch the new page', async () => {
    const calls: string[] = [];
    const proto = dom.window.Element.prototype as unknown as Record<string, unknown>;
    proto.scrollIntoView = function scrollIntoView(this: HTMLElement) {
      calls.push(this.dataset?.key ?? this.className);
    };
    try {
      const s = server([{ status: 404 }]);
      mount(s);
      s.hold();
      goOf('audit')!.click();
      await settle();

      // The shell empties its view on a route change and mounts afresh.
      root().textContent = '';
      mount(server([]));
      const page = Array.from(root().children);
      await settle();

      s.release();
      await settle();
      assert.ok(page.every((c, i) => root().children[i] === c) && root().children.length === page.length,
        'the old press redrew the page that replaced it');
      assert.equal(root().querySelector('.ui-state-error'), null, 'an old error on the new page');
      assert.deepEqual(calls, [], 'the old press scrolled the new page');
    } finally {
      delete proto.scrollIntoView;
    }
  });

  test('a press rebuilds the file rows, not the page: nothing replays its entrance', async () => {
    // Every direct child of the shell's view runs the `rise` entrance when it
    // is inserted (app.css `.shell-view > *`), so a page rebuilt on each press
    // blinked twice per file and lost the node that had focus.
    const s = server([{ status: 404 }]);
    mount(s);
    const before = Array.from(root().children);
    assert.equal(before.length, 3, 'header, intro, list');
    s.hold();
    goOf('audit')!.click();
    await settle();
    // Identity, not structure: deepEqual finds two fresh headers equal.
    const same = () => Array.from(root().children).every((c, i) => c === before[i])
      && root().children.length === before.length;
    assert.ok(same(), 'the busy render replaced the page');
    s.release();
    await settle();
    assert.ok(same(), 'the result render replaced the page');
    assert.ok(rowOf('audit')!.querySelector('.ui-state-error'), 'the rows were still redrawn');
  });

  /**
   * The foot of the page. A small layout model with what the browser does
   * there: every row is 72px, every message 133px, the list is at least its
   * min-height, the viewport is 700px, and when the page gets shorter than
   * scroll + viewport the browser pulls the scroll back (clamps it) at the
   * next layout read — which moves everything on screen down.
   */
  async function atTheFoot(run: (m: {
    onScreen: (key: string) => number;
    toFoot: () => void;
  }) => Promise<void>): Promise<void> {
    const w = dom.window as unknown as Window & { scrollBy: (x: number, y: number) => void };
    const doc = w.document;
    let stored = 0;
    const rows = () => Array.from(doc.querySelectorAll<HTMLElement>('.export-files > li'));
    const rowHeight = (li: Element) => 72 + li.querySelectorAll('.ui-state-error, .ui-success-note').length * 133;
    const listContent = () => rows().reduce((sum, li) => sum + rowHeight(li), 0);
    const maxScroll = () => {
      const ul = doc.querySelector<HTMLElement>('.export-files');
      const box = Math.max(listContent(), Number.parseFloat(ul?.style.minHeight ?? '') || 0);
      return Math.max(0, 300 + box + 100 - 700);
    };
    const scrollY = () => { stored = Math.min(stored, maxScroll()); return stored; };
    const layoutTop = (node: Element) => {
      const all = rows();
      const i = all.indexOf(node as HTMLElement);
      return i < 0 ? 0 : 300 + all.slice(0, i).reduce((sum, li) => sum + rowHeight(li), 0);
    };

    const proto = w.HTMLElement.prototype;
    const offsetTop = Object.getOwnPropertyDescriptor(proto, 'offsetTop')!;
    const offsetHeight = Object.getOwnPropertyDescriptor(proto, 'offsetHeight')!;
    const scrollYDesc = Object.getOwnPropertyDescriptor(w, 'scrollY')!;
    const originalScrollBy = w.scrollBy;
    Object.defineProperty(proto, 'offsetTop', {
      configurable: true, get(this: Element) { return layoutTop(this); },
    });
    Object.defineProperty(proto, 'offsetHeight', {
      configurable: true,
      get(this: Element) { return this.matches('.export-files') ? listContent() : 0; },
    });
    Object.defineProperty(w, 'scrollY', { configurable: true, get: scrollY });
    w.scrollBy = (_x: number, y: number) => { stored = Math.max(0, Math.min(scrollY() + y, maxScroll())); };
    try {
      await run({
        onScreen: (key) => layoutTop(rowOf(key)!) - scrollY(),
        toFoot: () => { stored = maxScroll(); },
      });
    } finally {
      Object.defineProperty(proto, 'offsetTop', offsetTop);
      Object.defineProperty(proto, 'offsetHeight', offsetHeight);
      Object.defineProperty(w, 'scrollY', scrollYDesc);
      w.scrollBy = originalScrollBy;
    }
  }

  test('at the foot, a message removed ABOVE the pressed row does not push it down', async () => {
    await atTheFoot(async ({ onScreen, toFoot }) => {
      const s = server([{ status: 404 }, { status: 404 }]);
      mount(s);
      goOf('students')!.click();
      await settle();
      toFoot();
      const before = onScreen('audit');

      s.hold();
      goOf('audit')!.click();
      await settle();
      // The browser already pulled the scroll back by the removed card; a
      // second correction by the same height put the busy button 133px lower.
      assert.equal(onScreen('audit'), before, 'the busy button left the finger');
      s.release();
      await settle();
      assert.equal(onScreen('audit'), before, 'the result moved the row');
    });
  });

  test('at the foot, a message removed BELOW the pressed row does not pull it down', async () => {
    await atTheFoot(async ({ onScreen, toFoot }) => {
      const s = server([{ status: 200, filename: 'offboarding.csv' }, { status: 404 }]);
      mount(s);
      goOf('offboarding')!.click();
      await settle();
      toFoot();
      const before = onScreen('audit');

      s.hold();
      goOf('audit')!.click();
      await settle();
      assert.equal(onScreen('audit'), before,
        'the page got shorter under the busy button and the browser pulled it down');
      s.release();
      await settle();
      assert.equal(onScreen('audit'), before);
      assert.equal(root().querySelector<HTMLElement>('.export-files')!.style.minHeight, '',
        'the list lets go of the held height once the result is drawn');
    });
  });

  test('at the foot, আবার চেষ্টা করুন keeps the busy button where it was', async () => {
    await atTheFoot(async ({ onScreen, toFoot }) => {
      const s = server([{ status: 500 }, { status: 500 }]);
      mount(s);
      goOf('audit')!.click();
      await settle();
      toFoot();
      const before = onScreen('audit');

      s.hold();
      rowOf('audit')!.querySelector<HTMLButtonElement>('.ui-state-action')!.click();
      await settle();
      assert.ok(goOf('audit')!.disabled, 'busy');
      assert.equal(onScreen('audit'), before, 'the row\'s own card went and the page pulled it down');
      s.release();
      await settle();
      assert.equal(onScreen('audit'), before);
    });
  });
});

/* ── minors 60, 101: the refusal speaks to the role reading it ─────────── */

describe('the refusal (minors 60, 101)', () => {
  for (const role of ['accountant', 'student', 'guardian']) {
    test(`${role}: no pointer to a roster page they do not have`, () => {
      mount(server([], role));
      const denied = root().querySelector('.ui-state-denied');
      assert.ok(denied, 'still refused');
      assert.match(denied.textContent ?? '', /কেবল প্রধান শিক্ষক বা আইটি অ্যাডমিন/);
      assert.doesNotMatch(denied.textContent ?? '', /রোস্টার/);
      assert.equal(root().querySelector('.export-files'), null, 'no file rows');
    });
  }

  test('a teacher is still pointed at their own roster', () => {
    mount(server([], 'teacher'));
    const denied = root().querySelector('.ui-state-denied');
    assert.match(denied?.textContent ?? '', /রোস্টার পাতায় দেখা যাবে/);
  });
});
