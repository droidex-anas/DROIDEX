import assert from 'node:assert/strict';
import test from 'node:test';

import { collabChildSignals, threadItem, toolCall } from './codexItems.js';

const spawn = {
  type: 'collabAgentToolCall',
  id: 'item-1',
  tool: 'spawnAgent',
  status: 'inProgress',
  senderThreadId: 'thread-parent',
  receiverThreadIds: ['thread-child'],
  prompt: 'Read every file in the diff and report what is wrong.',
  model: 'gpt-5-codex',
  reasoningEffort: 'low',
  agentsStates: {},
};

// The brief belongs to the agent it was given to. It reaches that agent's own
// pane as a prompt row, so the parent's transcript keeps no second copy.
test('a spawn keeps its brief out of the parent transcript and on the child', () => {
  const item = threadItem({ item: spawn });

  assert.deepEqual(toolCall(item)?.args, {});
  assert.deepEqual(
    collabChildSignals(item, {}).map((signal) => [signal.providerSessionId, signal.prompt]),
    [['thread-child', spawn.prompt]],
  );
});
