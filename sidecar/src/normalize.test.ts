import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyPermission,
  confirmationType,
  extractCompactionNotification,
  mapProgress,
  normalizeNotification,
  permissionSignature,
  normalizeStreamEvent,
} from './normalize.js';

function stream(event: Record<string, unknown>) {
  return normalizeStreamEvent('app-session-1', 'app-session-1', 'primary', event as never);
}

function result(toolName: string | undefined, toolUseId: string, content: string, isError = false) {
  return stream({ type: 'tool_result', toolName, toolUseId, content, isError });
}

function userMessage(message: Record<string, unknown>) {
  return normalizeNotification('parent', 'parent', 'primary', {
    params: { notification: { type: 'create_message', message: { role: 'user', ...message } } },
  });
}

test('mapProgress keeps Mission provider and spawn correlation internal for policy projection', () => {
  assert.deepEqual(
    mapProgress([
      {
        type: 'worker_started',
        timestamp: '2026-07-29T00:00:00.000Z',
        workerSessionId: 'provider-worker',
        spawnId: 'spawn-1',
        featureId: 'feature-1',
      },
    ] as never),
    [
      {
        type: 'worker_started',
        timestamp: '2026-07-29T00:00:00.000Z',
        title: undefined,
        message: undefined,
        featureId: 'feature-1',
        workerProviderSessionId: 'provider-worker',
        spawnId: 'spawn-1',
      },
    ],
  );
});

test('extractCompactionNotification reads the daemon compaction start and completion only', () => {
  const extract = (notification: Record<string, unknown>) =>
    extractCompactionNotification({ params: { notification } });
  assert.deepEqual(
    extract({ type: 'droid_working_state_changed', newState: 'compacting_conversation' }),
    { kind: 'started', removedCount: 0 },
  );
  assert.deepEqual(extract({ type: 'session_compacted', summaryId: 's1', removedCount: 42 }), {
    kind: 'completed',
    removedCount: 42,
    summaryId: 's1',
  });
  // A missing or malformed count falls back to zero instead of NaN.
  assert.deepEqual(extract({ type: 'session_compacted', summaryId: 's1' }), {
    kind: 'completed',
    removedCount: 0,
    summaryId: 's1',
  });
  assert.equal(extract({ type: 'droid_working_state_changed', newState: 'thinking' }), null);
  assert.equal(extract({ type: 'message', role: 'assistant' }), null);
  assert.equal(extractCompactionNotification({}), null);
});

test('only a terminal background-task notification completes its child', () => {
  const background = (text: string) =>
    userMessage({ id: 'background-1', content: [{ type: 'text', text }] });
  assert.deepEqual(
    background('Background task completed.\ntask_id: child-background-1\noutput: done'),
    [{ childSession: { providerSessionId: 'child-background-1', done: true } }],
  );
  assert.deepEqual(background('Background task launched.\ntask_id: child-1'), []);
});

test('user create_message notifications reach the transcript only as parsed harness signals', () => {
  const activation = userMessage({
    id: 'skill-activation-1',
    visibility: 'user_only',
    content: [{ type: 'text', text: 'Skill "review" activated: PR #100' }],
  });
  // A skill activation is harness output and never echoes the prompt as the user's.
  assert.equal(activation.length, 1);
  assert.equal(activation[0].transcript?.author, undefined);
  assert.equal(activation[0].transcript?.text, 'Skill "review" activated: PR #100');

  // Internal skill bodies arrive through this generic shape and stay off the chat.
  const instructions = userMessage({
    id: 'skill-instructions-1',
    content: [
      { type: 'text', text: '<system-notification>private skill body</system-notification>' },
    ],
  });
  assert.deepEqual(instructions, []);
});

test('token usage counts context the way the daemon threshold does, never from cumulative usage', () => {
  // The daemon's compaction threshold checks last-call input + output +
  // cacheRead (never cacheCreation), so the meter must count the same way.
  const lastCall = stream({
    type: 'session_token_usage_changed',
    inclusiveTokenUsage: {
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 30,
      cacheCreationTokens: 20,
    },
    lastCallTokenUsage: {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
    },
  });
  assert.deepEqual(lastCall?.tokens, { tokensIn: 150, tokensOut: 40, contextTokens: 17 });

  const cumulative = stream({
    type: 'session_token_usage_changed',
    inclusiveTokenUsage: {
      inputTokens: 1_235_355,
      outputTokens: 242_687,
      cacheReadTokens: 12_864_536,
      cacheCreationTokens: 0,
    },
    tokenUsage: {
      inputTokens: 979_933,
      outputTokens: 179_985,
      cacheReadTokens: 11_945_488,
      cacheCreationTokens: 0,
    },
  });
  assert.deepEqual(cumulative?.tokens, { tokensIn: 14_099_891, tokensOut: 242_687 });
});

test('classifyPermission reads the SDK toolUses shape for MCP tools and exec', () => {
  const mcp = {
    options: [{ value: 'proceed_once', label: 'Allow once' }],
    toolUses: [
      {
        confirmationType: 'mcp_tool',
        details: {
          type: 'mcp_tool',
          toolName: 'droidmaxx-browser___design_reference',
          impactLevel: 'low',
        },
        toolUse: {
          type: 'tool_use',
          id: 't1',
          name: 'droidmaxx-browser___design_reference',
          input: { url: 'https://skeina.app' },
        },
      },
    ],
  } as never;
  assert.equal(confirmationType(mcp), 'mcp_tool');
  const tool = classifyPermission('m1', 'r1', mcp);
  assert.equal(tool.kind, 'mcp');
  assert.equal(tool.title, 'droidmaxx-browser · design_reference');
  assert.match(tool.detail, /url: https:\/\/skeina\.app/);
  assert.match(tool.detail, /Impact: low/);
  assert.equal(permissionSignature(mcp), 'mcp::::droidmaxx-browser___design_reference');

  const exec = {
    options: [],
    toolUses: [
      {
        confirmationType: 'exec',
        details: { type: 'exec', command: 'rtk', fullCommand: 'rtk rm -rf build' },
        toolUse: {
          type: 'tool_use',
          id: 't2',
          name: 'Execute',
          input: { command: 'rtk rm -rf build' },
        },
      },
    ],
  } as never;
  const command = classifyPermission('m1', 'r2', exec);
  assert.equal(command.kind, 'exec');
  assert.equal(command.title, 'Run command');
  assert.equal(command.detail, 'rtk rm -rf build');
  assert.equal(permissionSignature(exec), 'exec::rtk rm -rf build');
});

test('permission grant keys hash automation payloads and name the kind of chat a spawn starts', () => {
  const params = (details: Record<string, unknown>, input: Record<string, unknown>) =>
    ({ toolUses: [{ details: { type: 'mcp_tool', ...details }, toolUse: { input } }] }) as never;
  const automation = { serverName: 'droidex-automations', toolName: 'automation_update' };
  const prefix = 'x'.repeat(9_000);
  // A grant for one automation payload must not cover a different one.
  assert.notEqual(
    permissionSignature(params(automation, { prompt: `${prefix}a` })),
    permissionSignature(params(automation, { prompt: `${prefix}b` })),
  );

  const spawn = (input: Record<string, unknown>) =>
    permissionSignature(params({ toolName: 'droidex_sessions___thread_spawn' }, input));
  assert.equal(spawn({ reportBack: true }), 'mcp::::droidex_sessions___thread_spawn::thread');
  assert.equal(spawn({ reportBack: false }), 'mcp::::droidex_sessions___thread_spawn::chat');
  assert.equal(spawn({}), '');
});

test('captures Task prompt metadata before the subagent session id exists', () => {
  const normalized = stream({
    type: 'tool_call',
    toolUse: {
      id: 'tool-1',
      name: 'Task',
      input: {
        subagent_type: 'code-reviewer',
        description: 'Review the patch',
        prompt: 'Inspect the current diff and report correctness risks.',
      },
    },
  });

  assert.equal(normalized?.childSession?.label, 'code-reviewer');
  assert.equal(
    normalized?.childSession?.prompt,
    'Inspect the current diff and report correctness risks.',
  );
  assert.equal(normalized?.childSession?.toolUseId, 'tool-1');
  // The spawn's transcript copy must carry the tool_call id so the chat feed
  // can collapse streaming deltas into one line and link it to the worker.
  assert.equal(normalized?.transcript?.kind, 'tool_call');
  assert.equal(normalized?.transcript?.toolUseId, 'tool-1');
});

test('stamps toolUseId on ordinary (non-subagent) tool_call and tool_result transcripts', () => {
  const call = stream({
    type: 'tool_call',
    toolUse: {
      id: 'edit-1',
      name: 'edit',
      input: { path: 'src/app.ts', old_string: 'a', new_string: 'b' },
    },
  });
  const done = result('edit', 'edit-1', 'ok');
  for (const [normalized, kind] of [
    [call, 'tool_call'],
    [done, 'tool_result'],
  ] as const) {
    assert.equal(normalized?.childSession, undefined);
    assert.equal(normalized?.transcript?.kind, kind);
    assert.equal(normalized?.transcript?.toolUseId, 'edit-1');
  }
});

test('Task progress forwards the subagent id, linking it only from a spawn', () => {
  const spawn = stream({
    type: 'tool_progress',
    toolUseId: 'tool-1',
    update: { subagentSessionId: 'worker-1', parameters: { subagent_type: 'code-reviewer' } },
  });
  assert.equal(spawn?.childSession?.providerSessionId, 'worker-1');
  assert.equal(spawn?.childSession?.label, 'code-reviewer');
  assert.equal(spawn?.childSession?.toolUseId, 'tool-1');

  // A TaskOutput poll's progress lacks spawn params: its call id must not
  // become the child's spawn link.
  const poll = stream({
    type: 'tool_progress',
    toolUseId: 'poll-1',
    update: { subagentSessionId: 'worker-1' },
  });
  assert.equal(poll?.childSession?.providerSessionId, 'worker-1');
  assert.equal(poll?.childSession?.toolUseId, undefined);
});

test('registers a background subagent at launch instead of completion', () => {
  const normalized = result(
    'Task',
    'spawn-1',
    'Task launched in background.\ntask_id: 7d32cc8f-77d5\nsession_id: 7d32cc8f-77d5\n\nUse TaskOutput to read output.',
  );
  assert.equal(normalized?.childSession?.providerSessionId, '7d32cc8f-77d5');
  assert.equal(normalized?.childSession?.done, false);
  // The launch acknowledgement is keyed by the spawning tool_use id.
  assert.equal(normalized?.childSession?.toolUseId, 'spawn-1');
  assert.equal(normalized?.transcript, undefined);
});

test('a TaskOutput poll completes a child only on a terminal status, without stealing its link', () => {
  const poll = (content: string) => result('TaskOutput', 'poll-1', content);
  const completed = poll(
    'Task ID: 7d32cc8f-77d5\nSubagent Type: Worker\nDescription: survey\nStatus: completed\nDuration: 208.3s\n\n<report>',
  );
  const running = poll(
    'Task ID: 7d32cc8f-77d5\nSubagent Type: Worker\nStatus: running\nDuration: 12.0s',
  );
  assert.equal(completed?.childSession?.providerSessionId, '7d32cc8f-77d5');
  assert.equal(completed?.childSession?.done, true);
  assert.equal(running?.childSession?.done, false);
  // The polling call's tool_use id is not the spawn; forwarding it would rekey
  // the child session away from its true spawn link.
  assert.equal(completed?.childSession?.toolUseId, undefined);
  assert.equal(running?.childSession?.toolUseId, undefined);
  // Poll results stay visible in the feed; only the child signal is added.
  assert.equal(completed?.transcript?.kind, 'tool_result');

  // A long description must not push the status line out of the header window.
  const long = poll(
    `Task ID: 7d32cc8f-77d5\nSubagent Type: Worker\nDescription: ${'survey the sidecar '.repeat(40)}\nStatus: running\nDuration: 12.0s\n\nstill reading`,
  );
  assert.equal(long?.childSession?.done, false);
  // Without a status the poll says nothing about completion, so the child keeps
  // running instead of having its clock stopped on a guess.
  assert.equal(
    poll('Task ID: 7d32cc8f-77d5\nSubagent Type: Worker\n\nstill reading')?.childSession?.done,
    false,
  );
  // The header ends at the blank line, CRLF or not; the body's own
  // "Status: completed" line belongs to the subagent's report.
  const crlf = poll(
    'Task ID: 7d32cc8f-77d5\r\nSubagent Type: Worker\r\nDuration: 12.0s\r\n\r\nStatus: completed\r\nstill reading',
  );
  assert.equal(crlf?.childSession?.done, false);
  assert.equal(crlf?.childSession?.activity?.preview, 'still reading');
});

test('a poll result carries the subagent activity it observed', () => {
  const poll = (content: string) => result('TaskOutput', 'poll-1', content);
  const running = poll(
    'Task ID: 7d32cc8f-77d5\nSubagent Type: Worker\nStatus: running\nDuration: 12.0s\n\nSearching the sidecar for the admit path',
  );
  // An autonomous child streams nothing to the parent, so this poll is the only
  // place the UI can learn what it is doing.
  assert.equal(running?.childSession?.activity?.phase, 'Running');
  assert.equal(
    running?.childSession?.activity?.preview,
    'Searching the sidecar for the admit path',
  );

  // Header-only polls still report the phase, and never invent a preview from
  // their own header lines.
  const headerOnly = poll('Task ID: 7d32cc8f-77d5\nStatus: running\n');
  assert.equal(headerOnly?.childSession?.activity?.phase, 'Running');
  assert.equal(headerOnly?.childSession?.activity?.preview, undefined);

  // Every report field is header, including the ones that trail the status.
  const emptyBody = poll(
    'Task ID: 7d32cc8f-77d5\nSubagent Type: Worker\nDescription: survey the sidecar\nStatus: running\nDuration: 12.0s\n\n',
  );
  assert.equal(emptyBody?.childSession?.activity?.preview, undefined);

  // A spawn result is the child's report, not an activity observation.
  assert.equal(
    result('Task', 'tool-1', 'session_id: real-child\n\n<report>')?.childSession?.activity,
    undefined,
  );
});

test('Task result text is never misparsed as a session id or a status', () => {
  // A report body mentioning statuses or task ids.
  const report = result(
    'Task',
    'tool-1',
    'session_id: real-child\n\nFindings:\nStatus: running\nTask ID: unrelated',
  );
  assert.equal(report?.childSession?.providerSessionId, 'real-child');
  assert.equal(report?.childSession?.done, true);
  assert.equal(report?.childSession?.toolUseId, 'tool-1');

  // Child output and a failed spawn's text are not the provider session id.
  const laterOutput = result('Task', 'tool-later', 'child output\nsession_id: fake-provider');
  const failed = result('Task', 'tool-failed', 'session_id: fake-provider\nspawn failed', true);
  assert.equal(laterOutput?.childSession?.providerSessionId, undefined);
  assert.equal(failed?.childSession?.providerSessionId, undefined);
});

test('only Task-family results can describe a subagent', () => {
  // A log, a paste, or a grep hit can open with these exact lines; treating it
  // as a poll would mint a phantom running subagent nobody spawned.
  const shellOutput = result('Bash', 'bash-1', 'Task ID: not-a-subagent\nStatus: running\n');
  assert.equal(shellOutput?.childSession, undefined);
  assert.equal(shellOutput?.transcript?.kind, 'tool_result');

  // A result whose tool name never made it through still parses: dropping those
  // would lose real subagent completions.
  const unnamed = result(undefined, 'poll-1', 'Task ID: 7d32cc8f-77d5\nStatus: completed\n');
  assert.equal(unnamed?.childSession?.providerSessionId, '7d32cc8f-77d5');
  assert.equal(unnamed?.childSession?.done, true);
});
