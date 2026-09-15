/**
 * Ata Ekta R6 — the one shared helper that puts numbers in the numeral face.
 *
 * Screens call it instead of each writing its own digit splitter. The two
 * guarantees: the class lands on the smallest element holding the number
 * (never the whole sentence), and what is read is exactly what was passed.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { el, numText, numClass, hasDigit } from '../src/ui/dom.ts';

let doc: Document;
before(() => { doc = new JSDOM('').window.document; });

describe('numText', () => {
  test('wraps each number, leaves the words in the text face', () => {
    const text = '৭৮৪ জন শিক্ষার্থী ফল দেখতে পাবে · ৳ ৩,১৩৬ · ১০:৪৫ · ২০২৫–২৬ · ৯২%';
    const p = el(doc, 'p', {}, ...numText(doc, text));
    assert.equal(p.textContent, text, 'what is read is unchanged');
    assert.deepEqual([...p.querySelectorAll('.n')].map((n) => n.textContent),
      ['৭৮৪', '৩,১৩৬', '১০:৪৫', '২০২৫–২৬', '৯২%']);
    assert.equal(p.classList.contains('n'), false, 'the sentence itself is not in the numeral face');
  });

  test('text without a digit is one plain string, no spans', () => {
    assert.deepEqual(numText(doc, 'কিছু নেই'), ['কিছু নেই']);
  });

  test('never parses markup', () => {
    const p = el(doc, 'p', {}, ...numText(doc, '<b>৫</b>'));
    assert.equal(p.querySelector('b'), null);
    assert.equal(p.textContent, '<b>৫</b>');
  });
});

describe('numClass / hasDigit', () => {
  test('a whole-number text gets n; a number inside words does not', () => {
    assert.equal(numClass('ui-stat-value', '৭৮৪'), 'ui-stat-value n');
    assert.equal(numClass('x', ' ২০২৫–২৬ '), 'x n');
    assert.equal(numClass('x', '৳ ৫'), 'x');
    assert.equal(numClass('x', 'শ্রেণি ৫'), 'x');
    assert.equal(numClass('', '৯+'), 'n');
  });
  test('hasDigit sees Latin and Bangla digits', () => {
    assert.equal(hasDigit('রোল 12'), true);
    assert.equal(hasDigit('রোল ১২'), true);
    assert.equal(hasDigit('রোল'), false);
  });
});
