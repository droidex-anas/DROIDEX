import { useMemo, useRef } from 'react';
import { ArrowLeft } from '@droidex/icons';
import type { ModelInfo, ProviderKind, TranscriptEvent } from '../../types/bridge';
import type { ChildSessionTarget } from '../../lib/childSessions';
import type { ToolActivitySettings } from '../../lib/toolActivity';
import type { ChildHistoryState } from '../../hooks/storeChildSession';
import { buildFeed } from '../chatFeed';
import { MessageFeed } from '../MessageFeed';
import { AgentAvatar } from '../AgentAvatar';
import { Button } from '../ui/Button';
import { AgentPaneExpand } from './AgentPaneExpand';
import { AgentEffortChip } from './AgentRow';
import type { AgentRow } from './agentMonitorModel';
import { useAgentTranscript } from './useAgentTranscript';
import { useAgentPaneScroll } from './useAgentPaneScroll';

/* One agent in the agents pane: who it is, then its conversation exactly as the
   chat would show it, because it is the chat's own feed. Two things differ on
   purpose. There is no prompt bar, since the parent drives the agent. And
   finished work stays unfolded: the pane exists to read what the agent did, so
   it never hides that behind a "Worked for" line. */

export function AgentPaneDetail({
  row,
  models,
  transcript,
  history,
  onRetryHistory,
  onLoadEarlier,
  provider,
  live,
  toolActivity,
  onBack,
  onOpenNested,
  expanded,
  onToggleExpanded,
}: {
  row: AgentRow;
  models: readonly ModelInfo[];
  // The parent transcript: child events are interleaved into it by source.
  transcript: readonly TranscriptEvent[];
  history?: ChildHistoryState;
  onRetryHistory: () => void;
  onLoadEarlier: () => void;
  provider?: ProviderKind;
  live: boolean;
  // The chat's own tool-row settings, so the agent reads the way the chat does.
  toolActivity: ToolActivitySettings;
  onBack: () => void;
  // An agent this one spawned opens in the same pane.
  onOpenNested: (target: ChildSessionTarget) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const events = useAgentTranscript(transcript, row.child);
  const items = useMemo(() => buildFeed(events, { childSessionCards: true }), [events]);
  const { viewportLayoutRef, anchorHistory } = useAgentPaneScroll(
    scrollRef,
    row.child.childSessionId,
    items,
  );
  const working = live && !row.queued && row.status === 'running';

  const modelName = models.find((entry) => entry.id === row.child.modelId)?.displayName;

  return (
    <div data-testid="agent-pane-detail" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2.5 px-3 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          icon={ArrowLeft}
          aria-label="Back to agents"
          onClick={onBack}
        />
        <AgentAvatar seed={row.key} size={20} working={working} />
        <span className="min-w-0 flex-1 truncate text-body-lg font-medium text-primary">
          {row.agentName}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-label text-muted">
          <span className="max-w-40 truncate">{modelName ?? row.child.modelId}</span>
          {row.child.reasoningEffort ? (
            <>
              <span aria-hidden="true">·</span>
              <AgentEffortChip
                effort={row.child.reasoningEffort}
                {...(provider ? { provider } : {})}
              />
            </>
          ) : null}
        </span>
        <AgentPaneExpand expanded={expanded} onToggle={onToggleExpanded} />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {/* Expanded, the conversation takes the chat column's own measure. */}
        <div className={`min-w-0 px-4 py-3 ${expanded ? 'mx-auto max-w-4xl px-6 py-6' : ''}`}>
          {history?.olderCursor ? (
            <div className="flex justify-center pb-3">
              <Button
                variant="ghost"
                size="sm"
                loading={history.isLoadingOlder}
                onClick={() => {
                  anchorHistory();
                  onLoadEarlier();
                }}
              >
                Show earlier messages
              </Button>
            </div>
          ) : null}
          {/* Once messages show, a failed load keeps them; the next change or click retries. */}
          {events.length === 0 && history?.status === 'failed' ? (
            <div role="alert" className="mb-3 flex flex-col items-start gap-2">
              <p className="text-body text-secondary">
                Couldn&apos;t load this agent&apos;s conversation.
              </p>
              {history.error ? <p className="text-caption text-muted">{history.error}</p> : null}
              <Button size="sm" onClick={onRetryHistory}>
                Retry
              </Button>
            </div>
          ) : null}
          {events.length === 0 && history?.status === 'loading' ? (
            <p role="status" className="py-3 text-center text-body text-muted">
              Loading conversation…
            </p>
          ) : (
            <MessageFeed
              events={events}
              items={items}
              pending={working}
              onOpenChildSession={onOpenNested}
              scrollElementRef={scrollRef}
              viewportLayoutRef={viewportLayoutRef}
              density={toolActivity.density}
              inlineDiffs={toolActivity.inlineDiffs}
            />
          )}
          {events.length === 0 &&
          !working &&
          history?.status !== 'loading' &&
          history?.status !== 'failed' ? (
            <p className="py-3 text-center text-body text-muted">No messages yet.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
