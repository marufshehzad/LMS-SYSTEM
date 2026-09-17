/**
 * Section picker + student roster.
 *
 * GET /api/v1/academics/sections feeds the picker; GET
 * /api/v1/academics/roster?sectionId=... feeds the list once a section is
 * chosen. Both responses are cached in localStorage (small, synchronous,
 * good enough for read-mostly reference data — unlike attendance writes,
 * which go through the outbox/IndexedDB for durability) so the screen still
 * shows the last-known roster offline, with a banner explaining that.
 *
 * Picking a section also writes shikhon_last_section / shikhon_last_roster
 * — app.ts reads these to seed the attendance screen with the real roster
 * instead of the placeholder students.
 *
 * ── Ata Ekta (02 Teacher §03, "সেকশন রোস্টার") ─────────────────────────────
 * One panel of contiguous bands, as the phone draws it: a control band (the
 * section picker, and the search the drawing leads with), an inset band with
 * the stat strip, then the rows — a round initial, the name over "রোল 01",
 * and the F-202 code button on the right. The search filters the roster that
 * is ALREADY in memory; it sends nothing and fetches nothing.
 */
import type { Auth } from './auth.ts';
import {
  formatCount, formatIdentifier, toLatinDigits,
} from '../../../packages/ui-core/src/format.ts';
import {
  el, append, icon, numText, pageHeader, field, searchField, button, dataTable,
  statRow, statCard, avatar, listSkeleton, emptyState, errorState, permissionState,
  announce, humanError, focusIsLost, type Column,
} from './ui/index.ts';

export interface SectionSummary {
  id: string;
  name: string;
  shift: string;
  studentCount: number;
  className: { bn: string; en: string };
  levelNo: number;
  /**
   * The year this section belongs to. Carried because the attendance screen
   * needs it and previously had a hardcoded placeholder — see
   * `services/academics-svc/api/sections.ts` for what that cost.
   */
  academicYearId: string;
}

export interface RosterStudent {
  rollNo: number;
  studentId: string;
  fullName: { bn: string | null; en: string | null };
  phone: string | null;
}

/**
 * A rejection that still knows its HTTP status.
 *
 * Declared as an explicit field rather than a parameter property: Node runs
 * this repo's TypeScript in strip-only mode, where `constructor(readonly x)`
 * compiles under tsc and throws at runtime. P3 lost an afternoon to that.
 */
class HttpStatus extends Error {
  status: number;
  constructor(status: number) { super(String(status)); this.status = status; }
}

const SECTIONS_CACHE_KEY = 'shikhon_sections_cache';
const LAST_SECTION_KEY = 'shikhon_last_section';
/** The chosen section's full descriptor — class label and academic year. */
export const LAST_SECTION_META_KEY = 'shikhon_last_section_meta';
const LAST_ROSTER_KEY = 'shikhon_last_roster';

function rosterCacheKey(sectionId: string): string {
  return `shikhon_roster_cache_${sectionId}`;
}

/** The name a row is read by. */
function nameOf(s: RosterStudent): string {
  return s.fullName.bn || s.fullName.en || '—';
}

/**
 * A roll number as the row shows it: an identifier, so Latin (R-8,
 * `formatIdentifier`), padded to two the way the register writes it — "01".
 */
function rollLabel(rollNo: number): string {
  return formatIdentifier(String(rollNo).padStart(2, '0'));
}

/**
 * Does this student answer the search? A query of digits (either script) is a
 * roll — "1" finds 1 and 10–19, "01" finds 1 — anything else is part of a
 * name, in either language.
 */
function matches(s: RosterStudent, query: string): boolean {
  const q = toLatinDigits(query).trim().toLowerCase();
  if (!q) return true;
  if (/^\d+$/.test(q)) {
    return Number(q) === s.rollNo || String(s.rollNo).padStart(2, '0').startsWith(q);
  }
  return `${s.fullName.bn ?? ''} ${s.fullName.en ?? ''}`.toLowerCase().includes(q);
}

/** What the panel shows under its control band. */
type Body = 'loading' | 'denied' | 'error' | 'pick' | 'none' | 'list';

/**
 * Which of dataTable's two renderings a control sits in: the list a phone
 * shows, or the table a laptop shows. CSS hides the other one.
 */
type Shape = 'list' | 'table';

function shapeOf(node: Element | null): Shape {
  return node?.closest('.ui-list') ? 'list' : 'table';
}

export interface RosterViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

export class RosterView {
  private readonly o: RosterViewOptions;
  private sections: SectionSummary[] = [];
  /**
   * F-202: the code just issued, shown once, and for whom — and the rendering
   * whose কোড button asked for it, so dismissing the card can go back there.
   */
  private issued: { studentId: string; nameBn: string; code: string; shape: Shape } | null = null;
  private issuing: string | null = null;
  private selectedId: string | null = null;
  private roster: RosterStudent[] = [];
  private offline = false;
  private loading = false;
  private errorMsg = '';
  /**
   * Presentation only — which state component tells the story. None of these
   * changes what is fetched, when, or what is sent.
   *
   * `failed`: the load that produced `errorMsg`, so its error card can offer
   * "আবার চেষ্টা করুন" (an issue-code failure never does). `sectionsDenied` /
   * `rosterDenied`: the last load was refused (403), drawn as the denied state
   * rather than as a red error. `sectionsLoading`: the first sections fetch is
   * still out, so an empty screen is a skeleton, not "pick a section".
   */
  private failed: 'sections' | 'roster' | null = null;
  private sectionsDenied = false;
  private rosterDenied = false;
  private sectionsLoading = true;
  /** The search over the roster already in memory. */
  private query = '';
  private lastAnnounced = -1;
  private bodyHost: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;

  constructor(options: RosterViewOptions) {
    this.o = options;
    void this.init();
  }

  private async init(): Promise<void> {
    const cached = this.readCache<SectionSummary[]>(SECTIONS_CACHE_KEY);
    if (cached) this.sections = cached;

    const lastSectionId = localStorage.getItem(LAST_SECTION_KEY);
    if (lastSectionId) {
      this.selectedId = lastSectionId;
      const cachedRoster = this.readCache<RosterStudent[]>(rosterCacheKey(lastSectionId));
      if (cachedRoster) this.roster = cachedRoster;
    }

    this.render();
    await this.loadSections();
    if (this.selectedId) await this.loadRoster(this.selectedId);
  }

  private readCache<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private writeCache(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full/unavailable — cache is a nicety, not load-bearing
    }
  }

  private async loadSections(): Promise<void> {
    this.sectionsDenied = false;
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/sections');
      // The STATUS travels with the failure. Throwing `new Error(String(status))`
      // and catching it bare is how "you do not have permission" became "could
      // not fetch" on this screen while the attendance screen said it properly.
      if (!res.ok) throw new HttpStatus(res.status);
      const body = (await res.json()) as { sections: SectionSummary[] };
      this.sections = body.sections;
      this.offline = false;
      this.writeCache(SECTIONS_CACHE_KEY, this.sections);
    } catch (err) {
      const status = err instanceof HttpStatus ? err.status : undefined;
      // A 403 is not an offline state and never becomes one on retry: a
      // cached list must not be shown as "last saved" to somebody who may
      // not have it.
      this.offline = status !== 403 && this.sections.length > 0;
      if (status === 403) { this.sections = []; this.roster = []; this.sectionsDenied = true; }
      if (this.sections.length === 0) {
        this.errorMsg = humanError(navigator.onLine ? null : 'offline', status);
        this.failed = 'sections';
      }
    }
    this.sectionsLoading = false;
    this.render();
  }

  private async loadRoster(sectionId: string): Promise<void> {
    this.loading = true;
    this.rosterDenied = false;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/roster?sectionId=${encodeURIComponent(sectionId)}`,
      );
      if (!res.ok) throw new HttpStatus(res.status);
      const body = (await res.json()) as { roster: RosterStudent[] };
      this.roster = body.roster;
      this.offline = false;
      this.writeCache(rosterCacheKey(sectionId), this.roster);
      localStorage.setItem(LAST_SECTION_KEY, sectionId);
      localStorage.setItem(LAST_ROSTER_KEY, JSON.stringify(this.roster));
      // The whole descriptor, so the attendance screen can name the class and
      // the year instead of guessing at both.
      const picked = this.sections.find((x) => x.id === sectionId);
      if (picked) localStorage.setItem(LAST_SECTION_META_KEY, JSON.stringify(picked));
    } catch (err) {
      const status = err instanceof HttpStatus ? err.status : undefined;
      this.offline = status !== 403 && this.roster.length > 0;
      if (status === 403) { this.roster = []; this.rosterDenied = true; }
      if (this.roster.length === 0) {
        this.errorMsg = humanError(navigator.onLine ? null : 'offline', status);
        this.failed = 'roster';
      }
    }
    this.loading = false;
    this.render();
  }

  /**
   * "আবার চেষ্টা করুন" on a failed load (§7). The same two reads the screen
   * makes on mount, in the same order — nothing new is asked for.
   */
  private async retry(): Promise<void> {
    this.errorMsg = '';
    this.failed = null;
    this.sectionsLoading = true;
    this.render();
    await this.loadSections();
    if (this.selectedId) await this.loadRoster(this.selectedId);
  }

  private bodyKind(): Body {
    if (this.loading || (this.sectionsLoading && this.roster.length === 0)) return 'loading';
    if (this.rosterDenied && this.selectedId) return 'denied';
    if (this.errorMsg && this.failed && this.roster.length === 0) return 'error';
    if (!this.selectedId) return 'pick';
    if (this.roster.length === 0) return 'none';
    return 'list';
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    this.bodyHost = null;
    this.searchInput = null;

    const picked = this.sections.find((x) => x.id === this.selectedId);
    append(root, pageHeader(d, {
      title: 'শিক্ষার্থী তালিকা',
      subtitle: picked
        ? `${picked.className.bn} — ${picked.name} শাখার ভর্তি হওয়া শিক্ষার্থীরা।`
        : 'সেকশন বেছে নিলে সেই শাখার শিক্ষার্থীদের তালিকা দেখা যাবে।',
    }));

    // Refused the sections themselves: nothing on this screen is theirs, so
    // the denied state is the whole screen — never a red line, never blank.
    if (this.sectionsDenied) {
      append(root, permissionState(d, { contact: 'প্রধান শিক্ষক' }));
      return;
    }

    const body = this.bodyKind();

    // Rendered wherever it is set, not only on an empty screen: an
    // issue-code failure happens WITH a roster on screen, and an error only
    // visible on an empty page is an error nobody sees. A load failure with
    // nothing to show is drawn inside the panel instead, where the list would
    // be; a refusal is drawn there as the denied state.
    if (this.errorMsg && body !== 'error' && body !== 'denied') {
      const err = errorState(d, this.errorMsg,
        this.failed ? () => { void this.retry(); } : undefined);
      err.classList.add('roster-note');
      append(root, err);
    }

    if (this.issued) append(root, this.issuedCard());

    const panel = el(d, 'div', { className: 'card roster-panel' });
    append(root, panel);

    // Offline is a statement about the data on screen, not a failure: the
    // cached roster is exactly as usable as a fresh one for taking a register.
    if (this.offline) {
      append(panel, el(d, 'p', { className: 'offline-banner', attrs: { role: 'status' } },
        icon(d, 'wifi-off', 'offline-icon'),
        el(d, 'span', {
          text: 'অফলাইন — সর্বশেষ সংরক্ষিত তালিকা দেখানো হচ্ছে। সংযোগ পেলে নিজেই হালনাগাদ হবে।',
        })));
    }

    if (this.sections.length > 0 || body === 'list') {
      append(panel, el(d, 'div', { className: 'roster-bar' },
        this.sections.length > 0 ? this.sectionPicker() : null,
        body === 'list' ? this.searchBox() : null));
    }

    if (body === 'list') {
      append(panel, el(d, 'div', { className: 'roster-summary' },
        statRow(d, statCard(d, {
          label: 'মোট', value: formatCount(this.roster.length, 'bn'),
        }))));
    }

    const host = el(d, 'div', { className: 'roster-body' });
    append(panel, host);

    switch (body) {
      case 'loading':
        append(host, listSkeleton(d, 6));
        return;
      case 'denied':
        append(host, permissionState(d, { contact: 'প্রধান শিক্ষক' }));
        return;
      case 'error':
        append(host, errorState(d, this.errorMsg, () => { void this.retry(); }));
        return;
      case 'pick':
        append(host, emptyState(d, {
          glyph: 'users',
          message: 'উপরে একটি সেকশন বেছে নিন — তারপর সেই শাখার শিক্ষার্থীদের তালিকা দেখা যাবে।',
        }));
        return;
      case 'none':
        append(host, emptyState(d, {
          glyph: 'users',
          message: picked
            ? `${picked.className.bn} — ${picked.name} শাখায় এখনো কোনো শিক্ষার্থী ভর্তি হয়নি।`
            : 'এই শাখায় এখনো কোনো শিক্ষার্থী ভর্তি হয়নি।',
          detail: 'অন্য শাখার তালিকা দেখতে উপরে সেকশন বদলান।',
        }));
        return;
      case 'list':
        this.bodyHost = host;
        this.fillList();
        return;
    }
  }

  /**
   * The rows, filtered by the search. Rebuilt on its own — not through
   * `render()` — so typing in the search box never loses focus.
   */
  private fillList(): void {
    const host = this.bodyHost;
    if (!host) return;
    const d = this.o.doc;
    host.textContent = '';

    const rows = this.query
      ? this.roster.filter((s) => matches(s, this.query))
      : this.roster;

    if (rows.length === 0) {
      append(host, emptyState(d, {
        glyph: 'search',
        message: `“${this.query}” নামে বা রোলে কোনো শিক্ষার্থী নেই।`,
        detail: 'বানান বা রোল দেখে আবার খুঁজুন।',
        action: { label: 'খোঁজা মুছুন', onClick: () => { this.clearSearch(); } },
      }));
      return;
    }

    const picked = this.sections.find((x) => x.id === this.selectedId);
    // One declaration, two renderings: a table on a laptop, a list of cards on
    // a phone. §7 — a six-column table squeezed into 360px is where a teacher
    // reads a student's name two characters at a time.
    append(host, dataTable(d, {
      columns: this.columns(),
      rows,
      rowKey: (r) => r.studentId,
      caption: picked
        ? `${picked.className.bn} — ${picked.name} শাখার শিক্ষার্থী তালিকা`
        : 'শিক্ষার্থী তালিকা',
      className: 'roster-data',
    }));
  }

  private columns(): Array<Column<RosterStudent>> {
    const d = this.o.doc;
    return [
      {
        key: 'roll', header: 'রোল', numeric: true, width: '88px', mobile: 'meta',
        // The phone's meta line reads "রোল 01", as drawn. The word is
        // aria-hidden: the list already announces the column header before
        // the value, and the table's own header says রোল (CSS hides the word
        // there).
        cell: (r) => el(d, 'span', { className: 'roster-roll' },
          el(d, 'span', {
            className: 'roster-roll-word', text: 'রোল ', attrs: { 'aria-hidden': 'true' },
          }),
          el(d, 'span', { className: 'n', text: rollLabel(r.rollNo) })),
      },
      {
        key: 'name', header: 'নাম', mobile: 'title',
        // A fresh fragment per call: dataTable asks once for each rendering.
        cell: (r) => {
          const name = nameOf(r);
          const f = d.createDocumentFragment();
          f.append(
            avatar(d, { name, size: 'sm' }),
            el(d, 'span', { className: 'roster-student-name', text: name }));
          return f;
        },
      },
      {
        key: 'phone', header: 'অভিভাবকের ফোন', mobile: 'meta',
        // LTR: a Bangladeshi number inside a Bangla run renders its digits in
        // the wrong order often enough to matter.
        cell: (r) => r.phone
          ? el(d, 'span', { className: 'n', text: r.phone, attrs: { dir: 'ltr' } })
          : el(d, 'span', { className: 'roster-nophone', text: 'নেই' }),
      },
      {
        key: 'code', header: 'সক্রিয়ন কোড', mobile: 'status',
        cell: (r) => button(d, {
          label: this.issuing === r.studentId ? 'তৈরি হচ্ছে…' : 'কোড',
          variant: 'secondary', size: 'sm',
          // Kept as a placement hook: `activation-ui.test.ts` selects it, and
          // F-202's "every issue button waits" property is asserted through
          // it. `className` exists for exactly this — placement, not restyling.
          className: 'roster-issue',
          disabled: this.issuing !== null,
          busy: this.issuing === r.studentId,
          // F-202. The teacher-mediated activation lives where the teacher
          // already is — beside the child's name. WHO may issue for WHOM is
          // the server's RLS policy; this button only asks.
          ariaLabel: `${r.fullName.bn ?? ''} এর জন্য সক্রিয়ন কোড তৈরি করুন`,
          onClick: (e) => { void this.issueCode(r, shapeOf(e.currentTarget as Element | null)); },
        }),
      },
    ];
  }

  private sectionPicker(): HTMLElement {
    const f = field(this.o.doc, {
      label: 'সেকশন',
      name: 'section',
      kind: 'select',
      value: this.selectedId ?? '',
      options: [
        { value: '', label: 'সেকশন নির্বাচন করুন' },
        ...this.sections.map((x) => ({
          value: x.id, label: `${x.className.bn} — ${x.name}`,
        })),
      ],
      onChange: (v) => {
        this.selectedId = v || null;
        this.roster = [];
        // A new list is a new search.
        this.query = '';
        this.lastAnnounced = -1;
        if (this.selectedId) void this.loadRoster(this.selectedId);
        else this.render();
      },
      className: 'roster-picker',
    });
    // The drawn band has no visible label; the select still has its <label
    // for>, only moved out of sight, and it shows its own value.
    f.root.querySelector('.ui-field-label')?.classList.add('ui-sr-only');
    return f.root;
  }

  private searchBox(): HTMLElement {
    const s = searchField(this.o.doc, {
      label: 'শিক্ষার্থী খুঁজুন',
      placeholder: 'নাম বা রোল দিয়ে খুঁজুন',
      value: this.query || undefined,
      onSearch: (q) => { this.setQuery(q); },
    });
    // Filtering what is already on this device costs nothing, so it follows
    // the typing; the field's own submit and clear still work.
    s.input.addEventListener('input', () => { this.setQuery(s.input.value); });
    this.searchInput = s.input;
    return s.root;
  }

  private setQuery(value: string): void {
    const next = value.trim();
    if (next === this.query) return;
    this.query = next;
    this.fillList();
    if (!next) { this.lastAnnounced = -1; return; }
    const found = this.roster.filter((s) => matches(s, next)).length;
    if (found !== this.lastAnnounced) {
      this.lastAnnounced = found;
      // Sighted users see the rows narrow; this says so to everyone else.
      announce(this.o.doc, `${formatCount(found, 'bn')} জন শিক্ষার্থী পাওয়া গেছে`);
    }
  }

  private clearSearch(): void {
    const input = this.searchInput;
    if (!input) { this.setQuery(''); return; }
    input.value = '';
    // Through the input's own event, so the field hides its clear button too.
    const Ev = this.o.doc.defaultView?.Event;
    if (Ev) input.dispatchEvent(new Ev('input', { bubbles: true }));
    else this.setQuery('');
    input.focus();
  }

  /**
   * F-202: ask for a code for one student.
   *
   * Focus (UX sweep 8): the press rebuilds the screen twice — busy, then the
   * answer — and the button that had focus is gone both times. Left to the
   * shell's keeper, focus went to "the same button", of which dataTable draws
   * two (the phone's list and the laptop's table, one hidden by CSS); with the
   * new card above the panel the two tie, the hidden table copy wins, cannot
   * take focus, and at 375 focus was parked on main with no ring. So the view
   * says where it goes: onto the card holding the new code (which scrolls it
   * into view — at 375 it appears above the list, out of sight of row ২০), or
   * back onto the row's VISIBLE কোড button when no code came. Only when focus
   * was still lost when the answer came: somebody who moved on meanwhile
   * keeps their place.
   */
  private async issueCode(s: RosterStudent, shape: Shape): Promise<void> {
    if (this.issuing) return;
    this.issuing = s.studentId;
    this.errorMsg = '';
    this.failed = null;
    this.render();
    let made = false;
    try {
      const res = await this.o.auth.authedFetch('/api/v1/auth/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'issue', userId: s.studentId }),
      });
      const body = (await res.json()) as { code?: string; error?: string; message?: string };
      if (!res.ok || !body.code) {
        this.errorMsg = body.error === 'not_your_student'
          ? 'শুধু নিজের শাখার শিক্ষার্থীর জন্য কোড তৈরি করা যায়।'
          : body.error === 'activation_unconfigured'
            ? 'এই সুবিধাটি এখনো চালু হয়নি।'
            : 'কোড তৈরি করা যায়নি। আবার চেষ্টা করুন।';
      } else {
        this.issued = {
          studentId: s.studentId,
          nameBn: s.fullName.bn || s.fullName.en || '—',
          code: body.code,
          shape,
        };
        made = true;
      }
    } catch {
      this.errorMsg = 'সংযোগ পাওয়া যায়নি।';
    } finally {
      this.issuing = null;
      // Asked BEFORE the redraw, which takes focus from whatever in the view
      // had it: lost now means lost since the busy render took the button.
      const lost = focusIsLost(this.o.doc);
      this.render();
      if (lost) {
        if (made) this.o.root.querySelector<HTMLElement>('.issued-code-card')?.focus();
        else this.focusRowCode(s.studentId, shape);
      }
      // Once, when the code is made — not on every later redraw that still
      // shows the card (a section change redraws twice).
      if (made && this.issued) {
        announce(this.o.doc, `${this.issued.nameBn} এর সক্রিয়ন কোড তৈরি হয়েছে`);
      }
    }
  }

  /**
   * Focus a row's কোড button: the copy that is on screen. dataTable draws
   * every row twice and CSS hides one rendering; a hidden button cannot take
   * focus. jsdom and a detached layout report no boxes for either, so the
   * rendering that was pressed stands in. A row no longer on screen (the
   * search now hides it) sends focus to the section picker, the panel's first
   * control, rather than leaving it parked on the page.
   */
  private focusRowCode(studentId: string, shape: Shape): void {
    const root = this.o.root;
    const copies = [...root.querySelectorAll<HTMLButtonElement>('.roster-issue')]
      .filter((b) => b.closest<HTMLElement>('[data-key]')?.dataset.key === studentId);
    const target = copies.find((b) => b.getClientRects().length > 0)
      ?? copies.find((b) => shapeOf(b) === shape)
      ?? root.querySelector<HTMLElement>('select[name="section"]');
    target?.focus();
  }

  /** "বুঝেছি": the code goes away, and focus goes back to the row it was for. */
  private dismissIssued(card: HTMLElement): void {
    const d = this.o.doc;
    const issued = this.issued;
    // Focus in the card (this button, or the card itself) or nowhere follows
    // the row; focus somewhere else is left where it is.
    const here = focusIsLost(d) || card.contains(d.activeElement);
    this.issued = null;
    this.render();
    if (here && issued) this.focusRowCode(issued.studentId, issued.shape);
  }

  /**
   * The one and only place the code is ever visible. Large enough to be
   * read across a desk, dismissed deliberately, and honest about the two
   * facts that matter: it dies in ৭২ hours, and issuing again kills it.
   *
   * Focus lands here when the code is made (see issueCode), so the card is a
   * script-only focus target (tabindex -1, never a Tab stop) with a name and a
   * description: arriving on it, a screen reader says whose code it is, the
   * code, and the two facts. Stable ids: there is one card at a time, and the
   * shell's keeper can find it again by id if the screen redraws under it.
   */
  private issuedCard(): HTMLElement {
    const d = this.o.doc;
    const issued = this.issued as NonNullable<typeof this.issued>;
    const wrap = el(d, 'section', {
      className: 'card issued-code-card roster-code',
      attrs: {
        id: 'roster-issued-code',
        role: 'status',
        tabindex: '-1',
        'aria-labelledby': 'roster-issued-code-who',
        'aria-describedby': 'roster-issued-code-value roster-issued-code-note',
      },
    });
    append(wrap,
      el(d, 'p', { className: 'issued-code-who', attrs: { id: 'roster-issued-code-who' } },
        ...numText(d, `${issued.nameBn} এর সক্রিয়ন কোড`)),
      // Split for reading aloud across a desk; the server strips separators
      // on redeem. `dir=ltr` because the code is Latin and must not reorder.
      // `n`: a code is a figure to copy, set in the number face like one.
      el(d, 'p', {
        className: 'issued-code-value n', attrs: { dir: 'ltr', id: 'roster-issued-code-value' },
        text: `${issued.code.slice(0, 4)}-${issued.code.slice(4)}`,
      }),
      el(d, 'p', { className: 'issued-code-note', attrs: { id: 'roster-issued-code-note' } },
        ...numText(d, 'কোডটি লিখে শিক্ষার্থীকে দিন — এটি আর দেখা যাবে না। '
          + 'মেয়াদ ৭২ ঘণ্টা; নতুন কোড তৈরি করলে এটি বাতিল হয়ে যাবে।')),
      button(d, {
        label: 'বুঝেছি', variant: 'primary',
        onClick: () => { this.dismissIssued(wrap); },
      }));
    return wrap;
  }
}
