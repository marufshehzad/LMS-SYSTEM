/**
 * The irreversible-action panel. (Ata Ekta IMPLEMENTATION §7, R11)
 *
 * Four actions in this app cannot be undone. The guarantees tested here are
 * the barrier itself: the button stays off until a person has ticked a real,
 * labelled checkbox; it goes off again when they untick or the screen resets;
 * the button is read together with what it costs; and the counts that make
 * the barrier informative are set in the numeral face without changing a
 * single character of what is read.
 */
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { resetUid } from '../src/ui/dom.ts';
import { button, setBusy, onClickBusy } from '../src/ui/button.ts';
import { irreversiblePanel } from '../src/ui/irreversible.ts';

let dom: JSDOM;
const doc = () => dom.window.document;
const host = () => doc().getElementById('root') as HTMLElement;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

before(() => {
  dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.CSS = dom.window.CSS;
  g.document = dom.window.document;
});

beforeEach(() => { host().textContent = ''; resetUid(); });

const STATEMENT = 'প্রকাশের পর নম্বর আর বদলানো যাবে না';
const DETAIL = 'প্রকাশ হলেই ৭৮৪ জন শিক্ষার্থী ও তাদের অভিভাবক ফল দেখতে পাবেন এবং এসএমএস যাবে।';

function build(extra: Partial<Parameters<typeof irreversiblePanel>[1]> = {}) {
  const confirm = button(doc(), { label: 'প্রকাশ করুন', variant: 'primary' });
  const panel = irreversiblePanel(doc(), {
    statement: STATEMENT,
    detail: DETAIL,
    items: [
      { text: 'সব বিষয়ের নম্বর দেওয়া হয়েছে', meta: '৫২ / ৫২ সেকশন', tone: 'success' },
      '৭২১ জন শিক্ষার্থী পরের শ্রেণিতে উঠবে',
      { text: 'এসএমএস খরচ', meta: '৳ ৩,১৩৬ · ৭৮৪টি বার্তা', tone: 'warn', glyph: 'info' },
    ],
    confirm,
    actions: [button(doc(), { label: 'খসড়া দেখুন' }), confirm],
    ...extra,
  });
  host().append(panel.root);
  return { panel, confirm };
}

describe('R11 — the confirm button is gated by the checkbox', () => {
  test('THE ONE THAT MATTERS — disabled until ticked', () => {
    const { panel, confirm } = build();
    assert.equal(confirm.disabled, true);
    assert.equal(panel.acknowledged(), false);
    panel.input.click();
    assert.equal(panel.acknowledged(), true);
    assert.equal(confirm.disabled, false);
  });

  test('re-disabled on untick', () => {
    const { panel, confirm } = build();
    panel.input.click();
    panel.input.click();
    assert.equal(panel.acknowledged(), false);
    assert.equal(confirm.disabled, true);
  });

  test('re-disabled on reset', () => {
    const { panel, confirm } = build();
    panel.input.click();
    panel.reset();
    assert.equal(panel.input.checked, false);
    assert.equal(confirm.disabled, true);
  });

  test('a button passed in enabled is still disabled at build', () => {
    const confirm = button(doc(), { label: 'উন্নয়ন শুরু করুন', variant: 'primary' });
    assert.equal(confirm.disabled, false);
    irreversiblePanel(doc(), { statement: 'এটি বছরের সবচেয়ে বড় পরিবর্তন', items: [], confirm });
    assert.equal(confirm.disabled, true);
  });

  test('a reset inside a busy action does not leave the button enabled when busy ends', async () => {
    // setBusy(false) sets disabled = false unconditionally. A screen that
    // resets the panel after its action succeeds must not get a live button
    // over an unticked box.
    const { panel, confirm } = build();
    let ran = 0;
    onClickBusy(confirm, async () => { ran += 1; panel.reset(); });
    panel.input.click();
    confirm.click();
    await tick();
    await tick();
    assert.equal(ran, 1);
    assert.equal(panel.acknowledged(), false);
    assert.equal(confirm.disabled, true);
    // And if it were somehow clickable, the click does nothing.
    confirm.disabled = false;
    confirm.click();
    await tick();
    assert.equal(ran, 1);
  });

  test('busy while acknowledged still releases to enabled', async () => {
    const { panel, confirm } = build();
    panel.input.click();
    setBusy(confirm, true);
    assert.equal(confirm.disabled, true);
    setBusy(confirm, false);
    await tick();
    assert.equal(confirm.disabled, false);
  });
});

describe('R8 — accessibility', () => {
  test('a real checkbox with an associated label, the label being the target', () => {
    const { panel } = build();
    assert.equal(panel.input.type, 'checkbox');
    const label = panel.root.querySelector<HTMLLabelElement>('label.irrev-ack')!;
    assert.ok(label);
    assert.equal(label.htmlFor, panel.input.id);
    assert.equal(label.contains(panel.input), true);
    assert.equal(panel.input.labels?.[0], label);
    assert.equal(label.textContent, 'আমি বুঝেছি এটি ফেরানো যাবে না');
    // Clicking the words ticks the box — the whole label is the hit area.
    label.click();
    assert.equal(panel.acknowledged(), true);
  });

  test('a custom ack label is used', () => {
    const { panel } = build({ ackLabel: 'আমি বুঝেছি' });
    assert.equal(panel.input.labels?.[0]?.textContent, 'আমি বুঝেছি');
  });

  test('the panel is a group named by its statement', () => {
    const { panel } = build();
    assert.equal(panel.root.getAttribute('role'), 'group');
    const named = doc().getElementById(panel.root.getAttribute('aria-labelledby')!);
    assert.equal(named?.textContent, STATEMENT);
    const described = doc().getElementById(panel.root.getAttribute('aria-describedby')!);
    assert.equal(described?.textContent, DETAIL);
  });

  test('the confirm button is described by the statement, keeping any prior description', () => {
    const confirm = button(doc(), { label: 'প্রকাশ করুন', variant: 'primary', attrs: { 'aria-describedby': 'cost-note' } });
    const panel = irreversiblePanel(doc(), { statement: STATEMENT, items: [], confirm });
    host().append(panel.root);
    const ids = confirm.getAttribute('aria-describedby')!.split(' ');
    assert.ok(ids.includes('cost-note'));
    const statementId = panel.root.getAttribute('aria-labelledby')!;
    assert.ok(ids.includes(statementId));
  });

  test('no live region — a tick is not an announcement', () => {
    const { panel } = build();
    panel.input.click();
    assert.equal(panel.root.querySelector('[aria-live], [role="status"], [role="alert"]'), null);
    assert.equal(panel.root.hasAttribute('aria-live'), false);
  });

  test('glyphs are hidden from readers; the words carry the meaning', () => {
    const { panel } = build();
    const glyphs = panel.root.querySelectorAll('.irrev-glyph');
    assert.equal(glyphs.length, 3);
    for (const g of glyphs) assert.equal(g.getAttribute('aria-hidden'), 'true');
  });

  test('the checklist is a list, in the order given, and actions sit in the foot with primary last', () => {
    const { panel, confirm } = build();
    const rows = [...panel.root.querySelectorAll('ul.irrev-list > li')];
    assert.equal(rows.length, 3);
    assert.equal(rows[1].textContent, '৭২১ জন শিক্ষার্থী পরের শ্রেণিতে উঠবে');
    const foot = panel.root.querySelector('.irrev-foot')!;
    const btns = [...foot.querySelectorAll('button')];
    assert.equal(btns[btns.length - 1], confirm);
    // Order of the anatomy: head, body, foot.
    const kids = [...panel.root.children].map((n) => n.className);
    assert.deepEqual(kids, ['irrev-head', 'irrev-body', 'irrev-foot']);
  });
});

describe('R6 — numbers', () => {
  test('every digit run is in .n and textContent is unchanged', () => {
    const { panel } = build();
    const statement = panel.root.querySelector('.irrev-statement')!;
    assert.equal(statement.textContent, STATEMENT);
    const detail = panel.root.querySelector('.irrev-detail')!;
    assert.equal(detail.textContent, DETAIL);
    assert.deepEqual([...detail.querySelectorAll('.n')].map((n) => n.textContent), ['৭৮৪']);
    // The words are not dragged into the numeral face.
    assert.equal(detail.classList.contains('n'), false);

    const meta = [...panel.root.querySelectorAll('.irrev-item-meta')];
    assert.equal(meta[0].textContent, '৫২ / ৫২ সেকশন');
    assert.deepEqual([...meta[0].querySelectorAll('.n')].map((n) => n.textContent), ['৫২', '৫২']);
    assert.equal(meta[1].textContent, '৳ ৩,১৩৬ · ৭৮৪টি বার্তা');
    assert.deepEqual([...meta[1].querySelectorAll('.n')].map((n) => n.textContent), ['৩,১৩৬', '৭৮৪']);

    const text = panel.root.querySelectorAll('.irrev-item-text')[1];
    assert.deepEqual([...text.querySelectorAll('.n')].map((n) => n.textContent), ['৭২১']);
  });

  test('no digit sits outside a .n span anywhere in the panel', () => {
    const { panel } = build();
    const walker = doc().createTreeWalker(panel.root, 4 /* SHOW_TEXT */);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!/[0-9০-৯]/.test(t.nodeValue ?? '')) continue;
      assert.ok(t.parentElement?.closest('.n'), `digit outside .n: "${t.nodeValue}"`);
    }
  });

  test('text is never parsed as markup', () => {
    const panel = irreversiblePanel(doc(), {
      statement: '<img src=x onerror="alert(1)">', items: ['<b>২</b>'],
    });
    assert.equal(panel.root.querySelector('img, b'), null);
    assert.equal(panel.root.querySelector('.irrev-statement')?.textContent, '<img src=x onerror="alert(1)">');
  });
});

describe('onChange', () => {
  test('called with the new state on tick and untick', () => {
    const seen: boolean[] = [];
    const { panel } = build({ onChange: (a) => seen.push(a) });
    panel.input.click();
    panel.input.click();
    assert.deepEqual(seen, [true, false]);
  });

  test('reset reports false only when it actually changed something', () => {
    const seen: boolean[] = [];
    const { panel } = build({ onChange: (a) => seen.push(a) });
    panel.reset();
    assert.deepEqual(seen, []);
    panel.input.click();
    panel.reset();
    assert.deepEqual(seen, [true, false]);
  });

  test('works without a confirm button', () => {
    const seen: boolean[] = [];
    const panel = irreversiblePanel(doc(), {
      statement: STATEMENT, items: ['এক'], onChange: (a) => seen.push(a),
    });
    // Connected: a disconnected checkbox toggles but fires no events (HTML
    // spec, input activation behaviour) — and no person can click one.
    host().append(panel.root);
    panel.input.click();
    assert.equal(panel.acknowledged(), true);
    assert.deepEqual(seen, [true]);
  });
});
