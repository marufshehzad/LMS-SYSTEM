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
  append, numText, numClass, focusIsLost, type Field,
} from './ui/index.ts';

/**
 * A count in Bangla digits with lakh grouping — ১,৫৬৮ / ৩,১৩৬ as the panel
 * draws them. The same `en-IN` grouping `formatBdt` uses; `formatCount` does
 * not group.
 */
const toBnGrouped = (n: number): string => toBanglaDigits(n.toLocaleString('en-IN'));

/**
 * A refusal of this notice, in Bangla, from the field it names.
 *
 * `parseNotice` (packages/ui-core/src/notice.ts) and ops-svc write their
 * refusals for a log: "every selection must be an id", "audience type
 * \"section\" needs at least one selection", "one or more of those sections is
 * not yours". The composer showed them as they came — in English, to a head
 * teacher. The field and the code say what went wrong; the words are this
 * screen's. A message the server already wrote in Bangla is used as it is.
 */
function refusalBn(field: string, message: string, code = ''): string {
  if (/[ঀ-৿]/.test(message)) return message;
  const m = message.toLowerCase();
  switch (field) {
    case 'title':
      return /fewer/.test(m)
        ? `শিরোনাম ${toBnGrouped(NOTICE_LIMITS.title)} অক্ষরের মধ্যে লিখুন।`
        : 'শিরোনাম লিখুন।';
    case 'body':
      return /fewer/.test(m)
        ? `বার্তা ${toBnGrouped(NOTICE_LIMITS.body)} অক্ষরের মধ্যে লিখুন।`
        : 'বার্তা লিখুন।';
    case 'category':
      return 'নোটিশের ধরন বাছাই করুন।';
    case 'audience':
      if (/at least one/.test(m)) return 'কারা পাবে — অন্তত একটি শাখা বাছাই করুন।';
      if (/at most/.test(m)) {
        return `একটি নোটিশে ${toBnGrouped(NOTICE_LIMITS.ids)}টির বেশি শাখা বাছাই করা যায় না।`;
      }
      if (/own sections only/.test(m)) return 'শ্রেণি শিক্ষক শুধু নিজের শাখায় নোটিশ পাঠাতে পারেন।';
      if (/not yours/.test(m)) {
        return 'বাছাই করা শাখার অন্তত একটি আপনার নয়। শুধু নিজের শাখা বাছাই করে আবার পাঠান।';
      }
      if (/selects nobody/.test(m) || code === 'invalid_audience') {
        return 'বাছাই করা প্রাপকদের মধ্যে এখন কেউ নেই। নোটিশটি কারও কাছে যেত না — অন্য প্রাপক বাছাই করুন।';
      }
      if (/must be an id/.test(m)) {
        return 'বাছাই করা শাখাটি চেনা যায়নি। পাতাটি আবার খুলে শাখা বাছাই করুন।';
      }
      return 'কারা পাবে, তা আবার বাছাই করুন।';
    default:
      return 'নোটিশটি পাঠানো যায়নি। লেখাগুলো আরেকবার দেখে আবার পাঠান।';
  }
}

/**
 * A well-formed id standing in for the i-th ticked section, for the check in
 * `problem()` only. Never sent.
 */
const standInId = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

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

/**
 * The preview reply, checked before anything reads it — or null.
 *
 * Every figure here goes through `toBnGrouped`, which throws on a missing
 * number. A reply without them (the demo answered `?preview=1` with the
 * publish reply, `{noticeId, status, recipients}`) threw out of `syncLive`
 * inside the typing listener, freezing the counter and the send button, and
 * out of `render` after the root was emptied, leaving a blank screen where the
 * typed notice had been. A reply that is not an estimate is no estimate: a
 * dash on screen, the same as offline.
 *
 * `needsConfirmation` fails closed: a reply that leaves it out, but whose own
 * numbers are over the threshold, still gets the gate.
 */
function readEstimate(raw: unknown): Estimate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const count = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  const recipients = count(r.recipients);
  const smsRecipients = count(r.smsRecipients);
  const segmentsEach = count(r.segmentsEach);
  const segmentsTotal = count(r.segmentsTotal);
  const confirmThreshold = count(r.confirmThreshold);
  if (recipients === null || smsRecipients === null || segmentsEach === null
    || segmentsTotal === null || confirmThreshold === null) return null;
  return {
    recipients, smsRecipients, segmentsEach, segmentsTotal, confirmThreshold,
    needsConfirmation: r.needsConfirmation === true || segmentsTotal > confirmThreshold,
  };
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
  /**
   * The estimate the drawn irreversible panel states; null while none is
   * drawn. Kept apart from `estimate` because a re-count that fails is not a
   * small send: the panel stays until the server says the send is small, and
   * an acknowledgement is checked against the numbers it was given for.
   */
  private gate: Estimate | null = null;
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
  /** The outcome of the last send, drawn beside Send (see `resultNode`). */
  private notice = '';
  private noticeKind: 'ok' | 'error' | 'offline' | '' = '';
  /** The field the outcome is about, so fixing that field takes it away. */
  private noticeField = '';
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

  /**
   * The section list arrives after the form is on screen — on 2G, seconds
   * after — and the author may already be typing. So it lands in place, in
   * the picker, and never rebuilds the fields (see `syncAudience`).
   */
  private async loadSections(): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/sections');
      if (!res.ok) {
        this.sectionsState = 'failed';
        this.syncAudience();
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
      this.syncAudience();
      // The "পাবে:" line names the chosen sections.
      this.syncLive();
    } catch {
      // The picker says the list could not be fetched, and offers to try again.
      this.sectionsState = 'failed';
      this.syncAudience();
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
    // Send is disabled until a section is ticked; this line, right above it,
    // is what says why.
    if (n === 0) return 'কোনো শাখা বাছাই করা হয়নি — পাঠাতে অন্তত একটি শাখা বাছাই করুন';
    const names = this.sections
      .filter((s) => this.selectedSections.has(s.id))
      .map((s) => s.label);
    // Guardians receive a section notice too — say so, because "শাখা ৯-ক" reads
    // like students only, and it is not.
    return `${names.join(', ')} — শিক্ষার্থী ও অভিভাবক`;
  }

  /**
   * What is wrong with the notice as written, in Bangla, or null.
   *
   * `parseNotice` is the one validator, and the server runs it again at
   * publish. Every choice the author makes goes through it here: the words,
   * the category, that a section is ticked, and not too many. The one thing it
   * is NOT asked here is whether each section id is a well-formed UUID. The
   * author never writes an id: each came from the list /academics/sections
   * sent, so that question is the server's, and the server asks it. Asked
   * here, it refused the demo's `demo-9a` before anything was sent, in
   * English: a class teacher, who may write only to sections, could not send
   * a notice at all.
   */
  private problem(): { field: string; message: string } | null {
    const draft = this.draft() as { audience: { type: string; ids?: string[] } };
    const ids = draft.audience.ids;
    const checked = ids
      ? { ...draft, audience: { ...draft.audience, ids: ids.map((_, i) => standInId(i)) } }
      : draft;
    try {
      parseNotice(checked);
      return null;
    } catch (err) {
      if (err instanceof NoticeError) {
        return { field: err.field, message: refusalBn(err.field, err.message) };
      }
      throw err;
    }
  }

  /** A refusal that names a field: marked on the field, and said beside Send. */
  private refuse(field: string, message: string): void {
    this.fieldError = { field, message };
    this.notice = message;
    this.noticeKind = 'error';
    this.noticeField = field;
  }

  /**
   * The person has fixed (or is fixing) `field`: its refusal goes, on the
   * field and beside Send. An error that stays while it is being put right
   * reads as "still wrong".
   */
  private clearProblem(field: string): void {
    this.startNextNotice();
    if (this.fieldError?.field === field) this.fieldError = null;
    if (field === 'audience') {
      const root = this.o.root;
      root.querySelector('.compose-audience > .ui-field-error')?.remove();
      root.querySelector('.audience-chips')?.removeAttribute('aria-describedby');
    }
    if (this.notice && this.noticeField === field) {
      this.notice = '';
      this.noticeKind = '';
      this.noticeField = '';
      this.o.root.querySelector('[data-send-result]')?.remove();
    }
  }

  /**
   * The person has started the next notice: "১২৮ জনের কাছে পৌঁছেছে" (or
   * "নির্ধারিত সময়ে পাঠানো হবে।") was about the one already sent, and it goes.
   *
   * The outcome is drawn in the panel, between the "পাবে:" line and Send — the
   * panel that says what is ABOUT to happen. Left there, the past tense of the
   * last send sat above the count of the next one ("কতজন পাবে ৩০ … ১২৮ জনের
   * কাছে পৌঁছেছে · পাঠান") and read as a statement about the draft. It is the
   * same reason send() drops the estimate, the gate and the tick.
   *
   * Only a success. A refusal names a field and goes when that field is put
   * right (`clearProblem`); offline, or a refusal that names none, stays until
   * the next press of Send, which is its retry.
   *
   * Called for every change to the notice: typing in the title or body, a chip,
   * a section tick, ধরন, the SMS toggle and the time.
   */
  private startNextNotice(): void {
    if (this.noticeKind !== 'ok') return;
    this.notice = '';
    this.noticeKind = '';
    this.noticeField = '';
    this.o.root.querySelector('[data-send-result]')?.remove();
  }

  /**
   * Draw the outcome of a send, and put focus where the person now is.
   *
   * The outcome is drawn beside Send, where the person who pressed it is
   * looking (see `resultNode`). Focus follows it: pressing Send leaves focus on
   * a button that goes busy — disabled, so the browser drops focus to <body> —
   * and a rebuild after it left focus there for good. After a refusal, Send is
   * the retry and the typed notice is still in the form, so focus goes back to
   * Send. After a send, the form is empty and Send is disabled, so focus goes
   * to the sentence saying what happened. Focus somewhere else — the person
   * moved on — is left where they put it.
   */
  private settle(sent: boolean): void {
    const d = this.o.doc;
    const active = d.activeElement as HTMLElement | null;
    const onSend = focusIsLost(d) || !!active?.closest?.('[data-send]');
    this.render();
    if (!onSend) return;
    const root = this.o.root;
    const send = root.querySelector<HTMLButtonElement>('[data-send]');
    const result = root.querySelector<HTMLElement>('[data-send-result]');
    const target = !sent && send && !send.disabled ? send : result;
    // Not preventScroll: the sentence is drawn above Send and can push it
    // below the fold of a 375px screen.
    target?.focus();
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    this.fieldError = null;
    this.notice = '';
    this.noticeKind = '';
    this.noticeField = '';

    const problem = this.problem();
    if (problem) {
      this.refuse(problem.field, problem.message);
      this.settle(false);
      return;
    }

    this.busy = true;
    this.render();
    let sent = false;
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
        message?: string; field?: string; error?: string;
      };
      if (!res.ok) {
        // ops-svc names the field for a notice it refused (400 invalid_notice,
        // 403 audience_not_permitted) and writes the reason in English; "that
        // audience selects nobody" names none, and is about the audience.
        const field = typeof body.field === 'string' && body.field
          ? body.field
          : body.error === 'invalid_audience' ? 'audience' : '';
        if (field) {
          this.refuse(field, refusalBn(field, body.message ?? '', body.error));
        } else {
          // No subject: "নোটিশ দেখার অনুমতি" is permission to SEE, and this
          // was a send (see the refusal in render()).
          this.notice = serverMessage(body, res.status, 'পাঠানো যায়নি। আবার চেষ্টা করুন।');
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
      // The figures, the panel and the tick were for the notice just sent.
      // Kept, the empty form showed that send's counts ticked, and the next
      // notice to the same audience at the same length (same totals) went out
      // on the old tick. A reply still on its way was for that notice too.
      this.estimateSeq++;
      this.estimate = null;
      this.gate = null;
      this.bigSendAcknowledged = false;
      sent = true;
      this.o.onPublished?.();
    } catch {
      // Offline, not a refusal: the warn tone, and the typed notice is kept.
      this.notice = 'সংযোগ নেই — নোটিশ পাঠানো যায়নি।';
      this.noticeKind = 'offline';
    } finally {
      this.busy = false;
      this.settle(sent);
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
    // has already revoked the flag (applyEstimate); the box and the counts
    // beside it say so instead of showing last send's numbers ticked.
    const gate = root.querySelector<HTMLElement>('[data-big-send]');
    if (gate && this.gate) {
      const texts = gate.querySelectorAll<HTMLElement>('.irrev-item-text');
      this.ackItems(this.gate).forEach((t, i) => { if (texts[i]) this.fill(texts[i], t); });
    }
    const box = gate?.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (box && box.checked !== this.bigSendAcknowledged) box.checked = this.bigSendAcknowledged;

    const send = root.querySelector<HTMLButtonElement>('[data-send]');
    // R-8 §4. A send large enough to be a mistake needs the mistake said out
    // loud first. Below the threshold nothing changes.
    if (send) send.disabled = this.sendDisabled();
  }

  private sendDisabled(): boolean {
    const blockedByScale = this.gate !== null && !this.bigSendAcknowledged;
    // A section notice with no section ticked is addressed to nobody. Send was
    // enabled for it, and pressing it gave a refusal at the top of the form,
    // off a phone's screen. The "পাবে:" line right above Send says why it waits.
    const noAudience = this.audienceType === 'section' && this.selectedSections.size === 0;
    return this.busy || !this.title.trim() || !this.body.trim() || blockedByScale || noAudience;
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
      if (!res.ok) { this.applyEstimate(null); return; }
      const next = readEstimate(await res.json());
      if (seq !== this.estimateSeq) return;
      this.applyEstimate(next);
    } catch {
      // Offline: no estimate rather than a wrong one. The send button stays
      // enabled — the composer already works offline and the server counts
      // again at publish.
      if (seq === this.estimateSeq) this.applyEstimate(null);
    }
  }

  /**
   * Put an estimate on screen. It lands while the author is typing — 400 ms
   * after a pause — so it never rebuilds the form.
   *
   * It used to call `render()` whenever `needsConfirmation` flipped. That
   * emptied the root and rebuilt the title and body under the caret: focus
   * fell to <body>, a phone's keyboard closed, the next keys went nowhere, and
   * a Bangla keyboard's composition was cut mid-word. And because the demo's
   * reply had no `needsConfirmation`, `false !== undefined` made that happen on
   * every pause. The panel is the only part the gate changes, so the panel is
   * the only part rebuilt (`swapPanel`); everything else updates in place.
   */
  private applyEstimate(next: Estimate | null): void {
    this.estimate = next;
    // No count is not a small count: a panel already drawn stays, and its
    // acknowledgement with it, until the server says otherwise.
    if (next === null) { this.syncLive(); return; }
    const was = this.gate;
    // A changed send invalidates an acknowledgement: saying yes to
    // "৮টি এসএমএস" must not carry over to "৪,৫০০টি".
    if (was && next.segmentsTotal !== was.segmentsTotal) this.bigSendAcknowledged = false;
    this.gate = next.needsConfirmation ? next : null;
    // `syncLive` updates text and button state in place — it cannot build the
    // acknowledgement panel. An estimate that turned the gate on and drew
    // nothing would disable Send with nothing to re-enable it: a dead end.
    if ((was === null) !== (this.gate === null)) this.swapPanel();
    else this.syncLive();
  }

  /**
   * Rebuild the panel beside Send, and only the panel: the fields are never
   * touched, so the caret, the phone keyboard and an IME composition survive.
   *
   * If focus was inside the old panel (on Send, or on the tick), it goes to
   * what now needs doing: the tick when the gate has just appeared, Send when
   * it has just gone.
   */
  private swapPanel(): void {
    const d = this.o.doc;
    const old = this.o.root.querySelector<HTMLElement>('.compose-panel');
    if (!old) return;
    const active = d.activeElement;
    const hadFocus = !!active && old.contains(active);
    const next = this.buildPanel(d);
    // The outcome already on screen moves across as it is: a new alert node
    // with the same words would be announced a second time.
    const said = old.querySelector('[data-send-result]');
    if (said) next.querySelector('[data-send-result]')?.replaceWith(said);
    old.replaceWith(next);
    if (!hadFocus || !focusIsLost(d)) return;
    const target = next.querySelector<HTMLInputElement>('[data-big-send] input[type=checkbox]')
      ?? next.querySelector<HTMLButtonElement>('[data-send]');
    // A disabled Send cannot take focus; the shell's focus keeper waits for it.
    if (target && !target.disabled) target.focus({ preventScroll: true });
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
        this.clearProblem(key);
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
        data: { audience: a },
        attrs: {
          type: 'button', 'aria-pressed': String(this.audienceType === a),
          'data-focus-key': `compose-audience-${a}`,
        },
      });
      chip.addEventListener('click', () => {
        this.audienceType = a;
        this.clearProblem('audience');
        // The audience IS the cost. Changing it invalidates any
        // acknowledgement of the previous one.
        this.bigSendAcknowledged = false;
        void this.refreshEstimate();
        // In place, not render(): the pressed chip keeps focus. A rebuild
        // dropped focus to <body>, the next Tab landed on "সবাই" at the top,
        // and Enter there silently widened the audience to everyone.
        this.syncAudience();
        this.syncLive();
      });
      chips.append(chip);
    }
    wrap.append(chips);

    const list = this.sectionsList(d);
    if (list) wrap.append(list);

    if (this.fieldError?.field === 'audience') {
      // Tied to the chips by description, the way `setFieldError` ties a text
      // field to its error. Not an alert: the same sentence is the alert
      // beside Send, where the person who pressed it is looking, and two
      // alerts would say it twice.
      const errId = uid('aud-err');
      chips.setAttribute('aria-describedby', errId);
      wrap.append(el(d, 'p', {
        className: 'ui-field-error', attrs: { id: errId },
      }, ...numText(d, this.fieldError.message)));
    }
    return wrap;
  }

  /** For a section audience, the list under the chips in its three states; otherwise null. */
  private sectionsList(d: Document): HTMLElement | null {
    if (this.audienceType !== 'section') return null;
    const list = el(d, 'div', { className: 'audience-sections' });
    if (this.sectionsState === 'loading') {
      list.append(listSkeleton(d, 3));
    } else if (this.sectionsState === 'failed') {
      list.append(errorState(d, 'শাখার তালিকা আনা যায়নি।', () => {
        this.sectionsState = 'loading';
        this.syncAudience();
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
        this.clearProblem('audience');
        this.bigSendAcknowledged = false;
        void this.refreshEstimate();
        this.syncLive();
      });
      list.append(el(d, 'label', { className: 'audience-section', data: { id: s.id } },
        box, el(d, 'span', {}, ...numText(d, s.label))));
    }
    return list;
  }

  /**
   * The chips' pressed state and the section list under them, in place.
   *
   * Used for a chip press, the section list arriving, and its retry — none of
   * which may rebuild the title or body someone is typing in. If focus was in
   * the old list (the retry button, now a skeleton), it goes to the pressed
   * chip just above rather than to <body>.
   */
  private syncAudience(): void {
    const d = this.o.doc;
    const root = this.o.root;
    const chips = root.querySelector<HTMLElement>('.audience-chips');
    if (!chips) return;
    for (const chip of chips.querySelectorAll<HTMLElement>('.audience-chip')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.audience === this.audienceType));
    }
    const old = root.querySelector<HTMLElement>('.audience-sections');
    const active = d.activeElement;
    const hadFocus = !!old && !!active && old.contains(active);
    const next = this.sectionsList(d);
    if (old && next) old.replaceWith(next);
    else if (old) old.remove();
    else if (next) chips.after(next);
    if (hadFocus && focusIsLost(d)) {
      chips.querySelector<HTMLElement>('.audience-chip[aria-pressed="true"]')
        ?.focus({ preventScroll: true });
    }
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
        this.clearProblem('category');
        // The category suggests a default until the author touches the toggle;
        // after that it is theirs.
        const hadSms = this.sendSms;
        if (!this.smsTouched) this.sendSms = smsDefaultFor(this.category);
        if (this.sendSms !== hadSms) {
          // জরুরি turned SMS on for the author, which is the same change as
          // ticking the box: it takes the cost from zero to the audience, so
          // it re-asks now, and a tick given for the old send does not carry
          // over. Without this the estimate still said "no SMS" — Send stayed
          // ungated for a 900-phone send until the next pause in typing.
          this.bigSendAcknowledged = false;
          void this.refreshEstimate();
        }
        // In place: the select keeps focus, so the next ArrowDown moves it
        // again instead of scrolling the page.
        this.syncSms();
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
    // Honest about the granularity rather than implying minute precision the
    // nightly sweeper cannot deliver.
    const whenHelp = () => (this.publishAt
      ? 'নির্ধারিত সময়ের পর পরবর্তী রক্ষণাবেক্ষণ চক্রে পাঠানো হবে।'
      : 'খালি রাখলে এখনই পাঠানো হবে।');
    const help = el(d, 'p', {
      className: 'ui-field-help', attrs: { id: whenHelpId }, text: whenHelp(),
    });
    at.addEventListener('change', () => {
      this.publishAt = at.value;
      // Before swapPanel, which would otherwise carry the last send's outcome
      // into the new panel.
      this.startNextNotice();
      // In place: a rebuild threw the field away under the person still
      // adjusting it, and focus with it. The panel carries the send button,
      // whose label names the time.
      help.textContent = whenHelp();
      this.swapPanel();
    });
    options.append(el(d, 'div', { className: 'ui-field' },
      el(d, 'label', { className: 'ui-field-label', attrs: { for: whenId } },
        el(d, 'span', { text: 'কখন পাঠানো হবে' })),
      el(d, 'div', { className: 'ui-field-control' }, at),
      help));

    // ── How ──
    const smsBox = el(d, 'input', {
      attrs: { type: 'checkbox', 'data-sms-toggle': '', 'data-focus-key': 'compose-sms' },
    });
    smsBox.checked = this.sendSms;
    smsBox.addEventListener('change', () => {
      this.sendSms = smsBox.checked;
      this.smsTouched = true;
      this.startNextNotice();
      // Turning SMS on is the single change that takes the cost from zero to
      // whatever the audience is, so it re-asks immediately rather than after
      // the typing debounce.
      this.bigSendAcknowledged = false;
      void this.refreshEstimate();
      // In place: the box keeps focus (a rebuild sent it to <body>).
      this.syncSms();
    });
    const sms = el(d, 'div', { className: 'compose-sms' },
      // The checkbox stays the label's direct child: the whole row is the target.
      el(d, 'label', { className: 'sms-toggle' },
        smsBox, el(d, 'span', { text: 'মোবাইলে এসএমএসও পাঠান' })),
      el(d, 'p', { className: 'ui-field-help', text: 'অ্যাপের নোটিফিকেশনে সবসময় যাবে।' }));
    if (this.sendSms) sms.append(this.smsNote(d));
    options.append(sms);
    return options;
  }

  /**
   * SMS is an alert, not the notice. Saying so beside the toggle is what stops
   * someone pasting four paragraphs in and wondering why the bill grew.
   */
  private smsNote(d: Document): HTMLElement {
    return el(d, 'p', {
      className: 'ui-field-help',
      attrs: { 'data-sms-note': '' },
      text: 'এসএমএসে সংক্ষিপ্ত বার্তা যাবে; পুরো নোটিশ অ্যাপে থাকবে।',
    });
  }

  /**
   * The counter row under the body: characters, and with SMS on the segment
   * cost and the Bangla 70-character rule.
   */
  private countRow(d: Document): HTMLElement {
    const live = this.liveText();
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
    return count;
  }

  /**
   * Everything the SMS toggle decides, in place: the box (a category can set
   * it), the note beside it, the counter row, the figures. Never the fields.
   */
  private syncSms(): void {
    const d = this.o.doc;
    const root = this.o.root;
    const box = root.querySelector<HTMLInputElement>('[data-sms-toggle]');
    if (box && box.checked !== this.sendSms) box.checked = this.sendSms;
    const sms = root.querySelector<HTMLElement>('.compose-sms');
    const note = sms?.querySelector('[data-sms-note]');
    if (this.sendSms && sms && !note) sms.append(this.smsNote(d));
    if (!this.sendSms) note?.remove();
    // The row holds no control, so replacing it cannot move focus.
    root.querySelector('.compose-count')?.replaceWith(this.countRow(d));
    this.syncLive();
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
        // No subject: permissionMessage(subject) says "… দেখার অনুমতি", and
        // "নোটিশ পাঠানো দেখার অনুমতি" (permission to SEE sending) is not the
        // refusal. The page header already names the task.
        message: permissionMessage(),
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

    // ── The white body ──────────────────────────────────────────────
    const body = el(d, 'div', { className: 'compose-body' });
    body.append(this.audienceField(d));
    this.field(body, 'শিরোনাম', 'title', { max: NOTICE_LIMITS.title });
    const bf = this.field(body, 'বার্তা', 'body', { multiline: true, max: NOTICE_LIMITS.body });
    bf.root.append(this.countRow(d));
    body.append(this.optionsBlock(d));

    root.append(el(d, 'div', { className: 'compose' }, body, this.buildPanel(d)));
  }

  /**
   * The panel: what is about to happen, and the one button. One builder for
   * render() and swapPanel(), so the first paint and a gate that appears
   * mid-typing are the same panel.
   */
  private buildPanel(d: Document): HTMLElement {
    const live = this.liveText();
    const gate = this.gate;
    const panel = el(d, 'div', {
      className: 'compose-panel',
      attrs: { 'data-gated': gate ? 'true' : null },
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

    const lineId = uid('compose-line');
    panel.append(el(d, 'p', { className: 'compose-line', attrs: { id: lineId } },
      el(d, 'span', { className: 'compose-line-label', text: 'পাবে:' }), ' ',
      el(d, 'span', { attrs: { 'data-audience-line': '' } },
        ...numText(d, this.audienceSentence()))));

    const result = this.resultNode(d);
    if (result) panel.append(result);

    const send = button(d, {
      label: this.busy
        ? 'পাঠানো হচ্ছে…'
        : this.publishAt ? 'নির্ধারিত সময়ে পাঠান' : 'পাঠান',
      variant: 'primary',
      busy: this.busy,
      // The label changes (পাঠান / নির্ধারিত সময়ে পাঠান / পাঠানো হচ্ছে…); the
      // key does not, so the shell's focus keeper finds it across a rebuild.
      // Described by the "পাবে:" line: who it goes to, and — while no section
      // is ticked — why it is waiting.
      attrs: { 'data-send': '', 'data-focus-key': 'compose-send', 'aria-describedby': lineId },
      onClick: () => { void this.send(); },
    });

    if (gate) {
      // Above the threshold the send button is not enough. A notice to a whole
      // school cannot be recalled from nine hundred phones, and the moment to
      // notice that is before the click, not in the invoice.
      const irrev = irreversiblePanel(d, {
        statement: 'পাঠানো হয়ে গেলে আর ফেরানো যায় না।',
        detail: `${toBnGrouped(gate.confirmThreshold)}টির বেশি এসএমএস — টিক না দিলে পাঠানো যাবে না।`,
        items: this.ackItems(gate),
        confirm: send,
        actions: [send],
        className: 'compose-irrev',
        onChange: (ticked) => {
          this.bigSendAcknowledged = ticked;
          this.syncLive();
        },
      });
      irrev.root.setAttribute('data-big-send', '');
      // Its id is generated per build; the key survives one.
      irrev.input.setAttribute('data-focus-key', 'compose-big-send-ack');
      irrev.input.checked = this.bigSendAcknowledged;
      panel.append(irrev.root);
    } else {
      panel.append(buttonRow(d, send));
    }
    // After the panel has had its say: busy, empty, and the gate together.
    send.disabled = this.sendDisabled();
    return panel;
  }

  /**
   * What the last send came to — sent, refused, or offline — or null.
   *
   * In the panel, between the "পাবে:" line and Send. It used to sit at the top
   * of the page, above the form: on a 375px phone the person pressing Send is
   * a screen and a half below it, so a refusal rendered out of sight (6px
   * above the viewport) and the tap looked like it did nothing.
   *
   * Focusable (tabindex -1) because `settle` puts focus on the sentence after
   * a send, when Send itself is disabled. No retry button on an error: Send,
   * just below, is the retry, and the typed notice is still in the form.
   */
  private resultNode(d: Document): HTMLElement | null {
    if (!this.notice) return null;
    let node: HTMLElement;
    if (this.noticeKind === 'ok') {
      node = successNote(d, this.notice);
      node.setAttribute('role', 'status');
    } else if (this.noticeKind === 'offline') {
      node = el(d, 'p', {
        className: 'offline-banner', attrs: { role: 'alert' },
      }, icon(d, 'wifi-off', 'offline-icon'), el(d, 'span', { text: this.notice }));
    } else {
      node = errorState(d, this.notice);
    }
    node.classList.add('compose-notice');
    node.setAttribute('data-send-result', '');
    node.setAttribute('tabindex', '-1');
    return node;
  }
}
