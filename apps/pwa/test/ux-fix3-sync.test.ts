/**
 * UX sweep, round 3 — the attendance sync line (group sync).
 *
 *   1  "আবার পাঠান" did nothing while the register waited out its backoff
 *      (recheck2 att4): the press called `outbox.flush()`, which skips every op
 *      whose `nextAttemptAt` has not passed. With the op 30 s into its wait the
 *      press sent nothing, the line went on saying "পাঠানো হচ্ছে", and 32 s
 *      later it was still unsent. A press now asks the engine for
 *      `flush({ ignoreBackoff: true })` (packages/offline, tested there too).
 *      These tests drive the REAL engine over an in-memory store, because the
 *      defect lived between the button and the engine's claim.
 *
 *   2  The sync line blinked inside its aria-live region (recheck2
 *      att2-captive): on reconnect it was removed while the push was in
 *      flight and drawn again when the push failed, so a screen reader could
 *      read it twice. Two causes: every status paint emptied the strip and
 *      rebuilt it, and an op in flight (`inflight`, not `pending`) counted as
 *      nothing waiting. The line is now changed in place, and only in the
 *      words that really changed.
 */
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="root"></main></body></html>',
  { url: 'http://localhost/app' });
before(() => {
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = dom.window.HTMLElement;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.CSS = dom.window.CSS;
  g.document = dom.window.document;
  for (const key of ['localStorage', 'location', 'navigator'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  g.addEventListener = dom.window.addEventListener.bind(dom.window);
  g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
});

const { AttendanceScreen } = await import('../src/attendance-screen.ts');
const { closeAllOverlays } = await import('../src/ui/index.ts');
const { SyncEngine } = await import('../../../packages/offline/src/sync-engine.ts');
const { MemoryOutboxStore } = await import('../../../packages/offline/src/store.ts');
type PushRequest = import('../../../packages/offline/src/types.ts').PushRequest;
type PushResponse = import('../../../packages/offline/src/types.ts').PushResponse;

const doc = dom.window.document;
const host = () => doc.getElementById('root') as HTMLElement;
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};
const click = (node: Element) =>
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

function setOnline(on: boolean): void {
  Object.defineProperty(dom.window.navigator, 'onLine', { value: on, configurable: true });
}
/** The browser's connectivity event; the screen listens on the window. */
function connectivity(on: boolean): void {
  setOnline(on);
  dom.window.dispatchEvent(new dom.window.Event(on ? 'online' : 'offline'));
}
/** What shell.ts autoFlush dispatches after a flush attempt or a progress report. */
function report(pending: number, inflight = 0): void {
  doc.dispatchEvent(new dom.window.CustomEvent('shikhon:outbox', { detail: { pending, inflight } }));
}

let screens: Array<{ destroy(): void }> = [];
beforeEach(() => {
  host().textContent = '';
  localStorage.clear();
  setOnline(true);
});
afterEach(() => {
  for (const s of screens) s.destroy();
  screens = [];
  closeAllOverlays();
  for (const s of doc.querySelectorAll('.ui-scrim')) s.remove();
  for (const s of doc.querySelectorAll('.ui-toast-host')) s.textContent = '';
});

const SECTIONS = [
  { id: 's1', name: 'ক', shift: 'morning', studentCount: 2,
    className: { bn: 'নবম শ্রেণি', en: 'Class 9' }, levelNo: 9, academicYearId: 'y1' },
];
const ROSTER = [
  { studentId: 'a1', rollNo: 1, fullName: { bn: 'আনিকা রহমান', en: 'Anika' }, phone: null },
  { studentId: 'a2', rollNo: 2, fullName: { bn: 'আরিফ হোসেন', en: 'Arif' }, phone: null },
];
const auth = {
  async authedFetch(path: string): Promise<Response> {
    const body = path.startsWith('/api/v1/academics/sections') ? { sections: SECTIONS } : { roster: ROSTER };
    return { ok: true, status: 200, json: async () => body } as Response;
  },
};

async function mount(outbox: unknown) {
  const screen = new AttendanceScreen({
    root: host(), doc, auth: auth as never, outbox: outbox as never,
    newId: () => 'session-1', takenOn: '2026-09-17', now: () => 1_760_000_000_000,
  });
  screens.push(screen);
  await settle();
  return screen;
}
const statusStrip = () => host().querySelector<HTMLElement>('.att-status')!;
const syncLine = () => host().querySelector<HTMLElement>('.att-sync-line');
const syncText = () => syncLine()?.querySelector<HTMLElement>('.att-sync-text') ?? null;
const offlineNote = () => host().querySelector<HTMLElement>('.att-offline-note');
const retryButton = () => syncLine()?.querySelector<HTMLButtonElement>('button') ?? null;
const act = (action: string) => doc.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
const savedText = () => host().querySelector<HTMLElement>('.att-saved-text');

/* ── 1: the real engine behind the button ───────────────────────────────── */

const clock = 1_760_000_000_000;

/** A SyncEngine over memory, whose sends fail until `t.up` is set. */
function realOutbox() {
  const t = {
    up: false,
    requests: [] as PushRequest[],
    async push(req: PushRequest): Promise<PushResponse> {
      t.requests.push(structuredClone(req));
      if (!t.up) throw new TypeError('Failed to fetch');
      return {
        serverTime: new Date(clock).toISOString(),
        results: req.ops.map((o) => ({ opId: o.opId, status: 'applied' as const, rowVersion: 1 })),
      };
    },
  };
  const store = new MemoryOutboxStore();
  const engine = new SyncEngine({
    deviceId: 'dev', tenantId: 'demo', actorId: 'usr_teacher', store, transport: t,
    // A fixed clock and the top of the jitter range: the failed send's backoff
    // is a real wait, and nothing lets it pass by itself.
    now: () => clock, random: () => 0.9,
  });
  return { engine, store, t };
}

/** Mark everyone, open the confirm sheet, and submit. */
async function submitRegister(): Promise<void> {
  click(act('mark-all')!);
  click(act('review')!);
  click(doc.querySelector('.att-confirm [data-action="save"]')!);
  await settle();
}

describe('1 — "আবার পাঠান" sends a register that is waiting out its backoff', () => {
  test('the press sends it now, the line clears and the footer says it arrived', async () => {
    const { engine, store, t } = realOutbox();
    await mount(engine);
    await submitRegister();                    // its own send fails on a dead link
    assert.equal(t.requests.length, 1);
    const [op] = await store.all();
    assert.ok(op && op.status === 'pending' && op.nextAttemptAt > clock,
      'the register is queued and waiting out a backoff');
    assert.match(syncLine()?.textContent ?? '', /১টি অপেক্ষমাণ/);
    assert.match(syncLine()?.textContent ?? '', /পাঠানো হচ্ছে/);

    t.up = true;                               // the link is back; the backoff is not over
    click(retryButton()!);
    await settle();

    assert.equal(t.requests.length, 2,
      'the press sent nothing: flush() skipped the op still inside its backoff');
    assert.deepEqual(await store.all(), [], 'the register left the device');
    assert.equal(syncLine(), null, '"পাঠানো হচ্ছে" stayed over a register nobody was sending');
    assert.match(savedText()?.textContent ?? '', /^হাজিরা জমা হয়েছে/);
  });

  test('offline, a press does not spend an attempt that would lengthen the wait after reconnecting', async () => {
    const { engine, store, t } = realOutbox();
    await mount(engine);
    await submitRegister();
    const [before] = await store.all();
    connectivity(false);
    await settle();

    click(retryButton()!);
    await settle();
    assert.equal(t.requests.length, 1, 'offline, the press tried the dead link anyway');
    const [after] = await store.all();
    assert.equal(after.attempts, before.attempts);
    assert.equal(after.nextAttemptAt, before.nextAttemptAt);
    assert.match(doc.querySelector('.ui-toast-host')?.textContent ?? '', /ইন্টারনেট নেই/,
      'the press still says what happened');
  });
});

/* ── 2: the line in its live region ─────────────────────────────────────── */

/** A queue the test steers: the counts the engine would report right now. */
function steeredQueue(init: Partial<{ pending: number; inflight: number; failed: number }> = {}) {
  const q = {
    pending: init.pending ?? 0,
    inflight: init.inflight ?? 0,
    failed: init.failed ?? 0,
    flushes: [] as unknown[],
    async enqueue(input: { opId?: string }) { q.pending++; return { opId: input.opId ?? 'op' }; },
    async flush(options?: unknown) { q.flushes.push(options); return undefined; },
    async state() { return { pending: q.pending, inflight: q.inflight, failed: q.failed, conflicts: 0 }; },
  };
  return q;
}

/** Every change made inside the status strip (an aria-live region). */
function watch(node: HTMLElement) {
  const seen: MutationRecord[] = [];
  const mo = new dom.window.MutationObserver((records: MutationRecord[]) => { seen.push(...records); });
  mo.observe(node, { childList: true, subtree: true, characterData: true, attributes: true });
  return {
    take(): MutationRecord[] { seen.push(...mo.takeRecords()); return seen.splice(0); },
    stop() { mo.disconnect(); },
  };
}
const removed = (records: MutationRecord[], node: Node | null) =>
  !!node && records.some((r) => [...r.removedNodes].some((n) => n === node || n.contains(node)));

describe('2 — the sync line changes in place, and only when what it says changes', () => {
  test('reconnect, a push in flight, then the push fails: the line is never taken out and put back', async () => {
    connectivity(false);
    const q = steeredQueue({ pending: 1 });
    await mount(q);
    const line = syncLine()!;
    const button = retryButton()!;
    assert.match(line.textContent ?? '', /সংযোগ পেলে পাঠানো হবে/);
    const w = watch(statusStrip());

    // Back online. The shell's reconnect flush claims the op: it is in flight.
    q.pending = 0;
    q.inflight = 1;
    connectivity(true);
    await settle();
    let records = w.take();
    assert.equal(syncLine(), line, 'the line was rebuilt on reconnect');
    assert.ok(line.isConnected);
    assert.ok(!removed(records, line),
      'the line left the live region while the push was in flight');
    assert.equal(retryButton(), button, '"আবার পাঠান" was replaced under the person');
    assert.match(line.textContent ?? '', /১টি অপেক্ষমাণ/, 'an op being sent has not arrived');
    assert.match(syncText()?.textContent ?? '', /পাঠানো হচ্ছে/, 'online, the words say it is being sent');
    assert.equal(offlineNote(), null, 'the offline note went with the connection');

    // The push fails: the op is pending again. Nothing the line says changed.
    q.inflight = 0;
    q.pending = 1;
    report(1);
    await settle();
    records = w.take();
    assert.equal(syncLine(), line);
    assert.deepEqual(records.map((r) => r.type), [],
      'a failed push changed nothing the line says, and the live region was written anyway');
    w.stop();
  });

  test('a queue with only an op in flight still shows its line', async () => {
    await mount(steeredQueue({ inflight: 1 }));
    assert.match(syncLine()?.textContent ?? '', /১টি অপেক্ষমাণ/,
      'the line said nothing was waiting while the register was on its way');
  });

  test('a change of count replaces the badge only; the words and the button stay', async () => {
    const q = steeredQueue({ pending: 2 });
    await mount(q);
    const line = syncLine()!;
    const words = syncText()!;
    const button = retryButton()!;
    const w = watch(statusStrip());

    q.pending = 1;
    report(1);
    await settle();
    const records = w.take();
    assert.equal(syncLine(), line);
    assert.match(line.textContent ?? '', /১টি অপেক্ষমাণ/);
    assert.equal(syncText(), words);
    assert.ok(!records.some((r) => r.target === words || words.contains(r.target)),
      'the unchanged sentence was written again');
    assert.equal(retryButton(), button);

    // Refused: a real change of state, still in place.
    q.pending = 0;
    q.failed = 1;
    report(0);
    await settle();
    assert.equal(syncLine(), line);
    assert.equal(line.dataset.state, 'failed');
    assert.match(line.textContent ?? '', /১টি পাঠানো যায়নি/);
    assert.match(syncText()?.textContent ?? '', /নিরাপদ আছে/);
    assert.doesNotMatch(line.textContent ?? '', /অপেক্ষমাণ/);
    assert.equal(retryButton(), button);
    w.stop();
  });

  test('offline, a press repaints nothing that did not change', async () => {
    connectivity(false);
    const q = steeredQueue({ pending: 1 });
    await mount(q);
    const note = offlineNote()!;
    const line = syncLine()!;
    const w = watch(statusStrip());

    click(retryButton()!);
    await settle();
    const records = w.take();
    assert.equal(offlineNote(), note);
    assert.equal(syncLine(), line);
    assert.ok(!removed(records, note) && !removed(records, line),
      'the strip was emptied and filled again, so both were read out a second time');
    assert.deepEqual(records.map((r) => r.type), []);
    assert.deepEqual(q.flushes, [undefined], 'offline the press is the plain flush');
    w.stop();
  });

  test('online, the press asks to send now', async () => {
    const q = steeredQueue({ pending: 1 });
    await mount(q);
    click(retryButton()!);
    await settle();
    assert.deepEqual(q.flushes, [{ ignoreBackoff: true }]);
  });

  test('going offline adds the note once; coming back removes it', async () => {
    const q = steeredQueue({ pending: 1 });
    await mount(q);
    assert.equal(offlineNote(), null);
    connectivity(false);
    await settle();
    const note = offlineNote()!;
    assert.ok(note);
    assert.equal(statusStrip().firstElementChild, note, 'the note still leads the strip');
    report(1);
    connectivity(false);                       // a second offline event, nothing new
    await settle();
    assert.equal(offlineNote(), note);
    assert.equal(statusStrip().querySelectorAll('.att-offline-note').length, 1);
    connectivity(true);
    await settle();
    assert.equal(offlineNote(), null);
  });
});
