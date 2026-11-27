import type { ReactNode } from 'react';

import { PrComposer } from './PrComposer';

// The scrolling summary shell: content scrolls while the comment composer stays
// pinned directly under the reading column (never sprawling beneath the rail in
// a wide workspace). Content ownership stays with the caller.
export function PrConversation({
  children,
  rail,
  compact = false,
  draft,
  posting,
  onDraftChange,
  onSubmit,
}: {
  children: ReactNode;
  // Side metadata rail in a wide workspace; omitted when the caller stacks
  // everything into one scroll column (e.g. the compact side pane).
  rail?: ReactNode;
  // Panel padding instead of the workspace's page padding.
  compact?: boolean;
  draft: string;
  posting: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const composer = (
    <PrComposer draft={draft} posting={posting} onDraftChange={onDraftChange} onSubmit={onSubmit} />
  );

  if (rail) {
    return (
      <div className="pr-summary-container">
        <div className="pr-summary-shell">
          <div className="pr-summary-column">
            <div className="pr-summary-scroll pr-workspace-scroll scroll-fade-y-end px-6 pt-5 pb-6">
              <div className="pr-reading-width">{children}</div>
            </div>
            <div className="pr-summary-composer px-6 pt-2 pb-5">
              <div className="pr-reading-width">{composer}</div>
            </div>
          </div>
          <div className="pr-summary-rail pr-workspace-scroll">{rail}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={`pr-workspace-scroll scroll-fade-y-end min-h-0 flex-1 overflow-y-auto ${
          compact ? 'px-3 pt-4 pb-4' : 'px-8 pt-5 pb-6'
        }`}
      >
        <div className="pr-reading-width">{children}</div>
      </div>
      <div className={compact ? 'shrink-0 px-3 pt-2 pb-3' : 'shrink-0 px-8 pt-2 pb-5'}>
        <div className="pr-reading-width">{composer}</div>
      </div>
    </div>
  );
}
