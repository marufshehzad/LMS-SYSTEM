/**
 * "রুটিন প্রকাশ" — read the timetable, then make it the school's.  (P9-7)
 *
 * The last screen in the routine workstream, and the only one whose button
 * cannot be undone. Everything before it is reversible: a draft can be
 * regenerated, an edit undone, a scoped re-solve rolled back. The moment
 * `status` becomes `active`, three thousand guardians are looking at it.
 *
 * ── The server decides; this screen reports ──────────────────────────────
 * `canPublish`, the blockers and the warnings are all computed by
 * `src/publish-gate.ts`, which is the same function the publish endpoint
 * enforces. Nothing here re-derives them. A screen that made its own ruling
 * would eventually say "প্রকাশ করা যাবে" about a routine the server refuses,
 * and a head who has been lied to once stops reading the screen.
 *
 * The button is still disabled when there are blockers — but as a courtesy,
 * not as the gate. §3: the UI is not authoritative.
 *
 * ── What a head is actually deciding ─────────────────────────────────────
 * §2 asks for the facts and §6 for the consequence. A head is not auditing
 * five hundred rows; they are answering "is this the week we will teach?".
 * So the screen leads with the verdict, then the numbers that would change
 * their mind — conflicts, gaps, what is being replaced — and the confirmation
 * says in words what publishing does to the people downstream.
 *
 * ── Two decisions, kept apart ────────────────────────────────────────────
 * "পর্যালোচনার জন্য পাঠান" hands the draft to the head. "প্রকাশ করুন" makes
 * it real. In most Bangladeshi schools that is one person doing both, which
 * is why neither is required — but a school where the coordinator builds and
 * the head signs off now has somewhere to do it, and `review` is a status the
 * schema has carried since migration 006 with nothing ever writing it.
 *
 * ── Online only, and it says why ─────────────────────────────────────────
 * §14. Publishing is not queued. Whether a routine can go live depends on
 * every other routine in the school at that instant, so two offline devices
 * could queue two publications that are each valid alone and together are
 * not. Offline, the action is disabled with that reason in a sentence — not
 * hidden, because a coordinator who cannot find the button assumes the
 * feature is broken.
 */
import {
  el, numText, pageHeader, card, button, buttonRow, statusBadge,
  statRow, statCard, permissionState, deniedMessage, deniedContact,
  announce, listSkeleton, confirmOverlay, emptyState, errorState, successNote,
} from './ui/index.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import { formatCount, formatDayMonth, formatTime, formatAcademicYear } from '../../../packages/ui-core/src/format.ts';
import type { Auth } from './auth.ts';

/** One thing wrong, in the server's words. */
export interface Finding {
  code: string;
  messageBn: string;
  actionBn?: string;
}

/** One routine, as the review endpoint describes it. */
export interface ReviewEntry {
  routineId: string;
  status: string;
  statusBn: string;
  version: number;
  shift: string;
  shiftBn: string;
  nameBn: string;
  yearLabel: string;
  slots: number;
  sections: number;
  teachers: number;
  pinned: number;
  hardConflicts: number;
  softViolations: number;
  unplacedDemands: number;
  lastModified: string | null;
  fingerprint: string;
  publishedAt: string | null;
  publishedByBn: string | null;
  supersedes: { version: number; publishedAt: string | null } | null;
  /** §6. What publishing would do — the server's sentences, not ours. */
  consequenceBn: string[];
  verdictBn: string;
  blockers: Finding[];
  warnings: Finding[];
  canPublish: boolean;
}

export interface RoutinePublishViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  yearId?: string;
  /** Where "খসড়া দেখুন" and "রুটিন তৈরি করুন" send people. */
  onNavigate?: (path: string) => void;
  /** Injectable so the offline branch is testable. */
  online?: () => boolean;
}

/**
 * A timestamp a head reads, built from the product's own formatters.
 *
 * NOT `Intl.DateTimeFormat('bn-BD')`, which was the first version of this and
 * produced "৭ সেপ্টেম্বর, ২০২৬ এ ১০:৩৮ AM" — a Latin meridiem in the middle
 * of a Bangla sentence, and exactly the kind of leak P9-4 spent a section
 * removing. Bangla uses a 24-hour clock, which is what `formatTime` writes.
 */
const dateBn = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            + `-${String(d.getDate()).padStart(2, '0')}`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:`
           + `${String(d.getMinutes()).padStart(2, '0')}`;
  return `${formatDayMonth(ymd, 'bn')} ${formatCount(d.getFullYear(), 'bn')}, `
       + `${formatTime(hm, 'bn')}`;
};

export class RoutinePublishView {
  private readonly o: RoutinePublishViewOptions;
  private readonly online: () => boolean;
  private yearId = '';

  private tenantNameBn = '';
  private yearLabel = '';
  private entries: ReviewEntry[] = [];

  private loading = true;
  private busy = '';
  private denied = false;
  private deniedErr: unknown = null;
  private error = '';
  private notice: { text: string; tone: 'ok' | 'warn' } | null = null;

  constructor(options: RoutinePublishViewOptions) {
    this.o = options;
    this.online = options.online ?? (() => navigator.onLine);
    this.yearId = options.yearId ?? '';
    void this.start();
  }

  private async start(): Promise<void> {
    if (!this.yearId) {
      try {
        const res = await this.o.auth.authedFetch('/api/v1/academics/hierarchy');
        await refuseUnlessOk(res);
        const b = await res.json() as
          { years?: Array<{ id: string; isCurrent?: boolean }>; year?: { id: string } };
        this.yearId = b.years?.find((y) => y.isCurrent)?.id ?? b.years?.[0]?.id
          ?? b.year?.id ?? '';
      } catch (err) {
        this.absorb(err, 'শিক্ষাবর্ষ আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।');
        this.loading = false; this.render(); return;
      }
    }
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/rms/publish?yearId=${encodeURIComponent(this.yearId)}`);
      await refuseUnlessOk(res);
      const b = await res.json() as {
        tenantNameBn?: string; yearLabel?: string; routines?: ReviewEntry[];
      };
      this.tenantNameBn = b.tenantNameBn ?? '';
      this.yearLabel = b.yearLabel ?? '';
      this.entries = b.routines ?? [];
      this.error = '';
    } catch (err) {
      this.absorb(err, this.online()
        ? 'রুটিনের তথ্য আনা যায়নি — একটু পরে আবার চেষ্টা করুন।'
        : 'সংযোগ নেই — রুটিন প্রকাশের তথ্য দেখতে ইন্টারনেট লাগবে।');
    } finally {
      this.loading = false; this.render();
    }
  }

  private absorb(err: unknown, fallbackBn: string): void {
    if (isDenied(err)) { this.denied = true; this.deniedErr = err; return; }
    this.error = fallbackBn;
  }

  /* ------------------------------------------------------------ actions */

  /**
   * One request for all three transitions.
   *
   * Every refusal below leaves a sentence on screen. The server's `message`
   * is preferred over anything composed here, because it is the one that
   * knows WHY — "একই সময়ে একই শিক্ষক" rather than "প্রকাশ করা গেল না".
   */
  private async send(
    action: 'submit' | 'withdraw' | 'publish', e: ReviewEntry,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    this.busy = `${action}:${e.routineId}`;
    this.notice = null;
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/rms/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, routineId: e.routineId, ...extra }),
      });
      const body = await res.json().catch(() => ({})) as {
        ok?: boolean; message?: string; messageBn?: string; error?: string;
        warnings?: Finding[]; actionBn?: string;
      };
      // A refused ACTION is not a refused SCREEN. This used to call
      // `refuseUnlessOk`, which throws and replaces the whole review with the
      // permission panel — so a head who was reading their timetable lost it
      // and was told they may not see it, which was not what happened. Found
      // in the demo, whose 403 means "this build does not write" and which
      // wiped the page it had just drawn. The denial panel stays for a
      // refused READ in `load()`, where it is the truth.
      //
      // The server's own sentence is rendered below either way, and it is the
      // one that knows whether this was a role, a conflict or a demo.
      if (res.ok && body.ok) {
        this.notice = {
          text: body.messageBn ?? 'হয়ে গেছে।',
          tone: 'ok',
        };
        announce(this.o.doc, this.notice.text);
        this.busy = '';
        await this.load();
        return true;
      }
      // §5. The server refuses an unconfirmed publish and hands back what it
      // wanted confirmed. Re-asking with those warnings on screen is the
      // point of the refusal, not an error to report.
      if (body.error === 'warnings_unconfirmed') {
        this.busy = ''; this.render();
        this.confirmPublish(e, body.warnings ?? []);
        return false;
      }
      this.notice = {
        text: [body.message, body.actionBn].filter(Boolean).join(' ')
          || 'কাজটি করা যায়নি।',
        tone: 'warn',
      };
      announce(this.o.doc, this.notice.text);
      return false;
    } catch (err) {
      if (isDenied(err)) { this.denied = true; this.deniedErr = err; return false; }
      this.notice = {
        text: this.online()
          ? 'কাজটি করা যায়নি — রুটিন আগের অবস্থাতেই আছে।'
          : 'সংযোগ নেই — রুটিন প্রকাশ করতে ইন্টারনেট লাগবে।',
        tone: 'warn',
      };
      return false;
    } finally {
      this.busy = ''; this.render();
    }
  }

  /**
   * §6. The confirmation names the consequence, not the action.
   *
   * "আপনি কি নিশ্চিত?" carries no information and teaches people to click
   * through. This says how many lessons, who will see them, what it replaces
   * and what is being accepted — and it is `danger` styled with focus on
   * Cancel, because it cannot be undone.
   */
  private confirmPublish(e: ReviewEntry, extra: Finding[] = []): void {
    // The server's sentences. Anything this screen composed from the counters
    // beside them would drift the first time either changed — the rule P9-3's
    // generate screen states about its verdict, and the same one applies to
    // the only irreversible button in the workstream.
    //
    // `extra` is what a REFUSAL wanted acknowledged: the server hands those
    // back when it declines an unconfirmed publish, and they belong in the
    // second ask even though the review that drew this card did not have them.
    // `?? []` is not defensive noise: a service worker holding a response
    // from before the server composed these, or an older deployment behind a
    // newer client, makes this undefined — and spreading undefined throws
    // inside a click handler, which loses the dialog and leaves the button
    // dead with nothing on screen to say why. Observed exactly once, in the
    // browser, from a cached payload.
    const lines = [...(e.consequenceBn ?? [])];
    for (const w of extra) {
      const line = `মেনে নেওয়া হচ্ছে: ${w.messageBn}`;
      if (!lines.includes(line)) lines.splice(lines.length - 1, 0, line);
    }

    confirmOverlay(this.o.doc, {
      title: 'রুটিন প্রকাশ করবেন?',
      body: lines.join(' '),
      confirmLabel: 'হ্যাঁ, প্রকাশ করুন',
      danger: true,
      onConfirm: async () => {
        // §9. The routine as THIS screen was drawn from. If somebody edited
        // it since, the server refuses rather than publishing something the
        // head never read.
        await this.send('publish', e, {
          confirmWarnings: true, fingerprint: e.fingerprint,
        });
      },
    });
  }

  /* ------------------------------------------------------------ render */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.append(pageHeader(d, {
      title: 'রুটিন প্রকাশ',
      subtitle: this.tenantNameBn
        ? `${this.tenantNameBn} · ${formatAcademicYear(this.yearLabel)} শিক্ষাবর্ষ`
        : 'তৈরি হওয়া রুটিন দেখে নিন, তারপর প্রকাশ করুন',
    }));

    if (this.denied) {
      root.append(permissionState(d, {
        message: deniedMessage(this.deniedErr),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }
    if (this.loading) { root.append(listSkeleton(d, 3)); return; }
    if (this.error) {
      root.append(errorState(d, this.error, () => { void this.load(); }));
      return;
    }
    if (this.notice) {
      if (this.notice.tone === 'ok') {
        // 14 Components §06's success strip. `role="status"` stays: this line
        // has always been a status region, and a reader that ignores
        // aria-live still hears it.
        const ok = successNote(d, this.notice.text);
        ok.setAttribute('role', 'status');
        root.append(ok);
      } else {
        root.append(el(d, 'p', {
          className: 'rpub-note', attrs: { role: 'status' },
        }, ...numText(d, this.notice.text)));
      }
    }
    if (this.entries.length === 0) {
      // §15. Never a blank screen — and the empty state carries the next
      // step, because "no routines" without "make one" is a dead end.
      root.append(emptyState(d, {
        glyph: 'clock',
        message: 'এই শিক্ষাবর্ষে এখনো কোনো রুটিন তৈরি হয়নি — আগে একটি তৈরি করুন।',
        action: {
          label: 'রুটিন তৈরি করুন',
          onClick: () => this.o.onNavigate?.('routinegenerate'),
        },
      }));
      return;
    }
    if (!this.online()) {
      root.append(el(d, 'p', {
        className: 'rpub-note',
        text: 'সংযোগ নেই — রুটিন দেখা যাচ্ছে, কিন্তু প্রকাশ করতে ইন্টারনেট লাগবে।',
        attrs: { role: 'status' },
      }));
    }
    // Ata Ekta §3: one primary button on the page. A school with two shifts
    // gets two review panels, and each keeps its own "প্রকাশ করুন" — §11, a
    // morning conflict is not an evening problem — but only one is painted
    // primary: the first that can actually go live, else the first that is
    // still being worked on. The rest are the same control, drawn secondary.
    const workable = (e: ReviewEntry) => e.status === 'draft' || e.status === 'review';
    const lead = this.entries.find((e) => workable(e) && e.canPublish)
      ?? this.entries.find(workable);
    for (const e of this.entries) root.append(this.entryCard(e, e === lead));
  }

  /**
   * One routine, as 06 Routine §06 draws the publish screen: a title bar with
   * the status chip, the stats band, what publishing does, and the footer
   * with the way back to the draft on the left and "প্রকাশ করুন" on the right.
   */
  private entryCard(e: ReviewEntry, lead: boolean): HTMLElement {
    const d = this.o.doc;
    const published = e.status === 'active';
    // B-108 introduced a fourth state on this screen. A routine that is still
    // the coordinator's — draft or review — has work in it; anything else is
    // either the school's timetable or its history.
    const editable = e.status === 'draft' || e.status === 'review';
    const retired = !published && !editable;

    const panel = card(d, {
      title: `${e.shiftBn} শিফট — ${e.nameBn}`,
      className: 'rpub-panel',
      action: statusBadge(d, {
        label: e.statusBn,
        // The WORD beside the chip is what a reader goes by. A draft that
        // cannot go live is `blocked` (danger + glyph); a superseded version
        // is history, not trouble, so it takes no STATUS key and reads
        // neutral — it used to fall through to `overdue`, a red triangle on
        // a routine nobody needs to do anything about.
        state: published ? 'active'
          : retired ? 'retired'
          : e.canPublish ? 'draft' : 'blocked',
      }),
    });

    /* ── the stats band ─────────────────────────────────────────────── */

    // §2. The verdict first — a head reads one line and knows where they are.
    // The dari closes a sentence; a clause continuing it must not follow
    // one, or the line reads "এই রুটিন চালু আছে। — ৭ সেপ্টেম্বর".
    const verdict = published
      ? (e.verdictBn ?? '').replace(/।$/, '') + ` — ${dateBn(e.publishedAt)}`
        + (e.publishedByBn ? `, প্রকাশ করেছেন ${e.publishedByBn}` : '')
      : e.verdictBn ?? '';
    // The facts the drawn strip has no cell for — who teaches and what is
    // pinned — stay on screen here rather than being dropped.
    const meta = `সর্বশেষ পরিবর্তন: ${dateBn(e.lastModified)} · খসড়া নম্বর `
      + `${formatCount(e.version, 'bn')} · ${formatCount(e.teachers, 'bn')} জন শিক্ষক · `
      + `${formatCount(e.pinned, 'bn')}টি পিন করা`
      + (e.supersedes && !published
        ? ` · প্রকাশ করলে এখনকার চালু রুটিনটি (নম্বর `
          + `${formatCount(e.supersedes.version, 'bn')}) বাতিল হবে`
        : '');

    panel.append(el(d, 'div', { className: 'rpub-facts' },
      verdict ? el(d, 'p', { className: 'rpub-verdict' }, ...numText(d, verdict)) : null,
      el(d, 'p', { className: 'rpub-meta' }, ...numText(d, meta)),
      // §2's list, as labelled numbers. The label says what each counts,
      // because "৫৬০ / ২০ / ০" alone makes a reader guess.
      statRow(d,
        statCard(d, { label: 'সেকশন', value: formatCount(e.sections, 'bn') }),
        statCard(d, { label: 'সাপ্তাহিক ক্লাস', value: formatCount(e.slots, 'bn') }),
        statCard(d, {
          // The one number that can stop a publication, and it is never
          // hidden when it is zero — a head who sees "০" beside "সংঘর্ষ" has
          // been told, whereas an absent cell leaves them to assume.
          label: 'সংঘর্ষ',
          value: formatCount(e.hardConflicts, 'bn'),
          tone: e.hardConflicts > 0 ? 'danger' : 'success',
        }),
        statCard(d, {
          label: 'বিষয় বসানো যায়নি',
          value: formatCount(e.unplacedDemands, 'bn'),
          ...(e.unplacedDemands > 0 ? { tone: 'warn' as const } : {}),
        }),
      )));

    /* ── what to fix, what to know, what publishing does ────────────── */

    const groups: Array<{ heading: string; items: Finding[]; tone?: 'danger' | 'warn' }> = [
      // Only a routine somebody can still work on has anything "to fix". A
      // published one's single blocker is "already published", and a
      // SUPERSEDED one's is the same — neither is a defect, and P9-7 fixed
      // only the first of the two because the second did not exist yet.
      { heading: 'যা ঠিক করতে হবে', items: editable ? e.blockers : [], tone: 'danger' },
      // A retired version's warnings are history, not work. The live one's
      // still say what the school is teaching around.
      { heading: 'যা জেনে রাখা দরকার', items: retired ? [] : e.warnings, tone: 'warn' },
      // §6. The server's sentences, the same ones the confirmation reads out —
      // shown before the button as 06 §06 draws them, not composed here.
      // `?? []`: see confirmPublish — a cached payload can lack them.
      {
        heading: 'প্রকাশ হলে যা ঘটবে',
        items: editable
          ? (e.consequenceBn ?? []).map((t) => ({ code: '', messageBn: t }))
          : [],
      },
    ];
    const shown = groups.filter((g) => g.items.length > 0);
    if (shown.length > 0) {
      const body = el(d, 'div', { className: 'rpub-body' });
      for (const g of shown) {
        const list = el(d, 'ul', { className: 'rpub-list', data: { tone: g.tone } });
        for (const f of g.items) {
          list.append(el(d, 'li', { className: 'rpub-item' },
            el(d, 'span', { className: 'rpub-dot', attrs: { 'aria-hidden': 'true' } }),
            el(d, 'span', { className: 'rpub-item-text' },
              el(d, 'span', { className: 'rpub-what' }, ...numText(d, f.messageBn)),
              f.actionBn
                ? el(d, 'span', { className: 'rpub-why' }, ...numText(d, f.actionBn))
                : null)));
        }
        body.append(el(d, 'div', { className: 'rpub-group' },
          el(d, 'h3', { className: 'label rpub-list-head', text: g.heading }),
          list));
      }
      panel.append(body);
    }

    /* ── the footer ─────────────────────────────────────────────────── */

    // B-108. `!published` was right while the only two states were draft and
    // active. A SUPERSEDED routine is neither, and it was being offered
    // "প্রকাশ করুন" and "সম্পাদনা করুন" — one would 409 and the other opens an
    // editor that refuses every write. Offering a control that cannot work is
    // the defect this whole phase keeps finding from the other side.
    if (editable) {
      const actions: HTMLElement[] = [];
      actions.push(button(d, {
        label: 'খসড়া দেখুন', variant: 'secondary',
        onClick: () => this.o.onNavigate?.('routineeditor'),
      }));
      if (e.status === 'draft') {
        actions.push(button(d, {
          label: 'পর্যালোচনার জন্য পাঠান', variant: 'secondary',
          disabled: this.busy !== '' || !this.online(),
          onClick: () => { void this.send('submit', e); },
        }));
      } else {
        actions.push(button(d, {
          label: 'খসড়ায় ফেরত নিন', variant: 'secondary',
          disabled: this.busy !== '' || !this.online(),
          onClick: () => { void this.send('withdraw', e); },
        }));
      }
      // §16. One primary action, and it is the one the screen exists for.
      // Disabled is a courtesy; `publish-gate.ts` is what actually refuses.
      actions.push(button(d, {
        label: 'প্রকাশ করুন', variant: lead ? 'primary' : 'secondary',
        className: 'rpub-publish',
        disabled: !e.canPublish || this.busy !== '' || !this.online(),
        onClick: () => this.confirmPublish(e),
      }));
      panel.append(el(d, 'div', { className: 'rpub-foot' }, buttonRow(d, ...actions)));
    }
    return panel;
  }
}
