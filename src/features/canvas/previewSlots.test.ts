import assert from 'node:assert/strict';
import test from 'node:test';
import {
  documentSlotOrder,
  MAX_LIVE_PREVIEWS,
  NO_PREVIEW_SLOTS,
  reducePreviewSlots,
  type PreviewSlotRequest,
  type PreviewSlots,
} from './previewSlots';

const EVERY_FRAME = ['a', 'b', 'c', 'd', 'e', 'f'];

function request(overrides: Partial<PreviewSlotRequest> = {}): PreviewSlotRequest {
  return {
    designIds: EVERY_FRAME,
    visible: [],
    interacted: null,
    selected: [],
    ...overrides,
  };
}

test('four visible frames go live and the rest do not', () => {
  const slots = reducePreviewSlots(NO_PREVIEW_SLOTS, request({ visible: EVERY_FRAME }));

  assert.equal(MAX_LIVE_PREVIEWS, 4);
  assert.deepEqual(slots.live, ['a', 'b', 'c', 'd']);
  // Nothing was released: 'e' and 'f' never held a slot to lose.
  assert.deepEqual(slots.released, []);
});

test('the interacted frame keeps its slot even after it scrolls out of view', () => {
  const live = reducePreviewSlots(
    NO_PREVIEW_SLOTS,
    request({ visible: ['f', 'a', 'b', 'c', 'd'] }),
  );
  assert.ok(live.live.includes('f'));

  const scrolledAway = reducePreviewSlots(
    live,
    request({ visible: ['a', 'b', 'c', 'd', 'e'], interacted: 'f' }),
  );

  assert.ok(scrolledAway.live.includes('f'), 'the frame being typed into stayed mounted');
  assert.equal(scrolledAway.live.length, MAX_LIVE_PREVIEWS);
  assert.deepEqual(scrolledAway.released, []);
});

test('a mounted preview outranks a nearer frame that has never been live', () => {
  const held: PreviewSlots = { live: ['c', 'd'], released: [] };

  const slots = reducePreviewSlots(held, request({ visible: ['a', 'b', 'c', 'd', 'e'] }));

  // 'e' is visible and 'c'/'d' are further from the centre, but keeping two
  // running previews mounted is worth more than mounting the nearer one.
  assert.deepEqual(new Set(slots.live), new Set(['a', 'b', 'c', 'd']));
  assert.deepEqual(slots.released, []);
});

test('selection claims a slot ahead of a frame that merely sits nearer', () => {
  const slots = reducePreviewSlots(
    NO_PREVIEW_SLOTS,
    request({ visible: ['a', 'b', 'c', 'd', 'e'], selected: ['e'] }),
  );

  assert.ok(slots.live.includes('e'));
  assert.deepEqual(slots.live, ['e', 'a', 'b', 'c']);
});

test("a document's nearest tiles take slots from farther live ones, past a small margin", () => {
  const held: PreviewSlots = { live: ['a', 'b', 'c', 'd'], released: [] };
  const claim = (distancesPx: Record<string, number>) => {
    const order = documentSlotOrder(new Map(Object.entries(distancesPx)), held.live);
    return reducePreviewSlots(held, request({ visible: order, selected: order }));
  };

  const scrolled = claim({ e: 0, a: 100, b: 200, c: 300, d: 400 });
  assert.deepEqual(scrolled.live, ['e', 'a', 'b', 'c']);
  assert.deepEqual(scrolled.released, ['d']);

  // A pixel nearer than 'd' is not reason enough to stop a running preview.
  assert.equal(claim({ a: 0, b: 100, c: 200, d: 300, e: 299 }), held);
});

test('a released frame says so until it is live again', () => {
  const live = reducePreviewSlots(NO_PREVIEW_SLOTS, request({ visible: ['a', 'b', 'c', 'd'] }));

  const movedOn = reducePreviewSlots(live, request({ visible: ['e', 'f', 'c', 'd'] }));
  // 'c' and 'd' are still visible, so they keep the slots they already hold;
  // 'a' and 'b' lost their guests, so returning to them reloads the design.
  assert.deepEqual(movedOn.live, ['c', 'd', 'e', 'f']);
  assert.deepEqual(movedOn.released, ['a', 'b']);

  const back = reducePreviewSlots(movedOn, request({ visible: ['a', 'b', 'c', 'd'] }));
  // 'a' is running again, so it has nothing left to explain; 'e' and 'f' do.
  assert.equal(back.released.includes('a'), false);
  assert.deepEqual(new Set(back.released), new Set(['e', 'f']));
});

test('slots for a deleted design are forgotten', () => {
  const held: PreviewSlots = { live: ['a', 'b'], released: ['c'] };

  const slots = reducePreviewSlots(held, request({ designIds: ['a'], visible: ['a', 'b', 'c'] }));

  assert.deepEqual(slots.live, ['a']);
  assert.deepEqual(slots.released, []);
});

test('an unchanged request keeps the same slots, so nothing remounts', () => {
  const live = reducePreviewSlots(NO_PREVIEW_SLOTS, request({ visible: ['a', 'b'] }));

  assert.equal(reducePreviewSlots(live, request({ visible: ['a', 'b'] })), live);
});
