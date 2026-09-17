/**
 * The shikhonBD Platform Operations Center.  (P7)
 *
 * Not a restyle of the R-7 console: a different product on the same
 * credentials. R-7 built a PROVISIONING tool — create a school, brand it,
 * make the first admin, import a roster — and it does that well. What it
 * could not do is OPERATE the schools afterwards, which is what a team
 * running forty institutions actually spends its day on.
 *
 * ── What P7-1's inventory found, and what this is for ─────────────────────
 *
 * `app.set_tenant_status` wrote `tenants.status`, the console had a button
 * for it, the audit log recorded it — and not one line of application code
 * read that column. An operator could suspend a school, get a success
 * message, and the school kept working.
 *
 * So the console is only half the fix. Migrations 051/052 made the state
 * real; this is the surface that lets a person see and change it without
 * writing SQL. Every control here maps to a database function that bites, and
 * every one of them says what it will do before it does it.
 *
 * ── Canonical, but denser ────────────────────────────────────────────────
 * Same tokens, same primitives, same shell as every tenant screen (§31). What
 * differs is density: an operator comparing forty schools needs a table, not
 * forty cards, and needs the numbers that decide an action in the same row as
 * the action.
 */
import {
  pageHeader, sectionHeading, card, button, buttonRow, dataTable, statusBadge,
  statRow, statCard, field, setFieldError, clearFieldError, tabs, openDrawer,
  listSkeleton, permissionState, permissionMessage, humanError, list, listItem, avatar,
  numText, el, append, focusIsLost, type OverlayHandle, type Field, type Child,
} from './ui/index.ts';
import {
  emptyState, errorState, successNote, confirmDialog, bnDate, bnDateTime,
} from './view-states.ts';
import { formatBdt, formatCount, todayLocalIso } from '../../../packages/ui-core/src/format.ts';

const bn = (n: number): string => formatCount(n, 'bn');

/** How many attention rows the dashboard shows before it says "and N more". */
const QUEUE_LIMIT = 20;

/** How many recent platform actions the dashboard shows. */
const FEED_LIMIT = 12;

// ── Shapes the platform API returns ────────────────────────────────────

export interface TenantOverview {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  stream: string;
  level: string;
  district: string | null;
  status: string;
  access: 'full' | 'read_only' | 'none';
  opsState: string;
  billingState: string;
  stateReason: string | null;
  planCode: string;
  planName: string | null;
  planPrice: string | null;
  billingCycle: string | null;
  studentCap: number;
  studentCount: number;
  userCount: number;
  paidTotal: string;
  nextDueOn: string | null;
  graceUntil: string | null;
  trialEndsOn: string | null;
  createdAt: string;
  /** Last real sign-in or product event. Null = never used. */
  lastActiveAt: string | null;
  portals: Record<string, boolean>;
  services: Record<string, string>;
}

export interface ServiceRow { code: string; nameBn: string; effectBn: string; dependsOn: string[]; inLimited: boolean }
export interface PlanRow {
  code: string; nameBn: string; priceBdt: string; billingCycle: string;
  studentCap: number; services: Record<string, boolean>; trialDays: number;
  graceDays: number; isActive: boolean;
}
export interface PaymentRow {
  amountBdt: string; paidOn: string; method: string; reference: string | null;
  note: string | null; coversUntil: string | null; recordedAt: string;
}
export interface AuditRow {
  id: string; reason: string | null; statement: string | null; at: string;
  /** Present on the cross-institution feed; null for a platform-wide act. */
  tenantId?: string | null;
  /**
   * WHO did it — P10-5, closing B-39.
   *
   * `null` where the credential is not in the operator directory, which the
   * screen says out loud rather than pretending. The actor's ID never leaves
   * the server: "never expose raw UUIDs" still holds, and a truncated one
   * would look like an identity while being a fragment.
   */
  actor?: string | null;
  actorRevoked?: boolean;
}

/** One named platform credential. Holds no secret. */
export interface OperatorRow {
  id: string; fullName: string; email: string | null;
  status: 'active' | 'revoked'; note: string | null;
  createdAt: string; lastSeenAt: string | null; revokedAt: string | null;
  actions: number; lastAction: string | null;
}
export interface Operations {
  access: string; opsState: string; billingState: string;
  reasonBn: string | null; until: string | null;
  stateReason: string | null; stateChangedAt: string | null; stateUntil: string | null;
  portals: Record<string, boolean>;
  serviceOverrides: Record<string, string>;
  planCode: string; planName: string | null; planPrice: string | null;
  billingCycle: string | null; graceDays: number | null;
  planCap: number | null; planServices: Record<string, boolean>;
  studentCap: number; studentCount: number;
  nextDueOn: string | null; graceUntil: string | null; graceReason: string | null;
  trialEndsOn: string | null;
}

// ── Vocabulary ─────────────────────────────────────────────────────────

/**
 * The four operational states, as a person reads them.
 *
 * `limited` and `suspended` are deliberately different words with different
 * tones: one is a bill and the other is a decision, and an operator must
 * never reach for the wrong one because they looked alike.
 */
export const OPS_BN: Record<string, { label: string; state: string; effect: string }> = {
  active: {
    label: 'সক্রিয়', state: 'published',
    effect: 'প্ল্যানে যা আছে, সব কিছু চলছে।',
  },
  maintenance: {
    label: 'রক্ষণাবেক্ষণ', state: 'invited',
    effect: 'শুধু দেখা যাবে — কোনো পরিবর্তন সংরক্ষণ হবে না। '
      + 'এটি আমাদের সিদ্ধান্ত, বকেয়ার সাথে সম্পর্ক নেই।',
  },
  limited: {
    label: 'সীমিত', state: 'partial',
    effect: 'শুধু দেখা যাবে। হাজিরা, ফলাফল, নোটিশ ও শিক্ষাপঞ্জি পড়া যাবে; '
      + 'নতুন কিছু লেখা যাবে না।',
  },
  suspended: {
    label: 'স্থগিত', state: 'overdue',
    effect: 'প্রতিষ্ঠানের কেউ প্রবেশ করতে পারবেন না। '
      + 'কোনো তথ্য মুছবে না — সব অক্ষত থাকবে এবং পুনরায় চালু করলে ফিরে আসবে।',
  },
};

export const BILLING_BN: Record<string, { label: string; state: string }> = {
  trial:        { label: 'ট্রায়াল',       state: 'invited' },
  active:       { label: 'পরিশোধিত',     state: 'published' },
  grace_period: { label: 'ছাড়ের মেয়াদে', state: 'partial' },
  limited:      { label: 'বকেয়া',        state: 'overdue' },
};

export const SERVICE_STATE_BN: Record<string, { label: string; state: string }> = {
  enabled:     { label: 'চালু',            state: 'published' },
  limited:     { label: 'শুধু পড়া',        state: 'partial' },
  maintenance: { label: 'রক্ষণাবেক্ষণ',    state: 'invited' },
  disabled:    { label: 'বন্ধ',            state: 'overdue' },
  not_in_plan: { label: 'প্ল্যানে নেই',    state: 'draft' },
  unknown:     { label: 'অজানা',           state: 'draft' },
};

export const PORTAL_BN: Record<string, string> = {
  principal: 'প্রধান শিক্ষক ও মালিক',
  it_admin: 'আইটি অ্যাডমিন',
  teacher: 'শিক্ষক ও কর্মী',
  student: 'শিক্ষার্থী',
  guardian: 'অভিভাবক',
};

export const METHOD_BN: Record<string, string> = {
  bank: 'ব্যাংক', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket',
  cash: 'নগদ', cheque: 'চেক', other: 'অন্যান্য',
};

/**
 * What the server counted, over the WHOLE fleet.  (P10-2)
 *
 * The dashboard above the list used to sum these in the browser from every
 * school it had downloaded. That is why the list could not be paginated: page
 * one of twenty-five would have reported twenty-five schools' students as the
 * country's total. One 45ms query answers all of it now.
 */
export interface FleetSummary {
  total: number;
  attention: { critical: number; warning: number; info: number };
  access: { full: number; readOnly: number; none: number };
  billing: { trial: number; active: number; grace: number; overdue: number };
  usage: { students: number; users: number; classes: number; sections: number;
           paid: number };
  quiet: number; neverActive: number;
  planUsage: Record<string, number>;
}

/** Which page of the fleet is on screen, as the server drew it. */
export interface FleetPage {
  page: number; size: number; total: number; pages: number;
  sort: string; dir: string;
}

// ── Attention ──────────────────────────────────────────────────────────

export interface Attention {
  tenantId: string;
  nameBn: string;
  kind: string;
  labelBn: string;
  /** Higher sorts first. Money and lock-outs outrank a cap warning. */
  weight: number;
}

/**
 * What needs a person today, derived from the same rows the table shows.
 *
 * Deliberately NOT a separate endpoint: an attention queue computed from
 * different data than the list beside it is an attention queue that
 * eventually disagrees with the list beside it.
 */
/** How long a school may sit empty before it stops being "being set up". */
export const ONBOARDING_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Created a while ago and still has nobody in it.
 *
 * Deliberately not an alert: nothing is broken and nothing is urgent. It is a
 * number an operator should be able to see and filter by — §1's "recently
 * inactive" — and that is all.
 */
export function isDormant(t: TenantOverview, now = Date.now()): boolean {
  if (t.studentCount > 0 || t.userCount > 1) return false;
  const born = Date.parse(t.createdAt);
  if (Number.isNaN(born)) return false;
  return now - born > ONBOARDING_WINDOW_DAYS * DAY_MS;
}

/** Created within the onboarding window — §1's "recently onboarded". */
export function isRecent(t: TenantOverview, now = Date.now()): boolean {
  const born = Date.parse(t.createdAt);
  if (Number.isNaN(born)) return false;
  return now - born <= ONBOARDING_WINDOW_DAYS * DAY_MS;
}

/** How long a school may go untouched before it is worth asking about. */
export const QUIET_DAYS = 30;

/**
 * Set up, and then nobody came back — §26's "recently inactive".
 *
 * Distinct from `isDormant`, which is about a school that was never filled
 * in. This one has students and users and has simply not been OPENED, which
 * is the quieter and more expensive failure: a school that was onboarded,
 * invoiced, and is not being used.
 *
 * Measured from real sign-ins and real product events (migration 057). A
 * school created three days ago with nobody in it yet is not "quiet" — it is
 * new, and `isRecent` already counts it.
 */
export function isQuiet(t: TenantOverview, now = Date.now()): boolean {
  if (isRecent(t, now) || isDormant(t, now)) return false;
  if (!t.lastActiveAt) return true;
  const seen = Date.parse(t.lastActiveAt);
  if (Number.isNaN(seen)) return false;
  return now - seen > QUIET_DAYS * DAY_MS;
}

export function attentionQueue(rows: TenantOverview[], now = Date.now()): Attention[] {
  const out: Attention[] = [];
  for (const t of rows) {
    // Ranked by how many people are stopped, not by how alarming it sounds.
    // A suspended school is a total outage; an overdue one still works for
    // reading; a full roll stops only the next admission.
    if (t.access === 'none') {
      out.push({ tenantId: t.id, nameBn: t.nameBn, kind: 'suspended', weight: 100,
        labelBn: 'স্থগিত — কেউ প্রবেশ করতে পারছেন না' });
    }
    if (t.billingState === 'limited') {
      // Said the way 10 Platform Console says it — "বকেয়া — ১২ দিন পার" —
      // because how long a bill has gone unpaid is what decides the call.
      const late = t.nextDueOn ? overdueDays(t.nextDueOn, now) : 0;
      out.push({ tenantId: t.id, nameBn: t.nameBn, kind: 'overdue', weight: 95,
        labelBn: late > 0
          ? `বকেয়া — ${bn(late)} দিন পার`
          : t.nextDueOn
            ? `বকেয়া — শেষ তারিখ ছিল ${bnDate(t.nextDueOn)}`
            : 'বকেয়া' });
    } else if (t.billingState === 'grace_period') {
      out.push({ tenantId: t.id, nameBn: t.nameBn, kind: 'grace', weight: 70,
        labelBn: t.graceUntil
          ? `ছাড়ের মেয়াদ ${bnDate(t.graceUntil)} পর্যন্ত`
          : 'ছাড়ের মেয়াদে চলছে' });
    }
    // A school that cannot enrol its next child has a problem it cannot see
    // until a parent is standing at the desk.
    const cap = t.studentCap || 0;
    if (cap > 0 && t.studentCount >= cap) {
      out.push({ tenantId: t.id, nameBn: t.nameBn, kind: 'cap_full', weight: 90,
        labelBn: `শিক্ষার্থীর সীমা পূর্ণ — ${bn(t.studentCount)} / ${bn(cap)}` });
    } else if (cap > 0 && t.studentCount >= cap * 0.9) {
      out.push({ tenantId: t.id, nameBn: t.nameBn, kind: 'cap_near', weight: 60,
        labelBn: `সীমার কাছাকাছি — ${bn(t.studentCount)} / ${bn(cap)}` });
    }
    const closed = Object.entries(t.portals).filter(([, open]) => open === false);
    if (closed.length > 0) {
      out.push({ tenantId: t.id, nameBn: t.nameBn, kind: 'portal', weight: 80,
        labelBn: `${closed.map(([k]) => PORTAL_BN[k] ?? k).join(', ')} — প্রবেশ বন্ধ` });
    }
    const off = Object.entries(t.services).filter(([, v]) => v === 'disabled');
    if (off.length > 0) {
      out.push({ tenantId: t.id, nameBn: t.nameBn, kind: 'service', weight: 50,
        labelBn: `${bn(off.length)}টি সেবা বন্ধ করা আছে` });
    }
    // Never onboarded: a school created and then forgotten is the quietest
    // failure on this screen, because nobody complains about it.
    //
    // But only while somebody could still plausibly be onboarding it. Past
    // that this is not a task anybody is going to do today, and left
    // unbounded it produced thirty identical rows that buried the outages
    // above. Older empty schools are counted on the dashboard instead — see
    // `dormant`.
    if (t.studentCount === 0 && t.userCount <= 1 && !isDormant(t, now)) {
      out.push({ tenantId: t.id, nameBn: t.nameBn, kind: 'onboarding', weight: 40,
        labelBn: 'অসম্পূর্ণ সেটআপ — কোনো শিক্ষার্থী যোগ হয়নি' });
    }
  }
  return out.sort((a, b) => b.weight - a.weight || a.nameBn.localeCompare(b.nameBn));
}

export interface OpsViewOptions {
  root: HTMLElement;
  doc: Document;
  /** Calls the platform API with the operator's token and key. */
  call<T>(path: string, init?: RequestInit): Promise<T>;
  /** Open the R-7 provisioning detail for one school. */
  onOpenTenant(id: string): void;
  /** Start the R-7 creation wizard. */
  onNewTenant(): void;
  /**
   * The section on screen changed.  (Ata Ekta, 10 Platform Console)
   *
   * The console's black sidebar owns the nav highlight now; this view no
   * longer draws its own tab strip. Called on a nav press and when a school
   * is opened — a school's page lives under প্রতিষ্ঠান, whichever section it
   * was opened from.
   */
  onSection?(s: Tab): void;
}

export type Tab = 'dashboard' | 'institutions' | 'plans' | 'operators';

// ── Presentation helpers (Ata Ekta) ────────────────────────────────────

/**
 * A band. 10 Platform Console draws its content as full-bleed white bands
 * under the bar — a 1px line between them — rather than cards in a gutter.
 * Exported so the R-7 screens in platform.ts speak the same vocabulary.
 */
export function platBand(doc: Document, className: string, ...children: Child[]): HTMLElement {
  return el(doc, 'div', {
    className: ['plat-band', className].filter(Boolean).join(' '),
  }, ...children);
}

/** The code the platform API put on a refusal, or ''. */
export function errorCodeOf(err: unknown): string {
  return String((err as { code?: unknown } | null)?.code ?? '');
}

/**
 * A refusal is a state, not an error to retry (§7 denied).
 *
 * platform-svc answers a bad key, a non-operator token and a revoked
 * credential alike with 403 `forbidden`, and an expired token with 401. A
 * retry button under either teaches an operator to hammer a locked door; the
 * way out is the sidebar's "সেশন শেষ".
 */
export function isDenied(code: string): boolean {
  return code === 'forbidden' || code === 'unauthorized';
}

/**
 * What a refusal means HERE, and the way out.
 *
 * The console holds nothing but a pasted token and key, so a refusal is
 * always about those two — and the one thing that helps is "সেশন শেষ" and
 * a fresh pair. B-30's canonical sentence stays the title; this is the line
 * under it. Without it the card said only "এই কাজটি করার অনুমতি আপনার
 * নেই।", and an operator who had mistyped the key was never told so.
 */
export const REFUSAL_HINT =
  'টোকেন বা কী গ্রহণ করা হয়নি। "সেশন শেষ" চেপে সঠিক টোকেন ও কী দিয়ে আবার প্রবেশ করুন।';

/**
 * The console's refusal state (§7 denied), announced.
 *
 * `permissionState` is a `note`, which is right for the app's page-load
 * refusals: the shell moves focus into every new page. The console swaps a
 * whole screen for this card in place, and a note there is never heard — so
 * this one card is an alert. The shared component is left as it is.
 */
export function refusalState(doc: Document): HTMLElement {
  const state = permissionState(doc, { message: `${permissionMessage()} ${REFUSAL_HINT}` });
  state.setAttribute('role', 'alert');
  return state;
}

/**
 * A failure card that has already been heard, drawn again without its alert.
 *
 * An alert is announced every time it is put on the page, and the console
 * redraws for reasons that are not a new failure. The words, the retry and
 * the look stay; only the announcement goes. The refusal goes back to the
 * shared card's `note` (permissionState); the error's words to plain text.
 * Works on a card or on anything holding cards.
 */
export function quietState(scope: HTMLElement): HTMLElement {
  const alerts = [...scope.querySelectorAll<HTMLElement>('.ui-state [role="alert"], .ui-state[role="alert"]')];
  if (scope.matches('.ui-state[role="alert"]')) alerts.push(scope);
  for (const a of alerts) {
    if (a.classList.contains('ui-state-denied')) a.setAttribute('role', 'note');
    else a.removeAttribute('role');
  }
  return scope;
}

/**
 * Make a page's name the place focus goes when the page changes.
 *
 * `tabindex="-1"` so it can take focus without becoming a Tab stop, and a
 * stable `data-focus-key` so the console's focus keeper finds the name again
 * when a load redraws the page — the words change ("প্রতিষ্ঠান" while a school
 * loads, then its name), the place does not.
 *
 * `plat-title` is the hook for the ring's size. The name is a block as wide
 * as the bar, so the sheet's focus ring (`[tabindex]:focus-visible`) drew a
 * 2px box round the whole title row — about 970px at 1280 — after every
 * keyboard page change. app.css (`.plat-title`) sizes the name to its words,
 * and the same ring then marks the words; the focus move itself is unchanged.
 */
export function titleTarget(scope: ParentNode): HTMLElement | null {
  const h = scope.querySelector<HTMLElement>('h1');
  if (!h) return null;
  h.setAttribute('tabindex', '-1');
  h.setAttribute('data-focus-key', 'plat-title');
  h.classList.add('plat-title');
  return h;
}

/** Move focus to the page's name. True when it took it. */
export function focusTitle(scope: ParentNode): boolean {
  const h = titleTarget(scope);
  if (!h) return false;
  h.focus();
  return h.ownerDocument.activeElement === h;
}

/**
 * The sentence an error state shows (§7 error: plain Bangla).
 *
 * The server's own words when it wrote them for a person — platform-svc's
 * validation messages are Bangla. A request that never reached a server is
 * said as that, not as the browser's "Failed to fetch". An English message
 * (`tenantId must be a uuid`, `platform console is not configured…`) keeps
 * its information but no longer leads: the Bangla sentence is the title and
 * the server's words are the detail line under it.
 */
export function plainError(err: unknown, fallback: string): string {
  const raw = String((err as { message?: unknown } | null)?.message ?? '').trim();
  if (err instanceof TypeError && /fetch|network|load failed/i.test(raw)) {
    return humanError('offline');
  }
  if (!raw) return fallback;
  if (/[ঀ-৿]/.test(raw)) return raw;
  return `${fallback} ${raw}`;
}

/** Whole days since an ISO date, or 0 when it has not passed or cannot be read. */
function overdueDays(iso: string, now = Date.now()): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

/**
 * The one word the fleet table's অবস্থা chip says.  (Ata Ekta, screen ০২)
 *
 * The drawn table has no billing column and no cap column: a school's worst
 * condition is the chip, and the cap shows in the শিক্ষার্থী cell itself. So
 * this reads, in the order an operator acts on them, every fact the removed
 * columns carried — lock-out, arrears, read-only, a full or nearly full roll,
 * a school nobody has filled in, a grace window, a trial — before it falls
 * back to the ops state. First match wins.
 */
function fleetState(t: TenantOverview): { state: string; label: string } {
  const cap = t.studentCap || 0;
  if (t.access === 'none') return { state: 'overdue', label: 'বন্ধ' };
  if (t.billingState === 'limited') return { state: 'overdue', label: 'বকেয়া' };
  if (t.access === 'read_only') return { state: 'partial', label: 'শুধু পড়া' };
  if (cap > 0 && t.studentCount >= cap) return { state: 'overdue', label: 'সীমা পূর্ণ' };
  if (cap > 0 && t.studentCount >= cap * 0.9) return { state: 'partial', label: 'সীমার কাছে' };
  if (t.studentCount === 0 && t.userCount <= 1) return { state: 'partial', label: 'সেটআপ বাকি' };
  if (t.billingState === 'grace_period') return { state: 'partial', label: 'ছাড়ের মেয়াদে' };
  if (t.billingState === 'trial') return { state: 'invited', label: 'ট্রায়াল' };
  return OPS_BN[t.opsState] ?? { label: t.opsState, state: 'draft' };
}

/**
 * A zeroed summary, for the type only. render() draws no section until a load
 * has come back (see `loaded`), so the figures on screen are always the
 * server's: never ০ standing in for a load that failed, never a page's count.
 */
const ZERO_SUMMARY: FleetSummary = {
  total: 0, attention: { critical: 0, warning: 0, info: 0 },
  access: { full: 0, readOnly: 0, none: 0 },
  billing: { trial: 0, active: 0, grace: 0, overdue: 0 },
  usage: { students: 0, users: 0, classes: 0, sections: 0, paid: 0 },
  quiet: 0, neverActive: 0, planUsage: {},
};

export class PlatformOpsView {
  private readonly o: OpsViewOptions;
  private tab: Tab = 'dashboard';
  private rows: TenantOverview[] = [];
  private services: ServiceRow[] = [];
  private plans: PlanRow[] = [];
  private loading = true;
  private error = '';
  /** The API's code for `error` — how a refusal is told from a failure. */
  private errorCode = '';
  private notice = '';
  private search = '';
  private filter = 'all';
  /** The plan or operator drawer, when one is open. */
  private drawer: OverlayHandle | null = null;
  private openId: string | null = null;
  private ops: Operations | null = null;
  private effective: Array<{ code: string; state: string }> = [];
  private payments: PaymentRow[] = [];
  private audit: AuditRow[] = [];
  /** §27 — the same trail, across every school. Read once with the list. */
  private feed: AuditRow[] = [];
  private detailTab = 'overview';
  // P10-1/2. `rows` is now ONE PAGE, not the fleet. Every fleet-wide number
  // comes from `summary`, so a page of twenty-five can never be mistaken for
  // the country.
  private summary: FleetSummary | null = null;
  private page: FleetPage = { page: 1, size: 25, total: 0, pages: 1,
                              sort: 'name', dir: 'asc' };
  /**
   * The dashboard's queue, fetched on its own.
   *
   * It must show the most urgent schools in the FLEET, which is not the same
   * as the most urgent on whichever page of the institutions tab happens to
   * be open. One query, ordered by severity, capped at what the card shows.
   */
  private queueRows: TenantOverview[] = [];
  private operators: OperatorRow[] = [];
  private busy = false;
  /**
   * Has a load ever come back?
   *
   * Until one has, nothing under the bar is real: `summary` is null and the
   * lists are empty because nothing was READ, not because nothing exists. A
   * failed first load drawn as if it had loaded said "সব ঠিক আছে — কোনো
   * প্রতিষ্ঠানে বকেয়া নেই…" under the error card, and "কোনো প্ল্যান নেই" with a
   * button to make one.
   */
  private loaded = false;
  /**
   * Failures, numbered, and the last one whose card has been on the page.
   *
   * A failure is announced once, when its card is first shown. The card used
   * to be built afresh, as an alert, on every redraw — so every sidebar press
   * while a load error stood said "তালিকা আনা যায়নি। …" again, though nothing
   * new had failed. A retry or a হালনাগাদ that fails is a new failure, and is
   * said again.
   *
   * "Shown" means a reader could be handed it: on the page, and not under an
   * open drawer. openDrawer (ui/overlay.ts) sets `aria-hidden` on the rest of
   * the page while it is open, and a failure drawn then — an operator save
   * that fails keeps its drawer open — is heard by nobody. It stays unsaid
   * until the drawer closes, and is said then (see `onOverlayClosed`).
   */
  private failure = 0;
  private saidFailure = 0;

  /** Any overlay closing may uncover a failure card nobody has heard. */
  private readonly onOverlayClosed = (): void => { this.sayUnheard(); };

  constructor(options: OpsViewOptions) {
    this.o = options;
    options.doc.addEventListener('ui:overlay-closed', this.onOverlayClosed);
    this.render();
    void this.load();
  }

  /** The view is being thrown away (the console signed out). */
  public destroy(): void {
    this.o.doc.removeEventListener('ui:overlay-closed', this.onOverlayClosed);
  }

  /** Record a failure: its words, its code, and that it is a new one. */
  private fail(err: unknown, fallback: string): void {
    this.error = plainError(err, fallback);
    this.errorCode = errorCodeOf(err);
    this.failure++;
  }

  /**
   * Could a card on this view's page be heard now? Not while the view is off
   * the page, and not while an overlay hides the page with `aria-hidden`.
   */
  private hearable(): boolean {
    const r = this.o.root;
    return r.isConnected && !r.closest('[aria-hidden="true"]');
  }

  /** The failure card is on the page: count it as said, if it could be heard. */
  private noteHeard(): void {
    if (this.error && this.failure !== this.saidFailure && this.hearable()) {
      this.saidFailure = this.failure;
    }
  }

  /**
   * An overlay has closed. A failure drawn while it was open went on the page
   * under its `aria-hidden` and was never said: put the card on the page again
   * now that it can be heard, which says it. Only the card moves — the page
   * and whatever has focus stay as they are.
   */
  private sayUnheard(): void {
    if (!this.error || this.failure === this.saidFailure || !this.hearable()) return;
    const card = this.o.root.querySelector<HTMLElement>('.plat-flash .ui-state');
    const band = card?.parentNode;
    if (!card || !band) return;
    const focused = this.o.doc.activeElement as HTMLElement | null;
    const next = card.nextSibling;
    card.remove();
    band.insertBefore(card, next);
    if (focused && card.contains(focused)) focused.focus();
    this.saidFailure = this.failure;
  }

  // ── the shell's handles ──────────────────────────────────────────────

  /** The section the sidebar should mark. A school's page is under প্রতিষ্ঠান. */
  public section(): Tab {
    return this.openId ? 'institutions' : this.tab;
  }

  /**
   * The console is about to put this view's DOM back on the page (platform.ts
   * keeps it across shell redraws). A failure card already heard is put back
   * quiet: re-inserting an alert announces it again. One drawn while the view
   * was off the page has never been heard, and goes back as an alert.
   */
  public attaching(): void {
    if (this.error && this.failure === this.saidFailure) quietState(this.o.root);
  }

  /**
   * The console has put this view's DOM back on the page. A failure that went
   * back as an alert has been said now — unless an open drawer hides the
   * page, in which case it is said when that closes.
   */
  public attached(): void {
    this.noteHeard();
  }

  /** A nav press in the sidebar. Leaves any open school and shows the section. */
  public showSection(s: Tab): void {
    this.tab = s;
    this.openId = null;
    this.ops = null;
    this.o.onSection?.(s);
    this.render();
  }

  // ── data ─────────────────────────────────────────────────────────────
  /**
   * `results`: only the results change — a search typed into the institutions
   * list. The page, and the field being typed into, stay exactly as they are
   * while the query runs and after it answers; only the table and the pager
   * are repainted. A full redraw here took the search box off the page for
   * the length of the request (focus went to the whole console, and whatever
   * was typed meanwhile went nowhere) and rebuilt it afterwards, which ends a
   * Bangla keyboard's composition mid-word.
   */
  private async load(results = false): Promise<void> {
    const seq = ++this.loadSeq;
    const inPlace = results && this.showsResults() && !this.error;
    if (inPlace) {
      this.tableHost?.setAttribute('aria-busy', 'true');
    } else {
      this.loading = true; this.error = ''; this.errorCode = ''; this.render();
    }
    try {
      // The page, the fleet-wide counts, the catalogue and the audit feed.
      // `/overview` is gone from this path: it returned every school on every
      // request — 142 kB at 258 schools, and a second per request in the
      // database.
      const p = new URLSearchParams({
        q: this.search,
        page: String(this.page.page), size: String(this.page.size),
        sort: this.page.sort, dir: this.page.dir,
      });
      // The tabs are server filters now, so the count on a tab and the rows
      // behind it are the same query.
      if (this.filter !== 'all') p.set('attention',
        this.filter === 'attention' ? 'action' : this.filter);

      const [list, sum, urgent, cat, feed, ops] = await Promise.all([
        this.o.call<{ tenants: TenantOverview[]; page: FleetPage }>(`/tenants?${p}`),
        this.o.call<FleetSummary>('/fleetsummary'),
        this.o.call<{ tenants: TenantOverview[] }>(
          `/tenants?attention=action&sort=severity&dir=asc&size=${QUEUE_LIMIT}`),
        this.o.call<{ plans: PlanRow[]; services: ServiceRow[] }>('/catalogue'),
        // Its own failure: a console that cannot show its history is still a
        // console that must show its schools.
        this.o.call<{ entries: AuditRow[] }>('/audit').catch(() => ({ entries: [] })),
        // Its own failure too: a console that cannot list its operators is
        // still a console that must show its schools.
        this.o.call<{ operators: OperatorRow[] }>('/operators')
          .catch(() => ({ operators: [] })),
      ]);
      // A later load has started (the next search, a হালনাগাদ): its answer
      // is the one the screen shows, whichever comes back first.
      if (seq !== this.loadSeq) return;
      this.rows = list.tenants;
      this.page = list.page;
      this.summary = sum;
      this.queueRows = urgent.tenants;
      this.plans = cat.plans;
      this.services = cat.services;
      this.feed = feed.entries;
      this.operators = ops.operators;
      this.loaded = true;
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.fail(err, 'তালিকা আনা যায়নি।');
    }
    this.loading = false;
    this.tableHost?.removeAttribute('aria-busy');
    if (inPlace && !this.error && this.showsResults()) {
      this.repaintTable();
      const pager = this.pager();
      this.pagerEl?.replaceWith(pager);
      this.pagerEl = pager;
      return;
    }
    const ours = this.holdsFocus();
    this.render();
    if (ours) this.titleIfLost();
  }

  /**
   * Is keyboard focus this view's to look after? On something inside it, or
   * parked by the console's focus keeper (platform.ts) because the control
   * that had it was redrawn away — "আবার চেষ্টা করুন" is gone the moment the
   * retry starts. Focus on <body> is not ours: the person put it there.
   */
  private holdsFocus(): boolean {
    const d = this.o.doc;
    const a = d.activeElement;
    if (!a || a === d.body || a === d.documentElement) return false;
    return this.o.root.contains(a) || focusIsLost(d);
  }

  /**
   * After a redraw, and after the focus keeper has had its turn (its observer
   * runs first — it was queued by the redraw): if focus still has nowhere to
   * be, give it the page's name. Never leave it on <body> or on the whole
   * console, where the next Tab starts again at the top of the sidebar.
   */
  private titleIfLost(): void {
    queueMicrotask(() => {
      if (focusIsLost(this.o.doc)) focusTitle(this.o.root);
    });
  }

  /**
   * Open one school — a page inside the shell (10 Platform Console, screen
   * ০৩), with the sidebar's প্রতিষ্ঠান row marked. It used to be a drawer;
   * every request and every confirmation is the same.
   *
   * `focus` moves focus to the school's name, which is what a drawer opening
   * did for its first control: the row pressed to get here is gone, and focus
   * left on <body> would start a keyboard user from the top of the page.
   */
  private async openDetail(id: string, focus = true): Promise<void> {
    this.openId = id;
    this.detailTab = 'overview';
    this.ops = null;
    this.error = ''; this.errorCode = '';
    this.o.onSection?.('institutions');
    this.render();
    if (focus) this.o.root.querySelector<HTMLElement>('.plat-bar h1')?.focus();
    try {
      const [r, a] = await Promise.all([
        this.o.call<{
          operations: Operations;
          services: Array<{ code: string; state: string }>;
          payments: PaymentRow[];
        }>(`/operations?id=${encodeURIComponent(id)}`),
        // Its own request and its own failure: a school whose history cannot
        // be read is still a school an operator must be able to act on.
        this.o.call<{ entries: AuditRow[] }>(
          `/audit?tenantId=${encodeURIComponent(id)}`).catch(() => ({ entries: [] })),
      ]);
      // The operator may have left while this was loading; a late answer must
      // not pull the page back or re-mark the sidebar.
      if (this.openId !== id) return;
      this.ops = r.operations;
      this.effective = r.services;
      this.payments = r.payments;
      this.audit = a.entries;
    } catch (err) {
      if (this.openId !== id) return;
      this.fail(err, 'তথ্য আনা যায়নি।');
    }
    this.render();
    // The re-render replaced the name that had focus; put it back, unless the
    // operator has already moved on to something that is still on the page.
    // `focusIsLost`, not "is it <body>": in the console a focus keeper parks
    // lost focus on its container, and that is lost too.
    const active = this.o.doc.activeElement;
    if (focus && (focusIsLost(this.o.doc) || !active?.isConnected)) {
      this.o.root.querySelector<HTMLElement>('.plat-bar h1')?.focus();
    }
  }

  /** Back to the section the school was opened from. */
  private closeDetail(): void {
    this.openId = null;
    this.ops = null;
    this.o.onSection?.(this.tab);
    this.render();
  }

  /**
   * Every operations POST goes through here.
   *
   * The endpoint returns the school's state AFTER the change, so the page
   * renders the consequence rather than re-fetching and possibly showing a
   * state one request out of date.
   */
  private async act(path: string, body: Record<string, unknown>, done: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await this.o.call(path, { method: 'POST', body: JSON.stringify(body) });
      this.notice = done;
      this.busy = false;
      // Both surfaces move: the school's page shows the new state, and the
      // row in the list stops disagreeing with it.
      await Promise.all([this.load(), this.openDetail(String(body.tenantId), false)]);
    } catch (err) {
      this.busy = false;
      this.fail(err, 'কাজটি সম্পন্ন হয়নি।');
      this.render();
    }
  }

  // ── the page ─────────────────────────────────────────────────────────
  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.replaceChildren();

    if (this.openId) { this.renderDetail(root); return; }

    root.append(this.bar());
    // A refusal, or a failure before anything was ever read: the error card
    // (with its retry) is the whole screen. Drawing the section under it would
    // turn "nothing loaded" into "০ schools, nothing overdue, no plans".
    if (this.flash(root, () => { void this.load(); }) || (this.error && !this.loaded)) return;
    if (this.loading) { root.append(platBand(d, 'plat-loading', listSkeleton(d, 5))); return; }

    if (this.tab === 'dashboard') this.renderDashboard(root);
    else if (this.tab === 'plans') this.renderPlans(root);
    else if (this.tab === 'operators') this.renderOperators(root);
    else this.renderList(root);
  }

  /**
   * The bar (10 Platform Console `bar()`): the section's name on the left, its
   * one action on the right. No subtitle — the drawing has none, and the fleet
   * count it used to carry is the first figure on the dashboard.
   */
  private bar(): HTMLElement {
    const head = this.barFor();
    // The section's name is where a nav press, a sign-in or a lost focus
    // lands (platform.ts, titleIfLost).
    titleTarget(head);
    return head;
  }

  private barFor(): HTMLElement {
    const d = this.o.doc;
    if (this.tab === 'dashboard') {
      return pageHeader(d, {
        className: 'plat-bar', title: 'ফ্লিট',
        actions: [
          el(d, 'span', { className: 'plat-date' }, ...numText(d, bnDate(todayLocalIso()))),
          button(d, {
            label: 'হালনাগাদ', variant: 'ghost', size: 'sm', glyph: 'refresh',
            onClick: () => { void this.load(); },
          }),
        ],
      });
    }
    if (this.tab === 'plans') {
      return pageHeader(d, {
        className: 'plat-bar', title: 'প্ল্যান',
        primary: button(d, {
          label: 'নতুন প্ল্যান', variant: 'primary', size: 'sm',
          onClick: () => this.planForm(null),
        }),
      });
    }
    if (this.tab === 'operators') {
      return pageHeader(d, {
        className: 'plat-bar', title: 'অপারেটর',
        primary: button(d, {
          label: 'অপারেটরের নাম যোগ করুন', variant: 'primary', size: 'sm',
          onClick: () => this.operatorForm(null),
        }),
      });
    }
    return pageHeader(d, {
      className: 'plat-bar', title: 'প্রতিষ্ঠান',
      primary: button(d, {
        label: 'নতুন প্রতিষ্ঠান', variant: 'primary', size: 'sm',
        onClick: () => this.o.onNewTenant(),
      }),
    });
  }

  /**
   * The notice and the error, each in its own band under the bar. Returns
   * true when the screen is a refusal and nothing below it can be shown.
   */
  private flash(root: HTMLElement, retry: () => void): boolean {
    const d = this.o.doc;
    if (this.notice) root.append(platBand(d, 'plat-flash', successNote(d, this.notice)));
    if (!this.error) return false;
    const denied = isDenied(this.errorCode);
    // B-30's canonical refusal, no retry, and what to do about it; or the
    // failure with its retry.
    const card = denied ? refusalState(d) : errorState(d, this.error, retry);
    // Announced when first shown; a redraw of the same failure (a sidebar
    // press, a tab, a drawer closing) shows it without saying it again.
    // Off the page, or behind an open drawer, it cannot be heard, so it is not
    // counted as said.
    if (this.failure === this.saidFailure) quietState(card);
    root.append(platBand(d, 'plat-flash', card));
    this.noteHeard();
    return denied;
  }

  // ── 3. the plan catalogue (§16) ──────────────────────────────────────
  //
  // A plan is not a property of one school. Editing one from inside a
  // school's page would read as though it only touched that school, and it
  // touches every school on it — so it lives here, and the number of schools
  // affected is on the button that does it.
/**
   * Who can operate this platform.  (P10-5, closes B-39)
   *
   * A name per issued credential, and the ability to stop one. It holds no
   * secret and issues nothing: the credential is minted out of band and this
   * screen only says whose it is. That is the whole of what B-39 asked for —
   * "even a small table with a name per issued credential" — and deliberately
   * not a login system, which would make the console worth stealing.
   *
   * Ata Ekta (screen ০৪, lower half): an inset header band, then one row per
   * operator — initial, name over a detail line, and a word-chip.
   */
  private renderOperators(root: HTMLElement): void {
    const d = this.o.doc;

    root.append(platBand(d, 'plat-intro', el(d, 'p', {
      className: 'plat-note',
      text: 'প্রতিটি ইস্যু করা ক্রেডেনশিয়ালের একটি নাম। এখানে কোনো পাসওয়ার্ড '
          + 'বা টোকেন রাখা হয় না — শুধু কার ক্রেডেনশিয়াল এবং এখনো চালু কি না। '
          + 'প্রত্যাহার করলে পরের অনুরোধেই কনসোল বন্ধ হয়ে যাবে।',
    })));

    root.append(el(d, 'div', { className: 'plat-band-inset' },
      sectionHeading(d, { title: 'অপারেটরের তালিকা', className: 'plat-label' })));

    if (this.operators.length === 0) {
      root.append(platBand(d, '', emptyState(d, {
        glyph: 'users',
        message: 'কোনো অপারেটরের নাম রাখা হয়নি। নাম ছাড়া অডিটে "নাম নেই" দেখাবে।',
        action: { label: 'অপারেটরের নাম যোগ করুন', onClick: () => this.operatorForm(null) },
      })));
      return;
    }

    const rows = list(d, 'অপারেটরের তালিকা', ...this.operators.map((r) => {
      const li = listItem(d, {
        title: r.fullName,
        // "কখনো নয়" is a real answer: a credential issued and never used is
        // one worth asking about.
        subtitle: `${r.email ?? '—'} · ${bn(r.actions)}টি কাজ · সর্বশেষ `
          + (r.lastSeenAt ? bnDateTime(r.lastSeenAt) : 'কখনো নয়'),
        // Never colour alone: the state is a WORD.
        status: statusBadge(d, r.status === 'active'
          ? { state: 'active', label: 'চালু' }
          : { state: 'draft', label: 'প্রত্যাহৃত' }),
        onClick: () => this.operatorForm(r),
      });
      li.querySelector('.ui-list-hit')?.prepend(avatar(d, { name: r.fullName, size: 'sm' }));
      return li;
    }));
    rows.classList.add('plat-operators');
    root.append(rows);
  }

  /**
   * Name a credential, or stop one.
   *
   * The id is the JWT subject of a credential that ALREADY EXISTS — this
   * screen does not mint anything, so the field asks for the subject rather
   * than offering to generate one.
   */
  private operatorForm(existing: OperatorRow | null): void {
    const d = this.o.doc;
    const id = field(d, {
      label: 'ক্রেডেনশিয়াল আইডি (JWT sub)', name: 'id',
      value: existing?.id ?? '',
      helper: 'ইস্যু করা টোকেনের sub — এখানে নতুন টোকেন তৈরি হয় না',
    });
    if (existing) id.input.setAttribute('readonly', 'true');
    const name = field(d, {
      label: 'পুরো নাম', name: 'fullName', value: existing?.fullName ?? '' });
    const email = field(d, {
      label: 'ইমেইল', name: 'email', value: existing?.email ?? '' });
    const note = field(d, {
      label: 'নোট', name: 'note', value: existing?.note ?? '' });

    const body = el(d, 'div', { className: 'ui-stack' });
    for (const f of [id, name, email, note]) append(body, f.root);

    const save = async (status: 'active' | 'revoked'): Promise<void> => {
      try {
        await this.o.call('/operator', {
          method: 'POST',
          body: JSON.stringify({
            id: id.input.value.trim(), fullName: name.input.value.trim(),
            email: email.input.value.trim(), note: note.input.value.trim(),
            status,
          }),
        });
        this.notice = status === 'revoked'
          ? 'ক্রেডেনশিয়াল প্রত্যাহার করা হয়েছে।'
          : 'অপারেটর সংরক্ষণ হয়েছে।';
        this.closeDrawer();
        await this.load();
      } catch (err) {
        this.fail(err, 'অপারেটর সংরক্ষণ করা যায়নি।');
        this.render();
      }
    };

    const actions = [button(d, {
      label: 'সংরক্ষণ', variant: 'primary',
      onClick: () => { void save('active'); },
    })];
    // Revocation is offered only for a credential that exists and is live.
    if (existing && existing.status === 'active') {
      actions.push(button(d, {
        label: 'প্রত্যাহার', variant: 'danger',
        onClick: () => { void save('revoked'); },
      }));
    }

    this.drawer = openDrawer(d, {
      title: existing ? existing.fullName : 'নতুন অপারেটর',
      body, actions,
      onClose: () => { this.drawer = null; },
    });
  }

  /**
   * The catalogue as drawn (screen ০৪): one cell per plan, side by side —
   * name, price, and a line of what it buys. The whole cell opens the plan.
   *
   * The cell is a button holding spans, not a card: a heading inside a button
   * is invalid content and drops out of heading navigation.
   */
  private renderPlans(root: HTMLElement): void {
    const d = this.o.doc;
    // From the summary: counting `this.rows` would count one page, and the
    // number beside a plan is what an operator checks before retiring it.
    const usedBy = (code: string) => this.summary?.planUsage[code] ?? 0;

    if (this.plans.length === 0) {
      root.append(platBand(d, '', emptyState(d, {
        glyph: 'layers',
        message: 'কোনো প্ল্যান নেই — প্রতিষ্ঠান যুক্ত করতে অন্তত একটি প্ল্যান লাগবে।',
        action: { label: 'নতুন প্ল্যান', onClick: () => this.planForm(null) },
      })));
    } else {
      const grid = el(d, 'ul', {
        className: 'plat-plan-grid', attrs: { 'aria-label': 'প্ল্যানের তালিকা' },
      });
      for (const p of this.plans) {
        const price = Number(p.priceBdt) === 0
          ? 'বিনামূল্যে'
          : `${formatBdt(p.priceBdt)} / ${CYCLE_BN[p.billingCycle] ?? p.billingCycle}`;
        const meta = `${bn(p.studentCap)} শিক্ষার্থী · `
          + `${bn(Object.values(p.services).filter(Boolean).length)}টি সেবা · `
          + `${bn(usedBy(p.code))}টি প্রতিষ্ঠান`;
        const cell = el(d, 'button', {
          className: p.isActive ? 'plat-plan' : 'plat-plan is-retired',
          attrs: { type: 'button' },
        },
          el(d, 'span', { className: 'plat-plan-head' },
            el(d, 'span', { className: 'plat-plan-name' }, ...numText(d, p.nameBn)),
            // A retired plan says so in a word, not only by being greyer.
            p.isActive ? null : statusBadge(d, { state: 'draft', label: 'বন্ধ' })),
          el(d, 'span', { className: 'plat-plan-price' }, ...numText(d, price)),
          el(d, 'span', { className: 'plat-plan-meta' }, ...numText(d, meta)));
        cell.addEventListener('click', () => this.planForm(p));
        grid.append(el(d, 'li', { className: 'plat-plan-cell' }, cell));
      }
      root.append(grid);
    }

    root.append(platBand(d, 'plat-intro', el(d, 'p', {
      className: 'plat-note',
      text: 'প্ল্যান ঠিক করে মূল্য, শিক্ষার্থীর সর্বোচ্চ সংখ্যা, কোন সেবাগুলো কেনা আছে, '
        + 'এবং বিল দেরি হলে কত দিন ছাড় পাওয়া যাবে। প্ল্যান বদলালে সেই প্ল্যানের '
        + 'প্রতিটি প্রতিষ্ঠানে সঙ্গে সঙ্গে কার্যকর হয়।',
    })));
  }

  /**
   * Create or change a plan.
   *
   * The WHOLE plan is submitted, never a patch: a partial update of a price
   * list is how a plan ends up carrying a new price and last year's services.
   */
  private planForm(existing: PlanRow | null): void {
    const d = this.o.doc;
    const affected = existing
      ? (this.summary?.planUsage[existing.code] ?? 0) : 0;

    const code = field(d, {
      label: 'কোড', name: 'code', value: existing?.code ?? '', required: !existing,
      helper: existing
        ? 'কোড বদলানো যায় না — এটি প্রতিষ্ঠানের সঙ্গে যুক্ত।'
        : 'ছোট হাতের ইংরেজি, যেমন: standard_plus। পরে আর বদলানো যাবে না।',
      attrs: existing ? { readonly: 'readonly' } : {},
    });
    const nameBn = field(d, { label: 'নাম', name: 'nameBn', required: true,
      value: existing?.nameBn ?? '' });
    const price = field(d, { label: 'মূল্য (৳)', name: 'priceBdt', kind: 'number',
      required: true, value: existing ? String(Number(existing.priceBdt)) : '',
      attrs: { min: 0, step: '0.01' } });
    const cycle = field(d, {
      label: 'বিলিং চক্র', name: 'billingCycle', kind: 'select',
      value: existing?.billingCycle ?? 'yearly',
      options: Object.entries(CYCLE_BN).map(([value, label]) => ({ value, label })),
    });
    const cap = field(d, { label: 'শিক্ষার্থীর সীমা', name: 'studentCap', kind: 'number',
      required: true, value: existing ? String(existing.studentCap) : '',
      attrs: { min: 1, step: 1 } });
    const trial = field(d, { label: 'ট্রায়াল (দিন)', name: 'trialDays', kind: 'number',
      value: String(existing?.trialDays ?? 30), attrs: { min: 0, max: 365, step: 1 } });
    const grace = field(d, { label: 'ছাড় (দিন)', name: 'graceDays', kind: 'number',
      value: String(existing?.graceDays ?? 14), attrs: { min: 0, max: 365, step: 1 },
      helper: 'বিলের শেষ তারিখের পর কত দিন প্রতিষ্ঠান পূর্ণ সক্রিয় থাকবে।' });

    // Which services the plan buys, in the same table shape the
    // per-institution service tab uses — including the "বন্ধ করলে" column,
    // because leaving a service OUT of a plan and switching it off for one
    // school have the same consequence and should read the same way.
    const YESNO = [{ value: 'yes', label: 'আছে' }, { value: 'no', label: 'নেই' }];
    const picks = new Map<string, Field>();
    for (const svc of this.services) {
      picks.set(svc.code, field(d, {
        label: svc.nameBn, name: `svc_${svc.code}`, kind: 'select', options: YESNO,
        value: (existing ? existing.services[svc.code] === true : true) ? 'yes' : 'no',
      }));
    }
    const list = dataTable(d, {
      caption: 'এই প্ল্যানে কোন সেবাগুলো আছে',
      rows: this.services,
      rowKey: (s) => s.code,
      columns: [
        { key: 'name', header: 'সেবা', mobile: 'title', cell: (s) => s.nameBn,
          width: 'minmax(0, 1.2fr)' },
        { key: 'effect', header: 'না থাকলে', mobile: 'subtitle', cell: (s) => s.effectBn,
          width: 'minmax(0, 2.4fr)' },
        { key: 'in', header: 'প্ল্যানে', mobile: 'status', width: '130px',
          cell: (s) => picks.get(s.code)!.root },
      ],
    });

    const active = field(d, {
      label: 'নতুন প্রতিষ্ঠানে দেওয়া যাবে', name: 'isActive', kind: 'select',
      options: YESNO, value: (existing ? existing.isActive : true) ? 'yes' : 'no',
      helper: '"নেই" করলে নতুন প্রতিষ্ঠানে এই প্ল্যান বেছে নেওয়া যাবে না। '
        + 'যেসব প্রতিষ্ঠান এখন এই প্ল্যানে আছে, তাদের কিছুই বদলাবে না।',
    });
    const why = field(d, { label: 'কারণ', name: 'reason', required: true,
      placeholder: existing ? 'যেমন: ২০২৭ সালের মূল্য তালিকা' : 'যেমন: নতুন প্যাকেজ চালু' });

    const form = el(d, 'div', { className: 'ui-card-form' });
    append(form, code.root, nameBn.root, price.root, cycle.root, cap.root,
      trial.root, grace.root,
      sectionHeading(d, { title: 'সেবা' }), list,
      active.root, why.root);

    if (existing && affected > 0) {
      append(form, card(d, {
        title: 'এই বদল কাদের ছোঁবে', glyph: 'alert-triangle', tone: 'warn', headingLevel: 3,
      }, el(d, 'p', { className: 'ui-card-note' },
        ...numText(d, `এখন ${bn(affected)}টি প্রতিষ্ঠান এই প্ল্যানে আছে। মূল্য, সীমা বা সেবা `
          + 'বদলালে সঙ্গে সঙ্গে সবার ক্ষেত্রে কার্যকর হবে — প্ল্যান থেকে বাদ দেওয়া '
          + 'সেবা তখনই বন্ধ হয়ে যাবে।'))));
    }

    const drawer = openDrawer(d, {
      title: existing ? `${existing.nameBn} — পরিবর্তন` : 'নতুন প্ল্যান',
      body: form,
      actions: [button(d, {
        label: existing ? 'সংরক্ষণ করুন' : 'প্ল্যান তৈরি করুন',
        variant: 'primary', busy: this.busy,
        onClick: () => {
          for (const f of [code, nameBn, price, cap, why]) clearFieldError(f.root);
          if (!existing && !/^[a-z][a-z0-9_]{1,30}$/.test(code.value().trim())) {
            setFieldError(code.root, 'ছোট হাতের ইংরেজি অক্ষর দিয়ে শুরু করুন, ২–৩১ অক্ষর।');
            return;
          }
          if (!nameBn.value().trim()) { setFieldError(nameBn.root, 'নাম লিখুন।'); return; }
          if (!(Number(price.value()) >= 0)) { setFieldError(price.root, 'মূল্য দিন।'); return; }
          if (!(Number(cap.value()) >= 1)) { setFieldError(cap.root, 'সীমা দিন।'); return; }
          if (!why.value().trim()) {
            setFieldError(why.root, 'কারণ লিখুন।');
            why.input.focus();
            return;
          }
          const services: Record<string, boolean> = {};
          for (const [c, f] of picks) services[c] = f.value() === 'yes';
          const body = {
            code: (existing?.code ?? code.value()).trim().toLowerCase(),
            nameBn: nameBn.value().trim(),
            priceBdt: Number(price.value()),
            billingCycle: cycle.value(),
            studentCap: Number(cap.value()),
            trialDays: Number(trial.value()),
            graceDays: Number(grace.value()),
            services,
            isActive: active.value() === 'yes',
            reason: why.value().trim(),
          };
          const go = (): void => { drawer.close(); void this.commitPlan(body, existing !== null); };
          // A plan with schools on it is a change to all of them at once, so
          // the number is read before the change, not after it.
          if (existing && affected > 0) {
            const dlg = confirmDialog({
              doc: d,
              title: 'প্ল্যান পরিবর্তন — নিশ্চিত করুন',
              body: `${bn(affected)}টি প্রতিষ্ঠান এই প্ল্যানে আছে। পরিবর্তনটি `
                + 'সবার ক্ষেত্রে সঙ্গে সঙ্গে কার্যকর হবে।',
              confirmLabel: 'পরিবর্তন করুন',
              danger: true,
              onConfirm: go,
            });
            append(form, dlg);
            dlg.scrollIntoView({ block: 'nearest' });
            (dlg.querySelector('button') as HTMLElement | null)?.focus();
            return;
          }
          go();
        },
      })],
      onClose: () => { /* nothing is held open by this drawer */ },
    });
  }

  private async commitPlan(body: Record<string, unknown>, existed: boolean): Promise<void> {
    this.busy = true;
    try {
      const r = await this.o.call<{ affected: number }>('/plans', {
        method: 'POST', body: JSON.stringify(body),
      });
      this.notice = existed
        ? `প্ল্যান হালনাগাদ হয়েছে — ${bn(r.affected)}টি প্রতিষ্ঠানে কার্যকর।`
        : 'নতুন প্ল্যান তৈরি হয়েছে।';
      this.busy = false;
      await this.load();
    } catch (err) {
      this.busy = false;
      this.fail(err, 'প্ল্যান সংরক্ষণ করা যায়নি।');
      this.render();
    }
  }

  // ── 1. dashboard ─────────────────────────────────────────────────────
  /**
   * Screen ০১ as drawn: four figures, then the schools that need a person,
   * each with its reason in words and a way in. The fleet's other figures
   * and the team's recent actions follow as further bands — the drawing does
   * not show them, and dropping them would lose what an operator reads here.
   */
  private renderDashboard(root: HTMLElement): void {
    const d = this.o.doc;
    // Every number here is the SERVER's, over the whole fleet. They used to
    // be `this.rows.filter(...).length` over a full download of the fleet,
    // which is the reason the list could not be paginated: a page of
    // twenty-five would have reported twenty-five schools as the country.
    const f = this.summary ?? ZERO_SUMMARY;
    const needing = f.attention.critical + f.attention.warning;

    // Tone is on the FIGURE and means something (R5): the active count in
    // --ok, the schools needing a person in --danger when there are any. The
    // suspended count is quiet ink, as drawn — a word beside every one.
    root.append(platBand(d, 'plat-stats', statRow(d,
      statCard(d, { label: 'প্রতিষ্ঠান', value: bn(f.total) }),
      statCard(d, { label: 'সক্রিয়', value: bn(f.access.full), tone: 'success' }),
      statCard(d, {
        label: 'নজর দরকার', value: bn(needing),
        tone: needing > 0 ? 'danger' : undefined,
      }),
      statCard(d, { label: 'স্থগিত', value: bn(f.access.none), tone: 'accent2' }),
    )));

    // ── the attention queue ──
    //
    // The SERVER chooses the rows (severity-ordered, fleet-wide) and the
    // count comes from the summary; `attentionQueue` still supplies the
    // human reason for each one, which is the part a database column cannot
    // give. Selection and explanation, split where each is better.
    const queue = attentionQueue(this.queueRows);
    const attn = platBand(d, 'plat-attn-band',
      sectionHeading(d, { title: 'নজর দরকার', className: 'plat-label' }));
    if (queue.length === 0) {
      attn.append(el(d, 'p', {
        className: 'plat-note',
        text: 'সব ঠিক আছে — কোনো প্রতিষ্ঠানে বকেয়া নেই, কোনোটি স্থগিত নেই, '
          + 'এবং কেউ সীমার কাছাকাছি নয়।',
      }));
    } else {
      // Shown in full only up to a point. Past QUEUE_LIMIT the operator is
      // scrolling, not working, and the rows below the fold are by
      // construction the least urgent ones. The remainder is stated, never
      // silently dropped.
      const shown = queue.slice(0, QUEUE_LIMIT);
      const rows = list(d, 'যেসব প্রতিষ্ঠানে ব্যবস্থা নেওয়া দরকার', ...shown.map((a) => {
        const li = listItem(d, {
          title: a.nameBn,
          subtitle: a.labelBn,
          className: 'plat-attn-row',
          // Every row goes to the school it is about. An alert that does not
          // reach the thing it is about is a notification, not an alert.
          status: button(d, {
            label: 'খুলুন', variant: 'secondary', size: 'sm',
            ariaLabel: `${a.nameBn} খুলুন`,
            onClick: () => { void this.openDetail(a.tenantId); },
          }),
        });
        // Money and lock-outs outrank a cap warning. The bar beside the row
        // and the colour of the reason say which; the reason says it in words.
        li.dataset.level = a.weight >= 90 ? 'danger' : 'warn';
        return li;
      }));
      rows.classList.add('plat-attn');
      attn.append(rows);
      if (queue.length > shown.length) {
        attn.append(el(d, 'p', { className: 'plat-note plat-more' },
          ...numText(d, `আরও ${bn(queue.length - shown.length)}টি কম জরুরি বিষয় আছে — `
            + 'প্রতিষ্ঠান তালিকায় ছেঁকে দেখুন।')));
      }
    }
    root.append(attn);

    root.append(platBand(d, 'plat-stats',
      sectionHeading(d, { title: 'বাণিজ্যিক অবস্থা', className: 'plat-label' }),
      statRow(d,
        statCard(d, { label: 'ট্রায়ালে', value: bn(f.billing.trial) }),
        statCard(d, { label: 'পরিশোধিত', value: bn(f.billing.active), tone: 'success' }),
        statCard(d, { label: 'ছাড়ের মেয়াদে', value: bn(f.billing.grace) }),
        statCard(d, {
          label: 'বকেয়া', value: bn(f.billing.overdue),
          tone: f.billing.overdue > 0 ? 'danger' : undefined,
        }),
      )));

    // Summed in the database. These three were `this.rows.reduce(...)`, and
    // a reduce over one page of twenty-five would have reported a fraction
    // of the country's students as its total.
    root.append(platBand(d, 'plat-stats',
      sectionHeading(d, { title: 'ব্যবহার', className: 'plat-label' }),
      statRow(d,
        statCard(d, { label: 'মোট শিক্ষার্থী', value: bn(f.usage.students) }),
        statCard(d, { label: 'সক্রিয় ব্যবহারকারী', value: bn(f.usage.users) }),
        statCard(d, {
          label: 'মোট আদায়', value: formatBdt(f.usage.paid),
          note: 'রেকর্ড করা সব পেমেন্ট',
        }),
      )));

    // §1's "recently onboarded" and "recently inactive". Counts, not alerts:
    // neither is a thing to DO today, and both are things a team running
    // forty schools is asked about weekly. Each carries a note saying what it
    // counts, because "নিষ্ক্রিয়" on its own could mean four different things.
    // `neverActive` is the server's count of schools nobody has ever signed
    // into, computed over the fleet rather than over a page. `fresh` stays a
    // page-level number, because "created in the last 30 days" is not
    // something the summary carries yet.
    const fresh = this.rows.filter((t) => isRecent(t)).length;
    root.append(platBand(d, 'plat-stats',
      sectionHeading(d, { title: 'সক্রিয়তা', className: 'plat-label' }),
      statRow(d,
        statCard(d, {
          label: 'শুধু পড়া', value: bn(f.access.readOnly),
          note: 'সীমিত বা রক্ষণাবেক্ষণে',
        }),
        statCard(d, {
          label: 'নতুন যুক্ত', value: bn(fresh),
          note: `গত ${bn(ONBOARDING_WINDOW_DAYS)} দিনে তৈরি`,
        }),
        statCard(d, {
          label: 'অসম্পূর্ণ সেটআপ', value: bn(f.neverActive),
          note: 'তৈরির পর কোনো শিক্ষার্থী যোগ হয়নি',
        }),
        // Set up, invoiced, and not being opened — the quieter and more
        // expensive failure, and the one nobody complains about.
        statCard(d, {
          label: 'অনেকদিন কেউ ঢোকেনি', value: bn(f.quiet),
          note: 'গত ' + bn(QUIET_DAYS) + ' দিনে কেউ প্রবেশ করেননি',
        }),
      )));

    this.renderFeed(root);
  }

  /**
   * §27 — what OUR team has been doing, across every school.
   *
   * The per-institution history answers "what happened to this school". This
   * answers "what have we been doing", which is the question an operator
   * arriving in the morning actually has, and the one that catches a
   * colleague's change nobody mentioned.
   *
   * Same trail, same rows, no second pipeline — `GET platform/audit` without
   * a tenant filter is the cross-institution view it has always served and
   * nothing had ever read.
   */
  private renderFeed(root: HTMLElement): void {
    const d = this.o.doc;
    if (this.feed.length === 0) return;

    const nameOf = new Map(this.rows.map((t) => [t.id, t.nameBn]));
    const shown = this.feed.slice(0, FEED_LIMIT);

    const band = platBand(d, 'plat-feed',
      sectionHeading(d, { title: 'সাম্প্রতিক কার্যক্রম', className: 'plat-label' }),
      el(d, 'p', {
        className: 'plat-note',
        text: 'shikhonBD দল প্ল্যাটফর্ম থেকে যা বদলেছে, নতুনটি আগে। এই তালিকা মোছা যায় না।',
      }),
      dataTable(d, {
        caption: 'প্ল্যাটফর্ম থেকে করা সাম্প্রতিক পরিবর্তন',
        rows: shown,
        rowKey: (r) => r.id,
        columns: [
          { key: 'when', header: 'কখন', mobile: 'title', width: '180px',
            cell: (r) => bnDateTime(r.at) },
          // A platform-wide act — a plan change — belongs to no one school, and
          // saying so is more honest than leaving the cell empty.
          { key: 'who', header: 'প্রতিষ্ঠান', mobile: 'subtitle', width: 'minmax(0, 1.5fr)',
            cell: (r) => r.tenantId
              ? (nameOf.get(r.tenantId) ?? 'অন্য একটি প্রতিষ্ঠান')
              : 'সব প্রতিষ্ঠান' },
          // B-39, closed. This column could not exist before P10-5: the actor
          // was a JWT subject with no row behind it, so the tab showed what,
          // why and when and never who. "নাম নেই" is the honest answer for a
          // credential nobody has named yet — better than a uuid, and better
          // than an empty cell that reads as "nobody".
          { key: 'actor', header: 'কে', mobile: 'meta', width: 'minmax(0, 1fr)',
            cell: (r) => r.actor
              ? (r.actorRevoked ? `${r.actor} (প্রত্যাহৃত)` : r.actor)
              : 'নাম নেই' },
          { key: 'why', header: 'কারণ', mobile: 'meta', width: 'minmax(0, 2fr)',
            cell: (r) => r.reason ?? '—' },
          { key: 'what', header: 'কী হয়েছিল', mobile: 'meta', width: 'minmax(0, 2fr)',
            cell: (r) => r.statement ?? '—' },
        ],
      }));
    if (this.feed.length > shown.length) {
      band.append(el(d, 'p', { className: 'plat-note plat-more' },
        ...numText(d, `আরও ${bn(this.feed.length - shown.length)}টি পুরোনো পরিবর্তন আছে — `
          + 'প্রতিটি প্রতিষ্ঠানের "ইতিহাস" ট্যাবে সেই প্রতিষ্ঠানের পুরো তালিকা আছে।')));
    }
    root.append(band);
  }

  // ── 2. the master list ───────────────────────────────────────────────
  /**
   * Screen ০২: the filter chips on an inset band, then the table, full
   * bleed. The search box and the sort control the drawing does not show
   * sit in one band between them — both are server queries an operator with
   * 258 schools cannot work without.
   */
  private renderList(root: HTMLElement): void {
    const d = this.o.doc;

    root.append(el(d, 'div', { className: 'plat-band-inset plat-filter-band' }, tabs(d, {
      label: 'ছাঁকনি',
      className: 'plat-filters',
      active: this.filter,
      // The counts are the SERVER's, over the whole fleet, and the tab that
      // shows them asks for exactly those rows. A tab counted in the browser
      // over one page would say "৪" and open a list of twenty-seven.
      items: [
        { id: 'all', label: 'সব', count: this.summary?.total ?? 0 },
        { id: 'attention', label: 'নজর দরকার',
          count: (this.summary?.attention.critical ?? 0)
               + (this.summary?.attention.warning ?? 0) },
        { id: 'overdue', label: 'বকেয়া',
          count: this.summary?.billing.overdue ?? 0 },
        { id: 'blocked', label: 'স্থগিত / সীমিত',
          count: (this.summary?.access.readOnly ?? 0)
               + (this.summary?.access.none ?? 0) },
      ],
      // Changing a tab is a new QUERY now, not a re-filter of what is held.
      onSelect: (id) => { this.filter = id; this.page.page = 1; void this.load(); },
    })));

    const search = field(d, {
      label: 'খুঁজুন', name: 'q', kind: 'search',
      value: this.search,
      placeholder: 'নাম, স্লাগ বা জেলা',
      onInput: (v) => {
        this.search = v;
        // Debounced: a keystroke is a database query now, not a filter over
        // an array that is already in memory.
        if (this.searchTimer !== null) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
          this.page.page = 1;
          void this.load(true);
        }, 250) as unknown as number;
      },
    });

    // ── Sorting ──
    //
    // A labelled SELECT rather than clickable column headers, for two
    // reasons: this table renders as a list below 1024px, where there are no
    // headers to click at all, and a select is one tab stop with a name a
    // screen reader reads — where twelve sortable headers are twelve stops
    // that each announce a column name and leave the reader to infer that it
    // sorts.
    const sortRow = el(d, 'div', { className: 'plat-sort' });
    const sortSel = field(d, {
      label: 'সাজান', name: 'sort', kind: 'select',
      value: this.page.sort,
      options: [
        { value: 'name', label: 'নাম' },
        { value: 'severity', label: 'অগ্রাধিকার' },
        { value: 'students', label: 'শিক্ষার্থী' },
        { value: 'active', label: 'সর্বশেষ সক্রিয়' },
        { value: 'status', label: 'অবস্থা' },
        { value: 'plan', label: 'প্ল্যান' },
        { value: 'created', label: 'তৈরির তারিখ' },
      ],
      onChange: (v) => {
        this.page.sort = v; this.page.page = 1; void this.load();
      },
    });
    append(sortRow, sortSel.root);
    sortRow.append(button(d, {
      label: this.page.dir === 'desc' ? '↓ বড় থেকে ছোট' : '↑ ছোট থেকে বড়',
      variant: 'ghost',
      // Its words flip with the order; the focus keeper still knows it.
      attrs: { 'data-focus-key': 'plat-sort-dir' },
      onClick: () => {
        this.page.dir = this.page.dir === 'desc' ? 'asc' : 'desc';
        this.page.page = 1;
        void this.load();
      },
    }));
    root.append(platBand(d, 'plat-tools', search.root, sortRow));

    const host = el(d, 'div', { className: 'plat-table-host plat-fleet' });
    root.append(host);
    this.tableHost = host;
    this.repaintTable();
    this.pagerEl = this.pager();
    root.append(this.pagerEl);
  }

  /**
   * Which page of how many, and how to move.  (P10-1)
   *
   * The count is the SERVER's total for the current filter, not the length of
   * what is on screen. A list that says "২৫টি" because twenty-five fit on a
   * page is a list an operator stops scrolling — and with 258 schools that is
   * two hundred and thirty-three they never see.
   */
  private pager(): HTMLElement {
    const d = this.o.doc;
    const { page, pages, total, size } = this.page;
    const nav = el(d, 'nav', { className: 'plat-pager' });
    nav.setAttribute('aria-label', 'পৃষ্ঠা');

    const from = total === 0 ? 0 : (page - 1) * size + 1;
    const to = Math.min(page * size, total);
    const count = el(d, 'p', { className: 'plat-pager-count' },
      ...numText(d, total === 0
        ? 'কোনো প্রতিষ্ঠান পাওয়া যায়নি'
        : `${bn(from)}–${bn(to)} / মোট ${bn(total)}টি`));
    // After pressing "next" the only thing that changed for a screen-reader
    // user is this sentence, so it has to announce itself.
    count.setAttribute('aria-live', 'polite');
    nav.append(count);

    const step = (delta: number, label: string): HTMLElement => {
      const b = button(d, {
        label, variant: 'secondary', size: 'sm',
        onClick: () => { this.page.page = page + delta; void this.load(); },
      });
      if (page + delta < 1 || page + delta > pages) {
        b.setAttribute('disabled', 'true');
      }
      return b;
    };
    nav.append(step(-1, 'আগের'));
    nav.append(el(d, 'span', { className: 'plat-pager-of' },
      ...numText(d, `পৃষ্ঠা ${bn(page)} / ${bn(pages)}`)));
    nav.append(step(1, 'পরের'));
    return nav;
  }

  private tableHost: HTMLElement | null = null;
  /** The pager on screen, so a search's answer can replace just it. */
  private pagerEl: HTMLElement | null = null;

  private searchTimer: number | null = null;
  /** Which load is the latest; an older one's answer is dropped. */
  private loadSeq = 0;

  /** The institutions list is on screen, drawn from loaded rows (see load). */
  private showsResults(): boolean {
    const host = this.tableHost;
    return this.tab === 'institutions' && !this.openId && !this.loading
      && host !== null && this.o.root.contains(host);
  }

  /**
   * The page the server drew, unfiltered.
   *
   * This used to re-filter and re-search `this.rows` in the browser, which
   * only worked because `this.rows` WAS the entire fleet. Doing it to a page
   * would silently drop schools that match but happen to be on page four —
   * a search that answers "not found" about a school that exists. The search
   * box and the tabs are database queries now, so there is nothing left to
   * do here but hand back what came.
   */
  private visible(): TenantOverview[] {
    return this.rows;
  }

  /**
   * Repaint only the table.
   *
   * A search box that re-renders the whole page loses its own focus on every
   * keystroke — which is the one thing a search box may not do.
   */
  private repaintTable(): void {
    const d = this.o.doc;
    const host = this.tableHost;
    if (!host) return;
    host.replaceChildren();

    const unfiltered = !this.search && this.filter === 'all';
    host.append(dataTable(d, {
      caption: 'প্রতিষ্ঠানের তালিকা',
      rows: this.visible(),
      rowKey: (t) => t.id,
      onRowClick: (t) => { void this.openDetail(t.id); },
      empty: {
        glyph: 'search',
        message: this.search
          ? 'এই নামে কোনো প্রতিষ্ঠান পাওয়া যায়নি।'
          : this.filter === 'all'
            ? 'কোনো প্রতিষ্ঠান নেই।'
            : 'এই ছাঁকনিতে কোনো প্রতিষ্ঠান নেই।',
        // The next action, only where there is one: an empty FLEET is filled
        // by onboarding a school, an empty filter is not.
        action: unfiltered
          ? { label: 'নতুন প্রতিষ্ঠান', onClick: () => this.o.onNewTenant() }
          : undefined,
      },
      // Screen ০২'s columns. The school's slug is on its page and in the
      // search; its billing state and its cap fold into the অবস্থা chip and
      // the শিক্ষার্থী cell. Last use stays — the list sorts by it, and a
      // school nobody has signed in to is the one an operator most wants.
      columns: [
        { key: 'name', header: 'প্রতিষ্ঠান', mobile: 'title', width: 'minmax(0, 2fr)',
          cell: (t) => t.nameBn },
        { key: 'plan', header: 'প্ল্যান', mobile: 'subtitle', width: 'minmax(0, 1.2fr)',
          cell: (t) => t.planName ?? t.planCode },
        // "৫০০ / ৫০০" only when the cap is reached or near — the drawing's
        // rule, so the cap is read where it matters and not on every row.
        { key: 'students', header: 'শিক্ষার্থী', mobile: 'meta', numeric: true,
          width: '130px',
          cell: (t) => t.studentCap > 0 && t.studentCount >= t.studentCap * 0.9
            ? `${bn(t.studentCount)} / ${bn(t.studentCap)}`
            : bn(t.studentCount) },
        { key: 'due', header: 'পরের বিল', mobile: 'meta', width: '150px',
          cell: (t) => {
            if (!t.nextDueOn) return '—';
            const late = t.billingState === 'limited' ? overdueDays(t.nextDueOn) : 0;
            return late > 0 ? `${bn(late)} দিন পার` : bnDate(t.nextDueOn);
          } },
        // §26 — measured, from real sign-ins and real product events.
        { key: 'seen', header: 'শেষ ব্যবহার', mobile: 'meta', width: '160px',
          cell: (t) => t.lastActiveAt ? bnDate(t.lastActiveAt) : 'কখনো নয়' },
        // The EFFECTIVE answer, not `ops_state`. A school suspended by its
        // legacy status, its bill or a closed portal has `ops_state` of
        // 'active', and a list an operator scans for trouble must not show
        // "সক্রিয়" next to a school nobody can sign in to.
        { key: 'access', header: 'অবস্থা', mobile: 'status', width: '150px',
          cell: (t) => statusBadge(d, fleetState(t)) },
      ],
    }));
  }

  // ── 3. the command centre ────────────────────────────────────────────
  /**
   * One school, as a page under প্রতিষ্ঠান (screen ০৩): its name in the bar
   * with the billing alarm and the two things done FROM here, the six-tab
   * strip, then the tab's content in one band.
   */
  private renderDetail(root: HTMLElement): void {
    const d = this.o.doc;
    const id = this.openId;
    if (!id) return;
    const t = this.rows.find((x) => x.id === id) ?? this.queueRows.find((x) => x.id === id);
    const o = this.ops;

    const head = pageHeader(d, {
      className: 'plat-bar',
      title: t?.nameBn ?? 'প্রতিষ্ঠান',
      actions: o ? [
        this.billingChip(o),
        button(d, {
          label: 'প্রভিশনিং ও ব্র্যান্ডিং', variant: 'secondary', size: 'sm', glyph: 'settings',
          onClick: () => { this.closeDetail(); this.o.onOpenTenant(id); },
        }),
        // A second way to the same confirmation the overview's state cards
        // use — named consequence, required reason. Not offered once it is.
        o.opsState === 'suspended' ? null : button(d, {
          label: 'স্থগিত করুন', variant: 'danger', size: 'sm',
          disabled: this.busy,
          onClick: () => this.askState(id, 'suspended', OPS_BN.suspended),
        }),
      ] : [],
    });
    // The page's name takes focus when a school is opened (openDetail).
    titleTarget(head);
    root.append(head);

    if (this.flash(root, () => { void this.openDetail(id); })) return;
    if (!o) {
      if (!this.error) root.append(platBand(d, 'plat-loading', listSkeleton(d, 4)));
      return;
    }

    root.append(tabs(d, {
      label: 'বিভাগ',
      className: 'plat-detail-tabs',
      active: this.detailTab,
      items: [
        { id: 'overview', label: 'সারসংক্ষেপ' },
        { id: 'services', label: 'সেবা' },
        { id: 'portals', label: 'প্রবেশ' },
        { id: 'billing', label: 'সাবস্ক্রিপশন' },
        { id: 'payments', label: 'পেমেন্ট', count: this.payments.length },
        { id: 'audit', label: 'ইতিহাস' },
      ],
      onSelect: (x) => { this.detailTab = x; this.render(); },
    }));

    const body = platBand(d, 'plat-detail');
    if (this.detailTab === 'overview') append(body, this.identity(o, t), this.overviewTab(o, id));
    if (this.detailTab === 'services') append(body, this.servicesTab(id));
    if (this.detailTab === 'portals') append(body, this.portalsTab(o, id));
    if (this.detailTab === 'billing') append(body, this.billingTab(o, id));
    if (this.detailTab === 'payments') append(body, this.paymentsTab(id));
    if (this.detailTab === 'audit') append(body, this.auditTab());
    root.append(body);
  }

  /**
   * The bar's chip: only an alarm, as drawn ("বকেয়া · ১২ দিন"). A school in
   * good standing gets no chip; its billing state is on the overview and the
   * subscription tab.
   */
  private billingChip(o: Operations): HTMLElement | null {
    const d = this.o.doc;
    if (o.billingState === 'limited') {
      const late = o.nextDueOn ? overdueDays(o.nextDueOn) : 0;
      return statusBadge(d, {
        state: 'overdue', label: late > 0 ? `বকেয়া · ${bn(late)} দিন` : 'বকেয়া',
      });
    }
    if (o.billingState === 'grace_period') {
      return statusBadge(d, BILLING_BN.grace_period);
    }
    return null;
  }

  /**
   * Show a confirmation where the operator can reach it.
   *
   * Inside a drawer when one is open, because a drawer is a modal: it covers
   * the page with a scrim and marks everything outside itself `aria-hidden`.
   * Otherwise in the school page's content band, under what the operator is
   * looking at.
   *
   * Focus moves to the dialogue's first control, which `confirmDialog` puts
   * in the DOM as Cancel on purpose: the way out is the first thing reached.
   */
  private showConfirm(dlg: HTMLElement): void {
    const host = this.drawer?.el.querySelector('.ui-dialog-body')
      ?? this.o.root.querySelector('.plat-detail')
      ?? this.o.root;
    host.append(dlg);
    dlg.scrollIntoView({ block: 'nearest' });
    (dlg.querySelector('button') as HTMLElement | null)?.focus();
  }

  /** Close the plan or operator drawer. A school's page is closed by closeDetail. */
  private closeDrawer(): void {
    this.drawer?.close();
    this.drawer = null;
  }

  /** Above the fold: who, what state, and the three numbers that decide. */
  private identity(o: Operations, t?: TenantOverview): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', { className: 'plat-identity' });
    const ops = OPS_BN[o.opsState] ?? { label: o.opsState, state: 'draft', effect: '' };

    // The headline is the EFFECTIVE answer, not the `ops_state` field.
    //
    // Four things can block a school — the ops state this console sets, the
    // legacy `tenants.status`, the bill, and a closed portal — and only the
    // first is `ops_state`. Leading with the field produced "সক্রিয়" above
    // "কেউ প্রবেশ করতে পারছেন না" on a school suspended by its status column,
    // which tells an operator nothing about which control to reach for.
    const ACCESS_BN: Record<string, string> = {
      full: 'সব চালু', read_only: 'শুধু পড়া যাবে', none: 'কেউ প্রবেশ করতে পারছেন না',
    };
    // When the ops state does NOT explain the answer, say what does.
    const disagrees = o.access !== 'full' && o.opsState === 'active';
    const full = o.studentCap > 0 && o.studentCount >= o.studentCap;
    append(wrap, statRow(d,
      statCard(d, {
        label: 'এখন যা সম্ভব', value: ACCESS_BN[o.access] ?? o.access,
        tone: o.access === 'full' ? 'success' : o.access === 'none' ? 'danger' : 'warn',
        note: disagrees
          ? `প্রতিষ্ঠানের অবস্থা "${ops.label}" — বাধাটি বিলিং, প্রবেশপথ বা পুরোনো স্ট্যাটাস থেকে`
          : `প্রতিষ্ঠানের অবস্থা: ${ops.label}`,
      }),
      statCard(d, {
        label: 'শিক্ষার্থী', value: `${bn(o.studentCount)} / ${bn(o.studentCap)}`,
        tone: full ? 'danger' : undefined,
        note: full ? 'সীমা পূর্ণ' : undefined,
      }),
      statCard(d, {
        label: 'বিলিং',
        value: (BILLING_BN[o.billingState] ?? { label: o.billingState }).label,
        tone: o.billingState === 'limited' ? 'danger'
          : o.billingState === 'grace_period' ? 'warn' : undefined,
        note: o.nextDueOn ? `শেষ তারিখ ${bnDate(o.nextDueOn)}` : 'কোনো তারিখ নির্ধারিত নেই',
      }),
    ));

    // What the SCHOOL is being told right now. An operator must be able to
    // read the sentence their own decision is producing.
    if (o.reasonBn) {
      append(wrap, card(d, {
        title: 'প্রতিষ্ঠান যা দেখছে', glyph: 'message', headingLevel: 2,
        tone: o.access === 'none' ? 'warn' : 'info',
      }, el(d, 'p', { className: 'ui-card-lead' }, ...numText(d, o.reasonBn))));
    }
    if (t) {
      const dl = el(d, 'dl', { className: 'ui-facts' });
      append(dl,
        el(d, 'dt', { className: 'ui-facts-key', text: 'ঠিকানা' }),
        el(d, 'dd', { className: 'ui-facts-val' }, ...numText(d, t.slug)),
        el(d, 'dt', { className: 'ui-facts-key', text: 'জেলা' }),
        el(d, 'dd', { className: 'ui-facts-val', text: t.district || '—' }),
        el(d, 'dt', { className: 'ui-facts-key', text: 'ব্যবহারকারী' }),
        el(d, 'dd', { className: 'ui-facts-val' }, ...numText(d, `${bn(t.userCount)} জন`)),
        el(d, 'dt', { className: 'ui-facts-key', text: 'যুক্ত হয়েছে' }),
        el(d, 'dd', { className: 'ui-facts-val' }, ...numText(d, bnDate(t.createdAt))));
      append(wrap, card(d, { title: 'পরিচয়', glyph: 'star', headingLevel: 2 }, dl));
    }
    return wrap;
  }

  /** The tenant-wide control. Four states, each explained before it is taken. */
  private overviewTab(o: Operations, id: string): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', { className: 'plat-overview' });
    append(wrap, sectionHeading(d, { title: 'প্রতিষ্ঠানের অবস্থা', className: 'plat-label' }));

    for (const state of ['active', 'maintenance', 'limited', 'suspended']) {
      const meta = OPS_BN[state];
      const current = o.opsState === state;
      append(wrap, card(d, {
        title: meta.label,
        glyph: state === 'active' ? 'check-square' : state === 'suspended' ? 'alert-triangle' : 'lock',
        headingLevel: 3,
        action: current
          ? statusBadge(d, { state: 'published', label: 'বর্তমান' })
          : button(d, {
              label: `${meta.label} করুন`,
              variant: state === 'suspended' ? 'danger' : 'secondary',
              size: 'sm',
              disabled: this.busy,
              onClick: () => this.askState(id, state, meta),
            }),
      },
        // The consequence, always, whether or not it is the current state.
        // An operator comparing two states must be able to read both.
        el(d, 'p', { className: 'ui-card-note', text: meta.effect }),
        current && o.stateReason
          ? el(d, 'p', { className: 'ui-card-note' }, ...numText(d, `কারণ: ${o.stateReason}`))
          : null,
      ));
    }

    append(wrap, sectionHeading(d, { title: 'শিক্ষার্থীর সীমা', className: 'plat-label' }));
    const cap = field(d, {
      label: 'সর্বোচ্চ শিক্ষার্থী', name: 'studentCap', kind: 'number',
      value: String(o.studentCap),
      helper: `এখন ভর্তি ${bn(o.studentCount)} জন · প্ল্যানে ${bn(o.planCap ?? o.studentCap)} জন পর্যন্ত`,
      attrs: { min: 1 },
    });
    const capReason = field(d, {
      label: 'কারণ', name: 'capReason', required: true,
      placeholder: 'যেমন: নতুন শাখা খুলেছে',
    });
    append(wrap, card(d, { title: 'সীমা পরিবর্তন', glyph: 'users', headingLevel: 3 },
      cap.root, capReason.root,
      buttonRow(d, button(d, {
        label: 'সীমা সংরক্ষণ করুন', variant: 'secondary', busy: this.busy,
        onClick: () => {
          clearFieldError(capReason.root);
          if (!capReason.value().trim()) {
            setFieldError(capReason.root, 'কারণ লিখুন।');
            capReason.input.focus();
            return;
          }
          void this.act('/cap', {
            tenantId: id, studentCap: Number(cap.value()), reason: capReason.value().trim(),
          }, 'শিক্ষার্থীর সীমা পরিবর্তন হয়েছে।');
        },
      }))));
    return wrap;
  }

  /**
   * A state change is the most consequential thing on this screen, so it
   * always passes through a confirmation that names the consequence and
   * demands a reason in the same step.
   */
  private askState(id: string, state: string, meta: { label: string; effect: string }): void {
    const d = this.o.doc;
    const reason = field(d, {
      label: 'কারণ', name: 'reason', required: true,
      helper: 'প্রতিষ্ঠান এই কারণটিই দেখতে পাবে।',
      placeholder: state === 'suspended' ? 'যেমন: চুক্তি নবায়ন হয়নি' : '',
    });
    const host = el(d, 'div');
    append(host, reason.root);
    const dlg = confirmDialog({
      doc: d,
      title: `${meta.label} — নিশ্চিত করুন`,
      body: meta.effect,
      confirmLabel: meta.label,
      danger: state === 'suspended' || state === 'limited',
      // The reason is checked while the dialog is still on screen: onConfirm
      // runs after it closes, where an error has nowhere to show.
      validate: () => {
        if (reason.value().trim()) return true;
        setFieldError(reason.root, 'কারণ ছাড়া পরিবর্তন করা যায় না।');
        reason.input.focus();
        return false;
      },
      onConfirm: () => {
        void this.act('/opsstate',
          { tenantId: id, state, reason: reason.value().trim() },
          `${meta.label} করা হয়েছে।`);
      },
    });
    // The reason field goes INSIDE the confirmation: a yes/no followed by a
    // second dialog asking why is two decisions where there is one.
    dlg.querySelector('.notice-confirm-line')?.after(host);
    this.showConfirm(dlg);
  }

  /**
   * §6 — every service, its effective state, and what changing it does.
   *
   * As drawn (screen ০৩): a label, a note, then one row per service — its
   * name over what switching it off does, a word-chip when it is not on, and
   * a switch. The switch changes nothing by itself: it opens the same
   * confirmation, with the consequence and a required reason, that the
   * buttons did.
   */
  private servicesTab(id: string): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', { className: 'plat-settings-section' });
    const stateOf = new Map(this.effective.map((s) => [s.code, s.state]));

    append(wrap,
      sectionHeading(d, { title: 'সেবা চালু / বন্ধ', className: 'plat-label' }),
      el(d, 'p', {
        className: 'plat-note',
        text: 'প্ল্যান ঠিক করে কোন সেবা কেনা আছে; এখান থেকে সেই সেবা এই প্রতিষ্ঠানের '
          + 'জন্য বন্ধ বা সীমিত করা যায়। প্ল্যানে না থাকা সেবা এখান থেকে চালু করা যায় না।',
      }));

    const rows = list(d, 'সেবার তালিকা ও অবস্থা', ...this.services.map((s) => listItem(d, {
      title: s.nameBn,
      // What turning it off DOES, in the row, so the consequence is read
      // before the control is reached rather than after.
      subtitle: s.effectBn,
      status: this.serviceActions(id, s, stateOf.get(s.code) ?? 'unknown'),
    })));
    rows.classList.add('plat-settings');
    append(wrap, rows);
    return wrap;
  }

  private serviceActions(id: string, s: ServiceRow, state: string): HTMLElement {
    const d = this.o.doc;
    const row = el(d, 'div', { className: 'ui-row-actions' });
    if (state !== 'enabled') {
      append(row, statusBadge(d, SERVICE_STATE_BN[state] ?? SERVICE_STATE_BN.unknown));
    }
    if (state === 'not_in_plan') {
      // Not "switched off" — not bought. Different remedy, so a different
      // sentence and no control that would fail.
      append(row, el(d, 'span', { className: 'ui-card-note', text: 'প্ল্যান বদলান' }));
      return row;
    }
    // Read-only, maintenance or unknown is neither on nor off: the switch
    // turns it back on, and "বন্ধ" switches it fully off, as before.
    if (state !== 'enabled' && state !== 'disabled') {
      append(row, button(d, {
        label: 'বন্ধ', variant: 'danger', size: 'sm',
        ariaLabel: `${s.nameBn} — বন্ধ`,
        disabled: this.busy,
        onClick: () => this.askService(id, s, 'disabled', 'বন্ধ'),
      }));
    }
    const on = state === 'enabled';
    append(row, this.switchControl(
      on, `${s.nameBn} — ${on ? 'বন্ধ করুন' : 'চালু করুন'}`,
      () => this.askService(id, s, on ? 'disabled' : 'enabled', on ? 'বন্ধ' : 'চালু')));
    return row;
  }

  /**
   * The drawn switch: `role="switch"` with its state in `aria-checked` and a
   * name that says what pressing it asks for. Pressing it opens a
   * confirmation; the state changes only when the server says it has.
   */
  private switchControl(on: boolean, label: string, onPress: () => void): HTMLElement {
    const d = this.o.doc;
    const sw = el(d, 'button', {
      className: 'plat-switch',
      attrs: {
        type: 'button', role: 'switch', 'aria-checked': String(on),
        'aria-label': label, disabled: this.busy || null,
      },
    }, el(d, 'span', { className: 'plat-switch-knob', attrs: { 'aria-hidden': 'true' } }));
    sw.addEventListener('click', onPress);
    return sw;
  }

  private askService(id: string, s: ServiceRow, next: string, label: string): void {
    const d = this.o.doc;
    const reason = field(d, { label: 'কারণ', name: 'reason', required: true });
    const host = el(d, 'div');
    append(host, reason.root);
    const dlg = confirmDialog({
      doc: d,
      title: `${s.nameBn} — ${label}`,
      body: next === 'disabled'
        ? s.effectBn
        : `${s.nameBn} আবার চালু হবে — প্ল্যানে থাকলে।`,
      confirmLabel: label,
      danger: next === 'disabled',
      // The reason is checked while the dialog is still on screen: onConfirm
      // runs after it closes, where an error has nowhere to show.
      validate: () => {
        if (reason.value().trim()) return true;
        setFieldError(reason.root, 'কারণ লিখুন।');
        reason.input.focus();
        return false;
      },
      onConfirm: () => {
        void this.act('/service',
          { tenantId: id, service: s.code, state: next, reason: reason.value().trim() },
          `${s.nameBn} — ${label} করা হয়েছে।`);
      },
    });
    dlg.querySelector('.notice-confirm-line')?.after(host);
    this.showConfirm(dlg);
  }

  /** §8 — per-portal sign-in, never by deleting users or roles. The same rows as the services. */
  private portalsTab(o: Operations, id: string): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', { className: 'plat-settings-section' });
    append(wrap,
      sectionHeading(d, { title: 'পোর্টাল প্রবেশ', className: 'plat-label' }),
      el(d, 'p', {
        className: 'plat-note',
        text: 'কোনো ব্যবহারকারী বা ভূমিকা মুছে ফেলা হয় না — শুধু এই মুহূর্তে প্রবেশ '
          + 'বন্ধ থাকে। আবার চালু করলে সবাই আগের মতোই ফিরে পাবেন।',
      }));

    const rows = list(d, 'পোর্টালভিত্তিক প্রবেশ', ...Object.keys(PORTAL_BN).map((code) => {
      const open = o.portals[code] !== false;
      return listItem(d, {
        title: PORTAL_BN[code],
        status: el(d, 'div', { className: 'ui-row-actions' },
          // Closed says so in words; the switch alone would be colour.
          open ? null : statusBadge(d, { state: 'overdue', label: 'প্রবেশ বন্ধ' }),
          this.switchControl(open,
            `${PORTAL_BN[code]} — ${open ? 'প্রবেশ বন্ধ করুন' : 'প্রবেশ খুলে দিন'}`,
            () => this.askPortal(id, code, !open))),
      });
    }));
    rows.classList.add('plat-settings');
    append(wrap, rows);
    return wrap;
  }

  private askPortal(id: string, portal: string, open: boolean): void {
    const d = this.o.doc;
    const reason = field(d, { label: 'কারণ', name: 'reason', required: true });
    const host = el(d, 'div');
    append(host, reason.root);
    const dlg = confirmDialog({
      doc: d,
      title: `${PORTAL_BN[portal]} — ${open ? 'প্রবেশ খুলুন' : 'প্রবেশ বন্ধ করুন'}`,
      body: open
        ? `${PORTAL_BN[portal]} আবার লগইন করতে পারবেন।`
        : `${PORTAL_BN[portal]} এখন থেকে লগইন করতে পারবেন না। `
          + 'তাঁদের অ্যাকাউন্ট, ভূমিকা ও সব তথ্য অক্ষত থাকবে।',
      confirmLabel: open ? 'খুলে দিন' : 'বন্ধ করুন',
      danger: !open,
      // The reason is checked while the dialog is still on screen: onConfirm
      // runs after it closes, where an error has nowhere to show.
      validate: () => {
        if (reason.value().trim()) return true;
        setFieldError(reason.root, 'কারণ লিখুন।');
        reason.input.focus();
        return false;
      },
      onConfirm: () => {
        void this.act('/portal',
          { tenantId: id, portal, open, reason: reason.value().trim() },
          `${PORTAL_BN[portal]} — ${open ? 'প্রবেশ খোলা হয়েছে' : 'প্রবেশ বন্ধ করা হয়েছে'}।`);
      },
    });
    dlg.querySelector('.notice-confirm-line')?.after(host);
    this.showConfirm(dlg);
  }

  /** §11 §13 §14 — the plan, the lifecycle, and the grace window. */
  private billingTab(o: Operations, id: string): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', { className: 'plat-billing' });

    const dl = el(d, 'dl', { className: 'ui-facts' });
    const facts: Array<[string, string]> = [
      ['প্ল্যান', o.planName ?? o.planCode],
      ['মূল্য', o.planPrice ? `${formatBdt(o.planPrice)} / ${CYCLE_BN[o.billingCycle ?? ''] ?? o.billingCycle}` : '—'],
      ['বর্তমান অবস্থা', (BILLING_BN[o.billingState] ?? { label: o.billingState }).label],
      ['পরবর্তী শেষ তারিখ', o.nextDueOn ? bnDate(o.nextDueOn) : 'নির্ধারিত নেই'],
      ['ছাড়ের মেয়াদ', o.graceUntil ? bnDate(o.graceUntil) : `প্ল্যান অনুযায়ী ${bn(o.graceDays ?? 0)} দিন`],
      ['ট্রায়াল শেষ', o.trialEndsOn ? bnDate(o.trialEndsOn) : '—'],
    ];
    for (const [k, v] of facts) {
      append(dl,
        el(d, 'dt', { className: 'ui-facts-key', text: k }),
        el(d, 'dd', { className: 'ui-facts-val' }, ...numText(d, v)));
    }
    append(wrap, card(d, { title: 'সাবস্ক্রিপশন', glyph: 'wallet', headingLevel: 2 },
      dl,
      // The lifecycle is DERIVED. Saying so on the screen stops an operator
      // hunting for a status field to correct.
      el(d, 'p', {
        className: 'ui-card-note',
        text: 'বিলিং অবস্থা তারিখ ও পেমেন্ট থেকে নিজে থেকেই নির্ধারিত হয় — '
          + 'হাতে বদলানোর কোনো ঘর নেই। পেমেন্ট রেকর্ড করলে তারিখ এগোবে এবং '
          + 'অবস্থা নিজেই বদলাবে।',
      })));

    if (o.graceReason) {
      append(wrap, card(d, { title: 'চলতি ছাড়', glyph: 'clock', headingLevel: 2, tone: 'warn' },
        el(d, 'p', { className: 'ui-card-note' }, ...numText(d, o.graceReason))));
    }

    append(wrap, this.planCard(o, id));

    const until = field(d, {
      label: 'ছাড় কত তারিখ পর্যন্ত', name: 'until', kind: 'date',
      value: o.graceUntil ?? '',
      helper: 'এই তারিখ পর্যন্ত প্রতিষ্ঠান পূর্ণ সক্রিয় থাকবে।',
    });
    const why = field(d, { label: 'কারণ', name: 'reason', required: true,
      placeholder: 'যেমন: চেক পাঠানো হয়েছে' });
    append(wrap, card(d, { title: 'ছাড়ের মেয়াদ বাড়ান', glyph: 'clock', headingLevel: 2 },
      until.root, why.root,
      buttonRow(d, button(d, {
        label: 'ছাড় দিন', variant: 'secondary', busy: this.busy,
        onClick: () => {
          clearFieldError(why.root);
          if (!until.value()) { setFieldError(until.root, 'তারিখ দিন।'); return; }
          if (!why.value().trim()) {
            setFieldError(why.root, 'কারণ লিখুন।');
            why.input.focus();
            return;
          }
          void this.act('/grace',
            { tenantId: id, until: until.value(), reason: why.value().trim() },
            'ছাড়ের মেয়াদ বাড়ানো হয়েছে।');
        },
      }))));
    return wrap;
  }

  /** §33 — what this console has done to this school, and why. */
  private auditTab(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', { className: 'plat-audit' });

    append(wrap,
      sectionHeading(d, { title: 'পরিবর্তনের ইতিহাস', className: 'plat-label' }),
      el(d, 'p', {
        className: 'plat-note',
        text: 'shikhonBD-এর পক্ষ থেকে এই প্রতিষ্ঠানে করা প্রতিটি পরিবর্তন, '
          + 'সঙ্গে যে কারণ লেখা হয়েছিল। এই তালিকা মোছা যায় না।',
      }));

    if (this.audit.length === 0) {
      append(wrap, emptyState(d, {
        glyph: 'clock',
        message: 'এই প্রতিষ্ঠানে shikhonBD থেকে এখনো কোনো পরিবর্তন করা হয়নি।',
      }));
      return wrap;
    }

    append(wrap, dataTable(d, {
      caption: 'প্ল্যাটফর্ম থেকে করা পরিবর্তন',
      rows: this.audit,
      rowKey: (r) => r.id,
      columns: [
        { key: 'when', header: 'কখন', mobile: 'title', width: '190px',
          cell: (r) => bnDateTime(r.at) },
        // The operator's own sentence. It is the column that makes this list
        // worth keeping — "suspended" tells nobody anything six months later.
        { key: 'why', header: 'কারণ', mobile: 'subtitle',
          cell: (r) => r.reason ?? '—', width: 'minmax(0, 2fr)' },
        { key: 'what', header: 'কী হয়েছিল', mobile: 'meta',
          cell: (r) => r.statement ?? '—', width: 'minmax(0, 2fr)' },
      ],
    }));
    return wrap;
  }

  /**
   * §16 — move a school to another plan.
   *
   * One control, four consequences: price, student cap, which services are
   * bought, and how many days of grace the bill gets. They are named on the
   * screen before the change, because a plan code alone tells an operator
   * none of them — and the operator is usually doing this while a headmaster
   * is on the phone.
   *
   * The cap moves with the plan unless it is already higher: a school that
   * negotiated 1,600 seats on a 1,500 plan does not lose them to an unrelated
   * plan change. And a plan whose cap is below the school's current roll is
   * refused here rather than at the server, with both numbers.
   */
  private planCard(o: Operations, id: string): HTMLElement {
    const d = this.o.doc;
    const enrolled = o.studentCount;
    const current = this.plans.find((p) => p.code === o.planCode);

    const pick = field(d, {
      label: 'প্ল্যান', name: 'planCode', kind: 'select', value: o.planCode,
      options: this.plans.map((p) => ({
        value: p.code,
        label: `${p.nameBn} — ${formatBdt(p.priceBdt)} / ${CYCLE_BN[p.billingCycle] ?? p.billingCycle}`,
      })),
    });
    // What the chosen plan would mean, kept current as the operator browses.
    const effect = el(d, 'p', { className: 'ui-card-note' });
    const describe = (): void => {
      const p = this.plans.find((x) => x.code === pick.value());
      effect.replaceChildren();
      if (!p) return;
      const cap = Math.max(p.studentCap, o.studentCap);
      const on = Object.entries(p.services).filter(([, v]) => v).length;
      append(effect, ...numText(d,
        `${p.nameBn}: ${formatBdt(p.priceBdt)} / ${CYCLE_BN[p.billingCycle] ?? p.billingCycle}, `
        + `শিক্ষার্থীর সীমা ${bn(cap)}, ${bn(on)}টি সেবা, ছাড় ${bn(p.graceDays)} দিন।`
        + (p.studentCap < enrolled
          ? ` — এই প্ল্যানের সীমা ${bn(p.studentCap)}, কিন্তু এখানে ${bn(enrolled)} জন শিক্ষার্থী আছে।`
          : '')));
    };
    pick.input.addEventListener('change', describe);
    describe();

    const why = field(d, { label: 'কারণ', name: 'reason', required: true,
      placeholder: 'যেমন: নতুন চুক্তি স্বাক্ষরিত' });

    return card(d, { title: 'প্ল্যান বদলান', glyph: 'layers', headingLevel: 2 },
      pick.root, effect, why.root,
      buttonRow(d, button(d, {
        label: 'প্ল্যান বদলান', variant: 'secondary', busy: this.busy,
        onClick: () => {
          clearFieldError(pick.root); clearFieldError(why.root);
          const next = this.plans.find((x) => x.code === pick.value());
          if (!next) { setFieldError(pick.root, 'প্ল্যান বেছে নিন।'); return; }
          if (next.code === o.planCode) {
            setFieldError(pick.root, 'এটি এখনকার প্ল্যানই — অন্য একটি বেছে নিন।');
            return;
          }
          if (!why.value().trim()) {
            setFieldError(why.root, 'কারণ লিখুন।');
            why.input.focus();
            return;
          }
          const cap = Math.max(next.studentCap, o.studentCap);
          if (cap < enrolled) {
            setFieldError(pick.root,
              `এই প্ল্যানে সীমা ${bn(cap)}, কিন্তু এখানে ${bn(enrolled)} জন শিক্ষার্থী আছে।`);
            return;
          }
          const dlg = confirmDialog({
            doc: d,
            title: 'প্ল্যান বদল — নিশ্চিত করুন',
            body: `${current?.nameBn ?? o.planCode} থেকে ${next.nameBn}। `
              + `নতুন মূল্য ${formatBdt(next.priceBdt)} / `
              + `${CYCLE_BN[next.billingCycle] ?? next.billingCycle}, `
              + `শিক্ষার্থীর সীমা ${bn(cap)}। `
              + 'প্ল্যানে না থাকা সেবা সঙ্গে সঙ্গে বন্ধ হয়ে যাবে।',
            confirmLabel: 'প্ল্যান বদলান',
            onConfirm: () => {
              void this.act('/plan',
                { tenantId: id, planCode: next.code, studentCap: cap,
                  reason: why.value().trim() },
                'প্ল্যান বদলানো হয়েছে।');
            },
          });
          this.showConfirm(dlg);
        },
      })));
  }

  /** §12 — manual payments. No gateway, by decision. */
  private paymentsTab(id: string): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'section', { className: 'plat-payments' });

    const amount = field(d, { label: 'টাকার পরিমাণ', name: 'amountBdt', kind: 'number',
      required: true, attrs: { min: 1, step: '0.01' } });
    const paidOn = field(d, { label: 'পরিশোধের তারিখ', name: 'paidOn', kind: 'date',
      required: true, value: todayLocalIso() });
    const method = field(d, {
      label: 'মাধ্যম', name: 'method', kind: 'select', required: true,
      options: Object.entries(METHOD_BN).map(([value, label]) => ({ value, label })),
    });
    const reference = field(d, { label: 'রেফারেন্স', name: 'reference',
      helper: 'ব্যাংক স্লিপ বা ট্রানজেকশন নম্বর — একই দিনে দুটি পেমেন্ট আলাদা করতে লাগে।' });
    const covers = field(d, { label: 'কত তারিখ পর্যন্ত মেয়াদ', name: 'coversUntil',
      kind: 'date', helper: 'দিলে পরবর্তী শেষ তারিখ এখানেই সরে যাবে।' });
    const note = field(d, { label: 'নোট', name: 'note', kind: 'textarea', attrs: { rows: 2 } });

    append(wrap, card(d, { title: 'পেমেন্ট রেকর্ড করুন', glyph: 'wallet', headingLevel: 2 },
      amount.root, paidOn.root, method.root, reference.root, covers.root, note.root,
      buttonRow(d, button(d, {
        label: 'রেকর্ড করুন', variant: 'primary', busy: this.busy,
        onClick: () => {
          clearFieldError(amount.root);
          const v = Number(amount.value());
          if (!Number.isFinite(v) || v <= 0) {
            setFieldError(amount.root, 'টাকার পরিমাণ দিন।');
            amount.input.focus();
            return;
          }
          const dlg = confirmDialog({
            doc: d,
            title: 'পেমেন্ট নিশ্চিত করুন',
            body: `${formatBdt(v)} · ${METHOD_BN[method.value()]} · ${bnDate(paidOn.value())}`
              + (covers.value() ? ` — মেয়াদ ${bnDate(covers.value())} পর্যন্ত এগোবে।` : ''),
            confirmLabel: 'রেকর্ড করুন',
            onConfirm: () => void this.act('/payment', {
              tenantId: id, amountBdt: v, paidOn: paidOn.value(),
              method: method.value(), reference: reference.value().trim(),
              coversUntil: covers.value() || null, note: note.value().trim() || null,
            }, 'পেমেন্ট রেকর্ড হয়েছে।'),
          });
          this.showConfirm(dlg);
        },
      }))));

    append(wrap, sectionHeading(d, { title: 'পেমেন্টের ইতিহাস', className: 'plat-label' }));
    append(wrap, dataTable(d, {
      caption: 'রেকর্ড করা পেমেন্ট',
      rows: this.payments,
      rowKey: (p) => `${p.paidOn}-${p.amountBdt}-${p.reference ?? ''}`,
      empty: { glyph: 'wallet', message: 'এখনো কোনো পেমেন্ট রেকর্ড করা হয়নি।' },
      columns: [
        { key: 'on', header: 'তারিখ', mobile: 'title', cell: (p) => bnDate(p.paidOn),
          width: 'minmax(0, 1.4fr)' },
        { key: 'amt', header: 'পরিমাণ', mobile: 'meta', numeric: true,
          cell: (p) => formatBdt(p.amountBdt), width: 'minmax(0, 1.2fr)' },
        { key: 'how', header: 'মাধ্যম', mobile: 'subtitle',
          cell: (p) => METHOD_BN[p.method] ?? p.method, width: 'minmax(0, 1fr)' },
        { key: 'ref', header: 'রেফারেন্স', mobile: 'meta',
          cell: (p) => p.reference || '—', width: 'minmax(0, 1.4fr)' },
        { key: 'covers', header: 'মেয়াদ', mobile: 'meta',
          cell: (p) => (p.coversUntil ? bnDate(p.coversUntil) : '—'),
          width: 'minmax(0, 1.2fr)' },
      ],
    }));
    return wrap;
  }
}

const CYCLE_BN: Record<string, string> = {
  monthly: 'মাস', quarterly: 'ত্রৈমাসিক', yearly: 'বছর',
};
