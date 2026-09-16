/**
 * ব্যবহারকারী — user management for the IT admin  (R-3, Part B)
 *
 * ── There is no delete, and the screen says why ────────────────────────
 * A teacher who left in 2024 still marked attendance in 2024 and is still the
 * answer to "who taught this section". The control is নিষ্ক্রিয় — deactivate —
 * and the confirmation states that their record stays. Without that sentence a
 * school looking for a delete button assumes the product cannot do what it
 * needs and starts keeping a parallel list on paper. The list's own footer
 * says it too, so the rule is on screen before anyone reaches for the button.
 *
 * ── Creating an account does not create a credential ───────────────────
 * The account is created 'invited'. First login goes through F-202's
 * activation code, which is a separate, audited act. So this screen never
 * shows, sets, or emails a password — there is nothing here to leak.
 *
 * ── Search is exact on phone, loose on name ────────────────────────────
 * Deliberate, and enforced server-side: a prefix search over a phone column is
 * a way to enumerate a school's contact list one digit at a time. The
 * placeholder tells the user which is which so the behaviour does not read as
 * a bug.
 *
 * ── Ata Ekta (05 Principal §03 usersScreen) ────────────────────────────
 * One panel, top to bottom: the filter band, the table, the footer note under
 * a 2px rule. The header carries the page's one primary, "নতুন অ্যাকাউন্ট".
 * Loading, empty and a failed load all render INSIDE the panel, under the
 * filter band, so the search stays where it was while the list is replaced.
 * The drawn মোবাইল column appears only for a caller who may manage accounts;
 * a read-only reader never sees the school's phone numbers.
 */
import type { Auth } from './auth.ts';
import { ROLE_BN } from './ui/roles.ts';
import {
  el, append, numText, button, buttonRow, dataTable, statusBadge, field, searchField,
  pageHeader, sectionHeading, confirmOverlay, listSkeleton, errorState, emptyState,
  successNote, permissionState, permissionMessage,
} from './ui/index.ts';
import { formatIdentifier } from '../../../packages/ui-core/src/format.ts';

interface UserRow {
  id: string; nameBn: string; nameEn: string | null; phone: string | null;
  status: string; roles: string[];
  employeeCode: string | null; studentCode: string | null;
}

export interface UsersViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  /** Whether this caller may create and deactivate. The server is the gate. */
  canManage: boolean;
}


const STATUS_BN: Record<string, string> = {
  active: 'সক্রিয়', invited: 'আমন্ত্রিত', suspended: 'স্থগিত',
  left: 'নিষ্ক্রিয়', deleted: 'মুছে ফেলা',
};

/** The roles an IT admin may hand out — mirrors the server's GRANTABLE set. */
const GRANTABLE = [
  'principal', 'academic_coordinator', 'dept_head', 'accountant',
  'class_teacher', 'subject_teacher', 'librarian', 'it_admin',
];

/**
 * A stored number as an office reads it: `+8801712345678` → `01712345678`.
 *
 * Display only. The digits stay Latin — a phone is an identifier someone
 * copies onto a slip or dials (`formatIdentifier`) — and the search box still
 * sends exactly what the person types.
 */
const localPhone = (p: string): string => formatIdentifier(p.replace(/^\+?88(?=01)/, ''));

export class UsersView {
  /**
   * The code just issued, shown once.  (R-7 completion)
   *
   * `activation_issue_scope` (migration 037) has always let a principal issue
   * a code for anyone in their school, and the only UI that offered it was the
   * student roster. So a teacher or IT admin created on THIS screen — which
   * tells the operator "প্রথমবার প্রবেশের জন্য অ্যাক্টিভেশন কোড লাগবে" — had
   * no way to be given one. Backend complete, UI absent, and the gap was
   * exactly the account a newly onboarded school needs first.
   */
  private issued: { nameBn: string; code: string } | null = null;
  private issuing: string | null = null;

  private readonly o: UsersViewOptions;
  private users: UserRow[] = [];
  private truncated = false;
  private term = '';
  private roleFilter = '';
  private loading = true;
  private error = '';
  /** The server refused. Distinct from `error`: no control on this screen helps. */
  private denied = false;
  private notice = '';
  private busy = false;
  private creating = false;

  constructor(options: UsersViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.error = ''; this.denied = false; this.render();
    try {
      const qs = new URLSearchParams();
      if (this.term) qs.set('q', this.term);
      if (this.roleFilter) qs.set('role', this.roleFilter);
      const res = await this.o.auth.authedFetch(`/api/v1/ops/users?${qs}`);
      if (res.status === 403) { this.denied = true; return; }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { users: UserRow[]; truncated: boolean };
      this.users = body.users ?? [];
      this.truncated = body.truncated ?? false;
    } catch {
      this.error = 'তালিকা আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।';
    } finally {
      this.loading = false; this.render();
    }
  }

  private async create(form: {
    nameBn: string; nameEn: string; phone: string; roleCode: string; employeeCode: string;
  }): Promise<void> {
    this.busy = true; this.error = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json() as { nameBn?: string; message?: string };
      if (!res.ok) { this.error = body.message ?? 'অ্যাকাউন্ট তৈরি করা যায়নি।'; return; }
      this.notice =
        `${body.nameBn} যুক্ত হয়েছেন। প্রথমবার প্রবেশের জন্য অ্যাক্টিভেশন কোড লাগবে।`;
      this.creating = false;
      await this.load();
    } catch {
      this.error = 'সংযোগ নেই — অ্যাকাউন্ট তৈরি করা যায়নি।';
    } finally {
      this.busy = false; this.render();
    }
  }

  private async setActive(u: UserRow, active: boolean): Promise<void> {
    this.busy = true; this.error = ''; this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, active }),
      });
      const body = await res.json() as { message?: string };
      if (!res.ok) { this.error = body.message ?? 'পরিবর্তন করা যায়নি।'; return; }
      this.notice = active
        ? `${u.nameBn} আবার সক্রিয়।`
        : `${u.nameBn} নিষ্ক্রিয় — তাঁর আগের সব রেকর্ড অপরিবর্তিত আছে।`;
      await this.load();
    } catch {
      this.error = 'সংযোগ নেই — পরিবর্তন করা যায়নি।';
    } finally {
      this.busy = false; this.render();
    }
  }

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // The header's primary is a control, and a refused caller is offered none.
    const manage = this.o.canManage && !this.denied;
    root.append(pageHeader(d, {
      title: 'ব্যবহারকারী',
      subtitle: 'শিক্ষক ও কর্মীর অ্যাকাউন্ট',
      primary: manage ? this.createToggle() : undefined,
    }));

    // P5. A refusal is the WHOLE answer, and it comes before the search bar.
    //
    // The security matrix drove this screen as a class teacher and found the
    // refusal rendered correctly — and then a live name box, a role filter
    // and a "খুঁজুন" button underneath it. Three controls whose only possible
    // outcome is a second 403: an invitation to a refusal, which is the
    // pattern this codebase removes everywhere else.
    if (this.denied) {
      root.append(permissionState(d, {
        message: permissionMessage('ব্যবহারকারী'),
        contact: 'প্রধান শিক্ষক, প্রতিষ্ঠান মালিক ও আইটি অ্যাডমিন',
      }));
      return;
    }

    // With no rows to show, a failure takes the list's place inside the panel.
    // It is an error, not an empty school: it never ALSO says
    // "এখনো কোনো ব্যবহারকারী নেই".
    const nothingToShow = !this.loading && this.users.length === 0;
    const errorInPanel = nothingToShow && this.error !== '';

    if (this.notice) root.append(successNote(d, this.notice));
    if (this.error && !errorInPanel) {
      const err = errorState(d, this.error, () => void this.load());
      err.classList.add('users-note');
      root.append(err);
    }
    // Above the list, so it is the first thing read after issuing.
    if (this.issued) root.append(this.issuedCard());
    if (this.o.canManage && this.creating) root.append(this.createForm());

    const panel = el(d, 'div', { className: 'card users-panel' });
    root.append(panel);
    panel.append(this.filters());

    if (this.loading) { panel.append(listSkeleton(d, 4)); return; }

    if (errorInPanel) {
      panel.append(errorState(d, this.error, () => void this.load()));
      return;
    }

    if (nothingToShow) {
      panel.append(emptyState(d, {
        glyph: 'users',
        message: this.term
          ? 'এই নামে বা নম্বরে কাউকে পাওয়া যায়নি। মোবাইল নম্বর পুরোটা লিখতে হয়।'
          : this.roleFilter
            ? `${ROLE_BN[this.roleFilter] ?? this.roleFilter} ভূমিকায় কাউকে পাওয়া যায়নি।`
            : 'এখনো কোনো ব্যবহারকারী নেই।',
        action: this.o.canManage
          ? { label: 'নতুন যোগ করুন', onClick: () => { this.creating = true; this.render(); } }
          : undefined,
      }));
      return;
    }

    panel.append(dataTable(d, {
      caption: 'ব্যবহারকারীর তালিকা',
      rows: this.users,
      rowKey: (u) => u.id,
      columns: [
        {
          key: 'name', header: 'নাম', mobile: 'title',
          cell: (u) => u.nameBn,
        },
        {
          key: 'roles', header: 'ভূমিকা', mobile: 'subtitle',
          cell: (u) => u.roles.map((r) => ROLE_BN[r] ?? r).join(' · ') || 'ভূমিকা নেই',
        },
        // The number is shown only to a caller who may manage accounts. The
        // list holds guardians and students as well as staff, and a read-only
        // reader (the academic coordinator builds timetables from this list)
        // has no use for a contact list on screen. It is the same line the
        // guardian drawer draws: a phone is withheld from anyone who may not
        // edit it. Before the redesign the number was never on screen at all.
        ...(this.o.canManage ? [{
          key: 'phone', header: 'মোবাইল', mobile: 'meta' as const,
          // `dir=ltr`: a Latin number inside a Bangla row must not reorder.
          cell: (u: UserRow) => u.phone
            ? el(d, 'span', { className: 'n', text: localPhone(u.phone), attrs: { dir: 'ltr' } })
            : '—',
        }] : []),
        {
          key: 'code', header: 'আইডি', mobile: 'meta',
          // The staff or student CODE, never the uuid. A uuid on screen is a
          // string nobody can read down a phone and nobody should have to.
          cell: (u) => {
            const c = u.employeeCode ?? u.studentCode;
            return c ? el(d, 'span', { className: 'n', text: formatIdentifier(c) }) : '—';
          },
        },
        {
          key: 'status', header: 'অবস্থা', mobile: 'status',
          // The raw state, so the shared table decides the tone: active is
          // ok, invited is info, suspended is danger with a glyph, and a
          // departed account is neutral — it left, nothing went wrong.
          cell: (u) => statusBadge(d, {
            state: u.status,
            // A word, never the tint alone: "সক্রিয়" and "নিষ্ক্রিয়" differ by
            // more than a colour to somebody who cannot see the colour.
            label: STATUS_BN[u.status] ?? u.status,
          }),
        },
        // On a phone the pair lands in the row's detail line, after the
        // number and the code, where a thumb can reach it.
        ...(this.o.canManage ? [{
          key: 'actions', header: 'ব্যবস্থা', mobile: 'meta' as const,
          cell: (u: UserRow) => this.rowActions(u),
        }] : []),
      ],
    }), this.footer());
  }

  /** The page's one primary: opens the form, and becomes its way out. */
  private createToggle(): HTMLButtonElement {
    const d = this.o.doc;
    return button(d, {
      label: this.creating ? 'বাতিল' : 'নতুন অ্যাকাউন্ট',
      // While the form is open its submit is the primary, so this steps down.
      variant: this.creating ? 'secondary' : 'primary',
      size: 'sm',
      onClick: () => { this.creating = !this.creating; this.render(); },
    });
  }

  /** Under the table, over a 2px rule, as drawn. */
  private footer(): HTMLElement {
    const d = this.o.doc;
    return el(d, 'div', { className: 'users-foot' },
      // Never let a capped list read as a complete one.
      this.truncated
        ? el(d, 'p', { className: 'users-foot-cap' },
          ...numText(d, 'প্রথম ৫০ জন দেখানো হচ্ছে — খুঁজতে নাম বা নম্বর লিখুন।'))
        : null,
      el(d, 'p', {
        text: 'নিষ্ক্রিয় করলে অ্যাকাউন্ট মুছে যায় না — তার নেওয়া হাজিরা ও দেওয়া নম্বর কার্যবিবরণীতে থেকে যায়।',
      }));
  }

  /**
   * The filter band: a name-or-number box and a role select.
   *
   * The select's label is only moved out of sight — the band draws none, and
   * the select shows its own value — so it is still announced.
   */
  private filters(): HTMLElement {
    const d = this.o.doc;
    const search = searchField(d, {
      label: 'ব্যবহারকারী খুঁজুন',
      placeholder: 'নামের অংশ, অথবা পুরো মোবাইল নম্বর',
      value: this.term || undefined,
      onSearch: (q) => { this.term = q; void this.load(); },
    });
    const role = field(d, {
      label: 'ভূমিকা', name: 'role', kind: 'select', className: 'users-role',
      value: this.roleFilter,
      options: [
        { value: '', label: 'সব ভূমিকা' },
        ...[...GRANTABLE, 'student', 'guardian'].map((r) => ({ value: r, label: ROLE_BN[r] ?? r })),
      ],
      onChange: (v) => { this.roleFilter = v; void this.load(); },
    });
    role.root.querySelector('.ui-field-label')?.classList.add('ui-sr-only');
    return el(d, 'div', { className: 'users-filters' }, search.root, role.root);
  }

  private createForm(): HTMLElement {
    const d = this.o.doc;
    const nameBn = field(d, { label: 'নাম (বাংলা)', name: 'nameBn', required: true });
    const nameEn = field(d, { label: 'নাম (ইংরেজি)', name: 'nameEn' });
    const phone = field(d, {
      label: 'মোবাইল', name: 'phone', kind: 'tel', required: true, placeholder: '01XXXXXXXXX',
    });
    // Required, because `staff_profiles.employee_code` is NOT NULL and has
    // been since the schema was written. Marked optional here, the form let a
    // principal submit a blank and receive `internal_error` — the constraint
    // was real and only the message was missing.
    const employeeCode = field(d, { label: 'কর্মচারী আইডি', name: 'employeeCode', required: true });
    const role = field(d, {
      label: 'ভূমিকা', name: 'roleCode', kind: 'select', value: 'subject_teacher',
      options: GRANTABLE.map((r) => ({ value: r, label: ROLE_BN[r] ?? r })),
    });

    const form = el(d, 'form', { className: 'card users-create' },
      sectionHeading(d, { title: 'নতুন অ্যাকাউন্ট' }),
      el(d, 'div', { className: 'users-create-grid' },
        nameBn.root, nameEn.root, phone.root, employeeCode.root, role.root),
      el(d, 'p', {
        className: 'ui-field-help users-create-note',
        text: 'অ্যাকাউন্ট তৈরি হবে "আমন্ত্রিত" অবস্থায়। প্রথমবার প্রবেশের জন্য অ্যাক্টিভেশন কোড দিতে হবে — '
          + 'এখানে কোনো পাসওয়ার্ড তৈরি বা দেখা যায় না।',
      }),
      buttonRow(d, button(d, {
        label: this.busy ? 'যোগ হচ্ছে…' : 'যোগ করুন',
        variant: 'primary', type: 'submit', busy: this.busy,
      })));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.create({
        nameBn: nameBn.value().trim(),
        nameEn: nameEn.value().trim(),
        phone: phone.value().trim(),
        roleCode: role.value(),
        employeeCode: employeeCode.value().trim(),
      });
    });
    return form;
  }

  /**
   * The two things an IT admin can do to an account, as a pair of controls.
   *
   * Both were on the old row and both keep their behaviour exactly: an
   * activation code is offered only to an account that can still sign in — a
   * deactivated one is not handed a way back in — and deactivation asks first.
   */
  private rowActions(u: UserRow): HTMLElement {
    const d = this.o.doc;
    const wrap = el(d, 'div', { className: 'ui-row-actions' });
    const isActive = u.status === 'active' || u.status === 'invited';

    if (isActive) {
      const codeBtn = button(d, {
        label: this.issuing === u.id ? '…' : 'কোড',
        variant: 'secondary', size: 'sm',
        disabled: this.issuing !== null || this.busy,
        onClick: () => { void this.issueCode(u); },
      });
      // Per-person, because forty buttons all called "কোড" are forty
      // identical announcements.
      codeBtn.setAttribute('aria-label', `${u.nameBn} এর জন্য সক্রিয়ন কোড তৈরি করুন`);
      codeBtn.dataset.action = 'issue-code';
      append(wrap, codeBtn);
    }

    const btn = button(d, {
      label: isActive ? 'নিষ্ক্রিয় করুন' : 'আবার সক্রিয় করুন',
      variant: 'ghost', size: 'sm',
      disabled: this.busy,
      onClick: () => {
        if (!isActive) { void this.setActive(u, true); return; }
        // §7: a destructive action states its reason in the shared overlay —
        // focus on Cancel, a danger confirm, a sheet on a phone.
        confirmOverlay(d, {
          title: 'নিষ্ক্রিয় করা নিশ্চিত করুন',
          body:
            `${u.nameBn} আর প্রবেশ করতে পারবেন না। তাঁর নেওয়া হাজিরা, দেওয়া নম্বর এবং ` +
            'দায়িত্বের রেকর্ড মুছে যাবে না — কে কখন কী করেছিলেন তা সংরক্ষিত থাকবে।',
          confirmLabel: 'নিষ্ক্রিয় করুন',
          danger: true,
          onConfirm: () => this.setActive(u, false),
        });
      },
    });
    btn.setAttribute('aria-label',
      `${u.nameBn}-কে ${isActive ? 'নিষ্ক্রিয়' : 'আবার সক্রিয়'} করুন`);
    append(wrap, btn);
    return wrap;
  }

  private async issueCode(u: UserRow): Promise<void> {
    if (this.issuing) return;
    this.issuing = u.id;
    this.error = '';
    this.notice = '';
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/auth/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'issue', userId: u.id }),
      });
      const body = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !body.code) {
        this.error = body.error === 'activation_unconfigured'
          ? 'এই সুবিধাটি এখনো চালু হয়নি।'
          : 'কোড তৈরি করা যায়নি। আবার চেষ্টা করুন।';
      } else {
        this.issued = { nameBn: u.nameBn, code: body.code };
      }
    } catch {
      this.error = 'সংযোগ পাওয়া যায়নি।';
    } finally {
      this.issuing = null;
      this.render();
    }
  }

  /**
   * The one place the code is visible, and it is visible once.
   *
   * Same shape and same warnings as the roster's: read across a desk,
   * dismissed deliberately, honest that issuing again kills it. The dismiss
   * is secondary: the header's "নতুন অ্যাকাউন্ট" is still the page's primary.
   */
  private issuedCard(): HTMLElement {
    const d = this.o.doc;
    const issued = this.issued as NonNullable<typeof this.issued>;
    return el(d, 'section', {
      className: 'card issued-code-card users-code', attrs: { role: 'status' },
    },
      el(d, 'p', { className: 'issued-code-who' }, ...numText(d, `${issued.nameBn} এর সক্রিয়ন কোড`)),
      // Split for reading aloud; the server strips separators on redeem. Latin,
      // because it is typed back exactly; `n`, because it is a figure to copy.
      el(d, 'p', {
        className: 'issued-code-value n', attrs: { dir: 'ltr' },
        text: `${issued.code.slice(0, 4)}-${issued.code.slice(4)}`,
      }),
      el(d, 'p', { className: 'issued-code-note' },
        ...numText(d, 'কোডটি লিখে তাঁকে দিন — এটি আর দেখা যাবে না। '
          + 'মেয়াদ ৭২ ঘণ্টা; নতুন কোড তৈরি করলে এটি বাতিল হয়ে যাবে।')),
      button(d, {
        label: 'বুঝেছি', variant: 'secondary',
        onClick: () => { this.issued = null; this.render(); },
      }));
  }
}
