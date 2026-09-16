/**
 * নোটিশ পাঠান — the composer  (R-2, docs/11-MASTER-PLAN.md; Ata Ekta 09 Comms §01)
 *
 * Where a head teacher decides who is told something. One white body, in the
 * order the drawing sets it: who it is for, what it says, and — under a line —
 * the category, the phone and the time. Below the body, the panel that says
 * what is about to happen, and the one button that does it.
 *
 * ── The audience picker is the screen ───────────────────────────────────
 * Everything else is a text box. The audience is where the mistake happens
 * and where it is expensive: a staff-only notice sent to `all` cannot be
 * recalled from 900 phones. So the chosen audience is restated in plain
 * Bangla in the panel beside the send button — not as a form value the author
 * set six fields ago, but as a sentence they read at the moment they commit.
 *
 * ── The SMS cost is shown while it is being written ─────────────────────
 * Bangla forces UCS-2: 70 characters per segment, not 160. A 300-character
 * notice is five segments, and to 900 guardians that is 4,500 messages. The
 * segment count sits in the counter row under the body and updates as the
 * body grows, because the moment to learn this is while writing, not on the
 * invoice.
 *
 * ── Above the threshold: the irreversible panel (§7, R11) ────────────────
 * The panel turns --danger-tint only when the server says the send is big
 * enough to need confirming, and then carries `irreversiblePanel`: what cannot
 * be undone, the real counts, the tick, and the send button behind it. Below
 * the threshold nothing is gated and nothing is red.
 */
import type { Auth } from './auth.ts';
import {
  AUDIENCE_LABELS_BN,
  CATEGORY_LABELS_BN,
  NOTICE_CATEGORIES,
  NOTICE_LIMITS,
  parseNotice,
  smsDefaultFor,
  smsSegmentsFor,
  NoticeError,
  type AudienceType,
  type NoticeCategory,
} from '../../../packages/ui-core/src/notice.ts';
import { toBanglaDigits, smsEncoding } from '../../../packages/ui-core/src/format.ts';
import {
  serverMessage, pageHeader, field as uiField, setFieldError, clearFieldError,
  permissionState, permissionMessage, button, buttonRow, statusBadge, emptyState,
  errorState, successNote, listSkeleton, irreversiblePanel, el, icon, uid, clear,
  append, numText, numClass, type Field,
} from './ui/index.ts';

/**
 * A count in Bangla digits with lakh grouping — ১,৫৬৮ / ৩,১৩৬ as the panel
 * draws them. The same `en-IN` grouping `formatBdt` uses; `formatCount` does
 * not group.
 */
const toBnGrouped = (n: number): string => toBanglaDigits(n.toLocaleString('en-IN'));

/**
 * Who may author a notice. Mirrors `AUTHOR_ROLES` in
 * `services/ops-svc/api/notices.ts`, which is the real gate — this copy only
 * decides whether the form is offered, never whether the send succeeds.
 */
const AUTHOR_ROLES = ['principal', 'school_owner', 'academic_coordinator', 'class_teacher'];

export interface SectionOption {
  id: string;
  label: string;
}

export interface NoticeComposeOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Where to go after a successful publish. */
  onPublished?: () => void;
}

/** Audiences a class teacher may use. The server enforces this too. */
const TEACHER_AUDIENCES: AudienceType[] = ['section'];
const MANAGEMENT_ROLES = new Set(['principal', 'school_owner', 'academic_coordinator']);

/** What the preview endpoint answers: the server's own count of this send. */
interface Estimate {
  recipients: number; smsRecipients: number;
  segmentsEach: number; segmentsTotal: number;
  confirmThreshold: number; needsConfirmation: boolean;
}

export class NoticeComposeView {
  private readonly o: NoticeComposeOptions;
  private title = '';
  private body = '';
  private category: NoticeCategory = 'general';
  private audienceType: AudienceType = 'all';
  private selectedSections = new Set<string>();
  private sendSms = false;
  /**
   * R-8 §4. How many people this would reach and what it would cost, from the
   * server's own audience resolver.
   *
   * The screen already restated the audience as a sentence and showed the
   * segments per person. What it could not say was how many people "সব
   * অভিভাবক" IS. Choosing between "this section" and "all guardians" was
   * choosing between two phrases, one of which costs a hundred times more,
   * with nothing on screen saying so.
   */
  private estimate: Estimate | null = null;
  /** Set by the operator, for a send big enough to need saying out loud. */
  private bigSendAcknowledged = false;
  private estimateSeq = 0;
  private estimateTimer: ReturnType<typeof setTimeout> | null = null;
  /** ISO local datetime, or '' for "send now". */
  private publishAt = '';
  /** Set once by the category picker; after that the author owns the toggle. */
  private smsTouched = false;
  private sections: SectionOption[] = [];
  /** The section list's own three states — it used to show "none" for all of them. */
  private sectionsState: 'loading' | 'ready' | 'failed' = 'loading';
  private busy = false;
  private notice = '';
  private noticeKind: 'ok' | 'error' | 'offline' | '' = '';
  private fieldError: { field: string; message: string } | null = null;

  constructor(options: NoticeComposeOptions) {
    this.o = options;
    if (!this.isManagement()) this.audienceType = 'section';
    this.render();
    void this.loadSections();
  }

  private isManagement(): boolean {
    return MANAGEMENT_ROLES.has(this.o.auth.role);
  }

  private allowedAudiences(): AudienceType[] {
    return this.isManagement()
      ? ['all', 'staff', 'students', 'guardians', 'section']
      : TEACHER_AUDIENCES;
  }

  private async loadSections(): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/sections');
      if (!res.ok) {
        this.sectionsState = 'failed';
        if (this.audienceType === 'section') this.render();
        return;
      }
      const body = (await res.json()) as {
        sections: { id: string; name: string; className?: { bn?: string } }[];
      };
      this.sections = (body.sections ?? []).map((s) => ({
        id: s.id,
        label: `${s.className?.bn ?? ''} ${s.name}`.trim(),
      }));
      this.sectionsState = 'ready';
      this.render();
    } catch {
      // The picker says the list could not be fetched, and offers to try again.
      this.sectionsState = 'failed';
      if (this.audienceType === 'section') this.render();
    }
  }

  private draft(): unknown {
    return {
      title: this.title,
      body: this.body,
      category: this.category,
      audience: this.audienceType === 'section'
        ? { type: 'section', ids: [...this.selectedSections] }
        : { type: this.audienceType },
      sendSms: this.sendSms,
    };
  }

  /** '' when sending now; otherwise the chosen local time as an ISO string. */
  private scheduleIso(): string | null {
    if (!this.publishAt) return null;
    const t = Date.parse(this.publishAt);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  /** The audience, as a sentence, for the "পাবে:" line beside Send. */
  private audienceSentence(): string {
    if (this.audienceType !== 'section') {
      return AUDIENCE_LABELS_BN[this.audienceType];
    }
    const n = this.selectedSections.size;
    if (n === 0) return 'কোনো শাখা বাছাই করা হয়নি';
    const names = this.sections
      .filter((s) => this.selectedSections.has(s.id))
      .map((s) => s.label);
    // Guardians receive a section notice too — say so, because "শাখা ৯-ক" reads
    // like students only, and it is not.
    return `${names.join(', ')} — শিক্ষার্থী ও অভিভাবক`;
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    this.fieldError = null;
    this.notice = '';

    try {
      parseNotice(this.draft());
    } catch (err) {
      if (err instanceof NoticeError) {
        this.fieldError = { field: err.field, message: err.message };
        this.render();
        return;
      }
      throw err;
    }

    this.busy = true;
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notice: this.draft(),
          publish: true,
          publishAt: this.scheduleIso(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        recipients?: number; smsQueued?: boolean; status?: string;
        message?: string; field?: string;
      };
      if (!res.ok) {
        if (body.field) this.fieldError = { field: body.field, message: body.message ?? 'ভুল আছে।' };
        else {
          this.notice = serverMessage(body, res.status, 'পাঠানো যায়নি। আবার চেষ্টা করুন।', 'নোটিশ');
          this.noticeKind = 'error';
        }
        return;
      }
      const n = body.recipients ?? 0;
      if (body.status === 'scheduled') {
        // A scheduled notice has reached nobody yet, and saying "0 জনের কাছে
        // পৌঁছেছে" would read as a failure. Say what actually happened.
        this.notice = 'নির্ধারিত সময়ে পাঠানো হবে।';
      } else {
        this.notice = body.smsQueued
          ? `${toBnGrouped(n)} জনের কাছে পৌঁছেছে · এসএমএস সারিতে দেওয়া হয়েছে`
          : `${toBnGrouped(n)} জনের কাছে পৌঁছেছে`;
      }
      this.noticeKind = 'ok';
      this.title = '';
      this.body = '';
      this.publishAt = '';
      this.selectedSections.clear();
      this.smsTouched = false;
      this.sendSms = smsDefaultFor(this.category);
      this.o.onPublished?.();
    } catch {
      // Offline, not a refusal: the warn tone, and the typed notice is kept.
      this.notice = 'সংযোগ নেই — নোটিশ পাঠানো যায়নি।';
      this.noticeKind = 'offline';
    } finally {
      this.busy = false;
      this.render();
    }
  }

  /**
   * R-8 §4. Ask again, but not on every keystroke.
   *
   * The estimate is a database query over the audience; firing it per
   * character would be a request per keystroke on a 2G connection, which is
   * the exact pattern docs/01 §8 forbids. 400 ms after typing stops is late
   * enough to be cheap and early enough to be read before the send button.
   */
  private scheduleEstimate(): void {
    if (this.estimateTimer !== null) clearTimeout(this.estimateTimer);
    this.estimateTimer = setTimeout(() => {
      this.estimateTimer = null;
      void this.refreshEstimate();
    }, 400);
  }

  /**
   * The counter row's words, and the panel's two figures — one method, used by
   * render() and syncLive(), so the first paint and the live update cannot
   * drift apart.
   */
  private liveText(): {
    chars: string; cost: string; warn: boolean; recipients: string; sms: string;
  } {
    const est = this.estimate;
    const len = this.body.length;
    const unicode = smsEncoding(this.body) === 'unicode';
    // With SMS on, the characters are counted against the segments the body
    // already fills ("৮৭ / ১৪০ অক্ষর" is two Bangla segments); otherwise against
    // the notice's own limit.
    let cap: number = NOTICE_LIMITS.body;
    if (this.sendSms && len > 0) {
      const per = unicode ? 70 : 160;
      cap = Math.max(1, Math.ceil(len / per)) * per;
    }
    // The server's figure when there is one, because it is computed from the
    // message that would actually be SENT — title, trimmed body, and the
    // school's signature — while `smsSegmentsFor(this.body)` measures the
    // notice text alone and under-reports every message. Two numbers on one
    // screen disagreeing is worse than one number arriving a moment late.
    const each = est ? est.segmentsEach : smsSegmentsFor(this.body);
    return {
      chars: `${toBnGrouped(len)} / ${toBnGrouped(cap)} অক্ষর`,
      cost: this.body ? `${toBnGrouped(each)}টি এসএমএস` : '',
      // "70 characters" is the Bangla rule; a Latin-only body is 160.
      warn: len === 0 || unicode,
      // No estimate yet (an empty form, or offline): a dash, never a guess.
      recipients: est ? toBnGrouped(est.recipients) : '—',
      sms: !this.sendSms ? toBnGrouped(0) : est ? toBnGrouped(est.segmentsTotal) : '—',
    };
  }

  /** The checklist under the irreversible statement, with the server's real counts. */
  private ackItems(est: Estimate): string[] {
    return [
      `${toBnGrouped(est.recipients)} জন নোটিশটি পাবে`,
      `${toBnGrouped(est.smsRecipients)} জনের ফোনে ${toBnGrouped(est.segmentsTotal)}টি এসএমএস যাবে`,
    ];
  }

  /** Replace a node's text, numbers in the `.n` face (R6). textContent is exactly `text`. */
  private fill(node: HTMLElement, text: string): void {
    clear(node);
    if (text) append(node, ...numText(this.o.doc, text));
  }

  /** Refresh only the parts that depend on the body: never re-render mid-type. */
  private syncLive(): void {
    const root = this.o.root;
    const est = this.estimate;
    const live = this.liveText();

    const recipients = root.querySelector<HTMLElement>('[data-estimate-recipients]');
    if (recipients) {
      recipients.textContent = live.recipients;
      recipients.className = numClass('compose-stat-value', live.recipients);
    }
    const sms = root.querySelector<HTMLElement>('[data-estimate-sms]');
    if (sms) {
      sms.textContent = live.sms;
      sms.className = numClass('compose-stat-value', live.sms);
    }
    const chars = root.querySelector<HTMLElement>('[data-char-count]');
    if (chars) this.fill(chars, live.chars);
    const seg = root.querySelector<HTMLElement>('[data-sms-cost]');
    if (seg) this.fill(seg, live.cost);
    const warn = root.querySelector<HTMLElement>('[data-sms-warn]');
    if (warn) warn.hidden = !live.warn;

    const line = root.querySelector<HTMLElement>('[data-audience-line]');
    if (line) this.fill(line, this.audienceSentence());

    // The acknowledgement shows what the estimate says NOW. A changed estimate
    // has already revoked the flag (refreshEstimate); the box and the counts
    // beside it say so instead of showing last send's numbers ticked.
    const gate = root.querySelector<HTMLElement>('[data-big-send]');
    if (gate && est) {
      const texts = gate.querySelectorAll<HTMLElement>('.irrev-item-text');
      this.ackItems(est).forEach((t, i) => { if (texts[i]) this.fill(texts[i], t); });
      const box = gate.querySelector<HTMLInputElement>('input[type=checkbox]');
      if (box && box.checked !== this.bigSendAcknowledged) box.checked = this.bigSendAcknowledged;
    }

    const send = root.querySelector<HTMLButtonElement>('[data-send]');
    // R-8 §4. A send large enough to be a mistake needs the mistake said out
    // loud first. Below the threshold nothing changes.
    if (send) send.disabled = this.sendDisabled();
  }

  private sendDisabled(): boolean {
    const blockedByScale = this.estimate?.needsConfirmation === true
      && !this.bigSendAcknowledged;
    return this.busy || !this.title.trim() || !this.body.trim() || blockedByScale;
  }

  /**
   * Ask the server what this would cost.
   *
   * Debounced by sequence rather than by timer: the audience picker fires on
   * every click and the body on every keystroke, and a stale reply arriving
   * after a newer one would show the cost of a message that is no longer being
   * written. Only the newest answer is allowed to land.
   */
  private async refreshEstimate(): Promise<void> {
    const seq = ++this.estimateSeq;
    if (!this.title.trim() && !this.body.trim()) { this.estimate = null; return; }
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/notices?preview=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: this.audienceType === 'section'
            ? { type: 'section', ids: [...this.selectedSections] }
            : { type: this.audienceType },
          title: this.title, body: this.body, sendSms: this.sendSms,
        }),
      });
      if (seq !== this.estimateSeq) return;
      if (!res.ok) { this.estimate = null; this.syncLive(); return; }
      const next = await res.json() as Estimate;
      if (seq !== this.estimateSeq) return;
      // A changed audience invalidates an acknowledgement: saying yes to
      // "৮টি এসএমএস" must not carry over to "৪,৫০০টি".
      if (this.estimate && next.segmentsTotal !== this.estimate.segmentsTotal) {
        this.bigSendAcknowledged = false;
      }
      // A full render when the GATE changes, not just the numbers.
      //
      // `syncLive` updates text and button state in place — it does not build
      // the acknowledgement panel, which exists only in `render`. So an
      // estimate that arrived and flipped `needsConfirmation` to true disabled
      // the send button and drew nothing to re-enable it: a dead end, and a
      // worse outcome than having no gate at all. Caught by the test that asks
      // for the checkbox after a large estimate.
      const gateChanged = (this.estimate?.needsConfirmation ?? false)
        !== next.needsConfirmation;
      this.estimate = next;
      if (gateChanged) this.render(); else this.syncLive();
    } catch {
      // Offline: no estimate rather than a wrong one. The send button stays
      // enabled — the composer already works offline and the server counts
      // again at publish.
      if (seq === this.estimateSeq) { this.estimate = null; this.syncLive(); }
    }
  }

  /**
   * One of the composer's two text fields, on the P2 primitive.
   *
   * What this replaces was a `<label class="login-label">` with the error
   * appended INSIDE it and no `aria-describedby`, so a screen reader met the
   * error only by wandering into it. `field()` wires the description, and
   * `setFieldError` puts the message in a slot that already exists — which
   * matters because the old path reported errors by re-rendering, and a
   * re-render of this screen throws away the notice the person just typed.
   *
   * Returned so the body's counter row can sit inside the same field.
   */
  private field(
    parent: HTMLElement,
    labelBn: string,
    key: 'title' | 'body',
    opts: { multiline?: boolean; max: number },
  ): Field {
    const d = this.o.doc;
    const f = uiField(d, {
      label: labelBn,
      name: key,
      kind: opts.multiline ? 'textarea' : 'text',
      value: this[key],
      required: true,
      attrs: { maxlength: opts.max, ...(opts.multiline ? { rows: 3 } : {}) },
      onInput: (v) => {
        this[key] = v;
        this.fieldError = null;
        clearFieldError(f.root);
        this.syncLive();
        // The body decides the segment count and the title is part of the
        // sent message, so both change the estimate.
        this.scheduleEstimate();
      },
    });
    if (this.fieldError?.field === key) setFieldError(f.root, this.fieldError.message);
    parent.append(f.root);
    return f;
  }

  /** কারা পাবে — the chips, and for a section audience the list under them. */
  private audienceField(d: Document): HTMLElement {
    const labelId = uid('aud');
    const wrap = el(d, 'div', { className: 'ui-field compose-audience' },
      el(d, 'span', { className: 'ui-field-label', attrs: { id: labelId }, text: 'কারা পাবে' }));

    const chips = el(d, 'div', {
      className: 'audience-chips',
      attrs: { role: 'group', 'aria-labelledby': labelId },
    });
    for (const a of this.allowedAudiences()) {
      const chip = el(d, 'button', {
        className: 'audience-chip',
        text: AUDIENCE_LABELS_BN[a],
        attrs: { type: 'button', 'aria-pressed': String(this.audienceType === a) },
      });
      chip.addEventListener('click', () => {
        this.audienceType = a;
        // The audience IS the cost. Changing it invalidates any
        // acknowledgement of the previous one.
        this.bigSendAcknowledged = false;
        void this.refreshEstimate();
        this.render();
      });
      chips.append(chip);
    }
    wrap.append(chips);

    if (this.audienceType === 'section') {
      const list = el(d, 'div', { className: 'audience-sections' });
      if (this.sectionsState === 'loading') {
        list.append(listSkeleton(d, 3));
      } else if (this.sectionsState === 'failed') {
        list.append(errorState(d, 'শাখার তালিকা আনা যায়নি।', () => {
          this.sectionsState = 'loading';
          this.render();
          void this.loadSections();
        }));
      } else if (this.sections.length === 0) {
        list.append(emptyState(d, {
          glyph: 'users',
          message: 'এখনো কোনো শাখা নেই।',
          detail: 'শাখা তৈরি হলে এখানে বাছাই করা যাবে।',
          action: this.isManagement()
            ? {
              label: 'শাখা তৈরি করুন',
              onClick: () => { const w = d.defaultView; if (w) w.location.hash = '#/academic'; },
            }
            : undefined,
        }));
      }
      for (const s of this.sectionsState === 'ready' ? this.sections : []) {
        const box = el(d, 'input', { attrs: { type: 'checkbox' } });
        box.checked = this.selectedSections.has(s.id);
        box.addEventListener('change', () => {
          if (box.checked) this.selectedSections.add(s.id);
          else this.selectedSections.delete(s.id);
          this.bigSendAcknowledged = false;
          void this.refreshEstimate();
          this.syncLive();
        });
        list.append(el(d, 'label', { className: 'audience-section' },
          box, el(d, 'span', {}, ...numText(d, s.label))));
      }
      wrap.append(list);
    }

    if (this.fieldError?.field === 'audience') {
      wrap.append(el(d, 'p', {
        className: 'ui-field-error', attrs: { role: 'alert' },
      }, ...numText(d, this.fieldError.message)));
    }
    return wrap;
  }

  /** ধরন, এসএমএস, কখন — the three controls the drawing leaves out and the code keeps. */
  private optionsBlock(d: Document): HTMLElement {
    const options = el(d, 'div', { className: 'compose-options' });

    const cat = uiField(d, {
      label: 'ধরন',
      name: 'category',
      kind: 'select',
      value: this.category,
      options: NOTICE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS_BN[c] })),
      onChange: (v) => {
        this.category = v as NoticeCategory;
        // The category suggests a default until the author touches the toggle;
        // after that it is theirs.
        if (!this.smsTouched) this.sendSms = smsDefaultFor(this.category);
        this.render();
      },
    });
    if (this.fieldError?.field === 'category') setFieldError(cat.root, this.fieldError.message);
    options.append(cat.root);

    // ── When ──
    const whenId = uid('when');
    const whenHelpId = `${whenId}-help`;
    const at = el(d, 'input', {
      className: 'ui-input n is-num',
      attrs: {
        type: 'datetime-local', id: whenId, name: 'publishAt',
        'aria-describedby': whenHelpId,
      },
    });
    at.value = this.publishAt;
    at.addEventListener('change', () => { this.publishAt = at.value; this.render(); });
    options.append(el(d, 'div', { className: 'ui-field' },
      el(d, 'label', { className: 'ui-field-label', attrs: { for: whenId } },
        el(d, 'span', { text: 'কখন পাঠানো হবে' })),
      el(d, 'div', { className: 'ui-field-control' }, at),
      // Honest about the granularity rather than implying minute precision the
      // nightly sweeper cannot deliver.
      el(d, 'p', {
        className: 'ui-field-help',
        attrs: { id: whenHelpId },
        text: this.publishAt
          ? 'নির্ধারিত সময়ের পর পরবর্তী রক্ষণাবেক্ষণ চক্রে পাঠানো হবে।'
          : 'খালি রাখলে এখনই পাঠানো হবে।',
      })));

    // ── How ──
    const smsBox = el(d, 'input', { attrs: { type: 'checkbox' } });
    smsBox.checked = this.sendSms;
    smsBox.addEventListener('change', () => {
      this.sendSms = smsBox.checked;
      this.smsTouched = true;
      // Turning SMS on is the single change that takes the cost from zero to
      // whatever the audience is, so it re-asks immediately rather than after
      // the typing debounce.
      this.bigSendAcknowledged = false;
      void this.refreshEstimate();
      this.render();
    });
    const sms = el(d, 'div', { className: 'compose-sms' },
      // The checkbox stays the label's direct child: the whole row is the target.
      el(d, 'label', { className: 'sms-toggle' },
        smsBox, el(d, 'span', { text: 'মোবাইলে এসএমএসও পাঠান' })),
      el(d, 'p', { className: 'ui-field-help', text: 'অ্যাপের নোটিফিকেশনে সবসময় যাবে।' }));
    if (this.sendSms) {
      // SMS is an alert, not the notice. Saying so here is what stops someone
      // pasting four paragraphs in and wondering why the bill grew.
      sms.append(el(d, 'p', {
        className: 'ui-field-help',
        text: 'এসএমএসে সংক্ষিপ্ত বার্তা যাবে; পুরো নোটিশ অ্যাপে থাকবে।',
      }));
    }
    options.append(sms);
    return options;
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // Mirrors AUTHOR_ROLES in ops-svc/api/notices.ts. A student or a guardian
    // typing this URL used to meet the whole composer — title, body, and
    // audience chips reading "শিক্ষকদের জন্য · অভিভাবকদের জন্য". The endpoint
    // would have refused the send; the screen should not have offered a child
    // a broadcast to the school in the first place.
    if (!AUTHOR_ROLES.includes(this.o.auth.role)) {
      root.append(pageHeader(d, { title: 'নোটিশ পাঠান' }));
      root.append(permissionState(d, {
        message: permissionMessage('নোটিশ পাঠানো'),
        contact: 'প্রধান শিক্ষক, প্রতিষ্ঠান মালিক, একাডেমিক সমন্বয়ক ও শ্রেণি শিক্ষক',
      }));
      return;
    }

    // The drawing's bar: the title, and a neutral chip in the right-hand slot.
    // Nothing is saved as a draft — the chip says "not yet sent".
    root.append(pageHeader(d, {
      title: 'নোটিশ পাঠান',
      actions: [statusBadge(d, { state: 'draft', label: 'খসড়া' })],
    }));

    if (this.notice) {
      if (this.noticeKind === 'ok') {
        const ok = successNote(d, this.notice);
        ok.setAttribute('role', 'status');
        root.append(ok);
      } else if (this.noticeKind === 'offline') {
        root.append(el(d, 'p', {
          className: 'offline-banner compose-notice', attrs: { role: 'alert' },
        }, icon(d, 'wifi-off', 'offline-icon'), el(d, 'span', { text: this.notice })));
      } else {
        // No retry button: the send button below is the retry, and the typed
        // notice is still in it.
        const err = errorState(d, this.notice);
        err.classList.add('compose-notice');
        root.append(err);
      }
    }

    const live = this.liveText();
    const est = this.estimate;

    // ── The white body ──────────────────────────────────────────────
    const body = el(d, 'div', { className: 'compose-body' });
    body.append(this.audienceField(d));
    this.field(body, 'শিরোনাম', 'title', { max: NOTICE_LIMITS.title });
    const bf = this.field(body, 'বার্তা', 'body', { multiline: true, max: NOTICE_LIMITS.body });

    const count = el(d, 'p', { className: 'compose-count' },
      el(d, 'span', { attrs: { 'data-char-count': '' } }, ...numText(d, live.chars)));
    if (this.sendSms) {
      count.append(
        el(d, 'span', { attrs: { 'data-sms-cost': '', role: 'status' } },
          ...(live.cost ? numText(d, live.cost) : [])),
        el(d, 'span', {
          className: 'compose-count-warn',
          attrs: { 'data-sms-warn': '', hidden: !live.warn },
        }, ...numText(d, 'বাংলায় ৭০ অক্ষরে ১টি এসএমএস')));
    }
    bf.root.append(count);
    body.append(this.optionsBlock(d));

    // ── The panel: what is about to happen, and the one button ─────
    const gated = est?.needsConfirmation === true;
    const panel = el(d, 'div', {
      className: 'compose-panel',
      attrs: { 'data-gated': gated ? 'true' : null },
    });

    // Two numbers, and the second is almost always the surprise: everyone
    // who gets the in-app notice, and the far smaller set who have a phone
    // on file and (for guardians) have consented. The bill is made of the
    // second one.
    panel.append(el(d, 'div', {
      className: 'compose-stats', attrs: { 'data-estimate': '', role: 'status' },
    },
    el(d, 'div', { className: 'compose-stat' },
      el(d, 'span', { className: 'compose-stat-label', text: 'কতজন পাবে' }),
      el(d, 'span', {
        className: numClass('compose-stat-value', live.recipients),
        text: live.recipients, attrs: { 'data-estimate-recipients': '' },
      })),
    el(d, 'div', { className: 'compose-stat' },
      el(d, 'span', { className: 'compose-stat-label', text: 'এসএমএস' }),
      el(d, 'span', {
        className: numClass('compose-stat-value', live.sms),
        text: live.sms, attrs: { 'data-estimate-sms': '' },
      }))));

    panel.append(el(d, 'p', { className: 'compose-line' },
      el(d, 'span', { className: 'compose-line-label', text: 'পাবে:' }), ' ',
      el(d, 'span', { attrs: { 'data-audience-line': '' } },
        ...numText(d, this.audienceSentence()))));

    const send = button(d, {
      label: this.busy
        ? 'পাঠানো হচ্ছে…'
        : this.publishAt ? 'নির্ধারিত সময়ে পাঠান' : 'পাঠান',
      variant: 'primary',
      busy: this.busy,
      attrs: { 'data-send': '' },
      onClick: () => { void this.send(); },
    });

    if (gated && est) {
      // Above the threshold the send button is not enough. A notice to a whole
      // school cannot be recalled from nine hundred phones, and the moment to
      // notice that is before the click, not in the invoice.
      const gate = irreversiblePanel(d, {
        statement: 'পাঠানো হয়ে গেলে আর ফেরানো যায় না।',
        detail: `${toBnGrouped(est.confirmThreshold)}টির বেশি এসএমএস — টিক না দিলে পাঠানো যাবে না।`,
        items: this.ackItems(est),
        confirm: send,
        actions: [send],
        className: 'compose-irrev',
        onChange: (ticked) => {
          this.bigSendAcknowledged = ticked;
          this.syncLive();
        },
      });
      gate.root.setAttribute('data-big-send', '');
      gate.input.checked = this.bigSendAcknowledged;
      panel.append(gate.root);
    } else {
      panel.append(buttonRow(d, send));
    }
    // After the panel has had its say: busy, empty, and the gate together.
    send.disabled = this.sendDisabled();

    root.append(el(d, 'div', { className: 'compose' }, body, panel));
  }
}
