import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupedFeed } from './chatFeedTurns';
import { designWorkingStatus } from './chatFeedClean';
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

test('a design chat shows the prompts, the answers and their designs, never the work between', () => {
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
    'agent: Here is the pricing card.',
    'canvas_artifact',
    'user: Make it darker',
  ]);
});

test('a finished turn that used the browser keeps its answer', () => {
  const events = [
    user('Make a design system from example.com'),
    ev({
      kind: 'tool_call',
      toolName: 'droidex-browser___browser_open',
      toolUseId: 'open',
      toolArgs: { url: 'https://example.com' },
    }),
    ev({ kind: 'tool_result', toolUseId: 'open', text: 'Opened the page.' }),
    reply('I created the Example design system.'),
  ];

  assert.deepEqual(shape(buildGroupedFeed(events, false, { clean: true })), [
    'user: Make a design system from example.com',
    'agent: I created the Example design system.',
  ]);
});

test('the status line names what the running turn is doing', () => {
  const prompt = user('Design a pricing card');
  const label = (...turn: TranscriptEvent[]) => designWorkingStatus([prompt, ...turn]).label;
  assert.equal(label(), 'Thinking');
  assert.equal(label(ev({ kind: 'thinking', text: '…' })), 'Thinking');
  assert.equal(label(read('r')[0]), 'Reading');
  assert.equal(label(...read('r')), 'Thinking');
  assert.equal(label(canvasCreate('c', 'running')), 'Drawing the design');
  assert.equal(label(canvasCreate('c', 'failed')), 'Fixing a problem');
  assert.equal(label(reply('Here it is')), 'Writing');
});

test('the status line carries the step the turn plan is on until the plan is done', () => {
  const plan = (todos: string) =>
    ev({ kind: 'tool_call', toolName: 'TodoWrite', toolArgs: { todos } });
  const prompt = user('Design a pricing card');
  assert.deepEqual(
    designWorkingStatus([
      prompt,
      plan('1. [completed] Read the kit\n2. [in_progress] Draw the tiers\n3. [pending] Polish'),
      ...read('r'),
    ]),
    { label: 'Thinking', step: { text: 'Draw the tiers', number: 2, total: 3 } },
  );
  assert.deepEqual(designWorkingStatus([prompt, plan('1. [completed] Read the kit')]), {
    label: 'Planning',
  });
  // A plan from an earlier turn is not this turn's.
  assert.deepEqual(designWorkingStatus([plan('1. [in_progress] Old'), prompt]), {
    label: 'Thinking',
  });
});
