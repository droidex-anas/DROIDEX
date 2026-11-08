import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupedFeed } from './chatFeedTurns';
import { sameFeedEvents, type FeedItem } from './chatFeed';
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
  revisionId?: string,
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
        ...(revisionId ? { revisionId } : {}),
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

test("each turn's card keeps the last revision that turn wrote as later turns refine it", () => {
  const write = (toolUseId: string, revisionId: string) =>
    canvasTool(toolUseId, 'write', ['dsg_card'], 'completed', revisionId);
  const turns = [
    [
      user('Design a card'),
      ...canvasTool('create', 'create', ['dsg_card']),
      ...write('w1', 'rev-1'),
    ],
    [user('Rounder corners'), ...write('w2', 'rev-2')],
    [user('Try a darker header'), ...write('w3a', 'rev-3a'), ...write('w3', 'rev-3')],
    [user('Tighter spacing'), ...write('w4', 'rev-4')],
  ].map((turn) => [...turn, answer('Updated the card.')]);
  const pinned = (events: TranscriptEvent[]) =>
    buildGroupedFeed(events, false).flatMap((item) =>
      item.type === 'canvas_artifact' && item.activity.action !== 'theme'
        ? [item.activity.revisionId]
        : [],
    );

  // Each turn arriving live, then the whole chat replayed, leaves earlier cards where they were.
  for (let count = 1; count <= turns.length; count++)
    assert.deepEqual(
      pinned(turns.slice(0, count).flat()),
      ['rev-1', 'rev-2', 'rev-3', 'rev-4'].slice(0, count),
    );

  // Mid-turn, a later write moves the card's pin, and its row sees the change.
  const running = [
    ...turns[0],
    user('Try a darker header'),
    ...write('w3a', 'rev-3a'),
    answer('Trying a darker header.'),
  ];
  const lastCard = (events: TranscriptEvent[]) =>
    buildGroupedFeed(events, true).findLast((item) => item.type === 'canvas_artifact');
  const before = lastCard(running);
  const after = lastCard([...running, ...write('w3', 'rev-3')]);
  assert.ok(before?.type === 'canvas_artifact' && after?.type === 'canvas_artifact');
  assert.deepEqual([before.activity.revisionId, after.activity.revisionId], ['rev-3a', 'rev-3']);
  assert.equal(sameFeedEvents(before, after), false);
});

function themeTool(toolUseId: string, designSystem?: Activity['designSystem']): TranscriptEvent[] {
  const activity = { toolUseId, action: 'theme' as const, designIds: [], message: 'theme done' };
  return [
    ev({
      kind: 'tool_call',
      toolName: 'canvas_theme',
      toolUseId,
      canvasActivity: { ...activity, state: 'running' },
    }),
    ev({
      kind: 'tool_result',
      toolUseId,
      text: '{}',
      canvasActivity: {
        ...activity,
        state: 'completed',
        ...(designSystem ? { designSystem } : {}),
      },
    }),
  ];
}

test('a kit the turn saved or proposed is one chip per kit and outcome, and a read is none', () => {
  const proposed = { id: 'acme', version: 1, status: 'proposed' as const };
  const events = [
    user('Make a design system, then refine it'),
    ...themeTool('read'),
    ...themeTool('save', { id: 'acme', version: 1, status: 'saved' }),
    ...themeTool('propose', proposed),
    ...themeTool('propose-again', proposed),
    answer('Saved Acme and proposed a change to it.'),
  ];
  const chips = buildGroupedFeed(events, false).flatMap((item) =>
    item.type === 'canvas_artifact' && item.activity.action === 'theme'
      ? [`${item.activity.designSystem.status}:${item.activity.toolUseId}`]
      : [],
  );

  assert.deepEqual(chips, ['saved:save', 'proposed:propose']);
});
