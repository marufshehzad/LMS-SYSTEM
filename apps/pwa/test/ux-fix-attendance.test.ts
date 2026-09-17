/**
 * UX fixes, group "attendance" — confirmed findings 49, 50, 52, 53, 54.
 *
 *   49  a tapped row low on the screen opened its buttons under the sticky
 *       footer, and nothing scrolled
 *   50  the undo toast covered the row just marked (scrolled before the toast
 *       existed), and a touch on the toast froze its countdown
 *   52  unsaved marks were thrown away without a word by a section change or
 *       by leaving the route (the shell asks `hasUnsavedChanges()`)
 *   53  one ArrowDown on the section select switched section, rebuilt the
 *       select under the keyboard user's focus, and a late roster answer could
 *       be drawn under another section's name
 *   54  after a submit the register looked exactly like one never submitted,
 *       with the same primary one tap from sending it again
 *
 * Minors in the same files: 81 (a touch froze the undo countdown — covered by
 * 50), 82 ("আবার পাঠান" offline looked dead; a drained queue dropped focus),
 * 83/103 (the sync line said "পাঠানো হচ্ছে" while offline), 88 (the denied
 * card was not the canonical sentence and printed "শিক্ষক-এর").
 *
 * Layout itself (what covers what) cannot be measured in jsdom. These pin the
 * causes: which element is scrolled, when, with the toast in which state, and
 * which events pause the countdown. The CSS half of 50 (end-of-list clearance)
 * goes back to the stylesheet's owner as data.
 */
import { test, describe, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

import { AttendanceScreen } from '../src/attendance-screen.ts';
import { AttendanceView, type OutboxLike } from '../src/attendance-view.ts';
import { closeAllOverlays } from '../src/ui/index.ts';
import { formatTime } from '../../../packages/ui-core/src/format.ts';
import type { Student } from '../../../packages/ui-core/src/attendance-grid.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const host = () => doc().getElementById('root') as HTMLElement;

before(() => {
  dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.CSS = dom.window.CSS;
  g.document = dom.window.document;
  g.location = dom.window.location;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
  g.addEventListener = dom.window.addEventListener.bind(dom.window);
  g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
});

beforeEach(() => {
  host().textContent = '';
  try { dom.window.localStorage.clear(); } catch { /* ignore */ }
  setOnline(true);
});

afterEach(() => {
  for (const s of doc().querySelectorAll('.ui-scrim')) {
    (s.querySelector('.ui-dialog-close') as HTMLButtonElement | null)?.click();
    s.remove();
  }
  for (const s of doc().querySelectorAll('.ui-toast-host')) s.textContent = '';
});

function setOnline(on: boolean): void {
  Object.defineProperty(dom.window.navigator, 'onLine', { value: on, configurable: true });
}

const settle = () => new Promise((r) => setTimeout(r, 15));
const click = (node: Element) =>
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

/** Record every scrollIntoView, with what the undo toast looked like at that moment. */
function recordScrolls(root: HTMLElement) {
  const proto = dom.window.HTMLElement.prototype as { scrollIntoView?: (o?: unknown) => void };
  const had = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView');
  const prev = proto.scrollIntoView;
  const calls: Array<{ id: string | undefined; opts: unknown; toastShown: boolean }> = [];
  proto.scrollIntoView = function (this: HTMLElement, o?: unknown) {
    const undo = root.querySelector<HTMLElement>('.att-undo');
    calls.push({ id: this.dataset.studentId, opts: o, toastShown: !!undo && !undo.hidden });
  };
  return {
    calls,
    restore: () => { if (had) proto.scrollIntoView = prev; else delete proto.scrollIntoView; },
  };
}

/* ── the register on its own ─────────────────────────────────────────── */

class FakeOutbox implements OutboxLike {
  online = true;
  enqueued: Array<{ opId: string; payload: unknown }> = [];
  pending = 0;
  failed = 0;
  conflicts = 0;
  inflight = 0;
  /** The server's answer to what the flush sends: parked the way the engine parks it. */
  refuse: 'failed' | 'conflict' | null = null;
  /** The next state() reads throw (an unreadable store). */
  stateThrows = 0;
  async enqueue(input: { opId?: string; payload: unknown }) {
    const opId = input.opId ?? `op_${this.enqueued.length + 1}`;
    this.enqueued.push({ opId, payload: input.payload });
    this.pending++;
    return { opId };
  }
  async flush() {
    if (!this.online) throw new Error('Failed to fetch');
    if (this.refuse === 'failed') this.failed += this.pending;
    if (this.refuse === 'conflict') this.conflicts += this.pending;
    this.pending = 0;
    return undefined;
  }
  stateReads = 0;
  async state() {
    this.stateReads++;
    if (this.stateThrows > 0) { this.stateThrows--; throw new Error('IndexedDB closed'); }
    return { pending: this.pending, failed: this.failed, conflicts: this.conflicts, inflight: this.inflight };
  }
}

const NOW = 1_760_000_000_000;
const students = (n: number): Student[] =>
  Array.from({ length: n }, (_, i) => ({
    studentId: `stu_${i + 1}`, rollNo: i + 1, nameBn: `শিক্ষার্থী ${i + 1}`, nameEn: `Student ${i + 1}`,
  }));

function mountView(n = 8, outbox = new FakeOutbox(), onDeliveryChange?: () => void) {
  const root = host();
  let idc = 0;
  const view = new AttendanceView({
    root, doc: doc(), students: students(n),
    section: { id: 'sec_9a', labelBn: '৯-ক', academicYearId: 'yr_2026' },
    takenOn: '2026-08-06', outbox, newId: () => `sess_${++idc}`, now: () => NOW,
    onDeliveryChange,
  });
  return { view, root, outbox };
}

const rowEl = (root: HTMLElement, roll: number) =>
  root.querySelector<HTMLLIElement>(`.att-row[data-student-id="stu_${roll}"]`)!;
const hit = (root: HTMLElement, roll: number) =>
  rowEl(root, roll).querySelector<HTMLButtonElement>('.att-row-hit')!;
const opt = (root: HTMLElement, roll: number, status: string) =>
  rowEl(root, roll).querySelector<HTMLButtonElement>(`.att-opt[data-status="${status}"]`)!;
const act = (root: ParentNode, action: string) =>
  root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
function mark(root: HTMLElement, roll: number, status: 'present' | 'absent' | 'late') {
  if (hit(root, roll).getAttribute('aria-expanded') !== 'true') click(hit(root, roll));
  click(opt(root, roll, status));
}
const footer = (root: HTMLElement) => root.querySelector<HTMLElement>('.att-footer')!;

describe('49 — a tapped row brings its three buttons into view', () => {
  test('a pointer tap that opens a row scrolls that row, nearest, so the footer cannot cover its buttons', () => {
    const { root } = mountView(8);
    const rec = recordScrolls(root);
    try {
      click(hit(root, 6));
      assert.equal(hit(root, 6).getAttribute('aria-expanded'), 'true');
      assert.deepEqual(rec.calls.map((c) => ({ id: c.id, opts: c.opts })),
        [{ id: 'stu_6', opts: { block: 'nearest' } }],
        'opening a row must scroll it (the root scroll-padding clears the sticky footer)');

      rec.calls.length = 0;
      click(hit(root, 6));
      assert.equal(hit(root, 6).getAttribute('aria-expanded'), 'false');
      assert.equal(rec.calls.length, 0, 'closing a row does not move the page');
    } finally {
      rec.restore();
    }
  });

  test('"বাকি … জনে যান" still centres the row it opens', () => {
    const { root } = mountView(4);
    mark(root, 1, 'present');
    const rec = recordScrolls(root);
    try {
      click(act(root, 'review')!);
      click(act(root, 'next-unmarked')!);
      const last = rec.calls.at(-1)!;
      assert.deepEqual({ id: last.id, opts: last.opts }, { id: 'stu_2', opts: { block: 'center' } });
      assert.equal(doc().activeElement, opt(root, 2, 'present'));
    } finally {
      rec.restore();
    }
  });
});

describe('50 — the undo toast does not cover the row, and a touch does not freeze it', () => {
  test('a chosen status scrolls its row only AFTER the toast is shown, so the toast padding applies', () => {
    const { root } = mountView(8);
    const rec = recordScrolls(root);
    try {
      click(hit(root, 7));
      rec.calls.length = 0;
      click(opt(root, 7, 'absent'));
      const own = rec.calls.filter((c) => c.id === 'stu_7');
      assert.equal(own.length, 1);
      assert.deepEqual(own[0], { id: 'stu_7', opts: { block: 'nearest' }, toastShown: true },
        'scrolled while the toast was still hidden: the row lands under its own toast');
      assert.equal(doc().activeElement, hit(root, 7), 'focus still returns to the row');
    } finally {
      rec.restore();
    }
  });

  test('touching the toast text does not pause the countdown; a resting mouse still does', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const tick = (s: number) => { for (let i = 0; i < s; i++) mock.timers.tick(1000); };
    try {
      const { root } = mountView(4);
      mark(root, 1, 'absent');
      const undo = root.querySelector<HTMLElement>('.att-undo')!;
      assert.equal(undo.hidden, false);
      // What a finger's tap on the text dispatches: pointer events with
      // pointerType "touch", then compatibility mouse events — a mouseenter
      // and never the matching mouseleave.
      const text = undo.querySelector('.ui-toast-text')!;
      text.dispatchEvent(new dom.window.PointerEvent('pointerenter', { pointerType: 'touch' }));
      text.dispatchEvent(new dom.window.PointerEvent('pointerleave', { pointerType: 'touch' }));
      undo.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
      tick(6);
      assert.equal(undo.hidden, true, 'a touch froze the countdown and the toast stayed over the rows');
      assert.equal(rowEl(root, 1).dataset.status, 'absent', 'expiry keeps the change');

      mark(root, 2, 'late');
      assert.equal(undo.hidden, false);
      undo.dispatchEvent(new dom.window.PointerEvent('pointerenter', { pointerType: 'mouse' }));
      tick(10);
      assert.equal(undo.hidden, false, 'WCAG 2.2.1: a mouse resting on the toast pauses it');
      undo.dispatchEvent(new dom.window.PointerEvent('pointerleave', { pointerType: 'mouse' }));
      tick(6);
      assert.equal(undo.hidden, true, 'and it resumes when the mouse leaves');
    } finally {
      mock.timers.reset();
    }
  });
});

describe('54 — a submitted register says so, and does not offer the same submit again', () => {
  const time = () => {
    const t = new Date(NOW);
    return formatTime(`${t.getHours()}:${t.getMinutes()}`, 'bn');
  };

  test('after a save the footer states saved, when, and the tally — with no "দেখে জমা দিন"', async () => {
    const outbox = new FakeOutbox();
    outbox.online = false;          // the flush fails: saved on the device, not sent
    const { view, root } = mountView(5, outbox);
    click(act(root, 'mark-all')!);
    mark(root, 2, 'absent');
    mark(root, 4, 'late');
    const res = await view.save();

    const f = footer(root);
    assert.equal(f.dataset.state, 'saved');
    assert.equal(act(root, 'review'), null, 'the same register is not one tap from being sent twice');
    const line = f.querySelector<HTMLElement>('.att-saved-text')!;
    assert.ok(line, 'a lasting line, not only a toast');
    assert.match(line.textContent!, new RegExp(`হাজিরা সংরক্ষিত · ${time()} — পাঠানো হচ্ছে`));
    assert.match(line.textContent!, /৩ জন উপস্থিত · ১ জন আসেনি · ১ জন দেরিতে/);
    // R6: the time and every count sit in the numeral face.
    const figures = [...line.querySelectorAll('.n')].map((n) => n.textContent);
    assert.deepEqual(figures, [time(), '৩', '১', '১']);

    await res.flushed;
    assert.match(line.textContent!, new RegExp(`হাজিরা এই যন্ত্রে সংরক্ষিত · ${time()} — এখনো পাঠানো হয়নি`),
      'offline, it never claims the register was sent');
    assert.equal(outbox.enqueued.length, 1);
  });

  test('"জমা হয়েছে" appears only once the queue holds nothing, in flight included', async () => {
    const outbox = new FakeOutbox();
    const { view, root } = mountView(3, outbox);
    click(act(root, 'mark-all')!);
    outbox.inflight = 1;           // the engine is still sending it
    const res = await view.save();
    await res.flushed;
    const line = () => footer(root).querySelector('.att-saved-text')!.textContent!;
    assert.doesNotMatch(line(), /জমা হয়েছে/, 'an op in flight has not arrived');
    outbox.inflight = 0;
    await view.refreshSaved();
    assert.match(line(), new RegExp(`^হাজিরা জমা হয়েছে · ${time()}`));
    assert.equal(footer(root).querySelector<HTMLElement>(".att-saved-text")!.dataset.delivery, "sent",
      "the stylesheet keys its sent rule on this");
    outbox.pending = 4;            // later, unrelated work queues up
    await view.refreshSaved();
    assert.match(line(), /হাজিরা জমা হয়েছে/, 'a register that arrived does not un-arrive');
  });

  test('a register sent later, in the background, stops saying "এখনো পাঠানো হয়নি" by itself', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const flushMicrotasks = async () => {
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    };
    try {
      const outbox = new FakeOutbox();
      outbox.online = false;
      let changes = 0;
      const { view, root } = mountView(3, outbox, () => { changes++; });
      click(act(root, 'mark-all')!);
      const res = await view.save();
      await res.flushed;
      const line = () => footer(root).querySelector('.att-saved-text')!.textContent!;
      assert.match(line(), /এখনো পাঠানো হয়নি/);
      assert.equal(changes, 1, 'sending → not yet sent is a change the screen hears about');

      // The shell's auto-flush sends it on reconnect; nobody tells the view.
      outbox.online = true;
      outbox.pending = 0;
      mock.timers.tick(10_000);
      await flushMicrotasks();
      assert.match(line(), /^হাজিরা জমা হয়েছে/, 'the footer kept saying "not sent" after it arrived');
      assert.equal(changes, 2, 'and the screen is told, so its sync line clears too');

      const reads = outbox.stateReads;
      mock.timers.tick(60_000);
      await flushMicrotasks();
      assert.equal(outbox.stateReads, reads, 'once sent, the queue is not read again');
    } finally {
      mock.timers.reset();
    }
  });

  test('an old refused op already parked in the queue does not make this register read "not sent" forever', async () => {
    // The engine parks refused and conflicted ops and nothing in the app
    // removes them: phones still hold registers refused for the old year id.
    mock.timers.enable({ apis: ['setTimeout'] });
    const flushMicrotasks = async () => {
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    };
    try {
      const outbox = new FakeOutbox();
      outbox.failed = 1;
      outbox.conflicts = 1;
      const { view, root } = mountView(3, outbox);
      click(act(root, 'mark-all')!);
      const res = await view.save();
      await res.flushed;
      const line = () => footer(root).querySelector<HTMLElement>('.att-saved-text')!;
      assert.match(line().textContent!, new RegExp(`^হাজিরা জমা হয়েছে · ${time()}`),
        'this register left the queue; the parked ops are older than it');
      assert.equal(line().dataset.delivery, 'sent');

      const reads = outbox.stateReads;
      mock.timers.tick(60_000);
      await flushMicrotasks();
      assert.equal(outbox.stateReads, reads, 'nothing is waiting: the queue is not read every 10 s');
    } finally {
      mock.timers.reset();
    }
  });

  test('a register the server refuses says "পাঠানো যায়নি", tells the screen, and stops reading', async () => {
    for (const refuse of ['failed', 'conflict'] as const) {
      mock.timers.enable({ apis: ['setTimeout'] });
      const flushMicrotasks = async () => {
        for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      };
      try {
        host().textContent = '';
        const outbox = new FakeOutbox();
        outbox.failed = 2;              // older refusals, as above
        outbox.refuse = refuse;
        let changes = 0;
        const { view, root } = mountView(3, outbox, () => { changes++; });
        click(act(root, 'mark-all')!);
        const res = await view.save();
        await res.flushed;
        const line = footer(root).querySelector<HTMLElement>('.att-saved-text')!;
        assert.match(line.textContent!, new RegExp(`হাজিরা এই যন্ত্রে সংরক্ষিত · ${time()} — পাঠানো যায়নি`),
          `${refuse}: a parked register reads neither "জমা হয়েছে" nor "not yet" forever`);
        assert.doesNotMatch(line.textContent!, /জমা হয়েছে|এখনো পাঠানো হয়নি/);
        assert.equal(line.dataset.delivery, 'failed');
        assert.equal(changes, 1, 'the screen repaints its sync line');

        const reads = outbox.stateReads;
        mock.timers.tick(60_000);
        await flushMicrotasks();
        await view.refreshSaved();
        assert.equal(outbox.stateReads, reads, 'a verdict is final');
        assert.match(line.textContent!, /পাঠানো যায়নি/);
      } finally {
        mock.timers.reset();
      }
    }
  });

  test('with no queue count from before the enqueue, a parked op is never claimed either way', async () => {
    const outbox = new FakeOutbox();
    outbox.failed = 1;
    const { view, root } = mountView(3, outbox);
    click(act(root, 'mark-all')!);
    outbox.stateThrows = 1;             // the read save() takes before the enqueue
    const res = await view.save();
    await res.flushed;
    assert.equal(outbox.enqueued.length, 1, 'an unreadable count does not stop the save');
    const line = footer(root).querySelector<HTMLElement>('.att-saved-text')!;
    assert.equal(line.querySelector('.att-saved-head')!.textContent, `হাজিরা এই যন্ত্রে সংরক্ষিত · ${time()}`);
    assert.equal(line.dataset.delivery, 'unknown');
  });

  test('changing a mark brings "দেখে জমা দিন" back; changing it back is saved again', async () => {
    const { view, root } = mountView(4);
    click(act(root, 'mark-all')!);
    await view.save();
    assert.equal(view.hasUnsavedChanges(), false);
    mark(root, 3, 'absent');
    assert.equal(footer(root).dataset.state, 'ready');
    assert.ok(act(root, 'review'), 'a correction can be submitted');
    assert.equal(view.hasUnsavedChanges(), true);
    mark(root, 3, 'present');
    assert.equal(footer(root).dataset.state, 'saved', 'the marks equal the saved register again');
    assert.equal(view.hasUnsavedChanges(), false);
  });

  test('submitting through the sheet leaves focus on the saved line, never on <body>', async () => {
    const { root, outbox } = mountView(3);
    click(act(root, 'mark-all')!);
    const review = act(root, 'review')!;
    review.focus();
    click(review);
    const save = doc().querySelector<HTMLButtonElement>('.att-confirm [data-action="save"]')!;
    save.focus();
    click(save);
    await settle();
    assert.equal(outbox.enqueued.length, 1);
    assert.equal(doc().querySelector('.att-confirm'), null, 'the sheet closed');
    const line = footer(root).querySelector('.att-saved-text');
    assert.ok(line);
    assert.equal(doc().activeElement, line,
      'the opener ("দেখে জমা দিন") is gone, so focus must land on what replaced it');
    assert.equal(line!.getAttribute('tabindex'), '-1');
  });
});

/* ── the screen: section picker, leaving, submit ──────────────────────── */

const SECTIONS = [
  { id: 's1', name: 'ক', shift: 'morning', studentCount: 2,
    className: { bn: 'নবম শ্রেণি', en: 'Class 9' }, levelNo: 9, academicYearId: 'y1' },
  { id: 's2', name: 'খ', shift: 'morning', studentCount: 1,
    className: { bn: 'নবম শ্রেণি', en: 'Class 9' }, levelNo: 9, academicYearId: 'y1' },
];
const ROSTERS: Record<string, unknown[]> = {
  s1: [
    { studentId: 'a1', rollNo: 1, fullName: { bn: 'আনিকা রহমান', en: 'Anika' }, phone: null },
    { studentId: 'a2', rollNo: 2, fullName: { bn: 'আরিফ হোসেন', en: 'Arif' }, phone: null },
  ],
  s2: [
    { studentId: 'b1', rollNo: 1, fullName: { bn: 'বাবুল মিয়া', en: 'Babul' }, phone: null },
  ],
};

function fakeAuth() {
  const a = {
    rosterCalls: [] as string[],
    hold: false,
    denySections: false,
    failing: new Set<string>(),
    held: [] as Array<{ id: string; release: () => void }>,
    async authedFetch(path: string): Promise<Response> {
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
      if (path.startsWith('/api/v1/academics/sections')) {
        if (a.denySections) return { ok: false, status: 403, json: async () => ({}) } as Response;
        return ok({ sections: SECTIONS });
      }
      const id = new URL(path, 'http://x').searchParams.get('sectionId') ?? '';
      a.rosterCalls.push(id);
      if (a.failing.has(id)) throw new TypeError('Failed to fetch');
      const res = ok({ roster: ROSTERS[id] ?? [] });
      if (!a.hold) return res;
      return new Promise<Response>((r) => { a.held.push({ id, release: () => r(res) }); });
    },
  };
  return a;
}

function stubOutbox(): OutboxLike & { enqueued: number } {
  return {
    enqueued: 0,
    async enqueue(input) { this.enqueued++; return { opId: input.opId ?? 'op' }; },
    async flush() { return undefined; },
    async state() { return { pending: 0, failed: 0, conflicts: 0 }; },
  } as OutboxLike & { enqueued: number };
}

async function mountScreen<O extends OutboxLike = ReturnType<typeof stubOutbox>>(
  outbox: O = stubOutbox() as unknown as O, auth = fakeAuth(),
) {
  const screen = new AttendanceScreen({
    root: host(), doc: doc(), auth: auth as never, outbox,
    newId: () => 'session-1', takenOn: '2026-09-17', now: () => NOW,
  });
  await settle();
  return { screen, auth, outbox };
}

const select = () => host().querySelector<HTMLSelectElement>('.att-pickers select[name="section"]')!;
const rowIds = () => [...host().querySelectorAll<HTMLElement>('.att-row')].map((r) => r.dataset.studentId);
function pick(value: string) {
  const s = select();
  s.value = value;
  s.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
const dialog = () => doc().querySelector<HTMLElement>('[role="alertdialog"]');
const dialogButton = (label: string) =>
  [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find((b) => b.textContent?.trim() === label)!;
function markRow(studentId: string, status: string) {
  const row = host().querySelector(`.att-row[data-student-id="${studentId}"]`)!;
  click(row.querySelector('.att-row-hit')!);
  click(row.querySelector(`.att-opt[data-status="${status}"]`)!);
}

describe('52 — marks not yet submitted are never thrown away without asking', () => {
  test('hasUnsavedChanges: nothing marked no, marked yes, submitted no, corrected yes', async () => {
    const { screen } = await mountScreen();
    assert.equal(screen.hasUnsavedChanges(), false, 'an untouched register has nothing to lose');
    markRow('a2', 'absent');
    assert.equal(screen.hasUnsavedChanges(), true);
    click(act(host(), 'mark-all')!);
    click(act(host(), 'review')!);
    click(doc().querySelector('.att-confirm [data-action="save"]')!);
    await settle();
    assert.equal(screen.hasUnsavedChanges(), false, 'a submitted register leaves freely');
    markRow('a2', 'late');
    assert.equal(screen.hasUnsavedChanges(), true, 'a correction not yet submitted');
  });

  test('changing section with marks asks first; "বাতিল" keeps the register and the section', async () => {
    const { auth } = await mountScreen();
    markRow('a1', 'absent');
    const sel = select();
    sel.focus();
    const calls = auth.rosterCalls.length;
    pick('s2');

    assert.ok(dialog(), 'no question before the marks are discarded');
    assert.match(dialog()!.textContent ?? '', /হাজিরা জমা দেওয়া হয়নি/);
    assert.match(dialog()!.textContent ?? '', /সেকশন বদলালে চিহ্নগুলো হারিয়ে যাবে/);
    assert.equal(sel.value, 's1', 'the picker goes back to the section on screen while asking');
    assert.equal(auth.rosterCalls.length, calls, 'nothing loads while the question is open');
    assert.equal(doc().activeElement, dialogButton('বাতিল'), 'focus starts on the safe answer');

    click(dialogButton('বাতিল'));
    await settle();
    assert.equal(dialog(), null);
    assert.equal(sel.value, 's1');
    assert.deepEqual(rowIds(), ['a1', 'a2']);
    assert.equal(host().querySelector('.att-row[data-student-id="a1"]')!.getAttribute('data-status'), 'absent',
      'the mark survived');
    assert.equal(doc().activeElement, sel, 'focus is back on the picker');
  });

  test('"বাদ দিন" switches section, and focus stays on the picker', async () => {
    await mountScreen();
    markRow('a1', 'absent');
    const sel = select();
    sel.focus();
    pick('s2');
    click(dialogButton('বাদ দিন'));
    await settle();
    assert.equal(dialog(), null);
    assert.equal(select(), sel, 'the same select, not a rebuilt one');
    assert.equal(sel.value, 's2');
    assert.deepEqual(rowIds(), ['b1']);
    assert.equal(doc().activeElement, sel);
  });

  test('a question closed from outside (a route change closes every overlay) does not silence the next one', async () => {
    await mountScreen();
    markRow('a1', 'absent');
    pick('s2');
    assert.ok(dialog());
    closeAllOverlays();
    assert.equal(dialog(), null);
    pick('s2');
    assert.ok(dialog(), 'the second attempt switched without asking, or did nothing');
    assert.equal(select().value, 's1');
  });

  test('with nothing marked the picker switches straight away', async () => {
    await mountScreen();
    pick('s2');
    assert.equal(dialog(), null);
    await settle();
    assert.deepEqual(rowIds(), ['b1']);
  });
});

describe('53 — the section select survives a section change', () => {
  test('an ArrowDown-style change keeps focus on the same select through loading and ready', async () => {
    const { auth } = await mountScreen();
    const sel = select();
    sel.focus();
    auth.hold = true;
    pick('s2');                                   // what Chrome does on ArrowDown
    assert.ok(host().querySelector('.is-skeleton'), 'loading state while the roster comes');
    assert.equal(select(), sel, 'the loading render kept the select');
    assert.equal(doc().activeElement, sel, 'focus did not drop to <body>');
    auth.held.shift()!.release();
    await settle();
    assert.deepEqual(rowIds(), ['b1']);
    assert.equal(select(), sel);
    assert.equal(sel.isConnected, true);
    assert.equal(doc().activeElement, sel, 'a second ArrowDown still reaches the select');
    assert.equal(host().querySelectorAll('h1').length, 1, 'one page heading, not one per render');
  });

  test('a late roster answer is not drawn under a section chosen after it', async () => {
    const { auth } = await mountScreen();
    auth.hold = true;
    pick('s2');
    pick('s1');                                   // quick second press, before s2 answered
    assert.deepEqual(auth.held.map((h) => h.id), ['s2', 's1']);
    auth.held[1].release();                       // s1 answers first
    await settle();
    auth.held[0].release();                       // s2's answer arrives late
    await settle();
    assert.equal(select().value, 's1');
    assert.deepEqual(rowIds(), ['a1', 'a2'], 'the late answer drew another section\'s children');
  });

  test('a section with no cached roster and a failed fetch shows an error, never the previous section\'s children', async () => {
    const { auth } = await mountScreen();
    assert.deepEqual(rowIds(), ['a1', 'a2']);
    auth.failing.add('s2');
    pick('s2');
    await settle();
    assert.equal(select().value, 's2');
    assert.deepEqual(rowIds(), [], 'section খ showed section ক\'s register — a save would have sent them');
    assert.ok([...host().querySelectorAll('button')].some((b) => /আবার চেষ্টা/.test(b.textContent ?? '')),
      'an error with a retry');
  });
});

describe('54 — the screen: a submitted register stays visibly submitted', () => {
  test('after submit the footer says it arrived, and offers no second submit', async () => {
    const { outbox } = await mountScreen();
    click(act(host(), 'mark-all')!);
    click(act(host(), 'review')!);
    click(doc().querySelector('.att-confirm [data-action="save"]')!);
    await settle();
    assert.equal(outbox.enqueued, 1);
    const f = host().querySelector<HTMLElement>('.att-footer')!;
    assert.equal(f.dataset.state, 'saved');
    assert.match(f.textContent ?? '', /হাজিরা জমা হয়েছে/, 'the queue is empty: it arrived');
    assert.equal(act(host(), 'review'), null);
  });

  test('an outbox that already holds a refused op still says the new register arrived', async () => {
    const base = stubOutbox();
    const outbox = Object.assign(base, { async state() { return { pending: 0, failed: 1, conflicts: 0 }; } });
    await mountScreen(outbox);
    click(act(host(), 'mark-all')!);
    click(act(host(), 'review')!);
    click(doc().querySelector('.att-confirm [data-action="save"]')!);
    await settle();
    assert.equal(outbox.enqueued, 1);
    const f = host().querySelector<HTMLElement>('.att-footer')!;
    assert.match(f.textContent ?? '', /হাজিরা জমা হয়েছে/);
    assert.doesNotMatch(f.textContent ?? '', /এখনো পাঠানো হয়নি/);
    // The sync line still reports the old refusal: that part is true.
    assert.match(host().querySelector('.att-sync-line')?.textContent ?? '', /১টি পাঠানো যায়নি/);
  });
});

/* ── minors in these files ──────────────────────────────────────────────── */

/** A queue whose sends fail until `online` is set, like a transport with no network. */
function queueOutbox(pending = 0) {
  const o = {
    online: true,
    pending,
    enqueued: 0,
    async enqueue(input: { opId?: string }) { o.enqueued++; o.pending++; return { opId: input.opId ?? 'op' }; },
    async flush() { if (!o.online) throw new TypeError('Failed to fetch'); o.pending = 0; return undefined; },
    async state() { return { pending: o.pending, failed: 0, conflicts: 0 }; },
  };
  return o;
}
const retryButton = () => [...host().querySelectorAll<HTMLButtonElement>('.att-sync-line button')]
  .find((b) => /আবার পাঠান/.test(b.textContent ?? ''));

describe('minor 82 / 83 — the sync line and its retry', () => {
  test('offline, a queued register is "sent when connected", never "being sent"', async () => {
    setOnline(false);
    await mountScreen(queueOutbox(1));
    const line = host().querySelector('.att-sync-line')!;
    assert.ok(line);
    assert.match(line.textContent ?? '', /সংযোগ পেলে পাঠানো হবে/);
    assert.doesNotMatch(line.textContent ?? '', /পাঠানো হচ্ছে/);
  });

  test('offline, "আবার পাঠান" says what happened instead of looking dead', async () => {
    setOnline(false);
    const outbox = queueOutbox(1);
    outbox.online = false;
    await mountScreen(outbox);
    click(retryButton()!);
    await settle();
    const toastText = doc().querySelector('.ui-toast-host')?.textContent ?? '';
    assert.match(toastText, /ইন্টারনেট নেই — হাজিরা এই যন্ত্রে নিরাপদ আছে/);
    assert.ok(retryButton(), 'still queued, still retryable');
  });

  test('a retry that empties the queue moves focus to the saved line, which now says it arrived', async () => {
    const outbox = queueOutbox();
    outbox.online = false;                     // the submit's own send fails
    await mountScreen(outbox);
    click(act(host(), 'mark-all')!);
    click(act(host(), 'review')!);
    click(doc().querySelector('.att-confirm [data-action="save"]')!);
    await settle();
    assert.equal(outbox.enqueued, 1);
    assert.match(footer(host()).textContent ?? '', /এখনো পাঠানো হয়নি/);

    outbox.online = true;
    const retry = retryButton()!;
    retry.focus();
    click(retry);
    await settle();
    assert.equal(host().querySelector('.att-sync-line'), null, 'the queue emptied');
    const saved = footer(host()).querySelector('.att-saved-text');
    assert.match(saved?.textContent ?? '', /^হাজিরা জমা হয়েছে/);
    assert.equal(doc().activeElement, saved, 'focus went down with the removed button');
  });

  test('the sync line clears when the register arrives in a background send', async () => {
    const outbox = queueOutbox();
    outbox.online = false;
    const { screen } = await mountScreen(outbox);
    click(act(host(), 'mark-all')!);
    click(act(host(), 'review')!);
    click(doc().querySelector('.att-confirm [data-action="save"]')!);
    await settle();
    assert.ok(host().querySelector('.att-sync-line'));
    outbox.pending = 0;                        // the shell's auto-flush sent it
    await screen.inner!.refreshSaved();        // what the view's re-check timer runs
    await settle();
    assert.match(footer(host()).textContent ?? '', /হাজিরা জমা হয়েছে/);
    assert.equal(host().querySelector('.att-sync-line'), null,
      '"১টি অপেক্ষমাণ" above a footer that says it arrived');
  });
});

describe('minor 88 — the denied card is the canonical sentence', () => {
  test('a 403 reads "এই কাজটি করার অনুমতি আপনার নেই।" and names the head teacher correctly', async () => {
    const auth = fakeAuth();
    auth.denySections = true;
    await mountScreen(stubOutbox(), auth);
    const card = host().querySelector('.ui-state-denied')!;
    assert.ok(card);
    assert.match(card.textContent ?? '', /এই কাজটি করার অনুমতি আপনার নেই।/);
    assert.match(card.textContent ?? '', /প্রধান শিক্ষকের সাথে যোগাযোগ করুন।/);
    assert.doesNotMatch(card.textContent ?? '', /শিক্ষক-এর/);
    assert.equal(card.querySelector('button'), null, 'still no retry on a refusal');
  });
});

describe('the attendance sources stay searchable text', () => {
  test('no control bytes (a NUL made grep and ripgrep treat the screen as binary)', () => {
    for (const f of ['attendance-screen.ts', 'attendance-view.ts']) {
      const bytes = readFileSync(new URL(`../src/${f}`, import.meta.url));
      const bad = [...bytes.entries()].filter(([, b]) => b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d);
      assert.deepEqual(bad.map(([i]) => i), [], `${f} holds control bytes at these offsets`);
    }
  });
});
