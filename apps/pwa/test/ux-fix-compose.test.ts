/**
 * UX fixes, group "compose" — নোটিশ পাঠান (notice-compose-view.ts).
 *
 * Confirmed findings 3, 11, 55 and 56. One cause under all four: the composer
 * redrew itself — `root.textContent = ''` and build again — while a person was
 * using it.
 *
 *   - 3 / 11 / 56: an estimate landing 400 ms after a pause in typing rebuilt
 *     the title and body under the caret. Focus fell to <body>, a phone's
 *     keyboard closed, the next keys went nowhere, and a Bangla keyboard's
 *     composition was cut. In the demo (a preview reply with no estimate
 *     fields) it happened on every pause, the counter and Send froze, and a
 *     chip press blanked the whole form.
 *   - 55: an audience chip, the SMS box, the ধরন select and the time field
 *     each rebuilt the form, so focus fell to <body> and the next Tab landed on
 *     "সবাই" — Enter there silently widened the audience to everyone.
 *
 * Every test here asks for the SAME node to still be there, and still focused,
 * after the thing that used to rebuild it. A focus keeper can put focus back
 * on a rebuilt field; it cannot give an Android keyboard back its composition.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { NoticeComposeView } from '../src/notice-compose-view.ts';
import { keepFocusWithin } from '../src/ui/index.ts';

let dom: JSDOM;
let errors: unknown[];

beforeEach(() => {
  dom = new JSDOM(
    '<!doctype html><html><body><main id="shell-view"><div id="root"></div></main></body></html>',
    { url: 'https://school.example/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.Event = dom.window.Event;
  errors = [];
  // An exception inside an event listener does not reach dispatchEvent's
  // caller; jsdom reports it on the window, the way a browser would.
  dom.window.addEventListener('error', (e) => { errors.push(e.error ?? e.message); e.preventDefault(); });
});

const doc = () => dom.window.document;
const root = () => doc().getElementById('root')!;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Past the 400 ms estimate debounce, and the stubbed fetch after it. */
const pastEstimate = () => wait(700);

const SECTIONS = {
  sections: [
    { id: '7bd00000-0000-4000-8000-00000000000a', name: 'ক', className: { bn: 'নবম' } },
    { id: '7bd00000-0000-4000-8000-00000000000b', name: 'খ', className: { bn: 'নবম' } },
  ],
};

/** What the server's preview returns (services/ops-svc/api/notices.ts previewAudience). */
function estimateFor(smsRecipients: number, segmentsEach = 1) {
  const segmentsTotal = smsRecipients * segmentsEach;
  return {
    recipients: smsRecipients + 5, smsRecipients, segmentsEach, segmentsTotal,
    confirmThreshold: 200, needsConfirmation: segmentsTotal > 200,
  };
}

/** The demo's old answer to `?preview=1`: the publish reply, no estimate fields. */
const PUBLISH_REPLY = { noticeId: 'demo-new', status: 'published', recipients: 42, smsQueued: false };

interface MountOptions {
  role?: string;
  /** The preview reply, given what the composer asked. Throwing means offline. */
  preview?: (asked: { sendSms?: boolean; title?: string; body?: string }) => unknown;
  /** The section list; resolve it when the test says so. */
  sections?: () => Promise<Response>;
}

function mount(o: MountOptions = {}) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  const auth = {
    role: o.role ?? 'principal',
    tenantId: 't1', userId: 'u1', displayName: 'পরীক্ষা',
    isLoggedIn: () => true,
    authedFetch: async (path: string, init?: RequestInit) => {
      if (path.includes('preview=1')) {
        const asked = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return json((o.preview ?? (() => estimateFor(12)))(asked));
      }
      if (path.startsWith('/api/v1/academics/sections')) {
        return o.sections ? o.sections() : json(SECTIONS);
      }
      return json(PUBLISH_REPLY);
    },
  };
  const view = new NoticeComposeView({ root: root(), doc: doc(), auth: auth as never });
  return { view };
}

function q<T extends Element>(sel: string): T {
  const node = root().querySelector<T>(sel);
  assert.ok(node, `missing ${sel}`);
  return node;
}

/** Type the way a keyboard does: the value grows, the caret follows, `input` fires. */
function type(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  field.value += text;
  field.setSelectionRange(field.value.length, field.value.length);
  field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function chip(label: string): HTMLButtonElement {
  const found = [...root().querySelectorAll<HTMLButtonElement>('.audience-chip')]
    .find((c) => c.textContent === label);
  assert.ok(found, `no chip ${label}`);
  return found;
}

const settle = () => wait(0);

describe('findings 3, 11, 56 — an estimate never rebuilds the field being typed in', () => {
  test('a reply that is not an estimate (the demo\'s publish reply): focus, counter and Send all survive', async () => {
    mount({ preview: () => PUBLISH_REPLY });
    await settle();

    const title = q<HTMLInputElement>('[name="title"]');
    title.focus();
    type(title, 'আগামীকাল');
    await pastEstimate();
    assert.equal(root().querySelector('[name="title"]'), title,
      'the title field was rebuilt under the caret after a pause');
    assert.equal(doc().activeElement, title, 'focus left the title after a pause');

    const body = q<HTMLTextAreaElement>('[name="body"]');
    body.focus();
    type(body, 'ছুটি');
    await pastEstimate();
    assert.equal(root().querySelector('[name="body"]'), body);
    assert.equal(doc().activeElement, body);
    assert.equal(q('[data-char-count]').textContent, '৪ / ৪,০০০ অক্ষর',
      'the counter froze — liveText threw on the missing estimate fields');
    assert.equal(q<HTMLButtonElement>('[data-send]').disabled, false,
      'Send stayed disabled with both fields filled');
    // No estimate is a dash, never a guess and never "undefined".
    assert.equal(q('[data-estimate-recipients]').textContent, '—');

    chip('সব অভিভাবক').click();
    await pastEstimate();
    assert.equal(root().querySelector('[name="title"]'), title,
      'a chip press blanked the composer');
    assert.equal(title.value, 'আগামীকাল');
    assert.equal(body.value, 'ছুটি');
    assert.deepEqual(errors, []);
  });

  test('the gate appearing mid-typing leaves the title, its focus and its caret alone', async () => {
    mount({ preview: () => estimateFor(900, 5) });
    await settle();

    const title = q<HTMLInputElement>('[name="title"]');
    title.focus();
    type(title, 'পরীক্ষার সূচি');
    title.setSelectionRange(3, 3);           // the caret mid-word
    await pastEstimate();

    assert.ok(root().querySelector('[data-big-send]'), 'the gate should be drawn');
    assert.equal(root().querySelector('[name="title"]'), title,
      'the gate flip rebuilt the field being typed in');
    assert.equal(doc().activeElement, title);
    assert.equal(title.selectionStart, 3, 'the caret moved');
  });

  test('the gate going away mid-typing leaves the body alone', async () => {
    let size = 900;
    mount({ preview: () => estimateFor(size, 5) });
    await settle();
    type(q<HTMLInputElement>('[name="title"]'), 'ছুটি');
    await pastEstimate();
    assert.ok(root().querySelector('[data-big-send]'));

    size = 10;
    const body = q<HTMLTextAreaElement>('[name="body"]');
    body.focus();
    type(body, 'আগামীকাল');
    await pastEstimate();
    assert.equal(root().querySelector('[data-big-send]'), null, 'a small send is not gated');
    assert.equal(root().querySelector('[name="body"]'), body);
    assert.equal(doc().activeElement, body);
  });

  test('a reply that omits needsConfirmation but is over the threshold is still gated', async () => {
    // Fails closed: a missing flag is not permission.
    mount({ preview: () => { const e: Record<string, unknown> = estimateFor(900, 5); delete e.needsConfirmation; return e; } });
    await settle();
    type(q<HTMLInputElement>('[name="title"]'), 'ছুটি');
    type(q<HTMLTextAreaElement>('[name="body"]'), 'আগামীকাল');
    await pastEstimate();
    assert.ok(root().querySelector('[data-big-send]'));
    assert.equal(q<HTMLButtonElement>('[data-send]').disabled, true);
  });

  test('focus on Send when the gate appears goes to the tick, not to <body>', async () => {
    mount({ preview: () => estimateFor(900, 5) });
    await settle();
    type(q<HTMLInputElement>('[name="title"]'), 'ছুটি');
    type(q<HTMLTextAreaElement>('[name="body"]'), 'আগামীকাল');
    const send = q<HTMLButtonElement>('[data-send]');
    assert.equal(send.disabled, false);
    send.focus();
    await pastEstimate();

    const tick = q<HTMLInputElement>('[data-big-send] input[type=checkbox]');
    assert.equal(doc().activeElement, tick,
      'Send was replaced and blocked; focus must go to the step that unblocks it');
  });

  test('a failed re-count keeps the gate; the tick is checked against the numbers it was given for', async () => {
    let reply: () => unknown = () => estimateFor(900, 5);
    mount({ preview: () => reply() });
    await settle();
    type(q<HTMLInputElement>('[name="title"]'), 'ছুটি');
    const body = q<HTMLTextAreaElement>('[name="body"]');
    type(body, 'আগামীকাল');
    await pastEstimate();

    const tick = q<HTMLInputElement>('[data-big-send] input[type=checkbox]');
    tick.checked = true;
    tick.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(q<HTMLButtonElement>('[data-send]').disabled, false);

    // Offline for one re-count: no count is not a small count.
    reply = () => { throw new Error('offline'); };
    type(body, ' বন্ধ');
    await pastEstimate();
    assert.ok(root().querySelector('[data-big-send]'), 'a failed re-count removed the gate');

    // Back online, and the send is now bigger than what was ticked.
    reply = () => estimateFor(1000, 5);
    type(body, ' থাকবে');
    await pastEstimate();
    assert.equal(q<HTMLInputElement>('[data-big-send] input[type=checkbox]').checked, false,
      'a tick given for ৪,৫০০ messages carried over to ৫,০০০');
    assert.equal(q<HTMLButtonElement>('[data-send]').disabled, true);
  });

  test('a tick given for the notice just sent is not carried to the next one', async () => {
    // Same audience, same length: the next estimate has the same totals, and
    // "the totals changed" was the only thing that ever withdrew a tick.
    mount({ preview: () => estimateFor(900, 5) });
    await settle();
    type(q<HTMLInputElement>('[name="title"]'), 'ছুটি');
    type(q<HTMLTextAreaElement>('[name="body"]'), 'আগামীকাল');
    await pastEstimate();
    const tick = q<HTMLInputElement>('[data-big-send] input[type=checkbox]');
    tick.checked = true;
    tick.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    q<HTMLButtonElement>('[data-send]').click();
    await wait(20);
    assert.match(root().textContent ?? '', /জনের কাছে পৌঁছেছে/, 'the first notice was sent');
    assert.equal(root().querySelector('[data-big-send] input:checked'), null,
      'the empty composer still showed the last send ticked');

    type(q<HTMLInputElement>('[name="title"]'), 'সভা');
    type(q<HTMLTextAreaElement>('[name="body"]'), 'আগামীকাল');
    await pastEstimate();
    assert.equal(q<HTMLInputElement>('[data-big-send] input[type=checkbox]').checked, false,
      'a second 4,500-message send went out on the first one\'s tick');
    assert.equal(q<HTMLButtonElement>('[data-send]').disabled, true);
  });

  test('the section list arriving while the author types does not rebuild the title', async () => {
    let release!: () => void;
    const arrived = new Promise<void>((r) => { release = r; });
    mount({
      role: 'class_teacher',
      sections: async () => {
        await arrived;
        return new Response(JSON.stringify(SECTIONS), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    await settle();
    const title = q<HTMLInputElement>('[name="title"]');
    title.focus();
    type(title, 'ab');
    release();
    await wait(10);

    assert.equal(root().querySelectorAll('.audience-section input').length, 2, 'the sections landed');
    assert.equal(root().querySelector('[name="title"]'), title, 'the sections rebuilt the title');
    assert.equal(doc().activeElement, title);
    assert.equal(title.value, 'ab');
  });
});

describe('finding 55 — a control keeps focus after it is used', () => {
  test('an audience chip keeps focus, and the pressed state moves with it', async () => {
    mount();
    await settle();
    const guardians = chip('সব অভিভাবক');
    guardians.focus();
    guardians.click();

    assert.equal(root().querySelector('.audience-chip[data-audience="guardians"]'), guardians);
    assert.equal(doc().activeElement, guardians,
      'focus fell to <body>; the next Tab would land on "সবাই"');
    assert.equal(guardians.getAttribute('aria-pressed'), 'true');
    assert.equal(chip('সবাই').getAttribute('aria-pressed'), 'false');
    assert.equal(q('[data-audience-line]').textContent, 'সব অভিভাবক');

    // The section chip opens the list under the chips, in place.
    const section = chip('নির্দিষ্ট শাখা');
    section.focus();
    section.click();
    assert.equal(doc().activeElement, section);
    assert.equal(root().querySelectorAll('.audience-section input').length, 2);
    assert.equal(q('.audience-chips').nextElementSibling, q('.audience-sections'));

    chip('সবাই').focus();
    chip('সবাই').click();
    assert.equal(root().querySelector('.audience-sections'), null);
    assert.equal(doc().activeElement, chip('সবাই'));
    assert.deepEqual(errors, []);
  });

  test('the SMS box keeps focus, and what it decides appears and goes in place', async () => {
    mount();
    await settle();
    const box = q<HTMLInputElement>('[data-sms-toggle]');
    box.focus();
    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assert.equal(root().querySelector('[data-sms-toggle]'), box);
    assert.equal(doc().activeElement, box, 'ticking SMS sent focus to <body>');
    assert.ok(root().querySelector('[data-sms-cost]'), 'the cost belongs next to the toggle');
    assert.ok(root().querySelector('[data-sms-note]'));

    box.checked = false;
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(doc().activeElement, box);
    assert.equal(root().querySelector('[data-sms-cost]'), null);
    assert.equal(root().querySelector('[data-sms-note]'), null);
  });

  test('ধরন keeps focus, so a second ArrowDown still moves it', async () => {
    mount();
    await settle();
    const cat = q<HTMLSelectElement>('select[name="category"]');
    cat.focus();
    cat.value = 'emergency';
    cat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assert.equal(root().querySelector('select[name="category"]'), cat);
    assert.equal(doc().activeElement, cat, 'the first ArrowDown sent focus to <body>');
    // Emergency suggests SMS; the box and the counter row follow in place.
    assert.equal(q<HTMLInputElement>('[data-sms-toggle]').checked, true);
    assert.ok(root().querySelector('[data-sms-cost]'));

    cat.value = 'exam';
    cat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(doc().activeElement, cat);
    assert.equal(q<HTMLInputElement>('[data-sms-toggle]').checked, false);
  });

  test('a category that turns SMS on re-asks the cost, so a big send is gated before Send', async () => {
    // The whole school, no SMS: nothing to confirm. The same send with SMS: 900.
    mount({
      preview: (asked) => (asked.sendSms === true
        ? estimateFor(900)
        : { ...estimateFor(0), recipients: 905 }),
    });
    await settle();
    type(q<HTMLInputElement>('[name="title"]'), 'ছুটি');
    type(q<HTMLTextAreaElement>('[name="body"]'), 'আগামীকাল');
    await pastEstimate();
    assert.equal(root().querySelector('[data-big-send]'), null);
    assert.equal(q<HTMLButtonElement>('[data-send]').disabled, false);

    const cat = q<HTMLSelectElement>('select[name="category"]');
    cat.focus();
    cat.value = 'emergency';                  // suggests SMS; the author never touched the box
    cat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await pastEstimate();

    assert.equal(q<HTMLInputElement>('[data-sms-toggle]').checked, true);
    assert.ok(root().querySelector('[data-big-send]'),
      'SMS went on to 900 phones and the estimate still said none: Send was never gated');
    assert.equal(q<HTMLButtonElement>('[data-send]').disabled, true);
    assert.equal(q('[data-estimate-sms]').textContent, '৯০০');
    assert.equal(doc().activeElement, cat, 'the gate appearing moved focus off ধরন');
  });

  test('the time field keeps focus, and Send says when', async () => {
    mount();
    await settle();
    const at = q<HTMLInputElement>('input[name="publishAt"]');
    at.focus();
    at.value = '2026-09-20T09:00';
    at.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assert.equal(root().querySelector('input[name="publishAt"]'), at);
    assert.equal(doc().activeElement, at);
    assert.equal(q('[data-send]').textContent, 'নির্ধারিত সময়ে পাঠান');
    assert.match(at.closest('.ui-field')!.textContent ?? '', /রক্ষণাবেক্ষণ চক্রে/);
  });

  test('retrying the section list puts focus on the section chip, not <body>', async () => {
    let fail = true;
    mount({
      role: 'class_teacher',
      sections: async () => new Response(JSON.stringify(fail ? {} : SECTIONS), {
        status: fail ? 500 : 200, headers: { 'Content-Type': 'application/json' },
      }),
    });
    await wait(10);
    const retry = [...root().querySelectorAll<HTMLButtonElement>('.audience-sections button')]
      .find((b) => b.textContent === 'আবার চেষ্টা করুন');
    assert.ok(retry, 'the failed list offers a retry');
    fail = false;
    retry.focus();
    retry.click();
    assert.equal(doc().activeElement, chip('নির্দিষ্ট শাখা'));
    await wait(10);
    assert.equal(root().querySelectorAll('.audience-section input').length, 2);
    assert.equal(doc().activeElement, chip('নির্দিষ্ট শাখা'));
  });

  test('with the shell\'s focus keeper armed, nothing is rebuilt and nothing is parked', async () => {
    const stop = keepFocusWithin(doc().getElementById('shell-view')!);
    try {
      mount({ preview: () => estimateFor(900, 5) });
      await settle();
      const title = q<HTMLInputElement>('[name="title"]');
      title.focus();
      type(title, 'ছুটি');
      await pastEstimate();
      assert.ok(root().querySelector('[data-big-send]'));
      assert.equal(root().querySelector('[name="title"]'), title);
      assert.equal(doc().activeElement, title);

      const box = q<HTMLInputElement>('[data-sms-toggle]');
      box.focus();
      box.checked = true;
      box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await settle();
      assert.equal(doc().activeElement, box);
    } finally {
      stop();
    }
  });
});

describe('minor 101 — the refusal for a role that cannot send', () => {
  test('says the task is not theirs, not that they may not "see sending"', async () => {
    mount({ role: 'student' });
    await settle();
    const text = root().textContent ?? '';
    assert.match(text, /এই কাজটি করার অনুমতি আপনার নেই।/);
    assert.doesNotMatch(text, /দেখার অনুমতি/);
    assert.equal(root().querySelector('[name="title"]'), null, 'no composer for a student');
  });
});
