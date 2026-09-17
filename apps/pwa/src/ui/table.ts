/**
 * Tabular data, in two shapes. (P2)
 *
 * §7 of the brief: desktop gets a table, mobile gets a list, and horizontal
 * scrolling is a last resort rather than a layout. The failure this prevents is
 * the one every admin template ships with — a six-column table squeezed into
 * 360px, where a guardian reads a student's name two characters at a time.
 *
 * **One column description, two renderings.** The caller declares the columns
 * once and says what each one *is* on a phone: the title, a piece of meta, the
 * status, or not shown at all. A list is not a table with the borders removed;
 * it is the same record with a different thing in charge of it, and the only
 * way both stay correct is for one declaration to produce both.
 *
 * ── Why both are in the DOM at once ────────────────────────────────────────
 * Same decision as the shell (P1): render both, let a media query hide one.
 * `display:none` takes a subtree out of the accessibility tree too, so a
 * screen reader meets exactly one of them. The alternative is a `matchMedia`
 * listener that re-renders on a breakpoint cross, which costs a listener per
 * table, a lifecycle these views do not have, and a rebuild that drops focus
 * mid-interaction.
 *
 * The wrapper says so: `data-shape="table-list"` marks a `.ui-data` that holds
 * BOTH shapes, and the 1024px swap (13 Responsive rule ০১) is scoped to it.
 * Hand-built matrices (rule ০৩ — teaching assignments, the routine editor, the
 * exam routine) also sit in a `.ui-data > .ui-table-scroll` and must never be
 * hidden on a phone; without the marker, the swap would blank them.
 *
 * The cost is roughly 5 extra nodes per row, which is why `page` exists below:
 * lists here are bounded at 50 rows by default. On the reference device — a
 * 2 GB Android on 2 G — an unbounded 500-row render is the thing to avoid,
 * and it was already the thing to avoid before this module existed.
 *
 * ── Empty is not an error ──────────────────────────────────────────────────
 * A table with no rows renders its empty state in place of both shapes, inside
 * the same `.ui-data` shell, with the caption kept for a screen reader. Callers
 * should pass an `empty` that says what is missing and what would fill it —
 * "no students match this filter" and "this school has no students" are
 * different sentences.
 *
 * ── Numbers (Ata Ekta §2, R6) ──────────────────────────────────────────────
 * Every slot this module fills with caller content sets its numbers in the
 * `.n` face. Content that is only a number gets `n` on the element itself; a
 * number inside words gets the smallest element that holds it, a
 * `<span class="n">` around the digits, so the words stay in the text face.
 * A `numeric` column's cell, the page position and a timeline's "when" line
 * are figures by definition and take `n` whole. In the phone's meta line the
 * hidden column-header prefix is skipped, so only the value's digits are
 * wrapped. textContent never changes.
 */
import { el, append, uid, type Child } from './dom.ts';
import { emptyState, type EmptyOptions } from '../view-states.ts';
import { icon } from './dom.ts';
import { toBanglaDigits } from '../../../../packages/ui-core/src/format.ts';

/** A digit, Latin or Bangla. */
const DIGIT = /[0-9০-৯]/;
/**
 * One number as a reader sees it: digits, with the separators that sit
 * between digits ("১২,৫০০.৭৫", "১০:৪৫", "৫১–১০০"), and a trailing % or + ("৯৬%").
 * The same spelling as ui/badge.ts and ui/card.ts, so a figure is split the
 * same way wherever it appears.
 */
const NUMBER = '[0-9০-৯]+(?:[.,:/\\u2013-][0-9০-৯]+)*[%+]?';
const NUMBER_RUN = new RegExp(NUMBER, 'g');
const ONLY_NUMBER = new RegExp(`^\\s*${NUMBER}\\s*$`);
/** Text inside these stays a plain text node: a span there is invalid or unseen. */
const KEEP_PLAIN = new Set(['option', 'select', 'textarea', 'script', 'style', 'svg']);

/** Is this text node already in the `.n` face, hidden, or somewhere a span cannot go? */
function shielded(t: Node, root: HTMLElement): boolean {
  for (let p = t.parentElement; p; p = p === root ? null : p.parentElement) {
    if (KEEP_PLAIN.has(p.localName)) return true;
    if (p.classList.contains('n') || p.classList.contains('ui-sr-only')) return true;
  }
  return false;
}

/**
 * Put the numbers in `node` in the `.n` face, after its content is appended.
 *
 * `whole` — the element is a figure (a numeric column, a position): it takes
 * `n` itself as soon as it holds a digit. Otherwise an element holding only a
 * number takes `n`, and a number inside words is wrapped where it stands.
 * Only text nodes are touched, so caller markup and textContent survive.
 */
function numbers<T extends HTMLElement>(node: T, whole = false): T {
  if (node.classList.contains('n')) return node;
  const text = node.textContent ?? '';
  if (!DIGIT.test(text)) return node;
  if (whole || ONLY_NUMBER.test(text)) {
    node.classList.add('n');
    return node;
  }
  const doc = node.ownerDocument;
  const walker = doc.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
  const hits: Text[] = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (DIGIT.test(t.nodeValue ?? '') && !shielded(t, node)) hits.push(t as Text);
  }
  for (const t of hits) {
    const s = t.nodeValue ?? '';
    const frag = doc.createDocumentFragment();
    let at = 0;
    for (const m of s.matchAll(NUMBER_RUN)) {
      const i = m.index ?? 0;
      if (i > at) append(frag, s.slice(at, i));
      append(frag, el(doc, 'span', { className: 'n', text: m[0] }));
      at = i + m[0].length;
    }
    if (at < s.length) append(frag, s.slice(at));
    t.replaceWith(frag);
  }
  return node;
}

/** Where a column goes on a phone. */
export type MobileRole = 'title' | 'subtitle' | 'meta' | 'status' | 'hidden';

export interface Column<T> {
  /** Stable key. Used for the cell's `data-col`, which the CSS labels from. */
  key: string;
  header: string;
  cell: (row: T) => Child;
  /**
   * Where this column goes on a phone (13 Responsive rule ০১). Default `meta`
   * — shown in the list's detail line. Set it on EVERY column of a new table:
   * left to the default, every column lands on one crowded meta line. A
   * `hidden` column's data must stay reachable in the row's detail view, so a
   * table with a `hidden` column should have an `onRowClick`.
   */
  mobile?: MobileRole;
  /** Right-aligns and applies tabular numerals. Amounts, marks, counts. */
  numeric?: boolean;
  /** Desktop width hint, e.g. '96px' or 'minmax(0, 2fr)'. */
  width?: string;
}

export interface TableOptions<T> {
  columns: Array<Column<T>>;
  rows: T[];
  /** Stable identity for a row — used for keys and the row action target. */
  rowKey: (row: T) => string;
  /** Makes each row activate. Renders a real control in both shapes. */
  onRowClick?: (row: T) => void;
  /** Accessible name for the table. Required: an unnamed table is a maze. */
  caption: string;
  /** Shown in place of the body when `rows` is empty. */
  empty?: EmptyOptions;
  className?: string;
}

/**
 * A table and its list, from one declaration.
 *
 * `<caption>` rather than `aria-label`: it is announced, it is the standard,
 * and on a narrow desktop it is the one thing that tells a reader which table
 * they have landed in.
 */
export function dataTable<T>(doc: Document, o: TableOptions<T>): HTMLElement {
  const wrap = el(doc, 'div', {
    className: ['ui-data', o.className ?? ''].filter(Boolean).join(' '),
  });

  if (!o.rows.length) {
    append(wrap, el(doc, 'p', { className: 'ui-sr-only', text: o.caption }),
      emptyState(doc, o.empty ?? { message: 'এখনো কিছু নেই।' }));
    return wrap;
  }

  // Both shapes are present, so the 1024px swap applies to this shell only.
  wrap.dataset.shape = 'table-list';
  append(wrap, desktopTable(doc, o), mobileList(doc, o));
  return wrap;
}

function desktopTable<T>(doc: Document, o: TableOptions<T>): HTMLElement {
  const scroll = el(doc, 'div', { className: 'ui-table-scroll' });
  const table = el(doc, 'table', { className: 'ui-table' });
  append(table, el(doc, 'caption', { className: 'ui-sr-only', text: o.caption }));

  const thead = el(doc, 'thead');
  const hrow = el(doc, 'tr');
  for (const c of o.columns) {
    append(hrow, numbers(el(doc, 'th', {
      text: c.header,
      attrs: { scope: 'col' },
      data: { col: c.key, numeric: c.numeric ? 'true' : undefined },
      style: c.width ? { width: c.width } : undefined,
    })));
  }
  // The action column's header is a real cell with a visually-hidden label.
  // Hiding the <th> itself took it out of the row, so the header band and its
  // rule stopped one column short of the body.
  if (o.onRowClick) {
    append(hrow, el(doc, 'th', { className: 'ui-table-action', attrs: { scope: 'col' } },
      el(doc, 'span', { className: 'ui-sr-only', text: 'ক্রিয়া' })));
  }
  append(thead, hrow);
  append(table, thead);

  const tbody = el(doc, 'tbody');
  for (const row of o.rows) {
    const tr = el(doc, 'tr', { data: { key: o.rowKey(row) } });
    // What the first column ended up SAYING for this row — the row's own
    // name, which is what the open button has to be called.
    let rowName = '';
    o.columns.forEach((c, i) => {
      // The FIRST column is a row header, not a cell: it is what identifies
      // the record, and `scope="row"` is what lets a reader say "সাদিয়া
      // ইসলাম, শ্রেণি, ৮ম" instead of reading bare values with no anchor.
      const cell = el(doc, i === 0 ? 'th' : 'td', {
        attrs: i === 0 ? { scope: 'row' } : {},
        data: { col: c.key, numeric: c.numeric ? 'true' : undefined },
      });
      append(cell, c.cell(row));
      numbers(cell, !!c.numeric);
      if (i === 0) rowName = (cell.textContent ?? '').trim();
      append(tr, cell);
    });
    if (o.onRowClick) {
      const td = el(doc, 'td', { className: 'ui-table-action' });
      const btn = el(doc, 'button', {
        className: 'ui-row-open',
        attrs: {
          type: 'button',
          // "সাদিয়া ইসলাম: খুলুন", not "নাম: খুলুন" — the header is the
          // same on every row and so told a reader nothing. Falls back to
          // the header only when the first column renders empty, which is
          // still better than nothing to click.
          'aria-label': `${rowName || o.columns[0].header}: খুলুন`,
        },
      }, icon(doc, 'chevron-right'));
      btn.addEventListener('click', () => o.onRowClick!(row));
      append(td, btn);
      append(tr, td);
    }
    append(tbody, tr);
  }
  append(table, tbody);
  append(scroll, table);
  return scroll;
}

function mobileList<T>(doc: Document, o: TableOptions<T>): HTMLElement {
  const list = el(doc, 'ul', {
    className: 'ui-list', attrs: { 'aria-label': o.caption },
  });
  const byRole = (r: MobileRole) => o.columns.filter((c) => (c.mobile ?? 'meta') === r);
  // With no 'title' column, the first column left on the default role
  // stands in. Column 0 did, whatever its role — so a 'subtitle' rendered
  // twice and a 'hidden' column showed on the phone.
  const titles = byRole('title').length
    ? byRole('title')
    : [o.columns.find((c) => (c.mobile ?? 'meta') === 'meta') ?? o.columns[0]];
  const subs = byRole('subtitle');
  const metas = byRole('meta').filter((c) => !titles.includes(c));
  const stats = byRole('status');

  for (const row of o.rows) {
    const li = el(doc, 'li', { className: 'ui-list-item', data: { key: o.rowKey(row) } });
    const inner = o.onRowClick
      ? el(doc, 'button', { className: 'ui-list-hit', attrs: { type: 'button' } })
      : el(doc, 'div', { className: 'ui-list-hit is-static' });
    if (o.onRowClick) inner.addEventListener('click', () => o.onRowClick!(row));

    const main = el(doc, 'div', { className: 'ui-list-main' });
    for (const c of titles) {
      append(main, numbers(el(doc, 'span', { className: 'ui-list-title' }, c.cell(row)), !!c.numeric));
    }
    for (const c of subs) {
      append(main, numbers(el(doc, 'span', { className: 'ui-list-sub' }, c.cell(row)), !!c.numeric));
    }
    if (metas.length) {
      const meta = el(doc, 'span', { className: 'ui-list-meta' });
      metas.forEach((c, i) => {
        if (i > 0) {
          append(meta, el(doc, 'span', {
            className: 'ui-list-dot', text: '·', attrs: { 'aria-hidden': 'true' },
          }));
        }
        // The column header goes in as a visually-hidden prefix. On a phone
        // the value stands alone with no header row to explain it, and
        // "০১৭xxxxxxxx" read without "অভিভাবকের ফোন" is a number from nowhere.
        // The hidden header is skipped when numbers are set in the `.n` face;
        // the value's digits are wrapped where they stand.
        append(meta, numbers(el(doc, 'span', { className: 'ui-list-cell' },
          el(doc, 'span', { className: 'ui-sr-only', text: `${c.header}: ` }),
          c.cell(row))));
      });
      append(main, meta);
    }
    append(inner, main);
    for (const c of stats) {
      append(inner, numbers(el(doc, 'span', { className: 'ui-list-status' }, c.cell(row)), !!c.numeric));
    }
    if (o.onRowClick) {
      append(inner, el(doc, 'span', {
        className: 'ui-list-chevron', attrs: { 'aria-hidden': 'true' },
      }, icon(doc, 'chevron-right')));
    }
    append(li, inner);
    append(list, li);
  }
  return list;
}

/** The meaning a standalone row's right-hand figure carries (14 Components §04). */
export type ListStatusTone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

/**
 * A standalone list row, for the many places that are a list but not a table:
 * notices, documents, the More menu, a class's sections.
 */
export function listItem(doc: Document, o: {
  title: string;
  subtitle?: string;
  meta?: string;
  glyph?: string;
  status?: Child;
  /**
   * Colours a plain-text `status` figure by meaning ("৯৬%" success, "৮১%"
   * danger) and sets it bold, as 14 Components §04 draws it. Colour never
   * carries meaning alone: the title beside it, or words in the status, must.
   * Leave unset when `status` is already a badge — the badge has its own tone.
   */
  statusTone?: ListStatusTone;
  onClick?: () => void;
  className?: string;
}): HTMLElement {
  const li = el(doc, 'li', {
    className: ['ui-list-item', o.className ?? ''].filter(Boolean).join(' '),
  });
  const inner = o.onClick
    ? el(doc, 'button', { className: 'ui-list-hit', attrs: { type: 'button' } })
    : el(doc, 'div', { className: 'ui-list-hit is-static' });
  if (o.onClick) inner.addEventListener('click', o.onClick);
  if (o.glyph) append(inner, el(doc, 'span', { className: 'ui-list-glyph' }, icon(doc, o.glyph)));
  const main = el(doc, 'div', { className: 'ui-list-main' },
    numbers(el(doc, 'span', { className: 'ui-list-title', text: o.title })),
    o.subtitle ? numbers(el(doc, 'span', { className: 'ui-list-sub', text: o.subtitle })) : null,
    o.meta ? numbers(el(doc, 'span', { className: 'ui-list-meta', text: o.meta })) : null);
  append(inner, main);
  if (o.status) {
    append(inner, numbers(el(doc, 'span', {
      className: 'ui-list-status', data: { tone: o.statusTone },
    }, o.status)));
  }
  if (o.onClick) {
    append(inner, el(doc, 'span', {
      className: 'ui-list-chevron', attrs: { 'aria-hidden': 'true' },
    }, icon(doc, 'chevron-right')));
  }
  append(li, inner);
  return li;
}

/** A `<ul>` for `listItem`s. */
export function list(doc: Document, label: string, ...items: Child[]): HTMLElement {
  return el(doc, 'ul', { className: 'ui-list', attrs: { 'aria-label': label } }, ...items);
}

/**
 * Pagination.
 *
 * Numbered pages, not infinite scroll: a teacher looking for one student in
 * six hundred needs to be able to go back to where they were, and on 2 G an
 * infinite list is an unbounded download nobody asked for. Prev/next plus a
 * live position — "৩ / ১২" — is enough, and the live region announces the
 * move for anyone who cannot see the page change.
 *
 * 14 Components §04: the position first, then two outline buttons with words
 * — "আগে" and "পরে" — rather than arrows. Each button's accessible name starts
 * with its visible word ("আগের পাতা" ⊃ "আগে"), so a voice user who says what
 * they see still hits it.
 */
export function pagination(doc: Document, o: {
  page: number;          // 1-based
  pageCount: number;
  onGo: (page: number) => void;
  /** e.g. "৬০০ জনের মধ্যে ৫১–১০০" */
  summary?: string;
}): HTMLElement | null {
  if (o.pageCount <= 1) return null;
  const nav = el(doc, 'nav', {
    className: 'ui-pagination', attrs: { 'aria-label': 'পাতা' },
  });
  const mk = (label: string, text: string, to: number, disabled: boolean) => {
    const b = el(doc, 'button', {
      className: 'ui-page-btn',
      text,
      attrs: { type: 'button', 'aria-label': label, disabled: disabled || null },
    });
    if (!disabled) b.addEventListener('click', () => o.onGo(to));
    return b;
  };
  append(nav,
    el(doc, 'span', {
      className: 'ui-page-pos n',
      text: o.summary ?? `${toBanglaDigits(o.page)} / ${toBanglaDigits(o.pageCount)}`,
      attrs: { 'aria-live': 'polite' },
    }),
    mk('আগের পাতা', 'আগে', o.page - 1, o.page <= 1),
    mk('পরের পাতা', 'পরে', o.page + 1, o.page >= o.pageCount));
  return nav;
}

/**
 * A vertical timeline — an audit trail, a student's history, a fee ledger.
 *
 * An ordered list, because the order is the meaning. The rail and dots are
 * `::before` / `::after` decoration in CSS, not nodes, so a reader hears the
 * entries and not a column of bullets. The mark is left empty: the dot is
 * coloured by `tone`, and a glyph inside the mark would sit between the dot
 * and its rail and break the line.
 */
export function timeline(doc: Document, o: {
  label: string;
  entries: Array<{
    when: string;
    title: string;
    detail?: string;
    tone?: string;
    /** Ignored since Ata Ekta: the mark is a plain tone-coloured dot (14 Components §04). */
    glyph?: string;
  }>;
}): HTMLElement {
  const ol = el(doc, 'ol', { className: 'ui-timeline', attrs: { 'aria-label': o.label } });
  for (const e of o.entries) {
    append(ol, el(doc, 'li', {
      className: 'ui-timeline-item', data: { tone: e.tone ?? 'neutral' },
    },
      el(doc, 'span', { className: 'ui-timeline-mark', attrs: { 'aria-hidden': 'true' } }),
      el(doc, 'div', { className: 'ui-timeline-body' },
        numbers(el(doc, 'p', { className: 'ui-timeline-when', text: e.when }), true),
        numbers(el(doc, 'p', { className: 'ui-timeline-title', text: e.title })),
        e.detail ? numbers(el(doc, 'p', { className: 'ui-timeline-detail', text: e.detail })) : null)));
  }
  return ol;
}
