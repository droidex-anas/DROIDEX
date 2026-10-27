import { useEffect, useRef, useState } from 'react';
import { Browser } from '@droidex/icons';
import { useDocumentVisible } from '../../hooks/useDocumentVisible';
import { useBrowserHost } from '../../lib/browserHost';
import { watchNativeBrowser, type NativeBrowserFrame } from '../../lib/nativeBrowser';
import { BrowserAgentCursor } from './BrowserAgentCursor';
import design from './browserAgentCursorDesign.json';

interface PageSize {
  width: number;
  height: number;
}

/** A read-only live picture; the native page keeps its viewport and ownership. */
export function BrowserPreview({ browserSessionId }: { browserSessionId: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<PageSize | null>(null);
  const [width, setWidth] = useState(0);
  const visible = useDocumentVisible();
  const host = useBrowserHost();
  const working = browserSessionId in host.working;
  const crashed = browserSessionId in host.crashed;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    // Frames decode off the main thread and draw in arrival order; a frame
    // whose decode finishes after a newer one has drawn is dropped.
    let latest = 0;
    let drawn = 0;
    let stopped = false;
    const draw = async (next: NativeBrowserFrame) => {
      const order = ++latest;
      const bitmap = await createImageBitmap(new Blob([next.image], { type: 'image/jpeg' }));
      const canvas = canvasRef.current;
      if (stopped || order < drawn || !canvas) {
        bitmap.close();
        return;
      }
      drawn = order;
      if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
      if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      bitmap.close();
      setFrame((size) =>
        size?.width === next.width && size.height === next.height
          ? size
          : { width: next.width, height: next.height },
      );
    };
    const stop = watchNativeBrowser(browserSessionId, (next) => {
      draw(next).catch(() => undefined);
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [browserSessionId, visible]);

  // The page is fitted whole inside the box, so a phone's tall page stands
  // in the middle rather than being cut off below its top.
  const fit = frame ? Math.min(width / frame.width, (width * 10) / 16 / frame.height) : 0;
  const shown = frame !== null && !crashed;

  return (
    <div ref={boxRef} className="relative aspect-browser overflow-hidden bg-elevated">
      {!shown && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
          <Browser className="size-icon-lg" aria-hidden="true" />
          <span className="text-caption">
            {crashed ? 'Open the browser to reload it.' : 'Waiting for the browser…'}
          </span>
        </div>
      )}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={frame ? { width: frame.width * fit, height: frame.height * fit } : undefined}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Agent's browser"
          className={`h-full w-full select-none ${shown ? 'block' : 'hidden'}`}
        />
        <BrowserAgentCursor
          browserSessionId={browserSessionId}
          scale={fit}
          shown={shown}
          working={working}
          size={design.size.min}
        />
      </div>
    </div>
  );
}
