import assert from 'node:assert/strict';
import test from 'node:test';
import { PREVIEW_POLL_SCRIPT, PREVIEW_STARTED } from './previewDocument';
import {
  PREVIEW_POLL_DEADLINE_MS,
  PREVIEW_POLL_INTERVAL_MS,
  PREVIEW_READY_DEADLINE_MS,
  startPreview,
  type PreviewClock,
  type PreviewLostReason,
} from './previewRuntime';
import type { CanvasDiagnostic } from './protocol';

/** Timers a test fires itself; nothing here waits on wall-clock time. */
function createClock() {
  const timers = new Map<number, { task: () => void; delayMs: number }>();
  let next = 0;
  const clock: PreviewClock = {
    schedule(task, delayMs) {
      const id = (next += 1);
      timers.set(id, { task, delayMs });
      return () => timers.delete(id);
    },
  };
  return {
    clock,
    pending: () => [...timers.values()].map((timer) => timer.delayMs),
    /** Fires the one pending timer set for this delay. */
    fire(delayMs: number) {
      const entry = [...timers].find(([, timer]) => timer.delayMs === delayMs);
      assert.ok(entry, `No timer pending for ${String(delayMs)} ms`);
      timers.delete(entry[0]);
      entry[1].task();
    },
  };
}

/** A webview whose every call is a promise this test settles. */
function createGuest(webContentsId = 42) {
  const calls: { code: string; settle: (value: unknown) => void; fail: () => void }[] = [];
  return {
    calls,
    guest: {
      getWebContentsId: () => webContentsId,
      executeJavaScript: (code: string) =>
        new Promise<unknown>((resolve, reject) => {
          calls.push({ code, settle: resolve, fail: () => reject(new Error('guest gone')) });
        }),
    },
  };
}

function createObserver() {
  const seen = {
    ready: 0,
    sizes: [] as { width: number; height: number }[],
    diagnostics: [] as CanvasDiagnostic[],
    lost: [] as PreviewLostReason[],
  };
  return {
    seen,
    observer: {
      onReady: () => (seen.ready += 1),
      onResize: (size: { width: number; height: number }) => seen.sizes.push(size),
      onDiagnostics: (entries: CanvasDiagnostic[]) => seen.diagnostics.push(...entries),
      onLost: (reason: PreviewLostReason) => seen.lost.push(reason),
    },
  };
}

interface RunOptions {
  webContentsId?: number;
  terminate?: (guestId: number) => Promise<unknown>;
}

function run(options: RunOptions = {}) {
  const terminated: number[] = [];
  const clock = createClock();
  const { guest, calls } = createGuest(options.webContentsId);
  const { observer, seen } = createObserver();
  const preview = startPreview({
    guest,
    designId: 'dsg_hey',
    revisionId: 'rev_02',
    generation: 3,
    html: '<!doctype html><body>Hey</body>',
    observer,
    clock: clock.clock,
    terminate:
      options.terminate ??
      ((guestId) => {
        terminated.push(guestId);
        return Promise.resolve(true);
      }),
  });
  return { preview, clock, calls, seen, terminated };
}

/** The identity the guest echoes back, as `start` was given it. */
function snapshot(events: unknown[], dropped = 0, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    nonce: '',
    designId: 'dsg_hey',
    revisionId: 'rev_02',
    generation: 3,
    events,
    dropped,
    ...overrides,
  });
}

/** Starts the run and answers its start call, returning the minted nonce. */
async function started(session: ReturnType<typeof run>): Promise<string> {
  const [start] = session.calls;
  const nonce = /"nonce":"([0-9a-f]{32})"/.exec(start.code)?.[1];
  assert.ok(nonce, 'the start script carries a hex nonce');
  start.settle(PREVIEW_STARTED);
  await Promise.resolve();
  await Promise.resolve();
  return nonce;
}

test('the start script carries the artifact and the identity as data, not code', () => {
  const session = run();

  const [start] = session.calls;
  const call = 'globalThis.__droidexCanvasPreview.start(';
  assert.ok(start.code.startsWith(call) && start.code.endsWith(')'));
  // Escaping `<` means no artifact can close an element wherever this is placed,
  // and the argument still decodes back to exactly what the compiler produced.
  assert.equal(start.code.includes('<'), false);
  const payload = JSON.parse(start.code.slice(call.length, -1)) as Record<string, unknown>;
  assert.deepEqual(payload, {
    nonce: payload.nonce,
    designId: 'dsg_hey',
    revisionId: 'rev_02',
    generation: 3,
    html: '<!doctype html><body>Hey</body>',
  });
  assert.match(String(payload.nonce), /^[0-9a-f]{32}$/);
  assert.deepEqual(session.clock.pending(), [PREVIEW_READY_DEADLINE_MS]);
});

test('a started guest is polled one call at a time on a bounded cadence', async () => {
  const session = run();
  const nonce = await started(session);

  assert.equal(session.calls.length, 2);
  assert.equal(session.calls[1].code, PREVIEW_POLL_SCRIPT);
  session.calls[1].settle(snapshot([{ event: 'ready' }], 0, { nonce }));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(session.seen.ready, 1);
  // Readiness released its deadline, and the next poll waits out the cadence.
  assert.deepEqual(session.clock.pending(), [PREVIEW_POLL_INTERVAL_MS]);
  assert.equal(session.calls.length, 2);
  session.clock.fire(PREVIEW_POLL_INTERVAL_MS);
  assert.equal(session.calls.length, 3);
  assert.deepEqual(session.clock.pending(), [PREVIEW_POLL_DEADLINE_MS]);
});

test('bounded events reach the board and a flood is reported as dropped', async () => {
  const session = run();
  const nonce = await started(session);

  session.calls[1].settle(
    snapshot(
      [
        { event: 'resize', width: 640, height: 480 },
        { event: 'diagnostics', diagnostics: [{ code: 'preview_error', message: 'Boom' }] },
        { event: 'selection', elementId: 'el_1', instancePath: '0/1' },
      ],
      7,
      { nonce },
    ),
  );
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(session.seen.sizes, [{ width: 640, height: 480 }]);
  assert.deepEqual(
    session.seen.diagnostics.map((entry) => entry.code),
    ['preview_flooded', 'preview_error'],
  );
  assert.match(session.seen.diagnostics[0].message, /7 were dropped/);
  assert.deepEqual(session.seen.lost, []);
});

test('a poll that misses its deadline has main end the guest', async () => {
  const session = run({ webContentsId: 11 });
  await started(session);

  session.clock.fire(PREVIEW_POLL_DEADLINE_MS);

  assert.deepEqual(session.seen.lost, ['poll_timeout']);
  assert.deepEqual(session.terminated, [11]);
  assert.deepEqual(session.clock.pending(), []);
  // The wedged call eventually answers and reaches nothing.
  session.calls[1].settle(snapshot([{ event: 'ready' }]));
  await Promise.resolve();
  assert.equal(session.seen.ready, 0);
});

test('a design that never reports ready has main end the guest', async () => {
  const session = run({ webContentsId: 12 });
  const nonce = await started(session);
  session.calls[1].settle(snapshot([{ event: 'resize', width: 10, height: 10 }], 0, { nonce }));
  await Promise.resolve();
  await Promise.resolve();

  session.clock.fire(PREVIEW_READY_DEADLINE_MS);

  assert.deepEqual(session.seen.lost, ['not_ready']);
  assert.deepEqual(session.terminated, [12]);
});

test('a refused start ends the guest without polling it', async () => {
  const session = run();

  session.calls[0].settle('invalid_request');
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(session.seen.lost, ['guest_gone']);
  assert.equal(session.calls.length, 1);
});

test('a guest that cannot be reached is lost rather than retried', async () => {
  const session = run();
  await started(session);

  session.calls[1].fail();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(session.seen.lost, ['guest_gone']);
  assert.deepEqual(session.clock.pending(), []);
});

test("a snapshot from another instance never reaches this board's frame", async () => {
  const session = run();
  await started(session);

  // The right revision under a later generation: a replacement's guest.
  session.calls[1].settle(snapshot([{ event: 'ready' }], 0, { generation: 4 }));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(session.seen.ready, 0);
  assert.deepEqual(session.seen.lost, ['guest_gone']);
});

test('stopping releases every timer and silences a late answer', async () => {
  const session = run();
  const nonce = await started(session);

  session.preview.stop();
  session.preview.stop();
  session.calls[1].settle(snapshot([{ event: 'ready' }], 0, { nonce }));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(session.clock.pending(), []);
  assert.equal(session.seen.ready, 0);
  assert.deepEqual(session.seen.lost, []);
  assert.deepEqual(session.terminated, []);
});

test('a guest that was never attached is lost before anything is run on it', () => {
  const { observer, seen } = createObserver();
  const clock = createClock();
  let asked = 0;

  const preview = startPreview({
    guest: {
      getWebContentsId: () => {
        throw new Error('not attached');
      },
      executeJavaScript: () => {
        asked += 1;
        return Promise.resolve(PREVIEW_STARTED);
      },
    },
    designId: 'dsg_hey',
    revisionId: 'rev_02',
    generation: 1,
    html: '<body></body>',
    observer,
    clock: clock.clock,
    terminate: () => Promise.resolve(true),
  });
  preview.stop();

  assert.deepEqual(seen.lost, ['guest_gone']);
  assert.equal(asked, 0);
  assert.deepEqual(clock.pending(), []);
});
