/**
 * Student home — "today's class" (B-15) and the states around it.
 *
 * The card P4 shipped without, because `/rms/routine` is teacher-scoped and
 * inventing a timetable on the client is fabricated curriculum data. What is
 * asserted here is mostly about the things the browser caught and no earlier
 * test would have:
 *
 *   * Bangla ordinals are per-number, not a suffix. The first draft rendered
 *     "২ম পিরিয়ড" — right for period 1, wrong for 2, 3, 4 and 6, and
 *     invisible in a screenshot of the top of the list.
 *   * A period that is BOTH running now and covered by a substitute must say
 *     both. Badge precedence once dropped the substitution at exactly the
 *     moment a student needs it.
 *
 * Ata Ekta (03 Student §01) draws four blocks first — the name, the class
 * happening now, the figures, and what has to be handed in — and the day's
 * full timetable and the study suggestions follow them, because this screen
 * is the only place a student can read either. The guarantees stay: every
 * period is listed in order, the right period is picked and marked, it names
 * subject, room and teacher, a substitution survives, times are Bangla,
 * nothing says "undefined", an empty day says so, and one failure never takes
 * the screen. And no figure is shown that the data cannot back: the capped
 * homework suggestions are never presented as the pending total.
 *
 * The clock is injected, so "which period is now" is a fact of the test and
 * not of the hour the suite happens to run — the shape of bug P3.1 spent an
 * afternoon on.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { StudentHomeView, periodBn, bnTime } from '../src/student-home-view.ts';

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
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true }, configurable: true, writable: true,
  });
});

const SLOTS = [
  { slotId: 'a', periodNo: 1, startsAt: '08:00', endsAt: '08:45',
    subjectBn: 'বাংলা', roomCode: '১০১', teacherNameBn: 'নাজমা', isSubstitution: false },
  { slotId: 'b', periodNo: 2, startsAt: '08:50', endsAt: '09:35',
    subjectBn: 'গণিত', roomCode: '১০২', teacherNameBn: 'রফিক', isSubstitution: false },
  { slotId: 'c', periodNo: 4, startsAt: '11:00', endsAt: '11:45',
    subjectBn: 'পদার্থবিজ্ঞান', roomCode: 'ল্যাব-১',
    teacherNameBn: 'শাহনাজ', isSubstitution: true },
];

/** A refusal the stub should answer with, instead of a 200. */
const refuse = (error: string, message: string) => ({ __status: 403, error, message });

/** Every endpoint the screen calls, answerable per-test. */
function stubAuth(over: Record<string, unknown> = {}, seen: string[] = []) {
  const bodies: Record<string, unknown> = {
    myroutine: { slots: SLOTS },
    next: { suggestions: [] },
    attendance: { totals: { present: 18, late: 0, absent: 1, excused: 0, halfDay: 0,
                            counted: 19, attendedPercent: 95 } },
    results: { results: [] },
    inbox: { notices: [], unread: 0 },
    ...over,
  };
  return {
    authedFetch: async (url: string) => {
      seen.push(url);
      const key = Object.keys(bodies).find((k) => url.includes(k));
      const body = key ? bodies[key] : {};
      if (body === null) return { ok: false, status: 500 } as unknown as Response;
      const status = (body as { __status?: number }).__status;
      if (status) {
        return { ok: false, status, json: async () => body } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    },
  } as unknown as ConstructorParameters<typeof StudentHomeView>[0]['auth'];
}

/** 11:15 on a Tuesday — inside period 4, which is also the covered one. */
const AT_1115 = () => new Date('2026-09-01T11:15:00');
/** 09:40 — after period 2, before period 4: nothing current, one next. */
const AT_0940 = () => new Date('2026-09-01T09:40:00');
/** 12:00 — after the last period. */
const AT_1200 = () => new Date('2026-09-01T12:00:00');

async function mount(
  over: Record<string, unknown> = {}, now = AT_1115, seen: string[] = [],
  go: (path: string) => void = () => {},
): Promise<HTMLElement> {
  const root = dom.window.document.getElementById('root') as HTMLElement;
  root.textContent = '';
  new StudentHomeView({
    root, doc: dom.window.document, auth: stubAuth(over, seen),
    displayName: 'রাফি', go, now,
  });
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  return root;
}

/** The class card: the one period the screen picked for "now". */
function nowCard(root: HTMLElement): HTMLElement {
  const card = root.querySelector('.sh-now') as HTMLElement | null;
  assert.ok(card, 'the now-class card must exist');
  return card;
}

/** The value of the stat strip cell whose label is `label`. */
function stat(root: HTMLElement, label: string): HTMLElement {
  const cell = [...root.querySelectorAll('.sh-stats .ui-stat')]
    .find((c) => c.querySelector('.ui-stat-label')?.textContent === label);
  assert.ok(cell, `the "${label}" stat must exist`);
  return cell as HTMLElement;
}

/** The rows of the day's timetable, in the order they render. */
function dayRows(root: HTMLElement): HTMLElement[] {
  const section = root.querySelector('section.sh-day') as HTMLElement | null;
  assert.ok(section, 'the day timetable must exist');
  assert.equal(section.querySelector('h2')?.textContent, 'আজকের রুটিন');
  return [...section.querySelectorAll('.ui-list-item')] as HTMLElement[];
}

/** The due panel. */
function duePanel(root: HTMLElement): HTMLElement {
  const panel = root.querySelector('section.sh-due') as HTMLElement | null;
  assert.ok(panel, 'the due panel must exist');
  return panel;
}

describe('B-15 — today’s class', () => {
  let root: HTMLElement;
  beforeEach(async () => { root = await mount(); });

  test('the page names the student in its one h1, under the salutation', () => {
    const h1s = root.querySelectorAll('h1');
    assert.equal(h1s.length, 1, 'exactly one h1 per screen');
    assert.equal(h1s[0].textContent, 'রাফি');
    assert.equal(root.querySelector('.page-header .page-sub')?.textContent, 'আসসালামু আলাইকুম');
  });

  test('every period is listed, in order, with subject, room and teacher', () => {
    const rows = dayRows(root);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.querySelector('.ui-list-title')?.textContent),
      ['বাংলা', 'গণিত', 'পদার্থবিজ্ঞান']);
    assert.match(rows[0].textContent ?? '', /কক্ষ ১০১/);
    assert.match(rows[0].textContent ?? '', /নাজমা/);
  });

  test('the class happening now names its subject, room and teacher', () => {
    const card = nowCard(root);
    assert.equal(card.querySelector('h2')?.textContent, 'পদার্থবিজ্ঞান');
    assert.match(card.textContent ?? '', /কক্ষ ল্যাব-১/);
    assert.match(card.textContent ?? '', /শাহনাজ/);
    // Only the one period — the others are not on the card.
    assert.doesNotMatch(card.textContent ?? '', /বাংলা|গণিত/);
    // Every period of the day is still counted.
    assert.equal(stat(root, 'আজকের ক্লাস').querySelector('.ui-stat-value')?.textContent, '৩');
  });

  test('Bangla ordinals are per-number, not digit + ম', () => {
    const subs = dayRows(root).map((r) => r.querySelector('.ui-list-sub')?.textContent ?? '');
    assert.match(subs[0], /^১ম পিরিয়ড/);
    assert.match(subs[1], /^২য় পিরিয়ড/, '"২ম" is not a Bangla ordinal');
    assert.match(subs[2], /^৪র্থ পিরিয়ড/);
    // The unit, directly: the function period labels depend on.
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(periodBn),
      ['১ম', '২য়', '৩য়', '৪র্থ', '৫ম', '৬ষ্ঠ']);
    assert.notEqual(periodBn(2), '২ম', '"২ম" is not a Bangla ordinal');
    // Past the table it must not invent a suffix.
    assert.equal(periodBn(20), '২০');
  });

  test('times are Bangla digits, in the numeral face', () => {
    assert.equal(bnTime('08:00'), '৮:০০');
    assert.equal(bnTime('11:45'), '১১:৪৫');
    const time = nowCard(root).querySelector('.sh-now-when .n');
    assert.equal(time?.textContent, '১১:০০');
    assert.doesNotMatch(nowCard(root).textContent ?? '', /[0-9]/, 'no Latin digit on the card');
    // The day's list carries both ends of every period.
    assert.match(dayRows(root)[0].textContent ?? '', /৮:০০–৮:৪৫/);
  });

  test('the period happening NOW is the one the card calls now', () => {
    const card = nowCard(root);
    assert.match(card.querySelector('.sh-now-when')?.textContent ?? '', /^এখন ক্লাস · /);
    assert.equal(card.dataset.now, 'true');
    assert.doesNotMatch(card.textContent ?? '', /পরবর্তী/);
    // In the day's list the same period, and only that one, says so in words.
    const marked = dayRows(root).filter((r) => r.textContent?.includes('এখন চলছে'));
    assert.equal(marked.length, 1);
    assert.match(marked[0].textContent ?? '', /পদার্থবিজ্ঞান/);
  });

  test('a covered period says so even while it is the current one', () => {
    // The defect this replaced: badge precedence put "এখন চলছে" in the only
    // slot available and the substitution vanished — at the exact moment the
    // student is walking to that room expecting a different teacher.
    const text = nowCard(root).textContent ?? '';
    assert.match(text, /এখন ক্লাস/);
    assert.match(text, /শাহনাজ \(বদলি\)/,
      'the substitution must survive alongside the timing');
    const row = dayRows(root).find((r) => r.textContent?.includes('এখন চলছে'));
    assert.ok(row);
    assert.match(row.textContent ?? '', /শাহনাজ \(বদলি\)/,
      'the list row keeps the substitution beside the timing too');
  });

  test('with nothing running, the next period is the one shown', async () => {
    const r = await mount({}, AT_0940);
    const card = nowCard(r);
    assert.doesNotMatch(card.textContent ?? '', /এখন ক্লাস/);
    assert.match(card.querySelector('.sh-now-when')?.textContent ?? '', /^পরবর্তী ক্লাস · ১১:০০$/);
    assert.equal(card.querySelector('h2')?.textContent, 'পদার্থবিজ্ঞান');
    assert.equal(card.dataset.now, 'false');
    const rows = dayRows(r);
    assert.equal(rows.filter((x) => x.textContent?.includes('এখন চলছে')).length, 0);
    const next = rows.filter((x) => x.textContent?.includes('পরবর্তী'));
    assert.equal(next.length, 1);
    assert.match(next[0].textContent ?? '', /পদার্থবিজ্ঞান/);
  });

  test('after the last period the card says the day is over, not a stale class', async () => {
    const r = await mount({}, AT_1200);
    assert.equal(r.querySelector('.sh-now'), null);
    assert.match(r.querySelector('.sh-now-empty')?.textContent ?? '', /আজকের সব ক্লাস শেষ হয়েছে/);
    // The day is still readable, with nothing marked as running or next.
    const rows = dayRows(r);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((x) => !/এখন চলছে|পরবর্তী/.test(x.textContent ?? '')));
  });

  test('no classes today says so, rather than disappearing', async () => {
    const r = await mount({ myroutine: { slots: [] } });
    const slot = r.querySelector('.sh-now-empty');
    assert.ok(slot, 'the block stays — a missing block reads as a failed load');
    assert.match(slot.textContent ?? '', /আজ কোনো ক্লাস নেই/);
    assert.equal(stat(r, 'আজকের ক্লাস').querySelector('.ui-stat-value')?.textContent, '০');
    assert.equal(r.querySelector('.sh-day'), null, 'said once, not repeated as an empty list');
  });

  test('a period with no subject or teacher never renders the word undefined', async () => {
    const r = await mount({
      myroutine: { slots: [{
        slotId: 'x', periodNo: 3, startsAt: '09:40', endsAt: '10:25',
        subjectBn: null, roomCode: null, teacherNameBn: null, isSubstitution: true,
      }] },
    }, () => new Date('2026-09-01T10:00:00'));
    for (const block of [nowCard(r), ...dayRows(r)]) {
      const text = block.textContent ?? '';
      assert.doesNotMatch(text, /undefined|null/);
      assert.match(text, /বিষয় নির্ধারিত হয়নি/);
      // With no name at all, the substitution still has to be sayable.
      assert.match(text, /বদলি শিক্ষক/);
    }
  });

  test('the routine is its own request and does not wait for the others', async () => {
    const seen: string[] = [];
    await mount({}, AT_1115, seen);
    assert.ok(seen.some((u) => u.includes('/academics/myroutine')));
    // Five independent GETs, not one bundle: a slow inbox must not hold up
    // "which room next".
    assert.equal(new Set(seen).size, 5);
  });

  test('one failed block does not take the screen down', async () => {
    const r = await mount({ myroutine: null });
    // The routine failed; attendance, results and the inbox did not, so the
    // screen renders and only the one block shows its own state.
    assert.ok(r.textContent?.includes('হাজিরা'));
    assert.ok(r.querySelector('.sh-due'));
    // The failed block carries its own retry (ux-fix 65); nothing wider does.
    const errors = [...r.querySelectorAll('.ui-state-error')];
    assert.equal(errors.length, 1, 'a single failure is not a whole-screen error');
    assert.ok(errors[0].closest('.sh-now-empty'), 'the error sits in the failed block only');
    assert.equal([...r.querySelectorAll('button')]
      .filter((b) => b.textContent === 'আবার চেষ্টা করুন').length, 1);
  });
});

describe('Ata Ekta — the figures and the due panel', () => {
  const DUE = [
    { kind: 'assignment', titleBn: 'গণিত — অনুশীলনী ৪.২', whyBn: 'আজই জমা দিতে হবে',
      route: 'assignments', refId: 'a1', urgency: 'high' },
    { kind: 'assignment', titleBn: 'বাংলা — রচনা', whyBn: '2 দিনের মধ্যে জমা দিতে হবে',
      route: 'assignments', refId: 'a2', urgency: 'high' },
    { kind: 'redo_practice', titleBn: 'ভগ্নাংশ', whyBn: '৩টি প্রশ্ন এখনো ভুল আছে — আবার চেষ্টা করো',
      route: 'learn', refId: 't1', urgency: 'medium' },
  ];

  test('attendance carries its meaning, and every figure is in the numeral face', async () => {
    const r = await mount({ next: { suggestions: DUE } });
    const att = stat(r, 'হাজিরা');
    assert.equal(att.querySelector('.ui-stat-value')?.textContent, '৯৫%');
    assert.equal(att.dataset.tone, 'success');
    for (const v of r.querySelectorAll('.sh-stats .ui-stat-value')) {
      assert.ok(v.classList.contains('n'), 'every figure is in the numeral face');
    }
  });

  test('the capped homework suggestions are never shown as the pending total', async () => {
    // /academics/next returns at most TWO assignments, only those due inside
    // three days, none overdue. DUE is exactly that cap. A "জমা বাকি ২" here
    // would state as fact a number the server cannot know: a student with
    // five pieces outstanding, or one overdue, would be told ২ or ০.
    const r = await mount({ next: { suggestions: DUE } });
    const labels = [...r.querySelectorAll('.sh-stats .ui-stat-label')].map((x) => x.textContent);
    assert.deepEqual(labels, ['আজকের ক্লাস', 'হাজিরা']);
    assert.ok(!r.querySelector('.sh-stats')?.textContent?.includes('জমা বাকি'));
    // What IS known is still on screen, row by row, under its own heading.
    assert.equal(duePanel(r).querySelectorAll('.ui-list-item').length, 2);
  });

  test('attendance still opens my attendance', async () => {
    const went: string[] = [];
    const r = await mount({}, AT_1115, [], (p) => went.push(p));
    (stat(r, 'হাজিরা') as HTMLButtonElement).click();
    assert.deepEqual(went, ['my-attendance']);
  });

  test('nothing is decoration: no tone on a plain count, no attendance tone without data', async () => {
    const r = await mount({ attendance: null });
    assert.equal(stat(r, 'আজকের ক্লাস').dataset.tone, undefined);
    assert.equal(stat(r, 'হাজিরা').querySelector('.ui-stat-value')?.textContent, '—');
    assert.equal(stat(r, 'হাজিরা').dataset.tone, undefined);
    assert.equal(r.querySelector('.btn-primary'), null, 'this screen has no primary action');
  });

  test('the due panel lists homework only, with Bangla digits and a word for when', async () => {
    const went: string[] = [];
    const r = await mount({ next: { suggestions: DUE } }, AT_1115, [], (p) => went.push(p));
    const panel = duePanel(r);
    const head = panel.querySelector('h2');
    assert.equal(head?.textContent, 'আজ জমা দিতে হবে');
    assert.equal(panel.getAttribute('aria-labelledby'), head?.id);
    const rows = [...panel.querySelectorAll('.ui-list-item')] as HTMLElement[];
    assert.deepEqual(rows.map((x) => x.querySelector('.ui-list-title')?.textContent),
      ['গণিত — অনুশীলনী ৪.২', 'বাংলা — রচনা']);
    const when = rows.map((x) => x.querySelector('.ui-list-status') as HTMLElement);
    assert.equal(when[0].textContent, 'আজই জমা দিতে হবে');
    assert.equal(when[0].dataset.tone, 'danger');
    assert.equal(when[1].textContent, '২ দিনের মধ্যে জমা দিতে হবে', 'no Latin digit reaches the row');
    assert.equal(when[1].dataset.tone, 'warn');
    assert.equal(when[1].querySelector('.n')?.textContent, '২');
    (rows[1].querySelector('button') as HTMLButtonElement).click();
    assert.deepEqual(went, ['assignments']);
  });

  test('nothing due says so under the panel heading, with the way on', async () => {
    const went: string[] = [];
    const r = await mount({}, AT_1115, [], (p) => went.push(p));
    const panel = duePanel(r);
    assert.match(panel.textContent ?? '', /এই মুহূর্তে জমা দেওয়ার কিছু নেই/);
    const action = [...panel.querySelectorAll('button')]
      .find((b) => b.textContent === 'পড়াশোনায় যাও');
    assert.ok(action, 'an empty state names the next action');
    action.click();
    assert.deepEqual(went, ['learn']);
  });

  test('a refused homework request says "not for you", not "nothing due"', async () => {
    const r = await mount({
      next: refuse('tenant_blocked', 'শেখার অংশটি এই প্রতিষ্ঠানের প্যাকেজে নেই।'),
    });
    const panel = duePanel(r);
    const denied = panel.querySelector('.ui-state-denied');
    assert.ok(denied, 'the denied state, inside the panel');
    assert.match(denied.textContent ?? '', /শেখার অংশটি এই প্রতিষ্ঠানের প্যাকেজে নেই।/);
    assert.doesNotMatch(panel.textContent ?? '', /জমা দেওয়ার কিছু নেই/);
    // A refusal is not "nothing to study" either: no suggestion list at all.
    assert.equal(r.querySelector('.sh-study'), null);
    // The rest of the screen still answers.
    assert.ok(r.querySelector('.sh-now'));
    assert.equal(dayRows(r).length, 3);
  });

  test('a role refusal uses the canonical sentence and names who can help', async () => {
    const r = await mount({ myroutine: refuse('forbidden', 'a student may only read their own routine') });
    const slot = r.querySelector('.sh-now-empty .ui-state-denied');
    assert.ok(slot);
    assert.match(slot.textContent ?? '', /আজকের রুটিন দেখার অনুমতি আপনার নেই।/);
    assert.match(slot.textContent ?? '', /প্রধান শিক্ষক/);
    assert.doesNotMatch(slot.textContent ?? '', /a student may only/, 'no server English on screen');
    assert.equal(stat(r, 'আজকের ক্লাস').querySelector('.ui-stat-value')?.textContent, '—');
    assert.equal(r.querySelector('.sh-day'), null, 'the refusal is said once, not as an empty timetable');
  });

  test('when every drawn block is refused, one denied state stands for the screen', async () => {
    const blocked = refuse('tenant_blocked', 'এই প্রতিষ্ঠানের অ্যাকাউন্ট এখন বন্ধ আছে।');
    const r = await mount({ myroutine: blocked, next: blocked, attendance: blocked });
    assert.equal(r.querySelectorAll('.ui-state-denied').length, 1);
    assert.match(r.textContent ?? '', /এই প্রতিষ্ঠানের অ্যাকাউন্ট এখন বন্ধ আছে।/);
    assert.equal(r.querySelector('.sh-due'), null);
    assert.equal(r.querySelectorAll('h1').length, 1);
    assert.ok(!r.textContent?.includes('আবার চেষ্টা করুন'), 'no retry on a refusal');
  });
});

describe('what to study next — the suggestions that are not homework', () => {
  const MIXED = [
    { kind: 'assignment', titleBn: 'গণিত — অনুশীলনী ৪.২', whyBn: 'আজই জমা দিতে হবে',
      route: 'assignments', refId: 'a1', urgency: 'high' },
    { kind: 'redo_practice', titleBn: 'ভগ্নাংশ', whyBn: '৩টি প্রশ্ন এখনো ভুল আছে — আবার চেষ্টা করো',
      route: 'learn', refId: 't1', urgency: 'medium' },
    { kind: 'continue_topic', titleBn: 'পড়ন্ত বস্তুর গতি', whyBn: 'গতি অধ্যায়টি শেষ করো',
      route: 'learn', refId: 't2', urgency: 'medium' },
  ];

  test('they are listed after the timetable, in server order, and open where they point', async () => {
    const went: string[] = [];
    const r = await mount({ next: { suggestions: MIXED } }, AT_1115, [], (p) => went.push(p));
    const section = r.querySelector('section.sh-study') as HTMLElement | null;
    assert.ok(section, 'the suggestions must still reach the student');
    assert.equal(section.querySelector('h2')?.textContent, 'এখন যা দরকার');
    const rows = [...section.querySelectorAll('.ui-list-item')] as HTMLElement[];
    assert.deepEqual(rows.map((x) => x.querySelector('.ui-list-title')?.textContent),
      ['ভগ্নাংশ', 'পড়ন্ত বস্তুর গতি'], 'homework is not repeated here');
    assert.equal(rows[0].querySelector('.ui-list-sub')?.textContent,
      '৩টি প্রশ্ন এখনো ভুল আছে — আবার চেষ্টা করো', 'the reason is shown, so it can be argued with');
    // After the drawn blocks and the day, never ahead of them.
    const order = [...r.querySelectorAll('.sh-now, .sh-stats, .sh-due, .sh-day, .sh-study')]
      .map((x) => x.className.match(/sh-(now|stats|due|day|study)\b/)?.[1]);
    assert.deepEqual(order, ['now', 'stats', 'due', 'day', 'study']);
    (rows[0].querySelector('button') as HTMLButtonElement).click();
    assert.deepEqual(went, ['learn']);
  });

  test('with nothing to suggest, no empty list is drawn', async () => {
    const r = await mount({ next: { suggestions: [MIXED[0]] } });
    assert.equal(r.querySelector('.sh-study'), null);
  });
});
