// A working frame's last captured picture, for when it holds no live preview
// slot. Main keeps the latest capture per revision for this app run, so a frame
// that has not been previewed yet has none and shows its fallback instead.

import { useEffect, useState, type ReactNode } from 'react';
import { readCanvasThumbnail } from '../../lib/desktop';

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
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let wanted = true;
    let created: string | null = null;
    setUrl(null);
    readCanvasThumbnail(canvasId, designId, revisionId).then(
      (png) => {
        if (!wanted || !png) return;
        created = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }));
        setUrl(created);
      },
      (error: unknown) => {
        console.error('A Canvas thumbnail could not be read:', error);
      },
    );
    return () => {
      wanted = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [canvasId, designId, revisionId]);

  if (url === null) return fallback;
  return <img className="canvas-sheet-thumbnail" src={url} alt="" draggable={false} />;
}
