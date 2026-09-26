import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DroidRuntime, createInitializeSessionParams } from './DroidRuntime.js';
import { HistoryIndex } from './history.js';

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

test('passes compaction settings when initializing a session', () => {
  const params = createInitializeSessionParams({
    cwd: '/tmp/project',
    interactionMode: 'auto',
    modelId: 'main-model',
    compactionModel: 'summary-model',
    compactionTokenLimit: 400_000,
  });

  assert.equal(params.compactionModel, 'summary-model');
  assert.equal(params.compactionTokenLimit, 400_000);
});

test('passes current-model compaction sentinel when initializing a session', () => {
  const params = createInitializeSessionParams({
    cwd: '/tmp/project',
    interactionMode: 'auto',
    modelId: 'main-model',
    compactionModel: 'current-model',
  });

  assert.equal(params.compactionModel, 'current-model');
});
