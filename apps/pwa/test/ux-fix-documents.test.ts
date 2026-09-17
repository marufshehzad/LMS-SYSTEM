/**
 * UX sweep — নথি ও ছাপা (group documents).
 *
 * Findings 13 and 19: a student or guardian offered প্রগতি পত্র / প্রবেশপত্র
 * met "একাডেমিক কাঠামো দেখার অনুমতি আপনার নেই।" — the step read the staff-only
 * class tree and publish list — and could never reach the document the
 * endpoint would have given them.
 *
 * Finding 24: every action rebuilt the screen and left focus on <body>.
 *
 * Minors 11, 21, 32, 58: a primary under an empty step, and a missing choice
 * shown as a load failure with a retry that could never work.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { DocumentsView, type DocKind } from '../src/documents-view.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const settle = (ms = 15) => new Promise((r) => setTimeout(r, ms));

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, 'localStorage',
    { value: dom.window.localStorage, configurable: true });
});

beforeEach(() => {
  doc().body.innerHTML = '<main id="root"></main><button id="elsewhere">অন্যত্র</button>';
});

const root = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;

type Body = unknown | ((url: string) => { status: number; body?: unknown; html?: string });

/** An Auth whose server is a table of path → answer, recording every request. */
function fakeAuth(role: string, routes: Record<string, Body>, userId = 'me-1') {
  const urls: string[] = [];
  const auth = {
    role,
    userId,
    authedFetch: async (url: string) => {
      urls.push(url);
      const path = url.split('?')[0];
      const hit = routes[path];
      if (hit === undefined) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as unknown as Response;
      }
      const r = typeof hit === 'function'
        ? (hit as (u: string) => { status: number; body?: unknown; html?: string })(url)
        : { status: 200, body: hit };
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body ?? {},
        text: async () => r.html ?? '',
      } as unknown as Response;
    },
  };
  return { urls, auth: auth as never };
}

const FAMILY: DocKind[] = ['fee_receipt', 'report_card', 'admit_card'];
const ALL: DocKind[] = ['fee_receipt', 'report_card', 'admit_card', 'id_card',
  'transfer_certificate', 'attendance_sheet'];

const kindHit = (kind: DocKind) =>
  root().querySelector<HTMLButtonElement>(`.doc-kinds [data-key="${kind}"] .ui-list-hit`)!;
const primary = () => root().querySelector<HTMLButtonElement>('.doc-actions .btn-primary');
const generateBtn = () => root().querySelector<HTMLButtonElement>('[data-focus-key="doc-generate"]');
const lock = () => root().querySelector('.ui-state-denied');
/** The preview button found by what it says, not by the key the fix added. */
const previewByText = () => [...root().querySelectorAll<HTMLButtonElement>('button')]
  .find((b) => /পূর্বরূপ দেখুন|আবার তৈরি করুন/.test(b.textContent ?? '')) ?? null;

const WARDS = [
  { studentId: 'kid-a', nameBn: 'রাফি হাসান', sectionLabel: 'নবম–ক', rollNo: 7, relationBn: 'পিতা' },
  { studentId: 'kid-b', nameBn: 'তাহিয়া হাসান', sectionLabel: 'পঞ্চম–খ', rollNo: 3, relationBn: 'পিতা' },
];
const RESULTS = {
  results: [
    { examId: 'ex-annual', examNameBn: 'বার্ষিক পরীক্ষা', publishedAt: '2026-08-12T09:00:00Z' },
    { examId: 'ex-half', examNameBn: 'অর্ধবার্ষিক পরীক্ষা', publishedAt: '2026-05-20T09:00:00Z' },
  ],
};
const CALENDAR = {
  entries: [
    { id: 'exam:ex-final', day: '2026-11-02', kind: 'exam', titleBn: 'বার্ষিক পরীক্ষা' },
    { id: 'exam-subject:es-1', day: '2026-11-03', kind: 'exam', titleBn: 'বার্ষিক পরীক্ষা — গণিত' },
  ],
};
const STAFF_ONLY = (_url: string) => ({ status: 403, body: { error: 'forbidden' } });
const DOC_OK = () => ({ status: 200, html: '<!doctype html><p>নথি</p>' });

function familyRoutes(extra: Record<string, Body> = {}): Record<string, Body> {
  return {
    // What a family really gets from the staff reads (hierarchy.ts
    // requireStaff, publish.ts PUBLISH_ROLES).
    '/api/v1/academics/hierarchy': STAFF_ONLY,
    '/api/v1/academics/publish': STAFF_ONLY,
    '/api/v1/academics/ward': { wards: WARDS, student: null },
    '/api/v1/academics/results': RESULTS,
    '/api/v1/ops/calendar': CALENDAR,
    '/api/v1/ops/document': DOC_OK,
    ...extra,
  };
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

/* ── 13 / 19: a family reaches its own report card and admit card ───────── */

describe('a family’s report card and admit card (findings 13, 19)', () => {
  test('a STUDENT’s report card: no staff read, no lock, their own card', async () => {
    const f = fakeAuth('student', familyRoutes(), 'me-1');
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
    kindHit('report_card').click();
    await settle();

    assert.equal(lock(), null, 'no refusal card');
    assert.ok(!f.urls.some((u) => u.startsWith('/api/v1/academics/hierarchy')),
      'the staff-only class tree is not read');
    assert.ok(!f.urls.some((u) => u.startsWith('/api/v1/academics/publish')),
      'the principal-level publish list is not read');
    assert.ok(f.urls.includes('/api/v1/academics/results'),
      'a student reads their own published results, without an id');
    assert.equal(root().querySelector('select[name="sectionId"]'), null, 'no section picker');
    assert.equal(root().querySelector('.doc-students'), null, 'no roster');

    const exam = root().querySelector<HTMLSelectElement>('select[name="examId"]')!;
    assert.ok(exam, 'the exam picker is offered');
    assert.deepEqual([...exam.options].map((o) => o.value), ['', 'ex-annual', 'ex-half']);
    choose(exam, 'ex-annual');
    primary()!.click();
    await settle();

    const req = f.urls.find((u) => u.startsWith('/api/v1/ops/document'))!;
    const q = new URLSearchParams(req.split('?')[1]);
    assert.equal(q.get('type'), 'report_card');
    assert.equal(q.get('examId'), 'ex-annual');
    assert.equal(q.get('studentIds'), 'me-1', 'the card is the student’s own');
    assert.ok(root().querySelector('iframe.doc-frame'), 'the preview is on screen');
    assert.equal(root().querySelector('.doc-count'), null,
      'no "১ জন নির্বাচিত" for a choice the family never made');
  });

  test('a GUARDIAN’s admit card: the wards, the school’s coming exams, one child', async () => {
    const f = fakeAuth('guardian', familyRoutes());
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
    kindHit('admit_card').click();
    await settle();

    assert.equal(lock(), null, 'no refusal card');
    assert.ok(f.urls.includes('/api/v1/academics/ward'), 'the guardian’s own children');
    const cal = f.urls.find((u) => u.startsWith('/api/v1/ops/calendar'));
    assert.ok(cal, 'the exam list comes from the calendar every member may read');
    const cq = new URLSearchParams(cal!.split('?')[1]);
    assert.equal(cq.get('kind'), 'exam');
    assert.match(cq.get('from') ?? '', /^\d{4}-\d{2}-\d{2}$/);
    assert.ok((cq.get('to') ?? '') > (cq.get('from') ?? ''), 'a range ahead of today');
    assert.ok(!f.urls.some((u) => u.startsWith('/api/v1/academics/hierarchy')));

    const tabs = [...root().querySelectorAll<HTMLButtonElement>('.doc-child [role="tab"]')];
    assert.equal(tabs.length, 2, 'both children named side by side');
    assert.equal(tabs[0].getAttribute('aria-selected'), 'true', 'the first child is chosen');

    const exam = root().querySelector<HTMLSelectElement>('select[name="examId"]')!;
    assert.deepEqual([...exam.options].map((o) => o.value), ['', 'ex-final'],
      'exam periods only — a single paper is not an exam');
    choose(exam, 'ex-final');
    primary()!.click();
    await settle();
    let q = new URLSearchParams(f.urls.filter((u) => u.startsWith('/api/v1/ops/document')).at(-1)!.split('?')[1]);
    assert.equal(q.get('type'), 'admit_card');
    assert.equal(q.get('examId'), 'ex-final');
    assert.equal(q.get('studentIds'), 'kid-a');

    // The other child: same exam list (the school's), their own card.
    root().querySelectorAll<HTMLButtonElement>('.doc-child [role="tab"]')[1].click();
    await settle();
    assert.equal(root().querySelector<HTMLSelectElement>('select[name="examId"]')!.value, 'ex-final',
      'an admit card’s exam stays chosen across children');
    generateBtn()!.click();
    await settle();
    q = new URLSearchParams(f.urls.filter((u) => u.startsWith('/api/v1/ops/document')).at(-1)!.split('?')[1]);
    assert.equal(q.get('studentIds'), 'kid-b');
  });

  test('a GUARDIAN’s report card reads the chosen child’s results, and again on a switch', async () => {
    const f = fakeAuth('guardian', familyRoutes());
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
    kindHit('report_card').click();
    await settle();
    assert.ok(f.urls.includes('/api/v1/academics/results?studentId=kid-a'));
    assert.equal(lock(), null);

    root().querySelectorAll<HTMLButtonElement>('.doc-child [role="tab"]')[1].click();
    await settle();
    assert.ok(f.urls.includes('/api/v1/academics/results?studentId=kid-b'),
      'the second child’s results, not the first child’s exams');
  });

  test('a guardian with ONE child is not asked to choose, but is told whose card it is', async () => {
    const f = fakeAuth('guardian', familyRoutes({
      '/api/v1/academics/ward': { wards: [WARDS[0]], student: null },
    }));
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
    kindHit('report_card').click();
    await settle();
    assert.equal(root().querySelector('.doc-child [role="tab"]'), null, 'no one-option control');
    assert.match(root().querySelector('.doc-child')?.textContent ?? '', /রাফি হাসান/);
  });

  test('no published result: the empty state, not a lock and not a primary', async () => {
    const f = fakeAuth('student', familyRoutes({ '/api/v1/academics/results': { results: [] } }));
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
    kindHit('report_card').click();
    await settle();
    assert.equal(lock(), null);
    assert.match(root().querySelector('.ui-state-empty, .ui-state')?.textContent ?? '',
      /প্রকাশিত ফলাফলসহ কোনো পরীক্ষা পাওয়া যায়নি/);
    assert.equal(primary(), null, 'nothing to preview');
  });

  test('the office still prints a section at a time (staff flow unchanged)', async () => {
    const f = fakeAuth('principal', {
      '/api/v1/academics/hierarchy': (url: string) => url.includes('sectionId')
        ? { status: 200, body: { roster: [{ studentId: 's1', rollNo: 1, nameBn: 'আয়শা' }] } }
        : { status: 200, body: TREE },
      '/api/v1/academics/publish': { exams: [{ examId: 'ex-1', examNameBn: 'বার্ষিক', status: 'published' }] },
    });
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ALL });
    kindHit('report_card').click();
    await settle();
    assert.ok(f.urls.includes('/api/v1/academics/hierarchy'));
    assert.ok(f.urls.includes('/api/v1/academics/publish'));
    assert.ok(!f.urls.some((u) => u.startsWith('/api/v1/academics/ward')));
    assert.ok(root().querySelector('select[name="sectionId"]'), 'the section picker is the office’s');
  });
});

const TREE = {
  classes: [{
    levelNo: 9, nameBn: 'নবম',
    groups: [{ groupBn: 'বিজ্ঞান', sections: [{ id: 'sec-a', name: 'ক', studentCount: 2 }] }],
  }],
};
const ROSTER = {
  roster: [
    { studentId: 's1', rollNo: 1, nameBn: 'আয়শা সিদ্দিকা' },
    { studentId: 's2', rollNo: 2, nameBn: 'তানভীর হাসান' },
  ],
};
function officeRoutes(extra: Record<string, Body> = {}): Record<string, Body> {
  return {
    '/api/v1/academics/hierarchy': (url: string) => url.includes('sectionId')
      ? { status: 200, body: ROSTER }
      : { status: 200, body: TREE },
    '/api/v1/academics/publish': { exams: [{ examId: 'ex-1', examNameBn: 'বার্ষিক', status: 'published' }] },
    '/api/v1/finance/receipts': { receipts: [
      { id: 'r1', receiptNo: 'RCP-2026-07-00012', amount: '1250.00', issuedAt: '2026-07-08T10:12:00Z' },
      { id: 'r2', receiptNo: 'RCP-2026-07-00013', amount: '900.00', issuedAt: '2026-07-09T10:12:00Z' },
    ] },
    '/api/v1/ops/document': DOC_OK,
    ...extra,
  };
}

/* ── 24: focus is never left on <body> after an action ──────────────────── */

describe('focus after an action (finding 24)', () => {
  test('choosing a document puts focus on that document’s first choice', async () => {
    const f = fakeAuth('student', familyRoutes());
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
    const row = kindHit('report_card');
    row.focus();
    row.click();
    await settle();
    assert.notEqual(active(), doc().body, 'focus fell to <body>');
    assert.equal(active(), root().querySelector('select[name="examId"]'),
      'focus is on the exam picker the row led to');
  });

  test('an empty receipt step puts focus on its way on', async () => {
    const f = fakeAuth('accountant', officeRoutes({ '/api/v1/finance/receipts': { receipts: [] } }));
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ['fee_receipt'] });
    const row = kindHit('fee_receipt');
    row.focus();
    row.click();
    await settle();
    assert.equal(active()?.textContent, 'অন্য নথি বেছে নিন');
  });

  test('a refusal puts focus on the document list shown under it, never <body>', async () => {
    const f = fakeAuth('principal', officeRoutes({ '/api/v1/academics/hierarchy': STAFF_ONLY }));
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ALL });
    const row = kindHit('id_card');
    row.focus();
    row.click();
    await settle();
    assert.ok(lock());
    assert.ok(active()?.closest('.doc-kinds'), 'focus is on a document row');
  });

  test('going back puts focus on the document that was open', async () => {
    const f = fakeAuth('principal', officeRoutes());
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ALL });
    kindHit('id_card').click();
    await settle();
    const crumb = root().querySelector<HTMLButtonElement>('.ui-crumb button, .ui-crumb-link')!;
    crumb.focus();
    crumb.click();
    await settle();
    assert.equal(active(), kindHit('id_card'), 'back on the পরিচয়পত্র row');
  });

  test('a finished preview puts focus on ছাপুন and says so', async () => {
    const f = fakeAuth('accountant', officeRoutes());
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ['fee_receipt'] });
    kindHit('fee_receipt').click();
    await settle();
    root().querySelector<HTMLButtonElement>('.doc-receipts .ui-list-hit')!.click();
    const btn = generateBtn()!;
    btn.focus();
    btn.click();
    await settle();
    assert.equal(active()?.getAttribute('data-focus-key'), 'doc-print', 'focus is on ছাপুন');
    const said = [...doc().querySelectorAll('[role="status"]')].map((n) => n.textContent);
    assert.ok(said.some((t) => /নথি তৈরি হয়েছে/.test(t ?? '')), 'the success is announced');
  });

  test('focus the person moved elsewhere while loading is left alone', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const f = fakeAuth('accountant', officeRoutes());
    const slow = {
      ...(f.auth as object),
      role: 'accountant',
      authedFetch: async (url: string) => { await gate; return (f.auth as { authedFetch: (u: string) => Promise<Response> }).authedFetch(url); },
    };
    new DocumentsView({ root: root(), doc: doc(), auth: slow as never, allowed: ['fee_receipt'] });
    const row = kindHit('fee_receipt');
    row.focus();
    row.click();
    const elsewhere = doc().getElementById('elsewhere') as HTMLButtonElement;
    elsewhere.focus();
    release();
    await settle();
    assert.equal(active(), elsewhere);
  });

  describe('inside the shell’s focus keeper', () => {
    test('focus the keeper parked on the view during loading still reaches the new step', async () => {
      const stop = keepFocusWithin(root());
      const f = fakeAuth('student', familyRoutes());
      new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
      const row = kindHit('report_card');
      row.focus();
      row.click();
      await settle();
      assert.notEqual(active(), root(), 'not left parked on the view');
      assert.equal(active(), root().querySelector('select[name="examId"]'));
      stop();
    });

    test('switching child keeps focus on the child strip while that child’s exams load', async () => {
      const stop = keepFocusWithin(root());
      const f = fakeAuth('guardian', familyRoutes());
      new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
      kindHit('report_card').click();
      await settle();
      const second = root().querySelectorAll<HTMLButtonElement>('.doc-child [role="tab"]')[1];
      second.focus();
      second.click();
      await settle();
      assert.equal(active()?.getAttribute('data-id'), 'kid-b', 'on the chosen child');
      assert.equal(active()?.getAttribute('aria-selected'), 'true');
      stop();
    });

    test('ticking a student keeps focus on that student’s box', async () => {
      const stop = keepFocusWithin(root());
      const f = fakeAuth('principal', officeRoutes());
      new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ALL });
      kindHit('id_card').click();
      await settle();
      const section = root().querySelector<HTMLSelectElement>('select[name="sectionId"]')!;
      section.focus();
      choose(section, 'sec-a');
      await settle();
      assert.equal(active(), root().querySelector('select[name="sectionId"]'),
        'the section select keeps focus through the roster’s skeleton');
      const box = root().querySelector<HTMLInputElement>('[data-student-id="s2"] input')!;
      box.focus();
      box.click();
      await settle();
      assert.equal(active(), root().querySelector('[data-student-id="s2"] input'));
      assert.equal((active() as HTMLInputElement).checked, false, 'unticked');
      stop();
    });

    test('the select-all button keeps focus although its label flips', async () => {
      const stop = keepFocusWithin(root());
      const f = fakeAuth('principal', officeRoutes());
      new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ALL });
      kindHit('id_card').click();
      await settle();
      choose(root().querySelector<HTMLSelectElement>('select[name="sectionId"]')!, 'sec-a');
      await settle();
      const all = root().querySelector<HTMLButtonElement>('[data-focus-key="doc-select-all"]')!;
      const before = all.textContent;
      all.focus();
      all.click();
      await settle();
      assert.notEqual(active()?.textContent, before, 'the label flipped');
      assert.equal(active()?.getAttribute('data-focus-key'), 'doc-select-all');
      stop();
    });

    test('a finished preview still lands on ছাপুন with the keeper armed', async () => {
      const stop = keepFocusWithin(root());
      const f = fakeAuth('accountant', officeRoutes());
      new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ['fee_receipt'] });
      kindHit('fee_receipt').click();
      await settle();
      const receipt = root().querySelector<HTMLButtonElement>('.doc-receipts .ui-list-hit')!;
      receipt.focus();
      receipt.click();
      await settle();
      const btn = generateBtn()!;
      btn.focus();
      btn.click();
      await settle();
      assert.equal(active()?.getAttribute('data-focus-key'), 'doc-print',
        'not taken back to "আবার তৈরি করুন" by the keeper');
      stop();
    });

    test('a pressed preview with a choice missing keeps focus on its button', async () => {
      const stop = keepFocusWithin(root());
      const f = fakeAuth('principal', officeRoutes());
      new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ALL });
      kindHit('fee_receipt').click();
      await settle();
      const btn = previewByText()!;
      btn.focus();
      btn.click();
      await settle();
      assert.ok(root().querySelector('.doc-actions [role="alert"]'), 'the missing choice is said');
      assert.equal(active(), previewByText(), 'focus is on the rebuilt preview button');
      stop();
    });
  });
});

/* ── minors 11, 21, 32, 58: empty steps and missing choices ─────────────── */

describe('empty steps and missing choices (minors 11, 21, 32, 58)', () => {
  test('no receipts: the empty state, and no পূর্বরূপ দেখুন under it', async () => {
    const f = fakeAuth('guardian', familyRoutes({ '/api/v1/finance/receipts': { receipts: [] } }));
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
    kindHit('fee_receipt').click();
    await settle();
    assert.match(root().textContent ?? '', /এখনো কোনো পরিশোধের রসিদ নেই/);
    assert.equal(previewByText(), null);
  });

  test('a receipt not yet chosen is said beside the button, with no retry card', async () => {
    const f = fakeAuth('accountant', officeRoutes());
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ['fee_receipt'] });
    kindHit('fee_receipt').click();
    await settle();
    generateBtn()!.click();
    await settle();
    const msg = root().querySelector('.doc-actions [role="alert"]');
    assert.equal(msg?.textContent, 'একটি রসিদ বেছে নিন।');
    assert.equal(root().querySelector('.ui-state-error'), null, 'not a load failure');
    assert.ok(!f.urls.some((u) => u.startsWith('/api/v1/ops/document')), 'nothing was requested');

    root().querySelector<HTMLButtonElement>('.doc-receipts .ui-list-hit')!.click();
    assert.equal(root().querySelector('.doc-actions [role="alert"]'), null,
      'choosing clears the message');
  });

  test('report cards with no published exam: no section picker and no primary', async () => {
    const f = fakeAuth('principal', officeRoutes({
      '/api/v1/academics/publish': { exams: [{ examId: 'ex-1', examNameBn: 'বার্ষিক', status: 'draft' }] },
    }));
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ALL });
    kindHit('report_card').click();
    await settle();
    assert.match(root().textContent ?? '', /প্রকাশিত ফলাফলসহ কোনো পরীক্ষা পাওয়া যায়নি/,
      'an unpublished-only list is empty, not a select holding "বেছে নিন…"');
    assert.equal(root().querySelector('select[name="examId"]'), null);
    assert.equal(root().querySelector('select[name="sectionId"]'), null);
    assert.equal(previewByText(), null);
  });

  test('a section chosen for one document is not left filled in for the next', async () => {
    const f = fakeAuth('principal', officeRoutes());
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ALL });
    kindHit('id_card').click();
    await settle();
    choose(root().querySelector<HTMLSelectElement>('select[name="sectionId"]')!, 'sec-a');
    await settle();
    root().querySelector<HTMLButtonElement>('.ui-crumb button, .ui-crumb-link')!.click();
    kindHit('attendance_sheet').click();
    await settle();
    assert.equal(root().querySelector<HTMLSelectElement>('select[name="sectionId"]')!.value, '');
    generateBtn()!.click();
    await settle();
    assert.ok(!f.urls.some((u) => u.startsWith('/api/v1/ops/document')),
      'no section is sent that the select does not show');
  });

  test('a family’s list that never arrived: the retry, not "no child is linked to you"', async () => {
    let down = true;
    const f = fakeAuth('guardian', familyRoutes({
      '/api/v1/academics/ward': () => down
        ? { status: 503, body: { error: 'unavailable' } }
        : { status: 200, body: { wards: WARDS, student: null } },
    }));
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: FAMILY });
    const row = kindHit('report_card');
    row.focus();
    row.click();
    await settle();

    const failed = root().querySelector('.ui-state-error');
    assert.match(failed?.textContent ?? '', /তালিকা আনা যায়নি/);
    assert.equal(lock(), null, 'a failed read is not a refusal');
    assert.doesNotMatch(root().textContent ?? '', /কোনো শিক্ষার্থী যুক্ত নেই/,
      'an offline parent is not told they have no child');
    assert.doesNotMatch(root().textContent ?? '', /কোনো পরীক্ষা পাওয়া যায়নি/);
    assert.equal(previewByText(), null);
    assert.equal(active(), root().querySelector('.ui-state-error .ui-state-action'),
      'focus is on the retry');

    down = false;
    (active() as HTMLButtonElement).click();
    await settle();
    assert.equal(root().querySelector('.ui-state-error'), null);
    assert.ok(root().querySelector('select[name="examId"]'), 'the step is back once the list arrives');
  });

  test('the office’s list that never arrived: no "কোনো শাখা তৈরি হয়নি" under the error', async () => {
    const f = fakeAuth('principal', officeRoutes({
      '/api/v1/academics/hierarchy': () => ({ status: 500, body: {} }),
    }));
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ALL });
    kindHit('id_card').click();
    await settle();
    assert.ok(root().querySelector('.ui-state-error'));
    assert.doesNotMatch(root().textContent ?? '', /কোনো শাখা তৈরি হয়নি/);
    assert.equal(root().querySelector('select[name="sectionId"]'), null);
    assert.equal(previewByText(), null, 'no preview of a list nobody read');
  });

  test('a failed preview’s retry makes the preview again, keeping the choices', async () => {
    let fail = true;
    const f = fakeAuth('accountant', officeRoutes({
      '/api/v1/ops/document': () => fail
        ? { status: 500, body: { message: 'নথি তৈরি করা যায়নি।' } }
        : { status: 200, html: '<p>নথি</p>' },
    }));
    new DocumentsView({ root: root(), doc: doc(), auth: f.auth, allowed: ['fee_receipt'] });
    kindHit('fee_receipt').click();
    await settle();
    root().querySelectorAll<HTMLButtonElement>('.doc-receipts .ui-list-hit')[1].click();
    generateBtn()!.click();
    await settle();
    const receiptsRead = f.urls.filter((u) => u.startsWith('/api/v1/finance/receipts')).length;

    fail = false;
    root().querySelector<HTMLButtonElement>('.ui-state-error .ui-state-action')!.click();
    await settle();
    assert.equal(f.urls.filter((u) => u.startsWith('/api/v1/finance/receipts')).length, receiptsRead,
      'the lists are not read again');
    const last = f.urls.filter((u) => u.startsWith('/api/v1/ops/document')).at(-1)!;
    assert.equal(new URLSearchParams(last.split('?')[1]).get('receiptId'), 'r2',
      'the receipt chosen before the failure');
    assert.ok(root().querySelector('iframe.doc-frame'));
  });
});
