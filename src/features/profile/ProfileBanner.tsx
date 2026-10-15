import { activityCalendar, heatLevel, type ActivityDay } from './activityCalendar';

const COLUMNS = 70;
const CELL = 8;
const STEP = 11;
const MAX_STACK = 8;
const HEIGHT = 120;

// A cover drawn from the owner's last ten weeks: one pixel column per day,
// stacked by intensity, so every profile's banner is its own skyline.
// Styled inline so the public web profile can render it too.
export function ProfileBanner({
  days,
  end,
  color,
  height,
}: {
  days: readonly ActivityDay[];
  end: Date;
  color: string;
  height: number;
}) {
  const recent = activityCalendar(days, end, 11)
    .filter((day) => !day.future)
    .slice(-COLUMNS);
  const peak = Math.max(1, ...recent.map((day) => day.tokens));
  const width = recent.length * STEP;
  return (
    <div
      aria-hidden
      style={{
        height,
        overflow: 'hidden',
        background: `radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, ${color} 30%, var(--droid-surface)) 0%, color-mix(in srgb, ${color} 10%, var(--droid-surface)) 55%, var(--droid-surface) 100%)`,
      }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${String(width)} ${String(HEIGHT)}`}
        preserveAspectRatio="xMaxYMax slice"
        style={{ display: 'block' }}
      >
        {recent.map((day, column) => {
          const level = heatLevel(day.tokens, peak);
          const stack = level === 0 ? 1 : level * 2;
          return (
            <g
              key={day.key}
              className="profile-banner-bar"
              style={{ animationDelay: `${String(column * 8)}ms` }}
            >
              {Array.from({ length: MAX_STACK }, (_, row) => {
                const lit = row < stack;
                return (
                  <rect
                    key={row}
                    x={column * STEP}
                    y={HEIGHT - 10 - (row + 1) * STEP}
                    width={CELL}
                    height={CELL}
                    rx={1.5}
                    fill={color}
                    opacity={lit ? 0.35 + (0.5 * (row + 1)) / MAX_STACK : 0.06}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
