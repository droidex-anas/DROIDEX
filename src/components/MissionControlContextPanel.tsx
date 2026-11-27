import { useState } from 'react';
import {
  Boxes,
  ChevronDown,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  Monitor,
} from 'lucide-react';
import type {
  ChildSessionSummary,
  ModelInfo,
  ProgressEntry,
  SessionSummary,
} from '@droidex/protocol';
import type { ChildRuntimeState } from '../hooks/storeChildSession';
import { useStoreDispatch } from '../hooks/useStore';
import { useRepoStatus } from '../hooks/useRepoStatus';
import { newClientRef, updateSessionSettings } from '../lib/commands';
import { childSessionIsLive, childSessionLabel, childSessionMeta } from '../lib/childSessions';
import { environmentLabels } from '../lib/repoEnvironment';
import AutonomySelector from './AutonomySelector';
import EditorOpenMenu, { openCodebase, openCurrentDiff } from './EditorOpenMenu';
import { ModelIcon, providerOf } from './ModelIcon';

const accentMix = (pct: number) => `color-mix(in srgb, var(--accent) ${String(pct)}%, transparent)`;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] font-medium text-muted">{children}</span>;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function EnvRow({
  icon,
  label,
  chevron,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  chevron?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-secondary hover:text-primary hover:bg-elevated/60 transition-colors"
    >
      <span className="text-muted shrink-0">{icon}</span>
      <span className="text-[13px] leading-none">{label}</span>
      {chevron && <ChevronDown className="w-3.5 h-3.5 ml-1 text-muted/60" />}
    </button>
  );
}

export default function ContextColumn({
  mission,
  childSessions,
  progress,
  selectedChildSessionId,
  primaryIsLive,
  models,
  pendingAutonomy,
  childRuntime,
  onSelectChild,
  big,
}: {
  mission: SessionSummary;
  childSessions: ChildSessionSummary[];
  progress: ProgressEntry[];
  selectedChildSessionId: string | null;
  primaryIsLive: boolean;
  models: ModelInfo[];
  pendingAutonomy: boolean;
  childRuntime: Record<string, ChildRuntimeState>;
  onSelectChild: (childSessionId: string | null) => void;
  big?: boolean;
}) {
  const skills = Array.from(new Set(mission.features.map((f) => f.skillName).filter(Boolean)));
  const repoStatus = useRepoStatus(mission.cwd);
  const env = environmentLabels(mission.cwd, repoStatus);

  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto space-y-5 ${big ? '-mx-6 -mb-6 px-4 pb-4' : 'px-3 py-3'}`}
    >
      {/* Environment */}
      <section>
        <div className="flex items-center justify-between px-2 mb-1">
          <SectionLabel>Environment</SectionLabel>
          <EditorOpenMenu cwd={mission.cwd} hasRepo={!!repoStatus} />
        </div>
        <EnvRow
          icon={<FileDiff className="w-4 h-4" />}
          label={env.changes}
          title={
            repoStatus
              ? 'Open a diff of uncommitted changes in your editor'
              : 'No git repository here'
          }
          onClick={() => {
            openCurrentDiff(mission.cwd);
          }}
        />
        <EnvRow
          icon={<Monitor className="w-4 h-4" />}
          label={env.location}
          title={repoStatus?.repoRoot ?? mission.cwd}
          chevron
          onClick={() => {
            openCodebase(mission.cwd);
          }}
        />
        <EnvRow
          icon={<GitBranch className="w-4 h-4" />}
          label={env.branch}
          title={repoStatus?.repoRoot ? `${env.branch} · ${repoStatus.repoRoot}` : env.branch}
          chevron
        />
        <EnvRow icon={<GitCommitHorizontal className="w-4 h-4" />} label="Commit or push" />
      </section>

      {/* Agents (model + live status merged) */}
      <AgentsSection
        mission={mission}
        childSessions={childSessions}
        selectedChildSessionId={selectedChildSessionId}
        primaryIsLive={primaryIsLive}
        models={models}
        pendingAutonomy={pendingAutonomy}
        childRuntime={childRuntime}
        onSelectChild={onSelectChild}
      />

      {/* Progress log */}
      <ProgressSection
        progress={progress}
        onSelectChild={(childSessionId) => {
          if (childSessions.some((child) => child.childSessionId === childSessionId)) {
            onSelectChild(childSessionId);
          }
        }}
        big={big}
      />

      {/* Sources */}
      <section>
        <div className="px-2 mb-2">
          <SectionLabel>Sources</SectionLabel>
        </div>
        <div className="flex items-center gap-1 px-1">
          <button
            title={`${String(skills.length)} skills`}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-muted hover:text-primary hover:bg-elevated/60 transition-colors"
          >
            <Boxes className="w-4 h-4" />
            {skills.length > 0 && <span className="text-[11px] tabular-nums">{skills.length}</span>}
          </button>
          <button
            title="Web"
            className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-elevated/60 transition-colors"
          >
            <Globe className="w-4 h-4" />
          </button>
        </div>
        {big && skills.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1 mt-2">
            {skills.map((s) => (
              <span key={s} className="px-1.5 py-0.5 rounded-xs text-[11px] text-muted bg-elevated">
                {s}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function modelLabel(models: ModelInfo[], id?: string): string {
  if (!id) return 'Factory default';
  return models.find((m) => m.id === id)?.displayName ?? id;
}

function AgentsSection({
  mission,
  childSessions,
  selectedChildSessionId,
  primaryIsLive,
  models,
  pendingAutonomy,
  childRuntime,
  onSelectChild,
}: {
  mission: SessionSummary;
  childSessions: ChildSessionSummary[];
  selectedChildSessionId: string | null;
  primaryIsLive: boolean;
  models: ModelInfo[];
  pendingAutonomy: boolean;
  childRuntime: Record<string, ChildRuntimeState>;
  onSelectChild: (childSessionId: string | null) => void;
}) {
  const dispatch = useStoreDispatch();

  return (
    <section>
      <div className="flex items-center justify-between px-2 mb-1.5">
        <SectionLabel>Agents</SectionLabel>
        {/* Confirmed autonomy only — the pill never moves ahead of the provider. */}
        <AutonomySelector
          scope="session"
          provider={mission.provider}
          value={mission.autonomy}
          pending={pendingAutonomy}
          placement="bottom-end"
          onSelect={(level) => {
            const requestId = newClientRef();
            dispatch({
              type: 'AUTONOMY_UPDATE_REQUESTED',
              appSessionId: mission.appSessionId,
              requestId,
              autonomy: level,
            });
            updateSessionSettings({
              appSessionId: mission.appSessionId,
              requestId,
              autonomy: level,
            });
          }}
        />
      </div>

      <div className="space-y-0.5">
        <AgentRow
          title="Orchestrator"
          id={mission.modelId}
          meta={[modelLabel(models, mission.modelId), mission.reasoningEffort, mission.phase]
            .filter(Boolean)
            .join(' · ')}
          models={models}
          selected={selectedChildSessionId === null}
          working={primaryIsLive}
          onClick={() => {
            onSelectChild(null);
          }}
        />
        {childSessions.map((childSession, index) => {
          const displayedModel = modelLabel(models, childSession.modelId);
          return (
            <AgentRow
              key={childSession.childSessionId}
              title={childSessionLabel(childSession, index)}
              id={childSession.modelId}
              meta={childSessionMeta(childSession, displayedModel)}
              models={models}
              selected={selectedChildSessionId === childSession.childSessionId}
              working={childSessionIsLive(childSession, childRuntime[childSession.childSessionId])}
              onClick={() => {
                onSelectChild(childSession.childSessionId);
              }}
            />
          );
        })}
      </div>
    </section>
  );
}

function AgentRow({
  title,
  id,
  meta,
  models,
  selected,
  working,
  onClick,
}: {
  title: string;
  id?: string;
  meta: string;
  models: ModelInfo[];
  selected: boolean;
  working: boolean;
  onClick: () => void;
}) {
  const provider = providerOf(
    models.find((m) => m.id === id),
    id,
  );
  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors text-left hover:bg-elevated/50"
      style={selected ? { background: accentMix(7) } : undefined}
    >
      <span className="relative shrink-0">
        <ModelIcon provider={provider} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`text-[13px] leading-none truncate ${selected ? 'text-primary' : 'text-secondary'}`}
          >
            {title}
          </span>
          {working && (
            <span className="shimmer-text text-[11px] leading-none font-medium">working</span>
          )}
        </span>
        <span className="mt-1 block text-[11px] text-muted truncate">{meta}</span>
      </span>
    </button>
  );
}

function ProgressSection({
  progress,
  onSelectChild,
  big,
}: {
  progress: ProgressEntry[];
  onSelectChild: (childSessionId: string) => void;
  big?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const COLLAPSED = 4;
  const ordered = [...progress].reverse();
  const shown = big || showAll ? ordered : ordered.slice(0, COLLAPSED);
  const hidden = ordered.length - shown.length;

  return (
    <section>
      <div className="flex items-center justify-between px-2 mb-1.5">
        <SectionLabel>Progress</SectionLabel>
        {progress.length > 0 && (
          <span className="tabular-nums text-[11px] text-muted">{progress.length}</span>
        )}
      </div>
      <div className="space-y-0.5">
        {shown.map((entry, index) => (
          <button
            type="button"
            key={`${entry.timestamp}-${entry.type}-${String(index)}`}
            disabled={!entry.workerChildSessionId}
            title={entry.workerChildSessionId ? 'Open exact child transcript' : undefined}
            onClick={() => {
              if (entry.workerChildSessionId) onSelectChild(entry.workerChildSessionId);
            }}
            className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-left transition-colors ${
              entry.workerChildSessionId ? 'hover:bg-elevated/35' : 'cursor-default'
            }`}
          >
            <span className="tabular-nums text-[11px] text-muted/70 shrink-0">
              {formatTime(entry.timestamp)}
            </span>
            <span className="min-w-0 truncate text-[12px] text-secondary">
              {entry.title ?? entry.message ?? entry.type.replace(/_/g, ' ')}
            </span>
          </button>
        ))}
        {shown.length === 0 && (
          <div className="px-2 py-4 text-[12px] text-muted">No progress log yet.</div>
        )}
        {!big && hidden > 0 && (
          <button
            onClick={() => {
              setShowAll(true);
            }}
            className="w-full text-left px-2 py-1 text-[12px] text-muted hover:text-primary transition-colors"
          >
            Show {hidden} more
          </button>
        )}
        {!big && showAll && ordered.length > COLLAPSED && (
          <button
            onClick={() => {
              setShowAll(false);
            }}
            className="w-full text-left px-2 py-1 text-[12px] text-muted hover:text-primary transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </section>
  );
}
