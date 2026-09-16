/**
 * নোটিশ — the inbox behind the bell  (R-2, docs/11-MASTER-PLAN.md)
 *
 * Every role has one. What differs is what is in it, and that was decided when
 * the notice was published and the receipts were written — this screen does not
 * interpret audiences at all, it lists the caller's own receipts.
 *
 * ── Reading is a side effect of opening, not a button ───────────────────
 * A notice is marked read when its body is expanded. An explicit "mark as
 * read" control asks a guardian to do bookkeeping for the school's benefit;
 * expanding it is already the act of reading it. "সব পড়া হয়েছে" exists for the
 * backlog case — a teacher returning from leave to 40 notices — and is the
 * only place the user is asked to declare anything.
 *
 * ── Unread is a state, not a colour ─────────────────────────────────────
 * Unread rows carry a marker and a heavier title, not only a tint: the
 * reference device is a 2 GB Android phone in daylight, and a pale background
 * difference is the first thing that stops being visible.
 *
 * ── Ata Ekta (09 Comms §02) ─────────────────────────────────────────────
 * One flat surface of rows, no cards: a dot, the title over a one-line
 * preview, and the time at the end. The dot is present on EVERY row — clear on
 * a read one — so the text column never shifts between the two states. Below
 * 1024px the time drops under the text (01 Shell's phone panel); one DOM, the
 * stylesheet decides.
 */
import type { Auth } from './auth.ts';
import { CATEGORY_LABELS_BN } from '../../../packages/ui-core/src/notice.ts';
import { emptyState, errorState, bnNum } from './view-states.ts';
import {
  pageHeader, button, badge, listSkeleton, numText, append,
  permissionState, permissionMessage, serverMessage, deniedContact,
} from './ui/index.ts';

export interface InboxNotice {
  receiptId: string;
  noticeId: string;
  title: string;
  body: string;
  category: string;
  deliveredAt: string;
  readAt: string | null;
  aboutStudent: { id: string; nameBn: string | null } | null;
}

export interface InboxViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Called after a read so the shell's badge can follow without a refetch. */
  onUnreadChange?: (unread: number) => void;
}

/** "আজ" / "গতকাল" / a date — a timestamp is not what a reader wants. */
export function relativeDayBn(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return 'আজ';
  if (days === 1) return 'গতকাল';
  // Bangla digits (R6): the count sat in Latin between two Bangla words.
  if (days < 7) return `${bnNum(days)} দিন আগে`;
  return new Date(then).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' });
}

/**
 * The row's time, as 09 Comms draws it: "আজ ০৯:৪০", "গতকাল ১৬:২০",
 * "৩ দিন আগে", "১ সপ্তাহ আগে", then a date.
 *
 * The clock is added only for today and yesterday — the two cases where "when
 * in the day" still answers something. Weeks run from 7 to 27 days; after
 * that relativeDayBn's date is plainer than "৫ সপ্তাহ আগে". 24-hour, because `bn-BD` renders the
 * 12-hour marker as a Latin "AM"/"PM" inside a Bangla line (see bnDateTime).
 */
export function noticeWhenBn(iso: string, now = Date.now()): string {
  const day = relativeDayBn(iso, now);
  if (!day) return '';
  const then = Date.parse(iso);
  if (day === 'আজ' || day === 'গতকাল') {
    // relativeDayBn counts 24-hour windows, not calendar days: at 10:00 a
    // notice from 23:00 last night is "আজ". A clock beside that word would
    // print "আজ ২৩:০০" — a time that has not happened yet today — so the
    // clock is added only where the word and the calendar agree.
    const key = (t: Date) => `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
    const ref = new Date(now);
    if (day === 'গতকাল') ref.setDate(ref.getDate() - 1);
    if (key(new Date(then)) !== key(ref)) return day;
    try {
      const clock = new Date(then).toLocaleTimeString('bn-BD', {
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      // bnNum: an ICU without Bangla data prints Latin digits here.
      return clock ? `${day} ${bnNum(clock)}` : day;
    } catch {
      return day;
    }
  }
  const days = Math.floor((now - then) / 86_400_000);
  if (days >= 7 && days < 28) return `${bnNum(Math.floor(days / 7))} সপ্তাহ আগে`;
  return bnNum(day);
}

/** Longest preview kept in the DOM; more than a wide desktop line shows. */
const PREVIEW_MAX = 200;

/**
 * The closed row's one line: whitespace folded (the line is `nowrap` anyway, so
 * the cap is spent on visible text), cut back to a word boundary so a Bangla
 * conjunct or a surrogate pair is never split, and marked "…" when cut — on a
 * monitor wide enough to show all 200 characters, CSS ellipsis would not fire
 * and the line would simply stop mid-word.
 */
function previewText(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= PREVIEW_MAX) return flat;
  let end = flat.lastIndexOf(' ', PREVIEW_MAX);
  if (end < PREVIEW_MAX / 2) {
    // One very long "word" (a URL, an unspaced line): cut at the cap, but not
    // between the halves of a surrogate pair.
    end = PREVIEW_MAX;
    const last = flat.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return `${flat.slice(0, end).trimEnd()}…`;
}

export class InboxView {
  private readonly o: InboxViewOptions;
  private notices: InboxNotice[] = [];
  private unread = 0;
  private loading = true;
  private error = '';
  /** The refusal sentence when the server says no; a denied inbox has no retry. */
  private denied = '';
  private deniedWho: string | undefined;
  private expanded = new Set<string>();

  constructor(options: InboxViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/inbox?limit=50');
      if (res.status === 403) {
        // A refusal is a sentence, not "could not load" with a retry button:
        // retrying a permission failure is hammering a locked door.
        let body: { message?: unknown; error?: unknown } | null = null;
        try { body = await res.json(); } catch { /* no body */ }
        this.denied = serverMessage(body, 403, permissionMessage('নোটিশ'), 'নোটিশ');
        this.deniedWho = deniedContact({ code: body?.error });
        this.error = '';
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { unread: number; notices: InboxNotice[] };
      this.notices = body.notices ?? [];
      this.unread = body.unread ?? 0;
      this.error = '';
      this.denied = '';
      this.o.onUnreadChange?.(this.unread);
    } catch {
      // Offline is expected on this product's reference network. The service
      // worker serves the last inbox from cache; if even that is absent, say
      // so plainly rather than showing an empty inbox, which reads as
      // "nothing has happened" and is a different, wrong claim.
      if (this.notices.length === 0) this.error = 'নোটিশ আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async markRead(noticeId: string): Promise<void> {
    const row = this.notices.find((n) => n.noticeId === noticeId);
    if (!row || row.readAt) return;
    // Optimistic: the badge should drop the instant it is opened, and a failed
    // request costs nothing but a re-mark on the next load.
    row.readAt = new Date().toISOString();
    this.unread = Math.max(0, this.unread - 1);
    this.o.onUnreadChange?.(this.unread);
    this.render();
    try {
      await this.o.auth.authedFetch('/api/v1/ops/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noticeId }),
      });
    } catch { /* the next load re-marks it */ }
  }

  private async markAllRead(): Promise<void> {
    for (const n of this.notices) n.readAt ??= new Date().toISOString();
    this.unread = 0;
    this.o.onUnreadChange?.(0);
    this.render();
    try {
      await this.o.auth.authedFetch('/api/v1/ops/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch { /* the next load re-marks them */ }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // 09 Comms bar: the title alone, then "৩ পড়া হয়নি" and the small outline
    // "সব পড়া হয়েছে" together on the right. The count is exact — a chip with
    // words has room for "১২", unlike the bell's capped counter.
    root.append(pageHeader(d, {
      title: 'নোটিশ',
      actions: this.unread > 0
        ? [
            badge(d, {
              label: `${bnNum(this.unread)} পড়া হয়নি`,
              tone: 'neutral',
              className: 'inbox-unread',
            }),
            button(d, {
              label: 'সব পড়া হয়েছে', variant: 'secondary', size: 'sm',
              onClick: () => { void this.markAllRead(); },
            }),
          ]
        : undefined,
    }));

    if (this.loading) { root.append(listSkeleton(d, 4)); return; }

    if (this.denied) {
      root.append(permissionState(d, { message: this.denied, contact: this.deniedWho }));
      return;
    }

    if (this.error) {
      root.append(errorState(d, this.error, () => { void this.load(); }));
      // Nothing to list under it: an empty bordered shell beneath an error
      // would read as a second, blank answer.
      if (this.notices.length === 0) return;
    }

    if (this.notices.length === 0) {
      // The default empty glyph (`inbox`) is the one 14 Components §06 draws.
      // No action button: nobody who reads an inbox can make a notice arrive.
      root.append(emptyState(d, {
        message: 'এখনো কোনো নোটিশ নেই। বিদ্যালয় কিছু জানালে এখানে দেখা যাবে।',
      }));
      return;
    }

    // A DISCLOSURE list, not a `dataTable`: a notice is a title that opens
    // into a paragraph, and a table cell cannot hold a paragraph.
    const list = d.createElement('div');
    list.className = 'notice-list';

    for (const n of this.notices) {
      const item = d.createElement('article');
      item.className = 'notice-card';
      if (!n.readAt) item.classList.add('unread');
      const urgent = n.category === 'emergency';
      if (urgent) item.classList.add('urgent');

      const head = d.createElement('button');
      head.type = 'button';
      head.className = 'notice-head';
      const open = this.expanded.has(n.noticeId);
      head.setAttribute('aria-expanded', String(open));

      // The marker comes first and is always there; a read row's is clear
      // and silent, an unread row's is filled and named.
      const dot = d.createElement('span');
      dot.className = 'notice-dot';
      if (!n.readAt) dot.setAttribute('aria-label', 'পড়া হয়নি');
      else dot.setAttribute('aria-hidden', 'true');

      const main = d.createElement('span');
      main.className = 'notice-main';
      const title = d.createElement('span');
      title.className = 'notice-title';
      title.textContent = n.title;
      main.append(title);

      // Not drawn in 09 Comms, and kept on purpose. A guardian with two
      // children needs to know WHICH child this is about before they read a
      // word of it; and an emergency says so in a word, not only in red.
      const who = n.aboutStudent?.nameBn ?? '';
      if (urgent || who) {
        const meta = d.createElement('span');
        meta.className = 'notice-meta';
        if (urgent) {
          const word = d.createElement('span');
          word.className = 'notice-urgent';
          word.textContent = CATEGORY_LABELS_BN.emergency;
          meta.append(word);
        }
        if (urgent && who) meta.append(d.createTextNode(' · '));
        if (who) meta.append(d.createTextNode(who));
        main.append(meta);
      }

      if (!open) {
        // One line of the message while closed, as drawn. textContent, never
        // innerHTML — the same rule as the full body below.
        //
        // aria-hidden: this span sits inside the disclosure button, so its
        // text would become part of the button's accessible name. A
        // screen-reader user tabbing down fifty rows would hear every whole
        // body on every stop — and would have "read" each notice without
        // opening it. The body is announced where it belongs: in
        // p.notice-body once the row is opened.
        //
        // Capped, because the CSS shows one clipped line: fifty full bodies in
        // the DOM for that is waste on the 2 GB reference phone.
        const preview = d.createElement('span');
        preview.className = 'notice-preview';
        preview.setAttribute('aria-hidden', 'true');
        preview.textContent = previewText(n.body);
        main.append(preview);
      }

      const when = d.createElement('span');
      when.className = 'notice-time';
      // The number face on the figure only ("আজ <n>০৯:৪০</n>"), per R6.
      append(when, ...numText(d, noticeWhenBn(n.deliveredAt)));

      head.append(dot, main, when);

      head.addEventListener('click', () => {
        if (this.expanded.has(n.noticeId)) this.expanded.delete(n.noticeId);
        else {
          this.expanded.add(n.noticeId);
          void this.markRead(n.noticeId);
        }
        this.render();
      });

      item.append(head);

      if (open) {
        const body = d.createElement('p');
        body.className = 'notice-body';
        // textContent, never innerHTML: this string was typed by a person at
        // the school and is being placed in every reader's browser.
        body.textContent = n.body;
        item.append(body);
      }

      list.append(item);
    }

    root.append(list);
  }
}
