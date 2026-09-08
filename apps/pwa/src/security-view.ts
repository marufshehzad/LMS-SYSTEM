/**
 * নিরাপত্তা → সক্রিয় সেশন — where am I signed in.  (B-120)
 *
 * `user_sessions` has recorded every sign-in since migration 002 and nothing
 * ever showed it to the person it belongs to. `logout` ends the session
 * making the request; somebody whose phone was stolen had no way to end that
 * phone and the practical answer was to wait out the refresh token.
 *
 * ── Deliberately one screen with two buttons ────────────────────────────
 * This is a security surface a worried person reaches in a hurry, so it says
 * one thing per line and nothing it does not have to. No IP address, no
 * map, no raw user agent — the server sends "Chrome · Windows" and this
 * renders it. A device it cannot name says so rather than showing a blank,
 * because an unnamed device is still one somebody may want to end.
 *
 * ── The confirmation is not decoration ──────────────────────────────────
 * Both actions are irreversible from the user's side: the other device has
 * to sign in again, and on a school phone that means finding the OTP. So
 * each names its consequence before it happens, and the destructive one
 * names how many devices it is about to end.
 */
import type { Auth } from './auth.ts';
import {
  errorState, successNote, skeleton, confirmDialog, bnDateTime, bnNum,
} from './view-states.ts';
import {
  pageHeader, sectionHeading, card, button, buttonRow, statusBadge, el, append,
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

export class SecurityView {
  private readonly o: SecurityViewOptions;
  private rows: SessionRow[] = [];
  private loading = true;
  private error = '';
  private notice = '';
  /** The device being revoked, so only ITS button shows the busy label. */
  private busy = '';

  constructor(options: SecurityViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/auth/sessions?deviceId=${encodeURIComponent(this.o.auth.deviceId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json() as { sessions: SessionRow[] };
      this.rows = body.sessions ?? [];
    } catch {
      this.error = 'সেশনের তালিকা আনা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।';
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
      subtitle: 'আপনার অ্যাকাউন্ট কোন কোন ডিভাইসে খোলা আছে',
    }));

    if (this.error) root.append(errorState(d, this.error, () => { void this.load(); }));
    if (this.notice) root.append(successNote(d, this.notice));

    if (this.loading) { root.append(skeleton(d, 3)); return; }

    const current = this.rows.filter((r) => r.current);
    const others = this.rows.filter((r) => !r.current);

    root.append(sectionHeading(d, { title: 'এই ডিভাইস' }));
    if (current.length === 0) {
      // Honest rather than reassuring. It happens when the session was
      // created before this device id was stored, and saying so beats
      // showing nothing.
      root.append(card(d, { title: 'চিহ্নিত করা যায়নি', glyph: 'alert-triangle', headingLevel: 3 },
        el(d, 'p', {
          className: 'ui-card-note',
          text: 'এই ডিভাইসটি নিচের তালিকায় আলাদা করে চেনা যায়নি। '
              + 'নিরাপদ থাকতে চাইলে অন্য সব সেশন বন্ধ করে আবার সাইন ইন করুন।',
        })));
    } else {
      for (const r of current) root.append(this.sessionCard(r));
    }

    root.append(sectionHeading(d, { title: 'অন্যান্য ডিভাইস' }));
    if (others.length === 0) {
      root.append(card(d, { title: 'আর কোথাও খোলা নেই', glyph: 'check-square', headingLevel: 3 },
        el(d, 'p', {
          className: 'ui-card-note',
          text: 'আপনার অ্যাকাউন্ট শুধু এই ডিভাইসেই খোলা আছে।',
        })));
    } else {
      for (const r of others) root.append(this.sessionCard(r));
      root.append(buttonRow(d, button(d, {
        label: 'অন্য সব সেশন বন্ধ করুন',
        variant: 'danger',
        onClick: () => { this.confirmRevokeOthers(others.length); },
      })));
    }
  }

  private sessionCard(r: SessionRow): HTMLElement {
    const d = this.o.doc;
    const body = el(d, 'div', { className: 'ui-stack' });

    // The state is a WORD in a badge, never a colour alone (04-UIUX §5).
    append(body, statusBadge(d, {
      state: r.current ? 'active' : 'other',
      label: r.current ? 'এই ডিভাইস' : 'অন্য ডিভাইস',
      tone: r.current ? 'success' : 'neutral',
    }));

    append(body, el(d, 'p', {
      className: 'ui-card-note',
      text: `সাইন ইন: ${bnDateTime(r.signedInAt)}`,
    }));
    append(body, el(d, 'p', {
      className: 'ui-card-note',
      text: r.lastSeenAt
        ? `শেষ ব্যবহার: ${bnDateTime(r.lastSeenAt)}`
        : 'শেষ ব্যবহার: এখনো ব্যবহার হয়নি',
    }));

    if (!r.current) {
      const b = button(d, {
        label: this.busy === r.deviceId ? 'বন্ধ করা হচ্ছে…' : 'এই সেশন বন্ধ করুন',
        variant: 'secondary',
        onClick: () => { this.confirmRevoke(r); },
      });
      if (this.busy) b.setAttribute('disabled', 'true');
      append(body, b);
    }

    return card(d, {
      title: r.label,
      glyph: r.current ? 'check-square' : 'log-out',
      headingLevel: 3,
    }, body);
  }

  /**
   * The confirmation is appended to the page, not floated over it.
   *
   * `confirmDialog` returns an inline `role="alertdialog"` card, which is
   * the pattern every other destructive action in this app uses — and on a
   * 360px phone an inline confirmation is readable where a modal is a
   * scroll trap.
   */
  private confirmRevoke(r: SessionRow): void {
    this.o.root.append(confirmDialog({
      doc: this.o.doc,
      title: 'এই সেশন বন্ধ করবেন?',
      // The consequence, not just the question.
      body: `"${r.label}" ডিভাইসটি সঙ্গে সঙ্গে সাইন আউট হয়ে যাবে। `
          + 'ওই ডিভাইসে আবার ঢুকতে হলে নতুন করে সাইন ইন করতে হবে।',
      confirmLabel: 'বন্ধ করুন',
      danger: true,
      onConfirm: () => { void this.revoke(r.deviceId, false, r.label); },
      onCancel: () => { this.render(); },
    }));
  }

  private confirmRevokeOthers(count: number): void {
    this.o.root.append(confirmDialog({
      doc: this.o.doc,
      title: 'অন্য সব সেশন বন্ধ করবেন?',
      // `bnNum`, not the raw number: a Latin digit inside a Bangla sentence
      // is what `bangla-numerals.test.ts` exists to catch, and it caught
      // exactly this line.
      body: `${bnNum(count)}টি ডিভাইস সাইন আউট হয়ে যাবে। আপনি যে ডিভাইসে এখন আছেন `
          + 'সেটি খোলা থাকবে।',
      confirmLabel: 'সব বন্ধ করুন',
      danger: true,
      onConfirm: () => { void this.revoke(this.o.auth.deviceId, true); },
      onCancel: () => { this.render(); },
    }));
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
      // Announced, because the visible change is a card disappearing and a
      // screen-reader user would otherwise be told nothing happened.
      this.notice = others
        ? `${bnNum(body.revoked)}টি সেশন বন্ধ করা হয়েছে। এই ডিভাইসটি খোলা আছে।`
        : `${label ?? 'ডিভাইসটি'} বন্ধ করা হয়েছে।`;
    } catch {
      this.error = 'সেশন বন্ধ করা যায়নি। আবার চেষ্টা করুন।';
    } finally {
      this.busy = '';
      await this.load();
    }
  }
}
