/**
 * The homework inbox filter — F-808, wireframe §6.6.
 *
 * A student with twenty assignments across a term opens this screen to
 * answer one question: "what do I still owe?" The three buckets are what
 * answer it, and the bucketing rule is easy to get subtly wrong — a
 * submitted-but-ungraded assignment is neither pending nor graded, and
 * putting it in either place is a lie the student acts on.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AssignmentsView } from '../src/assignments-view.ts';

let dom: JSDOM;

before(() => {
  // A url is required: without one jsdom has an opaque origin and
  // localStorage throws, which the view uses for its offline cache.
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
                  { url: 'http://localhost/' });
  (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
  (globalThis as Record<string, unknown>).KeyboardEvent = dom.window.KeyboardEvent;
  // localStorage and location are getter-only on globalThis in newer Node,
  // so plain assignment throws and takes the whole hook with it.
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
});

const soon = () => new Date(Date.now() + 2 * 864e5).toISOString();

const assignment = (id: string, sub: null | { gradedAt: string | null }) => ({
  id, titleBn: id, dueAt: soon(), status: 'open', maxMarks: '20',
  subjectBn: 'গণিত', sectionName: 'ক', submissionCount: sub ? 1 : 0,
  ungradedCount: sub && !sub.gradedAt ? 1 : 0,
  mySubmission: sub ? { submittedAt: soon(), marksAwarded: null, gradedAt: sub.gradedAt } : null,
});

/** Mounts the view with a stubbed auth that returns a fixed list. */
function mount(list: unknown[]) {
  const root = dom.window.document.getElementById('root')!;
  root.textContent = '';
  const auth = {
    role: 'student',
    authedFetch: async () => ({
      ok: true, status: 200, json: async () => ({ assignments: list }),
    }),
  } as never;
  return { root, view: new AssignmentsView({ root, doc: dom.window.document, auth, outbox: null as never }) };
}

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

/** Mounts a student view whose auth answers both the list and one detail. */
function mountWithDetail(id: string) {
  const root = dom.window.document.getElementById('root')!;
  root.textContent = '';
  const ops: Array<Record<string, unknown>> = [];
  const auth = {
    role: 'student', userId: 's-1',
    authedFetch: async (url: string) => ({
      ok: true, status: 200,
      json: async () =>
        url.includes('assignmentId=')
          ? {
              assignment: {
                id, titleBn: 'গণিত ৪.২', instructionsBn: 'করো', maxMarks: '20',
                dueAt: soon(), allowsLate: true, status: 'open',
                subjectBn: 'গণিত', sectionName: 'ক',
              },
              submissions: [],
            }
          : { assignments: [assignment(id, null)] },
    }),
  } as never;
  const outbox = {
    enqueue: async (i: Record<string, unknown>) => { ops.push(i); return { opId: `op-${ops.length}` }; },
    flush: async () => {},
  } as never;
  return { root, ops, view: new AssignmentsView({ root, doc: dom.window.document, auth, outbox }) };
}

describe('homework draft autosave (F-902, §6.6)', () => {
  test('THE ONE THAT MATTERS — a typed answer survives a reload', async () => {
    localStorage.clear();
    const first = mountWithDetail('hw-1');
    await settle();
    (first.root.querySelector('table.ui-table tbody .ui-row-open') as HTMLElement).click();
    await settle();

    const ta = first.root.querySelector('.assign-answer') as HTMLTextAreaElement;
    ta.value = 'আমার উত্তর ১';
    ta.dispatchEvent(new dom.window.Event('input'));

    assert.equal(localStorage.getItem('shikhon_assign_draft_hw-1'), 'আমার উত্তর ১',
      'the draft is persisted on every keystroke');
    assert.match(first.root.querySelector('.assign-draft-status')?.textContent ?? '', /সংরক্ষিত/);

    // A brand-new view instance is a page reload: the answer must come back.
    const again = mountWithDetail('hw-1');
    await settle();
    (again.root.querySelector('table.ui-table tbody .ui-row-open') as HTMLElement).click();
    await settle();
    assert.equal((again.root.querySelector('.assign-answer') as HTMLTextAreaElement).value,
      'আমার উত্তর ১', 'the draft is restored after reload');
  });

  test('submitting clears the draft so a stale copy cannot resurrect', async () => {
    localStorage.clear();
    const { root, ops } = mountWithDetail('hw-2');
    await settle();
    (root.querySelector('table.ui-table tbody .ui-row-open') as HTMLElement).click();
    await settle();
    const ta = root.querySelector('.assign-answer') as HTMLTextAreaElement;
    ta.value = 'জমা দেওয়ার উত্তর';
    ta.dispatchEvent(new dom.window.Event('input'));
    assert.ok(localStorage.getItem('shikhon_assign_draft_hw-2'));

    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'জমা দাও') as HTMLButtonElement).click();
    await settle();
    assert.equal(ops.length, 1, 'the answer is queued to the outbox');
    assert.equal(localStorage.getItem('shikhon_assign_draft_hw-2'), null, 'and the draft is cleared');
  });

  test('emptying the field clears the saved draft, so a blank is not "restored"', async () => {
    localStorage.clear();
    const { root } = mountWithDetail('hw-3');
    await settle();
    (root.querySelector('table.ui-table tbody .ui-row-open') as HTMLElement).click();
    await settle();
    const ta = root.querySelector('.assign-answer') as HTMLTextAreaElement;
    ta.value = 'কিছু';
    ta.dispatchEvent(new dom.window.Event('input'));
    assert.ok(localStorage.getItem('shikhon_assign_draft_hw-3'));
    ta.value = '';
    ta.dispatchEvent(new dom.window.Event('input'));
    assert.equal(localStorage.getItem('shikhon_assign_draft_hw-3'), null);
  });
});

describe('homework inbox filter', () => {
  test('the three buckets are mutually exclusive and cover every assignment', async () => {
    // Never-submitted, submitted-awaiting-marks, and graded. The middle one
    // is the case that gets miscounted.
    const list = [
      assignment('pending-1', null),
      assignment('pending-2', null),
      assignment('awaiting', { gradedAt: null }),
      assignment('graded', { gradedAt: new Date().toISOString() }),
    ];
    const { root } = mount(list);
    await new Promise((r) => setTimeout(r, 0));

    // P6 moved this onto the P2 tab strip, which renders each count in its
    // own `.ui-tab-count` rather than folding it into an `aria-label`.
    const tabsFound = [...root.querySelectorAll('.ui-tab')];
    assert.equal(tabsFound.length, 3, 'three buckets, always visible');

    const nums = tabsFound.map((b) => b.querySelector('.ui-tab-count')?.textContent ?? '০');
    const toLatin = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
    const [pending, submitted, graded] = nums.map((n) => Number(toLatin(n)));
    assert.equal(pending, 2, 'two never submitted');
    assert.equal(submitted, 1, 'one submitted and awaiting marks');
    assert.equal(graded, 1, 'one graded');
    assert.equal(pending + submitted + graded, list.length, 'buckets cover everything exactly once');
  });

  test('pending is the default — the question the screen exists to answer', async () => {
    const { root } = mount([assignment('a', null)]);
    await new Promise((r) => setTimeout(r, 0));
    const active = root.querySelector('.ui-tab[aria-selected="true"]');
    assert.ok(active, 'one bucket is selected on open');
    // Ata Ekta 03 Student §03 names the pending bucket "জমা দিতে হবে".
    assert.ok((active!.textContent ?? '').startsWith('জমা দিতে হবে'), 'and it is the pending one');
    assert.equal(active!.getAttribute('data-id'), 'pending', 'by its id, not only its words');
  });

  test('selection is announced, not just coloured', async () => {
    const { root } = mount([assignment('a', null)]);
    await new Promise((r) => setTimeout(r, 0));
    const opts = [...root.querySelectorAll('.ui-tab')];
    assert.equal(opts.filter((o) => o.getAttribute('aria-selected') === 'true').length, 1);
    assert.equal(root.querySelector('[role="tablist"]')?.getAttribute('role'), 'tablist');
    // Stronger than P6 found it: the P2 strip carries a roving tabindex, so
    // the whole group is ONE keyboard stop. The hand-rolled `.seg-bar` had
    // `role=tab` on three buttons and no tabindex management at all.
    assert.equal(opts.filter((o) => o.getAttribute('tabindex') === '0').length, 1);
  });

  test('an empty pending bucket reads as good news, not as an error', async () => {
    // "Nothing due" is the best possible state and must not show a warning
    // glyph — the empty-state glyph is the only signal a hurried reader gets.
    const { root } = mount([assignment('graded', { gradedAt: new Date().toISOString() })]);
    await new Promise((r) => setTimeout(r, 0));
    // P6 fixed `emptyState` so the glyph it is GIVEN is the glyph it draws —
    // it used to render a literal `·` whatever the caller asked for, which is
    // why this screen hand-rolled its own ✓. "Nothing due" now gets the tick
    // icon from the real set.
    const glyph = root.querySelector('.ui-state-glyph');
    assert.ok(glyph, 'a hurried reader gets one signal, and it is this');
    assert.ok(glyph!.querySelector('svg'), 'a drawn icon, not a stray character');
    assert.notEqual(glyph!.textContent, '·', 'and not the placeholder dot');
    assert.match(root.querySelector('.ui-state-empty .ui-state-title')?.textContent ?? '', /বাকি নেই/);
  });
});

/**
 * Ata Ekta §7 — the states that are not the happy path.
 *
 * Two of these were wrong before the redesign, and both looked plausible on
 * screen: a first load that failed with nothing cached said "no homework"
 * (a claim about data never seen), and a detail read that failed left the
 * skeleton up forever.
 */
describe('homework states (Ata Ekta §7)', () => {
  /** Mounts with a caller-supplied fetch, so each test can fail where it needs to. */
  function mountWith(role: string, fetcher: (url: string) => Promise<unknown>) {
    const root = dom.window.document.getElementById('root')!;
    root.textContent = '';
    const auth = { role, userId: 's-1', authedFetch: fetcher } as never;
    return { root, view: new AssignmentsView({ root, doc: dom.window.document, auth, outbox: null as never }) };
  }
  const okList = (list: unknown[]) => ({ ok: true, status: 200, json: async () => ({ assignments: list }) });
  const buttonNamed = (root: HTMLElement, text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement | undefined;

  test('a failed first load with nothing cached is an error with a retry — never "no homework"', async () => {
    localStorage.clear();
    let calls = 0;
    const { root } = mountWith('student', async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return okList([assignment('a', null)]);
    });
    await settle();
    assert.ok(root.querySelector('.ui-state-error [role="alert"]'), 'the failure is announced');
    assert.equal(root.querySelector('.ui-state-empty'), null, 'and is not dressed as an empty list');

    const retry = buttonNamed(root, 'আবার চেষ্টা করুন');
    assert.ok(retry, 'a way to try again');
    retry!.click();
    await settle();
    assert.equal(root.querySelector('.ui-state-error'), null);
    assert.equal(root.querySelectorAll('.ui-tab').length, 3, 'the retry loads the list');
  });

  test('a failed detail read says so, instead of a skeleton that never ends', async () => {
    localStorage.clear();
    const { root } = mountWith('student', async (url) => {
      if (url.includes('assignmentId=')) throw new TypeError('Failed to fetch');
      return okList([assignment('d-1', null)]);
    });
    await settle();
    (root.querySelector('table.ui-table tbody .ui-row-open') as HTMLElement).click();
    await settle();
    assert.equal(root.querySelector('.is-skeleton'), null, 'not still loading');
    assert.ok(root.querySelector('.ui-state-error'), 'an error the reader can act on');
    assert.ok(buttonNamed(root, 'আবার চেষ্টা করুন'));
    assert.equal(root.querySelectorAll('h1').length, 1, 'the screen still names itself');
  });

  test('a refused detail read is the permission state, and offers no retry', async () => {
    localStorage.clear();
    const { root } = mountWith('student', async (url) => {
      if (url.includes('assignmentId=')) {
        return { ok: false, status: 403, json: async () => ({ error: 'forbidden' }) };
      }
      return okList([assignment('d-2', null)]);
    });
    await settle();
    (root.querySelector('table.ui-table tbody .ui-row-open') as HTMLElement).click();
    await settle();
    assert.ok(root.querySelector('.ui-state-denied'), 'a refusal, not an outage');
    assert.equal(root.querySelector('.ui-state-error'), null);
    assert.equal(buttonNamed(root, 'আবার চেষ্টা করুন'), undefined, 'retrying a refusal is futile');
  });

  test('a teacher opens on the review queue, and each row says its marking progress in words', async () => {
    localStorage.clear();
    const row = { ...assignment('t-1', null), submissionCount: 24, ungradedCount: 6 };
    const { root } = mountWith('teacher', async () => okList([row]));
    await settle();
    const active = root.querySelector('.ui-tab[aria-selected="true"]');
    assert.equal(active?.getAttribute('data-id'), 'pending', 'unmarked work is the default bucket');
    assert.ok((active?.textContent ?? '').startsWith('জমা দেখা বাকি'));
    const count = root.querySelector('.assign-count');
    assert.equal(count?.textContent, '২৪ জমা · ৬ দেখা বাকি', 'colour is never the only carrier');
    assert.ok(count?.querySelector('.n'), 'and its numbers are in the numeral face');
  });
});
