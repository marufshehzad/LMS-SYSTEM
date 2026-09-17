/**
 * UX fixes, round 3 — the marks footer belongs to the paper on screen.
 *
 * The round-2 browser re-check (work/recheck2-9802/marks3.log, r7-1280.log
 * step 10): save পদার্থবিজ্ঞান offline, open গণিত with nothing typed, and
 * গণিত's footer said "১ সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে"; after the
 * reconnect flush it said "সংরক্ষিত". Online, the same: গণিত read
 * "সংরক্ষিত" where nothing had been saved. The saved state was one set of
 * fields for the whole view and loading another sheet never touched it.
 *
 * The other half of the item: a row that is genuinely still queued for a
 * paper is still reported on THAT paper's footer — going back to it, or when
 * its save finished while another paper was open.
 *
 * Mounted the way the shell mounts it, inside a container armed with
 * keepFocusWithin, with `shikhon:outbox` dispatched as shell.ts autoFlush does.
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

const subject = (id: string, bn: string) => ({
  examSubjectId: id, subject: { bn, en: bn }, cqMax: 70, mcqMax: 30, practicalMax: 0, caMax: 0,
  markingLocked: false,
});
const EXAM = {
  id: 'ex-1', nameBn: 'অর্ধ-বার্ষিক পরীক্ষা ২০২৬', status: 'draft', academicYearId: 'yr-1',
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

/** The footer's resting sentence: nothing saved on this paper yet. */
const RESTING = /নম্বর দেওয়া অফলাইনেও কাজ করে — সংযোগ পেলে নিজেই জমা হবে।/;
const HELD = /সারি এই যন্ত্রে জমা/;
const SAVED = /সংরক্ষিত/;

interface Opts {
  /** The outbox's queue, as the sync engine's state() reports it. */
  queue?: { pending: number };
  enqueue?: () => Promise<void>;
}

let stopKeeper: () => void = () => {};
beforeEach(() => {
  localStorage.clear();
  host().textContent = '';
  setOnline(true);
});
afterEach(() => {
  closeAllOverlays();
  stopKeeper();
  stopKeeper = () => {};
  host().textContent = '';                      // the replaced view stops listening
});

async function mount(o: Opts = {}) {
  localStorage.setItem('shikhon_last_section', 'sec-1');
  const root = host();
  stopKeeper = keepFocusWithin(root);
  const ops: unknown[] = [];
  const queue = o.queue ?? { pending: 0 };
  const outbox = {
    enqueue: async (i: unknown) => {
      if (o.enqueue) await o.enqueue();
      ops.push(i);
      if (!navigator.onLine) queue.pending++;
      return { opId: `op-${ops.length}` };
    },
    flush: async () => {},
    state: async () => ({ pending: queue.pending, inflight: 0 }),
  };
  const view = new MarksView({
    root, doc,
    auth: {
      authedFetch: async (url: string) => {
        if (url.includes('/exams')) return { ok: true, status: 200, json: async () => ({ exams: [EXAM] }) };
        const id = decodeURIComponent(url.split('examSubjectId=')[1] ?? '');
        return { ok: true, status: 200, json: async () => SHEETS[id]() };
      },
    } as never,
    outbox: outbox as never,
  });
  await settle();
  return { root, ops, view, queue };
}

const picker = () => host().querySelector('[name="examSubject"]') as HTMLSelectElement;
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
const saveBottom = () => host().querySelector('[data-focus-key="marks-save-bottom"]') as HTMLButtonElement;
const caption = () => host().querySelector('caption')?.textContent ?? '';
const dialogButton = (label: string) =>
  [...(doc.querySelector('[role="alertdialog"]')?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find((b) => b.textContent?.trim() === label)!;

/** Type one mark on the paper on screen and press the footer's "সব সংরক্ষণ". */
async function saveOne(value: string): Promise<void> {
  type(boxes()[2], value);                      // বিজয়, CQ
  click(saveBottom());
  await settle();
}

describe('the marks footer belongs to the paper on screen', () => {
  test('saved offline on পদার্থবিজ্ঞান: গণিত, with nothing typed, does not say a row is held', async () => {
    await mount();
    choose('es-1');
    await settle();
    setOnline(false);
    await saveOne('৩৩');
    assert.match(note(), /১ সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে/, 'পদার্থবিজ্ঞান reports its own row');

    choose('es-2');
    await settle();
    assert.match(caption(), /গণিত/, 'গণিত is on screen');
    assert.doesNotMatch(note(), HELD, 'গণিত\'s footer carried পদার্থবিজ্ঞান\'s queued row');
    assert.doesNotMatch(note(), SAVED);
    assert.match(note(), RESTING, 'nothing was saved on গণিত');
  });

  test('the reconnect flush sends পদার্থবিজ্ঞান\'s row while গণিত is open: গণিত does not turn "সংরক্ষিত"', async () => {
    const { queue } = await mount();
    choose('es-1');
    await settle();
    setOnline(false);
    await saveOne('৩৩');
    choose('es-2');
    await settle();

    setOnline(true);
    queue.pending = 0;                          // the reconnect flush sent it
    report(0);
    await settle();
    assert.doesNotMatch(note(), SAVED, 'গণিত says "সংরক্ষিত" where nothing was saved');
    assert.doesNotMatch(note(), HELD);
    assert.match(note(), RESTING);
  });

  test('saved online on পদার্থবিজ্ঞান (1280): গণিত does not say "সংরক্ষিত"', async () => {
    await mount();
    choose('es-1');
    await settle();
    await saveOne('৩৩');
    assert.match(note(), SAVED, 'পদার্থবিজ্ঞান reports its save');

    choose('es-2');
    await settle();
    assert.doesNotMatch(note(), SAVED, 'গণিত carried পদার্থবিজ্ঞান\'s "সংরক্ষিত"');
    assert.match(note(), RESTING);
  });

  test('each paper keeps its own count: গণিত\'s save does not rewrite পদার্থবিজ্ঞান\'s', async () => {
    await mount();
    choose('es-1');
    await settle();
    setOnline(false);
    type(boxes()[0], '৪১');
    type(boxes()[2], '৩৩');
    click(saveBottom());
    await settle();
    assert.match(note(), /২ সারি এই যন্ত্রে জমা/);

    choose('es-2');
    await settle();
    await saveOne('২২');
    assert.match(note(), /১ সারি এই যন্ত্রে জমা/, 'গণিত saved one row, not পদার্থবিজ্ঞান\'s two');

    choose('es-1');
    await settle();
    assert.match(note(), /২ সারি এই যন্ত্রে জমা/,
      'পদার্থবিজ্ঞান\'s footer now reports গণিত\'s one row');
  });
});

describe('a row genuinely queued for a paper is still reported on that paper', () => {
  test('back on পদার্থবিজ্ঞান while its row is still queued, its footer says so again', async () => {
    await mount();
    choose('es-1');
    await settle();
    setOnline(false);
    await saveOne('৩৩');
    choose('es-2');
    await settle();
    assert.match(note(), RESTING);

    choose('es-1');
    await settle();
    assert.match(caption(), /পদার্থবিজ্ঞান/);
    assert.match(note(), /১ সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে/,
      'opening a paper forgot that this paper\'s row is still held on the device');
  });

  test('the row left while গণিত was open: back on পদার্থবিজ্ঞান it reads "সংরক্ষিত", not "waiting"', async () => {
    const { queue } = await mount();
    choose('es-1');
    await settle();
    setOnline(false);
    await saveOne('৩৩');
    choose('es-2');
    await settle();
    setOnline(true);
    queue.pending = 0;
    report(0);
    await settle();

    choose('es-1');
    await settle();
    assert.doesNotMatch(note(), /ইন্টারনেট এলে যাবে/, 'the row went while another paper was open');
    assert.match(note(), SAVED);
  });

  test('while another paper\'s rows are still waiting, nothing is declared sent', async () => {
    const { queue } = await mount();
    choose('es-1');
    await settle();
    setOnline(false);
    await saveOne('৩৩');
    choose('es-2');
    await settle();
    report(queue.pending);                      // still offline: the flush sent nothing
    await settle();
    choose('es-1');
    await settle();
    assert.match(note(), /১ সারি এই যন্ত্রে জমা/);
  });

  test('a save that finishes after another paper opened is reported on its own paper, not the new one', async () => {
    const gate = deferred<void>();
    let first = true;
    const { ops } = await mount({
      enqueue: async () => { if (first) { first = false; await gate.promise; } },
    });
    choose('es-1');
    await settle();
    setOnline(false);
    type(boxes()[0], '৪১');
    type(boxes()[2], '৩৩');
    click(saveBottom());                        // the first row's enqueue is slow
    await settle();
    choose('es-2');
    click(dialogButton('বাদ দিন'));
    await settle();
    gate.resolve();
    await settle();
    assert.equal(ops.length, 2, 'both পদার্থবিজ্ঞান rows were queued');
    assert.match(caption(), /গণিত/);
    assert.doesNotMatch(note(), HELD, 'গণিত claims পদার্থবিজ্ঞান\'s rows');
    assert.match(note(), RESTING);

    choose('es-1');
    await settle();
    assert.match(note(), /২ সারি এই যন্ত্রে জমা — ইন্টারনেট এলে যাবে/,
      'পদার্থবিজ্ঞান\'s two queued rows are not reported on পদার্থবিজ্ঞান');
  });
});
