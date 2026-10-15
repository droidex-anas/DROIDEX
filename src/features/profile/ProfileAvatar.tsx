import { CREATURE_CELLS, pixelCreature } from '../../lib/pixelCreature';

export function profileSeed(profile: { username: string; displayName: string }): string {
  return profile.username || profile.displayName.trim().toLowerCase() || 'droidex';
}

// Styled inline (not Tailwind) so the public web profile can render it too.
// Pixels pop in on a diagonal when the seed changes; keyframes live in
// src/index.css and remote-web/src/profile.css as `profile-pixel-in`.
export function ProfileAvatar({ seed, size }: { seed: string; size: number }) {
  const { grid, color } = pixelCreature(seed);
  const padding = size * 0.2;
  const cell = (size - padding * 2) / CREATURE_CELLS;
  return (
    <svg
      key={seed}
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      aria-hidden
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect
        width={size}
        height={size}
        rx={size * 0.26}
        style={{ fill: `color-mix(in srgb, ${color} 16%, var(--droid-elevated))` }}
      />
      {grid.map((row, r) =>
        row.map((on, c) =>
          on ? (
            <rect
              key={`${String(r)}-${String(c)}`}
              x={padding + c * cell}
              y={padding + r * cell}
              width={cell + 0.5}
              height={cell + 0.5}
              rx={cell * 0.12}
              fill={color}
              className="profile-avatar-pixel"
              style={{ animationDelay: `${String((r + c) * 45)}ms` }}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
