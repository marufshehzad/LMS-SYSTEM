/**
 * Practice (অনুশীলন) — one question at a time, immediate feedback.
 *
 * Mounted at the end of a topic by learn-view.ts. Deliberately NOT a
 * quiz: there is no score, no pass mark, and retrying is encouraged. The
 * only thing being measured is the signal V3 needs — did they get it, and
 * how long did it take.
 *
 * Answers are marked locally for instant feedback (the answer key ships
 * with the questions — see the practice endpoint's header for why that's
 * the right trade for formative work) and the attempt is queued to the
 * outbox, where the server re-marks it authoritatively. If the two ever
 * disagreed, the server's verdict is the one that counts; the local one
 * exists purely so a student on a bus isn't staring at a spinner.
 *
 * Drawn in 14 Components §08 (Ata Ekta): one white card holding, in order,
 * the dot rail, the meta row (question number + five difficulty dots), the
 * stem, the answer (option rows or one box), then — after checking — the
 * verdict, the explanation box and the two small actions.
 */
import { formatCount } from '../../../packages/ui-core/src/format.ts';
import { button } from './ui/button.ts';
import { append, numClass, numText, uid } from './ui/dom.ts';
import { emptyState } from './view-states.ts';

/**
 * Put `text` into `node` with every number in the numeral face (R6): the
 * whole element carries `n` when the text is only a figure ("১৩"), otherwise
 * each number gets its own `<span class="n">` and the words keep the text
 * face. Text nodes only — questions are school data, never markup — so
 * `textContent` is exactly `text`.
 */
function setNumText(d: Document, node: HTMLElement, base: string, text: string): void {
  const cls = numClass(base, text);
  node.className = cls;
  if (cls.split(' ').includes('n')) node.textContent = text;
  else append(node, ...numText(d, text));
}

export interface PracticeOption {
  id: string;
  optionNo: number;
  textBn: string;
  isCorrect: boolean;
}

export interface PracticeQuestion {
  id: string;
  questionNo: number;
  kind: string;
  stemBn: string;
  explanationBn: string | null;
  difficulty: number;
  numericAnswer: string | null;
  numericTolerance: string | null;
  options: PracticeOption[];
  myProgress: { attempts: number; solved: boolean; lastResponseMs: number | null };
}

export interface PracticeOutbox {
  enqueue(input: { entity: 'practice_attempt'; payload: unknown }): Promise<{ opId: string }>;
  flush(): Promise<unknown>;
}

export interface PracticeViewOptions {
  root: HTMLElement;
  doc: Document;
  questions: PracticeQuestion[];
  outbox: PracticeOutbox;
  onDone?: () => void;
}

export class PracticeView {
  private readonly o: PracticeViewOptions;
  private index = 0;
  private selectedId: string | null = null;
  private typed = '';
  private revealed = false;
  private wasCorrect = false;
  private shownAt = Date.now();
  private attemptsThisSession = new Map<string, number>();
  private solved = new Set<string>();

  constructor(options: PracticeViewOptions) {
    this.o = options;
    for (const q of options.questions) if (q.myProgress.solved) this.solved.add(q.id);
    this.render();
  }

  private get current(): PracticeQuestion | undefined {
    return this.o.questions[this.index];
  }

  private markLocally(q: PracticeQuestion): boolean {
    if (q.kind === 'mcq' || q.kind === 'true_false') {
      return q.options.find((o) => o.id === this.selectedId)?.isCorrect ?? false;
    }
    if (q.kind === 'numeric') {
      const given = Number(this.typed);
      if (!Number.isFinite(given)) return false;
      const tol = Number(q.numericTolerance ?? 0);
      return Math.abs(given - Number(q.numericAnswer)) <= tol;
    }
    return false;   // short answer is server-marked; no local guess
  }

  private async check(): Promise<void> {
    const q = this.current;
    if (!q || this.revealed) return;
    if (!this.selectedId && !this.typed.trim()) return;

    const attemptNo = (this.attemptsThisSession.get(q.id) ?? q.myProgress.attempts) + 1;
    this.attemptsThisSession.set(q.id, attemptNo);
    this.wasCorrect = this.markLocally(q);
    this.revealed = true;
    if (this.wasCorrect) this.solved.add(q.id);

    try {
      await this.o.outbox.enqueue({
        entity: 'practice_attempt',
        payload: {
          questionId: q.id,
          attemptNo,
          selectedOptionId: this.selectedId,
          answerText: q.kind === 'short_answer' ? this.typed.trim() : null,
          answerNumeric: q.kind === 'numeric' ? Number(this.typed) : null,
          responseMs: Date.now() - this.shownAt,
        },
      });
      void Promise.resolve(this.o.outbox.flush()).catch(() => {});
    } catch {
      // A failed enqueue must not block the student from continuing.
    }
    this.render();
  }

  private retry(): void {
    this.revealed = false;
    this.selectedId = null;
    this.typed = '';
    this.shownAt = Date.now();
    this.render();
  }

  private next(): void {
    if (this.index >= this.o.questions.length - 1) { this.o.onDone?.(); return; }
    this.index += 1;
    this.retry();
  }

  /* -------------------------------------------------------------- render */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    const q = this.current;
    if (!q) {
      // 14 Components §08 footnote: with no practice the section says so in
      // one sentence. Built with the shared empty state (R10) so it reads as
      // every other empty screen does.
      root.append(emptyState(d, { message: 'এই পাঠে কোনো অনুশীলন নেই।' }));
      return;
    }

    // The card is the drawn white frame; everything below sits inside it,
    // the dot rail included. Not `.card`: that class shadows on hover, and a
    // practice card is not clickable (shadows are for floating things only).
    const card = d.createElement('div');
    card.className = 'prac-card';

    // Progress dots — solved / attempted / untouched, so the student sees
    // shape of the set at a glance rather than just "3 of 6".
    const rail = d.createElement('div');
    rail.className = 'prac-rail';
    // role=img: an aria-label on a role-less div is ignored by most screen
    // readers, so the rail's name was never actually spoken. Both numbers in
    // Bangla, as the eye reads them.
    rail.setAttribute('role', 'img');
    rail.setAttribute('aria-label',
      `প্রশ্ন ${formatCount(q.questionNo, 'bn')}, মোট ${formatCount(this.o.questions.length, 'bn')}`);
    this.o.questions.forEach((item, i) => {
      const dot = d.createElement('span');
      dot.className = 'prac-dot';
      dot.dataset.state = this.solved.has(item.id) ? 'solved'
        : i === this.index ? 'current' : 'todo';
      // The sheet colours by class: the current dot in accent even once it
      // is solved (as drawn after a correct verdict), solved ones in ok.
      if (i === this.index) dot.classList.add('is-current');
      else if (this.solved.has(item.id)) dot.classList.add('is-done');
      rail.append(dot);
    });
    card.append(rail);

    const meta = d.createElement('div');
    meta.className = 'prac-meta';
    const num = d.createElement('span');
    append(num, ...numText(d, `প্রশ্ন ${formatCount(q.questionNo, 'bn')}`));
    const diff = d.createElement('span');
    diff.className = 'prac-difficulty';
    diff.textContent = '●'.repeat(q.difficulty) + '○'.repeat(5 - q.difficulty);
    // Both numbers in the same script. It read "কঠিনতা 3 / ৫" — the child's
    // own difficulty in Latin and the maximum in Bangla, in one phrase.
    diff.setAttribute('aria-label', `কঠিনতা ${formatCount(q.difficulty, 'bn')} / ৫`);
    meta.append(num, diff);
    card.append(meta);

    // The stem names the answer controls below it, so a screen reader that
    // lands on an option or the answer box hears the question with it.
    const stemId = uid('prac-stem');
    const stem = d.createElement('p');
    setNumText(d, stem, 'prac-stem', q.stemBn);
    stem.id = stemId;
    card.append(stem);

    if (q.kind === 'mcq' || q.kind === 'true_false') {
      const list = d.createElement('div');
      list.className = 'prac-options';
      list.setAttribute('role', 'radiogroup');
      list.setAttribute('aria-labelledby', stemId);
      for (const opt of q.options) {
        const btn = d.createElement('button');
        btn.type = 'button';
        btn.className = 'prac-option';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(this.selectedId === opt.id));
        btn.disabled = this.revealed;

        // A mark, not just a colour. Right and wrong used to be carried by a
        // green or red background alone, which a red-green colour-blind
        // student cannot read — and that is roughly one boy in twelve.
        const mark = d.createElement('span');
        mark.className = 'prac-mark';
        mark.setAttribute('aria-hidden', 'true');
        const label = d.createElement('span');
        setNumText(d, label, 'prac-option-text', opt.textBn);

        if (this.revealed) {
          // After answering, show BOTH what they chose and what was right —
          // marking only the wrong answer teaches nothing.
          if (opt.isCorrect) {
            btn.dataset.state = 'correct';
            btn.classList.add('is-correct');
            mark.textContent = '✓';
            // Spoken as well as shown, so the state does not depend on sight.
            btn.setAttribute('aria-label', `${opt.textBn} — সঠিক উত্তর`);
          } else if (opt.id === this.selectedId) {
            btn.dataset.state = 'wrong';
            btn.classList.add('is-wrong');
            mark.textContent = '✗';
            btn.setAttribute('aria-label', `${opt.textBn} — তোমার উত্তর, ভুল`);
          } else {
            // Drawn: an option that was neither chosen nor right keeps its
            // empty ring after checking, rather than losing its mark.
            mark.textContent = '○';
          }
        } else if (this.selectedId === opt.id) {
          mark.textContent = '●';
          btn.dataset.state = 'selected';
          btn.classList.add('is-chosen');
        } else {
          mark.textContent = '○';
        }
        btn.append(mark, label);

        btn.addEventListener('click', () => {
          if (this.revealed) return;
          this.selectedId = opt.id;
          this.render();
        });
        list.append(btn);
      }
      card.append(list);
    } else {
      const input = d.createElement('input');
      input.type = q.kind === 'numeric' ? 'number' : 'text';
      // `ui-input` is ui/field.ts's control: the sheet's box, its focus ring
      // and its disabled look for the revealed state. Drawn in the number face.
      input.className = q.kind === 'numeric' ? 'ui-input prac-input n is-num' : 'ui-input prac-input n';
      input.placeholder = q.kind === 'numeric' ? 'উত্তর লেখো' : 'সংক্ষেপে লেখো';
      input.setAttribute('aria-labelledby', stemId);
      input.value = this.typed;
      input.disabled = this.revealed;
      if (q.kind === 'numeric') input.step = 'any';
      input.addEventListener('input', () => { this.typed = input.value; });
      card.append(input);
    }

    if (this.revealed) {
      const verdict = d.createElement('div');
      verdict.className = 'prac-verdict';
      verdict.dataset.correct = String(this.wasCorrect);
      // A short answer is marked by the teacher, so `wasCorrect` is always
      // false there — it takes no tone and must never turn red.
      if (q.kind !== 'short_answer') verdict.classList.add(this.wasCorrect ? 'is-correct' : 'is-wrong');
      verdict.setAttribute('role', 'status');
      // The words carry right and wrong; the colour only repeats them.
      verdict.textContent = q.kind === 'short_answer'
        ? 'উত্তর জমা হয়েছে — শিক্ষক যাচাই করবেন'
        : this.wasCorrect ? 'ঠিক হয়েছে' : 'আবার ভাবো';
      card.append(verdict);

      if (q.explanationBn) {
        const exp = d.createElement('p');
        setNumText(d, exp, 'prac-explanation', q.explanationBn);
        card.append(exp);
      }
    }

    const actions = d.createElement('div');
    actions.className = 'prac-actions';
    if (!this.revealed) {
      // Full width, label flush left (btn-block), as drawn before checking.
      actions.append(button(d, {
        label: 'যাচাই করো',
        variant: 'primary',
        block: true,
        disabled: !this.selectedId && !this.typed.trim(),
        onClick: () => { void this.check(); },
      }));
    } else {
      // Two small buttons side by side at their own width; one primary.
      if (!this.wasCorrect && q.kind !== 'short_answer') {
        actions.append(button(d, {
          label: 'আবার চেষ্টা করো',
          variant: 'secondary',
          size: 'sm',
          className: 'prac-retry',
          onClick: () => { this.retry(); },
        }));
      }
      actions.append(button(d, {
        label: this.index >= this.o.questions.length - 1 ? 'শেষ করো' : 'পরের প্রশ্ন →',
        variant: 'primary',
        size: 'sm',
        onClick: () => { this.next(); },
      }));
    }
    card.append(actions);
    root.append(card);
  }
}
