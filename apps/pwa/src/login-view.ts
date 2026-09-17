/**
 * Phone → OTP → verify login screen.
 *
 * Framework-free, built from the ui/ components (field, button, el):
 * Bangla-first copy, buttons sized to --tap-min, no client-side routing
 * concerns here — the shell decides what to show after onLoggedIn fires.
 * Drawn as 01 Shell & Auth ক প্রবেশ (Ata Ekta): one card, both widths.
 *
 * tenantId is normally already known (baked into the install link the
 * school hands out, see app.ts's ?tid= / localStorage resolution) and
 * shown read-only; the rare case of a bare install with no tenant yet is
 * covered by a fallback text field so the screen never dead-ends.
 */
import type { Auth } from './auth.ts';
import {
  applyCachedThenRefresh,
  fetchPublicBranding,
  cachedBranding,
  cachedOtpLogin,
} from './branding.ts';
import { type Branding, brandName } from '../../../packages/ui-core/src/branding.ts';
import { el, icon, append, uid, numText, numClass } from './ui/dom.ts';
import { button } from './ui/button.ts';
import { field } from './ui/field.ts';
import { bnNum } from './view-states.ts';

const PHONE_RE = /^\+8801[3-9][0-9]{8}$/;

/**
 * Fill one of the card's two message panels (01 Shell & Auth ক, the "ভুল পিন
 * · অপেক্ষা" card): a bold title line, then a quieter detail line. The first
 * Bangla sentence is the title and the rest, when there is a rest, is the
 * detail — "সংযোগে সমস্যা হয়েছে।" over "আবার চেষ্টা করুন।". A one-sentence
 * message is title only.
 *
 * Text nodes only (the message can carry a server-side word, never markup),
 * numbers in the `.n` face (R6), and the panel's textContent stays exactly the
 * message: the single space between the sentences is kept as a text node.
 */
function fillPanel(doc: Document, panel: HTMLElement, message: string): void {
  panel.textContent = '';
  const i = message.indexOf('।');
  const rest = i >= 0 ? message.slice(i + 1) : '';
  const detail = rest.trimStart();
  const title = detail ? message.slice(0, i + 1) : message;
  append(panel, el(doc, 'p', { className: 'login-panel-title' }, ...numText(doc, title)));
  if (detail) {
    append(panel,
      rest.slice(0, rest.length - detail.length),
      el(doc, 'p', { className: 'login-panel-detail' }, ...numText(doc, detail)));
  }
}

/**
 * Wireframe §5.1: a rate-limit rejection renders as a countdown, not an
 * error. The difference matters — "সংযোগে সমস্যা" tells a teacher something
 * is broken and to try a different phone; a visible timer tells them the
 * system is fine and exactly how long to wait, which is the truth.
 *
 * Exported and pure so the wording and the minute/second boundary are
 * unit-testable without a DOM.
 */
export function cooldownMessage(secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft));
  if (s >= 60) {
    const m = Math.ceil(s / 60);
    return `অনেকবার চেষ্টা হয়েছে। ${m} মিনিট পর আবার চেষ্টা করুন।`;
  }
  return `অনেকবার চেষ্টা হয়েছে। ${s} সেকেন্ড পর আবার চেষ্টা করুন।`;
}

/**
 * Whether OTP login is off, as the CLIENT currently believes.
 *
 * This used to be a hand-maintained mirror of `OTP_SENDING_ENABLED` in
 * services/identity-svc — "keep both in sync", which is a comment that only
 * ever appears above two things that will not stay in sync. Turning OTP on
 * meant editing a server file, editing this one, and rebuilding the browser
 * bundle, in that order, without forgetting either.
 *
 * R-8 makes the server the single source: `GET /api/v1/ops/brand` — the call
 * the login screen already makes before anyone types anything — now carries
 * `otpLogin`, and `branding.ts` caches the answer beside the branding.
 *
 * It is read from that cache rather than awaited, for the same reason the
 * branding is: the boot has to decide what to draw before a 2G round-trip
 * could possibly finish. A device that has never reached the server reads it
 * as OFF, which is the reading that cannot strand anybody — the
 * activation-code path works whether or not the aggregator does. Failing to
 * reach the server is not evidence that OTP works.
 *
 * Read on every call rather than captured once at module load. The cold-start
 * path in app.ts asks the server before deciding what to draw, and that answer
 * lands AFTER this module is evaluated — a snapshot taken at import time would
 * freeze a newly live school on "OTP login is temporarily off" until the
 * visitor happened to reload. A localStorage read costs nothing next to that.
 */
export function isLoginDisabled(): boolean {
  return !cachedOtpLogin();
}

export interface LoginViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  tenantId: string;
  onLoggedIn: () => void;
}

type Step = 'phone' | 'code' | 'activate';

export class LoginView {
  private readonly o: LoginViewOptions;
  private step: Step = 'phone';
  private phone = '';
  private tenantId: string;
  /**
   * The institution's identity. Starts from the local cache so the first
   * paint already carries the school's name — see branding.ts on why a
   * network round-trip before painting is the wrong trade on 2G — and is
   * replaced by the server's answer when it arrives.
   */
  private branding: Branding;
  private errorEl!: HTMLElement;
  private cooldownEl!: HTMLElement;
  private submitEl!: HTMLButtonElement;
  private busy = false;
  /** epoch ms; 0 = no cooldown. F-102 — see cooldownMessage() above. */
  private cooldownUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: LoginViewOptions) {
    this.o = options;
    this.tenantId = options.tenantId;
    this.branding = cachedBranding(this.tenantId);
    this.render();
    // Paint from cache (already done by render above), then reconcile with
    // the server. A school that changed its logo this morning sees it on
    // the next launch without the login screen ever waiting on the network.
    if (this.tenantId) {
      const { refreshed } = applyCachedThenRefresh(
        options.doc,
        this.tenantId,
        () => fetchPublicBranding(this.tenantId),
      );
      void refreshed.then((b) => {
        // Only re-render if something visible actually changed — a
        // re-render mid-typing would discard the phone number.
        if (b.nameBn !== this.branding.nameBn
          || b.nameEn !== this.branding.nameEn
          || b.logoUrl !== this.branding.logoUrl
          || b.shortName !== this.branding.shortName) {
          this.branding = b;
          this.render();
        } else {
          this.branding = b;
        }
      });
    }
  }

  /** Called by the shell when the view is torn down. Stops the tick. */
  destroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 01 Shell & Auth ক "স্বাভাবিক": one bordered card on the grey ground —
   * mark, the school's name, the step's instruction, the fields, the one
   * full-width primary with its arrow on the right, and a single quiet footer
   * line under it. The same card at both widths (13 Responsive: fluid, no
   * breakpoint of its own).
   */
  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', 'bn');

    const wrap = el(d, 'div', { className: 'login-wrap' });
    const card = el(d, 'div', { className: 'card login-card' });

    // R-1: the institution's mark, not the platform's. A school that has
    // uploaded a logo gets the logo; one that has not gets the first
    // letter of its own name in the Ata Ekta 52px accent brand square,
    // which is still ITS identity rather than "শি" for ShikhonBD.
    const institution = brandName(this.branding);

    // aria-hidden: the letter is a picture of the name, and the <h1> right
    // under it already says the name — a reader would otherwise hear "ন" and
    // then "নর্থ সিটি…".
    const mark = el(d, 'div', {
      className: 'login-brandmark', attrs: { 'aria-hidden': 'true' },
    });
    if (this.branding.logoUrl) {
      const img = d.createElement('img');
      img.className = 'login-brandlogo';
      img.src = this.branding.logoUrl;
      img.alt = '';
      mark.classList.add('has-logo');
      mark.append(img);
    } else {
      // [...institution] rather than charAt(0): Bangla is multi-byte, and
      // charAt would slice a grapheme in half and render a broken glyph.
      const letter = [...institution][0] ?? '';
      mark.className = numClass('login-brandmark', letter);
      mark.textContent = letter;
    }

    // The school's name IS the screen's one heading, and now it is visible:
    // it used to be a visually-hidden <h1> duplicating a styled <div>. The
    // design draws the name as the card's heading, so the two became one.
    const h1 = el(d, 'h1', { className: 'login-brandname' }, ...numText(d, institution));

    if (isLoginDisabled() && this.step !== 'activate') {
      // F-202. The OTP kill switch used to be a dead end; now it is a
      // detour. The aggregator negotiation blocks SMS, not the school —
      // and the school can hand out activation codes on paper.
      const notice = el(d, 'p', {
        className: 'login-sub', text: 'মোবাইল কোডে লগইন সাময়িকভাবে বন্ধ আছে।',
      });
      const enter = button(d, {
        label: 'সক্রিয়ন কোড দিয়ে প্রবেশ করুন',
        variant: 'primary',
        block: true,
        onClick: () => { this.step = 'activate'; this.render(); },
      });
      // After the label, so it sits on the right of the full-width bar.
      enter.append(icon(d, 'arrow-right', 'btn-glyph'));
      const hint = el(d, 'p', {
        className: 'login-foot login-foot-note',
        text: 'কোড পাবেন আপনার শ্রেণিশিক্ষক বা অফিস থেকে।',
      });
      card.append(mark, h1, notice, enter, hint);
      wrap.append(card);
      root.append(wrap);
      return;
    }

    const sub = el(d, 'p', { className: 'login-sub' });
    if (this.step === 'activate') {
      append(sub, ...numText(d, 'শিক্ষকের দেওয়া ৮ অক্ষরের কোডটি দিন'));
    } else if (this.step === 'phone') {
      sub.textContent = 'আপনার মোবাইল নম্বর দিন';
    } else {
      // The number is an identifier and stays exactly as typed (Latin), in
      // the numeral face; the words around it stay in the text face.
      append(sub,
        el(d, 'span', { className: 'n', text: this.phone }),
        ' নম্বরে পাঠানো কোডটি দিন');
    }

    // The design's alert panel: tinted ground, 4px bar, a bold title over a
    // quieter detail line. A <div>, because it holds those two paragraphs.
    this.errorEl = el(d, 'div', {
      className: 'login-panel login-error',
      attrs: { id: uid('login-error'), role: 'alert', hidden: true },
    });

    // Deliberately role="status", not "alert": a countdown is a wait, not a
    // failure, and it updates every second — an alert would re-announce on
    // every tick. Same panel anatomy, warn tone (§3: অপেক্ষমাণ is --warn).
    this.cooldownEl = el(d, 'div', {
      className: 'login-panel login-cooldown',
      attrs: { role: 'status', hidden: true },
    });

    // No class: the fields' own 16px rhythm is the design's spacing, and the
    // old `.login-form` flex gap would add to it.
    const form = el(d, 'form');
    form.addEventListener('submit', (e) => { e.preventDefault(); void this.onSubmit(); });

    /**
     * The step's one other way forward. It lives in the footer line under the
     * primary (the design's "পিন ভুলে গেছেন? প্রধান শিক্ষককে বলুন" slot), as a
     * ghost button, so the primary directly follows the fields.
     */
    let alt: HTMLButtonElement | null = null;

    if (!this.tenantId) {
      const t = field(d, {
        label: 'স্কুল আইডি',
        name: 'tenantId',
        onInput: (v) => { this.tenantId = v.trim(); },
      });
      // Set after creation: field() owns `autocomplete` and would drop it.
      t.input.setAttribute('autocomplete', 'off');
      form.append(t.root);
    }

    if (this.step === 'activate') {
      const f = field(d, {
        label: 'সক্রিয়ন কোড',
        name: 'activationCode',
        attrs: { maxlength: 12, autocapitalize: 'characters' },
      });
      // Uppercase letters and digits; autocapitalize helps the ten-year-old
      // typing it. NOT one-time-code — that hint summons the SMS reader,
      // and this code never arrives by SMS. The code carries digits, so it
      // is set in the numeral face like every other figure (R6).
      f.input.classList.add('n', 'is-num', 'login-code-input');
      f.input.setAttribute('autocomplete', 'off');
      form.append(f.root);

      if (!isLoginDisabled()) {
        // Only offer the way back when there IS a way back.
        alt = button(d, {
          label: 'মোবাইল নম্বরে ফিরে যান',
          variant: 'ghost',
          size: 'sm',
          onClick: () => { this.step = 'phone'; this.render(); },
        });
      }
    } else if (this.step === 'phone') {
      // kind 'tel' gives type="tel", inputmode="tel", dir="ltr" and the
      // numeral face — the same control as before, with its label wired.
      const f = field(d, {
        label: 'মোবাইল নম্বর',
        name: 'phone',
        kind: 'tel',
        placeholder: '+8801XXXXXXXXX',
        value: this.phone,
        onInput: (v) => { this.phone = v.trim(); },
      });
      f.input.setAttribute('autocomplete', 'tel');
      form.append(f.root);

      // R-7. The activation-code door, offered even when OTP works.
      //
      // It used to appear ONLY when OTP was switched off, as a fallback for
      // the missing aggregator. But an activation code is how EVERY newly
      // onboarded school gets in: the platform console hands the operator a
      // code for the head teacher, and the school issues codes to its own
      // teachers, students and guardians from the roster. With OTP enabled
      // that door vanished, so a principal holding the printed code the
      // console had just given them had no way to use it — which is R-7's
      // own exit criterion, failing on a deployment where OTP works.
      //
      // Quieter than the primary, because a person who has a phone should use
      // it; the code path is for the first login and for anyone without SMS.
      alt = button(d, {
        label: 'সক্রিয়ন কোড দিয়ে প্রবেশ করুন',
        variant: 'ghost',
        size: 'sm',
        onClick: () => {
          // `this.error = ''` was here, and there is no such field — the view
          // clears its message by hiding `errorEl`. So a person who mistyped
          // their phone number, gave up and switched to the activation code
          // carried the phone-number error onto the code screen, where it was
          // both wrong and alarming. `tsc` had been reporting this since R-7's
          // completion pass; the suite never could, because node --test strips
          // types instead of checking them.
          this.step = 'activate';
          this.errorEl.hidden = true;
          this.render();
        },
      });
    } else {
      // kind 'number' is type="text" + inputmode="numeric", as before.
      const f = field(d, { label: 'যাচাইকরণ কোড', name: 'code', kind: 'number' });
      f.input.setAttribute('autocomplete', 'one-time-code');
      form.append(f.root);

      alt = button(d, {
        label: 'নম্বর পরিবর্তন করুন',
        variant: 'ghost',
        size: 'sm',
        onClick: () => { this.step = 'phone'; this.render(); },
      });
    }

    const submit = button(d, {
      label: this.busy
        ? 'অপেক্ষা করুন…'
        : this.step === 'activate' ? 'প্রবেশ করুন'
          : this.step === 'phone' ? 'কোড পাঠান' : 'যাচাই করুন',
      variant: 'primary',
      type: 'submit',
      block: true,
      // Disabled, spinner beside the label, aria-busy — §01's busy button.
      busy: this.busy,
      className: 'login-submit',
    });
    // The arrow sits on the right of the bar; a busy bar shows the spinner
    // instead, never both.
    if (!this.busy) submit.append(icon(d, 'arrow-right', 'btn-glyph'));
    this.submitEl = submit;
    form.append(submit);

    card.append(mark, h1, sub, this.errorEl, this.cooldownEl, form);
    if (alt) card.append(el(d, 'p', { className: 'login-foot' }, alt));
    wrap.append(card);
    root.append(wrap);
    this.paintCooldown();
  }

  /**
   * Show a message in the error panel. `fieldName` is given only for the
   * client-side checks, where one field is at fault: that field takes the
   * sheet's error look (2px --danger, --danger-tint) and says so to a reader
   * (`aria-invalid`, described by the panel). Nothing is re-created, so what
   * the person typed stays in the field.
   */
  private showError(message: string, fieldName?: string): void {
    fillPanel(this.o.doc, this.errorEl, message);
    this.errorEl.hidden = false;
    if (!fieldName) return;
    const input = this.o.root.querySelector<HTMLElement>(`.ui-input[name="${fieldName}"]`);
    if (!input) return;
    input.closest('.ui-field')?.classList.add('is-error');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', this.errorEl.id);
  }

  /** Undo showError's field highlight, so the panel and the field always agree. */
  private clearFieldHighlight(): void {
    this.o.root.querySelectorAll<HTMLElement>('.ui-field.is-error').forEach((f) => {
      f.classList.remove('is-error');
      const input = f.querySelector('.ui-input');
      input?.removeAttribute('aria-invalid');
      input?.removeAttribute('aria-describedby');
    });
  }

  /**
   * Enter the F-102 cooldown. The submit button stays disabled and the
   * countdown ticks down to zero, at which point the form re-arms itself —
   * the teacher never has to guess whether it is safe to retry.
   */
  private startCooldown(seconds: number): void {
    this.cooldownUntil = Date.now() + Math.max(1, Math.ceil(seconds)) * 1000;
    this.errorEl.hidden = true;
    if (this.timer === null) {
      this.timer = setInterval(() => this.paintCooldown(), 1000);
    }
    this.paintCooldown();
  }

  private paintCooldown(): void {
    if (!this.cooldownEl) return;
    const left = (this.cooldownUntil - Date.now()) / 1000;
    if (left <= 0) {
      this.cooldownUntil = 0;
      this.cooldownEl.hidden = true;
      this.destroy();
      if (this.submitEl && !this.busy) this.submitEl.disabled = false;
      return;
    }
    // cooldownMessage() stays Latin (login-cooldown.test.ts pins it); the
    // screen counts in Bangla, each figure in the numeral face (R6).
    fillPanel(this.o.doc, this.cooldownEl, bnNum(cooldownMessage(left)));
    this.cooldownEl.hidden = false;
    if (this.submitEl) this.submitEl.disabled = true;
  }

  private async onSubmit(): Promise<void> {
    if (this.busy) return;
    if (this.cooldownUntil > Date.now()) return;
    this.errorEl.hidden = true;
    this.clearFieldHighlight();

    if (!this.tenantId) {
      this.showError('স্কুল আইডি প্রয়োজন।', 'tenantId');
      return;
    }

    if (this.step === 'activate') {
      const input = this.o.root.querySelector<HTMLInputElement>('input[name="activationCode"]');
      const code = input?.value.trim() ?? '';
      if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) {
        this.showError('৮ অক্ষরের কোডটি সম্পূর্ণ দিন।', 'activationCode');
        return;
      }
      this.busy = true;
      this.render();
      try {
        await this.o.auth.redeemActivationCode(this.tenantId, code);
        this.o.onLoggedIn();
      } catch (err) {
        this.busy = false;
        this.render();
        this.handleFailure(err);
      }
      return;
    }

    if (this.step === 'phone') {
      if (!PHONE_RE.test(this.phone)) {
        this.showError('সঠিক মোবাইল নম্বর দিন (উদাহরণ: +8801712345678)।', 'phone');
        return;
      }
      this.busy = true;
      this.render();
      try {
        await this.o.auth.requestOtp(this.tenantId, this.phone);
        this.step = 'code';
      } catch (err) {
        this.handleFailure(err);
      } finally {
        this.busy = false;
        this.render();
      }
      return;
    }

    const codeInput = this.o.root.querySelector<HTMLInputElement>('input[name="code"]');
    const code = codeInput?.value.trim() ?? '';
    if (!/^[0-9]{4,8}$/.test(code)) {
      this.showError('সঠিক কোড দিন।', 'code');
      return;
    }
    this.busy = true;
    this.render();
    try {
      await this.o.auth.verifyOtp(this.tenantId, this.phone, code);
      this.o.onLoggedIn();
    } catch (err) {
      this.busy = false;
      this.render();
      this.handleFailure(err);
    }
  }

  /**
   * A 429 becomes a countdown; everything else becomes an error line. Split
   * out so both submit paths agree — they used to differ only by accident.
   */
  private handleFailure(err: unknown): void {
    const e = err as { code?: string; retryAfterSec?: number };
    if (e?.code === 'rate_limited') {
      this.startCooldown(e.retryAfterSec && e.retryAfterSec > 0 ? e.retryAfterSec : 60);
      return;
    }
    this.showError(this.friendlyError(err));
  }

  private friendlyError(err: unknown): string {
    const code = (err as { code?: string })?.code;
    switch (code) {
      case 'otp_disabled': return 'লগইন সাময়িকভাবে বন্ধ আছে। পরে আবার চেষ্টা করুন।';
      case 'too_soon': return 'একটু আগে কোড পাঠানো হয়েছে, একটু অপেক্ষা করুন।';
      case 'invalid_code': return this.step === 'activate'
        ? 'কোডটি সঠিক নয় বা মেয়াদ শেষ — শিক্ষকের কাছে নতুন কোড চান।'
        : 'কোডটি সঠিক নয়।';
      case 'activation_unconfigured': return 'এই সুবিধাটি এখনো চালু হয়নি।';
      case 'too_many_attempts': return 'অনেকবার চেষ্টা হয়েছে — নতুন কোড চান।';
      case 'challenge_not_found': return 'কোডের মেয়াদ শেষ — আবার চেষ্টা করুন।';
      case 'user_not_found': return 'এই নম্বরে কোনো অ্যাকাউন্ট পাওয়া যায়নি।';
      case 'account_not_active': return 'অ্যাকাউন্টটি সক্রিয় নয়।';
      default: return 'সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।';
    }
  }
}
