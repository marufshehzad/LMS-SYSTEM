/**
 * Home for every role that has no home screen of its own.
 *
 * app.ts mounts a dedicated home for the principal and owner, the student and
 * the teaching roles. Everyone else lands here: today the guardian, the
 * accountant, the IT admin and the academic coordinator. The screen is a calm
 * re-orientation surface — who is signed in and what day it is, the two
 * destinations this role most often needs, then a short list of the rest.
 *
 * For guardians there is one addition: a "next" block fetched through
 * `loadNext`. The destinations answer "what CAN I do"; the next block answers
 * "what SHOULD I do". It renders progressively — the destinations paint
 * immediately and the suggestions slot in when they arrive, so the shell is
 * never blocked on a request.
 *
 * ── Ata Ekta ───────────────────────────────────────────────────────────────
 * 04 Guardian §01 draws the guardian's home as three answers: today's
 * attendance for the selected child, that child's fee due, and the new
 * notices. This screen is handed none of that data — only the role's
 * destinations and the next-block loader — and the redesign changes
 * appearance, not what a screen fetches. So the drawn answers are not built
 * here. What IS built is the page in the drawing's own vocabulary: the header
 * through `pageHeader()` (the one h1), the blocks stacked at the drawn 12px,
 * and each labelled group as the drawn bordered box with an inset label band
 * over its rows. Rows and cards are the shared `listItem` and `card`, so the
 * glyphs are neutral ink and no colour is spent on decoration.
 */
import {
  el, append, card, list, listItem, listSkeleton, pageHeader, sectionHeading,
  statusBadge, errorState, humanError,
} from './ui/index.ts';
import { bnNum } from './view-states.ts';
import { weekdayDateBn } from '../../../packages/ui-core/src/format.ts';

export interface DashboardItem {
  path: string;
  /** An icon name from ./icon.ts, not an emoji. */
  glyph: string;
  titleBn: string;
  subtitleBn: string;
  variant?: 'primary' | 'secondary';
}

export interface Suggestion {
  kind: string;
  titleBn: string;
  whyBn: string;
  route: string;
  refId: string;
  urgency: 'high' | 'medium' | 'low';
}

export interface HomeViewOptions {
  root: HTMLElement;
  doc: Document;
  displayName?: string;
  primary: DashboardItem[];
  secondary: DashboardItem[];
  /** Supplied for students/guardians only; omitted = no "next" block. */
  loadNext?: () => Promise<Suggestion[]>;
}

// Icon names (see ./icon.ts), not emoji: one drawn set, one stroke weight.
const KIND_GLYPH: Record<string, string> = {
  assignment: 'edit',
  redo_practice: 'refresh',
  continue_topic: 'arrow-right',
  new_chapter: 'star',
};

/** The heading every state of the next block keeps, so the slot never jumps. */
const NEXT_TITLE = 'এখন যা করবে';

function greetingBn(now: Date): string {
  const h = now.getHours();
  if (h < 5) return 'শুভ রাত্রি';
  if (h < 12) return 'শুভ সকাল';
  if (h < 17) return 'শুভ দুপুর';
  if (h < 20) return 'শুভ বিকেল';
  return 'শুভ সন্ধ্যা';
}

/** Navigation stays a hash change, exactly as the tiles it replaces did. */
function go(path: string): void {
  location.hash = `/${path}`;
}

export class HomeView {
  constructor(o: HomeViewOptions) {
    const d = o.doc;
    const now = new Date();
    o.root.textContent = '';

    // The shell's home drawing (01 Shell, mirrored by the teacher home): the
    // person's name is the page's h1 and the greeting sits with the date under
    // it. pageHeader puts the date's digits in the numeral face (R6).
    const name = (o.displayName ?? '').trim();
    append(o.root, pageHeader(d, name
      ? { title: name, subtitle: `${greetingBn(now)} · ${weekdayDateBn(now)}` }
      : { title: greetingBn(now), subtitle: weekdayDateBn(now) }));

    const page = el(d, 'div', { className: 'hv-home' });
    append(o.root, page);

    // "What should I do next" — between the header and the destinations, so
    // it reads as the answer to the greeting rather than one more option.
    if (o.loadNext) {
      const slot = el(d, 'section', { className: 'hv-group' });
      // The suggestions arrive after first paint; the region announces itself
      // to a screen reader when they do, and aria-busy carries the load state.
      slot.setAttribute('aria-live', 'polite');
      append(page, slot);
      this.loadNextInto(d, slot, o.loadNext);
    }

    // The role's two main destinations: whole-card buttons, named by title.
    if (o.primary.length > 0) {
      append(page, el(d, 'div', { className: 'hv-primary' },
        ...o.primary.map((item) => card(d, {
          title: item.titleBn,
          subtitle: item.subtitleBn,
          glyph: item.glyph,
          onClick: () => go(item.path),
        }))));
    }

    // "Quick access", not "all sections": a short shortcut list, with the long
    // tail in আরও. Naming it honestly stops it reading as the whole index.
    if (o.secondary.length > 0) {
      append(page, el(d, 'section', { className: 'hv-group' },
        this.groupHead(d, 'দ্রুত প্রবেশ'),
        list(d, 'দ্রুত প্রবেশ', ...o.secondary.map((item) => this.row(d, item)))));
    }
  }

  /** The drawn label band that heads a bordered group. */
  private groupHead(d: Document, title: string): HTMLElement {
    return sectionHeading(d, { title, className: 'hv-group-head' });
  }

  /** One destination row. Its accessible name stays the title alone, as the tile's was. */
  private row(d: Document, item: DashboardItem): HTMLElement {
    const li = listItem(d, {
      title: item.titleBn,
      subtitle: item.subtitleBn,
      glyph: item.glyph,
      onClick: () => go(item.path),
    });
    li.querySelector('.ui-list-hit')?.setAttribute('aria-label', item.titleBn);
    return li;
  }

  /**
   * Load the suggestions with three distinct states. A skeleton holds the
   * space from first paint (so the cards below never jump under a thumb), an
   * empty result is a quiet reassurance, and a failure is an honest retry,
   * not a void.
   */
  private loadNextInto(
    d: Document, slot: HTMLElement, loader: () => Promise<Suggestion[]>,
  ): void {
    this.renderNextSkeleton(d, slot);
    slot.setAttribute('aria-busy', 'true');
    loader()
      .then((items) => { slot.setAttribute('aria-busy', 'false'); this.renderNext(d, slot, items); })
      .catch(() => {
        slot.setAttribute('aria-busy', 'false');
        this.renderNextError(d, slot, () => this.loadNextInto(d, slot, loader));
      });
  }

  /** Grey rows in the shape of the list, never a spinner (Foundations §04). */
  private renderNextSkeleton(d: Document, slot: HTMLElement): void {
    slot.textContent = '';
    append(slot, this.groupHead(d, NEXT_TITLE), listSkeleton(d, 2));
  }

  /** Couldn't load — a sentence and "আবার চেষ্টা করুন", never a silent gap. */
  private renderNextError(d: Document, slot: HTMLElement, retry: () => void): void {
    slot.textContent = '';
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    append(slot, this.groupHead(d, NEXT_TITLE),
      errorState(d, offline ? humanError('offline') : 'পরামর্শ লোড হয়নি।', retry));
  }

  private renderNext(d: Document, slot: HTMLElement, items: Suggestion[]): void {
    slot.textContent = '';
    append(slot, this.groupHead(d, NEXT_TITLE));

    // Nothing due is a real, good answer — say so, quietly, instead of
    // leaving a blank where a moment ago there was a skeleton. The next
    // action is the destinations directly below.
    if (items.length === 0) {
      append(slot, el(d, 'p', {
        className: 'hv-note', text: 'আজ নতুন করে কিছু করার নেই — এগিয়ে আছো।',
      }));
      return;
    }

    append(slot, list(d, NEXT_TITLE, ...items.map((s) => listItem(d, {
      title: s.titleBn,
      // The reason is the point — a suggestion nobody can interrogate is one
      // people learn to ignore. The server writes the day count in Latin
      // digits ("2 দিনের মধ্যে …"), so it is put into Bangla digits here, as
      // the student home does with the same sentence (R6).
      subtitle: bnNum(s.whyBn),
      glyph: KIND_GLYPH[s.kind],
      // Urgency in a word, never in a coloured rail alone (§3).
      status: s.urgency === 'high'
        ? statusBadge(d, { state: 'due', label: 'জরুরি' })
        : undefined,
      onClick: () => go(s.route),
    }))));
  }
}
