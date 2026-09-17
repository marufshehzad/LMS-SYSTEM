/**
 * UX sweep, round 2 — the guardian's two child-aware tabs (group results-guardian).
 *
 *   R3  On #/results the exam picker lived in the page header and existed only
 *       for a child with two or more published exams. The child strip sat
 *       under the header, so switching from রাফির (two exams) to তাহিয়া (none)
 *       moved the strip up 87px on a phone, and a tap where রাফির's tab had
 *       just been landed on the empty state.
 *  R4  The child chosen on আমার সন্তান carried into ফলাফল, but a child chosen on
 *       the ফলাফল strip did not carry back: আমার সন্তান still showed the child
 *       it had saved.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/#/results' });
const g = globalThis as Record<string, unknown>;
g.HTMLElement = dom.window.HTMLElement;
g.KeyboardEvent = dom.window.KeyboardEvent;
for (const key of ['localStorage', 'location'] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

const { ResultsView } = await import('../src/results-view.ts');
const { GuardianView, CACHE_KEY: WARD_CACHE, CHOSEN_CHILD_KEY, rememberChosenChild } =
  await import('../src/guardian-view.ts');
const { keepFocusWithin } = await import('../src/ui/dom.ts');

const doc = dom.window.document;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const WARDS = [
  { studentId: A, nameBn: 'রাফির হাসান', sectionLabel: 'নবম–ক', rollNo: 7, relationBn: 'পিতা' },
  { studentId: B, nameBn: 'তাহিয়া হাসান', sectionLabel: 'পঞ্চম–খ', rollNo: 3, relationBn: 'পিতা' },
];
const HOME = (id: string) => ({
  ...WARDS.find((w) => w.studentId === id)!,
  attendance: { todayStatus: 'present', monthPercent: 94, present: 17, absent: 1, late: 0, halfDay: 0, excused: 0 },
  fees: { outstanding: 0, earliestDue: null, overdueCount: 0 },
  result: null,
});
const RESULT = (examId: string, examNameBn: string, gpa: string) => ({
  examId, examNameBn, examType: 'terminal', totalMarks: '450', totalMax: '500',
  percentage: '90', gpa, letterGrade: 'A+', subjectsFailed: 0, isPass: true,
  rankInSection: 5, publishedAt: '2026-08-12', subjects: [],
});
const RES_A = [RESULT('e1', 'বার্ষিক পরীক্ষা', '4.72'), RESULT('e2', 'দ্বিতীয় সাময়িক', '4.31')];

type Answer = (url: string) => Response | Promise<Response>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const offline = (): never => { throw new TypeError('Failed to fetch'); };

/** Production's answers: রাফির has two published exams, তাহিয়া none; the ward read by child. */
const PROD: Answer = (url) => {
  const [path, query = ''] = url.split('?');
  const id = new URLSearchParams(query).get('studentId');
  if (path === '/api/v1/academics/ward') return ok({ wards: WARDS, student: id ? HOME(id) : null });
  if (url === `/api/v1/academics/results?studentId=${A}`) return ok({ results: RES_A });
  if (url === `/api/v1/academics/results?studentId=${B}`) return ok({ results: [] });
  if (url === '/api/v1/academics/results') return ok({ results: RES_A });
  throw new Error(`unexpected ${url}`);
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let views: Array<{ destroy(): void }> = [];
let root: HTMLElement;
const stops: Array<() => void> = [];

function fakeAuth(role: string, answer: Answer, userId = 'guardian-1') {
  const urls: string[] = [];
  const auth = { role, userId, authedFetch: async (url: string) => { urls.push(url); return answer(url); } } as never;
  return { auth, urls };
}

function results(role: string, answer: Answer, studentId?: string, userId?: string) {
  const f = fakeAuth(role, answer, userId);
  views.push(new ResultsView({ root, doc, auth: f.auth, studentId }));
  return f;
}

function guardian(answer: Answer, userId?: string) {
  const f = fakeAuth('guardian', answer, userId);
  views.push(new GuardianView({ root, doc, auth: f.auth, onOpenFees: () => {}, onOpenResults: () => {} }));
  return f;
}

/** The shell leaving one route for another: the old page is torn down, the outlet emptied. */
function leave() {
  for (const v of views) v.destroy();
  views = [];
  root.textContent = '';
}

/** What আমার সন্তান saves after it has shown a child's panel. */
const savePanel = (id: string) =>
  localStorage.setItem(WARD_CACHE, JSON.stringify({ wards: WARDS, home: HOME(id) }));

const selectedTab = () =>
  (root.querySelector('.ui-child-opt[aria-selected="true"]') as HTMLElement | null)?.dataset.id;
const identity = () => root.querySelector('.ui-child-identity')?.textContent ?? '';
const header = () => root.querySelector('.page-header') as HTMLElement;
const strip = () => root.querySelector('.ui-child-strip') as HTMLElement;
const heroExam = () => root.querySelector('.result-hero-exam')?.textContent ?? '';
const tap = (id: string) => (root.querySelector(`.ui-child-opt[data-id="${id}"]`) as HTMLButtonElement).click();

beforeEach(() => {
  localStorage.clear();
  dom.window.sessionStorage.clear();
  dom.window.history.replaceState(null, '', '#/results');
  root = doc.createElement('main');
  doc.body.append(root);
});

afterEach(() => {
  for (const v of views) v.destroy();
  views = [];
  while (stops.length) stops.pop()!();
  root.remove();
});

/* ── R3 ───────────────────────────────────────────────────────────────── */

describe('R3 — the child strip stays where it is when the child changes', () => {
  test('THE ONE THAT MATTERS — header, then strip, for a child with two exams and for a child with none', async () => {
    savePanel(A);
    results('guardian', PROD, A);
    await settle();
    assert.equal(header().querySelector('.ui-field, select'), null,
      'a picker that only some children have must not sit above the strip');
    assert.equal(root.children[0], header());
    assert.equal(root.children[1], strip(), 'the strip comes straight after the header');
    const headerText = header().textContent;
    const pick = root.querySelector('.result-exam-pick') as HTMLElement | null;
    assert.ok(pick?.querySelector('select'), 'রাফির has two exams, so the picker is there');
    assert.equal(root.children[2], pick, 'under the strip, above the sheet');

    tap(B);
    await settle();
    assert.equal(selectedTab(), B);
    assert.equal(root.querySelector('select'), null, 'তাহিয়া has no exams to pick from');
    assert.equal(root.children[0], header());
    assert.equal(root.children[1], strip(), 'the strip did not move up into the picker’s place');
    assert.equal(header().textContent, headerText);
    assert.equal(header().querySelector('.ui-field, select'), null);

    tap(A);
    await settle();
    assert.equal(selectedTab(), A, 'tapping রাফির again, where his tab still is, reaches him');
    assert.equal(root.children[1], strip());
    assert.equal(root.children[2], root.querySelector('.result-exam-pick'));
  });

  test('while the next child’s sheet is still loading the strip is in the same place too', async () => {
    savePanel(A);
    const held = deferred<Response>();
    results('guardian', (url) => (url.endsWith(B) ? held.promise : PROD(url)), A);
    await settle();
    tap(B);
    await settle();
    assert.ok(root.querySelector('[aria-busy="true"]'), 'the skeleton, not a blank page');
    assert.equal(root.children[1], strip());
    assert.equal(header().querySelector('.ui-field, select'), null);
    held.resolve(ok({ results: [] }));
    await settle();
    assert.equal(root.children[1], strip());
  });

  test('a guardian changing the exam: the same select keeps focus, still under the strip', async () => {
    savePanel(A);
    results('guardian', PROD, A);
    await settle();
    const select = root.querySelector('.result-exam-pick select') as HTMLSelectElement;
    select.focus();
    select.value = 'e2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(doc.activeElement, select, 'focus never left the control');
    assert.ok(select.isConnected);
    assert.equal(root.children[2], select.closest('.ui-field'));
    assert.equal(heroExam(), 'দ্বিতীয় সাময়িক · রাফির হাসান');
    assert.equal(root.querySelectorAll('.result-sheet').length, 1, 'the old sheet is gone');
    const label = root.querySelector(`label[for="${select.id}"]`);
    assert.equal(label?.textContent, 'পরীক্ষা', 'the visible label moved with it');
  });

  test('switching child by keyboard still keeps focus on the child’s tab (keeper armed, as in the shell)', async () => {
    savePanel(A);
    stops.push(keepFocusWithin(root));
    results('guardian', PROD, A);
    await settle();
    const tab = root.querySelector(`.ui-child-opt[data-id="${A}"]`) as HTMLElement;
    tab.focus();
    tab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await settle();
    assert.equal(selectedTab(), B);
    assert.equal((doc.activeElement as HTMLElement).dataset.id, B);
  });

  test('a student has no strip, and their picker stays in the page header', async () => {
    results('student', PROD);
    await settle();
    assert.ok(header().querySelector('.exam-select-field select'));
    assert.equal(root.querySelector('.result-exam-pick'), null);
  });
});

/* ── R4 ───────────────────────────────────────────────────────────────── */

describe('R4 — one chosen child for আমার সন্তান and ফলাফল, both ways', () => {
  test('THE REVIEW’S CASE — তাহিয়া picked on the ফলাফল strip: আমার সন্তান opens on তাহিয়া', async () => {
    savePanel(A);                       // আমার সন্তান last showed রাফির
    results('guardian', PROD);
    await settle();
    assert.equal(selectedTab(), A);
    tap(B);
    await settle();
    leave();

    const m = guardian(PROD);
    // At once, before any answer: her tab, and no রাফির panel under it.
    assert.equal(selectedTab(), B);
    assert.doesNotMatch(identity(), /রাফির/, 'never one child’s figures under the other child’s tab');
    await settle();
    assert.equal(m.urls[0], `/api/v1/academics/ward?studentId=${B}`);
    assert.equal(selectedTab(), B);
    assert.match(identity(), /তাহিয়া হাসান/);
  });

  test('and back: a child picked on আমার সন্তান, whose panel has not arrived yet, is the child ফলাফল opens', async () => {
    savePanel(A);
    const held = deferred<Response>();
    guardian((url) => (url.endsWith(B) ? held.promise : PROD(url)));
    await settle();
    assert.equal(selectedTab(), A);
    tap(B);                             // slow line: her panel is still on its way
    await settle();
    leave();                            // …and the parent taps the ফলাফল tab

    const m = results('guardian', PROD);
    await settle();
    assert.deepEqual(m.urls, [`/api/v1/academics/results?studentId=${B}`]);
    assert.equal(selectedTab(), B);
    assert.equal(dom.window.location.hash, `#/results?studentId=${B}`);
    held.resolve(ok({ wards: WARDS, student: HOME(B) }));
    await settle();
    assert.equal(selectedTab(), B, 'the page the parent left does not paint over this one');
  });

  test('a child named by the link (মার্কশিট দেখুন, a reload) is the child আমার সন্তান opens, even with no panel saved', async () => {
    results('guardian', PROD, B);
    await settle();
    leave();
    localStorage.clear();               // nothing saved on this device

    const m = guardian(PROD);
    await settle();
    assert.deepEqual(m.urls, ['/api/v1/academics/ward', `/api/v1/academics/ward?studentId=${B}`]);
    assert.equal(selectedTab(), B);
    assert.match(identity(), /তাহিয়া হাসান/);
  });

  test('ফলাফল with nothing saved reads the list, then opens the child last on screen', async () => {
    rememberChosenChild(doc, fakeAuth('guardian', PROD).auth, B);
    const m = results('guardian', PROD);
    await settle();
    assert.equal(m.urls[0], '/api/v1/academics/ward');
    assert.ok(m.urls.includes(`/api/v1/academics/results?studentId=${B}`), m.urls.join(' | '));
    assert.equal(selectedTab(), B);
  });

  test('another person signed in on this tab reads nothing from the previous guardian’s choice', async () => {
    savePanel(A);
    rememberChosenChild(doc, fakeAuth('guardian', PROD, 'guardian-1').auth, B);

    const g2 = guardian(PROD, 'guardian-2');
    await settle();
    assert.equal(g2.urls[0], `/api/v1/academics/ward?studentId=${A}`);
    leave();
    // guardian-2's own panel load has made the choice theirs; put guardian-1's back.
    rememberChosenChild(doc, fakeAuth('guardian', PROD, 'guardian-1').auth, B);
    const r2 = results('guardian', PROD, undefined, 'guardian-2');
    await settle();
    assert.equal(r2.urls[0], `/api/v1/academics/results?studentId=${A}`);
  });

  test('a remembered child who is not one of this guardian’s children is ignored on both tabs', async () => {
    savePanel(A);
    rememberChosenChild(doc, fakeAuth('guardian', PROD).auth, C);
    const m = guardian(PROD);
    assert.equal(selectedTab(), A);
    await settle();
    assert.ok(!m.urls.some((u) => u.includes(C)), 'a stale id is never fetched');
    leave();
    rememberChosenChild(doc, fakeAuth('guardian', PROD).auth, C);
    const r = results('guardian', PROD);
    await settle();
    assert.equal(r.urls[0], `/api/v1/academics/results?studentId=${A}`);
  });

  test('offline, with only the other child’s panel saved: that child, selected and named, under the banner', async () => {
    savePanel(A);
    rememberChosenChild(doc, fakeAuth('guardian', PROD).auth, B);
    guardian(offline);
    await settle();
    assert.ok(root.querySelector('.ward-offline'), 'the offline banner');
    assert.equal(root.querySelector('.ui-state-error'), null, 'not an error page');
    assert.equal(selectedTab(), A, 'the tab and the panel name the same child');
    assert.match(identity(), /রাফির হাসান/);
  });

  test('a student’s own results never write a guardian’s choice', async () => {
    results('student', PROD);
    await settle();
    assert.equal(dom.window.sessionStorage.getItem(CHOSEN_CHILD_KEY), null);
  });

  test('in the preview, the re-check’s path: আমার সন্তান → ফলাফল → তাহিয়া → আমার সন্তান', async () => {
    const { DemoAuth } = await import('../src/demo.ts');
    localStorage.setItem('shikhon_demo_role', 'guardian');
    views.push(new GuardianView({ root, doc, auth: new DemoAuth() }));
    await settle();
    assert.equal(selectedTab(), 'demo-s1');
    leave();
    views.push(new ResultsView({ root, doc, auth: new DemoAuth() }));
    await settle();
    assert.equal(selectedTab(), 'demo-s1');
    tap('demo-s2');
    await settle();
    leave();
    views.push(new GuardianView({ root, doc, auth: new DemoAuth() }));
    await settle();
    assert.equal(selectedTab(), 'demo-s2');
    assert.match(identity(), /তাহিয়া/);
  });
});
