import { useRef, type CSSProperties, type PointerEvent, type RefObject } from 'react';

const KEYBOARD_STEP = 0.05;

// The gutter between two columns (vertical) or two tiles of a column
// (horizontal). Dragging previews the split as a fraction of the chat area and
// commits it on release; arrow keys step it, and a double click evens it.
export function TileDivider({
  orientation,
  split,
  label,
  style,
  areaRef,
  onPreview,
  onCommit,
}: {
  orientation: 'vertical' | 'horizontal';
  split: number;
  label: string;
  style: CSSProperties;
  areaRef: RefObject<HTMLDivElement | null>;
  onPreview: (split: number) => void;
  onCommit: (split: number) => void;
}) {
  const dragging = useRef(false);
  const vertical = orientation === 'vertical';

  const splitAt = (event: PointerEvent) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return split;
    return vertical
      ? (event.clientX - rect.left) / rect.width
      : (event.clientY - rect.top) / rect.height;
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(split * 100)}
      style={style}
      className={`group absolute z-20 flex items-center justify-center focus-visible:outline-none ${
        vertical ? 'cursor-col-resize' : 'cursor-row-resize'
      }`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Cancelling the press also cancels its focus, which arrow keys need.
        event.currentTarget.focus();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
      }}
      onPointerMove={(event) => {
        if (dragging.current) onPreview(splitAt(event));
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        onCommit(splitAt(event));
      }}
      onLostPointerCapture={() => {
        // A cancelled drag keeps where it got to.
        if (!dragging.current) return;
        dragging.current = false;
        onCommit(split);
      }}
      onDoubleClick={() => {
        onCommit(0.5);
      }}
      onKeyDown={(event) => {
        const back = vertical ? 'ArrowLeft' : 'ArrowUp';
        const forward = vertical ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        onCommit(split + (event.key === forward ? KEYBOARD_STEP : -KEYBOARD_STEP));
      }}
    >
      <span
        className={`rounded-full bg-droid-border transition-colors group-hover:bg-droid-accent/30 group-focus-visible:bg-droid-accent/40 group-active:bg-droid-accent/40 ${
          vertical ? 'h-full w-px' : 'h-px w-full'
        }`}
      />
    </div>
  );
}
