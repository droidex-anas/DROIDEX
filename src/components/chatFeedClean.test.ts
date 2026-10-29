import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupedFeed } from './chatFeedTurns';
import { designWorkingLabel } from './chatFeedClean';
import type { FeedItem } from './chatFeed';
import type { TranscriptEvent } from '../types/bridge';

let seq = 0;
function ev(extra: Partial<TranscriptEvent>): TranscriptEvent {
  seq += 1;
  return {
    id: `e${String(seq)}`,
    appSessionId: 'chat',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: seq,
    kind: 'text',
    ...extra,
  };
}

const user = (text: string) => ev({ author: 'user', text });
const reply = (text: string) => ev({ text });
const read = (toolUseId: string) => [
  ev({ kind: 'tool_call', toolName: 'Read', toolUseId, toolArgs: { path: 'a.ts' } }),
  ev({ kind: 'tool_result', toolUseId, text: 'ok' }),
];
function canvasCreate(toolUseId: string, state: 'running' | 'completed' | 'failed') {
  return ev({
    kind: state === 'running' ? 'tool_call' : 'tool_result',
    toolUseId,
    isError: state === 'failed' || undefined,
    canvasActivity: {
      toolUseId,
      action: 'create',
      designIds: ['dsg_card'],
      state,
      message: 'Created a card',
      ...(state === 'completed' ? { canvasId: 'cv_1' } : {}),
    },
  });
}

function shape(items: FeedItem[]): string[] {
  return items.map((item) =>
    item.type === 'message'
      ? `${item.event.author ?? 'agent'}: ${item.event.text ?? ''}`
      : item.type,
  );
}

test('a design chat shows the prompts, its designs and the answers, never the work between', () => {
  const events = [
    user('Design a pricing card'),
    ev({ kind: 'thinking', text: 'Three tiers…' }),
    reply('Let me look at the design system first.'),
    ...read('read-1'),
    canvasCreate('create-1', 'running'),
    canvasCreate('create-1', 'completed'),
    reply('Here is the pricing card.'),
    user('Make it darker'),
    reply('Reading the card again.'),
    ...read('read-2'),
  ];

  assert.deepEqual(shape(buildGroupedFeed(events, true, { clean: true })), [
    'user: Design a pricing card',
    'canvas_artifact',
    'agent: Here is the pricing card.',
    'user: Make it darker',
  ]);
});

test('the live cue names the design step the running turn is on', () => {
  const prompt = user('Design a pricing card');
  assert.equal(designWorkingLabel([prompt]), 'Thinking the design');
  assert.equal(
    designWorkingLabel([prompt, ev({ kind: 'thinking', text: '…' })]),
    'Thinking the design',
  );
  assert.equal(designWorkingLabel([prompt, ...read('r')]), 'Designing');
  assert.equal(designWorkingLabel([prompt, canvasCreate('c', 'failed')]), 'Fixing');
  assert.equal(
    designWorkingLabel([prompt, canvasCreate('c', 'completed'), ...read('r')]),
    'Iterating',
  );
  assert.equal(designWorkingLabel([prompt, reply('Here it is')]), 'Writing');
});
