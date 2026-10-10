import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DroidRuntime, createInitializeSessionParams } from './DroidRuntime.js';
import { HistoryIndex } from './history.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';

// Answers every request the way Droid answers load_session for a session it
// will not open.
const SESSION_NOT_FOUND_DAEMON = `
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    jsonrpc: request.jsonrpc,
    factoryApiVersion: request.factoryApiVersion,
    type: 'response',
    id: request.id,
    error: { code: -32004, message: 'Session not found' },
  }) + '\\n');
});
`;

test('names the owning organization when Droid refuses a session file it has on disk', async (t) => {
  if (process.platform === 'win32') return t.skip('the fake daemon is a shebang script');
  const dir = mkdtempSync(join(tmpdir(), 'droid-runtime-org-'));
  const previous = {
    droidPath: process.env.DROID_PATH,
    historyDir: process.env.DROIDEX_HISTORY_DIR,
  };
  const daemon = join(dir, 'droid');
  writeFileSync(daemon, `#!${process.execPath}\n${SESSION_NOT_FOUND_DAEMON}`);
  chmodSync(daemon, 0o755);
  process.env.DROID_PATH = daemon;
  process.env.DROIDEX_HISTORY_DIR = join(dir, 'history');
  const sessionPath = join(dir, 'other-org.jsonl');
  writeFileSync(
    sessionPath,
    `${JSON.stringify({ type: 'session_start', id: 'other-org', organizationId: 'org-before' })}\n`,
  );
  const index = new HistoryIndex();
  try {
    index.applySessionFileReconciliation({
      previousRevision: 0,
      revision: 1,
      changed: 1,
      upserts: [
        {
          providerSessionId: 'other-org',
          path: sessionPath,
          birthtimeMs: 1,
          mtimeMs: 1,
          sizeBytes: 1,
          settingsMtimeMs: null,
          summary: null,
        },
      ],
      removedProviderSessionIds: [],
    });

    await assert.rejects(new DroidRuntime().loadSession('other-org'), /organization org-before/);
    await assert.rejects(new DroidRuntime().loadSession('not-on-disk'), {
      message: 'Session not found: not-on-disk',
    });
  } finally {
    index.close();
    for (const [key, value] of [
      ['DROID_PATH', previous.droidPath],
      ['DROIDEX_HISTORY_DIR', previous.historyDir],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('native guidance belongs to exec launch arguments on create and resume, never session requests', async (t) => {
  if (process.platform === 'win32') return t.skip('the fake daemon is a shebang script');
  const dir = mkdtempSync(join(tmpdir(), 'droid-runtime-guidance-'));
  const daemon = join(dir, 'droid');
  const capture = join(dir, 'requests.jsonl');
  const previousDroidPath = process.env.DROID_PATH;
  const guidance = 'Internal Design context for this process only.';
  writeFileSync(
    daemon,
    `#!${process.execPath}\n` +
      SESSION_NOT_FOUND_DAEMON.replace(
        'const request = JSON.parse(line);',
        `const request = JSON.parse(line);
require('node:fs').appendFileSync(${JSON.stringify(capture)}, JSON.stringify({
  args: process.argv.slice(2), request,
}) + '\\n');`,
      ),
  );
  chmodSync(daemon, 0o755);
  process.env.DROID_PATH = daemon;
  try {
    const runtime = new DroidRuntime();
    await assert.rejects(
      runtime.createSession({
        cwd: dir,
        interactionMode: 'auto',
        systemPromptAppend: guidance,
      }),
      /Session not found/,
    );
    await assert.rejects(
      runtime.loadSession('design-session', { cwd: dir, systemPromptAppend: guidance }),
      /Session not found/,
    );
    const captured = readFileSync(capture, 'utf8').trim().split('\n');
    assert.equal(captured.length, 2);
    for (const raw of captured) {
      const entry = JSON.parse(raw) as { args: string[]; request: Record<string, unknown> };
      assert.deepEqual(entry.args.slice(0, 3), ['exec', '--append-system-prompt', guidance]);
      assert.equal(JSON.stringify(entry.request).includes(guidance), false);
    }
  } finally {
    if (previousDroidPath === undefined) delete process.env.DROID_PATH;
    else process.env.DROID_PATH = previousDroidPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passes compaction settings, including the current-model sentinel, when initializing a session', () => {
  const params = createInitializeSessionParams({
    cwd: '/tmp/project',
    interactionMode: 'auto',
    modelId: 'main-model',
    compactionModel: 'summary-model',
    compactionTokenLimit: 400_000,
  });

  assert.equal(params.compactionModel, 'summary-model');
  assert.equal(params.compactionTokenLimit, 400_000);

  const sentinel = createInitializeSessionParams({
    cwd: '/tmp/project',
    interactionMode: 'auto',
    modelId: 'main-model',
    compactionModel: 'current-model',
  });
  assert.equal(sentinel.compactionModel, 'current-model');
});

test('edits-only uses native Off so commands still reach the permission callback', () => {
  for (const [autonomyLevel, expected] of [
    ['off', 'off'],
    ['low', 'off'],
    ['medium', 'medium'],
    ['high', 'high'],
  ] as const) {
    const params = createInitializeSessionParams({
      cwd: '/tmp/project',
      interactionMode: 'auto',
      autonomyLevel,
    });
    assert.equal(params.autonomyLevel, expected);
  }
});

test('readContextBreakdown tries the public seam, then the private RPC, best effort', async () => {
  const session = new FakeFactorySession('backend', {}, []);
  const runtime = new DroidRuntime();
  Reflect.set(session, 'getContextBreakdown', () => Promise.resolve({ usedTokens: 10 }));
  assert.deepEqual(await runtime.readContextBreakdown(session), { usedTokens: 10 });

  Reflect.deleteProperty(session, 'getContextBreakdown');
  let rpcMethod = '';
  Reflect.set(session, '_client', {
    _sessionRpcWithoutParams: (method: string) => {
      rpcMethod = method;
      return Promise.resolve({ freeTokens: 90 });
    },
  });
  assert.deepEqual(await runtime.readContextBreakdown(session), { freeTokens: 90 });
  assert.equal(rpcMethod, 'droid.get_context_breakdown');

  Reflect.set(session, '_client', {
    _sessionRpcWithoutParams: () => Promise.reject(new Error('transport closed')),
  });
  assert.equal(await runtime.readContextBreakdown(session), undefined);
});
