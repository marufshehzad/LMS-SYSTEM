/**
 * UX fixes on the marks sheet (নম্বর এন্ট্রি): confirmed finding 67, the
 * wrong-sheet defects its keyboard fix exposes, and minor 14.
 *
 * Finding 7 (the frozen columns hiding every mark box on a phone) is CSS and
 * is pinned by ux-fix-infra-css.test.ts; the table here keeps the structure
 * that CSS targets (roll td / name th / mark cells in one scroller).
 *
 * The view is mounted the way the shell mounts it: inside a container armed
 * with keepFocusWithin, so these tests see the focus a real teacher sees.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
  { url: 'http://localhost/' });
const g = globalThis as Record<string, unknown>;
g.HTMLElement = dom.window.HTMLElement;
for (const key of ['localStorage', 'location'] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
}

const { keepFocusWithin, focusIsLost } = await import('../src/ui/dom.ts');
const { MarksView } = await import('../src/marks-view.ts');

const doc = dom.window.document;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

const subject = (id: string, bn: string) => ({
  examSubjectId: id, subject: { bn, en: bn }, cqMax: 70, mcqMax: 30, practicalMax: 0, caMax: 0,
  markingLocked: false,
});
const EXAM = {
  id: 'ex-1', nameBn: '১ম সাময়িক', status: 'draft', academicYearId: 'yr-1',
  subjects: [subject('es-1', 'পদার্থবিজ্ঞান'), subject('es-2', 'রসায়ন')],
};
const row = (n: number, bn: string, cq: number | null = null) => ({
  rollNo: n, studentId: `s-${n}`, fullName: { bn, en: null }, cqMarks: cq, mcqMarks: null,
  practicalMarks: null, caMarks: null, isAbsent: false, rowVersion: 1,
});
/** Each subject's sheet is told apart by its first student's name and CQ. */
const SHEETS: Record<string, () => unknown> = {
  'es-1': () => ({
    academicYearId: 'yr-1', examStatus: 'draft', markingLocked: false,
    maxima: { cq: 70, mcq: 30, practical: 0, ca: 0 },
    marks: [row(1, 'আনিকা', 41), row(2, 'বিজয়')],
  }),
  'es-2': () => ({
    academicYearId: 'yr-1', examStatus: 'draft', markingLocked: false,
    maxima: { cq: 70, mcq: 30, practical: 0, ca: 0 },
    marks: [row(1, 'আনিকা', 12), row(2, 'বিজয়')],
  }),
};

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const ok = (body: unknown): Reply => ({ ok: true, status: 200, json: async () => body });

interface MountOptions {
  /** Answer a sheet request; default: at once, from SHEETS. */
  sheet?: (examSubjectId: string) => Promise<Reply>;
  enqueue?: () => Promise<{ opId: string }>;
}

let stopKeeper: () => void = () => {};
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('shikhon_last_section', 'sec-1');
  (doc.activeElement as HTMLElement | null)?.blur?.();
});
afterEach(() => { stopKeeper(); stopKeeper = () => {}; });

async function mount(o: MountOptions = {}) {
  const root = doc.getElementById('root') as HTMLElement;
  root.textContent = '';
  stopKeeper = keepFocusWithin(root);
  const ops: unknown[] = [];
  new MarksView({
    root, doc,
    auth: {
      authedFetch: async (url: string) => {
        if (url.includes('/exams')) return ok({ exams: [EXAM] });
        const id = decodeURIComponent(url.split('examSubjectId=')[1] ?? '');
        return o.sheet ? o.sheet(id) : ok(SHEETS[id]());
      },
    } as never,
    outbox: {
      enqueue: async (i: unknown) => {
        if (o.enqueue) return o.enqueue();
        ops.push(i);
        return { opId: `op-${ops.length}` };
      },
      flush: async () => {},
    } as never,
  });
  await settle();
  return { root, ops };
}

const picker = (root: HTMLElement) => root.querySelector('[name="examSubject"]') as HTMLSelectElement;
/** What a keyboard change on the select does: the value moves, `change` fires. */
function choose(root: HTMLElement, value: string): void {
  const s = picker(root);
  s.value = value;
  s.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
const firstBox = (root: HTMLElement) => root.querySelector('.marks-input') as HTMLInputElement;
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
const copy = (root: HTMLElement, key: 'marks-save-top' | 'marks-save-bottom') =>
  root.querySelector(`[data-focus-key="${key}"]`) as HTMLButtonElement;
/** Enter on a focused button: it is the focused element, and it is clicked. */
function pressEnter(btn: HTMLButtonElement): void {
  btn.focus();
  assert.equal(doc.activeElement, btn, 'the button takes focus before Enter');
  btn.click();
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('67 — focus after "সব সংরক্ষণ"', () => {
  test('the phone footer copy: focus lands on the footer note that says what was saved', async () => {
    const { root, ops } = await mount();
    choose(root, 'es-1');
    await settle();
    type(firstBox(root), '৪৪');
    pressEnter(copy(root, 'marks-save-bottom'));
    await settle();

    assert.equal(ops.length, 1, 'the mark was queued');
    const note = root.querySelector('.marks-note') as HTMLElement;
    assert.equal(focusIsLost(doc), false, 'focus is not on <body> or parked on the view');
    assert.equal(doc.activeElement, note, 'focus is on the footer note beside the button');
    assert.equal(note.getAttribute('tabindex'), '-1', 'focusable by script, not a Tab stop');
    assert.match(note.textContent ?? '', /সংরক্ষিত|জমা/, 'and it reports the save');
    assert.equal(copy(root, 'marks-save-bottom').disabled, true, 'nothing is left to save');
  });

  test('moving focus to the phone footer note does not scroll the sheet', async () => {
    const { root } = await mount();
    choose(root, 'es-1');
    await settle();
    type(firstBox(root), '৪৪');
    // The note sits in the sticky save bar, inside the root's large
    // scroll-padding-bottom: a scrolling focus() would jump the page under a
    // teacher who just tapped the button. jsdom does not scroll, so the focus
    // options are what can be checked here.
    const calls: Array<{ el: Element; opts: FocusOptions | undefined }> = [];
    const proto = dom.window.HTMLElement.prototype;
    const origFocus = proto.focus;
    proto.focus = function (this: HTMLElement, opts?: FocusOptions) {
      calls.push({ el: this, opts });
      return origFocus.call(this, opts);
    };
    try {
      pressEnter(copy(root, 'marks-save-bottom'));
      await settle();
    } finally { proto.focus = origFocus; }

    const note = root.querySelector('.marks-note') as HTMLElement;
    assert.equal(doc.activeElement, note);
    const onNote = calls.filter((c) => c.el === note);
    assert.ok(onNote.length > 0, 'the note was focused');
    assert.ok(onNote.every((c) => c.opts?.preventScroll === true), 'with preventScroll');
  });

  test('the desktop header copy: focus lands on the page heading, above the picker', async () => {
    const { root } = await mount();
    choose(root, 'es-1');
    await settle();
    type(firstBox(root), '৪৪');
    pressEnter(copy(root, 'marks-save-top'));
    await settle();

    const h1 = root.querySelector('h1') as HTMLElement;
    assert.equal(focusIsLost(doc), false);
    assert.equal(doc.activeElement, h1, 'focus stays at the top, where the person was');
    assert.equal(h1.getAttribute('tabindex'), '-1');
  });

  test('a failed save: focus goes back to the same copy, and the typed mark is still in its box', async () => {
    const { root } = await mount({ enqueue: async () => { throw new Error('quota'); } });
    choose(root, 'es-1');
    await settle();
    type(firstBox(root), '৪৪');
    const origError = console.error;
    console.error = () => {};
    try {
      pressEnter(copy(root, 'marks-save-bottom'));
      await settle();
    } finally { console.error = origError; }

    const again = copy(root, 'marks-save-bottom');
    assert.equal(again.disabled, false, 'the change is still pending');
    assert.equal(doc.activeElement, again, 'focus is back on the button, ready to retry');
    // The toast says "ঘরের নম্বরগুলো ঠিক আছে": the box must still show it.
    assert.equal(firstBox(root).value, '৪৪', 'the box shows the pending mark, not the old 41');
  });

  test('focus the person moved to a mark box during the save is left with them', async () => {
    const gate = deferred<{ opId: string }>();
    const { root } = await mount({ enqueue: () => gate.promise });
    choose(root, 'es-1');
    await settle();
    type(firstBox(root), '৪৪');
    pressEnter(copy(root, 'marks-save-bottom'));
    const box = root.querySelectorAll<HTMLInputElement>('.marks-input')[2]; // row 2, CQ
    box.focus();
    gate.resolve({ opId: 'op-1' });
    await settle();

    const active = doc.activeElement as HTMLElement;
    assert.ok(active.classList.contains('marks-input'), 'still in a mark box, not moved to the note');
    assert.equal(active.getAttribute('aria-label'), box.getAttribute('aria-label'), 'the same box');
  });
});

describe('67 — choosing an exam with the keyboard', () => {
  test('the picker keeps focus through the re-render, so the next ArrowDown still works', async () => {
    const { root } = await mount();
    picker(root).focus();
    choose(root, 'es-1');
    await settle();
    assert.equal(doc.activeElement, picker(root), 'focus on the rebuilt picker after the first step');
    choose(root, 'es-2');
    await settle();
    assert.equal(doc.activeElement, picker(root), 'and after the second');
    assert.equal(picker(root).value, 'es-2');
  });

  test('stepping back up cannot land on the prompt and leave the old sheet under it', async () => {
    const { root } = await mount();
    const prompt = () => picker(root).querySelector('option[value=""]') as HTMLOptionElement;
    assert.equal(prompt().disabled, false, 'nothing chosen yet: the prompt is the selection');
    choose(root, 'es-1');
    await settle();
    assert.equal(prompt().disabled, true,
      'a subject is chosen: ArrowUp stops at the first subject instead of the prompt');
    assert.equal(picker(root).value, 'es-1');
  });

  test('stepping quickly: a late reply for the previous subject never paints over the current one', async () => {
    const pending: Record<string, ReturnType<typeof deferred<Reply>>> = {};
    const { root } = await mount({
      sheet: (id) => { pending[id] = deferred<Reply>(); return pending[id].promise; },
    });
    choose(root, 'es-1');
    await settle();
    choose(root, 'es-2');
    await settle();
    // The current subject answers first, the earlier one after it.
    pending['es-2'].resolve(ok(SHEETS['es-2']()));
    await settle();
    pending['es-1'].resolve(ok(SHEETS['es-1']()));
    await settle();

    assert.equal(picker(root).value, 'es-2');
    assert.equal(firstBox(root).value, '১২', 'রসায়ন\'s mark, not পদার্থবিজ্ঞান\'s ৪১');
    assert.match(root.querySelector('caption')?.textContent ?? '', /রসায়ন/);
  });

  test('a subject with no cached copy never shows the previous subject\'s marks under its name', async () => {
    const pending: Record<string, ReturnType<typeof deferred<Reply>>> = {};
    const { root } = await mount({
      sheet: (id) => {
        if (id === 'es-1') return Promise.resolve(ok(SHEETS['es-1']()));
        pending[id] = deferred<Reply>();
        return pending[id].promise;
      },
    });
    choose(root, 'es-1');
    await settle();
    assert.equal(firstBox(root).value, '৪১', 'পদার্থবিজ্ঞান loaded');

    choose(root, 'es-2');
    await settle();
    assert.equal(root.querySelector('.marks-input'), null,
      'while রসায়ন loads, no mark boxes — the old sheet is not offered as রসায়ন');

    // Offline, nothing cached for রসায়ন: the error state, not পদার্থবিজ্ঞান's marks.
    pending['es-2'].resolve({ ok: false, status: 503, json: async () => ({}) });
    await settle();
    assert.equal(root.querySelector('.marks-input'), null);
    assert.equal(root.querySelector('.marks-offline'), null, 'no "সর্বশেষ সংরক্ষিত নম্বর" banner');
    assert.match(root.textContent ?? '', /নম্বরের তালিকা আনা গেল না/);
  });
});

describe('minor 14 — the over-max message is tied to its box', () => {
  test('aria-describedby points at the message while the box is invalid, and goes with it', async () => {
    const { root } = await mount();
    choose(root, 'es-1');
    await settle();
    const box = firstBox(root);
    type(box, '৯৯');
    const id = box.getAttribute('aria-describedby');
    assert.ok(id, 'the invalid box is described');
    const msg = doc.getElementById(id!);
    assert.ok(msg, 'by an element that exists');
    assert.equal(msg!.className, 'marks-error');
    assert.match(msg!.textContent ?? '', /সর্বোচ্চ ৭০ — সংরক্ষণ হয়নি/);

    type(box, '৬৫');
    assert.equal(box.getAttribute('aria-describedby'), null, 'cleared with the error');
    assert.equal(box.getAttribute('aria-invalid'), null);
  });
});
