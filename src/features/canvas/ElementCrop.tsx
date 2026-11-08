// A picked element as its frame's latest capture shows it, cut to the pick's
// box, for its composer chip. Main keeps captures per revision for this app
// run, so a revision not captured yet keeps the chip's icon until it is.

import { useEffect, useRef, useState } from 'react';
import { MousePointerSquareDashed } from '@droidex/icons';
import { readCanvasThumbnail } from '../../lib/desktop';
import { onCanvasImageCaptured } from './captureCanvasImage';
import type { ElementPin } from './elementPins';
import type { FrameRect } from './protocol';

/** The crop's backing size: a 16 px chip mark at twice the pixel density. */
const CROP_PX = 32;

export function ElementCrop({ pin }: { pin: ElementPin }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const { canvasId, element, frameWidth } = pin;

  useEffect(() => {
    let wanted = true;
    const { designId, revisionId } = element;
    const box = element.text?.box ?? element.box;
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
  }, [canvasId, element, frameWidth]);

  return (
    <>
      <canvas
        ref={canvas}
        width={CROP_PX}
        height={CROP_PX}
        hidden={!drawn}
        className="h-4 w-4 rounded-xs"
        aria-hidden
      />
      {!drawn && <MousePointerSquareDashed className="h-4 w-4" aria-hidden />}
    </>
  );
}

/**
 * Draws `box`, in the frame's pixels, from a capture of that frame, whole and
 * centred in the square; false when none of it is in the capture.
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
  const fit = Math.min(CROP_PX / width, CROP_PX / height);
  const drawnWidth = width * fit;
  const drawnHeight = height * fit;
  context.clearRect(0, 0, CROP_PX, CROP_PX);
  context.drawImage(
    capture,
    left,
    top,
    width,
    height,
    (CROP_PX - drawnWidth) / 2,
    (CROP_PX - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
  return true;
}
