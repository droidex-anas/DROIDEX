import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { onNativeBrowserAgentPoint } from '../../lib/nativeBrowser';
import design from './browserAgentCursorDesign.json';

const ARTWORK = design.styles.droidex;
const SIZE = design.size.default;
// The glyph's tip, where the agent points, as a share of the artwork's box.
const TIP = {
  x: design.hotspot.x / design.viewBoxSize,
  y: design.hotspot.y / design.viewBoxSize,
};

interface Cursor {
  x: number;
  y: number;
  glideMs: number;
}

/**
 * The agent's cursor over a page in the pane. It glides to where the agent
 * points and, while the agent works, rests there tilting about its tip. The
 * app draws it above the page, so it is never part of the page or of the
 * agent's screenshots, and input never waits for it.
 */
export function BrowserAgentCursor({
  browserSessionId,
  scale,
  working,
}: {
  browserSessionId: string;
  /** How large the pane draws the page; points arrive in the page's own pixels. */
  scale: number;
  working: boolean;
}) {
  const [cursor, setCursor] = useState<Cursor | null>(null);

  useEffect(
    () =>
      onNativeBrowserAgentPoint((event) => {
        if (event.browserSessionId !== browserSessionId) return;
        const next = { x: event.x * scale, y: event.y * scale };
        // The first point is where it appears; after that, a longer way takes
        // a little longer, from 120 to 220 ms.
        setCursor((from) => ({
          ...next,
          glideMs: from
            ? Math.round(Math.min(220, 120 + Math.hypot(next.x - from.x, next.y - from.y) / 8))
            : 0,
        }));
      }),
    [browserSessionId, scale],
  );

  if (!cursor) return null;
  return (
    <div
      aria-hidden
      className="agent-cursor pointer-events-none absolute left-0 top-0"
      style={
        {
          width: SIZE,
          height: SIZE,
          opacity: working ? 1 : 0,
          transform: `translate(${String(cursor.x - TIP.x * SIZE)}px, ${String(cursor.y - TIP.y * SIZE)}px)`,
          '--glide': `${String(cursor.glideMs)}ms`,
        } as CSSProperties
      }
    >
      <svg
        viewBox={`0 0 ${String(design.viewBoxSize)} ${String(design.viewBoxSize)}`}
        className={`block h-full w-full ${working ? 'agent-cursor-tilt' : ''}`}
        style={{
          filter: ARTWORK.overlayFilter,
          transformOrigin: `${String(TIP.x * 100)}% ${String(TIP.y * 100)}%`,
        }}
      >
        <path
          d={design.path}
          fill={ARTWORK.fill}
          fillOpacity={ARTWORK.fillOpacity}
          stroke={ARTWORK.stroke}
          strokeWidth={design.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
