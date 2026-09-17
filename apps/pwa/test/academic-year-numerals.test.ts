/**
 * An academic year, arriving from the DATABASE, must reach the screen in
 * Bangla digits.  (P12-1)
 *
 * ── Why this file exists next to bangla-numerals.test.ts ────────────────
 * That guard reads source LITERALS, and it is good at it. It could never have
 * caught this defect, because the digits never appear in source: the year is
 * `academic_years.label`, a free-text column, interpolated into a Bangla
 * sentence at eleven different sites. The P12 audit found `শিক্ষাবর্ষ 2026` on
 * the principal's first screen with a correctly-Bangla date beside it —
 * "বৃহস্পতিবার, ১০ সেপ্টেম্বর · শিক্ষাবর্ষ 2026" — a mismatch inside one line.
 *
 * `import-view.ts` was the clearest evidence that a literal-scanning guard was
 * never going to be enough: it passed the STEP number through a numeral helper
 * and left the year raw, a few characters apart on the same line.
 *
 * So this file checks the two things the other one structurally cannot:
 *
 *   1. the shared formatter behaves, including on values the database really
 *      holds (this one contains both `2026` and `২০২৬`);
 *   2. no view interpolates a year label into Bangla prose without it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formatAcademicYear } from '../../../packages/ui-core/src/format.ts';

// fileURLToPath, not URL.pathname: this repo's path contains spaces.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('P12-1 — the formatter itself', () => {
  test('THE ONE THAT MATTERS — a Latin year becomes Bangla', () => {
    assert.equal(formatAcademicYear('2026'), '২০২৬');
    assert.equal(formatAcademicYear(2026), '২০২৬');
  });

  test('idempotent — a label already in Bangla is left alone', () => {
    // The database really does hold both forms; `label` is free text.
    assert.equal(formatAcademicYear('২০২৬'), '২০২৬');
  });

  test('a ranged label keeps its separator', () => {
    assert.equal(formatAcademicYear('2026-27'), '২০২৬-২৭');
    assert.equal(formatAcademicYear('2026–2027'), '২০২৬–২০২৭');
  });

  test('empty and absent labels do not print "null"', () => {
    assert.equal(formatAcademicYear(null), '');
    assert.equal(formatAcademicYear(undefined), '');
    assert.equal(formatAcademicYear(''), '');
  });
});

/**
 * Every interpolation of a year label that lands in Bangla prose.
 *
 * The patterns below are the shapes this defect actually took, not an
 * imagined grammar: `${y.label}`, `${year}` beside শিক্ষাবর্ষ, `${...yearLabel}`.
 * A site is acceptable only if the value passes through `formatAcademicYear`
 * on its way out.
 */
describe('P12-1 — no view renders a raw year label', () => {
  test('THE ONE THAT MATTERS — every year interpolation is formatted', () => {
    const offenders: string[] = [];
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts') && f !== 'demo.ts');

    for (const f of files) {
      const src = readFileSync(join(SRC, f), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;

        // A year value being interpolated or concatenated into display text.
        const interpolates = /\$\{[^}]*\b(?:yearLabel|year\.label|y\.label)\b[^}]*\}/.test(line)
          || /\by\.label\s*\+/.test(line);
        if (!interpolates) return;

        // rowKey / value keys are machine strings, not prose.
        if (/rowKey|key:\s*\(/.test(line)) return;

        if (!/formatAcademicYear\s*\(/.test(line)) {
          offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 88)}`);
        }
      });
    }

    assert.deepEqual(offenders, [],
      `a year label reaches the screen unformatted:\n  ${offenders.join('\n  ')}`);
  });

  test('the guard can fail — a raw interpolation is detected', () => {
    // Negative control. A check that cannot fail proves nothing, and this
    // repository has shipped one of those before (B-120's security probe).
    const sample = 'const s = `শিক্ষাবর্ষ ${this.yearLabel} · ধাপ ১`;';
    const interpolates = /\$\{[^}]*\b(?:yearLabel|year\.label|y\.label)\b[^}]*\}/.test(sample);
    assert.equal(interpolates, true, 'the pattern no longer matches the defect it was written for');
    assert.equal(/formatAcademicYear\s*\(/.test(sample), false);
  });
});
