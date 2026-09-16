/**
 * কার্যবিবরণী — the audit viewer  (R-3 completion pass, Part 5; F-1603)
 *
 * Migration 041 made `audit.activity_log` readable by management and R-3's
 * mutations began writing to it. Nothing displayed it, which meant the log
 * existed for a hypothetical future reader rather than for the school.
 *
 * ── Read-only, and structurally so ─────────────────────────────────────
 * There is no control on this screen that changes anything. That is not
 * restraint in the UI — 010 revokes UPDATE and DELETE from the application
 * role and 041 deliberately did not restore them, so there is no write path
 * to expose. A trail its subject can edit is decoration.
 *
 * ── What a person actually asks it ─────────────────────────────────────
 * Not "show me everything". They arrive with a question: who changed this
 * child's fee permission, who promoted the school, what did the new IT admin
 * do last week. So the filters lead — action, person, date range — and the
 * lists behind them are built from what THIS school has actually done rather
 * than from every action the code can emit. A dropdown of forty possible
 * actions in a school that has performed four is a worse screen.
 *
 * ── The diff is the answer, and it is masked ───────────────────────────
 * "can_pay_fees: true → false" is the whole point of an entry; a row that
 * says only "permissions changed" sends the reader back to the person they
 * were checking. The server redacts anything key-named like a phone, an
 * email or a credential before it leaves, so what renders here is already
 * safe — this screen does not re-decide that.
 *
 * ── Ata Ekta (08 Admin & IT §04) ───────────────────────────────────────
 * One white panel: the filter strip on the inset ground, one row per entry
 * (a stripe for the kind of action · when · who · what, with the record type
 * under it), and the footer note on a 2px rule. Loading, empty and error
 * take the rows' place inside the panel; a refusal replaces the panel.
 * The stripe is decoration over words that already say the same thing —
 * red means somebody changed or removed something — so it is aria-hidden.
 */
import type { Auth } from './auth.ts';
import { bnNum, bnDateTime } from './view-states.ts';
import {
  el, append, numText, pageHeader, button, field, filterBar, dataTable, pagination,
  listSkeleton, emptyState, errorState, permissionMessage, permissionState, tooltip,
  ROLE_BN,
} from './ui/index.ts';

interface Entry {
  id: string;
  at: string;
  actor: { id: string | null; nameBn: string; role: string | null };
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

interface Facets {
  actions: { value: string; count: number }[];
  entityTypes: { value: string; count: number }[];
  actors: { id: string; nameBn: string; count: number }[];
}

export interface AuditViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/**
 * Bangla for each action. An audit line that reads
 * `academic.class_teacher.assign` is a log; one that reads
 * "শ্রেণি শিক্ষক নির্ধারণ" is a record a head teacher can use.
 *
 * 08 §04 puts this word on the row's FIRST line, which is the most read text
 * on the screen — so a code with no Bangla here is not a small gap, it is the
 * screen failing at the one thing it does. The list below is the whole of
 * `AuditAction` in packages/server-core/src/audit.ts (46 codes), checked
 * against it rather than against what happened to be in a fixture. When that
 * union grows, this map grows with it; an unmapped code still renders, as its
 * raw dotted string, because a wrong Bangla guess would be worse than an
 * ugly true one.
 */
const ACTION_BN: Record<string, string> = {
  // একাডেমিক
  'academic.class_teacher.assign':   'শ্রেণি শিক্ষক নির্ধারণ',
  'academic.subject_teacher.assign': 'বিষয় শিক্ষক নির্ধারণ',
  'academic.enrolment.move':         'শিক্ষার্থী স্থানান্তর',
  'academic.rollover.commit':        'বার্ষিক উন্নয়ন সম্পন্ন',
  'academic.year.create':            'শিক্ষাবর্ষ তৈরি',
  'academic.class.create':           'শ্রেণি তৈরি',
  // B-6 allows the NAME only — level, stream, group and year are not editable.
  'academic.class.update':           'শ্রেণির নাম সংশোধন',
  'academic.section.create':         'সেকশন তৈরি',
  'academic.section.update':         'সেকশনের নাম সংশোধন',
  'academic.room.create':            'কক্ষ যোগ',
  'academic.room.update':            'কক্ষের তথ্য সংশোধন',
  'academic.room.deactivate':        'কক্ষ নিষ্ক্রিয়',
  'academic.room.reactivate':        'কক্ষ সক্রিয়',
  'academic.exam.create':            'পরীক্ষা তৈরি',
  'academic.exam.update':            'পরীক্ষা সংশোধন',
  'academic.calendar.create':        'শিক্ষাপঞ্জিতে দিন যোগ',
  'academic.calendar.update':        'শিক্ষাপঞ্জির দিন সংশোধন',
  'academic.calendar.delete':        'শিক্ষাপঞ্জির দিন বাদ',
  'exam.results.publish':            'ফলাফল প্রকাশ',
  // হিসাব
  'finance.invoices.generate':       'ইনভয়েস তৈরি',
  'finance.payment.record':          'ফি আদায়',
  'finance.fee_structure.create':    'ফি কাঠামো তৈরি',
  'finance.fee_structure.update':    'ফি কাঠামো সংশোধন',
  'finance.fee_structure.delete':    'ফি কাঠামো বাদ',
  // প্রশাসন
  'ops.settings.update':             'সেটিংস পরিবর্তন',
  'ops.user.create':                 'ব্যবহারকারী তৈরি',
  // 08 §04 draws this row as "অ্যাকাউন্ট নিষ্ক্রিয়": the account was closed,
  // not the person removed, and the design says so more carefully than
  // "ব্যবহারকারী নিষ্ক্রিয়" did.
  'ops.user.deactivate':             'অ্যাকাউন্ট নিষ্ক্রিয়',
  'ops.user.reactivate':             'অ্যাকাউন্ট সক্রিয়',
  'ops.guardian.link':               'অভিভাবক যুক্ত',
  'ops.guardian.permissions':        'অভিভাবকের অনুমতি পরিবর্তন',
  'ops.guardian.revoke':             'অভিভাবক সংযোগ বাতিল',
  'ops.staff_attendance.mark':       'শিক্ষক হাজিরা',
  'ops.data.export':                 'তথ্য রপ্তানি',
  // রুটিন
  'rms.routine.create':              'রুটিন তৈরি',
  'rms.routine.publish':             'রুটিন প্রকাশ',
  'rms.routine.submit':              'রুটিন পর্যালোচনায় পাঠানো',
  'rms.routine.withdraw':            'রুটিন ফেরত নেওয়া',
  'rms.routine.resolve':             'রুটিন পুনর্বিন্যাস',
  'rms.slot.place':                  'ক্লাস বসানো',
  'rms.slot.assign':                 'ক্লাসে শিক্ষক নির্ধারণ',
  'rms.slot.move':                   'ক্লাস সরানো',
  'rms.slot.remove':                 'ক্লাস তুলে নেওয়া',
  'rms.slot.lock':                   'ক্লাস পিন করা',
  'rms.slot.unlock':                 'ক্লাসের পিন খোলা',
  'rms.slot.undo':                   'রুটিনের কাজ ফেরানো',
  // পরিচয়
  'identity.session.revoke':         'যন্ত্রের সেশন বন্ধ',
};

/**
 * Bangla for the record a row is about — 08 §04's second line. All seventeen
 * `entityType` values the services write, for the same reason as above.
 */
const ENTITY_BN: Record<string, string> = {
  section: 'সেকশন', class: 'শ্রেণি', academic_year: 'শিক্ষাবর্ষ',
  user: 'ব্যবহারকারী', guardianship: 'অভিভাবক সংযোগ',
  tenant: 'প্রতিষ্ঠান', year_rollover: 'বার্ষিক উন্নয়ন',
  room: 'কক্ষ', exam: 'পরীক্ষা', calendar_day: 'শিক্ষাপঞ্জির দিন',
  fee_structure: 'ফি কাঠামো', payment_receipt: 'ফি রসিদ',
  routine: 'রুটিন', routine_slot: 'রুটিনের ক্লাস',
  teacher_attendance: 'শিক্ষক হাজিরা', session: 'যন্ত্রের সেশন',
  export: 'তথ্য রপ্তানি',
};


/**
 * Keys worth naming in a diff; anything else is shown by its raw key. Every
 * key below was read out of a real `before`/`after` payload in `services/`,
 * not guessed — a wrong Bangla name on a value someone is checking is worse
 * than the English key it replaces.
 */
const FIELD_BN: Record<string, string> = {
  canPayFees: 'ফি পরিশোধের অনুমতি', receivesSms: 'এসএমএস', isPrimary: 'প্রধান অভিভাবক',
  relation: 'সম্পর্ক', noticeMaxChars: 'এসএমএসের দৈর্ঘ্য', status: 'অবস্থা',
  nameBn: 'নাম', roleCode: 'ভূমিকা', teacherId: 'শিক্ষক', count: 'সংখ্যা',
  moved: 'স্থানান্তরিত', promoted: 'উন্নীত', repeated: 'পুনরাবৃত্তি', graduated: 'উত্তীর্ণ',
  capacity: 'ধারণক্ষমতা', name: 'নাম', label: 'নাম', levelNo: 'শ্রেণি', group: 'বিভাগ',
  // কক্ষ (rms-svc/api/rooms.ts)
  code: 'কোড', building: 'ভবন', floorNo: 'তলা', capabilities: 'সুবিধা',
  isBookable: 'রুটিনে ব্যবহারযোগ্য',
  // পরীক্ষা ও শিক্ষাপঞ্জি (academics-svc/api/exams.ts, ops-svc/api/calendar.ts)
  examType: 'পরীক্ষার ধরন', startsOn: 'শুরু', endsOn: 'শেষ',
  sections: 'সেকশন', papers: 'পত্র',
  day: 'দিন', kind: 'ধরন', titleBn: 'শিরোনাম', notified: 'জানানো হয়েছে',
  // হিসাব (finance-svc/api/payments.ts, feestructures.ts)
  amount: 'অঙ্ক', method: 'মাধ্যম', reference: 'সূত্র',
  receiptNo: 'রসিদ নম্বর', invoiceNo: 'ইনভয়েস নম্বর',
  invoiceStatus: 'ইনভয়েসের অবস্থা', ledgerPosted: 'লেজারে উঠেছে',
  head: 'ফির খাত', frequency: 'পর্যায়', dueDayOfMonth: 'পরিশোধের তারিখ',
  lateFeePerDay: 'দৈনিক বিলম্ব ফি', lateFeeCap: 'সর্বোচ্চ বিলম্ব ফি',
  // রুটিন (rms-svc/api/editor.ts, publish.ts, resolve.ts)
  fromStatus: 'আগের অবস্থা', version: 'সংস্করণ', slots: 'ক্লাসসংখ্যা',
  hardConflicts: 'কঠিন সংঘর্ষ', affected: 'প্রভাবিত ক্লাস', lost: 'বসানো যায়নি',
  isPinned: 'পিন করা', undidAction: 'যে কাজ ফেরানো হলো', labelBn: 'নাম',
  // হাজিরা ও সেশন (ops-svc/api/staff-attendance.ts, identity-svc/api/sessions.ts)
  date: 'তারিখ', reason: 'কারণ',
  device: 'যন্ত্র', sessions: 'সেশন', scope: 'পরিধি', kept: 'যে যন্ত্র খোলা রইল',
  // সেটিংস ও রপ্তানি (ops-svc/api/settings.ts, server-core/src/export-dataset.ts)
  pushReplacesSms: 'পুশ এসএমএসের বদলে', dataset: 'তালিকা', rows: 'সারি',
};

function bnBool(v: unknown): string {
  if (v === true) return 'হ্যাঁ';
  if (v === false) return 'না';
  // An explicit null is "nothing was set" — the same thing the missing-key
  // dash says. It used to print the word "null" on screen, which is neither
  // Bangla nor true: `reason: null → অসুস্থ` reads as a reason called null.
  if (v == null) return '—';
  // A figure the server sent as a number reads in Bangla numerals. Strings —
  // including redacted identifiers like "•••11" — stay exactly as sent.
  if (typeof v === 'number') return bnNum(v);
  return String(v);
}

/** The server's page size; offsets move by this much. */
const PAGE = 50;

type FilterKey = 'action' | 'entityType' | 'actorId' | 'from' | 'to';
const NO_FILTER = (): Record<FilterKey, string> =>
  ({ action: '', entityType: '', actorId: '', from: '', to: '' });

/**
 * The row stripe's meaning (08 §04: "লাল মানে কেউ কিছু বদলেছে বা নিষ্ক্রিয়
 * করেছে"). Read from the action's last segment, so a code this file has no
 * Bangla for still gets the right colour.
 */
type AuditTone = 'neutral' | 'info' | 'success' | 'danger';
const CHANGE_VERBS = new Set([
  'update', 'delete', 'deactivate', 'revoke', 'permissions', 'move', 'remove', 'assign', 'undo',
  // A scoped re-solve picks up lessons that were already placed and puts them
  // somewhere else; the row says "রুটিন পুনর্বিন্যাস", so a quiet grey stripe
  // beside it would contradict the words.
  'resolve',
]);
function toneOf(action: string): AuditTone {
  if (/(^|\.)notices?\./.test(action)) return 'info';
  const verb = action.slice(action.lastIndexOf('.') + 1);
  if (verb === 'publish' || verb === 'commit') return 'success';
  if (CHANGE_VERBS.has(verb)) return 'danger';
  return 'neutral';
}

export class AuditView {
  private readonly o: AuditViewOptions;
  private entries: Entry[] = [];
  private facets: Facets = { actions: [], entityTypes: [], actors: [] };
  private hasMore = false;
  private offset = 0;
  private loading = true;
  private error = '';
  /** The server refused. Distinct from `error`: no retry can help. */
  private denied = false;
  private expanded = new Set<string>();

  private f = NO_FILTER();

  constructor(options: AuditViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.error = ''; this.denied = false; this.render();
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(this.f)) if (v) qs.set(k, v);
      if (this.offset) qs.set('offset', String(this.offset));
      const res = await this.o.auth.authedFetch(`/api/v1/ops/audit?${qs}`);
      if (res.status === 403) {
        // The one screen where a refusal is the correct outcome for most of
        // the school, so it says who it is for rather than only "no".
        // B-30's canonical pattern, and a FLAG rather than a sentence: the
        // old code decided whether to draw a retry by sniffing the error
        // string for 'কেবল', which breaks the day somebody rewords it.
        this.denied = true;
        this.error = permissionMessage('কার্যবিবরণী');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        entries: Entry[]; facets: Facets; hasMore: boolean;
      };
      this.entries = body.entries ?? [];
      this.facets = body.facets ?? this.facets;
      this.hasMore = body.hasMore ?? false;
    } catch {
      this.error = 'কার্যবিবরণী আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false; this.render();
    }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // 08 §04 draws the bar with the title alone; "শুধু পড়ার জন্য" is said by
    // the footer note instead, where it sits under the thing it describes.
    root.append(pageHeader(d, { title: 'কার্যবিবরণী' }));

    if (this.denied) {
      // The canonical sentence, and underneath it the thing the old bespoke
      // wording carried that a generic one loses: WHICH roles may read this.
      // Somebody refused here is usually a coordinator or a teacher, and
      // "ask the head teacher" is less useful than "these three can see it".
      root.append(permissionState(d, {
        message: permissionMessage('কার্যবিবরণী'),
        contact: 'প্রধান শিক্ষক, প্রতিষ্ঠান মালিক ও আইটি অ্যাডমিন',
      }));
      // A refusal is the whole answer; an empty list underneath it would say
      // "there is nothing here", which is a different and untrue claim.
      return;
    }

    const panel = el(d, 'div', { className: 'card audit-panel' });
    append(panel, this.filters());

    if (this.error) {
      // In the rows' place, and alone there: an empty state under an error
      // would claim nothing has been recorded, which nobody knows yet.
      append(panel, errorState(d, this.error, () => void this.load()));
    } else if (this.loading) {
      append(panel, listSkeleton(d, 5));
    } else if (this.entries.length === 0) {
      const filtered = Object.values(this.f).some(Boolean);
      append(panel, emptyState(d, {
        message: filtered
          ? 'এই শর্তে কোনো কাজ পাওয়া যায়নি — ফিল্টার বদলে দেখুন।'
          : 'এখনো কোনো পরিবর্তন রেকর্ড হয়নি। শিক্ষক নির্ধারণ, ফলাফল প্রকাশ বা ' +
            'অভিভাবকের অনুমতি পরিবর্তন করলে এখানে দেখা যাবে।',
        action: filtered
          ? { label: 'ফিল্টার মুছুন', onClick: () => this.clearFilters() }
          : undefined,
      }));
    } else {
      const list = el(d, 'ul', {
        className: 'audit-list', attrs: { 'aria-label': 'কার্যবিবরণী' },
      });
      for (const e of this.entries) append(list, this.entryRow(e));
      append(panel, list, this.pager());
    }

    append(panel, el(d, 'p', {
      className: 'audit-note',
      text: 'এই তালিকা কেউ মুছতে বা বদলাতে পারে না — প্রধান শিক্ষকও নয়।',
    }));
    root.append(panel);
  }

  private setFilter(key: FilterKey, value: string): void {
    this.f[key] = value;
    this.offset = 0;
    void this.load();
  }

  private clearFilters(): void {
    this.f = NO_FILTER();
    this.offset = 0;
    void this.load();
  }

  /**
   * The inset strip. The three lists are the shared filter bar — bare selects
   * on a desktop whose name reads in the first option ("সব ধরনের কাজ"), a
   * button and a sheet on a phone, active filters as chips either way — and
   * the date range rides in its extra slot, visible at both widths.
   */
  private filters(): HTMLElement {
    const d = this.o.doc;

    const dates = el(d, 'div', { className: 'audit-dates' });
    for (const [labelBn, key] of [['থেকে', 'from'], ['পর্যন্ত', 'to']] as const) {
      append(dates, field(d, {
        kind: 'date', name: key, label: labelBn, value: this.f[key],
        className: 'audit-date', onChange: (v) => this.setFilter(key, v),
      }).root);
    }
    // The bar's chips clear the three lists; a range set on its own has no
    // chip, so it keeps the one-tap way out this screen has always had.
    const listFiltered = Boolean(this.f.action || this.f.entityType || this.f.actorId);
    if ((this.f.from || this.f.to) && !listFiltered) {
      append(dates, button(d, {
        label: 'ফিল্টার মুছুন', variant: 'ghost', size: 'sm',
        className: 'audit-clear', onClick: () => this.clearFilters(),
      }));
    }

    const bar = filterBar(d, {
      label: 'কার্যবিবরণী ছাঁকনি',
      filters: [
        {
          id: 'actorId', label: 'কে', value: this.f.actorId,
          options: [{ value: '', label: 'কে — সবাই' }, ...this.facets.actors.map((a) => ({
            value: a.id, label: `${a.nameBn} (${bnNum(a.count)})`,
          }))],
        },
        {
          id: 'action', label: 'কাজ', value: this.f.action,
          options: [{ value: '', label: 'সব ধরনের কাজ' }, ...this.facets.actions.map((a) => ({
            value: a.value, label: `${ACTION_BN[a.value] ?? a.value} (${bnNum(a.count)})`,
          }))],
        },
        {
          id: 'entityType', label: 'বিষয়', value: this.f.entityType,
          options: [{ value: '', label: 'সব বিষয়' }, ...this.facets.entityTypes.map((e) => ({
            value: e.value, label: `${ENTITY_BN[e.value] ?? e.value} (${bnNum(e.count)})`,
          }))],
        },
      ],
      onChange: (id, value) => this.setFilter(id as FilterKey, value),
      onClearAll: () => this.clearFilters(),
      extra: dates,
    });

    return el(d, 'div', { className: 'audit-filters' }, bar);
  }

  private entryRow(e: Entry): HTMLElement {
    const d = this.o.doc;
    const open = this.expanded.has(e.id);
    const roleBn = e.actor.role ? (ROLE_BN[e.actor.role] ?? e.actor.role) : '';
    const actionBn = ACTION_BN[e.action] ?? e.action;
    // 08 §04's second line names the record. For a few actions the record IS
    // the action — "শিক্ষক হাজিরা / শিক্ষক হাজিরা", "তথ্য রপ্তানি / তথ্য
    // রপ্তানি" — and a line that repeats the line above it is noise, so it
    // goes and the row stands on one line.
    const entity = e.entityType ? (ENTITY_BN[e.entityType] ?? e.entityType) : '';
    const entityBn = entity === actionBn ? '' : entity;

    // The role is not drawn on the row (08 §04 shows the name alone), so it
    // stays in the name for a screen reader and in the hover title.
    const who = el(d, 'span', { className: 'audit-who' },
      e.actor.nameBn,
      roleBn ? el(d, 'span', { className: 'ui-sr-only', text: ` (${roleBn})` }) : null);
    tooltip(d, who, roleBn ? `${e.actor.nameBn} (${roleBn})` : e.actor.nameBn);

    // The spaces between the parts are for the button's accessible name; a
    // flex or grid container drops whitespace-only text from the layout.
    const head = el(d, 'button', {
      className: 'audit-head',
      attrs: { type: 'button', 'aria-expanded': String(open) },
    },
      el(d, 'span', { className: 'audit-mark', attrs: { 'aria-hidden': 'true' } }),
      ' ',
      el(d, 'time', { className: 'audit-when', attrs: { datetime: e.at } },
        ...numText(d, bnDateTime(e.at))),
      ' ',
      who,
      ' ',
      el(d, 'span', { className: 'audit-what' },
        el(d, 'span', { className: 'audit-action', text: actionBn }),
        entityBn ? ' ' : null,
        entityBn ? el(d, 'span', { className: 'audit-detail' }, ...numText(d, entityBn)) : null));

    head.addEventListener('click', () => {
      if (open) this.expanded.delete(e.id); else this.expanded.add(e.id);
      this.render();
    });

    return el(d, 'li', { className: 'audit-row', data: { tone: toneOf(e.action) } },
      head, open ? this.diff(e) : null);
  }

  /**
   * before → after, field by field. Only the fields that CHANGED, because a
   * list of twelve identical values with one difference buried in it is how a
   * reader misses the difference.
   */
  private diff(e: Entry): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div', { className: 'audit-diff' });

    const before = (e.before ?? {}) as Record<string, unknown>;
    const after = (e.after ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));

    if (changed.length === 0) {
      // A create has no before-state; saying "no change" would be wrong.
      append(wrap, el(d, 'p', {
        className: 'audit-diff-note',
        text: e.before == null && e.after != null
          ? 'নতুন তৈরি — আগের কোনো অবস্থা নেই।'
          : 'কোনো মান পরিবর্তিত হয়নি।',
      }));
    } else {
      append(wrap, dataTable<string>(d, {
        caption: 'পরিবর্তিত মান',
        rows: changed,
        rowKey: (k) => k,
        columns: [
          { key: 'field', header: 'ক্ষেত্র', mobile: 'title', width: '40%',
            cell: (k) => FIELD_BN[k] ?? k },
          { key: 'change', header: 'আগে → পরে', mobile: 'subtitle',
            cell: (k) => el(d, 'span', {}, ...numText(d,
              `${k in before ? bnBool(before[k]) : '—'} → ${k in after ? bnBool(after[k]) : '—'}`)) },
        ],
      }));
    }

    // The raw `entityId` used to be printed here as
    // "শনাক্তকারী: 7b06d000-0000-…". It is gone, and nothing replaced it: §14
    // forbids a uuid in visible or accessible text, and it was never usable —
    // an office cannot read it down a phone or search by it. "Which record"
    // is answered by the entity type on the row above and by the diff itself.
    return wrap;
  }

  /** Previous / next by one server page. Absent when everything fits on one. */
  private pager(): HTMLElement | null {
    const d = this.o.doc;
    const page = Math.floor(this.offset / PAGE) + 1;
    return pagination(d, {
      page,
      pageCount: page + (this.hasMore ? 1 : 0),
      onGo: (p) => { this.offset = (p - 1) * PAGE; void this.load(); },
      summary: `${bnNum(this.offset + 1)}–${bnNum(this.offset + this.entries.length)}`,
    });
  }
}
