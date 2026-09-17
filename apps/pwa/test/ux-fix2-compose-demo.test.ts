/**
 * UX fixes round 2, group "compose-demo" — নোটিশ পাঠান (notice-compose-view.ts)
 * and the preview's in-page API (demo.ts).
 *
 *   partly 0 / R1  In /demo a class teacher could not send a notice. The
 *                  composer ran parseNotice on the demo's section ids
 *                  (`demo-9a`, not UUIDs) and refused with "every selection
 *                  must be an id"; the demo's own handler refused the same
 *                  way. The refusal was English, drawn at the top of the page
 *                  (6px above a 375px viewport, while the person was at Send),
 *                  and Send was enabled with no section ticked.
 *   R2             After a successful send, focus fell to <body> and stayed.
 *   R10            The rollover demo's blocked reason read "9 শ্রেণিতে …".
 *   R11            A guardian or student opening #/staffattendance was told the
 *                  school has no teachers.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom: JSDOM;
// Imported after the globals exist: demo.ts reads `location` and
// `localStorage` when a request is answered.
let DemoAuth: typeof import('../src/demo.ts').DemoAuth;
let NoticeComposeView: typeof import('../src/notice-compose-view.ts').NoticeComposeView;
let StaffAttendanceView: typeof import('../src/staff-attendance-view.ts').StaffAttendanceView;
let keepFocusWithin: typeof import('../src/ui/index.ts').keepFocusWithin;
let errors: unknown[] = [];

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/demo' });
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
  ({ NoticeComposeView } = await import('../src/notice-compose-view.ts'));
  ({ StaffAttendanceView } = await import('../src/staff-attendance-view.ts'));
  ({ keepFocusWithin } = await import('../src/ui/index.ts'));
  dom.window.addEventListener('error', (e) => { errors.push(e.error ?? e.message); e.preventDefault(); });
});

beforeEach(() => {
  dom.window.document.body.innerHTML = '<main id="shell-view"><div id="root"></div></main>';
  errors = [];
});

const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LATIN = /[A-Za-z]/;

/** The demo as `role`, the way the role picker leaves it (no ?role= in the URL). */
function as(role: string) {
  dom.window.localStorage.setItem('shikhon_demo_role', role);
  return new DemoAuth();
}

async function call(role: string, path: string, init: RequestInit = {}) {
  const res = await as(role).authedFetch(path, init);
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body };
}

const post = (body: unknown): RequestInit =>
  ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function q<T extends Element>(sel: string): T {
  const node = root().querySelector<T>(sel);
  assert.ok(node, `missing ${sel}`);
  return node;
}

function type(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  field.value += text;
  field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function tick(box: HTMLInputElement, on: boolean) {
  box.checked = on;
  box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

const UUID_SECTIONS = {
  sections: [
    { id: '7bd00000-0000-4000-8000-00000000000a', name: 'ক', className: { bn: 'নবম শ্রেণি' } },
    { id: '7bd00000-0000-4000-8000-00000000000b', name: 'খ', className: { bn: 'নবম শ্রেণি' } },
  ],
};

/**
 * The composer on a stub server. `publish` answers the send: a status and a
 * body, or a throw for no connection.
 */
function mount(role: string, publish: () => { status: number; body: unknown }) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  const auth = {
    role, tenantId: 't1', userId: 'u1', displayName: 'পরীক্ষা',
    isLoggedIn: () => true,
    authedFetch: async (path: string) => {
      if (path.includes('preview=1')) {
        return json({ recipients: 30, smsRecipients: 0, segmentsEach: 1, segmentsTotal: 0,
          confirmThreshold: 200, needsConfirmation: false });
      }
      if (path.startsWith('/api/v1/academics/sections')) return json(UUID_SECTIONS);
      const r = publish();
      return json(r.body, r.status);
    },
  };
  new NoticeComposeView({ root: root(), doc: doc(), auth: auth as never });
}

function fill(title = 'অভিভাবক সভা', body = 'শনিবার সকাল ১০টায়।') {
  type(q<HTMLInputElement>('[name="title"]'), title);
  type(q<HTMLTextAreaElement>('[name="body"]'), body);
}

const send = () => q<HTMLButtonElement>('[data-send]');
const result = () => root().querySelector<HTMLElement>('[data-send-result]');

/** The outcome sits in the panel, before Send: where the person who pressed it is. */
function assertBesideSend(node: HTMLElement) {
  const panel = node.closest('.compose-panel');
  assert.ok(panel, 'the outcome is drawn outside the panel that holds Send');
  assert.ok(panel.contains(send()), 'Send is not in the same panel');
  assert.ok(node.compareDocumentPosition(send()) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'the outcome is drawn after Send');
  assert.equal(root().querySelector('.compose-body')!.contains(node), false);
}

/* ── partly 0 / R1: the demo can send ─────────────────────────────────── */

describe('R1 — a class teacher can send a notice in the demo', () => {
  test('the demo accepts a notice to its own sections and keeps their ids; an unknown id is refused', async () => {
    const draft = { title: 'অভিভাবক সভা', body: 'শনিবার সকাল ১০টায়।', category: 'general',
      audience: { type: 'section', ids: ['demo-9a', 'demo-9a'] }, sendSms: false };
    const sent = await call('class_teacher', '/api/v1/ops/notices', post({ notice: draft, publish: true }));
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.status, 'published');
    assert.ok(sent.body.recipients > 0, 'the section reaches its students and guardians');

    const list = await call('class_teacher', '/api/v1/ops/notices');
    const last = list.body.notices[0];
    assert.deepEqual(last.audience, { type: 'section', ids: ['demo-9a'] },
      'the notice keeps the demo’s own section id, once');

    const unknown = await call('class_teacher', '/api/v1/ops/notices', post({
      notice: { ...draft, audience: { type: 'section', ids: ['demo-nope'] } }, publish: true,
    }));
    assert.equal(unknown.status, 400, 'an id the demo does not have is refused, as the service refuses it');
    assert.equal(unknown.body.field, 'audience');
  });

  test('end to end on the demo: tick a section, write, press পাঠান — it is sent, in Bangla', async () => {
    new NoticeComposeView({ root: root(), doc: doc(), auth: as('class_teacher') } as never);
    await wait(30);
    const boxes = [...root().querySelectorAll<HTMLInputElement>('.audience-section input')];
    assert.ok(boxes.length > 0, 'the demo’s sections are listed');
    tick(boxes[0], true);
    fill();
    assert.equal(send().disabled, false);
    send().focus();
    send().click();
    await wait(50);

    const said = result();
    assert.ok(said, 'nothing was said after pressing পাঠান');
    assert.match(said.textContent ?? '', /জনের কাছে পৌঁছেছে/, said.textContent ?? '');
    assert.doesNotMatch(root().textContent ?? '', /every selection|must be an id/);
    assert.deepEqual(errors, []);
  });
});

/* ── R1: no audience ─────────────────────────────────────────────────────── */

describe('R1 — Send waits for a section, and the line beside it says why', () => {
  test('a section notice with none ticked cannot be sent; ticking one enables Send', async () => {
    mount('class_teacher', () => ({ status: 201, body: { status: 'published', recipients: 30 } }));
    await wait(10);
    fill();
    assert.equal(send().disabled, true, 'পাঠান was enabled for a notice addressed to nobody');
    const line = q('[data-audience-line]');
    assert.match(line.textContent ?? '', /অন্তত একটি শাখা বাছাই করুন/);
    const described = (send().getAttribute('aria-describedby') ?? '').split(/\s+/);
    assert.ok(described.includes(line.closest('p')!.id), 'Send is not described by the line that says why');

    const box = q<HTMLInputElement>('.audience-section input');
    tick(box, true);
    assert.equal(send().disabled, false);
    tick(box, false);
    assert.equal(send().disabled, true);
  });
});

/* ── R1: refusals in Bangla, beside Send ──────────────────────────────────── */

describe('R1 — a refusal is Bangla, beside Send, and goes when it is put right', () => {
  test('the server’s English audience refusal: Bangla beside Send, the chips marked, focus on Send', async () => {
    mount('principal', () => ({ status: 403, body: {
      error: 'audience_not_permitted', message: 'one or more of those sections is not yours', field: 'audience',
    } }));
    await wait(10);
    fill();
    send().focus();
    send().click();
    await wait(20);

    const said = result();
    assert.ok(said, 'the refusal is not drawn');
    assertBesideSend(said);
    assert.doesNotMatch(said.textContent ?? '', LATIN, `English on screen: ${said.textContent}`);
    assert.match(said.textContent ?? '', /আপনার নয়/);
    assert.ok(said.querySelector('[role="alert"]') ?? (said.getAttribute('role') === 'alert' ? said : null),
      'the refusal is not announced');
    assert.doesNotMatch(root().textContent ?? '', /not yours/);
    const fieldErr = q('.compose-audience > .ui-field-error');
    assert.equal(fieldErr.textContent, said.querySelector('[role="alert"]')?.textContent);
    assert.equal(q('.audience-chips').getAttribute('aria-describedby'), fieldErr.id);
    assert.equal(doc().activeElement, send(), 'focus did not come back to Send, the retry');
    assert.equal(q<HTMLInputElement>('[name="title"]').value, 'অভিভাবক সভা', 'the typed notice was lost');

    // Choosing again takes the refusal away, on the field and beside Send.
    const chip = [...root().querySelectorAll<HTMLButtonElement>('.audience-chip')]
      .find((c) => c.textContent === 'সব অভিভাবক')!;
    chip.click();
    assert.equal(result(), null);
    assert.equal(root().querySelector('.compose-audience > .ui-field-error'), null);
    assert.equal(q('.audience-chips').hasAttribute('aria-describedby'), false);
  });

  test('the server’s English field refusal for the title is Bangla, and typing takes it away', async () => {
    mount('principal', () => ({ status: 400, body: {
      error: 'invalid_notice', message: 'title must be 200 characters or fewer', field: 'title',
    } }));
    await wait(10);
    fill();
    send().click();
    await wait(20);
    const said = result()!;
    assertBesideSend(said);
    assert.equal(said.textContent, 'শিরোনাম ২০০ অক্ষরের মধ্যে লিখুন।');
    const title = q<HTMLInputElement>('[name="title"]');
    assert.equal(title.getAttribute('aria-invalid'), 'true');
    type(title, 'ক');
    assert.equal(result(), null, 'the refusal stayed while the title was being fixed');
  });

  test('"selects nobody" and a bare 403 are Bangla too', async () => {
    let reply = { status: 400, body: { error: 'invalid_audience', message: 'that audience selects nobody' } as unknown };
    mount('principal', () => reply);
    await wait(10);
    fill();
    send().click();
    await wait(20);
    assert.doesNotMatch(result()!.textContent ?? '', LATIN);
    assert.match(result()!.textContent ?? '', /কেউ নেই/);

    reply = { status: 403, body: { error: 'forbidden', message: 'this endpoint requires one of: principal' } };
    send().click();
    await wait(20);
    assert.equal(result()!.textContent, 'এই কাজটি করার অনুমতি আপনার নেই।');
  });

  test('the validator’s own refusal (a title of control characters) is Bangla, beside Send', async () => {
    let posted = 0;
    mount('principal', () => { posted++; return { status: 201, body: { status: 'published', recipients: 1 } }; });
    await wait(10);
    fill('');
    assert.equal(send().disabled, false);
    send().focus();
    send().click();
    await wait(10);
    assert.equal(posted, 0, 'a refused notice was sent');
    const said = result()!;
    assertBesideSend(said);
    assert.equal(said.textContent, 'শিরোনাম লিখুন।');
    assert.equal(doc().activeElement, send());
  });
});

/* ── R2: focus after a send ────────────────────────────────────────────────── */

describe('R2 — after a send, focus is on what happened, not on <body>', () => {
  for (const keeper of [false, true]) {
    test(`sent${keeper ? ', with the shell’s focus keeper armed' : ''}: focus on the sentence beside Send`, async () => {
      const stop = keeper ? keepFocusWithin(doc().getElementById('shell-view')!) : () => {};
      try {
        mount('principal', () => ({ status: 201, body: { status: 'published', recipients: 128, smsQueued: false } }));
        await wait(10);
        fill();
        send().focus();
        send().click();
        await wait(30);

        const said = result();
        assert.ok(said);
        assert.match(said.textContent ?? '', /১২৮ জনের কাছে পৌঁছেছে/);
        assertBesideSend(said);
        assert.equal(doc().activeElement, said,
          `focus is on ${doc().activeElement?.tagName}, not on what the send came to`);
        assert.equal(send().disabled, true, 'the form is empty for the next notice');
      } finally {
        stop();
      }
    });
  }

  test('offline: the notice is kept, the warning is beside Send, and focus is back on Send', async () => {
    const auth = {
      role: 'principal', tenantId: 't1', userId: 'u1', displayName: 'পরীক্ষা', isLoggedIn: () => true,
      authedFetch: async (path: string) => {
        if (path.startsWith('/api/v1/academics/sections')) {
          return new Response(JSON.stringify(UUID_SECTIONS), { status: 200 });
        }
        throw new TypeError('Failed to fetch');
      },
    };
    new NoticeComposeView({ root: root(), doc: doc(), auth: auth as never });
    await wait(10);
    fill();
    send().focus();
    send().click();
    await wait(20);
    const said = result()!;
    assertBesideSend(said);
    assert.match(said.textContent ?? '', /সংযোগ নেই/);
    assert.equal(doc().activeElement, send());
    assert.equal(q<HTMLTextAreaElement>('[name="body"]').value, 'শনিবার সকাল ১০টায়।');
  });
});

/* ── Review: a past send's outcome is not left above the next notice ────────── */

describe('after a send, starting the next notice takes "… জনের কাছে পৌঁছেছে" away', () => {
  /**
   * A send that reached 128 people, then the author starts the next notice. The
   * panel's own count is 30 (the stub's estimate), so a sentence left beside
   * Send would contradict the figure right above it.
   */
  async function sentOnce(reply: Record<string, unknown> = { status: 'published', recipients: 128, smsQueued: false }) {
    mount('principal', () => ({ status: 201, body: reply }));
    await wait(10);
    fill();
    send().focus();
    send().click();
    await wait(30);
    assert.ok(result(), 'the send outcome is not drawn');
  }

  function assertGone(what: string) {
    assert.equal(result(), null, `after ${what}, the last send's outcome is still beside Send`);
    const panel = q('.compose-panel').textContent ?? '';
    assert.doesNotMatch(panel, /জনের কাছে পৌঁছেছে|নির্ধারিত সময়ে পাঠানো হবে।/, panel);
  }

  test('typing one character into the title', async () => {
    await sentOnce();
    type(q<HTMLInputElement>('[name="title"]'), 'ক');
    assertGone('typing in the title');
  });

  test('typing into the body', async () => {
    await sentOnce();
    type(q<HTMLTextAreaElement>('[name="body"]'), 'ক');
    assertGone('typing in the body');
  });

  test('pressing another audience, then writing the next notice (the reviewer’s steps)', async () => {
    await sentOnce();
    const chip = [...root().querySelectorAll<HTMLButtonElement>('.audience-chip')]
      .find((c) => c.textContent === 'শুধু শিক্ষক ও কর্মকর্তা')!;
    chip.click();
    assertGone('pressing an audience chip');
    fill('কর্মী সভা', 'রবিবার বিকেলে।');
    await wait(450);
    assertGone('writing the next notice');
    assert.equal(send().disabled, false);
  });

  test('ticking a section', async () => {
    mount('principal', () => ({ status: 201, body: { status: 'published', recipients: 128 } }));
    await wait(10);
    [...root().querySelectorAll<HTMLButtonElement>('.audience-chip')]
      .find((c) => c.dataset.audience === 'section')!.click();
    tick(q<HTMLInputElement>('.audience-section input'), true);
    fill();
    send().focus();
    send().click();
    await wait(30);
    assert.ok(result());
    tick(q<HTMLInputElement>('.audience-section input'), true);
    assertGone('ticking a section');
  });

  test('changing ধরন', async () => {
    await sentOnce();
    const cat = q<HTMLSelectElement>('select[name="category"]');
    cat.value = 'exam';
    cat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assertGone('changing the category');
  });

  test('turning SMS on', async () => {
    await sentOnce();
    tick(q<HTMLInputElement>('[data-sms-toggle]'), true);
    assertGone('the SMS toggle');
  });

  test('choosing a time — the panel is rebuilt, and the old sentence is not carried into it', async () => {
    await sentOnce({ status: 'scheduled', recipients: 0 });
    assert.match(result()!.textContent ?? '', /নির্ধারিত সময়ে পাঠানো হবে।/);
    const at = q<HTMLInputElement>('[name="publishAt"]');
    at.value = '2026-09-20T10:00';
    at.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(send().textContent?.includes('নির্ধারিত সময়ে পাঠান'), true, 'the panel was not rebuilt');
    assertGone('choosing a time');
  });

  test('guard: an offline warning stays while the notice is edited — Send is its retry', async () => {
    const auth = {
      role: 'principal', tenantId: 't1', userId: 'u1', displayName: 'পরীক্ষা', isLoggedIn: () => true,
      authedFetch: async (path: string) => {
        if (path.startsWith('/api/v1/academics/sections')) {
          return new Response(JSON.stringify(UUID_SECTIONS), { status: 200 });
        }
        throw new TypeError('Failed to fetch');
      },
    };
    new NoticeComposeView({ root: root(), doc: doc(), auth: auth as never });
    await wait(10);
    fill();
    send().click();
    await wait(20);
    type(q<HTMLInputElement>('[name="title"]'), 'ক');
    tick(q<HTMLInputElement>('[data-sms-toggle]'), true);
    assert.match(result()?.textContent ?? '', /সংযোগ নেই/, 'the offline warning went before the retry');
  });
});

/* ── R10: the rollover reason ──────────────────────────────────────────────── */

describe('R10 — the rollover demo names the class in Bangla', () => {
  test('every blocked reason says "নবম শ্রেণিতে", with no Latin figure', async () => {
    const r = await call('it_admin', '/api/v1/ops/rollover');
    const blocked = (r.body.students as Array<{ action: string; blockerBn: string | null }>)
      .filter((s) => s.action === 'blocked');
    assert.ok(blocked.length > 0);
    for (const s of blocked) {
      assert.doesNotMatch(s.blockerBn ?? '', /[0-9]/, `Latin figure in "${s.blockerBn}"`);
      assert.match(s.blockerBn ?? '', /^নবম শ্রেণিতে "খ" শাখা/);
    }
  });
});

/* ── R11: the teachers' register for a family ─────────────────────────────── */

describe('R11 — a family reading the teachers’ register is not told the school has no teachers', () => {
  for (const role of ['guardian', 'student']) {
    test(`${role}: the service's empty register, and a sentence that is true for them`, async () => {
      const r = await call(role, '/api/v1/ops/staff-attendance');
      assert.equal(r.status, 200, 'the GET is not role-gated in the service');
      assert.deepEqual(r.body.teachers, []);
      assert.equal(r.body.canMark, false);

      new StaffAttendanceView({ root: root(), doc: doc(), auth: as(role) } as never);
      await wait(40);
      const text = root().textContent ?? '';
      assert.doesNotMatch(text, /কোনো শিক্ষক যোগ করা হয়নি/, 'a false claim about the school');
      assert.match(text, /শিক্ষকদের হাজিরা এই অ্যাকাউন্ট থেকে দেখা যায় না।/);
    });
  }

  test('staff with a register that really is empty are still told no teachers have been added', async () => {
    const auth = {
      role: 'principal', tenantId: 't1', userId: 'u1', isLoggedIn: () => true,
      authedFetch: async () => new Response(JSON.stringify({
        date: '2026-09-14', canMark: true, total: 0, marked: 0, away: 0, teachers: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    };
    new StaffAttendanceView({ root: root(), doc: doc(), auth: auth as never });
    await wait(20);
    assert.match(root().textContent ?? '', /এই প্রতিষ্ঠানে এখনো কোনো শিক্ষক যোগ করা হয়নি।/);
  });

  test('a principal in the demo gets the register, not an empty state', async () => {
    new StaffAttendanceView({ root: root(), doc: doc(), auth: as('principal') } as never);
    await wait(40);
    const text = root().textContent ?? '';
    assert.doesNotMatch(text, /দেখা যায় না|কোনো শিক্ষক যোগ করা হয়নি/);
    assert.ok(root().querySelector('.staff-att-table'), 'no register drawn');
  });
});
