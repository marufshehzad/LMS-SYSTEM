/**
 * UX sweep — the settings screen (group adminsettings).
 *
 *  - 43  The notice-SMS length field refused Bangla digits without a word:
 *        "২৪০" (inside ৭০–৪৮০) was read with Number(), became NaN, greyed
 *        out সংরক্ষণ and priced the default (৩ টি) instead of ৪. An
 *        out-of-range value (৯৯৯) also just greyed the button, and because
 *        that button is the form's submit, Enter was swallowed too — the
 *        range message in the submit handler could never be reached. The
 *        field showed its count in Latin digits ("180") beside ১৮০.
 *
 * #/adminsettings mounts inside the shell's view, and the shell arms
 * `keepFocusWithin` on that view. The focus test arms it the same way, so it
 * checks what a keyboard user gets in the app.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { AdminSettingsView } from '../src/admin-settings-view.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';
import { bnNum } from '../src/view-states.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0)); };

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.HTMLFormElement = dom.window.HTMLFormElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.Event = dom.window.Event;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
});

let stopKeeper: () => void = () => {};
beforeEach(() => {
  doc().body.innerHTML = '<main id="root"></main>';
  stopKeeper = keepFocusWithin(root());
});
afterEach(() => { stopKeeper(); });

const LIMITS = { noticeMaxChars: 180, default: 180, min: 70, max: 480, charsPerSegment: 70 };

interface Call { url: string; method: string; body: unknown }

/** GET answers the limits; PUT echoes the saved length back, as the server does. */
function server(opts: { holdPut?: Promise<void> } = {}) {
  const calls: Call[] = [];
  let saved = LIMITS.noticeMaxChars;
  const auth = {
    tenantId: 't-1', role: 'it_admin',
    authedFetch: async (url: string, init?: RequestInit) => {
      const c: Call = {
        url, method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(c);
      if (c.method === 'PUT') {
        if (opts.holdPut) await opts.holdPut;
        saved = (c.body as { sms: { noticeMaxChars: number } }).sms.noticeMaxChars;
      }
      const body = { sms: { ...LIMITS, noticeMaxChars: saved } };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    },
  };
  return { auth, calls, puts: () => calls.filter((c) => c.method === 'PUT') };
}

async function mount(canManage = true, opts: { holdPut?: Promise<void> } = {}) {
  const s = server(opts);
  new AdminSettingsView({ root: root(), doc: doc(), auth: s.auth as never, canManage });
  await settle();
  return s;
}

const input = () => root().querySelector('[name="noticeMaxChars"]') as HTMLInputElement;
const saveBtn = () =>
  [...root().querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'সংরক্ষণ') as
    HTMLButtonElement;
const costLine = () => (root().querySelector('#sms-cost-note')?.textContent ?? '').trim();
const fieldRoot = () => input().closest('.ui-field') as HTMLElement;
const fieldError = () => fieldRoot().querySelector('.ui-field-error') as HTMLElement;

/** Type as a keyboard does: the value changes, then `input` fires. */
function type(value: string): void {
  const i = input();
  i.focus();
  i.value = value;
  i.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

describe('settings — the SMS length accepts Bangla digits (43)', () => {
  test('"২৪০" keeps সংরক্ষণ pressable, prices ২৪০ letters, and saves 240', async () => {
    const s = await mount();
    type('২৪০');
    assert.equal(saveBtn().disabled, false, 'an in-range Bangla entry does not grey out save');
    assert.equal(fieldError().hidden, true, 'and is not an error');
    assert.match(costLine(), new RegExp(`${bnNum(4)} টি এসএমএস`),
      '২৪০ ÷ ৭০ = ৪ segments — not the default’s ৩');
    const warn = root().querySelector('.inline-notice') as HTMLElement;
    assert.equal(warn.hidden, false, 'over the recommendation, so the cost warning shows');

    saveBtn().click();
    await settle();
    assert.equal(s.puts().length, 1, 'the tap reached the server');
    assert.deepEqual(s.puts()[0].body, { sms: { noticeMaxChars: 240 } },
      'the number sent is the one typed, as a number');
    assert.match(root().textContent ?? '', new RegExp(`সর্বোচ্চ ${bnNum(240)} অক্ষর`));
  });

  test('a prefill edited to mixed digits ("18৫") is read as ১৮৫', async () => {
    const s = await mount();
    type('18৫');
    assert.equal(saveBtn().disabled, false);
    assert.match(costLine(), new RegExp(`${bnNum(3)} টি এসএমএস`));
    saveBtn().click();
    await settle();
    assert.deepEqual(s.puts()[0]?.body, { sms: { noticeMaxChars: 185 } });
  });

  test('the count is shown in Bangla digits, and the reset writes Bangla digits back', async () => {
    await mount();
    assert.equal(input().value, bnNum(180), 'a count of letters, beside প্রস্তাবিত (১৮০)');
    type('300');
    const reset = [...root().querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('প্রস্তাবিত')) as HTMLButtonElement;
    reset.click();
    assert.equal(input().value, bnNum(180));
    assert.match(costLine(), new RegExp(`${bnNum(3)} টি এসএমএস`));
  });
});

describe('settings — a refused value says why, where it was typed (43)', () => {
  test('৯৯৯: save stays pressable, and pressing it shows the range at the field', async () => {
    const s = await mount();
    type('৯৯৯');
    assert.equal(saveBtn().disabled, false,
      'a greyed button explains nothing and swallows Enter');
    saveBtn().click();
    await settle();
    assert.equal(s.puts().length, 0, 'an out-of-range value is still never sent');
    assert.equal(fieldError().hidden, false, 'the error is shown');
    assert.match(fieldError().textContent ?? '',
      new RegExp(`${bnNum(70)} থেকে ${bnNum(480)} এর মধ্যে`));
    assert.equal(input().getAttribute('aria-invalid'), 'true');
    assert.equal(active(), input(), 'focus is on the field to correct');
    assert.equal(input().value, '৯৯৯', 'what was typed stays in front of them');

    type('৪০০');
    assert.equal(fieldError().hidden, true, 'the error clears as they correct it');
  });

  test('Latin out-of-range and an empty field are refused the same way', async () => {
    const s = await mount();
    for (const v of ['50', '9000', '']) {
      type(v);
      saveBtn().click();
      await settle();
      assert.equal(fieldError().hidden, false, `"${v}" is refused with a message`);
    }
    assert.equal(s.puts().length, 0);
  });

  test('no estimate is priced for a value nobody typed', async () => {
    await mount();
    type('');
    assert.equal(costLine(), '', 'an empty field is not "১ টি এসএমএস"');
    type('abc');
    assert.equal(costLine(), '', 'nor is text that is not a number');
  });

  test('the submit reads the field itself, not only the last input event', async () => {
    const s = await mount();
    // A value that arrived without an `input` event (restored by the browser,
    // set by an assistive tool) is what the person sees, so it is what is sent.
    input().value = '৩০০';
    saveBtn().click();
    await settle();
    assert.deepEqual(s.puts()[0]?.body, { sms: { noticeMaxChars: 300 } });
  });

  test('a second submit while the first is saving sends nothing', async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => { release = r; });
    const s = await mount(true, { holdPut: hold });
    type('২৪০');
    saveBtn().click();
    await settle();
    assert.equal(s.puts().length, 1);
    // Save is no longer disabled for a refused value, so the handler itself
    // must refuse while busy (a scripted or assistive submit of the rebuilt form).
    const form = root().querySelector('#sms-settings-form') as HTMLFormElement;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(s.puts().length, 1, 'one save at a time');
    release();
    await settle();
    assert.match(root().textContent ?? '', /সংরক্ষিত/);
  });

  test('read-only callers still get a disabled save', async () => {
    await mount(false);
    assert.equal(saveBtn().disabled, true);
    assert.equal(input().disabled, true);
  });
});

describe('settings — focus after a save (43, 71)', () => {
  test('saving from the field leaves focus in the field, not on <body>', async () => {
    await mount();
    type('২৪০');
    saveBtn().click();
    await settle();
    assert.match(root().textContent ?? '', /সংরক্ষিত/);
    assert.equal(active(), input(), 'the rebuilt field has focus again');
    assert.equal(input().value, bnNum(240));
  });

  test('saving with a tap on সংরক্ষণ gives focus back to সংরক্ষণ', async () => {
    await mount();
    type('২৪০');
    saveBtn().focus();
    saveBtn().click();
    await settle();
    assert.match(root().textContent ?? '', /সংরক্ষিত/);
    assert.equal(active(), saveBtn(), 'the rebuilt, re-enabled header save');
  });
});
