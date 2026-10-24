import { useEffect, useRef, useState } from 'react';
import { Browser } from '@droidex/icons';
import { useDocumentVisible } from '../../hooks/useDocumentVisible';
import { useBrowserHost } from '../../lib/browserHost';
import { watchNativeBrowser, type NativeBrowserFrame } from '../../lib/nativeBrowser';
import { BrowserAgentCursor } from './BrowserAgentCursor';
import design from './browserAgentCursorDesign.json';

/** A read-only live picture; the native page keeps its viewport and ownership. */
export function BrowserPreview({ browserSessionId }: { browserSessionId: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<NativeBrowserFrame | null>(null);
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
    return watchNativeBrowser(browserSessionId, setFrame);
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
        {shown && (
          <img
            src={`data:image/jpeg;base64,${frame.image}`}
            alt="Agent's browser"
            draggable={false}
            className="block h-full w-full select-none"
          />
        )}
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
