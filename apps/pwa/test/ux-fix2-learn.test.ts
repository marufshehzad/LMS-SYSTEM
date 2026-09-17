/**
 * UX sweep, round 2 — group learn (learn-view, subjects-view, practice-view).
 *
 * Finding 15, the half the demo-data fix did not reach: the screen logic.
 *   - A subject with no chapters on আমার বিষয় was a button that opened
 *     পড়াশোনা on a different subject. It is now a plain row that says there
 *     are no chapters yet.
 *   - পড়াশোনা opened with a subject that has no chapters (or an unknown id)
 *     silently showed the first subject. It now shows the first subject UNDER
 *     a notice naming the one asked for, said once aloud; the student's own
 *     pick clears it. While a saved list that predates the subject is on
 *     screen and the fresh one is still coming, it waits in the loading state
 *     instead of painting another subject.
 *
 * Finding 12, part (b), and the focus landing places of part (a):
 *   - "পাঠ সম্পন্ন" disabled itself under the finger, and the browser blurred
 *     it to <body>. It is now aria-disabled: focus stays, a second press is
 *     inert, and a re-render does not offer it again.
 *   - Opening a chapter or a lesson lands on the new view's title (the shell
 *     keeper's heading landing — confirmed here against learn-view's views,
 *     skeleton then data); back from a chapter lands on the chapter row that
 *     opened it; back from a lesson lands on its chapter's title while the
 *     lessons load, then on that lesson's row; "অনুশীলন করো", "পরের
 *     প্রশ্ন" and "আবার চেষ্টা করো" land on the question (its first option, or
 *     the stem for a typed answer — never the box, which would raise a phone
 *     keyboard); "শেষ করো" lands on "অনুশীলন করো". All with the shell's focus
 *     keeper armed on the view, as in the app — without these, focus parked
 *     on the view container and the next Tab started again at the top.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { LearnView } from '../src/learn-view.ts';
import { SubjectsView, cachedSubjectName, type SubjectRow } from '../src/subjects-view.ts';
import { PracticeView, type PracticeQuestion } from '../src/practice-view.ts';
import { keepFocusWithin, focusIsLost } from '../src/ui/dom.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

before(() => {
  dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="root"></main></body></html>',
    { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  // jsdom has no scrollIntoView; the practice section calls it on mount.
  (dom.window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

let stopKeeper: (() => void) | null = null;
beforeEach(() => { localStorage.clear(); location.hash = ''; });
afterEach(() => { stopKeeper?.(); stopKeeper = null; });

const root = () => doc().getElementById('root') as HTMLElement;
/** The shell arms its keeper on the view before a route mounts; so do these tests. */
function armKeeper(): void { stopKeeper = keepFocusWithin(root()); }

/* ── fixtures ─────────────────────────────────────────────────────────── */

const PHYSICS = { id: 'sub-phy', bn: 'পদার্থবিজ্ঞান', en: 'Physics' };
const CHEM = { id: 'sub-chem', bn: 'রসায়ন', en: 'Chemistry' };
function chapter(id: string, subject: typeof PHYSICS, bn: string) {
  return {
    id, chapterNo: 1, name: { bn, en: null }, summaryBn: null, estMinutes: 20, isPublished: true,
    subject, prerequisite: null, topicCount: 2, completedCount: 0,
  };
}
const CH_MOTION = chapter('ch-motion', PHYSICS, 'অধ্যায় ৫: গতি');
const CH_FORCE = chapter('ch-force', PHYSICS, 'অধ্যায় ৬: বল');
const CH_MOLE = chapter('ch-mole', CHEM, 'অধ্যায় ৬: মোলের ধারণা');
const TOPICS = [
  { id: 'tp-1', topicNo: 1, title: { bn: 'দূরত্ব ও সরণ', en: null }, estMinutes: 5, isPublished: true, progress: null },
  { id: 'tp-2', topicNo: 2, title: { bn: 'ত্বরণ', en: null }, estMinutes: 5, isPublished: true, progress: null },
];
const READER = {
  topic: { title: { bn: 'ত্বরণ' } },
  blocks: [{ id: 'b1', blockNo: 1, kind: 'text', bodyBn: 'বেগের পরিবর্তনের হার।', mediaKey: null, altTextBn: null, captionBn: null }],
};
const progress = { attempts: 0, solved: false, lastResponseMs: null };
const MCQ1: PracticeQuestion = {
  id: 'q1', questionNo: 1, kind: 'mcq', stemBn: 'ত্বরণের একক কোনটি?', explanationBn: null,
  difficulty: 2, numericAnswer: null, numericTolerance: null,
  options: [
    { id: 'o1a', optionNo: 1, textBn: 'm/s', isCorrect: false },
    { id: 'o1b', optionNo: 2, textBn: 'm/s²', isCorrect: true },
  ],
  myProgress: progress,
};
const MCQ2: PracticeQuestion = {
  ...MCQ1, id: 'q2', questionNo: 2, stemBn: 'বেগের একক কোনটি?',
  options: [
    { id: 'o2a', optionNo: 1, textBn: 'm/s', isCorrect: true },
    { id: 'o2b', optionNo: 2, textBn: 'm', isCorrect: false },
  ],
};
const NUMERIC: PracticeQuestion = {
  id: 'q3', questionNo: 3, kind: 'numeric', stemBn: '৮ সেকেন্ডে ২৪ m/s থেকে থামলে মন্দন কত?',
  explanationBn: null, difficulty: 3, numericAnswer: '3', numericTolerance: '0.01', options: [], myProgress: progress,
};

function subjectRow(subjectId: string, nameBn: string, total: number, done = 0): SubjectRow {
  return {
    subjectId, nameBn, nctbCode: null, requirementType: 'compulsory', requirementLabelBn: 'আবশ্যিক',
    totalChapters: total, completedChapters: done, progressPercent: 0, nextChapter: null,
  };
}

type Reply = { ok: boolean; status: number; body?: unknown } | 'throw';
const ok = (body: unknown): Reply => ({ ok: true, status: 200, body });

/** The default school: physics and chemistry chapters, two lessons, no practice. */
function school(over: { chapters?: unknown[]; questions?: PracticeQuestion[] } = {}) {
  return (url: string): Reply => (
    url.includes('/chapters') ? ok({ chapters: over.chapters ?? [CH_MOTION, CH_FORCE, CH_MOLE] })
    : url.includes('/practice') ? ok({ questions: over.questions ?? [] })
    : url.includes('topicId=') ? ok(READER)
    : ok({ topics: TOPICS }));
}

function mountLearn(answer: (url: string) => Reply | Promise<Reply>, extra: { subjectId?: string } = {}) {
  const r = root();
  r.textContent = '';
  const calls: string[] = [];
  const ops: Array<{ entity: string; payload: Record<string, unknown> }> = [];
  const auth = {
    role: 'student', userId: 's-1',
    authedFetch: async (url: string) => {
      calls.push(url);
      const reply = await answer(url);
      if (reply === 'throw') throw new TypeError('Failed to fetch');
      return { ok: reply.ok, status: reply.status, json: async () => reply.body };
    },
  } as never;
  const outbox = {
    enqueue: async (op: { entity: string; payload: Record<string, unknown> }) => { ops.push(op); return { opId: `op-${ops.length}` }; },
    flush: async () => undefined,
  } as never;
  new LearnView({ root: r, doc: doc(), auth, outbox, classId: 'cls-1', ...extra });
  return { root: r, calls, ops };
}

/** A promise with its resolver, for a request that answers when the test says. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const select = (r: HTMLElement) => r.querySelector('.learn-subject select') as HTMLSelectElement;
const chapterNames = (r: HTMLElement) =>
  [...r.querySelectorAll('.chapter-card .chapter-title')].map((n) => n.textContent);
const buttonNamed = (r: HTMLElement, text: string) =>
  [...r.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
/** Focus a control and press it, as Enter on a focused button does. */
function press(el: HTMLElement | null | undefined): void {
  assert.ok(el, 'the control to press is on screen');
  el.focus();
  el.click();
}
const active = () => doc().activeElement as HTMLElement | null;

/* ── finding 15 ───────────────────────────────────────────────────────── */

describe('finding 15 — আমার বিষয়: a subject with no chapters leads nowhere, so it is not a button', () => {
  function mountSubjects(rows: SubjectRow[]) {
    const r = root();
    r.textContent = '';
    const opened: string[] = [];
    const auth = {
      role: 'student', userId: 's-1',
      authedFetch: async () => ({ ok: true, status: 200, json: async () => ({ subjects: rows }) }),
    } as never;
    new SubjectsView({ root: r, doc: doc(), auth, onOpenSubject: (id) => { opened.push(id); } });
    return { root: r, opened };
  }

  test('a ০/০ subject is a plain row that says why; a subject with chapters still opens', async () => {
    const { root: r, opened } = mountSubjects([
      subjectRow('sub-phy', 'পদার্থবিজ্ঞান', 11, 4),
      subjectRow('sub-ict', 'তথ্য ও যোগাযোগ প্রযুক্তি', 0),
    ]);
    await settle();
    const items = [...r.querySelectorAll<HTMLElement>('.subj-rows > li')];
    assert.equal(items.length, 2, 'both subjects are still listed');

    const [phy, ict] = items as [HTMLElement, HTMLElement];
    const phyHit = phy.querySelector<HTMLButtonElement>('button.ui-list-hit');
    assert.ok(phyHit, 'a subject with chapters is still a button');
    assert.match(phyHit.getAttribute('aria-label') ?? '', /— খুলুন$/);
    phyHit.click();
    assert.deepEqual(opened, ['sub-phy']);

    assert.equal(ict.querySelector('button'), null, 'nothing to open: not a button, not a Tab stop');
    const hit = ict.querySelector<HTMLElement>('.ui-list-hit');
    assert.ok(hit?.classList.contains('is-static'), 'drawn as a static row');
    assert.equal(ict.querySelector('.ui-list-sub')?.textContent, 'এখনো কোনো অধ্যায় যুক্ত হয়নি',
      'it says what is missing instead of "০/০ অধ্যায়"');
    assert.match(ict.textContent ?? '', /তথ্য ও যোগাযোগ প্রযুক্তি/);
  });

  test('the saved list names a subject for পড়াশোনা, and nothing else is read', async () => {
    mountSubjects([subjectRow('sub-ict', 'তথ্য ও যোগাযোগ প্রযুক্তি', 0)]);
    await settle();
    assert.equal(cachedSubjectName('sub-ict'), 'তথ্য ও যোগাযোগ প্রযুক্তি');
    assert.equal(cachedSubjectName('sub-none'), null);
    localStorage.setItem('shikhon_my_subjects', '{not json');
    assert.equal(cachedSubjectName('sub-ict'), null, 'a damaged cache is no name, not a crash');
  });
});

describe('finding 15 — পড়াশোনা never silently shows another subject', () => {
  test('a subject with no chapters: the first subject is shown under a notice that names it', async () => {
    localStorage.setItem('shikhon_my_subjects', JSON.stringify([subjectRow('sub-ict', 'তথ্য ও যোগাযোগ প্রযুক্তি', 0)]));
    const { root: r, calls } = mountLearn(school(), { subjectId: 'sub-ict' });
    await settle();

    const notice = r.querySelector<HTMLElement>('.learn-list > .learn-missing');
    assert.ok(notice, 'a notice, inside the list shell');
    assert.equal(notice.querySelector('.learn-missing-text')?.textContent,
      'তথ্য ও যোগাযোগ প্রযুক্তি বিষয়ে এখনো কোনো অধ্যায় যুক্ত হয়নি। নিচে অন্য বিষয় বেছে নাও।');
    assert.ok(notice.compareDocumentPosition(r.querySelector('.learn-subject')!) & 4,
      'above the subject strip it explains');
    assert.equal(select(r).value, 'sub-phy', 'the first subject is still there to browse');
    assert.deepEqual(chapterNames(r), ['অধ্যায় ৫: গতি', 'অধ্যায় ৬: বল']);
    const host = doc().querySelector('.ui-toast-host');
    assert.match(host?.textContent ?? '', /তথ্য ও যোগাযোগ প্রযুক্তি বিষয়ে এখনো কোনো অধ্যায় যুক্ত হয়নি/,
      'said once to a screen reader, which does not read a notice that simply appears');
    assert.equal(calls.filter((u) => u.includes('/chapters')).length, 1, 'nothing extra is fetched');
    assert.ok(!calls.some((u) => u.includes('subject')), 'and no subject query is added');

    const action = notice.querySelector<HTMLButtonElement>('button.learn-missing-action');
    assert.ok(action, 'with a way back to the subject list');
    assert.equal(action.textContent, 'আমার বিষয় দেখো');
    assert.ok(action.classList.contains('btn-ghost'), 'a ghost action, not a second primary');
    action.click();
    assert.equal(location.hash, '#/subjects');
  });

  test('an unknown id with no saved name still says so, and the student\'s own pick clears it', async () => {
    const { root: r } = mountLearn(school(), { subjectId: 'demo-sub-999' });
    await settle();
    const notice = r.querySelector<HTMLElement>('.learn-missing');
    assert.ok(notice);
    assert.equal(notice.querySelector('.learn-missing-text')?.textContent,
      'এই বিষয়ে এখনো কোনো অধ্যায় যুক্ত হয়নি। নিচে অন্য বিষয় বেছে নাও।');

    const sel = select(r);
    sel.focus();
    sel.value = 'sub-chem';
    sel.dispatchEvent(new dom.window.Event('change'));
    assert.equal(r.querySelector('.learn-missing'), null, 'answered by the pick, so it goes');
    assert.equal(select(r), sel, 'the select is not rebuilt');
    assert.equal(active(), sel, 'focus stays on it');
    assert.deepEqual(chapterNames(r), ['অধ্যায় ৬: মোলের ধারণা']);

    press(r.querySelector<HTMLElement>('.chapter-card'));
    await settle();
    press(r.querySelector<HTMLElement>('.ui-back'));
    await settle();
    assert.equal(r.querySelector('.learn-missing'), null, 'and does not come back');
    assert.equal(select(r).value, 'sub-chem');
  });

  test('a name with a figure keeps the figure in the numeral face (R6)', async () => {
    localStorage.setItem('shikhon_my_subjects', JSON.stringify([subjectRow('sub-eng1', 'ইংরেজি ১ম পত্র', 0)]));
    const { root: r } = mountLearn(school(), { subjectId: 'sub-eng1' });
    await settle();
    const fig = r.querySelector('.learn-missing-text .n');
    assert.equal(fig?.textContent, '১');
  });

  test('a saved list that predates the subject: loading, not another subject, until the fresh one answers', async () => {
    localStorage.setItem('shikhon_chapters_cache', JSON.stringify([CH_MOTION, CH_FORCE]));
    const gate = deferred<Reply>();
    const { root: r } = mountLearn((url) => (url.includes('/chapters') ? gate.promise : ok({})), { subjectId: 'sub-chem' });
    await settle();
    assert.ok(r.querySelector('.is-skeleton'), 'the loading state while the fresh list is on its way');
    assert.equal(r.querySelector('.chapter-card'), null, 'no physics chapter painted under a chemistry tap');
    assert.equal(r.querySelector('h1')?.textContent, 'পড়াশোনা', 'the page still names itself');

    gate.resolve(ok({ chapters: [CH_MOTION, CH_FORCE, CH_MOLE] }));
    await settle();
    assert.equal(r.querySelector('.is-skeleton'), null);
    assert.equal(select(r).value, 'sub-chem', 'the tapped subject, once it arrives');
    assert.equal(r.querySelector('.learn-missing'), null, 'and no notice: it has chapters');
  });

  test('offline, a subject the saved list lacks is named with the offline reason', async () => {
    localStorage.setItem('shikhon_chapters_cache', JSON.stringify([CH_MOTION]));
    localStorage.setItem('shikhon_my_subjects', JSON.stringify([subjectRow('sub-chem', 'রসায়ন', 6)]));
    const { root: r } = mountLearn(() => 'throw', { subjectId: 'sub-chem' });
    await settle();
    assert.ok(r.querySelector('.learn-list > .offline-banner'), 'the offline banner stays');
    assert.equal(r.querySelector('.learn-missing-text')?.textContent,
      'রসায়ন বিষয়ের অধ্যায় এই যন্ত্রে সংরক্ষিত নেই। ইন্টারনেট এলে আবার খোলো, বা নিচে অন্য বিষয় বেছে নাও।');
    assert.deepEqual(chapterNames(r), ['অধ্যায় ৫: গতি'], 'the saved chapters are still readable');
  });

  test('a subject that has chapters opens with no notice', async () => {
    const { root: r } = mountLearn(school(), { subjectId: 'sub-chem' });
    await settle();
    assert.equal(select(r).value, 'sub-chem');
    assert.equal(r.querySelector('.learn-missing'), null);
  });
});

/* ── finding 12(b) ────────────────────────────────────────────────────── */

async function openReader(r: HTMLElement, topicIndex = 1): Promise<void> {
  await settle();
  press(r.querySelector<HTMLElement>('.chapter-card'));
  await settle();
  press(r.querySelectorAll<HTMLElement>('.topic-card')[topicIndex]);
  await settle();
}

describe('finding 12(b) — "পাঠ সম্পন্ন" keeps focus when pressed', () => {
  test('pressed from the keyboard, focus stays on it; it reads done; a second press is inert', async () => {
    armKeeper();
    const { root: r, ops } = mountLearn(school());
    await openReader(r);
    const done = buttonNamed(r, 'পাঠ সম্পন্ন');
    press(done);
    await settle();

    assert.equal(done!.disabled, false, 'not `disabled`: the browser blurs a disabled button to <body>');
    assert.equal(done!.getAttribute('aria-disabled'), 'true', 'still announced as unavailable');
    assert.equal(done!.textContent, 'সম্পন্ন হয়েছে');
    assert.equal(active(), done, 'focus is where the student pressed');
    assert.equal(focusIsLost(doc()), false);
    assert.match(doc().querySelector('.ui-toast-host')?.textContent ?? '', /পাঠটি সম্পন্ন হিসেবে রাখা হলো/);

    press(done);
    await settle();
    assert.equal(ops.filter((o) => o.payload.state === 'completed').length, 1, 'one completion, as before');
  });

  test('a re-render after pressing it (practice arriving late) keeps it done, and keeps focus on it', async () => {
    armKeeper();
    const late = deferred<Reply>();
    const base = school();
    const { root: r } = mountLearn((url) => (url.includes('/practice') ? late.promise : base(url)));
    await openReader(r);
    press(buttonNamed(r, 'পাঠ সম্পন্ন'));
    await settle();

    late.resolve(ok({ questions: [] }));
    await settle();
    const done = r.querySelector<HTMLButtonElement>('.topic-done');
    assert.ok(done && done.isConnected);
    assert.equal(done.textContent, 'সম্পন্ন হয়েছে', 'not offered again after the rebuild');
    assert.equal(done.getAttribute('aria-disabled'), 'true');
    assert.equal(active(), done, 'focus follows it into the rebuilt reader');
  });
});

/* ── finding 12(a): where focus lands ─────────────────────────────────── */

describe('finding 12(a) — a view change lands focus somewhere sensible, not on the page container', () => {
  test('a chapter lands on its title, which keeps focus through the load', async () => {
    armKeeper();
    const gate = deferred<Reply>();
    const base = school();
    const { root: r } = mountLearn((url) => (url.includes('chapterId=') ? gate.promise : base(url)));
    await settle();
    press(r.querySelector<HTMLElement>('.chapter-card'));
    await settle();

    let h1 = r.querySelector<HTMLElement>('h1');
    assert.equal(h1?.textContent, 'অধ্যায় ৫: গতি');
    assert.ok(r.querySelector('.is-skeleton'), 'still loading');
    assert.equal(active(), h1, 'on the new title while the lessons load');

    gate.resolve(ok({ topics: TOPICS }));
    await settle();
    h1 = r.querySelector<HTMLElement>('h1');
    assert.ok(r.querySelector('.topic-card'), 'the lessons arrived');
    assert.equal(active(), h1, 'still on the (rebuilt) title');
  });

  test('a lesson lands on its title', async () => {
    armKeeper();
    const { root: r } = mountLearn(school());
    await openReader(r);
    const h1 = r.querySelector<HTMLElement>('h1');
    assert.equal(h1?.textContent, 'ত্বরণ');
    assert.equal(active(), h1);
  });

  test('back from a chapter lands on the chapter row that opened it', async () => {
    armKeeper();
    const { root: r } = mountLearn(school());
    await settle();
    press(r.querySelectorAll<HTMLElement>('.chapter-card')[1]);
    await settle();
    press(r.querySelector<HTMLElement>('.ui-back'));
    await settle();
    const row = r.querySelectorAll<HTMLElement>('.chapter-card')[1];
    assert.match(row?.getAttribute('aria-label') ?? '', /^অধ্যায় ৬: বল/);
    assert.equal(active(), row, 'the row the student came from, not the top of the list');
  });

  test('back from a lesson: its chapter\'s title while loading, then that lesson\'s row', async () => {
    armKeeper();
    let gate: ReturnType<typeof deferred<Reply>> | null = null;
    const base = school();
    const { root: r } = mountLearn((url) => {
      if (url.includes('chapterId=') && gate) return gate.promise;
      return base(url);
    });
    await openReader(r, 1);
    gate = deferred<Reply>();
    press(r.querySelector<HTMLElement>('.ui-back'));
    await settle();
    const title = r.querySelector<HTMLElement>('h1');
    assert.equal(title?.textContent, 'অধ্যায় ৫: গতি');
    assert.equal(active(), title, 'the chapter title while its lessons load — not "সব অধ্যায়"');
    assert.ok(title!.classList.contains('ui-focus-landing'), 'with the keeper\'s light landing style');

    gate.resolve(ok({ topics: TOPICS }));
    await settle();
    const row = r.querySelectorAll<HTMLElement>('.topic-card')[1];
    assert.match(row?.textContent ?? '', /ত্বরণ/);
    assert.equal(active(), row, 'then the lesson just read');
    const h1 = r.querySelector<HTMLElement>('h1');
    assert.equal(h1?.hasAttribute('tabindex'), false, 'the title is not left a focus stop');
  });

  test('a student who moved on while it loaded is left where they went', async () => {
    armKeeper();
    let gate: ReturnType<typeof deferred<Reply>> | null = null;
    const base = school();
    const { root: r } = mountLearn((url) => {
      if (url.includes('chapterId=') && gate) return gate.promise;
      return base(url);
    });
    await openReader(r, 1);
    gate = deferred<Reply>();
    press(r.querySelector<HTMLElement>('.ui-back'));
    await settle();
    r.querySelector<HTMLElement>('.ui-back')!.focus();   // Shift+Tab to the back link meanwhile

    gate.resolve(ok({ topics: TOPICS }));
    await settle();
    assert.ok(active()?.classList.contains('ui-back'), 'not pulled to the lesson row');
  });

  test('"অনুশীলন করো" lands on the first question\'s first option', async () => {
    armKeeper();
    const { root: r } = mountLearn(school({ questions: [MCQ1, MCQ2] }));
    await openReader(r);
    press(buttonNamed(r, 'অনুশীলন করো'));
    await settle();
    const first = r.querySelector<HTMLElement>('.prac-option');
    assert.equal(first?.dataset.focusKey, 'prac-opt-o1a');
    assert.equal(active(), first);
    assert.equal(first!.getAttribute('aria-checked'), 'false', 'focused, not chosen');
  });

  test('"শেষ করো" lands on "অনুশীলন করো", where the practice was started', async () => {
    armKeeper();
    const { root: r, ops } = mountLearn(school({ questions: [MCQ1] }));
    await openReader(r);
    press(buttonNamed(r, 'অনুশীলন করো'));
    await settle();
    press(r.querySelectorAll<HTMLElement>('.prac-option')[1]);
    press(buttonNamed(r, 'যাচাই করো'));
    await settle();
    press(buttonNamed(r, 'শেষ করো'));
    await settle();
    const start = buttonNamed(r, 'অনুশীলন করো');
    assert.ok(start);
    assert.equal(active(), start);
    assert.equal(ops.filter((o) => o.payload.state === 'completed').length, 1, 'finishing marked the topic done');
    const done = buttonNamed(r, 'সম্পন্ন হয়েছে');
    assert.equal(done?.getAttribute('aria-disabled'), 'true', 'and the done button says so');
  });
});

describe('finding 12(a) — practice: next and retry land on the question', () => {
  function mountPractice(questions: PracticeQuestion[]) {
    const r = root();
    r.textContent = '';
    const host = doc().createElement('div');
    r.append(host);
    new PracticeView({
      root: host, doc: doc(), questions,
      outbox: { enqueue: async () => ({ opId: 'op' }), flush: async () => undefined },
    });
    return host;
  }
  async function answer(host: HTMLElement, optionIndex: number) {
    press(host.querySelectorAll<HTMLElement>('.prac-option')[optionIndex]);
    press(buttonNamed(host, 'যাচাই করো'));
    await settle();
  }

  test('"পরের প্রশ্ন" lands on the next question\'s first option', async () => {
    armKeeper();
    const host = mountPractice([MCQ1, MCQ2]);
    await answer(host, 1);
    press(buttonNamed(host, 'পরের প্রশ্ন'));
    await settle();
    assert.equal(host.querySelector('.prac-stem')?.textContent, 'বেগের একক কোনটি?');
    const first = host.querySelector<HTMLElement>('.prac-option');
    assert.equal(first?.dataset.focusKey, 'prac-opt-o2a');
    assert.equal(active(), first);
    assert.equal(focusIsLost(doc()), false);
  });

  test('"আবার চেষ্টা করো" lands on the same question\'s first option', async () => {
    armKeeper();
    const host = mountPractice([MCQ1, MCQ2]);
    await answer(host, 0);   // wrong
    press(buttonNamed(host, 'আবার চেষ্টা করো'));
    await settle();
    const first = host.querySelector<HTMLElement>('.prac-option');
    assert.equal(first?.dataset.focusKey, 'prac-opt-o1a');
    assert.equal(active(), first);
    assert.equal(first!.getAttribute('aria-checked'), 'false');
  });

  test('before a typed answer it lands on the stem, never the box (no keyboard pops up)', async () => {
    armKeeper();
    const host = mountPractice([MCQ1, NUMERIC]);
    await answer(host, 1);
    press(buttonNamed(host, 'পরের প্রশ্ন'));
    await settle();
    const stem = host.querySelector<HTMLElement>('.prac-stem');
    assert.equal(active(), stem);
    assert.equal(stem!.getAttribute('tabindex'), '-1', 'script-focusable, not a Tab stop');
    assert.notEqual(active(), host.querySelector('.prac-input'));
  });
});
