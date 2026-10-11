import type { BrowserAgentCursorStyle } from '../../lib/browserSettings';
import design from './browserAgentCursorDesign.json';

// The artwork's glow, with a soft contact shadow under it so a pale glyph
// still has an edge on a white page.
const CONTACT_SHADOW = 'drop-shadow(0 1px 1.5px rgba(16, 32, 90, 0.45))';

/**
 * The agent's cursor artwork in one of its styles: `page` draws it as it
 * looks over a page, otherwise it is the small icon that names the style.
 */
export function AgentCursorGlyph({
  cursorStyle,
  page = false,
  className,
}: {
  cursorStyle: BrowserAgentCursorStyle;
  page?: boolean;
  className?: string;
}) {
  const artwork = design.styles[cursorStyle];
  const filter = page
    ? `${artwork.overlayFilter} ${CONTACT_SHADOW}`
    : (artwork.iconFilter ?? artwork.overlayFilter);
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${String(design.viewBoxSize)} ${String(design.viewBoxSize)}`}
      className={className}
      style={{ filter }}
    >
      <path
        d={design.path}
        fill={artwork.fill}
        fillOpacity={artwork.fillOpacity}
        stroke={artwork.stroke}
        strokeWidth={design.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
