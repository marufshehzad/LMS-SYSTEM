/**
 * Cards, stats and avatars. (P2)
 *
 * §11 of the brief: "one canonical card system … do not create 20 visually
 * different card styles". The count today is closer to twenty than to one —
 * `.card`, `.home-card`, `.notice-card`, `.lesson-card`, `.next-card`,
 * `.quick`, `.brand-card`, `.assign-card` — each with its own padding and
 * radius, because each was written next to the screen that needed it.
 *
 * This is one card with **variants that mean something**, not variants that
 * look different:
 *
 *   `plain`        a container. Padding, hairline border, no shadow.
 *   `interactive`  the whole card navigates. Renders a <button>, gets hover,
 *                  focus and a chevron, and is keyboard-operable — which the
 *                  `<div onclick>` cards in this app are not.
 *   `accent`       kept so existing callers compile, and still emits the
 *                  `ui-card-accent` hook — but it no longer tints. Ata Ekta §3:
 *                  one accent, on the page's single primary button and the
 *                  active nav row, nowhere else.
 *
 * Ata Ekta: the root carries `card` — the shell the one stylesheet
 * (tokens/ata-ekta.css, top of app.css) styles: surface, 1px --line, --r-md —
 * AND `ui-card`, the hook tests and `.ui-card-grid > .ui-card` select. The
 * head and body inset themselves; the root has no padding of its own.
 *
 * A card is never *just* a rounded box here: if it has no title, no action and
 * no border to draw, the honest markup is a section, and the brief's "avoid
 * excessive cards" is that rule stated from the outside.
 *
 * ── Numbers (Ata Ekta §2, R6) ─────────────────────────────────────────────
 * Every slot this module fills with CALLER text — card title and subtitle,
 * stat label and note — sets its numbers in the `.n` face. Text that is only a
 * number gets `n` on the element itself; a number inside words ("গত ৯০ দিনের
 * হাজিরা") gets the smallest element that holds it, a `<span class="n">`
 * around the digits, so the words stay in the text face. textContent is
 * unchanged either way. The stat value is the figure, so it is always `.n`.
 */
import { el, icon, append, uid, type Child } from './dom.ts';

/** A digit, Latin or Bangla. */
const DIGIT = /[0-9০-৯]/;
/**
 * One number as a reader sees it: digits, with the separators that sit
 * between digits ("১২,৫০০.৭৫", "১০:৪৫", "৭/৫২", "২০২৫–২৬"), and a trailing
 * % or + ("৯৪%").
 */
const NUMBER = '[0-9০-৯]+(?:[.,:/\\u2013-][0-9০-৯]+)*[%+]?';
const NUMBER_RUN = new RegExp(NUMBER, 'g');
const ONLY_NUMBER = new RegExp(`^\\s*${NUMBER}\\s*$`);

/**
 * An element holding caller text, with its numbers in the `.n` face.
 * Built from text nodes only — the text is school data, never markup.
 */
function textEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, className: string, text: string, attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  if (!DIGIT.test(text)) return el(doc, tag, { className, text, attrs });
  if (ONLY_NUMBER.test(text)) return el(doc, tag, { className: `${className} n`, text, attrs });
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

export type CardVariant = 'plain' | 'interactive' | 'accent';

export interface CardOptions {
  variant?: CardVariant;
  /** Rendered as an <h2>/<h3> — pass `headingLevel` when nesting under one. */
  title?: string;
  subtitle?: string;
  /** Icon name shown in a square beside the title — neutral unless `tone` is set. */
  glyph?: string;
  /** Right-aligned control in the header row (a link, a menu, a small button). */
  action?: Child;
  /** Makes the whole card activate. Implies `variant: 'interactive'`. */
  onClick?: () => void;
  headingLevel?: 2 | 3;
  className?: string;
  /**
   * Tints the glyph square: 'info' | 'success' | 'warn' | 'danger' | 'accent2'.
   * Omit it and the square is the sheet's neutral --inset ground. Semantic
   * tones carry meaning only, always with words beside them (§3).
   * `'primary'` paints NEUTRAL, exactly as if omitted — see CardTone.
   */
  tone?: CardTone;
}

/**
 * `'primary'` stays in the union only so existing callers still compile. It
 * renders neutral: no `data-tone` is written for it, so the sheet's
 * accent-tinted `[data-tone="primary"]` glyph rules never match. Ata Ekta §3 /
 * R5 give the accent to the page's one primary button and the active nav row,
 * never to an icon. badge.ts maps its own 'primary' the same way. New code:
 * omit `tone`.
 */
export type CardTone = 'primary' | 'info' | 'success' | 'warn' | 'danger' | 'accent2';

/** The tone as written to the DOM: 'primary' (accent) is decoration, so none. */
function toneAttr(tone: CardTone | undefined): Exclude<CardTone, 'primary'> | undefined {
  return tone === 'primary' ? undefined : tone;
}

export function card(doc: Document, o: CardOptions, ...body: Child[]): HTMLElement {
  const interactive = Boolean(o.onClick) || o.variant === 'interactive';
  const cls = ['card', 'ui-card',
    o.variant === 'accent' ? 'ui-card-accent' : '',
    interactive ? 'ui-card-interactive' : '',
    o.className ?? ''].filter(Boolean).join(' ');

  // A card you can activate is a button, not a div with a click handler. The
  // div version is invisible to the keyboard and to every screen reader, and
  // this app has eight of them today.
  const root = interactive
    ? el(doc, 'button', { className: cls, attrs: { type: 'button' } })
    : el(doc, 'section', { className: cls });
  if (o.onClick) root.addEventListener('click', o.onClick);

  if (o.title || o.glyph || o.action) {
    const head = el(doc, 'div', { className: 'ui-card-head' });
    if (o.glyph) {
      append(head, el(doc, 'span', {
        // No default tone, and 'primary' writes none: an untoned glyph is the
        // sheet's neutral square. The old `?? 'primary'` painted every glyph
        // in the accent tint.
        className: 'ui-card-glyph', data: { tone: toneAttr(o.tone) },
      }, icon(doc, o.glyph)));
    }
    if (o.title) {
      const text = el(doc, 'div', { className: 'ui-card-titles' });
      const id = uid('card');
      append(text, textEl(doc, o.headingLevel === 3 ? 'h3' : 'h2', 'ui-card-title', o.title, { id }));
      if (o.subtitle) {
        append(text, textEl(doc, 'p', 'ui-card-sub', o.subtitle));
      }
      append(head, text);
      // The card names itself for a reader; without this an interactive card
      // announces its entire body as its label.
      root.setAttribute('aria-labelledby', id);
    }
    if (o.action) append(head, el(doc, 'div', { className: 'ui-card-action' }, o.action));
    if (interactive) {
      append(head, el(doc, 'span', {
        className: 'ui-card-chevron', attrs: { 'aria-hidden': 'true' },
      }, icon(doc, 'chevron-right')));
    }
    root.append(head);
  }

  if (body.length) root.append(el(doc, 'div', { className: 'ui-card-body' }, ...body));
  return root;
}

export interface StatOptions {
  label: string;
  /** Pre-formatted. Bangla numerals and money formatting are the caller's job. */
  value: string;
  glyph?: string;
  tone?: CardTone;
  /** A short qualifier under the number — "এ মাসে ৯২%", "২৫ আগস্ট শেষ তারিখ". */
  note?: string;
  onClick?: () => void;
}

/**
 * One number and what it means.
 *
 * The label comes FIRST in the DOM and reads first to a screen reader, because
 * "২৮৬" alone is not information. Visually the number dominates; the order in
 * the markup is the order that makes sense read aloud, and CSS handles the
 * rest.
 */
export function statCard(doc: Document, o: StatOptions): HTMLElement {
  const interactive = Boolean(o.onClick);
  // The tone sits on the ROOT as well as the glyph: the design colours the
  // figure itself by meaning (বকেয়া in --danger, উপস্থিত in --ok), and the
  // CSS keys that off `.ui-stat[data-tone]`. No tone — or 'primary', which is
  // the accent and so decoration (R5) — no attribute.
  const tone = toneAttr(o.tone);
  const root = interactive
    ? el(doc, 'button', {
      className: 'ui-stat ui-card-interactive', attrs: { type: 'button' }, data: { tone },
    })
    : el(doc, 'div', { className: 'ui-stat', data: { tone } });
  if (o.onClick) root.addEventListener('click', o.onClick);

  if (o.glyph) {
    root.append(el(doc, 'span', {
      className: 'ui-stat-glyph', data: { tone },
    }, icon(doc, o.glyph)));
  }
  const text = el(doc, 'div', { className: 'ui-stat-text' },
    textEl(doc, 'span', 'ui-stat-label', o.label),
    el(doc, 'span', { className: 'ui-stat-value n', text: o.value }),
    o.note ? textEl(doc, 'span', 'ui-stat-note', o.note) : null);
  root.append(text);
  return root;
}

/**
 * A strip of stat cells (13 Responsive rule ০২). Desktop: every cell in one
 * row — four across. Below 1024px: two per row (2×2 for four); an ODD count
 * stacks as one column, one cell per row — three stats are three rows, never
 * 1 + 2.
 *
 * The CSS needs the count for that, and app.css uses no `:has()`, so the row
 * carries `data-count`. It is stamped once, here: every caller passes its
 * cells as arguments.
 */
export function statRow(doc: Document, ...cards: Child[]): HTMLElement {
  const row = el(doc, 'div', { className: 'ui-stat-row' }, ...cards);
  row.dataset.count = String(row.childElementCount);
  return row;
}

/**
 * A person, as an initial — or a photo where one exists.
 *
 * 04-UIUX §6 makes initials the DEFAULT and photos opt-in: a 96px WebP is 4 KB
 * a school on 2G pays for every row of a roster, and a class of sixty is a
 * quarter of a megabyte to render a list of names.
 *
 * Ata Ekta: an initial renders on the neutral --inset ground with a 1px
 * --line edge, fully round, at 30 / 40 / 52px (sm / md / lg) — what every real
 * screen in the design draws. `data-tint` is still emitted from `tintOf()` so a
 * name-keyed palette can be switched on later, but no rule consumes it until
 * the owner approves a tokenised tint set (14 Components §01 labels its four
 * swatches a proposal). The hash is kept stable for that reason: same person,
 * same colour, once colour returns.
 */
export function avatar(doc: Document, o: {
  name: string;
  photoUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}): HTMLElement {
  const cls = ['ui-avatar', `is-${o.size ?? 'md'}`, o.className ?? '']
    .filter(Boolean).join(' ');
  if (o.photoUrl) {
    return el(doc, 'img', {
      className: cls,
      attrs: { src: o.photoUrl, alt: '', loading: 'lazy', decoding: 'async' },
    });
  }
  return el(doc, 'span', {
    className: cls,
    // aria-hidden: the name is always rendered beside this. An avatar that
    // announces "র" adds nothing and interrupts the name that follows.
    attrs: { 'aria-hidden': 'true' },
    data: { tint: String(tintOf(o.name)) },
    text: initial(o.name),
  });
}

/**
 * The first grapheme of a name.
 *
 * Bangla is why this is not `name[0]`: `'ক্ষুদ্র'[0]` is `'ক'` with the
 * conjunct's other half orphaned into the next slot, so a roster of sixty
 * would show sixty broken clusters.
 */
export function initial(name: string): string {
  const t = name.trim();
  if (!t) return '•';
  try {
    const seg = new Intl.Segmenter('bn', { granularity: 'grapheme' });
    for (const g of seg.segment(t)) return g.segment;
  } catch { /* no Segmenter */ }
  return [...t][0] ?? '•';
}

/** Stable 0–5 tint index for a name. Same person, same colour, every screen. */
export function tintOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 100003;
  return h % 6;
}
