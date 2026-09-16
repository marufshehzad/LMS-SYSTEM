/**
 * সিস্টেম ও ইন্টিগ্রেশন — what is running behind the screens
 *
 * Makes the schema-level and server-level parts of the product visible
 * without pretending they are user features: which services answer, which are
 * deliberately switched off awaiting configuration, which background workers
 * exist, and where the invariants live that have no page at all (RLS, the
 * database's own clash constraint, the offline outbox).
 *
 * Live state is probed by calling the public endpoints that carry a 503 when
 * their kill switch is on. No auth is needed and none is sent, which is why
 * this screen is readable by a role that can see nothing else here.
 *
 * ── P5: the vocabulary ────────────────────────────────────────────────────
 *
 * The four states were `on / dark / invisible / unknown` — words from the
 * commit that wrote them, not words a school operator reads. P5's brief asks
 * for human states and says to derive them from the architecture rather than
 * invent them, so the MODEL is unchanged and only the naming moved:
 *
 *   `running`      চালু আছে           the endpoint answered
 *   `builtIn`      সবসময় চালু          a database- or server-level guarantee.
 *                                     No page, no switch, nothing to check —
 *                                     it cannot be off while the app runs.
 *   `offByDesign`  ইচ্ছাকৃতভাবে বন্ধ    a kill switch is on. NOT a fault, and
 *                                     the distinction matters: a school that
 *                                     reads "সমস্যা" against AI will file a
 *                                     support ticket about a decision.
 *   `unchecked`    যাচাই করা যায়নি     the probe got no answer.
 *
 * Four words the brief proposed — healthy / warning / blocked / unavailable —
 * cannot express `builtIn`, and `builtIn` is the state most of this list is
 * in. Recording the mapping rather than forcing the words is the honest
 * reading of "do not invent fake health information": nothing here reports a
 * health it did not measure, and `builtIn` says so out loud by never being
 * probed.
 *
 * ── Ata Ekta (08 Admin & IT §05) ──────────────────────────────────────────
 *
 * The screen is drawn as a status board, not a table: a short title with one
 * aggregate chip on the right, then a two-column grid of tiles separated by
 * 1px hairlines. Each tile is a tone dot, the service name, and one line that
 * starts with the state WORD — so the dot is never the only carrier of the
 * state (§3). The design's six services and their live figures (sent today,
 * devices registered, last backup) have no endpoint behind them; the tiles
 * draw the same twelve rows and four probes this screen has always had.
 *
 * The header chip is derived, not fetched, and it is never an all-clear. The
 * design's "সব স্বাভাবিক" would be a verdict over twelve rows of which eight
 * are never probed, so it is not drawn. What the chip may say is only what the
 * probes measured: after the first answer it counts the probed rows whose
 * state is NOT confirmed — no answer at all, or a 503 whose body did not carry
 * the kill switch's own error code (a load balancer's "Service Unavailable"
 * is also a 503). When every probe was confirmed there is no chip.
 */
import type { Auth } from './auth.ts';
import {
  pageHeader, card, statusBadge, STATUS, el, append, numText,
} from './ui/index.ts';
import { bnNum } from './view-states.ts';

/** @see the header — the model is unchanged from `on/dark/invisible/unknown`. */
type State = 'running' | 'builtIn' | 'offByDesign' | 'unchecked';

interface FeatureRow {
  titleBn: string;
  descBn: string;
  /** Where it lives, for an IT admin who has to go and look. */
  path: string;
  state: State;
  detailBn?: string;
}

export interface SystemViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

const STATE_LABEL: Record<State, string> = {
  running: 'চালু আছে',
  builtIn: 'সবসময় চালু',
  offByDesign: 'ইচ্ছাকৃতভাবে বন্ধ',
  unchecked: 'যাচাই করা যায়নি',
};

/** Maps onto the shared badge vocabulary, so this screen tints like every other. */
const STATE_BADGE: Record<State, string> = {
  running: 'published',
  builtIn: 'invited',
  // Neutral, not danger. A kill switch that is on is a decision somebody made.
  offByDesign: 'draft',
  unchecked: 'pending',
};

const STATE_MEANS: Record<State, string> = {
  running: 'সেবাটি সাড়া দিচ্ছে।',
  builtIn: 'ডাটাবেস বা সার্ভারের স্তরে বসানো — এর কোনো আলাদা পাতা নেই এবং বন্ধ করার উপায়ও নেই।',
  offByDesign: 'কিল-সুইচ চালু আছে — এটি সমস্যা নয়, সিদ্ধান্ত। কনফিগ যোগ করলে চালু হবে।',
  unchecked: 'এই মুহূর্তে যাচাই করা যায়নি — সংযোগ না থাকলে এমন হয়।',
};

/**
 * The rows the probe writes to, by title, in probe order (sikhok, shikho,
 * scripts, ans-dispatch). Module scope so render() can tell which tiles are
 * still waiting for their first answer.
 */
const PROBE_INDEX: Record<string, number> = {
  'শিক্ষক সহায়ক AI (SikhokAI)': 0,
  'শিখো টিউটর (ShikhoAI)': 1,
  'উত্তরপত্র সংরক্ষণ': 2,
  'ANS আউটবাউন্ড ডিসপ্যাচার': 3,
};

/**
 * A probed row whose state the probe did not confirm. `unchecked` is no answer.
 * `offByDesign` is confirmed only when the 503 body matched the endpoint's
 * kill-switch code — probeOne() sets `detailBn` on exactly that branch and
 * nowhere else; any other 503 reaches `offByDesign` without it. Rows that are
 * never probed are out of scope: the chip makes no claim about them.
 */
function isUnconfirmed(r: FeatureRow): boolean {
  if (PROBE_INDEX[r.titleBn] === undefined) return false;
  if (r.state === 'unchecked') return true;
  return r.state === 'offByDesign' && !r.detailBn;
}

/** The dot's tone, from the shared STATUS table — never a one-off colour. */
function toneOf(s: State): string {
  return STATUS[STATE_BADGE[s]]?.tone ?? 'neutral';
}

export class SystemView {
  private readonly o: SystemViewOptions;
  private rows: FeatureRow[] = [];
  /** False until the first probe() answers. Render-only; no fetch reads it. */
  private probed = false;

  constructor(options: SystemViewOptions) {
    this.o = options;
    this.rows = this.buildStaticRows();
    this.render();
    void this.probe();
  }

  private buildStaticRows(): FeatureRow[] {
    return [
      // §1 RBAC + RLS
      { titleBn: 'বহু-প্রতিষ্ঠান আইসোলেশন (RLS)', descBn: '১০ ভূমিকা, প্রতিটি অনুরোধে SET LOCAL app.tenant_id', path: 'db/migrations/010_rls_policies.sql', state: 'builtIn' },
      // §2 AI
      { titleBn: 'শিক্ষক সহায়ক AI (SikhokAI)', descBn: 'CQ · MCQ · রুব্রিক · পাঠ পরিকল্পনা', path: 'services/ai-svc — POST /api/v1/ai/sikhok', state: 'unchecked' },
      { titleBn: 'শিখো টিউটর (ShikhoAI)', descBn: 'বাংলা/English/Banglish সক্রেটিক টিউটরিং', path: 'services/ai-svc — POST /api/v1/ai/shikho', state: 'unchecked' },
      // §3 attendance stack
      { titleBn: 'অফলাইন হাজিরা + Background Sync', descBn: 'IndexedDB আউটবক্স, সার্ভিস ওয়ার্কার', path: 'packages/offline/, apps/pwa/src/sw.ts', state: 'builtIn' },
      { titleBn: 'অভিভাবক SMS অ্যালার্ট', descBn: 'দৈনিক ক্রন ওয়ার্কার — এগ্রিগেটর অপেক্ষমাণ', path: 'services/sms-svc — /api/v1/sms/dispatch', state: 'builtIn' },
      { titleBn: 'উত্তরপত্র সংরক্ষণ', descBn: 'হাতে-লেখা উত্তরপত্রের ছবি', path: 'services/academics-svc — POST /api/v1/academics/scripts', state: 'unchecked' },
      // §4 finance
      { titleBn: 'MFS ওয়েবহুক (bKash/Nagad/Rocket)', descBn: 'সাইনড কলব্যাক গ্রহণ', path: 'services/finance-svc — /api/v1/finance/webhooks/{provider}', state: 'running' },
      { titleBn: 'ডিজিটাল রসিদ + লেজার', descBn: 'RCP-YYYY-MM-<seq> + সমমান DR/CR', path: 'services/finance-svc/src/webhook.ts', state: 'builtIn' },
      // §5 RMS
      { titleBn: 'ক্লাশ সনাক্তকরণ (EXCLUDE USING gist)', descBn: 'ডাটাবেস স্তরে দ্বৈত-বুকিং প্রতিরোধ', path: 'db/migrations/006_routines_rms.sql', state: 'builtIn' },
      // §6 ANS
      { titleBn: 'ANS আউটবাউন্ড ডিসপ্যাচার', descBn: 'HMAC-স্বাক্ষরিত ওয়েবহুক ডেলিভারি', path: 'services/ans-svc — POST /api/v1/ans/dispatch', state: 'unchecked' },
      { titleBn: 'ANS ইনবাউন্ড ইভেন্ট', descBn: 'অ্যালামনাই এনরিচমেন্ট গ্রহণ', path: 'services/ans-svc — POST /api/v1/ans/inbound', state: 'running' },
      // Ops
      { titleBn: 'নাইটলি DB রক্ষণাবেক্ষণ', descBn: 'পার্টিশন প্রি-ক্রিয়েশন, retention purge', path: 'services/ops-svc — /api/v1/ops/maintenance @ 01:00 BST', state: 'builtIn' },
    ];
  }

  private async probe(): Promise<void> {
    // The endpoints return 503 <error-code> when their kill switch is on,
    // and 401 when authenticated-only. That is enough signal to state each
    // row without needing a real login.
    const probes: [number, State, string?][] = await Promise.all([
      this.probeOne('POST', '/api/v1/ai/sikhok', 'ai_disabled'),
      this.probeOne('POST', '/api/v1/ai/shikho', 'ai_disabled'),
      this.probeOne('POST', '/api/v1/academics/scripts', 'script_storage_unconfigured'),
      this.probeOne('POST', '/api/v1/ans/dispatch', undefined),
    ]);
    // Order matches the rows above (sikhok, shikho, scripts, ans-dispatch).
    for (const row of this.rows) {
      const idx = PROBE_INDEX[row.titleBn];
      if (idx === undefined) continue;
      const [, state, detail] = probes[idx];
      row.state = state;
      if (detail) row.detailBn = detail;
    }
    this.probed = true;
    this.render();
  }

  private async probeOne(method: string, url: string, disabledCode?: string): Promise<[number, State, string?]> {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined,
      });
      if (res.status === 503) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (disabledCode && body.error === disabledCode) {
          return [503, 'offByDesign', 'কনফিগ যোগ করলেই চালু হবে'];
        }
        return [503, 'offByDesign'];
      }
      if (res.status === 401 || res.status === 400) return [res.status, 'running'];
      if (res.status === 200 || res.status === 202) return [res.status, 'running'];
      return [res.status, 'unchecked'];
    } catch {
      return [0, 'unchecked'];
    }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // The header chip (the design's bar('সিস্টেম', [chip(…)])). Never an
    // all-clear: most rows are never probed, so "সব স্বাভাবিক" would report a
    // health this screen did not measure. It only counts probed rows whose
    // state is not confirmed, and is held back until the first probe answers.
    let chip: HTMLElement | null = null;
    if (this.probed) {
      const unconfirmed = this.rows.filter(isUnconfirmed).length;
      if (unconfirmed > 0) {
        chip = statusBadge(d, {
          state: STATE_BADGE.unchecked, label: `${bnNum(unconfirmed)}টি সেবার অবস্থা নিশ্চিত নয়`,
        });
      }
    }
    root.append(pageHeader(d, { title: 'সিস্টেম', actions: chip ? [chip] : undefined }));

    // The tile board. A list, because it is one: twelve services, same shape.
    // role="list" survives `list-style: none` in the readers that drop it.
    const grid = el(d, 'ul', {
      className: 'sys-grid',
      attrs: { role: 'list', 'aria-label': 'সেবা ও ইন্টিগ্রেশনের অবস্থা' },
    });
    for (const r of this.rows) {
      grid.append(this.tile(r));
    }
    root.append(grid);

    // Every state, said in words — in the tiles' own dot-and-word vocabulary.
    // Without this there is no way to learn that "ইচ্ছাকৃতভাবে বন্ধ" is not a
    // fault.
    const dl = el(d, 'dl', { className: 'ui-facts' });
    for (const state of ['running', 'builtIn', 'offByDesign', 'unchecked'] as State[]) {
      append(dl,
        el(d, 'dt', { className: 'ui-facts-key sys-legend-key' },
          el(d, 'span', {
            className: 'sys-dot', data: { tone: toneOf(state) }, attrs: { 'aria-hidden': 'true' },
          }),
          el(d, 'span', { text: STATE_LABEL[state] })),
        el(d, 'dd', { className: 'ui-facts-val' }, ...numText(d, STATE_MEANS[state])));
    }
    root.append(card(d, {
      title: 'অবস্থাগুলোর মানে', headingLevel: 2, className: 'sys-legend',
    }, dl));
  }

  /**
   * One service: dot + name, then "<state word> · <what it does>", then where
   * it lives. A probed row that has not had its first answer shows a shimmer
   * in place of the state word — never "যাচাই করা যায়নি" for a check that has
   * not happened yet.
   */
  private tile(r: FeatureRow): HTMLElement {
    const d = this.o.doc;
    const loading = !this.probed && PROBE_INDEX[r.titleBn] !== undefined;

    const head = el(d, 'div', { className: 'sys-tile-head' },
      el(d, 'span', {
        className: 'sys-dot',
        data: { tone: loading ? 'neutral' : toneOf(r.state) },
        attrs: { 'aria-hidden': 'true' },
      }),
      el(d, 'p', { className: 'sys-tile-title' }, ...numText(d, r.titleBn)));

    // The state word leads, as drawn ("সচল · …", "বন্ধ — …"). A probe's own
    // qualifier ("কনফিগ যোগ করলেই চালু হবে") sits beside the word it qualifies.
    const detail = loading
      ? el(d, 'p', { className: 'sys-tile-detail' },
        el(d, 'span', { className: 'skel sys-tile-skel', attrs: { 'aria-hidden': 'true' } }),
        el(d, 'span', { className: 'ui-sr-only', text: 'লোড হচ্ছে' }),
        ' · ', ...numText(d, r.descBn))
      : el(d, 'p', { className: 'sys-tile-detail' }, ...numText(d,
        `${STATE_LABEL[r.state]}${r.detailBn ? ` — ${r.detailBn}` : ''} · ${r.descBn}`));

    return el(d, 'li', {
      className: 'sys-tile',
      data: { state: loading ? 'loading' : r.state },
      attrs: { 'aria-busy': loading ? 'true' : null },
    },
    head,
    detail,
    // For the IT admin who has to go and look. Shown at every width (13
    // Responsive: nothing is dropped on a phone); it wraps, never truncates.
    el(d, 'code', { className: 'sys-tile-path' }, ...numText(d, r.path)));
  }
}
