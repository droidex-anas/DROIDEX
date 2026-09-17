import { useMemo, useRef, useState } from 'react';
import { ArrowLeft } from '@droidex/icons';
import type { ModelInfo, ProviderKind, TranscriptEvent } from '../../types/bridge';
import type { ChildSessionTarget } from '../../lib/childSessions';
import type { ToolActivitySettings } from '../../lib/toolActivity';
import { buildFeed } from '../chatFeed';
import { MessageFeed } from '../MessageFeed';
import { AgentAvatar } from '../AgentAvatar';
import { SubagentStreamPreview } from '../SubagentStreamPreview';
import { AgentPaneExpand } from './AgentPaneExpand';
import { AgentEffortChip } from './AgentRow';
import { AgentStatusPill } from './AgentStatusPill';
import type { AgentRow } from './agentMonitorModel';
import { useAgentTranscript } from './useAgentTranscript';

/* One agent in the agents pane: who it is, then its conversation exactly as the
   chat would show it, because it is the chat's own feed: the message the parent
   sent, then thinking, tool rows and replies, with the working indicator while
   the agent runs. Two things differ on purpose. There is no prompt bar, since
   the parent drives the agent. And finished work stays unfolded: the pane exists
   to read what the agent did, so it never hides that behind a "Worked for" line.

   The pane is the only place an agent is read; expanding gives it the content
   row. A harness that streams no child transcript yet shows what it does report
   and says so, rather than pretending the agent is silent. */

export function AgentPaneDetail({
  row,
  models,
  transcript,
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
  // Unfolded on purpose: see the note above.
  const items = useMemo(() => buildFeed(events, { childSessionCards: true }), [events]);
  const working = live && !row.queued && row.status === 'running';

  const modelName = models.find((entry) => entry.id === row.child.modelId)?.displayName;

  return (
    <div data-testid="agent-pane-detail" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-droid-border/70 px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to agents"
          className="shrink-0 rounded-md p-1 text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <AgentAvatar
          seed={row.key}
          size={20}
          working={live && !row.queued && row.status === 'running'}
        />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-droid-text">
          {row.agentName}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-droid-text-muted">
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
          {events.length > 0 ? (
            <MessageFeed
              events={events}
              items={items}
              pending={working}
              onOpenChildSession={onOpenNested}
              scrollElementRef={scrollRef}
              density={toolActivity.density}
              inlineDiffs={toolActivity.inlineDiffs}
            />
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
