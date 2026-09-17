/**
 * R-4 — the academic calendar screen.
 *
 * The behaviours worth holding, in the order they would hurt if lost:
 *
 *   - the weekend comes from the TENANT, never from a hardcoded Friday
 *   - exam entries render and carry no edit control, because they belong to
 *     the exam tables and this screen does not own them
 *   - two events can share a day, and both appear
 *   - a holiday's marker is in the accessible name too, not colour alone
 *   - deleting a holiday warns that the day's attendance SMS resumes
 *   - notifying is confirmed, because a notice cannot be recalled
 *   - dates read in Bangla; no ISO string reaches a normal user
 *   - a refusal is the whole answer, never a refusal above an empty grid
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { CalendarView, type CalendarPayload, type CalendarEntry } from '../src/calendar-view.ts';
import { permissionMessage } from '../src/ui/feedback.ts';

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'https://school.example/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.HTMLFormElement = dom.window.HTMLFormElement;
  g.Event = dom.window.Event;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.location = dom.window.location;
  g.localStorage = dom.window.localStorage;
});

const doc = () => dom.window.document;
const root = () => doc().getElementById('root')!;
const text = () => root().textContent ?? '';
const settle = () => new Promise((r) => setTimeout(r, 0));
const fire = (el: Element, type = 'click') => el.dispatchEvent(new dom.window.Event(type));
const byLabel = (re: RegExp) =>
  [...root().querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
const days = () => [...root().querySelectorAll('.cal-day')] as HTMLElement[];
/** The month arrows are icon-only; they are found by their accessible name. */
const arrow = (dir: 'আগের' | 'পরের') =>
  root().querySelector(`button[aria-label^="${dir} মাস"]`) as HTMLElement | null;
/** confirmOverlay mounts on the body, outside the view root. */
const pageText = () => doc().body.textContent ?? '';
const dayOf = (n: string) => days().find((b) => b.getAttribute('aria-label')?.startsWith(n));

function fakeAuth(body: unknown, opts: { status?: number; throws?: boolean } = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  return {
    calls,
    role: 'principal', tenantId: 't1', userId: 'u1', displayName: 'প্রধান',
    isLoggedIn: () => true,
    authedFetch: async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (opts.throws) throw new Error('offline');
      const payload = init?.method && init.method !== 'GET'
        ? { id: 'new', notified: 1240 }
        : body;
      return new Response(JSON.stringify(payload), {
        status: opts.status ?? 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

const ENTRY = (over: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: 'c1', day: '2026-10-10', kind: 'holiday', titleBn: 'বিদ্যালয় ছুটি',
  descriptionBn: 'দুর্গাপূজা উপলক্ষে', appliesToShifts: null,
  source: 'calendar', editable: true, createdByNameBn: 'প্রধান শিক্ষক',
  ...over,
});

const PAYLOAD = (over: Partial<CalendarPayload> = {}): CalendarPayload => ({
  range: { from: '2026-10-01', to: '2026-10-31' },
  weekendDays: [5, 6],
  shifts: ['morning', 'day'],
  years: [{ id: 'y1', label: '২০২৬', isCurrent: true, startsOn: '2026-01-01', endsOn: '2026-12-31' }],
  currentYearId: 'y1',
  entries: [ENTRY()],
  ...over,
});

/** Mount, then step to October 2026 so the fixture's dates are on screen. */
async function mountOctober(payload: CalendarPayload, canManage = true) {
  const auth = fakeAuth(payload);
  new CalendarView({ root: root(), doc: doc(), auth: auth as never, canManage });
  await settle();
  const target = new Date(2026, 9, 1);
  const now = new Date();
  const steps = (target.getFullYear() - now.getFullYear()) * 12
    + (target.getMonth() - now.getMonth());
  const step = steps >= 0 ? 'পরের' : 'আগের';
  for (let i = 0; i < Math.abs(steps); i++) {
    fire(arrow(step)!);
    await settle();
  }
  return auth;
}

// ── The weekend, which is the whole multi-tenant point ─────────────────

describe('the weekend comes from the tenant', () => {
  test('THE ONE THAT MATTERS — Friday+Saturday for one school…', async () => {
    await mountOctober(PAYLOAD({ weekendDays: [5, 6] }));
    const heads = [...root().querySelectorAll('.cal-grid thead th')];
    // Each header carries the full name (what a reader hears) and a
    // one-letter phone label; the full name identifies the column. The week
    // is drawn Saturday-first, so the tenant's {5,6} is শনি … শুক্র.
    const shaded = heads.filter((h) => h.classList.contains('cal-weekend'))
      .map((h) => h.querySelector('.cal-wd-full')?.textContent);
    assert.deepEqual(shaded, ['শনি', 'শুক্র']);
  });

  test('…and Friday only for a Madrasah, from the same code', async () => {
    await mountOctober(PAYLOAD({ weekendDays: [5] }));
    const shaded = [...root().querySelectorAll('.cal-grid thead th')]
      .filter((h) => h.classList.contains('cal-weekend'))
      .map((h) => h.querySelector('.cal-wd-full')?.textContent);
    assert.deepEqual(shaded, ['শুক্র'],
      'a hardcoded Friday+Saturday would have shaded two columns here');
    // The day cells carry the same answer; `data-state` is the hook the grey
    // weekend ground is drawn from, so a Saturday here must not get it.
    assert.equal(dayOf('১৬ অক্টোবর')!.closest('td')!.getAttribute('data-state'), 'weekend');
    assert.equal(dayOf('১৭ অক্টোবর')!.closest('td')!.getAttribute('data-state'), 'normal');
  });

  test('a school with no weekend at all shades nothing rather than guessing', async () => {
    await mountOctober(PAYLOAD({ weekendDays: [] }));
    assert.equal(root().querySelectorAll('.cal-grid thead th.cal-weekend').length, 0);
  });

  test('the weekend reaches the accessible name, not just the shading', async () => {
    await mountOctober(PAYLOAD({ weekendDays: [5, 6], entries: [] }));
    const friday = days().find((b) => b.getAttribute('aria-label')?.includes('সাপ্তাহিক ছুটি'));
    assert.ok(friday, 'a shaded column a screen reader cannot hear is information withheld');
  });
});

// ── Exams: drawn, not owned ────────────────────────────────────────────

describe('exam entries', () => {
  const withExam = PAYLOAD({
    entries: [
      ENTRY(),
      ENTRY({
        id: 'exam-subject:e1', day: '2026-10-21', kind: 'exam',
        titleBn: 'অর্ধবার্ষিক — পদার্থবিজ্ঞান', descriptionBn: 'নবম শ্রেণি · সেকশন F',
        source: 'exam', editable: false, createdByNameBn: null,
      }),
    ],
  });

  test('THE ONE THAT MATTERS — an exam has no edit or delete control', async () => {
    await mountOctober(withExam);
    fire(dayOf('২১ অক্টোবর')!);
    await settle();
    assert.match(text(), /পদার্থবিজ্ঞান/);
    assert.equal(byLabel(/^সম্পাদনা$/), undefined,
      'the exam tables own this date; two places to change it is two answers');
    assert.equal(byLabel(/^মুছে ফেলুন$/), undefined);
  });

  test('and says where it DOES change, so nobody hunts for the button', async () => {
    await mountOctober(withExam);
    fire(dayOf('২১ অক্টোবর')!);
    await settle();
    assert.match(text(), /পরীক্ষার রুটিনে যান/);
  });

  test('a calendar entry, by contrast, has both controls', async () => {
    await mountOctober(withExam);
    fire(dayOf('১০ অক্টোবর')!);
    await settle();
    assert.ok(byLabel(/^সম্পাদনা$/));
    assert.ok(byLabel(/^মুছে ফেলুন$/));
  });
});

// ── Two events on one day: the constraint 043 relaxed ──────────────────

describe('multiple entries on one day', () => {
  const twoEvents = PAYLOAD({
    entries: [
      ENTRY({ id: 'e1', day: '2026-10-15', kind: 'event', titleBn: 'ক্রীড়া দিবস' }),
      ENTRY({ id: 'e2', day: '2026-10-15', kind: 'event', titleBn: 'অভিভাবক সভা' }),
    ],
  });

  test('both appear in the day panel', async () => {
    await mountOctober(twoEvents);
    fire(dayOf('১৫ অক্টোবর')!);
    await settle();
    assert.match(text(), /ক্রীড়া দিবস/);
    assert.match(text(), /অভিভাবক সভা/);
  });

  test('and both are named in the cell’s accessible label', async () => {
    await mountOctober(twoEvents);
    const label = dayOf('১৫ অক্টোবর')!.getAttribute('aria-label') ?? '';
    assert.match(label, /ক্রীড়া দিবস/);
    assert.match(label, /অভিভাবক সভা/);
  });

  test('the dots are capped at three but the label is not', async () => {
    const five = PAYLOAD({
      entries: Array.from({ length: 5 }, (_, i) =>
        ENTRY({ id: `e${i}`, day: '2026-10-15', kind: 'event', titleBn: `অনুষ্ঠান ${i}` })),
    });
    await mountOctober(five);
    const cell = dayOf('১৫ অক্টোবর')!;
    assert.equal(cell.querySelectorAll('.cal-dot').length, 3, 'a fourth dot in a 40px cell is noise');
    assert.match(cell.getAttribute('aria-label') ?? '', /অনুষ্ঠান 4/);
  });
});

// ── Holidays ───────────────────────────────────────────────────────────

describe('holidays', () => {
  test('a holiday is marked in the accessible name, not colour alone', async () => {
    await mountOctober(PAYLOAD());
    const label = dayOf('১০ অক্টোবর')!.getAttribute('aria-label') ?? '';
    assert.match(label, /ছুটি: বিদ্যালয় ছুটি/);
  });

  test('THE ONE THAT MATTERS — deleting one warns that the SMS resumes', async () => {
    await mountOctober(PAYLOAD());
    fire(dayOf('১০ অক্টোবর')!);
    await settle();
    fire(byLabel(/^মুছে ফেলুন$/)!);
    await settle();
    // The consequence nobody would guess: calendar_days drives sms-svc's
    // holiday suppression, so removing the holiday un-silences that day.
    assert.match(pageText(), /হাজিরার এসএমএস আবার পাঠানো হবে/);
  });

  test('deleting an ordinary event does not claim that', async () => {
    await mountOctober(PAYLOAD({
      entries: [ENTRY({ kind: 'event', titleBn: 'ক্রীড়া দিবস' })],
    }));
    fire(dayOf('১০ অক্টোবর')!);
    await settle();
    fire(byLabel(/^মুছে ফেলুন$/)!);
    await settle();
    assert.ok(doc().querySelector('[role="alertdialog"]'), 'the confirmation is open');
    assert.doesNotMatch(pageText(), /এসএমএস আবার/);
  });
});

// ── The form ───────────────────────────────────────────────────────────

describe('the event form', () => {
  test('offers no start/end time, because nothing in the product reads one', async () => {
    await mountOctober(PAYLOAD());
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    assert.equal(root().querySelectorAll('input[type=time]').length, 0,
      'a time the office fills in that no consumer honours is worse than none');
  });

  test('asks for shifts only when the school runs more than one', async () => {
    await mountOctober(PAYLOAD({ shifts: ['morning', 'day'] }));
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    assert.ok(root().querySelector('fieldset'), 'two shifts is a real choice');

    root().textContent = '';
    await mountOctober(PAYLOAD({ shifts: ['single'] }));
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    assert.equal(root().querySelectorAll('fieldset').length, 0,
      'one shift makes "which shift" a question with one answer');
  });

  test('refuses an empty title in place', async () => {
    await mountOctober(PAYLOAD());
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    const form = root().querySelector('.ui-card-form')!;
    fire(form, 'submit');
    // P5: the message is in the TITLE field's own error slot, not in one
    // shared line at the top of the form. The old form said "শিরোনাম লিখুন"
    // above the date input, which is where the eye was not.
    const title = form.querySelector('[name="titleBn"]')!.closest('.ui-field')!;
    assert.match(title.querySelector('.ui-field-error')?.textContent ?? '', /শিরোনাম লিখুন/);
    assert.equal(title.querySelector('.ui-field-error')?.hasAttribute('hidden'), false);
    assert.equal(form.querySelector('[name="titleBn"]')?.getAttribute('aria-invalid'), 'true');
  });

  test('SMS is unavailable until notify is chosen', async () => {
    await mountOctober(PAYLOAD());
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    const boxes = [...root().querySelectorAll('.ui-card-form input[type=checkbox]')] as HTMLInputElement[];
    const sms = boxes[boxes.length - 1];
    const notify = boxes[boxes.length - 2];
    assert.equal(sms.disabled, true, 'an SMS with no notice behind it is a stray charge');
    notify.checked = true;
    fire(notify, 'change');
    assert.equal(sms.disabled, false);
  });

  test('notifying is confirmed, because a notice cannot be recalled', async () => {
    const auth = await mountOctober(PAYLOAD());
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    const form = root().querySelector('.ui-card-form')!;
    (form.querySelector('[name="titleBn"]') as HTMLInputElement).value = 'ছুটি';
    const boxes = [...form.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
    const notify = boxes[boxes.length - 2];
    notify.checked = true;
    fire(notify, 'change');
    fire(form, 'submit');
    await settle();
    assert.match(pageText(), /ফিরিয়ে নেওয়া যায় না/);
    assert.equal(doc().activeElement?.textContent, 'বাতিল');
    assert.equal(auth.calls.some((c) => c.init?.method === 'POST'), false,
      'nothing is sent until the confirmation is answered');
  });

  test('saving without notify goes straight through', async () => {
    const auth = await mountOctober(PAYLOAD());
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    const form = root().querySelector('.ui-card-form')!;
    (form.querySelector('[name="titleBn"]') as HTMLInputElement).value = 'ছুটি';
    fire(form, 'submit');
    await settle(); await settle();
    const post = auth.calls.find((c) => c.init?.method === 'POST');
    assert.ok(post, 'no confirmation should stand between a quiet entry and the server');
    assert.match(String(post!.init!.body), /"notify":false/);
  });
});

// ── D13's four states ──────────────────────────────────────────────────

describe('the four states', () => {
  test('an empty month says so and offers a way to fill it', async () => {
    await mountOctober(PAYLOAD({ entries: [] }));
    assert.match(text(), /এই মাসে কোনো কিছু নির্ধারিত নেই/);
    assert.ok(byLabel(/এন্ট্রি যোগ করুন/));
  });

  test('an empty FILTERED month blames the filter, not the school', async () => {
    const auth = fakeAuth(PAYLOAD({ entries: [] }));
    new CalendarView({ root: root(), doc: doc(), auth: auth as never, canManage: true });
    await settle();
    fire([...root().querySelectorAll('.seg-opt')][1]);   // ছুটি
    await settle(); await settle();
    assert.match(text(), /এই ধরনের কিছু এই মাসে নির্ধারিত নেই/);
  });

  test('an empty DAY is a different sentence from an empty month', async () => {
    await mountOctober(PAYLOAD({ entries: [] }));
    fire(days()[0]);
    await settle();
    assert.match(text(), /এই দিনে কোনো কিছু নির্ধারিত নেই/);
  });

  test('a 403 is the whole answer — no grid underneath it', async () => {
    const auth = fakeAuth(PAYLOAD(), { status: 403 });
    new CalendarView({ root: root(), doc: doc(), auth: auth as never, canManage: false });
    await settle();
    // B-30 unified five wordings into one pattern, so this asserts the
    // canonical sentence rather than a substring of the bespoke one it
    // replaced ("শিক্ষাপঞ্জি দেখার অনুমতি নেই।" — no আপনার). Same claim,
    // pinned to the function every screen now shares.
    assert.match(text(), new RegExp(permissionMessage('শিক্ষাপঞ্জি')));
    assert.equal(root().querySelectorAll('.cal-day').length, 0,
      '"you may not see this" and "nothing is scheduled" are different claims');
  });

  test('offline says so and offers a retry', async () => {
    const auth = fakeAuth(PAYLOAD(), { throws: true });
    new CalendarView({ root: root(), doc: doc(), auth: auth as never, canManage: true });
    await settle();
    assert.match(text(), /সংযোগ পেলে/);
    assert.ok(byLabel(/আবার চেষ্টা/));
  });

  test('success names what happened, including who was told', async () => {
    const auth = await mountOctober(PAYLOAD());
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    const form = root().querySelector('.ui-card-form')!;
    (form.querySelector('[name="titleBn"]') as HTMLInputElement).value = 'ছুটি';
    fire(form, 'submit');
    await settle(); await settle();
    assert.match(text(), /শিক্ষাপঞ্জিতে যুক্ত হয়েছে/);
    assert.match(text(), /১২৪০ জনকে জানানো হয়েছে/);
    void auth;
  });
});

// ── Authorization, localisation, navigation ────────────────────────────

describe('roles and presentation', () => {
  test('a read-only role sees the calendar and no controls at all', async () => {
    await mountOctober(PAYLOAD(), false);
    assert.ok(days().length > 0, 'a calendar guardians cannot see is not a school calendar');
    assert.equal(byLabel(/নতুন ঘটনা/), undefined);
    fire(dayOf('১০ অক্টোবর')!);
    await settle();
    assert.match(text(), /বিদ্যালয় ছুটি/);
    assert.equal(byLabel(/^সম্পাদনা$/), undefined);
    assert.equal(byLabel(/^মুছে ফেলুন$/), undefined);
  });

  test('no ISO date reaches a normal user', async () => {
    await mountOctober(PAYLOAD());
    fire(dayOf('১০ অক্টোবর')!);
    await settle();
    // The <input type=date> value is legitimately ISO; the READING surface
    // is what must not be.
    const reading = [...root().querySelectorAll(
      '.ui-list-title, .ui-list-main, .cal-hint, .cal-nav-month, .cal-month-chip, h2')]
      .map((e) => e.textContent).join(' ');
    assert.doesNotMatch(reading, /\d{4}-\d{2}-\d{2}/);
    assert.match(text(), /১০ অক্টোবর, ২০২৬/);
  });

  test('the month heading and numbers are Bangla', async () => {
    await mountOctober(PAYLOAD());
    assert.match(text(), /অক্টোবর ২০২৬/);
    assert.ok(days().some((d) => d.textContent?.includes('১০')));
  });

  test('navigating months refetches for the new range', async () => {
    const auth = await mountOctober(PAYLOAD());
    const before = auth.calls.length;
    fire(arrow('পরের')!);
    await settle();
    assert.ok(auth.calls.length > before);
    assert.match(auth.calls[auth.calls.length - 1].path, /from=2026-11-01&to=2026-11-30/);
  });

  test('the filter is a pressed state, not colour alone', async () => {
    await mountOctober(PAYLOAD());
    const opts = [...root().querySelectorAll('.seg-opt')];
    assert.equal(opts[0].getAttribute('aria-pressed'), 'true');
    assert.equal(opts[0].getAttribute('data-active'), 'true');
  });
});

// ── Ata Ekta: the drawn month (04 Guardian §05, 09 Comms §03) ──────────

describe('the drawn month', () => {
  // "Upcoming" is relative to today, so these pin the clock (Date only —
  // timers stay real) to a day before the October fixtures.
  beforeEach(() => { mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 17, 12) }); });
  afterEach(() => { mock.timers.reset(); });

  test('the week starts on Saturday, and the 1st falls in its own column', async () => {
    await mountOctober(PAYLOAD({ entries: [] }));
    const heads = [...root().querySelectorAll('.cal-grid thead th .cal-wd-full')]
      .map((h) => h.textContent);
    assert.deepEqual(heads, ['শনি', 'রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র']);
    // 1 October 2026 is a Thursday: five blanks (শনি … বুধ) before it.
    const firstRow = root().querySelector('.cal-grid tbody tr')!;
    const cells = [...firstRow.children];
    assert.equal(cells.findIndex((td) => td.querySelector('.cal-day')), 5);
    assert.match(cells[5].querySelector('.cal-day')!.getAttribute('aria-label') ?? '', /^১ অক্টোবর/);
  });

  test('each month arrow is named by the month it goes to', async () => {
    await mountOctober(PAYLOAD());
    assert.match(arrow('আগের')!.getAttribute('aria-label') ?? '', /সেপ্টেম্বর/);
    assert.match(arrow('পরের')!.getAttribute('aria-label') ?? '', /নভেম্বর/);
  });

  test('one primary action at a time — the form’s save replaces the header’s', async () => {
    await mountOctober(PAYLOAD());
    assert.equal(root().querySelectorAll('.btn-primary').length, 1);
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    assert.equal(root().querySelectorAll('.btn-primary').length, 1);
    assert.ok(byLabel(/সংরক্ষণ করুন/)?.classList.contains('btn-primary'));
  });

  test('a day is filled by its kind, and a day with nothing carries no kind', async () => {
    await mountOctober(PAYLOAD());
    assert.equal(dayOf('১০ অক্টোবর')!.closest('td')!.getAttribute('data-kind'), 'holiday');
    assert.equal(dayOf('১১ অক্টোবর')!.closest('td')!.hasAttribute('data-kind'), false);
  });

  test('the upcoming list shows a run of days as one row, and a reader hears the dates', async () => {
    await mountOctober(PAYLOAD({
      entries: ['2026-10-18', '2026-10-19', '2026-10-20'].map((day, i) =>
        ENTRY({ id: `x${i}`, day, kind: 'exam', titleBn: 'অর্ধবার্ষিক পরীক্ষা', editable: false })),
    }));
    const rows = [...root().querySelectorAll('.cal-upcoming .ui-list-item')];
    assert.equal(rows.length, 1, 'three identical rows for one exam week is noise');
    assert.equal(rows[0].querySelector('.cal-up-date')?.textContent, '১৮–২০');
    assert.match(rows[0].textContent ?? '', /১৮ অক্টোবর, ২০২৬ থেকে ২০ অক্টোবর, ২০২৬/);
    assert.match(rows[0].textContent ?? '', /পরীক্ষা/);
    // The kind is written where a sighted reader sees it, beside the coloured
    // date — not only inside the screen-reader text.
    const kind = rows[0].querySelector('.ui-list-sub');
    assert.equal(kind?.textContent, 'পরীক্ষা');
    assert.equal(kind?.closest('.ui-sr-only'), null, 'the kind word is visible, not colour alone');
  });

  test('an upcoming day from another month carries its month, never posing as this one', async () => {
    // An exam PERIOD arrives dated on its first day, which can be last month.
    await mountOctober(PAYLOAD({
      entries: [ENTRY({ id: 'exam:p1', day: '2026-09-25', kind: 'exam', titleBn: 'মধ্যবর্তী পরীক্ষা', editable: false })],
    }));
    assert.equal(root().querySelector('.cal-upcoming .cal-up-date')?.textContent, '২৫/৯');
  });

  test('a run’s later days label "—" in the cell, but still name the entry aloud', async () => {
    await mountOctober(PAYLOAD({
      entries: ['2026-10-05', '2026-10-06'].map((day, i) =>
        ENTRY({ id: `h${i}`, day, titleBn: 'শারদীয় ছুটি' })),
    }));
    assert.equal(dayOf('৫ অক্টোবর')!.querySelector('.cal-dot')?.textContent, 'শারদীয় ছুটি');
    assert.equal(dayOf('৬ অক্টোবর')!.querySelector('.cal-dot')?.textContent, '—');
    assert.match(dayOf('৬ অক্টোবর')!.getAttribute('aria-label') ?? '', /ছুটি: শারদীয় ছুটি/);
  });

  test('a refusal uses the shared denied state, with no retry', async () => {
    const auth = fakeAuth(PAYLOAD(), { status: 403 });
    new CalendarView({ root: root(), doc: doc(), auth: auth as never, canManage: true });
    await settle();
    assert.ok(root().querySelector('.ui-state-denied'));
    assert.equal(byLabel(/আবার চেষ্টা/), undefined, 'retrying a refusal is futile');
    assert.equal(byLabel(/নতুন ঘটনা/), undefined, 'no create control over a refusal');
  });
});

// ── R-4.1: the three day states ────────────────────────────────────────

describe('working weekend', () => {
  const WORKING = ENTRY({
    id: 'w1', day: '2026-10-17', kind: 'working_weekend',
    titleBn: 'বন্যার ক্ষতি পুষিয়ে নিতে ক্লাস', descriptionBn: null,
  });

  test('THE ONE THAT MATTERS — a working Saturday does not look shut', async () => {
    // 2026-10-17 is a Saturday, inside the {5,6} weekend. The whole point of
    // the override is that this ONE date is open while the column is not, so
    // the cell has to actively undo the weekend shading.
    await mountOctober(PAYLOAD({ entries: [WORKING] }));
    const cell = dayOf('১৭ অক্টোবর')!.closest('td')!;
    assert.equal(cell.getAttribute('data-state'), 'working_weekend');
    assert.ok(cell.classList.contains('cal-working'));
    assert.ok(cell.classList.contains('cal-weekend'),
      'it is still a weekend COLUMN; the day is the exception');
  });

  test('and says it is open, because the column around it says otherwise', async () => {
    await mountOctober(PAYLOAD({ entries: [WORKING] }));
    const label = dayOf('১৭ অক্টোবর')!.getAttribute('aria-label') ?? '';
    assert.match(label, /সাপ্তাহিক ছুটির দিনে খোলা/);
    assert.doesNotMatch(label, /^.*· সাপ্তাহিক ছুটি ·/,
      'a day that is open must not also be announced as the weekly holiday');
  });

  test('an ordinary weekend day is still announced as closed', async () => {
    await mountOctober(PAYLOAD({ entries: [WORKING] }));
    // 2026-10-24, the next Saturday, carries no override.
    const label = dayOf('২৪ অক্টোবর')!.getAttribute('aria-label') ?? '';
    assert.match(label, /সাপ্তাহিক ছুটি/);
    assert.doesNotMatch(label, /খোলা/);
  });

  test('a holiday on the same date wins, matching the sender', async () => {
    // The contradiction the schema permits. The UI must agree with
    // sms-svc's nonWorkingReasonFor, or the calendar lies about what the
    // system will do.
    await mountOctober(PAYLOAD({
      entries: [WORKING, ENTRY({ id: 'h1', day: '2026-10-17', kind: 'holiday' })],
    }));
    const cell = dayOf('১৭ অক্টোবর')!.closest('td')!;
    assert.equal(cell.getAttribute('data-state'), 'holiday');
    assert.ok(!cell.classList.contains('cal-working'));
  });

  test('a normal weekday is neither', async () => {
    await mountOctober(PAYLOAD({ entries: [] }));
    const cell = dayOf('১৯ অক্টোবর')!.closest('td')!;   // a Monday
    assert.equal(cell.getAttribute('data-state'), 'normal');
  });

  test('the key names every colour in words, in the drawn order', async () => {
    // Ata Ekta: a phone cell says its kind by fill colour, so the key is what
    // makes that colour words. It is fixed — ছুটি, অনুষ্ঠান, পরীক্ষা, খোলা —
    // so a colour is explained whether or not this month happens to use it.
    await mountOctober(PAYLOAD({ entries: [WORKING] }));
    const items = [...root().querySelectorAll('.cal-legend-item')]
      .filter((li) => li.querySelector('.cal-legend-swatch[data-kind]'));
    assert.deepEqual(
      items.map((li) => li.querySelector('.cal-legend-swatch')?.getAttribute('data-kind')),
      ['holiday', 'event', 'exam', 'working_weekend']);
    assert.deepEqual(items.map((li) => li.textContent), ['ছুটি', 'অনুষ্ঠান', 'পরীক্ষা', 'খোলা'],
      'every swatch has its word beside it — colour is never the message alone');
  });

  test('the tenant’s weekend is keyed, last, when it has one — and only then', async () => {
    // The weekend is what a "খোলা" Saturday is read against, so the key
    // explains it whenever the school has a weekend at all.
    await mountOctober(PAYLOAD({ weekendDays: [5, 6], entries: [WORKING] }));
    const items = [...root().querySelectorAll('.cal-legend-item')];
    const last = items[items.length - 1];
    assert.equal(last.querySelector('.cal-legend-swatch')?.getAttribute('data-state'), 'weekend');
    assert.equal(last.textContent, 'সাপ্তাহিক ছুটি');

    await mountOctober(PAYLOAD({ weekendDays: [], entries: [] }));
    assert.equal(root().querySelector('.cal-legend-swatch[data-state="weekend"]'), null,
      'a school with no weekend has nothing to key');
  });

  test('a kind outside the four is keyed only in a month that has one', async () => {
    await mountOctober(PAYLOAD({ entries: [WORKING] }));
    assert.equal(root().querySelector('.cal-legend-swatch[data-kind="ramadan_schedule"]'), null);
    await mountOctober(PAYLOAD({
      entries: [ENTRY({ id: 'r1', day: '2026-10-05', kind: 'ramadan_schedule', titleBn: 'রমজান' })],
    }));
    assert.ok(root().querySelector('.cal-legend-swatch[data-kind="ramadan_schedule"]'));
  });

  test('a working Saturday with a holiday is filled as the holiday', async () => {
    // The fill follows the same precedence as data-state and the sender.
    await mountOctober(PAYLOAD({
      entries: [WORKING, ENTRY({ id: 'h1', day: '2026-10-17', kind: 'holiday' })],
    }));
    assert.equal(dayOf('১৭ অক্টোবর')!.closest('td')!.getAttribute('data-kind'), 'holiday');
  });

  test('the card explains the effect, which "working weekend" alone does not', async () => {
    await mountOctober(PAYLOAD({ entries: [WORKING] }));
    fire(dayOf('১৭ অক্টোবর')!);
    await settle();
    assert.match(text(), /স্বাভাবিক কর্মদিবস হিসেবে গণ্য হবে/);
    assert.match(text(), /এসএমএস যথারীতি যাবে/);
  });

  test('deleting one warns that the day goes quiet again', async () => {
    await mountOctober(PAYLOAD({ entries: [WORKING] }));
    fire(dayOf('১৭ অক্টোবর')!);
    await settle();
    fire(byLabel(/^মুছে ফেলুন$/)!);
    await settle();
    // The opposite consequence to a holiday's, and just as invisible.
    assert.match(pageText(), /আবার\s*\n?\s*সাপ্তাহিক ছুটি হিসেবে গণ্য হবে|সাপ্তাহিক ছুটি হিসেবে গণ্য হবে/);
    assert.match(pageText(), /এসএমএস বন্ধ থাকবে/);
  });

  test('a read-only role sees the state and cannot change it', async () => {
    await mountOctober(PAYLOAD({ entries: [WORKING] }), false);
    assert.equal(dayOf('১৭ অক্টোবর')!.closest('td')!.getAttribute('data-state'),
      'working_weekend');
    fire(dayOf('১৭ অক্টোবর')!);
    await settle();
    assert.match(text(), /স্বাভাবিক কর্মদিবস/, 'the effect is legible to everyone');
    assert.equal(byLabel(/^সম্পাদনা$/), undefined);
    assert.equal(byLabel(/^মুছে ফেলুন$/), undefined);
  });

  test('it is offered in the create form and the filter', async () => {
    await mountOctober(PAYLOAD());
    assert.ok([...root().querySelectorAll('.seg-opt')]
      .some((o) => o.textContent === 'খোলা'), 'a school can find its make-up days');
    fire(byLabel(/নতুন ঘটনা/)!);
    await settle();
    const kinds = [...(root().querySelector('.ui-card-form select') as HTMLSelectElement).options]
      .map((o) => o.value);
    assert.ok(kinds.includes('working_weekend'));
  });
});
