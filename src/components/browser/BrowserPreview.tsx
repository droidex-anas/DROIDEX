import { useEffect, useRef, useState } from 'react';
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
 * running and the card is on screen; otherwise it is the last frame it showed,
 * and a card that never had one has no picture.
 */
export function BrowserPreview({
  cardKey,
  browserSessionId,
  live,
}: {
  cardKey: string;
  browserSessionId: string;
  /** The card's turn is still running. */
  live: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(() => lastFrames.get(cardKey) ?? null);
  const [onScreen, setOnScreen] = useState(false);
  const [width, setWidth] = useState(0);
  const working = browserSessionId in useBrowserHost().working;

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
    if (!live || !onScreen) return;
    return watchNativeBrowser(browserSessionId, (next) => {
      keep(cardKey, next);
      setFrame(next);
    });
  }, [browserSessionId, cardKey, live, onScreen]);

  return (
    // The box is there from the start, so the card is seen arriving on screen;
    // it takes no room until there is a picture.
    <div
      ref={boxRef}
      className={`relative overflow-hidden bg-droid-elevated ${frame ? 'aspect-[16/10] border-b border-droid-border' : ''}`}
    >
      {frame && (
        <>
          <img
            src={`data:image/jpeg;base64,${frame.image}`}
            alt=""
            draggable={false}
            className="block w-full select-none"
          />
          <BrowserAgentCursor
            browserSessionId={browserSessionId}
            scale={width / frame.width}
            shown={live}
            working={working}
            size={design.size.min}
          />
        </>
      )}
    </div>
  );
}
