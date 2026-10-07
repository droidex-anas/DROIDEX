import { useEffect, useRef, useState, type ReactNode } from 'react';

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      className={`h-3 w-3 transition-transform duration-200 ${up ? 'rotate-180' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function ExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-expanded={expanded}
      className="flex items-center gap-1 rounded-full border border-droid-border bg-droid-surface px-2.5 py-1 text-[11px] font-medium text-droid-text-secondary shadow-sm transition-colors hover:border-droid-border-hover hover:text-droid-text"
    >
      {expanded ? 'Show less' : 'Show more'}
      <Chevron up={expanded} />
    </button>
  );
}

/* Caps long content at whole rendered lines, so the cut never slices through
   one, and only when there is a meaningful amount to hide. `fade` is the
   gradient that melts the last lines into the surface behind them. */
export function ClampedBlock({
  lines,
  lineHeightPx,
  fade,
  contentClassName = 'flow-root',
  children,
}: {
  lines: number;
  lineHeightPx: number;
  fade: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const clampPx = lineHeightPx * lines;

  // The cap lives on the outer box, so the inner box always reports the real
  // content height, including when an image or code card settles later. The
  // observer hands over a height the browser has already laid out, so a
  // transcript mounting many blocks never forces a synchronous layout for
  // each one. `flow-root` keeps the last child's margin inside that height: a
  // reading even a pixel short would slice the final line once expanded.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(([entry]) => {
      setContentHeight(Math.ceil(entry.contentRect.height));
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Capped until measured, so long content is short from its first paint
  // instead of drawn at full height and then collapsed. Once measured, one line
  // of slack: content that only just overflows shows in full rather than
  // hiding a single line behind a control.
  const clamped = contentHeight !== null && contentHeight > clampPx + lineHeightPx;
  let maxHeight: number | undefined;
  if (contentHeight === null) maxHeight = clampPx;
  else if (clamped) maxHeight = expanded ? contentHeight : clampPx;

  return (
    <div className="relative w-full min-w-0">
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-out motion-reduce:transition-none"
        style={maxHeight === undefined ? undefined : { maxHeight }}
      >
        <div ref={contentRef} className={contentClassName}>
          {children}
        </div>
      </div>
      {clamped && !expanded && (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t to-transparent ${fade}`}
        >
          <div className="pointer-events-auto">
            <ExpandButton
              expanded={false}
              onClick={() => {
                setExpanded(true);
              }}
            />
          </div>
        </div>
      )}
      {clamped && expanded && (
        <div className="mt-2 flex justify-center">
          <ExpandButton
            expanded
            onClick={() => {
              setExpanded(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
