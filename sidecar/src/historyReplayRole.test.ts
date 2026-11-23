import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionRole } from '@droidex/protocol';

const originalHome = process.env.HOME;
const home = mkdtempSync(join(tmpdir(), 'droid-history-role-'));
process.env.HOME = home;

const { HistoryIndex, loadSessionTranscriptWindow } = await import('./history.js');
const index = new HistoryIndex();
let sessionFileRevision = 0;

test.after(() => {
  index.close();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function writeTranscript(
  id: string,
  start: Record<string, unknown>,
  messages: Record<string, unknown>[] = [
    {
      type: 'message',
      id: 'm1',
      timestamp: '2026-06-12T00:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello from worker' }] },
    },
  ],
): void {
  const dir = join(home, '.factory', 'sessions', '2026', '06');
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'session_start', cwd: home, sessionTitle: 'S', ...start }),
    ...messages.map((message) => JSON.stringify(message)),
  ];
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  const stat = statSync(path);
  const previousRevision = sessionFileRevision;
  sessionFileRevision += 1;
  assert.equal(
    index.applySessionFileReconciliation({
      previousRevision,
      revision: sessionFileRevision,
      changed: 1,
      upserts: [
        {
          providerSessionId: id,
          path,
          birthtimeMs: stat.birthtimeMs,
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          settingsMtimeMs: null,
          summary: null,
        },
      ],
      removedProviderSessionIds: [],
    }),
    true,
  );
}

test('transcript windows preserve the requested child role and provider identity under either app identity, and default top-level sessions to primary', () => {
  const firstText = (providerSessionId: string, appSessionId: string, role?: SessionRole) => {
    const text = loadSessionTranscriptWindow(appSessionId, [providerSessionId], {
      role,
    }).events.find((e) => e.kind === 'text');
    assert.ok(text, 'expected a text event');
    return [text.sourceSessionId, text.role];
  };
  writeTranscript('child-session', {
    callingSessionId: 'parent-session',
    callingToolUseId: 'tool-1',
  });
  assert.deepEqual(firstText('child-session', 'parent-app', 'worker'), ['child-session', 'worker']);
  assert.deepEqual(firstText('child-session', 'child-session', 'worker'), [
    'child-session',
    'worker',
  ]);

  writeTranscript('plain-session', {});
  assert.deepEqual(firstText('plain-session', 'plain-session'), ['primary', 'primary']);
});

test('transcript windows parse child-only skill messages with the child role', () => {
  writeTranscript(
    'child-skill',
    {
      callingSessionId: 'parent-session',
      callingToolUseId: 'tool-skill',
    },
    [
      {
        type: 'message',
        id: 'skill-1',
        timestamp: '2026-06-12T00:00:00.000Z',
        message: {
          role: 'user',
          visibility: 'user_only',
          content: [{ type: 'text', text: 'Skill "review" activated: child task' }],
        },
      },
    ],
  );

  const primary = loadSessionTranscriptWindow('parent-app', ['child-skill'], {
    role: 'primary',
  });
  const child = loadSessionTranscriptWindow('parent-app', ['child-skill'], { role: 'worker' });

  assert.equal(primary.events.length, 2);
  assert.deepEqual(child.events, []);
});
