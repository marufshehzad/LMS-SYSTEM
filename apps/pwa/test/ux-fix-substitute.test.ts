/**
 * UX sweep — বদলি শিক্ষক (group substitute).
 *
 * Finding 9: the candidate drawer lost the keyboard user's place.
 *   1. Closing it (Escape, ✕) left focus on <body>, not on the period that
 *      opened it — the screen rebuilds the page before the drawer opens, so
 *      the overlay's saved opener was already <body>, and it rebuilds the page
 *      again on close.
 *   2. Assigning a substitute replaced the drawer's body while the drawer
 *      stayed open. The focused নির্ধারণ button went with it, focus fell to
 *      <body>, and the next Tab walked into the page behind the scrim.
 *
 * Part 1 is covered by the shell's focus keeper (keepFocusWithin on
 * main#shell-view, which the overlay pings on close); these tests arm it the
 * way the shell does, so they hold the screen to it. Part 2 is the screen's
 * own: nothing outside it can see a drawer body being swapped.
 *
 * Minor 101 (substitute part): a refused day kept a live date control above
 * the refusal.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { SubstituteView } from '../src/substitute-view.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';
import { closeAllOverlays } from '../src/ui/overlay.ts';

let dom: JSDOM;
let stopKeeper: (() => void) | null = null;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="shell-view"></main></body></html>',
    { url: 'http://localhost/app#/substitute' });
  const g = globalThis as Record<string, unknown>;
  for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLSelectElement',
    'HTMLTextAreaElement', 'HTMLButtonElement', 'Node', 'Event', 'KeyboardEvent', 'CSS'] as const) {
    g[k] = (dom.window as unknown as Record<string, unknown>)[k];
  }
  g.document = dom.window.document;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true }, configurable: true, writable: true,
  });
});

beforeEach(() => {
  closeAllOverlays();
  doc().body.innerHTML = '<main id="shell-view"></main>';
});

afterEach(() => {
  closeAllOverlays();
  stopKeeper?.();
  stopKeeper = null;
});

const doc = () => dom.window.document;
const root = () => doc().getElementById('shell-view') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;
const dialog = () => doc().querySelector<HTMLElement>('[role="dialog"]');
const settle = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setTimeout(r, 0)); };
const escape = () => doc().dispatchEvent(
  new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

const slot = (slotId: string, startsAt: string, subjectBn: string, sectionLabel: string) => ({
  slotId, periodNo: 1, startsAt, endsAt: startsAt, slotKind: 'teaching', subjectBn, sectionLabel,
  roomCode: '101', isSubstitution: false, coveringForBn: null, studentCount: 40,
  attendanceTaken: false, deliveryLogged: false,
});
const DAY = { slots: [slot('s1', '10:00:00', 'বাংলা', '৯-ক'), slot('s2', '11:00:00', 'গণিত', '৮-খ')] };
const CANDIDATES = { candidates: [
  { teacherId: 't-9', fullName: { bn: 'রহিম উদ্দিন', en: null }, rank: 1, matchScore: 9,
    matchReasons: ['subject_expertise'] },
  { teacherId: 't-8', fullName: { bn: 'করিম হোসেন', en: null }, rank: 2, matchScore: 4,
    matchReasons: [] },
] };

interface Reply { status: number; body?: unknown }
type Handler = () => Reply | Promise<Reply>;

/** Mounts the screen the way the shell does: into main#shell-view, keeper armed first. */
function mount(o: { routine?: Handler; find?: Handler; assign?: Handler } = {}) {
  stopKeeper = keepFocusWithin(root());
  const routine = o.routine ?? (() => ({ status: 200, body: DAY }));
  const find = o.find ?? (() => ({ status: 200, body: CANDIDATES }));
  const assign = o.assign ?? (() => ({ status: 200, body: { ok: true } }));
  const auth = {
    role: 'academic_coordinator', tenantId: 't-1', userId: 'u-1',
    authedFetch: async (url: string, init?: RequestInit) => {
      let handler = routine;
      if (url.includes('/rms/substitute')) {
        handler = JSON.parse(String(init?.body ?? '{}')).assign ? assign : find;
      }
      const hit = await handler();
      return {
        ok: hit.status >= 200 && hit.status < 300,
        status: hit.status,
        json: async () => hit.body ?? {},
      } as unknown as Response;
    },
  };
  new SubstituteView({ root: root(), doc: doc(), auth: auth as never });
}

/** A reply the test releases when it chooses, to look at the busy state. */
function deferred(reply: Reply) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return { handler: async () => { await gate; return reply; }, release };
}

const rowOpen = (key: string) =>
  root().querySelector<HTMLElement>(`tr[data-key="${key}"] .ui-row-open`);
const listHit = (key: string) =>
  root().querySelector<HTMLElement>(`li[data-key="${key}"] .ui-list-hit`);
const assignButton = (name: string) => [...(dialog()?.querySelectorAll<HTMLElement>('button') ?? [])]
  .find((b) => b.getAttribute('aria-label') === `${name}-কে বদলি নির্ধারণ করুন`) ?? null;

/** Open the drawer for a period from its desktop row button, as a keyboard user does. */
async function openFromRow(key: string): Promise<HTMLElement> {
  const opener = rowOpen(key)!;
  opener.focus();
  assert.equal(active(), opener);
  opener.click();
  await settle();
  const dlg = dialog();
  assert.ok(dlg, 'the candidate drawer is open');
  assert.ok(dlg.contains(active()), 'focus moved into the drawer');
  return dlg;
}

describe('finding 9 — closing the drawer puts focus back on the period', () => {
  test('Escape returns focus to the row button that opened it (desktop table)', async () => {
    mount();
    await settle();
    const opener = rowOpen('s2')!;
    await openFromRow('s2');
    assert.equal(opener.isConnected, false, 'the page was rebuilt around the drawer');

    escape();
    await settle();
    assert.equal(dialog(), null, 'the drawer closed');
    assert.notEqual(active(), doc().body, 'focus fell to <body>');
    assert.equal(active(), rowOpen('s2'), 'focus is on the same period, rebuilt');
  });

  test('✕ returns focus to the list row that opened it (phone)', async () => {
    mount();
    await settle();
    const hit = listHit('s2')!;
    hit.focus();
    hit.click();
    await settle();
    assert.ok(dialog()?.contains(active()), 'focus moved into the drawer');

    dialog()!.querySelector<HTMLElement>('.ui-dialog-close')!.click();
    await settle();
    assert.equal(dialog(), null);
    assert.notEqual(active(), doc().body, 'focus fell to <body>');
    assert.equal(active(), listHit('s2'), 'focus is on the same period, rebuilt');
  });

  test('on a phone, closing after an assignment returns to that period although its row text changed', async () => {
    mount();
    await settle();
    const hit = listHit('s2')!;
    hit.focus();
    hit.click();
    await settle();
    const pick = assignButton('রহিম উদ্দিন')!;
    pick.focus();
    pick.click();
    await settle();

    dialog()!.querySelector<HTMLElement>('.ui-dialog-close')!.click();
    await settle();
    assert.match(listHit('s2')?.textContent ?? '', /বদলি নির্ধারিত/);
    assert.equal(active(), listHit('s2'), 'focus is on the period it staffed, not another row');
  });

  test('"পিরিয়ডের তালিকায় ফিরুন" on a day with nobody free returns to the period', async () => {
    mount({ find: () => ({ status: 200, body: { candidates: [] } }) });
    await settle();
    const dlg = await openFromRow('s1');
    const back = [...dlg.querySelectorAll<HTMLElement>('button')]
      .find((b) => b.textContent === 'পিরিয়ডের তালিকায় ফিরুন')!;
    assert.ok(back, 'the empty drawer names the way back');
    back.focus();
    back.click();
    await settle();
    assert.equal(dialog(), null);
    assert.equal(active(), rowOpen('s1'));
  });
});

describe('finding 9 — assigning keeps focus inside the open drawer', () => {
  test('while the assignment is saving, and after it lands, focus stays in the drawer', async () => {
    const saving = deferred({ status: 200, body: { ok: true } });
    mount({ assign: saving.handler });
    await settle();
    const dlg = await openFromRow('s2');

    const pick = assignButton('রহিম উদ্দিন')!;
    pick.focus();
    pick.click();
    await settle();
    // The list is a skeleton now; the button that had focus is gone.
    assert.equal(pick.isConnected, false);
    assert.equal(dialog(), dlg, 'the drawer is still open');
    assert.notEqual(active(), doc().body, 'focus fell to <body> while saving');
    assert.ok(dlg.contains(active()), 'focus is inside the drawer while saving');

    saving.release();
    await settle();
    assert.match(dlg.textContent ?? '', /রহিম উদ্দিন কে বদলি নির্ধারণ করা হয়েছে/);
    assert.notEqual(active(), doc().body, 'focus fell to <body> after the assignment');
    assert.ok(dlg.contains(active()), 'focus is inside the drawer after the assignment');
    // On the dialog's first control, where the overlay's Tab trap holds it
    // in both directions (it wraps at the first and last item only).
    assert.equal(active(), dlg.querySelector('.ui-dialog-close'));
  });

  test('closing after an assignment still returns to the period, now marked done', async () => {
    mount();
    await settle();
    await openFromRow('s2');
    const pick = assignButton('রহিম উদ্দিন')!;
    pick.focus();
    pick.click();
    await settle();

    escape();
    await settle();
    assert.equal(dialog(), null);
    assert.equal(active(), rowOpen('s2'), 'focus is back on the period it staffed');
    assert.match(root().querySelector('tr[data-key="s2"]')?.textContent ?? '', /বদলি নির্ধারিত/);
  });

  test('a conflict re-search keeps focus in the drawer, and the fresh list is one Tab away', async () => {
    let tries = 0;
    mount({ assign: () => ({ status: 409, body: { error: 'substitute_conflict' } }),
      find: () => { tries++; return { status: 200, body: CANDIDATES }; } });
    await settle();
    const dlg = await openFromRow('s1');
    const pick = assignButton('রহিম উদ্দিন')!;
    pick.focus();
    pick.click();
    await settle();
    assert.equal(tries, 2, 'the list was searched again');
    assert.equal(dialog(), dlg);
    assert.ok(dlg.contains(active()), 'focus stayed inside the drawer');
    assert.ok(assignButton('রহিম উদ্দিন'), 'the fresh list is there');
  });

  test('a failed assignment keeps focus in the drawer beside its error', async () => {
    mount({ assign: () => ({ status: 500, body: {} }) });
    await settle();
    const dlg = await openFromRow('s1');
    const pick = assignButton('করিম হোসেন')!;
    pick.focus();
    pick.click();
    await settle();
    assert.ok(dlg.querySelector('[role="alert"]'), 'the error is shown in the drawer');
    assert.ok(dlg.contains(active()), 'focus stayed inside the drawer');
  });

  test('retrying a failed search from inside the drawer keeps focus there', async () => {
    let fail = true;
    mount({ find: () => (fail ? { status: 500, body: {} } : { status: 200, body: CANDIDATES }) });
    await settle();
    const dlg = await openFromRow('s1');
    const retry = [...dlg.querySelectorAll<HTMLElement>('button')]
      .find((b) => b.textContent === 'আবার চেষ্টা করুন')!;
    assert.ok(retry, 'the search error offers a retry');
    fail = false;
    retry.focus();
    retry.click();
    await settle();
    assert.equal(retry.isConnected, false);
    assert.ok(assignButton('রহিম উদ্দিন'), 'the retry found candidates');
    assert.ok(dlg.contains(active()), 'focus stayed inside the drawer');
  });
});

describe('minor 101 — a refused day has no live controls around the refusal', () => {
  test('the date control is not offered above a denied card', async () => {
    mount({ routine: () => ({ status: 403, body: {} }) });
    await settle();
    assert.ok(root().querySelector('.page-header'), 'the page still says where you are');
    assert.match(root().textContent ?? '', /অনুমতি/);
    assert.equal(root().querySelector('[name="day"]'), null, 'no date control around a refusal');
  });

  test('a failed (not refused) day keeps its date control', async () => {
    mount({ routine: () => ({ status: 500, body: {} }) });
    await settle();
    assert.ok(root().querySelector('[role="alert"]'));
    assert.ok(root().querySelector('[name="day"]'), 'another day may well load');
  });
});
