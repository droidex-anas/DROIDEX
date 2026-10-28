import { useEffect, useRef, useState } from 'react';
import { useDocumentVisible } from '../../hooks/useDocumentVisible';
import { useBrowserHost } from '../../lib/browserHost';
import { watchNativeBrowser, type NativeBrowserFrame } from '../../lib/nativeBrowser';
import { BrowserAgentCursor } from './BrowserAgentCursor';
import design from './browserAgentCursorDesign.json';

// The last picture each card showed, so a card that scrolls away and back, or
// whose turn has ended, still shows the page as it last was. Kept in memory
// only, and only for the newest cards.
const lastFrames = new Map<string, NativeBrowserFrame>();
const KEPT_FRAMES = 12;

function keep(cardKey: string, frame: NativeBrowserFrame): void {
  lastFrames.delete(cardKey);
  lastFrames.set(cardKey, frame);
  const oldest = lastFrames.keys().next().value;
  if (lastFrames.size > KEPT_FRAMES && oldest !== undefined) lastFrames.delete(oldest);
}

/**
 * A small picture of the page at the top of the transcript's Browser card,
 * with the agent's cursor over it. It is live only while the card's turn is
 * running, the card is on screen and the browser is open; otherwise it is the
 * last frame it showed, and a card that never had one has no picture.
 */
export function BrowserPreview({
  cardKey,
  browserSessionId,
  live,
}: {
  cardKey: string;
  /** The chat's open browser, if it has one. */
  browserSessionId?: string;
  /** The card's turn is still running. */
  live: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(() => lastFrames.get(cardKey) ?? null);
  const [onScreen, setOnScreen] = useState(false);
  const [width, setWidth] = useState(0);
  const visible = useDocumentVisible();
  const busy = useBrowserHost().working;
  const working = browserSessionId !== undefined && browserSessionId in busy;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const seen = new IntersectionObserver(([entry]) => {
      setOnScreen(entry.isIntersecting);
    });
    const sized = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    seen.observe(box);
    sized.observe(box);
    return () => {
      seen.disconnect();
      sized.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!browserSessionId || !live || !onScreen || !visible) return;
    return watchNativeBrowser(browserSessionId, (next) => {
      keep(cardKey, next);
      setFrame(next);
    });
  }, [browserSessionId, cardKey, live, onScreen, visible]);

  // The page is fitted whole inside the box, so a phone's tall page stands
  // in the middle rather than being cut off below its top.
  const fit = frame ? Math.min(width / frame.width, (width * 10) / 16 / frame.height) : 0;

  return (
    // The box is there from the start, so the card is seen arriving on screen;
    // it takes no room until there is a picture.
    <div
      ref={boxRef}
      className={`relative overflow-hidden bg-droid-elevated ${frame ? 'aspect-[16/10] border-b border-droid-border' : ''}`}
    >
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={frame ? { width: frame.width * fit, height: frame.height * fit } : undefined}
      >
        {frame && (
          <img
            src={`data:image/jpeg;base64,${frame.image}`}
            alt=""
            draggable={false}
            className="block h-full w-full select-none"
          />
        )}
        {/* Mounted before the first frame of a live card, so a point that
            comes first is kept. Keyed by browser, so a new one never starts
            at the last one's point. */}
        {browserSessionId && (live || frame) && (
          <BrowserAgentCursor
            key={browserSessionId}
            browserSessionId={browserSessionId}
            scale={fit}
            shown={live && frame !== null}
            working={working}
            size={design.size.min}
          />
        )}
      </div>
    </div>
  );
}
