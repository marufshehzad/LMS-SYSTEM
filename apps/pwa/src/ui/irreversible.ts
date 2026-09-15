/**
 * The irreversible-action panel. (Ata Ekta IMPLEMENTATION §7, R11)
 *
 * Four screens do something that cannot be undone — ফলাফল প্রকাশ, বার্ষিক
 * উন্নয়ন, ইনভয়েস তৈরি, নোটিশ পাঠান (২০০+) — and all four put the same barrier
 * in front of it. One builder, so the barrier is the same barrier everywhere:
 *
 *   1. a `--danger-tint` head that SAYS what cannot be reversed, in words
 *      (colour is never the message — R5);
 *   2. a checklist of what will happen, with the real counts the caller
 *      already holds ("৭৮৪ জন শিক্ষার্থী ফল দেখতে পাবে");
 *   3. a real checkbox, "আমি বুঝেছি এটি ফেরানো যাবে না";
 *   4. the primary button disabled until it is ticked.
 *
 * Anatomy follows the two screens that draw it whole — `05 Principal`
 * publishScreen and `08 Admin & IT` rolloverScreen: head (statement, then one
 * explanatory sentence) → body (eyebrow label, rows of glyph · text · count) →
 * foot behind a 2px rule (the checkbox label taking the free width, then the
 * actions, primary last).
 *
 * ── What this module does NOT do ───────────────────────────────────────────
 * It does not run the action, fetch a count, or open an overlay. The screen
 * already has the action (R3); this is how it is presented. The `confirm`
 * button is the caller's own — the panel only gates it. Pass it in `actions`
 * too to have it drawn in the panel's foot, or place it yourself (an overlay
 * footer, a page header).
 *
 * ── No live region ─────────────────────────────────────────────────────────
 * Ticking the box announces itself (a native checkbox reads "checked"), and a
 * button becoming enabled is found by moving to it. An `aria-live` here would
 * read the statement again on every tick.
 */
import { el, icon, append, uid, numText, type Child } from './dom.ts';
import { buttonRow } from './button.ts';

/** The tones a row can carry — the badge vocabulary, meaning only (R5). */
export type IrreversibleTone = 'neutral' | 'success' | 'info' | 'warn' | 'danger';

export interface IrreversibleItem {
  /** What will happen, with its real count: "৭২১ জন শিক্ষার্থী পরের শ্রেণিতে উঠবে". */
  text: string;
  /** A right-aligned figure beside the text: "৫২ / ৫২ সেকশন", "৳ ৩,১৩৬". */
  meta?: string;
  /** Colours the glyph only. The words carry the meaning. Default `neutral`. */
  tone?: IrreversibleTone;
  /** An icon.ts name. Default follows the tone (see GLYPH). */
  glyph?: string;
}

export interface IrreversibleOptions {
  /** What cannot be reversed, plainly: "প্রকাশের পর নম্বর আর বদলানো যাবে না". Names the panel. */
  statement: string;
  /** The one sentence under it — who is affected and what follows. */
  detail?: string;
  /** The checklist. Strings are neutral rows. */
  items: Array<string | IrreversibleItem>;
  /** The eyebrow over the checklist. Default "কী হবে" (08); 05 uses "প্রকাশের আগে যাচাই". */
  listLabel?: string;
  /** Default "আমি বুঝেছি এটি ফেরানো যাবে না". */
  ackLabel?: string;
  /**
   * The button to gate: disabled until ticked, again on untick and reset.
   * The panel then OWNS `confirm.disabled` — if the action is unavailable for
   * another reason (this month's invoices already exist), show that reason
   * instead of a panel; do not hand it a button that must stay off.
   */
  confirm?: HTMLButtonElement;
  /** Drawn in the foot after the checkbox, least important first, primary last. */
  actions?: Child[];
  /** Every change of the box, by the person or by `reset()`. */
  onChange?: (acknowledged: boolean) => void;
  className?: string;
}

export interface IrreversiblePanel {
  root: HTMLElement;
  /** The checkbox, for focus. */
  input: HTMLInputElement;
  acknowledged(): boolean;
  /** Untick and re-disable `confirm` — after the action ran, or was abandoned. */
  reset(): void;
}

/** A row's glyph when the caller names none. */
const GLYPH: Record<IrreversibleTone, string> = {
  neutral: 'check',
  success: 'check-circle',
  info: 'info',
  warn: 'alert-triangle',
  danger: 'alert-circle',
};

export function irreversiblePanel(doc: Document, o: IrreversibleOptions): IrreversiblePanel {
  const id = uid('irrev');
  const statementId = `${id}-statement`;
  const detailId = `${id}-detail`;
  const ackId = `${id}-ack`;

  const root = el(doc, 'div', {
    className: ['irrev', o.className ?? ''].filter(Boolean).join(' '),
    attrs: {
      // A group named by its statement: a reader entering the panel hears
      // what cannot be undone before any of the rows.
      role: 'group',
      'aria-labelledby': statementId,
      'aria-describedby': o.detail ? detailId : null,
    },
  });

  const head = el(doc, 'div', { className: 'irrev-head' },
    el(doc, 'p', { className: 'irrev-statement', attrs: { id: statementId } },
      ...numText(doc, o.statement)),
    o.detail
      ? el(doc, 'p', { className: 'irrev-detail', attrs: { id: detailId } }, ...numText(doc, o.detail))
      : null);

  const list = el(doc, 'ul', { className: 'irrev-list' });
  for (const raw of o.items) {
    const item: IrreversibleItem = typeof raw === 'string' ? { text: raw } : raw;
    const tone = item.tone ?? 'neutral';
    append(list, el(doc, 'li', { className: 'irrev-item', data: { tone } },
      icon(doc, item.glyph ?? GLYPH[tone], 'ui-icon irrev-glyph'),
      el(doc, 'span', { className: 'irrev-item-text' }, ...numText(doc, item.text)),
      item.meta ? el(doc, 'span', { className: 'irrev-item-meta' }, ...numText(doc, item.meta)) : null));
  }
  const body = el(doc, 'div', { className: 'irrev-body' },
    el(doc, 'p', { className: 'label irrev-list-label' }, ...numText(doc, o.listLabel ?? 'কী হবে')),
    list);

  const input = el(doc, 'input', {
    className: 'irrev-ack-box', attrs: { type: 'checkbox', id: ackId },
  });
  // Wrapping AND `for`: the whole label is the ≥44px target, and the
  // association survives a caller that moves the input.
  const ack = el(doc, 'label', { className: 'irrev-ack', attrs: { for: ackId } },
    input,
    el(doc, 'span', { className: 'irrev-ack-text' },
      ...numText(doc, o.ackLabel ?? 'আমি বুঝেছি এটি ফেরানো যাবে না')));

  const foot = el(doc, 'div', { className: 'irrev-foot' }, ack,
    o.actions?.length ? buttonRow(doc, ...o.actions) : null);

  append(root, head, body, foot);

  const confirm = o.confirm;
  const sync = () => { if (confirm) confirm.disabled = !input.checked; };

  if (confirm) {
    // The button is read with the statement, so "প্রকাশ করুন" is never heard
    // without what it costs. Kept alongside any description it already had.
    const prior = (confirm.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    confirm.setAttribute('aria-describedby',
      [...new Set([...prior, statementId, ...(o.detail ? [detailId] : [])])].join(' '));
    // Belt and braces. `setBusy(btn, false)` sets `disabled = false`
    // unconditionally, so a screen that calls `reset()` inside an
    // `onClickBusy` action would get an enabled button over an unticked box.
    // The capture listener refuses that click; the observer puts the
    // disabled state back.
    confirm.addEventListener('click', (e) => {
      if (input.checked) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    const MO = doc.defaultView?.MutationObserver;
    if (MO) {
      new MO(() => {
        if (!input.checked && !confirm.disabled) confirm.disabled = true;
      }).observe(confirm, { attributes: true, attributeFilter: ['disabled'] });
    }
    sync();
  }

  input.addEventListener('change', () => {
    sync();
    o.onChange?.(input.checked);
  });

  return {
    root,
    input,
    acknowledged: () => input.checked,
    reset: () => {
      const was = input.checked;
      input.checked = false;
      sync();
      if (was) o.onChange?.(false);
    },
  };
}
