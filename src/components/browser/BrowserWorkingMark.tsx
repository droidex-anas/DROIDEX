import type { CSSProperties, ReactNode } from 'react';
import { useBrowserAgentPresence } from '../../lib/browserHost';
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
 * The mark for chat browser pages while an agent's turn uses one: always when
 * that page is out of sight, and also while the pane shows it when
 * `whenShown` is set. Otherwise it is `fallback`.
 */
export function ChatBrowserWorkingMark({
  browserSessionIds,
  whenShown,
  className,
  fallback = null,
}: {
  browserSessionIds: readonly (string | undefined)[];
  whenShown: boolean;
  className?: string;
  fallback?: ReactNode;
}) {
  const presence = useBrowserAgentPresence(browserSessionIds);
  if (presence === 'none' || (presence === 'shown' && !whenShown)) return fallback;
  return <BrowserWorkingMark className={className} />;
}
