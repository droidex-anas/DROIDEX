import assert from 'node:assert/strict';
import test from 'node:test';
import { computePosition, type Placement, type Platform, type Rect } from '@floating-ui/react';
import { popoverMiddleware } from './usePopoverPosition';

const WINDOW = { x: 0, y: 0, width: 800, height: 600 };

// A window of fixed size with one anchor and one layer: just the geometry
// floating-ui asks for, so the test exercises the real middleware stack.
function platformFor(anchor: Rect, layer: { width: number; height: number }): Platform {
  return {
    getElementRects: () => ({ reference: anchor, floating: { x: 0, y: 0, ...layer } }),
    getDimensions: () => layer,
    getClippingRect: () => WINDOW,
    isElement: () => true,
    getOffsetParent: () => undefined,
    convertOffsetParentRelativeRectToViewportRelativeRect: ({ rect }) => rect,
    getScale: () => ({ x: 1, y: 1 }),
    isRTL: () => false,
  };
}

async function place(anchor: Rect, placement: Placement, layerHeight = 200) {
  const layer = { width: 240, height: layerHeight };
  const floating = { style: { setProperty: () => undefined } };
  return computePosition(anchor as unknown as Element, floating as unknown as HTMLElement, {
    placement,
    strategy: 'fixed',
    middleware: popoverMiddleware(4),
    platform: platformFor(anchor, layer),
  });
}

test('a menu that does not fit below its anchor flips above it', async () => {
  const nearBottom = { x: 100, y: 560, width: 80, height: 28 };
  const { placement, y } = await place(nearBottom, 'bottom-start');
  assert.equal(placement, 'top-start');
  assert.equal(y, 560 - 4 - 200);
});

test('a menu at the right edge stays 8px inside the window', async () => {
  const nearRight = { x: 760, y: 100, width: 30, height: 28 };
  const { x, placement } = await place(nearRight, 'bottom-start');
  assert.equal(placement.split('-')[0], 'bottom');
  assert.ok(x >= 8 && x + 240 <= 800 - 8, `layer spans ${String(x)}..${String(x + 240)}`);
});
