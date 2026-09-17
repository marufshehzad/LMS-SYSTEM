/**
 * তথ্য রপ্তানি — the school's own copy of its own data.  (P11)
 *
 * Until this screen the only file this product ever handed a school was the
 * error list from a failed import. Everything else a school typed in stayed
 * in, visible through our screens and reachable no other way. That is the
 * "clearest customer-trust gap" the Master Plan names, and this is the
 * screen that closes it.
 *
 * ── Why a download and not a preview ────────────────────────────────────
 * There is no table on this page and that is deliberate. A preview of two
 * thousand students is a second implementation of the roster screen, it is
 * slower than the download, and it invites the reading that the file is what
 * is on screen. The page states what each dataset contains, and the button
 * produces the file.
 *
 * ── The download itself ─────────────────────────────────────────────────
 * `authedFetch` → Blob → an object URL clicked once. A plain `<a href>` to
 * the endpoint cannot work: the access token lives in memory, not a cookie,
 * so a browser-initiated navigation arrives unauthenticated and the school
 * gets a 401 page instead of their data. Fetching it in the app is what
 * makes the Authorization header travel with the request.
 *
 * ── Ata Ekta (07 Finance §05) ───────────────────────────────────────────
 * The page title alone, one intro line, then a plain stack of file rows:
 * file glyph, name, a one-line "what columns" sub-line, and a small outline
 * "নামান". No cards, no section heading, and no accent button anywhere — ten
 * red buttons on one page is ten "the one thing this page is for", which is
 * none. Every row is a `listItem` in one `list`, so the markup is the one the
 * rest of the app's lists use; the only screen classes are `export-intro`,
 * `export-files` (layout and the phone stacking, 13 Responsive rule ০৮) and
 * `export-result`, the error or success message a press draws inside the
 * row that was pressed (UX 44).
 */
import type { Auth } from './auth.ts';
import { errorState, successNote } from './view-states.ts';
import {
  pageHeader, button, list, listItem, permissionState, el, numText,
} from './ui/index.ts';
import { navPaths } from './ui/nav.ts';

export interface ExportViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/**
 * Who sees this screen at all.
 *
 * The same three the server enforces. Duplicated deliberately and narrowly:
 * the server is the authority and refuses regardless, but a button that
 * exists only to answer 403 teaches a class teacher that the product is
 * broken rather than that the action is not theirs.
 */
const EXPORT_ROLES = new Set(['principal', 'school_owner', 'it_admin']);

interface Dataset {
  /** Query value — must match the server's DATASETS set. */
  key: string;
  titleBn: string;
  /**
   * What is actually in the file, as the design's sub-line draws it: the
   * columns, then ` · ` and the one caveat a head teacher needs before
   * trusting the file (what is included that they might not expect, or what
   * is deliberately left out). Short enough to read as one line on a desk.
   */
  containsBn: string;
  /** The service that owns the data. */
  service: string;
}

/**
 * The datasets.
 *
 * Only the ones that EXIST are listed. A row for a dataset whose endpoint is
 * not written yet would be a button that 400s, and a screen that offers a
 * school nine exports and delivers one is worse than a screen that offers
 * one — it is the "backend complete, UI pending" shape D13 exists to stop,
 * pointed the other way round.
 *
 * Order: the four 07 Finance §05 draws, in its order (students, attendance,
 * fees, results — the files a school asks for most), then the other six,
 * with the offboarding checklist last because it points back at the rest.
 */
const DATASETS: Dataset[] = [
  {
    key: 'students',
    titleBn: 'শিক্ষার্থীর তালিকা',
    containsBn: 'নাম, আইডি, শ্রেণি, শাখা, রোল, শিক্ষাবর্ষ, ভর্তির তারিখ, '
      + 'বোর্ড রেজিস্ট্রেশন ও রোল, অভিভাবক, অবস্থা · '
      + 'ছাড়পত্র নেওয়া ও শাখায় না বসানো শিক্ষার্থীসহ',
    service: 'academics',
  },
  {
    key: 'attendance',
    titleBn: 'হাজিরার হিসাব',
    containsBn: 'দৈনিক প্রকৃত রেকর্ড · তারিখ, পিরিয়ড, বিষয়, '
      + 'উপস্থিত/অনুপস্থিত/দেরি, দেরির মিনিট, কে হাজিরা নিয়েছেন',
    service: 'academics',
  },
  {
    key: 'fees',
    titleBn: 'বেতন ও বকেয়া',
    containsBn: 'প্রতি ইনভয়েসে এক সারি · খাত, অঙ্ক, জমা, বকেয়া, রসিদ নম্বর, মাধ্যম · '
      + 'অঙ্ক সংখ্যায় থাকে, এক্সেলে যোগ করা যায়',
    service: 'finance',
  },
  {
    key: 'results',
    titleBn: 'পরীক্ষার নম্বর',
    containsBn: 'বিষয়ভিত্তিক · সৃজনশীল, নৈর্ব্যক্তিক, ব্যবহারিক, ধারাবাহিক, মোট, '
      + 'গ্রেড, গ্রেড পয়েন্ট · অপ্রকাশিত পরীক্ষাও, অবস্থাসহ',
    service: 'academics',
  },
  {
    key: 'teachers',
    titleBn: 'শিক্ষক ও কর্মী',
    containsBn: 'নাম, কর্মচারী আইডি, পদবি, ভূমিকা, মোবাইল, ইমেইল, যোগদানের তারিখ, '
      + 'শ্রেণি শিক্ষকতা, বিষয় · ব্যাংক হিসাব বা কোনো গোপন তথ্য থাকে না',
    service: 'ops',
  },
  {
    key: 'guardians',
    titleBn: 'অভিভাবক',
    containsBn: 'প্রতি অভিভাবক–শিক্ষার্থী সম্পর্কে এক সারি · নাম, মোবাইল, সম্পর্ক, '
      + 'কে এসএমএস পান, কে ফি দিতে পারেন · প্রত্যাহৃত সম্পর্কসহ',
    service: 'ops',
  },
  {
    key: 'structure',
    titleBn: 'একাডেমিক কাঠামো',
    containsBn: 'প্রতি সেকশনে এক সারি · শিক্ষাবর্ষ, শ্রেণি, শাখা, গ্রুপ, শিফট, '
      + 'ধারণক্ষমতা, শ্রেণি শিক্ষক, কক্ষ',
    service: 'ops',
  },
  {
    key: 'notices',
    titleBn: 'নোটিশ',
    containsBn: 'শিরোনাম, পূর্ণ বিবরণ, প্রাপক, প্রকাশের তারিখ · খসড়াসহ',
    service: 'ops',
  },
  {
    key: 'audit',
    titleBn: 'কার্যবিবরণী',
    containsBn: 'কে, কখন, কী পরিবর্তন করেছেন · '
      + 'ফোন, ইমেইল, জন্ম তারিখ পর্দার মতোই আড়াল থাকে',
    service: 'ops',
  },
  {
    key: 'offboarding',
    titleBn: 'প্রতিষ্ঠান ছেড়ে যাওয়ার তালিকা',
    containsBn: 'কোন ডেটাসেটে কত সারি, কোথা থেকে নামাবেন · '
      + 'কিছু মোছে না, প্রতিষ্ঠান বন্ধ করে না',
    service: 'ops',
  },
];

/**
 * What the last press produced, and for which file.
 *
 * UX 44: the message used to be drawn above the intro, so on a phone a press
 * on any row below the fold showed nothing at all, and the card pushed the
 * whole list down under the finger. It now belongs to its row.
 */
interface Outcome {
  key: string;
  text: string;
  failed: boolean;
  /** False for a refusal: pressing again cannot change a 403. */
  retry: boolean;
}

export class ExportView {
  private readonly o: ExportViewOptions;
  private outcome: Outcome | null = null;
  /** The dataset currently being fetched, so only ITS button is busy. */
  private busy = '';
  /** The file list. Built once; a press rebuilds its rows, never the page. */
  private files: HTMLElement | null = null;

  constructor(options: ExportViewOptions) {
    this.o = options;
    this.render();
  }

  /**
   * The page, once. A press used to rebuild all of it (UX 44), so the button
   * that had focus went with it, and every direct child of the shell's view
   * replayed its entrance animation: the whole screen blinked twice per file.
   */
  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // 07 Finance §05 draws the bar with the title alone — the intro line
    // below carries the explanation a subtitle used to.
    root.append(pageHeader(d, { title: 'তথ্য রপ্তানি' }));

    if (!EXPORT_ROLES.has(this.o.auth.role)) {
      // The roster pointer only for a role that has a roster page. An
      // accountant, a student or a guardian has no class of their own, and
      // the roster refuses them too (minors 60, 101).
      const roster = navPaths(this.o.auth.role).includes('roster')
        ? ' আপনার নিজের শ্রেণির তালিকা রোস্টার পাতায় দেখা যাবে।'
        : '';
      root.append(permissionState(d, {
        message: 'প্রতিষ্ঠানের পূর্ণ তথ্য রপ্তানি করতে পারেন কেবল প্রধান শিক্ষক '
          + `বা আইটি অ্যাডমিন।${roster}`,
      }));
      return;
    }

    // The one thing a head teacher should read before pressing anything. The
    // first two sentences are the design's; the third is the P11 disclosure
    // that an export is itself recorded, which stays because it is true and
    // the file holds other people's data.
    root.append(el(d, 'p', { className: 'export-intro' },
      ...numText(d, 'CSV ফাইল — এক্সেলে সরাসরি খোলে। '
        + 'বাংলা লেখা ঠিকভাবে দেখাতে UTF-8 ব্যবহার করা হয়। '
        + 'কে কখন রপ্তানি করলেন তা কার্যবিবরণীতে লেখা থাকে।')));

    this.files = list(d, 'রপ্তানিযোগ্য ফাইল', ...DATASETS.map((ds) => this.datasetRow(ds)));
    this.files.classList.add('export-files');
    root.append(this.files);
  }

  /**
   * The rows again, for a press. `anchor` is the key of the row the person
   * just pressed. A rebuild drops the previous press's message, and when that
   * message sat above this row the row slid up under the person's hand; the
   * scroll takes the difference back, so the row stays where it was pressed.
   *
   * Both positions are on-screen ones, and the second is read after the
   * rebuild. At the foot of the page the browser has already pulled the
   * scroll back when the page got shorter, so the row did not move and must
   * not be moved again — a correction by the removed height alone pushed the
   * pressed button below the tab bar for as long as the file took.
   *
   * While the file is being made the list may also keep the height it had. A
   * message removed from BELOW the pressed button (a later row's, or this
   * row's own error when আবার চেষ্টা করুন is pressed) shortens the page, and
   * at its foot the browser then pulls everything down, the pressed row with
   * it, where no scroll can take it back. A message above the button needs no
   * hold: the scroll takes that one back. The height is let go with the
   * result, which is scrolled into view on its own.
   */
  private renderRows(anchor: string): void {
    const files = this.files;
    if (!files) return;
    const scroller = scrollerOf(files);
    const before = this.rowOnScreen(anchor, scroller);
    const gone = files.querySelector('.export-result');
    const pressed = this.row(anchor);
    const hold = this.busy && gone && pressed
      && !(pressed.compareDocumentPosition(gone) & pressed.DOCUMENT_POSITION_PRECEDING)
      ? files.offsetHeight : 0;
    files.textContent = '';
    files.append(...DATASETS.map((ds) => this.datasetRow(ds)));
    files.style.minHeight = hold > 0 ? `${hold}px` : '';
    if (before === null) return;
    const after = this.rowOnScreen(anchor, scroller);
    if (after !== null && Math.abs(after - before) >= 1) scroller.by(after - before);
  }

  private datasetRow(ds: Dataset): HTMLElement {
    const d = this.o.doc;
    const mine = this.busy === ds.key;

    const go = button(d, {
      label: mine ? 'ফাইল তৈরি হচ্ছে…' : 'নামান',
      variant: 'secondary',
      size: 'sm',
      busy: mine,
      // Disabled while any request is in flight — a second press would
      // start a second full query against the same school.
      disabled: Boolean(this.busy),
      // Ten visible "নামান" buttons would be ten identical names to a screen
      // reader. The name starts with the file and ends with the visible word,
      // so a voice user who says what they see still reaches it.
      ariaLabel: `${ds.titleBn} — ${mine ? 'ফাইল তৈরি হচ্ছে…' : 'CSV নামান'}`,
      // The label changes while the file is made; this is what the shell's
      // focus keeper follows back to the rebuilt button.
      attrs: { 'data-focus-key': `export-${ds.key}` },
      onClick: () => { void this.download(ds); },
    });

    const row = listItem(d, {
      title: ds.titleBn,
      subtitle: ds.containsBn,
      glyph: 'file-text',
      status: go,
    });
    row.dataset.key = ds.key;

    // The result of a press, directly under the button that was pressed:
    // in view wherever the row is, and nothing above the row moves.
    const out = this.outcome;
    if (out && out.key === ds.key && !mine) {
      // The retry button goes away with the next render; the row's data-key
      // is what lets the shell's focus keeper land on this file's own button
      // instead, whether the second try fails or succeeds.
      const retry = out.retry ? () => { void this.download(ds); } : undefined;
      row.append(el(d, 'div', { className: 'export-result' },
        out.failed ? errorState(d, out.text, retry) : successNote(d, out.text)));
    }
    return row;
  }

  /**
   * This view's own row, looked up in its own list. Not in the shell's view:
   * a file still being made when the person leaves and comes back finishes
   * into this, now detached, list, and must not scroll the new page's row.
   */
  private row(key: string): HTMLElement | null {
    return this.files?.querySelector<HTMLElement>(`[data-key="${key}"]`) ?? null;
  }

  /**
   * Where the row is on screen: its layout position less the scroll. From
   * offsets rather than getBoundingClientRect, so a transform — the shell's
   * `rise` entrance, 8px, while the page is still arriving — is not read as
   * the row having moved. Reading offsetTop first brings layout up to date,
   * so the scroll read after it is the one the browser clamped.
   */
  private rowOnScreen(key: string, scroller: Scroller): number | null {
    let n = this.row(key);
    if (!n) return null;
    let top = 0;
    for (; n; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
    return top - scroller.top();
  }

  /**
   * Fetch the file and hand it to the browser.
   *
   * The status is announced rather than only shown: the visible change on
   * success is a file appearing in a downloads tray the page cannot see, so
   * without `successNote` a screen-reader user gets no confirmation that
   * anything happened at all.
   */
  private async download(ds: Dataset): Promise<void> {
    this.busy = ds.key;
    this.outcome = null;
    this.renderRows(ds.key);

    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/${ds.service}/export?dataset=${encodeURIComponent(ds.key)}`);

      if (!res.ok) {
        // `isDenied` takes a thrown error, not a status; this path has a
        // Response in hand, so the status is read directly.
        const denied = res.status === 403;
        this.outcome = {
          key: ds.key,
          failed: true,
          retry: !denied,
          text: denied
            ? 'এই তথ্য রপ্তানির অনুমতি আপনার নেই।'
            : 'ফাইল তৈরি করা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।',
        };
        return;
      }

      const blob = await res.blob();
      // The server named the file; use its name so what lands on the desk
      // matches what the audit entry describes.
      const named = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
      const filename = named ? named[1] : `${ds.key}.csv`;

      const url = URL.createObjectURL(blob);
      const a = this.o.doc.createElement('a');
      a.href = url;
      a.download = filename;
      // Firefox needs the anchor in the document before a synthetic click.
      this.o.doc.body.append(a);
      a.click();
      a.remove();
      // Revoked on the next tick: revoking synchronously races the download
      // in Safari, which reads the blob after the handler returns.
      setTimeout(() => { URL.revokeObjectURL(url); }, 0);

      // successNote sets the date digits of the server's filename
      // (students-2026-09-16.csv) in the numeral face itself (R6).
      this.outcome = {
        key: ds.key,
        failed: false,
        retry: false,
        text: `${ds.titleBn} ফাইল নামানো হয়েছে — ${filename}`,
      };
    } catch {
      this.outcome = {
        key: ds.key,
        failed: true,
        retry: true,
        text: 'ফাইল তৈরি করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।',
      };
    } finally {
      this.busy = '';
      this.renderRows(ds.key);
      // A row near the bottom edge would put its message below the fold.
      // `nearest` scrolls only as far as needed, and the sheet's
      // scroll-padding keeps it clear of the tab bar. Not once the person has
      // left: this list is no longer on the page.
      const row = this.row(ds.key);
      if (row?.isConnected && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
    }
  }
}

interface Scroller {
  top(): number;
  by(dy: number): void;
}

/**
 * Whatever scrolls the page: the nearest scrolling ancestor, or the window
 * (the shell scrolls the window at every width today). Found once, before a
 * rebuild, so the same one is read before and after it.
 */
function scrollerOf(from: HTMLElement): Scroller {
  const doc = from.ownerDocument;
  const win = doc.defaultView;
  for (let n: HTMLElement | null = from.parentElement;
    n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
    const overflow = win?.getComputedStyle(n).overflowY ?? '';
    if ((overflow === 'auto' || overflow === 'scroll') && n.scrollHeight > n.clientHeight) {
      const box = n;
      return { top: () => box.scrollTop, by: (dy) => { box.scrollTop += dy; } };
    }
  }
  return {
    top: () => win?.scrollY ?? 0,
    by: (dy) => { try { win?.scrollBy(0, dy); } catch { /* not a browser */ } },
  };
}
