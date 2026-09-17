/**
 * P9-8 — the published routine, as each persona meets it.
 *
 * The API suite pins what the server will and will not answer. These are the
 * things about the SCREEN:
 *
 *   1. THE PICKER IS THE SERVER'S LIST. A menu assembled here from
 *      `auth.role` would be a second opinion about permission, and the first
 *      time it disagreed a person would be offered a view that 403s.
 *
 *   2. ONE READER, ONE CHOICE. A student has exactly one thing to look at, so
 *      they get no picker at all — a select with one option is a control that
 *      does nothing.
 *
 *   3. THE GRID IS ONE PER SHIFT. Morning period 8 and day period 1 are
 *      different hours with the same number; one table keyed on period number
 *      would put them in the same row.
 *
 *   4. A CELL CARRIES ITS OWN NAME. A screen reader moving through a table
 *      cell by cell has no other way to know which day and hour it is in.
 *
 *   5. NOTHING PUBLISHED IS A STATE, NOT A FAILURE. A school in its first
 *      week meets it, and it must say what happens next.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TimetableView, type TimetablePayload } from '../src/timetable-view.ts';
import { ordinalBn, formatClockRange } from '../../../packages/ui-core/src/format.ts';

let dom: JSDOM;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
                  { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.CSS = dom.window.CSS;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
});

const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const settle = async () => {
  for (let i = 0; i < 14; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = () => root().textContent ?? '';
const selects = () => [...root().querySelectorAll('select')];
const optionsOf = (i: number) => [...(selects()[i]?.options ?? [])].map((o) => o.textContent);
const scopeTabs = () => [...root().querySelectorAll<HTMLButtonElement>('.tt-scope-tabs [role="tab"]')];
const dayTabs = () => [...root().querySelectorAll<HTMLButtonElement>('.tt-day [role="tab"]')];
const dayRows = () => [...root().querySelectorAll('.tt-day-panel .ui-list-item')];

const period = (n: number) => ({
  routineId: 'r1', periodNo: n, labelBn: `${n} নম্বর`,
  startsAt: `${String(8 + n).padStart(2, '0')}:00`,
  endsAt: `${String(8 + n).padStart(2, '0')}:45`,
});
const lesson = (dow: number, p: number, over: Partial<TimetablePayload['lessons'][number]> = {}) => ({
  routineId: 'r1', dayOfWeek: dow, periodNo: p,
  startsAt: `${String(8 + p).padStart(2, '0')}:00`,
  endsAt: `${String(8 + p).padStart(2, '0')}:45`,
  subjectBn: 'গণিত', teacherBn: 'রফিক স্যার', roomBn: '১০১ নম্বর কক্ষ',
  sectionLabel: 'ক', classBn: 'নবম শ্রেণি', isParallel: false, ...over,
});

const BASE: TimetablePayload = {
  ok: true, scope: 'section', published: true,
  titleBn: 'নবম শ্রেণি — ক', subtitleBn: 'শাখার সাপ্তাহিক রুটিন',
  counts: { sections: 1, teachers: 3, rooms: 2, classes: 1 },
  routines: [{ id: 'r1', version: 2, shift: 'single', shiftBn: 'একক',
               nameBn: 'বার্ষিক রুটিন', publishedAt: '2026-03-02T05:30:00.000Z',
               yearLabel: '২০২৬' }],
  periods: [period(1), period(2)],
  lessons: [lesson(0, 1), lesson(0, 2, { subjectBn: 'বাংলা' }), lesson(1, 1)],
  days: [{ dow: 0, bn: 'রবি' }, { dow: 1, bn: 'সোম' }],
  offered: [
    { scope: 'section', labelBn: 'আমার শাখা',
      options: [{ id: 'sec-a', labelBn: 'নবম শ্রেণি — ক' }] },
    { scope: 'teacher', labelBn: 'আমার রুটিন',
      options: [{ id: 'self', labelBn: 'আমার সাপ্তাহিক ক্লাস' }] },
  ],
};

let payload: TimetablePayload;
let reply: { ok: boolean; status: number; body: unknown } | null = null;
/** What `/ops/document` answers when the print drawer asks. */
let printReply: { ok: boolean; status: number; text: string; body?: unknown } =
  { ok: true, status: 200, text: '<html><body><main class="doc">sheet</main></body></html>' };
let asked: string[] = [];
let navigated: string[] = [];

function auth() {
  return {
    role: 'class_teacher',
    authedFetch: async (url: string) => {
      asked.push(url);
      if (url.includes('/ops/document')) {
        return { ok: printReply.ok, status: printReply.status,
                 text: async () => printReply.text,
                 json: async () => printReply.body ?? {} } as unknown as Response;
      }
      if (reply) {
        return { ok: reply.ok, status: reply.status,
                 json: async () => reply.body } as unknown as Response;
      }
      return { ok: true, status: 200,
               json: async () => structuredClone(payload) } as unknown as Response;
    },
  } as never;
}

const mount = async (over: Record<string, unknown> = {}) => {
  root().textContent = '';
  new TimetableView({
    root: root(), doc: doc(), auth: auth(),
    onNavigate: (p) => navigated.push(p), ...over,
  });
  await settle();
};

describe('P9-8 — the published routine on screen', () => {
  beforeEach(() => {
    payload = structuredClone(BASE);
    reply = null;
    asked = [];
    navigated = [];
    printReply = { ok: true, status: 200,
                   text: '<html><body><main class="doc">sheet</main></body></html>' };
    doc().querySelectorAll('[role="dialog"]').forEach((n) => n.remove());
    doc().querySelectorAll('.ui-scrim').forEach((n) => n.remove());
  });

  /* ─────────────────────────── the picker ─────────────────────────────── */

  test('THE ONE THAT MATTERS — the picker is the server’s list, verbatim', async () => {
    await mount();
    // Two scopes offered, so two choices: which kind (the view tabs 06 Routine
    // draws), and which one (the select).
    assert.deepEqual(scopeTabs().map((t) => t.textContent), ['আমার শাখা', 'আমার রুটিন']);
    assert.deepEqual(optionsOf(0), ['নবম শ্রেণি — ক']);
    // Nothing the screen invented: every choice came from `offered`.
    for (const label of scopeTabs().map((t) => t.textContent)) {
      assert.ok(payload.offered.some((o) => o.labelBn === label), label ?? '');
    }
    // The one showing is the scope the server answered.
    assert.equal(scopeTabs()[0].getAttribute('aria-selected'), 'true');
    assert.equal(scopeTabs()[1].getAttribute('aria-selected'), 'false');
  });

  test('§2 — one reader with one thing to look at gets no picker', async () => {
    payload.scope = 'student';
    payload.offered = [{ scope: 'student', labelBn: 'আমার রুটিন',
                         options: [{ id: 'self', labelBn: 'আমার সাপ্তাহিক ক্লাস' }] }];
    await mount();
    assert.equal(selects().length, 0,
      'a select with one option is a control that does nothing');
    assert.equal(scopeTabs().length, 0, 'and neither is a strip of one tab');
    assert.match(text(), /মোট ক্লাস/, 'and the timetable is still there');
    assert.equal(root().querySelectorAll('.routine-grid').length, 1);
  });

  test('changing the scope asks the server again, for that scope', async () => {
    await mount();
    const before = asked.length;
    scopeTabs()[1].click();
    await settle();
    assert.ok(asked.length > before, 'it re-reads rather than filtering locally');
    assert.match(asked.at(-1) ?? '', /scope=teacher/);
    assert.match(asked.at(-1) ?? '', /id=self/);
  });

  test('the scope already showing does not ask again', async () => {
    await mount();
    const before = asked.length;
    scopeTabs()[0].click();
    await settle();
    assert.equal(asked.length, before, 'a select does not fire on the option it already shows');
  });

  test('a scope offered twice resolves to its first offer, as the select did', async () => {
    // A principal who also teaches: "আমার রুটিন" and "শিক্ষক" are both scope
    // teacher. The select's option values were scopes, so choosing either
    // asked for the first one — the tabs must not quietly start doing better.
    payload.offered = [
      { scope: 'teacher', labelBn: 'আমার রুটিন',
        options: [{ id: 'self', labelBn: 'আমার সাপ্তাহিক ক্লাস' }] },
      { scope: 'institution', labelBn: 'পুরো প্রতিষ্ঠান' },
      { scope: 'teacher', labelBn: 'শিক্ষক',
        options: [{ id: 't-9', labelBn: 'রফিক স্যার' }] },
    ];
    payload.scope = 'institution';
    await mount({ scope: 'institution' });
    assert.equal(selects().length, 0, 'the whole institution has no second choice');
    scopeTabs()[2].click();
    await settle();
    assert.match(asked.at(-1) ?? '', /scope=teacher/);
    assert.match(asked.at(-1) ?? '', /id=self/);
  });

  test('a view tab keeps keyboard focus through the reload it asks for', async () => {
    await mount();
    scopeTabs()[1].click();
    await settle();
    // The server here always answers scope=section, so the first tab is selected.
    const selected = root().querySelector('.tt-scope-tabs [aria-selected="true"]');
    assert.ok(selected);
    assert.equal(doc().activeElement, selected,
      'a rebuilt strip must not drop the keyboard to the top of the page');
  });

  test('the first read names no scope — the server answers from the reader’s menu', async () => {
    await mount();
    assert.equal(asked[0], '/api/v1/rms/timetable',
      'guessing a scope here would be a second opinion about permission');
  });

  /* ──────────────────────────── the grid ──────────────────────────────── */

  test('§3 — one grid per shift, never one table keyed on period number', async () => {
    payload.routines.push({ id: 'r2', version: 2, shift: 'day', shiftBn: 'দিবা',
                            nameBn: 'দিবা রুটিন', publishedAt: null, yearLabel: '২০২৬' });
    payload.periods.push({ routineId: 'r2', periodNo: 1, labelBn: '১ নম্বর',
                           startsAt: '13:00', endsAt: '13:45' });
    payload.lessons.push({ ...lesson(0, 1), routineId: 'r2', subjectBn: 'ইংরেজি',
                           startsAt: '13:00', endsAt: '13:45' });
    await mount();
    assert.equal(root().querySelectorAll('.routine-grid').length, 2);
    assert.match(text(), /একক শিফট/);
    assert.match(text(), /দিবা শিফট/);
  });

  test('§4 — every cell names its own day and hour for a screen reader', async () => {
    await mount();
    const cell = root().querySelector('.routine-slot') as HTMLElement;
    assert.ok(cell);
    const name = cell.getAttribute('aria-label') ?? '';
    assert.match(name, /রবিবার/, 'the day');
    // The ordinal and the clock a sighted reader sees, not `period_no` and a
    // 24-hour range — the label used to carry both, and both were wrong.
    assert.match(name, /১ম পিরিয়ড/, 'the hour');
    assert.match(name, /সকাল ৯:০০–৯:৪৫/, 'the clock time');
    assert.match(name, /গণিত/, 'and what happens in it');
  });

  test('an empty hour is a dash, not a missing cell', async () => {
    await mount();
    // Two periods x two days = four cells; three lessons, so one is empty.
    assert.equal(root().querySelectorAll('.routine-cell').length, 4);
    assert.match(text(), /—/);
  });

  test('a crowded cell shows a few and counts the rest', async () => {
    payload.scope = 'institution';
    payload.lessons = [0, 1, 2, 3, 4].map((k) =>
      lesson(0, 1, { sectionLabel: String.fromCharCode(0x995 + k) }));
    await mount();
    assert.match(text(), /আরও ২টি/,
      'the institution’s cell holds sixteen; a grid that printed them all is a list');
  });

  test('the section is named only when more than one is on screen', async () => {
    await mount();                       // scope=section
    const secCell = root().querySelector('.routine-slot')?.textContent ?? '';
    assert.doesNotMatch(secCell, /নবম শ্রেণি-ক/,
      'repeating the section in every cell of its own grid is noise');

    payload.scope = 'institution';
    await mount();
    assert.match(root().querySelector('.routine-slot')?.textContent ?? '', /নবম শ্রেণি-ক/);
  });

  test('a teacher’s own grid does not repeat the teacher in every cell', async () => {
    payload.scope = 'teacher';
    await mount();
    assert.doesNotMatch(root().querySelector('.routine-slot')?.textContent ?? '',
      /রফিক স্যার/);
    assert.match(text(), /১০১ নম্বর কক্ষ/, 'but the room still matters to them');
  });

  test('a split hour says so', async () => {
    payload.lessons = [lesson(0, 1, { isParallel: true })];
    await mount();
    assert.match(text(), /বিভাজিত ক্লাস/);
  });

  test('THE SCREEN AND THE SHEET AGREE — same ordinal, same clock', () => {
    // A screen that says one thing and paper printed from it that says
    // another is the divergence this whole shared read exists to prevent.
    // Both of these were wrong on the screen and right on the sheet, and a
    // browser check caught it because no test asserted the screen's clock.
    assert.equal(ordinalBn(5), '৫ম');
    assert.equal(formatClockRange('13:30', '14:15', 'bn'), 'দুপুর ১:৩০–২:১৫');
  });

  test('§3 — the grid clock is 12-hour with the part of the day', async () => {
    payload.periods = [
      { ...period(1), startsAt: '10:00', endsAt: '10:45', kind: 'teaching' },
      { ...period(2), labelBn: 'টিফিন', startsAt: '13:00', endsAt: '13:30',
        kind: 'tiffin' },
      { ...period(3), startsAt: '13:30', endsAt: '14:15', kind: 'teaching' },
    ];
    payload.lessons = [lesson(0, 3, { startsAt: '13:30', endsAt: '14:15' })];
    await mount();
    const t = text();
    assert.match(t, /সকাল ১০:০০–১০:৪৫/);
    assert.match(t, /দুপুর ১:৩০–২:১৫/, 'the afternoon hour, not ১৩:৩০');
    assert.doesNotMatch(t, /১৩:৩০|১৪:১৫/,
      'a 24-hour clock under a period ordinal reads as a period number');
    // The break carries its clock the same way.
    assert.match(t, /টিফিন/);
    assert.match(t, /দুপুর ১:০০–১:৩০/);
  });

  test('§2 — the screen ordinal counts TAUGHT hours, skipping the break', async () => {
    payload.periods = [
      { ...period(1), startsAt: '10:00', endsAt: '10:45', kind: 'teaching' },
      { ...period(2), labelBn: 'টিফিন', startsAt: '13:00', endsAt: '13:30',
        kind: 'tiffin' },
      { ...period(3), startsAt: '13:30', endsAt: '14:15', kind: 'teaching' },
    ];
    payload.lessons = [lesson(0, 3, { startsAt: '13:30', endsAt: '14:15' })];
    await mount();
    const nos = [...root().querySelectorAll('.routine-grid-no')]
      .map((e) => (e.textContent ?? '').replace('পিরিয়ড', '').trim());
    assert.deepEqual(nos, ['১ম', '২য়'],
      'period_no 3 is the SECOND taught hour — counting rows printed ৩য়');
  });

  test('the accessible label carries the same hour the column shows', async () => {
    // A screen-reader user heard "৬ নম্বর পিরিয়ড" for the hour everyone else
    // called ৫ম, because this label counted `period_no`. Same off-by-one,
    // one layer down where nobody looks.
    payload.periods = [
      { ...period(1), startsAt: '10:00', endsAt: '10:45', kind: 'teaching' },
      { ...period(2), labelBn: 'টিফিন', startsAt: '13:00', endsAt: '13:30',
        kind: 'tiffin' },
      { ...period(3), startsAt: '13:30', endsAt: '14:15', kind: 'teaching' },
    ];
    payload.lessons = [lesson(0, 3, { startsAt: '13:30', endsAt: '14:15' })];
    await mount();
    const label = root().querySelector('.routine-slot')
      ?.getAttribute('aria-label') ?? '';
    assert.match(label, /২য় পিরিয়ড/, label);
    assert.doesNotMatch(label, /৩ নম্বর|নম্বর পিরিয়ড/, label);
    assert.match(label, /দুপুর ১:৩০–২:১৫/, label);
  });

  test('B-116 — the year on the screen is in Bangla numerals', async () => {
    payload.routines = [{ ...BASE.routines[0], yearLabel: '2026' }];
    await mount();
    assert.match(text(), /২০২৬ শিক্ষাবর্ষ/);
    assert.doesNotMatch(text(), /2026/);
  });

  /* ─────────────────────── the phone's week (13 Responsive ০৬) ──────────── */

  test('the phone gets day tabs with today preselected, over that day only', async () => {
    const week = [0, 1, 2, 3, 4, 5, 6];
    payload.days = week.map((dow) => ({ dow, bn: ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'][dow] }));
    await mount();
    assert.deepEqual(dayTabs().map((t) => t.textContent),
      payload.days.map((x) => x.bn), 'one tab per teaching day the server sent');
    const today = new Date().getDay();
    const selected = dayTabs().filter((t) => t.getAttribute('aria-selected') === 'true');
    assert.equal(selected.length, 1);
    assert.equal(selected[0].textContent, payload.days[today].bn, 'today, preselected');
    const panel = root().querySelector('.tt-day-panel') as HTMLElement;
    assert.equal(panel.getAttribute('role'), 'tabpanel');
    assert.equal(panel.getAttribute('aria-labelledby'), selected[0].id);
    // Two periods, so two rows for the day — whatever the day holds.
    assert.equal(dayRows().length, 2);
  });

  test('a day that is not a teaching day falls back to the first one', async () => {
    const today = new Date().getDay();
    const first = (today + 1) % 7;
    const second = (today + 2) % 7;
    payload.days = [{ dow: first, bn: 'প্রথম' }, { dow: second, bn: 'দ্বিতীয়' }];
    payload.lessons = [lesson(first, 1)];
    await mount();
    assert.deepEqual(dayTabs().map((t) => t.getAttribute('aria-selected')), ['true', 'false']);
  });

  test('switching day repaints from memory and never asks the server', async () => {
    await mount();
    // Pin the start: pick রবি, where period 1 is গণিত and period 2 is বাংলা.
    const rabi = dayTabs().find((t) => t.textContent === 'রবি')!;
    rabi.click();
    const before = asked.length;
    const som = dayTabs().find((t) => t.textContent === 'সোম')!;
    som.click();
    await settle();
    assert.equal(asked.length, before, 'the week is already here');
    const now = dayTabs().find((t) => t.getAttribute('aria-selected') === 'true')!;
    assert.equal(now.textContent, 'সোম');
    assert.equal(doc().activeElement, now, 'focus follows the tab, not lost with the old strip');
    const rows = dayRows().map((r) => r.textContent ?? '');
    assert.match(rows[0], /গণিত/, 'সোম, period 1');
    assert.match(rows[1], /—/, 'সোম, period 2 is free');
    assert.doesNotMatch(rows.join(' '), /বাংলা/, 'রবি’s বাংলা is not on সোম');
  });

  test('a phone row keeps everything the desk cell shows', async () => {
    payload.lessons = [lesson(0, 1, { isParallel: true })];
    payload.days = [{ dow: 0, bn: 'রবি' }];
    await mount();
    const row = dayRows()[0];
    const t = row.textContent ?? '';
    assert.match(t, /১ম পিরিয়ড/, 'the ordinal, for a reader');
    assert.match(t, /সকাল ৯:০০–৯:৪৫/, 'the clock');
    assert.match(t, /গণিত/);
    assert.match(t, /রফিক স্যার/);
    assert.match(t, /১০১ নম্বর কক্ষ/);
    assert.match(t, /বিভাজিত ক্লাস/);
    // The phone rows are their own markup: the grid's counts stay the grid's.
    assert.equal(row.querySelector('.routine-slot, .routine-cell, .routine-grid-no'), null);
  });

  test('the break is a row of the day on both shapes', async () => {
    payload.periods = [
      { ...period(1), kind: 'teaching' },
      { ...period(2), labelBn: 'টিফিন', kind: 'tiffin' },
    ];
    payload.lessons = [lesson(0, 1)];
    await mount();
    // The desk grid draws it under every day, as 06 Routine does.
    assert.equal(root().querySelectorAll('.tt-band .tt-band-cell').length, payload.days.length);
    assert.equal(root().querySelector('.tt-band th[scope="row"]')?.textContent, 'সকাল ১০:০০–১০:৪৫');
    // And the phone's day has it in its place.
    assert.match(root().querySelector('.tt-day-break')?.textContent ?? '', /টিফিন/);
  });

  /* ───────────────────────────── the frame ────────────────────────────── */

  test('one h1, and print is the bar’s outline action, not a primary', async () => {
    await mount();
    const h1s = root().querySelectorAll('h1');
    assert.equal(h1s.length, 1);
    assert.equal(h1s[0].textContent, 'প্রকাশিত রুটিন');
    const print = root().querySelector('.page-header-actions button') as HTMLButtonElement;
    assert.equal(print?.textContent?.trim(), 'ছাপুন');
    assert.ok(print.classList.contains('btn-sm'));
    assert.equal(root().querySelectorAll('.btn-primary').length, 0, 'this screen has no primary');
  });

  test('the which-one select keeps its label for a reader', async () => {
    await mount();
    const sel = selects()[0];
    const label = root().querySelector(`label[for="${sel.id}"]`);
    assert.equal(label?.textContent, 'কোনটি');
    assert.ok(label?.classList.contains('ui-sr-only'), 'drawn without it, spoken with it');
  });

  test('no print action while there is nothing to print', async () => {
    payload.published = false;
    payload.routines = []; payload.periods = []; payload.lessons = [];
    await mount();
    assert.equal([...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim() === 'ছাপুন'), undefined);
    reply = { ok: false, status: 500, body: { error: 'internal_error' } };
    await mount();
    assert.equal([...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim() === 'ছাপুন'), undefined);
  });

  test('R6 — every number a person reads sits in the numeral face', async () => {
    payload.scope = 'institution';
    payload.periods = [
      { ...period(1), kind: 'teaching' },
      { ...period(2), labelBn: 'টিফিন', kind: 'tiffin' },
      { ...period(3), kind: 'teaching' },
    ];
    payload.lessons = [0, 1, 2, 3, 4].map((k) =>
      lesson(0, 1, { sectionLabel: String.fromCharCode(0x995 + k) }));
    await mount();
    const walker = doc().createTreeWalker(root(), 4 /* SHOW_TEXT */);
    const bare: string[] = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!/[0-9০-৯]/.test(t.nodeValue ?? '')) continue;
      const p = t.parentElement!;
      if (p.closest('option, select, .ui-sr-only')) continue;
      if (!p.classList.contains('n')) bare.push(`${p.className}: ${t.nodeValue}`);
    }
    assert.deepEqual(bare, [], 'a digit outside the numeral face');
  });


  test('every count is the server’s, in Bangla, with the word that names it', async () => {
    payload.counts = { sections: 20, teachers: 23, rooms: 22, classes: 5 };
    await mount();
    assert.match(text(), /মোট ক্লাস/);
    assert.match(text(), /২০টি/, 'sections — counted on ids by the server');
    assert.match(text(), /২৩ জন/);
    assert.match(text(), /২২টি/);
    assert.match(text(), /সংস্করণ ২/);
    // No Latin digit anywhere a person reads.
    assert.doesNotMatch(text().replace(/[০-৯]/g, ''), /[0-9]/);
  });

  test('nothing undefined, and no identifier on screen', async () => {
    payload.scope = 'institution';
    await mount();
    assert.doesNotMatch(text(), /undefined|NaN|\[object/);
    assert.doesNotMatch(text(), /[0-9a-f]{8}-[0-9a-f]{4}/, 'no uuid');
    assert.doesNotMatch(text(), /\br1\b|routineId/);
  });

  /* ──────────────────────────── P9-9 print ───────────────────────────── */

  test('P9-9 — the print action previews before it prints', async () => {
    await mount();
    const print = [...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim() === 'ছাপুন');
    assert.ok(print, 'the action sits with the routine it prints');
    print.click();
    await settle();

    const dlg = doc().querySelector('[role="dialog"]') as HTMLElement | null;
    assert.ok(dlg, 'a preview opens');
    // §15's rule, said before somebody wonders why their draft is missing.
    assert.match(dlg.textContent ?? '', /শুধু প্রকাশিত রুটিন ছাপা যায়/);
    // The document is FETCHED with the caller's token, not loaded by URL: an
    // iframe pointed at the endpoint would send no Authorization header.
    assert.match(asked.at(-1) ?? '', /\/api\/v1\/ops\/document\?/);
    assert.match(asked.at(-1) ?? '', /type=routine_sheet/);
    assert.match(asked.at(-1) ?? '', /scope=section/);
  });

  test('the preview iframe cannot run scripts', async () => {
    await mount();
    [...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim() === 'ছাপুন')!.click();
    await settle();
    const frame = doc().querySelector('[role="dialog"] iframe') as HTMLIFrameElement;
    assert.ok(frame, 'the preview is an iframe, not the app’s own DOM');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    assert.doesNotMatch(sandbox, /allow-scripts/,
      'defence that does not depend on the escaping being right');
    assert.match(sandbox, /allow-same-origin/,
      'the parent needs a handle to call print() on it');
    assert.ok(frame.srcdoc.includes('class="doc"'), 'and it holds the document');
  });

  test('print stays unreachable until there is something to print', async () => {
    // A print button that fires on an empty frame opens a blank page dialogue.
    let resolveFetch: (() => void) | null = null;
    const gate = new Promise<void>((r) => { resolveFetch = r; });
    const original = printReply;
    printReply = { ...original, text: original.text };
    await mount();
    [...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim() === 'ছাপুন')!.click();
    const btn = [...(doc().querySelectorAll('[role="dialog"] button') ?? [])]
      .find((b) => (b.textContent ?? '').includes('ছাপুন')) as HTMLButtonElement;
    assert.equal(btn.disabled, true, 'disabled while the sheet is being built');
    await settle();
    assert.equal(btn.disabled, false, 'and reachable once it is there');
    void gate; void resolveFetch;
  });

  test('a refused print says why and does not open an empty preview', async () => {
    printReply = { ok: false, status: 409, text: '',
                   body: { error: 'not_published',
                           message: 'এখনো কোনো রুটিন প্রকাশ করা হয়নি — প্রকাশের পর ছাপা যাবে।' } };
    await mount();
    [...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim() === 'ছাপুন')!.click();
    await settle();
    const dlg = doc().querySelector('[role="dialog"]');
    assert.match(dlg?.textContent ?? '', /এখনো কোনো রুটিন প্রকাশ করা হয়নি/);
    assert.equal(dlg?.querySelector('iframe'), null, 'no frame, nothing to print');
    const btn = [...(dlg?.querySelectorAll('button') ?? [])]
      .find((b) => (b.textContent ?? '').includes('ছাপুন')) as HTMLButtonElement;
    assert.equal(btn.disabled, true);
  });

  test('the print request follows the scope on screen', async () => {
    payload.scope = 'teacher';
    await mount({ scope: 'teacher', id: 'self' });
    [...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim() === 'ছাপুন')!.click();
    await settle();
    assert.match(asked.at(-1) ?? '', /scope=teacher/);
    assert.match(asked.at(-1) ?? '', /id=self/);
  });

  /* ─────────────────────────── the states ─────────────────────────────── */

  test('§5 — nothing published is a state that says what happens next', async () => {
    payload.published = false;
    payload.routines = [];
    payload.periods = [];
    payload.lessons = [];
    await mount();
    assert.match(text(), /এখনো কোনো রুটিন প্রকাশ করা হয়নি/);
    assert.equal(root().querySelectorAll('.routine-grid').length, 0);
    const go = [...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('রুটিন তৈরি ও প্রকাশ'));
    assert.ok(go, 'and offers the way there');
    go.click();
    assert.deepEqual(navigated, ['routinepublish']);
  });

  test('a refusal shows who to ask, not a retry', async () => {
    reply = { ok: false, status: 403, body: { error: 'forbidden_scope' } };
    await mount();
    assert.ok(text().length > 0, 'never blank');
    assert.equal([...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('আবার চেষ্টা')), undefined);
  });

  test('a failed read offers a retry and keeps the page', async () => {
    reply = { ok: false, status: 500, body: { error: 'internal_error' } };
    await mount();
    assert.ok(text().length > 0);
    assert.match(text(), /আবার চেষ্টা করুন/);
  });

  test('a deep link opens on the scope it names', async () => {
    await mount({ scope: 'room', id: 'room-7' });
    assert.match(asked[0], /scope=room/);
    assert.match(asked[0], /id=room-7/);
  });
});
