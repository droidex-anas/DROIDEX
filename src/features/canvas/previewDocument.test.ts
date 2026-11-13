import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PREVIEW_SNAPSHOT_EVENTS,
  previewHoverScript,
  previewLocateScript,
  previewNonce,
  previewSelectScript,
  readPreviewHover,
  readPreviewLocations,
  readPreviewSnapshot,
  readPreviewVector,
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

const selected = {
  elementId: 'el_1',
  instancePath: '0/2',
  rect: { x: -4, y: 2.5, width: 120, height: 0 },
  styles: { gap: '4px', color: 'rgb(0, 0, 0)' },
  text: 'Welcome',
  parentDisplay: 'flex',
};

test('every bounded event shape is accepted', () => {
  const events = [
    { event: 'ready' },
    { event: 'resize', width: 1024, height: 768 },
    { event: 'diagnostics', diagnostics: [{ code: 'preview_error', message: 'Boom' }] },
    { event: 'selection', sequence: 1, element: selected },
    { event: 'selection', sequence: 2, element: null },
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
    answer({ events: [{ event: 'selection', element: selected }] }),
    answer({ events: [{ event: 'selection', sequence: 0, element: null }] }),
    answer({ events: [{ event: 'selection', sequence: 1.5, element: null }] }),
    answer({
      events: [{ event: 'selection', sequence: 1, element: { ...selected, elementId: '' } }],
    }),
    answer({ events: [{ event: 'selection', sequence: 1, elementId: 'el_1', instancePath: '0' }] }),
    answer({
      events: [
        {
          event: 'selection',
          sequence: 1,
          element: { ...selected, rect: { ...selected.rect, width: -1 } },
        },
      ],
    }),
    answer({
      events: [{ event: 'selection', sequence: 1, element: { ...selected, styles: { gap: 4 } } }],
    }),
    answer({
      events: [{ event: 'selection', sequence: 1, element: { ...selected, parentDisplay: null } }],
    }),
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

test('a queue the guest filled within its own bounds is read, not refused', () => {
  // Each event sits just under the 4096 bytes the intermediate accepts, so a
  // full queue of them is legal: ending the guest over one is what the two
  // sides' bounds exist to prevent, not a reason to refuse the snapshot.
  const event = {
    event: 'diagnostics',
    diagnostics: Array.from({ length: 7 }, () => ({ code: 'e', message: 'a'.repeat(505) })),
  };
  assert.ok(new TextEncoder().encode(JSON.stringify(event)).length <= 4096);
  const events = Array.from({ length: MAX_PREVIEW_SNAPSHOT_EVENTS }, () => event);

  assert.equal(readPreviewSnapshot(answer({ events }), instance)?.events.length, events.length);
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

  // Except an element's text: the board may write it back whole, so past the
  // cap it is not offered at all rather than cut.
  const long = readPreviewSnapshot(
    answer({
      events: [
        { event: 'selection', sequence: 1, element: { ...selected, text: '界'.repeat(200) } },
      ],
    }),
    instance,
  )?.events[0];
  assert.ok(long?.event === 'selection');
  assert.equal(long.element?.text, null);
});

test('a snapshot over its own byte bound is still refused whole', () => {
  // The structural bounds are what a guest is ended over, and they stay strict.
  // Astral characters are four bytes each, so this clears the whole-snapshot
  // bound with room to spare however the fields are cut.
  const huge = answer({ events: [{ event: 'ready' }] }).replace(
    '"events"',
    `"padding":"${'😀'.repeat(90_000)}","events"`,
  );

  assert.equal(readPreviewSnapshot(huge, instance), null);
});

test('a selection the size of its own cap is read, not refused', () => {
  // The intermediate keeps one selection of up to 16 KB beside a full queue,
  // so the snapshot bound has to leave room for it.
  const styles = Object.fromEntries(
    Array.from({ length: 60 }, (_, index) => [`p${String(index)}`, 'a'.repeat(250)]),
  );
  const fill = {
    event: 'diagnostics',
    diagnostics: Array.from({ length: 8 }, () => ({ code: 'e', message: 'a'.repeat(470) })),
  };
  const selection = { event: 'selection', sequence: 1, element: { ...selected, styles } };
  const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  assert.ok(size(fill) <= 4096 && size(selection) <= 16384);
  const events = [
    ...Array.from({ length: MAX_PREVIEW_SNAPSHOT_EVENTS - 1 }, () => fill),
    selection,
  ];

  assert.equal(readPreviewSnapshot(answer({ events }), instance)?.events.length, events.length);
});

test('a hover is a fixed call, and only a well-formed answer names an element', () => {
  assert.equal(
    previewHoverScript({ x: 12.5, y: -3 }),
    'globalThis.__droidexCanvasPreview.hover({"x":12.5,"y":-3})',
  );
  assert.equal(
    previewHoverScript({ elementId: 'el_1', instancePath: '0/2' }),
    'globalThis.__droidexCanvasPreview.hover({"elementId":"el_1","instancePath":"0/2"})',
  );
  const hovered = {
    elementId: 'el_1',
    instancePath: '0/2',
    rect: selected.rect,
    tagName: 'h1',
    room: { above: 16, below: null },
  };

  assert.deepEqual(readPreviewHover(JSON.stringify(hovered)), hovered);
  // A path is an identity: past the text cap it is kept whole, never cut.
  const deep = { ...hovered, instancePath: '0/'.repeat(300) + '2' };
  assert.deepEqual(readPreviewHover(JSON.stringify(deep)), deep);
  for (const value of [
    'null',
    'invalid_request',
    null,
    JSON.stringify({ ...hovered, tagName: '' }),
    JSON.stringify({ ...hovered, rect: { ...hovered.rect, height: -1 } }),
    JSON.stringify({ ...hovered, instancePath: 2 }),
    JSON.stringify({ ...hovered, instancePath: '0/' }),
    JSON.stringify({ ...hovered, room: null }),
    JSON.stringify({ ...hovered, room: { above: -1, below: null } }),
  ]) {
    assert.equal(readPreviewHover(value), null, String(value));
  }
});

test('a locate is a fixed call, answered with a box or null for each element in order', () => {
  assert.equal(
    previewLocateScript(['el_1', '</script>']),
    'globalThis.__droidexCanvasPreview.locate({"elementIds":["el_1","\\u003c/script>"]})',
  );
  const box = { x: 4, y: -8, width: 120, height: 32 };

  assert.deepEqual(readPreviewLocations(JSON.stringify([box, null]), 2), [box, null]);
  // A box that is not one is an element not drawn, not a reason to refuse the rest.
  const unreadable = [{ ...box, width: -1 }, box];
  assert.deepEqual(readPreviewLocations(JSON.stringify(unreadable), 2), [null, box]);
  for (const value of ['null', 'invalid_request', null, JSON.stringify([box])]) {
    assert.equal(readPreviewLocations(value, 2), null, String(value));
  }
});

test('a vector answer is markup within the cap or a known refusal', () => {
  const svg = `<svg>${'x'.repeat(8_000)}</svg>`;
  assert.deepEqual(readPreviewVector(JSON.stringify({ svg })), { svg });
  assert.deepEqual(readPreviewVector(JSON.stringify({ refused: 'too_large' })), {
    refused: 'too_large',
  });
  const oversized = JSON.stringify({ svg: 'x'.repeat(256 * 1024 + 1) });
  for (const value of [oversized, JSON.stringify({ refused: 'other' }), 'null', null]) {
    assert.equal(readPreviewVector(value), null, String(value).slice(0, 40));
  }
});

test('a selection command is a fixed call whose previewed styles are data, not code', () => {
  const script = previewSelectScript(
    { elementId: 'el_1', instancePath: '0/2', styles: { color: '</script><b>' }, text: '<b>' },
    ['color'],
    7,
  );
  const call = 'globalThis.__droidexCanvasPreview.select(';

  assert.ok(script.startsWith(call) && script.endsWith(')'));
  assert.equal(script.includes('<'), false);
  assert.deepEqual(JSON.parse(script.slice(call.length, -1)), {
    target: {
      elementId: 'el_1',
      instancePath: '0/2',
      styles: { color: '</script><b>' },
      text: '<b>',
    },
    properties: ['color'],
    sequence: 7,
  });
});
