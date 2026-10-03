import assert from 'node:assert/strict';
import test from 'node:test';

import type { FeedItem } from './chatFeed';
import { areFeedRowPropsEqual } from './messageFeedRows';
import type { TranscriptEvent } from '../types/bridge';

function messageItem(id: string, author: 'user' | 'assistant'): FeedItem {
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

function rowProps(overrides: Partial<Parameters<typeof areFeedRowPropsEqual>[0]> = {}) {
  const item = messageItem('answer-1', 'assistant');
  return {
    item,
    live: false,
    animateOnMount: false,
    isFinalResponse: false,
    ...overrides,
  };
}

test('a row re-renders only when its own final-response flag changes', () => {
  const previous = rowProps({ isFinalResponse: true });
  assert.equal(areFeedRowPropsEqual(previous, { ...previous }), true);
  assert.equal(areFeedRowPropsEqual(previous, { ...previous, isFinalResponse: false }), false);
});
