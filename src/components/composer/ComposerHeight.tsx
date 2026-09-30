import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

// Publishes the composer's height as `--composer-height` on `target`, so a
// layout that places the composer over another surface (the expanded browser)
// can keep that surface clear of it. Written straight to the style, so a
// growing draft never re-renders the app.
export function ComposerHeight({
  target,
  className = '',
  children,
}: {
  target: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // The target is an ancestor, whose ref is attached after this effect runs
    // on mount; the observer's first callback comes after that.
    let host: HTMLElement | null = null;
    const observer = new ResizeObserver(() => {
      host = target.current;
      host?.style.setProperty('--composer-height', `${String(node.offsetHeight)}px`);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      host?.style.removeProperty('--composer-height');
    };
  }, [target]);

  return (
    <div ref={ref} className={`shrink-0 ${className}`}>
      {children}
    </div>
  );
}
