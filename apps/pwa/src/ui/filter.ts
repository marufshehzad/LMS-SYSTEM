/**
 * Tabs and filters. (P2)
 *
 * §20: a filter bar on desktop, a filter BUTTON on a phone that opens a sheet.
 * Not the same controls at a smaller size — a row of four selects at 360px is
 * either four lines tall or four unusable 60px dropdowns, and either way it
 * pushes the data it filters off the screen entirely.
 *
 * The other half of §20 matters more and is usually missed: **active filters
 * must be visible, and clearable in one tap.** A person who filtered a roster
 * to one section last week and comes back to an empty-looking screen does not
 * think "I have a filter on"; they think the students are gone.
 *
 * ── Ata Ekta (14 Components §03, 13 Responsive ০৬/০৭) ──────────────────────
 * app.css decides the look; the markup here only carries the vocabulary. The
 * strip is the accent-underline tab row of §03; a view that draws its strip
 * differently (segmented day tabs, the console's count chips) passes its own
 * `className` and styles it in its own block, keeping this ARIA and keyboard
 * behaviour. filterBar's inline selects show from 1024px, its button below;
 * the button opens a bottom sheet, because it only exists on a phone.
 *
 * Numbers (R6): counts are wholly numeric and carry `n` themselves. Labels are
 * caller text that can hold a figure inside words ("বার্ষিক ২০২৬", "৯ম শ্রেণি"),
 * so the figure gets the smallest element that holds it — a `<span class="n">`
 * — and the words stay in the text face. textContent is unchanged either way.
 */
import { el, icon, append, uid, type Child } from './dom.ts';
import { openOverlay } from './overlay.ts';
import { announce } from './feedback.ts';
import { toBanglaDigits } from '../../../../packages/ui-core/src/format.ts';

/** A digit, Latin or Bangla. */
const DIGIT = /[0-9০-৯]/;
/**
 * One number as a reader sees it: digits, with the separators that sit between
 * digits ("১২,৫০০.৭৫", "১০:৪৫", "৭/৫২", "২০২৫–২৬"), and a trailing % or +.
 * The same shape card.ts, badge.ts and overlay.ts use.
 */
const NUMBER = '[0-9০-৯]+(?:[.,:/\\u2013-][0-9০-৯]+)*[%+]?';
const NUMBER_RUN = new RegExp(NUMBER, 'g');
const ONLY_NUMBER = new RegExp(`^\\s*${NUMBER}\\s*$`);

/**
 * An element holding caller text, with its numbers in the `.n` face.
 * Built from text nodes only — the text is school data, never markup.
 */
function textEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, className: string, text: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  if (!DIGIT.test(text)) return el(doc, tag, { className, text, attrs });
  if (ONLY_NUMBER.test(text)) {
    return el(doc, tag, { className: [className, 'n'].filter(Boolean).join(' '), text, attrs });
  }
  const node = el(doc, tag, { className, attrs });
  let at = 0;
  for (const m of text.matchAll(NUMBER_RUN)) {
    const i = m.index ?? 0;
    if (i > at) append(node, text.slice(at, i));
    append(node, el(doc, 'span', { className: 'n', text: m[0] }));
    at = i + m[0].length;
  }
  if (at < text.length) append(node, text.slice(at));
  return node;
}

export interface TabItem {
  id: string;
  label: string;
  /** A count beside the label — "অনুপস্থিত ৪". */
  count?: number;
}

/**
 * Tabs.
 *
 * The full ARIA tab pattern, including the keyboard behaviour people actually
 * expect: arrow keys move between tabs, Home/End jump to the ends, and only
 * the selected tab is in the tab order — so Tab moves *out* of the tab strip
 * into the panel rather than through six tabs one at a time.
 */
export function tabs(doc: Document, o: {
  items: TabItem[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
  /**
   * Extra classes on the strip, for a view whose design draws the strip in
   * its own shape (segmented day tabs, count chips). The ARIA tab pattern and
   * the keyboard behaviour stay exactly the same whatever it looks like.
   */
  className?: string;
}): HTMLElement {
  const strip = el(doc, 'div', {
    className: ['ui-tabs', o.className ?? ''].filter(Boolean).join(' '),
    attrs: { role: 'tablist', 'aria-label': o.label },
  });
  const buttons: HTMLButtonElement[] = [];

  o.items.forEach((item) => {
    const selected = item.id === o.active;
    const b = el(doc, 'button', {
      className: 'ui-tab',
      attrs: {
        type: 'button', role: 'tab',
        'aria-selected': String(selected),
        // Roving tabindex: one stop for the whole strip.
        tabindex: selected ? '0' : '-1',
        id: `tab-${item.id}`,
      },
      data: { id: item.id },
    }, textEl(doc, 'span', '', item.label));
    if (item.count !== undefined) {
      append(b, el(doc, 'span', { className: 'ui-tab-count n', text: toBanglaDigits(item.count) }));
    }
    b.addEventListener('click', () => { o.onSelect(item.id); refocus(b, item.id); });
    buttons.push(b);
    append(strip, b);
  });

  strip.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    const i = buttons.findIndex((b) => b === doc.activeElement);
    if (i < 0) return;
    let next = -1;
    if (key === 'ArrowRight') next = (i + 1) % buttons.length;
    else if (key === 'ArrowLeft') next = (i - 1 + buttons.length) % buttons.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = buttons[next];
    target.focus();
    o.onSelect(target.dataset.id!);
    refocus(target, target.dataset.id!);
  });

  /**
   * Most callers answer `onSelect` by rebuilding their view, strip included,
   * which removes the tab that was just pressed and drops focus to <body> —
   * the arrow keys then work exactly once. When that happened, focus goes to
   * the rebuilt strip's tab with the same id (its roving tabindex is already
   * 0, because it is now the selected one). Nothing moves when the strip
   * survived, or when focus is already somewhere the person put it.
   */
  function refocus(pressed: HTMLElement, id: string): void {
    if (pressed.isConnected) return;
    const a = doc.activeElement;
    if (a && a !== doc.body && a !== doc.documentElement) return;
    doc.getElementById(`tab-${id}`)?.focus({ preventScroll: true });
  }

  return strip;
}

export interface FilterDef {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  /** The value that means "no filter". Defaults to ''. */
  anyValue?: string;
}

/**
 * A filter bar on desktop; a button and a sheet on a phone.
 *
 * Both renderings are in the DOM and CSS picks one, as everywhere else in this
 * system — the state lives in the caller's `values`, so the two cannot
 * disagree about what is filtered.
 */
export function filterBar(doc: Document, o: {
  filters: FilterDef[];
  onChange: (id: string, value: string) => void;
  onClearAll: () => void;
  /** Rendered at the end of the bar on desktop — a search box, a date picker. */
  extra?: Child;
  label?: string;
}): HTMLElement {
  const active = o.filters.filter((f) => f.value !== (f.anyValue ?? ''));
  const wrap = el(doc, 'div', {
    className: 'ui-filters', attrs: { 'aria-label': o.label ?? 'ছাঁকনি' },
  });

  // ── desktop: inline selects ──────────────────────────────────────────
  const inline = el(doc, 'div', { className: 'ui-filters-inline' });
  for (const f of o.filters) append(inline, selectControl(doc, f, o.onChange));
  if (o.extra) append(inline, el(doc, 'div', { className: 'ui-filters-extra' }, o.extra));

  // ── mobile: one button that opens the sheet ──────────────────────────
  const openBtn = el(doc, 'button', {
    className: 'ui-filters-open',
    attrs: {
      type: 'button',
      'aria-label': active.length
        ? `ছাঁকনি — ${toBanglaDigits(active.length)}টি চালু`
        : 'ছাঁকনি',
    },
  }, icon(doc, 'layers'), el(doc, 'span', { text: 'ছাঁকনি' }),
     active.length
       ? el(doc, 'span', { className: 'ui-count n', text: toBanglaDigits(active.length) })
       : null);
  openBtn.addEventListener('click', () => {
    const body = el(doc, 'div', { className: 'ui-filter-sheet' });
    for (const f of o.filters) {
      append(body, selectControl(doc, f, (id, v) => { o.onChange(id, v); }, true));
    }
    // This button only shows below 1024px, so the panel is the phone's answer
    // (13 Responsive ০৭): a full-width bottom sheet, not a side drawer.
    openOverlay(doc, { kind: 'sheet', title: 'ছাঁকনি', body });
  });

  append(wrap, inline, openBtn);

  // ── active filters, always visible, one tap to clear ─────────────────
  if (active.length) {
    const chips = el(doc, 'div', {
      className: 'ui-filter-active', attrs: { 'aria-label': 'চালু ছাঁকনি' },
    });
    for (const f of active) {
      const shown = f.options.find((x) => x.value === f.value)?.label ?? f.value;
      const chip = el(doc, 'button', {
        className: 'ui-filter-chip',
        attrs: { type: 'button', 'aria-label': `${f.label}: ${shown} — সরান` },
      }, textEl(doc, 'span', '', `${f.label}: ${shown}`), icon(doc, 'x'));
      chip.addEventListener('click', () => {
        o.onChange(f.id, f.anyValue ?? '');
        announce(doc, `${f.label} ছাঁকনি সরানো হয়েছে`);
      });
      append(chips, chip);
    }
    const clear = el(doc, 'button', {
      className: 'ui-filter-clear', text: 'সব সরান', attrs: { type: 'button' },
    });
    clear.addEventListener('click', () => {
      o.onClearAll();
      announce(doc, 'সব ছাঁকনি সরানো হয়েছে');
    });
    append(chips, clear);
    append(wrap, chips);
  }

  return wrap;
}

function selectControl(
  doc: Document,
  f: FilterDef,
  onChange: (id: string, value: string) => void,
  stacked = false,
): HTMLElement {
  const id = uid('flt');
  const wrap = el(doc, 'div', {
    className: stacked ? 'ui-filter-field is-stacked' : 'ui-filter-field',
  });
  append(wrap, textEl(doc, 'label',
    stacked ? 'ui-field-label' : 'ui-sr-only', f.label, { for: id }));
  const sel = el(doc, 'select', {
    className: 'ui-input ui-select', attrs: { id, name: f.id },
  });
  for (const opt of f.options) {
    const node = el(doc, 'option', { text: opt.label, attrs: { value: opt.value } });
    if (opt.value === f.value) node.selected = true;
    append(sel, node);
  }
  sel.addEventListener('change', () => onChange(f.id, sel.value));
  append(wrap, sel);
  return wrap;
}

