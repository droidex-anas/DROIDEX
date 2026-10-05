import { useRef } from 'react';
import { useStoreSelector } from '../../hooks/useStore';
import { ComposerHeight } from '../composer/ComposerHeight';
import PromptInput from '../PromptInput';
import { RunningProcessesMenu } from '../RunningProcessesMenu';
import { BrowserActivityLine } from './BrowserActivityLine';
import BrowserWorkspace from './BrowserWorkspace';

export function BrowserFocusWorkspace({
  expanded,
  ownComposer = false,
  onToggleExpanded,
}: {
  expanded: boolean;
  // Mission Control keeps a composer of its own here while its view is hidden;
  // a normal chat's composer is laid over the page by App instead.
  ownComposer?: boolean;
  onToggleExpanded: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const appSessionId = useStoreSelector((state) => state.activeAppSessionId);

  return (
    <div ref={rootRef} className="relative h-full min-h-0 bg-droid-bg">
      <BrowserWorkspace
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        activity={
          expanded && appSessionId ? (
            <div className="flex min-w-0 items-center gap-2">
              <RunningProcessesMenu appSessionId={appSessionId} overPage />
              <BrowserActivityLine appSessionId={appSessionId} />
            </div>
          ) : null
        }
      />
      {expanded && ownComposer && (
        <ComposerHeight target={rootRef} className="absolute inset-x-0 bottom-0 z-20">
          <PromptInput compact />
        </ComposerHeight>
      )}
    </div>
  );
}
