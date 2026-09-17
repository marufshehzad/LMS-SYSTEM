/**
 * Every screen names itself.  (P12-2)
 *
 * The P12 audit rendered all 24 of the shell's routes and found exactly one
 * with no `<h1>`: `#/students` built its own `<h2 class="page-header">`
 * instead of using the shared `pageHeader()` helper. It looked identical —
 * same class, same position — so nothing about the screen gave it away. What
 * gave it away was counting.
 *
 * A screen-reader user landing there got no page heading, and the document
 * outline began at level 2.
 *
 * The rule this encodes: a view that draws a page-level heading uses
 * `pageHeader()`, which emits the `<h1>`. Hand-rolling `page-header` as an
 * `h2` is the specific mistake that shipped, so that is what is checked.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// fileURLToPath, not URL.pathname: this repo's path contains spaces.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('P12-2 — page headings', () => {
  test('THE ONE THAT MATTERS — no view hand-rolls a page-header heading', () => {
    const offenders: string[] = [];
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

    for (const f of files) {
      const src = readFileSync(join(SRC, f), 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
        // `createElement('h2')` followed within a few lines by the shared
        // page-header class — the exact shape that shipped.
        if (!/createElement\(\s*'h[2-6]'\s*\)/.test(line)) return;
        const window = lines.slice(i, i + 4).join('\n');
        if (/className\s*=\s*'page-header'|'page-header'/.test(window)) {
          offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }

    assert.deepEqual(offenders, [],
      `a page-level heading is not an h1:\n  ${offenders.join('\n  ')}`);
  });

  test('the guard can fail — the shape that shipped is still detected', () => {
    // Negative control, written from the real defect rather than an imagined
    // one. Without this, the test above passes even if the pattern rots.
    const shipped = [
      "    const h = d.createElement('h2');",
      "    h.className = 'page-header';",
    ].join('\n');
    const first = shipped.split('\n')[0];
    assert.equal(/createElement\(\s*'h[2-6]'\s*\)/.test(first), true);
    assert.equal(/className\s*=\s*'page-header'/.test(shipped), true);
  });

  test('the students screen uses the shared header', () => {
    const src = readFileSync(join(SRC, 'students-view.ts'), 'utf8');
    assert.match(src, /pageHeader\(d, \{/,
      'students-view must render its heading through pageHeader()');
  });
});
