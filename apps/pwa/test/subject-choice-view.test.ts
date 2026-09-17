/**
 * Group & optional-subject selection — §10.3, F-305 / F-304.
 *
 * Two rules here are load-bearing and neither is visible in a screenshot:
 *
 *  • The regeneration warning is MANDATORY and must fire BEFORE the write.
 *    Changing a fourth subject re-cuts the student's timetable and
 *    invalidates their content assignments. A one-tap save that posts and
 *    then explains is the failure mode; these assert that no request
 *    leaves until a second, deliberate press.
 *
 *  • Derived compulsories are read-only. §10.3: "the coordinator never
 *    types them." A future commit that helpfully makes them editable —
 *    or merely pressable — breaks the derivation contract, because
 *    app.derive_student_subjects would overwrite the edit on the next run.
 *    The assertion is that there is physically nothing to press.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { SubjectChoiceView } from '../src/subject-choice-view.ts';

let dom: JSDOM;

const ROSTER = {
  roster: [
    { studentId: 's-1', rollNo: 1, fullName: { bn: 'আরিফুল ইসলাম', en: 'Ariful Islam' } },
  ],
};

const CHOICE = () => ({
  student: {
    id: 's-1', nameBn: 'আরিফুল ইসলাম', rollNo: 1,
    classBn: 'নবম শ্রেণি', sectionName: 'ক', groupCode: 'science',
  },
  hasTemplate: true,
  derived: [
    // A digit in the name, as the SSC compulsories have (migration 012).
    { subjectId: 'sub-bn', nameBn: 'বাংলা ১ম পত্র', requirementType: 'compulsory' },
    { subjectId: 'sub-ph', nameBn: 'পদার্থবিজ্ঞান', requirementType: 'group_compulsory' },
  ],
  religionOptions: [
    { subjectId: 'sub-isl', nameBn: 'ইসলাম ও নৈতিক শিক্ষা', variant: 'islam' },
    { subjectId: 'sub-hin', nameBn: 'হিন্দুধর্ম ও নৈতিক শিক্ষা', variant: 'hindu' },
  ],
  optionalOptions: [
    { subjectId: 'sub-hma', nameBn: 'উচ্চতর গণিত' },
    { subjectId: 'sub-agr', nameBn: 'কৃষিশিক্ষা' },
  ],
  current: { religionVariant: 'islam', religionSubjectId: 'sub-isl', optionalSubjectId: 'sub-hma' },
});

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
                  { url: 'http://localhost/' });
  (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
});

beforeEach(() => { localStorage.clear(); localStorage.setItem('shikhon_last_section', 'sec-1'); });

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

/**
 * `choice` replaces the GET for one student's choice — the n-th call (from 1)
 * — so a test can make it fail or refuse. Every other request answers as the
 * fixture does.
 */
async function mount(choice?: (n: number) => Response) {
  const posts: Array<{ url: string; body: unknown }> = [];
  let gets = 0;
  const root = dom.window.document.getElementById('root') as HTMLElement;
  root.textContent = '';
  new SubjectChoiceView({
    root, doc: dom.window.document,
    auth: {
      authedFetch: async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
          return { ok: true, status: 200,
            json: async () => ({ ok: true, subjectCount: 9, invalidated: ['routine', 'content'] }) } as unknown as Response;
        }
        if (url.includes('/roster')) {
          return { ok: true, status: 200, json: async () => ROSTER } as unknown as Response;
        }
        gets += 1;
        if (choice) return choice(gets);
        return { ok: true, status: 200, json: async () => CHOICE() } as unknown as Response;
      },
    } as never,
  });
  await settle();
  return { root, posts, gets: () => gets };
}

const byText = (root: HTMLElement, sel: string, text: string) =>
  [...root.querySelectorAll(sel)].find((n) => (n.textContent ?? '').includes(text)) as HTMLElement | undefined;

describe('subject choice §10.3', () => {
  test('the group is reported, not offered', async () => {
    const { root } = await mount();
    // The group is a property of the CLASS (classes are unique on
    // tenant/level/stream/group), so changing it is a re-enrolment into a
    // different class — not something a dropdown on this screen can
    // honestly do. It renders as a value plus an explanation of where it
    // is actually set.
    // Ata Ekta draws it as a label over one value row, `.choice-group-value`.
    const value = root.querySelector('.choice-group-value') as HTMLElement;
    assert.equal(value?.textContent, 'বিজ্ঞান');
    // The row is a flex box: its text sits in one wrapper, so a code with a
    // digit cannot break into separate flex items.
    assert.equal(value.childNodes.length, 1, 'one inline wrapper inside the value row');
    assert.equal(value.firstChild?.nodeType, 1, 'the one item is an element, not loose text');
    assert.ok((root.textContent ?? '').includes('অন্য শাখায় স্থানান্তর'));
    // Nothing in the group's block can be pressed or chosen.
    const group = root.querySelector('.choice-group') as HTMLElement;
    assert.ok(group, 'the group block renders');
    assert.equal(group.querySelectorAll('button, input, select, [role="radio"]').length, 0);
    // The selects on the screen are the student picker and the religion pool
    // (drawn as a select). Neither is the group.
    const selects = [...root.querySelectorAll('select')].map((s) => s.getAttribute('name')).sort();
    assert.deepEqual(selects, ['religion', 'student']);
  });

  test('derived compulsories are text, with nothing to press', async () => {
    const { root } = await mount();
    const derived = root.querySelector('.choice-derived') as HTMLElement;
    assert.ok(derived, 'derived list renders');
    assert.ok((derived.textContent ?? '').includes('পদার্থবিজ্ঞান'));
    // The panel is a flex row. numText splits "বাংলা ১ম পত্র" into text and a
    // `.n` span; loose, each piece became its own flex item, the spaces at
    // their edges collapsed and the list read "বাংলা১ / ম পত্র" in columns.
    // One wrapper keeps it a single run of text.
    assert.equal(derived.childNodes.length, 1, 'one inline wrapper, so one flex item');
    assert.equal(derived.firstChild?.nodeType, 1, 'the one item is an element, not loose text');
    assert.equal((derived.firstChild as HTMLElement).classList.contains('n'), false,
      'and not the numeral span itself');
    assert.ok(derived.querySelector('.n'), 'the digit still takes the numeral face');
    assert.ok((derived.textContent ?? '').startsWith('বাংলা ১ম পত্র · '), 'the spaces survive');
    // §10.3: "the coordinator never types them". No buttons, no inputs —
    // the derivation is the authority and the screen offers no way to
    // contradict it.
    assert.equal(derived.querySelectorAll('button, input, select, [role="radio"]').length, 0);
  });

  test('F-304: only the template pools are offered — the fourth subject as a radiogroup, the religion as a select', async () => {
    const { root } = await mount();
    const groups = root.querySelectorAll('[role="radiogroup"]');
    assert.equal(groups.length, 1, 'the fourth subject');
    // The optional pool as supplied, nothing invented.
    assert.equal(root.querySelectorAll('.choice-option').length, 2);
    // The student's current choices arrive pre-selected, so the screen
    // opens on their real state rather than an empty one.
    const chosen = [...root.querySelectorAll('.choice-option[data-chosen="true"]')]
      .map((b) => b.textContent);
    assert.deepEqual(chosen, ['উচ্চতর গণিত']);
    const religion = root.querySelector('select[name="religion"]') as HTMLSelectElement;
    assert.ok(religion, 'the religion pool renders');
    assert.equal(religion.value, 'islam');
    // The religion pool as supplied, plus the way back to no choice — the
    // empty option is what tapping the chosen button used to do.
    assert.deepEqual([...religion.options].map((o) => o.value), ['', 'islam', 'hindu']);
  });

  test('the regeneration warning fires before any write, and needs a second press', async () => {
    const { root, posts } = await mount();

    // Nothing has changed yet: the footer says so and offers no save — the
    // drawn bar is there, but its button cannot be pressed.
    assert.ok((root.querySelector('.choice-footer')?.textContent ?? '').includes('কোনো পরিবর্তন করা হয়নি'));
    const idle = byText(root, '.choice-footer button', 'পরিবর্তন সংরক্ষণ করুন') as HTMLButtonElement | undefined;
    assert.ok(!idle || idle.disabled, 'no pressable save before anything changed');
    assert.equal(root.querySelector('.choice-warning'), null, 'no premature warning');
    // The drawn warning at the top is not the confirm step's warning.
    assert.equal(root.querySelector('[role="alert"]'), null, 'nothing alerts before a save is asked for');

    // Change the fourth subject.
    byText(root, '.choice-option', 'কৃষিশিক্ষা')?.click();
    await settle();
    assert.equal(root.querySelector('.choice-warning'), null, 'still no warning — nothing submitted yet');

    // Press save. This must NOT write; it must explain first.
    byText(root, 'button', 'পরিবর্তন সংরক্ষণ করুন')?.click();
    await settle();

    const warn = root.querySelector('.choice-warning') as HTMLElement;
    assert.ok(warn, 'the warning is mandatory');
    assert.equal(warn.getAttribute('role'), 'alert');
    // It has to name BOTH consequences, not just "are you sure?".
    assert.ok((warn.textContent ?? '').includes('রুটিন'), 'names the routine');
    assert.ok((warn.textContent ?? '').includes('পাঠ বরাদ্দ'), 'names content assignment');
    assert.equal(posts.length, 0, 'NOTHING may be written before confirmation');

    // Only the second, deliberate press writes.
    byText(root, '.choice-confirm-row button', 'নিশ্চিত করুন')?.click();
    await settle();
    assert.equal(posts.length, 1);
    assert.equal((posts[0]?.body as { optionalSubjectId?: string }).optionalSubjectId, 'sub-agr');
  });

  test('cancelling the warning writes nothing', async () => {
    const { root, posts } = await mount();
    const religion = root.querySelector('select[name="religion"]') as HTMLSelectElement;
    religion.value = 'hindu';
    religion.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    byText(root, 'button', 'পরিবর্তন সংরক্ষণ করুন')?.click();
    await settle();
    assert.ok(root.querySelector('.choice-warning'), 'the warning is up before it is cancelled');
    byText(root, '.choice-confirm-row button', 'বাতিল')?.click();
    await settle();
    assert.equal(posts.length, 0);
    assert.equal(root.querySelector('.choice-warning'), null, 'warning clears on cancel');
  });

  test('the religion select writes the same draft the pool buttons did', async () => {
    const { root, posts } = await mount();
    const religion = root.querySelector('select[name="religion"]') as HTMLSelectElement;
    // The empty option clears the religion, as tapping the chosen one did.
    religion.value = '';
    religion.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    byText(root, 'button', 'পরিবর্তন সংরক্ষণ করুন')?.click();
    await settle();
    byText(root, '.choice-confirm-row button', 'নিশ্চিত করুন')?.click();
    await settle();
    assert.equal(posts.length, 1);
    const body = posts[0]?.body as { religionVariant?: string | null; optionalSubjectId?: string | null };
    assert.equal(body.religionVariant, null);
    assert.equal(body.optionalSubjectId, 'sub-hma', 'the untouched choice is sent as it was');
  });
});

describe('subject choice — the states', () => {
  test('a failed load is the error state with a retry, and the retry fetches again', async () => {
    const { root, gets } = await mount((n) => (n === 1
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => CHOICE() }) as unknown as Response);
    const error = root.querySelector('.ui-state-error') as HTMLElement;
    assert.ok(error, 'the error state renders');
    assert.ok((error.querySelector('[role="alert"]')?.textContent ?? '').includes('আনা গেল না'));
    // Nothing to choose from a load that did not arrive.
    assert.equal(root.querySelectorAll('.choice-option, select[name="religion"]').length, 0);
    byText(root, '.ui-state-error button', 'আবার চেষ্টা করুন')?.click();
    await settle();
    assert.equal(gets(), 2, 'the retry asked again');
    assert.equal(root.querySelector('.ui-state-error'), null);
    assert.ok(root.querySelector('.choice-options'), 'the screen recovers');
  });

  test('a refusal is the denied state, with nothing to retry and nothing to choose', async () => {
    const { root } = await mount(() => ({
      ok: false, status: 403, json: async () => ({ error: 'forbidden' }),
    }) as unknown as Response);
    const denied = root.querySelector('.ui-state-denied') as HTMLElement;
    assert.ok(denied, 'the denied state renders');
    assert.ok((denied.textContent ?? '').includes('অনুমতি'));
    assert.equal(root.querySelectorAll('button, select').length, 0, 'no retry, no picker, no pools');
    assert.equal(root.querySelectorAll('h1').length, 1, 'the page still names itself');
  });
});
