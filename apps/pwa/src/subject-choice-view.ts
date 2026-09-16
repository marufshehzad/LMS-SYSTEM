/**
 * Group & optional-subject selection — F-305 / F-304, wireframe §10.3.
 *
 * The input to the subject-based model. Every other academic screen reads
 * what this one writes: "আমার বিষয়" lists it, the exam-routine clash check
 * (§8.3) only finds anything because two students in one section hold
 * different optional subjects, and the routine's parallel blocks exist to
 * timetable exactly these choices.
 *
 * ── Derived is read-only; only the pools are choices ─────────────────────
 * §10.3: "Compulsory subjects are derived and shown read-only — the
 * coordinator never types them." So the compulsory list here is text, not
 * controls — there is nothing to click, because there is no decision to
 * make. The two genuine decisions are the religion variant and the fourth
 * subject, and each is rendered as the template's own pool, so a coordinator
 * cannot pick something this class does not offer. The server re-checks the
 * same bound; this screen is not the enforcement.
 *
 * ── The warning is the feature ───────────────────────────────────────────
 * §10.3 calls the regeneration warning mandatory, and it is the reason this
 * screen has a confirm step at all. Changing a fourth subject silently
 * re-cuts the student's timetable and invalidates their content assignments.
 * A coordinator who taps a dropdown and walks away has to be told that, in
 * words, before anything is written — so the save is two deliberate steps
 * and the second one restates the consequence.
 *
 * ── Ata Ekta (03 Student §05) ────────────────────────────────────────────
 * Drawn as one phone column: a warn callout on top ("the warning goes first,
 * because this is the part that bites"), plain 13px section labels, the
 * fourth subject as a bordered list of 48px rows with a square marker, the
 * religion as a select, and the save pinned in a bar above the tab bar
 * (13 Responsive, "বুড়ো আঙুলের নাগাল"). The drawing is of a student choosing
 * for themselves; this screen is the coordinator's, so the student picker,
 * the read-only group and the derived compulsories stay — the behaviour did
 * not change, only its presentation.
 */
import type { Auth } from './auth.ts';
import {
  pageHeader, field, listSkeleton, el, button, numText, numClass,
  emptyState, errorState, successNote, permissionState, permissionMessage,
  serverMessage, deniedContact,
} from './ui/index.ts';
import { formatCount } from '../../../packages/ui-core/src/format.ts';

interface Option { subjectId: string; nameBn: string; variant?: string | null }
interface Choice {
  student: {
    id: string; nameBn: string; rollNo: number;
    classBn: string; sectionName: string; groupCode: string;
  };
  hasTemplate: boolean;
  derived: Array<{ subjectId: string; nameBn: string; requirementType: string }>;
  religionOptions: Option[];
  optionalOptions: Option[];
  current: {
    religionVariant: string | null;
    religionSubjectId: string | null;
    optionalSubjectId: string | null;
  };
}

export interface SubjectChoiceViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

const GROUP_BN: Record<string, string> = {
  science: 'বিজ্ঞান', humanities: 'মানবিক', business_studies: 'ব্যবসায় শিক্ষা',
  arts: 'কলা', none: 'সাধারণ',
};

/** What a refusal names (B-30's canonical sentence takes a subject). */
const SUBJECT = 'বিষয় নির্বাচন';
const SAVE_LABEL = 'পরিবর্তন সংরক্ষণ করুন';
/** 00 Foundations §04's error pair, with what could not be fetched in front. */
const LOAD_ERROR = 'বিষয়ের তথ্য আনা গেল না। ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।';

export class SubjectChoiceView {
  private readonly o: SubjectChoiceViewOptions;
  private students: Array<{ studentId: string; rollNo: number; nameBn: string }> = [];
  private studentId: string | null = null;
  private data: Choice | null = null;
  private draftReligion: string | null = null;
  private draftOptional: string | null = null;
  private confirming = false;
  private notice: { text: string; tone: 'warn' | 'ok' } | null = null;
  private loading = true;
  private busy = false;
  /** A fetch that failed — the error state, with a retry. */
  private loadError = false;
  /** A 403 — the denied state, never retried. */
  private denied = false;
  private deniedMsg = '';
  private deniedWho: string | undefined;

  constructor(options: SubjectChoiceViewOptions) {
    this.o = options;
    void this.init();
  }

  private async init(): Promise<void> {
    this.loading = true;
    this.loadError = false;
    this.denied = false;
    this.render();
    // The roster this screen works through is the one the coordinator was
    // last looking at, same as marks entry — "pick your section first".
    const sectionId = localStorage.getItem('shikhon_last_section');
    if (sectionId) {
      try {
        const res = await this.o.auth.authedFetch(
          `/api/v1/academics/roster?sectionId=${encodeURIComponent(sectionId)}`);
        if (res.status === 403) {
          await this.refuse(res);
        } else if (res.ok) {
          const body = (await res.json()) as {
            roster: Array<{ studentId: string; rollNo: number; fullName: { bn?: string; en?: string } }>;
          };
          this.students = body.roster.map((r) => ({
            studentId: r.studentId, rollNo: r.rollNo,
            nameBn: r.fullName.bn ?? r.fullName.en ?? `রোল ${r.rollNo}`,
          }));
          if (this.students[0]) this.studentId = this.students[0].studentId;
        } else if (res.status !== 404) {
          // A section that no longer exists is "choose a section" (the empty
          // state below); anything else is a fetch that failed, and saying
          // "choose a section first" for it would send the coordinator off
          // to fix something that is not broken.
          this.loadError = true;
        }
      } catch {
        this.loadError = true;
      }
    }
    if (this.studentId && !this.denied && !this.loadError) await this.loadChoice(this.studentId);
    else { this.loading = false; this.render(); }
  }

  /**
   * A refusal is not a failed fetch: retrying it is futile, and the person
   * needs to know who can help — or, for a school without the module, that
   * nobody at the school can. Same reading as the class-performance screen.
   */
  private async refuse(res: Response): Promise<void> {
    const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    this.deniedMsg = serverMessage(b, 403, permissionMessage(SUBJECT), SUBJECT);
    this.deniedWho = deniedContact({ code: b.error });
    this.denied = true;
  }

  private async loadChoice(studentId: string): Promise<void> {
    this.loading = true;
    this.confirming = false;
    this.notice = null;
    this.loadError = false;
    this.denied = false;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/subjectchoice?studentId=${encodeURIComponent(studentId)}`);
      if (res.status === 403) {
        this.data = null;
        await this.refuse(res);
      } else {
        if (!res.ok) throw new Error(String(res.status));
        this.data = (await res.json()) as Choice;
        this.draftReligion = this.data.current.religionVariant;
        this.draftOptional = this.data.current.optionalSubjectId;
      }
    } catch {
      this.data = null;
      this.loadError = true;
    }
    this.loading = false;
    this.render();
  }

  /** Nothing to confirm if nothing moved. */
  private get dirty(): boolean {
    if (!this.data) return false;
    return this.draftReligion !== this.data.current.religionVariant
        || this.draftOptional !== this.data.current.optionalSubjectId;
  }

  private async save(): Promise<void> {
    if (!this.data || this.busy) return;
    this.busy = true; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/subjectchoice', {
        method: 'POST',
        body: JSON.stringify({
          studentId: this.data.student.id,
          religionVariant: this.draftReligion,
          optionalSubjectId: this.draftOptional,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as
        { ok?: boolean; message?: string; subjectCount?: number };
      if (res.ok && body.ok) {
        this.busy = false;
        await this.loadChoice(this.data.student.id);
        this.notice = {
          text: `সংরক্ষিত — এখন ${formatCount(body.subjectCount ?? 0, 'bn')}টি বিষয়। `
              + 'রুটিন ও পাঠ বরাদ্দ নতুন করে তৈরি করতে হবে।',
          tone: 'ok',
        };
        this.render();
        return;
      }
      this.notice = { text: body.message ?? 'সংরক্ষণ করা যায়নি।', tone: 'warn' };
    } catch {
      this.notice = { text: 'সংযোগ নেই — পরিবর্তন সংরক্ষণ হয়নি।', tone: 'warn' };
    }
    this.busy = false; this.confirming = false;
    this.render();
  }

  /* ------------------------------------------------------------- render */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', 'bn');

    // pageHeader sets the roll number in the subtitle in the numeral face.
    root.append(pageHeader(d, {
      title: 'বিভাগ ও বিষয় নির্বাচন',
      subtitle: this.data
        ? `${this.data.student.classBn}-${this.data.student.sectionName} · `
          + `রোল ${formatCount(this.data.student.rollNo, 'bn')}`
        : 'ধর্ম শিক্ষা ও চতুর্থ বিষয় নির্ধারণ',
    }));

    if (this.denied) {
      // The whole answer: no picker, no retry, nothing under it that would
      // read as "there is nothing here".
      root.append(permissionState(d, { message: this.deniedMsg, contact: this.deniedWho }));
      return;
    }

    // One column, drawn at phone width; on a desk it keeps that measure
    // rather than stretching a three-row list across 1200px.
    const body = el(d, 'div', { className: 'choice-body' });
    root.append(body);

    if (this.students.length > 0) body.append(this.studentPicker());

    if (this.notice) body.append(this.noticeEl(this.notice));

    if (this.loading) { body.append(listSkeleton(d, 4)); return; }
    if (this.loadError) {
      body.append(errorState(d, LOAD_ERROR, () => {
        if (this.studentId) void this.loadChoice(this.studentId);
        else void this.init();
      }));
      return;
    }
    if (!this.data) {
      if (this.students.length === 0) {
        body.append(emptyState(d, {
          glyph: 'users',
          message: 'আগে শিক্ষার্থী তালিকা থেকে একটি সেকশন নির্বাচন করুন — '
            + 'তারপর সেই শাখার শিক্ষার্থীদের বিষয় নির্ধারণ করা যাবে।',
          action: { label: 'শিক্ষার্থী তালিকা', onClick: () => { location.hash = '/roster'; } },
        }));
      }
      return;
    }
    if (!this.data.hasTemplate) {
      body.append(emptyState(d, {
        glyph: 'layers',
        message: 'এই শ্রেণির জন্য বিষয়-টেমপ্লেট তৈরি হয়নি। আগে টেমপ্লেট তৈরি করুন।',
      }));
      return;
    }

    // 03 Student §05 order: the warning first, then বিভাগ, the fourth
    // subject, the religion, and the bar. The compulsories are not drawn;
    // they sit under the group, which is where they come from.
    body.append(this.callout(), this.groupBlock(), this.derivedBlock());
    if (this.data.optionalOptions.length > 0) body.append(this.optionalBlock());
    if (this.data.religionOptions.length > 0) body.append(this.religionBlock());
    body.append(this.footer());
  }

  /**
   * A labelled control. It had an `aria-label` only — so a coordinator
   * working down a class of forty saw a bare dropdown and had to open it
   * to learn what it chose.
   */
  private studentPicker(): HTMLElement {
    const d = this.o.doc;
    const pick = field(d, {
      label: 'শিক্ষার্থী',
      name: 'student',
      kind: 'select',
      value: this.studentId ?? '',
      // Roll first: it is the order the register is in and the order a
      // coordinator works down.
      options: this.students.map((st) => ({
        value: st.studentId,
        label: `${formatCount(st.rollNo, 'bn')} · ${st.nameBn}`,
      })),
      onChange: (v) => { this.studentId = v; void this.loadChoice(v); },
    });
    // R6. An option cannot hold a span, so only a wholly numeric label takes
    // the numeral face; "১ · আরিফুল ইসলাম" keeps the text face for the name.
    for (const opt of Array.from(pick.root.querySelectorAll('option'))) {
      const cls = numClass('', opt.textContent ?? '');
      if (cls) opt.className = cls;
    }
    return pick.root;
  }

  /**
   * The result of a save. Success is the shared confirmation strip; a
   * failure is the same callout shape as the warning, in the danger tone.
   * Both stay `role="status"`, as the inline notice was.
   */
  private noticeEl(notice: { text: string; tone: 'warn' | 'ok' }): HTMLElement {
    const d = this.o.doc;
    if (notice.tone === 'ok') {
      const ok = successNote(d, notice.text);
      ok.setAttribute('role', 'status');
      return ok;
    }
    return el(d, 'p', {
      className: 'choice-callout', data: { tone: 'danger' }, attrs: { role: 'status' },
    }, ...numText(d, notice.text));
  }

  /**
   * The drawn warning, at the top. Its copy is the consequence this screen
   * really has — the drawing's deadline and head-teacher lock are not in the
   * data or the behaviour. Not `.choice-warning` and not an alert: that one
   * is the confirm step's, and it must appear only when a save is asked for.
   */
  private callout(): HTMLElement {
    return el(this.o.doc, 'p', { className: 'choice-callout', data: { tone: 'warn' } },
      'ধর্ম শিক্ষা বা চতুর্থ বিষয় বদলালে এই শিক্ষার্থীর রুটিন ও পাঠ বরাদ্দ '
      + 'নতুন করে তৈরি করতে হবে।');
  }

  /** The group is reported, not offered — see the endpoint's header. */
  private groupBlock(): HTMLElement {
    const d = this.o.doc;
    const code = this.data!.student.groupCode;
    return el(d, 'section', { className: 'choice-section choice-group' },
      el(d, 'h2', { className: 'choice-label', text: 'বিভাগ' }),
      // One inline wrapper, so the flex row has one item: numText splits a
      // name with a digit into text and `.n` spans, and as separate flex
      // items their edge spaces collapse ("বাংলা ১ম" became "বাংলা১").
      el(d, 'p', { className: 'choice-panel choice-group-value' },
        el(d, 'span', { className: 'choice-panel-text' },
          ...numText(d, GROUP_BN[code] ?? code))),
      // Honest about where the control actually lives, rather than showing a
      // dropdown that would quietly mean "re-enrol this child".
      el(d, 'p', {
        className: 'choice-hint',
        text: 'বিভাগ নির্ধারিত হয় শাখা অনুযায়ী। বিভাগ বদলাতে শিক্ষার্থীকে '
          + 'অন্য শাখায় স্থানান্তর করতে হবে।',
      }));
  }

  private derivedBlock(): HTMLElement {
    const d = this.o.doc;
    const derived = this.data!.derived;
    // Text, not controls: there is no decision here, so there is nothing to
    // press. §10.3 — "the coordinator never types them".
    return el(d, 'section', { className: 'choice-section' },
      el(d, 'h2', { className: 'choice-label', text: 'আবশ্যিক বিষয়' }),
      derived.length === 0
        ? el(d, 'p', { className: 'choice-panel choice-derived-empty', text: 'এখনো নির্ধারিত হয়নি।' })
        // The wrapper keeps "বাংলা ১ম পত্র · …" one line of text — see groupBlock.
        : el(d, 'p', { className: 'choice-panel choice-derived' },
            el(d, 'span', { className: 'choice-panel-text' },
              ...numText(d, derived.map((sub) => sub.nameBn).join(' · ')))),
      el(d, 'p', { className: 'choice-hint', text: 'টেমপ্লেট থেকে স্বয়ংক্রিয়ভাবে নির্ধারিত' }));
  }

  /** The fourth subject: the drawn list of rows, each a radio. */
  private optionalBlock(): HTMLElement {
    const d = this.o.doc;
    const group = el(d, 'div', {
      className: 'choice-options',
      // The instruction the old card title carried stays for a reader.
      attrs: { role: 'radiogroup', 'aria-label': 'চতুর্থ বিষয় (একটি বেছে নিন)' },
    });

    for (const opt of this.data!.optionalOptions) {
      const value = opt.subjectId;
      const chosen = this.draftOptional === value;
      const btn = el(d, 'button', {
        className: 'choice-option',
        data: { chosen: String(chosen) },
        attrs: { type: 'button', role: 'radio', 'aria-checked': String(chosen) },
      },
        el(d, 'span', { className: 'choice-mark', attrs: { 'aria-hidden': 'true' } }),
        el(d, 'span', { className: 'choice-option-text' }, ...numText(d, opt.nameBn)));
      btn.disabled = this.busy;
      btn.addEventListener('click', () => {
        // Tapping the chosen one clears it — a fourth subject can be removed,
        // and a control with no way back is a trap.
        this.draftOptional = chosen ? null : value;
        this.confirming = false;
        this.notice = null;
        this.render();
      });
      group.append(btn);
    }

    return el(d, 'section', { className: 'choice-section' },
      el(d, 'h2', { className: 'choice-label', text: 'চতুর্থ বিষয়' }),
      group);
  }

  /**
   * The religion, drawn as a select. The same pool and the same draft as the
   * row list it replaces; the empty option is the way back that tapping the
   * chosen row used to be.
   */
  private religionBlock(): HTMLElement {
    const d = this.o.doc;
    const f = field(d, {
      label: 'ধর্ম শিক্ষা',
      name: 'religion',
      kind: 'select',
      value: this.draftReligion ?? '',
      disabled: this.busy,
      options: [
        { value: '', label: 'নির্বাচন করা হয়নি' },
        ...this.data!.religionOptions.map((opt) => ({ value: opt.variant ?? '', label: opt.nameBn })),
      ],
      onChange: (v) => {
        this.draftReligion = v === '' ? null : v;
        this.confirming = false;
        this.notice = null;
        this.render();
      },
    });
    // The section heading is the visible label (all three are drawn alike);
    // the field keeps its own <label for> for a reader.
    f.root.querySelector('.ui-field-label')?.classList.add('ui-sr-only');
    for (const opt of Array.from(f.root.querySelectorAll('option'))) {
      const cls = numClass('', opt.textContent ?? '');
      if (cls) opt.className = cls;
    }
    return el(d, 'section', { className: 'choice-section choice-religion' },
      el(d, 'h2', { className: 'choice-label', text: 'ধর্ম শিক্ষা' }),
      f.root);
  }

  /** The drawn submit bar, pinned above the tab bar on a phone. */
  private footer(): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div', { className: 'choice-footer' });

    if (!this.dirty) {
      // The bar is always there, as drawn; with nothing changed it says so
      // and its save cannot be pressed.
      wrap.append(
        el(d, 'p', { className: 'choice-note', text: 'কোনো পরিবর্তন করা হয়নি।' }),
        button(d, { label: SAVE_LABEL, variant: 'primary', block: true, disabled: true }));
      return wrap;
    }

    if (!this.confirming) {
      wrap.append(button(d, {
        label: SAVE_LABEL, variant: 'primary', block: true, disabled: this.busy,
        onClick: () => { this.confirming = true; this.render(); },
      }));
      return wrap;
    }

    // §10.3: "The regeneration warning is mandatory." It is shown BEFORE the
    // write, states the two things that go stale, and requires a second
    // deliberate press — the whole reason this screen confirms at all.
    const warn = el(d, 'div', {
      className: 'choice-callout choice-warning', data: { tone: 'warn' }, attrs: { role: 'alert' },
      text: 'এই পরিবর্তনে এই শিক্ষার্থীর বিষয় বরাদ্দ নতুন করে তৈরি হবে, '
        + 'এবং তার রুটিন ও পাঠ বরাদ্দ পুরোনো হয়ে যাবে — নতুন করে তৈরি করতে হবে।',
    });
    const row = el(d, 'div', { className: 'choice-confirm-row' },
      button(d, {
        label: 'নিশ্চিত করুন', variant: 'primary', block: true, busy: this.busy,
        onClick: () => { void this.save(); },
      }),
      button(d, {
        label: 'বাতিল', variant: 'secondary', disabled: this.busy,
        onClick: () => { this.confirming = false; this.render(); },
      }));
    wrap.append(warn, row);
    return wrap;
  }
}
