/**
 * UX fixes on the results screen (#/results), from the confirmed browser sweep.
 *
 *   2  A guardian who comes in through the ফলাফল tab, the sidebar, the home
 *      card or আরও reaches plain #/results. The view asked the API with no
 *      studentId, the API read the guardian's own id, and a parent was told
 *      nothing had been published about a child whose results were.
 *  17  Even with the right id, the sheet never said whose it was: no child
 *      strip, no identity, no name in the hero.
 *  23  Changing the exam rebuilt the page, select and all, and focus fell to
 *      <body> after every change.
 *  64  The screen's own "অফলাইন" banner stayed after the connection came back,
 *      until the person left the page and returned.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/#/results' });
const g = globalThis as Record<string, unknown>;
g.HTMLElement = dom.window.HTMLElement;
for (const key of ['localStorage', 'location'] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

const { ResultsView } = await import('../src/results-view.ts');
const { keepFocusWithin } = await import('../src/ui/dom.ts');
const { permissionMessage } = await import('../src/ui/feedback.ts');

const doc = dom.window.document;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const WARDS = [
  { studentId: A, nameBn: 'রাফির হাসান', sectionLabel: 'নবম–ক', rollNo: 7, relationBn: 'পিতা' },
  { studentId: B, nameBn: 'তাহিয়া হাসান', sectionLabel: 'পঞ্চম–খ', rollNo: 3, relationBn: 'পিতা' },
];
const RESULT = (examId: string, examNameBn: string, gpa: string) => ({
  examId, examNameBn, examType: 'terminal', totalMarks: '450', totalMax: '500',
  percentage: '90', gpa, letterGrade: 'A+', subjectsFailed: 0, isPass: true,
  rankInSection: 5, publishedAt: '2026-08-12', subjects: [],
});
const RES_A = [RESULT('e1', 'বার্ষিক পরীক্ষা', '4.72'), RESULT('e2', 'দ্বিতীয় সাময়িক', '4.31')];

type Answer = (url: string) => Response | Promise<Response>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;
const offline = (): never => { throw new TypeError('Failed to fetch'); };

/** What production answers. The bare endpoint reads the caller's own id: a guardian has no rows. */
const PROD: Answer = (url) => {
  if (url === '/api/v1/academics/ward') return ok({ wards: WARDS, student: null });
  if (url === `/api/v1/academics/results?studentId=${A}`) return ok({ results: RES_A });
  if (url === `/api/v1/academics/results?studentId=${B}`) return ok({ results: [] });
  if (url === '/api/v1/academics/results') return ok({ results: [] });
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

function mount(role: string | undefined, answer: Answer, studentId?: string) {
  const urls: string[] = [];
  let current = answer;
  const auth = {
    role,
    authedFetch: async (url: string) => { urls.push(url); return current(url); },
  } as never;
  const view = new ResultsView({ root, doc, auth, studentId });
  views.push(view);
  return { view, urls, answer: (a: Answer) => { current = a; } };
}

const heroExam = () => root.querySelector('.result-hero-exam')?.textContent ?? '';
const text = () => root.textContent ?? '';
const cacheGuardian = (homeId: string | null, wards = WARDS) =>
  localStorage.setItem('shikhon_guardian_home', JSON.stringify({
    wards, home: homeId ? { ...wards.find((w) => w.studentId === homeId) } : null,
  }));

beforeEach(() => {
  localStorage.clear();
  // The child last on screen is shared with আমার সন্তান through sessionStorage
  // (R4); one test's choice must not become the next test's remembered child.
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

describe('2 — a guardian reaches #/results with no child in the link', () => {
  test('THE ONE THAT MATTERS — the ward list first, then a CHILD’s sheet; never the bare endpoint', async () => {
    const m = mount('guardian', PROD);
    await settle();
    assert.equal(m.urls[0], '/api/v1/academics/ward');
    assert.ok(m.urls.includes(`/api/v1/academics/results?studentId=${A}`), m.urls.join(' | '));
    assert.ok(!m.urls.includes('/api/v1/academics/results'),
      'the bare read answers with the guardian’s own id and says nothing was published');
    assert.match(root.querySelector('.result-hero')?.textContent ?? '', /৪\.৭২/);
    assert.doesNotMatch(text(), /এখনো কোনো ফলাফল প্রকাশিত হয়নি/);
  });

  test('the child last chosen on আমার সন্তান is the one the tab opens', async () => {
    cacheGuardian(B);
    const m = mount('guardian', PROD);
    await settle();
    assert.deepEqual(m.urls, [`/api/v1/academics/results?studentId=${B}`],
      'the child is known from the cache, so no ward read is needed');
    const selected = root.querySelector('.ui-child-opt[aria-selected="true"]') as HTMLElement | null;
    assert.equal(selected?.dataset.id, B, 'the strip says whose sheet this is');
  });

  test('a remembered child who is no longer linked is not used', async () => {
    localStorage.setItem('shikhon_guardian_home', JSON.stringify({
      wards: WARDS, home: { studentId: '33333333-3333-4333-8333-333333333333' },
    }));
    const m = mount('guardian', PROD);
    await settle();
    assert.equal(m.urls[0], `/api/v1/academics/results?studentId=${A}`);
  });

  test('the child goes into the address, so a reload stays on them', async () => {
    mount('guardian', PROD);
    await settle();
    assert.equal(dom.window.location.hash, `#/results?studentId=${A}`);
  });

  test('no child linked: the guardian’s sentence, not “nothing published”', async () => {
    const m = mount('guardian', (url) => (url === '/api/v1/academics/ward'
      ? ok({ wards: [], student: null }) : PROD(url)));
    await settle();
    assert.match(text(), /আপনার সাথে কোনো শিক্ষার্থী যুক্ত নেই/);
    assert.doesNotMatch(text(), /প্রকাশিত হয়নি/);
    assert.ok(!m.urls.some((u) => u.startsWith('/api/v1/academics/results')), m.urls.join(' | '));
  });

  test('the ward read refused: the permission state, with no retry', async () => {
    mount('guardian', (url) => (url === '/api/v1/academics/ward' ? fail(403) : PROD(url)));
    await settle();
    assert.match(text(), new RegExp(permissionMessage('ফলাফল')));
    assert.doesNotMatch(text(), /আবার চেষ্টা/);
  });

  test('the ward read fails with nothing cached: the error state, never the empty one', async () => {
    mount('guardian', offline);
    await settle();
    assert.match(text(), /ফলাফল আনা গেল না/);
    assert.doesNotMatch(text(), /প্রকাশিত হয়নি/);
  });

  test('a student still reads their own sheet, with no ward read', async () => {
    const m = mount('student', PROD);
    await settle();
    assert.deepEqual(m.urls, ['/api/v1/academics/results']);
    assert.equal(root.querySelector('.ui-child-strip, .ui-child-identity'), null);
  });
});

describe('17 — the sheet says whose it is', () => {
  test('two children: the strip, the child on screen selected, and the name in the hero', async () => {
    cacheGuardian(A);
    mount('guardian', PROD, A);
    await settle();
    const opts = [...root.querySelectorAll<HTMLElement>('.ui-child-strip .ui-child-opt')];
    assert.equal(opts.length, 2);
    assert.equal(opts.find((o) => o.getAttribute('aria-selected') === 'true')?.dataset.id, A);
    assert.match(heroExam(), /^বার্ষিক পরীক্ষা · রাফির হাসান$/);
    const region = root.querySelector('.result-sheet') as HTMLElement;
    const label = doc.getElementById(region.getAttribute('aria-labelledby') ?? '');
    assert.match(label?.textContent ?? '', /রাফির হাসান/, 'the sheet’s region is named by the child too');
  });

  test('a link with a child this device has no name for: the list is read and the hero names them', async () => {
    const m = mount('guardian', PROD, A);
    await settle();
    assert.ok(m.urls.includes('/api/v1/academics/ward'));
    assert.match(heroExam(), /রাফির হাসান/);
  });

  test('switching child reads that child; a late answer for the first is dropped', async () => {
    cacheGuardian(A);
    const lateA = deferred<Response>();
    const m = mount('guardian', (url) => (url.endsWith(A) ? lateA.promise : PROD(url)), A);
    await settle();
    const toB = root.querySelector(`.ui-child-opt[data-id="${B}"]`) as HTMLButtonElement;
    toB.click();
    await settle();
    assert.ok(m.urls.includes(`/api/v1/academics/results?studentId=${B}`));
    lateA.resolve(ok({ results: RES_A }));
    await settle();
    assert.doesNotMatch(text(), /৪\.৭২/, 'the first child’s marks never paint under the second');
    assert.match(text(), /এখনো কোনো ফলাফল প্রকাশিত হয়নি/);
    assert.equal(
      (root.querySelector('.ui-child-opt[aria-selected="true"]') as HTMLElement | null)?.dataset.id, B);
    assert.equal(localStorage.getItem(`shikhon_results_cache_${A}`), null,
      'the dropped answer is not cached either');
    assert.doesNotMatch(localStorage.getItem(`shikhon_results_cache_${B}`) ?? '', /4\.72/,
      'and above all not under the second child’s key, where the next paint would read it');
    assert.equal(dom.window.location.hash, `#/results?studentId=${B}`);
  });

  test('one child: the identity block, and no strip', async () => {
    cacheGuardian(A, [WARDS[0]]);
    mount('guardian', PROD);
    await settle();
    assert.equal(root.querySelector('.ui-child-strip'), null);
    assert.match(root.querySelector('.ui-child-identity')?.textContent ?? '', /রাফির হাসান/);
    assert.match(heroExam(), /রাফির হাসান/);
  });

  test('a student’s hero is only the exam', async () => {
    mount('student', () => ok({ results: RES_A }));
    await settle();
    assert.equal(heroExam(), 'বার্ষিক পরীক্ষা');
  });
});

describe('23 — changing the exam keeps focus on the select', () => {
  test('the select is the same node after the change, and still has focus', async () => {
    mount('student', () => ok({ results: RES_A }));
    await settle();
    const select = root.querySelector('.exam-select-field select') as HTMLSelectElement;
    select.focus();
    select.value = 'e2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(doc.activeElement, select, 'focus never left the control');
    assert.ok(select.isConnected);
    assert.match(heroExam(), /দ্বিতীয় সাময়িক/);
    const current = root.querySelector('.result-history-point[aria-current="true"]');
    assert.match(current?.textContent ?? '', /দ্বিতীয় সাময়িক/, 'the trend follows the choice');
    assert.equal(root.querySelectorAll('.result-sheet').length, 1, 'the old sheet is gone');
  });

  test('a read that lands while the select has focus: the shell’s keeper puts it back', async () => {
    localStorage.setItem('shikhon_results_cache', JSON.stringify(RES_A));
    stops.push(keepFocusWithin(root));
    const late = deferred<Response>();
    mount('student', () => late.promise);
    await settle();
    const select = root.querySelector('.exam-select-field select') as HTMLSelectElement;
    select.focus();
    late.resolve(ok({ results: RES_A }));
    await settle();
    const active = doc.activeElement as HTMLSelectElement;
    assert.equal(active.tagName, 'SELECT');
    assert.equal(active.name, 'exam');
    assert.ok(active.isConnected);
  });
});

describe('64 — the screen’s offline banner goes when the connection returns', () => {
  test('cached sheet under the banner, then online: read again, banner gone', async () => {
    localStorage.setItem('shikhon_results_cache', JSON.stringify([RESULT('e1', 'বার্ষিক পরীক্ষা', '4.00')]));
    const m = mount('student', offline);
    await settle();
    assert.ok(root.querySelector('.result-offline'), 'offline: the cached sheet is under a banner');
    m.answer(() => ok({ results: RES_A }));
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await settle();
    assert.equal(root.querySelector('.result-offline'), null, 'the banner does not outlive the outage');
    assert.match(root.querySelector('.result-hero')?.textContent ?? '', /৪\.৭২/, 'and the sheet is fresh');
  });

  test('the error page with nothing cached reads again by itself', async () => {
    const m = mount('student', offline);
    await settle();
    assert.match(text(), /ফলাফল আনা গেল না/);
    m.answer(() => ok({ results: RES_A }));
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await settle();
    assert.doesNotMatch(text(), /আনা গেল না/);
    assert.match(root.querySelector('.result-hero')?.textContent ?? '', /৪\.৭২/);
  });

  test('a current screen is not read again when the connection returns', async () => {
    const m = mount('student', () => ok({ results: RES_A }));
    await settle();
    const before = m.urls.length;
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await settle();
    assert.equal(m.urls.length, before);
  });

  test('after destroy: the online listener is gone', async () => {
    const m = mount('student', offline);
    await settle();
    assert.match(text(), /ফলাফল আনা গেল না/, 'a failed screen, which WOULD read again on online');
    const removed: string[] = [];
    const realRemove = dom.window.removeEventListener.bind(dom.window);
    dom.window.removeEventListener = ((type: string, fn: never, o?: never) => {
      removed.push(type);
      realRemove(type, fn, o);
    }) as typeof dom.window.removeEventListener;
    try { m.view.destroy(); } finally { dom.window.removeEventListener = realRemove; }
    assert.ok(removed.includes('online'), 'destroy() takes its listener off the window');
    root.textContent = 'the next page';
    const count = m.urls.length;
    m.answer(() => ok({ results: RES_A }));
    dom.window.dispatchEvent(new dom.window.Event('online'));
    await settle();
    assert.equal(m.urls.length, count, 'nothing is read for a page that is gone');
    assert.equal(root.textContent, 'the next page');
  });

  test('after destroy: a late answer does not paint over the page that replaced this one', async () => {
    const late = deferred<Response>();
    const m = mount('student', () => late.promise);
    await settle();
    m.view.destroy();
    root.textContent = 'the next page';
    late.resolve(ok({ results: RES_A }));
    await settle();
    assert.equal(root.textContent, 'the next page');
  });
});

/**
 * The review of 2 and 17: the view was right, but the preview (/demo) is what
 * the owner looks at, and its results stub answered রাফির's sheet for every
 * child. Once the screen names the child, one tap on তাহিয়া drew
 * "বার্ষিক পরীক্ষা · তাহিয়া হাসান" over রাফির's A+. These mount the screen on
 * the demo's own API (DemoAuth, as app.ts does in /demo), so the name above
 * the sheet and the sheet are checked together, not one side at a time.
 */
describe('2 + 17 in the preview — the name above the sheet is the sheet’s child', () => {
  let DemoAuth: typeof import('../src/demo.ts').DemoAuth;

  async function demoGuardian(studentId?: string) {
    DemoAuth ??= (await import('../src/demo.ts')).DemoAuth;
    localStorage.setItem('shikhon_demo_role', 'guardian');
    const view = new ResultsView({ root, doc, auth: new DemoAuth(), studentId });
    views.push(view);
    await settle();
    return view;
  }

  test('the tab with no child: রাফির, named, with his sheet', async () => {
    await demoGuardian();
    assert.match(heroExam(), /রাফির হাসান/);
    assert.match(root.querySelector('.result-hero')?.textContent ?? '', /৪\.৭২/);
    assert.equal(
      (root.querySelector('.ui-child-opt[aria-selected="true"]') as HTMLElement | null)?.dataset.id, 'demo-s1');
  });

  test('THE REVIEW’S CASE — tap তাহিয়া on the strip: her empty state, never রাফির’s A+ under her name', async () => {
    await demoGuardian();
    (root.querySelector('.ui-child-opt[data-id="demo-s2"]') as HTMLButtonElement).click();
    await settle();
    assert.equal(
      (root.querySelector('.ui-child-opt[aria-selected="true"]') as HTMLElement | null)?.dataset.id, 'demo-s2');
    assert.equal(root.querySelector('.result-hero'), null, 'no sheet is drawn for a child with no result');
    assert.doesNotMatch(text(), /৪\.৭২|A\+/);
    assert.match(text(), /এখনো কোনো ফলাফল প্রকাশিত হয়নি/);
  });

  test('তাহিয়া chosen on আমার সন্তান, then the ফলাফল tab: the same', async () => {
    cacheGuardian('demo-s2', [
      { studentId: 'demo-s1', nameBn: 'রাফির হাসান', sectionLabel: 'নবম–ক', rollNo: 7, relationBn: 'পিতা' },
      { studentId: 'demo-s2', nameBn: 'তাহিয়া হাসান', sectionLabel: 'পঞ্চম–খ', rollNo: 3, relationBn: 'পিতা' },
    ]);
    await demoGuardian();
    assert.equal(root.querySelector('.result-hero'), null);
    assert.doesNotMatch(text(), /৪\.৭২/);
    assert.match(text(), /এখনো কোনো ফলাফল প্রকাশিত হয়নি/);
  });
});
