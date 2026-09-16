/**
 * "কে কোন বিষয় পড়ান" — the teaching-assignment matrix.
 *
 * P9-1's screen, and not a follow-up to it: `rms-svc/api/assignments.ts` is
 * the writer for `section_subject_teachers`, the one input
 * `solve.ts:loadDemand` reads to decide what a timetable must contain. P9-0
 * found that table holding six rows across 183 schools. Without this screen
 * the endpoint would be exactly the "backend complete — UI pending" state
 * D13 forbids.
 *
 * Named `teaching-assignments` because `assignments-view.ts` is homework
 * (বাড়ির কাজ) and has been since R-2. Two different things share the English
 * word and nothing in Bangla confuses them. The homework screen owns the
 * `assign-*` look in app.css, so the classes this screen added in the Ata
 * Ekta pass are `ta-*`; the older `assign-matrix` / `assign-cell` /
 * `#assign-bar` hooks stay because the tests read them.
 *
 * ── The shape is the drawing: sections down, subjects across ───────────────
 * Ata Ekta 06 Routine §02 draws the matrix with a row per SECTION and a
 * column per SUBJECT, headed "সেকশন", one class at a time here because the
 * API serves one class at a time. A flat list of eight hundred assignments
 * would be technically equivalent and unusable. The frame is the drawn one:
 * the header carries the title, the gap chip ("২ ঘর ফাঁকা") and the small
 * primary; the table and its legend footer are one block.
 *
 * ── The empty cells are the feature ────────────────────────────────────────
 * The grid is built from the CURRICULUM (`class_subjects`) and not from the
 * assignments that exist, so a coordinator sees the eleven subjects nobody is
 * teaching yet rather than the two that are done. An empty cell reads
 * "শিক্ষক দিন" on the danger tint — the words carry it, the colour only
 * repeats it — and the progress line says the same thing in a sentence.
 * P9-2's wizard reads the progress to decide whether Generate may be reached
 * at all — nobody arrives at that button without knowing what is missing.
 *
 * ── Editing is a batch; saving is explicit ─────────────────────────────────
 * Changes are held locally and marked, then sent together in one transaction.
 * Eighty sections of typing should not be eighty requests — and a coordinator
 * who fills a column and loses their connection should find the column empty
 * and do it again, rather than find half of it saved and have to work out
 * which half.
 *
 * ── Mobile ─────────────────────────────────────────────────────────────────
 * 13 Responsive rule ০৩: a matrix NEVER reflows — the row × column
 * relationship is the data. There is one matrix at every width; below 1024px
 * its first column is frozen (sticky, with a 2px edge and a shadow) and the
 * subject columns scroll beside it. §03 "বুড়ো আঙুলের নাগাল" puts a phone's
 * primary at the bottom, so Save is drawn twice — small in the header, full
 * width in the pinned footer bar — and a media query shows one. Both follow
 * the same state.
 */
import {
  el, append, numText, pageHeader, button, setBusy, statusBadge, field, icon,
  permissionState, deniedMessage, deniedContact, announce, toast, listSkeleton,
  confirmOverlay,
} from './ui/index.ts';
import { emptyState, errorState, bnNum } from './view-states.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import type { Auth } from './auth.ts';

interface ClassRow { id: string; nameBn: string; levelNo: number }
interface SectionRow { id: string; name: string; shift: string }
interface SubjectRow {
  id: string; nameBn: string; periodsPerWeek: number;
  doublePeriodsPerWeek: number; requiresCapability: string | null;
}
interface TeacherRow { id: string; nameBn: string; employeeCode: string; teaches: string[] }
interface Cell { sectionId: string; subjectId: string; teacherId: string; teacherBn: string }

interface Grid {
  classes: ClassRow[];
  classId: string | null;
  sections: SectionRow[];
  subjects: SubjectRow[];
  teachers: TeacherRow[];
  cells: Cell[];
  progress: { required: number; assigned: number };
}

export interface TeachingAssignmentsViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /**
   * The academic year being planned. Optional: when absent the view resolves
   * the school's current year from `/academics/hierarchy`, the same way
   * `exams-view` does — a caller should not have to know the year to open a
   * screen whose whole subject is this year.
   */
  yearId?: string;
  /** Told after every load and save, so a wizard step can follow along. */
  onProgress?: (p: { required: number; assigned: number }) => void;
}

const TITLE = 'কে কোন বিষয় পড়ান';
const SAVE_LABEL = 'সংরক্ষণ';
const SAVING_LABEL = 'সংরক্ষণ হচ্ছে…';
/** The drawn footer sentence (06 Routine §02). */
const LEGEND = 'লাল ঘর মানে ঐ সেকশনে ঐ বিষয়ের শিক্ষক নেই — রুটিন তৈরিতে ঐ পিরিয়ডগুলো ফাঁকা থাকবে।';

const key = (sectionId: string, subjectId: string) => `${sectionId}|${subjectId}`;

export class TeachingAssignmentsView {
  private readonly o: TeachingAssignmentsViewOptions;
  private grid: Grid | null = null;
  private loading = true;
  private saving = false;
  private denied = false;
  private deniedErr: unknown = null;
  private offline = false;
  private error = '';
  /** Cell → teacherId ('' means nobody). Only cells the user actually changed. */
  private pending = new Map<string, string>();

  /**
   * The header's small Save and the footer bar's full-width one. Updated in
   * place by renderBar(), never rebuilt, so neither a dropdown nor the button
   * just pressed loses focus while the count moves.
   */
  private saveButtons: HTMLButtonElement[] = [];
  /** The progress line inside #assign-bar, refilled in place. */
  private statusEl: HTMLElement | null = null;

  /** Resolved once, then reused for every class switch and save. */
  private yearId = '';

  constructor(options: TeachingAssignmentsViewOptions) {
    this.o = options;
    this.yearId = options.yearId ?? '';
    void this.start();
  }

  private async start(): Promise<void> {
    if (this.yearId) { await this.load(null); return; }
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/hierarchy');
      await refuseUnlessOk(res);
      const body = await res.json() as
        { years?: Array<{ id: string; isCurrent?: boolean }>; year?: { id: string } };
      this.yearId = body.years?.find((y) => y.isCurrent)?.id
        ?? body.years?.[0]?.id ?? body.year?.id ?? '';
    } catch (err) {
      if (isDenied(err)) { this.denied = true; this.deniedErr = err; }
      else this.error = 'শিক্ষাবর্ষ আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
      this.loading = false; this.render(); return;
    }
    if (!this.yearId) {
      this.loading = false;
      this.error = '';
      this.render();
      return;
    }
    await this.load(null);
  }

  /** Unsaved edits, for a router that wants to warn before leaving. */
  hasUnsavedChanges(): boolean { return this.pending.size > 0; }

  private async load(classId: string | null): Promise<void> {
    this.loading = true; this.error = ''; this.render();
    try {
      const q = new URLSearchParams({ yearId: this.yearId });
      if (classId) q.set('classId', classId);
      const res = await this.o.auth.authedFetch(`/api/v1/rms/assignments?${q}`);
      await refuseUnlessOk(res);
      this.grid = await res.json() as Grid;
      this.pending.clear();
      this.offline = false;
      this.o.onProgress?.(this.grid.progress);
    } catch (err) {
      if (isDenied(err)) {
        this.denied = true; this.deniedErr = err; this.grid = null;
      } else {
        this.offline = true;
        this.error = 'তালিকা আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
      }
    } finally {
      this.loading = false; this.render();
    }
  }

  /**
   * Send only what changed.
   *
   * Returns a message on failure and `''` on success rather than setting
   * `this.error` — A2's lesson: a `finally { render() }` that reloaded would
   * wipe the message before anyone read it, and the grid must stay on screen
   * with the offending choice still selected.
   */
  private async send(): Promise<string> {
    const changes = [...this.pending.entries()].map(([k, teacherId]) => {
      const [sectionId, subjectId] = k.split('|');
      return { sectionId, subjectId, teacherId: teacherId || null };
    });
    try {
      const res = await this.o.auth.authedFetch('/api/v1/rms/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearId: this.yearId, changes }),
      });
      const body = await res.json().catch(() => null) as { message?: string } | null;
      return res.ok ? '' : (body?.message ?? 'সংরক্ষণ করা যায়নি।');
    } catch {
      return 'সংযোগ নেই — সংরক্ষণ করা যায়নি।';
    }
  }

  private currentTeacher(sectionId: string, subjectId: string): string {
    const k = key(sectionId, subjectId);
    if (this.pending.has(k)) return this.pending.get(k) as string;
    return this.grid?.cells.find(
      (c) => c.sectionId === sectionId && c.subjectId === subjectId)?.teacherId ?? '';
  }

  /** Mark a cell's state for CSS: unsaved (neutral edge) and empty (the red "শিক্ষক দিন" box). */
  private static mark(sel: HTMLSelectElement, dirty: boolean): void {
    if (dirty) sel.dataset.dirty = 'true'; else delete sel.dataset.dirty;
    if (sel.value === '') sel.dataset.empty = 'true'; else delete sel.dataset.empty;
  }

  /** One editable cell: a real <select>, so keyboard and screen reader work. */
  private picker(section: SectionRow, subject: SubjectRow): HTMLElement {
    const d = this.o.doc;
    const g = this.grid as Grid;
    const k = key(section.id, subject.id);
    const chosen = this.currentTeacher(section.id, subject.id);

    const sel = el(d, 'select', {
      // The sheet's select, drawn as the design's 36px teacher box by
      // `.assign-matrix .assign-cell` (the tap floor keeps it 44px, R8).
      className: 'ui-input ui-select assign-cell',
      attrs: {
        // Named explicitly: a screen reader landing in a grid cell announces
        // neither its column header nor its row header.
        'aria-label': `${subject.nameBn} — ${section.name} শাখার শিক্ষক`,
      },
      // The key a test (and a future bulk action) finds a cell by.
      data: { cellKey: k },
    });

    // The drawn empty cell reads "শিক্ষক দিন". Value '' is still "nobody",
    // which is also how a coordinator removes a teacher.
    sel.append(el(d, 'option', { text: 'শিক্ষক দিন', attrs: { value: '' } }));

    for (const t of g.teachers) {
      // The competency register is a HINT, never a filter: it is empty in
      // every school on this deployment, so filtering by it would offer an
      // empty list and make the screen unusable.
      const opt = el(d, 'option', {
        text: t.teaches.includes(subject.id) ? `${t.nameBn} ✓` : t.nameBn,
        attrs: { value: t.id },
      });
      if (t.id === chosen) opt.selected = true;
      sel.append(opt);
    }
    TeachingAssignmentsView.mark(sel, this.pending.has(k));

    sel.addEventListener('change', () => {
      const saved = g.cells.find(
        (c) => c.sectionId === section.id && c.subjectId === subject.id)?.teacherId ?? '';
      // Choosing back what was already saved is not a change. Without this, a
      // coordinator who opens a dropdown and re-picks the same name leaves the
      // grid "dirty" and is warned about work that does not exist.
      if (sel.value === saved) this.pending.delete(k);
      else this.pending.set(k, sel.value);

      // One matrix at every width, so there is no twin to move — only this
      // cell's own marks, then the bar.
      TeachingAssignmentsView.mark(sel, this.pending.has(k));
      this.renderBar();
    });
    return sel;
  }

  /**
   * The drawn block: the class strip, the matrix (sections down, subjects
   * across), the legend footer and the save bar — one surface, one frame.
   */
  private matrix(shell: HTMLElement): void {
    const d = this.o.doc;
    const g = this.grid as Grid;

    const table = el(d, 'table', { className: 'ui-table assign-matrix' });
    // The design draws no caption; the table still needs a name.
    table.append(el(d, 'caption', {
      className: 'ui-sr-only',
      text: `${g.classes.find((c) => c.id === g.classId)?.nameBn ?? ''}`
        + ' — শাখা ও বিষয়ভিত্তিক শিক্ষক',
    }));

    const head = el(d, 'thead');
    const hr = el(d, 'tr');
    hr.append(el(d, 'th', { text: 'সেকশন', attrs: { scope: 'col' } }));
    for (const sub of g.subjects) {
      const th = el(d, 'th', { attrs: { scope: 'col' } });
      append(th, el(d, 'span', { className: 'assign-subject' }, ...numText(d, sub.nameBn)));
      // The weekly load, because it is what makes an assignment mean
      // something: six periods is a different ask from two.
      append(th, el(d, 'span', { className: 'ta-load' },
        ...numText(d, `সপ্তাহে ${bnNum(sub.periodsPerWeek)}টি পিরিয়ড`
          + (sub.requiresCapability ? ' · ল্যাব লাগবে' : ''))));
      hr.append(th);
    }
    head.append(hr); table.append(head);

    const body = el(d, 'tbody');
    for (const sec of g.sections) {
      const tr = el(d, 'tr');
      tr.append(el(d, 'th', { attrs: { scope: 'row' } }, ...numText(d, `${sec.name} শাখা`)));
      for (const sub of g.subjects) {
        const td = el(d, 'td');
        td.append(this.picker(sec, sub));
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);

    // The section heading this block had ("শিক্ষক নির্ধারণ", h2) is not drawn
    // — its status moved to the header chip — but a reader's heading
    // navigation still lands here (R8), so it stays for them only.
    shell.append(el(d, 'h2', { className: 'ui-sr-only', text: 'শিক্ষক নির্ধারণ' }));

    const scroll = el(d, 'div', { className: 'ui-table-scroll' });
    scroll.append(table);
    shell.append(scroll);

    shell.append(el(d, 'p', { className: 'ta-legend', text: LEGEND }));

    // The bar is the shell's last child so it can pin to the bottom of a
    // phone's screen for the whole height of the matrix.
    const bar = el(d, 'div', { className: 'assign-bar' });
    bar.id = 'assign-bar';
    this.statusEl = el(d, 'p', { className: 'ta-status' });
    append(this.statusEl, ...this.statusChildren());
    bar.append(this.statusEl, this.saveButton('ta-save-bottom', true));
    shell.append(bar);
  }

  /** "১ / ৪ টি ঘর পূরণ হয়েছে · ১টি পরিবর্তন সংরক্ষণ করা হয়নি", numbers in the numeral face. */
  private statusChildren(): HTMLElement[] {
    const d = this.o.doc;
    const g = this.grid as Grid;
    const dirty = this.pending.size;
    const out = [el(d, 'span', {},
      ...numText(d, `${bnNum(g.progress.assigned)} / ${bnNum(g.progress.required)} টি ঘর পূরণ হয়েছে`))];
    if (dirty > 0) {
      out.push(el(d, 'span', { className: 'assign-dirty' },
        ...numText(d, ` · ${bnNum(dirty)}টি পরিবর্তন সংরক্ষণ করা হয়নি`)));
    }
    return out;
  }

  /** Save. Small in the header as drawn; a full-width bar button on a phone. */
  private saveButton(className: string, bottom: boolean): HTMLButtonElement {
    const btn = button(this.o.doc, {
      label: this.saving ? SAVING_LABEL : SAVE_LABEL,
      variant: 'primary',
      size: bottom ? 'md' : 'sm',
      block: bottom,
      className,
      disabled: this.saving || this.pending.size === 0,
      onClick: () => { void this.onSave(); },
    });
    this.saveButtons.push(btn);
    return btn;
  }

  /** The progress line and both Save buttons, updated in place so focus stays put. */
  private renderBar(): void {
    for (const btn of this.saveButtons) {
      setBusy(btn, this.saving);
      const label = btn.querySelector('.btn-label');
      if (label) label.textContent = this.saving ? SAVING_LABEL : SAVE_LABEL;
      if (!this.saving) btn.disabled = this.pending.size === 0;
    }
    const status = this.statusEl;
    if (!status || !this.grid) return;
    status.textContent = '';
    append(status, ...this.statusChildren());
  }

  private async onSave(): Promise<void> {
    if (this.pending.size === 0) return;
    this.saving = true; this.renderBar();
    const n = this.pending.size;
    const msg = await this.send();
    this.saving = false;

    if (msg) {
      // The grid stays exactly as it is, offending choice still selected.
      this.error = msg;
      this.render();
      announce(this.o.doc, msg);
      return;
    }
    toast(this.o.doc, { message: `${bnNum(n)}টি পরিবর্তন সংরক্ষণ হয়েছে`, tone: 'success' });
    await this.load(this.grid?.classId ?? null);
  }

  /** The drawn header chip: the gaps as a count, or "সম্পূর্ণ" once there are none. */
  private gapChip(g: Grid): HTMLElement {
    const gap = Math.max(0, g.progress.required - g.progress.assigned);
    return gap > 0
      ? statusBadge(this.o.doc, { state: 'unassigned', label: `${bnNum(gap)} ঘর ফাঁকা`, tone: 'danger' })
      : statusBadge(this.o.doc, { state: 'active', label: 'সম্পূর্ণ', tone: 'success' });
  }

  /**
   * Switching class throws the pending edits away, so it asks first — in the
   * app's own confirm (a bottom sheet on a phone), never a bare confirm()
   * (IMPLEMENTATION §7). The select goes back to the class on screen until
   * the answer is yes.
   */
  private switchClass(value: string, input: HTMLSelectElement, current: string): void {
    if (this.pending.size === 0) { void this.load(value); return; }
    input.value = current;
    confirmOverlay(this.o.doc, {
      title: 'সংরক্ষণ করা হয়নি',
      body: 'সংরক্ষণ না করা পরিবর্তন আছে। শ্রেণি বদলালে সেগুলো হারিয়ে যাবে।',
      confirmLabel: 'বাদ দিন',
      danger: true,
      onConfirm: () => { void this.load(value); },
    });
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    this.saveButtons = [];
    this.statusEl = null;

    if (this.denied) {
      root.append(pageHeader(d, { title: TITLE }));
      root.append(permissionState(d, {
        message: deniedMessage(this.deniedErr, 'শিক্ষক নির্ধারণ'),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }

    const g = this.grid;
    const ready = !this.loading && !!g && g.classes.length > 0 && g.subjects.length > 0;

    // The drawn bar (06 Routine §02): title, the gap chip, the small primary.
    root.append(pageHeader(d, {
      title: TITLE,
      actions: ready && g ? [this.gapChip(g)] : undefined,
      primary: ready ? this.saveButton('ta-save-top', false) : undefined,
    }));

    if (this.loading) { root.append(listSkeleton(d, 6)); return; }

    if (this.error && !g) {
      root.append(errorState(d, this.error, () => void this.load(null)));
      return;
    }
    if (!g) {
      root.append(emptyState(d, {
        glyph: 'calendar',
        message: 'চলতি শিক্ষাবর্ষ পাওয়া যায়নি। আগে শিক্ষাবর্ষ তৈরি করুন।',
      }));
      return;
    }

    if (g.classes.length === 0) {
      root.append(emptyState(d, {
        glyph: 'layers',
        message: 'এই শিক্ষাবর্ষে কোনো শ্রেণি বা শাখা নেই। আগে একাডেমিক কাঠামো তৈরি করুন।',
      }));
      return;
    }

    // A save failed. Loud, above the grid, and the grid stays editable.
    if (this.error) {
      const failed = errorState(d, this.error);
      failed.classList.add('ta-error');
      root.append(failed);
    }

    const shell = el(d, 'div', { className: 'ui-data ta-shell' });
    root.append(shell);

    // Offline is a statement about the data on screen, not a failure.
    if (this.offline) {
      shell.append(el(d, 'p', { className: 'offline-banner ta-offline', attrs: { role: 'status' } },
        icon(d, 'wifi-off', 'offline-icon'),
        el(d, 'span', { text: 'অফলাইন — সর্বশেষ সংরক্ষিত তথ্য দেখানো হচ্ছে।' })));
    }

    // A <select> and not tabs: a college has twelve classes, and tabs would
    // wrap into three rows on a phone. The design draws the matrix without
    // one; the API serves one class at a time, so the strip heads the block.
    const current = g.classId ?? '';
    const cls = field(d, {
      kind: 'select',
      name: 'classId',
      label: 'শ্রেণি',
      className: 'ta-class',
      value: current,
      options: g.classes.map((c) => ({ value: c.id, label: c.nameBn })),
      onChange: (value) => {
        this.switchClass(value, cls.input as HTMLSelectElement, current);
      },
    });
    shell.append(el(d, 'div', { className: 'ta-picker' }, cls.root));

    if (g.subjects.length === 0) {
      shell.append(emptyState(d, {
        glyph: 'book-open',
        message: 'এই শ্রেণিতে কোনো বিষয় নির্ধারিত নেই। পাঠ্যসূচি ছাড়া রুটিন তৈরি করা যাবে না।',
      }));
      return;
    }

    this.matrix(shell);
  }
}
