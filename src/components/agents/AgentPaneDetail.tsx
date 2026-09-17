import { useMemo, useState } from 'react';
import { ArrowLeft } from '@droidex/icons';
import type { ModelInfo, ProviderKind, TranscriptEvent } from '../../types/bridge';
import { scopeTranscriptToAgent } from '../../lib/transcript';
import { buildFeed } from '../chatFeed';
import { groupTurns } from '../chatFeedTurns';
import { FeedItemView } from '../chat';
import { ModelIcon } from '../ModelIcon';
import { SubagentStreamPreview } from '../SubagentStreamPreview';
import { AgentPaneExpand } from './AgentPaneExpand';
import { AgentEffortChip } from './AgentRow';
import { AgentStatusPill } from './AgentStatusPill';
import type { AgentRow } from './agentMonitorModel';

/* One agent in the agents pane: who it is, then its own transcript rendered with
   the chat's own row components. The pane is the only place an agent is read, so
   there is no way from here into the chat; expanding gives it the content row
   instead. A harness that does not stream a child transcript yet shows what it
   does report — status, task and the latest activity — and says so rather than
   pretending the agent is silent. */

export function AgentPaneDetail({
  row,
  models,
  transcript,
  provider,
  live,
  onBack,
  expanded,
  onToggleExpanded,
}: {
  row: AgentRow;
  models: readonly ModelInfo[];
  // The parent transcript: child events are interleaved into it by source.
  transcript: readonly TranscriptEvent[];
  provider?: ProviderKind;
  live: boolean;
  onBack: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const items = useMemo(() => {
    const events = scopeTranscriptToAgent(transcript, row.child.childSessionId);
    if (events.length === 0) return [];
    return groupTurns(buildFeed(events, { childSessionCards: true }), live);
  }, [transcript, row.child.childSessionId, live]);

  const modelName = models.find((entry) => entry.id === row.child.modelId)?.displayName;

  return (
    <div data-testid="agent-pane-detail" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to agents"
          className="shrink-0 rounded-md p-1 text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <ModelIcon provider={row.provider} size={16} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-droid-text">
          {row.agentName}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-droid-text-muted">
          <span className="max-w-[120px] truncate">{modelName ?? row.child.modelId}</span>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {/* Expanded, the transcript keeps a reading measure under its header. */}
        <div className={expanded ? 'w-full max-w-[860px]' : undefined}>
          {items.length > 0 ? (
            <div className="space-y-2.5">
              {items.map((item) => (
                <FeedItemView key={item.key} item={item} live={live} sessionLive={live} />
              ))}
            </div>
          ) : (
            <AgentActivityStandIn row={row} />
          )}
        </div>
      </div>
    </div>
  );
}

// No child-scoped transcript has arrived: report the state the harness does
// give us, and name the gap instead of leaving the pane blank. The preview
// keeps its fixed height so live tokens never resize the pane under the reader.
function AgentActivityStandIn({ row }: { row: AgentRow }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const hasPreview = Boolean(row.snapshot.preview) || row.snapshot.live;
  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2">
        <AgentStatusPill status={row.queued ? 'queued' : row.status} />
        <span className="min-w-0 truncate text-[12px] text-droid-text-secondary">
          {row.snapshot.step}
        </span>
      </div>
      {row.child.prompt ? (
        <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-droid-text-secondary">
          {row.child.prompt}
        </p>
      ) : null}
      <SubagentStreamPreview
        snapshot={row.snapshot}
        expanded={previewOpen}
        cacheId={`agent-pane:${row.key}`}
      />
      {hasPreview ? (
        <button
          type="button"
          onClick={() => {
            setPreviewOpen((open) => !open);
          }}
          aria-expanded={previewOpen}
          className="text-[12px] text-droid-text-muted transition-colors hover:text-droid-text"
        >
          {previewOpen ? 'Show less' : 'Show more'}
        </button>
      ) : null}
      <p className="text-[11px] text-droid-text-muted">
        This harness reports the agent&apos;s status and latest step; its own transcript appears
        here once it streams.
      </p>
    </div>
  );
}
