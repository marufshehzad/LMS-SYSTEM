/**
 * সেটিংস — the school's operational settings, grouped  (R-3 Part J · R-9 · P5)
 *
 * The screen that closes the gap which produced D13. R-2's finalisation made
 * the notice-SMS length tenant-configurable, tested it six ways and documented
 * it in three files, and left no way to set it except hand-written SQL against
 * production. A setting only a developer can reach is a setting the school
 * does not have.
 *
 * ── P5: an information architecture, not a form ────────────────────────────
 *
 * The brief asks for settings "grouped logically" and explicitly not for "a
 * giant uncontrolled form". The page is two groups with one job each:
 *
 *   ১. নোটিশ ও এসএমএস  — the two settings THIS endpoint owns, each with its
 *                       own save, its own validation and its own result.
 *   ২. অন্যান্য সেটিংস — the settings that exist but live on their own
 *                       screens. Named rather than duplicated: branding,
 *                       calendar and academic structure are each a screen
 *                       because each has content, and a settings page that
 *                       re-implemented them would be a second place to change
 *                       the same row.
 *
 * A settings hub that lists nothing but two SMS fields tells a head teacher
 * their school has two settings. It has more; they are elsewhere; saying so
 * is the whole value of the group.
 *
 * ── Ata Ekta (08 Admin & IT §02, 13 Responsive rule ০৮) ────────────────
 * One white panel under the page title. Each group is a full-bleed strip, and
 * each setting is a row: title and sub on the left, the control on the right
 * at desktop; on a phone the control drops under the words at full width. The
 * one primary, "সংরক্ষণ", sits in the page header and submits the SMS-length
 * form through its `form` attribute — the push switch still saves the moment
 * it is flipped, as it always has.
 *
 * ── The limits come from the server ────────────────────────────────────
 * min, max, default and the segment size all arrive in the GET response
 * rather than being constants here. The same numbers are already the sender's
 * clamp (sms-svc's `noticeSmsMaxChars`), and a second copy in the browser
 * would eventually disagree — in the direction that costs the school money,
 * because the disagreement only shows up when somebody raises the cap.
 *
 * ── The cost is shown in segments, not characters ──────────────────────
 * "৪৮০ অক্ষর" means nothing to the person paying. "৭টি এসএমএস — প্রতি
 * অভিভাবকে ৭ গুণ খরচ" is the same fact in the unit the bill arrives in.
 * Bangla forces UCS-2, so a segment is 70 characters and not 160 — which is
 * exactly why this warning matters more here than it would in an English
 * product.
 */
import type { Auth } from './auth.ts';
import { skeleton, errorState, successNote, bnNum } from './view-states.ts';
import {
  pageHeader, sectionHeading, button, field, setFieldError, clearFieldError,
  permissionState, serverMessage, statusBadge, list, listItem, confirmOverlay,
  el, append, numText, type Field,
} from './ui/index.ts';
import { isDenied } from './http-status.ts';
import { parseUserNumber } from '../../../packages/ui-core/src/format.ts';

interface SmsSettings {
  noticeMaxChars: number;
  default: number;
  min: number;
  max: number;
  charsPerSegment: number;
}

/** R-9. Whether a delivered push may cancel the SMS for the same message. */
interface PushSettings {
  replacesSms: boolean;
  /** Does the DEPLOYMENT have VAPID keys? The toggle is inert without them. */
  available: boolean;
}

export interface AdminSettingsViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Advisory only — the server is the gate. Controls whether the form renders. */
  canManage: boolean;
  /** Navigate. Used by the "settings that live elsewhere" group. */
  go?: (path: string) => void;
}

/**
 * The settings this product has that are NOT in `/ops/settings`.
 *
 * Listed, never re-implemented. Each is a screen because each has content;
 * a copy of its controls here would be a second place to change one row.
 */
const ELSEWHERE: Array<{ path: string; titleBn: string; whatBn: string }> = [
  { path: 'branding', titleBn: 'প্রতিষ্ঠানের পরিচয়',
    whatBn: 'নাম, লোগো, রং ও ছাপা কাগজের শীর্ষভাগ' },
  { path: 'calendar', titleBn: 'শিক্ষাপঞ্জি',
    whatBn: 'ছুটি, পরীক্ষা, অনুষ্ঠান ও কর্মদিবসের সাপ্তাহিক ছুটি' },
  { path: 'academic', titleBn: 'একাডেমিক কাঠামো',
    whatBn: 'শিক্ষাবর্ষ, শ্রেণি, বিভাগ ও সেকশন' },
  { path: 'users', titleBn: 'ব্যবহারকারী ও ভূমিকা',
    whatBn: 'কে কী দেখতে ও করতে পারবেন' },
];

/** The SMS-length form's id, so the header's save can submit it from outside. */
const SMS_FORM_ID = 'sms-settings-form';

export class AdminSettingsView {
  private readonly o: AdminSettingsViewOptions;
  private sms: SmsSettings | null = null;
  private push: PushSettings | null = null;
  private draft = 0;
  private loading = true;
  private error = '';
  private denied = false;
  private notice = '';
  private busy = false;
  /** The header primary, built by smsRow() and placed by render(). */
  private saveBtn: HTMLButtonElement | null = null;

  constructor(options: AdminSettingsViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.error = ''; this.denied = false; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/settings');
      if (isDenied(res)) { this.denied = true; return; }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { sms: SmsSettings; push?: PushSettings };
      this.sms = body.sms;
      this.push = body.push ?? null;
      this.draft = body.sms.noticeMaxChars;
    } catch {
      this.error = 'সেটিংস আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false; this.render();
    }
  }

  private async save(): Promise<void> {
    this.busy = true; this.error = ''; this.notice = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sms: { noticeMaxChars: this.draft } }),
      });
      const body = await res.json() as { sms?: SmsSettings; push?: PushSettings; message?: string };
      if (!res.ok) {
        this.error = serverMessage(body, res.status, 'সংরক্ষণ করা যায়নি।', 'সেটিংস');
        return;
      }
      this.sms = body.sms ?? this.sms;
      this.push = body.push ?? this.push;
      if (body.sms) this.draft = body.sms.noticeMaxChars;
      this.notice = `সংরক্ষিত — নোটিশ এসএমএস সর্বোচ্চ ${bnNum(this.draft)} অক্ষর।`;
    } catch {
      this.error = 'সংযোগ নেই — সংরক্ষণ করা যায়নি।';
    } finally {
      this.busy = false; this.render();
    }
  }

  private segments(chars: number): number {
    const per = this.sms?.charsPerSegment ?? 70;
    return Math.max(1, Math.ceil(chars / per));
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // The panel is built first because it owns the header's primary: the
    // save button submits the SMS form, so it exists only when that form does.
    this.saveBtn = null;
    const panel = !this.denied && !this.loading && this.sms ? this.panel() : null;

    root.append(pageHeader(d, {
      title: 'সেটিংস',
      primary: this.saveBtn ?? undefined,
    }));

    // A refusal is the whole answer: rendering the groups underneath would
    // say "you may not see this" and then show it.
    if (this.denied) {
      root.append(permissionState(d, {
        message: 'সেটিংস দেখার অনুমতি আপনার নেই।',
        contact: 'প্রধান শিক্ষক, প্রতিষ্ঠান মালিক, আইটি অ্যাডমিন ও একাডেমিক সমন্বয়ক',
      }));
      return;
    }

    if (this.notice) root.append(successNote(d, this.notice));
    if (this.error) root.append(errorState(d, this.error, () => void this.load()));
    if (this.loading) { root.append(skeleton(d, 3)); return; }
    if (panel) root.append(panel);
  }

  /** The one settings surface: group strips and setting rows, full bleed. */
  private panel(): HTMLElement {
    const d = this.o.doc;
    const panel = el(d, 'section', { className: 'set-panel' });
    append(panel,
      // Once, at the top — it applies to every control below it.
      this.readOnlyNote(),
      sectionHeading(d, { title: 'নোটিশ ও এসএমএস', className: 'set-group' }),
      this.smsRow(),
      this.pushRow(),
      sectionHeading(d, { title: 'অন্যান্য সেটিংস', className: 'set-group' }),
      ...this.elsewhereRows(),
    );
    return panel;
  }

  /** Read-only note, in the canonical wording, or nothing. */
  private readOnlyNote(): HTMLElement | null {
    if (this.o.canManage) return null;
    const d = this.o.doc;
    return el(d, 'p', {
      className: 'set-panel-note',
      // Names all four roles the endpoint allows — the old sentence said
      // "প্রধান শিক্ষক ও আইটি অ্যাডমিন" and left out the owner and the
      // coordinator, both of whom may in fact change this.
      text: 'আপনি শুধু দেখতে পারবেন — পরিবর্তনের অনুমতি প্রধান শিক্ষক, প্রতিষ্ঠান মালিক, ' +
            'আইটি অ্যাডমিন ও একাডেমিক সমন্বয়কের।',
    });
  }

  // ── group ১a: the notice-SMS length ──────────────────────────────────
  private smsRow(): HTMLElement {
    const d = this.o.doc;
    const sms = this.sms as SmsSettings;
    const form = el(d, 'form', { className: 'set-row', attrs: { id: SMS_FORM_ID } });

    // Declared before the field so it can ride in the field's control slot,
    // beside the input it resets. `sync` is assigned below, before any click.
    const reset = button(d, {
      label: `প্রস্তাবিত (${bnNum(sms.default)})`, variant: 'secondary', size: 'sm',
      disabled: !this.o.canManage,
      // Written back in Bangla digits, like the label it sits beside (R6).
      onClick: () => { (chars.input as HTMLInputElement).value = bnNum(sms.default); sync(); },
    });

    // The field's label is the row title and its helper the row sub (08 §02
    // settingRow), so the label, helper and error keep their association.
    const chars: Field = field(d, {
      label: 'এসএমএসের সর্বোচ্চ দৈর্ঘ্য',
      name: 'noticeMaxChars',
      kind: 'number',
      // A count of letters, not an identifier: Bangla digits, as in the
      // helper and the reset label beside it (R6). Read back with
      // parseUserNumber, so either numeral system is accepted.
      value: bnNum(this.draft),
      disabled: !this.o.canManage,
      helper: `বাংলায় ${bnNum(sms.charsPerSegment)} অক্ষরে একটি এসএমএস — এর বেশি হলে খরচ দ্বিগুণ। ` +
              `প্রস্তাবিত ${bnNum(sms.default)} · সর্বনিম্ন ${bnNum(sms.min)} · ` +
              `সর্বোচ্চ ${bnNum(sms.max)}`,
      attrs: { min: sms.min, max: sms.max, step: 1 },
      suffix: reset,
    });
    append(form, chars.root);

    // aria-live so a screen-reader user hears the cost change as they type,
    // which is the entire point of showing it live.
    const cost = el(d, 'p', {
      className: 'set-row-note', attrs: { 'aria-live': 'polite', id: 'sms-cost-note' },
    });
    const warn = el(d, 'p', { className: 'inline-notice' });
    warn.hidden = true;
    append(form, cost, warn);

    append(form, el(d, 'p', {
      className: 'set-row-note',
      text: 'এসএমএসে সংক্ষিপ্ত বার্তা যাবে; পুরো নোটিশ সবসময় অ্যাপে থাকবে। ' +
            'প্রতিটি এসএমএসে প্রতিষ্ঠানের নাম থাকবে।',
    }));

    // The page's one primary. It lives in the header (08 §02 bar) and reaches
    // this form through `form=`, so Enter in the field and a click on it are
    // still the same submit.
    const saveBtn = button(d, {
      label: 'সংরক্ষণ', variant: 'primary', type: 'submit', size: 'sm',
      busy: this.busy, disabled: !this.o.canManage,
      attrs: { form: SMS_FORM_ID },
    });
    this.saveBtn = saveBtn;

    /** Refill a line with its numbers in the numeral face (R6). */
    const say = (node: HTMLElement, text: string): void => {
      node.textContent = '';
      append(node, ...numText(d, text));
    };

    /**
     * The typed value, in either numeral system. Not `Number()`: the helper
     * states the range in Bangla digits, so "২৪০" from a Bangla keyboard is the
     * expected entry, and `Number('২৪০')` is NaN — which silently disabled
     * save and priced the default instead of what was typed.
     */
    const typed = (): number | null => parseUserNumber(chars.value());
    const inRange = (n: number | null): n is number =>
      n !== null && n >= sms.min && n <= sms.max;

    const sync = (): void => {
      const n = typed();
      const ok = inRange(n);
      if (n === null || n <= 0) {
        // No number yet: an estimate here would be the bill for a value nobody
        // typed (the default's, or "১" for an empty field).
        cost.textContent = '';
      } else {
        say(cost, `প্রতি প্রাপকে আনুমানিক ${bnNum(this.segments(n))} টি এসএমএস।`);
      }
      // The warning appears when the school goes beyond the recommendation,
      // stated as a multiple of the bill rather than as a number of letters.
      const over = ok && n > sms.default;
      warn.hidden = !over;
      if (over) {
        const baseSegs = this.segments(sms.default);
        say(warn,
          `প্রস্তাবিত দৈর্ঘ্যের চেয়ে বেশি — খরচ প্রায় ${bnNum((this.segments(n) / baseSegs).toFixed(1))} গুণ হতে পারে। ` +
          'এসএমএস প্রতিষ্ঠানের সবচেয়ে বড় চলতি খরচ।');
      }
      if (ok) { clearFieldError(chars.root); this.draft = Math.floor(n); }
      // Save is NOT disabled for a value it will refuse. A greyed button says
      // nothing about why, and — being the form's submit button — it also
      // swallowed Enter, so the range message below could never be reached.
      // The submit handler is the gate; busy and read-only still disable.
      saveBtn.toggleAttribute('disabled', this.busy || !this.o.canManage);
    };
    chars.input.addEventListener('input', sync);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.busy || !this.o.canManage) return;
      const n = typed();
      if (!inRange(n)) {
        // Field-level, so the number the person typed stays in front of them
        // while they correct it.
        setFieldError(chars.root,
          `${bnNum(sms.min)} থেকে ${bnNum(sms.max)} এর মধ্যে একটি সংখ্যা দিন।`);
        chars.input.focus();
        return;
      }
      // From the field itself, not only from the last `input` event.
      this.draft = Math.floor(n);
      void this.save();
    });

    sync();
    return form;
  }

  // ── group ১b: push vs SMS ────────────────────────────────────────────
  /**
   * R-9. The school's decision about whether push may REPLACE an SMS.
   *
   * Off by default and deliberately framed as a trade rather than a feature.
   * A push notification can be muted at the OS level or land on a phone the
   * parent has handed to the child; an SMS is harder to miss. So the screen
   * states what is gained and what is given up, and lets the school choose —
   * this is a judgement about their parents, not a technical fact we can
   * decide for them.
   */
  private async savePush(next: boolean): Promise<void> {
    this.busy = true; this.error = ''; this.notice = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ push: { replacesSms: next } }),
      });
      const body = await res.json() as { push?: PushSettings; message?: string };
      if (!res.ok) {
        this.error = serverMessage(body, res.status, 'সংরক্ষণ করা যায়নি।', 'সেটিংস');
        return;
      }
      this.push = body.push ?? this.push;
      this.notice = next
        ? 'সংরক্ষিত — নোটিফিকেশন পৌঁছালে সেই বার্তার এসএমএস আর পাঠানো হবে না।'
        : 'সংরক্ষিত — নোটিফিকেশনের পাশাপাশি এসএমএসও যাবে।';
    } catch {
      this.error = 'সংযোগ নেই — সংরক্ষণ করা যায়নি।';
    } finally {
      this.busy = false; this.render();
    }
  }

  private pushRow(): HTMLElement | null {
    if (!this.push) return null;
    const d = this.o.doc;
    const push = this.push;
    const title = 'নোটিফিকেশন পৌঁছালে একই বার্তার এসএমএস পাঠানো হবে না';
    const why = 'যাঁরা অ্যাপে নোটিফিকেশন চালু করেছেন, তাঁদের বার্তা ইন্টারনেটে যায় — খরচ নেই। ' +
                'সেই বার্তার এসএমএসটি বন্ধ রাখলে প্রতিষ্ঠানের খরচ কমে।';
    const row = el(d, 'div', { className: 'set-row' });

    if (!push.available) {
      // The toggle would save and change nothing: suppression only applies to
      // a push a service ACCEPTED, and with no VAPID keys none ever is.
      append(row,
        el(d, 'div', { className: 'set-row-text' },
          el(d, 'span', { className: 'set-row-title', text: title }),
          el(d, 'p', { className: 'set-row-sub', text: why })),
        el(d, 'div', { className: 'set-row-control' },
          statusBadge(d, { state: 'draft', label: 'চালু নেই' })),
        el(d, 'p', {
          className: 'inline-notice',
          text: 'এই সার্ভারে নোটিফিকেশন চালু নেই — সেটি চালু হলে এই সুবিধা ব্যবহার করা যাবে।',
        }));
      return row;
    }

    const box = el(d, 'input', {
      className: 'set-switch-input',
      attrs: { type: 'checkbox', id: 'push-replaces-sms', role: 'switch' },
    });
    box.checked = push.replacesSms;
    box.disabled = this.busy || !this.o.canManage;

    append(row,
      el(d, 'div', { className: 'set-row-text' },
        // The row title IS the switch's label, so the words are its name.
        el(d, 'label', { className: 'set-row-title', attrs: { for: 'push-replaces-sms' }, text: title }),
        el(d, 'p', { className: 'set-row-sub', text: why }),
        // The two exceptions are stated on the screen, not just in the code, so
        // a principal deciding this knows what is NOT being given up.
        el(d, 'p', {
          className: 'set-row-sub',
          text: 'জরুরি নোটিশ ও লগইন কোড সবসময় এসএমএসেও যাবে। ' +
                'যাঁদের নোটিফিকেশন চালু নেই, তাঁরা আগের মতোই এসএমএস পাবেন।',
        })),
      el(d, 'div', { className: 'set-row-control' },
        // The words beside the switch's colour (R5): the state, spelled out.
        statusBadge(d, {
          state: push.replacesSms ? 'published' : 'draft',
          label: push.replacesSms ? 'এসএমএস বন্ধ' : 'দুটোই যাবে',
        }),
        // A 44px hit area around the 42×24 track; the native checkbox stays
        // the control, transparent over the whole area.
        el(d, 'label', { className: 'set-switch', attrs: { for: 'push-replaces-sms' } },
          box,
          el(d, 'span', { className: 'set-switch-track', attrs: { 'aria-hidden': 'true' } }))),
    );

    if (this.o.canManage) {
      box.addEventListener('change', () => {
        const next = box.checked;
        // Turning it ON stops SMS going out for every guardian in the school
        // who has a working push subscription. That is a school-wide change
        // to how families are reached, so it is confirmed; turning it back
        // OFF only adds messages, so it is not.
        if (!next) { void this.savePush(false); return; }
        box.checked = push.replacesSms;   // until confirmed
        confirmOverlay(d, {
          title: 'এসএমএস বন্ধ করা নিশ্চিত করুন',
          body: 'যাঁদের ফোনে নোটিফিকেশন পৌঁছাবে, তাঁরা ওই বার্তার এসএমএস আর পাবেন না। ' +
                'জরুরি নোটিশ ও লগইন কোড এতে বাদ যাবে না।',
          confirmLabel: 'বন্ধ করুন',
          onConfirm: () => this.savePush(true),
        });
      });
    }
    return row;
  }

  // ── group ২: what is a setting but lives elsewhere ───────────────────
  private elsewhereRows(): HTMLElement[] {
    const d = this.o.doc;
    const go = this.o.go ?? ((path: string) => {
      const w = d.defaultView;
      if (w) w.location.hash = `#/${path}`;
    });
    return [
      el(d, 'div', { className: 'set-row' },
        el(d, 'p', {
          className: 'set-row-sub',
          text: 'এগুলোও প্রতিষ্ঠানের সেটিংস — যে জিনিসের সেটিং, সেখানেই আছে।',
        })),
      list(d, 'অন্যান্য সেটিংস',
        ...ELSEWHERE.map((e) => listItem(d, {
          title: e.titleBn, subtitle: e.whatBn, onClick: () => go(e.path),
        }))),
    ];
  }
}
