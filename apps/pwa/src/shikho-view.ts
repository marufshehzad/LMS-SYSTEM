/**
 * ShikhoAI (শিখো) — the student Socratic tutor chat.
 *
 * A minimal chat over POST /api/v1/ai/shikho. Stateless per turn on the
 * wire (the server logs sessions for audit; conversational memory is a
 * follow-on) — the transcript here is for the reader, and the tutor's
 * Socratic system prompt does the pedagogy. Handles the ai_disabled 503
 * with a friendly banner so the page ships before the API key does.
 *
 * Ata Ekta (03 Student §05): the message area fills the screen, the
 * student's question sits left on the inset ground, the tutor's answer sits
 * right in a bordered surface bubble, and the composer is one strip resting
 * on the tab bar — the input and a square arrow-up send, nothing else. The
 * class the student is asking about moved out of that strip into the page
 * header, beside the scope line it changes.
 */
import type { Auth } from './auth.ts';
import {
  pageHeader, button, field, el, numText,
  emptyState, errorState, permissionState, permissionMessage, serverMessage, deniedContact,
} from './ui/index.ts';
import { formatCount } from '../../../packages/ui-core/src/format.ts';
import { levelNameBn } from '../../../packages/ui-core/src/format.ts';

export interface ShikhoViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/**
 * A turn in the transcript. An assistant turn always carries WHAT KIND of
 * answer it is — §6.7 admits no unmarked reply:
 *   grounded    — the retrieval found NCTB passages; `sources` names them
 *   ungrounded  — answered from general curriculum knowledge, said out loud
 *   refused     — the model declined; an honest state, not an error
 *   unavailable — offline or the service is dark (F-1311), never a hang
 */
type TurnKind = 'grounded' | 'ungrounded' | 'refused' | 'unavailable';
interface Turn {
  role: 'user' | 'assistant';
  text: string;
  kind?: TurnKind;
  sources?: string[];
}

/** The classes a student may ask about. */
const FIRST_CLASS = 6;
const LAST_CLASS = 12;

/**
 * The state line under an answer. It is not decoration: it is how a student
 * knows whether they are reading their textbook or the model's general
 * knowledge.
 */
function stateLine(t: Turn): string {
  if (t.kind === 'grounded') {
    return t.sources && t.sources.length > 0
      ? `✓ NCTB পাঠ্যবই — ${t.sources.join(' · ')}`
      : '✓ NCTB পাঠ্যবই থেকে';
  }
  if (t.kind === 'refused') return 'এই প্রশ্নের উত্তর দেওয়া হয়নি।';
  if (t.kind === 'unavailable') return 'উত্তর দেওয়া যায়নি।';
  // Honest, and deliberately not alarming: this is a normal state, it just
  // is not the textbook, and the student is told where to check.
  return 'পাঠ্যবইয়ের নির্দিষ্ট অংশ পাওয়া যায়নি — বইয়ের সাথে মিলিয়ে নিও।';
}

export class ShikhoView {
  private readonly o: ShikhoViewOptions;
  private turns: Turn[] = [];
  private busy = false;
  private error = '';
  /**
   * A 403. A refusal is not a connection problem: saying "সংযোগে সমস্যা"
   * sends the student to check a connection that works. The canonical
   * sentence (B-30), and who can help — or, for a school without the
   * module, that nobody at the school can.
   */
  private denied: { message: string; contact: string | undefined } | null = null;
  private classLevel = 9;
  private draft = '';

  /** True when the device has cached lessons/practice to fall back on. */
  private hasCachedStudy(): boolean {
    try {
      return Object.keys(localStorage).some(
        (k) => k.startsWith('shikhon_practice_') || k.startsWith('shikhon_topic_cache_'),
      );
    } catch { return false; }
  }

  constructor(options: ShikhoViewOptions) {
    this.o = options;
    this.render();
  }

  private async send(message: string): Promise<void> {
    this.turns.push({ role: 'user', text: message });

    // F-1311: offline is answered from here, not by letting a doomed request
    // hang. The student is told plainly and pointed at what still works.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.turns.push({
        role: 'assistant', kind: 'unavailable',
        text: 'এখন ইন্টারনেট নেই, তাই শিখো টিউটর উত্তর দিতে পারছে না। সংযোগ ফিরলে আবার জিজ্ঞাসা করো।',
      });
      this.render();
      return;
    }

    this.busy = true;
    this.error = '';
    this.denied = null;
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ai/shikho', {
        method: 'POST',
        body: JSON.stringify({ message, classLevel: this.classLevel }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; reply?: string; error?: string; message?: string;
        grounded?: boolean; sources?: string[];
      };
      if (res.ok && body.ok && body.reply) {
        // Every reply is labelled. A grounded one names its textbook
        // sections; an ungrounded one says so rather than passing general
        // model knowledge off as the syllabus (F-1302).
        this.turns.push({
          role: 'assistant',
          text: body.reply,
          kind: body.grounded ? 'grounded' : 'ungrounded',
          sources: body.sources ?? [],
        });
      } else if (body.error === 'ai_disabled') {
        this.turns.push({
          role: 'assistant', kind: 'unavailable',
          text: 'শিখো টিউটর এখনো চালু হয়নি — স্কুল চালু করলেই প্রশ্ন করা যাবে।',
        });
      } else if (body.error === 'ai_refused') {
        this.turns.push({
          role: 'assistant', kind: 'refused',
          text: 'এই প্রশ্নে সাহায্য করতে পারছি না। পড়াশোনার প্রশ্ন করো, বা শিক্ষককে জিজ্ঞাসা করো।',
        });
      } else if (res.status === 403) {
        this.denied = {
          message: serverMessage(body, 403, permissionMessage()),
          contact: deniedContact({ code: body.error }),
        };
      } else {
        this.error = 'সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।';
      }
    } catch {
      // A failed request on a live connection is a connection problem; a
      // failed request with no connection is the offline state above.
      this.turns.push({
        role: 'assistant', kind: 'unavailable',
        text: 'উত্তর আনা গেল না — সংযোগ পরীক্ষা করে আবার চেষ্টা করো।',
      });
    }
    this.busy = false;
    this.render();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // The class the student is asking about. It is sent with every question
    // and it is what the scope line names, so it sits beside that line.
    const classField = field(d, {
      label: 'শ্রেণি',
      name: 'shikho-class',
      kind: 'select',
      value: String(this.classLevel),
      // Bangla digits, like every other number this product shows a student.
      options: Array.from({ length: LAST_CLASS - FIRST_CLASS + 1 }, (_, i) => {
        const c = FIRST_CLASS + i;
        return { value: String(c), label: formatCount(c, 'bn') };
      }),
      className: 'chat-class-field',
      attrs: { 'aria-label': 'শ্রেণি' },
      // Re-render: the header states the scope, so it must not go stale the
      // moment the student changes the class they are asking about.
      onChange: (value) => {
        this.classLevel = Number(value);
        this.render();
      },
    });
    // Its options are figures (R6); `.is-num` is what wins over .ui-input.
    classField.input.classList.add('chat-class', 'n', 'is-num');
    for (const opt of classField.input.querySelectorAll('option')) opt.classList.add('n');

    root.append(pageHeader(d, {
      title: 'শিখো টিউটর',
      // §6.7: the scope is pinned and VISIBLE, so the student understands the
      // boundary the tutor is answering inside rather than discovering it.
      subtitle: `${levelNameBn(this.classLevel)} শ্রেণির পাঠ্যসূচি · `
        + 'উত্তর বলে দেয় না, বুঝিয়ে দেয়',
      actions: [classField.root],
    }));

    const chat = el(d, 'div', { className: 'chat-log' });
    if (this.turns.length === 0) {
      // No action button: the next action is the composer directly below.
      chat.append(emptyState(d, {
        glyph: 'message',
        message: 'যেকোনো পড়াশোনার প্রশ্ন করো — বাংলা, English বা Banglish-এ।',
      }));
    }
    for (const t of this.turns) {
      if (t.role === 'user') {
        chat.append(el(d, 'div', { className: 'chat-bubble chat-user' }, ...numText(d, t.text)));
        continue;
      }

      // An assistant turn is a bubble plus its state line.
      const wrap = el(d, 'div', {
        className: 'chat-answer', data: { kind: t.kind ?? 'ungrounded' },
      },
      el(d, 'div', { className: 'chat-bubble chat-ai' }, ...numText(d, t.text)),
      el(d, 'p', { className: 'chat-source' }, ...numText(d, stateLine(t))));

      // F-1311: offline does not dead-end. When the device has lessons or
      // practice already cached, point at them instead of leaving the
      // student staring at a tutor that cannot answer.
      if (t.kind === 'unavailable' && this.hasCachedStudy()) {
        wrap.append(button(d, {
          label: 'সংরক্ষিত পাঠ ও অনুশীলন দেখো',
          variant: 'secondary',
          size: 'sm',
          className: 'chat-offline-cta',
          onClick: () => { location.hash = '#/learn'; },
        }));
      }

      chat.append(wrap);
    }
    if (this.busy) {
      // Loading is a skeleton on the tutor's side, never a spinner or a
      // sentence (§7). The word stays for a screen reader.
      chat.append(el(d, 'div', {
        className: 'chat-bubble chat-ai chat-typing', attrs: { 'aria-busy': 'true' },
      },
      el(d, 'span', { className: 'skel skel-bar' }),
      el(d, 'span', { className: 'skel skel-bar is-short' }),
      el(d, 'span', { className: 'ui-sr-only', text: 'ভাবছি…' })));
    }
    root.append(chat);

    if (this.denied) {
      const refusal = permissionState(d, {
        message: this.denied.message, contact: this.denied.contact,
      });
      // R8: the refusal is the answer to a question the student just sent,
      // and focus goes straight back to the input below. permissionState is
      // a calm role="note", which nobody hears; before this card existed the
      // same 403 was a role="alert" line that was read out. Keep that: the
      // look is the lock card, the announcement is the alert. The card holds
      // only words and an aria-hidden glyph, so the whole card is the alert.
      refusal.setAttribute('role', 'alert');
      root.append(refusal);
    } else if (this.error) {
      root.append(errorState(d, this.error));
    }

    // The composer, as drawn: the input and one square send, on a strip.
    const form = el(d, 'form', { className: 'chat-form' });

    const input = el(d, 'input', {
      className: 'ui-input chat-input',
      attrs: {
        type: 'text',
        placeholder: 'প্রশ্ন লেখো',
        // A placeholder is not a name; it disappears as soon as they type.
        'aria-label': 'প্রশ্ন লেখো',
        enterkeyhint: 'send',
      },
    });
    input.value = this.draft;
    input.addEventListener('input', () => { this.draft = input.value; });

    // The page's one primary. Icon-only on screen; the word is its name.
    const send = button(d, {
      label: 'পাঠাও',
      ariaLabel: 'পাঠাও',
      glyph: 'arrow-up',
      variant: 'primary',
      type: 'submit',
      className: 'chat-send',
      busy: this.busy,
      attrs: { title: 'পাঠাও' },
    });

    form.append(input, send);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = input.value.trim();
      if (!msg || this.busy) return;
      this.draft = '';
      void this.send(msg);
    });
    root.append(form);

    chat.scrollTop = chat.scrollHeight;
    if (!this.busy) input.focus();
  }
}
