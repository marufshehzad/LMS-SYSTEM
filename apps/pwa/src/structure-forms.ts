/**
 * Creating a year, a class and a section  (R-3 completion pass, Parts 1–2)
 *
 * The gap R-3's own report named first. A school could assign teachers to
 * sections and move students between them, and could not CREATE a section:
 * opening a seventh section mid-year meant the pilot runbook and a psql
 * prompt. These are the forms that close it.
 *
 * Rendered INSIDE the academic drill-down rather than as their own routes,
 * for the reason the drill-down itself is one screen: you create a section
 * while looking at the class that needs one, and a separate route would mean
 * re-choosing Class 9 → Science to add its seventh section.
 *
 * ── What the schema has, and what the brief assumed ────────────────────
 * The brief asks for an academic year and an active/inactive flag on the
 * CLASS form. `classes` carries neither — it is UNIQUE (tenant, level_no,
 * stream, "group") and the year lives on the section. That is right: a class
 * is a rung on a ladder ("নবম শ্রেণি, বিজ্ঞান") and a school does not create
 * Class 9 again every January, it creates this year's sections of it.
 *
 * So the year is on the SECTION form, where the column exists, and the class
 * form does not draw a checkbox for a column that is not there. A disabled
 * field for a value nothing stores is worse than its absence: it tells the
 * office they set something.
 *
 * ── The look (Ata Ekta, 14 Components §09) ─────────────────────────────
 * One column on the card: the title, the fields label-over-control, then the
 * validation panel, then two small buttons side by side — বাতিল, and the
 * primary last. The same shape at both widths; the year and class forms are
 * the section form's structure with their own fields.
 *
 * The message sits AFTER the fields, directly above the buttons, because that
 * is where the eye is when "তৈরি করুন" did nothing. It keeps role=alert, so
 * where it sits on screen changes nothing a screen reader hears.
 */
import { emptyState, successNote, bnNum } from './view-states.ts';
import { levelNameBn, formatAcademicYear } from '../../../packages/ui-core/src/format.ts';
import {
  append, clear, icon, numText, hasDigit, button, buttonRow,
} from './ui/index.ts';

export interface StructureOptions {
  defaultStream: string;
  years: { id: string; label: string; isCurrent: boolean }[];
  classes: { id: string; levelNo: number; nameBn: string; group: string }[];
  streams: string[];
  groups: string[];
  shifts: string[];
}

export type StructureKind = 'year' | 'class' | 'section';

export interface StructureFormOptions {
  doc: Document;
  kind: StructureKind;
  options: StructureOptions;
  /** Pre-selects the class when the form is opened from inside one. */
  presetClassId?: string;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onCancel: () => void;
}

export const GROUP_BN: Record<string, string> = {
  none: 'সাধারণ',
  science: 'বিজ্ঞান',
  humanities: 'মানবিক',
  business_studies: 'ব্যবসায় শিক্ষা',
  vocational: 'ভোকেশনাল',
  general: 'সাধারণ',
};

const STREAM_BN: Record<string, string> = {
  bangla_medium: 'বাংলা মাধ্যম',
  english_version: 'ইংরেজি ভার্সন',
  english_medium: 'ইংরেজি মাধ্যম',
  madrasah: 'মাদ্রাসা',
  technical: 'কারিগরি',
};

const SHIFT_BN: Record<string, string> = {
  morning: 'সকাল', day: 'দিবা', evening: 'সন্ধ্যা', single: 'একক',
};

export function structureForm(o: StructureFormOptions): HTMLElement {
  const d = o.doc;
  const form = d.createElement('form');
  // No inline side margin: the form lines up with the page header and the
  // tree below it, as drawn. Its spacing lives in app.css.
  form.className = 'card card-form structure-form';

  const title = d.createElement('p');
  title.className = 'notice-confirm-label';
  title.textContent = o.kind === 'year' ? 'নতুন শিক্ষাবর্ষ'
    : o.kind === 'class' ? 'নতুন শ্রেণি'
    : 'নতুন সেকশন';
  form.append(title);

  // Built here, appended just above the buttons (see the header note).
  const err = d.createElement('p');
  err.className = 'structure-form-error';
  err.setAttribute('role', 'alert');
  err.hidden = true;

  const field = (labelBn: string, control: HTMLElement): void => {
    const l = d.createElement('label');
    l.className = 'field';
    l.textContent = labelBn;
    if (control.tagName === 'SELECT') {
      // The drawn chevron. The wrapper sits INSIDE the label, so the label
      // still names the select and its text is still the label's first child;
      // the glyph is aria-hidden and lets the pointer through, so a tap on it
      // opens the select like a tap anywhere else on the control.
      const wrap = d.createElement('span');
      wrap.className = 'structure-select';
      wrap.append(control, icon(d, 'chevron-down', 'structure-select-glyph'));
      l.append(wrap);
    } else {
      l.append(control);
    }
    form.append(l);
  };

  const input = (type: string, value = ''): HTMLInputElement => {
    const i = d.createElement('input');
    i.type = type;
    i.className = 'field-input';
    i.value = value;
    return i;
  };

  const select = (items: { value: string; label: string; selected?: boolean }[]): HTMLSelectElement => {
    const s = d.createElement('select');
    s.className = 'field-input';
    for (const it of items) {
      const opt = d.createElement('option');
      opt.value = it.value;
      opt.textContent = it.label;
      if (it.selected) opt.selected = true;
      s.append(opt);
    }
    // R6. An <option> cannot hold a span, so the control carries the numeral
    // face when any of its choices has a figure in it ("২০২৬ (চলতি)",
    // "৯ — নবম শ্রেণি").
    if (items.some((it) => hasDigit(it.label))) s.classList.add('n');
    return s;
  };

  let collect: () => Record<string, unknown> | null;

  if (o.kind === 'year') {
    const label = input('text');
    label.placeholder = '২০২৭';
    const startsOn = input('date');
    const endsOn = input('date');
    // The year's name and both dates are figures (R6).
    for (const figure of [label, startsOn, endsOn]) figure.classList.add('n');
    const current = d.createElement('input');
    current.type = 'checkbox';
    current.checked = o.options.years.length === 0;

    field('শিক্ষাবর্ষের নাম', label);
    field('শুরু', startsOn);
    field('শেষ', endsOn);
    // The whole row is the tap target, the box beside the words (app.css).
    const cl = d.createElement('label');
    cl.className = 'structure-form-check';
    cl.append(current, d.createTextNode('চলতি শিক্ষাবর্ষ হিসেবে নির্ধারণ করুন'));
    form.append(cl);

    const note = d.createElement('p');
    note.className = 'structure-form-note';
    note.textContent = 'চলতি বছর একটিই থাকে — নতুনটি চলতি করলে আগেরটি স্বয়ংক্রিয়ভাবে সরে যাবে।';
    form.append(note);

    collect = () => {
      if (!label.value.trim()) { show('শিক্ষাবর্ষের নাম লিখুন'); return null; }
      if (!startsOn.value || !endsOn.value) { show('শুরু ও শেষের তারিখ দিন'); return null; }
      if (endsOn.value <= startsOn.value) { show('শেষের তারিখ শুরুর পরে হতে হবে'); return null; }
      return {
        kind: 'year', label: label.value.trim(),
        startsOn: startsOn.value, endsOn: endsOn.value, isCurrent: current.checked,
      };
    };
  } else if (o.kind === 'class') {
    const level = select(
      Array.from({ length: 12 }, (_, i) => ({
        value: String(i + 1),
        label: `${bnNum(i + 1)} — ${levelNameBn(i + 1)} শ্রেণি`,
        selected: i + 1 === 9,
      })));
    const nameBn = input('text', 'নবম শ্রেণি');
    const nameEn = input('text');
    nameEn.placeholder = 'ঐচ্ছিক — খালি রাখলে বাংলা নামই ব্যবহার হবে';
    const group = select(o.options.groups.map((g) => ({
      value: g, label: GROUP_BN[g] ?? g, selected: g === 'none',
    })));
    const stream = select(o.options.streams.map((st) => ({
      value: st, label: STREAM_BN[st] ?? st, selected: st === o.options.defaultStream,
    })));

    // Typing the Bangla name is the tedious part, and it is derivable from the
    // level the office just chose. They can still overwrite it.
    let nameTouched = false;
    nameBn.addEventListener('input', () => { nameTouched = true; });
    level.addEventListener('change', () => {
      if (!nameTouched) nameBn.value = `${levelNameBn(Number(level.value))} শ্রেণি`;
    });

    field('শ্রেণি', level);
    field('বাংলা নাম', nameBn);
    field('ইংরেজি নাম', nameEn);
    field('বিভাগ', group);
    field('ধারা', stream);

    const note = d.createElement('p');
    note.className = 'structure-form-note';
    // Say why there is no year field, rather than leaving the office looking
    // for one.
    note.textContent =
      'শ্রেণি বছরনির্ভর নয় — একই শ্রেণির অধীনে প্রতি বছর নতুন সেকশন তৈরি হয়। ' +
      'শিক্ষাবর্ষ সেকশন তৈরির সময় বেছে নেবেন।';
    form.append(note);

    collect = () => {
      if (!nameBn.value.trim()) { show('বাংলা নাম লিখুন'); return null; }
      return {
        kind: 'class', levelNo: Number(level.value), nameBn: nameBn.value.trim(),
        nameEn: nameEn.value.trim(), group: group.value, stream: stream.value,
      };
    };
  } else {
    // Empty: what is missing, what to do about it, and the way out as the
    // state's own button (Foundations §04) rather than a bar under the card.
    if (o.options.years.length === 0) {
      form.append(emptyState(d, {
        glyph: 'calendar',
        message: 'সেকশন তৈরির আগে একটি শিক্ষাবর্ষ দরকার।',
        detail: 'এটি বন্ধ করে আগে শিক্ষাবর্ষ তৈরি করুন, তারপর সেকশন যোগ করুন।',
        action: { label: 'বন্ধ করুন', onClick: o.onCancel },
      }));
      return form;
    }
    if (o.options.classes.length === 0) {
      form.append(emptyState(d, {
        glyph: 'layers',
        message: 'সেকশন তৈরির আগে একটি শ্রেণি দরকার।',
        detail: 'এটি বন্ধ করে আগে শ্রেণি তৈরি করুন, তারপর সেকশন যোগ করুন।',
        action: { label: 'বন্ধ করুন', onClick: o.onCancel },
      }));
      return form;
    }

    const year = select(o.options.years.map((y) => ({
      value: y.id,
      label: formatAcademicYear(y.label) + (y.isCurrent ? ' (চলতি)' : ''),
      selected: y.isCurrent,
    })));
    const klass = select(o.options.classes.map((c) => ({
      value: c.id,
      label: `${c.nameBn} · ${GROUP_BN[c.group] ?? c.group}`,
      selected: c.id === o.presetClassId,
    })));
    const name = input('text');
    name.placeholder = 'ক / A / F';
    const shift = select(o.options.shifts.map((sh) => ({
      value: sh, label: SHIFT_BN[sh] ?? sh, selected: sh === 'morning',
    })));
    const capacity = input('number', '60');
    capacity.min = '1';
    capacity.max = '300';
    capacity.classList.add('n');

    field('শিক্ষাবর্ষ', year);
    field('শ্রেণি ও বিভাগ', klass);
    field('সেকশনের নাম', name);
    field('শিফট', shift);
    field('ধারণক্ষমতা', capacity);

    collect = () => {
      if (!name.value.trim()) { show('সেকশনের নাম লিখুন'); return null; }
      const cap = Number(capacity.value);
      if (!Number.isInteger(cap) || cap < 1 || cap > 300) {
        show('ধারণক্ষমতা ১ থেকে ৩০০-এর মধ্যে দিন'); return null;
      }
      return {
        kind: 'section', academicYearId: year.value, classId: klass.value,
        name: name.value.trim(), shift: shift.value, capacity: cap,
      };
    };
  }

  function show(message: string): void {
    // "ধারণক্ষমতা ১ থেকে ৩০০-এর মধ্যে দিন": the figures in the numeral face,
    // the words left in the text face. textContent is the message exactly.
    clear(err);
    append(err, ...numText(d, message));
    err.hidden = false;
  }

  // Small, side by side, primary last (§09). `button()` gives the intrinsic
  // width and an explicit type; the save is the form's real submit control,
  // so Enter in a field still creates. While creating it reads
  // "তৈরি হচ্ছে…" and is busy — disabled and aria-busy — so it cannot be
  // pressed twice.
  const cancel = button(d, {
    label: 'বাতিল', variant: 'secondary', size: 'sm', onClick: o.onCancel,
  });
  const save = button(d, {
    label: o.busy ? 'তৈরি হচ্ছে…' : 'তৈরি করুন',
    variant: 'primary', size: 'sm', type: 'submit', busy: o.busy,
  });
  form.append(err, buttonRow(d, cancel, save));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.hidden = true;
    const payload = collect();
    if (payload) o.onSubmit(payload);
  });

  return form;
}

/** The confirmation a create returns, phrased so the office knows what to do next. */
export function createdNote(doc: Document, body: {
  kind?: string; label?: string; nameBn?: string; name?: string; classNameBn?: string;
}): HTMLElement {
  const what = body.kind === 'year' ? `শিক্ষাবর্ষ ${formatAcademicYear(body.label)} তৈরি হয়েছে।`
    : body.kind === 'class' ? `${body.nameBn} তৈরি হয়েছে — এবার এর সেকশন তৈরি করুন।`
    : `${body.classNameBn ?? ''} সেকশন ${body.name} তৈরি হয়েছে।`;
  // successNote sets the year's figures in the numeral face itself (R6).
  return successNote(doc, what);
}
