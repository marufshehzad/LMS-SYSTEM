/**
 * UX sweep, infra-css group — the shell-wide and cross-screen layout fixes in
 * public/app.css and the pre-JS boot state in public/app.html.
 *
 * jsdom does no layout, so these tests evaluate the CASCADE instead: every
 * rule of app.css is walked in source order through jsdom's CSSOM, media
 * queries are matched against a chosen viewport width, and the last
 * declaration for an exact selector wins (the selectors compared here are the
 * ones the fixes and the earlier rules they replace share, so specificity is
 * equal and source order decides — exactly as in the browser). The real
 * layout effect of each rule was measured in headless Chrome; these tests pin
 * the rules so a later edit cannot silently undo them.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'public', 'app.css'), 'utf8');
const HTML = readFileSync(join(ROOT, 'public', 'app.html'), 'utf8');

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
const styleEl = dom.window.document.createElement('style');
styleEl.textContent = CSS;
dom.window.document.head.append(styleEl);
const sheet = styleEl.sheet as unknown as CSSStyleSheet;

const norm = (s: string): string => s.replace(/\s+/g, ' ').replace(/\s*([>+~,])\s*/g, '$1').trim();

/** Does a media condition hold at this viewport width? Unknown features do not. */
function mediaMatches(condition: string, width: number): boolean {
  return condition.split(',').some((alt) => {
    const parts = alt.split(/\band\b/).map((p) => p.trim()).filter(Boolean);
    return parts.every((p) => {
      const m = /^\(\s*(min|max)-width\s*:\s*([\d.]+)px\s*\)$/.exec(p);
      if (!m) return false;
      const px = Number(m[2]);
      return m[1] === 'min' ? width >= px : width <= px;
    });
  });
}

/** The winning value of `prop` on exactly `selector` at `width`, or undefined. */
function valueAt(selector: string, prop: string, width: number): string | undefined {
  const want = norm(selector);
  let out: string | undefined;
  const walk = (rules: CSSRuleList, active: boolean): void => {
    for (const rule of Array.from(rules)) {
      const media = rule as CSSMediaRule;
      if (media.media && media.cssRules) {
        walk(media.cssRules, active && mediaMatches(media.media.mediaText, width));
        continue;
      }
      const style = rule as CSSStyleRule;
      if (!active || !style.selectorText) continue;
      if (!style.selectorText.split(',').map(norm).includes(want)) continue;
      const v = style.style.getPropertyValue(prop);
      if (v) out = v.trim();
    }
  };
  walk(sheet.cssRules, true);
  return out;
}

/** Largest px number in a value such as `calc(68px + env(...) + 128px)` summed. */
const sumPx = (v: string | undefined): number =>
  (v ?? '').match(/(-?[\d.]+)px/g)?.reduce((a, s) => a + parseFloat(s), 0) ?? 0;

describe('16, 59 — focus never parks behind the topbar or the tab bar', () => {
  test('phones: the root scroller is padded by both bars', () => {
    for (const w of [320, 375, 430, 768]) {
      assert.ok(sumPx(valueAt(':root', 'scroll-padding-top', w)) >= 56 + 2, `top at ${w}`);
      assert.ok(sumPx(valueAt(':root', 'scroll-padding-bottom', w)) >= 58 + 2, `bottom at ${w}`);
    }
  });
  test('desktop: the 64px topbar is cleared; there is no tab bar', () => {
    assert.ok(sumPx(valueAt(':root', 'scroll-padding-top', 1280)) >= 64);
  });
  test('the attendance register keeps its own, more specific padding', () => {
    assert.ok(sumPx(valueAt(':root:has(.att-register)', 'scroll-padding-bottom', 375)) >= 60 + 80);
  });
  test('the marks save bar (sticky above the tab bar, up to 117px) is cleared too', () => {
    assert.ok(sumPx(valueAt(':root:has(.marks-savebar)', 'scroll-padding-bottom', 375)) >= 60 + 117);
  });
});

describe('48 — the screen entrance animation leaves no transform behind', () => {
  test('.shell-view > * does not hold its end frame (both/forwards)', () => {
    for (const w of [375, 1280]) {
      const fill = valueAt('.shell-view > *', 'animation-fill-mode', w);
      const short = valueAt('.shell-view > *', 'animation', w) ?? '';
      const effective = fill ?? short;
      assert.doesNotMatch(effective, /\b(both|forwards)\b/, `fill mode at ${w}: ${effective}`);
      assert.match(short, /\brise\b/, 'the entrance animation itself still runs');
    }
  });
});

describe('25, 33 — a money figure in a stat band stays on one line', () => {
  for (const sel of ['.ph-band .ui-stat-value', '.ledger-stats .ui-stat-value', '.ward-stats .ui-stat-value']) {
    test(sel, () => {
      assert.equal(valueAt(sel, 'white-space', 320), 'nowrap');
      assert.notEqual(valueAt(sel, 'overflow-wrap', 320), 'anywhere');
      const size = valueAt(sel, 'font-size', 320) ?? '';
      const m = /^clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)$/.exec(size);
      assert.ok(m, `a viewport-scaled size, got "${size}"`);
      const at = (vw: number) => Math.min(Number(m[3]), Math.max(Number(m[1]), (Number(m[2]) * vw) / 100));
      // measured in Chrome: "৳ 12,50,000.00" fits a 320px phone's half cell at 16px
      assert.ok(at(320) <= 16, `size at 320 is ${at(320)}`);
      assert.equal(at(1280), 26, 'desktop keeps the sheet size');
    });
  }
  test('the ledger mismatch sentence keeps a wrapped figure together', () => {
    assert.equal(valueAt('.ledger-mismatch-text .ledger-fig', 'white-space', 375), 'nowrap');
  });
});

describe('7 — marks sheet: mark boxes are reachable and visible on phones', () => {
  test('the table shrinks to content below 1024, keeps 560px on desktop', () => {
    assert.match(valueAt('.marks-table', 'min-width', 375) ?? '', /^0(px)?$/);
    assert.equal(valueAt('.marks-table', 'min-width', 1280), '560px');
  });
  test('focus scrolling stops right of the frozen roll + name columns', () => {
    const roll = sumPx(valueAt('.marks-table .marks-roll', 'min-width', 375));
    const name = sumPx(valueAt('.marks-table .marks-name', 'min-width', 375));
    assert.ok(sumPx(valueAt('.marks-sheet > .ui-table-scroll', 'scroll-padding-left', 375)) >= roll + name);
    assert.equal(valueAt('.marks-table .marks-name', 'overflow-wrap', 375), 'anywhere', 'a long name cannot widen the frozen column');
  });
});

describe('36 — the student profile tab strip hides no tab on a phone', () => {
  test('tabs lay out in wrapping equal columns below 1024 only', () => {
    assert.equal(valueAt('.ui-tabs.stu-tabs', 'display', 375), 'grid');
    assert.match(valueAt('.ui-tabs.stu-tabs', 'grid-template-columns', 375) ?? '', /auto-fit/);
    assert.equal(valueAt('.ui-tabs.stu-tabs', 'display', 1280), undefined);
  });
});

describe('50 — the last register rows can scroll above the undo toast', () => {
  test('the list carries end clearance for the toast band below 1024', () => {
    // the toast is ~68px tall and sits var(--space-3) above the footer
    assert.ok(sumPx(valueAt('.att-list', 'padding-bottom', 375)) >= 80);
    assert.ok(sumPx(valueAt('.att-list', 'padding-bottom', 1280)) === 0);
  });
});

describe('66 — first paint before app.js is a skeleton', () => {
  test('#root holds the view-states skeleton markup, not a lone line of text', () => {
    const doc = new JSDOM(HTML).window.document;
    const root = doc.getElementById('root');
    assert.ok(root);
    const skel = root.querySelector('.is-skeleton.ui-skeleton');
    assert.ok(skel, 'skeleton present');
    assert.equal(skel.getAttribute('aria-busy'), 'true');
    assert.equal(skel.getAttribute('aria-label'), 'লোড হচ্ছে');
    assert.ok(skel.querySelector('.skel.skel-title'));
    assert.ok(skel.querySelectorAll('.skel.skel-bar').length >= 3);
    assert.equal(root.querySelector('p'), null, 'the old text-only placeholder is gone');
    for (const cls of ['.is-skeleton', '.ui-skeleton', '.skel', '.skel-title', '.skel-bar']) {
      assert.ok(CSS.includes(`${cls} {`) || CSS.includes(`${cls}{`), `${cls} is styled by app.css`);
    }
  });
});

describe('minors in the shell sheet', () => {
  test('89 — the account menu item ring is drawn inside the clipping menu', () => {
    assert.match(valueAt('.shell-menu-item:focus-visible', 'outline-offset', 375) ?? '', /^-/);
  });
  test('16/80 — আরও row descriptions wrap instead of cutting the warning off', () => {
    assert.equal(valueAt('.more-list .ui-list-sub', 'white-space', 320), 'normal');
  });
});
