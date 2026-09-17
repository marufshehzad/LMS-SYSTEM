/**
 * নোটিফিকেশন — turning push on for this browser.  (R-9)
 *
 * Available to every role, because every role receives notices: a guardian
 * gets their child's absence, a teacher gets the staff notice, a student gets
 * the exam routine. There is nothing to gate here — the only thing this screen
 * can do is register the device of whoever is holding it.
 *
 * ── Why the screen leads with what it costs the school ─────────────────
 * SMS is roughly 80% of a school's running bill (docs/05 §5). A parent turning
 * this on is doing the school a real favour, and saying so is both true and
 * more persuasive than "enable notifications?". It also sets an honest
 * expectation: the school may later stop sending them the SMS.
 *
 * ── Every branch of `pushState` is rendered ────────────────────────────
 * Including the two that have no button. A browser that has blocked
 * notifications shows a button that silently does nothing — the permission
 * prompt never appears again — so `denied` gets an explanation of where the
 * block actually is instead of a control that cannot work.
 *
 * ── Ata Ekta (09 Comms §02, notificationsScreen) ───────────────────────
 * The page is the bar, then an info-tint banner: a bare bell, a title over
 * one line of why, and at most one small button. The design draws only
 * `off`; the other four states keep that shape and spell their state out in
 * the title, so no status chip is needed. The banner is its own screen class
 * (`.push-banner*`), not a restyled card: the drawing is a tinted strip, and
 * the sheet's `.card` / `.ui-card-*` values are not ours to override (R1).
 *
 * The design's five per-category switches (হাজিরা, ফলাফল, …) are not built:
 * the push API has no per-category preference (R3). The device list is not
 * drawn but stays — it is the only way to revoke an old phone.
 */
import type { Auth } from './auth.ts';
import {
  PushClient, pushState, deviceLabelFor,
  type PushState, type PushDevice, type PushStatusResponse,
} from './push-client.ts';
import { errorState, successNote, bnDate } from './view-states.ts';
import {
  pageHeader, dataTable, sectionHeading, button, listSkeleton, el, icon, uid, numText,
  type Child,
} from './ui/index.ts';

export interface NotificationsViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Injected so the suite can drive every state without a real browser. */
  client?: PushClient;
  win?: Window;
}

export class NotificationsView {
  private readonly o: NotificationsViewOptions;
  private readonly client: PushClient;
  private status: PushStatusResponse | null = null;
  private subscribed = false;
  private loading = true;
  /**
   * The last load did not produce a status. Distinct from `error`, which an
   * action (enable, disable, remove) also sets while the status it rendered
   * is still true: only a failed LOAD leaves the screen with nothing to show.
   */
  private loadFailed = false;
  private error = '';
  private notice = '';
  private busy = false;

  constructor(options: NotificationsViewOptions) {
    this.o = options;
    this.client = options.client
      ?? new PushClient((p, i) => options.auth.authedFetch(p, i), options.win);
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.loadFailed = false; this.error = ''; this.render();
    try {
      this.status = await this.client.status();
      if (!this.status) {
        this.loadFailed = true;
        this.error = 'নোটিফিকেশন সেটিংস আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
      }
      this.subscribed = await this.client.isSubscribed();
    } catch {
      this.loadFailed = true;
      this.error = 'নোটিফিকেশন সেটিংস আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false; this.render();
    }
  }

  private state(): PushState {
    const win = this.o.win ?? globalThis.window;
    return pushState({
      hasServiceWorker: Boolean(win?.navigator && 'serviceWorker' in win.navigator),
      hasPushManager: Boolean(win && 'PushManager' in win),
      hasNotification: Boolean(win && 'Notification' in win),
      isSecureContext: Boolean(win?.isSecureContext),
      permission: this.client.permission(),
      serverEnabled: this.status?.enabled === true,
      subscribed: this.subscribed,
    });
  }

  private async enable(): Promise<void> {
    const key = this.status?.publicKey;
    if (!key) return;
    this.busy = true; this.error = ''; this.notice = ''; this.render();
    const r = await this.client.enable(key);
    if (r.ok) {
      this.notice = 'এই যন্ত্রে নোটিফিকেশন চালু হয়েছে।';
      this.subscribed = true;
      // Re-read so the device list shows the row that was just created,
      // rather than appearing only after the next visit.
      this.status = (await this.client.status()) ?? this.status;
    } else {
      this.error = r.message;
    }
    this.busy = false; this.render();
  }

  private async disable(): Promise<void> {
    this.busy = true; this.error = ''; this.notice = ''; this.render();
    const ok = await this.client.disable();
    if (ok) {
      this.notice = 'এই যন্ত্রে নোটিফিকেশন বন্ধ হয়েছে।';
      this.subscribed = false;
      this.status = (await this.client.status()) ?? this.status;
    } else {
      this.error = 'বন্ধ করা যায়নি — আবার চেষ্টা করুন।';
    }
    this.busy = false; this.render();
  }

  private async forget(d: PushDevice): Promise<void> {
    this.busy = true; this.error = ''; this.notice = ''; this.render();
    const ok = await this.client.forget(d.id);
    if (ok) {
      this.notice = 'যন্ত্রটি সরানো হয়েছে।';
      this.status = (await this.client.status()) ?? this.status;
      this.subscribed = await this.client.isSubscribed();
    } else {
      this.error = 'সরানো যায়নি — আবার চেষ্টা করুন।';
    }
    this.busy = false; this.render();
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // The design's bar carries the title alone — no sub-line, nothing on the
    // right. The cost argument the subtitle used to make is the banner's
    // description now.
    root.append(pageHeader(d, { title: 'নোটিফিকেশন' }));

    if (this.notice) root.append(successNote(d, this.notice));
    if (this.error) root.append(errorState(d, this.error, () => void this.load()));
    if (this.loading) { root.append(listSkeleton(d, 2)); return; }
    // A failed load is the error state and nothing else. Without a status,
    // `state()` reads the server as not set up and the device list as empty,
    // so going on would stack two claims the screen does not know to be true
    // ("not enabled on this server", "no devices") under the one it does.
    if (this.loadFailed) return;

    const state = this.state();
    root.append(this.pushBanner(state));

    // ── The other devices this person has registered ──────────────────
    // A table: each device is the same three facts, and a person deciding
    // which old phone to remove is comparing "last message" down a column.
    const devices = this.status?.devices ?? [];
    root.append(sectionHeading(d, { title: 'আপনার যন্ত্রসমূহ' }));
    root.append(dataTable(d, {
      caption: 'নোটিফিকেশন চালু আছে যেসব যন্ত্রে',
      rows: devices,
      rowKey: (dev) => dev.id,
      empty: {
        message: 'কোনো যন্ত্র যুক্ত নেই — যে যন্ত্রে নোটিফিকেশন চালু করবেন, '
          + 'সেটি এখানে দেখা যাবে।',
      },
      columns: [
        { key: 'label', header: 'যন্ত্র', mobile: 'title',
          cell: (dev) => dev.label || deviceLabelFor(''), width: 'minmax(0, 2fr)' },
        // A Bangla date has digits: they go in the numeral face, the month
        // name stays in the text face (R6). The never-sent line has none.
        { key: 'when', header: 'সর্বশেষ বার্তা', mobile: 'subtitle',
          cell: (dev) => (dev.lastSuccessAt
            ? this.dateCell(dev.lastSuccessAt)
            : 'এখনো কোনো বার্তা যায়নি'),
          width: 'minmax(0, 1.4fr)' },
        { key: 'added', header: 'যুক্ত হয়েছে', mobile: 'meta',
          cell: (dev) => this.dateCell(dev.createdAt), width: 'minmax(0, 1.4fr)' },
        // `status`, not the default `meta`: on a phone the remove button sits
        // at the right of its row, not inside the row's meta text line.
        { key: 'actions', header: 'ব্যবস্থা', mobile: 'status', width: '150px',
          cell: (dev) => el(d, 'div', { className: 'ui-row-actions' }, button(d, {
            label: 'সরান', variant: 'secondary', size: 'sm',
            // Per-device: three buttons all called "সরান" are three
            // identical announcements.
            ariaLabel: `${dev.label || deviceLabelFor('')} থেকে নোটিফিকেশন সরান`,
            disabled: this.busy,
            onClick: () => void this.forget(dev),
          })) },
      ],
    }));
  }

  /** A date cell: the date's numbers in the numeral face, its words not (R6). */
  private dateCell(iso: string): HTMLElement {
    const d = this.o.doc;
    return el(d, 'span', {}, ...numText(d, bnDate(iso)));
  }

  /**
   * What this device's notification state is, and the one thing to do about
   * it. Five states, and only two of them have an action — the other three
   * are fixed somewhere this app cannot reach, so they say where.
   *
   * 09 Comms §02 draws it as one row: bell, title over description, button.
   * The title is an h2 — the level the card title held — so heading
   * navigation still meets "this device" before "your devices".
   */
  private pushBanner(state: PushState): HTMLElement {
    const d = this.o.doc;
    const { title, detail, action } = this.bannerCopy(state);
    const titleId = uid('push');
    return el(d, 'section', {
      className: 'push-banner',
      attrs: { 'aria-labelledby': titleId },
      data: { pushState: state },
    },
      el(d, 'span', { className: 'push-banner-glyph' }, icon(d, 'bell')),
      el(d, 'div', { className: 'push-banner-text' },
        el(d, 'h2', { className: 'push-banner-title', attrs: { id: titleId } },
          ...numText(d, title)),
        el(d, 'p', { className: 'push-banner-detail' }, ...numText(d, detail))),
      action);
  }

  /**
   * Who can fix a server with no push keys depends on who is reading.
   *
   * The keys (VAPID) are set where the server is deployed, not in this app,
   * so "tell the school's IT admin" is the right pointer for staff and the
   * wrong one for the IT admin, who would be told to contact themselves. A
   * guardian or student has no line to the IT admin at all; what they need
   * to hear is that nothing is missed meanwhile. Nobody is named: whoever
   * runs the server is the platform, and a tenant screen does not print the
   * platform's brand (D11).
   */
  private unconfiguredDetail(): string {
    const role = this.o.auth.role;
    if (role === 'it_admin') {
      return 'এটি সার্ভারের সেটিং (VAPID কী), এই অ্যাপ থেকে চালু হয় না — '
        + 'সার্ভার যিনি চালান, তাঁকে জানান। ততদিন বার্তা আগের মতোই এসএমএসে যাবে।';
    }
    if (role === 'guardian' || role === 'student') {
      return 'বিদ্যালয় চালু করলে এখান থেকে চালু করতে পারবেন। ততদিন বার্তা আগের মতোই '
        + 'এসএমএসে ও অ্যাপের নোটিশ অংশে পাবেন।';
    }
    return 'বিদ্যালয়ের আইটি অ্যাডমিনকে জানাতে পারেন।';
  }

  private bannerCopy(state: PushState): { title: string; detail: string; action?: Child } {
    const d = this.o.doc;
    switch (state) {
      case 'on':
        return {
          title: 'এই যন্ত্রে নোটিফিকেশন চালু আছে।',
          detail: 'নোটিফিকেশন চালু থাকলে বিদ্যালয়ের বার্তা সঙ্গে সঙ্গে এই যন্ত্রে আসবে — '
            + 'ইন্টারনেট খরচ প্রায় শূন্য, আর বিদ্যালয়ের এসএমএস খরচ কমে।',
          action: button(d, {
            label: 'এই যন্ত্রে বন্ধ করুন', variant: 'secondary', size: 'sm', busy: this.busy,
            onClick: () => void this.disable(),
          }),
        };
      case 'denied':
        // The one state where the fix is entirely outside the app. A button
        // here would call requestPermission(), which returns 'denied'
        // immediately without showing anything, and look like a broken app.
        return {
          title: 'ব্রাউজারে নোটিফিকেশন বন্ধ করা আছে।',
          detail: 'ঠিকানার পাশের তালা চিহ্নে চাপ দিয়ে "নোটিফিকেশন" চালু করুন, '
            + 'তারপর এই পাতা আবার খুলুন।',
        };
      case 'unsupported':
        // Not a dead end: the SMS path is unaffected, and saying so stops
        // somebody concluding they will now miss their child's absence.
        return {
          title: 'এই ব্রাউজারে নোটিফিকেশন সমর্থিত নয়।',
          detail: 'বিদ্যালয়ের বার্তা আগের মতোই এসএমএসে ও অ্যাপের নোটিশ অংশে পাবেন।',
        };
      case 'unconfigured':
        return {
          title: 'এই সার্ভারে এখনো নোটিফিকেশন চালু করা হয়নি।',
          detail: this.unconfiguredDetail(),
        };
      default:
        // `off` — the one state the design draws, in its own words. The
        // page's single primary.
        return {
          title: 'এই যন্ত্রে বার্তা চালু করুন',
          detail: 'চালু করলে এসএমএসের বদলে অ্যাপেই বার্তা আসবে — বিদ্যালয়ের খরচ কমে',
          action: button(d, {
            label: 'চালু করুন', variant: 'primary', size: 'sm', busy: this.busy,
            onClick: () => void this.enable(),
          }),
        };
    }
  }
}
