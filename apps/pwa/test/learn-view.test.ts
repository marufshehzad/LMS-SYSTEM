/**
 * Chapter reader — F-803, wireframe §6.3.
 *
 * Two things this locks:
 *   • the reading article carries the class the stylesheet actually styles
 *     (a rename once left it '.topic-reader' while the CSS styled
 *     '.lesson-reader', so the 68ch measure and reader type size silently
 *     never applied);
 *   • the text-size control is persistent and remembered (§6.3) — a student
 *     reads for an hour, and the size that suits their eyes must survive the
 *     screen being closed.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { LearnView } from '../src/learn-view.ts';

let dom: JSDOM;

const CHAPTER = {
  id: 'ch-1', chapterNo: 1, name: { bn: 'অধ্যায় ৯', en: null }, summaryBn: null,
  estMinutes: 20, isPublished: true, subject: { id: 'sub-1', bn: 'পদার্থবিজ্ঞান', en: 'Physics' },
  prerequisite: null, topicCount: 1, completedCount: 0,
};
const TOPIC = {
  id: 'tp-1', topicNo: 1, title: { bn: 'তরঙ্গ', en: null }, estMinutes: 5,
  isPublished: true, progress: null,
};
const DETAIL = {
  topic: { title: { bn: 'তরঙ্গ' } },
  blocks: [{ id: 'b1', blockNo: 1, kind: 'text', bodyBn: 'তরঙ্গ হলো একটি আন্দোলন।', mediaKey: null, altTextBn: null, captionBn: null }],
};

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
                  { url: 'http://localhost/' });
  (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
  (globalThis as Record<string, unknown>).KeyboardEvent = dom.window.KeyboardEvent;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
});

beforeEach(() => { localStorage.clear(); });

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

function mount() {
  const root = dom.window.document.getElementById('root') as HTMLElement;
  root.textContent = '';
  const auth = {
    role: 'student', userId: 's-1',
    authedFetch: async (url: string) => ({
      ok: true, status: 200,
      json: async () =>
        url.includes('/chapters') ? { chapters: [CHAPTER] }
        : url.includes('/practice') ? { questions: [] }   // also carries topicId=, so check first
        : url.includes('topicId=') ? DETAIL
        : url.includes('chapterId=') ? { topics: [TOPIC] }
        : { questions: [] },
    }),
  } as never;
  const ops: Array<{ entity: string; payload: { state?: string } }> = [];
  const outbox = {
    enqueue: async (op: { entity: string; payload: { state?: string } }) => { ops.push(op); return { opId: 'op' }; },
    flush: async () => {},
  } as never;
  new LearnView({ root, doc: dom.window.document, auth, outbox, classId: 'cls-1' });
  return { root, ops };
}

/** list → chapter → topic → reader */
async function openReader(root: HTMLElement) {
  await settle();
  (root.querySelector('.chapter-card') as HTMLElement).click();
  await settle();
  (root.querySelector('.topic-card') as HTMLElement).click();
  await settle();
}

describe('chapter reader (F-803)', () => {
  test('the reading article uses the class the stylesheet styles', async () => {
    const { root } = mount();
    await openReader(root);
    assert.ok(root.querySelector('.lesson-reader'), 'article is .lesson-reader, not the unstyled .topic-reader');
    assert.ok(root.querySelector('.lesson-reader .block-text'), 'the blocks render inside it');
  });

  test('THE ONE THAT MATTERS — text size is remembered across a reload', async () => {
    const { root } = mount();
    await openReader(root);
    const article = root.querySelector('.lesson-reader') as HTMLElement;
    assert.equal(article.style.fontSize, '18px', 'default reader size');

    const bigger = root.querySelector('.reader-size-lg') as HTMLButtonElement;
    bigger.click();
    assert.equal(article.style.fontSize, '21px', 'the text grows');
    assert.equal(localStorage.getItem('shikhon_reader_textsize'), '2', 'and the choice is stored');

    // A fresh view instance is a reload: the remembered size must apply.
    const second = mount();
    await openReader(second.root);
    assert.equal((second.root.querySelector('.lesson-reader') as HTMLElement).style.fontSize, '21px',
      'the remembered size is applied on reopen');
  });

  test('the control bottoms and tops out, never past the legibility floor', async () => {
    const { root } = mount();
    await openReader(root);
    const smaller = root.querySelector('.reader-size') as HTMLButtonElement;
    const bigger = root.querySelector('.reader-size-lg') as HTMLButtonElement;
    const article = root.querySelector('.lesson-reader') as HTMLElement;

    smaller.click(); // 18 -> 16 (the floor)
    assert.equal(article.style.fontSize, '16px');
    assert.equal(smaller.disabled, true, 'cannot go below the 16px Bangla floor');

    bigger.click(); bigger.click(); bigger.click(); // 16 -> 18 -> 21 -> 25 (cap)
    assert.equal(article.style.fontSize, '25px');
    assert.equal(bigger.disabled, true, 'cannot grow past the top step');
  });
});

/* ── Ata Ekta (03 Student §০২) — the chapter list as drawn, and the §7 states ── */

type Reply = { ok: boolean; status: number; body?: unknown } | 'throw';

/** A view whose every request is answered by `answer(url)`; counts the calls. */
function mountWith(answer: (url: string) => Reply, extra: { subjectId?: string } = {}) {
  const root = dom.window.document.getElementById('root') as HTMLElement;
  root.textContent = '';
  const calls: string[] = [];
  const auth = {
    role: 'student', userId: 's-1',
    authedFetch: async (url: string) => {
      calls.push(url);
      const r = answer(url);
      if (r === 'throw') throw new TypeError('Failed to fetch');
      return { ok: r.ok, status: r.status, json: async () => r.body };
    },
  } as never;
  const outbox = { enqueue: async () => ({ opId: 'op' }), flush: async () => {} } as never;
  new LearnView({ root, doc: dom.window.document, auth, outbox, classId: 'cls-1', ...extra });
  return { root, calls };
}

const ok = (body: unknown): Reply => ({ ok: true, status: 200, body });

describe('chapter list (03 Student §০২)', () => {
  test('a row shows the percentage in the numeral face and a bar of that width', async () => {
    const half = { ...CHAPTER, id: 'ch-2', name: { bn: 'অধ্যায় ২', en: null }, topicCount: 4, completedCount: 2 };
    const { root } = mountWith((url) => ok(url.includes('/chapters') ? { chapters: [CHAPTER, half] } : {}));
    await settle();

    const rows = root.querySelectorAll('.chapter-card');
    assert.equal(rows.length, 2);
    const row = rows[1] as HTMLElement;
    assert.equal(row.tagName, 'BUTTON', 'the row is still one real button');
    assert.equal(row.getAttribute('aria-label'), 'অধ্যায় ২ — ৪ পাঠের মধ্যে ২টি শেষ',
      'the accessible name still carries the counts');
    const pct = row.querySelector('.chapter-pct') as HTMLElement;
    assert.equal(pct.textContent, '৫০%');
    assert.ok(pct.classList.contains('n'), 'the figure is in the numeral face (R6)');
    assert.equal((row.querySelector('.ui-progress-fill') as HTMLElement).style.width, '50%');
    assert.equal(row.dataset.progressTone, 'warn');
    assert.equal((rows[0] as HTMLElement).dataset.progressTone, 'neutral', 'not started');
    assert.equal(row.querySelector('.chapter-ring'), null, 'no ring');
  });

  test('the subject select shows one subject at a time, without fetching again', async () => {
    const chem = { ...CHAPTER, id: 'ch-3', name: { bn: 'রসায়ন ১', en: null },
      subject: { id: 'sub-2', bn: 'রসায়ন', en: 'Chemistry' } };
    const { root, calls } = mountWith((url) => ok(url.includes('/chapters') ? { chapters: [CHAPTER, chem] } : {}));
    await settle();

    const select = root.querySelector('.learn-subject select') as HTMLSelectElement;
    assert.ok(select, 'the subject strip holds a select');
    assert.equal(root.querySelector(`label[for="${select.id}"]`)?.textContent, 'বিষয়', 'and it is labelled');
    assert.equal(root.querySelectorAll('.chapter-card').length, 1, 'first subject only');
    assert.match(root.querySelector('.chapter-card')!.getAttribute('aria-label')!, /^অধ্যায় ৯/);

    const fetched = calls.length;
    select.value = 'sub-2';
    select.dispatchEvent(new dom.window.Event('change'));
    assert.equal(root.querySelector('.learn-subject select'), select, 'the select is not rebuilt, so focus stays');
    assert.equal(root.querySelectorAll('.chapter-card').length, 1);
    assert.match(root.querySelector('.chapter-card')!.getAttribute('aria-label')!, /^রসায়ন ১/);
    assert.equal(calls.length, fetched, 'switching subject fetches nothing');
  });

  /* F-802: আমার বিষয় → tap a subject → its chapters. The grouped page showed
     every subject; the select shows one, so arriving must not land on another. */
  const CHEM = { ...CHAPTER, id: 'ch-3', name: { bn: 'রসায়ন ১', en: null },
    subject: { id: 'sub-2', bn: 'রসায়ন', en: 'Chemistry' } };

  test('arriving with a subject starts the strip on that subject', async () => {
    const { root, calls } = mountWith(
      (url) => ok(url.includes('/chapters') ? { chapters: [CHAPTER, CHEM] } : {}), { subjectId: 'sub-2' });
    await settle();

    const select = root.querySelector('.learn-subject select') as HTMLSelectElement;
    assert.equal(select.value, 'sub-2', 'the tapped subject is the one chosen');
    assert.equal(root.querySelectorAll('.chapter-card').length, 1);
    assert.match(root.querySelector('.chapter-card')!.getAttribute('aria-label')!, /^রসায়ন ১/);
    assert.equal(root.querySelector('.chapter-list')!.getAttribute('aria-label'), 'রসায়ন — অধ্যায়');
    assert.equal(calls.filter((u) => u.includes('/chapters')).length, 1, 'still one chapters fetch');
    assert.ok(!calls.some((u) => u.includes('subjectId')), 'and no subject query is added to it');
  });

  test('a subject the cache predates is still honoured once the fresh list has it', async () => {
    localStorage.setItem('shikhon_chapters_cache', JSON.stringify([CHAPTER]));
    const { root } = mountWith(
      (url) => ok(url.includes('/chapters') ? { chapters: [CHAPTER, CHEM] } : {}), { subjectId: 'sub-2' });
    await settle();
    assert.equal((root.querySelector('.learn-subject select') as HTMLSelectElement).value, 'sub-2');
    assert.match(root.querySelector('.chapter-card')!.getAttribute('aria-label')!, /^রসায়ন ১/);
  });

  test('an unknown subject falls back to the first, and the student\'s own pick is kept', async () => {
    const { root } = mountWith(
      (url) => ok(url.includes('/chapters') ? { chapters: [CHAPTER, CHEM] } : { topics: [TOPIC] }),
      { subjectId: 'sub-gone' });
    await settle();
    const select = root.querySelector('.learn-subject select') as HTMLSelectElement;
    assert.equal(select.value, 'sub-1', 'first subject in API order');

    select.value = 'sub-2';
    select.dispatchEvent(new dom.window.Event('change'));
    (root.querySelector('.chapter-card') as HTMLElement).click();
    await settle();
    (root.querySelector('.ui-back') as HTMLElement).click();
    await settle();
    assert.equal((root.querySelector('.learn-subject select') as HTMLSelectElement).value, 'sub-2',
      'back from a chapter, the strip is where the student left it');
  });

  test('loading is a skeleton, never text', async () => {
    const { root } = mountWith(() => ok({ chapters: [] }));
    assert.ok(root.querySelector('.is-skeleton'), 'skeleton on first paint');
    assert.equal(root.querySelector('.page-sub.empty'), null);
    await settle();
  });

  test('a failed first load is an error with a retry — not an empty syllabus', async () => {
    let fail = true;
    const { root } = mountWith((url) => (fail ? 'throw' : ok(url.includes('/chapters') ? { chapters: [CHAPTER] } : {})));
    await settle();

    assert.ok(root.querySelector('.ui-state-error'), 'error state');
    assert.equal(root.querySelector('.ui-state-empty'), null, 'not the empty state');
    assert.equal(root.querySelector('h1')?.textContent, 'পড়াশোনা', 'the page still names itself');
    const retry = root.querySelector('.ui-state-error .ui-state-action') as HTMLButtonElement;
    assert.equal(retry.textContent, 'আবার চেষ্টা করুন');

    fail = false;
    retry.click();
    await settle();
    assert.equal(root.querySelector('.ui-state-error'), null);
    assert.equal(root.querySelectorAll('.chapter-card').length, 1, 'the retry loads the list');
  });

  test('an empty syllabus says what is missing and names a next action', async () => {
    const { root } = mountWith(() => ok({ chapters: [] }));
    await settle();
    const empty = root.querySelector('.ui-state-empty') as HTMLElement;
    assert.ok(empty);
    assert.match(empty.textContent ?? '', /এখনো কোনো অধ্যায় যুক্ত হয়নি/);
    assert.ok(empty.querySelector('button.ui-state-action'), 'with a next action');
  });

  test('a refusal is the denied state, with no retry and no cached chapters', async () => {
    localStorage.setItem('shikhon_chapters_cache', JSON.stringify([CHAPTER]));
    const { root } = mountWith(() => ({ ok: false, status: 403, body: { error: 'forbidden' } }));
    await settle();
    assert.ok(root.querySelector('.ui-state-denied'), 'denied state');
    assert.equal(root.querySelector('.chapter-card'), null, 'the refused cache is not shown');
    assert.equal(root.querySelector('.ui-state-action'), null, 'no retry for a lock');
  });

  test('offline with a cache: the warn banner sits over the cached list', async () => {
    localStorage.setItem('shikhon_chapters_cache', JSON.stringify([CHAPTER]));
    const { root } = mountWith(() => 'throw');
    await settle();
    const banner = root.querySelector('.learn-list > .offline-banner') as HTMLElement;
    assert.ok(banner, 'offline banner inside the list');
    assert.match(banner.textContent ?? '', /অফলাইন/);
    assert.equal(root.querySelectorAll('.chapter-card').length, 1, 'cached chapters still shown');
  });
});

describe('topics and reader states (§7)', () => {
  test('topics that fail to load are an error with a retry, and the way back stays', async () => {
    const { root } = mountWith((url) => (url.includes('chapterId=') ? 'throw' : ok({ chapters: [CHAPTER] })));
    await settle();
    (root.querySelector('.chapter-card') as HTMLElement).click();
    await settle();

    assert.ok(root.querySelector('.ui-back'), 'back link');
    assert.ok(root.querySelector('.ui-state-error'), 'error state');
    assert.equal(root.querySelector('.ui-state-empty'), null, 'not "no lessons in this chapter"');
    assert.equal(root.querySelector('.offline-banner'), null, 'nothing saved is being shown');
  });

  test('topic rows open the reader from a list row, with the minutes in the numeral face', async () => {
    const { root } = mount();
    await settle();
    (root.querySelector('.chapter-card') as HTMLElement).click();
    await settle();
    const hit = root.querySelector('.ui-list .topic-card') as HTMLButtonElement;
    assert.equal(hit.tagName, 'BUTTON');
    assert.equal(hit.dataset.state, 'new');
    assert.ok(hit.querySelector('.ui-list-meta .n'), '৫ in .n');
  });

  test('a lesson that fails with nothing cached is an error — no tools, no done button', async () => {
    const { root } = mountWith((url) => (
      url.includes('/chapters') ? ok({ chapters: [CHAPTER] })
      : url.includes('/practice') ? ok({ questions: [] })
      : url.includes('topicId=') ? 'throw'
      : ok({ topics: [TOPIC] })));
    await openReader(root);

    assert.ok(root.querySelector('.ui-state-error'), 'error state');
    assert.equal(root.querySelector('.reader-tools'), null);
    assert.equal(root.querySelector('.topic-done'), null);
  });

  test('the reader has one primary: done, full width, with its label intact', async () => {
    const { root, ops } = mount();
    await openReader(root);
    const primaries = root.querySelectorAll('.btn-primary');
    assert.equal(primaries.length, 1, 'one primary button');
    const done = primaries[0] as HTMLButtonElement;
    assert.ok(done.classList.contains('btn-block'));
    assert.equal(done.textContent, 'পাঠ সম্পন্ন');
    const completed = () => ops.filter((o) => o.payload.state === 'completed').length;
    done.click();
    assert.equal(done.textContent, 'সম্পন্ন হয়েছে');
    // Unavailable once pressed. Marked aria-disabled rather than `disabled`
    // (finding 12b: a disabled button under focus is blurred to <body>); the
    // guarantee `disabled` gave is checked directly: a second press is inert.
    assert.equal(done.getAttribute('aria-disabled'), 'true');
    await settle();
    done.click();
    await settle();
    assert.equal(completed(), 1, 'pressing it again records nothing more');
    assert.equal(done.textContent, 'সম্পন্ন হয়েছে');
  });
});

describe('F-802 — the subject tapped on আমার বিষয় is the one that opens', () => {
  test('app.ts carries the subject id from the subjects screen into the learn route', async () => {
    // subjects-view passes the id; app.ts dropped it, so every tap landed on
    // whichever subject the API happened to list first.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/app.ts', import.meta.url), 'utf8');
    assert.match(src, /onOpenSubject: \(subjectId\) =>[\s\S]{0,120}#\/learn\?subjectId=\$\{encodeURIComponent\(subjectId\)\}/);
    assert.match(src, /get\('subjectId'\)[\s\S]{0,120}new LearnView\(\{[^}]*subjectId/);
  });
});
