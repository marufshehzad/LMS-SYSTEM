/**
 * Learn (পড়াশোনা) — the syllabus browse + topic reader.
 *
 * The first genuinely student-facing screen in the product. Three modes in
 * one view because they share cached data and the transition between them
 * should never hit the network twice:
 *
 *   list    — one subject's chapters, each with a progress bar
 *   topics  — one chapter's lessons
 *   reader  — one topic's blocks, with progress written to the outbox
 *
 * Offline behaviour matches attendance: chapter lists and opened topics
 * are cached in localStorage, and reading progress is enqueued as a
 * `topic_progress` op rather than PUT directly — a student on a bus with
 * no signal still records what they read.
 *
 * ── Ata Ekta (03 Student §০২ learnScreen) ─────────────────────────────────
 *
 * The chapter list is drawn as an --inset strip holding one subject <select>
 * over flush rows: the chapter's name with its percentage at the right, then
 * an 8px pill bar. No ring, no card, no chevron. The select is a filter over
 * chapters ALREADY loaded — changing it refills the list in place, fetches
 * nothing, and never re-renders, so focus stays on the control. It starts on
 * the subject tapped on আমার বিষয় when the route passes one (`subjectId`),
 * else on the first subject — the grouped page it replaced showed every
 * subject, so arriving from a subject must not land on a different one.
 *
 * The bar's tint is the percentage's own meaning, set on the row as
 * `data-progress-tone` (not `data-tone`, which other rules key colour on):
 * done → ok, past half → warn, under half → danger, not started → ink-3.
 * The figure beside it always says the number in words' place.
 *
 * Topics and the reader are not drawn anywhere; they are built from the
 * shared components — backLink, pageHeader, list/listItem, sectionHeading,
 * the full-width flush-left primary — and every state the §7 table asks for.
 */
import type { Auth } from './auth.ts';
import { formatCount } from '../../../packages/ui-core/src/format.ts';
import { PracticeView, type PracticeQuestion } from './practice-view.ts';
import { refuseUnlessOk, isDenied } from './http-status.ts';
import {
  el, append, icon, clear, numText, field, backLink, statusBadge, list, listItem,
  pageHeader, sectionHeading, listSkeleton, emptyState, errorState,
  permissionState, deniedMessage, deniedContact,
} from './ui/index.ts';

export interface Chapter {
  id: string;
  chapterNo: number;
  name: { bn: string; en: string | null };
  summaryBn: string | null;
  estMinutes: number;
  isPublished: boolean;
  subject: { id: string; bn: string; en: string };
  prerequisite: { id: string; nameBn: string } | null;
  topicCount: number;
  completedCount: number;
}

interface Topic {
  id: string;
  topicNo: number;
  title: { bn: string; en: string | null };
  estMinutes: number;
  isPublished: boolean;
  progress: { state: string; secondsSpent: number } | null;
}

interface Block {
  id: string;
  blockNo: number;
  kind: string;
  bodyBn: string | null;
  mediaKey: string | null;
  altTextBn: string | null;
  captionBn: string | null;
}

/** Only what this view needs from the sync engine. */
export interface LearnOutbox {
  enqueue(input: { entity: 'topic_progress' | 'practice_attempt'; payload: unknown }): Promise<{ opId: string }>;
  flush(): Promise<unknown>;
}

export interface LearnViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
  outbox: LearnOutbox;
  /** The student's class; in demo mode this is a sample id. */
  classId?: string;
  /**
   * The subject to show first — the one the student tapped on আমার বিষয়
   * (F-802). Only the strip's starting choice: it fetches nothing and filters
   * nothing the server sends. Unknown or absent, the first subject is shown.
   */
  subjectId?: string;
}

const CHAPTERS_CACHE = 'shikhon_chapters_cache';
const TOPIC_CACHE_PREFIX = 'shikhon_topic_cache_';

/** The one sentence under every "could not fetch" title (00 Foundations §04). */
const FETCH_FAILED_DETAIL = 'ইন্টারনেট নেই বা সার্ভার সাড়া দিচ্ছে না।';

type Mode = { kind: 'list' } | { kind: 'topics'; chapter: Chapter } | { kind: 'reader'; chapter: Chapter; topicId: string };

/** How far through a chapter, as the meaning its bar is tinted with. */
type ProgressTone = 'success' | 'warn' | 'danger' | 'neutral';

export class LearnView {
  private readonly o: LearnViewOptions;
  private mode: Mode = { kind: 'list' };
  private chapters: Chapter[] = [];
  private topics: Topic[] = [];
  private blocks: Block[] = [];
  private topicTitle = '';
  private offline = false;
  /**
   * The server refused this read (403). Distinct from `offline`, and the
   * distinction is the point: an outage is temporary and a refusal is not,
   * so this state offers no retry and shows no cached data (B-30).
   */
  private denied = false;
  /** B-84. The refusal itself, so the screen can say which kind it was. */
  private deniedErr: unknown = null;
  private loading = true;
  /**
   * §7 error states. Each is set only when a fetch failed AND there is
   * nothing cached to show in its place — with a cache, the cached copy under
   * the offline banner is the better answer. Without these three, a failed
   * first load looked exactly like an empty syllabus.
   */
  private loadFailed = false;
  private topicsFailed = false;
  private readerFailed = false;
  /** The subject chosen in the strip. Survives a trip into a chapter and back. */
  private subjectId: string | null = null;
  /**
   * The subject asked for on arrival, held until the loaded chapters include
   * it. The cached list can predate a subject the fresh one has, so the first
   * paint must not spend the request; and once the student picks for
   * themselves, their pick wins over a late fetch.
   */
  private wantedSubjectId: string | null;
  private readingSince = 0;
  private lastBlockSeen = 0;
  private questions: PracticeQuestion[] = [];
  private practising = false;
  private textSize = LearnView.loadTextSize();

  constructor(options: LearnViewOptions) {
    this.o = options;
    this.wantedSubjectId = options.subjectId || null;
    void this.loadChapters();
  }

  /* ---------------------------------------------------------- reader text size
     §6.3: "Text-size control is persistent and remembered." A student reads
     this screen for the better part of an hour; the size that suits their
     eyes and their phone must survive being closed, not reset every open.
     Every level clears the 16px Bangla-legibility floor. */
  private static readonly TEXT_SIZES = [16, 18, 21, 25];
  private static readonly TEXT_SIZE_KEY = 'shikhon_reader_textsize';

  private static loadTextSize(): number {
    try {
      // Null-check before Number(): Number(null) is 0, a valid index, which
      // would silently make "never chosen" mean "smallest" instead of default.
      const raw = localStorage.getItem(LearnView.TEXT_SIZE_KEY);
      if (raw !== null) {
        const n = Number(raw);
        if (Number.isInteger(n) && n >= 0 && n < LearnView.TEXT_SIZES.length) return n;
      }
    } catch { /* private mode */ }
    return 1; // 18px default — a hair above the old fixed 17
  }

  private saveTextSize(): void {
    try { localStorage.setItem(LearnView.TEXT_SIZE_KEY, String(this.textSize)); } catch { /* ignore */ }
  }

  /* ------------------------------------------------------------- caching */

  private cacheGet<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch { return null; }
  }

  private cacheSet(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* best effort */ }
  }

  /* --------------------------------------------------------------- loads */

  private async loadChapters(): Promise<void> {
    const cached = this.cacheGet<Chapter[]>(CHAPTERS_CACHE);
    if (cached) { this.chapters = cached; this.loading = false; }
    this.render();

    const classId = this.o.classId ?? localStorage.getItem('shikhon_last_class') ?? '';
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/chapters?classId=${encodeURIComponent(classId)}`,
      );
      await refuseUnlessOk(res);
      const body = (await res.json()) as { chapters: Chapter[] };
      this.chapters = body.chapters;
      this.offline = false;
      this.loadFailed = false;
      this.cacheSet(CHAPTERS_CACHE, this.chapters);
    } catch (err) {
      if (isDenied(err)) {
        this.denied = true;
        this.deniedErr = err; this.chapters = []; this.offline = false;
        try { localStorage.removeItem(CHAPTERS_CACHE); } catch { /* private mode */ }
        // These two have no `finally { render() }`, so a bare return
        // computed the denied state and never painted it.
        this.loading = false; this.render(); return;
      }
      this.offline = this.chapters.length > 0;
      this.loadFailed = this.chapters.length === 0;
    }
    this.loading = false;
    this.render();
  }

  private async openChapter(chapter: Chapter): Promise<void> {
    this.mode = { kind: 'topics', chapter };
    this.loading = true;
    this.topicsFailed = false;
    this.render();
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/topics?chapterId=${encodeURIComponent(chapter.id)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { topics: Topic[] };
      this.topics = body.topics;
      this.offline = false;
    } catch {
      // Topics are never cached, so a failed fetch has nothing saved to fall
      // back on: it is the error state, not "offline — showing saved lessons"
      // over a false "no lessons in this chapter".
      this.topics = [];
      this.topicsFailed = true;
    }
    this.loading = false;
    this.render();
  }

  private async openTopic(chapter: Chapter, topicId: string): Promise<void> {
    this.mode = { kind: 'reader', chapter, topicId };
    this.loading = true;
    this.readerFailed = false;
    this.readingSince = Date.now();
    this.lastBlockSeen = 0;
    this.practising = false;
    this.questions = [];

    const cached = this.cacheGet<{ title: string; blocks: Block[] }>(TOPIC_CACHE_PREFIX + topicId);
    if (cached) { this.topicTitle = cached.title; this.blocks = cached.blocks; this.loading = false; }
    this.render();

    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/topics?topicId=${encodeURIComponent(topicId)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        topic: { title: { bn: string } }; blocks: Block[];
      };
      this.topicTitle = body.topic.title.bn;
      this.blocks = body.blocks;
      this.offline = false;
      this.readerFailed = false;
      this.cacheSet(TOPIC_CACHE_PREFIX + topicId, { title: this.topicTitle, blocks: this.blocks });
    } catch {
      this.offline = this.blocks.length > 0;
      this.readerFailed = this.blocks.length === 0;
    }
    this.loading = false;
    this.render();

    // Record that reading started, immediately — a student who closes the
    // app mid-topic should still show as having begun it.
    void this.recordProgress(topicId, 'started');
    void this.loadPractice(topicId);
  }

  private async loadPractice(topicId: string): Promise<void> {
    const cacheKey = `shikhon_practice_${topicId}`;
    const cached = this.cacheGet<PracticeQuestion[]>(cacheKey);
    if (cached) this.questions = cached;
    try {
      const res = await this.o.auth.authedFetch(
        `/api/v1/academics/practice?topicId=${encodeURIComponent(topicId)}`,
      );
      if (res.ok) {
        const body = (await res.json()) as { questions?: PracticeQuestion[] };
        this.questions = body.questions ?? [];
        // Cached whole so practice works on a later offline visit.
        this.cacheSet(cacheKey, this.questions);
      }
    } catch {
      // Offline: whatever was cached is what we have.
    }
    if (this.mode.kind === 'reader') this.render();
  }

  /* ------------------------------------------------------------ progress */

  private async recordProgress(topicId: string, state: 'started' | 'completed'): Promise<void> {
    const seconds = this.readingSince ? Math.round((Date.now() - this.readingSince) / 1000) : 0;
    try {
      await this.o.outbox.enqueue({
        entity: 'topic_progress',
        payload: {
          topicId,
          state,
          secondsSpent: seconds,
          lastBlockNo: this.lastBlockSeen || null,
        },
      });
      this.readingSince = Date.now();   // reset so seconds aren't double-counted
      void Promise.resolve(this.o.outbox.flush()).catch(() => {});
    } catch {
      // Offline enqueue failure is not a user-facing error.
    }
  }

  /* -------------------------------------------------------------- render */

  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    if (this.mode.kind === 'reader') { this.renderReader(); return; }
    if (this.mode.kind === 'topics') { this.renderTopics(); return; }

    // ---------------------------------------------------------- chapter list
    root.append(pageHeader(d, {
      title: 'পড়াশোনা',
      subtitle: 'তোমার শ্রেণির অধ্যায় ও পাঠ',
    }));

    // B-30. A refusal outranks the error, the skeleton and the empty state:
    // nothing is loading, there is nothing to show, and calling it "offline"
    // is the lie this item exists to remove.
    if (this.denied) {
      root.append(permissionState(d, {
        message: deniedMessage(this.deniedErr, 'পড়াশোনার বিষয়বস্তু'),
        contact: deniedContact(this.deniedErr),
      }));
      return;
    }

    if (this.loadFailed && this.chapters.length === 0) {
      root.append(errorState(d, `অধ্যায়ের তালিকা আনা গেল না। ${FETCH_FAILED_DETAIL}`, () => {
        this.loadFailed = false;
        this.loading = true;
        void this.loadChapters();
      }));
      return;
    }

    if (this.loading && this.chapters.length === 0) {
      root.append(listSkeleton(d, 5));
      return;
    }

    if (this.chapters.length === 0) {
      root.append(emptyState(d, {
        glyph: 'book-open',
        message: 'এখনো কোনো অধ্যায় যুক্ত হয়নি। শিক্ষক পাঠ যোগ করলে এখানে দেখা যাবে।',
        // The subject list is the way into chapters (app.ts F-802), so it is
        // where a student with an empty syllabus goes next.
        action: { label: 'আমার বিষয় দেখো', onClick: () => { location.hash = '/subjects'; } },
      }));
      return;
    }

    // Group by subject — by id, so two subjects that share a Bangla name stay
    // two choices — in the order the API sent them.
    const bySubject = new Map<string, { bn: string; chapters: Chapter[] }>();
    for (const c of this.chapters) {
      const group = bySubject.get(c.subject.id) ?? { bn: c.subject.bn, chapters: [] };
      group.chapters.push(c);
      bySubject.set(c.subject.id, group);
    }
    // Arriving from আমার বিষয়: start on the subject that was tapped, as soon as
    // the chapters on hand include it.
    if (this.wantedSubjectId !== null && bySubject.has(this.wantedSubjectId)) {
      this.subjectId = this.wantedSubjectId;
      this.wantedSubjectId = null;
    }
    if (this.subjectId === null || !bySubject.has(this.subjectId)) {
      this.subjectId = bySubject.keys().next().value ?? null;
    }

    const wrap = el(d, 'div', { className: 'learn-list' });
    if (this.offline) wrap.append(this.offlineBanner());

    // The subject's name as the level-2 heading the grouped sections used to
    // give, kept for heading navigation; the select already shows it.
    const heading = el(d, 'h2', { className: 'ui-sr-only' });
    const ul = el(d, 'ul', { className: 'chapter-list' });
    const fill = (): void => {
      const group = bySubject.get(this.subjectId ?? '');
      clear(heading);
      clear(ul);
      if (!group) return;
      append(heading, ...numText(d, group.bn));
      ul.setAttribute('aria-label', `${group.bn} — অধ্যায়`);
      for (const c of group.chapters) ul.append(el(d, 'li', {}, this.chapterRow(c)));
    };

    const subject = field(d, {
      kind: 'select',
      name: 'subject',
      label: 'বিষয়',
      value: this.subjectId ?? undefined,
      options: [...bySubject].map(([id, group]) => ({ value: id, label: group.bn })),
      // Refill only the list: a re-render would rebuild the select and take
      // focus away from the person still choosing.
      onChange: (v) => { this.subjectId = v; this.wantedSubjectId = null; fill(); },
    });
    // Drawn without a visible label; the word stays the select's name.
    subject.root.querySelector('.ui-field-label')?.classList.add('ui-sr-only');

    wrap.append(el(d, 'div', { className: 'learn-subject' }, subject.root), heading, ul);
    fill();
    root.append(wrap);
  }

  /** One chapter: name and percentage on a line, the bar under them. */
  private chapterRow(c: Chapter): HTMLElement {
    const d = this.o.doc;
    const pct = c.topicCount > 0 ? Math.round((c.completedCount / c.topicCount) * 100) : 0;
    const tone: ProgressTone = pct >= 100 ? 'success' : pct <= 0 ? 'neutral' : pct >= 50 ? 'warn' : 'danger';

    const btn = el(d, 'button', {
      className: 'chapter-card',
      data: { progressTone: tone },
      attrs: {
        type: 'button',
        // Bangla. This announced "…, 2 of 4 topics done" in the middle of a
        // Bangla page, to the one reader who has nothing but the announcement.
        'aria-label': `${c.name.bn} — ${c.topicCount === 0 ? 'কোনো পাঠ নেই'
          : `${formatCount(c.topicCount, 'bn')} পাঠের মধ্যে `
            + `${formatCount(c.completedCount, 'bn')}টি শেষ`}`,
      },
    });

    const head = el(d, 'span', { className: 'chapter-head' },
      el(d, 'span', { className: 'chapter-title' }, ...numText(d, c.name.bn)));
    if (!c.isPublished) head.append(statusBadge(d, { state: 'draft', label: 'খসড়া' }));
    head.append(el(d, 'span', { className: 'chapter-pct n', text: `${formatCount(pct, 'bn')}%` }));
    btn.append(head);

    if (c.prerequisite) {
      btn.append(el(d, 'span', { className: 'chapter-pre' },
        ...numText(d, `আগে পড়ো: ${c.prerequisite.nameBn}`)));
    }

    // The label already says how far; the bar is the same fact drawn.
    btn.append(el(d, 'span', { className: 'ui-progress-track', attrs: { 'aria-hidden': 'true' } },
      el(d, 'span', { className: 'ui-progress-fill', style: { width: `${pct}%` } })));

    btn.addEventListener('click', () => { void this.openChapter(c); });
    return btn;
  }

  private renderTopics(): void {
    if (this.mode.kind !== 'topics') return;
    const d = this.o.doc;
    const root = this.o.root;
    const chapter = this.mode.chapter;
    const back = (): void => { this.mode = { kind: 'list' }; this.render(); };

    root.append(backLink(d, 'সব অধ্যায়', back));

    root.append(pageHeader(d, {
      title: chapter.name.bn,
      subtitle: chapter.summaryBn || undefined,
    }));

    if (this.topicsFailed) {
      root.append(errorState(d, `পাঠের তালিকা আনা গেল না। ${FETCH_FAILED_DETAIL}`, () => {
        void this.openChapter(chapter);
      }));
      return;
    }

    if (this.offline) root.append(this.offlineBanner(true));
    if (this.loading) { root.append(listSkeleton(d, 4)); return; }
    if (this.topics.length === 0) {
      root.append(emptyState(d, {
        glyph: 'book-open',
        message: 'এই অধ্যায়ে এখনো পাঠ যুক্ত হয়নি।',
        action: { label: 'সব অধ্যায়', onClick: back },
      }));
      return;
    }

    root.append(list(d, `${chapter.name.bn} — পাঠ`,
      ...this.topics.map((t) => this.topicRow(chapter, t))));
  }

  /** One lesson, as a list row. The state glyph is decoration; the words carry it. */
  private topicRow(chapter: Chapter, t: Topic): HTMLElement {
    const d = this.o.doc;
    const state = t.progress?.state ?? 'new';
    const minutes = `${formatCount(t.estMinutes, 'bn')} মিনিট`;
    const li = listItem(d, {
      title: t.title.bn,
      meta: state === 'completed' ? `সম্পন্ন · ${minutes}` : minutes,
      glyph: state === 'completed' ? 'check-circle' : state === 'started' ? 'clock' : 'book-open',
      onClick: () => { void this.openTopic(chapter, t.id); },
    });
    const hit = li.querySelector<HTMLElement>('.ui-list-hit');
    if (hit) {
      hit.classList.add('topic-card');
      hit.dataset.state = state;
    }
    return li;
  }

  private renderReader(): void {
    if (this.mode.kind !== 'reader') return;
    const d = this.o.doc;
    const root = this.o.root;
    const { chapter, topicId } = this.mode;

    root.append(backLink(d, chapter.name.bn, () => {
      void this.recordProgress(topicId, 'started');
      void this.openChapter(chapter);
    }));

    root.append(pageHeader(d, { title: this.topicTitle || 'পাঠ' }));

    // Before the tools and the done button: a lesson that never arrived has
    // no text to resize and nothing to mark as read.
    if (this.readerFailed && this.blocks.length === 0) {
      root.append(errorState(d, `পাঠটি আনা গেল না। ${FETCH_FAILED_DETAIL}`, () => {
        void this.openTopic(chapter, topicId);
      }));
      return;
    }

    if (this.offline) root.append(this.offlineBanner(true));
    if (this.loading && this.blocks.length === 0) { root.append(listSkeleton(d, 4)); return; }

    // Was 'topic-reader', but the stylesheet only ever styled '.lesson-reader'
    // — so the reading measure (68ch, 1.85 leading, the reader type size) had
    // never applied and the article fell back to full-width body defaults.
    const article = d.createElement('article');
    article.className = 'lesson-reader';
    article.setAttribute('lang', 'bn');
    article.style.fontSize = `${LearnView.TEXT_SIZES[this.textSize]}px`;

    // Text-size control (§6.3), above the reading so it is found before it is
    // needed. Restyles the article in place — no re-render, no lost scroll.
    const tools = d.createElement('div');
    tools.className = 'reader-tools';
    const tlabel = d.createElement('span');
    tlabel.className = 'reader-tools-label';
    tlabel.textContent = 'লেখার আকার';
    const smaller = d.createElement('button');
    smaller.type = 'button'; smaller.className = 'reader-size';
    smaller.textContent = 'অ'; smaller.setAttribute('aria-label', 'লেখা ছোট করো');
    const bigger = d.createElement('button');
    bigger.type = 'button'; bigger.className = 'reader-size reader-size-lg';
    bigger.textContent = 'অ'; bigger.setAttribute('aria-label', 'লেখা বড় করো');
    const applySize = () => {
      article.style.fontSize = `${LearnView.TEXT_SIZES[this.textSize]}px`;
      smaller.disabled = this.textSize === 0;
      bigger.disabled = this.textSize === LearnView.TEXT_SIZES.length - 1;
    };
    smaller.addEventListener('click', () => {
      if (this.textSize > 0) { this.textSize--; this.saveTextSize(); applySize(); }
    });
    bigger.addEventListener('click', () => {
      if (this.textSize < LearnView.TEXT_SIZES.length - 1) { this.textSize++; this.saveTextSize(); applySize(); }
    });
    tools.append(tlabel, smaller, bigger);
    applySize();
    root.append(tools);

    for (const b of this.blocks) {
      this.lastBlockSeen = Math.max(this.lastBlockSeen, b.blockNo);
      article.append(this.renderBlock(b));
    }
    root.append(article);

    if (this.practising && this.questions.length > 0) {
      const host = el(d, 'div');
      const practiceWrap = el(d, 'section', { className: 'prac-wrap' },
        sectionHeading(d, { title: 'অনুশীলন' }), host);
      root.append(practiceWrap);
      new PracticeView({
        root: host,
        doc: d,
        questions: this.questions,
        outbox: this.o.outbox,
        onDone: () => {
          // Finishing the practice set is a far better completion signal
          // than a self-declared button, so it marks the topic done.
          void this.recordProgress(topicId, 'completed');
          this.practising = false;
          this.render();
        },
      });
      practiceWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // One primary on the page: practice when there is any, else "done".
    // Full width and flush left (14 Components §08). The label is ONE span:
    // btn-block spreads its children, and a bare "(৩টি" would be pushed apart.
    if (this.questions.length > 0) {
      const start = el(d, 'button', {
        className: 'btn-primary btn-block topic-done', attrs: { type: 'button' },
      }, el(d, 'span', { className: 'btn-label' },
        ...numText(d, `অনুশীলন করো (${formatCount(this.questions.length, 'bn')}টি প্রশ্ন)`)));
      start.addEventListener('click', () => { this.practising = true; this.render(); });
      root.append(start);
    }

    const doneLabel = el(d, 'span', { className: 'btn-label', text: 'পাঠ সম্পন্ন' });
    const done = el(d, 'button', {
      className: this.questions.length > 0
        ? 'btn-secondary btn-block topic-done-alt'
        : 'btn-primary btn-block topic-done',
      attrs: { type: 'button' },
    }, doneLabel, icon(d, 'check', 'btn-glyph'));
    done.addEventListener('click', () => {
      void this.recordProgress(topicId, 'completed');
      doneLabel.textContent = 'সম্পন্ন হয়েছে';
      done.disabled = true;
    });
    root.append(done);
  }

  private renderBlock(b: Block): HTMLElement {
    const d = this.o.doc;
    const body = b.bodyBn ?? '';
    switch (b.kind) {
      case 'key_point':
        return el(d, 'aside', { className: 'block-key-point' }, ...numText(d, body));
      case 'formula':
        // A formula is a figure: the whole block takes the numeral face.
        return el(d, 'div', { className: 'block-formula n', text: body });
      case 'example':
        return el(d, 'div', { className: 'block-example' },
          el(d, 'span', { className: 'block-label label', text: 'উদাহরণ' }),
          el(d, 'p', {}, ...numText(d, body)));
      case 'practice_prompt':
        return el(d, 'div', { className: 'block-practice' },
          el(d, 'span', { className: 'block-label label', text: 'নিজে করো' }),
          el(d, 'p', {}, ...numText(d, body)));
      case 'image': {
        const fig = el(d, 'figure', { className: 'block-figure' },
          el(d, 'img', {
            attrs: { src: `/media/${b.mediaKey ?? ''}`, alt: b.altTextBn ?? '', loading: 'lazy' },
          }));
        if (b.captionBn) fig.append(el(d, 'figcaption', {}, ...numText(d, b.captionBn)));
        return fig;
      }
      default:
        return el(d, 'p', { className: 'block-text' }, ...numText(d, body));
    }
  }

  /* --------------------------------------------------------------- bits */

  /**
   * The --warn-tint strip (00 Foundations §04). In the chapter list it is the
   * list shell's first row and runs edge to edge; above topics and the reader
   * it stands alone, so it takes its own edge (`learn-offline`).
   */
  private offlineBanner(standalone = false): HTMLElement {
    const d = this.o.doc;
    return el(d, 'p', { className: standalone ? 'offline-banner learn-offline' : 'offline-banner' },
      icon(d, 'wifi-off', 'offline-icon'),
      el(d, 'span', { text: 'অফলাইন — সংরক্ষিত পাঠ দেখানো হচ্ছে' }));
  }
}
