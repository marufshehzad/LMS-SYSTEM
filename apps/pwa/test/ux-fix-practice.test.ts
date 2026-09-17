/**
 * UX sweep — the practice card (group practice).
 *
 * Finding 1 (blocker): a student could not answer a numeric practice question.
 * Typing left "যাচাই করো" disabled for good — the button's disabled state was
 * worked out once per render, and typing never caused a render — Enter did
 * nothing, and the card had no other control, so the set could never reach
 * "শেষ করো" and finishing practice never marked the topic done. Short answer
 * went through the same branch.
 *
 * What is locked here:
 *   - typing enables the button and emptying the box disables it again, on
 *     the SAME input node (rebuilding it would end a Bangla keyboard's
 *     composition);
 *   - Enter checks, but not while a keyboard is still composing;
 *   - a Bangla-digit answer ("৩") is accepted and sent as the number 3 (a
 *     type="number" box drops the digit outright, so the button could never
 *     be enabled by it);
 *   - something that is not a number is not an attempt: it is named at the
 *     box, nothing is queued, the text stays;
 *   - after checking, focus is on the verdict, not <body>;
 *   - the whole set can be walked to "শেষ করো" and onDone.
 *
 * Minor 27, in the same file: the difficulty dots had an aria-label on a
 * role-less span (read out as "●●○○○"), and the radiogroup's options ignored
 * the arrow keys.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { PracticeView, type PracticeQuestion } from '../src/practice-view.ts';
import { keepFocusWithin, focusIsLost } from '../src/ui/dom.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

before(() => {
  dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="root"></main></body></html>',
    { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  Object.defineProperty(globalThis, 'localStorage',
    { value: dom.window.localStorage, configurable: true, writable: true });
});

const progress = { attempts: 0, solved: false, lastResponseMs: null };

const MCQ: PracticeQuestion = {
  id: 'q-mcq', questionNo: 1, kind: 'mcq',
  stemBn: '৫ সেকেন্ডে বেগ ১০ থেকে ৩০ m/s হলে ত্বরণ কত?', explanationBn: null,
  difficulty: 2, numericAnswer: null, numericTolerance: null,
  options: [
    { id: 'o-a', optionNo: 1, textBn: '২ m/s²', isCorrect: false },
    { id: 'o-b', optionNo: 2, textBn: '৪ m/s²', isCorrect: true },
    { id: 'o-c', optionNo: 3, textBn: '৬ m/s²', isCorrect: false },
  ],
  myProgress: progress,
};
const NUMERIC: PracticeQuestion = {
  id: 'q-num', questionNo: 2, kind: 'numeric',
  stemBn: 'একটি বাস ৮ সেকেন্ডে ২৪ m/s থেকে থেমে গেলে তার মন্দন কত?',
  explanationBn: 'a = (০ − ২৪)/৮ = −৩ m/s²।',
  difficulty: 3, numericAnswer: '3', numericTolerance: '0.01',
  options: [], myProgress: progress,
};
const SHORT: PracticeQuestion = {
  id: 'q-short', questionNo: 1, kind: 'short_answer',
  stemBn: 'ত্বরণের একক কী?', explanationBn: null,
  difficulty: 1, numericAnswer: null, numericTolerance: null,
  options: [], myProgress: progress,
};

interface Mounted {
  root: HTMLElement;
  sent: Array<Record<string, unknown>>;
  done: () => number;
}

function mount(questions: PracticeQuestion[]): Mounted {
  const d = doc();
  const main = d.getElementById('root') as HTMLElement;
  main.textContent = '';
  const root = d.createElement('div');
  main.append(root);
  const sent: Array<Record<string, unknown>> = [];
  let doneCount = 0;
  new PracticeView({
    root, doc: d, questions,
    outbox: {
      enqueue: async (op) => { sent.push(op.payload as Record<string, unknown>); return { opId: `op-${sent.length}` }; },
      flush: async () => undefined,
    },
    onDone: () => { doneCount += 1; },
  });
  return { root, sent, done: () => doneCount };
}

const checkButton = (root: HTMLElement) => {
  const btn = [...root.querySelectorAll<HTMLButtonElement>('.prac-actions button')]
    .find((b) => b.textContent?.includes('যাচাই করো'));
  assert.ok(btn, 'the card has its যাচাই করো button');
  return btn;
};
const answerBox = (root: HTMLElement) => {
  const input = root.querySelector<HTMLInputElement>('.prac-input');
  assert.ok(input, 'the card has its answer box');
  return input;
};
function type(input: HTMLInputElement, value: string): void {
  input.focus();
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
function key(target: HTMLElement, k: string, init: Record<string, unknown> = {}): KeyboardEvent {
  const e = new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
const verdictText = (root: HTMLElement) => root.querySelector('.prac-verdict')?.textContent ?? null;

describe('finding 1 — a typed answer can be checked', () => {
  test('typing enables যাচাই করো, emptying disables it, and the box is never rebuilt', () => {
    const { root } = mount([NUMERIC]);
    const input = answerBox(root);
    assert.equal(checkButton(root).disabled, true, 'nothing typed yet: nothing to check');

    type(input, '3');
    assert.equal(input.isConnected, true, 'the same box is still in the card');
    assert.equal(answerBox(root), input, 'typing must not rebuild the box (Bangla composition)');
    assert.equal(checkButton(root).disabled, false, 'a typed answer can be checked');

    type(input, '   ');
    assert.equal(checkButton(root).disabled, true, 'blank again: nothing to check');
    type(input, '3');
    assert.equal(checkButton(root).disabled, false);
  });

  test('tapping যাচাই করো after typing marks the answer and queues it', async () => {
    const { root, sent } = mount([NUMERIC]);
    type(answerBox(root), '3');
    checkButton(root).click();
    await settle();
    assert.equal(verdictText(root), 'ঠিক হয়েছে');
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.answerNumeric, 3);
    assert.equal(sent[0]!.questionId, 'q-num');
  });

  test('Enter in the answer box checks it', async () => {
    const { root, sent } = mount([NUMERIC]);
    const input = answerBox(root);
    type(input, '5');
    const e = key(input, 'Enter');
    assert.equal(e.defaultPrevented, true, 'Enter is taken by the check');
    await settle();
    assert.equal(verdictText(root), 'আবার ভাবো', 'a wrong number is marked wrong');
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.answerNumeric, 5);
  });

  test('Enter while a keyboard is still composing does not check', async () => {
    const { root, sent } = mount([NUMERIC]);
    const input = answerBox(root);
    type(input, '3');
    key(input, 'Enter', { isComposing: true });
    await settle();
    assert.equal(sent.length, 0, 'that Enter belonged to the composition');
    assert.equal(verdictText(root), null);
  });

  test('an answer in Bangla digits is accepted and sent as a number', async () => {
    const { root, sent } = mount([NUMERIC]);
    const input = answerBox(root);
    // A type="number" box drops "৩" outright (checked in Chrome), so the
    // button could never be enabled by a Bangla-digit answer.
    assert.equal(input.type, 'text');
    assert.equal(input.getAttribute('inputmode'), 'decimal', 'still the numeric keypad on a phone');
    type(input, '৩');
    assert.equal(input.value, '৩', 'the digit stays in the box');
    assert.equal(checkButton(root).disabled, false);
    checkButton(root).click();
    await settle();
    assert.equal(verdictText(root), 'ঠিক হয়েছে');
    assert.equal(sent[0]!.answerNumeric, 3, 'the server gets a number, not NaN or null');
  });

  test('something that is not a number is named at the box, and nothing is queued', async () => {
    const { root, sent } = mount([NUMERIC]);
    const input = answerBox(root);
    type(input, '৩ m/s');
    checkButton(root).click();
    await settle();

    assert.equal(sent.length, 0, 'not an attempt');
    assert.equal(verdictText(root), null, 'not marked wrong for a slip of the keyboard');
    assert.equal(answerBox(root), input, 'the box and what was typed stay');
    assert.equal(input.value, '৩ m/s');
    const err = root.querySelector<HTMLElement>('.prac-input-error');
    assert.ok(err, 'the error is shown');
    assert.equal(err.textContent, 'উত্তরটি সংখ্যায় লেখো');
    assert.equal(err.getAttribute('role'), 'alert');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(input.getAttribute('aria-describedby'), err.id);
    assert.equal(doc().activeElement, input, 'focus stays in the box to fix it');

    type(input, '৩');
    assert.equal(root.querySelector('.prac-input-error'), null, 'the error clears as they type');
    assert.equal(input.hasAttribute('aria-invalid'), false);
    assert.equal(input.hasAttribute('aria-describedby'), false);
    key(input, 'Enter');
    await settle();
    assert.equal(verdictText(root), 'ঠিক হয়েছে');
    assert.equal(sent.length, 1);
  });

  test('a short answer is enabled by typing and sent on Enter', async () => {
    const { root, sent } = mount([SHORT]);
    const input = answerBox(root);
    assert.equal(checkButton(root).disabled, true);
    type(input, ' মিটার/সেকেন্ড² ');
    assert.equal(checkButton(root).disabled, false);
    key(input, 'Enter');
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.answerText, 'মিটার/সেকেন্ড²');
    assert.equal(verdictText(root), 'উত্তর জমা হয়েছে — শিক্ষক যাচাই করবেন');
  });

  test('after checking, focus is on the verdict, not <body>', async () => {
    // By Enter: the box comes back disabled, and the shell's keeper waits
    // for a disabled control rather than moving focus — so nothing else
    // would take focus off <body>.
    let m = mount([NUMERIC]);
    let input = answerBox(m.root);
    type(input, '3');
    key(input, 'Enter');
    await settle();
    let verdict = m.root.querySelector<HTMLElement>('.prac-verdict');
    assert.ok(verdict);
    assert.equal(doc().activeElement, verdict, 'Enter: focus on the verdict');

    // By the button, with the shell's keeper armed on the view as in the app.
    const stop = keepFocusWithin(doc().getElementById('root') as HTMLElement);
    try {
      m = mount([NUMERIC]);
      input = answerBox(m.root);
      type(input, '3');
      const btn = checkButton(m.root);
      btn.focus();
      btn.click();
      await settle();
      verdict = m.root.querySelector<HTMLElement>('.prac-verdict');
      assert.ok(verdict);
      assert.equal(doc().activeElement, verdict, 'button: focus on the verdict');
      assert.equal(focusIsLost(doc()), false);
    } finally {
      stop();
    }
  });

  test('the whole set can be walked to শেষ করো, which finishes it', async () => {
    const { root, sent, done } = mount([MCQ, NUMERIC]);
    const options = root.querySelectorAll<HTMLButtonElement>('.prac-option');
    options[1]!.click();
    checkButton(root).click();
    await settle();
    assert.equal(verdictText(root), 'ঠিক হয়েছে');
    [...root.querySelectorAll<HTMLButtonElement>('.prac-actions button')]
      .find((b) => b.textContent?.includes('পরের প্রশ্ন'))!.click();

    const input = answerBox(root);
    type(input, '3');
    key(input, 'Enter');
    await settle();
    assert.equal(verdictText(root), 'ঠিক হয়েছে');
    const finish = [...root.querySelectorAll<HTMLButtonElement>('.prac-actions button')]
      .find((b) => b.textContent?.includes('শেষ করো'));
    assert.ok(finish, 'the last question offers শেষ করো');
    finish.click();
    assert.equal(done(), 1, 'finishing practice reaches onDone (which marks the topic done)');
    assert.equal(sent.length, 2);
  });
});

describe('minor 27 — difficulty and the option group, to a screen reader and a keyboard', () => {
  test('the difficulty dots are an image with a spoken name', () => {
    const { root } = mount([NUMERIC]);
    const diff = root.querySelector<HTMLElement>('.prac-difficulty');
    assert.ok(diff);
    assert.equal(diff.getAttribute('role'), 'img', 'an aria-label on a role-less span is not read');
    assert.equal(diff.getAttribute('aria-label'), 'কঠিনতা ৩ / ৫');
  });

  test('arrow keys move and select within the options, with one Tab stop', () => {
    const { root } = mount([MCQ]);
    const opts = () => [...root.querySelectorAll<HTMLButtonElement>('.prac-option')];
    const checked = () => opts().map((b) => b.getAttribute('aria-checked'));
    const tabStops = () => opts().map((b) => b.tabIndex);

    assert.deepEqual(tabStops(), [0, -1, -1], 'nothing chosen: the first option is the Tab stop');
    opts()[0]!.focus();

    let e = key(opts()[0]!, 'ArrowDown');
    assert.equal(e.defaultPrevented, true);
    assert.deepEqual(checked(), ['false', 'true', 'false'], 'ArrowDown chooses the next option');
    assert.equal(doc().activeElement, opts()[1], 'and focus goes with it');
    assert.deepEqual(tabStops(), [-1, 0, -1], 'the chosen option is the Tab stop');
    assert.equal(checkButton(root).disabled, false, 'an option chosen by keyboard can be checked');

    key(opts()[1]!, 'ArrowRight');
    assert.equal(doc().activeElement, opts()[2]);
    key(opts()[2]!, 'ArrowDown');
    assert.deepEqual(checked(), ['true', 'false', 'false'], 'wraps from the last to the first');
    assert.equal(doc().activeElement, opts()[0]);
    key(opts()[0]!, 'ArrowUp');
    assert.deepEqual(checked(), ['false', 'false', 'true'], 'ArrowUp wraps to the last');
    key(opts()[2]!, 'Home');
    assert.deepEqual(checked(), ['true', 'false', 'false']);
    key(opts()[0]!, 'End');
    assert.deepEqual(checked(), ['false', 'false', 'true']);
    assert.equal(doc().activeElement, opts()[2]);

    e = key(opts()[2]!, 'Tab');
    assert.equal(e.defaultPrevented, false, 'Tab is left to the browser');
  });

  test('an option keeps a stable focus key across the reveal, when its name changes', async () => {
    const { root } = mount([MCQ]);
    const before = [...root.querySelectorAll<HTMLElement>('.prac-option')].map((b) => b.dataset.focusKey);
    root.querySelectorAll<HTMLButtonElement>('.prac-option')[1]!.click();
    checkButton(root).click();
    await settle();
    const after = [...root.querySelectorAll<HTMLElement>('.prac-option')].map((b) => b.dataset.focusKey);
    assert.deepEqual(before, ['prac-opt-o-a', 'prac-opt-o-b', 'prac-opt-o-c']);
    assert.deepEqual(after, before);
  });
});
