/**
 * My subjects — F-802, wireframe §6.2 ⟨offline⟩ · Ata Ekta 03 Student §02
 *
 * "The subject-based model made visible. No catalog, no browse, no enrol,
 * no search-for-a-course." The student sees exactly the subjects their
 * class and group assign them (F-304) — including their religion variant
 * and their optional subject, not the class template.
 *
 * Framework-free manual DOM, same as every other view here.
 *
 * The drawing is one flush column of rows: a glyph (a star for the optional
 * subject, an open book for the rest), the subject's name, one quiet line
 * under it, and the requirement chip on the optional subject only. Built from
 * `list` / `listItem`, so the row is the same row every other list uses.
 *
 * All five states (IMPLEMENTATION §7): loading is `listSkeleton` — grey rows
 * the shape of the real list, never a spinner; empty says what is missing and
 * who can fix it; error says what failed in plain language with one retry;
 * offline is a --warn-tint banner over the last cached list rather than a
 * modal that stops work; denied is the canonical refusal (B-30).
 */
import type { Auth } from './auth.ts';
// ui-core owns the numeral policy (counts in Bangla, identifiers always
// Latin). Three views define a local `bn` instead; this one does not add a
// fourth copy of a rule that already has a home and a test suite.
import { formatCount } from '../../../packages/ui-core/src/format.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import {
  permissionState, permissionMessage, pageHeader, badge, list, listItem,
  listSkeleton, emptyState, errorState, el, icon,
} from './ui/index.ts';

const bn = (n: number): string => formatCount(n, 'bn');

export interface SubjectRow {
  subjectId: string;
  nameBn: string;
  nctbCode: string | null;
  requirementType: string;
  requirementLabelBn: string;
  totalChapters: number;
  completedChapters: number;
  progressPercent: number;
  nextChapter: { id: string; chapterNo: number | null; nameBn: string | null } | null;
}

export interface SubjectsViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Opens the chapter reader (F-803) for a subject. */
  onOpenSubject?: (subjectId: string) => void;
}

const CACHE_KEY = 'shikhon_my_subjects';

/**
 * A subject's Bangla name from the last list this screen saved, or null.
 *
 * For পড়াশোনা, which is opened with only a subject id: when that subject has
 * no chapters it must say WHICH subject, and the name the student just tapped
 * is already on the device. Reads the cache only — never a request.
 */
export function cachedSubjectName(subjectId: string): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const rows = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(rows)) return null;
    const hit = rows.find((r): r is SubjectRow =>
      !!r && typeof r === 'object' && (r as SubjectRow).subjectId === subjectId);
    return hit && typeof hit.nameBn === 'string' && hit.nameBn.trim() ? hit.nameBn : null;
  } catch {
    return null;
  }
}

export class SubjectsView {
  private readonly o: SubjectsViewOptions;
  private subjects: SubjectRow[] = [];
  private loading = true;
  private offline = false;
  private error = false;
  /** The server refused. Not an outage; no retry helps; drop the cache. */
  private denied = false;
  /** B-84. The refusal itself, so the screen can say which kind it was. */
  private deniedErr: unknown = null;

  constructor(options: SubjectsViewOptions) {
    this.o = options;
    // Cache first, network second. N-01's device floor and the "no blocking
    // fetch, ever" rule mean the list must be on screen before the request
    // even leaves the phone.
    this.subjects = this.readCache();
    this.loading = this.subjects.length === 0;
    this.render();
    void this.load();
  }

  private readCache(): SubjectRow[] {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const parsed = raw ? (JSON.parse(raw) as SubjectRow[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async load(): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/subjects');
      await refuseUnlessOk(res);
      const body = (await res.json()) as { subjects?: SubjectRow[] };
      this.subjects = body.subjects ?? [];
      this.offline = false;
      this.error = false;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(this.subjects)); } catch { /* quota */ }
    } catch (err) {
      if (isDenied(err)) {
        // A refusal invalidates the cache. It was filled while this person was
        // allowed to see it, or by somebody else on a shared device, and the
        // server has now said no — so the screen must stop saying yes. B-30.
        this.denied = true;
        this.deniedErr = err;
        this.subjects = [];
        this.offline = false;
        this.error = false;
        try { localStorage.removeItem(CACHE_KEY); } catch { /* private mode */ }
        return;
      }
      // A cached list plus an offline banner beats an error screen: the
      // student's subject set changes about twice a year.
      if (this.subjects.length > 0) this.offline = true;
      else this.error = true;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', 'bn');

    // The count only when there is a list to count. Above an error or a
    // refusal, "০টি বিষয়" read as a fact about the student rather than about
    // the request. pageHeader sets the figure in the numeral face (R6).
    root.append(pageHeader(d, {
      title: 'আমার বিষয়',
      subtitle: this.loading
        ? 'লোড হচ্ছে…'
        : this.subjects.length > 0 ? `${bn(this.subjects.length)}টি বিষয়` : undefined,
    }));

    // B-30. A refusal outranks the offline banner, the skeleton and the
    // empty state: nothing is loading, there is nothing to show, and
    // calling it "offline" is the lie this item exists to remove.
    if (this.denied) {
      root.append(permissionState(d, {
        message: permissionMessage('আমার বিষয়'),
        contact: 'প্রধান শিক্ষক',
      }));
      return;
    }

    if (this.loading) { this.renderSkeleton(root); return; }
    if (this.error)   { this.renderError(root);    return; }
    if (this.subjects.length === 0) { this.renderEmpty(root); return; }

    if (this.offline) {
      // The sheet's --warn-tint banner (§7), above the cached list: the rows
      // under it are real but may be stale. This screen only reads, so
      // nothing is queued and there is no waiting count to show.
      root.append(el(d, 'p', {
        className: 'offline-banner subj-offline', attrs: { role: 'status' },
      }, icon(d, 'wifi-off', 'offline-icon'),
         el(d, 'span', { text: 'অফলাইন — সংরক্ষিত বিষয় দেখানো হচ্ছে' })));
    }

    // One column of flush rows (03 Student §02), not a card grid: a subject
    // list is a short, fixed set the student scans top to bottom.
    const ul = list(d, 'আমার বিষয়', ...this.subjects.map((s) => this.row(s)));
    ul.classList.add('subj-rows');
    root.append(ul);
  }

  /** Foundations §04: grey rows the shape of the list, never a spinner. */
  private renderSkeleton(root: HTMLElement): void {
    const sk = listSkeleton(this.o.doc, 3);
    // The component says "লোড হচ্ছে"; this screen always said WHAT is loading.
    sk.setAttribute('aria-label', 'বিষয় লোড হচ্ছে');
    root.append(sk);
  }

  private renderEmpty(root: HTMLElement): void {
    // One sentence, and it says what to DO — a student seeing this has not
    // had their subject set derived yet (F-304), which is a school action,
    // so there is no in-app button to offer.
    root.append(emptyState(this.o.doc, {
      glyph: 'layers',
      message: 'এখনো কোনো বিষয় নির্ধারণ হয়নি। আপনার শ্রেণিশিক্ষকের সাথে কথা বলুন।',
    }));
  }

  private renderError(root: HTMLElement): void {
    // Foundations §04's error copy, and the same retry as before: back to the
    // skeleton, then the same request again.
    root.append(errorState(this.o.doc,
      'বিষয়ের তালিকা আনা গেল না। ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।',
      () => { this.loading = true; this.error = false; this.render(); void this.load(); }));
  }

  private row(s: SubjectRow): HTMLElement {
    const d = this.o.doc;
    // Coerced, because `String(undefined)` is the word "undefined" and these
    // figures are read aloud. A missing count is zero chapters, which is true
    // and sayable; the word "undefined" is neither. §27: no undefined, null
    // or UUID may reach accessible text.
    const total = Number.isFinite(s.totalChapters) ? s.totalChapters : 0;
    const done = Number.isFinite(s.completedChapters) ? s.completedChapters : 0;
    const optional = s.requirementType === 'optional';
    // A real <button> when the row opens something (listItem renders one for
    // onClick): no tabIndex, no role, no hand-rolled Enter/Space.
    // Only a subject that HAS chapters opens (finding 15). The count is of
    // published chapters for the student's class, the same set পড়াশোনা
    // lists, so a ০/০ row led nowhere: পড়াশোনা had nothing to select and
    // showed a different subject. It stays a plain row that says why.
    const openable = Boolean(this.o.onOpenSubject) && total > 0;

    const li = listItem(d, {
      title: s.nameBn,
      // The drawing's second line is the subject teacher, which the subjects
      // API does not return. The chapter count is the quiet fact this row
      // already carried, in the same slot. Bangla numerals; listItem puts the
      // figure in the numeral face (R6). With no chapters, "০/০ অধ্যায়" said
      // nothing a student could act on; the sentence says what is missing.
      subtitle: total > 0 ? `${bn(done)}/${bn(total)} অধ্যায়` : 'এখনো কোনো অধ্যায় যুক্ত হয়নি',
      glyph: optional ? 'star' : 'book-open',
      // The chip only on the optional subject (03 Student §02). It carries the
      // server's words, so the fourth subject is never marked by glyph alone
      // (F-812). badge() sets any figure in it in the numeral face.
      status: optional && s.requirementLabelBn
        ? badge(d, { label: s.requirementLabelBn, tone: 'neutral' })
        : undefined,
      onClick: openable ? () => this.o.onOpenSubject?.(s.subjectId) : undefined,
    });
    li.dataset.requirement = s.requirementType;

    if (openable) {
      // The accessible name says what the row shows and what it does. Bangla
      // numerals in the spoken label too: the visible count uses them, and a
      // screen reader that says the figures in English mid-Bangla is reading
      // a different sentence than the one on screen.
      const label = [
        `${s.nameBn}: ${bn(total)}টির মধ্যে ${bn(done)}টি অধ্যায় শেষ`,
        optional && s.requirementLabelBn ? `, ${s.requirementLabelBn}` : '',
        ' — খুলুন',
      ].join('');
      li.querySelector('button.ui-list-hit')?.setAttribute('aria-label', label);
    }
    return li;
  }
}
