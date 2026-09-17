/**
 * The application shell — desktop and mobile. (UI integration plan, P1)
 *
 * Before P1 this was a mobile shell that a desktop browser happened to be
 * able to open: a sticky bar with the school's name, a fixed five-tab bar at
 * the bottom, and one column of content between them at every width from
 * 320px to 2560px. On a laptop that is a stretched phone. It also built the
 * bar from *route order*, which knows nothing about who is holding the
 * device, so a student's phone offered "হাজিরা নিন" and a section roster.
 *
 * P1 gives the product two deliberate layouts from one DOM:
 *
 *   ≥1024px   a persistent sidebar (grouped, role-specific, collapsible to a
 *             48px icon rail), a topbar carrying breadcrumb + actions, and a
 *             content column that stops growing at 1200px (flush left, not
 *             centred — Ata Ekta 01 Shell §খ).
 *   <1024px   the mobile shell, kept: compact header with the institution's
 *             identity, a bottom bar of five role-chosen tabs, and sheets
 *             rather than menus.
 *
 * **One DOM, CSS decides.** Both navs are rendered and the media query hides
 * one — `display:none` removes a subtree from the accessibility tree as well
 * as the page, so a screen reader never meets the hidden one. The alternative
 * (re-rendering on resize) drops focus, remounts the current route and needs
 * a resize listener to be correct; this needs neither. The single exception
 * is the icon rail, which is an attribute the shell sets, because the rail is
 * a *preference* between 1280px and infinity and a *constraint* below that,
 * and expressing "user choice OR viewport" in CSS alone means duplicating
 * every rail rule inside a media query.
 *
 * What did NOT change: the hash router, `ShellRoute`, the five-tab cap, the
 * offline banner, the bell, the branding patch-in-place, or a single view.
 * Every route mounts into `.shell-view` exactly as before.
 */
import { iconSvg } from './icon.ts';
import { formatCount } from '../../../packages/ui-core/src/format.ts';
import { navFor, crumbFor, type RoleNav } from './ui/nav.ts';
import { roleLabel } from './ui/roles.ts';
import { append, numClass, numText, keepFocusWithin } from './ui/dom.ts';
import { closeAllOverlays, confirmOverlay, type OverlayHandle } from './ui/overlay.ts';

export interface ShellRoute {
  path: string;       // hash fragment without '#/', e.g. 'attendance'
  labelBn: string;
  glyph: string;       // icon name from ./icon.ts — never an emoji
  mount: (container: HTMLElement) => void | Promise<void>;
  /** Called when navigating away, so a view can release listeners/timers. */
  unmount?: () => void;
  /**
   * P9-5 §17. A last chance to stop a navigation that would lose work.
   *
   * Return `true` to BLOCK it and take responsibility for resuming: the shell
   * puts the address bar back where the person still is, and calls nothing
   * else until `resume()` runs. Return `false` — or omit this — and the
   * navigation proceeds as it always did.
   *
   * Optional, and every existing route omits it. Two views had a
   * `hasUnsavedChanges()` method before this existed and nothing ever called
   * either: the assignment matrix since P9-1 and the routine editor since
   * P9-5. A guard nobody asks is the same defect as a lock nobody can set.
   */
  guardLeave?: (resume: () => void) => boolean;
  /**
   * The simple form of `guardLeave`, for a route that only needs to say
   * whether leaving now would lose work. When it returns true the shell holds
   * the navigation and asks with `confirmOverlay` (Cancel keeps the person
   * where they are; the danger button lets the navigation through). Ignored
   * when the route also has `guardLeave`, which stays in full control.
   */
  hasUnsavedChanges?: () => boolean;
  /** The words of that question. Each part falls back to a generic sentence. */
  unsavedPrompt?: { title?: string; body?: string; confirmLabel?: string };
  /**
   * This screen keeps working offline: what it saves goes to the outbox and
   * is sent when the connection returns (attendance, marks, assignments,
   * learn, practice). Only these routes get the offline banner's promise
   * that work is being kept on the device; every other route is told the
   * truth, that saving needs a connection.
   */
  queuesOffline?: boolean;
  /**
   * Routable but not on the tab bar — reached from the আরও (More) menu, the
   * desktop sidebar or a deep link. Keeps the bar at 5 tabs while the app has
   * forty pages.
   */
  hidden?: boolean;
}

export interface ShellOptions {
  root: HTMLElement;
  doc: Document;
  routes: ShellRoute[];
  defaultPath: string;
  displayName: string;
  onLogout: () => void;
  /**
   * P1. The signed-in role. Drives the sidebar groups and which five routes
   * reach the bottom bar. Absent (tests, previews) falls back to route order,
   * which is exactly the pre-P1 behaviour — so an existing caller that has
   * not been told about roles still gets a working shell.
   */
  role?: string;
  /** Demo mode only — lets a previewer see each role's dashboard. */
  roleSwitcher?: { current: string; onChange: (role: string) => void };
  /**
   * R-1. The institution's name and logo. A teacher on a shared device should
   * be able to tell at a glance which school this install belongs to, and the
   * shell chrome is the one piece present on every screen. Optional so a
   * caller that has not resolved branding yet still gets a working shell.
   */
  institution?: { name: string; logoUrl?: string };
  /**
   * R-2. The notification bell. Present for every role, because every role
   * has an inbox — what differs is what is in it, and that was decided when
   * the notice was published. Omitted only in contexts with no inbox to open.
   */
  bell?: { onOpen: () => void };
  /**
   * P1 §30. Marks this as the demo environment, in the chrome, on every
   * screen. A demo that looks exactly like the product is a trust problem the
   * moment someone screenshots it.
   */
  demo?: boolean;
}

/** Below this the sidebar is gone and the bottom bar is the navigation. */
const DESKTOP_MIN = 1024;
/** The key the shell numbers history entries under, inside `history.state`. */
const NAV_KEY = 'shikhonNav';
/** A navigation the leave guard is holding: how far it moved, and whether it replaced the entry. */
interface Hold { delta: number; replaced: boolean }
/** A held navigation being undone by a step through history that has not arrived yet. */
interface Undo {
  hold: Hold;
  /** The number of the entry the step has to land on: the page on screen. */
  expect: number;
  stay: string;
  target: string;
  /** Of unknown kind (no Navigation API): check where the step lands. */
  check: boolean;
  /** Stepping forward again, onto an entry the navigation replaced. */
  returning: boolean;
  /** Answered "go on" before the step arrived. */
  resume: boolean;
  /** Where the step was sent from. A hashchange still there is the same navigation, delivered again. */
  from: { hash: string; at: number | null };
}
/** Between DESKTOP_MIN and this the sidebar is an icon rail, not a choice. */
const RAIL_MAX = 1279;
const RAIL_KEY = 'shikhon_sidebar_rail';

export class Shell {
  private readonly o: ShellOptions;
  private readonly nav: RoleNav | null;
  private viewEl!: HTMLElement;
  private shellEl!: HTMLElement;
  private bellEls: HTMLButtonElement[] = [];
  private bellBadgeEls: HTMLElement[] = [];
  /** The unread count on the sidebar's নোটিশ row (01 Shell §খ), and its row. */
  private inboxCounts: { row: HTMLElement; count: HTMLElement; labelBn: string }[] = [];
  /** The queued-work count inside the offline banner (§7 offline state). */
  private pendingEl: HTMLElement | null = null;
  /** The offline banner's sentence, which depends on the route (queuesOffline). */
  private offlineTextEl: HTMLElement | null = null;
  /** keepFocusWithin on the view, re-armed for each route. */
  private stopFocusKeeper: (() => void) | null = null;
  /** The shell's own unsaved-work question, while it is on screen. */
  private unsavedAsk: OverlayHandle | null = null;
  /** Page nodes hidden from readers while the phone account sheet is open. */
  private sheetHidden: Array<[Element, string | null]> = [];
  private teardowns: Array<() => void> = [];
  private navEls = new Map<string, HTMLElement[]>();
  private crumbEl: HTMLElement | null = null;
  private profileMenu: HTMLElement | null = null;
  private profileBtns: HTMLButtonElement[] = [];
  private currentRoute: ShellRoute | null = null;
  /** Set for exactly one navigation, by a guard that has been satisfied. */
  private bypassGuard = false;
  /** The current history entry's number (see stampEntry), once one is counted. */
  private navIndex = 0;
  private navCounted = false;
  /** Whether the entry on screen really carries its number (a history API that took it). */
  private navStamped = false;
  /** What the Navigation API said the last navigation was, where there is one. */
  private lastNavigate: { url: string; delta: number | null } | null = null;
  /** A held navigation's step back, not yet arrived (see settleUndo). */
  private undo: Undo | null = null;
  /** The address the page on screen was opened at, query and all. */
  private currentHash = '';
  private booted = false;
  private readonly onHashChange = () => { void this.renderRoute(); };
  private onConnectivity?: () => void;
  private onDocPointer?: (e: Event) => void;
  private onDocKey?: (e: KeyboardEvent) => void;
  private railQuery: MediaQueryList | null = null;
  private onRailQuery?: () => void;

  constructor(options: ShellOptions) {
    this.o = options;
    this.nav = options.role ? navFor(options.role) : null;
    this.renderChrome();
    this.watchNavigate();
    addEventListener('hashchange', this.onHashChange);
    void this.renderRoute();
  }

  /**
   * Update the institution plate after construction.
   *
   * The shell is built from the CACHED branding so it paints immediately, but
   * the server's answer arrives a round-trip later — and on a device's very
   * first launch there is no cache at all, so without this the chrome would
   * sit on the neutral placeholder until the next reload. Patching the nodes
   * in place rather than re-rendering keeps the current route mounted and its
   * scroll position intact. Both plates (mobile header, desktop sidebar) are
   * patched, because both are in the DOM at all times.
   */
  setInstitution(institution: { name: string; logoUrl?: string }): void {
    this.o.institution = institution;
    const d = this.o.doc;
    for (const org of this.o.root.querySelectorAll<HTMLElement>('.shell-org')) {
      // Only the mobile plate hides: the desktop brand row also carries the
      // rail toggle, and hiding that would take the sidebar control away with
      // the name it was waiting for.
      if (org.classList.contains('shell-org-mobile')) org.hidden = !institution.name;
      let nameEl = org.querySelector('.shell-org-name');
      if (!nameEl) {
        nameEl = d.createElement('span');
        nameEl.className = 'shell-org-name';
        org.append(nameEl);
      }
      this.setText(nameEl, institution.name);

      const existing = org.querySelector<HTMLImageElement>('.shell-org-logo');
      const mark = org.querySelector<HTMLElement>('.shell-org-mark');
      if (institution.logoUrl) {
        if (existing) {
          existing.src = institution.logoUrl;
        } else {
          const img = d.createElement('img');
          img.className = 'shell-org-logo';
          img.src = institution.logoUrl;
          img.alt = '';
          org.prepend(img);
        }
        mark?.remove();
      } else {
        existing?.remove();
        // No logo: the monogram takes its place rather than leaving a gap
        // where the identity goes. First letter of the school's own name.
        if (!mark) org.prepend(this.monogram(institution.name));
        else {
          mark.textContent = firstGrapheme(institution.name);
          mark.className = numClass('shell-org-mark', mark.textContent);
        }
      }
    }
  }

  /**
   * Set the unread count on the bell.
   *
   * A badge showing "0" is noise, so zero hides it entirely. Above 9 it reads
   * "৯+": the exact number stops being actionable there, and three digits do
   * not fit a 20px badge at 360px.
   */
  setUnread(count: number): void {
    const n = Math.max(0, Math.floor(count));
    // Bangla digits in the ACCESSIBLE name too, not only on the badge.
    // The badge said "৩" and the aria-label said "3": a sighted user read
    // Bangla and a screen-reader user heard Latin, in the same control.
    const label = n === 0 ? 'নোটিশ' : `নোটিশ — ${formatCount(n, 'bn')}টি পড়া হয়নি`;
    for (const badge of this.bellBadgeEls) {
      badge.hidden = n === 0;
      badge.textContent = n > 9 ? '৯+' : formatCount(n, 'bn');
    }
    for (const bell of this.bellEls) bell.setAttribute('aria-label', label);
    // The sidebar row repeats the count beside "নোটিশ" (01 Shell §খ). Its
    // badge is aria-hidden, so the row's own name carries the number instead
    // — the same Bangla sentence the bell reads, never a bare "৩".
    for (const { row, count, labelBn } of this.inboxCounts) {
      count.hidden = n === 0;
      count.textContent = n > 9 ? '৯+' : formatCount(n, 'bn');
      if (n === 0) row.removeAttribute('aria-label');
      else row.setAttribute('aria-label', `${labelBn} — ${formatCount(n, 'bn')}টি পড়া হয়নি`);
    }
  }

  /**
   * Set how much work is waiting on this device for a connection.
   *
   * The offline banner states the queue (IMPLEMENTATION §7: "count of queued
   * items"); zero hides the figure and leaves the sentence. The shell holds no
   * queue of its own, so the caller that owns the outbox reports it here, the
   * same way it reports unread notices through `setUnread`.
   */
  setPending(count: number): void {
    const n = Math.max(0, Math.floor(count));
    const el = this.pendingEl;
    if (!el) return;
    el.hidden = n === 0;
    this.setText(el, n === 0 ? '' : `${formatCount(n, 'bn')}টি অপেক্ষমাণ`);
  }

  /**
   * Run `fn` when the shell is destroyed: for something the caller wired for
   * the shell's lifetime (the outbox's automatic flush, a service-worker
   * listener), so a logout does not leave it running for the next person.
   */
  onDestroy(fn: () => void): void {
    this.teardowns.push(fn);
  }

  /** Call when the shell itself is being torn down (e.g. on logout). */
  destroy(): void {
    removeEventListener('hashchange', this.onHashChange);
    this.stopFocusKeeper?.();
    this.stopFocusKeeper = null;
    for (const fn of this.teardowns.splice(0)) {
      try { fn(); } catch { /* one failed teardown must not stop the next */ }
    }
    if (this.onConnectivity) {
      removeEventListener('online', this.onConnectivity);
      removeEventListener('offline', this.onConnectivity);
    }
    const d = this.o.doc;
    if (this.onDocPointer) d.removeEventListener('click', this.onDocPointer, true);
    if (this.onDocKey) d.removeEventListener('keydown', this.onDocKey);
    if (this.railQuery && this.onRailQuery) {
      this.railQuery.removeEventListener('change', this.onRailQuery);
    }
    this.currentRoute?.unmount?.();
  }

  /* ── chrome ─────────────────────────────────────────────────────────── */

  private resolvePath(): string {
    const h = location.hash.replace(/^#\/?/, '').split('?')[0];
    return this.o.routes.some((r) => r.path === h) ? h : this.o.defaultPath;
  }

  private route(path: string): ShellRoute | undefined {
    return this.o.routes.find((r) => r.path === path);
  }

  /** The five bottom-bar routes: the role's choice, or route order. */
  private barRoutes(): ShellRoute[] {
    const MAX_TABS = 5;   // Wireframe §2 — enforced here, not trusted to callers
    if (this.nav) {
      const picked = this.nav.tabs
        .map((p) => this.route(p))
        .filter((r): r is ShellRoute => Boolean(r));
      if (picked.length) return picked.slice(0, MAX_TABS);
      // Every tab the role asked for is missing from the route table. Falling
      // through beats rendering an empty bar: a nav model that has drifted
      // from the routes is a bug for nav.test.ts to fail on, not a reason to
      // leave a teacher with no navigation at all.
    }
    return this.o.routes.filter((r) => !r.hidden).slice(0, MAX_TABS);
  }

  /**
   * Text that may hold a number — a school called "১ নং সরকারি বিদ্যালয়", a
   * route label — with every figure in the numeral face (R6). `textContent`
   * stays exactly `text`; the digits just sit in their own `<span class="n">`.
   */
  private setText(target: Element, text: string): void {
    target.textContent = '';
    append(target, ...numText(this.o.doc, text));
  }

  private monogram(name: string): HTMLElement {
    const el = this.o.doc.createElement('span');
    el.textContent = firstGrapheme(name);
    // "১ নং …" starts with a digit, and a monogram of one digit is a number.
    el.className = numClass('shell-org-mark', el.textContent);
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  private renderChrome(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';
    root.setAttribute('lang', 'bn');

    const shellEl = d.createElement('div');
    shellEl.className = 'shell';
    this.shellEl = shellEl;
    if (this.o.demo) shellEl.dataset.demo = 'on';

    // Keyboard users land on this first; it is the only way past a
    // fifteen-row sidebar without fifteen Tab presses.
    const skip = d.createElement('a');
    skip.className = 'skip-link';
    skip.href = '#shell-view';
    skip.textContent = 'মূল অংশে যান';
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      this.skipToMain();
    });

    this.viewEl = d.createElement('main');
    this.viewEl.className = 'shell-view';
    this.viewEl.id = 'shell-view';
    // Focusable but not tabbable: the skip link and every route change move
    // focus here, so a keyboard user's next Tab is inside the new page.
    this.viewEl.tabIndex = -1;

    const main = d.createElement('div');
    main.className = 'shell-main';
    main.append(this.buildTopbar());
    // §30. The demo marker and the role picker are their own strip rather
    // than three more things in the app bar. Two reasons, and the second is
    // the one that decided it: at 390px the chip, the picker, the bell and
    // the avatar left the institution's name showing "শা" and pushed the
    // avatar off the screen edge; and a banner saying this is a demo is a
    // stronger signal than a chip lost among the controls. Neither exists in
    // a real session — a school's staff never see this element at all.
    if (this.o.demo) main.append(this.buildDemoBar());
    main.append(this.buildOfflineBanner(), this.viewEl);

    shellEl.append(skip, this.buildSidebar(), main, this.buildTabbar());
    root.append(shellEl);

    this.applyRail();
    this.wireDismissal();
  }

  /**
   * The skip link's target, brought into view as well as focused.
   *
   * A plain `focus()` lets the browser scroll main's top edge to y=0, under
   * the sticky topbar, so the page h1 and the next Tab stop are hidden behind
   * it. Focus without scrolling, then scroll so main starts just below the
   * topbar, and only when it is not already on screen there.
   */
  private skipToMain(): void {
    const view = this.viewEl;
    view.focus({ preventScroll: true });
    try {
      const bar = this.shellEl.querySelector('.shell-topbar');
      const offset = bar ? bar.getBoundingClientRect().height : 0;
      const top = view.getBoundingClientRect().top;
      const viewport = typeof innerHeight === 'number' ? innerHeight : 0;
      if (top < offset || (viewport > 0 && top > viewport - offset)) {
        scrollTo({ top: Math.max(0, top + (scrollY || 0) - offset) });
      }
    } catch { /* no layout (jsdom): focus alone */ }
  }

  /* ── desktop sidebar ────────────────────────────────────────────────── */

  private buildSidebar(): HTMLElement {
    const d = this.o.doc;
    const aside = d.createElement('div');
    aside.className = 'd-sidebar';

    // Institution identity leads. Whose school this is outranks who is signed
    // in — a teacher covering at a second institution needs that distinction
    // more than a reminder of their own name (R-1).
    const brand = d.createElement('div');
    brand.className = 'd-brand shell-org';
    const name = this.o.institution?.name ?? '';
    if (this.o.institution?.logoUrl) {
      const img = d.createElement('img');
      img.className = 'shell-org-logo';
      img.src = this.o.institution.logoUrl;
      img.alt = '';
      brand.append(img);
    } else if (name) {
      brand.append(this.monogram(name));
    }
    const brandName = d.createElement('span');
    brandName.className = 'shell-org-name';
    this.setText(brandName, name);
    brand.append(brandName);

    const rail = d.createElement('button');
    rail.type = 'button';
    rail.className = 'd-rail-toggle';
    rail.innerHTML = iconSvg('panel-left');
    rail.addEventListener('click', () => this.toggleRail());
    brand.append(rail);

    const nav = d.createElement('nav');
    nav.className = 'd-nav';
    nav.setAttribute('aria-label', 'প্রধান মেনু');

    const groups = this.nav
      ? this.nav.groups
      // No role (tests, previews): one flat group of every visible route, so
      // the sidebar is still navigable rather than empty.
      : [{ labelBn: '', items: this.o.routes.filter((r) => !r.hidden)
            .map((r) => ({ path: r.path, labelBn: r.labelBn, glyph: r.glyph })) }];

    for (const group of groups) {
      const section = d.createElement('div');
      section.className = 'd-nav-group';
      if (group.labelBn) {
        const label = d.createElement('p');
        label.className = 'd-nav-label';
        this.setText(label, group.labelBn);
        // Hidden from readers when the rail collapses it away; the rows keep
        // their own accessible names either way.
        section.append(label);
      } else if (this.nav) {
        // The unlabelled tail group (আরও) is drawn with a BLANK label row
        // above it (01 Shell §খ renders labelBn '' as a non-breaking space),
        // which is what separates "everything else" from the last named
        // group. Same element, same height as a real label, and nothing for a
        // screen reader to announce. The rail hides it with the other labels.
        const spacer = d.createElement('p');
        spacer.className = 'd-nav-label';
        spacer.setAttribute('aria-hidden', 'true');
        spacer.textContent = ' ';
        section.append(spacer);
      }
      for (const item of group.items) {
        if (!this.route(item.path)) continue;   // never render a dead link
        section.append(this.navRow(item.path, item.labelBn, item.glyph));
      }
      if (section.querySelector('.dnav')) nav.append(section);
    }

    const foot = d.createElement('div');
    foot.className = 'd-sidebar-foot';
    foot.append(this.profileButton('d-profile'));

    aside.append(brand, nav, foot);
    return aside;
  }

  private navRow(path: string, labelBn: string, glyph: string): HTMLElement {
    const d = this.o.doc;
    const a = d.createElement('a');
    a.className = 'dnav';
    a.href = `#/${path}`;
    a.dataset.path = path;
    // title, not a custom tooltip: when the rail hides the label this is the
    // only thing left, and the platform's own tooltip is the one that appears
    // for a mouse and is read by a screen reader without extra wiring.
    a.title = labelBn;
    const g = d.createElement('span');
    g.className = 'dnav-glyph';
    g.setAttribute('aria-hidden', 'true');
    g.innerHTML = iconSvg(glyph);
    const l = d.createElement('span');
    l.className = 'dnav-label';
    this.setText(l, labelBn);
    a.append(g, l);
    if (path === 'inbox') {
      // 01 Shell §খ draws the unread count on the নোটিশ row as well as on
      // the bell. Same number, same source: `setUnread` drives both, and it
      // starts hidden so a count nobody has reported never shows as zero.
      const count = d.createElement('span');
      count.className = 'ui-count n dnav-count';
      count.setAttribute('aria-hidden', 'true');
      count.hidden = true;
      a.append(count);
      this.inboxCounts.push({ row: a, count, labelBn });
    }
    this.remember(path, a);
    return a;
  }

  private remember(path: string, el: HTMLElement): void {
    const list = this.navEls.get(path) ?? [];
    list.push(el);
    this.navEls.set(path, list);
  }

  /* ── topbar ─────────────────────────────────────────────────────────── */

  private buildTopbar(): HTMLElement {
    const d = this.o.doc;
    const bar = d.createElement('header');
    bar.className = 'shell-topbar';

    // Mobile identity plate. On desktop the sidebar carries it, so this one
    // is hidden there rather than repeating the school's name twice.
    const org = d.createElement('span');
    org.className = 'shell-org shell-org-mobile';
    const name = this.o.institution?.name ?? '';
    if (this.o.institution?.logoUrl) {
      const img = d.createElement('img');
      img.className = 'shell-org-logo';
      img.src = this.o.institution.logoUrl;
      img.alt = '';
      org.append(img);
    } else if (name) {
      org.append(this.monogram(name));
    }
    const orgName = d.createElement('span');
    orgName.className = 'shell-org-name';
    this.setText(orgName, name);
    org.append(orgName);
    // An empty name plate looks broken, so it is hidden until there is a name
    // — but it stays in the DOM, which the pre-P1 shell did not do. That shell
    // OMITTED the node, and `setInstitution` began with `if (!org) return`, so
    // a shell built before branding resolved could never be given a name at
    // all: it waited for a reload. Present-and-hidden is patchable.
    org.hidden = !name;

    // Desktop breadcrumb. Deliberately NOT a page <h1>: 26 views already
    // render their own, and §5 forbids saying the same thing twice in the
    // topbar and the content header. A breadcrumb ending in the page name is
    // an orientation cue at 13px, not a second title.
    const crumb = d.createElement('nav');
    crumb.className = 'shell-crumb';
    crumb.setAttribute('aria-label', 'অবস্থান');
    this.crumbEl = crumb;

    const actions = d.createElement('div');
    actions.className = 'shell-actions';

    // R-6's student search, reached from every screen for the roles whose
    // navigation carries it. Not a global search box: nothing in this system
    // searches across notices, fees and students at once, and an input that
    // implies it would be a promise the API cannot keep.
    if (this.route('students') && this.navHas('students')) {
      const search = d.createElement('a');
      search.className = 'shell-icon-btn shell-search';
      search.href = '#/students';
      search.setAttribute('aria-label', 'শিক্ষার্থী খুঁজুন');
      search.title = 'শিক্ষার্থী খুঁজুন';
      search.innerHTML = iconSvg('search');
      actions.append(search);
    }

    if (this.o.bell) actions.append(this.bellButton());
    actions.append(this.profileButton('shell-avatar'));

    bar.append(org, crumb, actions);
    return bar;
  }

  private buildDemoBar(): HTMLElement {
    const d = this.o.doc;
    const bar = d.createElement('div');
    bar.className = 'shell-demobar';
    const chip = d.createElement('span');
    chip.className = 'shell-demo-chip';
    chip.textContent = 'ডেমো পরিবেশ';
    const note = d.createElement('span');
    note.className = 'shell-demo-note';
    note.textContent = 'নমুনা তথ্য — কোনো প্রকৃত শিক্ষার্থীর তথ্য নয়';
    bar.append(chip, note);
    if (this.o.roleSwitcher) bar.append(this.roleSwitcher());
    return bar;
  }

  private navHas(path: string): boolean {
    if (!this.nav) return true;
    return this.nav.groups.some((g) => g.items.some((i) => i.path === path));
  }

  private bellButton(): HTMLButtonElement {
    const d = this.o.doc;
    const bell = d.createElement('button');
    bell.type = 'button';
    bell.className = 'shell-icon-btn shell-bell';
    bell.setAttribute('aria-label', 'নোটিশ');
    const glyph = d.createElement('span');
    glyph.className = 'shell-bell-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.innerHTML = iconSvg('bell');
    const badge = d.createElement('span');
    // `.n`: the badge only ever holds a count ("৩", "৯+") — R6.
    badge.className = 'shell-bell-badge n';
    badge.hidden = true;
    bell.append(glyph, badge);
    bell.addEventListener('click', () => this.o.bell?.onOpen());
    this.bellEls.push(bell);
    this.bellBadgeEls.push(badge);
    return bell;
  }

  private roleSwitcher(): HTMLElement {
    const d = this.o.doc;
    const picker = d.createElement('select');
    picker.className = 'shell-role';
    picker.setAttribute('aria-label', 'ডেমো ভূমিকা পরিবর্তন করুন');
    const roles: [string, string][] = [
      ['class_teacher', 'শ্রেণি শিক্ষক'],
      ['student', 'শিক্ষার্থী'],
      ['guardian', 'অভিভাবক'],
      ['principal', 'অধ্যক্ষ'],
      ['it_admin', 'আইটি অ্যাডমিন'],
      ['accountant', 'হিসাবরক্ষক'],
    ];
    for (const [value, label] of roles) {
      const opt = d.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === this.o.roleSwitcher?.current;
      picker.append(opt);
    }
    picker.addEventListener('change', () => this.o.roleSwitcher?.onChange(picker.value));
    return picker;
  }

  /* ── profile menu ───────────────────────────────────────────────────── */

  private profileButton(className: string): HTMLButtonElement {
    const d = this.o.doc;
    const btn = d.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', `${this.o.displayName} — অ্যাকাউন্ট মেনু`);

    const avatar = d.createElement('span');
    avatar.textContent = firstGrapheme(this.o.displayName);
    avatar.className = numClass('shell-avatar-mark', avatar.textContent);
    avatar.setAttribute('aria-hidden', 'true');

    const who = d.createElement('span');
    who.className = 'shell-who';
    const nm = d.createElement('span');
    nm.className = 'shell-who-name';
    this.setText(nm, this.o.displayName);
    who.append(nm);
    if (this.o.role) {
      const rl = d.createElement('span');
      rl.className = 'shell-who-role';
      rl.textContent = roleLabel(this.o.role);
      who.append(rl);
    }

    btn.append(avatar, who);
    if (className === 'd-profile') {
      // 01 Shell §খ ends the sidebar's account row with a log-out glyph. The
      // row still opens the account menu (aria-haspopup) rather than signing
      // out on one click; the glyph says what that menu is for, and sign-out
      // is its one action. Decorative, so hidden from readers — the button's
      // name already says "অ্যাকাউন্ট মেনু".
      const out = d.createElement('span');
      out.className = 'd-profile-glyph';
      out.setAttribute('aria-hidden', 'true');
      out.innerHTML = iconSvg('log-out');
      btn.append(out);
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleProfile(btn);
    });
    this.profileBtns.push(btn);
    return btn;
  }

  private toggleProfile(anchor: HTMLButtonElement): void {
    if (this.profileMenu) { this.closeProfile(); return; }
    const d = this.o.doc;
    const menu = d.createElement('div');
    menu.className = 'shell-menu';
    // Below 1024px this is a bottom sheet over a dimmed page: a modal dialog,
    // not a dropdown menu. Its focus is trapped (onDocKey) and the page
    // behind it is hidden from readers, as every overlay does.
    const sheet = this.isSheet();
    if (sheet) {
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-modal', 'true');
    } else {
      menu.setAttribute('role', 'menu');
    }
    menu.setAttribute('aria-label', 'অ্যাকাউন্ট');

    const head = d.createElement('div');
    head.className = 'shell-menu-head';
    const nm = d.createElement('p');
    nm.className = 'shell-menu-name';
    this.setText(nm, this.o.displayName);
    head.append(nm);
    if (this.o.role) {
      const rl = d.createElement('p');
      rl.className = 'shell-menu-role';
      rl.textContent = roleLabel(this.o.role);
      head.append(rl);
    }
    menu.append(head);

    // No theme control: Ata Ekta has no dark mode (§5), so the picker that
    // offered follow-phone / light / dark was removed rather than left
    // offering one choice.

    const logout = d.createElement('button');
    logout.type = 'button';
    logout.className = 'shell-menu-item shell-logout';
    if (!sheet) logout.setAttribute('role', 'menuitem');
    const lg = d.createElement('span');
    lg.setAttribute('aria-hidden', 'true');
    lg.className = 'shell-menu-glyph';
    lg.innerHTML = iconSvg('log-out');
    const lt = d.createElement('span');
    lt.textContent = 'লগ আউট';
    logout.append(lg, lt);
    logout.addEventListener('click', () => { this.closeProfile(); this.o.onLogout(); });
    menu.append(logout);

    anchor.setAttribute('aria-expanded', 'true');
    anchor.after(menu);
    this.profileMenu = menu;
    if (sheet) this.hidePageBehind(menu);
    // Focus the first control so the menu is usable from the keyboard the
    // instant it opens; Escape and an outside click both close it.
    menu.querySelector<HTMLElement>('button')?.focus();
  }

  /**
   * Close the account menu.
   *
   * Focus goes back to the menu's button only when it would otherwise be lost
   * (it was inside the menu: Escape, লগ আউট; or on nothing) or when the menu
   * was the phone's modal sheet. On the desktop dropdown a click into a
   * search box has already put focus there by the time this runs; pulling it
   * back to the button made the next letters vanish and turned a Space into
   * "open the menu again, on লগ আউট".
   */
  private closeProfile(restoreFocus?: boolean): void {
    const menu = this.profileMenu;
    if (!menu) return;
    const anchor = menu.previousElementSibling as HTMLElement | null;
    const d = this.o.doc;
    const a = d.activeElement;
    const restore = restoreFocus ?? (this.sheetHidden.length > 0 || this.isSheet()
      || !a || a === d.body || a === d.documentElement || menu.contains(a));
    menu.remove();
    this.profileMenu = null;
    this.showPageBehind();
    for (const b of this.profileBtns) b.setAttribute('aria-expanded', 'false');
    if (restore) anchor?.focus();
  }

  /** aria-hidden on everything beside the sheet's ancestor chain, recorded. */
  private hidePageBehind(menu: HTMLElement): void {
    const d = this.o.doc;
    this.showPageBehind();
    for (let n: Element = menu; n !== d.body && n.parentElement; n = n.parentElement) {
      for (const sib of Array.from(n.parentElement.children)) {
        if (sib === n || sib.tagName === 'SCRIPT') continue;
        this.sheetHidden.push([sib, sib.getAttribute('aria-hidden')]);
        sib.setAttribute('aria-hidden', 'true');
      }
    }
  }

  private showPageBehind(): void {
    for (const [node, prev] of this.sheetHidden.splice(0)) {
      if (prev === null) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', prev);
    }
  }

  /**
   * Is the account menu currently a bottom sheet rather than a dropdown?
   *
   * Below the one breakpoint the menu is drawn as a full-width sheet rising
   * over a dimmed page (13 Responsive ০৭). The width is the only thing that
   * decides it, and the media query here is the exact complement of the 1024px
   * one in the stylesheet, so the two can never disagree about which shape is
   * on screen. Where `matchMedia` is missing (jsdom, an old engine) the answer
   * is "no", which leaves the pre-existing dropdown behaviour untouched.
   */
  private isSheet(): boolean {
    if (typeof matchMedia !== 'function') return false;
    try { return matchMedia(`(max-width: ${DESKTOP_MIN - 0.02}px)`).matches; }
    catch { return false; }
  }

  /**
   * Escape and outside-click, once for the whole shell.
   *
   * Capture phase on click: a menu item's own handler runs first and closes
   * the menu itself, so this only ever fires for a click that landed outside.
   *
   * On a phone that outside click is also the sheet's primary dismissal
   * gesture — tap the dimmed area — and the dimming is painted as a box-shadow
   * on the sheet, which no finger can land on. So without this the one tap
   * both closes the sheet AND carries on to whatever the dim area was covering:
   * a bottom tab navigates away, a list row opens a student. A person closing
   * a sheet ends up on a page they never asked for. The tap that dismisses a
   * sheet may do nothing else, so it is stopped here — before the target's own
   * listener runs (capture) and before any default action (a `.dnav` href).
   *
   * Only while the sheet is on screen. The desktop menu is a dropdown with no
   * scrim and no modal promise, and there a click outside has always been
   * allowed to do its own job as well.
   */
  private wireDismissal(): void {
    const d = this.o.doc;
    this.onDocPointer = (e: Event) => {
      if (!this.profileMenu) return;
      const t = e.target as Node;
      if (this.profileMenu.contains(t)) return;
      if (this.profileBtns.some((b) => b.contains(t))) return;
      // A keyboard cannot reach a control outside the sheet any more (Tab is
      // trapped in onDocKey), so what lands here is a tap on the dim area.
      if (this.isSheet()) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.closeProfile();
    };
    this.onDocKey = (e: KeyboardEvent) => {
      const menu = this.profileMenu;
      if (!menu) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeProfile(true);
        return;
      }
      if (e.key !== 'Tab') return;
      if (this.sheetHidden.length > 0 || this.isSheet()) {
        // The phone sheet is modal: Tab and Shift+Tab cycle inside it.
        const items = [...menu.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
        e.preventDefault();
        if (!items.length) return;
        const i = items.indexOf(d.activeElement as HTMLElement);
        const next = i < 0 ? 0
          : (i + (e.shiftKey ? -1 : 1) + items.length) % items.length;
        items[next].focus();
        return;
      }
      // The desktop dropdown: Tab leaves it, and it closes behind the person
      // without pulling focus back (the WAI-ARIA menu button pattern). When
      // focus is inside the menu it is first put on the menu's button, so a
      // Tab carries on from there rather than from a removed node; Shift+Tab
      // lands on that button itself.
      if (menu.contains(d.activeElement)) {
        (menu.previousElementSibling as HTMLElement | null)?.focus();
        if (e.shiftKey) e.preventDefault();
      }
      this.closeProfile(false);
    };
    d.addEventListener('click', this.onDocPointer, true);
    d.addEventListener('keydown', this.onDocKey);
  }

  /* ── rail ───────────────────────────────────────────────────────────── */

  /**
   * The sidebar is an icon rail when the user asked for it, or when the
   * viewport is desktop-but-narrow (1024–1279) where 240px of chrome takes a
   * quarter of a 1024px screen away from a table that needs it.
   *
   * Expressed as an attribute rather than pure CSS because the condition is
   * "preference OR viewport", and CSS can only express that by repeating
   * every rail rule inside a media query — which is how the two halves
   * eventually disagree.
   */
  private applyRail(): void {
    const forced = () => typeof matchMedia === 'function'
      && matchMedia(`(min-width: ${DESKTOP_MIN}px) and (max-width: ${RAIL_MAX}px)`).matches;
    const pref = () => {
      try { return localStorage.getItem(RAIL_KEY) === 'on'; } catch { return false; }
    };
    const paint = () => {
      this.shellEl.dataset.rail = forced() || pref() ? 'on' : 'off';
      for (const b of this.shellEl.querySelectorAll('.d-rail-toggle')) {
        b.setAttribute('aria-expanded', String(this.shellEl.dataset.rail !== 'on'));
        b.setAttribute('aria-label', this.shellEl.dataset.rail === 'on'
          ? 'মেনু চওড়া করুন' : 'মেনু সংকুচিত করুন');
      }
    };
    paint();
    if (typeof matchMedia === 'function') {
      // The FORCING query, not `(max-width: RAIL_MAX)`. Listening to the
      // upper bound alone misses the lower one: resizing 768 → 1024 does not
      // change `(max-width: 1279px)`, so the rail never engaged when the
      // sidebar first appeared — the 1024–1279 band showed a 240px sidebar
      // taking a quarter of the screen. Found by the responsive sweep, which
      // read `rail: "off"` at 1024 where it should read "on".
      this.railQuery = matchMedia(
        `(min-width: ${DESKTOP_MIN}px) and (max-width: ${RAIL_MAX}px)`);
      this.onRailQuery = paint;
      this.railQuery.addEventListener('change', paint);
    }
    this.repaintRail = paint;
  }

  private repaintRail: () => void = () => {};

  private toggleRail(): void {
    const on = this.shellEl.dataset.rail === 'on';
    try { localStorage.setItem(RAIL_KEY, on ? 'off' : 'on'); } catch { /* session only */ }
    this.repaintRail();
  }

  /* ── mobile bottom bar ──────────────────────────────────────────────── */

  private buildTabbar(): HTMLElement {
    const d = this.o.doc;
    const tabbar = d.createElement('nav');
    tabbar.className = 'shell-tabbar';
    tabbar.setAttribute('aria-label', 'দ্রুত মেনু');
    for (const route of this.barRoutes()) {
      const tab = d.createElement('button');
      tab.type = 'button';
      tab.className = 'shell-tab';
      tab.dataset.path = route.path;
      // Explicit accessible name — the child spans alone leave some readers
      // (and headless tools) with an empty button name.
      tab.setAttribute('aria-label', route.labelBn);
      const glyph = d.createElement('span');
      glyph.className = 'shell-tab-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.innerHTML = iconSvg(route.glyph);
      const label = d.createElement('span');
      label.className = 'shell-tab-label';
      this.setText(label, route.labelBn);
      tab.append(glyph, label);
      tab.addEventListener('click', () => { location.hash = `/${route.path}`; });
      this.remember(route.path, tab);
      tabbar.append(tab);
    }
    return tabbar;
  }

  private buildOfflineBanner(): HTMLElement {
    const d = this.o.doc;
    // Offline is a banner, never a modal (Wireframe §4): it must not block
    // work, and it belongs to the whole shell, not one screen — the moment a
    // teacher needs it most is mid-task, whatever screen they are on.
    const banner = d.createElement('p');
    banner.className = 'offline-banner';
    banner.setAttribute('role', 'status');
    const icon = d.createElement('span');
    icon.className = 'offline-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = iconSvg('wifi-off');
    const text = d.createElement('span');
    // 01 Shell §খ's sentence, but only where it is true: set per route by
    // paintOfflineText.
    text.className = 'offline-text';
    this.offlineTextEl = text;
    this.paintOfflineText(null);
    // §7: the offline state names how much is waiting. Hidden until the
    // outbox's owner reports a count through `setPending`.
    const pending = d.createElement('span');
    pending.className = 'offline-pending';
    pending.hidden = true;
    this.pendingEl = pending;
    banner.append(icon, text, pending);
    this.onConnectivity = () => { banner.hidden = navigator.onLine; };
    this.onConnectivity();
    addEventListener('online', this.onConnectivity);
    addEventListener('offline', this.onConnectivity);
    return banner;
  }

  /**
   * The banner's promise depends on the screen. 01 Shell §খ's "keep working,
   * everything is kept on this device" is true only where saving goes to the
   * outbox; on finance, notices, settings and the rest a save simply fails
   * offline, and inviting the accountant to keep entering money work there
   * was a false promise.
   */
  private paintOfflineText(route: ShellRoute | null): void {
    const text = this.offlineTextEl;
    if (!text) return;
    // A route table that marks no route at all has not been told about the
    // flag (a test, a preview): it keeps the sentence it always had, the same
    // way a shell with no `role` keeps route order for its tabs.
    const told = this.o.routes.some((r) => r.queuesOffline !== undefined);
    text.textContent = !told || route?.queuesOffline
      ? 'ইন্টারনেট নেই — কাজ চালিয়ে যান, সব এই যন্ত্রে জমা থাকছে'
      : 'ইন্টারনেট নেই — এই পাতার কাজ সংরক্ষণ করতে সংযোগ লাগবে';
  }

  /**
   * The shell's own leave question, for a route that declares
   * `hasUnsavedChanges`. Returns true when the navigation is held.
   */
  private askBeforeLeaving(leaving: ShellRoute, resume: () => void): boolean {
    // Already asking: a second back press waits for the answer to the first.
    if (this.unsavedAsk) return true;
    if (!leaving.hasUnsavedChanges?.()) return false;
    const p = leaving.unsavedPrompt ?? {};
    this.unsavedAsk = confirmOverlay(this.o.doc, {
      title: p.title ?? 'জমা দেওয়া হয়নি',
      body: p.body ?? 'এই পাতার কাজ এখনো জমা দেওয়া হয়নি। এখন চলে গেলে সেগুলো হারিয়ে যাবে।',
      confirmLabel: p.confirmLabel ?? 'বাদ দিন',
      danger: true,
      onConfirm: () => { this.unsavedAsk = null; resume(); },
      onCancel: () => { this.unsavedAsk = null; },
    });
    return true;
  }

  /* ── routing ────────────────────────────────────────────────────────── */

  private async renderRoute(): Promise<void> {
    if (this.settleUndo()) return;
    const path = this.resolvePath();
    if (this.currentRoute?.path === path) {
      // The same page: a query change, or the address put back by a held
      // navigation. Its history entry still has to be counted.
      this.stampEntry();
      this.currentHash = location.hash;
      return;
    }

    // §17. The hash has ALREADY changed by the time this runs, so blocking
    // means putting it back — otherwise the address bar says the person is
    // somewhere they are not, and the back button lands somewhere neither of
    // us expects.
    //
    // Put back WITHOUT adding history (R5). `location.hash = …` pushed a new
    // entry for every held back press and another for the resume, so after
    // "বাতিল" then "বাদ দিন" the next back returned to the page just left, now
    // with a blank register. A navigation that moved through history — a back
    // or forward press, and a new entry (a tab, a link, the bell), which is a
    // step forward onto a new entry — is undone by travelling the same
    // distance the other way and resumed by travelling it again. A new entry
    // must NOT be overwritten in place: that left two entries with the same
    // address side by side, and the next back press moved between them with
    // no hashchange, so it did nothing. Its entry stays ahead as a forward
    // entry, which the next tab press replaces. Only a navigation that
    // REPLACED the entry is put back by overwriting it.
    const leaving = this.currentRoute;
    if (!this.bypassGuard && leaving && (leaving.guardLeave || leaving.hasUnsavedChanges)) {
      const target = location.hash;
      const { delta, known } = this.travelled();
      const hold: Hold = { delta, replaced: delta === 0 };
      const stay = this.hashFor(leaving);
      let deciding = true;
      let resumedNow = false;
      const resume = () => {
        // Answered before the guard even returned: nothing to put back.
        if (deciding) { resumedNow = true; return; }
        // The step back to the page is still on its way: go on once it lands.
        if (this.undo?.hold === hold) { this.undo.resume = true; return; }
        this.bypassGuard = true;
        if (hold.replaced) {
          this.replaceHash(target);
          void this.renderRoute();
        } else {
          this.go(hold.delta);
        }
      };
      const held = leaving.guardLeave
        ? leaving.guardLeave(resume)
        : this.askBeforeLeaving(leaving, resume);
      deciding = false;
      if (held && !resumedNow) {
        if (hold.replaced) {
          // The entry the navigation replaced is the page's own entry again,
          // number and all: a later step counts from it.
          this.replaceHash(stay);
          if (this.navStamped) this.numberEntry(this.navIndex);
        } else {
          this.undo = {
            hold, expect: this.navIndex, stay, target, check: !known, returning: false, resume: false,
            from: { hash: target, at: this.entryIndex() },
          };
          this.go(-delta);
        }
        return;
      }
    }
    this.bypassGuard = false;
    this.stampEntry();

    this.closeProfile();
    // An overlay lives on <body>, outside every route: without this a sheet
    // opened on one page stays over the next after Android back. After the
    // guard, so a leave question survives the hash being put back.
    closeAllOverlays();
    this.unsavedAsk = null;
    this.stopFocusKeeper?.();
    this.stopFocusKeeper = null;
    this.currentRoute?.unmount?.();
    this.currentRoute = this.route(path) ?? null;
    this.paintOfflineText(this.currentRoute);

    for (const [p, els] of this.navEls) {
      const active = p === path;
      for (const el of els) {
        el.setAttribute('aria-current', active ? 'page' : 'false');
        el.classList.toggle('active', active);
      }
    }
    this.paintCrumb(path);
    this.currentHash = location.hash;

    this.viewEl.textContent = '';
    // Armed after the old page is gone and before the new one mounts, so an
    // identity from the previous page is never matched against this one.
    this.stopFocusKeeper = keepFocusWithin(this.viewEl);
    if (!this.currentRoute) return;
    await this.currentRoute.mount(this.viewEl);

    // Every navigation after the first moves focus into the new page and
    // resets the scroll. Without it a keyboard user's next Tab continues from
    // wherever it was in the sidebar, and a mouse user arrives at a new page
    // scrolled halfway down the previous one. Skipped on boot, where moving
    // focus would steal it from whatever the browser restored.
    if (this.booted) {
      this.viewEl.focus({ preventScroll: true });
      this.viewEl.scrollTop = 0;
      // jsdom defines scrollTo but refuses to implement it, and the refusal
      // is an error on the virtual console — noise that buries a real one.
      try { scrollTo({ top: 0 }); } catch { /* not a browser */ }
    }
    this.booted = true;
  }

  /* ── history (R5) ───────────────────────────────────────────────────── */

  private get history(): History | null {
    try { return this.o.doc.defaultView?.history ?? null; } catch { return null; }
  }

  /** This entry's place in the session history, as the shell numbered it. */
  private entryIndex(): number | null {
    try {
      const st = this.history?.state as Record<string, unknown> | null | undefined;
      const n = st && typeof st === 'object' ? st[NAV_KEY] : undefined;
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    } catch { return null; }
  }

  /**
   * Number the current history entry. An entry numbered before (a back or
   * forward press, a reload) keeps its number; a new one is one past the
   * entry it was pushed from. Entries only ever form a line — a push drops
   * everything ahead of it — so the difference between two numbers is the
   * distance a back or forward press travelled. Whatever else a view keeps
   * in the state (results-view preserves it on replace) is kept too.
   */
  private stampEntry(): void {
    const at = this.entryIndex();
    if (at !== null) { this.navIndex = at; this.navCounted = true; this.navStamped = true; return; }
    this.numberEntry(this.navCounted ? this.navIndex + 1 : 0);
  }

  /** Give the current entry number `n`, keeping the rest of its state. */
  private numberEntry(n: number): void {
    this.navIndex = n;
    this.navCounted = true;
    this.navStamped = false;
    const h = this.history;
    if (!h) return;
    try {
      const st = h.state;
      const base = st && typeof st === 'object' ? st as Record<string, unknown> : {};
      h.replaceState({ ...base, [NAV_KEY]: n }, '');
      this.navStamped = this.entryIndex() === n;
    } catch { /* no history API, or a state it cannot clone: count nothing */ }
  }

  /**
   * How far the navigation now being decided moved through history, and
   * whether that is known or assumed: -1 for a back press, +1 for forward or
   * a new entry (a tab, a link, a typed address), 0 for a navigation that
   * replaced the entry.
   *
   * A numbered entry says it exactly. An entry with no number yet is new, or
   * was replaced, or is one from before the shell started; the Navigation
   * API, where the browser has it, said which as it began. Without it the
   * shell assumes a new entry — every way this app leaves a page pushes one —
   * and settleUndo checks where the step back lands.
   */
  private travelled(): { delta: number; known: boolean } {
    const at = this.entryIndex();
    if (at !== null) return { delta: at - this.navIndex, known: true };
    const told = this.lastNavigate;
    if (told && told.delta !== null && told.url === location.href) return { delta: told.delta, known: true };
    // The page on screen has no number to travel back to: overwrite in place.
    if (!this.navStamped) return { delta: 0, known: true };
    return { delta: 1, known: false };
  }

  /**
   * Listen to the Navigation API's `navigate`, which fires before a
   * navigation moves and says what kind it is. Cap-safe: a push at Chrome's
   * fifty-entry limit keeps the same index, but still says "push".
   */
  private watchNavigate(): void {
    type Nav = EventTarget & { currentEntry?: { index?: number } | null };
    type NavigateEvent = Event & { navigationType?: string; destination?: { url?: string; index?: number } };
    let nav: Nav | undefined;
    try {
      nav = (this.o.doc.defaultView as unknown as { navigation?: Nav } | null)?.navigation;
    } catch { return; }
    if (!nav || typeof nav.addEventListener !== 'function') return;
    const api = nav;
    const onNavigate = (e: Event) => {
      const n = e as NavigateEvent;
      const from = api.currentEntry?.index ?? -1;
      const to = n.destination?.index ?? -1;
      this.lastNavigate = {
        url: n.destination?.url ?? '',
        delta: n.navigationType === 'push' ? 1
          : n.navigationType === 'replace' ? 0
          : n.navigationType === 'traverse' && from >= 0 && to >= 0 ? to - from
          : null,
      };
    };
    api.addEventListener('navigate', onNavigate);
    this.teardowns.push(() => api.removeEventListener('navigate', onNavigate));
  }

  /**
   * Where the step undoing a held navigation landed. On the page's own
   * entry: undone, and if the answer came while travelling, the navigation
   * goes on now. For a navigation of unknown kind (no Navigation API), one
   * entry further back means it had REPLACED the page's entry, not pushed
   * one: step forward onto that entry again and overwrite it with the page.
   * Returns true when this hashchange was one of those steps, or the held
   * navigation delivered a second time, and must not be drawn.
   */
  private settleUndo(): boolean {
    const u = this.undo;
    if (!u) return false;
    const at = this.entryIndex();
    // Still where the step was sent from: the same navigation again (a second
    // hashchange for it), not the step. It has been dealt with already.
    if (location.hash === u.from.hash && at === u.from.at) return true;
    this.undo = null;
    if (!u.returning && at === u.expect) {
      // An entry shown as the default route (an empty or unknown hash) is
      // given the page's own address, in place, as the overwrite always did.
      if (location.hash !== u.stay) this.replaceHash(u.stay);
      if (u.resume) { this.bypassGuard = true; this.go(u.hold.delta); }
      return false;   // the same-page branch counts the entry
    }
    if (u.check && !u.returning && at === u.expect - 1) {
      u.hold.replaced = true;
      this.undo = { ...u, returning: true, from: { hash: location.hash, at } };
      this.go(1);
      return true;
    }
    if (u.returning && at === null && location.hash === u.target) {
      if (u.resume) {
        // The target keeps the entry it replaced, and that entry's number.
        this.numberEntry(u.expect);
        this.bypassGuard = true;
        return false;
      }
      this.replaceHash(u.stay);
      this.numberEntry(u.expect);
      this.currentHash = location.hash;
      return true;
    }
    return false;   // some other navigation got there first: handle it as usual
  }

  private go(delta: number): void {
    try { this.history?.go(delta); } catch { /* nowhere to go */ }
  }

  /** Point the current entry at `hash` without a new entry or an event. */
  private replaceHash(hash: string): void {
    const h = this.history;
    try {
      if (h) { h.replaceState(h.state, '', hash); return; }
    } catch { /* fall through */ }
    location.replace(hash);
  }

  /** The address of the page on screen, query included when the address still names it. */
  private hashFor(route: ShellRoute): string {
    const h = this.currentHash;
    const at = h.replace(/^#\/?/, '').split('?')[0];
    return at === route.path ? h : `#/${route.path}`;
  }

  private paintCrumb(path: string): void {
    const crumb = this.crumbEl;
    if (!crumb) return;
    crumb.textContent = '';
    const d = this.o.doc;
    const parts = this.o.role
      ? crumbFor(this.o.role, path)
      : [this.route(path)?.labelBn ?? ''];
    const clean = parts.filter(Boolean);
    if (!clean.length) return;
    clean.forEach((part, i) => {
      if (i > 0) {
        const sep = d.createElement('span');
        sep.className = 'shell-crumb-sep';
        sep.setAttribute('aria-hidden', 'true');
        // "দৈনন্দিন / হাজিরা" — 01 Shell §খ separates section and page
        // with a slash.
        sep.textContent = '/';
        crumb.append(sep);
      }
      const el = d.createElement('span');
      el.className = 'shell-crumb-part';
      this.setText(el, part);
      if (i === clean.length - 1) el.setAttribute('aria-current', 'page');
      crumb.append(el);
    });
  }
}

/**
 * Send queued offline work by itself when there is a connection to send it on.
 *
 * The toasts promise "সংযোগ পেলে নিজেই জমা হবে", and before this nothing
 * kept the promise: the only automatic trigger was a service-worker message
 * for a Background Sync tag nobody registered, so a register saved in a dead
 * zone waited for the teacher's next save. The outbox is flushed:
 *   - once now (a queue left from an earlier session, drained at boot);
 *   - on `online`;
 *   - when the app comes back to the foreground (`visibilitychange` →
 *     visible), which is when a phone that was pocketed offline is next used;
 *   - and, while anything is still waiting and the device says it is online,
 *     again after `retryMs`. `online` can fire before the network truly works
 *     (a captive portal, a 2G link coming up), that flush fails and backs
 *     off, and without a retry nothing would try again. The engine only
 *     claims ops whose backoff has passed, so the retry costs nothing when
 *     there is nothing due. One timer at a time.
 *
 * `progress` is to be called with the engine's state on every change (its
 * `onProgress`): it arms the retry and asks the service worker for a
 * Background Sync, so Chrome can also send while the app is closed. Every
 * report, and the state read after every flush attempt, is also dispatched
 * on the document as `shikhon:outbox` (`detail: { pending, inflight }`) for
 * the screens that show a queue line.
 * The flush function never throws (SyncEngine.flush), but a rejection is
 * swallowed here anyway: this runs from event listeners.
 */
export interface AutoFlush {
  progress(st: { pending: number; inflight?: number }): void;
  /** Flush now if online. Also what the listeners call. */
  kick(): void;
  stop(): void;
}

export function autoFlush(o: {
  flush: () => Promise<unknown>;
  state: () => Promise<{ pending: number; inflight?: number }>;
  doc?: Document;
  retryMs?: number;
  /** Background Sync registration; defaults to the service worker's. */
  registerSync?: () => void;
}): AutoFlush {
  const retryMs = o.retryMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let syncAsked = false;

  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

  /**
   * Tell the page what is still waiting: `shikhon:outbox` on the document,
   * `detail: { pending, inflight }`, after every flush attempt (kick) and
   * every progress report. A screen that shows a queue line (attendance's
   * "১টি অপেক্ষমাণ", the marks footer) listens and repaints it. Before this
   * only the register saved in that same view could learn that its queue had
   * emptied: after a cold start, or leaving the screen and coming back, the
   * line said "পাঠানো হচ্ছে" long after the work had gone. A listener that
   * throws is the browser's to report; it cannot stop the flush.
   */
  const announce = (st: { pending: number; inflight?: number }) => {
    const doc = o.doc ?? (typeof document === 'undefined' ? undefined : document);
    const Ev = doc?.defaultView?.CustomEvent;
    if (!doc || typeof Ev !== 'function') return;
    try {
      doc.dispatchEvent(new Ev('shikhon:outbox', {
        detail: { pending: st.pending, inflight: st.inflight ?? 0 },
      }));
    } catch { /* a document being torn down */ }
  };

  const registerSync = o.registerSync ?? (() => {
    try {
      void navigator.serviceWorker?.ready
        .then((r) => (r as unknown as { sync?: { register(tag: string): Promise<void> } })
          .sync?.register('outbox-flush'))
        .catch(() => { /* no Background Sync: the listeners here still send */ });
    } catch { /* no service worker */ }
  });

  const api: AutoFlush = {
    kick() {
      if (stopped || !online()) return;
      void o.flush()
        .catch(() => undefined)
        .then(() => (stopped ? null : o.state()))
        .then((st) => { if (st) api.progress(st); })
        .catch(() => { /* no store: nothing to retry */ });
    },
    progress(st) {
      if (stopped) return;
      announce(st);
      const waiting = st.pending > 0;
      if (!waiting) { syncAsked = false; return; }
      if (!syncAsked) { syncAsked = true; registerSync(); }
      if (timer === null && online()) {
        timer = setTimeout(() => { timer = null; api.kick(); }, retryMs);
      }
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      removeEventListener('online', onOnline);
      o.doc?.removeEventListener('visibilitychange', onVisible);
    },
  };

  const onOnline = () => api.kick();
  const onVisible = () => { if (o.doc?.visibilityState === 'visible') api.kick(); };
  addEventListener('online', onOnline);
  o.doc?.addEventListener('visibilitychange', onVisible);
  api.kick();
  return api;
}

/**
 * The first character of a name, for a monogram.
 *
 * Bangla is the point: `'মোহাম্মদপুর'[0]` is `'ম'` but `'ক্ষুদ্র'[0]` is
 * `'ক'` with the conjunct's other half orphaned into the next slot, and a
 * name beginning with a surrogate pair (an emoji in a school's display name,
 * which happens) splits into a lone half. A grapheme segmenter takes the
 * whole cluster; where it is unavailable the spread operator at least takes
 * whole code points.
 */
function firstGrapheme(s: string): string {
  const t = s.trim();
  if (!t) return '•';
  try {
    const seg = new Intl.Segmenter('bn', { granularity: 'grapheme' });
    for (const g of seg.segment(t)) return g.segment;
  } catch { /* no Segmenter: fall through */ }
  return [...t][0] ?? '•';
}
