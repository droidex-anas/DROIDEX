import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState } from './useStore';
import type { AppState } from './useStore';
import type { TranscriptEvent } from '../types/bridge';

function ev(id: string, ts: number, text = id): TranscriptEvent {
  return {
    id,
    appSessionId: 'm1',
    sourceSessionId: 'primary',
    role: 'primary',
    kind: 'text',
    text,
    ts,
  };
}

function userEv(id: string, ts: number, text: string): TranscriptEvent {
  return {
    id,
    appSessionId: 'm1',
    sourceSessionId: 'user',
    role: 'primary',
    kind: 'text',
    text,
    ts,
    author: 'user',
  };
}

function childEv(
  childSessionId: string,
  id: string,
  ts: number,
  text = id,
  author?: 'user',
): TranscriptEvent {
  return {
    id,
    appSessionId: 'm1',
    sourceSessionId: childSessionId,
    role: 'worker',
    kind: 'text',
    text,
    ts,
    author,
  };
}

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

test('#29 a replace drops the optimistic opening prompt the restored page already contains', () => {
  // The seeded echo and the persisted user message share text but not id; the
  // page is authoritative, so the echo must not double-render.
  const seeded = withLive([userEv('seed-m1', 1, 'hello there')]);

  const next = applyHistory(seeded, [userEv('real-user', 1, 'hello there'), ev('asst', 2, 'hi')]);

  assert.deepEqual(transcriptIds(next), ['real-user', 'asst']);
});

test('#29 a replace keeps a new local prompt sent during restore even if it repeats earlier text', () => {
  // User re-sends the same prompt while the initial restore is still in flight;
  // the new local echo is newer than the whole page and must not be deduped.
  const seeded = withLive([userEv('local-1700000000000', 100, 'do it again')]);

  const next = applyHistory(seeded, [userEv('real-user', 1, 'do it again'), ev('asst', 2, 'done')]);

  assert.deepEqual(transcriptIds(next), ['real-user', 'asst', 'local-1700000000000']);
});

test('#29 a replace keeps an un-persisted opening prompt above the restored page', () => {
  // History returned assistant events but not the user message yet; the seeded
  // prompt is older than the page and must stay at the top, not slide below it.
  const seeded = withLive([userEv('seed-m1', 1, 'hello there')]);

  const next = applyHistory(seeded, [ev('asst', 5, 'response only')]);

  assert.deepEqual(transcriptIds(next), ['seed-m1', 'asst']);
});

test('#29 a paged replace keeps the opening prompt when a later page message repeats its text', () => {
  // The newest window (olderCursor set) does not contain the opening prompt; a
  // later message happens to repeat its text, so the older echo must not be
  // deduped away and lost above the page.
  const seeded = withLive([userEv('seed-m1', 1, 'run the build')]);

  const next = applyHistory(
    seeded,
    [userEv('later-user', 50, 'run the build'), ev('asst', 51, 'ok')],
    { olderCursor: '0:end' },
  );

  assert.deepEqual(transcriptIds(next), ['seed-m1', 'later-user', 'asst']);
});

test('#29 a prepend drops the optimistic echo superseded by the persisted prompt that pages in', () => {
  // The seeded opening echo was kept above a partial page; when the real prompt
  // arrives in an older page (different id), the prepend must drop the echo so
  // it does not duplicate and misorder the opening prompt.
  const seeded = withLive([userEv('seed-m1', 1, 'run the build'), ev('asst', 50, 'tail')]);

  const next = applyHistory(
    seeded,
    [userEv('real-user', 1, 'run the build'), ev('asst-old', 2, 'older reply')],
    { mode: 'prepend' },
  );

  assert.deepEqual(transcriptIds(next), ['real-user', 'asst-old', 'asst']);
});

test('#29 a replace drops a live event that duplicates a replayed one by content', () => {
  // Reconnect race: the live event has a transient id and receipt-time ts while
  // its persisted twin in the page has a session id and SDK ts, so neither id
  // nor ts match; the content signature must still collapse the duplicate.
  const seeded = withLive([ev('live-9', 1005, 'all done')]);

  const next = applyHistory(seeded, [
    userEv('real-user', 1, 'go'),
    ev('sess:1:0:text', 1000, 'all done'),
  ]);

  assert.deepEqual(transcriptIds(next), ['real-user', 'sess:1:0:text']);
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

test('#29 a full live App keeps the position of its truncated replay twin', () => {
  const fullText = `Visualization\n\n\`\`\`app\n${'x'.repeat(96)}\n\`\`\``;
  const retainedPrefix = fullText.slice(0, 40);
  const persistedText = `${retainedPrefix}\n\n[truncated ${String(fullText.length - retainedPrefix.length)} chars]`;
  const seeded = withLive([ev('live-app', 195, fullText)]);

  const next = applyHistory(seeded, [
    userEv('user-before', 100, '/visualize'),
    ev('truncated-app', 200, persistedText),
    userEv('user-after', 300, 'make it blue'),
  ]);

  assert.deepEqual(transcriptIds(next), ['user-before', 'live-app', 'user-after']);
});

test('#29 removing a leading truncated twin does not move intervening live events after history', () => {
  const fullText = `Visualization\n\n\`\`\`app\n${'x'.repeat(96)}\n\`\`\``;
  const retainedPrefix = fullText.slice(0, 40);
  const persistedText = `${retainedPrefix}\n\n[truncated ${String(fullText.length - retainedPrefix.length)} chars]`;
  const seeded = withLive([ev('live-app', 95, fullText), ev('live-between', 150, 'still here')]);

  const next = applyHistory(seeded, [
    ev('truncated-app', 100, persistedText),
    ev('history-after', 200, 'later'),
  ]);

  assert.deepEqual(transcriptIds(next), ['live-app', 'live-between', 'history-after']);
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

test('#29 a completed App does not hide a later App that is still missing a streamed chunk', () => {
  const firstApp = '```app\n<main>First app</main>\n```\n\n';
  const secondPrefix = '```app\n<main><script>const points = [';
  const missingChunk = '1, 2, 3];</script></main>\n```\n\n';
  const suffix =
    'The complete replay keeps this explanatory tail long enough to identify the same streamed response.';
  const fullText = `${firstApp}${secondPrefix}${missingChunk}${suffix}`;
  const incompleteLiveText = `${firstApp}${secondPrefix}${suffix}`;
  const seeded = withLive([
    {
      ...ev('live-mixed-apps', 900, incompleteLiveText),
      endTs: 1000,
      sourceSessionId: 'provider-m1',
    },
  ]);

  const next = applyHistory(seeded, [ev('persisted-complete-mixed-apps', 1001, fullText)]);

  assert.deepEqual(transcriptIds(next), ['persisted-complete-mixed-apps']);
});

test('#29 similar complete App answers are not mistaken for one gapped stream', () => {
  const prefix = `Here is the visualization.\n\n\`\`\`app\n<main>${'a'.repeat(80)}`;
  const suffix = `${'z'.repeat(80)}</main>\n\`\`\``;
  const shorter = `${prefix}<p>First answer</p>${suffix}`;
  const longer = `${prefix}<p>A distinct and intentionally longer second answer</p>${suffix}`;
  const seeded = withLive([ev('live-first', 1000, shorter)]);

  const next = applyHistory(seeded, [ev('persisted-second', 1001, longer)]);

  assert.deepEqual(transcriptIds(next), ['live-first', 'persisted-second']);
});

test('#29 a replace keeps a live event from a different worker with identical text', () => {
  // Same role/kind/text but a different sourceSessionId is a distinct worker's
  // output; scoping the signature by sourceSessionId must not drop it.
  const liveFromWorkerB: TranscriptEvent = {
    id: 'live-b',
    appSessionId: 'm1',
    sourceSessionId: 'worker-b',
    role: 'worker',
    kind: 'text',
    text: 'all done',
    ts: 1005,
  };
  const seeded = withLive([liveFromWorkerB]);

  const next = applyHistory(seeded, [ev('sess:1:0:text', 1000, 'all done')]);

  assert.deepEqual(transcriptIds(next), ['sess:1:0:text', 'live-b']);
});

test('#29 a replace keeps a new live event that only matches an OLD restored message by text', () => {
  // During reconnect a fresh "ok" arrives well after the snapshot; it must not
  // be consumed by an older restored "ok" from the same agent.
  const seeded = withLive([ev('live-new', 100000, 'ok')]);

  const next = applyHistory(seeded, [
    ev('sess:1:0:text', 1000, 'ok'),
    ev('sess:2:0:text', 1001, 'later'),
  ]);

  assert.deepEqual(transcriptIds(next), ['sess:1:0:text', 'sess:2:0:text', 'live-new']);
});

test('#29 a replace keeps a genuinely repeated live message the page only contains once', () => {
  // Two live "ok" events but the page persisted only one; consume-once dedup
  // drops the duplicate and keeps the genuinely new occurrence.
  const seeded = withLive([ev('live-1', 1000, 'ok'), ev('live-2', 2000, 'ok')]);

  const next = applyHistory(seeded, [ev('sess:1:0:text', 990, 'ok')]);

  assert.deepEqual(transcriptIds(next), ['sess:1:0:text', 'live-2']);
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

test('#29 a replace dedups a live primary event against its persisted twin', () => {
  // Live primary events carry sourceSessionId = appSessionId while history
  // canonicalizes it to 'primary'; the normalized signature must still
  // match so the twin is not duplicated.
  const liveOrch: TranscriptEvent = {
    id: 'live-orch',
    appSessionId: 'm1',
    sourceSessionId: 'm1',
    role: 'primary',
    kind: 'text',
    text: 'done',
    ts: 1002,
  };
  const seeded = withLive([liveOrch]);

  const next = applyHistory(seeded, [ev('sess:1:0:text', 1000, 'done')]);

  assert.deepEqual(transcriptIds(next), ['sess:1:0:text']);
});

test('#29 a replace dedups a long-streamed live event whose start is outside tolerance', () => {
  // Streamed text keeps the first-chunk ts but advances endTs; history is
  // timestamped near completion, so matching must use the live [ts, endTs] span.
  const streamed: TranscriptEvent = {
    id: 'live-stream',
    appSessionId: 'm1',
    sourceSessionId: 'primary',
    role: 'primary',
    kind: 'text',
    text: 'long answer',
    ts: 1000,
    endTs: 30000,
  };
  const seeded = withLive([streamed]);

  const next = applyHistory(seeded, [ev('sess:1:0:text', 29900, 'long answer')]);

  assert.deepEqual(transcriptIds(next), ['sess:1:0:text']);
});

test('#29 a replace supersedes a skill/file echo whose persisted prompt is composed', () => {
  // The optimistic echo holds raw input plus skill/file metadata; history stores
  // the composed prompt, so dedup must recompose to recognize it.
  const echo: TranscriptEvent = {
    id: 'local-1',
    appSessionId: 'm1',
    sourceSessionId: 'user',
    role: 'primary',
    kind: 'text',
    text: 'fix the bug',
    ts: 500,
    author: 'user',
    skills: ['debugger'],
    files: ['src/a.ts'],
  };
  const composed = '/debugger fix the bug\n\n@src/a.ts';
  const seeded = withLive([echo]);

  const next = applyHistory(seeded, [userEv('sess:1:0:text', 1000, composed)]);

  assert.deepEqual(transcriptIds(next), ['sess:1:0:text']);
});

test('a replace supersedes an echo that carried only side-chat answers', () => {
  const echo: TranscriptEvent = {
    id: 'local-answers',
    appSessionId: 'm1',
    sourceSessionId: 'user',
    role: 'primary',
    kind: 'text',
    text: '',
    ts: 500,
    author: 'user',
    sideChatReplies: ['Sort by date first.'],
  };
  const persisted = {
    ...userEv('sess:answers:text', 1_000, ''),
    sideChatReplies: ['Sort by date first.'],
  };
  const seeded = withLive([echo]);

  const next = applyHistory(seeded, [persisted]);

  assert.deepEqual(transcriptIds(next), ['sess:answers:text']);
});

test('#29 replace and prepend supersede a skill-only echo with empty raw text', () => {
  const echo: TranscriptEvent = {
    id: 'local-skill-only',
    appSessionId: 'm1',
    sourceSessionId: 'user',
    role: 'primary',
    kind: 'text',
    text: '',
    ts: 500,
    author: 'user',
    skills: ['debugger'],
  };
  const persisted = userEv('sess:skill:text', 1_000, '/debugger');
  const seeded = withLive([echo]);

  const replaced = applyHistory(seeded, [persisted]);
  const prepended = applyHistory(seeded, [persisted], { mode: 'prepend' });

  assert.deepEqual(transcriptIds(replaced), ['sess:skill:text']);
  assert.deepEqual(transcriptIds(prepended), ['sess:skill:text']);
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
