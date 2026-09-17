/**
 * UX fixes, group "demo" — the public preview's in-page API (src/demo.ts).
 *
 * `/demo` is how a school tries the product, and every screen in it talks to
 * DemoAuth.authedFetch instead of a server. The sweep found screens in a
 * role's own sidebar that could only ever show "আনা যায়নি" (the endpoint
 * fell through to the 404 default), and writes answered with a read's shape
 * so the screen reported a failure — or crashed — on a correct action.
 *
 * Every test drives DemoAuth exactly as a screen does and checks the answer
 * against the SHAPE the real service returns (services/*\/api), because that
 * shape is what the screens parse. Where a screen is cheap to mount, it is
 * mounted too, and the test asks for its data rather than its error state.
 *
 *   0, 3, 5, 11  /ops/notices?preview=1 answered with the publish reply
 *   10           /academics/assignments POST (a grade) answered with the list
 *   13           /ops/document for a family's own report card
 *   15           chapter subject ids never matched আমার বিষয়
 *   31           /finance/payments had no case
 *   35           /finance/feestructures had no case
 *   45           /auth/activate had no case
 *   46           rollover summary typed beside rows that disagreed with it
 *   47, 63       /rms/rooms, /ops/staff-attendance, /auth/sessions, /ops/push
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom: JSDOM;
// Imported after the globals exist: demo.ts reads `location` and
// `localStorage` when a request is answered.
let DemoAuth: typeof import('../src/demo.ts').DemoAuth;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost/demo' });
  const g = globalThis as Record<string, unknown>;
  g.location = dom.window.location;
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.Event = dom.window.Event;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.document = dom.window.document;
  g.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  ({ DemoAuth } = await import('../src/demo.ts'));
});

beforeEach(() => {
  dom.window.document.body.innerHTML = '<div id="root"></div>';
});

/** The demo as `role`, the way the role picker leaves it (no ?role= in the URL). */
function as(role: string) {
  dom.window.localStorage.setItem('shikhon_demo_role', role);
  return new DemoAuth();
}

async function call(role: string, path: string, init: RequestInit = {}) {
  const res = await as(role).authedFetch(path, init);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* HTML documents */ }
  return { status: res.status, ok: res.ok, body };
}

const post = (body: unknown, method = 'POST'): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = () => dom.window.document.getElementById('root') as HTMLElement;

/* ── 0, 3, 5, 11: the notice estimate ──────────────────────────────────── */

describe('notices — the estimate has the service’s shape (findings 0, 3, 5, 11)', () => {
  test('?preview=1 answers every figure the composer reads, as numbers and a boolean', async () => {
    const r = await call('class_teacher', '/api/v1/ops/notices?preview=1', post({
      audience: { type: 'section', ids: ['demo-9a'] },
      title: 'আগামীকাল ছুটি', body: 'ঈদের কারণে বিদ্যালয় বন্ধ থাকবে।', sendSms: true,
    }));
    assert.equal(r.status, 200);
    for (const k of ['recipients', 'smsRecipients', 'segmentsEach', 'segmentsTotal', 'confirmThreshold']) {
      assert.equal(typeof r.body[k], 'number', `${k} must be a number, got ${JSON.stringify(r.body[k])}`);
    }
    assert.equal(typeof r.body.needsConfirmation, 'boolean');
    assert.equal(r.body.noticeId, undefined, 'the estimate is not a publish');
    assert.equal(r.body.segmentsTotal, r.body.smsRecipients * r.body.segmentsEach);
    assert.equal(r.body.confirmThreshold, 200);
    assert.equal(r.body.needsConfirmation, false, 'one section never crosses the gate');
    assert.ok(r.body.recipients > 0);
  });

  test('segments count the SENT message — title and school name included — and SMS off texts nobody', async () => {
    const off = await call('principal', '/api/v1/ops/notices?preview=1', post({
      audience: { type: 'guardians' }, title: 'ক', body: 'খ', sendSms: false,
    }));
    assert.equal(off.body.smsRecipients, 0);
    assert.equal(off.body.segmentsTotal, 0);
    assert.equal(off.body.needsConfirmation, false);

    // 60 Bangla characters: one segment on its own, two once "title: … — school" is added.
    const body = 'ক'.repeat(60);
    const on = await call('principal', '/api/v1/ops/notices?preview=1', post({
      audience: { type: 'guardians' }, title: 'নোটিশ', body, sendSms: true,
    }));
    assert.equal(on.body.segmentsEach, 2);
    assert.ok(on.body.segmentsTotal > 200 && on.body.needsConfirmation === true,
      'all guardians with SMS on reaches the 200+ gate, so the preview can show it');
  });

  test('publishing answers 201 with a reach, a class teacher is held to sections, a student is refused', async () => {
    const draft = { title: 'অভিভাবক সভা', body: 'শনিবার সকাল ১০টায়।', category: 'general',
      audience: { type: 'guardians' }, sendSms: true };
    const sent = await call('principal', '/api/v1/ops/notices', post({ notice: draft, publish: true }));
    assert.equal(sent.status, 201);
    assert.equal(sent.body.status, 'published');
    assert.equal(typeof sent.body.recipients, 'number');
    assert.ok(sent.body.recipients > 0);
    assert.equal(sent.body.smsQueued, true);

    const wide = await call('class_teacher', '/api/v1/ops/notices',
      post({ notice: { ...draft, audience: { type: 'all' } }, publish: true }));
    assert.equal(wide.status, 403);
    assert.equal(wide.body.error, 'audience_not_permitted');

    const later = await call('principal', '/api/v1/ops/notices', post({
      notice: { ...draft, audience: { type: 'all' } }, publish: true,
      publishAt: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    assert.equal(later.body.status, 'scheduled');
    assert.equal(later.body.recipients, 0, 'a scheduled notice has reached nobody yet');

    const bad = await call('principal', '/api/v1/ops/notices',
      post({ notice: { ...draft, title: '' }, publish: true }));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.field, 'title');

    const student = await call('student', '/api/v1/ops/notices?preview=1', post({ title: 'x', body: 'y' }));
    assert.equal(student.status, 403);
  });

  test('the composer, mounted on the demo, keeps the form, counts, and enables Send', async () => {
    const { NoticeComposeView } = await import('../src/notice-compose-view.ts');
    const errors: unknown[] = [];
    dom.window.addEventListener('error', (e) => { errors.push(e.error ?? e.message); e.preventDefault(); });
    const d = dom.window.document;
    new NoticeComposeView({ root: root(), doc: d, auth: as('principal') } as never);
    await wait(50);
    const title = root().querySelector<HTMLInputElement>('input[name="title"]')!;
    const body = root().querySelector<HTMLTextAreaElement>('textarea[name="body"]')!;
    assert.ok(title && body, 'the form is drawn');
    title.value = 'আগামীকাল ছুটি';
    title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    body.value = 'ঈদের কারণে বিদ্যালয় বন্ধ থাকবে।';
    body.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(900);   // past the 400 ms debounce and the estimate

    assert.ok(root().querySelector('textarea[name="body"]'), 'the form was not wiped by the estimate');
    assert.equal(root().querySelector<HTMLTextAreaElement>('textarea[name="body"]')!.value,
      'ঈদের কারণে বিদ্যালয় বন্ধ থাকবে।');
    const recipients = root().querySelector('[data-estimate-recipients]');
    assert.ok(recipients && recipients.textContent !== '—', 'the estimate reached the screen');
    const send = root().querySelector<HTMLButtonElement>('[data-send]');
    assert.ok(send && !send.disabled, 'Send is usable with a title and a body for the whole school');
    assert.deepEqual(errors, []);
  });
});

/* ── 10: grading homework ──────────────────────────────────────────────── */

describe('assignments — a grade is saved, versioned and shown (finding 10)', () => {
  test('the detail carries rowVersion, and a grade with it saves and holds', async () => {
    const detail = await call('class_teacher', '/api/v1/academics/assignments?assignmentId=demo-a-1');
    const sub = detail.body.submissions[0];
    assert.equal(Number.isInteger(sub.rowVersion), true, 'rowVersion is what the screen sends back');
    assert.ok('gradedByName' in sub);
    const before = (await call('class_teacher', '/api/v1/academics/assignments')).body
      .assignments.find((a: any) => a.id === 'demo-a-1').ungradedCount;

    const saved = await call('class_teacher', '/api/v1/academics/assignments', post({
      submissionId: sub.id, marksAwarded: 8, feedbackBn: 'ভালো', rowVersion: sub.rowVersion,
    }));
    assert.equal(saved.status, 200);
    assert.equal(saved.body.ok, true, 'the screen reports success only on ok: true');
    assert.equal(saved.body.rowVersion, sub.rowVersion + 1);

    const again = await call('class_teacher', '/api/v1/academics/assignments?assignmentId=demo-a-1');
    const now = again.body.submissions.find((s: any) => s.id === sub.id);
    assert.equal(now.marksAwarded, '8.00');
    assert.ok(now.gradedAt);
    const after = (await call('class_teacher', '/api/v1/academics/assignments')).body
      .assignments.find((a: any) => a.id === 'demo-a-1').ungradedCount;
    assert.equal(after, before - 1);
  });

  test('the service’s refusals: stale version, over the maximum, no version, not staff', async () => {
    const detail = await call('class_teacher', '/api/v1/academics/assignments?assignmentId=demo-a-1');
    const sub = detail.body.submissions[1];
    const stale = await call('class_teacher', '/api/v1/academics/assignments',
      post({ submissionId: sub.id, marksAwarded: 5, rowVersion: sub.rowVersion + 3 }));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'grade_conflict');
    assert.equal(stale.body.conflict.currentRowVersion, sub.rowVersion);

    const over = await call('class_teacher', '/api/v1/academics/assignments',
      post({ submissionId: sub.id, marksAwarded: 11, rowVersion: sub.rowVersion }));
    assert.equal(over.status, 422);
    assert.equal(over.body.error, 'marks_exceed_max');

    const bare = await call('class_teacher', '/api/v1/academics/assignments',
      post({ submissionId: sub.id, marksAwarded: 5 }));
    assert.equal(bare.body.error, 'row_version_required');

    const student = await call('student', '/api/v1/academics/assignments',
      post({ submissionId: sub.id, marksAwarded: 5, rowVersion: 1 }));
    assert.equal(student.status, 403);
  });

  test('a student sees only their own submission', async () => {
    const r = await call('student', '/api/v1/academics/assignments?assignmentId=demo-a-2');
    assert.ok(r.body.submissions.length > 0);
    assert.ok(r.body.submissions.every((s: any) => s.studentId === 'demo-user'));
  });
});

/* ── 31: the office counter ────────────────────────────────────────────── */

describe('payments — the counter sheet opens and a payment holds (finding 31)', () => {
  test('GET answers the invoice, the methods and the receipts, as numbers', async () => {
    const r = await call('accountant', '/api/v1/finance/payments?invoiceId=demo-inv-1');
    assert.equal(r.status, 200);
    assert.equal(r.body.canCollect, true);
    assert.equal(typeof r.body.invoice.balanceAmount, 'number');
    assert.equal(r.body.invoice.balanceAmount, 1250);
    assert.ok(r.body.invoice.studentBn, 'the sheet names who is paying');
    assert.ok(r.body.methods.some((m: any) => m.code === 'cash' && m.labelBn));
    assert.ok(Array.isArray(r.body.receipts));
  });

  test('a part payment issues a receipt, and the list, the sheet and the receipts agree', async () => {
    const paid = await call('accountant', '/api/v1/finance/payments',
      post({ invoiceId: 'demo-inv-1', amount: 500, method: 'cash' }));
    assert.equal(paid.status, 200);
    assert.equal(paid.body.ok, true);
    assert.match(paid.body.receiptNo, /^RCP-\d{4}-\d{2}-\d{5}$/);
    assert.equal(paid.body.invoiceStatus, 'partly_paid');

    const list = await call('accountant', '/api/v1/finance/invoices');
    const inv = list.body.invoices.find((i: any) => i.id === 'demo-inv-1');
    assert.equal(inv.balanceAmount, '750.00');
    assert.equal(inv.status, 'partly_paid');
    const sheet = await call('accountant', '/api/v1/finance/payments?invoiceId=demo-inv-1');
    assert.equal(sheet.body.invoice.balanceAmount, 750);
    assert.ok(sheet.body.receipts.some((x: any) => x.receiptNo === paid.body.receiptNo));
    const receipts = await call('guardian', '/api/v1/finance/receipts?invoiceId=demo-inv-1');
    assert.ok(receipts.body.receipts.some((x: any) => x.receiptNo === paid.body.receiptNo));

    const over = await call('accountant', '/api/v1/finance/payments',
      post({ invoiceId: 'demo-inv-1', amount: 1000, method: 'cash' }));
    assert.equal(over.status, 409);
    assert.equal(over.body.error, 'over_payment');
    assert.equal(over.body.field, 'amount');
  });

  test('the counter is the money roles’ only', async () => {
    assert.equal((await call('student', '/api/v1/finance/payments?invoiceId=demo-inv-1')).status, 403);
    assert.equal((await call('it_admin', '/api/v1/finance/payments?invoiceId=demo-inv-1')).status, 403);
  });

  test('bills carry their child, a family sees its own, and the guardian panel counts from them', async () => {
    const all = await call('accountant', '/api/v1/finance/invoices');
    assert.ok(all.body.invoices.every((i: any) => typeof i.studentId === 'string'));
    const student = await call('student', '/api/v1/finance/invoices');
    assert.ok(student.body.invoices.every((i: any) => i.studentId === 'demo-s1'));
    for (const id of ['demo-s1', 'demo-s2']) {
      const bills = await call('guardian', `/api/v1/finance/invoices?studentId=${id}`);
      const due = bills.body.invoices.reduce((s: number, i: any) => s + Number(i.balanceAmount), 0);
      const home = await call('guardian', `/api/v1/academics/ward?studentId=${id}`);
      assert.equal(home.body.student.fees.outstanding, due, `${id}: the panel and the fee screen agree`);
    }
  });
});

/* ── 35: the price list ────────────────────────────────────────────────── */

describe('fee structures — the price list and its writes (finding 35)', () => {
  test('GET answers the Body the screen parses', async () => {
    const r = await call('accountant', '/api/v1/finance/feestructures');
    assert.equal(r.status, 200);
    assert.equal(r.body.canManage, true);
    assert.equal(typeof r.body.academicYearId, 'string');
    assert.ok(r.body.years.length && r.body.classes.length && r.body.heads.length);
    assert.ok(r.body.structures.length > 0);
    const s = r.body.structures[0];
    for (const k of ['id', 'feeHeadId', 'headBn', 'headCode', 'frequency', 'headActive', 'classId',
      'classBn', 'amount', 'lateFeePerDay', 'lateFeeCap', 'dueDayOfMonth', 'billedByMonthlyRun']) {
      assert.ok(k in s, `structure.${k}`);
    }
    assert.ok(r.body.structures.some((x: any) => x.billedByMonthlyRun === false),
      'a non-monthly head, so the "not billed by the monthly run" note is reachable');
    assert.equal((await call('class_teacher', '/api/v1/finance/feestructures')).body.canManage, false);
    assert.equal((await call('guardian', '/api/v1/finance/feestructures')).status, 403);
  });

  test('create, refuse a duplicate, change, remove — each visible on the next read', async () => {
    const created = await call('accountant', '/api/v1/finance/feestructures', post({
      feeHeadId: 'demo-fh-library', academicYearId: 'demo-year', classId: 'demo-cls-9sci',
      amount: 400, dueDayOfMonth: 15,
    }));
    assert.equal(created.status, 200);
    assert.equal(created.body.headBn, 'গ্রন্থাগার ফি');
    const id = created.body.id;
    const listed = (await call('accountant', '/api/v1/finance/feestructures')).body.structures;
    assert.ok(listed.some((x: any) => x.id === id && x.amount === 400 && x.classBn === 'নবম শ্রেণি'));

    const dup = await call('accountant', '/api/v1/finance/feestructures', post({
      feeHeadId: 'demo-fh-library', academicYearId: 'demo-year', classId: 'demo-cls-9sci', amount: 1,
    }));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.field, 'feeHeadId');

    const bad = await call('accountant', '/api/v1/finance/feestructures', post({ id, dueDayOfMonth: 31 }, 'PATCH'));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.field, 'dueDayOfMonth');

    const changed = await call('accountant', '/api/v1/finance/feestructures', post({ id, amount: 450 }, 'PATCH'));
    assert.equal(changed.body.amount, 450);
    const kept = (await call('accountant', '/api/v1/finance/feestructures')).body.structures
      .find((x: any) => x.id === id);
    assert.equal(kept.dueDayOfMonth, 15, 'PATCH carries the unnamed fields across');

    const gone = await call('accountant', `/api/v1/finance/feestructures?id=${id}`, { method: 'DELETE' });
    assert.equal(gone.body.issuedInvoicesUnaffected, true);
    assert.ok(!(await call('accountant', '/api/v1/finance/feestructures')).body.structures
      .some((x: any) => x.id === id));

    const teacher = await call('class_teacher', '/api/v1/finance/feestructures', post({
      feeHeadId: 'demo-fh-exam', academicYearId: 'demo-year', amount: 1,
    }));
    assert.equal(teacher.status, 403);
  });

  test('the screen, mounted on the demo, draws the list and no error', async () => {
    const { FeeStructuresView } = await import('../src/fee-structures-view.ts');
    new FeeStructuresView({ root: root(), doc: dom.window.document, auth: as('accountant') } as never);
    await wait(80);
    assert.equal(root().querySelector('.ui-state-error'), null, root().textContent ?? '');
    assert.match(root().textContent ?? '', /মাসিক বেতন/);
  });
});

/* ── 45: activation codes ──────────────────────────────────────────────── */

describe('activation codes — issued where the service issues them (finding 45)', () => {
  test('a principal gets a code; an IT admin is refused as the service refuses', async () => {
    const r = await call('principal', '/api/v1/auth/activate', post({ action: 'issue', userId: 'demo-t2' }));
    assert.equal(r.status, 200);
    assert.match(r.body.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ2345678]{8}$/);
    assert.ok(Date.parse(r.body.expiresAt) > Date.now());

    const it = await call('it_admin', '/api/v1/auth/activate', post({ action: 'issue', userId: 'demo-t2' }));
    assert.equal(it.status, 403);
    assert.equal(it.body.error, 'forbidden');
  });

  test('a class teacher issues for their roster’s children, not for a colleague', async () => {
    const mine = await call('class_teacher', '/api/v1/auth/activate', post({ action: 'issue', userId: 'demo-9a-s3' }));
    assert.equal(mine.status, 200);
    assert.ok(mine.body.code);
    const other = await call('class_teacher', '/api/v1/auth/activate', post({ action: 'issue', userId: 'demo-t2' }));
    assert.equal(other.status, 403);
    assert.equal(other.body.error, 'not_your_student');
  });
});

/* ── 46: rollover counts ───────────────────────────────────────────────── */

describe('rollover — one set of rows, one set of counts (finding 46)', () => {
  test('the summary is exactly what the rows say, and the graduating class is one class', async () => {
    const r = await call('it_admin', '/api/v1/ops/rollover');
    const rows = r.body.students as Array<{ action: string; fromLevel: number }>;
    const count = (a: string) => rows.filter((x) => x.action === a).length;
    assert.deepEqual(r.body.summary, {
      considered: rows.length, promote: count('promote'), repeat: count('repeat'),
      graduate: count('graduate'), blocked: count('blocked'),
    });
    assert.ok(r.body.summary.blocked > 0, 'a blocked child, so the refusal is demonstrable');
    assert.equal(new Set(rows.filter((x) => x.action === 'graduate').map((x) => x.fromLevel)).size, 1,
      'the checklist can name the class that graduates');
    assert.ok(rows.filter((x) => x.action === 'blocked').every((x: any) => x.blockerBn));
  });

  test('a saved plan is there on the next read, and commit refuses while anyone is blocked', async () => {
    assert.equal((await call('principal', '/api/v1/ops/rollover')).body.existing, null);
    const plan = await call('principal', '/api/v1/ops/rollover',
      post({ fromYearId: 'demo-year', toYearId: 'demo-year-next' }));
    assert.equal(plan.body.status, 'planned');
    const read = await call('principal', '/api/v1/ops/rollover');
    assert.equal(read.body.existing.status, 'planned');
    assert.deepEqual(read.body.existing.planned, read.body.summary);
    const commit = await call('principal', '/api/v1/ops/rollover', post({ rolloverId: plan.body.rolloverId }));
    assert.equal(commit.status, 409);
    assert.equal(commit.body.error, 'rollover_refused');
    assert.equal((await call('it_admin', '/api/v1/ops/rollover', post({ rolloverId: 'x' }))).status, 403);
  });
});

/* ── 47, 63: the screens that only showed "আনা যায়নি" ──────────────────── */

describe('rooms (findings 47, 63)', () => {
  test('GET answers the Body; writes hold; the office roles only', async () => {
    const r = await call('it_admin', '/api/v1/rms/rooms');
    assert.equal(r.status, 200);
    assert.equal(r.body.canManage, true);
    assert.ok(r.body.capabilityOptions.includes('physics_lab'));
    const room = r.body.rooms[0];
    for (const k of ['id', 'code', 'nameBn', 'building', 'floorNo', 'capacity', 'capabilities',
      'isBookable', 'homeSections', 'slotCount', 'hallCount']) assert.ok(k in room, `room.${k}`);
    assert.ok(r.body.rooms.some((x: any) => !x.isBookable), 'an out-of-service room');
    assert.equal((await call('class_teacher', '/api/v1/rms/rooms')).body.canManage, false);
    assert.equal((await call('student', '/api/v1/rms/rooms')).status, 403);

    const made = await call('principal', '/api/v1/rms/rooms',
      post({ code: '৪০১', capacity: 50, capabilities: ['computer'] }));
    assert.equal(made.body.code, '৪০১');
    const dup = await call('principal', '/api/v1/rms/rooms', post({ code: '৪০১' }));
    assert.equal(dup.status, 409);
    const lab = r.body.rooms.find((x: any) => x.capabilities.includes('physics_lab'));
    const closed = await call('principal', '/api/v1/rms/rooms', post({ id: lab.id, isBookable: false }, 'PATCH'));
    assert.equal(closed.body.isBookable, false);
    assert.deepEqual(closed.body.capabilities, lab.capabilities, 'closing a lab keeps its lab flag');
    assert.equal((await call('class_teacher', '/api/v1/rms/rooms', post({ code: 'x' }))).status, 403);
  });

  test('the screen, mounted on the demo, draws rooms and no error', async () => {
    const { RoomsView } = await import('../src/rooms-view.ts');
    new RoomsView({ root: root(), doc: dom.window.document, auth: as('principal') } as never);
    await wait(80);
    assert.equal(root().querySelector('.ui-state-error'), null, root().textContent ?? '');
    assert.match(root().textContent ?? '', /১০১/);
  });
});

describe('teachers’ register (finding 47)', () => {
  test('GET answers the register; a mark holds; marking is the office’s', async () => {
    const date = '2026-09-14';   // a Monday, in the past
    const r = await call('principal', `/api/v1/ops/staff-attendance?date=${date}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.date, date);
    assert.equal(r.body.canMark, true);
    assert.equal(r.body.total, r.body.teachers.length);
    assert.ok(r.body.total > 0);
    assert.equal(r.body.marked, r.body.teachers.filter((t: any) => t.status !== null).length);
    const t = r.body.teachers[0];
    for (const k of ['teacherId', 'name', 'roleCode', 'status', 'reason', 'markedAt', 'markedBy']) {
      assert.ok(k in t, `teacher.${k}`);
    }

    const mark = await call('principal', '/api/v1/ops/staff-attendance',
      post({ teacherId: t.teacherId, date, status: 'absent', reason: 'জরুরি কাজ' }));
    assert.equal(mark.body.status, 'absent');
    assert.equal(mark.body.nameBn, t.name.bn);
    const again = await call('principal', `/api/v1/ops/staff-attendance?date=${date}`);
    assert.equal(again.body.teachers.find((x: any) => x.teacherId === t.teacherId).status, 'absent');

    const teacher = await call('class_teacher', '/api/v1/ops/staff-attendance',
      post({ teacherId: t.teacherId, status: 'present' }));
    assert.equal(teacher.status, 403);
    assert.equal((await call('class_teacher', '/api/v1/ops/staff-attendance')).body.canMark, false);
  });
});

describe('sessions and push (finding 47)', () => {
  test('sessions list this device as current, and revoking removes the others', async () => {
    const auth = as('guardian');
    const q = `/api/v1/auth/sessions?deviceId=${encodeURIComponent(auth.deviceId)}`;
    const r = await call('guardian', q);
    assert.equal(r.status, 200);
    const current = r.body.sessions.filter((s: any) => s.current);
    assert.equal(current.length, 1);
    assert.equal(current[0].deviceId, auth.deviceId);
    for (const k of ['deviceId', 'label', 'current', 'signedInAt', 'lastSeenAt', 'expiresAt']) {
      assert.ok(k in r.body.sessions[0], `session.${k}`);
    }
    const other = r.body.sessions.find((s: any) => !s.current);
    const one = await call('guardian', '/api/v1/auth/sessions/revoke', post({ deviceId: other.deviceId }));
    assert.equal(one.body.revoked, 1);
    const rest = await call('guardian', '/api/v1/auth/sessions/revoke-others', post({ deviceId: auth.deviceId }));
    assert.equal(typeof rest.body.revoked, 'number');
    const after = await call('guardian', q);
    assert.deepEqual(after.body.sessions.map((s: any) => s.deviceId), [auth.deviceId]);
  });

  test('push answers the honest "not set up here" status, not a 404', async () => {
    const r = await call('it_admin', '/api/v1/ops/push');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { enabled: false, publicKey: null, devices: [] });
  });
});

/* ── 15: a subject opens its own chapters ──────────────────────────────── */

describe('learn — every subject on আমার বিষয় has its own chapters (finding 15)', () => {
  test('each subject id, and each "next chapter", is in the chapter feed', async () => {
    const subjects = (await call('student', '/api/v1/academics/subjects')).body.subjects;
    const chapters = (await call('student', '/api/v1/academics/chapters?classId=demo')).body.chapters;
    for (const s of subjects) {
      const own = chapters.filter((c: any) => c.subject.id === s.subjectId);
      assert.ok(own.length > 0, `${s.nameBn} (${s.subjectId}) has no chapters`);
      assert.ok(own.every((c: any) => c.subject.bn === s.nameBn), `${s.nameBn}: the subject names agree`);
      if (s.nextChapter) {
        assert.ok(chapters.some((c: any) => c.id === s.nextChapter.id),
          `${s.nameBn}: its next chapter ${s.nextChapter.id} is a real chapter`);
      }
    }
  });

  test('a chapter’s topics and a topic’s reader belong to that chapter', async () => {
    const t = await call('student', '/api/v1/academics/topics?chapterId=demo-ch-m12');
    assert.equal(t.body.topics.length, 4);
    const topic = t.body.topics[1];
    const read = await call('student', `/api/v1/academics/topics?topicId=${topic.id}`);
    assert.equal(read.body.topic.title.bn, topic.title.bn);
    assert.equal(read.body.topic.chapter.id, 'demo-ch-m12');
    // The motion lesson the student home points at is unchanged.
    const motion = await call('student', '/api/v1/academics/topics?topicId=demo-l-3');
    assert.equal(motion.body.topic.title.bn, 'ত্বরণ');
    const practice = await call('student', `/api/v1/academics/practice?topicId=${topic.id}`);
    assert.deepEqual(practice.body.questions, [], 'no acceleration questions under algebra');
  });

  test('the reader, opened on গণিত from আমার বিষয়, shows গণিত', async () => {
    const { LearnView } = await import('../src/learn-view.ts');
    new LearnView({
      root: root(), doc: dom.window.document, auth: as('student'),
      outbox: { enqueue: async () => undefined } as never,
      classId: 'demo-class', subjectId: 'demo-sub-109',
    } as never);
    await wait(80);
    const select = root().querySelector<HTMLSelectElement>('select');
    assert.ok(select, 'the subject strip is drawn');
    assert.equal(select!.selectedOptions[0]?.textContent, 'গণিত');
  });
});

/* ── minors 70, 95: the staff directory ────────────────────────────────── */

describe('users — the list answers what is asked, and a write shows on the next read (minors 70, 95)', () => {
  const list = async (q = '') => (await call('it_admin', `/api/v1/ops/users${q}`)).body;

  test('the role filter and the search narrow the list; a partial phone matches nobody', async () => {
    const all = await list();
    assert.ok(all.users.length > 5);
    for (const k of ['id', 'nameBn', 'nameEn', 'phone', 'status', 'roles', 'employeeCode', 'studentCode']) {
      assert.ok(k in all.users[0], `user.${k}`);
    }
    assert.equal(typeof all.truncated, 'boolean');
    assert.deepEqual((await list('?role=librarian')).users, [], 'nobody holds গ্রন্থাগারিক');
    assert.deepEqual((await list(`?q=${encodeURIComponent('জ্জ্জ')}`)).users, []);
    const karim = await list(`?q=${encodeURIComponent('করিম')}`);
    assert.deepEqual(karim.users.map((u: any) => u.id), ['demo-t2']);
    const accountants = await list('?role=accountant');
    assert.ok(accountants.users.length > 0 && accountants.users.every((u: any) => u.roles.includes('accountant')));
    const phone = karim.users[0].phone as string;
    assert.equal((await list(`?q=${encodeURIComponent(phone)}`)).users.length, 1, 'an exact phone finds the person');
    assert.deepEqual((await list(`?q=${encodeURIComponent(phone.slice(0, 8))}`)).users, []);
  });

  test('a new account is listed, invited; a bad phone and a duplicate are refused by field', async () => {
    const made = await call('it_admin', '/api/v1/ops/users', post({
      nameBn: 'পরীক্ষা শিক্ষক', nameEn: '', phone: '01812345678', roleCode: 'subject_teacher', employeeCode: 'T-900',
    }));
    assert.equal(made.status, 200);
    assert.deepEqual({ nameBn: made.body.nameBn, roleCode: made.body.roleCode, status: made.body.status },
      { nameBn: 'পরীক্ষা শিক্ষক', roleCode: 'subject_teacher', status: 'invited' });
    const found = (await list(`?q=${encodeURIComponent('পরীক্ষা শিক্ষক')}`)).users;
    assert.equal(found.length, 1);
    assert.equal(found[0].phone, '+8801812345678');

    const short = await call('it_admin', '/api/v1/ops/users', post({
      nameBn: 'ক', phone: '123', roleCode: 'subject_teacher', employeeCode: 'T-901',
    }));
    assert.equal(short.status, 400);
    assert.equal(short.body.field, 'phone');
    const again = await call('it_admin', '/api/v1/ops/users', post({
      nameBn: 'খ', phone: '+8801812345678', roleCode: 'subject_teacher', employeeCode: 'T-902',
    }));
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'phone_taken');
    const owner = await call('it_admin', '/api/v1/ops/users', post({
      nameBn: 'গ', phone: '01912345678', roleCode: 'school_owner', employeeCode: 'T-903',
    }));
    assert.equal(owner.body.field, 'roleCode', 'the owner is not created from inside the school');
    const coordinator = await call('academic_coordinator', '/api/v1/ops/users', post({
      nameBn: 'ঘ', phone: '01912345679', roleCode: 'subject_teacher', employeeCode: 'T-904',
    }));
    assert.equal(coordinator.status, 403, 'reading the list is wider than writing it');
  });

  test('deactivating shows on the row and takes the teacher off the register; reactivating returns them', async () => {
    const off = await call('principal', '/api/v1/ops/users', post({ userId: 'demo-t3', active: false }, 'PATCH'));
    assert.equal(off.status, 200);
    assert.equal(off.body.status, 'left');
    assert.equal((await list(`?q=${encodeURIComponent('হাসান স্যার')}`)).users[0].status, 'left');
    const date = '2026-09-14';
    const register = async () => (await call('principal', `/api/v1/ops/staff-attendance?date=${date}`))
      .body.teachers.map((t: any) => t.teacherId);
    assert.ok(!(await register()).includes('demo-t3'), 'the register lists active staff only');
    const mark = await call('principal', '/api/v1/ops/staff-attendance',
      post({ teacherId: 'demo-t3', date, status: 'present' }));
    assert.equal(mark.status, 404);

    const on = await call('principal', '/api/v1/ops/users', post({ userId: 'demo-t3', active: true }, 'PATCH'));
    assert.equal(on.body.status, 'active');
    assert.ok((await register()).includes('demo-t3'));
    const bad = await call('principal', '/api/v1/ops/users', post({ userId: 'demo-t3', active: 'no' }, 'PATCH'));
    assert.equal(bad.body.field, 'active');
  });

  test('the screen, mounted on the demo, filters by role to its empty state', async () => {
    const { UsersView } = await import('../src/users-view.ts');
    new UsersView({ root: root(), doc: dom.window.document, auth: as('it_admin'), canManage: true } as never);
    await wait(80);
    assert.match(root().textContent ?? '', /করিম স্যার/);
    const select = root().querySelector<HTMLSelectElement>('select[name="role"]');
    assert.ok(select, 'the role filter is drawn');
    select!.value = 'librarian';
    select!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(400);
    assert.doesNotMatch(root().textContent ?? '', /করিম স্যার/, 'the filter reached the list');
  });
});

/* ── minors 84, 103: offline is offline ────────────────────────────────── */

describe('offline — a write fails as fetch fails, so the outbox keeps its queue (minors 84, 103)', () => {
  const setOnline = (v: boolean | undefined) =>
    Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true });

  test('sync/push offline rejects like a dead network; online it applies; reads still answer', async () => {
    const push = post({ deviceId: 'demo-device', ops: [{ opId: 'op-1', entity: 'attendance', payload: {} }] });
    setOnline(false);
    try {
      await assert.rejects(as('class_teacher').authedFetch('/api/v1/sync/push', push), TypeError);
      await assert.rejects(as('principal').authedFetch('/api/v1/ops/notices?preview=1',
        post({ title: 'ক', body: 'খ' })), TypeError);
      const read = await as('class_teacher').authedFetch('/api/v1/academics/sections');
      assert.equal(read.status, 200, 'a read is served, as the cache serves it');
    } finally {
      setOnline(undefined);
    }
    const res = await as('class_teacher').authedFetch('/api/v1/sync/push', push);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).results[0].status, 'applied');
  });
});

/* ── minor 4: the published routine prints ─────────────────────────────── */

describe('routine sheet — ছাপুন on a published routine gives the sheet (minor 4)', () => {
  test('a teacher prints their section; a wider scope and an unknown one are refused as the service refuses', async () => {
    const sheet = await call('class_teacher', '/api/v1/ops/document?type=routine_sheet&scope=section&id=demo-9a');
    assert.equal(sheet.status, 200);
    assert.equal(typeof sheet.body, 'string');
    assert.match(sheet.body, /<html/i);
    assert.match(sheet.body, /নবম শ্রেণি/);
    const wide = await call('class_teacher', '/api/v1/ops/document?type=routine_sheet&scope=institution');
    assert.equal(wide.status, 403);
    const odd = await call('principal', '/api/v1/ops/document?type=routine_sheet&scope=planet');
    assert.equal(odd.status, 400);
    assert.equal(odd.body.error, 'invalid_scope');
    assert.equal((await call('principal', '/api/v1/ops/document?type=routine_sheet&scope=institution')).status, 200);
  });
});

/* ── minor 31: one student, one set of figures ─────────────────────────── */

describe('my attendance — the counts are the days, as the service derives them (minor 31)', () => {
  test('totals sum the months, and each month’s and subject’s misses are listed days on school days', async () => {
    const a = (await call('student', '/api/v1/academics/attendance')).body;
    const sum = (k: string) => a.byMonth.reduce((n: number, m: any) => n + m[k], 0);
    for (const k of ['present', 'late', 'absent', 'excused', 'halfDay']) {
      assert.equal(a.totals[k], sum(k), `totals.${k}`);
    }
    assert.equal(a.totals.counted, a.totals.present + a.totals.late + a.totals.absent + a.totals.halfDay);
    assert.equal(a.totals.attendedPercent,
      Math.round(((a.totals.present + a.totals.late + a.totals.halfDay * 0.5) / a.totals.counted) * 100));
    const status: Record<string, string> = { late: 'late', absent: 'absent', excused: 'excused', halfDay: 'half_day' };
    for (const m of a.byMonth) {
      for (const [k, s] of Object.entries(status)) {
        const days = a.recent.filter((r: any) => r.takenOn.startsWith(m.month) && r.status === s).length;
        assert.equal(days, m[k], `${m.month} ${k}: the strip's figure is that many days on the calendar`);
      }
    }
    for (const s of a.bySubject) {
      for (const k of ['late', 'absent', 'excused']) {
        const days = a.recent.filter((r: any) => r.subjectBn === s.subjectBn && r.status === status[k]).length;
        assert.equal(days, s[k], `${s.subjectBn} ${k}`);
      }
    }
    for (const r of a.recent) {
      const dow = new Date(`${r.takenOn}T00:00:00Z`).getUTCDay();
      assert.ok(dow !== 5 && dow !== 6, `${r.takenOn} is a weekend`);
    }
    const dates = a.recent.map((r: any) => r.takenOn);
    assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  });
});

describe('student home — a "next" suggestion names the topic it opens (minor 31)', () => {
  test('every learn suggestion’s title is its topic’s title', async () => {
    const next = (await call('student', '/api/v1/academics/next')).body.suggestions;
    for (const s of next.filter((x: any) => x.route === 'learn')) {
      const t = await call('student', `/api/v1/academics/topics?topicId=${s.refId}`);
      assert.equal(t.body.topic.title.bn, s.titleBn, `${s.refId}`);
    }
  });
});

/* ── 13: a family's own documents ──────────────────────────────────────── */

describe('documents — a family prints its own child’s card (finding 13)', () => {
  test('a student’s report card is their ফলাফল mark sheet', async () => {
    const r = await call('student',
      '/api/v1/ops/document?type=report_card&examId=demo-ex-3&studentIds=demo-user');
    assert.equal(r.status, 200);
    assert.match(r.body, /রাফির হাসান/);
    assert.match(r.body, /বার্ষিক পরীক্ষা/);
  });

  test('a guardian reaches both wards and nobody else; an exam is required', async () => {
    const tahiya = await call('guardian',
      '/api/v1/ops/document?type=admit_card&examId=demo-exam1&studentIds=demo-s2');
    assert.equal(tahiya.status, 200);
    assert.match(tahiya.body, /তাহিয়া হাসান/);
    const stranger = await call('guardian',
      '/api/v1/ops/document?type=report_card&examId=demo-ex-3&studentIds=demo-9a-s1');
    assert.equal(stranger.status, 404);
    const noExam = await call('guardian', '/api/v1/ops/document?type=report_card&studentIds=demo-s1');
    assert.equal(noExam.status, 400);
    assert.equal(noExam.body.field, 'examId');
    const unpublished = await call('principal',
      '/api/v1/ops/document?type=report_card&examId=demo-exam1&studentIds=demo-9a-s1');
    assert.equal(unpublished.status, 409);
  });

  test('results are asked for by child: none for a teacher, none yet for Tahiya', async () => {
    assert.ok((await call('student', '/api/v1/academics/results')).body.results.length > 0);
    assert.ok((await call('guardian', '/api/v1/academics/results?studentId=demo-s1')).body.results.length > 0);
    assert.deepEqual((await call('guardian', '/api/v1/academics/results?studentId=demo-s2')).body.results, []);
    assert.deepEqual((await call('class_teacher', '/api/v1/academics/results')).body.results, []);
  });
});
