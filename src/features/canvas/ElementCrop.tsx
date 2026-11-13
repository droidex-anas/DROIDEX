// A picked element as its frame's latest capture shows it, for its composer
// chip: the pick's box at the capture's scale, letterboxed whole into a tile
// 24 px tall and up to twice as wide. Main keeps captures per revision for
// this app run, so a revision not captured yet shows the chip's icon on the
// tile until it is; a box too small to read shows the icon alone.

import { lazy, Suspense } from 'react';
import { MousePointerSquareDashed } from '@droidex/icons';
import type { ElementPin } from './elementPins';

const TILE_HEIGHT_PX = 24;
const MAX_TILE_WIDTH_PX = 48;
/** Below this, in the design's own pixels, a box is too small to read in a crop. */
const MIN_BOX_PX = 4;

// An element is picked on the canvas, so the drawing loads with the canvas code,
// not the entry; the tile keeps its size meanwhile, so the chip does not move.
const CropCanvas = lazy(() =>
  import('./ElementCropCanvas').then((module) => ({ default: module.ElementCropCanvas })),
);

export function ElementCrop({ pin }: { pin: ElementPin }) {
  const box = pin.element.text?.box ?? pin.element.box;
  if (box.width < MIN_BOX_PX || box.height < MIN_BOX_PX)
    return <MousePointerSquareDashed className="h-4 w-4" aria-hidden />;
  // Sized from the box alone, so the chip keeps its width as the crop arrives.
  const width = Math.min(
    MAX_TILE_WIDTH_PX,
    Math.max(TILE_HEIGHT_PX, Math.round((TILE_HEIGHT_PX * box.width) / box.height)),
  );
  return (
    <span
      data-element-crop
      // eslint-disable-next-line design-policy/design-tokens -- colour swatch edge: an arbitrary design crop needs an edge to read on the composer
      className="relative flex h-6 shrink-0 items-center justify-center overflow-hidden rounded-xs bg-elevated ring-1 ring-inset ring-divider-strong"
      style={{ width }}
      aria-hidden
    >
      <Suspense fallback={<MousePointerSquareDashed className="h-4 w-4" />}>
        <CropCanvas pin={pin} box={box} width={width} height={TILE_HEIGHT_PX} />
      </Suspense>
    </span>
  );
}
