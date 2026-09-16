/**
 * প্রতিষ্ঠানের পরিচয় — the branding editor  (R-1, docs/11-MASTER-PLAN.md)
 *
 * The screen where a school stops looking like the platform and starts
 * looking like itself. Four groups, in the order a head teacher thinks
 * about them: name, logo and marks, colours, then the contact block that
 * only ever appears on printed paper.
 *
 * ── Ata Ekta (08 Admin & IT §01) ────────────────────────────────────────
 * One panel of setting rows under the page header, then the inset
 * "ছাপার নমুনা" band. Every row is the drawn settingRow: its title, a sub
 * line saying WHERE the setting shows up, and the control — to the right at
 * 1024px and up, underneath and full width below it (13 Responsive ০৮). The
 * header carries the one primary, "সংরক্ষণ". The design draws five rows; the
 * code edits fourteen fields, so all fourteen stay, grouped under the inset
 * group rows 08 §02 draws, with the five drawn rows in their drawn order.
 *
 * ── The preview is the real thing, not a mock-up ────────────────────────
 * The letterhead panel calls brandedLetterhead() from ui-core — the SAME
 * function every future receipt, report card and admit card will call. A
 * preview built from lookalike markup would drift from the document it
 * claims to predict, and the drift would be discovered by a parent holding
 * a receipt. Here, if the preview is right the document is right, because
 * they are one function.
 *
 * ── Images are downscaled before they are ever sent ─────────────────────
 * A school will upload the 4 MB PNG its signboard designer produced. The
 * limits in ui-core are bytes-on-the-wire limits, so the useful place to
 * meet them is here, on the device, before the upload: scale the longest
 * edge down and step the quality until it fits. Refusing a logo for being
 * large teaches an IT user to go and find image-editing software; quietly
 * fitting it teaches them nothing, which is the point.
 *
 * ── Validation runs twice on purpose ────────────────────────────────────
 * parseBranding() here gives the field-level error next to the input while
 * someone is typing. The server runs the identical function again on the
 * PUT, because this copy is advice — anyone can call the API directly.
 */
import type { Auth } from './auth.ts';
import {
  type Branding,
  DEFAULT_BRANDING,
  BrandingError,
  LIMITS,
  parseBranding,
  brandName,
  meetsAaOnWhiteText,
  contrastRatio,
  onBrandFill,
} from '../../../packages/ui-core/src/branding.ts';
import { brandedLetterhead } from '../../../packages/ui-core/src/branded-doc.ts';
import { applyBranding, cacheBranding, cachedBranding } from './branding.ts';
import {
  serverMessage, pageHeader, button, setBusy, field, setFieldError, clearFieldError,
  el, append, icon, uid, numText, hasDigit, successNote, skeleton,
  type Field,
} from './ui/index.ts';
import { bnNum } from './view-states.ts';

export interface BrandingViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Tenant key used for the branding cache; defaults to auth.tenantId. */
  tenantKey?: string;
  /**
   * Whether this person may SAVE. Mirrors BRANDING_WRITERS in the endpoint.
   *
   * Not discovered from a 403: the branding GET is public — it is what the
   * login screen draws before anybody signs in — so a reader who may not write
   * still gets 200, and a screen that waited for a refusal offered a teacher
   * twelve editable fields and a save that could only fail.
   */
  canManage?: boolean;
}

type AssetField = 'logoUrl' | 'faviconUrl' | 'watermarkUrl' | 'signatureUrl';

/** Longest edge per asset. A logo is a mark, not a photograph. */
const MAX_EDGE: Record<AssetField, number> = {
  logoUrl: 320,
  faviconUrl: 192,
  watermarkUrl: 900,
  signatureUrl: 480,
};

const HEX6 = /^#[0-9a-f]{6}$/i;

const FIELD_LABELS_BN: Record<string, string> = {
  nameBn: 'প্রতিষ্ঠানের নাম',
  nameEn: 'Institution name (English)',
  shortName: 'সংক্ষিপ্ত নাম',
  logoUrl: 'লোগো',
  faviconUrl: 'ফেভিকন',
  watermarkUrl: 'ওয়াটারমার্ক',
  signatureUrl: 'প্রধান শিক্ষকের স্বাক্ষর',
  primaryColor: 'মূল রং',
  accentColor: 'সহায়ক রং',
  address: 'ঠিকানা',
  phone: 'ফোন',
  email: 'ইমেইল',
  website: 'ওয়েবসাইট',
  headmasterName: 'প্রধান শিক্ষকের নাম',
  branding: 'পরিচয়',
};

/**
 * The settingRow sub line: where the setting shows up (08 §01 — "প্রতিটি
 * সেটিংয়ের নিচে লেখা আছে সেটি কোথায় দেখা যাবে"). The drawn rows use the
 * drawn copy; the rest say only what the code that reads them does —
 * manifest-build and the SMS sender read shortName, brandedLetterhead reads
 * the contact block, brandedSignature the head teacher's name. The accent
 * colour has no single place a reader would recognise, so it has no sub line.
 */
const FIELD_HINTS_BN: Partial<Record<string, string>> = {
  nameBn: 'খোলসে, ছাপার কাগজে ও এসএমএসে এই নামটিই যাবে',
  nameEn: 'ইংরেজি ছাপা কাগজে এই নামটি বসবে',
  shortName: 'ফোনে ইনস্টল করা অ্যাপের নামে ও এসএমএসে বসবে',
  logoUrl: 'বর্গাকার · কমপক্ষে ২৫৬×২৫৬ · PNG',
  faviconUrl: 'ব্রাউজার ট্যাব ও ইনস্টল করা অ্যাপের আইকন',
  watermarkUrl: 'ছাপা কাগজের পেছনে হালকা ছাপ',
  primaryColor: 'শুধু প্রধান বোতাম ও চালু মেনুতে ব্যবহৃত হবে',
  address: 'ছাপার কাগজের শীর্ষভাগে নামের নিচে বসবে',
  phone: 'ছাপার কাগজের শীর্ষভাগে ঠিকানার নিচে বসবে',
  email: 'ছাপার কাগজের শীর্ষভাগে ঠিকানার নিচে বসবে',
  website: 'ছাপার কাগজের শীর্ষভাগে ঠিকানার নিচে বসবে',
  headmasterName: 'ছাপার নথিতে স্বাক্ষরের নিচে বসবে',
  signatureUrl: 'ছাপার নথিতে বসবে · স্বচ্ছ PNG',
};

const READ_ONLY_SUB = 'আপনি শুধু দেখতে পারবেন — পরিবর্তনের অনুমতি প্রধান শিক্ষক বা আইটি প্রশাসকের।';

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export class BrandingView {
  private readonly o: BrandingViewOptions;
  /** The saved state — what Cancel returns to. */
  private saved: Branding;
  /** The edited state — what the preview shows and Save sends. */
  private draft: Branding;
  private busy = false;
  private notice = '';
  private noticeKind: 'ok' | 'error' | 'warn' | '' = '';
  private fieldError: { field: string; message: string } | null = null;
  /**
   * The next render takes the person to the field error just raised. It fires
   * once: a later render, such as a retried load, must not pull focus back to
   * an error nobody is working on.
   */
  private focusError = false;
  private readOnly = false;
  /**
   * Nothing cached for this school and the server has not answered yet.
   * `cachedBranding` hands back the shared DEFAULT_BRANDING object itself
   * when it has nothing, so identity is the test. The platform's placeholder
   * identity, editable, is the wrong first frame — a skeleton says "coming".
   * With a cache the form renders at once, as it always has.
   */
  private loading = false;
  /** The GET failed for a reason other than being offline. */
  private loadFailed = false;

  constructor(options: BrandingViewOptions) {
    this.o = options;
    this.readOnly = options.canManage === false;
    const key = this.tenantKey();
    this.saved = cachedBranding(key);
    this.loading = this.saved === DEFAULT_BRANDING;
    this.draft = { ...this.saved };
    this.render();
    void this.load();
  }

  private tenantKey(): string {
    return this.o.tenantKey ?? this.o.auth.tenantId ?? '';
  }

  private async load(): Promise<void> {
    let outcome: 'ok' | 'denied' | 'failed' | 'offline' = 'ok';
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/branding');
      if (res.status === 403) {
        // A teacher who deep-links here sees the school's identity but no
        // controls. The server is the enforcement; this is orientation.
        this.readOnly = true;
        outcome = 'denied';
      } else if (!res.ok) {
        outcome = 'failed';
      } else {
        const body = (await res.json()) as { branding?: unknown };
        this.saved = parseBranding(body.branding, DEFAULT_BRANDING);
        this.draft = { ...this.saved };
        cacheBranding(this.tenantKey(), this.saved);
      }
    } catch {
      // Offline: the cached branding is already on screen and editable, and
      // the shell's offline banner says why. The save will fail loudly if it
      // is still offline when they press it. Any other failure is said here.
      outcome = isOffline() ? 'offline' : 'failed';
    }
    const wasLoading = this.loading;
    const wasFailed = this.loadFailed;
    this.loading = false;
    this.loadFailed = outcome === 'failed';
    // Offline with the form already up: nothing on screen changes, so do not
    // rebuild it under someone's cursor.
    if (outcome === 'offline' && !wasLoading && !wasFailed) return;
    this.render();
  }

  private dirty(): boolean {
    return (Object.keys(this.draft) as (keyof Branding)[])
      .some((k) => this.draft[k] !== this.saved[k]);
  }

  private set<K extends keyof Branding>(key: K, value: Branding[K]): void {
    this.draft[key] = value;
    this.fieldError = null;
    this.notice = '';
    this.noticeKind = '';
  }

  // ── Image handling ────────────────────────────────────────────────────

  /**
   * Downscale and encode to a data URL that fits the field's byte cap.
   *
   * PNG first because a logo with a transparent background is the common
   * case and JPEG would fill it with black. If PNG will not fit, step down
   * through WebP qualities, which handles the photographic signature scan.
   */
  private async encodeAsset(file: File, field: AssetField): Promise<string> {
    const d = this.o.doc;
    const bitmap = await createImageBitmap(file);
    const cap = LIMITS[field];
    const edge = MAX_EDGE[field];

    const draw = (scale: number): HTMLCanvasElement => {
      const canvas = d.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas;
    };

    const baseScale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));

    // Progressively smaller, and for each size PNG then WebP. The first
    // candidate under the cap wins, so a small logo stays lossless.
    for (const shrink of [1, 0.8, 0.62, 0.5, 0.38]) {
      const canvas = draw(baseScale * shrink);
      const candidates = [
        canvas.toDataURL('image/png'),
        canvas.toDataURL('image/webp', 0.88),
        canvas.toDataURL('image/webp', 0.7),
      ];
      for (const url of candidates) {
        // toDataURL falls back to PNG when a type is unsupported; a
        // candidate that is not the type we asked for is simply a
        // duplicate and the length check treats it as one.
        if (url.length <= cap) return url;
      }
    }
    throw new BrandingError(field, `${FIELD_LABELS_BN[field]} ছবিটি খুব বড় — ছোট ছবি ব্যবহার করুন।`);
  }

  private async pickAsset(field: AssetField): Promise<void> {
    const d = this.o.doc;
    const input = d.createElement('input');
    input.type = 'file';
    // Raster only, matching the ui-core allowlist. An SVG picked here
    // would be refused by the validator anyway; not offering it avoids
    // teaching someone to try.
    input.accept = 'image/png,image/jpeg,image/webp';
    const file: File | null = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.click();
    });
    if (!file) return;

    try {
      const url = await this.encodeAsset(file, field);
      this.set(field, url);
      this.render();
    } catch (err) {
      this.fieldError = {
        field,
        message: err instanceof BrandingError
          ? err.message
          : 'ছবিটি পড়া যায়নি। অন্য একটি ছবি চেষ্টা করুন।',
      };
      this.focusError = true;
      this.render();
    }
  }

  // ── Save / cancel ─────────────────────────────────────────────────────

  private async save(): Promise<void> {
    if (this.busy) return;
    this.fieldError = null;

    // Local check first: a field error belongs beside its input, and a
    // round-trip to learn the colour is malformed is a round-trip wasted.
    let candidate: Branding;
    try {
      candidate = parseBranding(this.draft, this.saved);
    } catch (err) {
      if (err instanceof BrandingError) {
        this.fieldError = { field: err.field, message: err.message };
        this.focusError = true;
        this.render();
        return;
      }
      throw err;
    }

    this.busy = true;
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branding: candidate }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        branding?: unknown; message?: string; field?: string; error?: string;
      };
      if (!res.ok) {
        if (res.status === 403) {
          this.notice = 'পরিচয় পরিবর্তনের অনুমতি আপনার নেই।';
          this.noticeKind = 'error';
        } else if (body.field) {
          this.fieldError = { field: body.field, message: body.message ?? 'মানটি সঠিক নয়।' };
          this.focusError = true;
        } else {
          this.notice = serverMessage(body, res.status, 'সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।', 'প্রতিষ্ঠানের পরিচয়');
          this.noticeKind = 'error';
        }
        return;
      }
      // The server's answer, not the draft, becomes the saved state — it
      // has been through normalisation (#ABC → #aabbcc) and the client
      // must not keep believing in a value the database does not hold.
      this.saved = parseBranding(body.branding, DEFAULT_BRANDING);
      this.draft = { ...this.saved };
      this.loadFailed = false;
      cacheBranding(this.tenantKey(), this.saved);
      // Repaint the whole app immediately: the point of this screen is
      // that the change is visible, and making someone reload to see their
      // own logo would undercut it.
      applyBranding(this.o.doc, this.saved, { tenantKey: this.tenantKey() });
      this.notice = 'সংরক্ষিত হয়েছে।';
      this.noticeKind = 'ok';
    } catch {
      // Offline is a caution, not an error (Foundations §04): the draft is
      // intact and the same button saves it once the connection is back.
      this.notice = 'সংযোগ নেই — সংরক্ষণ করা যায়নি।';
      this.noticeKind = 'warn';
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private cancel(): void {
    this.draft = { ...this.saved };
    this.fieldError = null;
    this.notice = 'পরিবর্তন বাতিল করা হয়েছে।';
    this.noticeKind = 'ok';
    this.render();
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /** Replace a node's text with the same text, its numbers in the `.n` face (R6). */
  private numFill(node: HTMLElement, text = node.textContent ?? ''): void {
    if (!hasDigit(text)) { node.textContent = text; return; }
    node.textContent = '';
    append(node, ...numText(this.o.doc, text));
  }

  /** The inset group row (08 §02 "নোটিশ ও এসএমএস"). */
  private group(parent: HTMLElement, titleBn: string): void {
    parent.append(el(this.o.doc, 'h2', { className: 'brand-group', text: titleBn }));
  }

  /** The settingRow's left column: title, then where the setting shows up. */
  private rowText(titleId: string, title: string, sub?: string): HTMLElement {
    const d = this.o.doc;
    const text = el(d, 'div', { className: 'brand-row-text' },
      el(d, 'p', { className: 'brand-row-title', attrs: { id: titleId } }, ...numText(d, title)));
    if (sub) append(text, el(d, 'p', { className: 'brand-row-sub' }, ...numText(d, sub)));
    return text;
  }

  /**
   * Put a field() into the settingRow shape: its label and helper move into
   * one text column ahead of the control, so the row reads title → where it
   * shows up → control in the DOM as well as on screen (13 Responsive ০৮
   * stacks them in exactly that order). Nothing is re-created — `label[for]`,
   * `aria-describedby` and the error node are the ones field() wired.
   */
  private shapeRow(f: Field): void {
    const label = f.root.querySelector('.ui-field-label');
    const help = f.root.querySelector('.ui-field-help');
    f.root.prepend(el(this.o.doc, 'div', { className: 'brand-row-text' }, label, help));
    f.root.querySelector('.ui-field-error')?.setAttribute('role', 'alert');
  }

  private textField(
    parent: HTMLElement,
    key: keyof Branding,
    opts: { kind?: 'text' | 'textarea' | 'tel' | 'email'; placeholder?: string } = {},
  ): void {
    const f = field(this.o.doc, {
      label: FIELD_LABELS_BN[key] ?? key,
      name: key,
      kind: opts.kind ?? 'text',
      value: String(this.draft[key] ?? ''),
      helper: FIELD_HINTS_BN[key],
      placeholder: opts.placeholder,
      disabled: this.readOnly,
      className: 'brand-row',
      onInput: (value) => {
        this.draft[key] = value as Branding[typeof key];
        this.fieldError = null;
        this.paintPreview();
        this.syncControls();
      },
    });
    this.shapeRow(f);
    f.root.dataset.brandField = key;
    if (this.fieldError?.field === key) setFieldError(f.root, this.fieldError.message);
    parent.append(f.root);
  }

  private colorField(parent: HTMLElement, key: 'primaryColor' | 'accentColor'): void {
    const d = this.o.doc;
    const label = FIELD_LABELS_BN[key];

    // The native picker, drawn as the design's selected swatch.
    const picker = el(d, 'input', {
      className: 'brand-color-swatch',
      attrs: { type: 'color', 'aria-label': `${label} বাছুন`, disabled: this.readOnly },
    });
    picker.value = HEX6.test(this.draft[key]) ? this.draft[key] : '#000000';

    const sync = (value: string, alsoSet: HTMLInputElement) => {
      this.draft[key] = value;
      if (HEX6.test(value)) alsoSet.value = value;
      this.fieldError = null;
      this.paintPreview();
      this.syncControls();
    };

    const f = field(d, {
      label,
      name: key,
      kind: 'text',
      value: this.draft[key],
      helper: FIELD_HINTS_BN[key],
      disabled: this.readOnly,
      className: 'brand-row brand-color-row',
      onInput: (value) => sync(value.trim(), picker),
    });
    const hex = f.input as HTMLInputElement;
    // A colour code is an identifier: Latin, in the numeral face (R6).
    hex.classList.add('brand-color-hex', 'n', 'is-num');
    picker.addEventListener('input', () => {
      clearFieldError(f.root);
      sync(picker.value, hex);
    });
    f.root.querySelector('.ui-field-control')?.prepend(picker);
    this.shapeRow(f);
    f.root.dataset.brandField = key;
    if (this.fieldError?.field === key) setFieldError(f.root, this.fieldError.message);

    // Contrast warning. A brand colour that cannot carry white text turns
    // every primary button in the product into unreadable text at once —
    // the single highest-blast-radius mistake this screen can make.
    //
    // The element always exists and is toggled by syncControls(), because
    // typing must not trigger a re-render (that would move focus out of
    // the input mid-keystroke) and a warning that only appears after a
    // save is a warning that arrives too late to be advice.
    if (key === 'primaryColor') {
      f.root.append(el(d, 'p', {
        className: 'brand-warn',
        attrs: { role: 'status', 'data-warn-for': key, hidden: true },
      }));
    }
    parent.append(f.root);
  }

  /**
   * Refresh the controls that depend on the draft but must not trigger a
   * re-render: the Save/Cancel enabled state and the contrast advice.
   *
   * render() rebuilds the form, which is correct on load and after a save
   * and wrong on every keystroke — the input being typed into would lose
   * focus and the caret would jump to the end.
   */
  private syncControls(): void {
    const root = this.o.root;

    const buttons = root.querySelectorAll<HTMLButtonElement>('button.brand-action');
    const dirty = this.dirty();
    for (const b of buttons) b.disabled = this.busy || !dirty;

    const warn = root.querySelector<HTMLElement>('[data-warn-for="primaryColor"]');
    if (!warn) return;
    const c = this.draft.primaryColor;
    if (HEX6.test(c) && !meetsAaOnWhiteText(c)) {
      this.numFill(warn,
        `এই রঙে সাদা লেখা পড়া কঠিন (কনট্রাস্ট ${bnNum(contrastRatio(c, '#ffffff').toFixed(1))}:১, `
        + 'প্রয়োজন ৪.৫:১)। গাঢ় রং বেছে নিন।');
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }

  private assetField(parent: HTMLElement, key: AssetField): void {
    const d = this.o.doc;
    const titleId = uid('brand');
    const value = this.draft[key];
    const error = this.fieldError?.field === key ? this.fieldError.message : '';
    const errId = error ? uid('brand-err') : '';
    // The buttons are this row's controls, so they carry the error in their
    // description, the way setFieldError wires an input's.
    const describedBy = [titleId, errId].filter(Boolean).join(' ');
    const row = el(d, 'div', { className: 'brand-row brand-asset-row', data: { brandField: key } },
      this.rowText(titleId, FIELD_LABELS_BN[key], FIELD_HINTS_BN[key]));

    const control = el(d, 'div', { className: 'brand-row-control' });
    if (key === 'logoUrl') {
      // The logo row always shows the mark: the image, or the initial on the
      // draft's own colour — what the shell and the login screen will draw.
      control.append(this.logoMark(this.safeDraft()));
    } else if (value) {
      control.append(el(d, 'span', { className: 'brand-thumb has-img' },
        el(d, 'img', { attrs: { src: value, alt: '' } })));
    } else if (this.readOnly) {
      control.append(el(d, 'span', { className: 'brand-asset-empty', text: 'নেই' }));
    }
    if (!this.readOnly) {
      control.append(button(d, {
        label: value ? 'বদলান' : 'আপলোড',
        variant: 'secondary',
        size: 'sm',
        attrs: { 'aria-describedby': describedBy },
        onClick: () => { void this.pickAsset(key); },
      }));
      if (value) {
        control.append(button(d, {
          label: 'সরান',
          variant: 'ghost',
          size: 'sm',
          attrs: { 'aria-describedby': describedBy },
          onClick: () => { this.set(key, ''); this.render(); },
        }));
      }
    }
    row.append(control);

    if (error) {
      // tabindex -1: the focus target of last resort when the row has no
      // enabled button to take the person to (see revealFieldError).
      row.append(el(d, 'p', {
        className: 'ui-field-error',
        attrs: { id: errId, role: 'alert', tabindex: '-1' },
      }, ...numText(d, error)));
    }
    parent.append(row);
  }

  /**
   * "ছাপার কাগজের শীর্ষভাগ" — the drawn row whose "দেখুন" shows the
   * letterhead. The letterhead is not a field of its own (it is built from
   * the name, logo and contact rows), so the button brings the live sample
   * below into view and moves focus to it. Nothing is fetched or opened.
   */
  private letterheadRow(parent: HTMLElement, sample: HTMLElement): void {
    const d = this.o.doc;
    const titleId = uid('brand');
    parent.append(el(d, 'div', { className: 'brand-row' },
      this.rowText(titleId, 'ছাপার কাগজের শীর্ষভাগ', 'প্রগতি পত্র, রসিদ ও প্রবেশপত্রের উপরে বসবে'),
      el(d, 'div', { className: 'brand-row-control' },
        button(d, {
          label: 'দেখুন',
          variant: 'secondary',
          size: 'sm',
          attrs: { 'aria-describedby': titleId },
          onClick: () => sample.focus(),
        }))));
  }

  /** The draft as it can safely be drawn: a half-typed colour must not throw. */
  private safeDraft(): Branding {
    try {
      return parseBranding(this.draft, this.saved);
    } catch {
      return this.saved;
    }
  }

  /** The 44px mark in the logo row: the logo, or the initial on the brand fill. */
  private logoMark(safe: Branding): HTMLElement {
    const d = this.o.doc;
    const mark = el(d, 'span', {
      className: safe.logoUrl ? 'brand-thumb has-img' : 'brand-thumb is-mark',
      attrs: { 'data-brand-mark': '', 'aria-hidden': 'true' },
    });
    if (safe.logoUrl) {
      mark.append(el(d, 'img', { attrs: { src: safe.logoUrl, alt: '' } }));
    } else {
      mark.style.setProperty('--preview-primary', safe.primaryColor);
      // The label colour the app itself will put on this fill.
      mark.style.setProperty('--preview-on-primary', onBrandFill(safe.primaryColor));
      this.numFill(mark, [...brandName(safe)][0] ?? '');
    }
    return mark;
  }

  /**
   * Repaint only the sample and the logo mark. Called on every keystroke, so
   * it must not rebuild the form — doing that would move focus out of the
   * input being typed into after each character.
   */
  private paintPreview(): void {
    const safe = this.safeDraft();
    const host = this.o.root.querySelector<HTMLElement>('[data-brand-preview]');
    if (host) {
      host.textContent = '';
      host.append(this.previewContent(safe));
    }
    this.o.root.querySelector('[data-brand-mark]')?.replaceWith(this.logoMark(safe));
  }

  private previewContent(safe: Branding): HTMLElement {
    const d = this.o.doc;

    // The letterhead, rendered by the SAME function the documents use.
    const paper = el(d, 'div', { className: 'brand-preview-paper' });
    paper.innerHTML = brandedLetterhead(safe);
    // brandedLetterhead heads a printed page with <h1>; inside this screen
    // that would be a second h1 beside the page title. Same class, same
    // text — the heading level is the only thing that changes.
    const org = paper.querySelector('h1.doc-org');
    if (org) org.replaceWith(el(d, 'p', { className: 'doc-org', text: org.textContent ?? '' }));
    for (const node of paper.querySelectorAll<HTMLElement>('.doc-org, .doc-addr, .doc-contact')) {
      this.numFill(node);
    }
    if (safe.watermarkUrl) {
      const wm = el(d, 'div', { className: 'brand-preview-watermark' });
      wm.style.backgroundImage = `url("${safe.watermarkUrl}")`;
      paper.prepend(wm);
    }
    const sigRow = el(d, 'div', { className: 'brand-preview-sig' });
    if (safe.signatureUrl) {
      sigRow.append(el(d, 'img', { attrs: { src: safe.signatureUrl, alt: '' } }));
    }
    const sigName = el(d, 'div', { className: 'brand-preview-signame' });
    this.numFill(sigName, safe.headmasterName || '—');
    sigRow.append(sigName);
    paper.append(sigRow);
    return paper;
  }

  /** A save or load that did not go through: an inline strip, words beside the tone. */
  private noticeStrip(tone: 'danger' | 'warn', text: string, action?: HTMLElement): HTMLElement {
    const d = this.o.doc;
    return el(d, 'div', { className: 'brand-notice', data: { tone } },
      icon(d, tone === 'warn' ? 'wifi-off' : 'alert-circle', 'ui-icon brand-notice-glyph'),
      el(d, 'p', { className: 'brand-notice-text', attrs: { role: 'alert' } }, ...numText(d, text)),
      action);
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    const dirty = this.dirty();
    const editable = !this.readOnly && !this.loading;
    const focusError = this.focusError;
    this.focusError = false;

    // The bar: the title and the one primary. "বাতিল" is not drawn but is
    // what returns the draft to the saved state, so it stays, secondary.
    root.append(pageHeader(d, {
      title: 'প্রতিষ্ঠানের পরিচয়',
      subtitle: this.readOnly ? READ_ONLY_SUB : undefined,
      className: 'brand-header',
      actions: editable
        ? [button(d, {
          label: 'বাতিল',
          variant: 'secondary',
          size: 'sm',
          className: 'brand-action',
          disabled: this.busy || !dirty,
          onClick: () => this.cancel(),
        })]
        : undefined,
      primary: editable
        ? button(d, {
          label: this.busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ',
          variant: 'primary',
          size: 'sm',
          className: 'brand-action',
          busy: this.busy,
          disabled: this.busy || !dirty,
          onClick: () => { void this.save(); },
        })
        : undefined,
    }));

    if (this.loadFailed) {
      const retry = button(d, {
        label: 'আবার চেষ্টা করুন',
        variant: 'ghost',
        size: 'sm',
        className: 'brand-notice-action',
        onClick: () => { setBusy(retry, true); void this.load(); },
      });
      root.append(this.noticeStrip('danger', 'প্রতিষ্ঠানের পরিচয় আনা গেল না।', retry));
    }
    if (this.notice) {
      if (this.noticeKind === 'ok') {
        const note = successNote(d, this.notice);
        note.setAttribute('role', 'status');
        root.append(note);
      } else {
        root.append(this.noticeStrip(this.noticeKind === 'warn' ? 'warn' : 'danger', this.notice));
      }
    }

    const panel = el(d, 'section', { className: 'brand-panel' });
    root.append(panel);
    if (this.loading) {
      panel.append(skeleton(d, 6));
      return;
    }

    // The sample is built first so the letterhead row can point at it.
    const sampleId = uid('brand-sample');
    const host = el(d, 'div', { attrs: { 'data-brand-preview': '' } }, this.previewContent(this.safeDraft()));
    const sample = el(d, 'div', {
      className: 'brand-sample',
      attrs: { tabindex: '-1', role: 'group', 'aria-labelledby': sampleId },
    },
    el(d, 'h2', { className: 'brand-sample-label', text: 'ছাপার নমুনা', attrs: { id: sampleId } }),
    host);

    const rows = el(d, 'div', { className: 'brand-rows' });

    this.group(rows, 'নাম');
    this.textField(rows, 'nameBn');
    this.textField(rows, 'nameEn');
    this.textField(rows, 'shortName', { placeholder: 'ছোট জায়গার জন্য' });

    this.group(rows, 'লোগো ও ছবি');
    this.assetField(rows, 'logoUrl');
    this.assetField(rows, 'faviconUrl');
    this.assetField(rows, 'watermarkUrl');

    this.group(rows, 'রং');
    this.colorField(rows, 'primaryColor');
    this.colorField(rows, 'accentColor');

    // The drawn order continues: the letterhead row, then the paper-only
    // contact block, and the signature last, as the design ends.
    this.group(rows, 'যোগাযোগ ও স্বাক্ষর');
    this.letterheadRow(rows, sample);
    this.textField(rows, 'address', { kind: 'textarea' });
    this.textField(rows, 'phone', { kind: 'tel', placeholder: '+8801XXXXXXXXX' });
    this.textField(rows, 'email', { kind: 'email' });
    this.textField(rows, 'website', { placeholder: 'https://…' });
    this.textField(rows, 'headmasterName');
    this.assetField(rows, 'signatureUrl');

    panel.append(rows, sample);
    // The contrast advice is toggled rather than conditionally built, so
    // it has to be evaluated once after every full render too.
    this.syncControls();

    const errorRow = this.fieldErrorRow(rows);
    // A field error with no row of its own (the whole object refused, or a
    // key this screen does not edit) is still said, beside the header's
    // "সংরক্ষণ" that raised it, so a save never ends in silence.
    if (this.fieldError && !errorRow) {
      panel.before(this.noticeStrip('danger', this.fieldError.message));
    }
    if (focusError && errorRow) this.revealFieldError(errorRow);
  }

  /** The row that shows the current field error, if this screen has one. */
  private fieldErrorRow(rows: HTMLElement): HTMLElement | null {
    const key = this.fieldError?.field;
    if (!key) return null;
    // Matched by dataset, not by a selector built from the key: the key can
    // come from the server's response body.
    return [...rows.querySelectorAll<HTMLElement>('[data-brand-field]')]
      .find((n) => n.dataset.brandField === key) ?? null;
  }

  /**
   * Take the person to the field error just raised.
   *
   * The one "সংরক্ষণ" is in the page header, and most errors belong to rows
   * far below it: the contact block, the colours. Without this, pressing save
   * on a long form showed nothing on screen and left focus on the body, so
   * the save looked dead. It does what ui/field.ts reportErrors() does: focus
   * the failing control. An asset row has no input, so its focus goes to the
   * row's first button, whose description now carries the error. The row is
   * centred first, so the message under the control is in view as well as
   * the control.
   */
  private revealFieldError(row: HTMLElement): void {
    if (!this.o.root.isConnected) return;
    const target = row.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?? row.querySelector<HTMLElement>('button:not([disabled])')
      ?? row.querySelector<HTMLElement>('.ui-field-error');
    const canScroll = typeof row.scrollIntoView === 'function';
    if (canScroll) row.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: canScroll });
  }
}
