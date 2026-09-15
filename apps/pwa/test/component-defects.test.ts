/**
 * Defects the Ata Ekta component pass found in passing (R4) and the lead fixed.
 *
 * Each one was functionally wrong before the redesign touched it, so each
 * gets a test that fails on the old code — not only on the new look.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { confirmDialog } from '../src/view-states.ts';
import { field, setFieldError } from '../src/ui/field.ts';
import { dataTable, type Column } from '../src/ui/table.ts';
import { statusBadge } from '../src/ui/badge.ts';

let dom: JSDOM;
const doc = () => dom.window.document;

before(() => {
  dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="root"></main></body></html>',
    { url: 'http://localhost/app' });
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.document = dom.window.document;
});

describe('confirmDialog — a required field inside the confirm', () => {
  test('a failed validate keeps the dialog on screen and does not confirm', () => {
    // platform-ops puts a required reason inside the confirm. The dialog used
    // to remove itself BEFORE onConfirm ran, so the reason's error was set on
    // a detached node: the operator saw the dialog vanish and nothing happen.
    const root = doc().getElementById('root')!;
    let confirmed = 0;
    let valid = false;
    const dlg = confirmDialog({
      doc: doc(), title: 'স্থগিত — নিশ্চিত করুন', body: 'প্রতিষ্ঠান লগইন করতে পারবে না।',
      confirmLabel: 'স্থগিত', danger: true,
      validate: () => valid,
      onConfirm: () => { confirmed++; },
    });
    root.append(dlg);
    const ok = dlg.querySelector<HTMLButtonElement>('[data-danger="true"]')!;

    ok.click();
    assert.equal(confirmed, 0, 'nothing is submitted without a reason');
    assert.ok(dlg.isConnected, 'and the dialog stays, so its error can be read');

    valid = true;
    ok.click();
    assert.equal(confirmed, 1);
    assert.equal(dlg.isConnected, false);
  });

  test('without validate, confirming closes first exactly as before', () => {
    const root = doc().getElementById('root')!;
    let seenConnected: boolean | null = null;
    const dlg = confirmDialog({
      doc: doc(), title: 't', body: 'b', confirmLabel: 'হ্যাঁ',
      onConfirm: () => { seenConnected = dlg.isConnected; },
    });
    root.append(dlg);
    dlg.querySelector<HTMLButtonElement>('.btn-primary')!.click();
    assert.equal(seenConnected, false, 'callers that re-render still find the dialog gone');
  });
});

describe('field — the error clears while typing', () => {
  test('even when the caller listens only to change', () => {
    const f = field(doc(), { label: 'নাম', name: 'n', onChange: () => {} });
    setFieldError(f.root, 'নাম লিখুন।');
    assert.equal(f.input.getAttribute('aria-invalid'), 'true');
    f.input.dispatchEvent(new dom.window.Event('input'));
    assert.notEqual(f.input.getAttribute('aria-invalid'), 'true', 'typing takes the error away');
    assert.equal(f.root.querySelector<HTMLElement>('.ui-field-error')!.hidden, true);
  });
});

describe('dataTable — the phone list title without a title column', () => {
  interface Row { id: string; a: string; b: string }
  test('a subtitle column is not promoted to title and shown twice', () => {
    const cols: Column<Row>[] = [
      { key: 'a', header: 'ক', mobile: 'subtitle', cell: (r) => r.a },
      { key: 'b', header: 'খ', cell: (r) => r.b },
    ];
    const t = dataTable(doc(), {
      caption: 'x', columns: cols, rows: [{ id: '1', a: 'উপশিরোনাম', b: 'শিরোনাম' }], rowKey: (r) => r.id,
    });
    assert.equal(t.querySelector('.ui-list-title')?.textContent, 'শিরোনাম');
    assert.equal(t.querySelectorAll('.ui-list-item')[0]!.textContent!.split('উপশিরোনাম').length - 1, 1,
      'the subtitle appears once');
  });
});

describe('statusBadge — blocked is trouble, and trouble carries a glyph', () => {
  test('blocked renders the danger tone with the warning glyph', () => {
    const b = statusBadge(doc(), { state: 'blocked', label: 'আটকে আছে' });
    assert.equal(b.dataset.tone, 'danger');
    assert.ok(b.querySelector('svg'), 'not colour alone');
  });
});
