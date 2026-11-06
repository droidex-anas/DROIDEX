// One tool on the board's floating bars: an icon button whose accessible name
// is the plain label, and whose tip adds its key.

import type { ReactNode } from 'react';

export function Tool({
  label,
  tip,
  pressed,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-tip={tip}
      disabled={disabled}
      onClick={onClick}
      className="canvas-tool"
    >
      {children}
    </button>
  );
}
