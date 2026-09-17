/**
 * The button system. (P2)
 *
 * Before this there were 130 hand-typed class strings across 44 view modules —
 * `btn-primary`, `btn-secondary`, `btn-ghost btn-small`, `btn-primary
 * btn-inline` — and nothing enforced the two properties that actually matter:
 *
 *   1. **`type="button"`.** A `<button>` inside a `<form>` defaults to
 *      `type="submit"`. Every "cancel" and "add another row" control written
 *      without it submits the form instead. This module sets it always, and a
 *      submit button has to ask.
 *   2. **A busy button cannot be pressed twice.** The brief's §17 rule ("never
 *      allow double-submit") cannot be met by remembering it at 130 call
 *      sites. `busy` here disables the control, keeps its width so the layout
 *      does not jump, puts a spinner where the glyph was (the label stays, so
 *      the accessible name never changes), and announces itself.
 *
 * ── The hierarchy, and what each level means ───────────────────────────────
 * `primary`   the one action this screen exists for. At most one per view.
 * `secondary` an alternative that is not the point — cancel, back, export.
 * `ghost`     low-priority, in a row of them: filters, table row actions.
 * `danger`    destructive and irreversible. Delete, revoke, remove.
 * `success`   only where the semantics are genuinely "this completed" —
 *             "সব উপস্থিত", not "save".
 *
 * `danger` is deliberately not a colour swap on `primary`: a destructive
 * button that looks like the primary one is how a person deletes a section
 * while reaching for "save".
 */
import { el, icon, append, type Child } from './dom.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'md' | 'sm';

export interface ButtonOptions {
  label: string;
  onClick?: (e: Event) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon name from ../icon.ts, rendered before the label. */
  glyph?: string;
  disabled?: boolean;
  /** In flight: disabled, spinner in place of the glyph, announced. */
  busy?: boolean;
  /** Fill the container. The default is intrinsic width. */
  block?: boolean;
  /** `submit` only where the button really is a form's submit control. */
  type?: 'button' | 'submit';
  /** Extra classes for one-off placement (e.g. `att-save`). Not for restyling. */
  className?: string;
  /** Overrides the accessible name. Only for icon-only buttons. */
  ariaLabel?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
};

/** A digit, Latin 0-9 or Bangla ০-৯. */
const DIGIT = /[0-9০-৯]/;
/**
 * One number as a reader sees it: digits, with the separators that sit
 * between digits ("১২,৫০০.৭৫", "১০:৪৫", "২০২৫–২৬"), and a trailing % or + ("৯+").
 * The same pattern badge, card, field, filter, overlay and table use.
 */
const NUMBER = '[0-9০-৯]+(?:[.,:/\\u2013-][0-9০-৯]+)*[%+]?';
const NUMBER_RUN = new RegExp(NUMBER, 'g');
const ONLY_NUMBER = new RegExp(`^\\s*${NUMBER}\\s*$`);

/**
 * The label span, with every number in the `.n` face (R6).
 *
 * `.n` switches font-family to the numeral face, so it must not sit on words:
 * 14 Components §01 sets every button label in the text face. A label that is
 * only a number ("৫") gets `.n` on the span itself. A number inside words
 * ("বাকি ২ জনে যান") gets the smallest element that holds it — a
 * `<span class="n">` around the digits — and the words stay in the text face.
 * Built from text nodes only (labels can be school data, never markup), so
 * textContent is exactly the label and the accessible name does not change.
 */
function labelSpan(doc: Document, label: string): HTMLElement {
  if (!DIGIT.test(label)) return el(doc, 'span', { className: 'btn-label', text: label });
  if (ONLY_NUMBER.test(label)) return el(doc, 'span', { className: 'btn-label n', text: label });
  const span = el(doc, 'span', { className: 'btn-label' });
  let at = 0;
  for (const m of label.matchAll(NUMBER_RUN)) {
    const i = m.index ?? 0;
    if (i > at) append(span, label.slice(at, i));
    append(span, el(doc, 'span', { className: 'n', text: m[0] }));
    at = i + m[0].length;
  }
  if (at < label.length) append(span, label.slice(at));
  return span;
}

/** The glyph a busy button set aside, so release can put it back. */
const PARKED_GLYPH = new WeakMap<HTMLButtonElement, Element>();

export function button(doc: Document, o: ButtonOptions): HTMLButtonElement {
  const cls = [
    // `ui-btn` is a marker, not a look: it resets the `width: 100%` that
    // `.btn-primary` and `.btn-success` have carried since the app was
    // phone-only. Those two have never had an intrinsic-width form, so a
    // "save" in a table row or a page header stretched the whole column.
    // Scoped to this marker so the 130 legacy call sites keep the full-width
    // bar they were written for until their screen's phase migrates them.
    'ui-btn',
    VARIANT[o.variant ?? 'secondary'],
    // `btn-sm` is the sheet's small size (14 Components §01: 36px, 13px,
    // --r-sm). The older `btn-small` resolves only to a carried legacy rule
    // (44px, 14px, --r-md) that stays for the hand-typed call sites. Never
    // emit both: the carried rule sits later in app.css and would win.
    o.size === 'sm' ? 'btn-sm' : '',
    o.block ? 'btn-block' : '',
    o.className ?? '',
  ].filter(Boolean).join(' ');

  const btn = el(doc, 'button', {
    className: cls,
    attrs: {
      // Always explicit. The default is `submit`, and a "cancel" that submits
      // the form is the bug this line exists to make impossible.
      type: o.type ?? 'button',
      'aria-label': o.ariaLabel ?? null,
      ...(o.attrs ?? {}),
    },
  });

  // Numbers carry `n` (R6). Labels come from callers — 'বাকি ২ জনে যান',
  // '৩টি অপেক্ষমাণ' — so this is the one place the rule can be kept for all
  // of them. See labelSpan: the class goes on the number, not the words.
  const label = labelSpan(doc, o.label);
  if (o.glyph) btn.append(icon(doc, o.glyph, 'btn-glyph'));
  btn.append(label);

  if (o.onClick) btn.addEventListener('click', o.onClick);
  setBusy(btn, o.busy ?? false);
  if (o.disabled) btn.disabled = true;
  return btn;
}

/**
 * Put a button into (or out of) its busy state.
 *
 * Exported because the common case is a button that becomes busy on click and
 * stops when the request answers — recreating the element would lose focus
 * mid-action, which on a phone means the keyboard closes.
 *
 * The width is pinned before the glyph is swapped for the spinner. The label
 * stays (14 Components §01 draws the busy button as spinner + label), but a
 * spinner and a glyph are not the same width, and without the pin every
 * control to the right would shift — on a form that is merely ugly, on a row
 * of table actions it means the next button slides under the finger already
 * travelling towards it.
 *
 * Release puts the glyph back. It is parked, not destroyed, so a button that
 * has been busy once does not lose its icon for the rest of the screen.
 */
export function setBusy(btn: HTMLButtonElement, busy: boolean): void {
  const doc = btn.ownerDocument;
  if (busy) {
    if (btn.dataset.busy === 'true') return;
    const w = btn.getBoundingClientRect().width;
    if (w > 0) btn.style.minWidth = `${Math.round(w)}px`;
    btn.dataset.busy = 'true';
    btn.disabled = true;
    // aria-busy, not a visually-hidden "loading" string: the button keeps its
    // accessible name, and a reader that supports aria-busy says the rest.
    btn.setAttribute('aria-busy', 'true');
    const spin = el(doc, 'span', {
      className: 'btn-spinner', attrs: { 'aria-hidden': 'true' },
    });
    const glyph = btn.querySelector('.btn-glyph');
    if (glyph) {
      PARKED_GLYPH.set(btn, glyph);
      glyph.remove();
    }
    btn.prepend(spin);
  } else {
    if (btn.dataset.busy !== 'true') return;
    delete btn.dataset.busy;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.style.minWidth = '';
    btn.querySelector('.btn-spinner')?.remove();
    const glyph = PARKED_GLYPH.get(btn);
    PARKED_GLYPH.delete(btn);
    if (glyph && !btn.querySelector('.btn-glyph')) btn.prepend(glyph);
  }
}

/**
 * Run an async action with the button busy for its duration, once.
 *
 * This is the double-submit guard as a function rather than as a rule people
 * remember. A second click while the first is in flight does nothing, and the
 * button is restored whether the action resolves or throws — a failed save
 * that leaves a permanently disabled button is a screen a teacher has to
 * reload, losing the register.
 */
export function onClickBusy(
  btn: HTMLButtonElement,
  action: () => Promise<void>,
  onError?: (err: unknown) => void,
): void {
  btn.addEventListener('click', async () => {
    if (btn.dataset.busy === 'true') return;
    setBusy(btn, true);
    try {
      await action();
    } catch (err) {
      // Caught, never rethrown. An async event listener that rejects produces
      // an unhandled rejection with no stack the caller can act on, and in a
      // service-worker-controlled page that is a console entry nobody sees.
      // Callers that care pass `onError`; callers that forget still get a
      // restored button and a logged cause rather than a silent dead control.
      if (onError) onError(err);
      else console.error('[ui] button action failed', err);
    } finally {
      setBusy(btn, false);
    }
  });
}

/**
 * An icon-only control.
 *
 * `label` is required and becomes the accessible name — an icon-only button
 * with no name is the single most common accessibility defect in an
 * application like this, and there is no way to add one later from the outside.
 * `title` too, so a mouse user gets the same word a screen reader does.
 */
export function iconButton(doc: Document, o: {
  glyph: string;
  label: string;
  onClick?: (e: Event) => void;
  variant?: 'ghost' | 'danger';
  className?: string;
  disabled?: boolean;
}): HTMLButtonElement {
  const btn = el(doc, 'button', {
    className: ['ui-icon-btn', o.variant === 'danger' ? 'is-danger' : '', o.className ?? '']
      .filter(Boolean).join(' '),
    attrs: { type: 'button', 'aria-label': o.label, title: o.label },
  }, icon(doc, o.glyph));
  if (o.onClick) btn.addEventListener('click', o.onClick);
  if (o.disabled) btn.disabled = true;
  return btn;
}

/**
 * A row of buttons with one primary.
 *
 * Order is the point, and it is ONE order: DOM order is priority order, least
 * important first, so the primary finishes the line. `.ui-button-row` is one
 * wrapping row with an 8px gap (`--space-2`) at every width — there is no
 * phone column — so a row that runs out of room wraps rather than reflowing.
 * Callers pass "cancel, save" and the layout is right at both widths without
 * a second rule.
 */
export function buttonRow(doc: Document, ...children: Child[]): HTMLElement {
  return el(doc, 'div', { className: 'ui-button-row' }, ...children);
}
