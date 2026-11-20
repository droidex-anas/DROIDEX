import { useRef, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import type { ChildAccess, ChildRuntimeState } from '../hooks/storeChildSession';
import { useFollowLatest } from '../hooks/useFollowLatest';
import { interruptVisibleSession } from '../lib/commands';
import { utilityPanelForSession } from '../lib/utilityPanel';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize2, X, Check } from 'lucide-react';
import { PanelLeft } from '@droidex/icons';

import type {
  TranscriptEvent,
  BridgeFeature,
  ChildSessionSummary,
  ProgressEntry,
} from '@droidex/protocol';
import type { FileChange } from '../lib/diff';
import { displayPath } from '../lib/pathDisplay';
import { DiffFull } from './DiffView';
import {
  childSessionActivityForTarget,
  childSessionIdForFeature,
  childSessionLabel,
  childSelectionForFeature,
  findChildSessionForTarget,
  orderedChildSessions,
  transcriptEventIsVisible,
  visibleSessionIsPending,
  visibleSessionTarget,
  type ChildSessionActivity,
} from '../lib/childSessions';
import { sessionIsLive } from '../lib/sessions';
import { MessageFeed } from './MessageFeed';
import ContextColumn from './MissionControlContextPanel';
import FeatureFocus from './MissionControlFeatureDetail';
import PromptInput from './PromptInput';
import { createIncrementalTranscriptFilter } from '../lib/incrementalTranscriptFilter';
import { Dialog, DialogTitle } from './ui/Dialog';
import { Button } from './ui/Button';

const ACCENT = 'var(--accent)';
const accentMix = (pct: number) => `color-mix(in srgb, var(--accent) ${String(pct)}%, transparent)`;
const EMPTY_TRANSCRIPT: TranscriptEvent[] = [];
const EMPTY_PROGRESS: ProgressEntry[] = [];
const EMPTY_CHILD_SESSIONS: Record<string, ChildSessionSummary> = {};
const EMPTY_CHILD_ACCESS: Record<string, ChildAccess> = {};
const EMPTY_CHILD_RUNTIME: Record<string, ChildRuntimeState> = {};

const RENDERED_TRANSCRIPT_KIND: Record<TranscriptEvent['kind'], true> = {
  text: true,
  thinking: true,
  tool_call: true,
  tool_result: true,
  error: true,
  status: true,
  compaction: true,
};
const RENDERED_TRANSCRIPT_KINDS = new Set(
  Object.keys(RENDERED_TRANSCRIPT_KIND) as TranscriptEvent['kind'][],
);

/** The event kinds the mission transcript renders as feed rows. */
export const isRenderedTranscriptEvent = (t: TranscriptEvent) =>
  t.author === 'user' || RENDERED_TRANSCRIPT_KINDS.has(t.kind) || Boolean(t.isError);

/* ════════════════════════ chat ════════════════════════ */

function ChatArea({
  events,
  live,
  pending,
  cwd,
  onOpenDiff,
  onOpenChildSession,
  childSessionActivity,
  big,
}: {
  events: TranscriptEvent[];
  live: boolean;
  pending: boolean;
  cwd?: string;
  onOpenDiff?: (c: FileChange) => void;
  onOpenChildSession?: (target: { toolUseId?: string; label?: string }) => void;
  childSessionActivity?: (target: {
    toolUseId?: string;
    label?: string;
  }) => ChildSessionActivity | undefined;
  big?: boolean;
}) {
  const toolActivity = useStoreSelector((state) => state.toolActivity);
  const { scrollRef, followLatest } = useFollowLatest();
  const renderEvents = events.length > 900 ? events.slice(-900) : events;
  const hidden = events.length - renderEvents.length;
  useLayoutEffect(followLatest, [events.length, pending, followLatest]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-8 py-7"
    >
      <div className={`mx-auto min-w-0 ${big ? 'max-w-3xl' : 'max-w-2xl'}`}>
        {hidden > 0 && (
          <div className="mb-4 text-center text-caption text-muted">
            Showing latest {renderEvents.length.toLocaleString()} of{' '}
            {events.length.toLocaleString()} events.
          </div>
        )}

        <MessageFeed
          events={renderEvents}
          pending={pending}
          cwd={cwd}
          onOpenDiff={onOpenDiff}
          onOpenChildSession={onOpenChildSession}
          density={toolActivity.density}
          inlineDiffs={toolActivity.inlineDiffs}
          childSessionActivity={childSessionActivity}
          scrollElementRef={scrollRef}
          onListResize={followLatest}
        />

        {events.length === 0 && !pending && (
          <div className="py-24 text-center text-body text-muted">
            {live ? 'Waiting for the agent…' : 'Direct the orchestrator to begin.'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════ left: features ════════════════════════ */

function FeaturesColumn({
  features,
  selectedId,
  onSelect,
  big,
  paused,
}: {
  features: BridgeFeature[];
  selectedId: string | null;
  onSelect: (f: BridgeFeature) => void;
  big?: boolean;
  paused?: boolean;
}) {
  const milestones = useMemo(() => {
    const map = new Map<string, BridgeFeature[]>();
    features.forEach((f) => {
      const m = f.milestone ?? 'Tasks';
      const milestoneFeatures = map.get(m);
      if (milestoneFeatures) milestoneFeatures.push(f);
      else map.set(m, [f]);
    });
    return Array.from(map.entries());
  }, [features]);

  const numberOf = useMemo(() => {
    const map = new Map<string, number>();
    features.forEach((f, i) => map.set(f.id, i + 1));
    return map;
  }, [features]);

  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto pb-4 space-y-4 ${big ? '-mx-6 -mb-6 px-4' : 'px-2.5 pt-2'}`}
    >
      {milestones.map(([milestone, feats]) => (
        <div key={milestone}>
          <span className="block px-2 mb-1 text-[11px] font-medium text-muted/70 uppercase tracking-wider">
            {milestone}
          </span>
          <div className="space-y-px">
            {feats.map((f) => {
              const active = selectedId === f.id;
              const completed = f.status === 'completed';
              const running = f.status === 'in_progress';
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    onSelect(f);
                  }}
                  className="group relative w-full flex items-center gap-2 text-left pl-3 pr-2 py-1.5 rounded-sm transition-colors"
                  style={active ? { background: accentMix(7) } : undefined}
                >
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full transition-opacity"
                    style={{ background: ACCENT, opacity: active ? 1 : running ? 0.45 : 0 }}
                  />
                  <span className="tabular-nums text-[11px] text-muted/70 w-4 shrink-0 text-right">
                    {numberOf.get(f.id)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate ${big ? 'text-[13px]' : 'text-[12px]'} ${
                      completed
                        ? 'text-muted'
                        : active
                          ? 'text-primary'
                          : 'text-secondary group-hover:text-primary'
                    }`}
                  >
                    {f.skillName || f.description}
                  </span>
                  {running && !paused ? (
                    <span className="shimmer-text text-[11px] font-medium uppercase tracking-wide shrink-0">
                      working
                    </span>
                  ) : completed ? (
                    <Check className="w-3 h-3 shrink-0 text-muted/60" strokeWidth={2.5} />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {features.length === 0 && (
        <div className="px-3 py-8 text-[12px] text-muted">Planning features…</div>
      )}
    </div>
  );
}

/* ════════════════════════ panel header ════════════════════════ */

function ExpansionHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
      <DialogTitle className="min-w-0">
        <span className="block truncate">{title}</span>
      </DialogTitle>
      <Button variant="ghost" size="sm" icon={X} aria-label={`Close ${title}`} onClick={onClose} />
    </div>
  );
}

function PanelHeader({
  title,
  count,
  onExpand,
  onCollapse,
}: {
  title: string;
  count?: string;
  onExpand: () => void;
  onCollapse?: () => void;
}) {
  return (
    <div
      data-electron-drag-region
      className="flex items-center justify-between px-4 h-11 shrink-0 border-b border-divider"
    >
      <span className="flex items-center gap-2">
        <span className="text-[11px] font-medium tracking-[0.09em] text-secondary uppercase">
          {title}
        </span>
        {count && <span className="tabular-nums text-[11px] text-muted">{count}</span>}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={onExpand}
          title="Expand"
          className="p-1 rounded-sm text-muted/60 hover:text-primary hover:bg-elevated transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse"
            className="p-1 rounded-sm text-muted/60 hover:text-primary hover:bg-elevated transition-colors"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════ main ════════════════════════ */

export default function MissionControl() {
  const dispatch = useStoreDispatch();
  const missionState = useStoreSelector((state) => {
    const appSessionId = state.activeAppSessionId;
    return {
      mission: appSessionId ? (state.sessions[appSessionId] ?? null) : null,
      utilityOpen: utilityPanelForSession(state.utilityPanels, appSessionId).open,
      transcript: appSessionId
        ? (state.transcripts[appSessionId] ?? EMPTY_TRANSCRIPT)
        : EMPTY_TRANSCRIPT,
      transcriptMutation: appSessionId ? state.transcriptMutations[appSessionId] : undefined,
      progress: appSessionId ? (state.progress[appSessionId] ?? EMPTY_PROGRESS) : EMPTY_PROGRESS,
      childSessions: appSessionId
        ? (state.childSessions[appSessionId] ?? EMPTY_CHILD_SESSIONS)
        : EMPTY_CHILD_SESSIONS,
      childAccess: appSessionId
        ? (state.childAccess[appSessionId] ?? EMPTY_CHILD_ACCESS)
        : EMPTY_CHILD_ACCESS,
      childRuntime: appSessionId
        ? (state.childRuntime[appSessionId] ?? EMPTY_CHILD_RUNTIME)
        : EMPTY_CHILD_RUNTIME,
      selectedChild:
        appSessionId && state.selectedChild?.parentAppSessionId === appSessionId
          ? state.selectedChild
          : null,
      rightPanelOpen: state.rightPanelOpen,
      models: state.models,
      pendingAutonomy: appSessionId ? appSessionId in state.pendingAutonomy : false,
    };
  }, shallowEqual);
  const {
    mission,
    utilityOpen,
    transcript: allTx,
    transcriptMutation,
    progress,
    childSessions: childSessionsById,
    childAccess,
    childRuntime,
    selectedChild,
    rightPanelOpen,
    models,
    pendingAutonomy,
  } = missionState;
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<'features' | 'context' | null>(null);
  const [openDiff, setOpenDiff] = useState<FileChange | null>(null);
  const closeExpanded = () => {
    setExpanded(null);
  };
  const closeDiff = () => {
    setOpenDiff(null);
  };
  const visibleEventsProjectorRef = useRef<ReturnType<
    typeof createIncrementalTranscriptFilter
  > | null>(null);
  visibleEventsProjectorRef.current ??= createIncrementalTranscriptFilter();
  const featureEventsProjectorRef = useRef<ReturnType<
    typeof createIncrementalTranscriptFilter
  > | null>(null);
  featureEventsProjectorRef.current ??= createIncrementalTranscriptFilter();

  const features = mission?.features ?? [];
  const childSessions = useMemo(
    () => (mission ? orderedChildSessions(Object.values(childSessionsById)) : []),
    [mission, childSessionsById],
  );
  const visibleTarget = visibleSessionTarget(
    mission?.appSessionId,
    selectedChild,
    mission ? { [mission.appSessionId]: childSessionsById } : {},
    mission ? { [mission.appSessionId]: childAccess } : {},
  );

  const selectChild = useCallback(
    (childSessionId: string | null) => {
      if (!mission) return;
      setFocusOpen(false);
      dispatch({
        type: 'SELECT_CHILD',
        selection: childSessionId
          ? { parentAppSessionId: mission.appSessionId, childSessionId }
          : null,
      });
    },
    [dispatch, mission],
  );

  // Click a spawn name in the orchestrator transcript to select that exact child.
  const openChildSession = useCallback(
    (target: { toolUseId?: string; label?: string }) => {
      const childSession = findChildSessionForTarget(childSessions, target);
      if (!childSession) return;
      selectChild(childSession.childSessionId);
    },
    [childSessions, selectChild],
  );

  const childSessionActivity = useCallback(
    (target: { toolUseId?: string; label?: string }) => {
      return childSessionActivityForTarget(childSessions, allTx, target);
    },
    [childSessions, allTx],
  );
  const isLive = mission ? sessionIsLive(mission) : false;
  const visibleChildSessionId =
    visibleTarget.kind === 'child' ? visibleTarget.child.childSessionId : null;
  const selectedFeature = features.find((f) => f.id === selectedFeatureId) ?? null;
  const selectedFeatureChildSessionId = selectedFeature
    ? childSessionIdForFeature(progress, selectedFeature.id)
    : undefined;
  // The incremental transcript filters compare predicate identity, so the
  // includes closures must stay referentially stable across renders.
  const visibleEventsIncludes = useCallback(
    (event: TranscriptEvent) =>
      transcriptEventIsVisible(event, visibleChildSessionId) && isRenderedTranscriptEvent(event),
    [visibleChildSessionId],
  );
  const featureEventsIncludes = useCallback(
    (event: TranscriptEvent) => event.sourceSessionId === selectedFeatureChildSessionId,
    [selectedFeatureChildSessionId],
  );
  const phaseLabel = mission
    ? mission.phase === 'completed'
      ? 'Completed'
      : mission.phase === 'failed'
        ? 'Failed'
        : mission.phase === 'paused'
          ? 'Paused'
          : mission.phase === 'awaiting_plan_approval'
            ? 'Awaiting approval'
            : mission.phase === 'awaiting_run_start'
              ? 'Awaiting start'
              : 'Idle'
    : 'Idle';

  if (!mission) return null;

  const selectedChildSession = visibleTarget.kind === 'child' ? visibleTarget.child : undefined;
  const onOrchestrator = visibleChildSessionId === null;
  const visibleIsLive = visibleTarget.kind === 'child' ? visibleTarget.canInterrupt : isLive;
  const selectedChildIndex = selectedChildSession
    ? childSessions.findIndex(
        (child) => child.childSessionId === selectedChildSession.childSessionId,
      )
    : -1;
  const visibleAgentLabel = selectedChildSession
    ? childSessionLabel(selectedChildSession, Math.max(0, selectedChildIndex))
    : 'Orchestrator';
  const events = visibleEventsProjectorRef.current({
    conversationKey: `${mission.appSessionId}:${visibleChildSessionId ?? 'primary'}:mission`,
    source: allTx,
    mutation: transcriptMutation,
    includes: visibleEventsIncludes,
  });

  const selectFeature = (f: BridgeFeature) => {
    setSelectedFeatureId(f.id);
    selectChild(childSelectionForFeature(progress, childSessions, f.id));
    setFocusOpen(true);
  };

  const selectedFeatureEvents = selectedFeatureChildSessionId
    ? featureEventsProjectorRef.current({
        conversationKey: `${mission.appSessionId}:${selectedFeatureChildSessionId}:feature`,
        source: allTx,
        mutation: transcriptMutation,
        includes: featureEventsIncludes,
      })
    : [];
  const done = features.filter((f) => f.status === 'completed').length;

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
      {/* Mission Control starts with its own drag row instead of leading its
          headers past the window controls: the rail below is a fixed-width
          column, and the collapsed rail is narrower than that lead. */}
      <div data-electron-drag-region className="h-9 shrink-0" />
      <div className="flex-1 flex min-h-0 min-w-0">
        {/* ─── Features rail ─── */}
        {railCollapsed ? (
          <div className="w-11 shrink-0 flex flex-col items-center py-3 border-r border-divider bg-surface/20">
            <button
              onClick={() => {
                setRailCollapsed(false);
              }}
              title="Expand features"
              className="p-1.5 rounded-sm text-muted hover:text-primary hover:bg-elevated transition-colors"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <span className="mt-3 text-[11px] font-medium tracking-[0.15em] text-muted uppercase [writing-mode:vertical-rl]">
              Features
            </span>
          </div>
        ) : (
          <aside className="w-[248px] shrink-0 flex flex-col border-r border-divider bg-surface/20">
            <PanelHeader
              title="Features"
              count={features.length > 0 ? `${String(done)}/${String(features.length)}` : undefined}
              onExpand={() => {
                setExpanded('features');
              }}
              onCollapse={() => {
                setRailCollapsed(true);
              }}
            />
            <FeaturesColumn
              features={features}
              selectedId={selectedFeatureId}
              onSelect={selectFeature}
              paused={mission.phase === 'paused'}
            />
          </aside>
        )}

        {/* ─── Center chat ─── */}
        <section className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <div
            data-electron-drag-region
            className="shrink-0 flex items-center justify-between gap-3 pr-6 pl-6 h-12 border-b border-divider"
          >
            <h1 className="text-[14px] font-medium text-primary truncate">{mission.title}</h1>
            <div className="flex items-center gap-2 shrink-0">
              {visibleIsLive ? (
                <>
                  <span className="shimmer-text text-[12px] font-medium leading-none">
                    {visibleAgentLabel} working
                  </span>
                  <button
                    onClick={() => {
                      interruptVisibleSession(mission.appSessionId, visibleChildSessionId);
                    }}
                    className="px-2 py-1 rounded-sm text-[11px] text-muted hover:text-primary border border-divider hover:border-divider-strong transition-colors"
                  >
                    Stop
                  </button>
                </>
              ) : (
                <span className="text-caption text-muted capitalize">{phaseLabel}</span>
              )}
            </div>
          </div>
          {focusOpen && selectedFeature ? (
            <FeatureFocus
              feature={selectedFeature}
              events={selectedFeatureEvents}
              cwd={mission.cwd}
              onBack={() => {
                setFocusOpen(false);
              }}
              onOpenDiff={setOpenDiff}
            />
          ) : (
            <ChatArea
              key={`${mission.appSessionId}:${visibleChildSessionId ?? 'primary'}`}
              events={events}
              live={visibleIsLive}
              pending={visibleSessionIsPending(visibleTarget, isLive, isLive ? 'primary' : null)}
              cwd={mission.cwd}
              onOpenDiff={setOpenDiff}
              onOpenChildSession={onOrchestrator ? openChildSession : undefined}
              childSessionActivity={onOrchestrator ? childSessionActivity : undefined}
            />
          )}
          <PromptInput appSessionId={mission.appSessionId} />
        </section>

        {/* ─── Context panel (collapsible via the top-bar context button) ─── */}
        <AnimatePresence initial={false}>
          {rightPanelOpen && !utilityOpen && (
            <motion.aside
              key="mc-context"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 272, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 overflow-hidden flex flex-col border-l border-divider bg-surface/20"
            >
              <div className="flex h-full w-[272px] flex-col">
                <PanelHeader
                  title="Context"
                  onExpand={() => {
                    setExpanded('context');
                  }}
                />
                <ContextColumn
                  mission={mission}
                  childSessions={childSessions}
                  progress={progress}
                  selectedChildSessionId={visibleChildSessionId}
                  primaryIsLive={isLive}
                  models={models}
                  pendingAutonomy={pendingAutonomy}
                  childRuntime={childRuntime}
                  onSelectChild={selectChild}
                />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Expand overlays ─── */}
      <AnimatePresence>
        {expanded === 'features' && (
          <Dialog key="features" size="expanded" onClose={closeExpanded}>
            <ExpansionHeader title="Features" onClose={closeExpanded} />
            <FeaturesColumn
              features={features}
              selectedId={selectedFeatureId}
              onSelect={(f) => {
                selectFeature(f);
                setExpanded(null);
              }}
              big
              paused={mission.phase === 'paused'}
            />
          </Dialog>
        )}
        {expanded === 'context' && (
          <Dialog key="context" size="expanded" onClose={closeExpanded}>
            <ExpansionHeader title="Context" onClose={closeExpanded} />
            <ContextColumn
              mission={mission}
              childSessions={childSessions}
              progress={progress}
              selectedChildSessionId={visibleChildSessionId}
              primaryIsLive={isLive}
              models={models}
              pendingAutonomy={pendingAutonomy}
              childRuntime={childRuntime}
              onSelectChild={(childSessionId) => {
                selectChild(childSessionId);
                setExpanded(null);
              }}
              big
            />
          </Dialog>
        )}
        {openDiff && (
          <Dialog key="diff" size="expanded" onClose={closeDiff}>
            <ExpansionHeader title={displayPath(openDiff.path, mission.cwd)} onClose={closeDiff} />
            <DiffFull change={openDiff} cwd={mission.cwd} />
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}
