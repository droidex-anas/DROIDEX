// AgentAvatar — a subagent's pixel-creature identity. While the agent is
// working, its pixels run a diagonal shimmer sweep (CSS-only, compositor
// cheap); otherwise the creature sits still.
import { CREATURE_CELLS as CELLS, pixelCreature } from '../lib/pixelCreature';

export function AgentAvatar({
  seed,
  size = 16,
  working = false,
}: {
  seed: string;
  size?: number;
  working?: boolean;
}) {
  const { grid, color } = pixelCreature(seed);
  const px = size / CELLS;
  // Cells overlap by 0.4px so no hairline seams show between lit pixels.
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      className="block"
      aria-hidden
    >
      {grid.map((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect
              key={`${String(r)}-${String(c)}`}
              x={c * px}
              y={r * px}
              width={px + 0.4}
              height={px + 0.4}
              rx={0.6}
              fill={color}
              className={working ? 'agent-avatar-pixel' : undefined}
              style={working ? { animationDelay: `${String((r + c) * 90)}ms` } : undefined}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
