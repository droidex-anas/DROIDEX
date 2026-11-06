import design from './browser/browserAgentCursorDesign.json';

const ARTWORK = design.styles.droidex;
// The glyph's tip, where the agent points, as a share of the artwork's box.
const TIP = {
  x: design.hotspot.x / design.viewBoxSize,
  y: design.hotspot.y / design.viewBoxSize,
};

/**
 * An agent's pointer, its tip on the origin of whatever places it. While the
 * agent works it rocks about its tip. An agent with a name of its own is drawn
 * in its colour with the name beside it; otherwise it is DROIDEX's own glyph.
 */
export function AgentCursor({
  size,
  working,
  agent,
}: {
  size: number;
  working: boolean;
  agent?: { name: string; color: string };
}) {
  return (
    <>
      <svg
        viewBox={`0 0 ${String(design.viewBoxSize)} ${String(design.viewBoxSize)}`}
        width={size}
        height={size}
        className={`absolute block ${working ? 'agent-cursor-tilt' : ''}`}
        style={{
          left: -TIP.x * size,
          top: -TIP.y * size,
          filter: agent ? undefined : ARTWORK.overlayFilter,
          transformOrigin: `${String(TIP.x * 100)}% ${String(TIP.y * 100)}%`,
        }}
      >
        <path
          d={design.path}
          style={{ fill: agent?.color ?? ARTWORK.fill }}
          fillOpacity={ARTWORK.fillOpacity}
          stroke={ARTWORK.stroke}
          strokeWidth={design.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {agent && (
        <span
          className="absolute left-3 top-3.5 whitespace-nowrap rounded-xs px-1.5 py-px text-label text-on-presence"
          style={{ background: agent.color }}
        >
          {agent.name}
        </span>
      )}
    </>
  );
}
