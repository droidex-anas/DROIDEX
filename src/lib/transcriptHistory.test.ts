import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileRestoredTranscript } from './transcriptHistory';
import { textEvent } from '../test/textEvent';

const capped = (text: string, keep = 12_000) =>
  `${text.slice(0, keep)}\n\n[truncated ${text.length - keep} chars]`;

for (const size of [1, 100, 400]) {
  test(`capped restore preserves the full provider events at size ${size}`, () => {
    const live = Array.from({ length: size }, (_, index) =>
      textEvent(`live-${index}`, {
        sourceSessionId: 'provider-session',
        ts: index * 10_000,
        text: `${index}:`.padEnd(13_000, 'x'),
      }),
    );
    const page = live.map((event, index) =>
      textEvent(`replay-${index}`, { ts: event.ts, text: capped(event.text ?? '') }),
    );
    const result = reconcileRestoredTranscript(live, page, true);
    assert.deepEqual(result, live);
    result.forEach((event, index) => assert.equal(event, live[index]));
  });
}

test('normal, empty and nonmatching restores retain their exact arrays', () => {
  const live = textEvent('live', { ts: 10_000, text: 'answer' });
  const replay = textEvent('replay', { ts: 10_001, text: 'answer' });
  assert.deepEqual(reconcileRestoredTranscript([live], [replay], true), [replay]);
  const existing = [live];
  assert.equal(reconcileRestoredTranscript(existing, [], true), existing);
  assert.deepEqual(reconcileRestoredTranscript([], [replay], true), [replay]);
  assert.deepEqual(reconcileRestoredTranscript([], [], true), []);
  const unmatched = textEvent('unmatched', { ts: 20_000, text: capped('other answer', 5) });
  assert.deepEqual(reconcileRestoredTranscript([live], [unmatched], true), [live, unmatched]);
});

test('repeated capped content consumes nearest events and breaks ties in live order', () => {
  const text = 'same answer';
  const later = textEvent('later', { ts: 12_000, text });
  const earlier = textEvent('earlier', { ts: 8_000, text });
  const replay = textEvent('replay', { ts: 10_000, text: capped(text, 4) });
  const second = { ...replay, id: 'second' };
  assert.deepEqual(reconcileRestoredTranscript([later, earlier], [replay, second], true), [
    later,
    earlier,
  ]);
  const nearest = textEvent('nearest', { ts: 10_001, text });
  assert.deepEqual(reconcileRestoredTranscript([later, nearest], [replay], true), [nearest]);
});

test('child scopes stay isolated while primary provider IDs are canonicalized', () => {
  const text = 'full answer';
  const primary = textEvent('provider', { sourceSessionId: 'provider-id', text, ts: 10_000 });
  const child = textEvent('child', {
    role: 'worker',
    sourceSessionId: 'child-a',
    text,
    ts: 10_000,
  });
  const sibling = textEvent('sibling', {
    role: 'worker',
    sourceSessionId: 'child-b',
    text,
    ts: 10_000,
  });
  const replay = textEvent('replay', { text: capped(text, 4), ts: 10_000 });
  const childReplay = {
    ...replay,
    id: 'child-replay',
    role: child.role,
    sourceSessionId: 'child-a',
  };
  assert.deepEqual(
    reconcileRestoredTranscript([primary, child, sibling], [replay, childReplay], true),
    [primary, child, sibling],
  );
});

test('unpersisted prefixes disappear but persisted prefixes and distant events survive', () => {
  const full = textEvent('full', { ts: 10_000, text: 'a complete answer' });
  const prefix = textEvent('prefix', { ts: 9_000, text: 'a complete' });
  const distant = textEvent('distant', { ts: 1, text: 'a complete' });
  const replay = textEvent('replay', { ts: 10_000, text: capped(full.text ?? '', 5) });
  assert.deepEqual(reconcileRestoredTranscript([distant, prefix, full], [replay], true), [
    distant,
    full,
  ]);
  assert.deepEqual(reconcileRestoredTranscript([prefix, full], [prefix, replay], true), [
    prefix,
    full,
  ]);
});
