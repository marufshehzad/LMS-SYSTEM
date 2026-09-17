/**
 * The one element builder. (UI integration plan, P2)
 *
 * Every component in this directory is built from `el()`. It exists because
 * the alternative — which is what 59 view modules currently do — is six lines
 * of `createElement` / `className` / `textContent` / `append` per node, and at
 * that price nobody writes the seventh line that would have added the
 * `aria-label`. Making the correct thing one line long is most of what a
 * component system is for.
 *
 * Three deliberate absences:
 *
 *   1. **No `innerHTML`.** Everything here sets `textContent`. School data is
 *      user-entered — a student's name, a notice body, an institution's own
 *      title — and the one place raw markup is legitimate is our own icon set,
 *      which has its own door (`icon`, below) that no caller can pass a string
 *      through.
 *   2. **No reactivity, no vdom, no lifecycle.** The app is framework-free by
 *      decision (D1/D3) and the views own their own re-render. A component
 *      here is a function that returns a detached element; that is the whole
 *      contract, and it is the same contract `view-states.ts` has used since
 *      R-3.
 *   3. **No default `doc`.** Every builder takes the document explicitly, the
 *      way the existing helpers do, because the tests run in jsdom and the
 *      service worker has no `document` at all.
 */
import { iconSvg, hasIcon } from '../icon.ts';

/** Anything that can be appended: an element, text, or nothing. */
export type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  className?: string;
  /** Sets `textContent`. Never parsed as HTML. */
  text?: string | number;
  /** Plain attributes. `null` removes; everything else is stringified. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** `data-*` without the prefix: `{ path: 'home' }` → `data-path="home"`. */
  data?: Record<string, string | number | undefined>;
  /** Event listeners, by event name. */
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  /** Inline style properties. Used sparingly — tokens live in app.css. */
  style?: Partial<CSSStyleDeclaration>;
}

/**
 * Build an element.
 *
 * `el(d, 'button', { className: 'btn-primary', text: 'সংরক্ষণ' })`
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = String(props.text);
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [k, v] of Object.entries(props.data ?? {})) {
    if (v === undefined) continue;
    node.dataset[k] = String(v);
  }
  for (const [k, fn] of Object.entries(props.on ?? {})) {
    if (fn) node.addEventListener(k, fn as EventListener);
  }
  if (props.style) Object.assign(node.style, props.style);
  append(node, ...children);
  return node;
}

/** Append children, skipping `null` / `undefined` / `false` so callers can inline conditions. */
export function append(parent: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'object' ? c : parent.ownerDocument!.createTextNode(String(c)));
  }
}

/**
 * An icon, as a `<span>` wrapping inline SVG.
 *
 * The single place in this directory that assigns `innerHTML`, and it can only
 * ever receive markup from `icon.ts` — the `name` is a lookup key, not
 * content, so no caller can route a string through it.
 *
 * `aria-hidden` always: every control in this system is labelled in text
 * beside the glyph or by an explicit `aria-label`. An icon that needs its own
 * accessible name is a control whose label is missing.
 *
 * An unknown name is a bug, not a shrug. `iconSvg` returns a neutral dot for
 * one and says nothing about it — which is how `CARD.students` carried a
 * `search` glyph that did not exist from R-6 until P1. In a development build
 * this complains; in production it still renders the dot rather than throwing
 * a screen away over an icon.
 */
export function icon(doc: Document, name: string, className = 'ui-icon'): HTMLElement {
  if (!hasIcon(name)) {
    console.warn(`[ui] no icon named "${name}" — rendering the fallback dot`);
  }
  const span = el(doc, 'span', { className, attrs: { 'aria-hidden': 'true' } });
  span.innerHTML = iconSvg(name);
  return span;
}

/**
 * Mark a run of text as being in a different language from its container.
 *
 * 04-UIUX §5: without `lang`, a screen reader pronounces Bangla with English
 * phonemes and vice versa. The app root is `lang="bn"`, so any English string
 * that is genuinely English — a plan code, an EIIN, "CQ", an email — should be
 * wrapped rather than left to the Bangla voice.
 */
export function lang(doc: Document, code: 'bn' | 'en', text: string): HTMLElement {
  return el(doc, 'span', { text, attrs: { lang: code } });
}

/** Remove every child. Faster and safer than `innerHTML = ''`. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * A unique id, for `aria-labelledby` / `aria-describedby` / `<label for>`.
 *
 * Monotonic per document rather than random: a stable id makes a DOM snapshot
 * in a test diffable, and `Math.random()` in a render path makes every
 * re-render look like a change.
 */
let seq = 0;
export function uid(prefix = 'ui'): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** Reset the id counter. Tests only, so ids do not drift between cases. */
export function resetUid(): void {
  seq = 0;
}

/* ── numbers (Ata Ekta R6) ─────────────────────────────────────────────── */

/** A digit, Latin or Bangla. */
const DIGIT = /[0-9০-৯]/;
/**
 * One number as a reader sees it: digits with the separators that sit between
 * digits ("১২,৫০০.৭৫", "১০:৪৫", "২০২৫–২৬"), and a trailing % or + ("৯+").
 * The same shape the ui/ components mark, so a figure looks alike everywhere.
 */
const NUMBER = '[0-9০-৯]+(?:[.,:/\u2013-][0-9০-৯]+)*[%+]?';
const NUMBER_RUN = new RegExp(NUMBER, 'g');
const ONLY_NUMBER = new RegExp(`^\\s*${NUMBER}\\s*$`);

/** True when the text holds a digit (Latin or Bangla). */
export function hasDigit(text: string): boolean {
  return DIGIT.test(text);
}

/**
 * Text as children, with every number in the numeral face.
 *
 * `.n` goes on the smallest element that holds the number — a
 * `<span class="n">` around the digits — never on the whole sentence, because
 * `.n` switches typeface and would drag the words into the numeral face too.
 * Text nodes only: this is school data and is never parsed as markup, and the
 * resulting `textContent` is exactly `text`.
 *
 *   el(d, 'p', {}, ...numText(d, `${formatCount(n, 'bn')} জন উপস্থিত`))
 */
export function numText(doc: Document, text: string): Child[] {
  if (!DIGIT.test(text)) return [text];
  const out: Child[] = [];
  let at = 0;
  for (const m of text.matchAll(NUMBER_RUN)) {
    const i = m.index ?? 0;
    if (i > at) out.push(text.slice(at, i));
    out.push(el(doc, 'span', { className: 'n', text: m[0] }));
    at = i + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/**
 * The class list for an element whose WHOLE text is `text`: adds `n` when the
 * text is only a number ("৭৮৪", "৳ ৮৬,৫০০" is not — use numText for that).
 */
export function numClass(base: string, text: string): string {
  return ONLY_NUMBER.test(text) ? [base, 'n'].filter(Boolean).join(' ') : base;
}

/* ── focus that survives a re-render ───────────────────────────────────── */

/**
 * Keep keyboard focus in place while a container rebuilds itself.
 *
 * Almost every view here redraws by emptying its root and building it again
 * (`root.textContent = ''`, then `append`). That destroys the control the
 * person just used, and the browser drops focus to `<body>`: a tab strip
 * works for one arrow press, a select for one ArrowDown, and a screen reader
 * loses its place after every action. Fixing that in sixty views one at a
 * time is how it stays half fixed, so it is fixed once, here, by watching the
 * container rather than asking every view to cooperate.
 *
 * ── How ─────────────────────────────────────────────────────────────────
 * On `focusin` inside the container the focused element is described by an
 * identity that survives a rebuild, in this order:
 *   1. `data-focus-key` — the explicit door, for a view that knows best;
 *   2. its `id`, unless it looks generated by `uid()` (`f-3` becomes `f-7`
 *      on the next render and would match nothing, or the wrong thing);
 *   3. for a form field, tag + `name` (+ value for a radio or checkbox);
 *   4. `data-action`;
 *   5. tag + role + `aria-label`;
 *   6. tag + role + its trimmed text;
 * plus the closest row identity (`data-key`, `data-id`, `data-student-id`,
 * `data-node`) so "খুলুন" in row 3 goes back to row 3, and the DOM index
 * path as a last resort. The caret and selection of a text field are kept
 * current as the person types — read in the CAPTURE phase, before the
 * field's own listener can rebuild it, and read once more from the old
 * (detached) field when the rebuild is noticed. In a real browser microtasks
 * run between a keystroke's listeners, so the observer below runs after the
 * field's own `input` listener and before any bubbling listener: a caret
 * taken later than that is the previous keystroke's, and typed text comes
 * out backwards.
 *
 * A MutationObserver on the container then acts when — and only when — the
 * tracked element has left the document AND focus is on `<body>` (or
 * nowhere). It focuses the equivalent element in the new DOM
 * (`preventScroll`), restores the caret, and if nothing matches it focuses
 * the container itself (tabindex -1), never `<body>`. If a later rebuild
 * (skeleton → data) brings the control back while focus is still parked on
 * the container, focus moves on to it.
 *
 * A control that comes back DISABLED (a busy render: "পাঠানো হচ্ছে…") is
 * waited for, not parked on: focus stays where the browser put it, so a
 * view's own "focus was lost, put it back" code still sees `<body>`, and the
 * next rebuild that enables the control gets focus back. Views that check
 * for lost focus themselves should ask `focusIsLost(doc)`, which also counts
 * focus parked on a keeper's container as lost.
 *
 * ── What it never does ──────────────────────────────────────────────────
 * - Override a deliberate move: focus that went somewhere else, or a blur to
 *   the page background, is left alone.
 * - Fight an overlay: while a `.ui-scrim` is open nothing happens; when the
 *   overlay closes (overlay.ts dispatches `ui:overlay-closed` on the
 *   document) the check runs once, so a sheet whose opener was rebuilt
 *   behind it returns focus to the new opener.
 * - Open a phone keyboard nobody asked for: a text field is only ever
 *   focused when the element that lost focus was itself a text field.
 *
 * Returns a disposer. A container that switches to a DIFFERENT page (a
 * router's outlet) should dispose and call this again on each navigation, so
 * an identity from the old page is never matched against the new one.
 */
export function keepFocusWithin(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  if (!win || typeof win.MutationObserver !== 'function') return () => {};

  let tracked: Tracked | null = null;
  /** Focus was put on the container by the fallback, not by the person. */
  let parked = false;
  let parkedAt = 0;
  /** When the control came back disabled and is being waited for (0: not). */
  let heldAt = 0;
  /** Set while this function moves focus itself, so focusin ignores it. */
  let moving = false;

  const setParked = (on: boolean) => {
    parked = on;
    if (on) { parkedAt = Date.now(); PARKED.add(container); } else PARKED.delete(container);
  };
  const forget = () => { tracked = null; heldAt = 0; setParked(false); };

  const onFocusIn = (e: Event) => {
    if (moving) return;
    const t = e.target as HTMLElement | null;
    setParked(false);
    heldAt = 0;
    if (!t || t === container || !container.contains(t)) { tracked = null; return; }
    tracked = describe(container, t);
    readSelection(tracked);
  };
  const onEdit = (e: Event) => {
    if (tracked && e.target === tracked.el) readSelection(tracked);
  };
  const onFocusOut = (e: Event) => {
    const t = e.target;
    // Decided a microtask later: a removal disconnects the element within the
    // same task (and Chrome fires blur for it), a deliberate blur does not.
    queueMicrotask(() => {
      if (!tracked || !onBody(doc)) return;
      if (tracked.el === t && tracked.el.isConnected) tracked = null;
      // Focus parked on the container, then moved away by the person.
      else if (parked && t === container) forget();
    });
  };

  function focusEl(node: HTMLElement): boolean {
    moving = true;
    try { node.focus({ preventScroll: true }); } catch { /* detached or not focusable */ }
    finally { moving = false; }
    return doc.activeElement === node;
  }

  const restore = () => {
    if (!tracked) return;
    const active = doc.activeElement;
    const followUp = parked && active === container;
    if (!(onBody(doc) || followUp)) {
      // Waiting for a disabled control, and the person went somewhere else.
      if (heldAt) forget();
      return;
    }
    const now = Date.now();
    if ((followUp && now - parkedAt > PARK_MS) || (heldAt && now - heldAt > PARK_MS)) {
      forget();
      return;
    }
    if (doc.querySelector('.ui-scrim')) return;
    // The caret as the field was left — from the old field itself, detached
    // or not. A caret remembered from an earlier event can be a keystroke
    // old, and restoring that one reverses what the person types.
    readSelection(tracked);
    if (tracked.el.isConnected && container.contains(tracked.el)) {
      // Moved rather than rebuilt: the same node is still here.
      if (tracked.el === active) return;
      if (isDisabled(tracked.el)) { hold(followUp, now); return; }
      if (focusEl(tracked.el)) { writeSelection(tracked); heldAt = 0; setParked(false); return; }
    }
    // A later rebuild (skeleton → data) may only bring focus back to the SAME
    // control, never to whatever happens to sit at the old index path.
    const match = findMatch(container, tracked, followUp ? 2 : 1);
    if (match && isDisabled(match)) {
      // A busy render: the control is here but cannot take focus yet. Do not
      // park — leave focus where the browser put it, so a view's own "focus
      // was lost" repair still runs, and try again on the next rebuild.
      hold(followUp, now);
      return;
    }
    if (match && focusEl(match)) {
      const prev = tracked;
      tracked = describe(container, match);
      tracked.sel = prev.sel;
      writeSelection(tracked);
      heldAt = 0;
      setParked(false);
      return;
    }
    heldAt = 0;
    if (parked) return;
    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
    if (focusEl(container)) setParked(true);
  };
  /** Wait for a disabled control. Parked focus keeps its own clock. */
  function hold(followUp: boolean, now: number): void {
    if (!followUp && !heldAt) heldAt = now;
  }

  const observer = new win.MutationObserver(restore);
  observer.observe(container, { childList: true, subtree: true });
  container.addEventListener('focusin', onFocusIn);
  container.addEventListener('focusout', onFocusOut);
  // Capture: the caret must be read before the field's own listener rebuilds
  // it (see above). A bubbling listener runs after the observer has already
  // restored a stale caret.
  for (const ev of EDIT_EVENTS) container.addEventListener(ev, onEdit, true);
  doc.addEventListener('ui:overlay-closed', restore);
  const current = doc.activeElement as HTMLElement | null;
  if (current && current !== container && container.contains(current)) {
    tracked = describe(container, current);
  }

  return () => {
    observer.disconnect();
    container.removeEventListener('focusin', onFocusIn);
    container.removeEventListener('focusout', onFocusOut);
    for (const ev of EDIT_EVENTS) container.removeEventListener(ev, onEdit, true);
    doc.removeEventListener('ui:overlay-closed', restore);
    forget();
  };
}

/**
 * Has keyboard focus been lost? True when focus is on `<body>` or nowhere,
 * AND when a `keepFocusWithin` keeper parked it on its container because the
 * control that had it vanished. A view that repairs focus after an async
 * render ("if focus was lost, put it on the heading") must ask this, not
 * `activeElement === body`: inside the shell, lost focus waits on
 * `main#shell-view`, not on `<body>`.
 */
export function focusIsLost(doc: Document): boolean {
  const a = doc.activeElement;
  return onBody(doc) || (a !== null && PARKED.has(a));
}

interface Tracked {
  el: HTMLElement;
  tag: string;
  key: string;
  row: string | null;
  path: number[];
  text: boolean;
  sel: { start: number; end: number; dir: 'forward' | 'backward' | 'none' } | null;
}

const EDIT_EVENTS = ['input', 'keyup', 'select', 'pointerup', 'mouseup'];
/**
 * How long focus parked on the container may still follow its control back
 * in. Long enough for a slow 2G reload of the same view; short enough that a
 * timer ticking on the page an hour later cannot move anybody's focus.
 */
const PARK_MS = 30_000;
/** Looks like `uid()` output: a prefix and a counter. Not stable across renders. */
const GENERATED_ID = /^[a-z][a-z-]*-\d+$/;
const ROW_ATTRS = ['data-key', 'data-id', 'data-student-id', 'data-node'];
const FOCUS_CANDIDATE = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
  '[tabindex]', '[contenteditable="true"]', '[contenteditable=""]',
].join(',');
/** Input types that raise a phone's keyboard. */
const TEXT_TYPES = new Set([
  '', 'text', 'search', 'tel', 'url', 'email', 'password', 'number',
]);

/** Containers whose keeper has parked lost focus on them (see focusIsLost). */
const PARKED = new WeakSet<Element>();

function onBody(doc: Document): boolean {
  const a = doc.activeElement;
  return a === null || a === doc.body || a === doc.documentElement;
}

/** Cannot take focus right now: disabled itself, or inside a disabled fieldset. */
function isDisabled(node: Element): boolean {
  if ((node as HTMLButtonElement).disabled === true) return true;
  try { return node.matches(':disabled'); } catch { return false; }
}

function isTextEntry(node: Element): boolean {
  const tag = node.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return TEXT_TYPES.has((node.getAttribute('type') ?? '').toLowerCase());
  const ce = node.getAttribute('contenteditable');
  return ce === '' || ce === 'true';
}

function identity(node: HTMLElement): string {
  const tag = node.tagName.toLowerCase();
  const fk = node.getAttribute('data-focus-key');
  if (fk) return `k:${fk}`;
  if (node.id && !GENERATED_ID.test(node.id)) return `id:${node.id}`;
  const name = node.getAttribute('name');
  if (name && /^(input|select|textarea|button)$/.test(tag)) {
    const type = (node.getAttribute('type') ?? '').toLowerCase();
    const v = type === 'radio' || type === 'checkbox' ? `:${node.getAttribute('value') ?? ''}` : '';
    return `name:${tag}:${name}${v}`;
  }
  const act = node.getAttribute('data-action');
  if (act) return `act:${act}`;
  const role = node.getAttribute('role') ?? '';
  const label = node.getAttribute('aria-label');
  if (label) return `aria:${tag}:${role}:${label}`;
  const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `txt:${tag}:${role}:${text}`;
}

function rowOf(container: HTMLElement, node: HTMLElement): string | null {
  for (let n: HTMLElement | null = node; n && n !== container; n = n.parentElement) {
    for (const a of ROW_ATTRS) {
      const v = n.getAttribute(a);
      if (v !== null) return `${a}=${v}`;
    }
  }
  return null;
}

function pathOf(container: HTMLElement, node: HTMLElement): number[] {
  const path: number[] = [];
  for (let n: Element = node; n !== container; ) {
    const parent: Element | null = n.parentElement;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.children, n));
    n = parent;
  }
  return path;
}

function describe(container: HTMLElement, node: HTMLElement): Tracked {
  return {
    el: node,
    tag: node.tagName,
    key: identity(node),
    row: rowOf(container, node),
    path: pathOf(container, node),
    text: isTextEntry(node),
    sel: null,
  };
}

function readSelection(t: Tracked): void {
  const f = t.el as HTMLInputElement;
  try {
    if (typeof f.selectionStart === 'number' && typeof f.selectionEnd === 'number') {
      t.sel = { start: f.selectionStart, end: f.selectionEnd, dir: f.selectionDirection ?? 'none' };
    }
  } catch { /* input types without a selection (email, number) throw */ }
}

function writeSelection(t: Tracked): void {
  if (!t.sel || !t.text) return;
  const f = t.el as HTMLInputElement;
  try {
    const len = (f.value ?? '').length;
    f.setSelectionRange(Math.min(t.sel.start, len), Math.min(t.sel.end, len), t.sel.dir);
  } catch { /* no selection API on this type */ }
}

function sharedPrefix(a: number[], b: number[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * The element in the rebuilt DOM that stands where the tracked one stood.
 * Score: same identity in the same row (4) › same identity, no row to
 * compare (3) › same tag in the same row (2) › same tag at the same index
 * path (1). Ties go to the candidate nearest the old position, then to one
 * that is enabled.
 *
 * A DISABLED candidate is returned when it is the best one: the caller waits
 * for it rather than handing focus to a worse match or parking it. Skipping
 * it here would park focus on the container in every busy render, where a
 * view's own "focus fell to body, put it back" repair then no longer runs.
 */
function findMatch(container: HTMLElement, t: Tracked, minScore = 1): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestScore = 0;
  let bestNear = -1;
  let bestEnabled = false;
  for (const node of container.querySelectorAll<HTMLElement>(FOCUS_CANDIDATE)) {
    if (node.getAttribute('type') === 'hidden') continue;
    if (isTextEntry(node) && !t.text) continue;
    const key = identity(node);
    const row = rowOf(container, node);
    const path = pathOf(container, node);
    let score = 0;
    if (key === t.key) {
      if (t.row && row && t.row !== row) continue;   // same label, another row
      score = t.row && row === t.row ? 4 : 3;
    } else if (t.row && row === t.row && node.tagName === t.tag) {
      score = 2;
    } else if (node.tagName === t.tag && path.length === t.path.length
      && path.every((v, i) => v === t.path[i])) {
      score = 1;
    }
    if (score < minScore) continue;
    const near = sharedPrefix(path, t.path);
    const enabled = !isDisabled(node);
    if (score > bestScore || (score === bestScore && (near > bestNear
      || (near === bestNear && enabled && !bestEnabled)))) {
      best = node; bestScore = score; bestNear = near; bestEnabled = enabled;
    }
  }
  return best;
}
