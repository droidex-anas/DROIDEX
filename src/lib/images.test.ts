import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCropRect,
  dataUrlMime,
  displayedToNaturalRect,
  fitWithin,
  isFullImageRect,
  isPersistableMime,
  MIN_CROP_SIDE,
} from './images';

test('fitWithin scales down by the longer side and never upscales', () => {
  // [width, height, cap, expected width, expected height]
  const cases: Array<[number, number, number, number, number]> = [
    [800, 600, 2048, 800, 600], // already fits
    [100, 50, 99999, 100, 50], // never upscales, even with a huge cap
    [4096, 2048, 2048, 2048, 1024], // landscape scales by width
    [1000, 4000, 2000, 500, 2000], // portrait scales by height
    [5000, 5000, 0, 5000, 5000], // a zero cap means no resizing
    [5000, 2, 1000, 1000, 1], // tiny results keep at least one pixel
  ];
  for (const [width, height, cap, expectedWidth, expectedHeight] of cases) {
    assert.deepEqual(fitWithin({ width, height }, cap), {
      width: expectedWidth,
      height: expectedHeight,
    });
  }
});

test('clampCropRect keeps a valid rect, clamps overflow, negatives, and tiny sides, and spots a no-op crop', () => {
  const image = { width: 1000, height: 500 };
  const valid = { x: 10, y: 10, width: 200, height: 100 };
  assert.deepEqual(clampCropRect(valid, image), valid);
  assert.deepEqual(clampCropRect({ x: 900, y: 400, width: 500, height: 500 }, image), {
    x: 500,
    y: 0,
    width: 500,
    height: 500,
  });
  assert.deepEqual(clampCropRect({ x: -50, y: -20, width: 100, height: 100 }, image), {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });
  const tiny = clampCropRect({ x: 0, y: 0, width: 1, height: 1 }, image);
  assert.equal(tiny.width, MIN_CROP_SIDE);
  assert.equal(tiny.height, MIN_CROP_SIDE);

  const square = { width: 100, height: 100 };
  assert.equal(isFullImageRect({ x: 0, y: 0, width: 100, height: 100 }, square), true);
  assert.equal(isFullImageRect({ x: 1, y: 0, width: 100, height: 100 }, square), false);
});

test('displayedToNaturalRect scales a preview rect to natural pixels and clamps it', () => {
  const natural = { width: 2000, height: 1000 };
  const displayed = { width: 1000, height: 500 };
  assert.deepEqual(
    displayedToNaturalRect({ x: 100, y: 50, width: 400, height: 200 }, displayed, natural),
    { x: 200, y: 100, width: 800, height: 400 },
  );
  const out = displayedToNaturalRect(
    { x: 900, y: 450, width: 400, height: 200 },
    displayed,
    natural,
  );
  assert.ok(out.x + out.width <= natural.width);
  assert.ok(out.y + out.height <= natural.height);
});

test('data URL MIME types are read and only the desktop store allowlist persists', () => {
  assert.equal(dataUrlMime('data:image/png;base64,iVBOR'), 'image/png');
  assert.equal(dataUrlMime('data:image/svg+xml;base64,PHN2Zw'), 'image/svg+xml');
  assert.equal(dataUrlMime('not-a-data-url'), undefined);

  assert.equal(isPersistableMime('image/png'), true);
  assert.equal(isPersistableMime('image/jpeg'), true);
  assert.equal(isPersistableMime('image/webp'), true);
  assert.equal(isPersistableMime('image/gif'), true);
  assert.equal(isPersistableMime('image/svg+xml'), false);
  assert.equal(isPersistableMime('image/avif'), false);
  assert.equal(isPersistableMime(undefined), false);
});
