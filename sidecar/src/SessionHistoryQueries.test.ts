import assert from 'node:assert/strict';
import test from 'node:test';

import type { HistorySearchReply, ServerEvent } from './protocol.js';
import { SessionHistoryQueries } from './SessionHistoryQueries.js';

function createQueries(
  searchSessions: (query: string, isStale?: () => boolean) => Promise<HistorySearchReply>,
) {
  const events: ServerEvent[] = [];
  const queries = new SessionHistoryQueries({
    searchSessions,
    resolveSummary: () => undefined,
    emit: (event) => events.push(event),
  });
  return { queries, events };
}

test('sessions.search answers the requester with indexed results and their completeness', async () => {
  const results = [
    {
      appSessionId: 'app-1',
      matches: [{ snippet: '…hi bro whatsapp…', author: 'user' as const, ts: 1_700_000_000_000 }],
    },
  ];
  const queried: string[] = [];
  const { queries, events } = createQueries((query) => {
    queried.push(query);
    return Promise.resolve({ results, indexingIncomplete: true });
  });

  await queries.search({ type: 'sessions.search', requestId: 'req-7', query: 'whatsapp' });

  assert.deepEqual(queried, ['whatsapp']);
  assert.deepEqual(events, [
    { type: 'sessions.searchResults', requestId: 'req-7', results, indexingIncomplete: true },
  ]);
});

test('a superseded sessions.search scan does not emit its results', async () => {
  // Gate the scan so the newer query lands while the older one is in flight;
  // determinism comes from the gate, not from timing.
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { queries, events } = createQueries(async (_query, isStale) => {
    await gate;
    return {
      results: isStale?.()
        ? []
        : [{ appSessionId: 'app-1', matches: [{ snippet: 'hit', author: 'user', ts: 1 }] }],
      indexingIncomplete: false,
    };
  });

  const first = queries.search({ type: 'sessions.search', requestId: 'req-1', query: 'a' });
  const second = queries.search({ type: 'sessions.search', requestId: 'req-2', query: 'ab' });
  release();
  await Promise.all([first, second]);

  assert.deepEqual(
    events.map((event) => event.type === 'sessions.searchResults' && event.requestId),
    ['req-2'],
  );
});
