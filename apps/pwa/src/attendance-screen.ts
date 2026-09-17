/**
 * The attendance screen. (UI integration plan, P3 — highest priority)
 *
 * `AttendanceView` renders the register and owns the save path — the product's
 * one durable write. Since Ata Ekta path খ it sends only the students the
 * teacher marked, behind three guards (see attendance-view.ts). **This module is everything around it**: which
 * section, which roster, and the eleven moments before and after the grid is
 * on screen.
 *
 * ── The defect this replaces ───────────────────────────────────────────────
 * Until now `app.ts` built the view from a localStorage cache written by a
 * DIFFERENT screen, with this fallback when nothing had been picked:
 *
 *     section: { id: 'demo-section', labelBn: '৯-ক', academicYearId: 'yr-2026' }
 *
 * A teacher who opened হাজিরা before ever visiting the roster got an empty
 * grid labelled "৯-ক" — a real-looking class that does not exist — and any
 * save was rejected by sync, because `yr-2026` is not a uuid. The screen said
 * "১টি পাঠানো যায়নি" and nothing said why. That is now impossible: the screen
 * asks the server which sections this teacher has, and if the answer is none
 * it says so.
 *
 * ── The states §"ATTENDANCE" names, and where each lives ───────────────────
 *   1 loading        · this module — skeleton while sections/roster load
 *   2 empty          · this module — no sections, or a section with no students
 *   3 loaded         · AttendanceView's register (path খ: rows start unset)
 *   4 saving         · the confirm sheet's "জমা দিন" busy state (`onClickBusy`)
 *   5 saved          · this module's toast, in words: on the device vs sending;
 *                      then the register's footer, for as long as the marks
 *                      are unchanged (saved, when, the tally, sent or not)
 *   6 offline        · the shell banner + an explicit line in the status strip
 *   7 queued         · the sync line, with the count
 *   8 syncing        · the sync line, while a flush is in flight
 *   9 sync failed    · the sync line + a RETRY button that did not exist
 *  10 retry          · this module — `outbox.flush()` on demand
 *  11 permission     · this module — 403 from sections/roster
 *  12 error          · this module — anything else, through `humanError`
 *  13 success        · the toast, and the sync line clearing
 *
 * ── What the teacher must always be able to see ────────────────────────────
 * Section and subject: the picker strip. How many are marked, and how many are
 * left: the register's progress strip (only students the teacher marked).
 * The date: the confirm sheet, which every submit passes through. Whether
 * saved or only queued locally: the toast, the register's saved footer and
 * the sync line. In words; colour never carries any of them alone.
 */
import type { Auth } from './auth.ts';
import type {
  SectionSummary as RosterSectionSummary,
  RosterStudent as RosterRow,
} from './roster-view.ts';
import type { Student } from '../../../packages/ui-core/src/attendance-grid.ts';
import { AttendanceView, type OutboxLike } from './attendance-view.ts';
import {
  el, append, icon, button, pageHeader, field, emptyState, errorState,
  permissionState, listSkeleton, humanError, announce, toast, badge, confirmOverlay,
  focusIsLost, permissionMessageWithContact, type OverlayHandle,
} from './ui/index.ts';
import { formatCount } from '../../../packages/ui-core/src/format.ts';

/**
 * The real shape of `GET /academics/sections`, reused rather than re-guessed.
 *
 * The first cut of this screen assumed `{ labelBn, classLabelBn }` and got an
 * empty section picker with three blank options — the browser found it in
 * about ten seconds, and no type would have, because the response is parsed
 * from JSON. The label is composed the way roster-view.ts composes it, so the
 * two screens name the same section identically.
 */
type SectionSummary = RosterSectionSummary;

/** `নবম শ্রেণি — ক`. One spelling of a section, in both screens. */
function sectionLabel(s: SectionSummary): string {
  return `${s.className?.bn ?? ''} — ${s.name}`.replace(/^ — /, '');
}

/**
 * The roster's real shape, imported rather than re-declared.
 *
 * The first cut of this file declared `{ studentId, rollNo, nameBn }` — but
 * the endpoint returns `fullName: { bn, en }`, so every student's name mapped
 * to `undefined`. Nothing looked wrong: the tiles show a roll number and a
 * status glyph, and the name only reaches the `title` and the `aria-label`.
 * A screen reader announced "রোল 1, undefined, উপস্থিত" for all sixty
 * children. The code this replaced got it right; the browser caught the
 * regression, and re-using the type is what stops it recurring.
 */
type RosterStudent = RosterRow;

export interface AttendanceScreenOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  outbox: OutboxLike;
  newId: () => string;
  /** Today, as YYYY-MM-DD in the school's local day. */
  takenOn: string;
  subjectBn?: string;
  periodNo?: number | null;
  now?: () => number;
}

type Phase = 'loading' | 'ready' | 'empty' | 'error' | 'denied';

const LAST_SECTION_KEY = 'shikhon_last_section';
const SECTIONS_CACHE = 'shikhon_sections_cache';
const rosterCache = (id: string): string => `shikhon_roster_cache_${id}`;

export class AttendanceScreen {
  private readonly o: AttendanceScreenOptions;
  private phase: Phase = 'loading';
  private sections: SectionSummary[] = [];
  private sectionId: string | null = null;
  private roster: RosterStudent[] = [];
  private errText = '';
  private view: AttendanceView | null = null;
  private gridHost!: HTMLElement;
  private statusHost!: HTMLElement;
  private busy = false;
  private onConnectivity?: () => void;
  /**
   * The shell's automatic flush reports every attempt as `shikhon:outbox` on
   * the document. The sync line used to read the queue only when this screen
   * painted, so a register sent by that flush — at boot, on reconnect, after
   * a visit to another tab — left "১টি অপেক্ষমাণ … পাঠানো হচ্ছে" standing
   * over an empty queue for as long as the screen stayed open.
   */
  private onOutbox?: () => void;
  /** The sync line on screen, and the state it was drawn from. */
  private syncLine: HTMLElement | null = null;
  private syncKey = '';
  /** Sync-line paints run one after another; see paintSync. */
  private syncRunning: Promise<void> = Promise.resolve();
  private syncQueued: Promise<void> | null = null;
  /**
   * The page header and the picker strip outlive a render. The section select
   * used to be rebuilt by every render — twice per section change (loading,
   * then ready) — so the control a person was using vanished under them: one
   * ArrowDown switched the section and dropped focus to <body>.
   */
  private headerEl: HTMLElement | null = null;
  private regEl: HTMLElement | null = null;
  private pickersEl: HTMLElement | null = null;
  private sectionSelect: HTMLSelectElement | null = null;
  /** The section list the picker strip was built from. */
  private pickersFor = '';
  /** The "discard these marks?" question, while it is open. */
  private switchAsk: OverlayHandle | null = null;

  constructor(options: AttendanceScreenOptions) {
    this.o = options;
    this.render();
    void this.boot();
    // The status strip says "offline — কাজ চালিয়ে যান" in words. It listens
    // for itself rather than reading a flag once, because the interesting
    // transition is the one that happens WHILE the register is open.
    this.onConnectivity = () => this.paintStatus();
    addEventListener('online', this.onConnectivity);
    addEventListener('offline', this.onConnectivity);
    // After every flush attempt the queue is read again: the sync line, and
    // the register's saved footer ("এখনো পাঠানো হয়নি" → "জমা হয়েছে").
    this.onOutbox = () => {
      if (!this.statusHost?.isConnected) return;
      void this.view?.refreshSaved();
      void this.paintSync();
    };
    this.o.doc.addEventListener('shikhon:outbox', this.onOutbox);
  }

  destroy(): void {
    if (this.onConnectivity) {
      removeEventListener('online', this.onConnectivity);
      removeEventListener('offline', this.onConnectivity);
    }
    if (this.onOutbox) this.o.doc.removeEventListener('shikhon:outbox', this.onOutbox);
  }

  /**
   * A register with marks that no save holds. The shell asks this before a
   * tab, the bell or Android back leaves the route; the section picker asks
   * it before switching. Nothing marked, or nothing changed since the last
   * save, is nothing to lose.
   */
  hasUnsavedChanges(): boolean {
    return this.view?.hasUnsavedChanges() ?? false;
  }

  /* ── data ───────────────────────────────────────────────────────────── */

  private async boot(): Promise<void> {
    const cachedSections = read<SectionSummary[]>(SECTIONS_CACHE) ?? [];
    if (cachedSections.length) this.sections = cachedSections;

    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/sections');
      if (res.status === 403) { this.phase = 'denied'; this.render(); return; }
      if (!res.ok) throw new Status(res.status);
      const body = (await res.json()) as { sections: SectionSummary[] };
      this.sections = body.sections ?? [];
      write(SECTIONS_CACHE, this.sections);
    } catch (err) {
      if (!this.sections.length) {
        this.phase = 'error';
        this.errText = humanError(navigator.onLine ? null : 'offline',
          err instanceof Status ? err.status : undefined);
        this.render();
        return;
      }
      // Cached sections are enough to take a register offline, which is the
      // entire point of this screen.
    }

    if (!this.sections.length) { this.phase = 'empty'; this.render(); return; }

    const remembered = safeGet(LAST_SECTION_KEY);
    this.sectionId = this.sections.some((s) => s.id === remembered)
      ? remembered
      : this.sections[0].id;
    await this.loadRoster(this.sectionId!);
  }

  private async loadRoster(sectionId: string): Promise<void> {
    this.phase = 'loading';
    this.render();

    // This section's cached roster, or none. Keeping the previous section's
    // children here drew them under the new section's name whenever the new
    // one had no cache and the fetch failed — and a save would have sent them.
    const cached = read<RosterStudent[]>(rosterCache(sectionId));
    this.roster = cached?.length ? cached : [];

    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/roster?sectionId=${encodeURIComponent(sectionId)}`);
      // A later choice owns the screen now. With focus kept on the select,
      // quick arrow presses overlap these fetches, and a late answer must not
      // draw its roster under another section's label.
      if (sectionId !== this.sectionId) return;
      if (res.status === 403) { this.phase = 'denied'; this.render(); return; }
      if (!res.ok) throw new Status(res.status);
      const body = (await res.json()) as { roster: RosterStudent[] };
      if (sectionId !== this.sectionId) return;
      this.roster = body.roster ?? [];
      write(rosterCache(sectionId), this.roster);
      safeSet(LAST_SECTION_KEY, sectionId);
    } catch (err) {
      if (sectionId !== this.sectionId) return;
      if (!this.roster.length) {
        this.phase = 'error';
        this.errText = humanError(navigator.onLine ? null : 'offline',
          err instanceof Status ? err.status : undefined);
        this.render();
        return;
      }
    }

    this.phase = this.roster.length ? 'ready' : 'empty';
    this.render();
  }

  private section(): SectionSummary | null {
    return this.sections.find((s) => s.id === this.sectionId) ?? null;
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    this.view = null;

    // The register: one full-bleed column of strips. The picker strip stays
    // above every state but "denied", so a teacher can always leave a section
    // that has no students or failed to load.
    const showPickers = this.sections.length > 0 && this.phase !== 'denied';
    const pickersFor = showPickers
      ? JSON.stringify(this.sections.map((s) => [s.id, sectionLabel(s)]))
      : '';
    const keep = showPickers && pickersFor === this.pickersFor
      && this.headerEl?.parentNode === root
      && this.regEl?.parentNode === root
      && this.pickersEl?.parentNode === this.regEl;

    if (keep) {
      // Same sections: keep the header and the picker strip — with the select
      // the person may be using — and replace only what sits below them.
      for (const n of [...root.childNodes]) {
        if (n !== this.headerEl && n !== this.regEl) n.remove();
      }
      for (const n of [...this.regEl!.childNodes]) {
        if (n !== this.pickersEl) n.remove();
      }
      if (this.sectionSelect && this.sectionId && this.sectionSelect.value !== this.sectionId) {
        this.sectionSelect.value = this.sectionId;
      }
    } else {
      root.textContent = '';
      // §02 draws no page title on a phone; the h1 stays in the DOM (visually
      // hidden below 1024px by .att-page-header) for the heading outline.
      this.headerEl = pageHeader(d, { title: 'হাজিরা', className: 'att-page-header' });
      append(root, this.headerEl);
      this.regEl = el(d, 'div', { className: 'att-register' });
      this.pickersEl = null;
      this.sectionSelect = null;
      this.pickersFor = '';
      if (showPickers) {
        this.pickersEl = el(d, 'div', { className: 'att-pickers' },
          this.sectionPicker(),
          this.o.subjectBn ? this.subjectPicker() : null);
        append(this.regEl, this.pickersEl);
        append(root, this.regEl);
        this.pickersFor = pickersFor;
      }
    }
    const reg = this.regEl!;

    switch (this.phase) {
      case 'loading':
        append(root, listSkeleton(d, 6));
        return;

      case 'denied':
        // The canonical refusal (lead decision 4). The screen's own sentence
        // went through permissionState's contact line, which printed
        // "প্রধান শিক্ষক-এর" instead of "প্রধান শিক্ষকের".
        append(root, permissionState(d, { message: permissionMessageWithContact() }));
        return;

      case 'error':
        append(root, errorState(d, this.errText, () => { void this.boot(); }));
        return;

      case 'empty': {
        const sec = this.section();
        append(root, this.sections.length
          ? emptyState(d, {
              // Named, and with the way out. "No data" on a screen a teacher
              // opened to take a register is a dead end.
              message: `${sec ? sectionLabel(sec) : 'এই সেকশনে'}-তে এখনো কোনো শিক্ষার্থী ভর্তি হয়নি।`
                + ' শিক্ষার্থী যোগ করার পর হাজিরা নেওয়া যাবে।',
              action: { label: 'শিক্ষার্থী তালিকা দেখুন',
                        onClick: () => { location.hash = '/roster'; } },
            })
          : emptyState(d, {
              message: 'আপনার নামে কোনো সেকশন নির্ধারিত নেই, তাই হাজিরা নেওয়ার কিছু নেই।',
              action: { label: 'রুটিন দেখুন', onClick: () => { location.hash = '/routine'; } },
            }));
        return;
      }

      case 'ready':
        break;
    }

    const sec = this.section()!;
    // Offline and sync state, in words.
    this.statusHost = el(d, 'div', { className: 'att-status', attrs: { 'aria-live': 'polite' } });
    this.gridHost = el(d, 'div', { className: 'att-host' });
    append(reg, this.statusHost, this.gridHost);

    this.view = new AttendanceView({
      root: this.gridHost,
      doc: d,
      students: this.roster.map(toStudent),
      section: {
        id: sec.id,
        labelBn: sectionLabel(sec),
        academicYearId: sec.academicYearId,
      },
      takenOn: this.o.takenOn,
      periodNo: this.o.periodNo ?? null,
      subjectBn: this.o.subjectBn,
      outbox: this.o.outbox,
      newId: this.o.newId,
      now: this.o.now,
      embedded: true,
      onConfirm: () => this.submit(),
      // The register reached the server in a background flush: the sync line
      // must not still count it as waiting under a footer that says sent.
      onDeliveryChange: () => { void this.paintSync(); },
    });

    void this.paintStatus();
  }

  private sectionPicker(): HTMLElement {
    const f = field(this.o.doc, {
      label: 'সেকশন',
      name: 'section',
      kind: 'select',
      value: this.sectionId ?? '',
      options: this.sections.map((x) => ({ value: x.id, label: sectionLabel(x) })),
      onChange: (v) => this.chooseSection(v),
    });
    this.sectionSelect = f.input as HTMLSelectElement;
    return f.root;
  }

  /**
   * A section chosen in the picker. Switching loads another roster and builds
   * a fresh register, so marks not yet submitted would be gone — silently,
   * and on desktop from a single ArrowDown on the focused select. With such
   * marks on screen the select goes back to the current section and the
   * teacher is asked first; "বাতিল" keeps the register, "বাদ দিন" switches.
   */
  private chooseSection(v: string): void {
    if (v === this.sectionId) return;
    if (!this.hasUnsavedChanges()) { this.switchSection(v); return; }
    if (this.sectionSelect && this.sectionId) this.sectionSelect.value = this.sectionId;
    // One question at a time. A dialog closed from outside (a route change
    // closes every overlay) calls neither answer, so ask the DOM, not the flag.
    if (this.switchAsk?.el.isConnected) return;
    this.switchAsk = confirmOverlay(this.o.doc, {
      title: 'হাজিরা জমা দেওয়া হয়নি',
      body: 'এই সেকশনের হাজিরা এখনো জমা দেওয়া হয়নি। সেকশন বদলালে চিহ্নগুলো হারিয়ে যাবে।',
      confirmLabel: 'বাদ দিন',
      danger: true,
      // Focus returns to the select (the dialog's opener), which the switch
      // keeps in place.
      onConfirm: () => { this.switchAsk = null; this.switchSection(v); },
      onCancel: () => { this.switchAsk = null; },
    });
  }

  private switchSection(v: string): void {
    this.sectionId = v;
    void this.loadRoster(v);
  }

  /**
   * The subject, stated. The screen is handed one subject and has no list to
   * choose from, so this select is disabled — it names, it does not pick.
   */
  private subjectPicker(): HTMLElement {
    return field(this.o.doc, {
      label: 'বিষয়',
      name: 'subject',
      kind: 'select',
      value: 'subject',
      options: [{ value: 'subject', label: this.o.subjectBn! }],
      disabled: true,
    }).root;
  }

  /**
   * The confirm sheet's "জমা দিন". Single-flight: a second call while one is
   * in flight enqueues nothing. It holds only until the register is durable on
   * the device (the enqueue), then closes the sheet and says which state it
   * reached in words — saved locally is not the same promise as delivered.
   * The flush runs on in the background and repaints the sync line.
   *
   * The sheet is closed BEFORE the toast: while it is open every other body
   * child is aria-hidden, the toast host included, and a message written
   * there is never announced.
   *
   * Resolves `false` on failure, so the sheet stays open with the marks and
   * the view shows the failure inside the sheet (role=alert).
   */
  private async submit(): Promise<boolean> {
    if (this.busy || !this.view) return false;
    this.busy = true;
    const d = this.o.doc;
    try {
      const view = this.view;
      const result = await view.save();
      view.closeConfirm();
      void this.paintStatus();
      const message = navigator.onLine
        ? 'হাজিরা সংরক্ষিত — জমা হচ্ছে'
        : 'হাজিরা এই যন্ত্রে সংরক্ষিত — সংযোগ পেলে নিজেই জমা হবে';
      // Next task: the page's aria-hidden is lifted and focus has returned
      // to the opener before the live region changes.
      setTimeout(() => toast(d, { message, tone: 'success' }), 0);
      void result.flushed.then(() => this.paintStatus());
      return true;
    } catch (err) {
      // Enqueue itself failing means IndexedDB refused — genuinely rare and
      // genuinely fatal to this register, so it is said plainly and the
      // marks stay on screen to be saved again. The sheet is still open, so
      // the view repeats this inside it where a screen reader can hear it.
      toast(d, {
        message: 'হাজিরা সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।',
        tone: 'error',
      });
      console.error('[attendance] enqueue failed', err);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Offline and sync, in words. Section and subject live in the picker strip,
   * the date in the confirm sheet, and how many are marked in the register's
   * own progress strip — which counts only students the teacher marked.
   */
  private paintStatus(): Promise<void> {
    if (!this.statusHost) return Promise.resolve();
    const d = this.o.doc;
    this.statusHost.textContent = '';

    if (!navigator.onLine) {
      append(this.statusHost, el(d, 'p', { className: 'att-offline-note' },
        icon(d, 'wifi-off', 'att-offline-glyph'),
        el(d, 'span', {
          text: 'এখন অফলাইন — জমা দিলে এই যন্ত্রে থাকবে, সংযোগ পেলে নিজেই পাঠানো হবে।',
        })));
    }
    // The register's own "saved" footer says whether it has left the device;
    // it re-reads the queue whenever the sync line does.
    void this.view?.refreshSaved();
    return this.paintSync();
  }

  /**
   * The sync line, and the retry that never existed.
   *
   * A queue that said "৩টি পাঠানো যায়নি" with no way to act on it left a
   * teacher only reload-and-hope.
   *
   * Paints run one after another, each reading the queue when its turn comes.
   * Run side by side, an older read that answered last (a flush report, the
   * register's own delivery change and a reconnect can all ask at once) drew
   * "১টি অপেক্ষমাণ" back over a queue a newer read had found empty. A request
   * made while a paint is still waiting for its turn joins that paint: it has
   * not read yet, so it will see the same change.
   */
  private paintSync(): Promise<void> {
    if (this.syncQueued) return this.syncQueued;
    const next = this.syncRunning.then(() => {
      this.syncQueued = null;
      return this.paintSyncNow();
    });
    this.syncQueued = next;
    this.syncRunning = next.catch(() => { /* a failed paint never blocks the next */ });
    return next;
  }

  private async paintSyncNow(): Promise<void> {
    const d = this.o.doc;
    const host = this.statusHost;
    if (!host) return;
    let s: { pending: number; failed: number };
    try { s = await this.o.outbox.state(); } catch { return; }
    // The screen drew a new status strip while the queue was being read.
    if (host !== this.statusHost) return;

    const old = this.syncLine?.parentNode === host ? this.syncLine : null;
    const hadFocus = !!old && old.contains(d.activeElement);
    if (s.pending === 0 && s.failed === 0) {
      this.syncLine = null;
      this.syncKey = '';
      if (!old) return;
      old.remove();
      // The line (and a focused "আবার পাঠান") went because the queue emptied.
      // The register's saved line, if there is one, says where it went.
      if (hadFocus && focusIsLost(d)) this.view?.focusSaved();
      return;
    }

    const online = navigator.onLine;
    const key = `${s.failed}|${s.pending}|${online}`;
    // Nothing changed since the line was drawn: keep the node, so a focused
    // "আবার পাঠান" keeps focus and the live region does not repeat itself on
    // every flush report.
    if (old && key === this.syncKey) return;

    const line = el(d, 'p', { className: 'att-sync-line', data: { state: s.failed ? 'failed' : 'queued' } });
    append(line, badge(d, {
      label: s.failed
        ? `${formatCount(s.failed, 'bn')}টি পাঠানো যায়নি`
        : `${formatCount(s.pending, 'bn')}টি অপেক্ষমাণ`,
      tone: s.failed ? 'danger' : 'warn',
      glyph: s.failed ? 'alert-triangle' : 'clock',
    }));
    append(line, el(d, 'span', {
      className: 'att-sync-text',
      text: s.failed
        ? 'কিছু হাজিরা সার্ভারে পৌঁছায়নি। তথ্য এই যন্ত্রে নিরাপদ আছে।'
        // Offline nothing is being sent, and the line said it was.
        : online
          ? 'হাজিরা এই যন্ত্রে জমা আছে, পাঠানো হচ্ছে।'
          : 'হাজিরা এই যন্ত্রে জমা আছে, সংযোগ পেলে পাঠানো হবে।',
    }));
    append(line, button(d, {
      label: 'আবার পাঠান', variant: 'secondary', size: 'sm', glyph: 'refresh',
      onClick: async () => {
        announce(d, 'আবার পাঠানোর চেষ্টা হচ্ছে');
        try { await this.o.outbox.flush(); } catch { /* stays queued */ }
        if (!navigator.onLine) {
          // Offline the line comes back reading exactly as before, so the
          // press looked like it did nothing. Say what happened.
          toast(d, {
            message: 'ইন্টারনেট নেই — হাজিরা এই যন্ত্রে নিরাপদ আছে, সংযোগ পেলে নিজেই পাঠানো হবে।',
            tone: 'info',
          });
        }
        await this.paintStatus();
        // The queue emptied, so this line and its button are gone and focus
        // went with them. The register's saved line now says it arrived.
        // (While the line is still there the shell's focus keeper puts focus
        // back on its new "আবার পাঠান".)
        if (focusIsLost(d) && !this.statusHost?.querySelector('.att-sync-line')) {
          this.view?.focusSaved();
        }
      },
    }));
    if (old) old.replaceWith(line);
    else append(host, line);
    this.syncLine = line;
    this.syncKey = key;
    // The count changed under a focused "আবার পাঠান": the new line has one.
    if (hadFocus && focusIsLost(d)) line.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  /** Test seam. */
  get inner(): AttendanceView | null { return this.view; }
}

function toStudent(r: RosterStudent): Student {
  return {
    studentId: r.studentId,
    rollNo: r.rollNo,
    // Never `undefined`: this string becomes the tile's accessible name, and
    // a roll number is a worse label than a name but an infinitely better one
    // than the word "undefined".
    nameBn: r.fullName.bn || r.fullName.en || `রোল ${r.rollNo}`,
    nameEn: r.fullName.en || r.fullName.bn || `Roll ${r.rollNo}`,
  };
}

// No constructor parameter property: Node runs this repo's TypeScript in
// STRIP-ONLY mode, which rejects `constructor(public x)` outright. `tsc`
// accepts it, so the type gate is silent and only the test runner fails.
class Status extends Error {
  readonly status: number;
  constructor(status: number) { super(`http_${status}`); this.status = status; }
}

function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; }
  catch { return null; }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}
function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota */ }
}
