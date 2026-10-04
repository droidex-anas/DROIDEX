import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionSummary } from './protocol.js';
import { persistTestEvent, persistTestSummaries } from './testing/historyPersistenceFixture.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

const originalHome = process.env.HOME;
const home = mkdtempSync(join(tmpdir(), 'droid-history-home-'));
process.env.HOME = home;

const { HistoryIndex } = await import('./history.js');

test.after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function summary(appSessionId: string, cwd: string): SessionSummary {
  const now = Date.now();
  return sessionSummary({
    appSessionId,
    title: 'Plain chat',
    cwd,
    workspaceKind: cwd ? 'folder' : 'none',
    createdAt: now,
    updatedAt: now,
  });
}

test('summaryPatchesAndHidden derives patches and hidden ids from one read', () => {
  const cwd = join(home, 'workspace-combined-read');
  const index = new HistoryIndex();
  persistTestSummaries([
    {
      ...summary('app-1', cwd),
      providerSessionId: 'cur-1',
      compactedFromProviderSessionIds: ['old-1'],
      tokensIn: 20,
      contextTokens: 800,
    },
  ]);
  for (let i = 0; i < 2; i++) {
    persistTestEvent({
      id: `compaction-app-1-${String(i)}`,
      appSessionId: 'app-1',
      sourceSessionId: 'app-1',
      role: 'primary',
      kind: 'compaction',
      ts: i,
    });
  }
  try {
    const { patches, hiddenProviderSessionIds } = index.summaryPatchesAndHidden();
    assert.equal(patches.get('app-1')?.providerSessionId, 'cur-1');
    assert.equal(patches.get('cur-1')?.tokensIn, 20);
    assert.equal(patches.get('cur-1')?.contextTokens, 800);
    assert.equal(patches.get('app-1')?.autoCompactions, 2);
    assert.deepEqual([...hiddenProviderSessionIds], ['old-1']);
  } finally {
    index.close();
  }
});

test('chat preferences survive canonical history writes and explicit-off overwrites', () => {
  const stored: SessionSummary = {
    ...summary('preferences-chat', join(home, 'workspace-preferences')),
    provider: 'claude',
    fastMode: true,
    contextWindowTokens: 1000000,
  };
  const index = new HistoryIndex();
  try {
    persistTestSummaries([stored]);
    const first = index.summaryPatchesAndHidden().patches.get('preferences-chat');
    assert.equal(first?.fastMode, true);
    assert.equal(first?.contextWindowTokens, 1000000);
    // Explicit off is a stored choice, not an absent one.
    persistTestSummaries([{ ...stored, fastMode: false, contextWindowTokens: 200000 }]);
    const second = index.summaryPatchesAndHidden().patches.get('preferences-chat');
    assert.equal(second?.fastMode, false);
    assert.equal(second?.contextWindowTokens, 200000);
  } finally {
    index.close();
  }
});
