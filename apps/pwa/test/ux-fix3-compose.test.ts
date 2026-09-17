/**
 * UX fixes round 3, group "compose" — নোটিশ পাঠান (notice-compose-view.ts).
 *
 * From the round-2 browser re-check (ct-after-send-375.png): a class teacher
 * ticks নবম শ্রেণি ক, writes, presses পাঠান, and the panel then reads
 *
 *     পাবে: কোনো শাখা বাছাই করা হয়নি — পাঠাতে অন্তত একটি শাখা বাছাই করুন
 *     ✓ ২৪ জনের কাছে পৌঁছেছে
 *     [পাঠান]  ← half under the fixed tab bar at 375
 *
 *   A  The send clears the ticked sections, so the "পাবে:" line — which is
 *      about the notice being WRITTEN — turned into a do-this-first prompt,
 *      drawn right above the outcome. While the outcome stands the line waits;
 *      the first change to the next notice brings it back.
 *   B  The outcome is drawn above Send, which pushes Send down. Focus went to
 *      the outcome with a plain focus(), which scrolls only that node into
 *      view: the disabled পাঠান stayed under the tab bar (top 733 of 812).
 *      Both are now brought into view, the focused one last.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { NoticeComposeView } from '../src/notice-compose-view.ts';
import { keepFocusWithin } from '../src/ui/index.ts';

let dom: JSDOM;
let errors: unknown[];
let restore: Array<() => void> = [];

beforeEach(() => {
  dom = new JSDOM(
    '<!doctype html><html><body><main id="shell-view"><div id="root"></div></main></body></html>',
    { url: 'https://school.example/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.Event = dom.window.Event;
  errors = [];
  dom.window.addEventListener('error', (e) => { errors.push(e.error ?? e.message); e.preventDefault(); });
});

afterEach(() => {
  for (const undo of restore.reverse()) undo();
  restore = [];
});

const doc = () => dom.window.document;
const root = () => doc().getElementById('root') as HTMLElement;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SECTIONS = {
  sections: [
    { id: '7bd00000-0000-4000-8000-00000000000a', name: 'ক', className: { bn: 'নবম শ্রেণি' } },
    { id: '7bd00000-0000-4000-8000-00000000000b', name: 'খ', className: { bn: 'নবম শ্রেণি' } },
  ],
};

type Reply = { status: number; body: unknown } | 'offline';

/** The composer on a stub server; `publish` answers the send. */
function mount(role: string, publish: () => Reply) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  const auth = {
    role, tenantId: 't1', userId: 'u1', displayName: 'পরীক্ষা',
    isLoggedIn: () => true,
    authedFetch: async (path: string) => {
      if (path.includes('preview=1')) {
        return json({ recipients: 24, smsRecipients: 0, segmentsEach: 1, segmentsTotal: 0,
          confirmThreshold: 200, needsConfirmation: false });
      }
      if (path.startsWith('/api/v1/academics/sections')) return json(SECTIONS);
      const r = publish();
      if (r === 'offline') throw new TypeError('Failed to fetch');
      return json(r.body, r.status);
    },
  };
  new NoticeComposeView({ root: root(), doc: doc(), auth: auth as never });
}

const SENT: Reply = { status: 201, body: { status: 'published', recipients: 24, smsQueued: false } };

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

function fill(title = 'ছুটির নোটিশ', body = 'আগামীকাল স্কুল বন্ধ থাকবে।') {
  type(q<HTMLInputElement>('[name="title"]'), title);
  type(q<HTMLTextAreaElement>('[name="body"]'), body);
}

const send = () => q<HTMLButtonElement>('[data-send]');
const result = () => root().querySelector<HTMLElement>('[data-send-result]');
const lineP = () => q<HTMLElement>('[data-audience-line]').closest('p') as HTMLElement;
const PROMPT = /বাছাই করুন/;

/** Hidden by the `hidden` attribute, on itself or an ancestor (app.css: display none). */
const isHidden = (node: Element) => !!node.closest('[hidden]');

/**
 * The panel's text as a sighted person reads it, in order, up to (not
 * including) `stop`: what is drawn above the outcome.
 */
function visibleTextBefore(stop: Element): string {
  const panel = stop.closest('.compose-panel')!;
  const walker = doc().createTreeWalker(panel, dom.window.NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (stop.contains(n) || (stop.compareDocumentPosition(n) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)) break;
    if (!isHidden(n.parentElement!)) out += n.textContent;
  }
  return out;
}

/** A class teacher ticks the first section, writes, and presses পাঠান. */
async function teacherSends() {
  mount('class_teacher', () => SENT);
  await wait(10);
  tick(q<HTMLInputElement>('.audience-section input'), true);
  fill();
  assert.equal(send().disabled, false);
  send().focus();
  send().click();
  await wait(30);
  const said = result();
  assert.ok(said, 'the send outcome is not drawn');
  assert.equal(said.textContent, '২৪ জনের কাছে পৌঁছেছে');
  return said;
}

/* ── A: the outcome reads as the outcome ───────────────────────────────── */

describe('A — after a send, no do-this-first prompt sits above what happened', () => {
  test('class teacher (the re-check’s steps): the "পাবে:" prompt is not drawn above "২৪ জনের কাছে পৌঁছেছে"', async () => {
    const said = await teacherSends();
    const above = visibleTextBefore(said);
    assert.doesNotMatch(above, PROMPT, `drawn above the outcome: "${above}"`);
    assert.doesNotMatch(above, /কোনো শাখা বাছাই করা হয়নি/);
    assert.equal(lineP().hidden, true, 'the line about the next notice is on screen before it is begun');
    assert.equal(doc().activeElement, said, 'focus is not on the outcome');
    assert.deepEqual(errors, []);
  });

  test('the line stays in the DOM and still describes Send (a disabled Send is read in browse mode)', async () => {
    await teacherSends();
    const described = (send().getAttribute('aria-describedby') ?? '').split(/\s+/);
    assert.ok(described.includes(lineP().id), 'Send lost its description');
    assert.ok(doc().getElementById(lineP().id), 'the described-by target is gone');
    assert.match(lineP().textContent ?? '', PROMPT, 'the reason Send waits is no longer available to it');
  });

  test('principal, section audience: the same', async () => {
    mount('principal', () => SENT);
    await wait(10);
    [...root().querySelectorAll<HTMLButtonElement>('.audience-chip')]
      .find((c) => c.dataset.audience === 'section')!.click();
    tick(q<HTMLInputElement>('.audience-section input'), true);
    fill();
    send().focus();
    send().click();
    await wait(30);
    const said = result()!;
    assert.ok(said);
    assert.doesNotMatch(visibleTextBefore(said), PROMPT);
    assert.equal(lineP().hidden, true);
  });

  test('an in-place refresh while the outcome stands (the section list landing late) keeps the line waiting', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    const auth = {
      role: 'principal', tenantId: 't1', userId: 'u1', displayName: 'পরীক্ষা', isLoggedIn: () => true,
      authedFetch: async (path: string) => {
        if (path.includes('preview=1')) return json({});
        if (path.startsWith('/api/v1/academics/sections')) { await gate; return json(SECTIONS); }
        return json((SENT as { body: unknown }).body, 201);
      },
    };
    new NoticeComposeView({ root: root(), doc: doc(), auth: auth as never });
    await wait(10);
    fill();
    send().focus();
    send().click();
    await wait(30);
    assert.ok(result());
    assert.equal(lineP().hidden, true);
    release();
    await wait(20);
    assert.ok(result(), 'the outcome went without the next notice being started');
    assert.equal(lineP().hidden, true, 'the section list landing (syncLive) put the line back above the outcome');
    type(q<HTMLInputElement>('[name="title"]'), 'ক');
    assert.equal(lineP().hidden, false);
    assert.equal(lineP().textContent, 'পাবে: সবাই');
  });

  const starts: Array<[string, () => void]> = [
    ['typing in the title', () => type(q<HTMLInputElement>('[name="title"]'), 'ক')],
    ['typing in the body', () => type(q<HTMLTextAreaElement>('[name="body"]'), 'ক')],
    ['ticking a section', () => tick(q<HTMLInputElement>('.audience-section input'), true)],
    ['changing ধরন', () => {
      const cat = q<HTMLSelectElement>('select[name="category"]');
      cat.value = 'exam';
      cat.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }],
    ['the SMS toggle', () => tick(q<HTMLInputElement>('[data-sms-toggle]'), true)],
    ['choosing a time (the panel is rebuilt)', () => {
      const at = q<HTMLInputElement>('[name="publishAt"]');
      at.value = '2026-09-20T10:00';
      at.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }],
  ];
  for (const [what, start] of starts) {
    test(`starting the next notice by ${what} brings the "পাবে:" line back, and the outcome goes`, async () => {
      await teacherSends();
      start();
      assert.equal(result(), null, 'the last send’s outcome is still drawn');
      assert.equal(lineP().hidden, false, `after ${what} the line about the notice is still hidden`);
      const text = lineP().textContent ?? '';
      if (what === 'ticking a section') assert.match(text, /নবম শ্রেণি ক — শিক্ষার্থী ও অভিভাবক/);
      else assert.match(text, PROMPT, 'the reason Send waits is not said');
      assert.deepEqual(errors, []);
    });
  }

  test('guard: a refusal keeps the line — it is about the notice still in the form', async () => {
    mount('class_teacher', () => ({ status: 403, body: {
      error: 'audience_not_permitted', message: 'one or more of those sections is not yours', field: 'audience',
    } }));
    await wait(10);
    tick(q<HTMLInputElement>('.audience-section input'), true);
    fill();
    send().focus();
    send().click();
    await wait(30);
    assert.ok(result());
    assert.equal(lineP().hidden, false);
    assert.match(lineP().textContent ?? '', /নবম শ্রেণি ক/);
  });

  test('guard: offline keeps the line too', async () => {
    mount('class_teacher', () => 'offline');
    await wait(10);
    tick(q<HTMLInputElement>('.audience-section input'), true);
    fill();
    send().click();
    await wait(30);
    assert.match(result()?.textContent ?? '', /সংযোগ নেই/);
    assert.equal(lineP().hidden, false);
  });

  test('guard: a fresh composer shows the line', async () => {
    mount('class_teacher', () => SENT);
    await wait(10);
    assert.equal(lineP().hidden, false);
    assert.match(lineP().textContent ?? '', PROMPT);
  });
});

/* ── B: nothing important under the tab bar ────────────────────────────── */

/**
 * A 375×812 phone with the shell's fixed tab bar. jsdom has no layout, so the
 * panel's tail is given the geometry the re-check measured, and scrolling
 * follows the browser's rules: `scrollIntoView({block:'nearest'})` and a
 * plain `focus()` both scroll a node only as far as needed to bring it inside
 * the root's scroll-padding (app.css: 64px top, 68px bottom below 1024).
 */
function phone(startY = 48) {
  const H = 812, PAD_TOP = 64, PAD_BOTTOM = 68;
  // By default scrolled so that পাঠান, before the outcome pushed it down 48px,
  // sat just above the tab bar — the re-check's page.
  let scrollY = startY;
  const calls: string[] = [];
  /** Document-space [top, bottom] of the two nodes that matter. */
  const box = (node: Element): [number, number] | null => {
    if (node.hasAttribute('data-send')) return [733 + 48, 733 + 48 + 44];
    if (node.hasAttribute('data-send-result')) return [685 + 48, 685 + 48 + 36];
    return null;
  };
  const reveal = (node: Element) => {
    const b = box(node);
    if (!b) return;
    const [top, bottom] = b;
    if (top < scrollY + PAD_TOP) scrollY = top - PAD_TOP;
    else if (bottom > scrollY + H - PAD_BOTTOM) scrollY = Math.min(top - PAD_TOP, bottom - (H - PAD_BOTTOM));
  };
  const proto = dom.window.HTMLElement.prototype as unknown as {
    scrollIntoView?: (o?: ScrollIntoViewOptions) => void;
    focus: (o?: FocusOptions) => void;
  };
  const hadScroll = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView');
  const oldScroll = proto.scrollIntoView;
  const oldFocus = proto.focus;
  proto.scrollIntoView = function (this: Element, o?: ScrollIntoViewOptions) {
    calls.push(`${this.hasAttribute('data-send') ? 'send' : this.hasAttribute('data-send-result') ? 'result' : this.tagName}:${o?.block ?? 'start'}`);
    reveal(this);
  };
  proto.focus = function (this: HTMLElement, o?: FocusOptions) {
    oldFocus.call(this, o);
    if (!o?.preventScroll && doc().activeElement === this) reveal(this);
  };
  restore.push(() => {
    proto.focus = oldFocus;
    if (hadScroll) proto.scrollIntoView = oldScroll;
    else delete proto.scrollIntoView;
  });
  /** Viewport-space top/bottom, and whether the node is clear of the bars. */
  const place = (node: Element) => {
    const [top, bottom] = box(node)!;
    const t = top - scrollY, b = bottom - scrollY;
    return { top: t, bottom: b, clear: t >= PAD_TOP && b <= H - PAD_BOTTOM };
  };
  return { place, calls, scrollY: () => scrollY };
}

describe('B — after a send, the outcome and পাঠান are both clear of the tab bar', () => {
  for (const keeper of [false, true]) {
    test(`class teacher at 375${keeper ? ', with the shell’s focus keeper armed' : ''}: neither is under the bar`, async () => {
      const stop = keeper ? keepFocusWithin(doc().getElementById('shell-view')!) : () => {};
      try {
        mount('class_teacher', () => SENT);
        await wait(10);
        tick(q<HTMLInputElement>('.audience-section input'), true);
        fill();
        send().focus();
        const vp = phone();
        send().click();
        await wait(30);
        const said = result()!;
        assert.ok(said);
        assert.equal(doc().activeElement, said, 'focus is not on the outcome');
        const s = vp.place(send());
        assert.ok(s.clear, `পাঠান sits at ${s.top}–${s.bottom} of 812, under the tab bar (744 up)`);
        const r = vp.place(said);
        assert.ok(r.clear, `the outcome sits at ${r.top}–${r.bottom}, not clear of the bars`);
        // The focused node is brought in last, so it wins when the two cannot fit.
        assert.equal(vp.calls.at(-1), 'result:nearest', vp.calls.join(', '));
        assert.ok(vp.calls.includes('send:nearest'), vp.calls.join(', '));
        assert.deepEqual(errors, []);
      } finally {
        stop();
      }
    });
  }

  test('guard — a refusal: focus still goes to Send (the retry), and Send and the refusal are both clear of the bar', async () => {
    mount('principal', () => ({ status: 400, body: {
      error: 'invalid_notice', message: 'title must be 200 characters or fewer', field: 'title',
    } }));
    await wait(10);
    fill();
    send().focus();
    const vp = phone();
    send().click();
    await wait(30);
    assert.equal(doc().activeElement, send());
    assert.ok(vp.place(send()).clear, JSON.stringify(vp.place(send())));
    assert.ok(vp.place(result()!).clear, JSON.stringify(vp.place(result()!)));
  });

  test('guard — nearest, never a jump: with both already on screen the page does not move', async () => {
    mount('class_teacher', () => SENT);
    await wait(10);
    tick(q<HTMLInputElement>('.audience-section input'), true);
    fill();
    send().focus();
    const vp = phone(200);
    send().click();
    await wait(30);
    assert.ok(vp.place(send()).clear && vp.place(result()!).clear);
    assert.equal(vp.scrollY(), 200, 'the page scrolled although nothing was hidden');
    assert.ok(vp.calls.every((c) => c.endsWith(':nearest')), vp.calls.join(', '));
  });

  test('focus elsewhere after the send (the person moved on): nothing is focused and nothing scrolls', async () => {
    let answer: (r: Response) => void = () => {};
    const auth = {
      role: 'class_teacher', tenantId: 't1', userId: 'u1', displayName: 'পরীক্ষা', isLoggedIn: () => true,
      authedFetch: async (path: string) => {
        if (path.includes('preview=1')) return new Response('{}', { status: 200 });
        if (path.startsWith('/api/v1/academics/sections')) return new Response(JSON.stringify(SECTIONS), { status: 200 });
        return new Promise<Response>((r) => { answer = r; });
      },
    };
    new NoticeComposeView({ root: root(), doc: doc(), auth: auth as never });
    await wait(10);
    tick(q<HTMLInputElement>('.audience-section input'), true);
    fill();
    send().focus();
    send().click();
    await wait(5);
    const title = q<HTMLInputElement>('[name="title"]');
    title.focus();
    const vp = phone();
    answer(new Response(JSON.stringify({ status: 'published', recipients: 24 }), { status: 201 }));
    await wait(30);
    assert.ok(result());
    assert.deepEqual(vp.calls, [], 'the page was scrolled under a person who had moved on');
  });
});
