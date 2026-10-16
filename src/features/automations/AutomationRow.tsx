import { CircleAlert, CirclePause, History } from 'lucide-react';
import {
  Clock,
  MessageSquareText,
  Pencil,
  Play,
  Spinner,
  Trash,
  type IconComponent,
} from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { AUTONOMY_LABELS } from '../../lib/autonomy';
import type { ModelInfo } from '../../types/bridge';
import {
  formatAutomationRunStatus,
  formatNextRun,
  formatSchedule,
  isAutomationRunActive,
  workspaceLabel,
} from './schedule';
import type { Automation, AutomationRun } from './types';

/** One row of the Automations list: its schedule, its run state, and its actions. */
export function AutomationRow({
  automation,
  run: snapshotRun,
  model,
  modelIssue,
  targetTitle,
  now,
  deleteArmed,
  onEdit,
  onToggle,
  onRun,
  onOpenSession,
  onDelete,
}: {
  automation: Automation;
  run: AutomationRun | undefined;
  model: ModelInfo | undefined;
  modelIssue: string | null;
  targetTitle?: string | undefined;
  now: number;
  deleteArmed: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
  onOpenSession: (appSessionId: string) => void;
  onDelete: () => void;
}) {
  const run = snapshotRun ?? persistedLastRun(automation);
  const active = isAutomationRunActive(run);
  const isDelivery = automation.target.kind === 'existing-session';
  const pendingDelivery = isDelivery && active;
  const canPause = automation.enabled || pendingDelivery;
  const sessionId =
    automation.target.kind === 'existing-session'
      ? automation.target.appSessionId
      : run?.appSessionId;
  const needsSetup = !isDelivery && modelIssue !== null;
  const status = needsSetup && !active ? 'Setup required' : formatAutomationRunStatus(run, now);
  const error = run?.status === 'failed' ? run.error : modelIssue;
  const statusContent = (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 ${statusClass(run, needsSetup)}`}
    >
      <RunStatusIcon run={run} needsSetup={needsSetup} />
      <span>{status}</span>
    </span>
  );

  return (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 transition-colors hover:bg-elevated/30 [@container(min-width:540px)]:flex-nowrap">
      <span
        className={`flex size-control-lg shrink-0 items-center justify-center rounded-lg ${statusTileClass(
          run,
          needsSetup,
          automation.enabled,
        )}`}
      >
        <RunStatusIcon run={run} large enabled={automation.enabled} needsSetup={needsSetup} />
      </span>

      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div title={automation.title} className="truncate text-body-strong text-primary">
          {automation.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
          <span>{formatSchedule(automation.schedule, automation.timezone)}</span>
          <span aria-hidden>·</span>
          {isDelivery ? (
            <span className="truncate">Continue {targetTitle ?? 'original conversation'}</span>
          ) : (
            <>
              <span>{workspaceLabel(automation.workspaceCwd)}</span>
              <span aria-hidden>·</span>
              <span>{model?.displayName ?? automation.modelId ?? 'Choose a model'}</span>
              <span aria-hidden>·</span>
              <span className="capitalize">
                {automation.reasoningEffort
                  ? `${automation.reasoningEffort} reasoning`
                  : 'Choose reasoning'}
              </span>
              <span aria-hidden>·</span>
              <span>{AUTONOMY_LABELS[automation.autonomy]}</span>
            </>
          )}
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-caption">
          {error ? (
            <Tooltip label={error} placement="bottom">
              {statusContent}
            </Tooltip>
          ) : (
            statusContent
          )}
          <span className="truncate text-muted/75">
            {rowHint(automation, run, active, needsSetup)}
          </span>
        </div>
      </button>

      <div className="flex w-full shrink-0 items-center gap-0.5 pl-12 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none [@media(hover:hover)]:[@container(min-width:540px)]:opacity-0 [@container(min-width:540px)]:w-auto [@container(min-width:540px)]:pl-0">
        {sessionId && (
          <RowAction
            icon={MessageSquareText}
            label={
              isDelivery
                ? 'Open target conversation'
                : active
                  ? 'Open running chat'
                  : 'Open last run chat'
            }
            onClick={() => {
              onOpenSession(sessionId);
            }}
          />
        )}
        <RowAction
          icon={Play}
          label={
            needsSetup
              ? 'Choose a model and reasoning before running'
              : active
                ? 'This automation is already active'
                : isDelivery
                  ? 'Send now and open conversation'
                  : 'Run now and open its chat'
          }
          onClick={onRun}
          disabled={active || needsSetup}
        />
        <RowAction icon={Pencil} label="Edit automation" onClick={onEdit} />
        <RowAction
          icon={canPause ? CirclePause : Play}
          label={
            pendingDelivery
              ? 'Cancel pending delivery'
              : canPause
                ? 'Pause schedule'
                : 'Resume schedule'
          }
          onClick={() => {
            onToggle(!canPause);
          }}
        />
        <RowAction
          icon={Trash}
          label={deleteArmed ? 'Click again to delete' : 'Delete automation'}
          onClick={onDelete}
          danger={deleteArmed}
          disabled={active && run?.status !== 'queued'}
        />
      </div>
    </div>
  );
}

/**
 * The snapshot only carries a bounded window of recent runs, so an automation
 * whose last run has aged out of it falls back to the fields persisted on the
 * record. Without this the row claims "Never run" and drops its failure state
 * and its run chat link.
 */
function persistedLastRun(automation: Automation): AutomationRun | undefined {
  const { lastRunAt, lastRunStatus, lastRunDurationMs } = automation;
  if (lastRunAt === null || lastRunStatus === null) return undefined;
  return {
    id: `${automation.id}:last-run`,
    automationId: automation.id,
    automation,
    scheduledAt: lastRunAt,
    requestedAt: lastRunAt,
    trigger: 'schedule',
    status: lastRunStatus,
    startedAt: lastRunAt,
    finishedAt: lastRunDurationMs === null ? automation.completedAt : lastRunAt + lastRunDurationMs,
    clientRef: null,
    appSessionId: automation.lastAppSessionId,
    resolvedCwd: null,
    error: automation.lastRunError,
    effectiveModelId: automation.modelId,
    effectiveReasoningEffort: automation.reasoningEffort,
    selectionVerified: null,
  };
}

function rowHint(
  automation: Automation,
  run: AutomationRun | undefined,
  active: boolean,
  needsSetup: boolean,
): string {
  if (active) {
    if (automation.target.kind === 'existing-session') {
      return run?.status === 'queued'
        ? 'Waiting for this conversation to be ready'
        : 'Delivering to the original conversation';
    }
    return run?.status === 'queued'
      ? 'Waiting for the current automation slot'
      : 'The run chat is receiving live model activity';
  }
  if (needsSetup) return 'Open this automation and choose an available model and reasoning level';
  return formatNextRun(automation.nextRunAt, automation.completedAt, automation.timezone);
}

function RowAction({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: IconComponent;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <Button
        variant={danger ? 'danger' : 'ghost'}
        size="sm"
        icon={icon}
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
      />
    </Tooltip>
  );
}

function SetupRequiredIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3a9 9 0 1 1-6.4 2.7" strokeDasharray="3.1 2.4" />
      <circle cx="12" cy="12" r="1.45" fill="currentColor" stroke="none" />
    </svg>
  );
}

function RunStatusIcon({
  run,
  large = false,
  enabled = true,
  needsSetup = false,
}: {
  run: AutomationRun | undefined;
  large?: boolean;
  enabled?: boolean;
  needsSetup?: boolean;
}) {
  const size = large ? 'size-icon-md' : 'size-icon-sm';
  if (needsSetup && !isAutomationRunActive(run)) {
    return <SetupRequiredIcon className={`${size} text-warning`} />;
  }
  if (!run) {
    return enabled ? (
      <Clock className={`${size} text-muted`} />
    ) : (
      <CirclePause className={`${size} text-muted/60`} />
    );
  }
  switch (run.status) {
    case 'queued':
      return <Clock className={`${size} text-muted`} />;
    case 'starting':
    case 'running':
      return <Spinner className={`${size} motion-safe:animate-spin-slow text-secondary`} />;
    case 'completed':
      return <History className={`${size} text-secondary`} />;
    case 'failed':
      return <CircleAlert className={`${size} text-danger`} />;
  }
}

function statusTileClass(
  run: AutomationRun | undefined,
  needsSetup: boolean,
  enabled: boolean,
): string {
  if (needsSetup && !isAutomationRunActive(run)) return 'bg-warning-soft';
  if (run?.status === 'failed') return 'bg-danger-soft';
  if (run?.status === 'completed') return 'bg-surface';
  if (run?.status === 'running' || run?.status === 'starting') return 'bg-elevated';
  if (!enabled) return 'bg-surface/30';
  return 'bg-surface/65';
}

function statusClass(run: AutomationRun | undefined, needsSetup = false): string {
  if (needsSetup && !isAutomationRunActive(run)) return 'text-warning';
  if (run?.status === 'failed') return 'text-danger';
  if (run?.status === 'completed') return 'text-secondary';
  if (run?.status === 'running' || run?.status === 'starting') return 'text-secondary';
  return 'text-muted';
}
