/**
 * A guardian opens a CHILD's mark sheet.
 *
 * The guardian screen passed the child's id to `onOpenResults`, app.ts dropped
 * it, and the results screen fetched with no `studentId` — so the API used
 * the caller's own id. A guardian has no results of their own: every parent
 * who tapped "মার্কশিট দেখুন" was told nothing had been published.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let dom: JSDOM;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/' });
  (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
});

const root = () => dom.window.document.getElementById('root') as HTMLElement;
const settle = () => new Promise((r) => setTimeout(r, 10));

function recordingAuth(body: unknown) {
  const urls: string[] = [];
  return {
    urls,
    auth: {
      authedFetch: async (url: string) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      },
    } as never,
  };
}

const RESULT = (gpa: string) => ({
  examId: 'e1', examNameBn: 'বার্ষিক', examType: 'annual', totalMarks: '450', totalMax: '500',
  percentage: '90', gpa, letterGrade: 'A+', subjectsFailed: 0, isPass: true,
  rankInSection: 2, publishedAt: '2026-01-01', subjects: [],
});

const CHILD_A = '11111111-1111-4111-8111-111111111111';
const CHILD_B = '22222222-2222-4222-8222-222222222222';

describe('guardian → a child’s results', () => {
  beforeEach(() => { localStorage.clear(); root().textContent = ''; });

  test('THE ONE THAT MATTERS — the request names the child', async () => {
    const { ResultsView } = await import('../src/results-view.ts');
    const r = recordingAuth({ results: [RESULT('4.80')] });
    new ResultsView({ root: root(), doc: dom.window.document, auth: r.auth, studentId: CHILD_A });
    await settle();
    assert.equal(r.urls[0], `/api/v1/academics/results?studentId=${CHILD_A}`);
  });

  test('a student reading their own results still asks without an id', async () => {
    const { ResultsView } = await import('../src/results-view.ts');
    const r = recordingAuth({ results: [] });
    new ResultsView({ root: root(), doc: dom.window.document, auth: r.auth });
    await settle();
    assert.equal(r.urls[0], '/api/v1/academics/results');
  });

  test('one child’s cached marks never paint under another child', async () => {
    const { ResultsView } = await import('../src/results-view.ts');
    const a = recordingAuth({ results: [RESULT('4.80')] });
    new ResultsView({ root: root(), doc: dom.window.document, auth: a.auth, studentId: CHILD_A });
    await settle();
    assert.ok(localStorage.getItem(`shikhon_results_cache_${CHILD_A}`), 'child A is cached under their own key');

    root().textContent = '';
    const offline = { authedFetch: async () => { throw new TypeError('Failed to fetch'); } } as never;
    new ResultsView({ root: root(), doc: dom.window.document, auth: offline, studentId: CHILD_B });
    await settle();
    assert.doesNotMatch(root().textContent ?? '', /[৪4][.,][৮8][০0]/, 'child B offline shows none of child A’s marks');
  });

  test('app.ts carries the id from the guardian screen into the route', () => {
    const src = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    assert.match(src, /onOpenResults: \(studentId\) =>[\s\S]{0,120}#\/results\?studentId=\$\{encodeURIComponent\(studentId\)\}/);
    assert.match(src, /get\('studentId'\)[\s\S]{0,80}new ResultsView\(\{[^}]*studentId/);
  });
});
