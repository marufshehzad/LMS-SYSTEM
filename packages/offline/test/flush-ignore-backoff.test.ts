/**
 * `flush({ ignoreBackoff: true })` — a person's "send now".
 *
 * Found in the browser (UX round 2, att4): on the attendance screen
 * "আবার পাঠান" called `flush()`, which only claims ops whose backoff has
 * elapsed. With the register 30 s into its wait, the press sent nothing and
 * the line went on saying "পাঠানো হচ্ছে". A person pressing retry means now.
 *
 * The option is additive: `flush()` with no argument, which every automatic
 * caller uses, behaves exactly as before.
 *
 *   node --test packages/offline/test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SyncEngine } from '../src/sync-engine.ts';
import { MemoryOutboxStore } from '../src/store.ts';
import type { OutboxOp, PushRequest, PushResponse, SyncTransport } from '../src/types.ts';

let clock = 1_760_000_000_000;
const now = () => clock;
const advance = (ms: number) => (clock += ms);
/** Always the top of the jitter range, so every backoff is a real wait. */
const late = () => 0.9;

class ScriptedTransport implements SyncTransport {
  readonly requests: PushRequest[] = [];
  handler: (req: PushRequest) => PushResponse | Promise<PushResponse>;
  constructor(handler: (req: PushRequest) => PushResponse | Promise<PushResponse>) {
    this.handler = handler;
  }
  async push(req: PushRequest): Promise<PushResponse> {
    this.requests.push(structuredClone(req));
    return this.handler(req);
  }
}

const applied = (req: PushRequest): PushResponse => ({
  serverTime: new Date(clock).toISOString(),
  results: req.ops.map((o) => ({ opId: o.opId, status: 'applied' as const, rowVersion: 1 })),
});
const offline = (): Promise<never> => Promise.reject(new TypeError('Failed to fetch'));
/** The server answers but names none of the ops: each is retried, never assumed sent. */
const silent = (): PushResponse => ({ serverTime: new Date(clock).toISOString(), results: [] });

const SCHOOL = '11111111-1111-4111-8111-111111111111';

function makeEngine(transport: SyncTransport, opts: Record<string, unknown> = {}) {
  const store = new MemoryOutboxStore();
  const engine = new SyncEngine({
    deviceId: 'dev_test', tenantId: SCHOOL, actorId: 'usr_teacher',
    store, transport, now, random: late, ...opts,
  });
  return { engine, store };
}

const register = (id: string) => ({
  entity: 'attendance_session' as const,
  opId: id,
  payload: { sessionId: id, records: [] },
});

/** One op, one failed send: it now sits in its backoff wait. */
async function waitingOp(transport: ScriptedTransport, opts: Record<string, unknown> = {}) {
  const made = makeEngine(transport, opts);
  const op = await made.engine.enqueue(register('sess_1'));
  transport.handler = offline;
  await made.engine.flush();
  const waiting = (await made.store.get(op.opId))!;
  assert.equal(waiting.status, 'pending');
  assert.ok(waiting.nextAttemptAt > now(), 'the op is inside its backoff wait');
  return { ...made, op };
}

describe('flush({ ignoreBackoff }) — "আবার পাঠান" sends now', () => {
  test('an op still in its backoff wait is sent at once', async () => {
    const t = new ScriptedTransport(offline);
    const { engine, store, op } = await waitingOp(t);
    t.handler = applied;

    await engine.flush();
    assert.equal(t.requests.length, 1, 'the automatic flush still waits out the backoff');

    const res = await engine.flush({ ignoreBackoff: true });
    assert.equal(t.requests.length, 2, 'the press sent nothing: the op was still waiting');
    assert.equal(res.acked, 1);
    assert.equal(await store.get(op.opId), undefined, 'delivered');
  });

  test('it sends only this session’s work, and leaves parked ops alone', async () => {
    const t = new ScriptedTransport(offline);
    const { engine, store } = makeEngine(t);
    const other = (opId: string, patch: Partial<OutboxOp>): OutboxOp => ({
      opId, seq: 0, deviceId: 'dev_test', tenantId: SCHOOL, actorId: 'usr_other_teacher',
      entity: 'attendance_session', operation: 'upsert', occurredAt: new Date(clock).toISOString(),
      payload: {}, status: 'pending', attempts: 3, nextAttemptAt: clock + 60_000, ...patch,
    });
    // Another teacher's register on the same phone, also waiting (B-8).
    await store.append({ ...other('op_hers', {}), seq: await store.nextSeq() });
    // This teacher's own op the engine parked: that takes retry(), not a flush.
    await store.append({
      ...other('op_parked', { actorId: 'usr_teacher', status: 'failed', nextAttemptAt: 0 }),
      seq: await store.nextSeq(),
    });
    await engine.enqueue(register('sess_mine'));
    await engine.flush();                                   // fails: sess_mine now waits too
    t.handler = applied;

    await engine.flush({ ignoreBackoff: true });
    const sent = t.requests.slice(1).flatMap((r) => r.ops.map((o) => o.opId));
    assert.deepEqual(sent, ['sess_mine']);
    const hers = (await store.get('op_hers'))!;
    assert.equal(hers.status, 'pending');
    assert.equal(hers.nextAttemptAt, clock + 60_000, 'her wait is not touched');
    assert.equal((await store.get('op_parked'))!.status, 'failed');
  });

  test('a press that fails still counts, and backs off from there', async () => {
    const t = new ScriptedTransport(offline);
    const { engine, store, op } = await waitingOp(t);
    const before = (await store.get(op.opId))!;

    await engine.flush({ ignoreBackoff: true });
    assert.equal(t.requests.length, 2, 'the press did try');
    const after = (await store.get(op.opId))!;
    assert.equal(after.status, 'pending', 'nothing is dropped');
    assert.equal(after.attempts, before.attempts + 1);
    assert.ok(after.nextAttemptAt > now(), 'the automatic retry waits again after a failed press');

    await engine.flush();
    assert.equal(t.requests.length, 2, 'and the automatic flush respects that wait');
  });

  test('one press sends each op once, even when every round comes back full', async () => {
    // batchSize 1: every round is "full", so the drain asks for another. Were
    // the press to claim past the deadline, the op it had just backed off
    // would be claimed and sent again, round after round.
    const t = new ScriptedTransport(offline);
    const { engine, store } = await waitingOp(t, { batchSize: 1 });
    await engine.enqueue(register('sess_2'));
    t.handler = silent;

    const res = await engine.flush({ ignoreBackoff: true });
    const sent = t.requests.slice(1).flatMap((r) => r.ops.map((o) => o.opId));
    assert.deepEqual(sent, ['sess_1', 'sess_2'], 'each op once, in order');
    assert.equal(res.rounds, 2);
    assert.equal((await store.byStatus('pending')).length, 2);
  });

  test('a zero-delay draw cannot make one press send the same op twice', async () => {
    // Full jitter can draw no delay at all, leaving a failed op due at once.
    const t = new ScriptedTransport(offline);
    const { engine } = await waitingOp(t, { batchSize: 1 });
    // From here every backoff is zero.
    (engine as unknown as { o: { random: () => number } }).o.random = () => 0;
    // Silent a few times, then unreachable: a press that resent the op would
    // otherwise spin forever inside one call (a press never parks it).
    t.handler = () => (t.requests.length > 4 ? offline() : silent());

    const res = await engine.flush({ ignoreBackoff: true });
    assert.equal(t.requests.length, 2, 'the same op was sent again inside one press');
    assert.equal(res.rounds, 1);
  });

  test('taps never use up the retry budget; the automatic retries still do', async () => {
    const t = new ScriptedTransport(offline);
    const { engine, store, op } = await waitingOp(t, { maxAttempts: 3 });
    // A teacher on a bad link presses "আবার পাঠান" again and again.
    for (let i = 0; i < 5; i++) await engine.flush({ ignoreBackoff: true });
    const tapped = (await store.get(op.opId))!;
    assert.equal(tapped.status, 'pending',
      'her own taps parked the register as failed, where "আবার পাঠান" cannot reach it');
    assert.equal(tapped.attempts, 6);

    // The next automatic failure past the budget parks it, as it always did.
    advance(tapped.nextAttemptAt - now() + 1);
    await engine.flush();
    const parked = (await store.get(op.opId))!;
    assert.equal(parked.status, 'failed');
  });

  test('flush() with no options is unchanged: the budget still parks an op', async () => {
    const t = new ScriptedTransport(offline);
    const { engine, store, op } = await waitingOp(t, { maxAttempts: 3, maxBackoffMs: 1000 });
    for (let i = 0; i < 4; i++) { advance(2000); await engine.flush(); }
    assert.equal((await store.get(op.opId))!.status, 'failed');
  });

  test('a press collapses into a flush already running, like any other', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const t = new ScriptedTransport(async (req) => { await gate; return applied(req); });
    const { engine } = makeEngine(t);
    await engine.enqueue(register('sess_1'));

    const running = engine.flush();
    const pressed = await engine.flush({ ignoreBackoff: true });
    assert.deepEqual(pressed, { sent: 0, acked: 0, rounds: 0 }, 'single-flight holds for a press');
    release();
    await running;
    assert.equal(t.requests.length, 1);
  });
});
