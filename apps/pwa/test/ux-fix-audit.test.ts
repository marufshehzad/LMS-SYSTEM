/**
 * UX sweep — the audit viewer (group audit).
 *
 * Findings 39 and 40 are about focus on #/audit: opening a row, changing a
 * filter, removing a chip, typing a date. Inside the app the view sits in the
 * shell's `main#shell-view`, which `keepFocusWithin` watches, so every test
 * here mounts the view the same way — a fix that only works without the
 * shell's keeper, or only because of it, is not the fix that ships.
 *
 * Finding 41 is the diff: no raw English key, no raw code, no record id.
 */
import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AuditView } from '../src/audit-view.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';
import { closeAllOverlays } from '../src/ui/overlay.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const active = () => doc().activeElement as HTMLElement | null;

before(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, 'localStorage',
    { value: dom.window.localStorage, configurable: true });
});

let stopKeeper: () => void = () => {};
afterEach(() => {
  closeAllOverlays();
  stopKeeper();
  delete (dom.window as unknown as Record<string, unknown>).matchMedia;
});

const UUID = (n: number) => `7b06d000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-/i;

const ENTRY = (over: Record<string, unknown> = {}) => ({
  id: 'e1', at: '2026-08-28T09:12:00Z',
  actor: { id: 'p1', nameBn: 'প্রধান শিক্ষক', role: 'principal' },
  action: 'ops.guardian.permissions', entityType: 'guardianship', entityId: 'l1',
  before: { canPayFees: true }, after: { canPayFees: false },
  ...over,
});

const FACETS = {
  actions: [
    { value: 'ops.guardian.permissions', count: 2 },
    { value: 'ops.settings.update', count: 1 },
  ],
  entityTypes: [{ value: 'guardianship', count: 2 }, { value: 'tenant', count: 1 }],
  actors: [{ id: 'p1', nameBn: 'প্রধান শিক্ষক', count: 3 }],
};

/**
 * Mount like the shell does: the view's root inside `main#shell-view`, with
 * the shell's focus keeper armed on main. `respond` answers each request.
 */
function mount(respond: (url: string) => unknown = () => ({
  entries: [ENTRY(), ENTRY({ id: 'e2', at: '2026-08-27T09:12:00Z' })],
  facets: FACETS, hasMore: false,
})) {
  doc().body.innerHTML = '<main id="shell-view"><div id="view"></div></main>';
  const main = doc().getElementById('shell-view') as HTMLElement;
  const root = doc().getElementById('view') as HTMLElement;
  stopKeeper = keepFocusWithin(main);
  const urls: string[] = [];
  const auth = {
    tenantId: 't-1',
    authedFetch: async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => respond(url) } as unknown as Response;
    },
  };
  new AuditView({ root, doc: doc(), auth: auth as never });
  return { root, main, urls };
}

const fire = (node: Element, type: string) =>
  node.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
const key = (node: Element, k: string, init: KeyboardEventInit = {}) =>
  node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => {
  const n = root.querySelector<T>(sel as never);
  assert.ok(n, `expected ${sel}`);
  return n as T;
};

async function chooseFilter(root: HTMLElement, name: string, value: string): Promise<void> {
  const sel = q<HTMLSelectElement>(root, `.ui-filters-inline select[name="${name}"]`);
  sel.value = value;
  fire(sel, 'change');
  await settle();
}

/* ── 39: a row opens and closes in place ──────────────────────────────── */

describe('finding 39 — opening a log row keeps focus on it', () => {
  test('Enter on a row opens it on the SAME button, which keeps focus and says it is open', async () => {
    const { root } = mount();
    await settle();
    const head = q(root, '.audit-head');
    const row = head.parentElement as HTMLElement;
    head.focus();

    head.click();
    await settle();
    assert.ok(head.isConnected, 'the button that was pressed must not be rebuilt');
    assert.equal(active(), head, 'focus stays on the row, not <body> or the page');
    assert.equal(head.getAttribute('aria-expanded'), 'true',
      'the change is on the focused button, so a screen reader announces it');
    assert.equal(row.querySelectorAll('.audit-diff').length, 1, 'the answer opens under the row');

    head.click();
    await settle();
    assert.equal(active(), head);
    assert.equal(head.getAttribute('aria-expanded'), 'false', 'a second press closes it');
    assert.equal(row.querySelectorAll('.audit-diff').length, 0);

    head.click();
    await settle();
    assert.equal(head.getAttribute('aria-expanded'), 'true', 'and a third opens it again');
    assert.equal(row.querySelectorAll('.audit-diff').length, 1, 'with exactly one diff');
  });

  test('the next row is still the next thing in the list, and rows carry their id', async () => {
    const { root } = mount();
    await settle();
    const [first, second] = [...root.querySelectorAll<HTMLElement>('.audit-head')];
    first.focus();
    first.click();
    await settle();
    const heads = [...root.querySelectorAll<HTMLElement>('.audit-head')];
    assert.equal(heads[0], first);
    assert.equal(heads[1], second, 'the second row was not rebuilt either');
    assert.deepEqual(
      [...root.querySelectorAll<HTMLElement>('.audit-row')].map((r) => r.dataset.id),
      ['e1', 'e2'], 'the row identity the shell keeper matches on after a real rebuild');
  });

  test('an open row stays open when the list is rebuilt for another reason', async () => {
    const { root } = mount();
    await settle();
    q(root, '.audit-head').click();
    await chooseFilter(root, 'actorId', 'p1');
    assert.equal(q(root, '.audit-head').getAttribute('aria-expanded'), 'true');
    assert.equal(root.querySelectorAll('.audit-diff').length, 1);
  });
});

/* ── 40: filter changes keep a keyboard user's place ──────────────────── */

describe('finding 40 — a filter change does not lose focus', () => {
  test('changing a desktop select: focus is on the rebuilt select (shell keeper)', async () => {
    const { root, urls } = mount();
    await settle();
    const sel = q<HTMLSelectElement>(root, '.ui-filters-inline select[name="action"]');
    sel.focus();
    sel.value = 'ops.settings.update';
    fire(sel, 'change');
    await settle();
    assert.ok(urls.some((u) => u.includes('action=ops.settings.update')));
    const now = active();
    assert.notEqual(now, sel, 'the panel was rebuilt');
    assert.equal(now, root.querySelector('.ui-filters-inline select[name="action"]'));
  });

  test('removing the only chip puts focus on that filter\'s own select, not the page', async () => {
    const { root, main } = mount();
    await settle();
    await chooseFilter(root, 'action', 'ops.settings.update');
    const chip = q(root, '.ui-filter-chip');
    chip.focus();
    chip.click();
    await settle();
    const now = active();
    assert.notEqual(now, doc().body);
    assert.notEqual(now, main, 'parked on main#shell-view is lost focus too');
    assert.equal(now, root.querySelector('.ui-filters-inline select[name="action"]'));
    assert.equal((now as HTMLSelectElement).value, '', 'and it now reads "সব ধরনের কাজ"');
  });

  test('on a phone the same removal lands on the ছাঁকনি button', async () => {
    (dom.window as unknown as Record<string, unknown>).matchMedia =
      (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} });
    const { root } = mount();
    await settle();
    await chooseFilter(root, 'entityType', 'tenant');
    const chip = q(root, '.ui-filter-chip');
    chip.focus();
    chip.click();
    await settle();
    assert.equal(active(), root.querySelector('.ui-filters-open'));
  });

  test('removing one of two chips moves to the chip that took its place', async () => {
    const { root } = mount();
    await settle();
    await chooseFilter(root, 'actorId', 'p1');
    await chooseFilter(root, 'action', 'ops.settings.update');
    const chips = [...root.querySelectorAll<HTMLElement>('.ui-filter-chip')];
    assert.equal(chips.length, 2);
    chips[0].focus();
    chips[0].click();
    await settle();
    const left = [...root.querySelectorAll<HTMLElement>('.ui-filter-chip')];
    assert.equal(left.length, 1);
    assert.equal(active(), left[0]);
    assert.match(left[0].getAttribute('aria-label') ?? '', /^কাজ:/);
  });

  test('removing the last of two chips moves on to "সব সরান"', async () => {
    const { root } = mount();
    await settle();
    await chooseFilter(root, 'actorId', 'p1');
    await chooseFilter(root, 'action', 'ops.settings.update');
    const chips = [...root.querySelectorAll<HTMLElement>('.ui-filter-chip')];
    chips[1].focus();
    chips[1].click();
    await settle();
    assert.equal(active(), root.querySelector('.ui-filter-clear'));
  });

  test('"সব সরান" puts focus on the first filter control', async () => {
    const { root } = mount();
    await settle();
    await chooseFilter(root, 'action', 'ops.settings.update');
    const clear = q(root, '.ui-filter-clear');
    clear.focus();
    clear.click();
    await settle();
    assert.equal(root.querySelectorAll('.ui-filter-chip').length, 0);
    assert.equal(active(), root.querySelector('.ui-filters-inline select'));
    assert.equal(active()?.getAttribute('name'), 'actorId');
  });

  test('the empty result\'s "ফিল্টার মুছুন" puts focus on the first filter control', async () => {
    const { root } = mount((url) => (url.includes('action=')
      ? { entries: [], facets: FACETS, hasMore: false }
      : { entries: [ENTRY()], facets: FACETS, hasMore: false }));
    await settle();
    await chooseFilter(root, 'action', 'ops.settings.update');
    const clear = q(root, '.ui-state-empty .ui-state-action');
    clear.focus();
    clear.click();
    await settle();
    assert.equal(active(), root.querySelector('.ui-filters-inline select[name="actorId"]'));
  });

  test('closing the phone sheet after a change returns focus to the rebuilt ছাঁকনি button', async () => {
    const { root } = mount();
    await settle();
    const opener = q(root, '.ui-filters-open');
    opener.focus();
    opener.click();
    const sheetSelect = q<HTMLSelectElement>(doc(), '.ui-dialog select[name="action"]');
    sheetSelect.value = 'ops.settings.update';
    fire(sheetSelect, 'change');
    await settle();
    assert.equal(opener.isConnected, false, 'the panel behind the sheet was rebuilt');
    key(doc().activeElement ?? doc().body, 'Escape');
    await settle();
    assert.equal(doc().querySelector('.ui-dialog'), null);
    const now = active();
    assert.equal(now, root.querySelector('.ui-filters-open'));
    assert.match(now?.getAttribute('aria-label') ?? '', /১টি চালু/, 'the new button, with the count');
  });

  describe('a typed date applies when it is finished', () => {
    test('typing does not apply a half-typed year or rebuild the field under the fingers', async () => {
      const { root, urls } = mount();
      await settle();
      const from = q<HTMLInputElement>(root, 'input[name="from"]');
      from.focus();
      // Chrome: "1","7","0","9" fill day and month; the first year digit
      // already makes a valid value and fires change.
      key(from, '2');
      from.value = '0002-09-17';
      fire(from, 'input');
      fire(from, 'change');
      await settle();
      assert.ok(!urls.some((u) => u.includes('from=')), 'year 2 must not be applied');
      assert.equal(root.querySelector('input[name="from"]'), from, 'the field was not rebuilt');
      assert.equal(active(), from);

      for (const [k, v] of [['0', '0020-09-17'], ['2', '0202-09-17'], ['6', '2026-09-17']]) {
        key(from, k);
        from.value = v;
        fire(from, 'input');
        fire(from, 'change');
      }
      await settle();
      assert.ok(!urls.some((u) => u.includes('from=')));

      // Tab away: the finished date applies once.
      const to = q<HTMLInputElement>(root, 'input[name="to"]');
      to.focus();
      await settle();
      const applied = urls.filter((u) => u.includes('from='));
      assert.equal(applied.length, 1, `one request, got ${applied.join(' | ')}`);
      assert.match(applied[0], /from=2026-09-17/);
      assert.equal(active(), root.querySelector('input[name="to"]'),
        'focus went where Tab sent it, on the rebuilt পর্যন্ত field');
    });

    test('Enter applies a typed date, and focus stays on the date', async () => {
      const { root, urls } = mount();
      await settle();
      const from = q<HTMLInputElement>(root, 'input[name="from"]');
      from.focus();
      key(from, '6');
      from.value = '2026-09-17';
      fire(from, 'change');
      await settle();
      assert.ok(!urls.some((u) => u.includes('from=')));
      key(from, 'Enter');
      await settle();
      assert.ok(urls.some((u) => u.includes('from=2026-09-17')));
      assert.equal(active(), root.querySelector('input[name="from"]'));
    });

    test('a date picked from the calendar (no keystroke) still applies at once', async () => {
      const { root, urls } = mount();
      await settle();
      const to = q<HTMLInputElement>(root, 'input[name="to"]');
      to.value = '2026-08-31';
      fire(to, 'change');
      await settle();
      assert.ok(urls.some((u) => u.includes('to=2026-08-31')));
      assert.equal(q<HTMLInputElement>(root, 'input[name="to"]').value, '2026-08-31');
    });

    test('leaving without a change sends nothing', async () => {
      const { root, urls } = mount();
      await settle();
      const before = urls.length;
      const from = q<HTMLInputElement>(root, 'input[name="from"]');
      from.focus();
      key(from, 'ArrowRight');
      from.blur();
      await settle();
      assert.equal(urls.length, before);
    });
  });

  test('the dates\' own "ফিল্টার মুছুন" puts focus back on থেকে', async () => {
    const { root } = mount();
    await settle();
    const from = q<HTMLInputElement>(root, 'input[name="from"]');
    from.value = '2026-08-01';
    fire(from, 'change');
    await settle();
    const clear = q(root, '.audit-clear');
    clear.focus();
    clear.click();
    await settle();
    assert.equal(root.querySelector('.audit-clear'), null);
    assert.equal(active(), root.querySelector('input[name="from"]'));
    assert.equal((active() as HTMLInputElement).value, '');
  });
});

/* ── 41: the diff is in words ─────────────────────────────────────────── */

describe('finding 41 — the diff shows no raw key, code or record id', () => {
  /** Open every row and return each diff's text, by entry id. */
  async function diffs(entries: unknown[]): Promise<Record<string, string>> {
    const { root } = mount(() => ({ entries, facets: FACETS, hasMore: false }));
    await settle();
    for (const head of root.querySelectorAll<HTMLElement>('.audit-head')) head.click();
    await settle();
    const out: Record<string, string> = {};
    for (const row of root.querySelectorAll<HTMLElement>('.audit-row')) {
      const diff = row.querySelector('.audit-diff');
      assert.ok(diff, `row ${row.dataset.id} opened`);
      out[row.dataset.id!] = diff.textContent ?? '';
      for (const n of diff.querySelectorAll('[aria-label],[title]')) {
        assert.doesNotMatch((n.getAttribute('aria-label') ?? '') + (n.getAttribute('title') ?? ''),
          UUID_RE);
      }
    }
    return out;
  }

  test('a class-teacher change (ops-svc/api/assign.ts): names and a Bangla date, no ids', async () => {
    const t = await diffs([ENTRY({
      id: 'a', action: 'academic.subject_teacher.assign', entityType: 'section',
      before: { teacherId: UUID(1), nameBn: 'রহিম স্যার' },
      after: { teacherId: UUID(2), nameBn: 'করিম স্যার', subjectId: UUID(3),
        effective: '2026-08-27', reason: 'বদলি হয়েছেন' },
    })]);
    assert.doesNotMatch(t.a, UUID_RE, 'no uuid, in any shape');
    assert.doesNotMatch(t.a, /teacherId|subjectId|effective/);
    assert.match(t.a, /রহিম স্যার → করিম স্যার/);
    assert.match(t.a, /কার্যকর তারিখ/);
    assert.doesNotMatch(t.a, /2026-08-27/, 'an ISO date is not how a date is read');
    assert.match(t.a, /২৭/);
    assert.match(t.a, /বদলি হয়েছেন/);
  });

  test('the preview\'s demo ids are hidden by key, not only by uuid shape', async () => {
    const t = await diffs([ENTRY({
      id: 'd', action: 'academic.class_teacher.assign', entityType: 'section',
      before: { teacherId: 'demo-t1', nameBn: 'রহিম স্যার' },
      after: { teacherId: 'demo-t2', nameBn: 'করিম স্যার' },
    })]);
    assert.doesNotMatch(t.d, /demo-t/);
    assert.match(t.d, /রহিম স্যার → করিম স্যার/);
  });

  test('a new section: শিফট সকাল, and no class or year id', async () => {
    const t = await diffs([ENTRY({
      id: 's', action: 'academic.section.create', entityType: 'section', before: null,
      after: { name: 'G', classId: UUID(4), yearId: UUID(5), shift: 'morning', capacity: 55 },
    })]);
    assert.match(t.s, /শিফট/);
    assert.match(t.s, /সকাল/);
    assert.doesNotMatch(t.s, /shift|morning|classId|yearId/);
    assert.doesNotMatch(t.s, UUID_RE);
    assert.match(t.s, /ধারণক্ষমতা/);
  });

  test('a new user: the role in words, the masked phone as sent', async () => {
    const t = await diffs([ENTRY({
      id: 'u', action: 'ops.user.create', entityType: 'user', before: null,
      after: { nameBn: 'নতুন শিক্ষক', roleCode: 'subject_teacher', phone: '•••47' },
    })]);
    assert.match(t.u, /ভূমিকা/);
    assert.match(t.u, /বিষয় শিক্ষক/);
    assert.doesNotMatch(t.u, /subject_teacher|phone/);
    assert.match(t.u, /ফোন/);
    assert.match(t.u, /•••47/, 'a redacted identifier stays exactly as the server sent it');
  });

  test('a lesson given another teacher and room — ids only — says what changed, in words', async () => {
    const t = await diffs([ENTRY({
      id: 'x', action: 'rms.slot.assign', entityType: 'routine_slot',
      before: { subjectId: UUID(6), teacherId: UUID(7), roomId: UUID(8) },
      after: { subjectId: UUID(6), teacherId: UUID(9), roomId: UUID(10) },
    })]);
    assert.doesNotMatch(t.x, UUID_RE);
    assert.doesNotMatch(t.x, /[A-Za-z]/, 'no English at all');
    assert.match(t.x, /শিক্ষক ও কক্ষ বদলেছে/);
    assert.doesNotMatch(t.x, /বিষয়/, 'the subject did not change');
    assert.doesNotMatch(t.x, /কোনো মান পরিবর্তিত হয়নি/, 'something DID change');
  });

  test('status reads by record: attendance, user, routine', async () => {
    const t = await diffs([
      ENTRY({
        id: 'att', action: 'ops.staff_attendance.mark', entityType: 'teacher_attendance',
        before: { status: 'present', reason: null },
        after: { status: 'on_leave', reason: 'অসুস্থ', date: '2026-09-01' },
      }),
      ENTRY({
        id: 'usr', action: 'ops.user.deactivate', entityType: 'user',
        before: { status: 'active' }, after: { status: 'left', sessionsRevoked: 2 },
      }),
      ENTRY({
        id: 'rt', action: 'rms.routine.submit', entityType: 'routine',
        after: { status: 'review', fromStatus: 'draft' },
      }),
    ]);
    assert.match(t.att, /উপস্থিত → ছুটি/);
    assert.doesNotMatch(t.att, /present|on_leave|2026-09-01/);
    assert.match(t.usr, /সক্রিয় → নিষ্ক্রিয়/);
    assert.match(t.usr, /বন্ধ হওয়া সেশন/);
    assert.match(t.rt, /পর্যালোচনায়/);
    assert.match(t.rt, /খসড়া/);
    assert.doesNotMatch(t.usr + t.rt, /[A-Za-z]/);
  });

  test('routine edits: a day by name, a warning list by count, a re-solve scope in words', async () => {
    const t = await diffs([
      ENTRY({
        id: 'mv', action: 'rms.slot.move', entityType: 'routine_slot',
        before: { dayOfWeek: 0, periodNo: 2 }, after: { dayOfWeek: 1, periodNo: 3 },
      }),
      ENTRY({
        id: 'pub', action: 'rms.routine.publish', entityType: 'routine',
        after: { status: 'active', fromStatus: 'review', version: 3, slots: 240,
          hardConflicts: 0, warnings: ['teacher_overload', 'room_gap'],
          supersededId: UUID(11), supersededVersion: 2 },
      }),
      ENTRY({
        id: 'rs', action: 'rms.routine.resolve', entityType: 'routine',
        before: { scope: { kind: 'teacher', teacherId: UUID(12) }, affected: 6 },
        after: { moved: 5, lost: 1 },
      }),
      ENTRY({
        id: 'un', action: 'rms.slot.undo', entityType: 'routine_slot',
        before: { undidAction: 'move', labelBn: 'গণিত সরানো' },
      }),
    ]);
    assert.match(t.mv, /রবিবার → সোমবার/);
    assert.match(t.pub, /সতর্কতা/);
    assert.match(t.pub, /২টি/);
    assert.doesNotMatch(t.pub, /teacher_overload|supersededId/);
    assert.doesNotMatch(t.pub, UUID_RE);
    assert.match(t.pub, /প্রকাশিত/);
    assert.match(t.rs, /একজন শিক্ষকের ক্লাস/);
    assert.doesNotMatch(t.rs, /object Object/);
    assert.doesNotMatch(t.rs, UUID_RE);
    assert.match(t.un, /ক্লাস সরানো/);
    for (const id of ['mv', 'pub', 'rs', 'un']) assert.doesNotMatch(t[id], /[A-Za-z]/, id);
  });

  test('guardians, enrolment, sessions, rooms, fees, calendar, export: no English key or code', async () => {
    const t = await diffs([
      ENTRY({
        id: 'gl', action: 'ops.guardian.link', entityType: 'guardianship',
        after: { studentId: UUID(13), guardianId: UUID(14), relation: 'mother',
          isPrimary: false, receivesSms: true, canPayFees: true, createdGuardian: true },
      }),
      ENTRY({
        // guardians.ts:226-232 — names before, the revocation time and reason after.
        id: 'gr', action: 'ops.guardian.revoke', entityType: 'guardianship',
        before: { student: 'রাফি', guardian: 'সালমা বেগম', relation: 'mother', isPrimary: true },
        after: { revokedAt: '2026-09-01T04:30:00.000Z', reason: 'ভুল নম্বর' },
      }),
      ENTRY({
        id: 'en', action: 'academic.enrolment.move', entityType: 'section',
        before: { count: 40 }, after: { count: 42, moved: 2, studentIds: [UUID(15), UUID(16)] },
      }),
      ENTRY({
        id: 'se', action: 'identity.session.revoke', entityType: 'session',
        after: { device: UUID(17), sessions: 1, scope: 'one' },
      }),
      ENTRY({
        id: 'ro', action: 'academic.room.create', entityType: 'room',
        after: { code: 'R-101', nameBn: 'ল্যাব', building: 'প্রধান ভবন', floorNo: 2,
          capacity: 40, capabilities: ['physics_lab'] },
      }),
      ENTRY({
        id: 'fs', action: 'finance.fee_structure.create', entityType: 'fee_structure',
        after: { head: 'মাসিক বেতন', frequency: 'monthly', classId: UUID(18), amount: 1200,
          dueDayOfMonth: 10, lateFeePerDay: null, lateFeeCap: null },
      }),
      ENTRY({
        id: 'pay', action: 'finance.payment.record', entityType: 'payment_receipt',
        after: { receiptNo: 'RC-2026-0042', invoiceNo: 'INV-0042', amount: 500,
          method: 'bkash', reference: null, invoiceStatus: 'partly_paid', ledgerPosted: true },
      }),
      ENTRY({
        id: 'cal', action: 'academic.calendar.create', entityType: 'calendar_day',
        after: { day: '2026-12-16', kind: 'holiday', titleBn: 'বিজয় দিবস', notified: 300 },
      }),
      ENTRY({
        id: 'ex', action: 'ops.data.export', entityType: 'export',
        after: { dataset: 'students', rows: 600 },
      }),
      ENTRY({
        id: 'cls', action: 'academic.class.create', entityType: 'class',
        after: { levelNo: 9, nameBn: 'নবম শ্রেণি', stream: 'bangla_medium', group: 'science' },
      }),
    ]);
    assert.match(t.gl, /মা/);
    assert.match(t.gr, /বাতিলের সময়/);
    assert.match(t.gr, /সালমা বেগম → —/);
    assert.doesNotMatch(t.gr, /revokedAt|2026-09-01|T04/);
    assert.match(t.en, /৪০ → ৪২/);
    assert.match(t.se, /একটি যন্ত্র/);
    assert.match(t.ro, /পদার্থবিজ্ঞান ল্যাব/);
    assert.match(t.fs, /প্রতি মাসে/);
    assert.match(t.pay, /বিকাশ/);
    assert.match(t.pay, /আংশিক পরিশোধিত/);
    assert.match(t.pay, /RC-2026-0042/, 'a receipt number is an identifier and stays Latin');
    assert.match(t.cal, /ছুটি/);
    assert.match(t.ex, /শিক্ষার্থীর তালিকা/);
    assert.match(t.cls, /বাংলা মাধ্যম/);
    assert.match(t.cls, /বিজ্ঞান/);
    for (const [id, text] of Object.entries(t)) {
      assert.doesNotMatch(text, UUID_RE, id);
      // Identifiers the school reads (receipt, invoice, room code) are the
      // only Latin letters allowed.
      const english = text.replace(/RC-2026-0042|INV-0042|R-101/g, '');
      assert.doesNotMatch(english, /[A-Za-z]/, `${id}: ${text}`);
    }
  });
});
