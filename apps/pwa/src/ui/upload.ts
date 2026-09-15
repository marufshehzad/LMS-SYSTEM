/**
 * File input. (P2)
 *
 * Two callers exist today and they want opposite things: the CSV import wants
 * one file and a name to confirm it picked the right one; the answer-script
 * capture wants the camera, several photos, and to survive a phone that runs
 * out of memory holding them. Both are served by a real `<input type="file">`
 * with the right attributes — there is no drag-and-drop zone here, because the
 * primary device has no cursor to drag with, and a desktop-only affordance
 * that is dead on a phone is worse than a button that works on both. (Ata
 * Ekta 14 Components §03 draws a dashed "drop here" box; the sheet keeps the
 * trigger a `.btn-secondary`, so nothing on screen promises a drop that the
 * browser would answer by navigating away to the file.)
 *
 * The native input is visually hidden and driven by a real button. That is the
 * one accessible way to restyle a file input: `opacity:0` over the button
 * leaves a control a screen reader announces as "choose file, no file chosen"
 * with no label, and `display:none` on the input breaks keyboard activation
 * unless the label is wired — which is what `<label for>` below does.
 *
 * What was picked, or why it was refused, shows as a file row under the
 * trigger (14 Components §03): a file glyph, the name, an optional second
 * line, and a check or a cross. The rows live inside the same live region and
 * alert as before; only their shape changed.
 */
import { el, icon, append, clear, uid } from './dom.ts';
import { toBanglaDigits } from '../../../../packages/ui-core/src/format.ts';

export interface UploadOptions {
  label: string;
  name: string;
  /** MIME types or extensions, e.g. '.csv,text/csv' or 'image/*'. */
  accept?: string;
  multiple?: boolean;
  /** `environment` opens the rear camera directly on a phone. */
  capture?: 'environment' | 'user';
  helper?: string;
  onFiles: (files: File[]) => void;
  /** Rejects anything larger, in bytes, before the caller sees it. */
  maxBytes?: number;
  className?: string;
  /**
   * Glyph drawn in the trigger. Default 'upload'; the answer-script capture
   * can pass 'camera' (02 Teacher §05). Visual only.
   */
  glyph?: string;
}

export function fileUpload(doc: Document, o: UploadOptions): {
  root: HTMLElement;
  input: HTMLInputElement;
  reset(): void;
} {
  const id = uid('up');
  const helpId = `${id}-help`;
  const root = el(doc, 'div', {
    className: ['ui-upload', o.className ?? ''].filter(Boolean).join(' '),
  });

  const input = el(doc, 'input', {
    className: 'ui-sr-only ui-upload-input',
    attrs: {
      id, type: 'file', name: o.name,
      accept: o.accept ?? null,
      multiple: o.multiple ?? null,
      capture: o.capture ?? null,
      'aria-describedby': o.helper ? helpId : null,
    },
  });

  // `<label for>` IS the button. It is keyboard-activatable, it is announced
  // with the input's name, and it needs no JavaScript to open the picker —
  // which matters on a WebView where a synthetic .click() on a file input is
  // sometimes blocked as un-gestured.
  const trigger = el(doc, 'label', {
    className: 'btn-secondary ui-upload-trigger', attrs: { for: id },
  }, icon(doc, o.glyph ?? 'upload', 'btn-glyph'), el(doc, 'span', {}, ...withNums(doc, o.label)));

  const chosen = el(doc, 'div', {
    className: 'ui-upload-chosen', attrs: { 'aria-live': 'polite' },
  });
  const err = el(doc, 'div', {
    className: 'ui-field-error', attrs: { role: 'alert', hidden: true },
  });

  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    err.hidden = true;
    clear(err);
    clear(chosen);
    if (!files.length) return;
    if (o.maxBytes) {
      const big = files.find((f) => f.size > o.maxBytes!);
      if (big) {
        // Named and sized, because "file too large" without either sends a
        // person back to a folder of forty photos to guess which one.
        err.append(fileRow(doc, 'error', [big.name],
          `ফাইলটি অনেক বড় (${toBanglaDigits(mb(big.size))} MB)। সর্বোচ্চ ${toBanglaDigits(mb(o.maxBytes!))} MB।`));
        err.hidden = false;
        input.value = '';
        return;
      }
    }
    chosen.append(fileRow(doc, 'done', files.length === 1
      ? [files[0].name]
      : [el(doc, 'span', { className: 'n', text: toBanglaDigits(files.length) }), 'টি ফাইল নির্বাচিত']));
    o.onFiles(files);
  });

  append(root, input, trigger, chosen);
  if (o.helper) {
    append(root, el(doc, 'p', {
      className: 'ui-field-help', attrs: { id: helpId },
    }, ...withNums(doc, o.helper)));
  }
  append(root, err);

  return {
    root, input,
    reset() { input.value = ''; clear(chosen); clear(err); err.hidden = true; },
  };
}

/**
 * One file row: glyph, name (+ optional second line), and a check or a cross.
 * Both glyphs are aria-hidden (icon() sets it), so the cross is a mark, not a
 * remove button — the row is read as its words only.
 *
 * A single file name is an identifier-like token and gets `n` whole; a count
 * arrives pre-split with its own `span.n`.
 */
function fileRow(
  doc: Document, state: 'done' | 'error', name: Array<Node | string>, meta?: string,
): HTMLElement {
  const single = name.length === 1 && typeof name[0] === 'string';
  return el(doc, 'div', { className: 'ui-upload-file', data: { state } },
    icon(doc, 'file-text', 'ui-upload-file-glyph'),
    el(doc, 'span', { className: 'ui-upload-file-text' },
      el(doc, 'span', { className: single ? 'ui-upload-file-name n' : 'ui-upload-file-name' }, ...name),
      // A space between the two lines, so the alert's text does not read
      // "photos.zipফাইলটি" where a reader takes textContent verbatim.
      meta ? ' ' : null,
      meta ? el(doc, 'span', { className: 'ui-upload-file-meta' }, ...withNums(doc, meta)) : null),
    state === 'done'
      ? icon(doc, 'check', 'ui-upload-file-mark')
      : icon(doc, 'x', 'ui-upload-file-mark'));
}

/**
 * Caller text with every run of digits (Bangla or Latin, with an inner `.`
 * or `,`) wrapped in `span.n`, so the number face lands on the number and not
 * on the sentence around it. Text without a digit comes back as one string.
 */
function withNums(doc: Document, text: string): Array<Node | string> {
  const out: Array<Node | string> = [];
  let last = 0;
  for (const m of text.matchAll(/[0-9০-৯]+(?:[.,][0-9০-৯]+)*/g)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(el(doc, 'span', { className: 'n', text: m[0] }));
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const mb = (b: number): string => (b / (1024 * 1024)).toFixed(1);
