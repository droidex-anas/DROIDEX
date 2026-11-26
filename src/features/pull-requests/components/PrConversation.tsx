import type { ReactNode } from 'react';

import { PrComposer } from './PrComposer';

// The scrolling half of the workspace: content scrolls while the comment
// composer stays pinned below it. Content ownership stays with the caller.
export function PrConversation({
  children,
  compact = false,
  draft,
  posting,
  onDraftChange,
  onSubmit,
}: {
  children: ReactNode;
  // Panel padding instead of the workspace's page padding.
  compact?: boolean;
  draft: string;
  posting: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={`pr-workspace-scroll scroll-fade-y-end min-h-0 flex-1 overflow-y-auto ${
          compact ? 'px-3 pt-4 pb-4' : 'px-8 pt-5 pb-6'
        }`}
      >
        {children}
      </div>
      <div className={compact ? 'px-3 pb-3' : 'px-8 pb-5'}>
        <div className="pr-reading-width">
          <PrComposer
            draft={draft}
            posting={posting}
            onDraftChange={onDraftChange}
            onSubmit={onSubmit}
          />
        </div>
      </div>
    </div>
  );
}
