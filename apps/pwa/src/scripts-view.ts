/**
 * Answer-script photo capture (উত্তরপত্র).
 *
 * Camera → canvas → compressed JPEG → POST metadata. Compression happens
 * on-device before any byte leaves — the 3G budget (docs/04 §6) is the
 * whole point. Target: ≤200 KB per page after downscaling to 1600px on
 * the long edge and quality 0.7 (about 6× smaller than a typical phone
 * photo). Uses `input[type=file] capture=environment` because it works on
 * every Android browser without the MediaDevices permission dance.
 */
import type { Auth } from './auth.ts';
import { formatCount, formatIdentifier } from '../../../packages/ui-core/src/format.ts';
import {
  pageHeader, field, button, fileUpload, el, append, icon, numText,
  permissionState, permissionMessage, emptyState, errorState, skeleton, humanError,
} from './ui/index.ts';

const TARGET_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.7;
const MAX_PAGE_BYTES = 250 * 1024;

interface Page {
  id: string;
  pageNo: number;
  originalBytes: number;
  compressedBytes: number;
  sha256: string;
  dataUrl: string;
  status: 'ready' | 'uploading' | 'saved' | 'error';
  error?: string;
}

/** The three lists this screen picks from. Same shapes the marks and roster
 *  screens already read — named here because `typeof this.x` inside a method
 *  does not resolve (TS2683) and an inline shape would drift from theirs. */
interface SectionOpt { id: string; name: string; className: { bn: string } }
interface ExamOpt {
  examId: string; nameBn: string;
  subjects: Array<{ examSubjectId: string; subject: { bn: string } }>;
}
interface RosterOpt {
  studentId: string; rollNo: number;
  fullName: { bn: string | null; en: string | null };
}

export interface ScriptsViewOptions {
  root: HTMLElement;
  doc: Document;
  auth: Auth;
}

/** Downscale + re-encode; returns a Blob under the wire budget. */
async function compress(file: File, doc: Document): Promise<{ blob: Blob; originalBytes: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, TARGET_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = doc.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', JPEG_QUALITY);
  });
  return { blob, originalBytes: file.size };
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Mirrors `requireStaff` in server-core, which blocks exactly these two.
 * Advisory only — the endpoint is the gate; this decides whether the form is
 * offered at all.
 */
const NOT_STAFF = ['student', 'guardian'];

const bn = (n: number): string => formatCount(n, 'bn');

export class ScriptsView {
  private readonly o: ScriptsViewOptions;
  private sections: SectionOpt[] = [];
  private sectionId = '';
  private exams: ExamOpt[] = [];
  private roster: RosterOpt[] = [];
  private loadingCtx = true;
  private examSubjectId = '';
  private studentId = '';
  private pages: Page[] = [];
  private lastBlob = new Map<string, Blob>();
  private busy = false;
  private notice = '';
  /**
   * How the sections read ended. It used to end silently, so a refused or
   * failed read drew three pickers saying "কোনো সেকশন পাওয়া যায়নি" — a
   * sentence about the school that was really about the network (R10).
   */
  private ctxError: 'denied' | 'failed' | null = null;
  private ctxStatus = 0;

  constructor(options: ScriptsViewOptions) {
    this.o = options;
    this.render();
    void this.loadContext();
  }

  private async onFile(file: File): Promise<void> {
    if (!this.examSubjectId || !this.studentId) {
      this.notice = 'পরীক্ষা ও শিক্ষার্থীর তথ্য পূরণ করুন।';
      this.render();
      return;
    }
    this.busy = true;
    this.notice = '';
    this.render();
    try {
      const { blob, originalBytes } = await compress(file, this.o.doc);
      if (blob.size > MAX_PAGE_BYTES) {
        this.notice = `ফাইল এখনো বড় (${bn(Math.round(blob.size / 1024))} KB); আবার তোলার চেষ্টা করুন।`;
        this.busy = false; this.render(); return;
      }
      const sha = await sha256Hex(blob);
      const dataUrl = await blobToDataUrl(blob);
      const id = crypto.randomUUID();
      const pageNo = this.pages.length + 1;
      this.pages.push({
        id, pageNo, originalBytes, compressedBytes: blob.size,
        sha256: sha, dataUrl, status: 'ready',
      });
      this.lastBlob.set(id, blob);
    } catch (err) {
      this.notice = `ছবি প্রস্তুত করা যায়নি: ${String((err as Error).message ?? err)}`;
    }
    this.busy = false;
    this.render();
  }

  /**
   * Sections, then that section's exams and roster.
   *
   * Exactly the three reads marks-view and roster-view already perform, so a
   * teacher who can mark a paper can also file its scan — the authorization
   * is the one they already have, not a new one.
   */
  private async loadContext(): Promise<void> {
    this.ctxError = null;
    this.ctxStatus = 0;
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/sections');
      if (res.ok) {
        const body = (await res.json()) as { sections: SectionOpt[] };
        this.sections = body.sections ?? [];
        const remembered = (() => {
          try { return localStorage.getItem('shikhon_last_section') ?? ''; }
          catch { return ''; }
        })();
        this.sectionId = this.sections.some((x) => x.id === remembered)
          ? remembered : (this.sections[0]?.id ?? '');
      } else {
        // A 403 never becomes anything else on retry, so it is the denied
        // state; everything else is an error with a retry (roster-view and
        // marks-view read the same status the same way).
        this.ctxStatus = res.status;
        this.ctxError = res.status === 403 ? 'denied' : 'failed';
      }
    } catch {
      // Offline or the request never answered: the error state says which.
      this.ctxError = 'failed';
      this.ctxStatus = 0;
    }
    this.loadingCtx = false;
    this.render();
    if (this.sectionId) await this.loadSection(this.sectionId);
  }

  private async loadSection(sectionId: string): Promise<void> {
    this.sectionId = sectionId;
    this.examSubjectId = '';
    this.studentId = '';
    const q = encodeURIComponent(sectionId);
    try {
      const [ex, ro] = await Promise.all([
        this.o.auth.authedFetch(`/api/v1/academics/exams?sectionId=${q}`),
        this.o.auth.authedFetch(`/api/v1/academics/roster?sectionId=${q}`),
      ]);
      if (ex.ok) this.exams = ((await ex.json()) as { exams: ExamOpt[] }).exams ?? [];
      if (ro.ok) this.roster = ((await ro.json()) as { roster: RosterOpt[] }).roster ?? [];
    } catch { /* offline */ }
    this.render();
  }

  private async upload(page: Page): Promise<void> {
    page.status = 'uploading';
    page.error = undefined;
    this.render();
    try {
      const res = await this.o.auth.authedFetch('/api/v1/academics/scripts', {
        method: 'POST',
        body: JSON.stringify({
          id: page.id,
          examSubjectId: this.examSubjectId,
          studentId: this.studentId,
          pageNo: page.pageNo,
          byteSize: page.compressedBytes,
          originalBytes: page.originalBytes,
          sha256: page.sha256,
          capturedAt: new Date().toISOString(),
          contentType: 'image/jpeg',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) {
        page.status = 'saved';
      } else if (body.error === 'script_storage_unconfigured') {
        page.status = 'error';
        // It used to promise "অ্যাডমিন চালু করলেই আপলোড হবে" — an automatic
        // upload later. Nothing uploads by itself, and the photo is gone once
        // the screen is left, so say only what happened (R3: do not fake it).
        page.error = 'সংরক্ষণ এখনো চালু হয়নি — পৃষ্ঠাটি পাঠানো যায়নি।';
      } else {
        page.status = 'error';
        page.error = body.error ?? 'আপলোড ব্যর্থ';
      }
    } catch (err) {
      page.status = 'error';
      page.error = `সংযোগ নেই — পরে আবার চেষ্টা করুন`;
      void err;
    }
    this.render();
  }

  private removePage(id: string): void {
    this.pages = this.pages.filter((p) => p.id !== id);
    this.pages.forEach((p, i) => { p.pageNo = i + 1; });
    this.lastBlob.delete(id);
    this.render();
  }

  /**
   * 02 Teacher §05 "উত্তরপত্র আপলোড", top to bottom: the info callout, the
   * dashed capture tile, the grid label, and a three-across grid of photos
   * with the state written under each one.
   *
   * Two things the drawing does not show are kept, because upload cannot work
   * without them: the three pickers (which paper, whose paper) above the
   * callout, and each photo's own আপলোড / সরান — uploading is per page, by
   * hand, as it was.
   *
   * The layout is the drawing's; three pieces of its copy are not. It says
   * photos stay on the device without internet, titles the grid
   * "আপলোড হয়েছে" and marks pages "গেছে" / "অপেক্ষায়" — a persisted,
   * automatic queue. Here pages live in memory until this screen is left,
   * each is uploaded by hand, and the grid holds unsent and failed pages too.
   * The words below say that instead (R3); the drawn copy is an owner
   * question.
   */
  private render(): void {
    const d = this.o.doc;
    const root = this.o.root;
    root.textContent = '';

    // The h1 stays although the phone frame draws its title in the topbar:
    // a route without one is the P12-2 defect. The explanation that used to
    // be the subtitle is the callout below.
    root.append(pageHeader(d, { title: 'উত্তরপত্র আপলোড' }));

    // Mirrors `requireStaff` on the endpoint. Uploading a child's answer
    // script is a teacher's job, and a student meeting three pickers and a
    // camera trigger here is being offered somebody else's work. A 403 on
    // the sections read is the same refusal, said the same way.
    if (NOT_STAFF.includes(this.o.auth.role) || this.ctxError === 'denied') {
      root.append(permissionState(d, {
        message: permissionMessage('উত্তরপত্র আপলোড'),
        contact: 'বিষয় শিক্ষক বা প্রধান শিক্ষক',
      }));
      return;
    }

    // Offline, with pages not yet sent: say how many (§7). The shell's own
    // banner says the connection is gone; this one says what that means for
    // the work on this screen — including that the photos are held only
    // while the screen stays open, which is when losing them is likeliest.
    const waiting = this.pages.filter((p) => p.status === 'ready' || p.status === 'error').length;
    if (!navigator.onLine && waiting > 0) {
      root.append(el(d, 'p', {
        className: 'offline-banner scripts-offline', attrs: { role: 'status' },
      },
      icon(d, 'wifi-off', 'offline-icon'),
      el(d, 'span', {}, ...numText(d,
        `${bn(waiting)}টি পৃষ্ঠা এখনো পাঠানো হয়নি — সংযোগ পেলে আপলোড করুন। ততক্ষণ এই পাতা ছাড়বেন না।`))));
    }

    // The pickers' slot also carries the sections read's loading and its
    // failure, so the rest of the screen keeps its place.
    const pickers = el(d, 'div', { className: 'scripts-pickers' });
    if (this.loadingCtx) {
      append(pickers, skeleton(d, 3));
    } else if (this.ctxError === 'failed') {
      append(pickers, errorState(d,
        humanError(navigator.onLine ? null : 'offline', this.ctxStatus || undefined),
        () => {
          this.ctxError = null;
          this.loadingCtx = true;
          this.render();
          void this.loadContext();
        }));
    } else {
      append(pickers, ...this.pickerFields());
    }
    root.append(pickers);

    // Not the drawn "ইন্টারনেট না থাকলেও ছবি এই যন্ত্রে জমা থাকবে": pages
    // are held in memory, and app.ts builds a new view on every mount, so a
    // tab switch or a reload drops every unsent photo.
    root.append(el(d, 'p', {
      className: 'scripts-note',
      text: 'প্রতিটি উত্তরপত্রের ছবি তুলুন, তারপর প্রতিটি পৃষ্ঠা আপলোড করুন। এই পাতা ছাড়লে না-পাঠানো ছবি থাকবে না।',
    }));

    // `capture: 'environment'` opens the rear camera directly on a phone,
    // which is the whole interaction: a teacher points at a page on a desk.
    // The primitive keeps that — a real <label for> over a hidden input —
    // and the dashed tile is only its look.
    root.append(fileUpload(d, {
      label: this.busy ? 'প্রস্তুত হচ্ছে…' : 'ছবি তুলুন',
      name: 'page',
      accept: 'image/*',
      capture: 'environment',
      glyph: 'camera',
      className: 'scripts-capture',
      onFiles: (files) => { if (files[0]) void this.onFile(files[0]); },
    }).root);

    if (this.notice) {
      root.append(el(d, 'p', {
        className: 'scripts-notice', attrs: { role: 'alert' },
      }, ...numText(d, this.notice)));
    }

    // An h2 where the drawing has a <p>: it is the one heading between the
    // page title and the photos, and the outline had one here before. It
    // names every photo taken — unsent and failed ones too — so it is not
    // the drawn "আপলোড হয়েছে", which a screen reader would announce over
    // pages that never left the phone.
    root.append(el(d, 'h2', { className: 'label scripts-grid-label', text: 'তোলা পৃষ্ঠা' }));

    if (this.pages.length === 0) {
      // No action button: the capture tile directly above is the action.
      root.append(emptyState(d, {
        glyph: 'camera',
        message: 'এখনো কোনো পৃষ্ঠা তোলা হয়নি। উপরের বোতাম দিয়ে উত্তরপত্রের ছবি তুলুন।',
      }));
      return;
    }

    const grid = el(d, 'ul', {
      className: 'scripts-grid', attrs: { 'aria-label': 'তোলা পৃষ্ঠার তালিকা' },
    });
    for (const pg of this.pages) grid.append(this.tile(pg));
    root.append(grid);
  }

  /** Section, exam + subject, student — the uuids travel, the names show. */
  private pickerFields(): HTMLElement[] {
    const d = this.o.doc;

    // Three pickers where there were two uuid boxes. The uuid still travels
    // in the request — it is the identifier the API takes — but it is chosen
    // by name and never typed, seen or spelled out (§15).
    const esLabel = field(d, {
      label: 'সেকশন', name: 'section', kind: 'select', value: this.sectionId,
      options: this.sections.length
        ? this.sections.map((x) => ({ value: x.id, label: `${x.className.bn} — ${x.name}` }))
        : [{ value: '', label: 'কোনো সেকশন পাওয়া যায়নি' }],
      onChange: (v) => { void this.loadSection(v); },
    }).root;

    const examOptions = this.exams.flatMap((ex) =>
      ex.subjects.map((sub) => ({
        value: sub.examSubjectId, label: `${ex.nameBn} — ${sub.subject.bn}`,
      })));
    const stLabel = field(d, {
      label: 'পরীক্ষা ও বিষয়', name: 'examSubject', kind: 'select',
      value: this.examSubjectId,
      options: [{ value: '', label: examOptions.length ? 'বেছে নিন' : 'এই সেকশনে কোনো পরীক্ষা নেই' },
                ...examOptions],
      onChange: (v) => { this.examSubjectId = v; this.render(); },
    }).root;

    const stuLabel = field(d, {
      label: 'শিক্ষার্থী', name: 'student', kind: 'select', value: this.studentId,
      options: [{ value: '', label: this.roster.length ? 'বেছে নিন' : 'এই সেকশনে কোনো শিক্ষার্থী নেই' },
                ...this.roster.map((r) => ({
                  value: r.studentId,
                  // Roll first: it is how a teacher identifies a script, and
                  // how the scripts are stacked on the desk. An identifier,
                  // so Latin (R-8). An <option> cannot carry `.n`; the
                  // numeral face named first in --font-bn draws the digits.
                  label: `${formatIdentifier(r.rollNo)} · ${r.fullName.bn || r.fullName.en || '—'}`,
                }))],
      onChange: (v) => { this.studentId = v; this.render(); },
    }).root;

    return [esLabel, stLabel, stuLabel];
  }

  /**
   * One photo: the picture in a 70px well, which page it is, what happened to
   * it — in words, coloured by meaning — and its two controls.
   */
  private tile(pg: Page): HTMLElement {
    const d = this.o.doc;
    const page = bn(pg.pageNo);
    // A class, not `data-tone`: the tone is the text colour only, and the
    // words carry the meaning. "পাঠানো হয়েছে / হয়নি", not the drawn
    // "গেছে / অপেক্ষায়": a ready page is not queued — nothing sends it until
    // the teacher presses আপলোড — and a saved one means the server recorded
    // the page, which is all the answer says (its upload_state is 'pending').
    const [tone, word] =
      pg.status === 'saved'       ? ['is-ok', 'পাঠানো হয়েছে']
      : pg.status === 'uploading' ? ['is-warn', 'আপলোড হচ্ছে']
      : pg.status === 'error'     ? ['is-danger', pg.error ?? 'সমস্যা']
      : ['is-warn', 'পাঠানো হয়নি'];

    return el(d, 'li', { className: 'scripts-tile', data: { key: pg.id } },
      el(d, 'img', {
        className: 'scripts-tile-thumb',
        attrs: { src: pg.dataUrl, alt: `পৃষ্ঠা ${page}-এর ছবি`, loading: 'lazy' },
      }),
      el(d, 'div', { className: 'scripts-tile-foot' },
        el(d, 'span', { className: 'scripts-tile-name' }, ...numText(d, `পৃষ্ঠা ${page}`)),
        el(d, 'span', { className: `scripts-tile-state ${tone}` }, ...numText(d, word))),
      el(d, 'div', { className: 'scripts-tile-actions' },
        pg.status !== 'saved'
          ? button(d, {
              // After a failure the same handler is the retry, and says so.
              label: pg.status === 'error' ? 'আবার চেষ্টা করুন' : 'আপলোড',
              // Secondary, not primary: one accent per screen (R5), and this
              // control repeats in every tile.
              variant: 'secondary', size: 'sm', block: true,
              // Per-page: six buttons called "আপলোড" are six identical
              // announcements, and the pages differ only by number. The
              // visible words lead, so the name contains the label.
              ariaLabel: pg.status === 'error'
                ? `আবার চেষ্টা করুন — পৃষ্ঠা ${page} আপলোড`
                : `পৃষ্ঠা ${page} আপলোড করুন`,
              busy: pg.status === 'uploading',
              onClick: () => { void this.upload(pg); },
            })
          : null,
        button(d, {
          label: 'সরান', variant: 'ghost', size: 'sm', block: true,
          ariaLabel: `পৃষ্ঠা ${page} সরান`,
          onClick: () => { this.removePage(pg.id); },
        })));
  }
}
