/**
 * The exam routine screen — F-510, wireframe §8.3.
 *
 * §8.3 is called "the screen that proves the subject-based model", and
 * what makes it that is not the table of papers — it is the panel naming
 * the children caught by a clash, and the fact that publication is shut
 * while they are. Those are what this suite holds still.
 *
 * The view never re-derives a clash; the server does that. So there is
 * nothing here asserting clash LOGIC — that lives in db/tests/exam_clash.sql
 * and services/rms-svc/test/examroutine.test.ts, against a real roster.
 * What is asserted here is that the screen tells the truth about what the
 * server said.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ExamRoutineView } from '../src/exam-routine-view.ts';

let dom: JSDOM;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
                  { url: 'http://localhost/' });
  (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
});

const EXAM = {
  id: 'e1', nameBn: 'বার্ষিক পরীক্ষা', examType: 'annual',
  startsOn: '2026-12-10', endsOn: '2026-12-20', status: 'planned',
  // Migration 068. `status` is the RESULTS lifecycle; whether the TIMETABLE
  // has been announced is its own fact. This screen reads only the latter.
  routinePublished: false,
};

const paper = (id: string, subjectBn: string, examDate: string, hasClash: boolean) => ({
  examSubjectId: id, sectionName: 'ক', subjectBn, examDate,
  startTime: '10:00', endTime: '13:00', durationMinutes: 180, hasClash,
});

/** Two papers clash on the 14th; Physics on the 15th is innocent. */
const withClash = {
  exam: EXAM,
  papers: [
    paper('p1', 'রসায়ন', '2026-12-14', true),
    paper('p2', 'উচ্চতর গণিত', '2026-12-14', true),
    paper('p3', 'পদার্থবিজ্ঞান', '2026-12-15', false),
  ],
  clashes: [{
    studentNameBn: 'আনিকা', rollNo: 7, sectionName: 'ক', examDate: '2026-12-14',
    subjectABn: 'রসায়ন', subjectBBn: 'উচ্চতর গণিত', startA: '10:00', startB: '10:00',
  }],
  affectedStudents: 1,
  canPublish: false,
};

const clean = {
  ...withClash,
  papers: withClash.papers.map((p) => ({ ...p, hasClash: false })),
  clashes: [],
  affectedStudents: 0,
  canPublish: true,
};

/** A stub Auth that answers the list request and then the routine request. */
function stubAuth(routine: unknown, sent: Array<Record<string, unknown>> = []) {
  return {
    authedFetch: async (url: string, init?: { body?: string }) => {
      if (init?.body) sent.push(JSON.parse(init.body) as Record<string, unknown>);
      const body = url.includes('examId=') || init ? routine : { exams: [EXAM] };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    },
  } as unknown as ConstructorParameters<typeof ExamRoutineView>[0]['auth'];
}

async function mount(routine: unknown, sent?: Array<Record<string, unknown>>) {
  const root = dom.window.document.getElementById('root') as HTMLElement;
  root.textContent = '';
  new ExamRoutineView({ root, doc: dom.window.document, auth: stubAuth(routine, sent) });
  // Two awaited fetches before the final render.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return root;
}

describe('exam routine view (§8.3)', () => {
  let root: HTMLElement;

  describe('with a clash standing', () => {
    beforeEach(async () => { root = await mount(withClash); });

    test('names the affected student rather than only counting', () => {
      const panel = root.querySelector('#clash-panel');
      assert.ok(panel, 'the clash panel is rendered');
      assert.match(panel!.textContent ?? '', /আনিকা/);
      assert.match(panel!.textContent ?? '', /রসায়ন \+ উচ্চতর গণিত/);
    });

    test('the headline counts students, in Bangla numerals', () => {
      const head = root.querySelector('.clash-head');
      assert.match(head?.textContent ?? '', /১ জন শিক্ষার্থীর/);
    });

    test('the roll number stays in Latin digits — it is an identifier', () => {
      assert.equal(root.querySelector('.clash-roll')?.textContent, '7');
    });

    test('both papers of the pair are flagged and the innocent one is not', () => {
      const flagged = root.querySelectorAll('tr.is-flagged');
      assert.equal(flagged.length, 2);
      const rows = [...root.querySelectorAll('tbody tr')];
      const physics = rows.find((r) => r.textContent?.includes('পদার্থবিজ্ঞান'));
      assert.ok(physics && !physics.classList.contains('is-flagged'));
    });

    test('every status carries a word, never colour or a glyph alone (F-812)', () => {
      // P6 moved these onto `statusBadge`, so a clashing paper tints like
      // every other overdue thing in the product rather than like exams only.
      const chips = [...root.querySelectorAll('.ui-table .ui-badge')];
      assert.equal(chips.length, 3);
      assert.ok(chips.every((c) => /সংঘর্ষ|ঠিক আছে/.test(c.textContent ?? '')),
        chips.map((c) => c.textContent).join(' | '));
    });

    test('publish is disabled and says why', () => {
      const pub = [...root.querySelectorAll('button')]
        .find((b) => b.textContent === 'প্রকাশ করুন') as HTMLButtonElement;
      assert.ok(pub, 'the publish button exists');
      assert.equal(pub.disabled, true);
      assert.match(pub.title, /সংঘর্ষ/);
    });

    test('each flagged paper offers the reschedule that closes the loop', () => {
      const buttons = [...root.querySelectorAll('button')]
        .filter((b) => b.textContent === 'সময় পরিবর্তন করুন');
      assert.equal(buttons.length, 2);
    });

    test('rescheduling posts the paper id, date and time the server expects', async () => {
      const sent: Array<Record<string, unknown>> = [];
      const r = await mount(withClash, sent);
      const open = [...r.querySelectorAll('button')]
        .find((b) => b.textContent === 'সময় পরিবর্তন করুন') as HTMLButtonElement;
      open.click();

      const date = r.querySelector('input[type=date]') as HTMLInputElement;
      const time = r.querySelector('input[type=time]') as HTMLInputElement;
      assert.equal(date.value, '2026-12-14', 'prefilled with the current slot');
      date.value = '2026-12-17';
      time.value = '09:30';

      const save = [...r.querySelectorAll('button')]
        .find((b) => b.textContent === 'সংরক্ষণ') as HTMLButtonElement;
      save.click();
      await new Promise((res) => setTimeout(res, 0));

      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0].reschedule, {
        examSubjectId: 'p1', examDate: '2026-12-17', startTime: '09:30',
      });
    });
  });

  describe('with a clean routine', () => {
    beforeEach(async () => { root = await mount(clean); });

    test('no clash panel is rendered at all', () => {
      assert.equal(root.querySelector('#clash-panel'), null);
    });

    test('publish is enabled', () => {
      const pub = [...root.querySelectorAll('button')]
        .find((b) => b.textContent === 'প্রকাশ করুন') as HTMLButtonElement;
      assert.equal(pub.disabled, false);
    });

    test('a clean routine offers no reschedule rows to clutter it', () => {
      assert.equal(root.querySelectorAll('tr.row-action').length, 0);
    });
  });

  describe('once published', () => {
    test('the routine cannot be rescheduled or published again from here', async () => {
      root = await mount({ ...clean, exam: { ...EXAM, routinePublished: true } });
      const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
      assert.ok(!labels.includes('প্রকাশ করুন'));
      assert.ok(!labels.includes('সময় পরিবর্তন করুন'));
      // And the state is stated, not merely implied by what is missing. Ata
      // Ekta (05 Principal §06) draws it as the chip in the page bar's right
      // cluster, where the action card's header used to hold it.
      assert.match(root.querySelector('.page-header-actions .ui-badge')?.textContent ?? '',
        /প্রকাশিত/);
      // Said in words as well as in a badge: a published routine cannot be
      // edited, and a reader must not have to infer that from absent buttons.
      assert.match(root.textContent ?? '', /প্রকাশিত রুটিন আর পরিবর্তন করা যায় না/);
    });
  });

  describe('Ata Ekta — 05 Principal §06', () => {
    test('the bar carries the clash count, in Bangla, with the number in the numeral face', async () => {
      root = await mount(withClash);
      const chip = root.querySelector('.page-header-actions .ui-badge');
      assert.match(chip?.textContent ?? '', /২ সংঘর্ষ/);
      assert.equal(chip?.querySelector('.n')?.textContent, '২');
      // One accent on the page: the publish button, and nothing else.
      assert.equal(root.querySelectorAll('.btn-primary').length, 1);
    });

    test('the strip says why, in one sentence, and that publishing waits on it', async () => {
      root = await mount(withClash);
      const panel = root.querySelector('#clash-panel')!;
      assert.match(panel.querySelector('.clash-head')?.textContent ?? '',
        /১৪ ডিসেম্বর তারিখে ১ জন শিক্ষার্থীর একই সময়ে দুটি পরীক্ষা পড়েছে — সে রসায়ন ও উচ্চতর গণিত দুটোই নিয়েছে।/);
      assert.match(panel.textContent ?? '', /সংঘর্ষ থাকা অবস্থায় রুটিন প্রকাশ করা যাবে না/);
      // The publish button's description still points at it.
      const pub = [...root.querySelectorAll('button')]
        .find((b) => b.textContent === 'প্রকাশ করুন') as HTMLButtonElement;
      assert.equal(pub.getAttribute('aria-describedby'), 'clash-panel');
    });

    test('a refusal is the permission state, never a retryable load error', async () => {
      const r = dom.window.document.getElementById('root') as HTMLElement;
      r.textContent = '';
      new ExamRoutineView({
        root: r, doc: dom.window.document,
        auth: {
          authedFetch: async () => ({
            ok: false, status: 403, json: async () => ({ error: 'forbidden' }),
          }) as unknown as Response,
        } as unknown as ConstructorParameters<typeof ExamRoutineView>[0]['auth'],
      });
      await new Promise((res) => setTimeout(res, 0));
      await new Promise((res) => setTimeout(res, 0));
      assert.ok(r.querySelector('.ui-state-denied'), 'the denied state is shown');
      assert.match(r.textContent ?? '', /অনুমতি/);
      assert.doesNotMatch(r.textContent ?? '', /লোড হয়নি|আবার চেষ্টা/);
      assert.equal(r.querySelectorAll('h1').length, 1);
    });

    test('no exams yet says what is missing and where to go next', async () => {
      const r = dom.window.document.getElementById('root') as HTMLElement;
      r.textContent = '';
      new ExamRoutineView({
        root: r, doc: dom.window.document,
        auth: {
          authedFetch: async () => ({
            ok: true, status: 200, json: async () => ({ exams: [] }),
          }) as unknown as Response,
        } as unknown as ConstructorParameters<typeof ExamRoutineView>[0]['auth'],
      });
      await new Promise((res) => setTimeout(res, 0));
      await new Promise((res) => setTimeout(res, 0));
      assert.match(r.textContent ?? '', /কোনো পরীক্ষার সময়সূচি তৈরি হয়নি/);
      const go = [...r.querySelectorAll('button')]
        .find((b) => b.textContent === 'পরীক্ষা ব্যবস্থাপনায় যান');
      assert.ok(go, 'the next action is a real button');
    });
  });
});
