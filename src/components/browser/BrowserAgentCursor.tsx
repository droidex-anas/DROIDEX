import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { onNativeBrowserAgentPoint } from '../../lib/nativeBrowser';
import { AgentCursor } from '../AgentCursor';
import design from './browserAgentCursorDesign.json';

// Where the agent last pointed, in the page's own pixels, the scale the page
// is drawn at, and the glide that takes the cursor there.
interface Cursor {
  x: number;
  y: number;
  glideMs: number;
  scale: number;
}

/**
 * The agent's cursor over a page, in the pane or picture in picture. It glides to where the agent
 * points and, while the agent works, rests there rocking about its tip. The
 * app draws it above the page, so it is never part of the page or of the
 * agent's screenshots, and input never waits for it. It follows the page's
 * points whether the pane shows the page or not, and draws only when it does.
 */
export function BrowserAgentCursor({
  browserSessionId,
  scale,
  shown,
  working,
  size = design.size.default,
}: {
  browserSessionId: string;
  /** How large the page is drawn. */
  scale: number;
  shown: boolean;
  working: boolean;
  /** The glyph's size; smaller on a small picture of the page. */
  size?: number;
}) {
  const [cursor, setCursor] = useState<Cursor | null>(null);

  useEffect(
    () =>
      onNativeBrowserAgentPoint(({ browserSessionId: id, x, y }) => {
        if (id !== browserSessionId) return;
        // The first point is where it appears; after that, a longer way takes
        // a little longer, from 120 to 220 ms.
        setCursor((from) => ({
          x,
          y,
          glideMs: from
            ? Math.round(Math.min(220, 120 + (Math.hypot(x - from.x, y - from.y) * scale) / 8))
            : 0,
          scale,
        }));
      }),
    [browserSessionId, scale],
  );

  // A page drawn at a new size takes its cursor along at once: only a new
  // point is a glide.
  if (cursor && cursor.scale !== scale) setCursor({ ...cursor, scale, glideMs: 0 });

  if (!cursor || !shown) return null;
  return (
    <div
      aria-hidden
      className="agent-cursor pointer-events-none absolute left-0 top-0"
      style={
        {
          opacity: working ? 1 : 0,
          transform: `translate(${String(cursor.x * scale)}px, ${String(cursor.y * scale)}px)`,
          '--glide': `${String(cursor.glideMs)}ms`,
        } as CSSProperties
      }
    >
      <AgentCursor size={size} working={working} />
    </div>
  );
}
