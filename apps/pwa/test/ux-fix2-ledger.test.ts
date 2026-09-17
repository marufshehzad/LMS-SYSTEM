/**
 * UX sweep round 2, ledger group — finding 33 (mismatch sentence) and R12.
 *
 * Round 1 fixed the stat strip but not the pink mismatch note: the sentence
 * was built as one string through numText, so "৳" stayed a loose text node
 * beside the digits' `.n` span, and from 375 to 414px Chrome ended a line with
 * "পোস্ট হয়েছে ৳" and began the next with "3,100.00". The stylesheet rule
 * waiting for a wrapped figure matched nothing, because nothing was wrapped.
 *
 * jsdom does no layout, so these tests pin the DOM the no-wrap rule needs:
 * every amount in the sentence is ONE span, `.ledger-mismatch-fig`, holding
 * the ৳ and its digits together, and the sentence reads exactly as before.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { LedgerView } from '../src/ledger-view.ts';
import { formatBdt } from '../../../packages/ui-core/src/format.ts';

let dom: JSDOM;

before(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>',
                  { url: 'http://localhost/' });
  const g = globalThis as Record<string, unknown>;
  for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLSelectElement',
                   'HTMLTextAreaElement', 'HTMLButtonElement', 'Node', 'Event'] as const) {
    g[k] = (dom.window as unknown as Record<string, unknown>)[k];
  }
  for (const key of ['localStorage', 'location'] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key], configurable: true, writable: true,
    });
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true }, configurable: true, writable: true,
  });
});

const root = () => dom.window.document.getElementById('root') as HTMLElement;
const settle = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setTimeout(r, 0)); };

type Recon = { provider: string; posted: string; reconciled: string };

async function mount(reconciliation: Recon[]): Promise<void> {
  root().textContent = '';
  new LedgerView({
    root: root(),
    doc: dom.window.document,
    auth: {
      role: 'accountant', tenantId: 't-1', userId: 'u-1',
      authedFetch: async () => ({
        ok: true, status: 200,
        json: async () => ({ accounts: [], batches: [], reconciliation }),
      }) as unknown as Response,
    },
  } as never);
  await settle();
}

const sentences = () => [...root().querySelectorAll<HTMLElement>('.ledger-mismatch-text')];

/** Every text node under `node`, in document order. */
function textNodes(node: Node): Text[] {
  const out: Text[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === 3) out.push(n as Text);
    n.childNodes.forEach(walk);
  };
  walk(node);
  return out;
}

describe('33 — the mismatch sentence never cuts "৳" from its figure', () => {
  test('posted more than reconciled: the demo\'s Rocket sentence', async () => {
    await mount([
      { provider: 'bKash', posted: '18450.00', reconciled: '18450.00' },
      { provider: 'Rocket', posted: '3100.00', reconciled: '2350.00' },
    ]);
    const [p] = sentences();
    assert.ok(p, 'the unmatched channel has its sentence');
    assert.equal(sentences().length, 1, 'a matched channel has none');

    // What a reader hears and what copy-paste gives is exactly the old sentence.
    assert.equal(p.textContent,
      `Rocket-এ ${formatBdt(750)} এখনো মেলেনি — পোস্ট হয়েছে ${formatBdt('3100.00')}, মিলেছে ${formatBdt('2350.00')}। মিলিয়ে দেখুন।`);

    // Each amount is one span holding the whole "৳ 3,100.00".
    const figs = [...p.querySelectorAll('.ledger-mismatch-fig')];
    assert.deepEqual(figs.map((f) => f.textContent), ['৳ 750.00', '৳ 3,100.00', '৳ 2,350.00']);
    for (const f of figs) {
      assert.equal(f.tagName, 'SPAN', 'inline, so the words around it still wrap');
      assert.equal(f.parentElement, p, 'a direct part of the sentence, not nested in another figure');
    }
  });

  test('no "৳" and no digit is left as a loose piece the line can break at', async () => {
    await mount([{ provider: 'Rocket', posted: '3100.00', reconciled: '2350.00' }]);
    const [p] = sentences();
    for (const t of textNodes(p)) {
      if (!/[৳0-9০-৯]/.test(t.data)) continue;
      assert.ok(t.parentElement?.closest('.ledger-mismatch-fig'),
        `"${t.data}" sits outside a figure span, so the line can break beside it`);
    }
    // The digits keep the numeral face (R6), inside the figure.
    const nums = [...p.querySelectorAll('.n')];
    assert.equal(nums.length, 3);
    for (const n of nums) assert.ok(n.closest('.ledger-mismatch-fig'), `${n.textContent} is inside its figure`);
  });

  test('reconciled more than posted: the other sentence, same guarantee', async () => {
    await mount([{ provider: 'Nagad', posted: '1250000.00', reconciled: '1375000.50' }]);
    const [p] = sentences();
    assert.equal(p.textContent,
      `Nagad-এ পোস্ট হওয়া অঙ্কের চেয়ে ${formatBdt(125000.5)} বেশি মিলেছে — পোস্ট হয়েছে ${formatBdt('1250000.00')}, মিলেছে ${formatBdt('1375000.50')}। মিলিয়ে দেখুন।`);
    const figs = [...p.querySelectorAll('.ledger-mismatch-fig')].map((f) => f.textContent);
    // Lakh-sized figures, the ones that split worst, stay whole.
    assert.deepEqual(figs, [formatBdt(125000.5), formatBdt('1250000.00'), formatBdt('1375000.50')]);
    assert.ok(figs.every((f) => /^৳ [\d,]+\.\d{2}$/.test(f ?? '')), `Latin money, sign and figure together: ${figs.join(' | ')}`);
    for (const t of textNodes(p)) {
      if (/[৳0-9]/.test(t.data)) assert.ok(t.parentElement?.closest('.ledger-mismatch-fig'), `loose "${t.data}"`);
    }
  });

  test('two unmatched channels: one sentence each, each with its own three figures', async () => {
    await mount([
      { provider: 'Rocket', posted: '3100.00', reconciled: '2350.00' },
      { provider: 'Upay', posted: '500.00', reconciled: '800.00' },
    ]);
    const ps = sentences();
    assert.equal(ps.length, 2);
    for (const p of ps) assert.equal(p.querySelectorAll('.ledger-mismatch-fig').length, 3);
    assert.equal(root().querySelector('.ledger-mismatch')?.getAttribute('role'), 'note',
      'the note keeps its role');
  });

  test('the figure class is scoped to the sentence', async () => {
    await mount([{ provider: 'Rocket', posted: '3100.00', reconciled: '2350.00' }]);
    assert.equal(root().querySelectorAll('.ledger-mismatch-fig').length, 3);
    for (const f of root().querySelectorAll('.ledger-mismatch-fig')) {
      assert.ok(f.closest('.ledger-mismatch-text'), 'emitted only inside the mismatch sentence');
    }
    // The MFS list keeps its own figure span (table and phone list), untouched.
    const recon = [...root().querySelectorAll('.ledger-recon .ledger-fig')].map((f) => f.textContent);
    assert.ok(recon.includes('৳ 3,100.00') && recon.includes('৳ 2,350.00'), recon.join(' | '));
    assert.equal(root().querySelectorAll('.ledger-recon .ledger-mismatch-fig').length, 0);
    // R12: the old `.ledger-mismatch-text .ledger-fig` rule matches nothing,
    // so the stylesheet merge can drop it.
    assert.equal(root().querySelectorAll('.ledger-mismatch-text .ledger-fig').length, 0);
  });
});
