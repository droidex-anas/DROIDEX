import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  sessionIdFromSessionFileName,
  startSessionFileWatcher,
  type SessionFileChange,
  type SessionFileWatcherOptions,
} from './sessionFileWatcher.js';

function controlledSessionWatch(): {
  watchDirectory: (
    root: string,
    onChange: (filename: string | null) => void,
  ) => { onError: (listener: (error: unknown) => void) => void; close: () => void };
  emit: (filename: string | null) => void;
} {
  let onChange: ((filename: string | null) => void) | undefined;
  return {
    watchDirectory: (_root, listener) => {
      onChange = listener;
      return {
        onError: () => {},
        close: () => {},
      };
    },
    emit: (filename) => {
      if (!onChange) throw new Error('Controlled session watch has not started');
      onChange(filename);
    },
  };
}

function manualClock(): {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  cancel: (timer: NodeJS.Timeout) => void;
  advance: (ms: number) => void;
  pendingTimers: () => number;
} {
  let currentMs = 0;
  const timers = new Map<number, { dueAt: number; callback: () => void }>();
  let nextId = 0;
  return {
    now: () => currentMs,
    schedule: (callback, delayMs) => {
      nextId += 1;
      timers.set(nextId, { dueAt: currentMs + delayMs, callback });
      return nextId as unknown as NodeJS.Timeout;
    },
    cancel: (timer) => {
      timers.delete(timer as unknown as number);
    },
    advance: (ms) => {
      const targetMs = currentMs + ms;
      for (;;) {
        const due = [...timers].filter(([, entry]) => entry.dueAt <= targetMs);
        if (due.length === 0) break;
        due.sort((left, right) => left[1].dueAt - right[1].dueAt);
        const [id, entry] = due[0];
        timers.delete(id);
        currentMs = entry.dueAt;
        entry.callback();
      }
      currentMs = targetMs;
    },
    pendingTimers: () => timers.size,
  };
}

/**
 * A watcher over a scratch sessions root with one encoded-cwd folder, fed by a
 * controlled watch and closed when the test ends.
 */
function watch(t: TestContext, options: Partial<SessionFileWatcherOptions> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'session-watcher-'));
  const dir = join(root, 'encoded-cwd');
  mkdirSync(dir);
  const payloads: (SessionFileChange[] | null)[] = [];
  const controlledWatch = controlledSessionWatch();
  const watcher = startSessionFileWatcher(
    {
      root,
      batchWindowMs: 0,
      onExternalChange: (changes) => {
        payloads.push(changes);
      },
      ...options,
    },
    controlledWatch.watchDirectory,
  );
  assert.ok(watcher);
  t.after(() => {
    watcher.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { dir, payloads, emit: controlledWatch.emit, watcher };
}

test('sessionIdFromSessionFileName extracts the provider session id', () => {
  assert.equal(sessionIdFromSessionFileName('encoded-cwd/dir/abc-123.jsonl'), 'abc-123');
  assert.equal(sessionIdFromSessionFileName('abc-123.jsonl'), 'abc-123');
  assert.equal(sessionIdFromSessionFileName('encoded-cwd\\dir\\abc-123.jsonl'), 'abc-123');
  assert.equal(sessionIdFromSessionFileName('encoded-cwd-dir'), undefined);
  assert.equal(sessionIdFromSessionFileName('notes.txt'), undefined);
  assert.equal(sessionIdFromSessionFileName(null), undefined);
});

test('external session and settings file changes fire once with their session files, until close', (t) => {
  const clock = manualClock();
  const { dir, payloads, emit, watcher } = watch(t, {
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  emit('encoded-cwd/a.jsonl');
  emit('encoded-cwd/b.jsonl');
  // A settings sidecar reports the session file beside it.
  emit('encoded-cwd/c.settings.json');
  clock.advance(50);
  assert.equal(payloads.length, 1, 'a burst of changes coalesces into one callback');
  const changes = payloads[0];
  assert.ok(changes, 'file events explained by the batch reconcile exactly those files');
  assert.deepEqual(
    new Set(changes.map((change) => change.providerSessionId)),
    new Set(['a', 'b', 'c']),
  );
  for (const change of changes) {
    assert.equal(change.path, join(dir, `${change.providerSessionId}.jsonl`));
  }

  watcher.close();
  emit('encoded-cwd/d.jsonl');
  clock.advance(50);
  assert.equal(payloads.length, 1, 'close stops further callbacks');
});

test('a subagent writing its own session file is reported while it keeps writing', (t) => {
  const clock = manualClock();
  const { dir, payloads, emit } = watch(t, {
    batchWindowMs: 1_500,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  const subagent = [{ providerSessionId: 'subagent', path: join(dir, 'subagent.jsonl') }];
  // A spawned subagent creates its session file and then writes to it for as
  // long as it works.
  emit('encoded-cwd/subagent.jsonl');
  clock.advance(50);
  assert.deepEqual(payloads, [subagent], 'a file nobody has reported yet is not made to wait');

  for (let elapsed = 0; elapsed < 1_500; elapsed += 100) {
    emit('encoded-cwd/subagent.jsonl');
    clock.advance(100);
  }
  assert.deepEqual(payloads, [subagent, subagent], 'later writes report once per batch window');
});

test('live session writes neither delay an external batch nor arm a timer', (t) => {
  const clock = manualClock();
  const { dir, payloads, emit, watcher } = watch(t, {
    batchWindowMs: 1_500,
    isLiveSession: (id) => id === 'live-1',
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  for (let elapsed = 0; elapsed < 5_000; elapsed += 100) {
    emit('encoded-cwd/live-1.jsonl');
    clock.advance(100);
  }
  assert.equal(clock.pendingTimers(), 0, 'a live session streaming alone schedules no work');
  assert.equal(payloads.length, 0);

  emit('encoded-cwd/external-1.jsonl');
  for (let elapsed = 0; elapsed < 1_500; elapsed += 100) {
    emit('encoded-cwd/live-1.jsonl');
    clock.advance(100);
  }
  assert.deepEqual(
    payloads,
    [[{ providerSessionId: 'external-1', path: join(dir, 'external-1.jsonl') }]],
    'the live stream neither delayed nor duplicated the external report',
  );
  assert.equal(
    watcher.consumeLiveSessionFile('live-1'),
    join(dir, 'live-1.jsonl'),
    'live paths are still retained for targeted close reconciliation',
  );
  assert.equal(
    watcher.consumeLiveSessionFile('live-1'),
    undefined,
    'consuming a live file path forgets it',
  );
});

test('a missing sessions root is created, and an unwatchable one returns null', () => {
  // A merely-missing root is created so live republish starts on a first run
  // with no history yet.
  const root = join(tmpdir(), 'session-watcher-first-run-', String(Date.now()), 'sessions');
  const watcher = startSessionFileWatcher({ root, batchWindowMs: 50, onExternalChange: () => {} });
  try {
    assert.ok(watcher, 'the watcher starts even when the root did not exist');
    assert.ok(existsSync(root), 'the missing sessions root is created');
  } finally {
    watcher?.close();
    rmSync(root, { recursive: true, force: true });
  }

  // A path whose parent is a regular file cannot be created or watched.
  const blocker = join(tmpdir(), 'session-watcher-blocker');
  writeFileSync(blocker, '');
  try {
    assert.equal(
      startSessionFileWatcher({ root: join(blocker, 'sessions'), onExternalChange: () => {} }),
      null,
    );
  } finally {
    rmSync(blocker, { force: true });
  }
});
