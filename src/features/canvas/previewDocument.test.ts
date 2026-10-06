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
  const oversized = answer({
    events: [{ event: 'diagnostics', diagnostics: [{ code: 'x', message: 'y'.repeat(600) }] }],
  });
  // Caps are bytes, so a string under the cap in code units can still be over it.
  const astral = answer({
    events: [{ event: 'diagnostics', diagnostics: [{ code: 'x', message: '😀'.repeat(200) }] }],
  });

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
    oversized,
    astral,
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

test('the snapshot and text caps are byte caps, not code-unit caps', () => {
  // 512 bytes of text is accepted; 129 four-byte characters is 516 bytes.
  const atCap = answer({ events: [{ event: 'interaction', kind: 'y'.repeat(512) }] });
  const overCap = answer({ events: [{ event: 'interaction', kind: '😀'.repeat(129) }] });

  assert.equal(readPreviewSnapshot(atCap, instance)?.events.length, 1);
  assert.equal(overCap.length < atCap.length, true, 'the over-cap answer is shorter in code units');
  assert.equal(readPreviewSnapshot(overCap, instance), null);

  // And the whole snapshot is bounded in bytes too.
  const huge = answer({
    events: [{ event: 'ready' }],
    designId: instance.designId,
  }).replace('"events"', `"padding":"${'😀'.repeat(20_000)}","events"`);
  assert.equal(readPreviewSnapshot(huge, instance), null);
});
