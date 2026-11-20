import test from 'node:test';
import assert from 'node:assert/strict';
import type { FeedItem } from './chatFeed';
import {
  appendedFeedItemKeysFromProjection,
  isCopyableFinalResponse,
  projectFinalResponseKeys,
} from './messageFeedState';
import type { TranscriptEvent } from '@droidex/protocol';

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

// Entrance keys decide which rows get the rise-in animation. They track item
// identity (not list index) so paging older history, a re-render of the same
// rows, or a switched feed never re-animates existing rows.
test('projected entrance keys animate only genuinely appended tail items', () => {
  const identity = 'm:primary';
  const items = (keys: string[]) => keys.map((key) => ({ key }));
  const previous = { identity, items: items(['old-1', 'old-2', 'turn', 'tail']) };
  const entranceKeys = (
    keys: string[],
    updateKind: 'full' | 'append' | 'prepend',
    rebuiltFromItemIndex: number,
    from: typeof previous | null = previous,
  ) => [
    ...appendedFeedItemKeysFromProjection(
      items(keys),
      from,
      identity,
      updateKind,
      rebuiltFromItemIndex,
    ),
  ];

  // Appended keys after the rebuilt suffix animate, newest first.
  assert.deepEqual(
    entranceKeys(['old-1', 'old-2', 'turn', 'tail', 'new-1', 'new-2'], 'append', 2),
    ['new-2', 'new-1'],
  );
  // A rebuilt turn that replaces its own tail row animates only the new row.
  assert.deepEqual(entranceKeys(['old-1', 'old-2', 'turn', 'reply'], 'append', 2), ['reply']);
  // Re-rendering the same keys (a token streaming into an existing row) animates nothing.
  assert.deepEqual(entranceKeys(['old-1', 'old-2', 'turn', 'tail'], 'append', 2), []);
  // Loading older history leaves the prepended and the already visible rows still.
  assert.deepEqual(entranceKeys(['older', 'old-1', 'old-2', 'turn', 'tail'], 'prepend', 0), []);
  // A full rebuild, a first render and a switched feed animate nothing.
  assert.deepEqual(entranceKeys(['old-1', 'old-2', 'turn', 'tail', 'new-1'], 'full', 0), []);
  assert.deepEqual(entranceKeys(['old-1', 'new-1'], 'append', 0, null), []);
  assert.deepEqual(
    entranceKeys(['old-1', 'new-1'], 'append', 1, { identity: 'other', items: items(['old-1']) }),
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
