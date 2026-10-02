import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistTestSummaries } from './testing/historyPersistenceFixture.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

const originalHome = process.env.HOME;
const home = mkdtempSync(join(tmpdir(), 'droid-chain-replay-'));
process.env.HOME = home;

const {
  HistoryIndex,
  invalidateSessionIndex,
  invalidateSessionTranscripts,
  loadSessionTranscriptWindow,
  resolveSessionChain,
} = await import('./history.js');

test.after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

// These tests call loadSessionTranscriptWindow directly with hand-built
// chains, bypassing the resolveSessionChain self-heal that refreshes the
// memoized session index in production. Reset the memos (session index and
// parsed-transcript readers) so each test sees the files it just wrote,
// mirroring a freshly booted sidecar.
test.beforeEach(() => {
  sessionPaths.clear();
  invalidateSessionIndex();
  invalidateSessionTranscripts();
});

let clock = 0;
const sessionPaths = new Map<string, string>();
function assistant(text: string): string {
  clock += 1000;
  return JSON.stringify({
    type: 'message',
    id: `${text}-id`,
    timestamp: new Date(clock).toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function assistantAt(text: string, ts: number): string {
  return JSON.stringify({
    type: 'message',
    id: `${text}-id`,
    timestamp: new Date(ts).toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function compactionState(removedCount: number): string {
  clock += 1000;
  return JSON.stringify({
    type: 'compaction_state',
    id: `comp-${removedCount}`,
    timestamp: new Date(clock).toISOString(),
    removedCount,
    summaryText: 'summary of earlier turns',
    summaryKind: 'llm_summary',
  });
}

function writeSession(id: string, lines: string[]): void {
  const dir = join(home, '.factory', 'sessions', '2026', '06');
  mkdirSync(dir, { recursive: true });
  const all = [
    JSON.stringify({ type: 'session_start', id, cwd: home, sessionTitle: 'S' }),
    ...lines,
  ];
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(path, `${all.join('\n')}\n`);
  sessionPaths.set(id, path);
  publishSessionPaths();
}

function publishSessionPaths(): void {
  const index = new HistoryIndex();
  try {
    assert.equal(
      index.applySessionFileReconciliation({
        previousRevision: 0,
        revision: 1,
        changed: sessionPaths.size,
        upserts: [...sessionPaths].map(([providerSessionId, path]) => {
          const stat = statSync(path);
          return {
            providerSessionId,
            path,
            birthtimeMs: stat.birthtimeMs,
            mtimeMs: stat.mtimeMs,
            sizeBytes: stat.size,
            settingsMtimeMs: null,
            summary: null,
          };
        }),
        removedProviderSessionIds: [],
      }),
      true,
    );
  } finally {
    index.close();
  }
}

// A chat compacted twice: s0 (original) -> s1 -> s2 (current backing).
function seedChain(): string[] {
  writeSession('s0', [assistant('a0-1'), assistant('a0-2')]);
  writeSession('s1', [compactionState(5), assistant('a1-1'), assistant('a1-2')]);
  writeSession('s2', [compactionState(7), assistant('a2-1'), assistant('a2-2')]);
  return ['s0', 's1', 's2'];
}

test('loadSessionTranscriptWindow replays the full compaction chain in seq order with dividers', () => {
  const chain = seedChain();
  const { events, olderCursor } = loadSessionTranscriptWindow('m', chain, { limit: 100 });

  assert.deepEqual(
    events.map((e) => (e.kind === 'compaction' ? `divider:${e.removedCount}` : e.text)),
    ['a0-1', 'a0-2', 'divider:5', 'a1-1', 'a1-2', 'divider:7', 'a2-1', 'a2-2'],
  );
  // The whole conversation fits in one window, so there is no older page.
  assert.equal(olderCursor, undefined);
  assert.ok(
    events.every((e) => typeof e.seq === 'number'),
    'every replayed event must be stamped with a seq',
  );
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].seq! > events[i - 1].seq!, `seq must increase at index ${i}`);
  }
});

test('cursor pages older history across the chain with no gaps or duplicates', () => {
  const chain = seedChain();
  const collected: string[] = [];
  const seenIds = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;

  do {
    const page = loadSessionTranscriptWindow('m', chain, { limit: 3, cursor });
    // Prepend each older page to rebuild the transcript oldest -> newest.
    collected.unshift(
      ...page.events.map((e) => (e.kind === 'compaction' ? `divider:${e.removedCount}` : e.text!)),
    );
    for (const e of page.events) {
      assert.ok(!seenIds.has(e.id), `duplicate event ${e.id} across pages`);
      seenIds.add(e.id);
    }
    cursor = page.olderCursor;
    pages += 1;
    assert.ok(pages < 10, 'pagination did not terminate');
  } while (cursor);

  assert.deepEqual(collected, [
    'a0-1',
    'a0-2',
    'divider:5',
    'a1-1',
    'a1-2',
    'divider:7',
    'a2-1',
    'a2-2',
  ]);
});

test('equal-timestamp events keep chain order via seq, not wall-clock', () => {
  // All three share one ts, so only seq disambiguates their order.
  writeSession('eqts', [
    assistantAt('first', 5000),
    assistantAt('second', 5000),
    assistantAt('third', 5000),
  ]);
  const { events } = loadSessionTranscriptWindow('m', ['eqts'], { limit: 100 });
  const texts = events.filter((e) => e.kind === 'text');

  assert.deepEqual(
    texts.map((e) => e.text),
    ['first', 'second', 'third'],
  );
  assert.equal(texts[0].ts, texts[2].ts);
  assert.ok(texts[0].seq! < texts[1].seq! && texts[1].seq! < texts[2].seq!);
});

test('a single segment replays its dividers in position, whether none, at the head, or mid-file', () => {
  // An in-place-compacted file whose earlier files were pruned begins with a
  // compaction_state: position cannot flag it, so the divider is read from the
  // record itself, once. The daemon's auto-compaction appends the marker to the
  // same file, between messages.
  const cases = [
    ['solo', [assistant('only-1'), assistant('only-2')], ['only-1', 'only-2']],
    ['inplace', [compactionState(9), assistant('after')], ['divider:9', 'after']],
    [
      'midfile',
      [assistant('before-1'), assistant('before-2'), compactionState(86), assistant('after-1')],
      ['before-1', 'before-2', 'divider:86', 'after-1'],
    ],
  ] as const;
  for (const [id, lines, expected] of cases) {
    writeSession(id, [...lines]);
    const { events, olderCursor } = loadSessionTranscriptWindow('m', [id], { limit: 100 });
    assert.deepEqual(
      events.map((e) => (e.kind === 'compaction' ? `divider:${e.removedCount}` : e.text)),
      expected,
    );
    assert.equal(olderCursor, undefined);
  }
});

test('export resolves the chain from the persisted app-session row and replays it in one window', () => {
  // Regression: "Copy as Markdown" originally parsed only the CURRENT backing
  // file, silently dropping every pre-compaction message. The export path
  // (resolveSessionChain + one big window) must contain all segments.
  writeSession('app9', [assistant('orig')]);
  writeSession('mid9', [compactionState(2), assistant('mid')]);
  writeSession('cur9', [compactionState(3), assistant('latest')]);
  const index = new HistoryIndex();
  index.close();
  persistTestSummaries([
    sessionSummary({
      appSessionId: 'app9',
      providerSessionId: 'cur9',
      compactedFromProviderSessionIds: ['app9', 'mid9'],
      cwd: home,
      workspaceKind: 'folder',
    }),
  ]);
  publishSessionPaths();

  const chain = resolveSessionChain('app9', 'cur9');
  assert.deepEqual(chain, ['app9', 'mid9', 'cur9']);
  const { events } = loadSessionTranscriptWindow('app9', chain, { limit: 100_000 });
  assert.deepEqual(
    events.filter((e) => e.kind === 'text').map((e) => e.text),
    ['orig', 'mid', 'latest'],
    'export must include the pre-compaction segments, not just the current backing file',
  );
  assert.equal(events.filter((e) => e.kind === 'compaction').length, 2);
});

function sessionFilePath(id: string): string {
  return join(home, '.factory', 'sessions', '2026', '06', `${id}.jsonl`);
}

test('a live-appended session file invalidates the memoized reader', () => {
  writeSession('live1', [assistant('l1')]);
  const first = loadSessionTranscriptWindow('app', ['live1'], { limit: 10 });
  assert.deepEqual(
    first.events.map((e) => e.text),
    ['l1'],
  );
  appendFileSync(sessionFilePath('live1'), `${assistant('l2')}\n`);
  const second = loadSessionTranscriptWindow('app', ['live1'], { limit: 10 });
  assert.deepEqual(
    second.events.map((e) => e.text),
    ['l1', 'l2'],
  );
});

test('pre-v2 cursors end paging cleanly instead of serving a wrong page', () => {
  seedChain();
  // The pre-v2 "<ci>:end" form still maps to a segment tail.
  const legacy = loadSessionTranscriptWindow('app', ['s0', 's1', 's2'], {
    cursor: '1:end',
    limit: 3,
  });
  assert.deepEqual(
    legacy.events.filter((e) => e.kind === 'text').map((e) => e.text),
    ['a1-1', 'a1-2'],
  );
  // Item-index cursors no longer address anything: empty page, no cursor.
  const stale = loadSessionTranscriptWindow('app', ['s0', 's1', 's2'], {
    cursor: '2:1',
    limit: 10,
  });
  assert.deepEqual(stale.events, []);
  assert.equal(stale.olderCursor, undefined);
});
