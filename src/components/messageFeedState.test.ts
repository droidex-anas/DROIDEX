import test from 'node:test';
import assert from 'node:assert/strict';
import type { FeedItem } from './chatFeed';
import {
  appendedFeedItemKeys,
  appendedFeedItemKeysFromProjection,
  isCopyableFinalResponse,
  projectFinalResponseKeys,
} from './messageFeedState';
import type { TranscriptEvent } from '../types/bridge';

function event(id: string, extra: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    id,
    appSessionId: 'm',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: 1,
    kind: 'text',
    ...extra,
  };
}

function message(id: string, author: 'user' | 'assistant'): FeedItem {
  return { type: 'message', key: id, event: event(id, { author, text: id }) };
}

// appendedFeedItemKeys decides which rows get the rise-in entrance animation.
// It must track item identity (not list index) so paging older history — which
// prepends already-past messages ahead of the visible ones — does not re-animate
// existing rows or treat the prepend like a fresh append.
test('appendedFeedItemKeys animates only genuinely appended tail items', () => {
  const identity = 'm:primary';
  const keys = (letters: string[]) => letters.map((key) => ({ key }));

  // Genuinely appended items (new keys at the tail) animate.
  const previous = { identity, keys: new Set(['a', 'b', 'c']) };
  assert.deepEqual(
    [...appendedFeedItemKeys(keys(['a', 'b', 'c', 'd', 'e']), previous, identity)],
    ['e', 'd'],
  );

  // Paging older history prepends new keys ahead of the existing ones; nothing
  // re-animates (neither the prepended items nor the already-visible rows).
  assert.deepEqual(
    [...appendedFeedItemKeys(keys(['x', 'y', 'a', 'b', 'c']), previous, identity)],
    [],
  );

  // Re-rendering with the same keys (e.g. a token streaming into an existing
  // message) animates nothing.
  assert.deepEqual([...appendedFeedItemKeys(keys(['a', 'b', 'c']), previous, identity)], []);

  // No previous render (first time a feed is shown) animates nothing.
  assert.deepEqual([...appendedFeedItemKeys(keys(['a', 'b']), null, identity)], []);

  // A different feed identity (switched sessions/child) animates nothing.
  assert.deepEqual(
    [
      ...appendedFeedItemKeys(
        keys(['a', 'b', 'd']),
        { identity: 'other', keys: new Set(['a']) },
        identity,
      ),
    ],
    [],
  );

  // A newly appended item preceded by a fresh prepend animates only the tail.
  assert.deepEqual(
    [...appendedFeedItemKeys(keys(['x', 'a', 'b', 'c', 'd']), previous, identity)],
    ['d'],
  );
});

test('projected entrance keys inspect only the rebuilt feed suffix', () => {
  const identity = 'm:primary';
  const items = (keys: string[]) => keys.map((key) => ({ key }));
  const previous = { identity, items: items(['old-1', 'old-2', 'turn', 'tail']) };

  assert.deepEqual(
    [
      ...appendedFeedItemKeysFromProjection(
        items(['old-1', 'old-2', 'turn', 'tail', 'new-1', 'new-2']),
        previous,
        identity,
        'append',
        2,
      ),
    ],
    ['new-2', 'new-1'],
  );
  assert.deepEqual(
    [
      ...appendedFeedItemKeysFromProjection(
        items(['older', 'old-1', 'old-2', 'turn', 'tail']),
        previous,
        identity,
        'prepend',
        0,
      ),
    ],
    [],
  );
});

test('final response projection retains settled turns while the live turn changes', () => {
  const initial = [
    message('user-1', 'user'),
    message('answer-1', 'assistant'),
    message('user-2', 'user'),
    message('answer-2', 'assistant'),
  ];
  const first = projectFinalResponseKeys(null, 'm:primary', initial, 'full');
  assert.deepEqual([...first.settledKeys], ['answer-1']);
  assert.deepEqual([...first.liveKeys], ['answer-2']);
  assert.equal(isCopyableFinalResponse('answer-1', first, true), true);
  assert.equal(isCopyableFinalResponse('answer-2', first, true), false);
  assert.equal(isCopyableFinalResponse('answer-2', first, false), true);

  const streamed = projectFinalResponseKeys(
    first,
    'm:primary',
    [...initial, message('answer-3', 'assistant')],
    'append',
  );
  assert.equal(streamed.settledKeys, first.settledKeys);
  assert.deepEqual([...streamed.liveKeys], ['answer-3']);

  const nextTurn = projectFinalResponseKeys(
    streamed,
    'm:primary',
    [...initial, message('answer-3', 'assistant'), message('user-3', 'user')],
    'append',
  );
  assert.equal(nextTurn.settledKeys.has('answer-1'), true);
  assert.equal(nextTurn.settledKeys.has('answer-3'), true);
  assert.deepEqual([...nextTurn.liveKeys], []);
});

test('appending two prompts in one batch still settles the skipped turn response', () => {
  const initial = [message('user-1', 'user'), message('answer-1', 'assistant')];
  const first = projectFinalResponseKeys(null, 'm:primary', initial, 'full');
  const batched = projectFinalResponseKeys(
    first,
    'm:primary',
    [
      ...initial,
      message('user-2', 'user'),
      message('answer-2', 'assistant'),
      message('user-3', 'user'),
    ],
    'append',
  );

  assert.equal(batched.settledKeys.has('answer-1'), true);
  assert.equal(batched.settledKeys.has('answer-2'), true);
  assert.deepEqual([...batched.liveKeys], []);
});

test('live final-response keys keep their reference while the live key is unchanged', () => {
  const initial = [message('user-1', 'user'), message('answer-1', 'assistant')];
  const first = projectFinalResponseKeys(null, 'm:primary', initial, 'full');

  // A non-message tail append leaves the turn's final response key unchanged,
  // so chunks whose final-response display is unchanged stay memoized.
  const streamed = projectFinalResponseKeys(
    first,
    'm:primary',
    [...initial, { type: 'thinking', key: 'thinking-1', event: event('thinking-1') }],
    'append',
  );
  assert.equal(streamed.liveKeys, first.liveKeys);
  assert.equal(streamed.settledKeys, first.settledKeys);

  const answered = projectFinalResponseKeys(
    streamed,
    'm:primary',
    [...initial, message('answer-2', 'assistant')],
    'append',
  );
  assert.deepEqual([...answered.liveKeys], ['answer-2']);
  assert.notEqual(answered.liveKeys, streamed.liveKeys);
});
