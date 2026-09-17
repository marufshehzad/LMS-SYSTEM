/**
 * The page header, and the badges that sit in one. (P2)
 *
 * 29 view modules build this by hand today — the same seven lines each time:
 * a `<header class="page-header">`, an `<h1>`, a `<p class="page-sub">`,
 * `append`. That is ~200 lines of identical DOM construction, and it is why no
 * screen has a description, a breadcrumb or a primary action in its header:
 * adding one meant editing 29 places, so nobody did.
 *
 * §8 of the brief asks for:
 *
 *     Breadcrumb
 *     Page Title
 *     Short explanation
 *     Primary action
 *     Secondary actions
 *
 * The DOM this produces for `{ title, subtitle }` alone is byte-identical to
 * what the 29 views already build, so adopting it is a no-op visually and the
 * extra slots simply become available.
 *
 * ── Why the breadcrumb is optional here ────────────────────────────────────
 * The shell's topbar already renders one on desktop (P1), and repeating it in
 * the content is exactly the duplication §5 forbids. This slot exists for the
 * case the shell cannot serve: a screen reached *inside* another screen — a
 * section under a class, a student under a section — where the trail is data,
 * not navigation, and only the view knows it.
 *
 * ── Numbers (Ata Ekta §2, R6) ──────────────────────────────────────────────
 * Every element this module fills with CALLER text — title, subtitle, crumb,
 * back label, section title — sets its numbers in the `.n` face, on the
 * smallest element that holds them:
 *
 *   no digit            the same DOM as before — one element, one text node.
 *   only a number       `n` on the element itself ("২০২৬", "১০:৪৫").
 *   number inside words the element keeps its own class, and each number run
 *                       is a `<span class="n">` ("শিক্ষাবর্ষ <span.n>২০২৬</span>"),
 *                       so the words stay in the text face and a page title
 *                       does not change typeface from one screen to the next.
 *
 * textContent is identical in all three cases. Slots that take a node (badge,
 * primary, actions, section action) are the caller's markup and carry their
 * own `n`. The same rule, and the same number pattern, as ui/card.ts and
 * ui/badge.ts.
 */
import { el, icon, append, type Child, type ElProps } from './dom.ts';

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
 * An element holding caller `text`, with its numbers in the `.n` face (R6).
 * `props` is everything but the text (className, attrs, on). Built from text
 * nodes only — the text is school data, never markup.
 */
function numEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, props: Omit<ElProps, 'text'>, text: string,
): HTMLElementTagNameMap[K] {
  if (!DIGIT.test(text)) return el(doc, tag, { ...props, text });
  if (ONLY_NUMBER.test(text)) {
    const className = props.className ? `${props.className} n` : 'n';
    return el(doc, tag, { ...props, className, text });
  }
  const node = el(doc, tag, props);
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

export interface Crumb {
  label: string;
  /** Hash path without `#/`. Omit for the current (last) crumb. */
  path?: string;
  /**
   * For depth the ROUTER does not hold.
   *
   * P5: the academic screen is four levels deep behind one hash — year →
   * class → section → student — because those four are one thought and
   * splitting them into routes would mean re-choosing the section three times
   * to do three things to the same forty children. A crumb that can only
   * carry a `path` is decoration on a screen like that, so it may carry a
   * handler instead and renders a real `<button>`.
   */
  onClick?: () => void;
}

export interface PageHeaderOptions {
  title: string;
  /** One sentence on what this screen is for. Not a status line. */
  subtitle?: string;
  /** In-content trail, for hierarchy the shell cannot know. */
  crumbs?: Crumb[];
  /** The one action this screen exists for. */
  primary?: Child;
  /** Everything else — export, filter, settings. Rendered before the primary. */
  actions?: Child[];
  /** A status chip beside the title (e.g. "খসড়া", "প্রকাশিত"). */
  badge?: Child;
  className?: string;
}

/**
 * `<header class="page-header">` with the same `<h1>` and `.page-sub` the
 * hand-built ones produce, plus the slots they never had.
 */
export function pageHeader(doc: Document, o: PageHeaderOptions): HTMLElement {
  const head = el(doc, 'header', {
    className: ['page-header', o.className ?? ''].filter(Boolean).join(' '),
  });

  if (o.crumbs?.length) head.append(breadcrumb(doc, o.crumbs));

  const row = el(doc, 'div', { className: 'page-header-main' });
  const titles = el(doc, 'div', { className: 'page-header-text' });

  const h1 = numEl(doc, 'h1', {}, o.title);
  if (o.badge) {
    append(titles, el(doc, 'div', { className: 'page-title-row' }, h1, o.badge));
  } else {
    append(titles, h1);
  }
  if (o.subtitle) {
    append(titles, numEl(doc, 'p', { className: 'page-sub' }, o.subtitle));
  }
  row.append(titles);

  if (o.actions?.length || o.primary) {
    // Secondary first, primary last — priority order, so the eye finishes on
    // the primary. The actions sit beside the title while they fit next to
    // the title block's minimum width; when they do not, the row wraps and
    // they drop under the title, still flush left (14 Components §01). There
    // is no separate phone layout — one DOM, flex-wrap decides.
    const acts = el(doc, 'div', { className: 'page-header-actions' });
    append(acts, ...(o.actions ?? []), o.primary);
    row.append(acts);
  }

  head.append(row);
  return head;
}

/**
 * A trail. The last crumb is the current page and is not a link.
 *
 * `<nav aria-label>` + `<ol>`: a breadcrumb is an ordered list of ancestors,
 * and a reader that knows the pattern announces "list, 3 items" instead of
 * three unexplained links. The separator is a decorative `aria-hidden` span,
 * never a character inside a link's text.
 */
export function breadcrumb(doc: Document, crumbs: Crumb[]): HTMLElement {
  const nav = el(doc, 'nav', {
    className: 'ui-crumb', attrs: { 'aria-label': 'অবস্থান' },
  });
  const list = el(doc, 'ol', { className: 'ui-crumb-list' });
  crumbs.forEach((c, i) => {
    const last = i === crumbs.length - 1;
    const li = el(doc, 'li', { className: 'ui-crumb-item' });
    if (i > 0) {
      append(li, el(doc, 'span', {
        className: 'ui-crumb-sep', text: '/', attrs: { 'aria-hidden': 'true' },
      }));
    }
    if (c.onClick && !last) {
      // A button, not an anchor: it goes nowhere a URL names, and an `<a>`
      // with no href is invisible to the keyboard.
      append(li, numEl(doc, 'button', { className: 'ui-crumb-link',
        attrs: { type: 'button' }, on: { click: c.onClick } }, c.label));
    } else if (c.path && !last) {
      append(li, numEl(doc, 'a', { className: 'ui-crumb-link',
        attrs: { href: `#/${c.path}` } }, c.label));
    } else {
      append(li, numEl(doc, 'span', { className: 'ui-crumb-current',
        attrs: last ? { 'aria-current': 'page' } : {} }, c.label));
    }
    list.append(li);
  });
  nav.append(list);
  return nav;
}

/**
 * A "back to X" control for a drill-down.
 *
 * A `<button>` calling the view's own handler rather than `history.back()`:
 * the view knows what it was showing, the history does not, and going back
 * from a section to its class must not depend on how the person arrived.
 */
export function backLink(doc: Document, label: string, onBack: () => void): HTMLElement {
  const btn = el(doc, 'button', {
    className: 'ui-back', attrs: { type: 'button' },
  }, icon(doc, 'arrow-left'), numEl(doc, 'span', {}, label));
  btn.addEventListener('click', onBack);
  return btn;
}

/**
 * A section heading inside a page — the level below the page title.
 *
 * `<h2>` by default so the document outline is title → section → card, which
 * is what a screen reader's heading navigation walks. The optional action is
 * for "সব দেখুন" links, which today are `<a>` tags floated by six different
 * rules.
 */
export function sectionHeading(doc: Document, o: {
  title: string;
  action?: Child;
  level?: 2 | 3;
  className?: string;
}): HTMLElement {
  const wrap = el(doc, 'div', {
    className: ['ui-section-head', o.className ?? ''].filter(Boolean).join(' '),
  });
  append(wrap, numEl(doc, o.level === 3 ? 'h3' : 'h2', { className: 'ui-section-title' }, o.title));
  if (o.action) append(wrap, el(doc, 'div', { className: 'ui-section-action' }, o.action));
  return wrap;
}
