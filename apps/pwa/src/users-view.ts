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
 *
 * ── Focus (UX sweep 38, 58) ────────────────────────────────────────────
 * Every render redraws the screen. The places a person TYPES — the filter
 * band and the create form — are built once and kept: a redraw leaves those
 * nodes where they are, so what was typed, the caret, a phone keyboard's
 * composition and an open select all survive a list arriving mid-word (and a
 * failed create no longer hands back an empty form). Everything else is
 * rebuilt. Putting focus back on the SAME button after a rebuild is the
 * shell's job (`keepFocusWithin` on the view), and the controls whose label
 * changes carry a `data-focus-key` so it can find them. What this screen does
 * itself is the moves only it knows: into the form it just opened, onto the
 * confirmation after an account is created, onto the code or the failure
 * after issuing one, and back to the row when the code is dismissed. Each is
 * made only when focus has actually been lost — a person who moved on while
 * the request was out keeps where they went.
 */
import type { Auth } from './auth.ts';
import { ROLE_BN } from './ui/roles.ts';
import {
  el, append, numText, button, buttonRow, dataTable, statusBadge, field, searchField,
  pageHeader, sectionHeading, confirmOverlay, listSkeleton, errorState, emptyState,
  successNote, permissionState, permissionMessage, focusIsLost, uid,
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

/**
 * A place to send focus after a render: the control carrying this
 * `data-focus-key`, inside the row with this `data-key` when `row` is given.
 */
interface FocusTarget { key: string; row?: string }

/**
 * Whether trying the same request again can help. A timeout, a rate limit or
 * a server fault can; a refusal (403), a missing person (404) or a malformed
 * request (400) will answer the same way every time.
 */
const retryable = (status: number): boolean => status >= 500 || status === 408 || status === 429;

/**
 * Make `parent`'s children exactly `nodes`, in that order, without moving a
 * node that is already there in the right order.
 *
 * `textContent = ''` and a fresh append detach everything, and a detached
 * text field loses its focus, its caret and — on an Android keyboard that
 * composes Bangla — the word being typed. Removing the nodes that are not
 * wanted first leaves the kept ones in their old order; each new node is then
 * inserted in front of the next kept one, which therefore never moves.
 */
function place(parent: HTMLElement, nodes: Node[]): void {
  const want = new Set(nodes);
  for (const c of [...parent.childNodes]) if (!want.has(c)) c.remove();
  let at = parent.firstChild;
  for (const n of nodes) {
    if (n === at) { at = at.nextSibling; continue; }
    parent.insertBefore(n, at);
  }
}

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
  private issued: { userId: string; nameBn: string; code: string } | null = null;
  private issuing: string | null = null;

  private readonly o: UsersViewOptions;
  private users: UserRow[] = [];
  private truncated = false;
  private term = '';
  private roleFilter = '';
  private loading = true;
  private error = '';
  /**
   * What this error's "আবার চেষ্টা করুন" repeats, or null when no button
   * would help.  (UX sweep 45)
   *
   * Every error used to offer a retry that reloaded the LIST, whatever had
   * failed. A failed activation code got a button that wiped its own message,
   * drew no code and said nothing — it read as if the retry had worked. So
   * the retry is kept beside the error it belongs to: a failed code retries
   * the code; a failed create or (de)activation has none, because the form's
   * submit and the row's button are already the way to try again.
   */
  private retry: (() => void) | null = null;
  /** The error is the list's own (a failed load), so it takes the list's place. */
  private listFailed = false;
  /** The server refused. Distinct from `error`: no control on this screen helps. */
  private denied = false;
  private notice = '';
  private busy = false;
  private creating = false;
  /**
   * The nodes a person types into, kept across renders (see the header).
   * `form` exists while the create form is open; closing it discards what
   * was typed, which is what বাতিল means.
   */
  private panel: HTMLElement | null = null;
  private band: HTMLElement | null = null;
  private form: { root: HTMLFormElement; actions: HTMLElement } | null = null;
  /**
   * The latest list request. The role select now keeps focus through its own
   * reload, so ArrowDown ArrowDown sends two requests, and on a slow network
   * the first can answer last. Only the newest answer may draw the list,
   * or the select says প্রধান শিক্ষক over a list of accountants.
   */
  private loadSeq = 0;

  constructor(options: UsersViewOptions) {
    this.o = options;
    this.render();
    void this.load();
  }

  private fail(message: string, retry: (() => void) | null, list = false): void {
    this.error = message; this.retry = retry; this.listFailed = list;
  }

  private clearError(): void {
    this.error = ''; this.retry = null; this.listFailed = false;
  }

  /**
   * @param refresh The list is being re-read after an action on it. The rows
   *   stay on screen until the new ones arrive. A skeleton in their place
   *   shrinks the page to the viewport, and the browser clamps the scroll to
   *   the top: the person who deactivated the thirtieth row was sent back to
   *   the first.  (UX sweep 58)
   */
  private async load(refresh = false): Promise<void> {
    const seq = ++this.loadSeq;
    const current = () => seq === this.loadSeq;
    const quiet = refresh && this.users.length > 0;
    this.loading = !quiet; this.clearError(); this.denied = false;
    if (!quiet) this.render();
    try {
      const qs = new URLSearchParams();
      if (this.term) qs.set('q', this.term);
      if (this.roleFilter) qs.set('role', this.roleFilter);
      const res = await this.o.auth.authedFetch(`/api/v1/ops/users?${qs}`);
      if (!current()) return;
      if (res.status === 403) { this.denied = true; return; }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { users: UserRow[]; truncated: boolean };
      if (!current()) return;
      this.users = body.users ?? [];
      this.truncated = body.truncated ?? false;
    } catch {
      if (current()) {
        this.fail('তালিকা আনা যায়নি — সংযোগ পেলে আবার দেখা যাবে।', () => void this.load(), true);
      }
    } finally {
      // A superseded request draws nothing: the newer one is still loading.
      if (current()) { this.loading = false; this.render(); }
    }
  }

  private async create(form: {
    nameBn: string; nameEn: string; phone: string; roleCode: string; employeeCode: string;
  }): Promise<void> {
    this.busy = true; this.clearError(); this.render();
    let next: FocusTarget[] | undefined;
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json() as { nameBn?: string; message?: string };
      if (!res.ok) { this.fail(body.message ?? 'অ্যাকাউন্ট তৈরি করা যায়নি।', null); return; }
      this.notice =
        `${body.nameBn} যুক্ত হয়েছেন। প্রথমবার প্রবেশের জন্য অ্যাক্টিভেশন কোড লাগবে।`;
      // The form stays, its submit busy, until the list has the new person:
      // one change on screen, not a closed form over a stale list.
      await this.load(true);
      this.creating = false; this.form = null;
      // The form and its submit are gone. The confirmation is where the
      // person is sent, and focusing it is what gets it read out.
      next = [{ key: 'users-notice' }, { key: 'create-toggle' }];
    } catch {
      this.fail('সংযোগ নেই — অ্যাকাউন্ট তৈরি করা যায়নি।', null);
    } finally {
      this.busy = false; this.render(next);
    }
  }

  private async setActive(u: UserRow, active: boolean): Promise<void> {
    // Focus: the row's own button is rebuilt (busy, then with its new label)
    // and the shell's keeper puts focus back on it by its `data-focus-key`
    // and its shape's row (`data-id`, see draw) — after the confirm dialog
    // closes, for a deactivation.
    this.busy = true; this.clearError(); this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/ops/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, active }),
      });
      const body = await res.json() as { message?: string };
      if (!res.ok) { this.fail(body.message ?? 'পরিবর্তন করা যায়নি।', null); return; }
      this.notice = active
        ? `${u.nameBn} আবার সক্রিয়।`
        : `${u.nameBn} নিষ্ক্রিয় — তাঁর আগের সব রেকর্ড অপরিবর্তিত আছে।`;
      await this.load(true);
    } catch {
      this.fail('সংযোগ নেই — পরিবর্তন করা যায়নি।', null);
    } finally {
      this.busy = false; this.render();
    }
  }

  /**
   * Draw the screen, then — when `focus` is given and focus was lost in the
   * rebuild — move it to the first of those places that takes it. A target
   * inside the shape CSS hides (table or list) refuses focus in a browser,
   * so each candidate is tried in turn.
   */
  private render(focus?: FocusTarget[]): void {
    this.draw();
    if (!focus) return;
    const d = this.o.doc;
    if (!focusIsLost(d)) return;
    for (const t of focus) {
      for (const node of this.o.root.querySelectorAll<HTMLElement>(`[data-focus-key="${t.key}"]`)) {
        if (t.row && node.closest('[data-key]')?.getAttribute('data-key') !== t.row) continue;
        if ((node as HTMLButtonElement).disabled) continue;
        node.focus();
        if (d.activeElement === node) return;
      }
    }
  }

  /**
   * Redraw. The filter band and an open create form are the same nodes as
   * last time and are not moved (`place`); everything else is new.
   */
  private draw(): void {
    const d = this.o.doc;
    const top: Node[] = [];

    // The header's primary is a control, and a refused caller is offered none.
    const manage = this.o.canManage && !this.denied;
    top.push(pageHeader(d, {
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
      top.push(permissionState(d, {
        message: permissionMessage('ব্যবহারকারী'),
        contact: 'প্রধান শিক্ষক, প্রতিষ্ঠান মালিক ও আইটি অ্যাডমিন',
      }));
      place(this.o.root, top);
      return;
    }

    // With no rows to show, a failure takes the list's place inside the panel.
    // It is an error, not an empty school: it never ALSO says
    // "এখনো কোনো ব্যবহারকারী নেই".
    const nothingToShow = !this.loading && this.users.length === 0;
    // Only the list's own failure stands in for the list. A failed create on
    // an empty school is shown above its form, and the panel still says the
    // school is empty.
    const errorInPanel = nothingToShow && this.error !== '' && this.listFailed;

    if (this.notice) {
      const note = successNote(d, this.notice);
      // A focus target (a created account), never a Tab stop.
      note.setAttribute('tabindex', '-1');
      note.dataset.focusKey = 'users-notice';
      top.push(note);
    }
    if (this.error && !errorInPanel) {
      const err = this.errorCard();
      err.classList.add('users-note');
      top.push(err);
    }
    // Above the list, so it is the first thing read after issuing.
    if (this.issued) top.push(this.issuedCard());
    if (this.o.canManage && this.creating) top.push(this.createForm());

    this.panel ??= el(d, 'div', { className: 'card users-panel' });
    this.band ??= this.filters();
    top.push(this.panel);
    place(this.o.root, top);
    place(this.panel, [this.band, ...this.listBody(nothingToShow, errorInPanel)]);
  }

  /** What stands under the filter band: the list, or what is there instead. */
  private listBody(nothingToShow: boolean, errorInPanel: boolean): Node[] {
    const d = this.o.doc;
    if (this.loading) return [listSkeleton(d, 4)];

    if (errorInPanel) return [this.errorCard()];

    if (nothingToShow) {
      return [emptyState(d, {
        glyph: 'users',
        message: this.term
          ? 'এই নামে বা নম্বরে কাউকে পাওয়া যায়নি। মোবাইল নম্বর পুরোটা লিখতে হয়।'
          : this.roleFilter
            ? `${ROLE_BN[this.roleFilter] ?? this.roleFilter} ভূমিকায় কাউকে পাওয়া যায়নি।`
            : 'এখনো কোনো ব্যবহারকারী নেই।',
        action: this.o.canManage
          ? { label: 'নতুন যোগ করুন', onClick: () => this.toggleForm(true) }
          : undefined,
      })];
    }

    const table = dataTable(d, {
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
    });
    // Each row's actions are drawn twice, once per shape (the table and the
    // phone list), and CSS shows one. Each copy is named by its shape, so the
    // shell's focus keeper, finding a row's control again after a rebuild,
    // stays in the shape the person is using. Without it a tie went to the
    // first copy in the DOM — the hidden table, on a phone — which cannot
    // take focus, and focus was parked on the page instead of the row.
    for (const [shape, sel] of [['table', 'table.ui-table'], ['list', '.ui-list']] as const) {
      for (const w of table.querySelectorAll<HTMLElement>(`${sel} .ui-row-actions`)) {
        const key = w.closest('[data-key]')?.getAttribute('data-key');
        if (key) w.dataset.id = `${shape}:${key}`;
      }
    }
    return [table, this.footer()];
  }

  /** The page's one primary: opens the form, and becomes its way out. */
  private createToggle(): HTMLButtonElement {
    const d = this.o.doc;
    return button(d, {
      label: this.creating ? 'বাতিল' : 'নতুন অ্যাকাউন্ট',
      // While the form is open its submit is the primary, so this steps down.
      variant: this.creating ? 'secondary' : 'primary',
      size: 'sm',
      // One control under two labels: the keeper must know it as one.
      attrs: { 'data-focus-key': 'create-toggle' },
      onClick: () => this.toggleForm(!this.creating),
    });
  }

  /**
   * Open or close the create form. Opening sends focus to its first field:
   * without that, focus fell to <body> and a screen reader was never told a
   * form had opened. Closing sends it back to the toggle.  (UX sweep 38, 58)
   */
  private toggleForm(open: boolean): void {
    this.creating = open;
    if (!open) this.form = null;
    this.render([{ key: open ? 'create-first' : 'create-toggle' }]);
  }

  /**
   * The error card, with the retry that belongs to this error (or none).
   * Its message is also where focus goes when a code fails and no retry
   * would help: the card sits above the list, out of sight of a person
   * forty rows down.
   */
  private errorCard(): HTMLElement {
    const d = this.o.doc;
    const err = errorState(d, this.error, this.retry ?? undefined);
    const alert = err.querySelector<HTMLElement>('[role="alert"]');
    alert?.setAttribute('tabindex', '-1');
    alert?.setAttribute('data-focus-key', 'users-error');
    err.querySelector('.ui-state-action')?.setAttribute('data-focus-key', 'users-retry');
    return err;
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
   *
   * Built once and kept (`this.band`). A search or a role change reloads
   * only what is under it: the box keeps what is being typed while a list
   * arrives, and ArrowDown on the select moves on through the roles instead
   * of stopping after one.
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

  /**
   * The open create form: built once when it opens, then the same node on
   * every render, so a failed create (a number already in use) hands back
   * what was typed instead of five empty boxes. Only its submit is redrawn,
   * because only the submit changes (busy or not).
   */
  private createForm(): HTMLElement {
    this.form ??= this.buildForm();
    this.form.actions.replaceChildren(button(this.o.doc, {
      label: this.busy ? 'যোগ হচ্ছে…' : 'যোগ করুন',
      variant: 'primary', type: 'submit', busy: this.busy,
      // The label changes while busy; the keeper waits for this control.
      attrs: { 'data-focus-key': 'create-submit' },
    }));
    return this.form.root;
  }

  private buildForm(): { root: HTMLFormElement; actions: HTMLElement } {
    const d = this.o.doc;
    const nameBn = field(d, { label: 'নাম (বাংলা)', name: 'nameBn', required: true });
    nameBn.input.dataset.focusKey = 'create-first';
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

    const actions = buttonRow(d);
    const form = el(d, 'form', { className: 'card users-create' },
      sectionHeading(d, { title: 'নতুন অ্যাকাউন্ট' }),
      el(d, 'div', { className: 'users-create-grid' },
        nameBn.root, nameEn.root, phone.root, employeeCode.root, role.root),
      el(d, 'p', {
        className: 'ui-field-help users-create-note',
        text: 'অ্যাকাউন্ট তৈরি হবে "আমন্ত্রিত" অবস্থায়। প্রথমবার প্রবেশের জন্য অ্যাক্টিভেশন কোড দিতে হবে — '
          + 'এখানে কোনো পাসওয়ার্ড তৈরি বা দেখা যায় না।',
      }),
      actions);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // The same node answers a second Enter while the first is still out.
      if (this.busy) return;
      void this.create({
        nameBn: nameBn.value().trim(),
        nameEn: nameEn.value().trim(),
        phone: phone.value().trim(),
        roleCode: role.value(),
        employeeCode: employeeCode.value().trim(),
      });
    });
    return { root: form, actions };
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
      codeBtn.dataset.focusKey = 'user-code';
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
    // One control whose label flips with the account: after a deactivation
    // the keeper finds it by this key in the same row (`data-key`), now as
    // "আবার সক্রিয় করুন" — the natural next place.
    btn.dataset.focusKey = 'user-toggle';
    append(wrap, btn);
    return wrap;
  }

  /**
   * Issue a code, and send focus to the outcome: the code card on success,
   * the failure (its retry, or its message) otherwise. Both are drawn above
   * the list, where a person pressing কোড on a lower row cannot see them.
   */
  private async issueCode(u: UserRow): Promise<void> {
    if (this.issuing) return;
    this.issuing = u.id;
    this.clearError();
    this.notice = '';
    this.render();
    const again = () => void this.issueCode(u);
    // On failure: its retry when it has one, else its message.
    let next: FocusTarget[] = [{ key: 'users-retry' }, { key: 'users-error' }];
    try {
      const res = await this.o.auth.authedFetch('/api/v1/auth/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'issue', userId: u.id }),
      });
      const body = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !body.code) {
        if (body.error === 'activation_unconfigured') {
          // A 503 that no second try will change.
          this.fail('এই সুবিধাটি এখনো চালু হয়নি।', null);
        } else if (retryable(res.status)) {
          this.fail(`${u.nameBn} এর কোড তৈরি করা যায়নি। আবার চেষ্টা করুন।`, again);
        } else {
          this.fail(`${u.nameBn} এর কোড তৈরি করা যায়নি।`, null);
        }
      } else {
        this.issued = { userId: u.id, nameBn: u.nameBn, code: body.code };
        next = [{ key: 'issued-code' }];
      }
    } catch {
      this.fail(`সংযোগ পাওয়া যায়নি — ${u.nameBn} এর কোড তৈরি হয়নি।`, again);
    } finally {
      this.issuing = null;
      this.render(next);
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
    const [whoId, valueId, noteId] = [uid('code-who'), uid('code-value'), uid('code-note')];
    return el(d, 'section', {
      className: 'card issued-code-card users-code',
      attrs: {
        role: 'status',
        // Focus is sent here once the code exists (never a Tab stop). On
        // focus a reader says whose code it is, the code, and the warning —
        // in the order a sighted person reads the card.
        tabindex: '-1',
        'aria-labelledby': whoId,
        'aria-describedby': `${valueId} ${noteId}`,
        'data-focus-key': 'issued-code',
      },
    },
      el(d, 'p', { className: 'issued-code-who', attrs: { id: whoId } },
        ...numText(d, `${issued.nameBn} এর সক্রিয়ন কোড`)),
      // Split for reading aloud; the server strips separators on redeem. Latin,
      // because it is typed back exactly; `n`, because it is a figure to copy.
      el(d, 'p', {
        className: 'issued-code-value n', attrs: { dir: 'ltr', id: valueId },
        text: `${issued.code.slice(0, 4)}-${issued.code.slice(4)}`,
      }),
      el(d, 'p', { className: 'issued-code-note', attrs: { id: noteId } },
        ...numText(d, 'কোডটি লিখে তাঁকে দিন — এটি আর দেখা যাবে না। '
          + 'মেয়াদ ৭২ ঘণ্টা; নতুন কোড তৈরি করলে এটি বাতিল হয়ে যাবে।')),
      button(d, {
        label: 'বুঝেছি', variant: 'secondary',
        // Back to the row whose code it was, where the person was working.
        onClick: () => {
          this.issued = null;
          this.render([{ key: 'user-code', row: issued.userId }, { key: 'create-toggle' }]);
        },
      }));
  }
}
