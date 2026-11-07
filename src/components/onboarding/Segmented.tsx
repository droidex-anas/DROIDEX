import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Why the option can't be picked; set, it disables the option. */
  disabledReason?: string | undefined;
}

function arrowStep(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
  return 0;
}

/** Equal segments with a pill that slides to the choice. Arrow keys move between enabled segments. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((option) => option.value === value);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = arrowStep(event.key);
    if (step === 0) return;
    event.preventDefault();
    const count = options.length;
    for (let k = 1; k < count; k++) {
      const next = (((index + step * k) % count) + count) % count;
      const option = options.at(next);
      if (!option || option.disabledReason !== undefined) continue;
      onChange(option.value);
      buttons.current[next]?.focus();
      return;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="ob-segments"
      style={{ '--ob-count': options.length } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      {index >= 0 && (
        <span
          className="ob-segment-pill"
          aria-hidden="true"
          style={{ '--ob-index': index } as CSSProperties}
        />
      )}
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(element) => {
            buttons.current[i] = element;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          disabled={option.disabledReason !== undefined}
          title={option.disabledReason}
          className="ob-segment text-label"
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
