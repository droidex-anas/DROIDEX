// A working frame's last captured picture, for when it holds no live preview
// slot. Main keeps the latest capture per revision for this app run, so a frame
// that has not been previewed yet shows its fallback until its first capture.

import { useEffect, useState, type ReactNode } from 'react';
import { readCanvasThumbnail } from '../../lib/desktop';
import { onCanvasImageCaptured } from './captureCanvasImage';

export function FrameThumbnail({
  canvasId,
  designId,
  revisionId,
  fallback,
}: {
  canvasId: string;
  designId: string;
  revisionId: string;
  fallback: ReactNode;
}) {
  // undefined while the first read is out, so a kept picture never shows its
  // fallback first; null once there is none.
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let wanted = true;
    let created: string | null = null;
    setUrl(undefined);
    const read = () => {
      readCanvasThumbnail(canvasId, designId, revisionId).then(
        (png) => {
          if (!wanted) return;
          if (!png) {
            setUrl((shown) => shown ?? null);
            return;
          }
          if (created) URL.revokeObjectURL(created);
          created = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }));
          setUrl(created);
        },
        (error: unknown) => {
          console.error('A Canvas thumbnail could not be read:', error);
          if (wanted) setUrl((shown) => shown ?? null);
        },
      );
    };
    read();
    const stopListening = onCanvasImageCaptured(canvasId, { designId, revisionId }, read);
    return () => {
      wanted = false;
      stopListening();
      if (created) URL.revokeObjectURL(created);
    };
  }, [canvasId, designId, revisionId]);

  if (url === undefined) return null;
  if (url === null) return fallback;
  // Whole, as the board shows the frame: a card's 16:10 tile must not cut a
  // portrait frame down to its top.
  return (
    <img
      className="canvas-state-reveal h-full w-full object-contain"
      src={url}
      alt=""
      draggable={false}
    />
  );
}
