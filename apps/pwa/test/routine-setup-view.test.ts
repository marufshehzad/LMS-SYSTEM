/**
 * P9-2 — the setup checklist, as a coordinator reads it.
 *
 * The API suite pins the readiness rules. These are the four things about the
 * SCREEN that decide whether a school can trust it:
 *
 *   1. Three states are rendered as three different things. A checklist that
 *      showed "incomplete" for both an optional gap and a real blocker would
 *      send a school off to do an afternoon of optional data entry before
 *      seeing anything work — the exact opposite of the one-minute promise.
 *
 *   2. Working days carry NO control. `tenants.weekend_days` is platform-owned
 *      by migration 069, and a wizard that quietly grew a control for it would
 *      be a privilege escalation dressed as a convenience. The screen says who
 *      manages it instead.
 *
 *   3. The verdict is the server's. `canGenerate` is rendered, never
 *      recomputed — two people editing at once would make a browser-side
 *      count disagree with the database, and being trusted about what is
 *      missing is this screen's only job.
 *
 *   4. A refused save keeps the typing. Ten rows of bell times are a real
 *      afternoon, and `writer-save-errors.test.ts` records what happens when
 *      a `finally { load() }` wipes them.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { RoutineSetupView } from '../src/routine-setup-view.ts';

let dom: JSDOM;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
                  { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.CSS = dom.window.CSS;
  g.confirm = () => true;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
});

const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const settle = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setTimeout(r, 0)); };
const YEAR = 'eeeeeeee-0000-4000-8000-00000000000a';
const TEMPLATE = 'ffffffff-0000-4000-8000-00000000000a';

const READINESS = {
  steps: [
    { id: 'workingdays', titleBn: 'সাপ্তাহিক কর্মদিবস', state: 'ok',
      detailBn: 'সপ্তাহে ৫ দিন ক্লাস — রবি, সোম, মঙ্গল, বুধ, বৃহস্পতি', done: 5, total: 7 },
    { id: 'periods', titleBn: 'পিরিয়ড ও বিরতি', state: 'ok',
      detailBn: 'প্রতিদিন ৭টি ক্লাস পিরিয়ড', done: 7, total: 7 },
    { id: 'assignments', titleBn: 'কে কোন বিষয় পড়ান', state: 'blocked',
      detailBn: '১২টির মধ্যে ৩টি সম্পূর্ণ — ৯টি বাকি', done: 3, total: 12 },
    { id: 'availability', titleBn: 'শিক্ষকের সময়-সীমা', state: 'warn',
      detailBn: 'কারও সময়-সীমা দেওয়া হয়নি — সবাইকে সব সময় ফাঁকা ধরা হবে', done: 0, total: 3 },
  ],
  canGenerate: false,
  weekend: { days: [5, 6], managedBy: 'platform' },
};

const PERIODS = {
  templates: [{ id: TEMPLATE, nameBn: 'সকাল', shift: 'morning' }],
  periods: [
    { id: 'p1', templateId: TEMPLATE, periodNo: 1, labelBn: 'সমাবেশ',
      startsAt: '08:00', endsAt: '08:20', kind: 'assembly' },
    { id: 'p2', templateId: TEMPLATE, periodNo: 2, labelBn: '১ম',
      startsAt: '08:20', endsAt: '09:00', kind: 'teaching' },
  ],
  kinds: ['teaching', 'assembly', 'tiffin', 'prayer', 'games', 'study', 'break'],
};

let sent: unknown[] = [];
let postReply: { ok: boolean; status: number; body: unknown } =
  { ok: true, status: 200, body: { periods: 2, teaching: 1 } };
let readiness: unknown = READINESS;
let navigated: string[] = [];

function auth() {
  return {
    role: 'principal',
    authedFetch: async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') {
        sent.push(JSON.parse(init.body as string));
        return { ok: postReply.ok, status: postReply.status,
                 json: async () => postReply.body } as unknown as Response;
      }
      if (url.includes('step=periods')) {
        return { ok: true, status: 200,
                 json: async () => JSON.parse(JSON.stringify(PERIODS)) } as unknown as Response;
      }
      return { ok: true, status: 200,
               json: async () => JSON.parse(JSON.stringify(readiness)) } as unknown as Response;
    },
  } as unknown as ConstructorParameters<typeof RoutineSetupView>[0]['auth'];
}

const mount = async () => {
  root().textContent = '';
  const v = new RoutineSetupView({
    root: root(), doc: doc(), auth: auth(), yearId: YEAR,
    onNavigate: (p) => navigated.push(p),
  });
  await settle();
  return v;
};

/**
 * The checklist row (`li.setup-step`) whose own title is `titleBn`.
 *
 * Matched on `.ui-list-title` and not on `textContent`: a row that holds an
 * open editor contains other text, and a substring match could land on the
 * wrong row — every assertion would then pass against the wrong element.
 */
const cardFor = (titleBn: string): HTMLElement | undefined =>
  [...root().querySelectorAll<HTMLElement>('li.setup-step')].find((c) =>
    (c.querySelector('.ui-list-title')?.textContent ?? '').trim() === titleBn);
const buttonIn = (scope: HTMLElement, text: string) =>
  [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text));

describe('P9-2 — the routine setup checklist', () => {
  beforeEach(() => {
    sent = []; navigated = []; readiness = READINESS;
    postReply = { ok: true, status: 200, body: { periods: 2, teaching: 1 } };
  });

  test('THE ONE THAT MATTERS — three states read as three different things', async () => {
    await mount();
    const text = root().textContent ?? '';
    assert.match(text, /সম্পূর্ণ/, 'ok');
    assert.match(text, /প্রয়োজন/, 'blocked — the word a coordinator must act on');
    assert.match(text, /ঐচ্ছিক/, 'warn — optional, and must not read as a blocker');
  });

  test('the verdict is the server’s sentence, not a recomputation', async () => {
    await mount();
    assert.match(root().textContent ?? '', /১টি ধাপ শেষ না হলে রুটিন তৈরি করা যাবে না/,
      'one blocked step in this fixture — the count comes from the steps the server sent');

    // Flip only `canGenerate`; the browser must follow it rather than
    // counting the steps itself.
    readiness = { ...READINESS, canGenerate: true };
    await mount();
    assert.match(root().textContent ?? '', /রুটিন তৈরি করা যাবে/);
  });

  test('an optional gap does not stop generation', async () => {
    readiness = {
      ...READINESS, canGenerate: true,
      steps: READINESS.steps.map((s) => s.id === 'assignments'
        ? { ...s, state: 'ok', detailBn: '১২টির মধ্যে ১২টি সম্পূর্ণ' } : s),
    };
    await mount();
    const t = root().textContent ?? '';
    assert.match(t, /রুটিন তৈরি করা যাবে/);
    assert.match(t, /ঐচ্ছিক ধাপ বাকি/,
      'the warning is still named — it is not hidden just because it does not block');
  });

  test('working days show WHO manages them and offer no control', async () => {
    await mount();
    const c = cardFor('সাপ্তাহিক কর্মদিবস');
    assert.ok(c, 'the step must be listed');
    assert.match(c.textContent ?? '', /shikhonBD নির্ধারণ করে/);
    assert.equal(buttonIn(c, 'ঠিক করুন'), undefined,
      'migration 069 makes this platform-owned; a control here would be an escalation');
    assert.equal(buttonIn(c, 'এই ধাপে যান'), undefined);
    assert.equal(c.querySelector('button'), null,
      'no control of any label — a complete row elsewhere reads "খুলুন", and this one must not');
  });

  test('a step that lives on another screen navigates there', async () => {
    await mount();
    const c = cardFor('কে কোন বিষয় পড়ান') as HTMLElement;
    // Blocked, so the row carries the drawn "ঠিক করুন" (06 Routine §01).
    buttonIn(c, 'ঠিক করুন')?.click();
    await settle();
    assert.deepEqual(navigated, ['teachingassignments'],
      'the assignment matrix already exists — a wizard copy of it would be the one that rots');
  });

  test('the bell-times editor opens with the school’s real schedule', async () => {
    await mount();
    const c = cardFor('পিরিয়ড ও বিরতি') as HTMLElement;
    buttonIn(c, 'খুলুন')?.click();
    await settle();

    const rows = root().querySelectorAll('.setup-period-row');
    assert.equal(rows.length, 2);
    const first = [...rows[0].querySelectorAll('input')].map((i) => (i as HTMLInputElement).value);
    assert.deepEqual(first, ['সমাবেশ', '08:00', '08:20']);
  });

  test('adding a period starts where the last one finished', async () => {
    // The office should never do this arithmetic, and a wizard that made them
    // type 09:45 after 09:00 would be a form pretending to be a wizard.
    await mount();
    const c = cardFor('পিরিয়ড ও বিরতি') as HTMLElement;
    buttonIn(c, 'খুলুন')?.click();
    await settle();
    buttonIn(root(), 'পিরিয়ড যোগ করুন')?.click();
    await settle();

    const rows = root().querySelectorAll('.setup-period-row');
    assert.equal(rows.length, 3);
    const added = [...rows[2].querySelectorAll('input')].map((i) => (i as HTMLInputElement).value);
    assert.equal(added[1], '09:00', 'starts where period 2 ended');
    assert.equal(added[2], '09:45', 'and runs the default 45 minutes');
  });

  test('A REFUSED SAVE keeps every row on screen and says which two collide', async () => {
    postReply = {
      ok: false, status: 409,
      body: { error: 'period_overlap',
              message: '"সমাবেশ" (08:00–08:30) এবং "১ম" (08:20–09:00) একই সময়ে পড়ছে' },
    };
    await mount();
    const c = cardFor('পিরিয়ড ও বিরতি') as HTMLElement;
    buttonIn(c, 'খুলুন')?.click();
    await settle();
    buttonIn(root(), 'সংরক্ষণ করুন')?.click();
    await settle();

    assert.match(root().textContent ?? '', /একই সময়ে পড়ছে/,
      'the server’s own sentence, naming both periods');
    assert.equal(root().querySelectorAll('.setup-period-row').length, 2,
      'and an afternoon of bell times must still be there to correct');
  });

  test('every period control has an accessible name, and no raw uuid', async () => {
    await mount();
    const c = cardFor('পিরিয়ড ও বিরতি') as HTMLElement;
    buttonIn(c, 'খুলুন')?.click();
    await settle();

    const controls = [...root().querySelectorAll('.setup-period-row input, .setup-period-row select')];
    assert.ok(controls.length >= 8);
    for (const el of controls) {
      const name = el.getAttribute('aria-label') ?? '';
      assert.notEqual(name, '', 'an unnamed time box is "edit text" repeated ten times');
      assert.doesNotMatch(name, /[0-9a-f]{8}-/, 'never a raw uuid');
    }
  });

  test('a refusal to read the setup shows a permission state, not an empty page', async () => {
    // A coordinator who has been given the wrong role must be told, not
    // shown a checklist with nothing in it.
    root().textContent = '';
    const v = new RoutineSetupView({
      root: root(), doc: doc(), yearId: YEAR,
      auth: {
        role: 'student',
        authedFetch: async () => ({ ok: false, status: 403,
          json: async () => ({ error: 'forbidden' }) } as unknown as Response),
      } as unknown as ConstructorParameters<typeof RoutineSetupView>[0]['auth'],
    });
    await settle();
    void v;
    assert.match(root().textContent ?? '', /অনুমতি/);
  });
});

/**
 * 06 Routine §01 — what the design adds to the checklist, and what it must
 * not take away. The drawing is the bar (title + one "৪ / ৬ ধাপ" chip), one
 * panel of rows with "ঠিক করুন" beside every incomplete row, and a footer
 * sentence under a 2px rule.
 */
describe('Ata Ekta — the setup checklist as drawn', () => {
  beforeEach(() => {
    sent = []; navigated = []; readiness = READINESS;
    postReply = { ok: true, status: 200, body: { periods: 2, teaching: 1 } };
  });

  test('the bar counts complete steps over all steps, from the server’s rows', async () => {
    await mount();
    const chip = root().querySelector('.page-header .setup-count');
    assert.ok(chip, 'the chip sits in the page header');
    assert.equal(chip.textContent, '২ / ৪ ধাপ', 'two ok rows of four in the fixture');
    assert.equal(chip.getAttribute('data-tone'), 'warn');
    assert.equal(root().querySelectorAll('h1').length, 1, 'exactly one h1');
  });

  test('every step is one row, and "ঠিক করুন" stands only beside the incomplete ones', async () => {
    await mount();
    const rows = [...root().querySelectorAll<HTMLElement>('.setup-panel li.setup-step')];
    assert.equal(rows.length, 4);
    for (const row of rows) {
      const fix = buttonIn(row, 'ঠিক করুন');
      if (row.dataset.state === 'ok') assert.equal(fix, undefined, `${row.dataset.step} is complete`);
      else assert.ok(fix, `${row.dataset.step} is ${row.dataset.state} and must offer the fix`);
    }
  });

  test('the three states differ in glyph shape, not only in colour', async () => {
    await mount();
    const glyphOf = (step: string) =>
      root().querySelector(`li[data-step="${step}"] .ui-list-glyph svg`)?.innerHTML ?? '';
    const ok = glyphOf('periods');
    const blocked = glyphOf('assignments');
    const warn = glyphOf('availability');
    assert.ok(ok && blocked && warn, 'every row draws a glyph');
    assert.notEqual(ok, blocked);
    assert.notEqual(blocked, warn);
    assert.notEqual(ok, warn);
  });

  test('the state word is VISIBLE on every row, not only read aloud', async () => {
    // P9-2 #1 for sighted readers. `textContent` includes visually hidden
    // text, so the suite above would still pass if the word were sr-only;
    // this one reads the detail line a sighted coordinator actually sees.
    await mount();
    const expected: Record<string, string> = {
      workingdays: 'সম্পূর্ণ', periods: 'সম্পূর্ণ', assignments: 'প্রয়োজন', availability: 'ঐচ্ছিক',
    };
    for (const row of root().querySelectorAll<HTMLElement>('.setup-panel li.setup-step')) {
      const word = expected[row.dataset.step ?? ''];
      const state = row.querySelector('.ui-list-sub .setup-step-state');
      assert.ok(state, `${row.dataset.step} names its state in the detail line`);
      assert.equal(state.textContent, word);
      assert.equal(state.closest('.ui-sr-only'), null, `${row.dataset.step}: the word is not hidden`);
      assert.equal(row.querySelector('.ui-sr-only'), null, 'no hidden copy of the word either');
    }
    const blockedSub = cardFor('কে কোন বিষয় পড়ান')?.querySelector('.ui-list-sub')?.textContent ?? '';
    const warnSub = cardFor('শিক্ষকের সময়-সীমা')?.querySelector('.ui-list-sub')?.textContent ?? '';
    assert.match(blockedSub, /^প্রয়োজন · ১২টির মধ্যে/, 'the word leads, the server’s detail follows');
    assert.match(warnSub, /^ঐচ্ছিক · /);
  });

  test('a step with no detail sentence still shows its state word', async () => {
    readiness = {
      ...READINESS,
      steps: READINESS.steps.map((s) => s.id === 'availability' ? { ...s, detailBn: '' } : s),
    };
    await mount();
    const row = cardFor('শিক্ষকের সময়-সীমা') as HTMLElement;
    assert.equal(row.querySelector('.ui-list-sub .setup-step-state')?.textContent, 'ঐচ্ছিক');
  });

  test('no accent button until an editor is open, and then exactly one', async () => {
    await mount();
    assert.equal(root().querySelectorAll('.btn-primary').length, 0,
      'a blocked row is no longer a primary; the rows are outline controls');
    buttonIn(cardFor('পিরিয়ড ও বিরতি') as HTMLElement, 'খুলুন')?.click();
    await settle();
    assert.equal(root().querySelectorAll('.btn-primary').length, 1);
  });

  test('an inline step says whether it is open', async () => {
    await mount();
    const toggle = () => buttonIn(cardFor('পিরিয়ড ও বিরতি') as HTMLElement, 'খুলুন')
      ?? buttonIn(cardFor('পিরিয়ড ও বিরতি') as HTMLElement, 'বন্ধ করুন');
    assert.equal(toggle()?.getAttribute('aria-expanded'), 'false');
    toggle()?.click();
    await settle();
    assert.equal(toggle()?.getAttribute('aria-expanded'), 'true');
    assert.ok(cardFor('পিরিয়ড ও বিরতি')?.querySelector('.setup-step-editor .setup-period-row'),
      'the editor opens under its own row');
  });

  test('numbers are in the numeral face, on the number and not the sentence', async () => {
    await mount();
    const foot = root().querySelector('.setup-foot-text') as HTMLElement;
    assert.ok(foot);
    assert.equal(foot.classList.contains('n'), false);
    assert.deepEqual([...foot.querySelectorAll('.n')].map((n) => n.textContent), ['১', '১']);
    const detail = cardFor('কে কোন বিষয় পড়ান')?.querySelector('.ui-list-sub') as HTMLElement;
    assert.ok([...detail.querySelectorAll('.n')].some((n) => n.textContent === '১২'));
  });

  test('a redraw keeps one frame in the root, so the entrance does not replay', async () => {
    await mount();
    assert.equal(root().children.length, 1);
    const frame = root().firstElementChild;
    buttonIn(cardFor('পিরিয়ড ও বিরতি') as HTMLElement, 'খুলুন')?.click();
    await settle();
    assert.equal(root().children.length, 1);
    assert.equal(root().firstElementChild, frame);
  });

  test('a refused save is shown beside the editor it came from', async () => {
    postReply = { ok: false, status: 409, body: { error: 'period_overlap', message: 'দুটি পিরিয়ড একই সময়ে পড়ছে' } };
    await mount();
    buttonIn(cardFor('পিরিয়ড ও বিরতি') as HTMLElement, 'খুলুন')?.click();
    await settle();
    buttonIn(root(), 'সংরক্ষণ করুন')?.click();
    await settle();
    const editor = cardFor('পিরিয়ড ও বিরতি')?.querySelector('.setup-step-editor') as HTMLElement;
    assert.match(editor.querySelector('[role="alert"]')?.textContent ?? '', /একই সময়ে পড়ছে/);
  });
});
