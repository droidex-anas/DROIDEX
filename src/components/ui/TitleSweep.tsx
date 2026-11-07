import { useState, type Ref } from 'react';

interface TitleSweepProps {
  title: string;
  // Classes for the text itself: its type, colour and how it truncates.
  className: string;
  // Lets one title follow another, such as a sidebar row after its header.
  delayMs?: number;
  ref?: Ref<HTMLSpanElement>;
}

interface Sweep {
  title: string;
  previous: string | null;
  changes: number;
}

// A title that writes itself in when it changes, so a chat's name arriving
// reads as news instead of a flicker. The first title shows as it is.
export function TitleSweep({ title, className, delayMs = 0, ref }: TitleSweepProps) {
  const [sweep, setSweep] = useState<Sweep>({ title, previous: null, changes: 0 });
  if (sweep.title !== title) {
    setSweep({ title, previous: sweep.title, changes: sweep.changes + 1 });
  }
  const sweeping = sweep.previous !== null;
  return (
    <span className="relative block min-w-0">
      <span
        key={sweep.changes}
        className={sweeping ? 'title-sweep-in' : 'block'}
        style={sweeping ? { animationDelay: `${String(delayMs)}ms` } : undefined}
        onAnimationEnd={(event) => {
          if (event.animationName !== 'title-sweep-in') return;
          setSweep((current) => ({ ...current, previous: null }));
        }}
      >
        <span ref={ref} className={className}>
          {title}
        </span>
      </span>
      {sweeping && (
        <span aria-hidden="true" className="title-sweep-out">
          <span className={className}>{sweep.previous}</span>
        </span>
      )}
    </span>
  );
}
