/**
 * The principal's dashboard.  (P5)
 *
 * The brief asks the top of this screen to answer three questions — what needs
 * attention, what changed, what can I act on — and warns against inventing
 * analytics to fill space. So most of what is asserted here is about ORDER and
 * about ABSENCE: that the pending queue leads when it has anything in it, that
 * an empty queue is one calm line rather than four zeroes, and that a block
 * the server did not send is not rendered at all.
 *
 * Two behaviours carried over from R-3 have their own tests because both were
 * hard-won:
 *
 *   * `percent: null` is "nobody has taken attendance yet", NOT 0%. A
 *     dashboard reading 0% at 8:05 puts a head teacher on the phone to a class
 *     teacher who has done nothing wrong.
 *   * the fee block is ABSENT for a role the server does not send it to, not
 *     hidden with CSS — a hidden card with the numbers still in the response
 *     body is the frontend-filtering pattern D13 rules out.
 *
 * And one that is new, because the first draft of this screen got it wrong:
 * the payload's field names are the endpoint's. `collectedThisMonth` and
 * `invoicesDue` were invented, and the dashboard rendered
 * "undefinedটি ইনভয়েস বাকি".
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { PrincipalHomeView, type DashboardPayload } from '../src/principal-home-view.ts';
import { permissionMessage } from '../src/ui/feedback.ts';

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

const FULL: DashboardPayload = {
  year: { id: 'y1', label: '২০২৬' },
  needsSetup: false,
  counts: { students: 1240, teachers: 48, sections: 26, classes: 6 },
  attendanceToday: {
    present: 1102, marked: 1180, percent: 93, sessionsTaken: 22, sectionsExpected: 26,
  },
  absentToday: {
    total: 78,
    shown: [
      { studentId: 's1', nameBn: 'রাফি', rollNo: 7, section: 'ক', classBn: 'নবম' },
    ],
  },
  upcomingExams: [
    { id: 'e1', nameBn: 'অর্ধবার্ষিক', startsOn: '2026-06-10', status: 'marking' },
  ],
  recentNotices: [
    { id: 'n1', title: 'অভিভাবক সভা', category: 'guardian',
      publishedAt: '2026-05-02', recipientCount: 860 },
  ],
  pending: {
    sectionsWithoutClassTeacher: 2, subjectsWithoutTeacher: 3,
    examsAwaitingPublication: 1, studentsWithoutSection: 0,
  },
  finance: {
    invoiced: '1240000.00', collected: '985000.00',
    outstanding: '255000.00', unpaidCount: 212,
  },
};

function auth(body: unknown, status = 200) {
  return {
    authedFetch: async () => {
      if (status === 0) throw new TypeError('Failed to fetch');
      return {
        ok: status >= 200 && status < 300, status, json: async () => body,
      } as unknown as Response;
    },
  } as never;
}

const root = () => dom.window.document.getElementById('root') as HTMLElement;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const AT_NOON = () => new Date('2026-09-01T12:00:00');

async function mount(body: unknown, status = 200, go: (p: string) => void = () => {}) {
  root().textContent = '';
  new PrincipalHomeView({
    root: root(), doc: dom.window.document, auth: auth(body, status),
    displayName: 'প্রধান', go, now: AT_NOON,
  });
  await settle();
  return root();
}

const text = () => root().textContent ?? '';

describe('P5 — the principal dashboard', () => {
  beforeEach(async () => { await mount(FULL); });

  test('answers "what needs attention" first, and only the non-zero rows', () => {
    const sections = [...root().querySelectorAll('section')];
    assert.match(sections[0].textContent ?? '', /এখনই দেখা দরকার/,
      'the queue leads — it is the only block with this person’s name on it');
    // Ata Ekta: one sentence per open item — the sentence is the decision.
    // 0 students-without-section must not appear as a row.
    assert.match(text(), /২টি সেকশনে শ্রেণি শিক্ষক নির্ধারণ করা হয়নি/);
    assert.match(text(), /৩টি বিষয়ে শিক্ষক নির্ধারণ করা হয়নি/);
    assert.match(text(), /১টি পরীক্ষার ফলাফল প্রকাশের অপেক্ষায়/);
    assert.doesNotMatch(text(), /০ জন শিক্ষার্থী কোনো সেকশনে নেই/, 'a zero is not a task');
  });

  test('an empty queue is one calm line, not four zeroes', async () => {
    // FULL still has 22 of 26 registers: attendance is not a queue item, so it
    // must not keep the calm line away.
    await mount({ ...FULL, pending: {
      sectionsWithoutClassTeacher: 0, subjectsWithoutTeacher: 0,
      examsAwaitingPublication: 0, studentsWithoutSection: 0,
    } });
    assert.match(text(), /সব কিছু নির্ধারিত আছে/);
    // Scoped to the queue's own section. "বাকি" appears legitimately in the
    // calm line itself ("কোথাও কিছু বাকি নেই") and in the fee card's
    // "২১২টি ইনভয়েস বাকি"; what must not exist is a queue ROW.
    const queue = [...root().querySelectorAll('section')]
      .find((x) => x.textContent?.includes('এখনই দেখা দরকার'));
    assert.ok(queue);
    assert.equal(queue.querySelectorAll('.ui-list-item').length, 0,
      'nothing is outstanding, so there is no row saying so');
    // The all-clear vouches only for what the queue checks.
    assert.doesNotMatch(queue.textContent ?? '', /হাজিরা/,
      'the queue does not check registers, so its all-clear must not claim them');
  });

  test('"nobody has taken attendance yet" is not 0%', async () => {
    await mount({ ...FULL, attendanceToday: {
      present: 0, marked: 0, percent: null, sessionsTaken: 0, sectionsExpected: 26,
    }, absentToday: { total: 0, shown: [] } });
    assert.match(text(), /এখনো নেওয়া হয়নি/);
    const attCell = [...root().querySelectorAll('.ui-stat')]
      .find((c) => c.querySelector('.ui-stat-label')?.textContent === 'আজ উপস্থিত');
    assert.match(attCell?.querySelector('.ui-stat-note')?.textContent ?? '', /^এখনো নেওয়া হয়নি/,
      'the strip itself says it');
    assert.doesNotMatch(text(), /০%/,
      '0% at 8:05 puts a head teacher on the phone to a teacher who did nothing wrong');
    // The denominator is still worth saying: 0 of 26 sections taken. (\s: the
    // spaces are no-break, so the fraction never splits across a line.)
    assert.match(text(), /০\s\/\s২৬\sসেকশন/);
    // …as a fact, not as an alarm: at 8:05 (or on a Friday) open registers are
    // not something that "needs attention now".
    assert.doesNotMatch(text(), /সেকশনের হাজিরা এখনো নেওয়া হয়নি/);
    assert.equal(root().querySelectorAll('.ph-attention .ui-list-item').length, 3,
      'only the pending queue makes rows');
    // …and "০ absent" before anyone has marked a register is the same lie.
    const absentCell = [...root().querySelectorAll('.ui-stat')]
      .find((c) => c.querySelector('.ui-stat-label')?.textContent === 'আজ অনুপস্থিত');
    assert.equal(absentCell?.querySelector('.ui-stat-value')?.textContent, '—');
    assert.match(text(), /হাজিরা নেওয়া শুরু হলে অনুপস্থিত শিক্ষার্থীদের নাম এখানে আসবে/,
      'the absentee panel says why it is empty, rather than "nobody is absent"');
    assert.doesNotMatch(text(), /আজ কোনো শিক্ষার্থী অনুপস্থিত নেই/);
  });

  test('the register count is a neutral note under the figure, never a queue row', async () => {
    const attCell = [...root().querySelectorAll('.ui-stat')]
      .find((c) => c.querySelector('.ui-stat-label')?.textContent === 'আজ উপস্থিত');
    assert.equal(attCell?.querySelector('.ui-stat-note')?.textContent, '২২\u00a0/\u00a0২৬\u00a0সেকশন',
      'no-break spaces: the fraction never splits across a line');
    // A period-wise school has one session per period: 30 sessions from 5
    // sections is "more than 26", and must not read as an all-clear for
    // attendance either.
    await mount({ ...FULL, attendanceToday: {
      present: 150, marked: 160, percent: 94, sessionsTaken: 30, sectionsExpected: 26,
    }, pending: {
      sectionsWithoutClassTeacher: 0, subjectsWithoutTeacher: 0,
      examsAwaitingPublication: 0, studentsWithoutSection: 0,
    } });
    assert.doesNotMatch(root().querySelector('.ph-calm')?.textContent ?? '', /হাজিরা/);
  });

  test('the fee block is ABSENT for a role the server does not send it to', async () => {
    await mount({ ...FULL, finance: null });
    assert.doesNotMatch(text(), /বকেয়া/);
    assert.doesNotMatch(text(), /আদায়/);
    // Nothing hidden: no element carrying the numbers exists at all.
    assert.equal(root().querySelectorAll('[hidden]').length, 0);
    // …and the rest of the screen is unaffected.
    assert.match(text(), /আজ উপস্থিত/);
  });

  test('money uses the endpoint’s own field names', () => {
    // The first draft invented `collectedThisMonth` and `invoicesDue`, and
    // rendered "undefinedটি ইনভয়েস বাকি" on a principal's dashboard.
    assert.match(text(), /২১২টি ইনভয়েস বাকি/);
    assert.doesNotMatch(text(), /undefined/);
    // Money stays Latin with Bangla lakh grouping — it is an amount, not a count.
    assert.match(text(), /2,55,000\.00/);
  });

  test('the label says the window the number actually covers', () => {
    // The endpoint sums over the ACADEMIC YEAR. A label saying "this month"
    // would be a wrong number dressed as a right one.
    assert.match(text(), /এ বছর আদায়/);
    assert.doesNotMatch(text(), /এ মাসে আদায়/);
  });

  test('the absentee list is a TABLE, and says how many it is NOT showing', () => {
    // P7-0 merged `institution` into this screen and brought its absentee
    // table with it: an office phoning six families reads down a column of
    // roll numbers, and a stack of list items makes them read one name per
    // full screen width.
    const r = root();
    const heads = [...r.querySelectorAll('thead th')].map((h) => h.textContent);
    for (const h of ['রোল', 'নাম', 'শ্রেণি', 'সেকশন']) {
      assert.ok(heads.includes(h), `${h} — got ${heads.join('|')}`);
    }
    // 78 absent, 1 shown. The screen must never imply the list is the list.
    assert.match(r.textContent ?? '', /আরও ৭৭ জন/);
  });

  test('a roll number stays Latin; counts are Bangla', () => {
    // P7-0 moved the roll from a `· রোল 7` subtitle into its own column, so
    // the header carries the word and the cell carries the number. The rule
    // is unchanged: a roll is an IDENTIFIER, read down a phone to a class
    // teacher, and a count is a quantity.
    const cells = [...root().querySelectorAll('tbody tr')]
      .flatMap((tr) => [...tr.children].map((c) => c.textContent ?? ''));
    assert.ok(cells.includes('7'), `a roll is Latin: ${cells.join('|')}`);
    assert.match(text(), /রোল/, 'and the column says what it is');
    const absentCell = [...root().querySelectorAll('.ui-stat')]
      .find((c) => c.querySelector('.ui-stat-label')?.textContent === 'আজ অনুপস্থিত');
    assert.equal(absentCell?.querySelector('.ui-stat-value')?.textContent, '৭৮',
      'a count is Bangla');
  });

  test('no charts, and no platform or subscription wording', () => {
    assert.equal(root().querySelectorAll('canvas, svg.chart, .chart').length, 0);
    // D16: ShikhonBD's own commercial relationship belongs to the Platform
    // Console. A principal's dashboard must never blur it with school tuition.
    assert.doesNotMatch(text(), /সাবস্ক্রিপশন|প্ল্যান|শিখনবিডি|ShikhonBD/i);
  });

  test('a school with no academic year is told what to do, not shown zeroes', async () => {
    await mount({ year: null, needsSetup: true });
    assert.match(text(), /শিক্ষাবর্ষ এখনো তৈরি হয়নি/);
    assert.doesNotMatch(text(), /০ জন/);
  });

  test('a 403 says so, and offers no retry', async () => {
    await mount({}, 403);
    assert.match(text(), new RegExp(permissionMessage('প্রতিষ্ঠানের সারসংক্ষেপ')));
    assert.doesNotMatch(text(), /আবার চেষ্টা/);
  });

  test('a network failure offers a retry, because one might work', async () => {
    await mount({}, 0);
    assert.match(text(), /আবার চেষ্টা/);
  });

  test('every stat card is a route somewhere useful', async () => {
    const seen: string[] = [];
    await mount(FULL, 200, (p) => seen.push(p));
    // Ata Ekta: the strip is শিক্ষার্থী · আজ উপস্থিত · আজ অনুপস্থিত · বকেয়া.
    // The three that have a screen behind them are buttons.
    const cards = [...root().querySelectorAll('button.ui-stat')] as HTMLElement[];
    assert.ok(cards.length >= 3);
    for (const c of cards) c.click();
    assert.ok(seen.includes('students'));
    assert.ok(seen.includes('academic'));
    assert.ok(seen.includes('fees'));
  });

  test('nothing renders undefined, null or a raw uuid in accessible text', () => {
    for (const el of root().querySelectorAll('[aria-label],[title]')) {
      const s = (el.getAttribute('aria-label') ?? '') + (el.getAttribute('title') ?? '');
      assert.doesNotMatch(s, /undefined|null|[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
    assert.doesNotMatch(text(), /undefined|\[object/);
  });

  test("Ata Ekta header: one h1, today's date as a figure, one primary", () => {
    const r = root();
    const h1s = r.querySelectorAll('h1');
    assert.equal(h1s.length, 1, 'exactly one page heading');
    assert.equal(h1s[0].textContent, 'আজকের অবস্থা');
    const date = r.querySelector('.page-header time.ph-date');
    assert.ok(date, 'the date sits in the header');
    assert.equal(date.textContent, '১ সেপ্টেম্বর ২০২৬');
    assert.equal(date.getAttribute('datetime'), '2026-09-01');
    assert.ok(date.classList.contains('n'), 'the date is set in the numeral face');
    // R5: the accent is on one button only.
    const primaries = [...r.querySelectorAll('.btn-primary')];
    assert.equal(primaries.length, 1);
    assert.equal(primaries[0].textContent, 'নোটিশ পাঠান');
  });

  test('the primary goes to the composer', async () => {
    const seen: string[] = [];
    await mount(FULL, 200, (p) => seen.push(p));
    (root().querySelector('.page-header .btn-primary') as HTMLElement).click();
    assert.deepEqual(seen, ['compose']);
  });

  test('a refused principal is not offered "নোটিশ পাঠান"', async () => {
    await mount({}, 403);
    assert.equal(root().querySelectorAll('h1').length, 1);
    assert.equal(root().querySelectorAll('.btn-primary').length, 0);
  });

  test('the attention rows keep their way to the screen that closes them', async () => {
    const seen: string[] = [];
    await mount(FULL, 200, (p) => seen.push(p));
    const queue = root().querySelector('.ph-attention') as HTMLElement;
    assert.ok(queue);
    const rows = [...queue.querySelectorAll('.ui-list-item')];
    // 2 class teachers, 3 subject teachers, 1 result. The 4 open registers are
    // the attendance note, not a row.
    assert.equal(rows.length, 3);
    for (const b of queue.querySelectorAll('button.ui-list-hit')) (b as HTMLElement).click();
    assert.deepEqual(seen, ['academic', 'academic', 'publish']);
  });

  test("loading is the page's own shape in shimmer, never a spinner", () => {
    root().textContent = '';
    new PrincipalHomeView({
      root: root(), doc: dom.window.document,
      auth: { authedFetch: () => new Promise(() => {}) } as never,
      go: () => {}, now: AT_NOON,
    });
    const busy = root().querySelector('[aria-busy="true"]');
    assert.ok(busy, 'the loading region is announced as busy');
    assert.ok(busy.querySelectorAll('.skel').length > 0);
    assert.equal(root().querySelectorAll('.ui-spinner').length, 0);
    assert.equal(root().querySelectorAll('h1').length, 1, 'the header is there while it loads');
  });
});
