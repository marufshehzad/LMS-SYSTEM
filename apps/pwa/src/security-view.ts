/**
 * নিরাপত্তা → যেসব যন্ত্রে খোলা আছে — where am I signed in.  (B-120)
 *
 * `user_sessions` has recorded every sign-in since migration 002 and nothing
 * ever showed it to the person it belongs to. `logout` ends the session
 * making the request; somebody whose phone was stolen had no way to end that
 * phone and the practical answer was to wait out the refresh token.
 *
 * ── Deliberately one panel with two kinds of button ─────────────────────
 * This is a security surface a worried person reaches in a hurry, so it says
 * one thing per line and nothing it does not have to. No IP address, no
 * map, no raw user agent — the server sends "Chrome · Windows" and this
 * renders it. A device it cannot name says so rather than showing a blank,
 * because an unnamed device is still one somebody may want to end.
 *
 * Ata Ekta (01 Shell & Auth §ঙ): one panel — a head over a 2px rule, one row
 * per device with the current device first, and a footer holding the one
 * destructive action. No section headings, no per-device cards, no badges.
 *
 * ── The confirmation is not decoration ──────────────────────────────────
 * Both actions are irreversible from the user's side: the other device has
 * to sign in again, and on a school phone that means finding the OTP. So
 * each goes through `confirmOverlay` (IMPLEMENTATION §7 — a modal at 1024px
 * and up, a bottom sheet on a phone, focus on বাতিল), names its consequence
 * before it happens, and the one that ends several devices says how many.
 */
import type { Auth } from './auth.ts';
import { hasIcon } from './icon.ts';
import { isDenied, refuseUnlessOk } from './http-status.ts';
import { errorState, successNote, bnDateTime, bnNum } from './view-states.ts';
import {
  pageHeader, card, button, list, listItem, listSkeleton, confirmOverlay,
  permissionState, deniedMessage, deniedContact, el, uid,
} from './ui/index.ts';

export interface SecurityViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

interface SessionRow {
  deviceId: string;
  label: string;
  current: boolean;
  signedInAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
}

/**
 * The device-type glyph the design draws beside each row.
 *
 * A guess from the label, and only a picture: `SessionRow` carries no device
 * type, just the client's own label or the server's "Chrome · Android". The
 * words beside the glyph are what identify the device. A name the icon set
 * does not carry yet gives no glyph rather than the fallback dot.
 */
function deviceGlyph(label: string): string | undefined {
  const name = /iPad|tablet|ট্যাব/i.test(label) ? 'tablet'
    : /Android|iOS|iPhone|mobile|ফোন|মোবাইল/i.test(label) ? 'smartphone'
    : 'monitor';
  return hasIcon(name) ? name : undefined;
}

/** "১০:৪৫", 24-hour — the same clock `bnDateTime` uses. */
function bnClock(t: number): string {
  return new Date(t).toLocaleTimeString('bn-BD', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/**
 * When, as the design writes it: "আজ ০৮:১২", "গতকাল ১৪:৩০", "৪ দিন আগে",
 * and the full date and time for anything older than a week. Calendar days
 * on the reader's own clock, so a sign-in at 23:50 is "গতকাল" at 00:10.
 */
function bnWhen(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return bnDateTime(iso);
  try {
    const day = (ms: number): number => {
      const x = new Date(ms);
      return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86_400_000;
    };
    const days = day(now) - day(t);
    if (days <= 0) return `আজ ${bnClock(t)}`;
    if (days === 1) return `গতকাল ${bnClock(t)}`;
    if (days < 7) return `${bnNum(days)} দিন আগে`;
  } catch { /* fall through to the full date */ }
  return bnDateTime(iso);
}

export class SecurityView {
  private readonly o: SecurityViewOptions;
  private rows: SessionRow[] = [];
  private loading = true;
  private error = '';
  private notice = '';
  /** The device being revoked, so only ITS button shows the busy label. */
  private busy = '';
  /** The server refused the list (403) — kept so the sentence can say why. */
  private denied: unknown = null;

  constructor(options: SecurityViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.denied = null;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/auth/sessions?deviceId=${encodeURIComponent(this.o.auth.deviceId)}`);
      await refuseUnlessOk(res);
      const body = await res.json() as { sessions: SessionRow[] };
      this.rows = body.sessions ?? [];
    } catch (err) {
      if (isDenied(err)) {
        // A refusal is not an outage: no retry, and nothing the server has
        // just refused stays on screen.
        this.denied = err;
        this.rows = [];
      } else {
        this.error = 'যন্ত্রের তালিকা আনা গেল না। ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।';
      }
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    root.append(pageHeader(d, {
      title: 'নিরাপত্তা',
      subtitle: 'আপনার অ্যাকাউন্ট কোন কোন যন্ত্রে খোলা আছে',
    }));

    if (this.denied) {
      root.append(permissionState(d, {
        message: deniedMessage(this.denied, 'যন্ত্রের তালিকা'),
        contact: deniedContact(this.denied),
      }));
      return;
    }

    if (this.error) root.append(errorState(d, this.error, () => { void this.load(); }));
    if (this.notice) root.append(successNote(d, this.notice));

    // A failed first load has nothing to list. An empty panel under the error
    // would claim "this device is not recognised" and "open nowhere else",
    // neither of which anybody knows.
    if (!this.loading && this.error && this.rows.length === 0) return;

    const panel = card(d, {
      title: 'যেসব যন্ত্রে খোলা আছে',
      subtitle: 'চেনেন না এমন যন্ত্র দেখলে সাথে সাথে বন্ধ করুন',
      className: 'sec-devices',
    });
    root.append(panel);

    if (this.loading) { panel.append(listSkeleton(d, 3)); return; }

    const current = this.rows.filter((r) => r.current);
    const others = this.rows.filter((r) => !r.current);
    const items: HTMLElement[] = [];

    if (current.length === 0) {
      // Honest rather than reassuring. It happens when the session was
      // created before this device id was stored, and saying so beats
      // showing nothing.
      items.push(listItem(d, {
        glyph: 'alert-triangle',
        title: 'এই যন্ত্রটি চেনা যায়নি',
        subtitle: 'তালিকায় এই যন্ত্রটি আলাদা করে চেনা যায়নি। নিরাপদ থাকতে চাইলে '
          + 'অন্য সব যন্ত্র থেকে বের করে দিয়ে আবার প্রবেশ করুন।',
      }));
    }
    for (const r of current) items.push(this.deviceRow(r));
    for (const r of others) items.push(this.deviceRow(r));

    panel.append(
      list(d, 'যেসব যন্ত্রে খোলা আছে', ...items),
      el(d, 'div', { className: 'sec-devices-foot' },
        others.length > 0
          ? button(d, {
            label: 'সব যন্ত্র থেকে বের করে দিন',
            variant: 'danger',
            onClick: () => { this.confirmRevokeOthers(others.length); },
          })
          : el(d, 'p', {
            className: 'sec-devices-note',
            text: 'আর কোনো যন্ত্রে খোলা নেই — আপনার অ্যাকাউন্ট শুধু এই যন্ত্রে খোলা আছে।',
          })),
    );
  }

  private deviceRow(r: SessionRow): HTMLElement {
    const d = this.o.doc;
    const titleId = uid('sec-dev');

    // The current row's "এই যন্ত্র" has no action, so it is not a button: a
    // control that does nothing is a dead stop for a keyboard. The title's
    // "এখন ব্যবহার করছেন" already says it to a reader.
    let status: HTMLElement;
    if (r.current) {
      status = el(d, 'span', {
        className: 'sec-this-device', text: 'এই যন্ত্র', attrs: { 'aria-hidden': 'true' },
      });
    } else {
      const b = button(d, {
        label: this.busy === r.deviceId ? 'বন্ধ করা হচ্ছে…' : 'বন্ধ করুন',
        variant: 'secondary',
        size: 'sm',
        className: 'sec-row-btn',
        // Every row's button says "বন্ধ করুন"; the device's name tells a
        // screen-reader user WHICH one, as the card heading used to.
        attrs: { 'aria-describedby': titleId },
        onClick: () => { this.confirmRevoke(r); },
      });
      if (this.busy) b.disabled = true;
      status = b;
    }

    const seen = r.lastSeenAt ? `শেষ ব্যবহার ${bnWhen(r.lastSeenAt)}` : 'এখনো ব্যবহার হয়নি';
    const li = listItem(d, {
      glyph: deviceGlyph(r.label),
      title: r.current ? `${r.label} · এখন ব্যবহার করছেন` : r.label,
      meta: `${seen} · প্রবেশ ${bnWhen(r.signedInAt)}`,
      status,
    });
    li.querySelector('.ui-list-title')?.setAttribute('id', titleId);
    return li;
  }

  /**
   * An overlay, not an inline card: `confirmOverlay` is a bottom sheet on a
   * phone, so the 360px readability the inline version was chosen for is
   * kept, and the confirm is the danger button rather than an accent fill.
   */
  private confirmRevoke(r: SessionRow): void {
    confirmOverlay(this.o.doc, {
      title: 'এই যন্ত্র বন্ধ করবেন?',
      // The consequence, not just the question.
      body: `"${r.label}" সঙ্গে সঙ্গে বের হয়ে যাবে। ওই যন্ত্রে আবার ঢুকতে হলে `
          + 'নতুন করে প্রবেশ করতে হবে — এটি ফেরানো যাবে না।',
      confirmLabel: 'বন্ধ করুন',
      danger: true,
      onConfirm: () => { void this.revoke(r.deviceId, false, r.label); },
    });
  }

  private confirmRevokeOthers(count: number): void {
    confirmOverlay(this.o.doc, {
      title: 'সব যন্ত্র থেকে বের করে দেবেন?',
      // `bnNum`, not the raw number: a Latin digit inside a Bangla sentence
      // is what `bangla-numerals.test.ts` exists to catch, and it caught
      // exactly this line.
      body: `${bnNum(count)}টি যন্ত্র সঙ্গে সঙ্গে বের হয়ে যাবে। আপনি এখন যে যন্ত্রে আছেন `
          + 'সেটি খোলা থাকবে। ওই যন্ত্রগুলোতে আবার প্রবেশ করতে হবে — এটি ফেরানো যাবে না।',
      confirmLabel: 'সব বন্ধ করুন',
      danger: true,
      onConfirm: () => { void this.revoke(this.o.auth.deviceId, true); },
    });
  }

  private async revoke(deviceId: string, others: boolean, label?: string): Promise<void> {
    this.busy = deviceId;
    this.error = '';
    this.notice = '';
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/auth/sessions/${others ? 'revoke-others' : 'revoke'}`,
        { method: 'POST', body: JSON.stringify({ deviceId }) });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json() as { revoked: number };
      // Announced, because the visible change is a row disappearing and a
      // screen-reader user would otherwise be told nothing happened.
      this.notice = others
        ? `${bnNum(body.revoked)}টি যন্ত্র থেকে বের করে দেওয়া হয়েছে। এই যন্ত্রটি খোলা আছে।`
        : `${label ?? 'যন্ত্রটি'} বন্ধ করা হয়েছে।`;
    } catch {
      this.error = 'বন্ধ করা গেল না। আবার চেষ্টা করুন।';
    } finally {
      this.busy = '';
      await this.load();
    }
  }
}
