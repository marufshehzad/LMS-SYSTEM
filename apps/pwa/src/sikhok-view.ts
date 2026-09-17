/**
 * SikhokAI (শিক্ষক সহায়ক) — the teacher co-pilot page.
 *
 * A form over POST /api/v1/ai/sikhok: task type (CQ / MCQ / rubric / topic
 * plan), class level, subject, optional chapter and instructions. The
 * response is NCTB-bounded generated Markdown, rendered as preformatted
 * text (no client-side Markdown engine on a 2 GB device budget — the
 * structure reads fine as plain text).
 *
 * While the gateway is dark (no ANTHROPIC_API_KEY → 503 ai_disabled) the
 * page stays usable and explains itself instead of erroring.
 *
 * ── Ata Ekta (02 Teacher §07, drawn on a phone) ────────────────────────────
 * The drawing is four task tiles in a 2×2 grid — CQ প্রশ্ন, MCQ প্রশ্ন,
 * রুব্রিক, পাঠ পরিকল্পনা — and a "সর্বশেষ" card: eyebrow, title ("নবম গণিত —
 * অধ্যায় ৪ CQ"), meta time.
 *
 * The tiles ARE the old task select: the same four values, the same default
 * (CQ), the same payload — a single choice shown as pressed buttons, not four
 * launchers. The endpoint still needs a class, a subject, a chapter and
 * instructions, which the drawing does not show, so those stay as the page's
 * working form directly under the tiles, with the one primary last.
 *
 * Order is tiles → form → result, not the drawn tiles → সর্বশেষ. The drawing
 * has no form, so it cannot say where the answer to a form submission goes;
 * put above the form, the skeleton, the error and the new card all land above
 * a phone's viewport while the teacher's thumb is on "তৈরি করুন" at the bottom.
 * Under the button, the outcome appears where they are already looking.
 */
import type { Auth } from './auth.ts';
import { levelNameBn } from '../../../packages/ui-core/src/format.ts';
import { hasIcon } from './icon.ts';
import {
  pageHeader, card, button, buttonRow, field, setFieldError, clearFieldError,
  statusBadge, el, append, icon, uid, numText, skeleton, emptyState, errorState,
  permissionState, permissionMessage, type Child,
} from './ui/index.ts';
import { bnNum } from './view-states.ts';


export interface SikhokViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/**
 * Mirrors `requireStaff` in server-core, which blocks exactly these two.
 * Advisory only — the endpoint is the gate; this decides whether the form is
 * offered at all.
 */
const NOT_STAFF = ['student', 'guardian'];

interface Task {
  /** What the endpoint receives. Unchanged from the select this replaced. */
  value: string;
  /** The tile's label, exactly as drawn. */
  short: string;
  /** The suffix of the সর্বশেষ title: "নবম গণিত — অধ্যায় ৪ CQ". */
  tag: string;
  /** The choice in words, under the form card's title. */
  full: string;
  glyph: string;
}

/** The drawn MCQ glyph is Lucide `list`; until the set carries it, the three-line `menu`. */
const LIST_GLYPH = hasIcon('list') ? 'list' : 'menu';

const TASKS: readonly Task[] = [
  { value: 'generate_cq', short: 'CQ প্রশ্ন', tag: 'CQ', full: 'সৃজনশীল প্রশ্ন (CQ)', glyph: 'file-text' },
  { value: 'generate_mcq', short: 'MCQ প্রশ্ন', tag: 'MCQ', full: 'বহুনির্বাচনি প্রশ্ন (MCQ)', glyph: LIST_GLYPH },
  { value: 'rubric', short: 'রুব্রিক', tag: 'রুব্রিক', full: 'মূল্যায়ন রুব্রিক', glyph: 'check-square' },
  { value: 'lesson_plan', short: 'পাঠ পরিকল্পনা', tag: 'পাঠ পরিকল্পনা', full: 'পাঠ পরিকল্পনা', glyph: 'book-open' },
];

/** The one failure where sending the same request again can succeed. */
const NETWORK_ERROR = 'সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।';

interface GenerateInput {
  taskType: string; classLevel: number; subjectBn: string;
  chapterNo: number | null; instructions: string;
}

export class SikhokView {
  private readonly o: SikhokViewOptions;
  private busy = false;
  private output = '';
  private error = '';
  private grounded: boolean | null = null;
  /** What the সর্বশেষ card names: built from the request that produced `output`. */
  private latest: { title: string; at: string } | null = null;
  /** The request behind the current error, so "আবার চেষ্টা করুন" can send it again. */
  private lastInput: GenerateInput | null = null;

  constructor(options: SikhokViewOptions) {
    this.o = options;
    this.render();
  }

  private async generate(input: GenerateInput): Promise<void> {
    this.busy = true;
    this.error = '';
    this.lastInput = input;
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ai/sikhok', {
        method: 'POST',
        body: JSON.stringify({
          taskType: input.taskType,
          classLevel: input.classLevel,
          subjectBn: input.subjectBn,
          chapterNo: input.chapterNo ?? undefined,
          instructions: input.instructions || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; content?: string; grounded?: boolean; error?: string;
      };
      if (res.ok && body.ok && body.content) {
        this.output = body.content;
        this.grounded = body.grounded ?? null;
        this.latest = latestOf(input, new Date());
      } else if (body.error === 'ai_disabled') {
        this.error = 'AI ফিচার এখনো চালু হয়নি — অ্যাডমিন চালু করলেই এখান থেকে প্রশ্নপত্র তৈরি করা যাবে।';
      } else if (body.error === 'ai_refused') {
        this.error = 'এই অনুরোধটি তৈরি করা সম্ভব হয়নি — অন্যভাবে চেষ্টা করুন।';
      } else if (res.status === 403) {
        this.error = 'এই ফিচারটি শুধু শিক্ষক/কর্মকর্তাদের জন্য।';
      } else {
        this.error = NETWORK_ERROR;
      }
    } catch {
      this.error = NETWORK_ERROR;
    }
    this.busy = false;
    this.render();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // A student typing this URL used to meet the whole generator — task type,
    // class, subject, and a live "তৈরি করুন". The endpoint refuses them, so
    // nothing could have been generated; offering it anyway implies a child
    // may write their own exam questions.
    const denied = NOT_STAFF.includes(this.o.auth.role);
    root.append(pageHeader(d, {
      title: 'শিক্ষক সহায়ক AI',
      subtitle: denied ? undefined : 'NCTB পাঠ্যক্রম অনুযায়ী প্রশ্ন, রুব্রিক ও পাঠ পরিকল্পনা',
    }));
    if (denied) {
      root.append(permissionState(d, {
        message: permissionMessage('শিক্ষক সহায়ক AI'),
        contact: 'শিক্ষক ও কর্মকর্তা',
      }));
      return;
    }

    // Render-local, like the select it replaces: every render starts at CQ.
    let taskType = TASKS[0].value;

    const level = field(d, {
      label: 'শ্রেণি', name: 'classLevel', kind: 'select', required: true,
      value: '9',
      // These read "শ্রেণি 6 … শ্রেণি 12" — Latin digits in a Bangla product,
      // on the one control that names the class. `levelNameBn` is the table
      // `structure-forms` has had since R-3; appending "ম" to a numeral gives
      // "১১ম" where a school says "একাদশ".
      options: Array.from({ length: 7 }, (_, i) => {
        const c = i + 6;
        return { value: String(c), label: `${levelNameBn(c)} শ্রেণি` };
      }),
    });
    const subject = field(d, {
      label: 'বিষয়', name: 'subjectBn', required: true,
      placeholder: 'যেমন: পদার্থবিজ্ঞান',
      helper: 'পাঠ্যবইয়ে যে নামে আছে, সেই নাম লিখুন।',
    });
    const chapter = field(d, {
      label: 'অধ্যায় নম্বর', name: 'chapterNo', kind: 'number',
      attrs: { min: 1 }, helper: 'ঐচ্ছিক — দিলে ওই অধ্যায়ে সীমাবদ্ধ থাকবে।',
    });
    const notes = field(d, {
      label: 'অতিরিক্ত নির্দেশনা', name: 'instructions', kind: 'textarea',
      attrs: { rows: 3 }, helper: 'ঐচ্ছিক — যেমন "সহজ ভাষায়" বা "১০ নম্বরের"।',
    });

    const form = el(d, 'form', { className: 'sikhok-form' });
    append(form, level.root, subject.root, chapter.root, notes.root);
    append(form, buttonRow(d, button(d, {
      label: 'তৈরি করুন', variant: 'primary', type: 'submit', busy: this.busy,
    })));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.busy) return;
      clearFieldError(subject.root);
      if (!subject.value().trim()) {
        // Field-level, so the class and the instructions the person already
        // chose stay in front of them.
        setFieldError(subject.root, 'কোন বিষয়ের জন্য, সেটি লিখুন।');
        subject.input.focus();
        return;
      }
      void this.generate({
        taskType,
        classLevel: Number(level.value()),
        subjectBn: subject.value().trim(),
        chapterNo: chapter.value() ? Number(chapter.value()) : null,
        instructions: notes.value().trim(),
      });
    });

    // The subtitle names the chosen task in words, so the choice is never
    // carried by a tile's edge alone.
    const formCard = card(d, {
      title: 'কী চান', subtitle: TASKS[0].full, glyph: 'edit', headingLevel: 2,
      className: 'sikhok-form-card',
    }, form);
    const taskSub = formCard.querySelector<HTMLElement>('.ui-card-sub');

    const tiles = el(d, 'div', {
      className: 'sikhok-tasks', attrs: { role: 'group', 'aria-label': 'কী তৈরি করবেন' },
    });
    const tileButtons = TASKS.map((t) => el(d, 'button', {
      className: 'sikhok-task',
      // A string, not a boolean: el() drops `false`, and a toggle with no
      // aria-pressed is announced as a plain button.
      attrs: { type: 'button', 'aria-pressed': t.value === taskType ? 'true' : 'false' },
      data: { task: t.value },
    },
      icon(d, t.glyph, 'sikhok-task-glyph'),
      el(d, 'span', { className: 'sikhok-task-label', text: t.short }),
    ));
    tileButtons.forEach((b, i) => {
      b.addEventListener('click', () => {
        // No render(): what is typed in the form below survives a tile change.
        const t = TASKS[i];
        taskType = t.value;
        for (const other of tileButtons) {
          other.setAttribute('aria-pressed', other === b ? 'true' : 'false');
        }
        if (taskSub) taskSub.textContent = t.full;
      });
    });
    append(tiles, ...tileButtons);

    append(root, el(d, 'div', { className: 'sikhok-body' },
      tiles,
      formCard,
      ...this.result(d, subject.input),
    ));
  }

  /**
   * The slot under the form, directly below "তৈরি করুন": generating, the last
   * error, the সর্বশেষ card, or nothing yet.
   */
  private result(d: Document, subjectInput: HTMLElement): Child[] {
    const previous = this.latestCard(d);
    if (this.busy) {
      // The skeleton goes where the new card will land, right under the
      // button. The previous card stays below it, as the output did before
      // this redesign: the teacher keeps their last result while waiting, and
      // the page does not shrink under the button they just pressed.
      return [card(d, { className: 'sikhok-latest' }, skeleton(d, 3)), previous];
    }
    const out: Child[] = [];
    if (this.error) {
      const retry = this.error === NETWORK_ERROR && this.lastInput
        ? () => { if (!this.busy && this.lastInput) void this.generate(this.lastInput); }
        : undefined;
      out.push(errorState(d, this.error, retry));
    }
    if (previous) {
      out.push(previous);
    } else if (!this.error) {
      out.push(emptyState(d, {
        glyph: 'file-text',
        message: 'এখনো কিছু তৈরি হয়নি।',
        detail: 'ওপরে কী তৈরি করবেন বেছে নিন, শ্রেণি ও বিষয় লিখে “তৈরি করুন” চাপুন। ' +
                'যা তৈরি হবে, তা এখানে দেখাবে।',
        action: { label: 'বিষয় লিখুন', onClick: () => subjectInput.focus() },
      }));
    }
    return out;
  }

  /** The সর্বশেষ card for the last successful generation, or null before one. */
  private latestCard(d: Document): HTMLElement | null {
    if (!this.output || !this.latest) return null;
    const tid = uid('sikhok');
    const latest = card(d, { className: 'sikhok-latest' },
      el(d, 'p', { className: 'label sikhok-latest-kicker', text: 'সর্বশেষ' }),
      el(d, 'h2', { className: 'sikhok-latest-title', attrs: { id: tid } },
        ...numText(d, this.latest.title)),
      el(d, 'p', { className: 'sikhok-latest-meta' }, ...numText(d, this.latest.at)),
      // Whether this came from the textbook corpus is a fact about how far
      // to trust it, so it sits with the title rather than under the text.
      el(d, 'div', { className: 'sikhok-latest-trust' },
        this.grounded === false
          ? statusBadge(d, { state: 'pending', label: 'যাচাই করে নিন' })
          : statusBadge(d, { state: 'published', label: 'পাঠ্যক্রম-ভিত্তিক' })),
      this.grounded === false
        ? el(d, 'p', {
            className: 'sikhok-note',
            text: 'পাঠ্যবই কর্পাস এখনো যুক্ত হয়নি — সাধারণ পাঠ্যক্রম-জ্ঞান থেকে তৈরি; ' +
                  'ব্যবহারের আগে যাচাই করুন।',
          })
        : null,
      // Preformatted text, not a Markdown engine: 04-UIUX's device budget
      // does not carry a parser for structure that reads fine as plain text.
      // numText puts only the digits in the numeral face; the prose stays
      // in the text face and textContent is the content exactly.
      el(d, 'pre', { className: 'sikhok-output' }, ...numText(d, this.output)),
    );
    latest.setAttribute('aria-labelledby', tid);
    return latest;
  }
}

/** "নবম গণিত — অধ্যায় ৪ CQ" and "আজ ০৯:২০", from the request and the moment it answered. */
function latestOf(input: GenerateInput, now: Date): { title: string; at: string } {
  const task = TASKS.find((t) => t.value === input.taskType) ?? TASKS[0];
  const ch = input.chapterNo;
  const chapterPart = ch !== null && Number.isFinite(ch) ? ` — অধ্যায় ${bnNum(ch)}` : ' —';
  const hh = bnNum(String(now.getHours()).padStart(2, '0'));
  const mm = bnNum(String(now.getMinutes()).padStart(2, '0'));
  return {
    title: `${levelNameBn(input.classLevel)} ${input.subjectBn}${chapterPart} ${task.tag}`,
    at: `আজ ${hh}:${mm}`,
  };
}
