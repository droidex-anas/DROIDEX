import assert from 'node:assert/strict';
import test from 'node:test';

import { collabChildSignals, threadItem, toolCall, toolOutput } from './codexItems.js';

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

// An app tool that answered Codex with a picture comes back in the finished
// item the same way; the item is kept and the picture becomes a saved file.
test('a finished app tool keeps the picture it answered with', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]).toString('base64');
  const item = threadItem({
    item: {
      type: 'dynamicToolCall',
      id: 'item-2',
      namespace: 'droidex-browser',
      tool: 'browser_screenshot',
      arguments: {},
      status: 'completed',
      success: true,
      contentItems: [
        { type: 'inputText', text: 'Screenshot of the viewport.' },
        { type: 'inputImage', imageUrl: `data:image/jpeg;base64,${jpeg}` },
      ],
    },
  });
  assert.equal(item.type, 'dynamicToolCall');
  const { text, images } = toolOutput(item, '', 'app-1');
  assert.equal(text, 'Screenshot of the viewport.');
  assert.match(images?.[0] ?? '', /tool-[0-9a-f]{32}\.jpg$/);
});
