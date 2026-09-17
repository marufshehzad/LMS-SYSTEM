/**
 * UX fixes, round 2 — sync status and the marks picker.
 *
 * Partly-fixed 6 and 51, R6: the shell's automatic flush sends the queue by
 * itself now, but the attendance sync line kept "১টি অপেক্ষমাণ … পাঠানো
 * হচ্ছে" for 40 s and more after a cold start or a rebuilt screen, and the
 * marks footer kept "১ সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে" after the
 * rows were sent. The shared contract: after every flush attempt and every
 * progress report the shell dispatches `shikhon:outbox` on the document with
 * `{ pending, inflight }`, and a screen with a queue line repaints it from
 * the real queue.
 *
 * R7: on #/marks, choosing another exam or subject with marks not yet saved
 * dropped them without a word — one ArrowDown on the focused picker did it.
 *
 * The marks view is mounted the way the shell mounts it, inside a container
 * armed with keepFocusWithin, so these tests see the focus a teacher sees.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="root"></main></body></html>',
  { url: 'http://localhost/app' });
before(() => {
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.CSS = dom.window.CSS;
  g.document = dom.window.document;
  for (const key of ['localStorage', 'location', 'navigator'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  g.addEventListener = dom.window.addEventListener.bind(dom.window);
  g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
});

const { AttendanceScreen } = await import('../src/attendance-screen.ts');
const { MarksView } = await import('../src/marks-view.ts');
const { keepFocusWithin, closeAllOverlays } = await import('../src/ui/index.ts');

const doc = dom.window.document;
const host = () => doc.getElementById('root') as HTMLElement;
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const click = (node: Element) =>
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

function setOnline(on: boolean): void {
  Object.defineProperty(dom.window.navigator, 'onLine', { value: on, configurable: true });
}
/** What shell.ts autoFlush dispatches after a flush attempt or a progress report. */
function report(pending: number, inflight = 0): void {
  doc.dispatchEvent(new dom.window.CustomEvent('shikhon:outbox', { detail: { pending, inflight } }));
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let stopKeeper: () => void = () => {};
beforeEach(() => {
  host().textContent = '';
  localStorage.clear();
  setOnline(true);
  (doc.activeElement as HTMLElement | null)?.blur?.();
});
afterEach(() => {
  closeAllOverlays();
  for (const s of doc.querySelectorAll('.ui-scrim')) s.remove();
  for (const s of doc.querySelectorAll('.ui-toast-host')) s.textContent = '';
  stopKeeper();
  stopKeeper = () => {};
});

/* ── attendance: the sync line ──────────────────────────────────────────── */

const SECTIONS = [
  { id: 's1', name: 'ক', shift: 'morning', studentCount: 2,
    className: { bn: 'নবম শ্রেণি', en: 'Class 9' }, levelNo: 9, academicYearId: 'y1' },
];
const ROSTER = [
  { studentId: 'a1', rollNo: 1, fullName: { bn: 'আনিকা রহমান', en: 'Anika' }, phone: null },
  { studentId: 'a2', rollNo: 2, fullName: { bn: 'আরিফ হোসেন', en: 'Arif' }, phone: null },
];
const attAuth = {
  async authedFetch(path: string): Promise<Response> {
    const body = path.startsWith('/api/v1/academics/sections') ? { sections: SECTIONS } : { roster: ROSTER };
    return { ok: true, status: 200, json: async () => body } as Response;
  },
};

/**
 * The outbox as the screen sees it. `state()` answers with the queue as it is
 * when called; `holdReads` keeps those answers back until released, the way
 * a slow IndexedDB read can come back after a later one.
 */
function queue(pending = 0) {
  const q = {
    online: true,
    pending,
    failed: 0,
    enqueued: 0,
    stateReads: 0,
    holdReads: false,
    held: [] as Array<() => void>,
    async enqueue(input: { opId?: string }) { q.enqueued++; q.pending++; return { opId: input.opId ?? 'op' }; },
    async flush() { if (!q.online) throw new TypeError('Failed to fetch'); q.pending = 0; return undefined; },
    state() {
      q.stateReads++;
      const snap = { pending: q.pending, failed: q.failed, conflicts: 0, inflight: 0 };
      if (!q.holdReads) return Promise.resolve(snap);
      return new Promise<typeof snap>((r) => { q.held.push(() => r(snap)); });
    },
  };
  return q;
}

async function mountScreen(outbox = queue()) {
  const screen = new AttendanceScreen({
    root: host(), doc, auth: attAuth as never, outbox,
    newId: () => 'session-1', takenOn: '2026-09-17', now: () => 1_760_000_000_000,
  });
  await settle();
  return { screen, outbox };
}
const syncLine = () => host().querySelector<HTMLElement>('.att-sync-line');
const retryButton = () => syncLine()?.querySelector<HTMLButtonElement>('button') ?? null;
const act = (action: string) => host().querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
const savedText = () => host().querySelector<HTMLElement>('.att-saved-text');

describe('51 / R6 — the attendance sync line follows the automatic flush', () => {
  test('cold start: a register the boot flush sent stops reading "১টি অপেক্ষমাণ"', async () => {
    // A register left in the queue from an earlier session. The screen paints
    // before the shell's boot flush has sent it.
    const { outbox } = await mountScreen(queue(1));
    assert.match(syncLine()?.textContent ?? '', /১টি অপেক্ষমাণ/);
    assert.match(syncLine()?.textContent ?? '', /পাঠানো হচ্ছে/);

    outbox.pending = 0;                         // the flush sent it
    report(0);
    await settle();
    assert.equal(syncLine(), null,
      'the line still said "১টি অপেক্ষমাণ … পাঠানো হচ্ছে" over an empty queue');
  });

  test('rebuilt screen: after leaving and coming back, the flush on reconnect clears the line', async () => {
    setOnline(false);
    const first = await mountScreen(queue(1));
    assert.match(syncLine()?.textContent ?? '', /সংযোগ পেলে পাঠানো হবে/);
    // #/home and back, still offline: the route unmounts and mounts a new screen.
    first.screen.destroy();
    host().textContent = '';
    const outbox = first.outbox;
    await mountScreen(outbox);
    assert.match(syncLine()?.textContent ?? '', /১টি অপেক্ষমাণ/);

    setOnline(true);
    outbox.pending = 0;                         // the reconnect flush sent it
    report(0);
    await settle();
    assert.equal(syncLine(), null);
  });

  test('a saved register\'s footer says it arrived as soon as the flush reports, not 10 s later', async () => {
    const outbox = queue();
    outbox.online = false;                      // the submit's own send fails
    await mountScreen(outbox);
    click(act('mark-all')!);
    click(act('review')!);
    click(doc.querySelector('.att-confirm [data-action="save"]')!);
    await settle();
    assert.equal(outbox.enqueued, 1);
    assert.match(savedText()?.textContent ?? '', /এখনো পাঠানো হয়নি/);
    assert.ok(syncLine());

    outbox.online = true;
    outbox.pending = 0;                         // the shell's auto-flush sent it
    report(0);
    await settle();
    assert.match(savedText()?.textContent ?? '', /^হাজিরা জমা হয়েছে/);
    assert.equal(syncLine(), null);
  });

  test('a queue still waiting keeps its line', async () => {
    const { outbox } = await mountScreen(queue(2));
    outbox.pending = 1;                         // one of two went; one backed off
    report(1);
    await settle();
    assert.match(syncLine()?.textContent ?? '', /১টি অপেক্ষমাণ/);
  });

  test('an older queue read that answers last never draws the line back over an empty queue', async () => {
    const { outbox } = await mountScreen(queue(1));
    assert.ok(syncLine());
    // A report while the op is still waiting: this read is slow.
    outbox.holdReads = true;
    report(1);
    await settle();
    // The send finishes and reports again; this read would answer at once.
    outbox.holdReads = false;
    outbox.pending = 0;
    report(0);
    await settle();
    // The slow read (pending 1) comes back last.
    for (const release of outbox.held.splice(0)) release();
    await settle();
    assert.equal(syncLine(), null, 'the stale read put "১টি অপেক্ষমাণ" back');
  });

  test('a report that changes nothing keeps the line node, and focus on its "আবার পাঠান"', async () => {
    await mountScreen(queue(1));
    const line = syncLine()!;
    const retry = retryButton()!;
    retry.focus();
    report(1);
    await settle();
    assert.equal(syncLine(), line, 'the line was rebuilt, and the live region spoke again');
    assert.equal(doc.activeElement, retry);
  });

  test('a count that changes under a focused "আবার পাঠান" moves focus to the new line\'s button', async () => {
    const { outbox } = await mountScreen(queue(2));
    retryButton()!.focus();
    outbox.pending = 1;
    report(1);
    await settle();
    assert.match(syncLine()?.textContent ?? '', /১টি অপেক্ষমাণ/);
    assert.equal(doc.activeElement, retryButton(), 'focus fell to <body> with the old line');
  });

  test('a queue emptied under a focused "আবার পাঠান" moves focus to the saved line', async () => {
    const outbox = queue();
    outbox.online = false;
    await mountScreen(outbox);
    click(act('mark-all')!);
    click(act('review')!);
    click(doc.querySelector('.att-confirm [data-action="save"]')!);
    await settle();
    retryButton()!.focus();
    outbox.online = true;
    outbox.pending = 0;
    report(0);
    await settle();
    assert.equal(syncLine(), null);
    assert.equal(doc.activeElement, savedText(), 'focus went down with the removed button');
  });

  test('destroy() stops listening', async () => {
    const { screen, outbox } = await mountScreen(queue(1));
    screen.destroy();
    const reads = outbox.stateReads;
    report(0);
    await settle();
    assert.equal(outbox.stateReads, reads, 'a destroyed screen still reads the queue on every report');
  });
});

/* ── marks: the footer and the picker ───────────────────────────────────── */

const subject = (id: string, bn: string) => ({
  examSubjectId: id, subject: { bn, en: bn }, cqMax: 70, mcqMax: 30, practicalMax: 0, caMax: 0,
  markingLocked: false,
});
const EXAM = {
  id: 'ex-1', nameBn: 'অর্ধ-বার্ষিক', status: 'draft', academicYearId: 'yr-1',
  subjects: [subject('es-1', 'পদার্থবিজ্ঞান'), subject('es-2', 'গণিত')],
};
const row = (n: number, bn: string, cq: number | null) => ({
  rollNo: n, studentId: `s-${n}`, fullName: { bn, en: null }, cqMarks: cq, mcqMarks: null,
  practicalMarks: null, caMarks: null, isAbsent: false, rowVersion: 1,
});
const SHEETS: Record<string, () => unknown> = {
  'es-1': () => ({
    academicYearId: 'yr-1', examStatus: 'draft', markingLocked: false,
    maxima: { cq: 70, mcq: 30, practical: 0, ca: 0 },
    marks: [row(1, 'আনিকা', 40), row(2, 'বিজয়', null)],
  }),
  'es-2': () => ({
    academicYearId: 'yr-1', examStatus: 'draft', markingLocked: false,
    maxima: { cq: 70, mcq: 30, practical: 0, ca: 0 },
    marks: [row(1, 'আনিকা', 12), row(2, 'বিজয়', null)],
  }),
};

interface MarksOpts {
  enqueue?: () => Promise<void>;
  /** Give the outbox a state() (the sync engine has one). */
  state?: () => Promise<{ pending: number; inflight?: number }>;
}

async function mountMarks(o: MarksOpts = {}) {
  localStorage.setItem('shikhon_last_section', 'sec-1');
  const root = host();
  stopKeeper = keepFocusWithin(root);
  const ops: unknown[] = [];
  const sheetCalls: string[] = [];
  const outbox: Record<string, unknown> = {
    enqueue: async (i: unknown) => {
      if (o.enqueue) await o.enqueue();
      ops.push(i);
      return { opId: `op-${ops.length}` };
    },
    flush: async () => {},
  };
  if (o.state) outbox.state = o.state;
  const view = new MarksView({
    root, doc,
    auth: {
      authedFetch: async (url: string) => {
        if (url.includes('/exams')) return { ok: true, status: 200, json: async () => ({ exams: [EXAM] }) };
        const id = decodeURIComponent(url.split('examSubjectId=')[1] ?? '');
        sheetCalls.push(id);
        return { ok: true, status: 200, json: async () => SHEETS[id]() };
      },
    } as never,
    outbox: outbox as never,
  });
  await settle();
  return { root, ops, view, sheetCalls };
}

const picker = () => host().querySelector('[name="examSubject"]') as HTMLSelectElement;
/** What a keyboard change on the select does: the value moves, `change` fires. */
function choose(value: string): void {
  const s = picker();
  s.value = value;
  s.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
const boxes = () => [...host().querySelectorAll<HTMLInputElement>('.marks-input')];
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
const note = () => host().querySelector('.marks-note')?.textContent ?? '';
const saveCopies = () => [...host().querySelectorAll<HTMLButtonElement>('[data-focus-key^="marks-save"]')];
const dialog = () => doc.querySelector<HTMLElement>('[role="alertdialog"]');
const dialogButton = (label: string) =>
  [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find((b) => b.textContent?.trim() === label)!;

describe('6 / R6 — the marks footer follows the automatic flush', () => {
  test('rows saved offline stop reading "এই যন্ত্রে জমা" once the flush has sent them', async () => {
    let pending = 0;
    await mountMarks({ state: async () => ({ pending, inflight: 0 }) });
    choose('es-1');
    await settle();
    setOnline(false);
    type(boxes()[0], '৪৩');
    click(saveCopies()[1]);
    await settle();
    pending = 1;
    assert.match(note(), /১ সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে/);

    setOnline(true);
    pending = 0;                                // the reconnect flush sent it
    report(0);
    await settle();
    assert.doesNotMatch(note(), /ইন্টারনেট এলে যাবে/, 'still "waiting for the internet" after it went');
    assert.match(note(), /সংরক্ষিত/);
  });

  test('while anything is still waiting, the footer does not say the rows went', async () => {
    await mountMarks({ state: async () => ({ pending: 0, inflight: 1 }) });
    choose('es-1');
    await settle();
    setOnline(false);
    type(boxes()[0], '৪৩');
    click(saveCopies()[1]);
    await settle();
    setOnline(true);
    report(0, 1);
    await settle();
    assert.match(note(), /১ সারি এই যন্ত্রে জমা/, 'an op in flight has not arrived');
  });

  test('an outbox with no state() is read from the report itself', async () => {
    await mountMarks();
    choose('es-1');
    await settle();
    setOnline(false);
    type(boxes()[0], '৪৩');
    click(saveCopies()[1]);
    await settle();
    report(1);
    await settle();
    assert.match(note(), /১ সারি এই যন্ত্রে জমা/);
    setOnline(true);
    report(0);
    await settle();
    assert.match(note(), /সংরক্ষিত/);
    assert.doesNotMatch(note(), /ইন্টারনেট এলে যাবে/);
  });

  test('a queue read begun before a later save cannot speak for that save', async () => {
    let pending = 0;
    let hold: ReturnType<typeof deferred<void>> | null = null;
    await mountMarks({
      state: async () => {
        const snap = { pending, inflight: 0 };
        if (hold) await hold.promise;
        return snap;
      },
    });
    choose('es-1');
    await settle();
    setOnline(false);
    type(boxes()[0], '৪৩');
    click(saveCopies()[1]);
    await settle();
    // The first save's rows were sent; the report's read is slow.
    hold = deferred<void>();
    const gate = hold;
    report(0);
    await settle();
    // A second save, offline, before that read answers.
    type(boxes()[2], '২৫');
    click(saveCopies()[1]);
    await settle();
    pending = 1;
    hold = null;
    gate.resolve();
    await settle();
    assert.match(note(), /১ সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে/,
      'a read of the queue from before the second save said its row had gone');
  });

  test('a view the route has replaced stops listening', async () => {
    let reads = 0;
    await mountMarks({ state: async () => { reads++; return { pending: 0 }; } });
    choose('es-1');
    await settle();
    setOnline(false);
    type(boxes()[0], '৪৩');
    click(saveCopies()[1]);
    await settle();
    host().textContent = '';                    // the shell mounts the next route here
    report(0);
    await settle();
    report(0);
    await settle();
    assert.equal(reads, 0, 'a view that is no longer on screen still reads the queue');
  });
});

describe('R7 — choosing another exam or subject never drops unsaved marks without asking', () => {
  test('the question comes first; "বাতিল" keeps the marks, the paper and focus on the picker', async () => {
    const { sheetCalls, view } = await mountMarks();
    choose('es-1');
    await settle();
    assert.equal(view.hasUnsavedChanges(), false);
    type(boxes()[0], '১১');
    assert.equal(view.hasUnsavedChanges(), true);
    assert.ok(saveCopies().every((b) => !b.disabled), 'both save buttons are enabled');
    const sel = picker();
    sel.focus();
    const calls = sheetCalls.length;
    choose('es-2');                             // ArrowDown on the focused picker

    assert.ok(dialog(), 'গণিত opened and the typed ১১ was dropped without a word');
    assert.match(dialog()!.textContent ?? '', /নম্বর সংরক্ষণ করা হয়নি/);
    assert.match(dialog()!.textContent ?? '', /১ জনের নম্বর এখনো সংরক্ষণ করা হয়নি/);
    assert.ok(dialog()!.querySelector('.ui-dialog-text .n'), 'the count is in the numeral face (R6)');
    assert.equal(sel.value, 'es-1', 'the picker stays on the paper whose marks are on screen');
    assert.equal(sheetCalls.length, calls, 'nothing loads while the question is open');
    assert.equal(doc.activeElement, dialogButton('বাতিল'), 'focus starts on the safe answer');

    click(dialogButton('বাতিল'));
    await settle();
    assert.equal(dialog(), null);
    assert.equal(picker().value, 'es-1');
    assert.equal(boxes()[0].value, '১১', 'the typed mark is still in its box');
    assert.ok(saveCopies().every((b) => !b.disabled), 'and still waiting to be saved');
    assert.equal(doc.activeElement, picker(), 'focus is back on the picker');
  });

  test('"বাদ দিন" opens the other paper, and focus stays on the picker', async () => {
    await mountMarks();
    choose('es-1');
    await settle();
    type(boxes()[0], '১১');
    picker().focus();
    choose('es-2');
    click(dialogButton('বাদ দিন'));
    await settle();
    assert.equal(dialog(), null);
    assert.equal(picker().value, 'es-2');
    assert.equal(boxes()[0].value, '১২', 'গণিত\'s own mark, not the ১১ typed on পদার্থবিজ্ঞান');
    assert.ok(saveCopies().every((b) => b.disabled), 'nothing of পদার্থবিজ্ঞান is carried over');
    assert.equal(doc.activeElement, picker(), 'focus is on the rebuilt picker, not <body>');
  });

  test('a question closed from outside (a route change) does not silence the next one', async () => {
    await mountMarks();
    choose('es-1');
    await settle();
    type(boxes()[0], '১১');
    choose('es-2');
    assert.ok(dialog());
    closeAllOverlays();
    assert.equal(dialog(), null);
    choose('es-2');
    assert.ok(dialog(), 'the second change switched without asking, or did nothing');
    assert.equal(picker().value, 'es-1');
  });

  test('with nothing typed the picker switches straight away', async () => {
    await mountMarks();
    choose('es-1');
    await settle();
    choose('es-2');
    assert.equal(dialog(), null);
    await settle();
    assert.equal(boxes()[0].value, '১২');
  });

  test('a paper chosen during a save does not cut the save short', async () => {
    const gate = deferred<void>();
    let first = true;
    const { ops } = await mountMarks({
      enqueue: async () => { if (first) { first = false; await gate.promise; } },
    });
    choose('es-1');
    await settle();
    type(boxes()[0], '১১');
    type(boxes()[2], '২২');
    click(saveCopies()[1]);                     // the first row's enqueue is slow
    await settle();
    choose('es-2');
    click(dialogButton('বাদ দিন'));
    await settle();
    gate.resolve();
    await settle();
    assert.equal(ops.length, 2, 'the save stopped after the first row: the second was neither sent nor kept');
  });

  test('a mark changed again while the save runs stays pending', async () => {
    const gate = deferred<void>();
    const { ops } = await mountMarks({ enqueue: () => gate.promise });
    choose('es-1');
    await settle();
    type(boxes()[0], '৪৪');
    click(saveCopies()[1]);
    await settle();
    type(boxes()[0], '৪৫');                     // the teacher corrects it before the save ends
    gate.resolve();
    await settle();
    assert.equal(ops.length, 1);
    assert.equal((ops[0] as { payload: { cqMarks: number } }).payload.cqMarks, 44);
    assert.equal(boxes()[0].value, '৪৫', 'the correction was wiped from its box');
    assert.ok(saveCopies().every((b) => !b.disabled), 'and it is still offered for saving');
    assert.match(note(), /১টি পরিবর্তন/);
  });
});
