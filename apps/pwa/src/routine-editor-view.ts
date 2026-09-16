/**
 * Routine editor — F-502 / F-504 / F-506, wireframe §8.1.
 * Drawn in Ata Ekta 06 Routine §05 (desktop); the phone follows 13 Responsive
 * rule ০৩, the matrix.
 *
 * The coordinator's hardest screen: a week of periods against a week of days,
 * where every move can collide with a teacher, a room, or the section itself.
 *
 * ── Why this moves by tap, and not by drag ───────────────────────────────
 * §8.1 draws the interaction as drag-and-drop. It is implemented here as
 * tap-to-pick-up, tap-to-place, because on the device this product actually
 * targets, dragging is the worse instrument for the same job:
 *
 *   • The floor is 360x640 on a 2GB phone (§1), and §11 says the mobile
 *     layout IS the design — desktop is the enhancement. At 360px the grid
 *     scrolls horizontally, so source and target are frequently not on
 *     screen together. A drag that requires auto-scrolling mid-gesture with
 *     a thumb is a drag that gets dropped in the wrong cell.
 *   • HTML5 drag-and-drop does not fire on touch at all without a polyfill,
 *     and the critical path is budgeted at 180 KB gzipped (TRD §3).
 *   • Selection survives scrolling. Pick up a class, scroll to Thursday,
 *     put it down — the phone equivalent of holding it in your other hand.
 *   • It is the same gesture on touch, mouse, and keyboard, so keyboard
 *     support is not a second implementation.
 *
 * And it makes the constraint feedback BETTER, which is the actual
 * requirement. F-504 asks for live feedback; a drag can only tell you about
 * the cell under the pointer, whereas a held selection lets the grid mark
 * every reachable cell at once — see markTargets().
 *
 * ── What the client may and may not claim ────────────────────────────────
 * The database's exclusion constraints are the final arbiter (§8.1); this
 * screen is "an optimistic proposer". So it hints only what it can actually
 * see — this section's own week, which is the whole of the section-collision
 * dimension — and never pre-judges teacher or room collisions, which live in
 * other sections' slots it was never sent. Those surface on the attempt, as
 * a sentence naming the class that already owns the hour.
 *
 * ── Ata Ekta §05 ─────────────────────────────────────────────────────────
 * The drawing is one desk: a bar with the title, the section as a neutral
 * chip and one small primary; a white grid area — a blank corner, inset day
 * heads, start times right-aligned, square 44px cells, a break drawn as one
 * inset cell per day — and, flush under the grid, the band that names a
 * clash in words. The section picker, the undo row, the held-lesson banner,
 * the legend and the drawers are not drawn and take the same vocabulary.
 * On a phone the matrix never reflows: the first column is frozen with a
 * rule and a shadow on its edge, and the primary moves to a bar pinned under
 * the grid, where a thumb reaches it (13 Responsive, "বুড়ো আঙুলের নাগাল").
 * The band rides in that pinned dock with it, so a clash is read where the
 * tap was made and is never left behind the bar or below the fold.
 * What is drawn but not built — the conflict chip and cell, subject tints,
 * "সংরক্ষণ", the drag cursor — is recorded in the unit's `deferred`: the
 * payload carries no conflicts, and every edit is already saved as it is made.
 */
import type { Auth } from './auth.ts';
import { emptyState, errorState } from './view-states.ts';
import {
  pageHeader, field, badge, statusBadge, listSkeleton, openDrawer, button, buttonRow,
  el, append, numText, numClass, icon, setBusy, announce, confirmOverlay, sectionHeading,
  permissionState, permissionMessage, serverMessage, deniedContact,
  type OverlayHandle,
} from './ui/index.ts';
import { formatCount, formatTime, formatAcademicYear } from '../../../packages/ui-core/src/format.ts';

/**
 * The teaching week comes from the SERVER, which reads `tenants.weekend_days`.
 *
 * This file used to hard-code রবি–বৃহঃ — Sunday to Thursday, five fixed
 * columns. `weekend_days` defaults to {5,6} so that matched most schools, but
 * it is per-institution and the live data already varies: one school in this
 * database keeps only Friday, which makes Saturday a teaching day the grid had
 * no column for. Lessons there would have been invisible and unplaceable.
 *
 * The fallback is used only before the first response arrives.
 */
const FALLBACK_DAYS: Array<{ dow: number; bn: string }> = [
  { dow: 0, bn: 'রবি' }, { dow: 1, bn: 'সোম' }, { dow: 2, bn: 'মঙ্গল' },
  { dow: 3, bn: 'বুধ' }, { dow: 4, bn: 'বৃহঃ' },
];

interface Period {
  periodNo: number; labelBn: string; startsAt: string; endsAt: string; kind: string;
}
interface Slot {
  id: string; dayOfWeek: number; periodNo: number;
  subjectBn: string | null; teacherName: string | null; roomName: string | null;
  isDouble: boolean; doubleGroupId: string | null;
  parallelPool: string | null; isPinned: boolean; rowVersion: number;
  /** P9-6. Which teacher, for a teacher-scoped re-solve. */
  teacherId: string | null;
}
interface RoutineMeta {
  id: string; nameBn: string; shift: string; status: string; version: number;
  publishedAt: string | null; editable: boolean; sectionLabel: string;
}
interface Day { dow: number; bn: string }
interface PickSubject { id: string; nameBn: string; periodsPerWeek: number }
interface PickTeacher { subjectId: string; id: string; nameBn: string }
interface PickRoom { id: string; label: string; capacity: number | null }
/** What a section needs before a routine can exist for it. */
interface Setup {
  academicYearId: string; yearLabel: string; shift: string;
  periodTemplateId: string | null; periodTemplateName: string | null;
  sectionLabel: string; effectiveFrom: string;
}
interface UndoEntry { id: string; action: string; labelBn: string; createdAt: string }

interface Grid {
  sectionId: string;
  /** P9-5. What pressing undo would reverse, newest first. Server-owned. */
  undo?: UndoEntry[];
  routine: RoutineMeta | null;
  periods: Period[];
  slots: Slot[];
  days?: Day[];
  setup?: Setup | null;
  subjects?: PickSubject[];
  teachers?: PickTeacher[];
  rooms?: PickRoom[];
}

export interface SectionOption { id: string; label: string }

export interface RoutineEditorViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /**
   * P9-5 §16. Which section to open on.
   *
   * Without it the editor opens on the last section this device used, which
   * is right when a coordinator navigates to it directly and wrong when they
   * arrive from a generation result that was about a different one — they
   * would be dropped into a week they had not been reading about and would
   * have to find their way back.
   */
  sectionId?: string;
}

const TITLE = 'রুটিন সম্পাদনা';
/** What a refusal names — "রুটিন দেখার অনুমতি আপনার নেই।" (B-30). */
const SUBJECT = 'রুটিন';
/** Every connection failure on this screen starts with these words. */
const OFFLINE_PREFIX = 'সংযোগ নেই';

const SHIFT_BN: Record<string, string> = {
  morning: 'প্রাতঃ', day: 'দিবা', evening: 'সান্ধ্য', single: 'একক',
};
const STATUS_BN: Record<string, string> = {
  draft: 'খসড়া', review: 'পর্যালোচনায়', active: 'প্রকাশিত',
  superseded: 'প্রতিস্থাপিত', archived: 'সংরক্ষিত',
};

/**
 * What the band under the grid is saying, which decides its tint:
 *   ok       an edit was accepted
 *   warn     accepted, with something to read (publish warnings)
 *   danger   refused — a clash, a stale version, a pinned lesson (§05's band)
 *   offline  nothing reached the server
 */
type NoticeTone = 'ok' | 'warn' | 'danger' | 'offline';
interface Notice { text: string; tone: NoticeTone }

export class RoutineEditorView {
  private readonly o: RoutineEditorViewOptions;
  /**
   * The one child this view keeps in the shell's view element. Every render
   * refills THIS, not the root: the shell animates each direct child of the
   * view element in, and rebuilding the root on every tap replayed that
   * entrance on every pick-up and every placement.
   */
  private readonly screen: HTMLElement;
  private sections: SectionOption[] = [];
  private sectionId: string | null = null;
  private grid: Grid | null = null;
  private selected: string | null = null;
  private notice: Notice | null = null;
  private loading = true;
  /**
   * The load failed. Distinct from `notice`, and the distinction is the
   * point: a failure means the app does NOT know whether this section has a
   * routine, so "no routine has been created" must not be rendered under it.
   */
  private failed = false;
  /** The server refused this role. Not a failure: retrying cannot help. */
  private denied = false;
  private deniedMsg = '';
  private deniedWho: string | undefined = undefined;
  private busy = false;
  /** §17. True while a lesson drawer holds typing nobody has saved yet. */
  private drawerOpen = false;
  /** P9-6. Slots a scoped re-solve just moved, so the grid can show which. */
  private changed = new Set<string>();
  /** P9-6 §10. The routine as this screen last saw it. */
  private fingerprint = '';
  /**
   * The cell a keyboard or pointer last pressed. Each render rebuilds the
   * grid, so without this a keyboard user who picks up a class lands back on
   * the page body and has to tab through the header to find their place.
   */
  private lastCell: string | null = null;
  /**
   * The cell a result is about, for the next render only. On a phone the
   * band is pinned over the bottom of the grid; if the sentence it just
   * gained covers the cell that caused it, the page lifts by the overlap.
   */
  private reveal: string | null = null;

  constructor(options: RoutineEditorViewOptions) {
    this.o = options;
    this.screen = options.doc.createElement('div');
    this.screen.className = 'editor-screen';
    options.root.textContent = '';
    options.root.append(this.screen);
    // An explicit section wins over the remembered one: arriving from a
    // generation result means the coordinator has a section in mind, and
    // this device's last choice is not it.
    this.sectionId = options.sectionId || localStorage.getItem('shikhon_last_section');
    void this.init();
  }

  private async init(): Promise<void> {
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/sections');
      if (res.ok) {
        const body = (await res.json()) as { sections: Array<{ id: string; name: string; className?: { bn?: string } }> };
        this.sections = body.sections.map((s) => ({
          id: s.id, label: `${s.className?.bn ?? ''}-${s.name}`.replace(/^-/, ''),
        }));
        if (!this.sectionId && this.sections[0]) this.sectionId = this.sections[0].id;
      }
    } catch { /* offline: the picker stays empty and the grid says why */ }
    if (this.sectionId) await this.loadGrid(this.sectionId);
    else { this.loading = false; this.render(); }
  }

  private async loadGrid(sectionId: string): Promise<void> {
    this.failed = false;
    this.denied = false;
    this.loading = true;
    this.selected = null;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/rms/editor?sectionId=${encodeURIComponent(sectionId)}`);
      if (res.status === 403) {
        // A refusal is not a failed fetch: retrying it is futile, and the
        // person needs to know who can help — the same reading every other
        // screen gives a 403 (B-30, B-84).
        const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        this.grid = null;
        this.notice = null;
        this.deniedMsg = serverMessage(b, 403, permissionMessage(SUBJECT), SUBJECT);
        this.deniedWho = deniedContact({ code: b.error });
        this.denied = true;
      } else {
        if (!res.ok) throw new Error(String(res.status));
        this.grid = (await res.json()) as Grid;
        this.notice = null;
      }
    } catch {
      this.grid = null;
      // A FAILURE, not a notice. The render used to draw this warning and
      // then "এই শাখার জন্য কোনো রুটিন তৈরি হয়নি" underneath — but a failed
      // load does not know whether the section has a routine.
      this.failed = true;
      this.notice = null;
    }
    this.loading = false;
    this.render();
  }

  /* ------------------------------------------------------------ writing */

  /** The institution's own teaching days, never a constant. */
  private days(): Day[] {
    return this.grid?.days?.length ? this.grid.days : FALLBACK_DAYS;
  }

  /** A refusal, in the tint that says whether the server even heard it. */
  private refused(text: string): Notice {
    return { text, tone: text.startsWith(OFFLINE_PREFIX) ? 'offline' : 'danger' };
  }

  /**
   * Raise the band, and say it. The band is rebuilt on every render, and a
   * live region that arrives already filled is one most screen readers never
   * read — so the same words also go through the persistent announcer. A
   * refusal interrupts; a confirmation waits its turn.
   */
  private tell(notice: Notice): void {
    this.notice = notice;
    announce(this.o.doc, notice.text, notice.tone === 'danger' || notice.tone === 'offline');
  }

  /**
   * One POST, one shape of failure.
   *
   * Returns '' when accepted, otherwise the server's own sentence — which for
   * a clash names the teacher, the room or the class already in that hour.
   * Callers decide where to put it: a drawer keeps it inside the form beside
   * the values that caused it, the grid raises it as a notice.
   */
  private async send(body: Record<string, unknown>): Promise<string> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/rms/editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.ok && out.ok) return '';
      return out.message ?? 'কাজটি সম্পন্ন হয়নি।';
    } catch {
      return 'সংযোগ নেই — পরিবর্তন সংরক্ষণ হয়নি।';
    }
  }

  private slotAt(dow: number, periodNo: number): Slot | undefined {
    return this.grid?.slots.find((s) => s.dayOfWeek === dow && s.periodNo === periodNo);
  }

  private pick(slot: Slot): void {
    this.changed.clear();
    // A pinned lesson IS selectable, and that is a P9-5 correction: refusing
    // the selection meant its action bar never opened, so the only control
    // that could unlock it was unreachable. It cannot be MOVED — `place()`
    // still refuses, and the bar says so — but it can be selected, edited
    // and unlocked, which is the whole point of being able to lock it.
    if (slot.isDouble || slot.doubleGroupId) {
      this.tell(this.refused(
        'দ্বৈত পিরিয়ড আলাদা করে সরানো যায় না — দুটি অংশ একসাথেই থাকে।'));
      this.reveal = `${slot.dayOfWeek}-${slot.periodNo}`;
      this.render(); return;
    }
    this.selected = this.selected === slot.id ? null : slot.id;
    this.notice = null;
    this.render();
  }

  private async place(dow: number, periodNo: number): Promise<void> {
    const slotId = this.selected;
    if (!slotId || this.busy) return;
    // Selectable, not movable. The server refuses this too; saying it here
    // saves a round trip the coordinator would wait through.
    const held = this.grid?.slots.find((x) => x.id === slotId);
    const target = `${dow}-${periodNo}`;
    if (held?.isPinned) {
      this.tell(this.refused('এই ক্লাসটি পিন করা — সরাতে হলে আগে পিন সরান।'));
      this.reveal = target;
      this.render(); return;
    }
    this.busy = true;
    this.notice = null;
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/rms/editor', {
        method: 'POST',
        // §13. The version this grid was drawn from. If somebody else has
        // moved this class since, the server refuses rather than quietly
        // discarding their change.
        body: JSON.stringify({
          action: 'move', slotId, dayOfWeek: dow, periodNo,
          rowVersion: this.grid?.slots.find((x) => x.id === slotId)?.rowVersion,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.ok && body.ok) {
        this.selected = null;
        this.busy = false;
        await this.loadGrid(this.grid!.sectionId);   // re-read: the DB is the truth
        this.tell({ text: 'সরানো হয়েছে।', tone: 'ok' });
        this.reveal = target;
        this.render();
        return;
      }
      // F-504: the refusal names the class that already owns the hour.
      this.tell(this.refused(body.message ?? 'ওই ঘরে বসানো গেল না।'));
    } catch {
      this.tell(this.refused('সংযোগ নেই — পরিবর্তন সংরক্ষণ হয়নি।'));
    }
    this.busy = false;
    this.reveal = target;
    this.render();
  }

  private async publish(): Promise<void> {
    const routine = this.grid?.routine;
    if (!routine || this.busy) return;
    this.busy = true; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/rms/editor', {
        method: 'POST',
        body: JSON.stringify({ action: 'publish', routineId: routine.id }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; message?: string;
        warnings?: Array<{ code: string; messageBn: string }>;
      };
      if (res.ok && body.ok) {
        this.busy = false;
        await this.loadGrid(this.grid!.sectionId);
        // What was accepted, in the server's own words. The old version of
        // this line counted teaching slots with no teacher, which migration
        // 006's CHECK constraint makes impossible — so it could only ever
        // say ০টি, and the demo was the only thing that ever made it
        // say otherwise.
        const accepted = body.warnings ?? [];
        this.tell(accepted.length > 0
          ? { text: `প্রকাশিত হয়েছে — ${accepted[0].messageBn}`, tone: 'warn' }
          : { text: 'রুটিন প্রকাশিত হয়েছে।', tone: 'ok' });
        this.render();
        return;
      }
      this.tell(this.refused(body.message ?? 'প্রকাশ করা যায়নি।'));
    } catch {
      this.tell(this.refused('সংযোগ নেই — প্রকাশ করা যায়নি।'));
    }
    this.busy = false;
    this.render();
  }

  /* ------------------------------------------------------------- render */

  private render(): void {
    const d = this.o.doc;
    const screen = this.screen;
    // Which cell had focus, before this render destroys it.
    const active = d.activeElement as HTMLElement | null;
    const hadFocus = Boolean(active && screen.contains(active));
    if (hadFocus && active?.dataset.cell) this.lastCell = active.dataset.cell;
    screen.textContent = '';

    const rt = this.grid?.routine;
    screen.append(pageHeader(d, {
      title: TITLE,
      // §05 draws the bar without a sentence under the title; the purpose
      // line stays only while there is no week on screen to explain itself.
      subtitle: rt ? undefined : 'পিরিয়ড সরান — সংঘর্ষ হলে কারণ জানায়',
      actions: rt
        ? [
          // F-506: the shift is named in the header, because a teacher
          // working both shifts is the most common source of real-world
          // routine failure and the coordinator must always know which one
          // they are editing. §05's neutral section chip carries it.
          badge(d, {
            label: `${rt.sectionLabel} · ${SHIFT_BN[rt.shift] ?? rt.shift}`, tone: 'neutral',
          }),
          statusBadge(d, {
            state: rt.status,
            label: `${STATUS_BN[rt.status] ?? rt.status} · সংস্করণ ${formatCount(rt.version, 'bn')}`,
          }),
        ]
        : undefined,
      // The drawn bar's small primary. On a phone it is hidden and the same
      // action sits in the dock pinned under the grid (see `foot`).
      primary: rt?.editable ? this.publishButton('editor-publish-top', false) : undefined,
    }));

    // One tool row above the matrix: the section picker and the undo row.
    // Neither is drawn in §05; both are kept, out of the drawn frame.
    const toolbar = el(d, 'div', { className: 'editor-toolbar' });
    if (this.sections.length > 0) {
      toolbar.append(field(d, {
        label: 'শাখা',
        name: 'section',
        kind: 'select',
        value: this.sectionId ?? '',
        options: this.sections.map((sec) => ({ value: sec.id, label: sec.label })),
        onChange: (v) => {
          this.sectionId = v;
          // A different week: the last cell pressed is not on it.
          this.lastCell = null;
          try { localStorage.setItem('shikhon_last_section', v); } catch { /* quota */ }
          void this.loadGrid(v);
        },
      }).root);
    }
    const undoBar = this.undoBar();
    if (undoBar) toolbar.append(undoBar);
    if (toolbar.childElementCount > 0) screen.append(toolbar);

    if (this.denied) {
      screen.append(permissionState(d, { message: this.deniedMsg, contact: this.deniedWho }));
      return;
    }

    // A failure is the whole answer. This used to draw the warning AND then
    // "এই শাখার জন্য কোনো রুটিন তৈরি হয়নি" underneath it — two contradictory
    // claims, and the second one is not knowable when the first is true.
    if (this.failed) {
      screen.append(errorState(d, 'রুটিন আনা যায়নি — সংযোগ দেখে আবার চেষ্টা করুন।',
        () => { if (this.sectionId) void this.loadGrid(this.sectionId); }));
      return;
    }

    if (this.loading && !this.grid) { screen.append(listSkeleton(d, 5)); return; }

    if (!this.grid?.routine) {
      // With no grid there is nothing to sit under, so any notice stands on
      // its own above the empty state rather than disappearing.
      const standalone = this.noticeEl(true);
      if (standalone) screen.append(standalone);
      const setup = this.grid?.setup ?? null;
      if (!setup) {
        screen.append(emptyState(d, {
          glyph: 'clock',
          message: 'এই শাখার জন্য কোনো রুটিন তৈরি হয়নি।',
        }));
        return;
      }
      if (!setup.periodTemplateId) {
        // provision_tenant clones a bell schedule per shift from
        // period_template_defaults, which carries only `day` and `morning`
        // rows — an evening shift is provisioned with an empty template.
        screen.append(emptyState(d, {
          glyph: 'clock',
          message: 'এই শিফটের জন্য ঘণ্টার সময়সূচি (পিরিয়ড টেমপ্লেট) নেই — '
            + 'আগে সেটি তৈরি করতে হবে, তারপর রুটিন বানানো যাবে।',
        }));
        return;
      }
      screen.append(emptyState(d, {
        glyph: 'clock',
        message: `${setup.sectionLabel} · ${formatAcademicYear(setup.yearLabel)} শিক্ষাবর্ষের জন্য এখনো কোনো রুটিন নেই। `
          + 'রুটিন তৈরি করলে সপ্তাহের ছক খুলবে এবং ক্লাস বসানো যাবে।',
        action: { label: 'রুটিন তৈরি করুন', onClick: () => this.openCreate(setup) },
      }));
      return;
    }

    // The pick-up banner. Present only while something is held, so the screen
    // reads as "nothing is happening" when nothing is.
    if (this.selected) {
      const held = this.grid.slots.find((s) => s.id === this.selected);
      const what = `সরানো হচ্ছে: ${held?.subjectBn ?? 'ক্লাস'}`
        + (held?.teacherName ? ` · ${held.teacherName}` : '');
      // §10. A locked lesson explains its own consequence here, in words,
      // rather than leaving a padlock to carry the meaning.
      const how = held?.isPinned
        ? 'এই ক্লাসটি পিন করা — সরানো বা মুছে ফেলা যাবে না, এবং আবার রুটিন '
          + 'তৈরি করলেও এটি বদলাবে না। বদলাতে হলে আগে পিন সরান।'
        : 'যে ঘরে বসাতে চান সেই খালি ঘরে চাপ দিন।';
      const acts = buttonRow(d,
        button(d, {
          label: 'সম্পাদনা', size: 'sm', variant: 'secondary', disabled: this.busy,
          onClick: () => { if (held) this.openLesson(held); },
        }),
        button(d, {
          label: held?.isPinned ? 'পিন খুলুন' : 'পিন করুন',
          size: 'sm', variant: 'secondary', disabled: this.busy,
          glyph: 'lock',
          onClick: () => { if (held) void this.toggleLock(held); },
        }),
        button(d, {
          label: 'সরান', size: 'sm', variant: 'danger',
          disabled: this.busy || Boolean(held?.isPinned),
          onClick: () => { if (held) this.confirmRemove(held); },
        }),
        button(d, {
          label: 'বাতিল', size: 'sm', variant: 'secondary',
          onClick: () => { this.selected = null; this.render(); },
        }));
      screen.append(el(d, 'div', { className: 'editor-hold' },
        el(d, 'p', { className: 'editor-hold-what' }, ...numText(d, what)),
        el(d, 'p', { className: 'editor-hold-how' }, how),
        acts));
    }

    // §05's desk: the grid area, then the clash band flush under it, as one
    // white shell. The band and the phone's primary travel together in one
    // dock: on a phone the dock is pinned above the tab bar, so what just
    // happened is read beside the thumb that made it happen, never behind the
    // bar or below the fold. On a desktop the dock is static and holds only
    // the band, which is exactly §05.
    const band = this.noticeEl();
    const foot = rt?.editable
      ? el(d, 'div', { className: 'editor-foot' },
        this.publishButton('editor-publish-bottom', true))
      : null;
    const frame = el(d, 'div', { className: 'editor-frame' },
      el(d, 'div', { className: 'editor-grid-area' }, this.buildGrid(), this.legend()),
      band || foot ? el(d, 'div', { className: 'editor-dock' }, band, foot) : null);
    screen.append(frame);

    this.restoreFocus(hadFocus || d.activeElement === d.body || !d.activeElement);
    const reveal = this.reveal;
    this.reveal = null;
    if (reveal) this.keepClear(reveal);
  }

  /**
   * Lift the page if the pinned dock now covers the cell a result is about,
   * so the cell and the sentence about it are on screen together. A no-op
   * wherever the dock is not pinned: a desktop, or the end of the frame.
   */
  private keepClear(cellKey: string): void {
    const win = this.o.doc.defaultView;
    const dock = this.screen.querySelector<HTMLElement>('.editor-dock');
    const cell = this.screen.querySelector<HTMLElement>(`[data-cell="${cellKey}"]`);
    if (!win || !dock || !cell) return;
    const style = win.getComputedStyle(dock);
    if (style.position !== 'sticky') return;
    const c = cell.getBoundingClientRect();
    const k = dock.getBoundingClientRect();
    if (c.bottom <= k.top || c.top >= k.bottom) return;
    // Measured against where the dock settles once pinned, not where it is
    // now: near the top of the frame a pinned element cannot rise above its
    // frame, so it travels up with the page for a while before it stays put.
    const pinnedTop = win.innerHeight - (parseFloat(style.bottom) || 0) - k.height;
    const lift = Math.ceil(c.bottom - pinnedTop) + 8;
    if (lift > 0) win.scrollBy({ top: lift, behavior: 'auto' });
  }

  /**
   * Put focus back on the cell that had it. Only when this render took focus
   * away (or it is on nothing): a person who has moved on to the shell or a
   * drawer is never pulled back to the grid.
   */
  private restoreFocus(allowed: boolean): void {
    if (!allowed || !this.lastCell) return;
    const again = this.screen.querySelector<HTMLButtonElement>(
      `button[data-cell="${this.lastCell}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  }

  /** "প্রকাশ করুন": small in the desktop bar, a full-width bar on a phone. */
  private publishButton(className: string, bottom: boolean): HTMLButtonElement {
    return button(this.o.doc, {
      label: 'প্রকাশ করুন',
      variant: 'primary',
      size: bottom ? 'md' : 'sm',
      block: bottom,
      className,
      disabled: this.busy,
      onClick: () => { void this.publish(); },
    });
  }

  /**
   * The band that names what happened, in words. §05 draws it for a clash;
   * a confirmation and a lost connection take the same band in their own
   * tint, so a result always appears in the same place.
   */
  private noticeEl(standalone = false): HTMLElement | null {
    if (!this.notice) return null;
    return el(this.o.doc, 'p', {
      className: standalone ? 'editor-notice is-standalone' : 'editor-notice',
      data: { tone: this.notice.tone },
      attrs: { role: 'status' },
    }, ...numText(this.o.doc, this.notice.text));
  }

  /* ------------------------------------------------------------ drawers */

  /** Name the routine, and create the draft the grid hangs off. */
  private openCreate(setup: Setup): void {
    const d = this.o.doc;
    const form = el(d, 'div', { className: 'ui-fieldset' });
    const errLine = el(d, 'p', {
      className: 'ui-field-error', attrs: { role: 'alert', hidden: 'hidden' },
    });
    const name = field(d, {
      label: 'রুটিনের নাম', name: 'nameBn', required: true,
      value: `নিয়মিত রুটিন ${formatAcademicYear(setup.yearLabel)}`,
      helper: `${SHIFT_BN[setup.shift] ?? setup.shift} শিফট · ঘণ্টার সময়সূচি: ${setup.periodTemplateName ?? '—'}`,
      attrs: { maxlength: 120 },
    });
    append(form, errLine, name.root);
    append(form, el(d, 'p', {
      className: 'ui-dialog-text',
      text: 'খসড়া হিসেবে তৈরি হবে। ক্লাস বসানো শেষ হলে প্রকাশ করতে পারবেন।',
    }));

    let handle: OverlayHandle;
    const cancel = button(d, {
      label: 'বাতিল', variant: 'secondary', onClick: () => handle.close(),
    });
    const save = button(d, {
      label: 'তৈরি করুন', variant: 'primary',
      onClick: async () => {
        errLine.setAttribute('hidden', 'hidden');
        setBusy(save, true);
        const msg = await this.send({
          action: 'create-routine', sectionId: this.grid?.sectionId, nameBn: name.input.value.trim(),
        });
        setBusy(save, false);
        if (msg) {
          errLine.textContent = msg;
          errLine.removeAttribute('hidden');
          announce(d, msg, true);
          return;
        }
        handle.close();
        await this.loadGrid(this.grid!.sectionId);
        this.tell({ text: 'রুটিন তৈরি হয়েছে — এখন ক্লাস বসান।', tone: 'ok' });
        this.render();
      },
    });
    handle = openDrawer(d, { title: 'নতুন রুটিন', body: form, actions: [cancel, save] });
  }

  /**
   * Place a lesson in an empty cell, or change the one already there.
   *
   * The teacher list narrows to the people actually assigned to teach the
   * chosen subject in THIS section — `section_subject_teachers` — so the form
   * cannot propose a timetable the school never staffed.
   */
  private openLesson(existing: Slot | null, dow?: number, periodNo?: number): void {
    const d = this.o.doc;
    const g = this.grid;
    if (!g?.routine) return;
    const subjects = g.subjects ?? [];
    const allTeachers = g.teachers ?? [];
    const rooms = g.rooms ?? [];

    const form = el(d, 'div', { className: 'ui-fieldset' });
    const errLine = el(d, 'p', {
      className: 'ui-field-error', attrs: { role: 'alert', hidden: 'hidden' },
    });
    append(form, errLine);

    if (subjects.length === 0) {
      append(form, el(d, 'p', {
        className: 'ui-dialog-text',
        text: 'এই শ্রেণির পাঠ্যসূচিতে কোনো বিষয় নেই — আগে বিষয় নির্ধারণ করুন।',
      }));
    }

    // Reconstruct the current subject from its Bangla name: the grid payload
    // carries names for display, not ids, and widening it is a server change
    // this screen does not need.
    const currentSubject = existing
      ? subjects.find((x) => x.nameBn === existing.subjectBn)?.id ?? ''
      : '';

    const subject = field(d, {
      label: 'বিষয়', name: 'subjectId', kind: 'select', required: true,
      value: currentSubject,
      options: subjects.map((x) => ({ value: x.id, label: x.nameBn })),
    });
    const teacher = field(d, {
      label: 'শিক্ষক', name: 'teacherId', kind: 'select', required: true,
      options: [], helper: 'কেবল এই সেকশনে এই বিষয়ের জন্য দায়িত্বপ্রাপ্ত শিক্ষক।',
    });
    const room = field(d, {
      label: 'কক্ষ', name: 'roomId', kind: 'select',
      options: [{ value: '', label: 'নির্দিষ্ট নয়' },
        ...rooms.map((r) => ({ value: r.id, label: r.label }))],
      helper: 'ঐচ্ছিক।',
    });

    const fillTeachers = (): void => {
      const sel = teacher.input as HTMLSelectElement;
      const chosen = subject.input.value;
      const opts = allTeachers.filter((t) => t.subjectId === chosen);
      sel.textContent = '';
      for (const t of opts) {
        const o = d.createElement('option');
        o.value = t.id;
        o.textContent = t.nameBn;
        sel.append(o);
      }
      if (opts.length === 0) {
        const o = d.createElement('option');
        o.value = '';
        o.textContent = 'এই বিষয়ে কোনো শিক্ষক নিযুক্ত নন';
        sel.append(o);
      }
      const match = opts.find((t) => t.nameBn === existing?.teacherName);
      if (match) sel.value = match.id;
    };
    subject.input.addEventListener('change', fillTeachers);
    fillTeachers();

    if (existing?.roomName) {
      const r = rooms.find((x) => x.label === existing.roomName);
      if (r) (room.input as HTMLSelectElement).value = r.id;
    }
    append(form, subject.root, teacher.root, room.root);

    let handle: OverlayHandle;
    const cancel = button(d, {
      label: 'বাতিল', variant: 'secondary', onClick: () => handle.close(),
    });
    const save = button(d, {
      label: existing ? 'সংরক্ষণ করুন' : 'বসান', variant: 'primary',
      onClick: async () => {
        errLine.setAttribute('hidden', 'hidden');
        setBusy(save, true);
        const roomId = (room.input as HTMLSelectElement).value || null;
        const msg = existing
          ? await this.send({
            action: 'assign', slotId: existing.id,
            subjectId: subject.input.value, teacherId: teacher.input.value, roomId,
          })
          : await this.send({
            action: 'place', routineId: g.routine!.id, sectionId: g.sectionId,
            dayOfWeek: dow, periodNo,
            subjectId: subject.input.value, teacherId: teacher.input.value, roomId,
          });
        setBusy(save, false);
        // The drawer stays open on a refusal and the typed choices survive, so
        // a coordinator told "রফিক ইসলাম তখন নবম-খ-তে গণিত পড়াচ্ছেন" can pick a
        // different teacher without rebuilding the form (B-60).
        if (msg) {
          errLine.textContent = msg;
          errLine.removeAttribute('hidden');
          announce(d, msg, true);
          return;
        }
        handle.close();
        this.selected = null;
        await this.loadGrid(g.sectionId);
        this.tell({ text: existing ? 'হালনাগাদ হয়েছে।' : 'ক্লাস বসানো হয়েছে।', tone: 'ok' });
        this.render();
      },
    });
    this.drawerOpen = true;
    handle = openDrawer(d, {
      title: existing ? 'ক্লাস সম্পাদনা' : 'ক্লাস বসান',
      body: form,
      actions: [cancel, save],
      onClose: () => { this.drawerOpen = false; },
    });
  }

  private confirmRemove(slot: Slot): void {
    confirmOverlay(this.o.doc, {
      title: `${slot.subjectBn ?? 'ক্লাস'} সরাবেন?`,
      // A soft delete: routine_slots.status becomes 'removed', the row stays.
      body: 'ঘরটি খালি হয়ে যাবে এবং ওই সময়ে অন্য ক্লাস বসানো যাবে। '
        + 'রেকর্ড মুছে যাবে না — কী ছিল তা সংরক্ষিত থাকবে।',
      confirmLabel: 'সরান',
      danger: true,
      onConfirm: async () => {
        const msg = await this.send({
          action: 'remove', slotId: slot.id, rowVersion: slot.rowVersion,
        });
        this.selected = null;
        await this.loadGrid(this.grid!.sectionId);
        this.tell(msg ? this.refused(msg) : { text: 'সরানো হয়েছে।', tone: 'ok' });
        this.render();
      },
    });
  }

  /* ------------------------------------------------------------- P9-5 */

  /**
   * Lock or unlock a lesson. (§9/§10)
   *
   * `is_pinned` has meant "the solver may not move it" since migration 006
   * and `move` and `remove` have refused to touch a pinned slot for as long —
   * but nothing could ever SET it, so the guarantee existed and no school
   * could use it. This is the control.
   *
   * The row version goes with the request: two coordinators on one routine is
   * the ordinary case in a school office, and a lock applied to a slot
   * somebody else has since moved should be refused, not silently applied to
   * whatever is there now.
   */
  private async toggleLock(slot: Slot): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const msg = await this.send({
      action: slot.isPinned ? 'unlock' : 'lock',
      slotId: slot.id,
      rowVersion: slot.rowVersion,
    });
    this.busy = false;
    if (msg) {
      this.tell(this.refused(msg));
      this.render();
      return;
    }
    await this.loadGrid(this.grid!.sectionId);
    const done = slot.isPinned
      ? `${slot.subjectBn ?? 'ক্লাসটির'} পিন খোলা হয়েছে।`
      : `${slot.subjectBn ?? 'ক্লাসটি'} পিন করা হয়েছে — আবার রুটিন তৈরি করলে এটি বদলাবে না।`;
    // §18: a lock is a state change with consequences, and a padlock glyph
    // says nothing to a screen reader — `tell` announces it.
    this.tell({ text: done, tone: 'ok' });
    this.render();
  }

  /**
   * Reverse the most recent edit. (§11)
   *
   * The server owns the stack — it recorded how to reverse each edit while
   * the old row was still in front of it — so this sends one action and
   * re-reads. A browser-side undo would have to remember state the server has
   * already moved on from, and would be wrong exactly when two people are
   * editing, which is when undo matters most.
   */
  private async undo(): Promise<void> {
    if (this.busy || !this.grid?.routine) return;
    const top = this.grid.undo?.[0];
    this.busy = true;
    this.render();
    const msg = await this.send({ action: 'undo', routineId: this.grid.routine.id });
    this.busy = false;
    if (msg) {
      this.tell(this.refused(msg));
      this.render();
      return;
    }
    await this.loadGrid(this.grid.sectionId);
    const done = top ? `ফিরিয়ে নেওয়া হয়েছে — ${top.labelBn}` : 'ফিরিয়ে নেওয়া হয়েছে।';
    this.tell({ text: done, tone: 'ok' });
    this.render();
  }

  /**
   * The undo control, naming what it will reverse. (§11/§18)
   *
   * "ফিরিয়ে নিন" alone asks a coordinator to remember what they last did. The
   * label the server stored says it for them, and it keeps saying it after
   * the subject has been renamed — which is why the label is stored rather
   * than derived at read time.
   */
  private undoBar(): HTMLElement | null {
    const d = this.o.doc;
    const stack = this.grid?.undo ?? [];
    if (!this.grid?.routine?.editable) return null;

    const wrap = el(d, 'div', { className: 'editor-undo' });
    // P9-6. Always available while the routine is editable: recalculating a
    // part is not a recovery action, it is the ordinary response to a change
    // in the school, and it must not be hidden behind having edited first.
    wrap.append(button(d, {
      label: 'আবার হিসাব করুন', variant: 'secondary', size: 'sm', glyph: 'repeat',
      disabled: this.busy,
      onClick: () => this.openResolve(),
    }));
    if (stack.length === 0) {
      // Shown disabled rather than hidden: a control that appears only
      // sometimes is one a person has to hunt for, and its absence reads as
      // a bug rather than as "nothing to undo".
      wrap.append(button(d, {
        label: 'ফিরিয়ে নেওয়ার কিছু নেই', variant: 'ghost', size: 'sm', disabled: true,
      }));
      return wrap;
    }
    wrap.append(button(d, {
      label: `ফিরিয়ে নিন — ${stack[0].labelBn}`,
      variant: 'secondary',
      size: 'sm',
      glyph: 'rotate-ccw',
      disabled: this.busy,
      onClick: () => void this.undo(),
    }));
    if (stack.length > 1) {
      wrap.append(el(d, 'span', { className: 'editor-undo-more' },
        ...numText(d, `আরও ${formatCount(stack.length - 1, 'bn')}টি ধাপ ফিরিয়ে নেওয়া যাবে`)));
    }
    return wrap;
  }

  /**
   * §17 — do not lose an edit to a stray tap on the back button.
   *
   * The editor writes each change to the server as it is made, so there is no
   * unsaved GRID. What can be lost is a half-filled lesson drawer, and that
   * is what this guards: P9-2 recorded the same gap in the setup wizard and
   * this is the answer for both shapes.
   */
  hasUnsavedChanges(): boolean {
    return this.drawerOpen;
  }

  /** Wired by the shell before it swaps this view out. */
  confirmDiscard(onConfirm: () => void): void {
    confirmOverlay(this.o.doc, {
      title: 'এই ক্লাসটি এখনো সংরক্ষণ করা হয়নি',
      body: 'খোলা ফর্মে যা লিখেছেন তা হারিয়ে যাবে। রুটিনে ইতিমধ্যে করা '
        + 'পরিবর্তনগুলো সংরক্ষিত আছে — শুধু এই ফর্মটিই বাকি।',
      confirmLabel: 'বাদ দিন',
      danger: true,
      onConfirm,
    });
  }

  /* ------------------------------------------------------------- P9-6 */

  /**
   * "আবার হিসাব করুন" — recalculate one part of the routine. (§16)
   *
   * Reached from the editor, without leaving it, because the change that
   * prompts it — a teacher who is now unavailable, a room that closed — is
   * something a coordinator notices while looking at the grid.
   *
   * The scopes offered are derived from what is on screen: this section
   * always, and the selected lesson's teacher and day when one is held.
   * Offering "any teacher in the school" would need a picker for a question
   * nobody asks from this screen.
   */
  private openResolve(): void {
    const d = this.o.doc;
    const g = this.grid;
    if (!g?.routine) return;
    const held = g.slots.find((s) => s.id === this.selected) ?? null;

    const choices: Array<{ value: string; label: string; scope: Record<string, unknown> }> = [
      { value: 'section', label: `এই শাখার পুরো রুটিন (${g.routine.sectionLabel})`,
        scope: { kind: 'section', sectionId: g.sectionId } },
    ];
    if (held?.teacherName) {
      choices.push({
        value: 'teacher',
        label: `${held.teacherName} — এই শিক্ষকের সব ক্লাস`,
        scope: { kind: 'teacher', teacherId: held.teacherId ?? '' },
      });
    }
    if (held) {
      const dayBn = this.days().find((x) => x.dow === held.dayOfWeek)?.bn ?? '';
      choices.push({
        value: 'day', label: `${dayBn}বারের সব ক্লাস`,
        scope: { kind: 'day', dayOfWeek: held.dayOfWeek },
      });
    }

    let chosen = choices[0];
    const body = el(d, 'div', { className: 'ui-stack editor-resolve' });
    body.append(el(d, 'p', {
      className: 'ui-dialog-text',
      text: 'যে অংশটি আবার হিসাব করতে চান তা বেছে নিন। পিন করা ক্লাসগুলো '
          + 'অপরিবর্তিত থাকবে, এবং বাকি রুটিনের কিছুই নড়বে না।',
    }));
    body.append(field(d, {
      label: 'কোন অংশ', name: 'scope', kind: 'select', value: chosen.value,
      options: choices.map((c) => ({ value: c.value, label: c.label })),
      onChange: (v) => { chosen = choices.find((c) => c.value === v) ?? choices[0]; },
    }).root);

    const outcome = el(d, 'div', { className: 'ui-stack' });
    body.append(outcome);

    let handle: OverlayHandle | undefined;
    let previewed: Record<string, unknown> | null = null;

    // A refused preview or apply: the same band the grid uses, inside the
    // drawer, beside the choice that caused it.
    const showRefusal = (): void => {
      outcome.textContent = '';
      const band = this.noticeEl(true);
      if (band) outcome.append(band);
      if (this.notice) announce(d, this.notice.text, true);
    };

    const review = button(d, {
      label: 'পর্যালোচনা করুন', variant: 'secondary',
      onClick: async () => {
        setBusy(review, true);
        previewed = await this.sendResolve(chosen.scope, true);
        setBusy(review, false);
        if (!previewed) { showRefusal(); return; }
        outcome.textContent = '';
        for (const node of this.resolveSummary(previewed, true)) outcome.append(node);
        apply.disabled = false;
        announce(d, String((previewed as { verdictBn?: string }).verdictBn ?? ''));
      },
    });
    // Disabled until a preview has been seen: §17's whole point is that the
    // draft is not touched before somebody has read what would happen.
    const apply = button(d, {
      label: 'প্রয়োগ করুন', variant: 'primary', disabled: true,
      onClick: async () => {
        setBusy(apply, true);
        const before = new Set((this.grid?.slots ?? []).map((s) => s.id));
        const out = await this.sendResolve(chosen.scope, false);
        setBusy(apply, false);
        if (!out) { showRefusal(); return; }
        handle?.close();
        await this.loadGrid(this.grid!.sectionId);
        // §16. Which cells actually moved, so the grid shows the answer
        // rather than making a coordinator hunt for it.
        this.changed = new Set((this.grid?.slots ?? [])
          .filter((s) => !before.has(s.id)).map((s) => s.id));
        this.tell({ text: String((out as { verdictBn?: string }).verdictBn ?? 'হয়ে গেছে।'),
                    tone: 'ok' });
        this.render();
      },
    });

    handle = openDrawer(d, {
      title: 'অংশবিশেষ আবার হিসাব',
      body,
      actions: [
        button(d, { label: 'বাতিল', variant: 'secondary',
                    onClick: () => handle?.close() }),
        review, apply,
      ],
    });
  }

  /** One request. Returns the payload, or null after setting `this.notice`. */
  private async sendResolve(
    scope: Record<string, unknown>, preview: boolean,
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/rms/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routineId: this.grid?.routine?.id, scope, preview,
          // §10. The routine as this screen last saw it. A re-solve computed
          // against somebody else's newer routine is the silent overwrite
          // this exists to prevent.
          ...(this.fingerprint && !preview ? { fingerprint: this.fingerprint } : {}),
        }),
      });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && out.ok) {
        if (typeof out.fingerprint === 'string') this.fingerprint = out.fingerprint;
        return out;
      }
      this.notice = this.refused(
        typeof out.message === 'string' ? out.message : 'আবার হিসাব করা যায়নি।');
      return null;
    } catch {
      this.notice = this.refused('সংযোগ নেই — রুটিন আগের অবস্থাতেই আছে।');
      return null;
    }
  }

  /** §6/§7 — what changed, and what each moved lesson was before and after. */
  private resolveSummary(out: Record<string, unknown>, isPreview: boolean): HTMLElement[] {
    const d = this.o.doc;
    const s = out.summary as {
      affected: number; pinnedPreserved: number; unchanged: number;
      lost: number; moved: Array<{ beforeBn: string; afterBn: string }>;
    };
    const nodes: HTMLElement[] = [];
    nodes.push(el(d, 'p', { className: 'editor-verdict' },
      ...numText(d, String(out.verdictBn ?? ''))));
    // Counts as WORDS beside the numbers (§22): a coordinator reading
    // "৭ / ২৯ / ২" has to guess which is which.
    nodes.push(el(d, 'ul', { className: 'editor-counts' },
      ...[
        [`প্রভাবিত ক্লাস`, s.affected],
        [`অপরিবর্তিত থাকবে`, s.unchanged],
        [`পিন করা — অক্ষত`, s.pinnedPreserved],
        [`কোথাও বসানো যায়নি`, s.lost],
      ].map(([label, n]) => el(d, 'li', { className: 'editor-count' },
        ...numText(d, `${label}: ${formatCount(Number(n), 'bn')}টি`)))));

    if (s.moved.length > 0) {
      nodes.push(sectionHeading(d, { title: 'কোনটি কোথায় যাবে', level: 3 }));
      const list = el(d, 'ul', { className: 'editor-moves' });
      for (const m of s.moved.slice(0, 12)) {
        list.append(el(d, 'li', { className: 'editor-move' },
          el(d, 'span', { className: 'editor-move-before' }, ...numText(d, `আগে: ${m.beforeBn}`)),
          el(d, 'span', { className: 'editor-move-after' }, ...numText(d, `পরে: ${m.afterBn}`))));
      }
      nodes.push(list);
      if (s.moved.length > 12) {
        nodes.push(el(d, 'p', { className: 'editor-resolve-more' },
          ...numText(d, `আরও ${formatCount(s.moved.length - 12, 'bn')}টি`)));
      }
    }
    if (isPreview) {
      nodes.push(el(d, 'p', {
        className: 'editor-preview-note',
        text: 'এখনো কিছুই বদলানো হয়নি। "প্রয়োগ করুন" চাপলে উপরের পরিবর্তনগুলো হবে।',
      }));
    }
    return nodes;
  }

  /**
   * §05's matrix, as a real table: a blank corner (named for a screen
   * reader), the teaching days as column heads, one row per period headed by
   * its start time. It scrolls sideways inside its own box; the first column
   * is frozen at every width and carries the rule and shadow on a phone.
   */
  private buildGrid(): HTMLElement {
    const d = this.o.doc;
    const grid = this.grid!;
    const days = this.days();
    const table = el(d, 'table', { className: 'editor-grid' });
    // The column count sets the minimum width, so a six-day school scrolls
    // rather than squeezing its days under the 44px touch floor.
    table.style.setProperty('--editor-days', String(days.length));

    const head = el(d, 'tr', {},
      el(d, 'th', { className: 'editor-corner', attrs: { scope: 'col' } },
        el(d, 'span', { className: 'ui-sr-only', text: 'পিরিয়ড' })),
      ...days.map((day) => el(d, 'th', { className: 'editor-day', attrs: { scope: 'col' } },
        el(d, 'span', { className: 'editor-day-label', text: day.bn }))));
    table.append(el(d, 'thead', {}, head));

    const tbody = el(d, 'tbody');
    for (const p of grid.periods) {
      // Bangla digits, like every other number on this screen. The grid was
      // rendering the raw `HH:MM` from the API, so a Bangla timetable carried
      // Latin clock times in its one always-visible column.
      const time = formatTime(p.startsAt, 'bn');
      const rowHead = el(d, 'th', { className: 'editor-period', attrs: { scope: 'row' } },
        // §05 shows the start time only; the period number stays in the
        // row's accessible name, where "which period" is asked.
        el(d, 'span', { className: 'ui-sr-only' },
          ...numText(d, `পিরিয়ড ${formatCount(p.periodNo, 'bn')}`)),
        ' ',
        el(d, 'span', { className: numClass('editor-period-time', time), text: time }));
      const tr = el(d, 'tr', {}, rowHead);

      if (p.kind !== 'teaching') {
        // §05 draws the break as one inset cell per day, not a single band.
        days.forEach(() => {
          tr.append(el(d, 'td', { className: 'editor-break' },
            el(d, 'span', { className: 'editor-break-label' }, ...numText(d, p.labelBn))));
        });
        tbody.append(tr);
        continue;
      }

      for (const day of days) tr.append(this.buildCell(day.dow, p));
      tbody.append(tr);
    }
    table.append(tbody);
    return el(d, 'div', { className: 'ui-table-scroll editor-grid-scroll' }, table);
  }

  private buildCell(dow: number, p: Period): HTMLElement {
    const d = this.o.doc;
    const td = el(d, 'td', { className: 'editor-cell' });
    const slot = this.slotAt(dow, p.periodNo);
    const dayBn = this.days().find((x) => x.dow === dow)?.bn ?? '';
    const cellKey = `${dow}-${p.periodNo}`;

    const btn = el(d, 'button', {
      // `routine-slot` is the hook the lock/undo suite reads; `editor-slot`
      // is the look, scoped so the timetable's own slots are untouched.
      className: 'routine-slot editor-slot',
      attrs: { type: 'button' },
      data: { cell: cellKey },
    });
    btn.disabled = !this.grid?.routine?.editable || this.busy;
    btn.addEventListener('click', () => { this.lastCell = cellKey; });

    if (slot) {
      btn.dataset.filled = 'true';
      btn.dataset.selected = String(this.selected === slot.id);
      btn.setAttribute('aria-pressed', String(this.selected === slot.id));
      if (slot.isPinned) btn.dataset.pinned = 'true';
      // P9-6 §16. The cells a scoped re-solve just moved, marked until the
      // next action — so a coordinator sees the answer instead of comparing
      // the grid against their memory of it.
      const justMoved = this.changed.has(slot.id);
      if (justMoved) btn.dataset.changed = 'true';

      const subject = el(d, 'span', { className: 'editor-slot-subject' },
        ...numText(d, slot.subjectBn ?? '—'));
      // The wireframe's own legend marks: fork = parallel block (religion or
      // optional-subject split), joined squares = double period.
      const isDouble = slot.isDouble || Boolean(slot.doubleGroupId);
      if (slot.parallelPool) subject.append(this.mark('⑂', 'সমান্তরাল ব্লক'));
      if (isDouble) subject.append(this.mark('⧉', 'দ্বৈত পিরিয়ড'));

      const teacher = el(d, 'span', { className: 'editor-slot-meta' },
        ...numText(d, slot.teacherName ?? 'শিক্ষক নেই'));
      if (!slot.teacherName) teacher.dataset.missing = 'true';
      btn.append(subject, teacher);
      if (slot.roomName) {
        btn.append(el(d, 'span', { className: 'editor-slot-meta' }, ...numText(d, slot.roomName)));
      }
      // §10. The padlock is a reinforcement; the WORD is the carrier. A
      // coordinator who cannot see the glyph, and every screen reader, gets
      // the same fact and the same consequence.
      if (slot.isPinned) {
        btn.append(el(d, 'span', { className: 'editor-slot-lock' },
          icon(d, 'lock'), el(d, 'span', { text: 'পিন করা' })));
      }
      // The re-solve outline is a colour; this is the word beside it.
      if (justMoved) {
        btn.append(el(d, 'span', { className: 'editor-slot-note', text: 'এইমাত্র সরানো' }));
      }
      btn.setAttribute('aria-label',
        `${dayBn}, পিরিয়ড ${formatCount(p.periodNo, 'bn')}, ${slot.subjectBn ?? 'ক্লাস'}`
        + (slot.teacherName ? `, ${slot.teacherName}` : ', শিক্ষক নেই')
        + (slot.roomName ? `, ${slot.roomName}` : '')
        + (slot.parallelPool ? ', সমান্তরাল ব্লক' : '')
        + (isDouble ? ', দ্বৈত পিরিয়ড' : '')
        + (slot.isPinned
          ? ', পিন করা — আবার রুটিন তৈরি করলে এটি বদলাবে না'
          : '')
        + (justMoved ? ', এইমাত্র সরানো হয়েছে' : ''));
      btn.addEventListener('click', () => this.pick(slot));
    } else {
      btn.dataset.filled = 'false';
      // Plain words, not a warning glyph: an empty period is a fact the
      // coordinator is working ON, not an error being reported AT them.
      btn.append(el(d, 'span', { className: 'editor-slot-empty', text: 'খালি' }));
      btn.setAttribute('aria-label',
        `${dayBn}, পিরিয়ড ${formatCount(p.periodNo, 'bn')}, খালি`
        + (this.selected ? ' — এখানে বসাতে চাপ দিন' : ' — নতুন ক্লাস বসাতে চাপ দিন'));
      // Holding a class makes this a drop target. Holding nothing, it is now
      // where a NEW lesson is placed — until A4 an empty cell was inert,
      // because nothing in the product could create a slot to put in it.
      if (this.selected) {
        btn.dataset.target = 'true';
        btn.addEventListener('click', () => { void this.place(dow, p.periodNo); });
      } else {
        btn.addEventListener('click', () => this.openLesson(null, dow, p.periodNo));
      }
    }
    td.append(btn);
    return td;
  }

  /**
   * A legend glyph inside a cell. Hidden from assistive technology because
   * the cell's accessible name already says it in words; the title keeps it
   * explainable on hover and long-press.
   */
  private mark(glyph: string, label: string): HTMLElement {
    return el(this.o.doc, 'span', {
      className: 'editor-mark', text: glyph,
      attrs: { title: label, 'aria-hidden': 'true' },
    });
  }

  private legend(): HTMLElement {
    const d = this.o.doc;
    return el(d, 'div', { className: 'editor-legend' },
      ...([['⑂', 'সমান্তরাল ব্লক'], ['⧉', 'দ্বৈত পিরিয়ড']] as const).map(([glyph, label]) =>
        el(d, 'span', { className: 'editor-legend-item' },
          el(d, 'span', { className: 'editor-mark', text: glyph, attrs: { 'aria-hidden': 'true' } }),
          el(d, 'span', { text: label }))));
  }
}
