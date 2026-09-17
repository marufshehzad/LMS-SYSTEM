/**
 * R-3 — the principal and IT admin screens.
 *
 * D13 makes loading, empty, error and success part of "done", so those four
 * moments are tested here as behaviour rather than trusted as polish. The
 * empty state gets the most attention because it is what a school sees on its
 * FIRST day, when every table is legitimately empty and nothing has failed.
 *
 * Beyond the states, the behaviours worth holding are the ones a school would
 * be harmed by losing:
 *
 *   - "nobody has taken attendance yet" is not rendered as 0%
 *   - a capped list never reads as a complete list
 *   - replacing a teacher demands a reason and says the record is kept
 *   - every irreversible action states its consequence with numbers first
 *   - the SMS cost warning is in segments, and comes from the server's limits
 *   - a fee block absent from the response is absent from the screen
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AcademicView } from '../src/academic-view.ts';
import { PublishView } from '../src/publish-view.ts';
import { InvoiceView } from '../src/invoice-view.ts';
import { AdminSettingsView } from '../src/admin-settings-view.ts';
import { RolloverView } from '../src/rollover-view.ts';
import { permissionMessage } from '../src/ui/feedback.ts';
import { UsersView } from '../src/users-view.ts';
import { bnNum, skeleton, emptyState, errorState } from '../src/view-states.ts';

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
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
});

const doc = () => dom.window.document;
const root = () => doc().getElementById('root')!;
const text = () => root().textContent ?? '';
const settle = () => new Promise((r) => setTimeout(r, 0));

/**
 * Open section F from its tree row. One press: 05 Principal §02 draws the
 * hierarchy as a tree whose first শ্রেণি and বিভাগ are open on arrival, and a
 * section row opens the section itself — the class page that used to sit
 * between them no longer exists.
 */
async function openSectionF(): Promise<void> {
  (root().querySelector('.ac-node[data-node="S:secF"] .ac-node-hit') as HTMLElement)
    .dispatchEvent(new dom.window.Event('click'));
  await settle();
}

/** Click a button by its exact label. */
const clickLabel = (label: string) =>
  ([...root().querySelectorAll('button')].find((b) => b.textContent === label) as HTMLElement)
    .dispatchEvent(new dom.window.Event('click'));

/** An Auth stand-in. `status` lets a test drive the 403 and offline paths. */
function fakeAuth(
  routes: Record<string, unknown>,
  opts: { role?: string; status?: number; throws?: boolean } = {},
) {
  const calls: { path: string; init?: RequestInit }[] = [];
  return {
    calls,
    role: opts.role ?? 'principal',
    tenantId: 't1',
    userId: 'u1',
    displayName: 'প্রধান শিক্ষক',
    isLoggedIn: () => true,
    authedFetch: async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (opts.throws) throw new Error('offline');
      // Longest prefix wins. `/hierarchy?studentId=…` also starts with
      // `/hierarchy`, and insertion order silently handed it the tree — which
      // looked like a view bug for a while and was a stub bug.
      const key = Object.keys(routes)
        .filter((k) => path.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
      const body = key ? routes[key] : {};
      return new Response(JSON.stringify(body), {
        status: opts.status ?? 200, headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}


// ── The four states D13 requires ───────────────────────────────────────

describe('the four states', () => {
  test('loading is a skeleton, not a spinner, and is announced as busy', () => {
    const el = skeleton(doc(), 3);
    assert.equal(el.getAttribute('aria-busy'), 'true');
    assert.ok(el.querySelector('.skel-title'), 'a skeleton shows the shape of what is coming');
    assert.equal(el.querySelectorAll('.skel-bar').length, 3);
  });

  test('an empty state offers a way out, not just a full stop', () => {
    let clicked = false;
    const el = emptyState(doc(), {
      message: 'এখনো কিছু নেই।',
      action: { label: 'যোগ করুন', onClick: () => { clicked = true; } },
    });
    const btn = el.querySelector('button')!;
    btn.dispatchEvent(new dom.window.Event('click'));
    assert.ok(clicked, 'the empty state is where a person is told what to do next');
  });

  test('an error is announced and offers a retry', () => {
    let retried = false;
    const el = errorState(doc(), 'আনা যায়নি।', () => { retried = true; });
    assert.equal(el.querySelector('[role="alert"]')?.textContent, 'আনা যায়নি।');
    el.querySelector('button')!.dispatchEvent(new dom.window.Event('click'));
    assert.ok(retried);
  });

  // P7-0. The two cases that stood here — a 403 offering no retry, and a
  // network failure offering one — drove `principal-view.ts`, which the
  // home/institution merge retired. Both now run against the screen that
  // ships, in `principal-home-view.test.ts`, where they belong.
});

// ── Part A: the principal dashboard ────────────────────────────────────

// P7-0. The `principal dashboard` block that stood here tested
// `principal-view.ts`, which the home/institution merge retired. Every rule
// it held now lives in `principal-home-view.test.ts` against the screen that
// actually ships — including the absentee truncation guarantee, which was
// ported before this was removed.

// ── Parts C, D, L: the hierarchy and assignment ────────────────────────

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

const sectionDetail = {
  section: { id: 'secF', name: 'F', shift: 'morning', capacity: 60, studentCount: 40,
             classId: 'c1', levelNo: 9, classNameBn: 'নবম শ্রেণি', groupBn: 'বিজ্ঞান',
             yearId: 'y1', yearLabel: '২০২৬' },
  classTeacher: { id: 't1', nameBn: 'রহিম স্যার', since: '2026-01-05' },
  subjectTeachers: [{
    assignmentId: 'a1', subject: { id: 'sub1', nameBn: 'পদার্থবিজ্ঞান', nameEn: 'Physics' },
    teacher: { id: 't2', nameBn: 'করিম স্যার' }, startedOn: '2026-01-05',
  }],
  unassignedSubjects: [{ id: 'sub2', nameBn: 'রসায়ন' }],
  roster: [
    { studentId: 's1', rollNo: 1, nameBn: 'শিক্ষার্থী ১', studentCode: 'X1', status: 'active' },
    { studentId: 's2', rollNo: 2, nameBn: 'শিক্ষার্থী ২', studentCode: 'X2', status: 'active' },
  ],
  history: [{ kind: 'subject_teacher', subjectBn: 'পদার্থবিজ্ঞান', teacherBn: 'জামাল স্যার',
              startedOn: '2026-01-05', endedOn: '2026-03-15', endReason: 'বদলি হয়েছেন' }],
};

describe('academic hierarchy', () => {
  const routes = {
    '/api/v1/academics/hierarchy?sectionId': sectionDetail,
    '/api/v1/academics/hierarchy': tree,
    '/api/v1/ops/assign': {
      subjects: [{ id: 'sub1', nameBn: 'পদার্থবিজ্ঞান', assigned: { id: 't2', nameBn: 'করিম স্যার' } }],
      teachers: [
        { id: 't2', nameBn: 'করিম স্যার', employeeCode: 'T2', currentLoad: 3, expertiseSubjectIds: ['sub1'] },
        { id: 't3', nameBn: 'হাসান স্যার', employeeCode: 'T3', currentLoad: 1, expertiseSubjectIds: [] },
      ],
    },
  };

  test('the tree shows counts at every level', async () => {
    new AcademicView({ root: root(), doc: doc(), auth: fakeAuth(routes) as never, canManage: true, canManageGuardians: true });
    await settle();
    assert.match(text(), /নবম শ্রেণি/);
    assert.match(text(), /বিজ্ঞান/);
    // Ata Ekta (05 Principal §02): the counts are each tree row's meta line,
    // at all three levels — the শ্রেণি, its বিভাগ, and every section.
    const metas = [...root().querySelectorAll('.ac-node-meta')].map((m) => m.textContent);
    assert.ok(metas.includes('১ বিভাগ · ২ সেকশন · ৭৮ জন'), 'the শ্রেণি row counts its sections and students');
    assert.ok(metas.includes('২ সেকশন · ৭৮ জন'), 'and so does its বিভাগ');
    assert.ok(metas.includes('৪০ জন · রহিম স্যার'), 'and so does each section');
    assert.match(text(), new RegExp(bnNum(78)));
  });

  test('a section with no class teacher is marked, not left to be read', async () => {
    new AcademicView({ root: root(), doc: doc(), auth: fakeAuth(routes) as never, canManage: true, canManageGuardians: true });
    await settle();
    // The first শ্রেণি and বিভাগ open on arrival, so section E is on screen
    // with no click. The mark is a status on section E itself, in an OPEN
    // branch — not text somewhere on the page, nor folded out of sight.
    const e = root().querySelector('.ac-node[data-node="S:secE"]');
    assert.equal(e?.querySelector('.ui-status')?.textContent, 'শিক্ষক নেই');
    assert.equal(e?.closest('ul.ac-tree-group')?.hasAttribute('hidden'), false,
      'inside an OPEN branch, not folded away');
  });

  test('an empty class says so instead of rendering nothing', async () => {
    const emptyTree = {
      ...tree,
      classes: [{ ...tree.classes[0], groups: [{ ...tree.classes[0].groups[0], sections: [] }] }],
    };
    new AcademicView({
      root: root(), doc: doc(),
      auth: fakeAuth({ '/api/v1/academics/hierarchy': emptyTree }) as never, canManage: true,
    });
    await settle();
    const empty = root().querySelector('.ac-node.is-empty');
    assert.match(empty?.textContent ?? '', /কোনো সেকশন তৈরি হয়নি/);
    assert.equal(empty?.closest('ul.ac-tree-group')?.hasAttribute('hidden'), false,
      'inside an OPEN branch, not folded away');
  });

  test('a subject nobody teaches is shown as empty, not omitted', async () => {
    new AcademicView({ root: root(), doc: doc(), auth: fakeAuth(routes) as never, canManage: true, canManageGuardians: true });
    await settle();
    await openSectionF();
    // The most useful thing this screen tells a principal in January.
    assert.match(text(), /রসায়ন/);
    assert.match(text(), /খালি/);
  });

  test('the replacement record is visible on the section', async () => {
    new AcademicView({ root: root(), doc: doc(), auth: fakeAuth(routes) as never, canManage: true, canManageGuardians: true });
    await settle();
    await openSectionF();
    assert.match(text(), /জামাল স্যার/, 'the replaced teacher stays on the record');
    assert.match(text(), /বদলি হয়েছেন/, 'and so does the reason');
  });

  test('a teacher sees no management controls', async () => {
    new AcademicView({ root: root(), doc: doc(), auth: fakeAuth(routes) as never, canManage: false, canManageGuardians: false });
    await settle();
    await openSectionF();
    assert.doesNotMatch(text(), /শিক্ষক বদল করুন/);
    assert.doesNotMatch(text(), /একসাথে স্থানান্তর/);
  });

  test('THE ONE THAT MATTERS — replacement states that the old record is kept', async () => {
    new AcademicView({ root: root(), doc: doc(), auth: fakeAuth(routes) as never, canManage: true, canManageGuardians: true });
    await settle();
    await openSectionF();
    clickLabel('শিক্ষক বদল করুন');
    await settle();
    assert.match(text(), /রেকর্ড মুছে যাবে না/,
      'a school that thinks replacing erases the old teacher stops recording replacements');
    assert.match(text(), /পরিবর্তনের কারণ/, 'a history of changes with no reasons is a list of dates');
  });

  test('the student drawer shows the year-by-year history and no guardian phone', async () => {
    const withStudent = {
      ...routes,
      '/api/v1/academics/hierarchy?studentId': {
        student: { id: 's1', nameBn: 'শিক্ষার্থী ১', nameEn: null, studentCode: 'X1',
                   admissionDate: '2024-01-05', lifecycleStatus: 'enrolled',
                   bloodGroup: 'B+', status: 'active' },
        current: { yearLabel: '২০২৬', levelNo: 9, classBn: 'নবম', groupBn: 'বিজ্ঞান',
                   section: 'F', rollNo: 1, status: 'active' },
        history: [
          { yearLabel: '২০২৬', levelNo: 9, classBn: 'নবম', groupBn: 'বিজ্ঞান', section: 'F',
            rollNo: 1, status: 'active', enrolledOn: '2026-01-05', endedOn: null },
          { yearLabel: '২০২৫', levelNo: 8, classBn: 'অষ্টম', groupBn: 'সাধারণ', section: 'খ',
            rollNo: 12, status: 'promoted', enrolledOn: '2025-01-05', endedOn: '2025-12-20' },
        ],
        guardians: [{ nameBn: 'আব্দুল করিম', relation: 'father', isPrimary: true, canPayFees: true }],
        attendance90d: { present: 74, total: 80 },
      },
      // R-3 completion: the drawer's guardian block is now a live panel with
      // its own endpoint, so the stub has to answer it. The phone is null
      // because the SERVER withholds it from anyone who may not edit it —
      // this stub models the answer a coordinator would get.
      '/api/v1/ops/guardians': {
        student: { id: 's1', nameBn: 'শিক্ষার্থী ১' },
        guardians: [{
          linkId: 'l1', guardianId: 'g1', nameBn: 'আব্দুল করিম', phone: null,
          relation: 'father', isPrimary: true, receivesSms: true,
          canPayFees: true, otherWards: 0,
        }],
      },
    };
    new AcademicView({ root: root(), doc: doc(), auth: fakeAuth(withStudent) as never, canManage: true, canManageGuardians: true });
    await settle();
    await openSectionF();
    // The roster is a `dataTable` since P5, so a student is opened by the
    // table's own row control rather than by a bespoke `.roster-name` button.
    const tables = [...root().querySelectorAll('table.ui-table')];
    const roster = tables[tables.length - 1];
    (roster.querySelector('tbody .ui-row-open') as HTMLElement)
      .dispatchEvent(new dom.window.Event('click'));
    await settle();
    assert.match(text(), /২০২৫/, 'the ten-year history is the point of never overwriting enrolments');
    assert.match(text(), /আব্দুল করিম/);
    assert.doesNotMatch(text(), /\+8801|01[3-9]\d{8}/,
      'a phone number here is a phone number on every teacher’s device');
  });
});

// ── Part H: result publishing ──────────────────────────────────────────

describe('result publishing', () => {
  const exams = {
    exams: [{
      examId: 'e1', examNameBn: 'অর্ধবার্ষিক', status: 'marking',
      startsOn: '2026-06-10', endsOn: '2026-06-20',
      subjects: [
        { examSubjectId: 'es1', subjectBn: 'পদার্থ', sectionName: 'F', enrolled: 40, marked: 40 },
        { examSubjectId: 'es2', subjectBn: 'রসায়ন', sectionName: 'F', enrolled: 40, marked: 31 },
      ],
    }],
  };

  test('incompleteness is shown before the button, not after it', async () => {
    new PublishView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/academics/publish': exams }) as never });
    await settle();
    assert.match(text(), /নম্বর বাকি/);
  });

  test('the confirmation names what is missing, with numbers', async () => {
    new PublishView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/academics/publish': exams }) as never });
    await settle();
    // 05 §05 / §7 R11: the consequence is on screen before any press — the
    // irreversible panel replaced the dialog that opened after one.
    assert.match(text(), /অপরিবর্তনীয়|সম্পাদনা করা যাবে না|বদলানো যাবে না/);
    assert.match(text(), new RegExp(`${bnNum(1)} টি বিষয়ে`));
  });

  test('the irreversible action is behind an acknowledgement that comes first', async () => {
    // §7 / R11: no dialog and no "বাতিল" any more — the tick IS the
    // confirmation. What the old focus-to-cancel test protected still holds:
    // publishing needs a deliberate second act, the thing reached first is
    // not the action, and nothing is sent without it.
    const auth = fakeAuth({ '/api/v1/academics/publish': exams });
    new PublishView({ root: root(), doc: doc(), auth: auth as never });
    await settle();
    const btn = [...root().querySelectorAll('button')]
      .find((b) => b.textContent === 'প্রকাশ করুন') as HTMLButtonElement;
    assert.ok(btn, 'the publish action exists');
    assert.equal(btn.disabled, true, 'nothing irreversible is one click away');
    btn.dispatchEvent(new dom.window.Event('click'));
    await settle();
    assert.equal(auth.calls.filter((c) => c.init?.method === 'POST').length, 0,
      'a press before the tick publishes nothing');
    const box = root().querySelector('input[type="checkbox"]') as HTMLInputElement;
    assert.match(box.labels![0].textContent ?? '', /ফেরানো যাবে না/);
    assert.ok(box.compareDocumentPosition(btn) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      'the way to stop is reached before the action');
    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change'));
    assert.equal(btn.disabled, false, 'the tick unlocks it');
    btn.dispatchEvent(new dom.window.Event('click'));
    await settle();
    const posts = auth.calls.filter((c) => c.init?.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, '/api/v1/academics/publish');
    assert.deepEqual(JSON.parse(String(posts[0].init!.body)), { examId: 'e1' });
  });

  test('no exams is guidance, not a blank screen', async () => {
    new PublishView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/academics/publish': { exams: [] } }) as never });
    await settle();
    assert.match(text(), /কোনো পরীক্ষা তৈরি হয়নি/);
  });
});

// ── Part I: invoice generation ─────────────────────────────────────────

describe('invoice generation', () => {
  test('idempotency is promised before the button, not discovered after', async () => {
    new InvoiceView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/finance/invoices': { invoices: [] } }) as never, canGenerate: true });
    await settle();
    assert.match(text(), /দুইবার চালালে/,
      'without this sentence the second press is the scariest thing in the product');
  });

  // §7 / R11: the run sits behind "আমি বুঝেছি এটি ফেরানো যাবে না". The tick
  // IS the confirmation — the dialog that asked after the press is gone.
  const runForm = () => root().querySelector('form.inv-run') as HTMLFormElement;
  const runButton = () => [...runForm().querySelectorAll('button[type="submit"]')]
    .find((b) => b.textContent === 'ইনভয়েস তৈরি করুন') as HTMLButtonElement;
  const ackBox = () => runForm().querySelector('input[type="checkbox"]') as HTMLInputElement;
  const posts = (auth: ReturnType<typeof fakeAuth>) =>
    auth.calls.filter((c) => c.init?.method === 'POST');
  /** Tick the acknowledgement and press the run, the way a person does. */
  async function acknowledgeAndRun(): Promise<void> {
    ackBox().checked = true;
    ackBox().dispatchEvent(new dom.window.Event('change'));
    // A real press: jsdom runs the submit button's activation behaviour for
    // `click()`, so this goes through the form's submit handler.
    runButton().click();
    // generate() awaits the POST and then a reload; both need to land.
    await settle(); await settle(); await settle();
  }

  test('zero new invoices is explained, not reported as a failure', async () => {
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { invoices: [] },
      '/api/v1/finance/generate': { invoicesCreated: 0 },
    });
    new InvoiceView({ root: root(), doc: doc(), auth: auth as never, canGenerate: true });
    await settle();
    await acknowledgeAndRun();
    assert.equal(posts(auth).length, 1, 'the run was actually sent');
    assert.match(text(), /সবার ইনভয়েস আগেই তৈরি হয়েছে/);
  });

  test('a run that creates invoices says how many, and who was told', async () => {
    // finance-svc answers `invoicesCreated`. The screen read `invoiceCount`,
    // which the server never sends, so every successful run — the month's
    // first included — was reported as "nothing new".
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { invoices: [] },
      '/api/v1/finance/generate': { ok: true, invoicesCreated: 3, notified: 2 },
    });
    new InvoiceView({ root: root(), doc: doc(), auth: auth as never, canGenerate: true });
    await settle();
    await acknowledgeAndRun();
    assert.equal(posts(auth).length, 1, 'the run was actually sent');
    assert.match(text(), /৩ টি ইনভয়েস তৈরি হয়েছে/);
    assert.match(text(), /২ জন অভিভাবককে জানানো হয়েছে/, 'the guardians told are named');
    assert.doesNotMatch(text(), /নতুন কোনো ইনভয়েস তৈরি হয়নি/,
      'three new bills must not be reported as none');
  });

  test('the run is behind an acknowledgement that comes first, and nothing is sent without it', async () => {
    // Takes over the guarantee the removed confirm dialog gave, in the same
    // form as the result-publishing test above.
    const auth = fakeAuth({
      '/api/v1/finance/invoices': { invoices: [] },
      '/api/v1/finance/generate': { invoicesCreated: 0 },
    });
    new InvoiceView({ root: root(), doc: doc(), auth: auth as never, canGenerate: true });
    await settle();
    const form = runForm();
    const btn = runButton();
    const box = ackBox();
    assert.ok(btn, 'the run action exists');

    // What cannot be undone names the panel, and is said before the button.
    const group = form.querySelector('[role="group"][aria-labelledby]') as HTMLElement;
    const statement = doc().getElementById(group.getAttribute('aria-labelledby')!)!;
    assert.match(statement.textContent ?? '', /ফেরানো যাবে না/);
    assert.ok(statement.compareDocumentPosition(btn) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      'the consequence is read before the action');
    assert.match(box.labels![0].textContent ?? '', /ফেরানো যাবে না/);
    assert.ok(box.compareDocumentPosition(btn) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      'the way to stop is reached before the action');

    // The month the run is for, fixed so the payload can be checked exactly.
    const month = form.querySelector('input[type="month"]') as HTMLInputElement;
    month.value = '2026-03';
    month.dispatchEvent(new dom.window.Event('change'));

    assert.equal(btn.disabled, true, 'nothing irreversible is one click away');
    btn.click();
    // Enter in the month field submits even while the button is disabled.
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(posts(auth).length, 0, 'a press or a submit before the tick generates nothing');
    assert.equal(doc().activeElement, box, 'the way forward is the box, not the run');

    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change'));
    assert.equal(btn.disabled, false, 'the tick unlocks it');

    // The tick belongs to the month it was given for.
    month.value = '2026-04';
    month.dispatchEvent(new dom.window.Event('change'));
    assert.equal(box.checked, false, 'a new month clears the tick');
    assert.equal(btn.disabled, true, 'and locks the run again');
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(posts(auth).length, 0, 'a tick given for another month sends nothing');

    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change'));
    btn.click();
    await settle(); await settle(); await settle();
    const sent = posts(auth);
    assert.equal(sent.length, 1, 'one tick, one press, one run');
    assert.equal(sent[0].path, '/api/v1/finance/generate');
    assert.deepEqual(JSON.parse(String(sent[0].init!.body)), { billingPeriod: '2026-04' });
  });
});

// ── Part J: the SMS setting that produced D13 ──────────────────────────

describe('invoice generation — permission', () => {
  test('a caller who may not generate is offered no form', async () => {
    // Found in the browser: the invoice LIST is legitimately readable by a
    // guardian for their own child, so the screen loaded and drew a billing
    // form that would have 403'd on submit.
    new InvoiceView({
      root: root(), doc: doc(),
      auth: fakeAuth({ '/api/v1/finance/invoices': { invoices: [] } }) as never,
      canGenerate: false,
    });
    await settle();
    assert.equal(root().querySelectorAll('input[type=month]').length, 0);
    // P5 replaced this screen's bespoke sentence with the canonical one, and
    // asserts it through the function so it cannot drift again.
    assert.match(text(), new RegExp(permissionMessage('ইনভয়েস তৈরি')));
    assert.match(text(), /প্রধান শিক্ষক, প্রতিষ্ঠান মালিক ও হিসাবরক্ষক/);
  });
});

describe('SMS notice settings', () => {
  const settings = { sms: { noticeMaxChars: 180, default: 180, min: 70, max: 480, charsPerSegment: 70 } };

  test('the limits come from the server, not from a constant in the browser', async () => {
    new AdminSettingsView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/settings': settings }) as never, canManage: true, canManageGuardians: true });
    await settle();
    // `field({ kind: 'number' })` renders `type="text"` with
    // `inputmode="numeric"` on purpose — `type=number` silently discards what
    // it considers invalid, so a mis-keyed value vanishes instead of being
    // corrected. The bounds still come from the server and are still on the
    // control, which is what this test is about.
    const input = root().querySelector('[name="noticeMaxChars"]') as HTMLInputElement;
    assert.equal(input.getAttribute('min'), '70');
    assert.equal(input.getAttribute('max'), '480');
    // A count of letters, not an identifier: shown in Bangla digits beside "প্রস্তাবিত (১৮০)" (R6, UX sweep 43). Still the server's number.
    assert.equal(input.value, bnNum(180));
    assert.equal(input.getAttribute('inputmode'), 'numeric');
  });

  test('cost is shown in segments, because that is the unit the bill arrives in', async () => {
    new AdminSettingsView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/settings': settings }) as never, canManage: true, canManageGuardians: true });
    await settle();
    assert.match(text(), new RegExp(`${bnNum(3)} টি এসএমএস`), '180 chars ÷ 70 = 3 Bangla segments');
  });

  test('going over the recommendation warns in multiples of the bill', async () => {
    new AdminSettingsView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/settings': settings }) as never, canManage: true, canManageGuardians: true });
    await settle();
    const input = root().querySelector('[name="noticeMaxChars"]') as HTMLInputElement;
    input.value = '420';
    input.dispatchEvent(new dom.window.Event('input'));
    const warn = root().querySelector('.inline-notice') as HTMLElement;
    assert.equal(warn.hidden, false);
    assert.match(warn.textContent ?? '', /গুণ/);
  });

  test('an out-of-range value cannot be saved', async () => {
    const auth = fakeAuth({ '/api/v1/ops/settings': settings });
    new AdminSettingsView({ root: root(), doc: doc(), auth: auth as never, canManage: true, canManageGuardians: true });
    await settle();
    const input = root().querySelector('[name="noticeMaxChars"]') as HTMLInputElement;
    input.value = '9000';
    input.dispatchEvent(new dom.window.Event('input'));
    const save = [...root().querySelectorAll('button')].find((b) => b.textContent?.includes('সংরক্ষণ'))! as HTMLButtonElement;
    /* UX sweep 43: save is not greyed out for a refused value — a disabled submit said nothing about why and swallowed Enter. Pressing it is refused by the submit handler instead, at the field, and nothing is sent. */
    save.click();
    await settle();
    assert.equal(auth.calls.filter((c) => c.init?.method === 'PUT').length, 0, 'an out-of-range value is never sent');
    assert.equal(input.getAttribute('aria-invalid'), 'true', 'and the field says why');
    assert.match(text(), new RegExp(`${bnNum(70)} থেকে ${bnNum(480)} এর মধ্যে`));
  });

  test('the policy is stated: SMS is an alert, the app holds the notice', async () => {
    new AdminSettingsView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/settings': settings }) as never, canManage: true, canManageGuardians: true });
    await settle();
    assert.match(text(), /পুরো নোটিশ সবসময় অ্যাপে থাকবে/);
    assert.match(text(), /প্রতিষ্ঠানের নাম/);
  });

  test('a caller who may not change it gets a disabled form and a reason', async () => {
    new AdminSettingsView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/settings': settings }) as never, canManage: false, canManageGuardians: false });
    await settle();
    assert.equal((root().querySelector('[name="noticeMaxChars"]') as HTMLInputElement).disabled, true);
    // P5: names all FOUR roles the endpoint allows. The old sentence said
    // "প্রধান শিক্ষক ও আইটি অ্যাডমিন" and left out the owner and the
    // coordinator, both of whom may in fact change this.
    assert.match(text(), /আপনি শুধু দেখতে পারবেন/);
    assert.match(text(), /প্রধান শিক্ষক, প্রতিষ্ঠান মালিক, আইটি অ্যাডমিন ও একাডেমিক সমন্বয়ক/);
  });
});

// ── Part G: rollover ───────────────────────────────────────────────────

describe('yearly rollover', () => {
  const preview = {
    years: [{ id: 'y2', label: '২০২৭', isCurrent: false }, { id: 'y1', label: '২০২৬', isCurrent: true }],
    needsTargetYear: false,
    fromYear: { id: 'y1', label: '২০২৬' }, toYear: { id: 'y2', label: '২০২৭' },
    summary: { considered: 180, promote: 168, repeat: 5, graduate: 4, blocked: 3 },
    students: [
      { studentId: 's1', nameBn: 'ক', fromLevel: 9, fromSection: 'F', fromRoll: 1,
        action: 'promote', toLevel: 10, toSection: 'ক', toRoll: 1, blockerBn: null },
      { studentId: 's2', nameBn: 'খ', fromLevel: 9, fromSection: 'F', fromRoll: 2,
        action: 'blocked', toLevel: null, toSection: null, toRoll: null,
        blockerBn: 'দশম শ্রেণিতে সেকশন নেই' },
    ],
    existing: null,
  };

  test('blocked students are named above the button, with the reason', async () => {
    new RolloverView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/rollover': preview }) as never, canCommit: true });
    await settle();
    assert.match(text(), /দশম শ্রেণিতে সেকশন নেই/);
    assert.match(text(), /কাউকে বাদ দিয়ে করা হয় না/);
  });

  test('one year only is guidance, not an empty preview', async () => {
    new RolloverView({
      root: root(), doc: doc(),
      auth: fakeAuth({ '/api/v1/ops/rollover': {
        years: [{ id: 'y1', label: '২০২৬', isCurrent: true }],
        needsTargetYear: true, summary: null, students: [], existing: null,
      } }) as never,
      canCommit: true,
    });
    await settle();
    assert.match(text(), /দুইটি শিক্ষাবর্ষ দরকার/);
  });

  test('a caller who may not commit is told, and offered nothing', async () => {
    new RolloverView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/rollover': preview }) as never, canCommit: false });
    await settle();
    assert.match(text(), /অনুমতি কেবল/);
    // 08 §03 relabelled the commit "উন্নয়ন শুরু করুন"; both words are refused.
    assert.equal([...root().querySelectorAll('button')]
      .filter((b) => /সম্পন্ন করুন|শুরু করুন/.test(b.textContent ?? '')).length, 0);
    assert.equal(root().querySelector('input[type=checkbox]'), null,
      'and no acknowledgement to tick either');
  });

  test('the commit button appears only after a plan is saved, and stays blocked', async () => {
    const planned = { ...preview, existing: {
      id: 'r1', status: 'planned',
      planned: { considered: 180, promote: 168, repeat: 5, graduate: 4, blocked: 3 },
      actual: null,
    } };
    const auth = fakeAuth({ '/api/v1/ops/rollover': planned });
    new RolloverView({ root: root(), doc: doc(), auth: auth as never, canCommit: true });
    await settle();
    // 08 §03 labels the commit "উন্নয়ন শুরু করুন".
    const commit = [...root().querySelectorAll('button')]
      .find((b) => b.textContent?.includes('উন্নয়ন শুরু করুন')) as HTMLButtonElement;
    assert.ok(commit, 'the plan step gates the commit button');
    assert.equal(commit.disabled, true, '3 blocked students must stop it');
    // The irreversible panel's tick also disables it, so an unticked box alone
    // would satisfy the line above. Tick it anyway: the blocked students must
    // still stop the commit.
    const box = root().querySelector('input[type=checkbox]') as HTMLInputElement;
    assert.equal(box.disabled, true, 'the tick is unavailable while students are blocked');
    box.disabled = false;
    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change'));
    assert.equal(commit.disabled, true, '3 blocked students must stop it even when ticked');
    commit.dispatchEvent(new dom.window.Event('click'));
    await settle();
    assert.equal(doc().querySelector('[role="alertdialog"]'), null, 'no confirmation is opened');
    assert.equal(auth.calls.filter((c) => c.init?.method === 'POST').length, 0, 'and nothing is committed');
  });

  test('the named list is available, because a count is not something to trust', async () => {
    new RolloverView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/rollover': preview }) as never, canCommit: true });
    await settle();
    // Scoped to the list block: the blocked students above it are a
    // `table.ui-table` too, so an unscoped query would pass without the toggle.
    assert.equal(root().querySelector('.roll-list table.ui-table'), null, 'closed until asked for');
    [...root().querySelectorAll('button')]
      .find((b) => b.textContent?.includes('তালিকা দেখুন'))!
      .dispatchEvent(new dom.window.Event('click'));
    assert.ok(root().querySelector('.roll-list table.ui-table'));
    assert.match(text(), /উন্নীত/);
  });
});

// ── Part B: users ──────────────────────────────────────────────────────

describe('user management', () => {
  const users = {
    users: [
      { id: 'u1', nameBn: 'রহিম স্যার', nameEn: null, phone: '+8801700000001',
        status: 'active', roles: ['class_teacher'], employeeCode: 'T1', studentCode: null },
    ],
    truncated: true, limit: 50,
  };

  test('there is no delete, and deactivation says the record is kept', async () => {
    new UsersView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/users': users }) as never, canManage: true, canManageGuardians: true });
    await settle();
    assert.doesNotMatch(text(), /মুছে ফেলুন/);
    [...root().querySelectorAll('button')]
      .find((b) => b.textContent === 'নিষ্ক্রিয় করুন')!
      .dispatchEvent(new dom.window.Event('click'));
    // §7: the confirmation is `confirmOverlay`, a scrim on document.body —
    // not inside the view root.
    assert.match(doc().querySelector('[role="alertdialog"]')?.textContent ?? '', /রেকর্ড মুছে যাবে না/);
  });

  test('a capped list never reads as a complete one', async () => {
    new UsersView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/users': users }) as never, canManage: true, canManageGuardians: true });
    await settle();
    assert.match(text(), /প্রথম ৫০ জন/);
  });

  test('creating an account never offers a password', async () => {
    new UsersView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/users': users }) as never, canManage: true, canManageGuardians: true });
    await settle();
    [...root().querySelectorAll('button')]
      .find((b) => b.textContent?.includes('নতুন অ্যাকাউন্ট'))!
      .dispatchEvent(new dom.window.Event('click'));
    assert.equal(root().querySelectorAll('input[type=password]').length, 0);
    assert.match(text(), /অ্যাক্টিভেশন কোড/);
  });

  test('a read-only caller is offered no controls', async () => {
    new UsersView({ root: root(), doc: doc(), auth: fakeAuth({ '/api/v1/ops/users': users }) as never, canManage: false, canManageGuardians: false });
    await settle();
    assert.equal([...root().querySelectorAll('button')]
      .filter((b) => b.textContent === 'নিষ্ক্রিয় করুন').length, 0);
    // The মোবাইল column is for a caller who may manage accounts. In EITHER
    // shape (table and phone list), no number reaches a read-only reader.
    assert.ok(![...root().querySelectorAll('thead th')].some((h) => h.textContent === 'মোবাইল'));
    assert.doesNotMatch(text(), /01700000001/, 'a read-only caller is shown no phone number');
  });

  test('an empty search explains the exact-phone rule rather than looking broken', async () => {
    const v = new UsersView({
      root: root(), doc: doc(),
      auth: fakeAuth({ '/api/v1/ops/users': { users: [], truncated: false } }) as never,
      canManage: true,
    });
    (v as unknown as { term: string }).term = '017';
    await settle();
    (v as unknown as { render: () => void }).render();
    assert.match(text(), /মোবাইল নম্বর পুরোটা/);
  });
});
