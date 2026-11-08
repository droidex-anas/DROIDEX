// A picked element as its frame's latest capture shows it, for its composer
// chip: the pick's box at the capture's scale, letterboxed whole into a tile
// 24 px tall and up to twice as wide. Main keeps captures per revision for
// this app run, so a revision not captured yet shows the chip's icon on the
// tile until it is; a box too small to read shows the icon alone.

import { useEffect, useRef, useState } from 'react';
import { MousePointerSquareDashed } from '@droidex/icons';
import { readCanvasThumbnail } from '../../lib/desktop';
import { onCanvasImageCaptured } from './captureCanvasImage';
import type { ElementPin } from './elementPins';
import type { FrameRect } from './protocol';

const TILE_HEIGHT_PX = 24;
const MAX_TILE_WIDTH_PX = 48;
/** Below this, in the design's own pixels, a box is too small to read in a crop. */
const MIN_BOX_PX = 4;

export function ElementCrop({ pin }: { pin: ElementPin }) {
  const box = pin.element.text?.box ?? pin.element.box;
  if (box.width < MIN_BOX_PX || box.height < MIN_BOX_PX)
    return <MousePointerSquareDashed className="h-4 w-4" aria-hidden />;
  return <CropTile pin={pin} box={box} />;
}

function CropTile({ pin, box }: { pin: ElementPin; box: FrameRect }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const { canvasId, element, frameWidth } = pin;
  // Sized from the box alone, so the chip keeps its width as the crop arrives.
  const width = Math.min(
    MAX_TILE_WIDTH_PX,
    Math.max(TILE_HEIGHT_PX, Math.round((TILE_HEIGHT_PX * box.width) / box.height)),
  );

  useEffect(() => {
    let wanted = true;
    const { designId, revisionId } = element;
    const read = async () => {
      const png = await readCanvasThumbnail(canvasId, designId, revisionId);
      if (!png) return;
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(png)], { type: 'image/png' }),
      );
      try {
        if (wanted && canvas.current) setDrawn(drawCrop(canvas.current, bitmap, box, frameWidth));
      } finally {
        bitmap.close();
      }
    };
    const draw = () => {
      read().catch((error: unknown) => {
        console.error('A picked element’s crop could not be drawn:', error);
      });
    };
    draw();
    const stopListening = onCanvasImageCaptured(canvasId, { designId, revisionId }, draw);
    return () => {
      wanted = false;
      stopListening();
    };
  }, [canvasId, element, box, frameWidth]);

  return (
    <span
      data-element-crop
      // eslint-disable-next-line design-policy/design-tokens -- colour swatch edge: an arbitrary design crop needs an edge to read on the composer
      className="relative flex h-6 shrink-0 items-center justify-center overflow-hidden rounded-xs bg-elevated ring-1 ring-inset ring-divider-strong"
      style={{ width }}
      aria-hidden
    >
      <canvas
        ref={canvas}
        width={width * 2}
        height={TILE_HEIGHT_PX * 2}
        hidden={!drawn}
        className="h-full w-full"
      />
      {!drawn && <MousePointerSquareDashed className="h-4 w-4" />}
    </span>
  );
}

/**
 * Draws `box`, in the frame's pixels, from a capture of that frame, whole and
 * centred in the tile; false when none of it is in the capture.
 */
function drawCrop(
  target: HTMLCanvasElement,
  capture: ImageBitmap,
  box: FrameRect,
  frameWidth: number,
): boolean {
  const context = target.getContext('2d');
  if (!context || frameWidth <= 0) return false;
  const scale = capture.width / frameWidth;
  const left = Math.max(0, box.x * scale);
  const top = Math.max(0, box.y * scale);
  const width = Math.min(capture.width, (box.x + box.width) * scale) - left;
  const height = Math.min(capture.height, (box.y + box.height) * scale) - top;
  if (width < 1 || height < 1) return false;
  const fit = Math.min(target.width / width, target.height / height);
  const drawnWidth = width * fit;
  const drawnHeight = height * fit;
  context.clearRect(0, 0, target.width, target.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    capture,
    left,
    top,
    width,
    height,
    (target.width - drawnWidth) / 2,
    (target.height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
  return true;
}
