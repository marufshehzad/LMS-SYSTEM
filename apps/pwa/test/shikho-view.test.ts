/**
 * ShikhoAI tutor — F-809 / F-1302 / F-1311, wireframe §6.7.
 *
 * This is the screen where a machine talks to a child, so the rule it must
 * never break is not a layout rule: EVERY answer says where it came from.
 * A grounded reply names its NCTB sections; an ungrounded one admits it is
 * not quoting the textbook; a refusal and an offline turn are honest states
 * of their own, never a hang and never a confident-looking answer.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ShikhoView } from '../src/shikho-view.ts';

let dom: JSDOM;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
                  { url: 'http://localhost/' });
  (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
  // navigator.onLine drives the offline branch; default it to online.
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true }, configurable: true, writable: true,
  });
});

beforeEach(() => {
  localStorage.clear();
  (globalThis.navigator as { onLine: boolean }).onLine = true;
});

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

/** Mounts the tutor with a stubbed gateway reply. */
function mount(reply: Record<string, unknown>, ok = true) {
  const root = dom.window.document.getElementById('root') as HTMLElement;
  root.textContent = '';
  const auth = {
    authedFetch: async () => ({ ok, status: ok ? 200 : 500, json: async () => reply }),
  } as never;
  new ShikhoView({ root, doc: dom.window.document, auth });
  return root;
}

async function ask(root: HTMLElement, question = 'শব্দ কেন শূন্যে চলে না?') {
  const input = root.querySelector('.chat-input') as HTMLInputElement;
  input.value = question;
  (root.querySelector('.chat-form') as HTMLFormElement)
    .dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await settle();
}

describe('ShikhoAI answer states (F-1302, §6.7)', () => {
  test('THE ONE THAT MATTERS — a grounded reply names its NCTB source', async () => {
    const root = mount({
      ok: true, reply: 'ভাবো, শব্দ কীভাবে যায়?',
      grounded: true, sources: ['পদার্থবিজ্ঞান ৯ম-১০ম / অধ্যায় ৯'],
    });
    await ask(root);

    const answer = root.querySelector('.chat-answer') as HTMLElement;
    assert.ok(answer, 'the assistant turn renders');
    assert.equal(answer.dataset.kind, 'grounded');
    const src = answer.querySelector('.chat-source')!.textContent ?? '';
    assert.match(src, /NCTB/, 'the source line names NCTB');
    assert.match(src, /অধ্যায় ৯/, 'and the actual section it used');
  });

  test('an ungrounded reply admits it is not the textbook', async () => {
    const root = mount({ ok: true, reply: 'সাধারণভাবে…', grounded: false, sources: [] });
    await ask(root);

    const answer = root.querySelector('.chat-answer') as HTMLElement;
    assert.equal(answer.dataset.kind, 'ungrounded');
    // The distinction has to be legible, not merely encoded in a data
    // attribute: an ungrounded answer must not read as a textbook answer.
    const src = answer.querySelector('.chat-source')!.textContent ?? '';
    assert.doesNotMatch(src, /✓ NCTB/, 'it does not claim a textbook source');
    assert.match(src, /পাওয়া যায়নি/, 'it says the passage was not found');
  });

  test('a refusal is its own honest state, not a confident answer', async () => {
    const root = mount({ ok: true, error: 'ai_refused' });
    await ask(root, 'আমার হোমওয়ার্কের উত্তর বলে দাও');

    const answer = root.querySelector('.chat-answer') as HTMLElement;
    assert.equal(answer.dataset.kind, 'refused');
    assert.match(answer.textContent ?? '', /শিক্ষককে/, 'and it points somewhere real');
  });

  test('F-1311 — offline answers immediately and offers cached study', async () => {
    // Something is cached, so the dead end has a way out.
    localStorage.setItem('shikhon_practice_tp-1', '[]');
    (globalThis.navigator as { onLine: boolean }).onLine = false;
    // The fetch would hang/throw; the view must never reach it.
    const root = mount({ ok: true, reply: 'should not be used', grounded: true });
    await ask(root);

    const answer = root.querySelector('.chat-answer') as HTMLElement;
    assert.equal(answer.dataset.kind, 'unavailable');
    assert.doesNotMatch(answer.textContent ?? '', /should not be used/, 'no network reply is shown');
    const cta = answer.querySelector('.chat-offline-cta');
    assert.ok(cta, 'cached lessons are offered instead of a dead end');
  });

  test('offline with nothing cached does not promise study that is not there', async () => {
    (globalThis.navigator as { onLine: boolean }).onLine = false;
    const root = mount({ ok: true, reply: 'x' });
    await ask(root);
    assert.equal(root.querySelector('.chat-offline-cta'), null);
  });

  test('the pinned scope is visible in the header', async () => {
    const root = mount({ ok: true, reply: 'x', grounded: true });
    await settle();
    // P6 gave this screen the page header it never had; the pinned scope is
    // now the header's own subtitle rather than a stray `.att-sub`.
    assert.match(root.querySelector('.page-sub')?.textContent ?? '', /শ্রেণির পাঠ্যসূচি/);
  });

  test('a 403 is a refusal in words, not a connection problem', async () => {
    const root = dom.window.document.getElementById('root') as HTMLElement;
    root.textContent = '';
    const auth = {
      authedFetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }),
    } as never;
    new ShikhoView({ root, doc: dom.window.document, auth });
    await ask(root);

    const denied = root.querySelector('.ui-state-denied');
    assert.ok(denied, 'the denied state renders');
    assert.match(denied!.textContent ?? '', /অনুমতি/, 'and it says permission, in Bangla');
    assert.doesNotMatch(root.textContent ?? '', /সংযোগে সমস্যা/, 'it does not blame the connection');
    // R8: the old 403 line was role="alert". Focus goes back to the input on
    // render, so a refusal that is not a live region is never heard.
    const alerts = [...root.querySelectorAll('[role="alert"]')];
    assert.ok(alerts.some((a) => /অনুমতি/.test(a.textContent ?? '')),
      'the refusal is announced, not only shown');
  });

  test('a school without the tutor hears the server\'s sentence, and no colleague is named', async () => {
    const root = dom.window.document.getElementById('root') as HTMLElement;
    root.textContent = '';
    const reason = 'আপনার প্রতিষ্ঠানের প্ল্যানে শিখো টিউটর নেই।';
    const auth = {
      authedFetch: async () => ({
        ok: false, status: 403,
        json: async () => ({ error: 'tenant_blocked', message: reason }),
      }),
    } as never;
    new ShikhoView({ root, doc: dom.window.document, auth });
    await ask(root);

    const alert = root.querySelector('.ui-state-denied[role="alert"]');
    assert.ok(alert, 'the refusal card is a live region');
    assert.match(alert!.textContent ?? '', /প্ল্যানে শিখো টিউটর নেই/, 'it reads the entitlement sentence');
    assert.doesNotMatch(alert!.textContent ?? '', /প্রধান শিক্ষক/, 'and sends nobody to the head teacher');
  });
});

describe('ShikhoAI — the Ata Ekta composer (03 Student §05)', () => {
  test('the class picker still sets the class that is sent, and the scope line follows', async () => {
    const root = dom.window.document.getElementById('root') as HTMLElement;
    root.textContent = '';
    const sent: Array<{ message: string; classLevel: number }> = [];
    const auth = {
      authedFetch: async (_p: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => ({ ok: true, reply: 'x', grounded: false }) };
      },
    } as never;
    new ShikhoView({ root, doc: dom.window.document, auth });

    const sel = root.querySelector('select.chat-class') as HTMLSelectElement;
    assert.ok(sel, 'the picker is on the screen');
    assert.equal(sel.getAttribute('aria-label'), 'শ্রেণি', 'and keeps its accessible name');
    sel.value = '10';
    sel.dispatchEvent(new dom.window.Event('change'));
    assert.match(root.querySelector('.page-sub')?.textContent ?? '', /দশম/, 'the scope line names the new class');

    await ask(root);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].classLevel, 10, 'the question is asked about the class that was picked');
  });

  test('the composer is the input and one named submit — the page\'s only primary', async () => {
    const root = mount({ ok: true, reply: 'x' });
    const form = root.querySelector('.chat-form') as HTMLFormElement;
    const input = form.querySelector('.chat-input') as HTMLInputElement;
    assert.ok(input.getAttribute('aria-label'), 'the input has a name, not only a placeholder');
    const send = form.querySelector('button.chat-send') as HTMLButtonElement;
    assert.equal(send.type, 'submit');
    assert.equal(send.getAttribute('aria-label'), 'পাঠাও', 'an icon-only send still has its word');
    assert.equal(root.querySelectorAll('.btn-primary').length, 1, 'one primary on the screen');
  });

  test('waiting for a reply is a skeleton on the tutor side, and send cannot be pressed twice', async () => {
    const root = dom.window.document.getElementById('root') as HTMLElement;
    root.textContent = '';
    let answer: (v: unknown) => void = () => {};
    const auth = {
      authedFetch: () => new Promise((r) => { answer = r; }),
    } as never;
    new ShikhoView({ root, doc: dom.window.document, auth });
    await ask(root);

    const typing = root.querySelector('.chat-typing') as HTMLElement;
    assert.ok(typing, 'something is shown while the tutor thinks');
    assert.equal(typing.getAttribute('aria-busy'), 'true');
    assert.ok(typing.querySelector('.skel'), 'as skeleton rows');
    assert.equal((root.querySelector('.chat-send') as HTMLButtonElement).disabled, true);

    answer({ ok: true, status: 200, json: async () => ({ ok: true, reply: 'x', grounded: false }) });
    await settle();
    assert.equal(root.querySelector('.chat-typing'), null, 'and it goes when the answer arrives');
  });

  test('R6 — a number in the source line is set in the numeral face', async () => {
    const root = mount({
      ok: true, reply: 'ভাবো, শব্দ কীভাবে যায়?',
      grounded: true, sources: ['পদার্থবিজ্ঞান ৯ম-১০ম / অধ্যায় ৯'],
    });
    await ask(root);
    const src = root.querySelector('.chat-source') as HTMLElement;
    const nums = [...src.querySelectorAll('.n')].map((n) => n.textContent);
    assert.ok(nums.includes('৯'), 'the chapter number carries .n');
    assert.match(src.textContent ?? '', /অধ্যায় ৯/, 'and the words read exactly as before');
  });
});
