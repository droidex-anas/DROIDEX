import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

const EDGE_CLASSES = {
  left: { line: 'left-0', grip: 'left-1' },
  right: { line: 'right-0', grip: 'right-1' },
};

export function PaneResizeHandle({
  label,
  edge = 'left',
  width,
  min,
  max,
  onResize,
  onResizeEnd,
}: {
  label: string;
  /** The pane's edge the handle sits on; dragging away from the pane widens it. */
  edge?: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
}) {
  // How the width follows the pointer moving right.
  const direction = edge === 'right' ? 1 : -1;
  const drag = useRef<{ x: number; width: number; latest: number } | null>(null);
  const frame = useRef(0);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));
  const schedule = (value: number) => {
    if (drag.current) drag.current.latest = value;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (drag.current) onResize(drag.current.latest);
    });
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const latest = drag.current?.latest;
    drag.current = null;
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
    if (latest !== undefined) {
      onResize(latest);
      onResizeEnd(latest);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      className={`group absolute top-0 z-30 h-full w-3 cursor-col-resize focus:outline-none ${EDGE_CLASSES[edge].line}`}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = clamp(width + (event.key === 'ArrowRight' ? 20 : -20) * direction);
        onResize(next);
        onResizeEnd(next);
      }}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, width, latest: width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        schedule(clamp(drag.current.width + (event.clientX - drag.current.x) * direction));
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div
        className={`absolute top-0 h-full w-px bg-divider-strong/30 transition-colors group-hover:bg-accent/70 group-focus-visible:bg-accent ${EDGE_CLASSES[edge].line}`}
      />
      <div
        className={`absolute top-1/2 h-10 w-1 -translate-y-1/2 rounded-full bg-divider-strong/40 opacity-50 transition-colors group-hover:bg-accent group-hover:opacity-100 group-focus-visible:bg-accent group-focus-visible:opacity-100 ${EDGE_CLASSES[edge].grip}`}
      />
    </div>
  );
}
