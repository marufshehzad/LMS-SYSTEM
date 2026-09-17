/**
 * UX sweep — group "assignments" (apps/pwa/src/assignments-view.ts).
 *
 * Finding 10: grading homework. An empty mark box went out as marksAwarded 0,
 *   a failed save drew a reasonless card above the whole list with no retry,
 *   and the render that drew it emptied every mark box on the page and left
 *   focus on <body>. The success sentence was erased before it was drawn.
 * Finding 64: the screen's own "অফলাইন — সংরক্ষিত তালিকা" banner stayed up
 *   after the connection came back.
 * Minor 30: "সর্বোচ্চ ১০.০০", and an offline submit reported in a success
 *   note that hedged "(অফলাইন হলে …)".
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AssignmentsView } from '../src/assignments-view.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';

let dom: JSDOM;
const doc = () => dom.window.document;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="shell-view"><div id="root"></div></main></body></html>',
    { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
});

beforeEach(() => {
  doc().body.innerHTML = '<main id="shell-view"><div id="root"></div></main>';
  localStorage.clear();
  setOnline(true);
});

function setOnline(on: boolean): void {
  Object.defineProperty(dom.window.navigator, 'onLine', { value: on, configurable: true });
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const root = () => doc().getElementById('root') as HTMLElement;
const soon = () => new Date(Date.now() + 2 * 864e5).toISOString();

type Res = { ok: boolean; status: number; json: () => Promise<unknown> };
const res = (status: number, body: unknown): Res =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body });

const LIST = [{
  id: 'a-1', titleBn: 'অনুশীলনী ৫.২', dueAt: soon(), status: 'open', maxMarks: '10.00',
  subjectBn: 'পদার্থবিজ্ঞান', sectionName: 'ক', submissionCount: 2, ungradedCount: 2, mySubmission: null,
}];

const sub = (id: string, name: string, roll: number) => ({
  id, studentId: `st-${id}`, fullNameBn: name, rollNo: roll, bodyBn: 'উত্তর',
  submittedAt: soon(), isLate: false, marksAwarded: null, feedbackBn: null, gradedAt: null,
  gradedByName: null, rowVersion: 3,
});

const DETAIL = () => ({
  assignment: {
    id: 'a-1', titleBn: 'অনুশীলনী ৫.২', instructionsBn: null, maxMarks: '10.00', dueAt: soon(),
    allowsLate: true, status: 'open', subjectBn: 'পদার্থবিজ্ঞান', sectionName: 'ক',
  },
  submissions: [sub('sub-1', 'আয়শা', 1), sub('sub-2', 'তানভীর', 2)],
});

/**
 * A teacher's view. `post` answers the grading POST; GETs answer the list
 * and the detail. Every request is recorded.
 */
function teacher(post: (body: Record<string, unknown>) => Res | Promise<Res>) {
  const posts: Array<Record<string, unknown>> = [];
  const gets: string[] = [];
  const auth = {
    role: 'class_teacher', userId: 't-1',
    authedFetch: async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        return post(body);
      }
      gets.push(url);
      return url.includes('assignmentId=') ? res(200, DETAIL()) : res(200, { assignments: LIST });
    },
  } as never;
  const view = new AssignmentsView({ root: root(), doc: doc(), auth, outbox: null as never });
  return { view, posts, gets };
}

async function openFirst(): Promise<void> {
  await settle();
  (root().querySelector('table.ui-table tbody .ui-row-open') as HTMLElement).click();
  await settle();
}

const row = (id: string) =>
  [...root().querySelectorAll<HTMLElement>('.sub-item')].find((li) => li.dataset.id === id)!;
const markOf = (id: string) => row(id).querySelector('.sub-mark') as HTMLInputElement;
const feedbackOf = (id: string) => row(id).querySelector('.sub-feedback') as HTMLInputElement;
const giveOf = (id: string) =>
  [...row(id).querySelectorAll('button')].find((b) => b.textContent === 'দাও') as HTMLButtonElement;
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
const buttonIn = (scope: HTMLElement, text: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement | undefined;

/* ── finding 10: validation before anything is sent ─────────────────────── */

describe('grading validates the mark before sending (finding 10)', () => {
  test('an empty mark box sends nothing and says so beside the row, not a zero', async () => {
    const { posts } = teacher(() => res(200, { ok: true, rowVersion: 4 }));
    await openFirst();
    const give = giveOf('sub-2');
    give.focus();
    give.click();
    await settle();

    assert.equal(posts.length, 0, 'an empty box is not marksAwarded: 0');
    const err = row('sub-2').querySelector('.sub-grade-error [role="alert"]');
    assert.equal(err?.textContent, 'নম্বর লিখুন।', 'the sentence sits in the row it is about');
    assert.equal(row('sub-1').querySelector('.sub-grade-error'), null, 'and only that row');
    assert.equal(root().querySelector('.assign-notice'), null, 'not a card above the list');
    const mark = markOf('sub-2');
    assert.equal(mark.getAttribute('aria-invalid'), 'true');
    assert.equal(mark.getAttribute('aria-describedby'), err?.id, 'the box is described by the sentence');
    assert.ok(mark.classList.contains('is-error'), 'the sheet\'s error look');
    assert.equal(doc().activeElement, mark, 'focus goes to the box that needs a mark');

    type(mark, '৭');
    assert.equal(row('sub-2').querySelector('.sub-grade-error'), null, 'typing clears the sentence');
    assert.equal(mark.hasAttribute('aria-invalid'), false);
  });

  test('a Bangla-digit mark is read, and sent as a number', async () => {
    const { posts } = teacher(() => res(200, { ok: true, rowVersion: 4 }));
    await openFirst();
    const mark = markOf('sub-1');
    assert.equal(mark.type, 'text', 'type=number would drop ৮ or read an empty box as 0');
    assert.equal(mark.getAttribute('inputmode'), 'decimal', 'the phone still offers a number pad');
    type(mark, '৮.৫');
    giveOf('sub-1').click();
    await settle();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].marksAwarded, 8.5);
    assert.equal(posts[0].rowVersion, 3, 'F-103: the version the screen was showing');
  });

  test('a mark over the maximum is refused on the phone, with the maximum in words', async () => {
    const { posts } = teacher(() => res(200, { ok: true, rowVersion: 4 }));
    await openFirst();
    type(markOf('sub-1'), '12');
    giveOf('sub-1').click();
    await settle();
    assert.equal(posts.length, 0);
    const err = row('sub-1').querySelector('.sub-grade-error [role="alert"]');
    assert.match(err?.textContent ?? '', /সর্বোচ্চ ১০-এর বেশি/);
    assert.ok(err?.querySelector('.n'), 'the number is in the numeral face');
  });

  test('a negative or non-numeric mark is refused', async () => {
    const { posts } = teacher(() => res(200, { ok: true, rowVersion: 4 }));
    await openFirst();
    for (const bad of ['-1', 'আট', '8..5']) {
      type(markOf('sub-1'), bad);
      giveOf('sub-1').click();
      await settle();
      assert.equal(row('sub-1').querySelector('.sub-grade-error [role="alert"]')?.textContent,
        'সঠিক নম্বর দিন।', bad);
    }
    assert.equal(posts.length, 0);
  });
});

/* ── finding 10: a failed save keeps the teacher's work ─────────────────── */

describe('a failed save keeps what was typed and answers in the row (finding 10)', () => {
  test('the server refuses: every typed mark and comment survives, and focus stays on দাও', async () => {
    // The preview's answer once demo.ts stops replying to POST with the list.
    teacher(() => res(403, {
      error: 'demo_read_only', message: 'এটি প্রদর্শনী সংস্করণ — এখানে নম্বর সংরক্ষণ হয় না।',
    }));
    const stop = keepFocusWithin(doc().getElementById('shell-view') as HTMLElement);
    try {
      await openFirst();
      type(markOf('sub-1'), '6');
      type(feedbackOf('sub-1'), 'ভালো');
      type(markOf('sub-2'), '৮');
      type(feedbackOf('sub-2'), 'ধাপগুলো দেখাও');
      const give = giveOf('sub-2');
      give.focus();
      give.click();
      await settle();

      assert.notEqual(giveOf('sub-2'), give, 'the list was rebuilt');
      assert.equal(markOf('sub-1').value, '6', 'the other row keeps its mark');
      assert.equal(feedbackOf('sub-1').value, 'ভালো');
      assert.equal(markOf('sub-2').value, '৮', 'the failed row keeps its mark');
      assert.equal(feedbackOf('sub-2').value, 'ধাপগুলো দেখাও');
      assert.equal(row('sub-2').querySelector('.sub-grade-error [role="alert"]')?.textContent,
        'এটি প্রদর্শনী সংস্করণ — এখানে নম্বর সংরক্ষণ হয় না।', 'the reason, in the row');
      assert.equal(buttonIn(row('sub-2'), 'আবার চেষ্টা করুন'), undefined, 'a refusal offers no retry');
      assert.equal(root().querySelector('.assign-notice'), null);
      assert.equal(doc().activeElement, giveOf('sub-2'), 'focus is on THIS row\'s দাও, not <body>');
    } finally { stop(); }
  });

  test('a lost connection offers a retry that sends the same mark, and success says so in the row', async () => {
    let fail = true;
    const { posts } = teacher(() => {
      if (fail) throw new TypeError('Failed to fetch');
      return res(200, { ok: true, submissionId: 'sub-1', rowVersion: 4 });
    });
    await openFirst();
    type(markOf('sub-1'), '৯');
    type(feedbackOf('sub-1'), 'চমৎকার');
    giveOf('sub-1').click();
    await settle();

    const err = row('sub-1').querySelector('.sub-grade-error');
    assert.match(err?.querySelector('[role="alert"]')?.textContent ?? '', /পাঠানো যায়নি/);
    const retry = buttonIn(row('sub-1'), 'আবার চেষ্টা করুন');
    assert.ok(retry, 'R10: a failure a second try can fix has a retry');
    assert.equal(markOf('sub-1').hasAttribute('aria-invalid'), false, 'the mark itself is not wrong');

    fail = false;
    retry!.focus();
    retry!.click();
    await settle();
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[1], posts[0], 'the retry sends exactly what failed');

    assert.equal(row('sub-1').querySelector('.sub-mark'), null, 'the graded row has no form');
    const saved = row('sub-1').querySelector('.sub-grade-saved') as HTMLElement;
    assert.ok(saved, 'the confirmation is in the row that was saved');
    assert.match(saved.textContent ?? '', /নম্বর সংরক্ষিত/);
    assert.equal(doc().activeElement, saved, 'focus has somewhere to be once the form is gone');
    assert.match(row('sub-1').querySelector('.sub-head')?.textContent ?? '', /৯ নম্বর/);
    assert.equal(root().querySelector('.is-skeleton'), null, 'no skeleton, so the scroll position holds');
  });

  test('each failed row keeps its own sentence; only the newest is announced, and a save elsewhere erases none', async () => {
    const { posts } = teacher((b) => {
      if (b.submissionId === 'sub-2' && posts.length > 2) return res(200, { ok: true, rowVersion: 4 });
      throw new TypeError('Failed to fetch');
    });
    await openFirst();
    type(markOf('sub-1'), '4');
    giveOf('sub-1').click();
    await settle();
    type(markOf('sub-2'), '5');
    giveOf('sub-2').click();
    await settle();

    const e1 = row('sub-1').querySelector('.sub-grade-error .ui-field-error') as HTMLElement;
    const e2 = row('sub-2').querySelector('.sub-grade-error .ui-field-error') as HTMLElement;
    assert.ok(e1 && e2, 'both rows still say they were not saved');
    assert.equal(e1.getAttribute('role'), null, 'the older one is not announced again');
    assert.equal(e2.getAttribute('role'), 'alert', 'the new one is');
    assert.equal(giveOf('sub-2').getAttribute('aria-describedby'), e2.id,
      'the button that failed is read with the reason');
    assert.equal(markOf('sub-2').hasAttribute('aria-invalid'), false, 'the mark is not what is wrong');

    buttonIn(row('sub-2'), 'আবার চেষ্টা করুন')!.click();
    await settle();
    assert.ok(row('sub-2').querySelector('.sub-grade-saved'), 'row 2 saved');
    assert.ok(row('sub-1').querySelector('.sub-grade-error'), 'row 1 still says it was not');
    assert.equal(markOf('sub-1').value, '4');
  });

  test('the row is updated in place with the version the server echoed', async () => {
    let n = 0;
    const { posts, gets } = teacher(() => { n += 1; return res(200, { ok: true, rowVersion: 7 }); });
    await openFirst();
    const readsBefore = gets.length;
    type(markOf('sub-2'), '5');
    const give = giveOf('sub-2');
    give.click();
    give.click();
    await settle();
    assert.equal(n, 1, 'a double tap sends one write, not a conflict with itself');
    assert.equal(posts[0].marksAwarded, 5);
    assert.equal(gets.length, readsBefore, 'the saved row is not re-read behind a skeleton');
    assert.ok(markOf('sub-1'), 'the other row is still open for marking');
  });

  test('"keep theirs" still says so after the re-read', async () => {
    teacher(() => res(409, {
      conflict: {
        submissionId: 'sub-1', currentRowVersion: 5,
        yours: { marksAwarded: 7, feedbackBn: null },
        theirs: { marksAwarded: '8.00', feedbackBn: null, gradedAt: soon(), gradedByName: 'রহিম' },
      },
    }));
    await openFirst();
    type(markOf('sub-1'), '7');
    giveOf('sub-1').click();
    await settle();
    const card = root().querySelector('.grade-conflict') as HTMLElement;
    assert.ok(card, 'the conflict is put in front of the teacher');
    assert.match(card.textContent ?? '', /তাঁদের নম্বর৮আপনার/, 'their mark, without ".00"');
    buttonIn(card, 'তাঁদেরটি রাখুন')!.click();
    await settle();
    assert.match(root().textContent ?? '', /আগের নম্বরই রাখা হয়েছে।/,
      'the outcome is not erased by the re-read it triggers');
  });
});

/* ── finding 10: an outcome redraws its own row, not the teacher's next one ─ */

describe('a grading outcome leaves the other rows alone (finding 10)', () => {
  /** A POST held open until the test answers it: the save "on the wire". */
  function held() {
    let answer!: (r: Res | Error) => void;
    const wire = teacher(() => new Promise<Res>((resolve, reject) => {
      answer = (r) => (r instanceof Error ? reject(r) : resolve(r));
    }));
    return { ...wire, answer: (r: Res | Error) => answer(r) };
  }

  for (const [label, outcome] of [
    ['saved', () => res(200, { ok: true, rowVersion: 4 })],
    ['refused as over the maximum', () => res(422, { error: 'marks_exceed_max', message: 'too many' })],
    ['lost to the connection', () => new TypeError('Failed to fetch')],
  ] as const) {
    test(`row 2 ${label} while the teacher types in row 1: row 1's boxes and focus are untouched`, async () => {
      const { answer, posts } = held();
      const stop = keepFocusWithin(doc().getElementById('shell-view') as HTMLElement);
      try {
        await openFirst();
        type(markOf('sub-2'), '5');
        giveOf('sub-2').click();
        await settle();
        assert.equal(posts.length, 1, 'row 2 is on the wire');

        // Meanwhile the teacher has moved on to row 1.
        const mark1 = markOf('sub-1');
        const fb1 = feedbackOf('sub-1');
        type(mark1, '৭');
        fb1.focus();
        type(fb1, 'ভাল');

        answer(outcome());
        await settle();

        assert.equal(markOf('sub-1'), mark1, 'row 1\'s mark box is the same node, not a rebuilt copy');
        assert.equal(feedbackOf('sub-1'), fb1, 'so a Bangla word being composed in it is not cut off');
        assert.equal(fb1.value, 'ভাল');
        assert.equal(doc().activeElement, fb1, 'focus is not pulled to row 2');
        assert.ok(row('sub-2').querySelector('.sub-grade-saved, .sub-grade-error'), 'row 2 shows its outcome');
      } finally { stop(); }
    });
  }

  test('a mark refused on the phone redraws only that row', async () => {
    const { posts } = teacher(() => res(200, { ok: true, rowVersion: 4 }));
    await openFirst();
    const mark1 = markOf('sub-1');
    type(mark1, '3');
    giveOf('sub-2').click();
    await settle();
    assert.equal(posts.length, 0);
    assert.ok(row('sub-2').querySelector('.sub-grade-error'));
    assert.equal(markOf('sub-1'), mark1, 'row 1 was not rebuilt');
    assert.equal(doc().activeElement, markOf('sub-2'), 'focus goes to the box that needs a mark');
  });

  test('a conflict about one row is still on screen after another row saves', async () => {
    teacher((b) => b.submissionId === 'sub-1'
      ? res(409, {
          conflict: {
            submissionId: 'sub-1', currentRowVersion: 5,
            yours: { marksAwarded: 7, feedbackBn: null },
            theirs: { marksAwarded: '8.00', feedbackBn: null, gradedAt: soon(), gradedByName: 'রহিম' },
          },
        })
      : res(200, { ok: true, rowVersion: 4 }));
    await openFirst();
    type(markOf('sub-1'), '7');
    giveOf('sub-1').click();
    await settle();
    assert.ok(root().querySelector('.grade-conflict'));

    type(markOf('sub-2'), '6');
    giveOf('sub-2').click();
    await settle();
    assert.ok(row('sub-2').querySelector('.sub-grade-saved'), 'row 2 saved');
    assert.ok(root().querySelector('.grade-conflict'),
      'the decision about row 1 was not taken away by a save on row 2');
  });

  test('"নম্বর সংরক্ষিত" stands beside the newest save only', async () => {
    const d = DETAIL();
    d.submissions.push(sub('sub-3', 'রাফি', 3));
    const auth = {
      role: 'class_teacher', userId: 't-1',
      authedFetch: async (url: string, init: RequestInit = {}) => init.method === 'POST'
        ? res(200, { ok: true, rowVersion: 4 })
        : url.includes('assignmentId=') ? res(200, d) : res(200, { assignments: LIST }),
    } as never;
    new AssignmentsView({ root: root(), doc: doc(), auth, outbox: null as never });
    await openFirst();
    type(markOf('sub-1'), '5');
    giveOf('sub-1').click();
    await settle();
    const mark3 = markOf('sub-3');
    type(markOf('sub-2'), '6');
    giveOf('sub-2').click();
    await settle();
    assert.equal(root().querySelectorAll('.sub-grade-saved').length, 1);
    assert.ok(row('sub-2').querySelector('.sub-grade-saved'));
    assert.equal(markOf('sub-3'), mark3, 'the row still to mark was not rebuilt');
  });
});

/* ── finding 64: the offline banner clears when the connection returns ─── */

describe('the screen\'s offline state follows the connection (finding 64)', () => {
  function student(fetcher: (url: string) => Promise<Res>) {
    let calls = 0;
    const auth = {
      role: 'student', userId: 's-1',
      authedFetch: async (url: string) => { calls += 1; return fetcher(url); },
    } as never;
    const view = new AssignmentsView({ root: root(), doc: doc(), auth, outbox: null as never });
    return { view, calls: () => calls };
  }
  const online = () => dom.window.dispatchEvent(new dom.window.Event('online'));

  test('a cached list shown offline is re-read when the connection returns, and the banner goes', async () => {
    localStorage.setItem('shikhon_assignments_cache', JSON.stringify(LIST));
    let up = false;
    const { view } = student(async () => {
      if (!up) throw new TypeError('Failed to fetch');
      return res(200, { assignments: LIST });
    });
    await settle();
    assert.ok(root().querySelector('.assign-offline'), 'offline: the cached list, labelled');

    up = true;
    online();
    await settle();
    assert.equal(root().querySelector('.assign-offline'), null, 'back online: no stale "অফলাইন"');
    view.destroy();
  });

  test('a first load that failed with nothing cached loads when the connection returns', async () => {
    let up = false;
    const { view } = student(async () => {
      if (!up) throw new TypeError('Failed to fetch');
      return res(200, { assignments: LIST });
    });
    await settle();
    assert.ok(root().querySelector('.ui-state-error'));
    up = true;
    online();
    await settle();
    assert.equal(root().querySelector('.ui-state-error'), null);
    assert.equal(root().querySelectorAll('.ui-tab').length, 3, 'the list is on screen');
    view.destroy();
  });

  test('an assignment that could not be opened offline opens when the connection returns', async () => {
    let up = false;
    const { view } = student(async (url) => {
      if (url.includes('assignmentId=')) {
        if (!up) throw new TypeError('Failed to fetch');
        return res(200, { ...DETAIL(), submissions: [] });
      }
      return res(200, { assignments: LIST });
    });
    await openFirst();
    assert.ok(root().querySelector('.ui-state-error'), 'the detail read failed');
    up = true;
    online();
    await settle();
    assert.equal(root().querySelector('.ui-state-error'), null);
    assert.equal(root().querySelector('h1')?.textContent, 'অনুশীলনী ৫.২', 'the open item, not the list');
    view.destroy();
  });

  test('a screen that is already current is not re-read, and destroy() stops listening', async () => {
    const { view, calls } = student(async () => res(200, { assignments: LIST }));
    await settle();
    const before = calls();
    online();
    await settle();
    assert.equal(calls(), before, 'nothing stale, nothing fetched, no skeleton flash');

    localStorage.setItem('shikhon_assignments_cache', JSON.stringify(LIST));
    let up = false;
    const second = student(async () => {
      if (!up) throw new TypeError('Failed to fetch');
      return res(200, { assignments: LIST });
    });
    await settle();
    view.destroy();
    second.view.destroy();
    const after = second.calls();
    up = true;
    online();
    await settle();
    assert.equal(second.calls(), after, 'an unmounted screen does not fetch');
  });
});

/* ── minor 30 ─────────────────────────────────────────────────────────────── */

describe('marks read as marks, and an offline submit says what happened (minor 30)', () => {
  function studentDetail() {
    const ops: unknown[] = [];
    const auth = {
      role: 'student', userId: 's-1',
      authedFetch: async (url: string) => url.includes('assignmentId=')
        ? res(200, { ...DETAIL(), submissions: [] })
        : res(200, { assignments: LIST }),
    } as never;
    const outbox = {
      enqueue: async (i: unknown) => { ops.push(i); return { opId: 'op-1' }; },
      flush: async () => { throw new TypeError('offline'); },
    } as never;
    new AssignmentsView({ root: root(), doc: doc(), auth, outbox });
    return ops;
  }

  test('the maximum is "১০", not "১০.০০"', async () => {
    studentDetail();
    await openFirst();
    const sub = root().querySelector('.page-sub')?.textContent ?? '';
    assert.match(sub, /সর্বোচ্চ ১০(?!\.)/);
  });

  test('offline, the answer is "kept on this device", not a hedged success', async () => {
    const ops = studentDetail();
    await openFirst();
    const ta = root().querySelector('.assign-answer') as HTMLTextAreaElement;
    ta.value = 'উত্তর';
    ta.dispatchEvent(new dom.window.Event('input'));
    setOnline(false);
    buttonIn(root(), 'জমা দাও')!.click();
    await settle();
    assert.equal(ops.length, 1, 'still queued to the outbox');
    assert.equal(root().querySelector('.ui-success-note'), null, 'not dressed as a delivery');
    const note = root().querySelector('.assign-note[role="status"]');
    assert.match(note?.textContent ?? '', /এই যন্ত্রে রাখা আছে — সংযোগ ফিরলে নিজেই জমা হবে/);
    assert.doesNotMatch(root().textContent ?? '', /অফলাইন হলে/);
  });
});
