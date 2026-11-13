// The drawing inside a picked element's chip tile (ElementCrop.tsx): the
// frame's latest capture, cropped to the pick's box, redrawn whenever that
// revision is captured again.

import { useEffect, useRef, useState } from 'react';
import { MousePointerSquareDashed } from '@droidex/icons';
import { readCanvasThumbnail } from '../../lib/desktop';
import { onCanvasImageCaptured } from './captureCanvasImage';
import type { ElementPin } from './elementPins';
import type { FrameRect } from './protocol';

export function ElementCropCanvas({
  pin,
  box,
  width,
  height,
}: {
  pin: ElementPin;
  box: FrameRect;
  /** The tile's size in CSS px; the canvas draws at twice it. */
  width: number;
  height: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const { canvasId, element, frameWidth } = pin;

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
    <>
      <canvas
        ref={canvas}
        width={width * 2}
        height={height * 2}
        hidden={!drawn}
        className="h-full w-full"
      />
      {!drawn && <MousePointerSquareDashed className="h-4 w-4" />}
    </>
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
