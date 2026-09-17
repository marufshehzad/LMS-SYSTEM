/**
 * Exam routine with per-student clash check — F-510, wireframe §8.3
 *
 * The spec calls this "the screen that proves the subject-based model".
 * Two legitimate Class 11 Science subjects share a slot; nothing is wrong
 * at class level; four named students cannot be in both rooms. It only
 * becomes visible when the routine is checked against each student's own
 * resolved subject set.
 *
 * Three things that follow from that, and shape this file:
 *
 * The clash panel names students. §8.3 shows roll, name and the two
 * subjects, not a count — "৪ জন" is the headline, the names are the
 * content. A coordinator told "4 clashes" goes hunting; a coordinator told
 * "১০৪ মাহির ফয়সাল — উচ্চতর গণিত + জীববিজ্ঞান" fixes it.
 *
 * BOTH papers of a pair are flagged, not just the later one, because the
 * coordinator has to choose which of the two to move.
 *
 * The publish button is never a lie. It is disabled while clashes stand
 * and says why. If it were somehow pressed anyway the server would refuse
 * — the gate is a database trigger — so this is courtesy, not security.
 *
 * ── Ata Ekta (05 Principal §06) ─────────────────────────────────────────
 * Three flush bands, as drawn: the bar (page header — title left; the state
 * chip, the re-check and the one accent button right), the routine table,
 * and the danger-tint strip under it that says in one sentence WHY the
 * routine clashes. There is no action card any more; its two sentences moved
 * to where they are true — the "blocked" one into the strip, the "published"
 * one into a footnote under the table.
 *
 * Framework-free manual DOM, same as every other view here.
 */
import type { Auth } from './auth.ts';
import { errorState, emptyState } from './view-states.ts';
import {
  formatCount, formatIdentifier, formatDayMonth, formatTime,
} from '../../../packages/ui-core/src/format.ts';
import { pageHeader } from './ui/page-header.ts';
import {
  serverMessage, button, statusBadge, tabs, listSkeleton, permissionState,
  permissionMessage, deniedContact, el, numText, numClass,
} from './ui/index.ts';

const bn = (n: number): string => formatCount(n, 'bn');

/** What a refusal names. "পরীক্ষার রুটিন দেখার অনুমতি আপনার নেই।" */
const SUBJECT = 'পরীক্ষার রুটিন';

export interface ExamSummary {
  id: string;
  nameBn: string;
  examType: string;
  startsOn: string;
  endsOn: string;
  /** The RESULTS lifecycle. This screen displays nothing from it. */
  status: string;
  /** Whether this TIMETABLE has been announced. Migration 068. */
  routinePublished: boolean;
}

export interface PaperRow {
  examSubjectId: string;
  sectionName: string;
  subjectBn: string;
  examDate: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  hasClash: boolean;
}

export interface ClashRow {
  studentNameBn: string;
  rollNo: number;
  sectionName: string;
  examDate: string;
  subjectABn: string;
  subjectBBn: string;
  startA: string;
  startB: string;
}

interface RoutinePayload {
  exam: ExamSummary;
  papers: PaperRow[];
  clashes: ClashRow[];
  affectedStudents: number;
  canPublish: boolean;
}

export interface ExamRoutineViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

const ENDPOINT = '/api/v1/rms/examroutine';

/** The routine table's columns, in drawn order. The status column is last. */
const COLUMNS: ReadonlyArray<readonly [key: string, label: string]> = [
  ['date', 'তারিখ'],
  ['time', 'সময়'],
  ['subject', 'বিষয়'],
  // The drawing says শ্রেণি; the payload carries the SECTION name ("ক"), and
  // calling a section a class would be a false label.
  ['section', 'শাখা'],
];

export class ExamRoutineView {
  private readonly o: ExamRoutineViewOptions;
  private exams: ExamSummary[] = [];
  private selected: string | null = null;
  private data: RoutinePayload | null = null;
  private loading = true;
  private error: string | null = null;
  /**
   * The server refused the read (403). Not an error: retrying a refusal is
   * futile, and the person needs to be told who can help instead.
   */
  private denied = false;
  private deniedMsg = '';
  private deniedWho: string | undefined;
  private busy = false;
  /** The paper whose inline reschedule row is open, if any. */
  private editing: string | null = null;

  constructor(options: ExamRoutineViewOptions) {
    this.o = options;
    this.render();
    void this.loadExams();
  }

  private async loadExams(): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch(ENDPOINT);
      if (res.status === 403) {
        await this.refuse(res);
        this.loading = false;
        this.render();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { exams?: ExamSummary[] };
      this.exams = body.exams ?? [];
      this.selected = this.exams[0]?.id ?? null;
      if (this.selected) { await this.loadRoutine(); return; }
      this.loading = false;
      this.render();
    } catch {
      this.loading = false;
      this.error = 'পরীক্ষার তালিকা লোড হয়নি।';
      this.render();
    }
  }

  private async loadRoutine(): Promise<void> {
    if (!this.selected) return;
    this.loading = true;
    this.error = null;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `${ENDPOINT}?examId=${encodeURIComponent(this.selected)}`);
      if (res.status === 403) { await this.refuse(res); return; }
      if (!res.ok) throw new Error(String(res.status));
      this.data = (await res.json()) as RoutinePayload;
    } catch {
      this.error = 'রুটিন লোড হয়নি।';
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Read a 403 into the permission state. The body is read, not re-fetched:
   * a school without the module gets the server's own sentence and nobody to
   * ring; a role refusal gets the canonical line and the head teacher.
   */
  private async refuse(res: Response): Promise<void> {
    const b = await res.json().catch(() => ({})) as { error?: string; message?: string };
    this.deniedMsg = serverMessage(b, 403, permissionMessage(SUBJECT), SUBJECT);
    this.deniedWho = deniedContact({ code: b.error });
    this.denied = true;
  }

  private async post(body: Record<string, unknown>): Promise<void> {
    if (!this.selected || this.busy) return;
    this.busy = true;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ examId: this.selected, ...body }),
      });
      const payload = (await res.json()) as RoutinePayload & { message?: string };
      if (res.ok) {
        this.data = payload;
        this.editing = null;
        this.error = null;
      } else {
        // The server's refusal is the honest text: it names a student.
        this.error = serverMessage(payload, res.status, 'কাজটি সম্পন্ন হয়নি।');
        await this.loadRoutine();
        return;
      }
    } catch {
      this.error = 'সংযোগ পাওয়া যায়নি। পরে চেষ্টা করুন।';
    } finally {
      this.busy = false;
      this.render();
    }
  }

  // ── rendering ───────────────────────────────────────────────────────
  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', 'bn');

    const exam = this.data?.exam ?? this.exams.find((e) => e.id === this.selected) ?? null;
    // The bar's right cluster speaks about a routine that is on screen. While
    // it loads, fails or is refused there is nothing for a chip to describe
    // and nothing a button could act on.
    const ready = !this.denied && !this.error && !this.loading && exam && this.data
      ? this.data : null;

    root.append(pageHeader(d, {
      title: 'পরীক্ষার রুটিন',
      subtitle: this.loading ? 'লোড হচ্ছে…' : (exam?.nameBn ?? ''),
      ...(ready ? this.headerActions(ready) : {}),
    }));

    if (this.denied) {
      root.append(permissionState(d, { message: this.deniedMsg, contact: this.deniedWho }));
      return;
    }

    if (this.exams.length > 1) root.append(this.selector());

    // An error is the WHOLE answer. This used to render the failure AND then
    // "এই শিক্ষাবর্ষে কোনো পরীক্ষার সময়সূচি তৈরি হয়নি" underneath it — but a
    // failed load does not know whether the school has exams, only that it
    // could not find out. The empty state is a claim about the SCHOOL and is
    // a lie whenever the error is on screen.
    if (this.error) {
      root.append(errorState(d, this.error, () => void this.loadExams()));
      return;
    }

    if (this.loading) { root.append(listSkeleton(d, 4)); return; }
    if (!exam) { root.append(this.empty()); return; }

    if (this.data) root.append(this.routineTable(this.data));
  }

  private selector(): HTMLElement {
    // The P2 strip: one keyboard stop with arrow keys, where the hand-rolled
    // `.seg-bar` gave every exam its own tab stop and no arrow handling.
    return tabs(this.o.doc, {
      label: 'পরীক্ষা নির্বাচন',
      className: 'exam-routine-tabs',
      active: this.selected ?? '',
      items: this.exams.map((e) => ({ id: e.id, label: e.nameBn })),
      onSelect: (id) => {
        if (id === this.selected) return;
        this.selected = id;
        this.data = null;
        this.editing = null;
        void this.loadRoutine();
      },
    });
  }

  /**
   * The bar's right cluster, as drawn: the state chip, then the page's one
   * accent button. The re-check sits between them as a secondary — it is
   * not drawn, but removing it would remove §8.3's [ যাচাই ].
   */
  private headerActions(data: RoutinePayload): { actions: Node[]; primary?: Node } {
    const d = this.o.doc;
    // Migration 068. This read `status === 'published'`, which is the RESULTS
    // lifecycle — so a school whose results were out saw its routine marked
    // "প্রকাশিত" although no timetable had been announced, and vice versa.
    const published = data.exam.routinePublished;
    const blocked = !data.canPublish;
    // The drawn "২ সংঘর্ষ" counts the flagged rows on screen — both papers of
    // a pair, which is exactly what the table below marks.
    const flagged = data.papers.filter((p) => p.hasClash).length;

    const chip = published
      ? statusBadge(d, { state: 'published', label: 'প্রকাশিত' })
      : flagged > 0
        ? statusBadge(d, { state: 'overdue', label: `${bn(flagged)} সংঘর্ষ` })
        : statusBadge(d, { state: 'draft', label: 'খসড়া' });

    // §8.3's [ যাচাই ]. Re-runs the check against the live roster — a
    // student's optional subject can change between one look and the next.
    const check = button(d, {
      label: 'যাচাই', variant: 'secondary', size: 'sm', disabled: this.busy,
      onClick: () => { void this.loadRoutine(); },
    });

    if (published) return { actions: [chip, check] };

    const primary = button(d, {
      label: 'প্রকাশ করুন', variant: 'primary', size: 'sm',
      disabled: this.busy || blocked,
      // Disabled with a stated reason, never disabled and silent.
      attrs: blocked
        ? { title: 'সময় সংঘর্ষ থাকা অবস্থায় রুটিন প্রকাশ করা যাবে না',
            'aria-describedby': 'clash-panel' }
        : {},
      onClick: () => { void this.post({ publish: true }); },
    });
    return { actions: [chip, check], primary };
  }

  private routineTable(data: RoutinePayload): HTMLElement {
    const d = this.o.doc;
    if (data.papers.length === 0) return this.empty(true);
    const published = data.exam.routinePublished;

    const hr = el(d, 'tr');
    for (const [key, label] of COLUMNS) {
      hr.append(el(d, 'th', { text: label, attrs: { scope: 'col' }, data: { col: key } }));
    }
    // Drawn blank: the chip in each row says what it is. The header still
    // names the column for a reader walking the table by cell.
    hr.append(el(d, 'th', { attrs: { scope: 'col' }, data: { col: 'status' } },
      el(d, 'span', { className: 'ui-sr-only', text: 'অবস্থা' })));

    const tbody = el(d, 'tbody');
    for (const p of data.papers) {
      const tr = el(d, 'tr', { className: p.hasClash ? 'is-flagged' : '' });

      const date = p.examDate ? formatDayMonth(p.examDate, 'bn') : '—';
      tr.append(el(d, 'th', { attrs: { scope: 'row' }, data: { col: 'date' } },
        ...numText(d, date)));

      const time = p.startTime && p.endTime
        ? `${formatTime(p.startTime, 'bn')}–${formatTime(p.endTime, 'bn')}`
        : 'সময় নির্ধারিত হয়নি';
      tr.append(el(d, 'td', { className: numClass('', time), text: time, data: { col: 'time' } }));

      tr.append(el(d, 'td', { data: { col: 'subject' } }, ...numText(d, p.subjectBn)));
      tr.append(el(d, 'td', { data: { col: 'section' } }, ...numText(d, p.sectionName)));

      // A word on every chip. Colour alone fails F-812, and a bare tint
      // tells a coordinator nothing about what to do.
      tr.append(el(d, 'td', { data: { col: 'status' } }, p.hasClash
        ? statusBadge(d, { state: 'overdue', label: 'সময় সংঘর্ষ' })
        : statusBadge(d, { state: 'published', label: 'ঠিক আছে' })));

      tbody.append(tr);

      if (p.hasClash && !published) tbody.append(this.rescheduleRow(p));
    }

    const table = el(d, 'table', { className: 'ui-table' },
      el(d, 'caption', { className: 'ui-sr-only' },
        ...numText(d, `${data.exam.nameBn} — পরীক্ষার রুটিন`)),
      el(d, 'thead', {}, hr),
      tbody);

    const wrap = el(d, 'div', { className: 'ui-data exam-routine-table' },
      el(d, 'div', { className: 'ui-table-scroll' }, table));

    if (data.clashes.length > 0) wrap.append(this.clashPanel(data));
    if (published) {
      // Said in words as well as by a chip: a reader must not have to infer
      // that the routine is closed from the buttons that are missing.
      wrap.append(el(d, 'p', {
        className: 'exam-routine-note',
        text: 'প্রকাশিত রুটিন আর পরিবর্তন করা যায় না।',
      }));
    }
    return wrap;
  }

  /** §8.3's [ সময় পরিবর্তন করুন ], inline under the paper it moves. */
  private rescheduleRow(p: PaperRow): HTMLElement {
    const d = this.o.doc;
    const tr = el(d, 'tr', { className: 'row-action' });
    const td = el(d, 'td');
    td.colSpan = COLUMNS.length + 1;
    tr.append(td);

    if (this.editing !== p.examSubjectId) {
      td.append(button(d, {
        label: 'সময় পরিবর্তন করুন', variant: 'secondary', size: 'sm',
        disabled: this.busy,
        onClick: () => { this.editing = p.examSubjectId; this.render(); },
      }));
      return tr;
    }

    const dateIn = el(d, 'input', {
      className: 'ui-input n',
      attrs: { type: 'date', 'aria-label': `${p.subjectBn} — নতুন তারিখ` },
    });
    dateIn.value = p.examDate ?? '';

    const timeIn = el(d, 'input', {
      className: 'ui-input n',
      attrs: { type: 'time', 'aria-label': `${p.subjectBn} — নতুন সময়` },
    });
    timeIn.value = p.startTime ?? '';

    // Secondary, not primary: the page's one accent is প্রকাশ করুন.
    const save = button(d, {
      label: 'সংরক্ষণ', variant: 'secondary', size: 'sm', disabled: this.busy,
      onClick: () => {
        if (!dateIn.value || !timeIn.value) {
          this.error = 'তারিখ ও সময় দুটোই দিতে হবে।';
          this.render();
          return;
        }
        void this.post({
          reschedule: {
            examSubjectId: p.examSubjectId,
            examDate: dateIn.value,
            startTime: timeIn.value.slice(0, 5),
          },
        });
      },
    });

    const cancel = button(d, {
      label: 'বাতিল', variant: 'ghost', size: 'sm',
      onClick: () => { this.editing = null; this.render(); },
    });

    td.append(el(d, 'div', { className: 'inline-form' }, dateIn, timeIn, save, cancel));
    return tr;
  }

  /**
   * The strip under the table. The drawing's rule for it: a clash is not
   * only flagged — WHY it clashes is written underneath in one sentence. The
   * named list keeps §8.3's content (roll, name, the two subjects, when).
   */
  private clashPanel(data: RoutinePayload): HTMLElement {
    const d = this.o.doc;
    const box = el(d, 'section', {
      className: 'clash-panel',
      attrs: { id: 'clash-panel', role: 'group', 'aria-labelledby': 'clash-panel-head' },
    });

    // The headline counts STUDENTS, as §8.3 does. One student sitting three
    // overlapping papers is one child with a problem, not three.
    box.append(el(d, 'h2', { className: 'clash-head', attrs: { id: 'clash-panel-head' } },
      ...numText(d, this.clashSentence(data))));

    if (!data.canPublish) {
      box.append(el(d, 'p', {
        className: 'clash-consequence',
        text: 'সংঘর্ষ থাকা অবস্থায় রুটিন প্রকাশ করা যাবে না।',
      }));
    }

    const ul = el(d, 'ul', { className: 'clash-list' });
    for (const c of data.clashes) {
      // Roll numbers are identifiers, so they stay in Latin digits —
      // the same rule the roster and the mark sheet follow.
      const roll = formatIdentifier(c.rollNo);
      ul.append(el(d, 'li', {},
        el(d, 'span', { className: numClass('clash-roll', roll), text: roll }),
        el(d, 'span', { className: 'clash-name' }, ...numText(d, c.studentNameBn)),
        el(d, 'span', { className: 'clash-subjects' },
          ...numText(d, `${c.subjectABn} + ${c.subjectBBn}`)),
        el(d, 'span', { className: 'clash-when' },
          ...numText(d, `${formatDayMonth(c.examDate, 'bn')} · ${formatTime(c.startA, 'bn')}`)),
      ));
    }
    box.append(ul);
    return box;
  }

  /**
   * The one-sentence why, from what the server sent and nothing more. The
   * date is named when every clash falls on one day; the reason is named
   * when every clash is the same pair of subjects. Otherwise the sentence
   * points at the list, which names each child's pair.
   */
  private clashSentence(data: RoutinePayload): string {
    const first = data.clashes[0];
    const oneDay = data.clashes.every((c) => c.examDate === first.examDate);
    const pairOf = (c: ClashRow): string => [c.subjectABn, c.subjectBBn].sort().join(' + ');
    const onePair = data.clashes.every((c) => pairOf(c) === pairOf(first));

    const when = oneDay ? `${formatDayMonth(first.examDate, 'bn')} তারিখে ` : '';
    const who = data.affectedStudents === 1 ? 'সে' : 'তারা';
    const why = onePair
      ? `${who} ${first.subjectABn} ও ${first.subjectBBn} দুটোই নিয়েছে।`
      : 'কার কোন দুটি বিষয়, নিচে নামসহ দেওয়া আছে।';
    return `${when}${bn(data.affectedStudents)} জন শিক্ষার্থীর একই সময়ে দুটি পরীক্ষা পড়েছে — ${why}`;
  }

  /**
   * Say what is missing, then where to go (00 Foundations §04). An exam that
   * exists but has no papers is a different absence from no exam at all, and
   * saying "no routine this year" over a named exam would be half true.
   */
  private empty(examWithoutPapers = false): HTMLElement {
    const d = this.o.doc;
    return emptyState(d, {
      glyph: 'calendar',
      message: examWithoutPapers
        ? 'এই পরীক্ষার কোনো বিষয়ের সময়সূচি এখনো তৈরি হয়নি।'
        : 'এই শিক্ষাবর্ষে কোনো পরীক্ষার সময়সূচি তৈরি হয়নি।',
      detail: examWithoutPapers
        ? 'পরীক্ষা ব্যবস্থাপনায় এই পরীক্ষার বিষয় যোগ করলে রুটিন এখানে দেখা যাবে।'
        : 'পরীক্ষা ব্যবস্থাপনায় পরীক্ষা তৈরি করলে তার বিষয়ভিত্তিক রুটিন এখানে দেখা যাবে।',
      action: {
        label: 'পরীক্ষা ব্যবস্থাপনায় যান',
        onClick: () => { const w = d.defaultView; if (w) w.location.hash = '#/exams'; },
      },
    });
  }
}
