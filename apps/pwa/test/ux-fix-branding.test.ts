/**
 * UX sweep — প্রতিষ্ঠানের পরিচয় (#/branding), group branding.
 *
 * #/branding mounts into the shell's view, and the shell arms
 * `keepFocusWithin` on that view for every route. These tests arm it the same
 * way on the view root, so focus is checked as a keyboard user gets it.
 *
 *  - 42  every validation error was ui-core's English sentence with the raw
 *        field key in it ("website must be a full https:// address",
 *        "primaryColor must be a hex colour like #1A73E8"), from the local
 *        check and from the server's 400 alike.
 *  - 15 / 50 / 72  the English-name row was labelled "Institution name (English)".
 *  - 71  after a save (or a cancel) that worked, focus fell to <body>.
 *  - (found on the way) a phone typed with a Bangla keyboard's digits was
 *        refused as invalid although it was a correct number.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { BrandingView, brandingErrorBn } from '../src/branding-view.ts';
import { keepFocusWithin } from '../src/ui/dom.ts';
import { LIMITS } from '../../../packages/ui-core/src/branding.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const active = () => doc().activeElement as HTMLElement | null;
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0)); };

before(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'location', { value: dom.window.location, configurable: true, writable: true });
});

let stopKeeper: () => void = () => {};
beforeEach(() => {
  dom.window.localStorage.clear();
  doc().body.innerHTML = '<main id="root"></main>';
  stopKeeper = keepFocusWithin(root());
});
afterEach(() => { stopKeeper(); });

const SAVED = {
  nameBn: 'শাহজালাল আদর্শ উচ্চ বিদ্যালয়',
  nameEn: 'Shahjalal Adarsha High School',
  shortName: 'শাহজালাল',
  primaryColor: '#156a3f',
  accentColor: '#4e7a94',
  address: 'সিলেট',
  phone: '+8801711000000',
  email: 'office@shahjalal.edu.bd',
  website: 'https://shahjalal.edu.bd',
  headmasterName: 'মো. রফিক',
};

interface Reply { status: number; body: unknown }
interface Call { method: string; body: { branding?: Record<string, unknown> } | undefined }

function server(put: (c: Call) => Reply = (c) => ({ status: 200, body: { branding: c.body?.branding } })) {
  const calls: Call[] = [];
  const auth = {
    tenantId: 't-brand',
    authedFetch: async (_url: string, init?: RequestInit) => {
      const c: Call = {
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(c);
      const r = c.method === 'GET' ? { status: 200, body: { branding: SAVED } } : put(c);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as unknown as Response;
    },
  };
  return { auth, calls };
}

async function mount(s = server()) {
  new BrandingView({ root: root(), doc: doc(), auth: s.auth as never, canManage: true });
  await settle();
  return s;
}

const row = (key: string) => {
  const r = [...root().querySelectorAll<HTMLElement>('[data-brand-field]')]
    .find((n) => n.dataset.brandField === key);
  assert.ok(r, `the ${key} row is drawn`);
  return r;
};
function type(key: string, value: string): void {
  const input = row(key).querySelector<HTMLInputElement | HTMLTextAreaElement>('.ui-input')!;
  input.focus();
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
const headerButton = (label: string) =>
  [...root().querySelectorAll<HTMLButtonElement>('button.brand-action')]
    .find((b) => (b.textContent ?? '').includes(label))!;
/** Press as a keyboard user does: the control has focus, then it activates. */
function press(b: HTMLElement): void { b.focus(); b.click(); }
const errorText = (key: string) =>
  (row(key).querySelector('.ui-field-error:not([hidden])')?.textContent ?? '').trim();

/**
 * English a Bangla reader cannot use: a raw field key, or any run of Latin
 * words. The tokens a fix has to name exactly (https://, a hex example, image
 * formats) are allowed; nothing else is.
 */
function assertBangla(message: string, key: string): void {
  assert.ok(message, `an error is shown for ${key}`);
  assert.match(message, /[ঀ-৿]/, `the ${key} error is Bangla: ${message}`);
  assert.ok(!message.includes(key), `the ${key} error does not show the field key: ${message}`);
  const english = message.replace(/https:\/\/|#1A73E8|PNG|JPEG|WebP/g, '').match(/[A-Za-z]{2,}/g);
  assert.equal(english, null, `the ${key} error has no English words: ${message}`);
}

/* ── 42: the local check ────────────────────────────────────────────────── */

describe('branding — a validation error is said in Bangla beside its field (42)', () => {
  const cases: Array<{ key: string; value: string; expect: RegExp }> = [
    { key: 'email', value: 'abc', expect: /ইমেইল ঠিকানাটি সঠিক নয়/ },
    { key: 'website', value: 'example.com', expect: /ওয়েবসাইটের পুরো ঠিকানা দিন.*https:\/\// },
    { key: 'phone', value: 'abc', expect: /ফোন নম্বরটি সঠিক নয়/ },
    { key: 'primaryColor', value: 'red', expect: /^মূল রং হেক্স কোডে লিখুন, যেমন #1A73E8/ },
    { key: 'accentColor', value: 'blue', expect: /^সহায়ক রং হেক্স কোডে লিখুন/ },
    { key: 'nameBn', value: 'ক'.repeat(LIMITS.nameBn + 1), expect: /^প্রতিষ্ঠানের নাম সর্বোচ্চ ১২০ অক্ষরের হতে পারে।$/ },
    { key: 'address', value: 'ক'.repeat(LIMITS.address + 1), expect: /^ঠিকানা সর্বোচ্চ ৩০০ অক্ষরের হতে পারে।$/ },
  ];
  for (const c of cases) {
    test(`${c.key} = ${JSON.stringify(c.value.slice(0, 12))}`, async () => {
      const s = await mount();
      type(c.key, c.value);
      press(headerButton('সংরক্ষণ'));
      await settle();
      const message = errorText(c.key);
      assertBangla(message, c.key);
      assert.match(message, c.expect);
      assert.ok(row(c.key).contains(active()), 'focus is taken to the field in error, as before');
      assert.equal(s.calls.filter((x) => x.method === 'PUT').length, 0, 'nothing was sent');
    });
  }

  test('both names empty: the name row asks for a name in either language', async () => {
    await mount();
    type('nameBn', '');
    type('nameEn', '');
    press(headerButton('সংরক্ষণ'));
    await settle();
    const message = errorText('nameBn');
    assertBangla(message, 'nameBn');
    assert.match(message, /প্রতিষ্ঠানের নাম দিন — বাংলায় বা ইংরেজিতে/);
  });

  test('the error line keeps its numbers in the numeral face (R6)', async () => {
    await mount();
    type('nameBn', 'ক'.repeat(LIMITS.nameBn + 1));
    press(headerButton('সংরক্ষণ'));
    await settle();
    const n = row('nameBn').querySelector('.ui-field-error span.n');
    assert.equal(n?.textContent, '১২০');
  });
});

/* ── 42: the server's 400 ───────────────────────────────────────────────── */

describe('branding — the server’s English refusal is said in Bangla too (42)', () => {
  test('a field the server refused gets the Bangla sentence, not body.message', async () => {
    const s = await mount(server(() => ({
      status: 400,
      body: { error: 'invalid_branding', field: 'email', message: 'email is not a valid address' },
    })));
    type('email', 'head@shahjalal.edu.bd');
    press(headerButton('সংরক্ষণ'));
    await settle();
    assert.equal(s.calls.filter((x) => x.method === 'PUT').length, 1);
    const message = errorText('email');
    assertBangla(message, 'email');
    assert.match(message, /ইমেইল ঠিকানাটি সঠিক নয়/);
  });

  test('an image the server found too big names the image, in Bangla', async () => {
    await mount(server(() => ({
      status: 400,
      body: { error: 'invalid_branding', field: 'signatureUrl', message: 'signatureUrl exceeds 48 KB' },
    })));
    type('headmasterName', 'মো. রফিক উদ্দিন');
    press(headerButton('সংরক্ষণ'));
    await settle();
    const message = (row('signatureUrl').querySelector('.ui-field-error')?.textContent ?? '').trim();
    assertBangla(message, 'signatureUrl');
    assert.match(message, /^প্রধান শিক্ষকের স্বাক্ষর ছবিটি খুব বড়/);
  });

  test('a refusal with no row of its own is still Bangla, in the notice strip', async () => {
    await mount(server(() => ({
      status: 400,
      body: { error: 'invalid_branding', field: 'branding', message: 'branding must be an object' },
    })));
    type('address', 'সিলেট সদর');
    press(headerButton('সংরক্ষণ'));
    await settle();
    const strip = (root().querySelector('.brand-notice-text')?.textContent ?? '').trim();
    assertBangla(strip, 'branding');
  });

  test('brandingErrorBn: inherited keys and Bangla messages', () => {
    // The key comes from a response body; "constructor" must not print a function.
    assert.equal(brandingErrorBn('constructor', 'constructor must be text'), 'মানটি সঠিক নয়।');
    assert.equal(brandingErrorBn('logoUrl', 'লোগো ছবিটি খুব বড় — ছোট ছবি ব্যবহার করুন।'),
      'লোগো ছবিটি খুব বড় — ছোট ছবি ব্যবহার করুন।');
    assert.equal(brandingErrorBn('faviconUrl', 'faviconUrl must be a PNG, JPEG or WebP image, an https URL, or a site path', 'javascript:alert(1)'),
      'ফেভিকন হিসেবে PNG, JPEG বা WebP ছবি দিন।');
    // A length error is told from a format error by the value, not the wording.
    assert.equal(brandingErrorBn('website', 'reworded upstream', 'https://' + 'a'.repeat(LIMITS.website)),
      'ওয়েবসাইট সর্বোচ্চ ২০০ অক্ষরের হতে পারে।');
    assert.equal(brandingErrorBn('headmasterName', ''), 'প্রধান শিক্ষকের নাম সঠিক নয়।');
  });
});

/* ── the fields themselves ──────────────────────────────────────────────── */

describe('branding — the text fields', () => {
  test('each text field carries ui-core’s length cap as maxlength (42)', async () => {
    await mount();
    for (const key of ['nameBn', 'nameEn', 'shortName', 'address', 'phone', 'email', 'website', 'headmasterName'] as const) {
      const input = row(key).querySelector('.ui-input')!;
      assert.equal(input.getAttribute('maxlength'), String(LIMITS[key]), `${key} maxlength`);
    }
  });

  test('the English-name row is labelled in Bangla (15, 50, 72)', async () => {
    await mount();
    const label = (row('nameEn').querySelector('.ui-field-label')?.textContent ?? '').trim();
    assert.equal(label, 'প্রতিষ্ঠানের নাম (ইংরেজি)');
    assert.equal(/[A-Za-z]/.test(label), false);
  });

  test('a phone typed in Bangla digits is accepted and sent in Latin digits', async () => {
    const s = await mount();
    type('phone', '০১৭১১-০০০০০০');
    press(headerButton('সংরক্ষণ'));
    await settle();
    assert.equal(errorText('phone'), '', 'no error on a correct number');
    const put = s.calls.find((x) => x.method === 'PUT');
    assert.ok(put, 'the save went to the server');
    assert.equal(put.body?.branding?.phone, '01711-000000');
  });
});

/* ── 71: focus after a save or cancel that worked ───────────────────────── */

describe('branding — focus after a save or a cancel that worked (71)', () => {
  test('সংরক্ষণ: focus goes to the note that says it saved, not <body>', async () => {
    await mount();
    type('address', 'সিলেট সদর, সিলেট');
    press(headerButton('সংরক্ষণ'));
    await settle();
    const note = root().querySelector<HTMLElement>('.ui-success-note');
    assert.ok(note, 'the saved note is shown');
    assert.match(note.textContent ?? '', /সংরক্ষিত হয়েছে/);
    assert.equal(active(), note, 'focus is on the outcome');
    assert.equal(note.getAttribute('tabindex'), '-1', 'focusable by script only, not a Tab stop');
  });

  test('বাতিল: focus goes to the note that says the change was undone', async () => {
    await mount();
    type('address', 'সিলেট সদর, সিলেট');
    press(headerButton('বাতিল'));
    await settle();
    const note = root().querySelector<HTMLElement>('.ui-success-note');
    assert.match(note?.textContent ?? '', /পরিবর্তন বাতিল করা হয়েছে/);
    assert.equal(active(), note);
  });

  test('someone who moved into a field during a slow save keeps their place', async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => { open = r; });
    const s = server();
    const slow = {
      ...s.auth,
      authedFetch: async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') await gate;
        return s.auth.authedFetch(url, init);
      },
    };
    new BrandingView({ root: root(), doc: doc(), auth: slow as never, canManage: true });
    await settle();
    type('address', 'সিলেট সদর, সিলেট');
    press(headerButton('সংরক্ষণ'));
    await settle();
    // Busy render: the person clicks into another field meanwhile.
    const email = row('email').querySelector<HTMLInputElement>('.ui-input')!;
    email.focus();
    open();
    await settle();
    assert.ok(root().querySelector('.ui-success-note'), 'it saved');
    assert.equal(active()?.getAttribute('name'), 'email', 'focus was not pulled away from the field');
  });
});
