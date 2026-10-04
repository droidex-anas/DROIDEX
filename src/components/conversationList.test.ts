import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MessageFeed } from './MessageFeed';
import type { FeedItem } from './chatFeed';
import {
  updateConversationRowLookup,
  findConversationRowIndex,
  isConversationAtLatest,
  shouldAdjustConversationRowOnSizeChange,
  syncMeasureConversationList,
  shouldAnimateFeedRow,
} from './conversationListState';
import { feedRowId } from '../hooks/conversationViewportAnchor';
import type { TranscriptEvent } from '../types/bridge';

function messageItem(
  id: string,
  author: 'user' | 'assistant' = 'assistant',
): Extract<FeedItem, { type: 'message' }> {
  const event: TranscriptEvent = {
    id,
    appSessionId: 'm',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: 1,
    kind: 'text',
    author,
    text: id,
  };
  return { type: 'message', key: id, event };
}

function history(count: number): FeedItem[] {
  return Array.from({ length: count }, (_, index) =>
    messageItem(`row-${String(index)}`, index % 2 === 0 ? 'user' : 'assistant'),
  );
}

test('size-change compensation is off while the user is scrolling', () => {
  const aboveFold = { start: 0, size: 96, key: 'row-0' };
  const scrolling = {
    isScrolling: true,
    scrollDirection: 'backward' as const,
    scrollAdjustments: 0,
    itemSizeCache: new Map<string | number | bigint, number>(),
    scrollOffset: 2_000,
  };
  assert.equal(shouldAdjustConversationRowOnSizeChange(aboveFold, -77, scrolling), false);

  const idle = { ...scrolling, isScrolling: false, scrollDirection: null };
  assert.equal(shouldAdjustConversationRowOnSizeChange(aboveFold, -77, idle), true);

  const growingInView = { start: 1_920, size: 96, key: 'live' };
  const idleMeasured = {
    ...idle,
    itemSizeCache: new Map<string | number | bigint, number>([['live', 96]]),
  };
  assert.equal(shouldAdjustConversationRowOnSizeChange(growingInView, 24, idleMeasured), false);
});

test('streamed commits read only changed or newly mounted row heights', () => {
  const items = history(3);
  const reads: number[] = [];
  const rows = items.map((_, index) => ({
    dataset: { index: String(index) },
    get offsetHeight() {
      reads.push(index);
      return 40;
    },
    nextElementSibling: null as unknown,
  }));
  rows.forEach((row, index) => {
    row.nextElementSibling = rows[index + 1] ?? null;
  });
  const list = { firstElementChild: rows[0] } as unknown as HTMLElement;
  const changedRows = { items, measured: new WeakMap<Element, FeedItem>() };
  const resize = () => {};
  syncMeasureConversationList(list, resize, changedRows);
  assert.deepEqual(reads.splice(0), [0, 1, 2]);
  changedRows.items = [...items.slice(0, 2), messageItem('row-2')];
  syncMeasureConversationList(list, resize, changedRows);
  assert.deepEqual(reads.splice(0), [2]);
  syncMeasureConversationList(list, resize, changedRows);
  assert.deepEqual(reads, []);

  // Scrolling a cached item back into view still measures its new DOM node.
  const remounted = {
    firstElementChild: {
      dataset: { index: '0' },
      get offsetHeight() {
        reads.push(0);
        return 40;
      },
      nextElementSibling: null,
    },
  } as unknown as HTMLElement;
  syncMeasureConversationList(remounted, resize, changedRows);
  assert.deepEqual(reads, [0]);
});

test('row measure reads the index attribute and rounds layout height', () => {
  const measured: Array<[number, number]> = [];
  const list = {
    firstElementChild: {
      dataset: { index: '12' },
      offsetHeight: 19.4,
      nextElementSibling: { dataset: {}, offsetHeight: 40, nextElementSibling: null },
    },
  } as unknown as HTMLElement;
  syncMeasureConversationList(list, (index, size) => measured.push([index, size]));
  assert.deepEqual(measured, [[12, 19]]);
});

test('scroll-to-row lookup remains accurate for prompt, tool, and turn identities', () => {
  const prompt = messageItem('prompt-1', 'user');
  const answer = messageItem('answer-1', 'assistant');
  const toolCall: TranscriptEvent = {
    ...messageItem('tool-1').event,
    kind: 'tool_call',
    toolName: 'Grep',
    toolArgs: { pattern: 'x' },
  };
  const tools: FeedItem = { type: 'tools', key: 'tool-1', events: [toolCall] };
  const child: FeedItem = {
    type: 'child_session',
    key: 'child-session-wave',
    event: {
      ...messageItem('child-1').event,
      kind: 'tool_call',
      toolName: 'Task',
      toolUseId: 'tu-child',
      toolArgs: { description: 'explore' },
    },
  };
  const items = [prompt, tools, child, answer];
  const lookup = updateConversationRowLookup(null, items);

  assert.equal(findConversationRowIndex(lookup, prompt.key), 0);
  assert.equal(findConversationRowIndex(lookup, feedRowId(prompt)), 0);
  assert.equal(findConversationRowIndex(lookup, tools.key), 1);
  assert.equal(findConversationRowIndex(lookup, feedRowId(tools)), 1);
  assert.equal(findConversationRowIndex(lookup, child.key), 2);
  assert.equal(findConversationRowIndex(lookup, feedRowId(child)), 2);
  assert.equal(findConversationRowIndex(lookup, 'missing'), undefined);
});

test('suffix lookup removes obsolete group anchors and rows without replacing settled indexes', () => {
  const settled = messageItem('prompt', 'user');
  const firstTool = { ...messageItem('tool-1').event, kind: 'tool_call' as const };
  const secondTool = { ...firstTool, id: 'tool-2' };
  const tools: FeedItem = { type: 'tools', key: 'tools', events: [firstTool] };
  const items = [settled, tools, messageItem('removed')];
  const lookup = updateConversationRowLookup(null, items);
  const mountKeys = lookup.byMountKey;
  const viewportIds = lookup.byViewportId;
  const regrouped: FeedItem = { ...tools, events: [firstTool, secondTool] };
  updateConversationRowLookup(lookup, [settled, regrouped], 1);
  assert.equal(lookup.byMountKey, mountKeys);
  assert.equal(lookup.byViewportId, viewportIds);
  assert.equal(findConversationRowIndex(lookup, feedRowId(settled)), 0);
  assert.equal(findConversationRowIndex(lookup, 'tools'), 1);
  assert.equal(findConversationRowIndex(lookup, feedRowId(regrouped)), 1);
  assert.equal(findConversationRowIndex(lookup, feedRowId(tools)), undefined);
  assert.equal(findConversationRowIndex(lookup, 'removed'), undefined);
  updateConversationRowLookup(lookup, []);
  assert.equal(lookup.byMountKey.size, 0);
  assert.equal(lookup.byViewportId.size, 0);
});

test('lookup rewinds past an uncommitted projection before applying the latest suffix', () => {
  const initial = history(5);
  const lookup = updateConversationRowLookup(null, initial);
  const skipped = [...initial.slice(0, 2), messageItem('replacement'), messageItem('new-turn')];
  const latest = [...skipped, messageItem('live-answer')];
  updateConversationRowLookup(lookup, latest, skipped.length);
  assert.equal(findConversationRowIndex(lookup, 'row-2'), undefined);
  assert.equal(findConversationRowIndex(lookup, 'replacement'), 2);
  assert.equal(findConversationRowIndex(lookup, 'new-turn'), 3);
  assert.equal(findConversationRowIndex(lookup, 'live-answer'), 4);
  assert.deepEqual(lookup, updateConversationRowLookup(null, latest));

  // A skipped prepend can extend just the first group without shifting rows.
  const prepended = [messageItem('older-group'), ...latest.slice(1)];
  const appended = [...prepended, messageItem('after-prepend')];
  updateConversationRowLookup(lookup, appended, prepended.length);
  assert.equal(findConversationRowIndex(lookup, 'row-0'), undefined);
  assert.equal(findConversationRowIndex(lookup, 'older-group'), 0);
  assert.deepEqual(lookup, updateConversationRowLookup(null, appended));
});

test('bottom-follow is a cheap end-threshold, not full geometry', () => {
  assert.equal(isConversationAtLatest(2_000, 1_100, 900), true);
  assert.equal(isConversationAtLatest(2_000, 1_000, 900), false);
  assert.equal(isConversationAtLatest(2_000, 1_921, 900), true);
});

test('entrance animation fires once per append and not when a settled row remounts', () => {
  const entered = new Set<string>();
  const appended = new Set(['new-tail']);
  const tail = { key: 'new-tail', type: 'tool' };
  const old = { key: 'old-row', type: 'tool' };
  assert.equal(shouldAnimateFeedRow(tail, appended, entered), true);
  assert.equal(
    shouldAnimateFeedRow(tail, appended, entered),
    true,
    'discarded renders must not consume entrance',
  );
  entered.add('new-tail'); // The mounted row records its committed entrance.
  assert.equal(shouldAnimateFeedRow(tail, appended, entered), false);
  assert.equal(shouldAnimateFeedRow(old, appended, entered), false);
});

test('a prompt sent moments ago animates once even when the projection rebuilt it', () => {
  const entered = new Set<string>();
  const none = new Set<string>();
  const now = 10_000;
  const sent = { key: 'prompt', type: 'message', event: { author: 'user', ts: now - 500 } };
  const replayed = { key: 'old', type: 'message', event: { author: 'user', ts: now - 60_000 } };
  assert.equal(shouldAnimateFeedRow(sent, none, entered, now), true);
  assert.equal(shouldAnimateFeedRow(replayed, none, entered, now), false);
  entered.add('prompt');
  assert.equal(shouldAnimateFeedRow(sent, none, entered, now), false);
});

test('MessageFeed mounts a bounded window for a long synthetic history', () => {
  const events: TranscriptEvent[] = Array.from({ length: 400 }, (_, index) => ({
    id: `e${String(index)}`,
    appSessionId: 'm',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: index + 1,
    kind: 'text',
    author: index % 2 === 0 ? 'user' : 'assistant',
    text: `row ${String(index)}`,
  }));
  const html = renderToStaticMarkup(createElement(MessageFeed, { events, pending: false }));
  const mounted = html.match(/data-feed-row-id=/g)?.length ?? 0;
  assert.ok(mounted > 0);
  assert.ok(mounted < 80, `expected a virtual window, mounted ${String(mounted)}`);
  assert.match(html, /row 399/);
  assert.doesNotMatch(html, /row 0</);
});
