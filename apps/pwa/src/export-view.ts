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
 */
import type { Auth } from './auth.ts';
import { errorState, successNote } from './view-states.ts';
import {
  pageHeader, sectionHeading, card, button, permissionState, el, append,
} from './ui/index.ts';

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
  /** What is actually in the file, in the words a head teacher would use. */
  containsBn: string;
  /** The service that owns the data. */
  service: string;
}

/**
 * The datasets, in the order P11 §30 builds them.
 *
 * Only the ones that EXIST are listed. A row for a dataset whose endpoint is
 * not written yet would be a button that 400s, and a screen that offers a
 * school nine exports and delivers one is worse than a screen that offers
 * one — it is the "backend complete, UI pending" shape D13 exists to stop,
 * pointed the other way round.
 */
const DATASETS: Dataset[] = [
  {
    key: 'students',
    titleBn: 'শিক্ষার্থী',
    containsBn: 'নাম, শিক্ষার্থী আইডি, শ্রেণি, শাখা, রোল, শিক্ষাবর্ষ, '
      + 'ভর্তির তারিখ, বোর্ড রেজিস্ট্রেশন ও রোল, অভিভাবকের নাম এবং বর্তমান অবস্থা। '
      + 'ছাড়পত্র নেওয়া ও শাখায় বসানো হয়নি এমন শিক্ষার্থীও এতে থাকবে।',
    service: 'academics',
  },
];

export class ExportView {
  private readonly o: ExportViewOptions;
  private notice = '';
  private error = '';
  /** The dataset currently being fetched, so only ITS button is busy. */
  private busy = '';

  constructor(options: ExportViewOptions) {
    this.o = options;
    this.render();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    root.append(pageHeader(d, {
      title: 'তথ্য রপ্তানি',
      subtitle: 'প্রতিষ্ঠানের নিজের তথ্য নিজের কাছে রাখুন',
    }));

    if (!EXPORT_ROLES.has(this.o.auth.role)) {
      root.append(permissionState(d, {
        message: 'প্রতিষ্ঠানের পূর্ণ তথ্য রপ্তানি করতে পারেন কেবল প্রধান শিক্ষক '
          + 'বা আইটি অ্যাডমিন। আপনার নিজের শ্রেণির তালিকা রোস্টার পাতায় দেখা যাবে।',
      }));
      return;
    }

    if (this.error) root.append(errorState(d, this.error));
    if (this.notice) root.append(successNote(d, this.notice));

    root.append(sectionHeading(d, { title: 'কী রপ্তানি করবেন' }));

    // The one thing a head teacher should read before pressing anything.
    root.append(card(d, { title: 'ফাইলটি কী', glyph: 'book-open', headingLevel: 3 },
      el(d, 'p', {
        className: 'ui-card-note',
        text: 'প্রতিটি ফাইল CSV — এক্সেল, গুগল শিট বা লিব্রেঅফিসে সরাসরি খোলে। '
            + 'বাংলা লেখা ঠিকভাবে দেখাবে। ফাইলটি আপনার যন্ত্রে নামবে, কোথাও জমা থাকবে না, '
            + 'এবং কে কখন রপ্তানি করলেন তা কার্যবিবরণীতে লেখা থাকবে।',
      })));

    for (const ds of DATASETS) root.append(this.datasetCard(ds));
  }

  private datasetCard(ds: Dataset): HTMLElement {
    const d = this.o.doc;
    const body = el(d, 'div', { className: 'ui-stack' });

    append(body, el(d, 'p', { className: 'ui-card-note', text: ds.containsBn }));

    const go = button(d, {
      label: this.busy === ds.key ? 'ফাইল তৈরি হচ্ছে…' : 'CSV নামান',
      variant: 'primary',
      glyph: 'download',
      onClick: () => { void this.download(ds); },
    });
    // Disabled while its own request is in flight — a second press would
    // start a second full query against the same school.
    if (this.busy) go.setAttribute('disabled', 'true');
    append(body, go);

    return card(d, { title: ds.titleBn, glyph: 'check-square', headingLevel: 3 }, body);
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
    this.error = '';
    this.notice = '';
    this.render();

    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/${ds.service}/export?dataset=${encodeURIComponent(ds.key)}`);

      if (!res.ok) {
        // `isDenied` takes a thrown error, not a status; this path has a
        // Response in hand, so the status is read directly.
        this.error = res.status === 403
          ? 'এই তথ্য রপ্তানির অনুমতি আপনার নেই।'
          : 'ফাইল তৈরি করা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।';
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

      this.notice = `${ds.titleBn} ফাইল নামানো হয়েছে — ${filename}`;
    } catch {
      this.error = 'ফাইল তৈরি করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।';
    } finally {
      this.busy = '';
      this.render();
    }
  }
}
