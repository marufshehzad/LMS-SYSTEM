/**
 * The attendance register, rendered into a real DOM (jsdom).
 *
 * These assert the things a user actually experiences: that nobody starts
 * marked, that a row tap never records anything, that every change can be
 * undone, that submit is blocked while students are unmarked and confirmed by
 * name, that saving does not await the network and sends only the students the
 * teacher marked, and that a screen-reader user gets a correct label.
 */
import { test, describe, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AttendanceView, NothingMarkedError, type OutboxLike } from '../src/attendance-view.ts';
import { route, stalecaches, dataSaverPolicy, PRECACHE, CACHE_SHELL, CACHE_DATA } from '../src/sw-router.ts';
import type { Student, AttendanceStatus } from '../../../packages/ui-core/src/attendance-grid.ts';

let dom: JSDOM;
let doc: Document;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>');
  doc = dom.window.document;
  // jsdom's KeyboardEvent etc. must be reachable from the module under test.
  (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
  (globalThis as Record<string, unknown>).KeyboardEvent = dom.window.KeyboardEvent;
});

afterEach(() => {
  // A sheet left open by one test would aria-hide the next test's register.
  for (const s of doc.querySelectorAll('.ui-scrim')) {
    (s.querySelector('.ui-dialog-close') as HTMLButtonElement | null)?.click();
    s.remove();
  }
});

const students = (n: number): Student[] =>
  Array.from({ length: n }, (_, i) => ({
    studentId: `stu_${i + 1}`,
    rollNo: i + 1,
    nameBn: `শিক্ষার্থী ${i + 1}`,
    nameEn: `Student ${i + 1}`,
  }));

/** Records what the view asked the outbox to do; can pretend to be offline. */
class FakeOutbox implements OutboxLike {
  online = true;
  enqueued: Array<{ opId: string; payload: unknown }> = [];
  flushes = 0;
  pending = 0;
  failed = 0;

  async enqueue(input: { opId?: string; payload: unknown }) {
    const opId = input.opId ?? `op_${this.enqueued.length + 1}`;
    this.enqueued.push({ opId, payload: input.payload });
    this.pending++;
    return { opId };
  }
  async flush() {
    this.flushes++;
    if (!this.online) throw new Error('Failed to fetch');
    this.pending = 0;
    return undefined;
  }
  async state() {
    return { pending: this.pending, failed: this.failed, conflicts: 0 };
  }
}

interface Payload {
  sessionId: string;
  mode: string;
  records: Array<{ studentId: string; status: AttendanceStatus }>;
}

function mount(n = 60, outbox = new FakeOutbox(), extra: { initial?: Record<string, AttendanceStatus> } = {}) {
  const root = doc.getElementById('root')!;
  let idc = 0;
  const view = new AttendanceView({
    root,
    doc,
    students: students(n),
    section: { id: 'sec_9a', labelBn: '৯-ক', academicYearId: 'yr_2026' },
    takenOn: '2026-08-06',
    subjectBn: 'পদার্থবিজ্ঞান',
    outbox,
    newId: () => `sess_${++idc}`,
    now: () => 1_760_000_000_000,
    initial: extra.initial,
  });
  return { view, root, outbox };
}

const row = (root: HTMLElement, roll: number) =>
  root.querySelector<HTMLLIElement>(`.att-row[data-student-id="stu_${roll}"]`)!;
const hit = (root: HTMLElement, roll: number) =>
  row(root, roll).querySelector<HTMLButtonElement>('.att-row-hit')!;
const opt = (root: HTMLElement, roll: number, status: string) =>
  row(root, roll).querySelector<HTMLButtonElement>(`.att-opt[data-status="${status}"]`)!;
const click = (node: Element) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
/** Open the row's switch and pick a status: the two taps a teacher makes. */
function mark(root: HTMLElement, roll: number, status: 'present' | 'absent' | 'late') {
  if (hit(root, roll).getAttribute('aria-expanded') !== 'true') click(hit(root, roll));
  click(opt(root, roll, status));
}
const act = (root: ParentNode, action: string) =>
  root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
const progressText = (root: HTMLElement) => root.querySelector('.att-progress')!.textContent ?? '';
const sheet = () => doc.querySelector<HTMLElement>('.ui-dialog.att-confirm');
const settle = () => new Promise((r) => setTimeout(r, 10));

/* -------------------------------------------------------------------- */

describe('rendering — nobody starts marked', () => {
  test('renders one row per student, in roll order, every one unset', () => {
    const { root } = mount(60);
    const rows = root.querySelectorAll('.att-row');
    assert.equal(rows.length, 60);
    assert.equal(rows[0].getAttribute('data-student-id'), 'stu_1');
    assert.equal(rows[59].getAttribute('data-student-id'), 'stu_60');
    assert.equal(root.querySelectorAll('.att-row[data-status="unset"]').length, 60,
      'the grid defaults to present internally; the teacher must never see that');
    assert.equal(root.querySelectorAll('.att-opt[aria-pressed="true"]').length, 0);
    assert.ok(row(root, 1).textContent!.includes('চিহ্নিত হয়নি'));
  });

  test('rows show the roll as a Latin identifier AND the name', () => {
    const { root } = mount(3);
    assert.equal(row(root, 1).querySelector('.att-roll')!.textContent, '1');
    assert.equal(row(root, 3).querySelector('.att-roll')!.textContent, '3');
    assert.equal(row(root, 1).querySelector('.att-name')!.textContent, 'শিক্ষার্থী 1',
      'a title attribute is not a name a teacher can scan');
  });

  test('header carries section, subject and a localised date', () => {
    const { root } = mount(2);
    const sub = root.querySelector('.att-sub')!.textContent!;
    assert.ok(sub.includes('৯-ক'));
    assert.ok(sub.includes('পদার্থবিজ্ঞান'));
    assert.ok(sub.includes('৬ আগস্ট'), `date missing from "${sub}"`);
  });

  test('the tally starts at zero marked, never the class size, and is announced politely', () => {
    const { root } = mount(10);
    const p = root.querySelector('.att-progress')!;
    assert.equal(p.getAttribute('aria-live'), 'polite');
    assert.ok(progressText(root).includes('০ / ১০ জন চিহ্নিত — ১০ জন বাকি'), progressText(root));
    click(act(root, 'mark-all')!);
    assert.ok(progressText(root).includes('সবাই চিহ্নিত · ০ জন ব্যতিক্রম'), progressText(root));
  });

  test('root carries lang so screen readers pick Bangla phonemes', () => {
    const { root } = mount(1);
    assert.equal(root.getAttribute('lang'), 'bn');
  });

  test('draft restore: marked students come back marked, everyone else unset', async () => {
    // Save a partial register, then rebuild from the queued payload.
    const first = mount(5);
    mark(first.root, 2, 'absent');
    mark(first.root, 4, 'late');
    await first.view.save();
    const sent = first.outbox.enqueued[0].payload as Payload;
    const initial = Object.fromEntries(sent.records.map((r) => [r.studentId, r.status]));

    const again = mount(5, new FakeOutbox(), { initial });
    assert.equal(row(again.root, 2).dataset.status, 'absent');
    assert.equal(row(again.root, 4).dataset.status, 'late');
    for (const r of [1, 3, 5]) assert.equal(row(again.root, r).dataset.status, 'unset');
    assert.equal(opt(again.root, 2, 'absent').getAttribute('aria-pressed'), 'true');

    // And the round trip is exact: re-saving sends the same records.
    await again.view.save();
    const resent = again.outbox.enqueued[0].payload as Payload;
    assert.deepEqual(resent.records, sent.records);
  });
});

describe('marking — three discrete targets, no cycle', () => {
  test('a row tap only opens the switch; a choice sets the status', () => {
    const { root, view } = mount(5);
    const h = hit(root, 2);

    click(h);
    assert.equal(h.getAttribute('aria-expanded'), 'true');
    assert.equal(row(root, 2).dataset.status, 'unset', 'a row tap never records anything');
    click(h);
    assert.equal(h.getAttribute('aria-expanded'), 'false');
    assert.equal(row(root, 2).dataset.status, 'unset');

    click(h);
    click(opt(root, 2, 'absent'));
    assert.equal(row(root, 2).dataset.status, 'absent');
    assert.equal(opt(root, 2, 'absent').getAttribute('aria-pressed'), 'true');
    assert.equal(opt(root, 2, 'present').getAttribute('aria-pressed'), 'false');
    assert.equal(h.getAttribute('aria-label'), 'রোল 2, শিক্ষার্থী 2, অনুপস্থিত');
    assert.ok(row(root, 2).textContent!.includes('আসেনি'));
    assert.ok(progressText(root).includes('১ / ৫'), progressText(root));

    // Re-tapping the pressed option is a true no-op.
    const before = JSON.stringify(view.state);
    const toastBefore = root.querySelector('.att-undo')!.textContent;
    click(h);
    click(opt(root, 2, 'absent'));
    assert.equal(row(root, 2).dataset.status, 'absent');
    assert.equal(root.querySelector('.att-undo')!.textContent, toastBefore);
    assert.equal(JSON.stringify(view.state), before);
    assert.equal(h.getAttribute('aria-expanded'), 'true', 'the row stays open');

    click(opt(root, 2, 'late'));
    assert.equal(row(root, 2).dataset.status, 'late');
  });

  test('opening one row closes the previously open row', () => {
    const { root } = mount(3);
    click(hit(root, 1));
    click(hit(root, 2));
    assert.equal(hit(root, 1).getAttribute('aria-expanded'), 'false');
    assert.equal(row(root, 1).querySelector<HTMLElement>('.att-switch')!.hidden, true);
    assert.equal(hit(root, 2).getAttribute('aria-expanded'), 'true');
  });

  test('the aria-label always states the status in words, not just colour', () => {
    const { root } = mount(3);
    assert.ok(hit(root, 1).getAttribute('aria-label')!.endsWith('চিহ্নিত হয়নি'));
    mark(root, 1, 'absent');
    assert.ok(hit(root, 1).getAttribute('aria-label')!.endsWith('অনুপস্থিত'),
      'colour is never the only signal');
  });

  test('"all present" marks everyone, and its undo restores exceptions AND unset', () => {
    const { root } = mount(6);
    mark(root, 1, 'absent');
    mark(root, 4, 'absent');
    assert.equal(root.querySelectorAll('.att-row[data-status="absent"]').length, 2);

    const bulk = act(root, 'mark-all')!;
    assert.equal(bulk.textContent, '৬ জনকে উপস্থিত ধরুন');
    click(bulk);
    assert.equal(root.querySelectorAll('.att-row[data-status="present"]').length, 6);
    const undo = root.querySelector<HTMLElement>('.att-undo')!;
    assert.equal(undo.hidden, false);
    assert.match(undo.textContent!, /৬ জনকে উপস্থিত ধরা হয়েছে — ২ জনের আগের চিহ্ন বদলে উপস্থিত হয়েছে/);
    // The overwrite clause must be SEEN, not cut off: it lives in its own
    // wrapping line, never inside the ellipsised name line.
    assert.equal(undo.dataset.kind, 'bulk');
    const nameLine = undo.querySelector('.att-undo-name')!;
    assert.equal(nameLine.textContent, '৬ জনকে উপস্থিত ধরা হয়েছে');
    const detail = undo.querySelector('.att-undo-detail');
    assert.ok(detail, 'the overwrite clause has its own element');
    assert.ok(!nameLine.contains(detail));
    assert.match(detail!.textContent!, /২ জনের আগের চিহ্ন বদলে উপস্থিত হয়েছে/);
    assert.equal(bulk.getAttribute('aria-disabled'), 'true', 'with everyone marked it can only erase exceptions');

    [...undo.querySelectorAll('button')].find((b) => b.textContent === 'ফিরিয়ে নিন')!.click();
    assert.equal(row(root, 1).dataset.status, 'absent');
    assert.equal(row(root, 4).dataset.status, 'absent');
    for (const r of [2, 3, 5, 6]) assert.equal(row(root, r).dataset.status, 'unset');
    assert.equal(undo.hidden, true);
    assert.equal(bulk.hasAttribute('aria-disabled'), false);
    assert.equal(doc.activeElement, bulk, 'bulk undo returns focus to the bulk button');
  });

  test('an aria-disabled bulk press changes nothing', () => {
    const { root, view } = mount(3);
    click(act(root, 'mark-all')!);
    mark(root, 2, 'late');
    const before = JSON.stringify(view.state.entries);
    click(act(root, 'mark-all')!);
    assert.equal(JSON.stringify(view.state.entries), before, 'the late mark survived');
  });
});

describe('keyboard accessibility', () => {
  test('rows are buttons that expose a labelled three-button switch', () => {
    const { root } = mount(4);
    const list = root.querySelector('ul.att-list')!;
    assert.ok(list.getAttribute('aria-label'));
    const h = hit(root, 1);
    assert.equal(h.tagName, 'BUTTON');
    assert.equal(h.getAttribute('aria-expanded'), 'false');
    const sw = row(root, 1).querySelector('.att-switch')!;
    assert.equal(h.getAttribute('aria-controls'), sw.id);
    assert.equal(sw.getAttribute('role'), 'group');
    assert.ok(sw.getAttribute('aria-label'));
    const opts = sw.querySelectorAll('.att-opt');
    assert.equal(opts.length, 3, 'four statuses, three tap targets');
    for (const o of opts) assert.ok(o.hasAttribute('aria-pressed'));
    assert.equal(sw.querySelector('[data-status="excused"]'), null);
  });

  test('space opens the switch without scrolling, and records nothing', () => {
    const { root } = mount(3);
    const h = hit(root, 2);
    const ev = new dom.window.KeyboardEvent('keydown', { key: ' ', cancelable: true });
    h.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true, 'space must not scroll');
    assert.equal(h.getAttribute('aria-expanded'), 'true');
    assert.equal(row(root, 2).dataset.status, 'unset');
  });

  test('escape inside a switch closes it and returns focus to the row', () => {
    const { root } = mount(3);
    click(hit(root, 2));
    opt(root, 2, 'late').focus();
    opt(root, 2, 'late').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(hit(root, 2).getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement, hit(root, 2));
  });

  test('arrow keys move focus down the list', () => {
    const { root } = mount(12);
    hit(root, 1).focus();
    hit(root, 1).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    assert.equal(doc.activeElement, hit(root, 2), 'down = +1');
    hit(root, 2).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
    assert.equal(doc.activeElement, hit(root, 3));
    hit(root, 3).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', cancelable: true }));
    assert.equal(doc.activeElement, hit(root, 12));
  });

  test('focus moved to a row scrolls it clear of the sticky footer and toast (2.4.11)', () => {
    const { root } = mount(6);
    const proto = dom.window.HTMLElement.prototype as { scrollIntoView?: (o?: unknown) => void };
    const had = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView');
    const prev = proto.scrollIntoView;
    const calls: { id: string | undefined; opts: unknown }[] = [];
    proto.scrollIntoView = function (this: HTMLElement, o?: unknown) {
      calls.push({ id: this.dataset.studentId, opts: o });
    };
    const focusOpts: unknown[] = [];
    const origFocus = hit(root, 2).focus.bind(hit(root, 2));
    hit(root, 2).focus = (o?: FocusOptions) => { focusOpts.push(o); origFocus(o); };
    try {
      hit(root, 1).focus();
      hit(root, 1).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
      assert.equal(doc.activeElement, hit(root, 2));
      assert.deepEqual(calls.at(-1), { id: 'stu_2', opts: { block: 'nearest' } },
        'arrow focus scrolls the target row so scroll-padding applies');
      assert.deepEqual(focusOpts.at(-1), { preventScroll: true });

      calls.length = 0;
      mark(root, 4, 'absent');
      assert.deepEqual(calls.at(-1), { id: 'stu_4', opts: { block: 'nearest' } }, 'choose scrolls its row');

      calls.length = 0;
      hit(root, 4).focus();
      [...root.querySelectorAll<HTMLButtonElement>('.att-undo button')]
        .find((x) => x.textContent === 'ফিরিয়ে নিন')!.click();
      assert.equal(doc.activeElement, hit(root, 4));
      assert.deepEqual(calls.at(-1), { id: 'stu_4', opts: { block: 'nearest' } }, 'undo scrolls its row');
    } finally {
      if (had) proto.scrollIntoView = prev; else delete proto.scrollIntoView;
    }
  });

  test('focus movement stops at the edges instead of wrapping', () => {
    const { root } = mount(4);
    hit(root, 1).focus();
    hit(root, 1).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    assert.equal(doc.activeElement, hit(root, 1), 'no wrap-around');
    hit(root, 1).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
    assert.equal(doc.activeElement, hit(root, 1));
  });

  test('choosing a status returns focus to that row', () => {
    const { root } = mount(3);
    mark(root, 3, 'absent');
    assert.equal(doc.activeElement, hit(root, 3));
  });
});

describe('guard 2 — every change can be undone', () => {
  test('a mark names the student and the new state, and undo returns it to unset', () => {
    const { root, view } = mount(5);
    mark(root, 2, 'absent');
    assert.equal(view.state.dirty, true);
    const undo = root.querySelector<HTMLElement>('.att-undo')!;
    assert.equal(undo.getAttribute('role'), 'status');
    assert.equal(undo.hidden, false);
    assert.match(undo.textContent!, /শিক্ষার্থী 2 — আসেনি/);
    assert.match(undo.textContent!, /৫ সেকেন্ড/);
    assert.equal(undo.querySelector('.att-undo-time')!.getAttribute('aria-hidden'), 'true',
      'the countdown ticks are not announced');

    [...undo.querySelectorAll('button')].find((b) => b.textContent === 'ফিরিয়ে নিন')!.click();
    assert.equal(row(root, 2).dataset.status, 'unset', 'a first mark undoes to unset, not present');
    assert.equal(doc.activeElement, hit(root, 2));
    assert.equal(undo.hidden, true);
  });

  test('the window closes after five seconds, and pauses while the toast has focus', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const seconds = (n: number) => { for (let i = 0; i < n; i++) mock.timers.tick(1000); };
    try {
      const { root, view } = mount(3);
      mark(root, 1, 'late');
      const undo = root.querySelector<HTMLElement>('.att-undo')!;
      seconds(2);
      assert.match(undo.textContent!, /৩ সেকেন্ড/);

      // WCAG 2.2.1: a teacher reaching for the button is not timed out.
      undo.querySelector('button')!.focus();
      seconds(10);
      assert.equal(undo.hidden, false);
      assert.match(undo.textContent!, /৩ সেকেন্ড/);

      hit(root, 2).focus();
      seconds(3);
      assert.equal(undo.hidden, true, 'resumes on leave, then closes');
      assert.equal(row(root, 1).dataset.status, 'late', 'expiry keeps the change');
      assert.equal(view.state.dirty, true);
    } finally {
      mock.timers.reset();
    }
  });

  test('keyboard: a bulk press made with the keyboard can be undone after any wait, with Ctrl+Z', () => {
    // The undo button sits after every row. A keyboard user whose focus stays
    // on the bulk button is T+1 Tab stops from it, so the window must not
    // expire on them, and there must be a way that does not need Tab at all.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { root } = mount(6);
      mark(root, 2, 'absent');
      const bulk = act(root, 'mark-all')!;
      bulk.focus();
      bulk.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 0 }));
      assert.equal(root.querySelectorAll('.att-row[data-status="present"]').length, 6);
      const undo = root.querySelector<HTMLElement>('.att-undo')!;
      assert.equal(undo.dataset.expires, 'false');
      for (let i = 0; i < 30; i++) mock.timers.tick(1000);
      assert.equal(undo.hidden, false, 'a keyboard change is not timed out');
      assert.equal(doc.activeElement, bulk);
      const btn = undo.querySelector('.att-undo-btn')!;
      assert.equal(btn.getAttribute('aria-keyshortcuts'), 'Control+Z Meta+Z');
      assert.match(undo.textContent!, /ফিরিয়ে নিতে Ctrl\+Z চাপুন/, 'the shortcut is in the accessible text');

      const ev = new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
      bulk.dispatchEvent(ev);
      assert.equal(ev.defaultPrevented, true);
      assert.equal(row(root, 2).dataset.status, 'absent');
      for (const r of [1, 3, 4, 5, 6]) assert.equal(row(root, r).dataset.status, 'unset');
      assert.equal(undo.hidden, true);
      assert.equal(doc.activeElement, bulk);
    } finally {
      mock.timers.reset();
    }
  });

  test('keyboard: a status chosen with the keyboard is undone with Ctrl+Z from its row', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { root } = mount(4);
      click(hit(root, 3));
      opt(root, 3, 'late').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 0 }));
      assert.equal(doc.activeElement, hit(root, 3));
      for (let i = 0; i < 10; i++) mock.timers.tick(1000);
      assert.equal(root.querySelector<HTMLElement>('.att-undo')!.hidden, false);
      hit(root, 3).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Z', metaKey: true, bubbles: true, cancelable: true }));
      assert.equal(row(root, 3).dataset.status, 'unset');
      assert.equal(doc.activeElement, hit(root, 3));
    } finally {
      mock.timers.reset();
    }
  });

  test('Ctrl+Z also works for a pointer change, and does nothing with no change pending', () => {
    const { root } = mount(3);
    const idle = new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    hit(root, 1).dispatchEvent(idle);
    assert.equal(idle.defaultPrevented, false, 'no change pending: the key is left alone');
    mark(root, 1, 'absent');
    assert.equal(root.querySelector<HTMLElement>('.att-undo')!.dataset.expires, 'true');
    hit(root, 1).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(row(root, 1).dataset.status, 'unset');
  });

  test('a new change replaces the toast; only the latest change is undone', () => {
    const { root } = mount(5);
    mark(root, 1, 'absent');
    mark(root, 3, 'late');
    const undo = root.querySelector<HTMLElement>('.att-undo')!;
    assert.match(undo.textContent!, /শিক্ষার্থী 3 — দেরি/);
    assert.doesNotMatch(undo.textContent!, /শিক্ষার্থী 1/);
    [...undo.querySelectorAll('button')].find((b) => b.textContent === 'ফিরিয়ে নিন')!.click();
    assert.equal(row(root, 3).dataset.status, 'unset');
    assert.equal(row(root, 1).dataset.status, 'absent');
  });
});

describe('guard 1 — unmarked students block submit', () => {
  test('review with students unmarked raises the guard and opens no sheet', () => {
    const { root } = mount(5);
    mark(root, 1, 'absent');
    mark(root, 2, 'present');
    mark(root, 3, 'present');
    const footer = root.querySelector<HTMLElement>('.att-footer')!;
    assert.equal(footer.dataset.state, 'ready', 'no warning from the first frame');

    click(act(root, 'review')!);
    assert.equal(sheet(), null, 'the sheet never opens while students are unmarked');
    assert.equal(footer.dataset.state, 'blocked');
    assert.match(footer.textContent!, /২ জনকে এখনো চিহ্নিত করা হয়নি — খালি রেখে জমা দিলে তারা কোনো হিসাবেই থাকবে না।/);
    assert.equal(root.querySelector('.att-progress')!.getAttribute('data-tone'), 'warn');
    assert.ok(progressText(root).includes('৩ / ৫ জন চিহ্নিত — ২ জন বাকি'));
    const go = act(root, 'next-unmarked')!;
    assert.equal(go.textContent, 'বাকি ২ জনে যান');
    assert.equal(doc.activeElement, go);
    assert.ok(act(root, 'submit-anyway'), 'the quiet escape exists once someone is marked');

    click(go);
    assert.equal(hit(root, 4).getAttribute('aria-expanded'), 'true');
    assert.equal(doc.activeElement, opt(root, 4, 'present'), 'focus lands on the first unmarked row');

    click(opt(root, 4, 'present'));
    assert.equal(act(root, 'next-unmarked')!.textContent, 'বাকি ১ জনে যান', 'numbers update live');
    mark(root, 5, 'late');
    assert.equal(footer.dataset.state, 'ready', 'with nobody unmarked the footer returns to ready');
    assert.ok(act(root, 'review'));
  });

  test('"তবুও জমা" is not offered while nobody is marked', () => {
    const { root, outbox } = mount(4);
    click(act(root, 'review')!);
    assert.equal(root.querySelector<HTMLElement>('.att-footer')!.dataset.state, 'blocked');
    assert.equal(act(root, 'submit-anyway'), null);
    assert.equal(sheet(), null);
    assert.equal(outbox.enqueued.length, 0);
  });
});

describe('guard 3 — confirm by name before submit', () => {
  test('the sheet names absentees and late arrivals, states the SMS, and submits once', async () => {
    const { root, outbox } = mount(8);
    click(act(root, 'mark-all')!);
    mark(root, 2, 'absent');
    mark(root, 5, 'absent');
    mark(root, 7, 'late');
    click(act(root, 'review')!);

    const s = sheet()!;
    assert.ok(s, 'review with everyone marked opens the sheet');
    assert.equal(outbox.enqueued.length, 0, 'opening the sheet enqueues nothing');
    assert.match(s.textContent!, /জমা দেওয়ার আগে দেখুন/);
    assert.match(s.querySelector('.att-confirm-sub')!.textContent!, /৯-ক · পদার্থবিজ্ঞান · ৬ আগস্ট/);
    assert.match(s.textContent!, /৫ জন উপস্থিত/);
    assert.match(s.textContent!, /২ জন আসেনি/);
    assert.match(s.textContent!, /১ জন দেরিতে/);
    const names = [...s.querySelectorAll('.att-confirm-name')].map((n) => n.textContent);
    assert.deepEqual(names, ['শিক্ষার্থী 2', 'শিক্ষার্থী 5', 'শিক্ষার্থী 7']);
    assert.equal(s.querySelectorAll('.att-confirm-change').length, 3);
    // Tabbing through the last check before an unrecallable SMS: each change
    // button says roll, name AND the state being confirmed.
    assert.deepEqual([...s.querySelectorAll('.att-confirm-change')].map((b) => b.getAttribute('aria-label')),
      ['রোল 2, শিক্ষার্থী 2, আসেনি — বদলান', 'রোল 5, শিক্ষার্থী 5, আসেনি — বদলান',
       'রোল 7, শিক্ষার্থী 7, দেরি — বদলান']);
    // The groups are headings in code, and each list is named by its heading.
    for (const ul of s.querySelectorAll('.att-confirm-list')) {
      const head = doc.getElementById(ul.getAttribute('aria-labelledby') ?? '');
      assert.equal(head?.localName, 'h3', 'a real heading names the group');
    }
    // Focus on জমা দিন reads what it does, including the SMS count.
    const described = (act(s, 'save')!.getAttribute('aria-describedby') ?? '')
      .split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? '').join(' ');
    assert.match(described, /৫ জন উপস্থিত/);
    assert.match(described, /৩ জন শিক্ষার্থীর অভিভাবকের কাছে এসএমএস যাবে/);
    assert.match(s.querySelector('.att-confirm-sms')!.textContent!, /৩ জন শিক্ষার্থীর অভিভাবকের কাছে এসএমএস যাবে/,
      'absent + late: the server texts guardians for both');
    assert.equal(doc.activeElement, s.querySelector('.ui-dialog-close'),
      'initial focus is the close button, so a habitual Enter never submits');

    const save = act(s, 'save')!;
    click(save); click(save); click(save);
    await settle();
    assert.equal(outbox.enqueued.length, 1, 'one register, however many taps');
    assert.equal(sheet(), null, 'the sheet closes on success');
  });

  test('"বদলান" closes the sheet and focuses that student\'s pressed option', () => {
    const { root, outbox } = mount(3);
    click(act(root, 'mark-all')!);
    mark(root, 2, 'absent');
    click(act(root, 'review')!);
    click(sheet()!.querySelector('.att-confirm-change')!);
    assert.equal(sheet(), null);
    assert.equal(hit(root, 2).getAttribute('aria-expanded'), 'true');
    assert.equal(doc.activeElement, opt(root, 2, 'absent'));
    assert.equal(outbox.enqueued.length, 0);
  });

  test('a failed save is said inside the sheet, and focus stays in it', async () => {
    const outbox = new FakeOutbox();
    outbox.enqueue = async () => { throw new Error('IndexedDB refused'); };
    const { root } = mount(3, outbox);
    click(act(root, 'mark-all')!);
    click(act(root, 'review')!);
    const s = sheet()!;
    const alert = s.querySelector('[role="alert"]')!;
    assert.equal(alert.textContent, '', 'the alert region exists, empty, before anything fails');
    const save = act(s, 'save')!;
    save.focus();
    const err = console.error;
    console.error = () => {};
    try {
      click(save);
      await settle();
    } finally {
      console.error = err;
    }
    assert.equal(sheet(), s, 'the sheet stays open');
    assert.match(alert.textContent!, /হাজিরা সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।/);
    assert.equal(save.disabled, false);
    assert.equal(doc.activeElement, save, 'focus is back on "জমা দিন", not on the hidden page');
    assert.equal(row(root, 1).dataset.status, 'present', 'the marks stay');
  });

  test('a successful save closes the sheet first, then announces outside any aria-hidden subtree', async () => {
    const { root } = mount(2);
    click(act(root, 'mark-all')!);
    click(act(root, 'review')!);
    click(act(sheet()!, 'save')!);
    await settle();
    assert.equal(sheet(), null);
    const said = [...doc.querySelectorAll('.ui-toast-host .ui-sr-only')]
      .find((n) => /হাজিরা এই যন্ত্রে সংরক্ষিত/.test(n.textContent ?? ''));
    assert.ok(said, 'the result is announced');
    assert.equal(said!.closest('[aria-hidden="true"]'), null);
  });

  test('"ফিরে যান" closes the sheet and sends nothing', () => {
    const { root, outbox } = mount(2);
    click(act(root, 'mark-all')!);
    click(act(root, 'review')!);
    assert.equal(sheet()!.querySelector('.att-confirm-sms'), null, 'no SMS strip when nobody is absent or late');
    [...sheet()!.querySelectorAll('button')].find((b) => b.textContent === 'ফিরে যান')!.click();
    assert.equal(sheet(), null);
    assert.equal(outbox.enqueued.length, 0);
  });

  test('"তবুও জমা" lists the unmarked by name and sends only the marked', async () => {
    const { root, outbox } = mount(5);
    mark(root, 1, 'present');
    mark(root, 3, 'absent');
    click(act(root, 'review')!);
    click(act(root, 'submit-anyway')!);

    const s = sheet()!;
    assert.ok(s, '"তবুও জমা" opens the sheet, it never saves directly');
    assert.equal(outbox.enqueued.length, 0);
    assert.match(s.textContent!, /৩ জন চিহ্নিত হয়নি — এদের হাজিরা জমা হবে না/);
    const names = [...s.querySelectorAll('.att-confirm-name')].map((n) => n.textContent);
    assert.deepEqual(names, ['শিক্ষার্থী 3', 'শিক্ষার্থী 2', 'শিক্ষার্থী 4', 'শিক্ষার্থী 5']);

    click(act(s, 'save')!);
    await settle();
    assert.equal(outbox.enqueued.length, 1);
    const p = outbox.enqueued[0].payload as Payload;
    assert.deepEqual(p.records, [
      { studentId: 'stu_1', status: 'present' },
      { studentId: 'stu_3', status: 'absent' },
    ], 'unmarked students are omitted: no default present, no default absent');
  });
});

describe('saving — the UI never awaits the network', () => {
  test('save enqueues one op for the register', async () => {
    const { view, outbox, root } = mount(60);
    click(act(root, 'mark-all')!);
    const res = await view.save();

    assert.equal(outbox.enqueued.length, 1, 'one op per register, not 60');
    assert.equal(res.queued, true);
    const payload = outbox.enqueued[0].payload as Payload;
    assert.equal(payload.records.length, 60);
    assert.equal(payload.mode, 'section_daily');
    assert.equal(payload.sessionId, res.opId, 'op id IS the session id');
  });

  test('a partial register sends exactly the marked students, in roll order', async () => {
    const { view, outbox, root } = mount(10);
    mark(root, 7, 'late');
    mark(root, 2, 'absent');
    mark(root, 4, 'present');
    await view.save();
    const payload = outbox.enqueued[0].payload as Payload;
    assert.deepEqual(payload.records.map((r) => r.studentId), ['stu_2', 'stu_4', 'stu_7']);
    assert.deepEqual(payload.records.map((r) => r.status), ['absent', 'present', 'late']);
  });

  test('save with nobody marked rejects and enqueues nothing', async () => {
    const { view, outbox } = mount(5);
    await assert.rejects(() => view.save(), (err) => err instanceof NothingMarkedError);
    assert.equal(outbox.enqueued.length, 0, 'an empty register would count as taken');
  });

  test('save succeeds with the network down and shows queued state', async () => {
    const outbox = new FakeOutbox();
    outbox.online = false;
    const { view, root } = mount(30, outbox);

    mark(root, 5, 'absent');
    const res = await view.save();          // must not throw

    assert.equal(res.queued, true);
    assert.equal(outbox.enqueued.length, 1, 'work is durable locally');
    const chip = root.querySelector('.sync-chip')!;
    assert.equal(chip.getAttribute('data-state'), 'queued');
    assert.ok(chip.textContent!.includes('অপেক্ষমাণ'));
  });

  test('a flush rejection never surfaces as an unhandled rejection', async () => {
    const outbox = new FakeOutbox();
    outbox.online = false;
    const { view, root } = mount(5, outbox);
    click(act(root, 'mark-all')!);
    let unhandled: unknown = null;
    const onUnhandled = (e: unknown) => { unhandled = e; };
    process.on('unhandledRejection', onUnhandled);
    await view.save();
    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', onUnhandled);
    assert.equal(unhandled, null, 'offline is a normal state, not an error');
  });

  test('the chip reports failures distinctly from queued work', async () => {
    const outbox = new FakeOutbox();
    const { view, root } = mount(5, outbox);
    outbox.failed = 2;
    await view.paintChip();
    const chip = root.querySelector('.sync-chip')!;
    assert.equal(chip.getAttribute('data-state'), 'failed');
    assert.ok(chip.textContent!.includes('পাঠানো যায়নি'));
  });

  test('saving marks the grid clean and closes the undo window', async () => {
    const { view, root } = mount(5);
    mark(root, 2, 'absent');
    assert.equal(view.state.dirty, true);
    const undo = root.querySelector<HTMLElement>('.att-undo')!;
    assert.equal(undo.hidden, false, 'every change is undoable before save');
    assert.match(undo.textContent!, /ফিরিয়ে নিন/);
    await view.save();
    assert.equal(view.state.dirty, false);
    assert.equal(undo.hidden, true, 'markSaved clears the undo stack, so the toast goes too');
    assert.equal(row(root, 2).dataset.status, 'absent', 'rows still show what was sent');
  });
});

/* ---------------------------------------------------- service worker */

describe('service-worker routing policy', () => {
  test('mutations and authoritative reads are never cached', () => {
    assert.equal(route({ url: 'https://a.bd/api/v1/sync/push', method: 'POST' }).strategy, 'network-only');
    assert.equal(route({ url: 'https://a.bd/api/v1/sync/pull', method: 'GET' }).strategy, 'network-only');
    assert.equal(route({ url: 'https://a.bd/api/v1/ai/chat', method: 'GET' }).strategy, 'network-only');
    assert.equal(route({ url: 'https://a.bd/api/v1/finance/payments', method: 'GET' }).strategy, 'network-only');
    // P9-7. The review a head publishes from. A cached one would show last
    // week's conflict count and last week's fingerprint — and the fingerprint
    // is what decides whether the routine being approved is the one on
    // screen, so a stale copy turns the concurrency check into a formality.
    const pub = route({ url: 'https://a.bd/api/v1/rms/publish?yearId=x', method: 'GET' });
    assert.equal(pub.strategy, 'network-only');
    // B-104's tenant partitioning applies to what is STORED, and this is
    // stored nowhere — the stronger guarantee, not a weaker one.
    assert.equal(pub.cache, undefined);
    assert.equal(pub.tenantScoped, undefined);
  });

  test('P9-8 — the published timetable is readable offline, and partitioned', () => {
    // A published routine is the reference data the offline story exists for:
    // a teacher checking the week in a corridor on a dead link is the case.
    // It falls into the existing /api/v1/rms/ branch rather than getting its
    // own rule — and it must be tenant-scoped, because two schools on one
    // device share this origin (B-104).
    const t = route({ url: 'https://a.bd/api/v1/rms/timetable?scope=institution', method: 'GET' });
    assert.equal(t.strategy, 'stale-while-revalidate');
    assert.equal(t.cache, CACHE_DATA);
    assert.equal(t.tenantScoped, true);
  });

  test('B-109 — the demo bundle is versioned like an entry, and never precached', () => {
    // `/demo.js` has no content hash, so IMMUTABLE would match it on its
    // extension alone and pin a demo visitor to the first build their browser
    // downloaded — the `/platform.js` defect, in a second place.
    const d = route({ url: 'https://a.bd/demo.js', method: 'GET' });
    assert.equal(d.strategy, 'stale-while-revalidate');
    assert.equal(d.cache, CACHE_SHELL);
    // And it stays off every school's device: precaching it would put the
    // 94 kB the split removed back by another route.
    assert.equal(PRECACHE.includes('/demo.js'), false);
    assert.equal(PRECACHE.includes('/app.js'), true, 'the real entry still is');
  });

  test('navigations fall back to the app shell so a cold offline start works', () => {
    // R-1-A: the application lives at /app. The worker's scope is still "/"
    // (it is registered from /app.html and must control /app.js), so it also
    // sees the marketing site — which must NOT be answered with the app.
    const r = route({ url: 'https://a.bd/app', method: 'GET', mode: 'navigate' });
    assert.equal(r.strategy, 'app-shell');
    assert.equal(r.cache, CACHE_SHELL);

    assert.equal(route({ url: 'https://a.bd/', method: 'GET', mode: 'navigate' }).strategy,
      'network-only', 'the marketing site must never be served the app shell');
  });

  test('content-hashed assets are cache-first; reference data is SWR', () => {
    assert.equal(route({ url: 'https://a.bd/_next/static/x.js', method: 'GET' }).strategy, 'cache-first');
    assert.equal(route({ url: 'https://a.bd/fonts/noto-bengali-subset.woff2', method: 'GET' }).strategy, 'cache-first');
    assert.equal(route({ url: 'https://a.bd/api/v1/rms/teachers/1/day', method: 'GET' }).strategy, 'stale-while-revalidate');
  });

  test('the operations console is never served from a cache', () => {
    // P7. The SW's scope is the origin, so it controls /platform as well —
    // and /platform.js used to match IMMUTABLE on its extension alone, which
    // pinned an operator to the first console build they ever downloaded.
    // A console that suspends schools must not be one deploy behind.
    for (const u of ['/platform', '/platform.js', '/platform.css', '/platform.html']) {
      assert.equal(route({ url: `https://a.bd${u}`, method: 'GET' }).strategy, 'network-only', u);
    }
    // Including as a navigation: the app-shell fallback must not answer it.
    assert.equal(
      route({ url: 'https://a.bd/platform', method: 'GET', mode: 'navigate' }).strategy,
      'network-only');
    // The tenant app is unaffected — it still gets its offline story.
    assert.equal(route({ url: 'https://a.bd/app.js', method: 'GET' }).strategy,
      'stale-while-revalidate');
  });

  test('media is cache-first with a 7-day TTL', () => {
    const r = route({ url: 'https://a.bd/media/script.jpg', method: 'GET' });
    assert.equal(r.strategy, 'cache-first-ttl');
    assert.equal(r.ttlSeconds, 7 * 24 * 3600);
  });

  test('precache stays small — it decides cold first paint on 2G', () => {
    assert.ok(PRECACHE.length <= 8, `precache has ${PRECACHE.length} entries`);
    assert.ok(PRECACHE.includes('/offline'));
    // Every precache entry must be a file that actually ships — a 404 here
    // used to abort SW install entirely (the once-listed .woff2 subset was
    // never built; Bangla renders from the device's system font instead).
    assert.ok(!PRECACHE.some((p) => p.includes('woff2')), 'no phantom font files in precache');
    assert.ok(PRECACHE.includes('/icons/icon.svg'), 'the app icon is precached');
  });

  test('old deploy caches are pruned, foreign caches are left alone', () => {
    // v1 is now stale too: R-1-A bumped the shell cache to v2 precisely so
    // returning devices drop the cache that held "/" as the app shell and a
    // never-revalidated app.js. Another app's caches are still untouched.
    const stale = stalecaches(['shikhon-shell-v0', 'shikhon-shell-v1', 'shikhon-media-v1', 'other-app-v3']);
    assert.deepEqual(stale, ['shikhon-shell-v0', 'shikhon-shell-v1']);
    assert.ok(!stale.includes('other-app-v3'));
  });
});

describe('data-saver policy', () => {
  test('2G or saveData drops avatars, lowers quality and lengthens the sync interval', () => {
    const p = dataSaverPolicy({ effectiveType: '2g' });
    assert.equal(p.lite, true);
    assert.equal(p.loadAvatars, false);
    assert.equal(p.imageQuality, 0.45);
    assert.equal(p.syncIntervalMs, 300_000);
  });

  test('a good link keeps full behaviour', () => {
    const p = dataSaverPolicy({ effectiveType: '4g' }, 4);
    assert.equal(p.lite, false);
    assert.equal(p.loadAvatars, true);
    assert.equal(p.autoCropWasm, true);
  });

  test('the WASM auto-cropper is skipped on 2 GB devices regardless of link', () => {
    assert.equal(dataSaverPolicy({ effectiveType: '4g' }, 2).autoCropWasm, false);
  });

  test('an absent Network Information API is treated as a good link', () => {
    assert.equal(dataSaverPolicy(undefined).lite, false);
  });
});
