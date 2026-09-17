/**
 * The Ata Ekta token foundation.  (IMPLEMENTATION.md §2–§4)
 *
 * The redesign replaced the stylesheet underneath 668 carried screen rules
 * by installing tokens/ata-ekta.css and re-pointing every old token name at
 * the new palette through an alias layer — without touching a view module.
 * That is only safe while four properties hold, and each test here exists
 * because breaking one is invisible in a screenshot until a specific screen
 * is opened by a specific role.
 *
 *   1. Every alias resolves. A `var(--thing)` with no definition does not
 *      error; the declaration is dropped and the element inherits a colour
 *      that usually looks plausible.
 *   2. There is ONE theme. The design has no dark mode (§5); a dark block that
 *      survives is a half-palette waiting for someone to switch it on.
 *   3. Text tokens meet their contrast obligations — and where the design's
 *      exact palette does NOT, that is written down by name and ratio rather
 *      than hidden by loosening the assertion. See "known shortfalls".
 *   4. The geometry and motion the spec fixes (§4) keep those values.
 *
 * These read the shipped CSS rather than a copy, so they cannot drift from it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LIGHT_SURFACE } from '../../../packages/ui-core/src/branding.ts';

// fileURLToPath, not URL.pathname: this repo's path contains spaces.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_RAW = readFileSync(join(ROOT, 'public', 'app.css'), 'utf8');
/**
 * Comments stripped before any token scan. This file's comments deliberately
 * NAME tokens and colours that are not in effect — a scanner that reads them
 * reports the very thing the comment says was changed.
 */
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every `:root { … }` block, LATEST FIRST.
 *
 * The sheet has three: the design's tokens, the compatibility aliases, and the
 * B-108 font override. The browser applies the last definition, and `resolve`
 * returns the first match — so ordering them latest-first gives `resolve`
 * exactly the cascade the browser applies.
 */
function rootBlocks(): string {
  const blocks: string[] = [];
  const re = /:root\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS)) !== null) {
    blocks.push(CSS.slice(m.index, CSS.indexOf('\n}', m.index)));
  }
  return blocks.reverse().join('\n');
}
const ROOT_TOKENS = rootBlocks();

/**
 * Tokens are declared several-per-line in the ramps, so an anchored match
 * sees only the first on each line. Match every declaration instead.
 */
function definedIn(block: string): Set<string> {
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/* ── contrast ─────────────────────────────────────────────────────────── */

function luminance(hexColour: string): number {
  let h = hexColour.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Resolve a token to its literal hex, following aliases, latest definition wins. */
function resolve(token: string, depth = 0): string | null {
  if (depth > 8) return null;
  // Several declarations can share a line, so anchor on a boundary, not ^.
  const m = new RegExp(`(?:^|[;{\\s])${token}\\s*:\\s*([^;]+);`, 'm').exec(ROOT_TOKENS);
  if (!m) return null;
  const v = m[1].trim();
  if (v.startsWith('#')) return v;
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  return alias ? resolve(alias[1], depth + 1) : null;
}

/**
 * Tokens used with NO fallback and never defined.
 *
 * `var(--x, var(--y))` is safe and deliberate. `var(--x)` alone is the
 * dangerous form: an undefined property drops the declaration silently.
 */
function undefinedWithoutFallback(prefix: string): string[] {
  const defined = definedIn(CSS_RAW);
  const re = new RegExp('var\\(\\s*(' + prefix + '[a-z0-9-]*)\\s*([,)])', 'g');
  const bad = new Set<string>();
  for (const m of CSS.matchAll(re)) {
    if (m[2] === ')' && !defined.has(m[1])) bad.add(m[1]);
  }
  return [...bad];
}

describe('every token resolves to a real value', () => {
  test('THE ONE THAT MATTERS — no token of ANY family is used but never defined', () => {
    // One prefix, so a new family cannot be forgotten. P8 found four rules
    // reading `var(--lh-normal)`, defined nowhere, that silently inherited
    // 1.75 instead of 1.65. The alias layer exists so the 668 carried screen
    // rules do not repeat that on every screen at once.
    const missing = undefinedWithoutFallback('--');
    assert.deepEqual(missing, [], `used but never defined: ${missing.join(', ')}`);
  });

  test('the carried --c-* and --color-* names all resolve through the alias layer', () => {
    assert.deepEqual(undefinedWithoutFallback('--c-'), []);
    assert.deepEqual(undefinedWithoutFallback('--color-'), []);
  });

  test('the Ata Ekta palette is in effect (§3)', () => {
    assert.equal(resolve('--bg')?.toLowerCase(), '#f3f2f2', 'page ground');
    assert.equal(resolve('--surface')?.toLowerCase(), '#ffffff', 'cards, tables, sheets');
    assert.equal(resolve('--inset')?.toLowerCase(), '#eae9e9', 'wells, table heads');
    assert.equal(resolve('--ink')?.toLowerCase(), '#201e1d', 'primary text');
    assert.equal(resolve('--accent')?.toLowerCase(), '#ec3013', 'the one accent');
    assert.equal(resolve('--ok')?.toLowerCase(), '#1c7f4f');
    assert.equal(resolve('--warn')?.toLowerCase(), '#9a6207');
    assert.equal(resolve('--danger')?.toLowerCase(), '#ae1800');
    assert.equal(resolve('--info')?.toLowerCase(), '#1d5fa8');
  });

  test('a carried old name lands on the NEW palette, not the old one', () => {
    // The alias layer is only worth having if it re-points: an old screen
    // reading --c-ink or --color-text must render in Ata Ekta colours.
    //
    // Only names a carried rule still USES get an alias — the build writes
    // one per reference, not one per old token — so these are checked
    // against names that are actually in the layer.
    assert.equal(resolve('--c-ink'), resolve('--ink'));
    assert.equal(resolve('--color-text'), resolve('--ink'));
    assert.equal(resolve('--c-primary'), resolve('--accent'));
    assert.equal(resolve('--color-bg'), resolve('--surface'));
    assert.equal(resolve('--c-surface'), resolve('--inset'));
    // and the previous palette's signature colours are gone from effect
    const inEffect = ['--c-ink', '--color-text', '--c-primary', '--color-bg', '--c-surface']
      .map((t) => resolve(t)?.toUpperCase());
    for (const old of ['#D23B2E', '#F1EFE6', '#53443D', '#E9E3D4']) {
      assert.ok(!inEffect.includes(old), `the previous palette's ${old} is still in effect`);
    }
  });
});

describe('§5 — light only, no dark mode', () => {
  test('THE ONE THAT MATTERS — no dark theme block survives', () => {
    // A surviving dark block is a half-palette: whoever switches it on gets
    // the old dark ramp under the new components.
    assert.doesNotMatch(CSS, /:root\[data-theme=['"]?dark/, 'a :root[data-theme=dark] block remains');
    assert.doesNotMatch(CSS, /prefers-color-scheme\s*:\s*dark/, 'a prefers-color-scheme: dark block remains');
  });

  test('the theme picker rules are gone with the picker', () => {
    assert.doesNotMatch(CSS, /\.shell-theme\s*\{/);
    assert.doesNotMatch(CSS, /\.theme-options?\s*\{/);
  });
});

describe('§3 — contrast obligations of the text tokens', () => {
  const GROUNDS = { bg: '#f3f2f2', surface: '#ffffff', inset: '#eae9e9' } as const;

  /**
   * Known shortfalls in the design's EXACT palette, measured and pinned.
   *
   * IMPLEMENTATION.md was followed to the letter — the owner asked for the
   * design "100% same" — and these tokens, used exactly as the design uses
   * them, do not reach WCAG AA (4.5:1) for normal-size text. They are listed
   * here with their measured ratios instead of being dropped from the test,
   * because a suite that goes green by forgetting an accessibility failure is
   * worse than a red one.
   *
   * Two rules make this a guard rather than a waiver:
   *   - a token NOT on this list must still clear 4.5 on every ground, so a
   *     new failure fails the build;
   *   - a token ON this list must not get WORSE than recorded.
   *
   * Remove an entry the moment its colour is corrected. The primary-button
   * ratio is the one to read twice: this product's previous palette recorded
   * its old red at 4.23:1 and was changed specifically to clear AA.
   *
   * DECIDED 2026-09-16: the owner chose to keep the design accent `#ec3013`
   * exactly (BACKLOG AE-1). These pins are therefore a record of a deliberate
   * choice, not an oversight waiting for a fix — do not "correct" the colour
   * without asking.
   */
  const KNOWN_SHORTFALLS: Record<string, { worst: number; why: string }> = {
    '--ink-3': { worst: 3.55, why: 'labels, meta and placeholders — small text, needs 4.5' },
    '--ok': { worst: 4.13, why: 'status text on bg/inset' },
    '--warn': { worst: 4.20, why: 'status text on inset' },
  };

  test('THE ONE THAT MATTERS — every text token clears AA on every ground, except the pinned ones', () => {
    const failures: string[] = [];
    for (const t of ['--ink', '--ink-2', '--ink-3', '--accent-ink', '--ok', '--warn', '--danger', '--info']) {
      const v = resolve(t);
      assert.ok(v, `${t} must resolve to a literal`);
      for (const [name, ground] of Object.entries(GROUNDS)) {
        const r = contrast(v, ground);
        if (r >= 4.5) continue;
        const known = KNOWN_SHORTFALLS[t];
        if (!known) {
          failures.push(`${t} (${v}) on ${name} is ${r.toFixed(2)}:1 — NEW failure`);
        } else if (r < known.worst - 0.01) {
          failures.push(`${t} on ${name} is ${r.toFixed(2)}:1 — WORSE than the pinned ${known.worst}`);
        }
      }
    }
    assert.deepEqual(failures, []);
  });

  test('the primary text tokens pass outright, with room', () => {
    for (const t of ['--ink', '--ink-2', '--accent-ink', '--danger', '--info']) {
      const v = resolve(t)!;
      for (const [name, ground] of Object.entries(GROUNDS)) {
        assert.ok(contrast(v, ground) >= 4.5, `${t} on ${name}`);
      }
    }
  });

  test('status chips: danger and info text pass on their own tints', () => {
    // ok-on-ok-tint (4.30) and warn-on-warn-tint (4.35) do not — those are the
    // উপস্থিত and দেরি chips, and are reported with the known shortfalls.
    assert.ok(contrast(resolve('--danger')!, resolve('--danger-tint')!) >= 4.5);
    assert.ok(contrast(resolve('--info')!, resolve('--info-tint')!) >= 4.5);
  });

  test('KNOWN SHORTFALL — white on the design accent is recorded, not ignored', () => {
    // The primary button. Pinned so a darker accent is a measurable win and a
    // lighter one is a failure — see the list above.
    const r = contrast('#ffffff', resolve('--accent')!);
    assert.ok(r >= 4.19, `white on --accent is ${r.toFixed(2)}:1, worse than the pinned 4.20`);
    assert.ok(r < 4.5, 'if this now passes, remove the primary-button note from the known shortfalls');
  });

  test("branding.ts's recessed-ground literal still matches this stylesheet", () => {
    // brandingCssVars derives a SCHOOL's brand text against this hex, so a pale
    // crest still gets a readable active tab. That module cannot read app.css,
    // so the two copies are compared here rather than trusted to stay in step.
    const inset = resolve('--inset');
    assert.ok(inset);
    assert.equal(inset.toLowerCase(), LIGHT_SURFACE.toLowerCase(),
      `branding.ts says ${LIGHT_SURFACE}, app.css --inset is ${inset}`);
    // and the carried --c-surface resolves to that same ground
    assert.equal(resolve('--c-surface')?.toLowerCase(), inset.toLowerCase());
  });
});

describe('§4 — geometry and motion', () => {
  test('corners on the four-step scale', () => {
    assert.match(ROOT_TOKENS, /--r-sm:\s*8px/);
    assert.match(ROOT_TOKENS, /--r-md:\s*12px/);
    assert.match(ROOT_TOKENS, /--r-lg:\s*18px/);
    assert.match(ROOT_TOKENS, /--r-pill:\s*999px/);
  });

  test('the tap target and the content cap', () => {
    assert.match(ROOT_TOKENS, /--tap-min:\s*44px/);
    assert.match(ROOT_TOKENS, /--content-max:\s*1200px/);
  });

  test('three durations and the two curves', () => {
    assert.match(ROOT_TOKENS, /--dur-1:\s*120ms/);
    assert.match(ROOT_TOKENS, /--dur-2:\s*180ms/);
    assert.match(ROOT_TOKENS, /--dur-3:\s*280ms/);
    assert.match(ROOT_TOKENS, /--ease:\s*cubic-bezier\(\.22,\s*\.61,\s*\.36,\s*1\)/);
    assert.match(ROOT_TOKENS, /--ease-spring:\s*cubic-bezier\(\.34,\s*1\.26,\s*\.64,\s*1\)/);
  });

  test('reduced motion still collapses every duration — the sheet says do not remove it', () => {
    assert.match(CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});

describe('§2 — type', () => {
  test('every number has its own face', () => {
    assert.match(ROOT_TOKENS, /--font-num:\s*"Anek Bangla"/);
    assert.match(CSS, /\.n\s*\{[^}]*font-family:\s*var\(--font-num\)/);
  });

  test('the design body size — mobile body text never below 15px', () => {
    assert.match(ROOT_TOKENS, /--text-body:\s*15px/);
  });
});

/**
 * B-108 §16 — Bangla digits do not render in Hind Siliguri.
 *
 * Hind Siliguri's ১ is close enough to ৮ at UI sizes that "১০টি" reads as
 * "৮০টি", "১০:৪৫" as "৮০:৪৫" and "১২,৫০০.৭৫" as "৮২,৫০০.৭৫" — a mark, a time and
 * a fee, each wrong by a digit. Digits arrive inside sentences, not as
 * elements, so the split has to be per character: a `unicode-range` face over
 * U+09E6–U+09EF only.
 *
 * The Ata Ekta sheet's `--font-bn` does not name that face, and routes numbers
 * through `.n` onto Anek Bangla instead. `.n` cannot reach a digit mid-sentence,
 * so installing the sheet left the face defined and referenced nowhere — the
 * exact failure B-108 was filed for. app.css names it first again, on purpose.
 */
describe('B-108 §16 — the Bangla numeral face', () => {
  const face = (() => {
    const i = CSS.indexOf("font-family: 'ShikhonBnNum'");
    return i < 0 ? '' : CSS.slice(CSS.lastIndexOf('@font-face', i), CSS.indexOf('}', i));
  })();

  test('THE ONE THAT MATTERS — digits are covered, and only digits', () => {
    assert.ok(face, 'the numeral @font-face is gone');
    assert.match(face, /unicode-range:\s*U\+09E6-09EF/i);
    assert.doesNotMatch(face, /U\+0980-09FF/i, 'that would be the whole script');
  });

  test('THE ONE THAT MATTERS — it is reachable: the text stack names it BEFORE Hind Siliguri', () => {
    // The token that preceded this face failed by being defined and never
    // referenced. Checked against the stack actually in effect.
    const m = /--font-bn:\s*([^;]+);/.exec(ROOT_TOKENS);
    assert.ok(m, '--font-bn must be defined');
    const stack = m[1];
    assert.match(stack, /ShikhonBnNum/, '--font-bn does not reach the numeral face');
    assert.ok(stack.indexOf('ShikhonBnNum') < stack.indexOf('Hind Siliguri'),
      'ShikhonBnNum must come before Hind Siliguri, or Hind Siliguri keeps the digits');
  });

  test('every text stack a rule reads reaches it, or is the design numeral face', () => {
    // The carried --font-body / --font-heading are no longer read by any rule —
    // the screens were restyled onto --font-bn directly — so the guarantee is
    // stated over what IS read: every `font-family: var(--x)` in the sheet must
    // be --font-bn (which names ShikhonBnNum first), the design's own numeral
    // face for `.n` (--font-num / its alias --font-bn-num), or an alias that
    // resolves to --font-bn. A new stack that skips the face fails here.
    const read = [...new Set([...CSS.matchAll(/font-family:\s*var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]))];
    assert.ok(read.includes('--font-bn'), 'the text stack must actually be read by a rule');
    const allowed = new Set(['--font-bn', '--font-num', '--font-bn-num']);
    for (const t of read) {
      if (allowed.has(t)) continue;
      const m = new RegExp(`${t}:\\s*([^;]+);`).exec(ROOT_TOKENS);
      assert.ok(m, `${t} is read by a rule but never defined`);
      assert.match(m[1], /var\(--font-bn\)|ShikhonBnNum/, `${t} does not reach the numeral face`);
    }
    // --font-bn-num must really be the numeral face, not a letter stack.
    const alias = /--font-bn-num:\s*([^;]+);/.exec(ROOT_TOKENS);
    if (read.includes('--font-bn-num')) {
      assert.ok(alias, '--font-bn-num is read but never defined');
      assert.match(alias![1], /var\(--font-num\)/);
    }
  });

  test('Bangla letters still belong to Hind Siliguri', () => {
    const m = /--font-bn:\s*([^;]+);/.exec(ROOT_TOKENS)!;
    assert.match(m[1], /Hind Siliguri/, 'the letter face must remain');
  });

  test('every platform is named, not just the target device', () => {
    for (const family of ['Noto Sans Bengali', 'Nirmala UI', 'Kohinoor Bangla']) {
      assert.ok(face.includes(`local('${family}')`), `${family} is not named`);
    }
  });

  test('it downloads nothing', () => {
    assert.doesNotMatch(face, /url\(/, 'a numeral face must not fetch anything');
  });
});
