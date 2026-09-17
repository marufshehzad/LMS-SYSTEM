/**
 * UX sweep — group academic (academic-view.ts).
 *
 * Finding 26: every move between the tree, a section and a student repainted
 * the screen and dropped focus to <body>. Going in, nothing was announced and
 * the next Tab started from the top; going back, the section row or the
 * student row the person came from was lost, along with their scroll place in
 * a forty-child roster. Going IN now focuses the new depth's heading; going
 * BACK focuses the row the person left from.
 *
 * Minor 49: a past year's enrolment status showed the column's English
 * ('promoted') in the student's year-by-year history.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AcademicView } from '../src/academic-view.ts';
import { keepFocusWithin, focusIsLost } from '../src/ui/dom.ts';

let dom: JSDOM;
let scrolls: unknown[];
let intoView: { el: Element; arg: unknown }[];

beforeEach(() => {
  dom = new JSDOM(
    '<!doctype html><html><body><nav><button id="side">হোম</button></nav>' +
    '<main id="root"></main></body></html>',
    { url: 'https://school.example/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.HTMLFormElement = dom.window.HTMLFormElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.Event = dom.window.Event;
  g.location = dom.window.location;
  g.localStorage = dom.window.localStorage;
  // The browser's scroll calls, recorded. jsdom has neither.
  scrolls = [];
  g.scrollTo = (arg: unknown) => { scrolls.push(arg); };
  intoView = [];
  (dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView =
    function (this: Element, arg: unknown) { intoView.push({ el: this, arg }); };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).scrollTo;
});

const doc = () => dom.window.document;
const root = () => doc().getElementById('root')!;
const active = () => doc().activeElement as HTMLElement | null;
const settle = () => new Promise((r) => setTimeout(r, 0));

// ── fixtures ──────────────────────────────────────────────────────────

const tree = {
  years: [{ id: 'y1', label: '২০২৬', isCurrent: true }],
  year: { id: 'y1', label: '২০২৬' },
  classes: [{
    levelNo: 9, nameBn: 'নবম শ্রেণি', nameEn: 'Nine',
    sectionCount: 2, studentCount: 78,
    groups: [{
      classId: 'c1', group: 'science', groupBn: 'বিজ্ঞান',
      sectionCount: 2, studentCount: 78,
      sections: [
        { id: 'secF', name: 'F', shift: 'morning', capacity: 60, studentCount: 40,
          classTeacher: { id: 't1', nameBn: 'রহিম স্যার' }, subjectTeacherCount: 5 },
        { id: 'secE', name: 'E', shift: 'morning', capacity: 60, studentCount: 38,
          classTeacher: null, subjectTeacherCount: 4 },
      ],
    }],
  }],
};

const roster = [
  { studentId: 's1', rollNo: 1, nameBn: 'শিক্ষার্থী ১', studentCode: 'X1', status: 'active' },
  { studentId: 's2', rollNo: 2, nameBn: 'শিক্ষার্থী ২', studentCode: 'X2', status: 'active' },
  { studentId: 's3', rollNo: 3, nameBn: 'শিক্ষার্থী ৩', studentCode: 'X3', status: 'active' },
];

const sectionDetail = (id = 'secE', rows = roster) => ({
  section: { id, name: id === 'secE' ? 'E' : 'F', shift: 'morning', capacity: 60,
             studentCount: rows.length, classId: 'c1', levelNo: 9,
             classNameBn: 'নবম শ্রেণি', groupBn: 'বিজ্ঞান', yearId: 'y1', yearLabel: '২০২৬' },
  classTeacher: null,
  subjectTeachers: [],
  unassignedSubjects: [{ id: 'sub2', nameBn: 'রসায়ন' }],
  roster: rows,
  history: [],
});

const studentDetail = (id: string, nameBn: string) => ({
  student: { id, nameBn, nameEn: null, studentCode: 'X2', admissionDate: '2024-01-05',
             lifecycleStatus: 'enrolled', bloodGroup: null, status: 'active' },
  current: { yearLabel: '২০২৬', levelNo: 9, classBn: 'নবম', groupBn: 'বিজ্ঞান',
             section: 'E', rollNo: 2, status: 'active' },
  history: [
    { yearLabel: '২০২৬', levelNo: 9, classBn: 'নবম', groupBn: 'বিজ্ঞান', section: 'E',
      rollNo: 2, status: 'active', enrolledOn: '2026-01-05', endedOn: null },
    { yearLabel: '২০২৫', levelNo: 8, classBn: 'অষ্টম', groupBn: 'সাধারণ', section: 'খ',
      rollNo: 12, status: 'promoted', enrolledOn: '2025-01-05', endedOn: '2025-12-20' },
  ],
  guardians: [],
  attendance90d: { present: 74, total: 80 },
});

type Route = unknown | (() => unknown | Promise<unknown>);

/** Longest prefix wins; a function answers late (a slow 2G request). */
function fakeAuth(routes: Record<string, Route>) {
  return {
    role: 'principal', tenantId: 't1', userId: 'u1', displayName: 'প্রধান শিক্ষক',
    isLoggedIn: () => true,
    authedFetch: async (path: string) => {
      const key = Object.keys(routes)
        .filter((k) => path.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
      const route = key ? routes[key] : {};
      const body = typeof route === 'function' ? await (route as () => unknown)() : route;
      return new Response(JSON.stringify(body), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

function routes(extra: Record<string, Route> = {}): Record<string, Route> {
  return {
    '/api/v1/academics/hierarchy': tree,
    '/api/v1/academics/hierarchy?sectionId': sectionDetail(),
    '/api/v1/academics/hierarchy?studentId': studentDetail('s2', 'শিক্ষার্থী ২'),
    '/api/v1/ops/guardians': { student: { id: 's2', nameBn: 'শিক্ষার্থী ২' }, guardians: [] },
    ...extra,
  };
}

async function mount(r: Record<string, Route> = routes()): Promise<void> {
  new AcademicView({
    root: root(), doc: doc(), auth: fakeAuth(r) as never,
    canManage: true, canManageGuardians: true,
  });
  await settle();
}

/** A keyboard press: the control has focus, then activates. */
function press(control: Element | null | undefined): void {
  assert.ok(control, 'the control to press is on screen');
  (control as HTMLElement).focus();
  control.dispatchEvent(new dom.window.Event('click'));
}

const treeHit = (sectionId: string) =>
  root().querySelector(`.ac-node[data-node="S:${sectionId}"] .ac-node-hit`) as HTMLElement | null;
const rosterOpen = (studentId: string) =>
  root().querySelector(`.ac-roster tr[data-key="${studentId}"] .ui-row-open`) as HTMLElement | null;
const buttonByText = (label: string) =>
  [...root().querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;

async function openSectionE(): Promise<void> {
  press(treeHit('secE'));
  await settle();
}
async function openStudent2(): Promise<void> {
  press(rosterOpen('s2'));
  await settle();
}

// ── Finding 26 ─────────────────────────────────────────────────────────

describe('finding 26 — going IN lands on the new depth’s heading', () => {
  test('tree → section: the section heading has focus, and the page starts at its top', async () => {
    await mount();
    press(treeHit('secE'));
    // The skeleton render: the heading holds focus while the section loads.
    assert.equal(active()?.tagName, 'H1', 'focus is not dropped to <body> while loading');
    await settle();
    const h1 = root().querySelector('h1');
    assert.equal(h1?.textContent, 'সেকশন E');
    assert.equal(active(), h1, 'the loaded heading has focus — not <body>');
    assert.equal(h1?.getAttribute('tabindex'), '-1', 'focusable by script, not a Tab stop');
    assert.deepEqual(scrolls.at(-1), { top: 0 }, 'a new depth starts at its top');
  });

  test('section → student: the student’s heading has focus', async () => {
    await mount();
    await openSectionE();
    press(rosterOpen('s2'));
    await settle();
    const h1 = root().querySelector('h1');
    assert.equal(h1?.textContent, 'শিক্ষার্থী ২');
    assert.equal(active(), h1);
  });

  test('a person who moved elsewhere during a slow load is not pulled back', async () => {
    let answer: (v: unknown) => void = () => {};
    await mount(routes({
      '/api/v1/academics/hierarchy?sectionId': () => new Promise((r) => { answer = r; }),
    }));
    press(treeHit('secE'));
    // Tabbed out to the sidebar while the section was still loading.
    const side = doc().getElementById('side') as HTMLElement;
    side.focus();
    answer(sectionDetail());
    await settle(); await settle();
    assert.equal(root().querySelector('h1')?.textContent, 'সেকশন E');
    assert.equal(active(), side, 'focus the person put somewhere else stays there');
  });
});

describe('finding 26 — going BACK lands on the row the person came from', () => {
  test('student → section by “ফিরে যান”: that student’s roster row has focus, scrolled into view', async () => {
    await mount();
    await openSectionE();
    await openStudent2();
    press(buttonByText('ফিরে যান'));
    await settle();
    assert.equal(root().querySelector('h1')?.textContent, 'সেকশন E');
    const row = active()?.closest('[data-key]') as HTMLElement | null;
    assert.equal(row?.dataset.key, 's2', 'the row of the student just visited, not the first row');
    assert.ok(active()?.matches('button.ui-row-open, button.ui-list-hit'), 'its open control');
    const last = intoView.at(-1);
    assert.equal(last?.el, active(), 'and it is brought into view');
    assert.deepEqual(last?.arg, { block: 'center' });
  });

  test('student → section by the crumb: the same row', async () => {
    await mount();
    await openSectionE();
    await openStudent2();
    const crumb = [...root().querySelectorAll('.ui-crumb-link')]
      .find((c) => c.textContent === 'সেকশন E');
    press(crumb);
    await settle();
    assert.equal((active()?.closest('[data-key]') as HTMLElement | null)?.dataset.key, 's2');
  });

  test('on a phone, where the table is hidden, the visible list row takes focus', async () => {
    await mount();
    await openSectionE();
    await openStudent2();
    // A display:none control refuses focus in a browser. Model the phone
    // width: the desktop table's open buttons will not take focus.
    const proto = dom.window.HTMLElement.prototype;
    const realFocus = proto.focus;
    proto.focus = function (this: HTMLElement, opts?: FocusOptions) {
      if (this.classList.contains('ui-row-open')) return;
      realFocus.call(this, opts);
    };
    try {
      press(buttonByText('ফিরে যান'));
      await settle();
    } finally {
      proto.focus = realFocus;
    }
    assert.ok(active()?.matches('li[data-key="s2"] button.ui-list-hit'),
      'the list item the phone actually shows, not a hidden table button');
  });

  test('a student no longer in the section falls back to the heading, never <body>', async () => {
    const r = routes();
    await mount(r);
    await openSectionE();
    await openStudent2();
    // Moved to another section while their record was open.
    r['/api/v1/academics/hierarchy?sectionId'] =
      sectionDetail('secE', roster.filter((s) => s.studentId !== 's2'));
    press(buttonByText('ফিরে যান'));
    await settle();
    assert.equal(active(), root().querySelector('h1'));
  });

  test('section → tree by “ফিরে যান”: the section’s own tree row has focus, its branch open', async () => {
    await mount();
    // Close the বিভাগ first: coming back must reopen it to reach the row.
    press(root().querySelector('.ac-node[data-node="G:c1"] > .ac-row .ac-node-hit'));
    await openSectionE();
    press(buttonByText('ফিরে যান'));
    assert.equal(root().querySelector('h1')?.textContent, 'একাডেমিক কাঠামো');
    assert.equal(active(), treeHit('secE'), 'section E’s row — not <body>, not section F');
    assert.equal(active()?.closest('ul.ac-tree-group')?.hasAttribute('hidden'), false);
    assert.deepEqual(intoView.at(-1)?.arg, { block: 'center' });
  });

  test('student → tree by the crumb: the student’s section row has focus', async () => {
    await mount();
    await openSectionE();
    await openStudent2();
    const crumb = [...root().querySelectorAll('.ui-crumb-link')]
      .find((c) => c.textContent === 'একাডেমিক কাঠামো');
    press(crumb);
    assert.equal(active(), treeHit('secE'));
  });
});

describe('finding 26 — inside the shell, with its focus keeper armed', () => {
  test('the keeper does not park focus over the landing, in either direction', async () => {
    const stop = keepFocusWithin(root());
    try {
      await mount();
      press(treeHit('secE'));
      await settle(); await settle();
      assert.equal(active(), root().querySelector('h1'), 'in: the heading');
      assert.equal(focusIsLost(doc()), false);

      await openStudent2();
      await settle();
      assert.equal(active(), root().querySelector('h1'));

      press(buttonByText('ফিরে যান'));
      await settle(); await settle();
      assert.equal((active()?.closest('[data-key]') as HTMLElement | null)?.dataset.key, 's2',
        'back: the student row, not the main element');
      assert.equal(focusIsLost(doc()), false);

      press(buttonByText('ফিরে যান'));
      await settle(); await settle();
      assert.equal(active(), treeHit('secE'));
      assert.equal(focusIsLost(doc()), false);
    } finally {
      stop();
    }
  });
});

// ── Minor 49 ───────────────────────────────────────────────────────────

describe('minor 49 — a past year’s status is in Bangla', () => {
  test('“promoted” reads উন্নীত in the year-by-year history', async () => {
    await mount();
    await openSectionE();
    await openStudent2();
    const tables = [...root().querySelectorAll('.ui-data')];
    const history = tables[tables.length - 1];
    assert.match(history.textContent ?? '', /উন্নীত/);
    assert.doesNotMatch(root().textContent ?? '', /promoted/, 'no column English on screen');
  });
});
