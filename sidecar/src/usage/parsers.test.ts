import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createClaudeUsageParserState,
  createCodexUsageParserState,
  parseClaudeUsageRecord,
  parseCodexUsageRecord,
  restoreUsageParserState,
  type UsageSourcePosition,
  type UsageTokenCounts,
} from './parsers.js';

const position: UsageSourcePosition = {
  sourceId: 'fixture-source',
  recordStartByte: 0,
  recordEndByte: 1,
};

test('Claude normalizes cache subsets without retaining content and deduplicates restarts', () => {
  const privateText = 'PRIVATE_PROMPT_MUST_NOT_SURVIVE';
  const row = {
    type: 'assistant',
    timestamp: '2026-10-14T10:00:00.000Z',
    sessionId: 'claude-session',
    cwd: '/fixture/project',
    requestId: 'request-1',
    message: {
      id: 'message-1',
      model: 'claude-fixture',
      content: [{ type: 'text', text: privateText }],
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 5,
        output_tokens: 40,
        output_tokens_details: { thinking_tokens: 10 },
      },
    },
  };

  const first = parseClaudeUsageRecord(row, createClaudeUsageParserState(), position);
  assert.equal(first.events.length, 1);
  assert.deepEqual(first.events[0], {
    dedupeKey: first.events[0]?.dedupeKey,
    harnessId: 'claude-code',
    harnessDisplayName: 'Claude Code',
    sourceId: 'fixture-source',
    sessionId: 'claude-session',
    project: '/fixture/project',
    sessionStartedAtMs: null,
    tsMs: Date.parse('2026-10-14T10:00:00.000Z'),
    model: 'claude-fixture',
    serviceTier: null,
    inputTokens: 125,
    outputTokens: 40,
    cacheWriteTokens: 5,
    cacheReadTokens: 20,
    reasoningTokens: 10,
    providerCostMicrousd: null,
    estimatedCostMicrousd: null,
    pricingVersion: null,
  });
  assert.equal(JSON.stringify(first.events).includes(privateText), false);
  assert.deepEqual(parseClaudeUsageRecord(row, first.state, position).events, []);

  const sidechain = parseClaudeUsageRecord(
    {
      ...row,
      isSidechain: true,
      requestId: 'sidechain-request',
      message: { ...row.message, id: 'sidechain-message' },
    },
    first.state,
    position,
  );
  assert.equal(sidechain.events.length, 1);
  assert.equal(sidechain.events[0]?.reasoningTokens, 10);

  const withoutProviderIds = {
    ...row,
    requestId: undefined,
    message: { ...row.message, id: undefined },
  };
  const firstFallback = parseClaudeUsageRecord(
    {
      ...withoutProviderIds,
      message: {
        ...withoutProviderIds.message,
        content: [{ type: 'text', text: 'first private response' }],
      },
    },
    createClaudeUsageParserState(),
    position,
  );
  const secondFallback = parseClaudeUsageRecord(
    {
      ...withoutProviderIds,
      message: {
        ...withoutProviderIds.message,
        content: [{ type: 'text', text: 'different private response' }],
      },
    },
    createClaudeUsageParserState(),
    position,
  );
  assert.equal(firstFallback.events[0]?.dedupeKey, secondFallback.events[0]?.dedupeKey);
});

test('Codex preserves model state, uses per-call usage, and derives cumulative resets safely', () => {
  let state = createCodexUsageParserState();
  state = parseCodexUsageRecord(
    {
      type: 'session_meta',
      timestamp: '2026-10-14T10:00:00Z',
      payload: { id: 'codex-session', cwd: '/fixture/codex' },
    },
    state,
    position,
  ).state;
  state = parseCodexUsageRecord(
    {
      type: 'turn_context',
      payload: { model: 'gpt-fixture', service_tier: 'priority' },
    },
    state,
    position,
  ).state;

  const perCallRow = tokenCountRow('2026-10-14T10:01:00Z', {
    total_token_usage: codexCounts(900, 90, 300, 30),
    last_token_usage: codexCounts(300, 50, 120, 20),
  });
  const perCall = parseCodexUsageRecord(perCallRow, state, position);
  assert.deepEqual(pickCounts(perCall.events[0]), {
    inputTokens: 300,
    outputTokens: 50,
    cacheWriteTokens: null,
    cacheReadTokens: 120,
    reasoningTokens: 20,
  });
  assert.equal(perCall.events[0]?.model, 'gpt-fixture');
  assert.equal(perCall.events[0]?.serviceTier, 'priority');
  assert.deepEqual(parseCodexUsageRecord(perCallRow, perCall.state, position).events, []);

  const delta = parseCodexUsageRecord(
    tokenCountRow('2026-10-14T10:02:00Z', {
      total_token_usage: codexCounts(950, 105, 330, 35),
    }),
    perCall.state,
    position,
  );
  assert.deepEqual(
    pickCounts(delta.events[0]),
    pickCounts({
      inputTokens: 50,
      outputTokens: 15,
      cacheReadTokens: 30,
      cacheWriteTokens: null,
      reasoningTokens: 5,
    }),
  );

  const reset = parseCodexUsageRecord(
    tokenCountRow('2026-10-14T10:03:00Z', {
      total_token_usage: codexCounts(10, 4, 2, 1),
    }),
    delta.state,
    position,
  );
  assert.deepEqual(pickCounts(reset.events[0]), {
    inputTokens: 10,
    outputTokens: 4,
    cacheWriteTokens: null,
    cacheReadTokens: 2,
    reasoningTokens: 1,
  });
  assert.deepEqual(restoreUsageParserState('codex', JSON.stringify(reset.state)), reset.state);
});

test('Codex reads provider usage records and suppresses their legacy notification', () => {
  let state = createCodexUsageParserState();
  state = parseCodexUsageRecord(
    {
      type: 'session_meta',
      timestamp: '2026-10-14T11:00:00Z',
      payload: { id: 'codex-thread', session_id: 'app-session', cwd: '/fixture/codex' },
    },
    state,
    position,
  ).state;
  state = parseCodexUsageRecord(
    {
      type: 'session_meta',
      timestamp: '2026-10-14T11:00:01Z',
      payload: { id: 'app-session', session_id: 'app-session', cwd: '/fixture/codex' },
    },
    state,
    position,
  ).state;
  state = parseCodexUsageRecord(
    { type: 'turn_context', payload: { model: 'gpt-current' } },
    state,
    position,
  ).state;

  const current = parseCodexUsageRecord(
    {
      type: 'token_usage_record',
      timestamp: '2026-10-14T11:01:00Z',
      payload: {
        response_id: 'response-current',
        session_id: 'app-session',
        thread_id: 'codex-thread',
        turn_id: 'turn-current',
        usage: codexCounts(300, 50, 120, 20, 7),
        turn_token_usage: codexCounts(300, 50, 120, 20, 7),
        thread_token_usage: codexCounts(900, 90, 300, 30, 7),
      },
    },
    state,
    position,
  );
  assert.deepEqual(pickCounts(current.events[0]), {
    inputTokens: 300,
    outputTokens: 50,
    cacheWriteTokens: 7,
    cacheReadTokens: 120,
    reasoningTokens: 20,
  });
  assert.equal(current.events[0]?.sessionId, 'codex-thread');
  assert.equal(current.events[0]?.model, 'gpt-current');

  const duplicateNotification = parseCodexUsageRecord(
    tokenCountRow('2026-10-14T11:01:01Z', {
      total_token_usage: codexCounts(900, 90, 300, 30),
      last_token_usage: codexCounts(300, 50, 120, 20),
    }),
    current.state,
    position,
  );
  assert.deepEqual(duplicateNotification.events, []);

  const overlappingIdentity = parseCodexUsageRecord(
    tokenCountRow('2026-10-14T11:01:02Z', {
      response_id: 'response-current',
      total_token_usage: codexCounts(950, 100, 320, 35, 9),
      last_token_usage: codexCounts(50, 10, 20, 5, 2),
    }),
    current.state,
    position,
  );
  assert.deepEqual(overlappingIdentity.events, []);
});

test('Codex preserves per-field cumulative baselines across unknown gaps and resets', () => {
  let state = createCodexUsageParserState();
  state = parseCodexUsageRecord(
    {
      type: 'session_meta',
      timestamp: '2026-10-14T12:00:00Z',
      payload: { id: 'gap-session', model: 'gpt-gap' },
    },
    state,
    position,
  ).state;
  const first = parseCodexUsageRecord(
    tokenCountRow('2026-10-14T12:01:00Z', {
      total_token_usage: codexCounts(100, 50, 20, 10, 5),
    }),
    state,
    position,
  );
  const gap = parseCodexUsageRecord(
    tokenCountRow('2026-10-14T12:02:00Z', { total_token_usage: {} }),
    first.state,
    position,
  );
  assert.deepEqual(gap.events, []);

  const resumed = parseCodexUsageRecord(
    tokenCountRow('2026-10-14T12:03:00Z', {
      total_token_usage: codexCounts(120, 10, 25, 12, 7),
    }),
    gap.state,
    position,
  );
  assert.deepEqual(pickCounts(resumed.events[0]), {
    inputTokens: 20,
    outputTokens: 10,
    cacheWriteTokens: 2,
    cacheReadTokens: 5,
    reasoningTokens: 2,
  });
});

function tokenCountRow(timestamp: string, info: Record<string, unknown>) {
  return { type: 'event_msg', timestamp, payload: { type: 'token_count', info } };
}

function codexCounts(
  input: number,
  output: number,
  cached: number,
  reasoning: number,
  cacheWrite?: number,
) {
  return {
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: cached,
    reasoning_output_tokens: reasoning,
    ...(cacheWrite === undefined ? {} : { cache_write_input_tokens: cacheWrite }),
  };
}

function pickCounts(value: Partial<UsageTokenCounts> | undefined) {
  return {
    inputTokens: value?.inputTokens,
    outputTokens: value?.outputTokens,
    cacheWriteTokens: value?.cacheWriteTokens,
    cacheReadTokens: value?.cacheReadTokens,
    reasoningTokens: value?.reasoningTokens,
  };
}
