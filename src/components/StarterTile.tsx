import { useEffect, type ReactNode } from 'react';

// The two tones a starter's sketch is drawn in: quiet ink for the frame of the
// thing, and one mark for the part the starter asks for.
export const SKETCH_INK = 'bg-text/10 transition-colors group-hover:bg-text/15';
export const SKETCH_MARK = 'bg-accent/35 transition-colors group-hover:bg-accent/60';

export interface Starter {
  label: string;
  hint: string;
  prompt: string;
  sketch: ReactNode;
}

/**
 * Starting points: a sketch of what each one asks for, over its name. Pressing
 * one seeds the composer without sending; hovering or focusing it shows its
 * prompt there first.
 */
export function StarterTiles({
  starters,
  onPick,
  onPreview,
}: {
  starters: readonly Starter[];
  onPick: (prompt: string) => void;
  onPreview: (prompt: string | null) => void;
}) {
  // A preview must not outlive its tiles, or the composer keeps showing it.
  useEffect(
    () => () => {
      onPreview(null);
    },
    [onPreview],
  );
  return (
    <ul
      aria-label="Starting points"
      className="grid gap-3"
      // As many columns as fit at a readable width: four beside a full
      // composer, two in a narrow tile.
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))' }}
    >
      {starters.map((starter) => (
        <li key={starter.label}>
          <button
            type="button"
            onClick={() => {
              onPreview(null);
              onPick(starter.prompt);
            }}
            onMouseEnter={() => {
              onPreview(starter.prompt);
            }}
            onMouseLeave={() => {
              onPreview(null);
            }}
            onFocus={() => {
              onPreview(starter.prompt);
            }}
            onBlur={() => {
              onPreview(null);
            }}
            className="group flex w-full cursor-pointer flex-col gap-1 rounded-xl bg-raised p-1.5 text-left shadow-sm transition duration-200 ease-out hover:shadow-lg active:scale-97 active:duration-75"
          >
            <span className="flex h-20 items-center justify-center rounded-lg bg-text/5 transition-colors duration-200 group-hover:bg-text/10">
              <span className="transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5">
                {starter.sketch}
              </span>
            </span>
            <span className="flex min-w-0 flex-col px-1.5 pb-1">
              <span className="truncate text-body-strong text-primary">{starter.label}</span>
              <span className="truncate text-caption text-muted">{starter.hint}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
