import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState } from './useStore';
import type { AppState } from './useStore';
import type { TranscriptEvent } from '../types/bridge';
import { textEvent } from '../test/textEvent';

const ev = (id: string, ts: number, text = id) => textEvent(id, { appSessionId: 'm1', ts, text });

const userEv = (id: string, ts: number, text: string) =>
  textEvent(id, { appSessionId: 'm1', sourceSessionId: 'user', ts, text, author: 'user' });

const childEv = (childSessionId: string, id: string, ts: number, text = id, author?: 'user') =>
  textEvent(id, {
    appSessionId: 'm1',
    sourceSessionId: childSessionId,
    role: 'worker',
    ts,
    text,
    author,
  });

/** Seeds m1 with live transcript events (and any other state) before a restore. */
function withLive(events: TranscriptEvent[], extra: Partial<AppState> = {}): AppState {
  return { ...initialState, transcripts: { m1: events }, ...extra } as unknown as AppState;
}

/** Applies a primary history page to m1; a page with an older cursor has more. */
function applyHistory(
  state: AppState,
  transcripts: TranscriptEvent[],
  options: { mode?: 'prepend'; olderCursor?: string; loadedCount?: number } = {},
): AppState {
  return reducer(state, {
    type: 'SESSION_HISTORY',
    appSessionId: 'm1',
    progress: [],
    transcripts,
    mode: 'replace',
    hasMore: Boolean(options.olderCursor),
    ...options,
  });
}

const transcriptIds = (state: AppState) => state.transcripts.m1.map((event) => event.id);

test('#29 restore status moves from loading to loaded, or paged while an older cursor remains', () => {
  const start = reducer(initialState as unknown as AppState, {
    type: 'SESSION_RESTORE_START',
    appSessionId: 'm1',
  });
  assert.deepEqual(start.sessionRestore.m1, { status: 'loading', loadedCount: 0, hasMore: false });

  const loaded = applyHistory(start, [ev('a', 1), ev('b', 2)], { loadedCount: 2 });
  assert.deepEqual(loaded.sessionRestore.m1, { status: 'loaded', loadedCount: 2, hasMore: false });

  const paged = applyHistory(start, [ev('c', 3), ev('d', 4)], { olderCursor: '1:end' });
  assert.deepEqual(paged.sessionRestore.m1, { status: 'paged', loadedCount: 2, hasMore: true });
  assert.deepEqual(transcriptIds(paged), ['c', 'd']);
  assert.equal(paged.historyCursor.m1, '1:end');
  assert.equal(paged.historyLoadingOlder.m1, false);
  assert.equal(paged.historyLoaded.m1, true);
});

test('a prepend puts older events ahead of the scrollback and records its provenance', () => {
  const seeded = withLive([ev('c', 3), ev('d', 4)], {
    historyCursor: { m1: '1:end' },
    historyLoadingOlder: { m1: true },
  });

  const next = applyHistory(seeded, [ev('a', 1), ev('b', 2)], {
    mode: 'prepend',
    olderCursor: '0:end',
  });

  assert.deepEqual(transcriptIds(next), ['a', 'b', 'c', 'd']);
  assert.equal(next.historyCursor.m1, '0:end');
  assert.equal(next.historyLoadingOlder.m1, false);
  assert.deepEqual(next.transcriptMutations.m1, {
    revision: 1,
    baseRevision: 0,
    kind: 'prepend',
    previousLength: 2,
    firstChangedIndex: 0,
    insertedCount: 2,
  });
});

test('a prepend skips events already at the boundary; an all-duplicate page only settles loading', () => {
  const overlapping = applyHistory(
    withLive([ev('b', 2), ev('c', 3)], { historyLoadingOlder: { m1: true } }),
    [ev('a', 1), ev('b', 2)],
    { mode: 'prepend' },
  );
  assert.deepEqual(transcriptIds(overlapping), ['a', 'b', 'c']);
  assert.equal(overlapping.historyCursor.m1, undefined);
  assert.equal(overlapping.historyLoadingOlder.m1, false);
  assert.equal(overlapping.transcriptMutations.m1.insertedCount, 1);

  const existing = [ev('a', 1), ev('b', 2)];
  const loading = reducer(withLive(existing), {
    type: 'SESSION_HISTORY_LOADING_OLDER',
    appSessionId: 'm1',
  });
  assert.equal(loading.historyLoadingOlder.m1, true);
  const duplicate = applyHistory(loading, [ev('a', 1)], { mode: 'prepend' });
  assert.equal(duplicate.transcripts.m1, existing);
  assert.equal(duplicate.historyLoadingOlder.m1, false);
});

test('#29 a replace never clobbers live events that streamed in before the snapshot', () => {
  // A reconnect to a running session can deliver a live transcript event before
  // the history snapshot; that event must survive the replace.
  const seeded = withLive([ev('live-1', 99)]);

  const next = applyHistory(seeded, [ev('a', 1), ev('b', 2)]);

  assert.deepEqual(transcriptIds(next), ['a', 'b', 'live-1']);
  assert.equal(next.sessionRestore.m1.loadedCount, 3);
});

test('#29 a replace prefers the authoritative page for events shared with live state', () => {
  const seeded = withLive([ev('a', 1, 'partial')]);

  const next = applyHistory(seeded, [ev('a', 1, 'complete')]);

  assert.deepEqual(transcriptIds(next), ['a']);
  assert.equal(next.transcripts.m1[0].text, 'complete');
});

type ReconcileCase = {
  name: string;
  live: TranscriptEvent[];
  page: TranscriptEvent[];
  mode?: 'prepend';
  olderCursor?: string;
  ids: string[];
};

function reconcile({ live, page, mode, olderCursor }: ReconcileCase): string[] {
  return transcriptIds(applyHistory(withLive(live), page, { mode, olderCursor }));
}

/** History's stored copy of `fullText` after persistence truncated it to its first `kept` chars. */
function truncatedReplay(fullText: string, kept: number): string {
  return `${fullText.slice(0, kept)}\n\n[truncated ${String(fullText.length - kept)} chars]`;
}

const appVisualization = `Visualization\n\n\`\`\`app\n${'x'.repeat(96)}\n\`\`\``;
const gappedApp = (head: string) => {
  const missingChunk = '1, 2, 3];</script></main>\n```\n\n';
  const tail =
    'The complete replay keeps this explanatory tail long enough to identify the same streamed response.';
  const prefix = `${head}\`\`\`app\n<main><script>const points = [`;
  return { full: `${prefix}${missingChunk}${tail}`, gapped: `${prefix}${tail}` };
};
const similarApp = (answer: string) =>
  `Here is the visualization.\n\n\`\`\`app\n<main>${'a'.repeat(80)}<p>${answer}</p>${'z'.repeat(80)}</main>\n\`\`\``;

test('#29 history replaces and prepends drop live events and echoes the page already holds', () => {
  const cases: ReconcileCase[] = [
    {
      // The seeded echo and the persisted user message share text but not id.
      name: 'optimistic opening prompt',
      live: [userEv('seed-m1', 1, 'hello there')],
      page: [userEv('real-user', 1, 'hello there'), ev('asst', 2, 'hi')],
      ids: ['real-user', 'asst'],
    },
    {
      // A prepend that pages in the real prompt drops the echo kept above a partial page.
      name: 'echo superseded by an older page',
      live: [userEv('seed-m1', 1, 'run the build'), ev('asst', 50, 'tail')],
      page: [userEv('real-user', 1, 'run the build'), ev('asst-old', 2, 'older reply')],
      mode: 'prepend',
      ids: ['real-user', 'asst-old', 'asst'],
    },
    {
      // Reconnect race: neither the transient id nor the receipt-time ts match the twin.
      name: 'live twin matched by content',
      live: [ev('live-9', 1005, 'all done')],
      page: [userEv('real-user', 1, 'go'), ev('sess:1:0:text', 1000, 'all done')],
      ids: ['real-user', 'sess:1:0:text'],
    },
    {
      // Live primary events carry the app session id; history canonicalizes it to 'primary'.
      name: 'live primary twin',
      live: [{ ...ev('live-orch', 1002, 'done'), sourceSessionId: 'm1' }],
      page: [ev('sess:1:0:text', 1000, 'done')],
      ids: ['sess:1:0:text'],
    },
    {
      // Streamed text keeps its first-chunk ts; matching uses the live [ts, endTs] span.
      name: 'long-streamed live twin',
      live: [{ ...ev('live-stream', 1000, 'long answer'), endTs: 30000 }],
      page: [ev('sess:1:0:text', 29900, 'long answer')],
      ids: ['sess:1:0:text'],
    },
    {
      // History stores the composed prompt, so dedup recomposes the echo's skills and files.
      name: 'skill and file echo',
      live: [
        { ...userEv('local-1', 500, 'fix the bug'), skills: ['debugger'], files: ['src/a.ts'] },
      ],
      page: [userEv('sess:1:0:text', 1000, '/debugger fix the bug\n\n@src/a.ts')],
      ids: ['sess:1:0:text'],
    },
    {
      name: 'side-chat answers echo',
      live: [{ ...userEv('local-answers', 500, ''), sideChatReplies: ['Sort by date first.'] }],
      page: [
        { ...userEv('sess:answers:text', 1_000, ''), sideChatReplies: ['Sort by date first.'] },
      ],
      ids: ['sess:answers:text'],
    },
    ...(['replace', 'prepend'] as const).map((mode) => ({
      name: `skill-only echo on ${mode}`,
      live: [{ ...userEv('local-skill-only', 500, ''), skills: ['debugger'] }],
      page: [userEv('sess:skill:text', 1_000, '/debugger')],
      mode: mode === 'prepend' ? ('prepend' as const) : undefined,
      ids: ['sess:skill:text'],
    })),
    {
      name: 'completed App ahead of a later gapped App',
      live: [
        {
          ...ev(
            'live-mixed-apps',
            900,
            gappedApp('```app\n<main>First app</main>\n```\n\n').gapped,
          ),
          endTs: 1000,
          sourceSessionId: 'provider-m1',
        },
      ],
      page: [
        ev(
          'persisted-complete-mixed-apps',
          1001,
          gappedApp('```app\n<main>First app</main>\n```\n\n').full,
        ),
      ],
      ids: ['persisted-complete-mixed-apps'],
    },
  ];
  for (const testCase of cases) {
    assert.deepEqual(reconcile(testCase), testCase.ids, testCase.name);
  }
});

test('#29 history replaces keep live events and echoes the page does not hold, in place', () => {
  const cases: ReconcileCase[] = [
    {
      // A re-sent prompt newer than the whole page is not a duplicate of the earlier one.
      name: 'new local prompt repeating earlier text',
      live: [userEv('local-1700000000000', 100, 'do it again')],
      page: [userEv('real-user', 1, 'do it again'), ev('asst', 2, 'done')],
      ids: ['real-user', 'asst', 'local-1700000000000'],
    },
    {
      // History returned the reply but not the prompt yet; the older prompt stays on top.
      name: 'un-persisted opening prompt',
      live: [userEv('seed-m1', 1, 'hello there')],
      page: [ev('asst', 5, 'response only')],
      ids: ['seed-m1', 'asst'],
    },
    {
      // The newest window lacks the opening prompt; a later message only repeats its text.
      name: 'opening prompt above a paged window',
      live: [userEv('seed-m1', 1, 'run the build')],
      page: [userEv('later-user', 50, 'run the build'), ev('asst', 51, 'ok')],
      olderCursor: '0:end',
      ids: ['seed-m1', 'later-user', 'asst'],
    },
    {
      name: 'identical text from a different worker',
      live: [{ ...ev('live-b', 1005, 'all done'), sourceSessionId: 'worker-b', role: 'worker' }],
      page: [
        { ...ev('sess:1:0:text', 1000, 'all done'), sourceSessionId: 'worker-a', role: 'worker' },
      ],
      ids: ['sess:1:0:text', 'live-b'],
    },
    {
      name: 'fresh reply matching only an old restored one',
      live: [ev('live-new', 100000, 'ok')],
      page: [ev('sess:1:0:text', 1000, 'ok'), ev('sess:2:0:text', 1001, 'later')],
      ids: ['sess:1:0:text', 'sess:2:0:text', 'live-new'],
    },
    {
      // Consume-once dedup: the page holds one "ok", so the second live one is new.
      name: 'genuinely repeated live message',
      live: [ev('live-1', 1000, 'ok'), ev('live-2', 2000, 'ok')],
      page: [ev('sess:1:0:text', 990, 'ok')],
      ids: ['sess:1:0:text', 'live-2'],
    },
    {
      name: 'similar but distinct complete App answers',
      live: [ev('live-first', 1000, similarApp('First answer'))],
      page: [
        ev(
          'persisted-second',
          1001,
          similarApp('A distinct and intentionally longer second answer'),
        ),
      ],
      ids: ['live-first', 'persisted-second'],
    },
    {
      name: 'full live App replacing its truncated twin in place',
      live: [ev('live-app', 195, appVisualization)],
      page: [
        userEv('user-before', 100, '/visualize'),
        ev('truncated-app', 200, truncatedReplay(appVisualization, 40)),
        userEv('user-after', 300, 'make it blue'),
      ],
      ids: ['user-before', 'live-app', 'user-after'],
    },
    {
      name: 'live events between a leading truncated twin and later history',
      live: [ev('live-app', 95, appVisualization), ev('live-between', 150, 'still here')],
      page: [
        ev('truncated-app', 100, truncatedReplay(appVisualization, 40)),
        ev('history-after', 200, 'later'),
      ],
      ids: ['live-app', 'live-between', 'history-after'],
    },
  ];
  for (const testCase of cases) {
    assert.deepEqual(reconcile(testCase), testCase.ids, testCase.name);
  }
});

test('#29 a replace keeps one full live event when persisted history truncates its twin', () => {
  const fullText = `Here is the visualization.\n\n\`\`\`app\n${'x'.repeat(64)}\n\`\`\`\n\nDetails.`;
  const retainedPrefix = fullText.slice(0, 48);
  const persistedText = `${retainedPrefix}\n\n[truncated ${String(fullText.length - retainedPrefix.length)} chars]`;
  const seeded = withLive([ev('live-prefix', 999, retainedPrefix), ev('live-app', 1000, fullText)]);

  const next = applyHistory(seeded, [
    userEv('real-user', 900, '/visualize histogram'),
    ev('sess:1:0:text', 1001, persistedText),
  ]);

  assert.deepEqual(transcriptIds(next), ['real-user', 'live-app']);
  assert.equal(next.transcripts.m1[1].text, fullText);
});

test('#29 a replace drops a live App response missing one streamed middle chunk', () => {
  const prefix = 'Here is the visualization.\n\n```app\n<main><script>const points = [';
  const missingChunk = '1, 2, 3];</script></main>\n```\n\n';
  const suffix =
    'The points rise together, and the complete response keeps this explanatory tail intact.';
  const fullText = `${prefix}${missingChunk}${suffix}`;
  const incompleteLiveText = `${prefix}${suffix}`;
  const live = {
    ...ev('live-app-with-gap', 900, incompleteLiveText),
    endTs: 1000,
    sourceSessionId: 'provider-m1',
  };
  const seeded = withLive([live]);

  const next = applyHistory(seeded, [ev('persisted-complete-app', 1001, fullText)]);

  assert.deepEqual(transcriptIds(next), ['persisted-complete-app']);
  assert.equal(next.transcripts.m1[0].text, fullText);
});

test('child replace reconciles only its logical source and removes a superseded local prompt', () => {
  const primary = ev('primary-live', 5, 'parent output');
  const sibling = childEv('child-b', 'sibling-live', 6, 'same output');
  const seeded = {
    ...initialState,
    transcripts: {
      m1: [
        primary,
        childEv('child-a', 'local-1000', 10, 'run checks', 'user'),
        sibling,
        childEv('child-a', 'child-live', 21, 'new live output'),
      ],
    },
  } as AppState;

  const next = reducer(seeded, {
    type: 'SESSION_HISTORY',
    appSessionId: 'm1',
    childSessionId: 'child-a',
    progress: [],
    transcripts: [
      childEv('child-a', 'persisted-prompt', 10, 'run checks', 'user'),
      childEv('child-a', 'persisted-output', 20, 'saved output'),
    ],
    mode: 'replace',
    olderCursor: 'child-cursor',
    hasMore: true,
  });

  assert.deepEqual(
    next.transcripts.m1
      .filter((event) => event.sourceSessionId === 'child-a')
      .map((event) => event.id),
    ['persisted-prompt', 'persisted-output', 'child-live'],
  );
  assert.equal(
    next.transcripts.m1.find((event) => event.id === primary.id),
    primary,
  );
  assert.equal(
    next.transcripts.m1.find((event) => event.id === sibling.id),
    sibling,
  );
  assert.deepEqual(next.childHistory.m1['child-a'], {
    status: 'paged',
    loadedCount: 3,
    hasMore: true,
    isLoaded: true,
    isLoadingOlder: false,
    olderCursor: 'child-cursor',
    isViewportPinned: true,
  });
  assert.equal(next.historyCursor.m1, undefined);
  assert.equal(next.sessionRestore.m1, undefined);
});

test('child prepend advances only that child cursor and preserves parent and sibling order', () => {
  const primary = ev('primary-live', 5, 'parent output');
  const sibling = childEv('child-b', 'sibling-live', 6, 'sibling output');
  const seeded = {
    ...initialState,
    transcripts: {
      m1: [primary, childEv('child-a', 'child-newer', 20), sibling],
    },
    childHistory: {
      m1: {
        'child-a': {
          status: 'paged',
          loadedCount: 1,
          hasMore: true,
          isLoaded: true,
          isLoadingOlder: true,
          olderCursor: 'cursor-2',
          isViewportPinned: false,
        },
      },
    },
  } as AppState;

  const next = reducer(seeded, {
    type: 'SESSION_HISTORY',
    appSessionId: 'm1',
    childSessionId: 'child-a',
    progress: [],
    transcripts: [childEv('child-a', 'child-older', 10)],
    mode: 'prepend',
    olderCursor: 'cursor-1',
    hasMore: true,
  });

  assert.deepEqual(
    next.transcripts.m1
      .filter((event) => event.sourceSessionId === 'child-a')
      .map((event) => event.id),
    ['child-older', 'child-newer'],
  );
  assert.deepEqual(
    next.transcripts.m1
      .filter((event) => event.sourceSessionId !== 'child-a')
      .map((event) => event.id),
    [primary.id, sibling.id],
  );
  assert.equal(next.childHistory.m1['child-a'].olderCursor, 'cursor-1');
  assert.equal(next.childHistory.m1['child-a'].isLoadingOlder, false);
  assert.equal(next.childHistory.m1['child-a'].isViewportPinned, false);
});

test('successful empty child history settles loading without clearing other sources', () => {
  const existing = [ev('primary-live', 5), childEv('child-b', 'sibling-live', 6)];
  const seeded = {
    ...initialState,
    transcripts: { m1: existing },
    childHistory: {
      m1: {
        'child-a': {
          status: 'loading',
          loadedCount: 0,
          hasMore: false,
          isLoaded: false,
          isLoadingOlder: false,
          isViewportPinned: true,
        },
      },
    },
  } as AppState;

  const next = reducer(seeded, {
    type: 'SESSION_HISTORY',
    appSessionId: 'm1',
    childSessionId: 'child-a',
    progress: [],
    transcripts: [],
    mode: 'replace',
    hasMore: false,
  });

  assert.equal(next.transcripts.m1, existing);
  assert.deepEqual(next.childHistory.m1['child-a'], {
    status: 'loaded',
    loadedCount: 0,
    hasMore: false,
    isLoaded: true,
    isLoadingOlder: false,
    olderCursor: undefined,
    isViewportPinned: true,
  });
});

test('opening an unloaded child creates explicit history loading state', () => {
  const seeded = {
    ...initialState,
    activeAppSessionId: 'm1',
    childSessions: {
      m1: {
        'child-a': {
          parentAppSessionId: 'm1',
          childSessionId: 'child-a',
          role: 'worker' as const,
          status: 'completed' as const,
          modelId: 'model-1',
          transcriptAvailable: true,
          streamFidelity: 'state',
        },
      },
    },
  };
  const next = reducer(seeded, {
    type: 'SELECT_CHILD',
    selection: { parentAppSessionId: 'm1', childSessionId: 'child-a' },
    requestId: 'open-1',
  });

  assert.deepEqual(next.childHistory.m1['child-a'], {
    status: 'loading',
    loadedCount: 0,
    hasMore: false,
    isLoaded: false,
    isLoadingOlder: false,
    isViewportPinned: true,
  });
  assert.deepEqual(next.childAccess.m1['child-a'], {
    state: 'opening',
    requestId: 'open-1',
  });
});

test('#29 an empty replace keeps live progress instead of clearing it', () => {
  // A live session with no persisted history answers with an empty replace; that
  // must not wipe progress already delivered by live events.
  const seeded = withLive([], {
    progress: { m1: [{ type: 'feature', timestamp: '2026-01-01T00:00:00Z', title: 'work' }] },
  });

  const next = applyHistory(seeded, []);

  assert.equal(next.progress.m1.length, 1);
  assert.equal(next.progress.m1[0].title, 'work');
});

test('#29 SESSION_HISTORY_FAILED records a failed restore but keeps any prior count', () => {
  const seeded = {
    ...initialState,
    sessionRestore: { m1: { status: 'loading', loadedCount: 5, hasMore: true } },
  } as unknown as AppState;

  const next = reducer(seeded, {
    type: 'SESSION_HISTORY_FAILED',
    appSessionId: 'm1',
    message: 'session file unreadable',
  });

  assert.deepEqual(next.sessionRestore.m1, {
    status: 'failed',
    loadedCount: 5,
    hasMore: true,
    error: 'session file unreadable',
  });
});

test('#29 prepend grows the restore count and resolves to loaded when no cursor remains', () => {
  const seeded = withLive([ev('c', 3), ev('d', 4)], {
    sessionRestore: { m1: { status: 'paged', loadedCount: 2, hasMore: true } },
    historyLoadingOlder: { m1: true },
  });

  const next = applyHistory(seeded, [ev('a', 1), ev('b', 2)], { mode: 'prepend' });

  assert.equal(next.sessionRestore.m1.status, 'loaded');
  assert.equal(next.sessionRestore.m1.hasMore, false);
  assert.equal(next.sessionRestore.m1.loadedCount, 4);
});

test('child history failures preserve the retry cursor and settle only that child', () => {
  const seeded = {
    ...initialState,
    childHistory: {
      m1: {
        'child-1': {
          status: 'paged',
          loadedCount: 120,
          hasMore: true,
          isLoaded: true,
          isLoadingOlder: true,
          olderCursor: 'child-older',
          isViewportPinned: false,
        },
      },
    },
  } as unknown as AppState;

  const next = reducer(seeded, {
    type: 'SESSION_HISTORY_FAILED',
    appSessionId: 'm1',
    childSessionId: 'child-1',
    message: 'history unavailable',
  });

  assert.deepEqual(next.childHistory.m1['child-1'], {
    status: 'failed',
    loadedCount: 120,
    hasMore: true,
    error: 'history unavailable',
    isLoaded: true,
    isLoadingOlder: false,
    olderCursor: 'child-older',
    isViewportPinned: false,
  });
  assert.equal(next.sessionRestore.m1, undefined);
});
