import type { CSSProperties, ReactNode } from 'react';
import { useBrowserHost } from '../../lib/browserHost';
import design from './browserAgentCursorDesign.json';

// The agent's cursor, cropped to its outline, as the shape the working
// shimmer shows through.
const SHAPE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="120 56 336 406"><path d="${design.path}"/></svg>`,
)}")`;
const MASKED: CSSProperties = { maskImage: SHAPE, WebkitMaskImage: SHAPE };
const LABEL = 'Agent working in the browser';

/**
 * The agent's cursor in miniature, shimmering the way the "Working…" line
 * does: an agent is using a browser page.
 */
export function BrowserWorkingMark({ className = '' }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label={LABEL}
      title={LABEL}
      className={`browser-working-mark ${className}`}
      style={MASKED}
    />
  );
}

/**
 * The mark for a tab whose chats have an agent at work in these browser
 * pages, unless the only one is in front of the reader already (the pane
 * shows it and the tab is the active one). Otherwise it is `fallback`.
 */
export function TabBrowserWorkingMark({
  browserSessionIds,
  active,
  fallback,
}: {
  browserSessionIds: readonly string[];
  active: boolean;
  fallback: ReactNode;
}) {
  const shown = useBrowserHost().slot?.browserSessionId;
  const inFront = active && browserSessionIds.every((id) => id === shown);
  if (browserSessionIds.length === 0 || inFront) return fallback;
  return <BrowserWorkingMark className="h-[13px] w-[13px]" />;
}
