import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PREVIEW_SNAPSHOT_EVENTS,
  previewNonce,
  readPreviewSnapshot,
  type PreviewInstance,
} from './previewDocument';

const instance: PreviewInstance = {
  nonce: 'a'.repeat(32),
  designId: 'dsg_hey',
  revisionId: 'rev_02',
  generation: 4,
};

function answer(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...instance, events: [], dropped: 0, ...overrides });
}

test('a nonce is the hex charset the guest will embed', () => {
  const minted = new Set(Array.from({ length: 8 }, previewNonce));

  assert.equal(minted.size, 8);
  for (const nonce of minted) assert.match(nonce, /^[0-9a-f]{32}$/);
});

test('every bounded event shape is accepted', () => {
  const events = [
    { event: 'ready' },
    { event: 'resize', width: 1024, height: 768 },
    { event: 'diagnostics', diagnostics: [{ code: 'preview_error', message: 'Boom' }] },
    { event: 'selection', elementId: 'el_1', instancePath: '0/2' },
    { event: 'interaction', kind: 'click' },
  ];

  const snapshot = readPreviewSnapshot(answer({ events, dropped: 3 }), instance);

  assert.deepEqual(snapshot, { events, dropped: 3 });
});

test('a snapshot from another instance is refused', () => {
  for (const drift of [
    { nonce: 'b'.repeat(32) },
    { designId: 'dsg_other' },
    { revisionId: 'rev_03' },
    { generation: 5 },
  ]) {
    assert.equal(readPreviewSnapshot(answer(drift), instance), null, JSON.stringify(drift));
  }
});

test('a malformed or oversized answer is refused whole', () => {
  for (const value of [
    null,
    42,
    'not json',
    '[]',
    answer({ events: {} }),
    answer({ dropped: -1 }),
    answer({ events: [{ event: 'unknown' }] }),
    answer({ events: [{ event: 'resize', width: -1, height: 10 }] }),
    answer({ events: [{ event: 'resize', width: 1.5, height: 10 }] }),
    answer({ events: [{ event: 'selection', elementId: '', instancePath: '0' }] }),
    answer({ events: [{ event: 'diagnostics', diagnostics: [{ code: 'x' }] }] }),
    // One good event does not carry a bad one past the boundary.
    answer({ events: [{ event: 'ready' }, { event: 'resize', width: 'wide', height: 1 }] }),
  ]) {
    assert.equal(readPreviewSnapshot(value, instance), null, String(value).slice(0, 80));
  }
});

test('a snapshot over the queue cap is refused rather than trimmed', () => {
  const ready = { event: 'ready' };
  const atCap = Array.from({ length: MAX_PREVIEW_SNAPSHOT_EVENTS }, () => ready);

  assert.equal(
    readPreviewSnapshot(answer({ events: atCap }), instance)?.events.length,
    atCap.length,
  );
  assert.equal(readPreviewSnapshot(answer({ events: [...atCap, ready] }), instance), null);
});

test('an over-long text field is cut on a code point boundary, not refused', () => {
  // A diagnostic is display data. Refusing the snapshot over one would end a
  // guest because its design wrote an error message in a non-Latin script.
  const wide = readPreviewSnapshot(
    answer({
      events: [
        {
          event: 'diagnostics',
          diagnostics: [{ code: 'preview_error', message: '界'.repeat(200) }],
        },
      ],
    }),
    instance,
  );
  const [event] = wide?.events ?? [];
  assert.ok(event?.event === 'diagnostics');
  const [diagnostic] = event.diagnostics;
  assert.equal(new TextEncoder().encode(diagnostic.message).length, 510);
  assert.equal([...diagnostic.message].length, 170, 'cut between characters, never inside one');
  assert.ok(diagnostic.message.startsWith('界界'));

  // Every other text field is cut the same way.
  const kind = readPreviewSnapshot(
    answer({ events: [{ event: 'interaction', kind: '😀'.repeat(200) }] }),
    instance,
  )?.events[0];
  assert.ok(kind?.event === 'interaction');
  assert.equal(new TextEncoder().encode(kind.kind).length, 512);
});

test('a snapshot over its own byte bound is still refused whole', () => {
  // The structural bounds are what a guest is ended over, and they stay strict.
  const huge = answer({ events: [{ event: 'ready' }] }).replace(
    '"events"',
    `"padding":"${'😀'.repeat(20_000)}","events"`,
  );

  assert.equal(readPreviewSnapshot(huge, instance), null);
});
