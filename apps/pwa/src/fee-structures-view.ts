/**
 * ফি নির্ধারণ — the price list.  (P0/A2)
 *
 * What each fee head costs, this academic year, optionally per class. The
 * monthly invoice run reads exactly this table, and it had no writer at all:
 * `fee_structures` held zero rows across 126 institutions, so
 * `POST /finance/generate` billed nothing, for every school, every month.
 *
 * ── The screen tells the truth about what gets billed ───────────────────
 * The invoice run joins `fh.frequency = 'monthly' AND fh.is_active`. A price
 * set against an annual, exam or one-time head is stored and never invoiced by
 * it. Rather than hide that, every row states both halves of that join — its
 * ধরন ("প্রতি মাসে" is the monthly run's) and its অবস্থা (চালু / বন্ধ, the
 * head's own switch) — and the note under the list says in words that a fee
 * which is not monthly is not added, whenever such a row is on screen. A fee
 * somebody configured and never saw on an invoice is the kind of silence this
 * product has been bitten by before.
 *
 * ── No quota field ──────────────────────────────────────────────────────
 * The engine joins `fs.quota_category IS NULL`, so a quota-scoped price is
 * ignored entirely. Offering the field would be a control whose value is
 * discarded, which is the exact defect this phase exists to close.
 *
 * ── School-wide and per-class ───────────────────────────────────────────
 * A price with no class is the school-wide default; a class price overrides it
 * (`ORDER BY … class_id NULLS LAST` in the run). Both are shown, grouped by
 * head, so the override is visible rather than inferred.
 *
 * ── Ata Ekta (07 Finance §01, feeStructures) ────────────────────────────
 * The drawn bar is the page header: the title, the শিক্ষাবর্ষ and ONE small
 * primary, "নতুন ফি". Under it, one frame: the five drawn columns —
 * ফির নাম · ধরন · শ্রেণি · পরিমাণ · অবস্থা — and the drawn note joined under
 * them. Three things the drawing does not show stay, because taking them away
 * would take away something the office can do today: the name search (compact,
 * in the header's cluster), the year switch (the drawn chip's place, but the
 * sheet's select — a control, not a label), and each row's সম্পাদনা / সরান (a
 * sixth column at the right edge). The drawing's late fee ("১০ তারিখের পরে")
 * is a head of its own there; here the due day and the late fee belong to the
 * price, so they are a muted line under that row's ধরন. On a phone the price
 * is its own bold line under শ্রেণি, never beside the late fee's figures.
 */
import type { Auth } from './auth.ts';
import { formatBdt, formatAcademicYear } from '../../../packages/ui-core/src/format.ts';
import { skeleton, errorState, emptyState, successNote, bnNum } from './view-states.ts';
import { pageHeader } from './ui/page-header.ts';
import {
  el, append, button, buttonRow, field, dataTable, statusBadge, numText,
  permissionState, permissionMessage, openDrawer, confirmOverlay,
  setBusy, announce, type OverlayHandle, type Column, type Child,
} from './ui/index.ts';

interface Structure {
  id: string;
  feeHeadId: string;
  headBn: string;
  headCode: string;
  frequency: string;
  headActive: boolean;
  classId: string | null;
  classBn: string | null;
  amount: number;
  lateFeePerDay: number | null;
  lateFeeCap: number | null;
  dueDayOfMonth: number | null;
  billedByMonthlyRun: boolean;
}

interface Body {
  canManage: boolean;
  academicYearId: string | null;
  years: Array<{ id: string; label: string; isCurrent: boolean }>;
  classes: Array<{ id: string; nameBn: string }>;
  heads: Array<{ id: string; nameBn: string; code: string; frequency: string; isActive: boolean }>;
  structures: Structure[];
}

export interface FeeStructuresViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/**
 * The six frequencies `fee_heads_frequency_check` allows, in the words the
 * ধরন column is drawn with ("প্রতি মাসে", "প্রতি পরীক্ষায়", "একবার"). The
 * other three are not drawn and follow the same "প্রতি …" pattern.
 */
const FREQUENCY_BN: Record<string, string> = {
  one_time: 'একবার',
  monthly: 'প্রতি মাসে',
  quarterly: 'প্রতি তিন মাসে',
  half_yearly: 'প্রতি ছয় মাসে',
  annual: 'প্রতি বছরে',
  exam: 'প্রতি পরীক্ষায়',
};
const freqLabel = (f: string) => FREQUENCY_BN[f] ?? f;

export class FeeStructuresView {
  private data: Body | null = null;
  private loading = true;
  private denied = false;
  /** The whole service is off for this school's plan — a different refusal. */
  private planBlocked = '';
  private error = '';
  private notice = '';
  private busy = false;
  private yearId = '';
  private search = '';

  // Declared and assigned rather than a `private readonly o` parameter
  // property: Node's type-stripping test runner rejects those outright, so a
  // view written that way cannot be imported by a test at all. Both P0
  // writers were, which is why neither had one.
  private readonly o: FeeStructuresViewOptions;

  constructor(options: FeeStructuresViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.render();
    try {
      const q = this.yearId ? `?yearId=${encodeURIComponent(this.yearId)}` : '';
      const res = await this.o.auth.authedFetch(`/api/v1/finance/feestructures${q}`);
      if (res.status === 403) {
        // Two different 403s. The entitlement gate returns `tenant_blocked`
        // with a Bangla reason from the database; a role refusal does not.
        // Telling them apart matters: one is "ask your principal", the other
        // is "your school has not bought this".
        const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
        if (body.error === 'tenant_blocked') this.planBlocked = body.message ?? '';
        else this.denied = true;
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      this.data = await res.json() as Body;
      this.yearId = this.data.academicYearId ?? '';
    } catch {
      this.error = 'ফি-এর তালিকা আনা যায়নি।';
    } finally {
      this.loading = false;
      this.render();
    }
  }

  /**
   * Returns '' when the write was accepted, otherwise the sentence to show.
   *
   * It deliberately does NOT set `this.error` on a refusal. It used to, and
   * the `finally` below then called `load()`, whose first statement is
   * `this.error = ''` — so every refusal erased its own message and the
   * screen went back to looking exactly as it had. Handing the message to
   * the caller puts it where the person is looking: a rejected form keeps it
   * inside the drawer, a rejected delete raises it on the page.
   */
  private async send(
    method: 'POST' | 'PATCH' | 'DELETE', payload: Record<string, unknown>, ok: string,
  ): Promise<string> {
    this.busy = true;
    this.notice = '';
    try {
      const url = method === 'DELETE'
        ? `/api/v1/finance/feestructures?id=${encodeURIComponent(String(payload.id))}`
        : '/api/v1/finance/feestructures';
      const res = await this.o.auth.authedFetch(url, {
        method,
        ...(method === 'DELETE' ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      });
      const out = await res.json().catch(() => ({})) as { message?: string; headBn?: string };
      if (!res.ok) {
        // The server's Bangla message names what it objected to — a duplicate,
        // a due day past 28. Showing it verbatim beats a generic failure the
        // office cannot act on.
        return out.message ?? 'ফি সংরক্ষণ করা যায়নি।';
      }
      this.notice = `${out.headBn ?? 'ফি'} — ${ok}`;
      return '';
    } catch {
      return 'ফি সংরক্ষণ করা যায়নি।';
    } finally {
      this.busy = false;
      await this.load();
    }
  }

  private visible(): Structure[] {
    const rows = this.data?.structures ?? [];
    const q = this.search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.headBn.toLowerCase().includes(q)
      || r.headCode.toLowerCase().includes(q)
      || (r.classBn ?? '').toLowerCase().includes(q));
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // The drawn bar: the title, and — exactly when the old in-page controls
    // appeared (loaded, allowed, a year to work in) — the search, the
    // শিক্ষাবর্ষ chip and the page's ONE small primary. While loading, refused
    // or yearless, the title stands alone.
    const ready = !this.loading && !this.planBlocked && !this.denied
      && this.data?.academicYearId ? this.data : null;
    root.append(pageHeader(d, {
      title: 'ফি নির্ধারণ',
      actions: ready ? this.controls(ready) : undefined,
      primary: ready?.canManage
        ? button(d, {
          label: 'নতুন ফি', variant: 'primary', size: 'sm', disabled: this.busy,
          onClick: () => this.openForm(null),
        })
        : undefined,
    }));

    if (this.planBlocked) {
      // Not a permission problem, and saying "ask your principal" would send
      // the office somewhere that cannot help — so the refusal names nobody
      // (the same reading as `deniedContact` for `tenant_blocked`). The
      // server's own Bangla reason is the whole message.
      root.append(permissionState(d, { message: this.planBlocked }));
      return;
    }
    if (this.denied) {
      root.append(permissionState(d, {
        message: permissionMessage('ফি নির্ধারণ'),
        contact: 'প্রধান শিক্ষক, প্রতিষ্ঠান মালিক, হিসাবরক্ষক ও আইটি অ্যাডমিন',
      }));
      return;
    }

    if (this.notice) root.append(successNote(d, this.notice));
    if (this.error) {
      const err = errorState(d, this.error, () => void this.load());
      err.classList.add('fs-error');
      root.append(err);
    }

    if (this.loading) { root.append(skeleton(d, 5)); return; }
    const data = this.data;
    if (!data) return;

    if (!data.academicYearId) {
      root.append(emptyState(d, {
        message: 'আগে একটি শিক্ষাবর্ষ তৈরি করুন — ফি সবসময় একটি শিক্ষাবর্ষের জন্য নির্ধারিত হয়।',
      }));
      return;
    }

    // One frame, as drawn: the list (or what stands in for it), and the note
    // joined under it over a 2px rule.
    const frame = el(d, 'div', { className: 'card fs-frame' });
    root.append(frame);

    const rows = this.visible();
    if (rows.length === 0) {
      frame.append(emptyState(d, {
        message: this.search
          ? 'এই নামে কোনো ফি পাওয়া যায়নি।'
          : 'এই শিক্ষাবর্ষে এখনো কোনো ফি নির্ধারণ করা হয়নি। ফি না থাকলে মাসিক বিল তৈরি হবে না।',
        action: data.canManage && !this.search
          ? { label: 'প্রথম ফি নির্ধারণ করুন', onClick: () => this.openForm(null) }
          : undefined,
      }));
    } else {
      frame.append(this.table(data, rows));
    }
    frame.append(this.note(rows));
  }

  /** The five drawn columns, and the office's row actions after them. */
  private table(data: Body, rows: Structure[]): HTMLElement {
    const d = this.o.doc;
    const columns: Array<Column<Structure>> = [
      {
        key: 'head', header: 'ফির নাম', mobile: 'title',
        cell: (r) => r.headBn,
      },
      {
        key: 'kind', header: 'ধরন', mobile: 'meta',
        cell: (r) => this.kindCell(r),
      },
      {
        key: 'scope', header: 'শ্রেণি', mobile: 'subtitle',
        // A NULL class is the school-wide default. "সব", as drawn, beats an
        // empty cell the office has to interpret. On a phone there is no
        // column header above it, so the word শ্রেণি is added there — and
        // hidden in the table, where the header already says it.
        cell: (r) => r.classBn ?? el(d, 'span', {},
          'সব', el(d, 'span', { className: 'fs-scope-word', text: ' শ্রেণি' })),
      },
      {
        // On a phone the price is a line of its own under শ্রেণি, bold. In the
        // meta line it sat after the due day and the late fee's two figures,
        // with its hidden "পরিমাণ:" the only thing telling it apart — so a
        // clerk could read the late-fee cap as the fee.
        key: 'amount', header: 'পরিমাণ', mobile: 'subtitle', numeric: true,
        // Money stays Latin (R-8, formatBdt). The whole figure, ৳ included,
        // is in the numeral face, as the drawn cell is.
        cell: (r) => el(d, 'span', { className: 'n fs-amount', text: formatBdt(r.amount) }),
      },
      {
        key: 'status', header: 'অবস্থা', mobile: 'status',
        // The head's own switch — the second half of what the monthly run
        // reads. A word beside the tone, never the tint alone.
        cell: (r) => statusBadge(d, {
          state: r.headActive ? 'active' : 'pending',
          label: r.headActive ? 'চালু' : 'বন্ধ',
        }),
      },
    ];
    if (data.canManage) {
      // On a phone the pair sits on its own line under the row's meta, where
      // a thumb can reach it — not hidden, not squeezed beside the chip.
      columns.push({
        key: 'actions', header: 'ব্যবস্থা', mobile: 'meta',
        cell: (r) => this.rowActions(r),
      });
    }

    return dataTable(d, {
      caption: 'নির্ধারিত ফি-এর তালিকা',
      className: 'fs-table',
      rows,
      rowKey: (r) => r.id,
      columns,
    });
  }

  /**
   * ধরন, and — when the price carries them — its due day and late fee, in a
   * muted line of their own under it, in the table and on a phone alike.
   * These were the old শেষ তারিখ column; the drawing has no column for them.
   */
  private kindCell(r: Structure): HTMLElement {
    const d = this.o.doc;
    // Each money figure is one span, ৳ included (as the পরিমাণ cell is), and
    // does not wrap — so "৳" never ends a line with its figure on the next.
    const money = (x: number) => el(d, 'span', { className: 'n fs-money', text: formatBdt(x) });
    const parts: Child[][] = [];
    if (r.dueDayOfMonth !== null) {
      parts.push(numText(d, `${bnNum(r.dueDayOfMonth)} তারিখে শেষ`));
    }
    if (r.lateFeePerDay) {
      parts.push(r.lateFeeCap !== null
        ? ['বিলম্বে দিনে ', money(r.lateFeePerDay), ', সর্বোচ্চ ', money(r.lateFeeCap)]
        : ['বিলম্বে দিনে ', money(r.lateFeePerDay)]);
    }
    // The leading space keeps the words apart in the text (a reader, a copy);
    // at the start of the block line it takes no room.
    const terms = parts.flatMap((p, i) => (i > 0 ? [' · ', ...p] : [' ', ...p]));

    return el(d, 'span', { className: 'fs-kind' },
      freqLabel(r.frequency),
      parts.length ? el(d, 'span', { className: 'fs-terms' }, ...terms) : null);
  }

  /** The drawn note under the list, and the honest sentence when it applies. */
  private note(rows: Structure[]): HTMLElement {
    const d = this.o.doc;
    return el(d, 'div', { className: 'fs-note' },
      el(d, 'p', {
        text: 'এখানে যা লেখা থাকবে, মাসিক ইনভয়েস ঠিক তাই থেকে তৈরি হবে। চালু ফি বদলালে আগের ইনভয়েস বদলায় না।',
      }),
      // Shown only when it applies to something on screen.
      rows.some((r) => !r.billedByMonthlyRun)
        ? el(d, 'p', {
          text: 'যেসব ফি মাসিক নয়, সেগুলো মাসিক বিল তৈরির সময় যুক্ত হবে না — সেগুলো আলাদাভাবে আদায় করতে হবে।',
        })
        : null);
  }

  /**
   * The search and the year, for the header's cluster. The drawing shows
   * values only, so each label leaves the screen and stays the control's
   * `<label for>` — still announced.
   */
  private controls(data: Body): HTMLElement[] {
    const d = this.o.doc;

    const search = field(d, {
      label: 'খুঁজুন', name: 'q', kind: 'search', value: this.search,
      placeholder: 'ফি বা শ্রেণির নাম', className: 'fs-search',
      onInput: (v) => { this.search = v; this.render(); },
    });
    // The drawn chip reads "শিক্ষাবর্ষ ২০২৬", and so does this select's value.
    // It keeps the sheet's input look (R1): a chip there is a static label —
    // the অবস্থা column's চালু / বন্ধ — and the one control that switches the
    // year must not look like one. Switching works exactly as it did.
    const year = field(d, {
      label: 'শিক্ষাবর্ষ', name: 'year', kind: 'select', className: 'fs-year',
      value: this.yearId,
      options: data.years.map((y) => ({
        value: y.id,
        label: `শিক্ষাবর্ষ ${formatAcademicYear(y.label)}`,
      })),
      onChange: (v) => { this.yearId = v; void this.load(); },
    });
    // An <option> cannot hold a span, so the control carries the numeral
    // face (R6; `is-num`, or `.ui-input` would override `.n`).
    year.input.classList.add('n', 'is-num');
    for (const f of [search, year]) {
      f.root.querySelector('.ui-field-label')?.classList.add('ui-sr-only');
    }
    return [search.root, year.root];
  }

  /**
   * Secondary, both of them: they repeat on every row, and the page has one
   * primary. The warning lives where the decision is made — the confirmation
   * names what stays unchanged and carries the danger button.
   */
  private rowActions(r: Structure): HTMLElement {
    const d = this.o.doc;
    const row = buttonRow(d,
      button(d, {
        label: 'সম্পাদনা', size: 'sm', variant: 'secondary', disabled: this.busy,
        onClick: () => this.openForm(r),
      }),
      button(d, {
        label: 'সরান', size: 'sm', variant: 'secondary', disabled: this.busy,
        onClick: () => this.confirmRemove(r),
      }));
    row.classList.add('fs-actions');
    return row;
  }

  private confirmRemove(r: Structure): void {
    confirmOverlay(this.o.doc, {
      title: `${r.headBn} সরাবেন?`,
      // The question an accountant will actually ask, answered before they
      // have to ask it. invoice_lines stores its own amounts and does not
      // reference fee_structures, so an issued invoice cannot be changed here.
      body: `${r.classBn ?? 'পুরো প্রতিষ্ঠান'} — ${formatBdt(r.amount)}। `
        + 'এটি সরালে পরের মাস থেকে আর বিলে আসবে না। ইতিমধ্যে তৈরি হওয়া বিল ও রসিদ অপরিবর্তিত থাকবে।',
      confirmLabel: 'সরান',
      danger: true,
      onConfirm: async () => {
        // No drawer survives a delete, so a refusal belongs on the page.
        // Set after `send` resolves: its own `load()` would have cleared it.
        const msg = await this.send('DELETE', { id: r.id }, 'সরানো হয়েছে।');
        if (msg) { this.error = msg; this.render(); }
      },
    });
  }

  private openForm(existing: Structure | null): void {
    const d = this.o.doc;
    const data = this.data;
    if (!data) return;

    const form = el(d, 'div', { className: 'ui-fieldset' });

    // Editing never re-points a price at a different head or class: that is a
    // different fee, and the unique scope would collide with the real one.
    const headField = existing
      ? null
      : field(d, {
        label: 'কোন ফি', name: 'feeHeadId', kind: 'select', required: true,
        options: data.heads.filter((h) => h.isActive).map((h) => ({
          value: h.id, label: `${h.nameBn} — ${freqLabel(h.frequency)}`,
        })),
        helper: 'কেবল মাসিক ফি স্বয়ংক্রিয়ভাবে মাসিক বিলে যুক্ত হয়।',
      });

    const classField = existing
      ? null
      : field(d, {
        label: 'কার জন্য', name: 'classId', kind: 'select',
        options: [
          { value: '', label: 'পুরো প্রতিষ্ঠান' },
          ...data.classes.map((c) => ({ value: c.id, label: c.nameBn })),
        ],
        helper: 'শ্রেণির জন্য আলাদা ফি দিলে সেটিই প্রাধান্য পাবে।',
      });

    // `kind: 'number'` already sets these in the numeral face (`n is-num`).
    const amount = field(d, {
      label: 'টাকার অঙ্ক', name: 'amount', kind: 'number', required: true,
      value: existing ? String(existing.amount) : '',
      attrs: { min: 0, step: 1 },
    });
    const dueDay = field(d, {
      label: 'প্রতি মাসের কত তারিখে শেষ', name: 'dueDayOfMonth', kind: 'number',
      value: existing?.dueDayOfMonth === null || existing?.dueDayOfMonth === undefined
        ? '' : String(existing.dueDayOfMonth),
      helper: 'ঐচ্ছিক — ১ থেকে ২৮ (ফেব্রুয়ারির কারণে ২৮-এর বেশি নয়)।',
      attrs: { min: 1, max: 28, step: 1 },
    });
    const lateFee = field(d, {
      label: 'দৈনিক বিলম্ব ফি', name: 'lateFeePerDay', kind: 'number',
      value: String(existing?.lateFeePerDay ?? 0),
      helper: 'ঐচ্ছিক — শূন্য মানে বিলম্ব ফি নেই।',
      attrs: { min: 0, step: 1 },
    });
    const lateCap = field(d, {
      label: 'বিলম্ব ফির সর্বোচ্চ সীমা', name: 'lateFeeCap', kind: 'number',
      value: existing?.lateFeeCap === null || existing?.lateFeeCap === undefined
        ? '' : String(existing.lateFeeCap),
      helper: 'ঐচ্ছিক।',
      attrs: { min: 0, step: 1 },
    });

    // A refusal is shown here, beside the values that caused it, and the
    // drawer stays open so they do not have to be retyped.
    const errLine = el(d, 'p', {
      className: 'ui-field-error',
      attrs: { role: 'alert', hidden: 'hidden' },
    });
    append(form, errLine);

    for (const f of [headField, classField, amount, dueDay, lateFee, lateCap]) {
      if (f) append(form, f.root);
    }

    let handle: OverlayHandle;
    const cancel = button(d, { label: 'বাতিল', variant: 'secondary', onClick: () => handle.close() });
    const save = button(d, {
      label: existing ? 'সংরক্ষণ করুন' : 'নির্ধারণ করুন',
      variant: 'primary',
      onClick: async () => {
        const num = (v: string) => (v.trim() === '' ? null : Number(v));
        const payload: Record<string, unknown> = {
          amount: Number(amount.input.value),
          dueDayOfMonth: num(dueDay.input.value),
          lateFeePerDay: num(lateFee.input.value) ?? 0,
          lateFeeCap: num(lateCap.input.value),
        };
        if (existing) {
          payload.id = existing.id;
        } else {
          payload.feeHeadId = headField?.input.value ?? '';
          payload.academicYearId = this.yearId;
          const cls = classField?.input.value ?? '';
          payload.classId = cls === '' ? null : cls;
        }

        errLine.setAttribute('hidden', 'hidden');
        setBusy(save, true);
        // The drawer closes only once the server has accepted it. It used to
        // close here, before the request was even sent, so a refusal looked
        // exactly like a save.
        const msg = await this.send(existing ? 'PATCH' : 'POST', payload,
          existing ? 'সংরক্ষণ করা হয়েছে।' : 'নির্ধারণ করা হয়েছে।');
        setBusy(save, false);
        if (!msg) { handle.close(); return; }
        // The server's sentence can carry a figure ("২৮"): numbers in the
        // numeral face (R6), the text itself unchanged.
        errLine.textContent = '';
        append(errLine, ...numText(d, msg));
        errLine.removeAttribute('hidden');
        // Announced as well as shown: focus is on the button just pressed, and
        // a message that only appears is one a screen-reader user never gets.
        announce(d, msg, true);
      },
    });
    handle = openDrawer(d, {
      title: existing ? `${existing.headBn} সম্পাদনা` : 'নতুন ফি নির্ধারণ',
      body: form,
      actions: [cancel, save],
    });
  }
}
