import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupedFeed } from './chatFeedTurns';
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

type Activity = NonNullable<TranscriptEvent['canvasActivity']>;

function canvasTool(
  toolUseId: string,
  action: Activity['action'],
  designIds: string[],
  outcome: 'completed' | 'failed' = 'completed',
): TranscriptEvent[] {
  const activity = { toolUseId, action, designIds, message: `${action} done` };
  return [
    ev({
      kind: 'tool_call',
      toolName: `canvas_${action}`,
      toolUseId,
      canvasActivity: { ...activity, state: 'running' },
    }),
    ev({
      kind: 'tool_result',
      toolUseId,
      text: '{}',
      isError: outcome === 'failed' || undefined,
      canvasActivity: {
        ...activity,
        state: outcome,
        ...(outcome === 'completed' ? { canvasId: 'cv_1' } : {}),
      },
    }),
  ];
}

const user = (text: string) => ev({ kind: 'text', author: 'user', text });
const answer = (text: string) => ev({ kind: 'text', text });

function cards(items: FeedItem[]): string[] {
  return items.flatMap((item) =>
    item.type === 'canvas_artifact' ? [item.activity.designIds.join()] : [],
  );
}

function folded(items: FeedItem[]): FeedItem[] {
  return items.flatMap((item) => (item.type === 'worked' ? item.items : []));
}

test('a design the turn made stays a card beside the answer once the turn folds', () => {
  const events = [
    user('Design a pricing page'),
    ev({ kind: 'tool_call', toolName: 'Read', toolUseId: 'read', toolArgs: { path: 'a.ts' } }),
    ev({ kind: 'tool_result', toolUseId: 'read', text: 'ok' }),
    ...canvasTool('create', 'create', ['dsg_pricing']),
    ...canvasTool('write', 'write', ['dsg_pricing']),
    answer('Here is the pricing page.'),
  ];
  const items = buildGroupedFeed(events, false);

  assert.deepEqual(cards(items), ['dsg_pricing']);
  assert.deepEqual(cards(folded(items)), []);
  // The write that filled the design is a step along the way, so it folds.
  const foldedTools = folded(items).flatMap((item) => (item.type === 'tools' ? item.events : []));
  assert.ok(foldedTools.some((event) => event.toolUseId === 'write'));
  assert.ok(!foldedTools.some((event) => event.toolUseId === 'create'));
});

test('a call that made nothing gets no card, and a later turn shows its design again', () => {
  const events = [
    user('Make a hero'),
    ...canvasTool('broken', 'create', ['dsg_hero'], 'failed'),
    ...canvasTool('create', 'create', []),
    answer('That did not work.'),
    user('Try writing the hero again'),
    ...canvasTool('write-1', 'write', ['dsg_hero']),
    ...canvasTool('write-2', 'write', ['dsg_hero']),
    answer('Done.'),
  ];
  const items = buildGroupedFeed(events, false);

  assert.deepEqual(cards(items), ['dsg_hero']);
  const card = items.find((item) => item.type === 'canvas_artifact');
  assert.equal(card?.type === 'canvas_artifact' && card.activity.toolUseId, 'write-1');
});

test('replay that batches calls before results keeps the card and the other tool together', () => {
  const [createCall, createResult] = canvasTool('create', 'create', ['dsg_menu']);
  const readCall = ev({ kind: 'tool_call', toolName: 'Read', toolUseId: 'read', toolArgs: {} });
  const readResult = ev({ kind: 'tool_result', toolUseId: 'read', text: 'ok' });
  const items = buildGroupedFeed(
    [user('Design a menu'), createCall, readCall, createResult, readResult],
    true,
  );

  assert.deepEqual(
    items.map((item) => item.type),
    ['message', 'canvas_artifact', 'tools'],
  );
  const group = items.at(-1);
  assert.deepEqual(group?.type === 'tools' && group.events, [readCall, readResult]);
});
