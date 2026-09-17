export type AutomationSchedule =
  | { kind: 'once'; runAt: number }
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; weekday: number; time: string }
  | { kind: 'cron'; expression: string };

type AutomationTarget =
  | { kind: 'new-session' }
  | { kind: 'existing-session'; appSessionId: string };

export type AutomationDeliveryReceipt =
  | { status: 'accepted'; settled: Promise<void> }
  | { status: 'busy' }
  | { status: 'unavailable'; error: string };

export type AutomationExecutionMode = 'local' | 'worktree';
export type AutomationAutonomy = 'off' | 'low' | 'medium' | 'high';
export type AutomationRunStatus = 'queued' | 'starting' | 'running' | 'completed' | 'failed';
export type AutomationTrigger = 'schedule' | 'manual';
export type AutomationReasoningEffort =
  | 'off'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'
  | 'dynamic';

export interface AutomationInput {
  target?: AutomationTarget | undefined;
  files?: string[] | undefined;
  title: string;
  prompt: string;
  workspaceCwd?: string | null | undefined;
  executionMode?: AutomationExecutionMode | undefined;
  enabled?: boolean | undefined;
  schedule: AutomationSchedule;
  timezone?: string | undefined;
  modelId?: string | null | undefined;
  reasoningEffort?: AutomationReasoningEffort | null | undefined;
  autonomy?: AutomationAutonomy | undefined;
}

/** A validated definition with every default resolved before storage. */
export interface NormalizedAutomationInput {
  target: AutomationTarget;
  files: string[];
  title: string;
  prompt: string;
  workspaceCwd: string | null;
  executionMode: AutomationExecutionMode;
  enabled: boolean;
  schedule: AutomationSchedule;
  timezone: string;
  modelId: string | null;
  reasoningEffort: AutomationReasoningEffort | null;
  autonomy: AutomationAutonomy;
}

export interface Automation extends NormalizedAutomationInput {
  id: string;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastRunStatus: AutomationRunStatus | null;
  lastRunError: string | null;
  lastRunDurationMs: number | null;
  lastAppSessionId: string | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type AutomationPatch = {
  [Key in keyof AutomationInput]?: AutomationInput[Key] | undefined;
};

export interface AutomationRunSnapshot extends Omit<
  NormalizedAutomationInput,
  'enabled' | 'schedule'
> {
  id: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  automation: AutomationRunSnapshot;
  scheduledAt: number;
  requestedAt: number;
  trigger: AutomationTrigger;
  status: AutomationRunStatus;
  startedAt: number | null;
  finishedAt: number | null;
  clientRef: string | null;
  appSessionId: string | null;
  resolvedCwd: string | null;
  error: string | null;
  effectiveModelId: string | null;
  effectiveReasoningEffort: AutomationReasoningEffort | null;
  selectionVerified: boolean | null;
}

export type AutomationProposalStatus = 'draft' | 'confirmed';
export type AutomationProposalMissingField = 'modelId' | 'reasoningEffort';

export interface AutomationProposal {
  id: string;
  sourceAppSessionId: string;
  draft: NormalizedAutomationInput;
  status: AutomationProposalStatus;
  missingFields: AutomationProposalMissingField[];
  automationId: string | null;
  createdAt: number;
  updatedAt: number;
  confirmedAt: number | null;
}

export interface AutomationSessionOrigin {
  automationId: string;
  automationTitle: string;
  runId: string;
  trigger: AutomationTrigger;
}

export interface AutomationSchedulerStatus {
  ready: boolean;
  nextWakeAt: number | null;
  activeRunId: string | null;
}

export interface AutomationStore {
  version: 1;
  automations: Automation[];
  runs: AutomationRun[];
  proposals: AutomationProposal[];
  /** Which run started a chat, for the chats an automation started. */
  sessionOrigins: Partial<Record<string, AutomationSessionOrigin>>;
}

export interface AutomationSnapshot {
  automations: Automation[];
  runs: AutomationRun[];
  proposals: AutomationProposal[];
  sessionOrigins: Partial<Record<string, AutomationSessionOrigin>>;
  queuedRunCount: number;
  activeRunCount: number;
  scheduler: AutomationSchedulerStatus;
}

export type AutomationBridgeEvent =
  | { type: 'automations.snapshot'; snapshot: AutomationSnapshot }
  | { type: 'automations.result'; requestId: string; ok: true; runId?: string }
  | { type: 'automations.result'; requestId: string; ok: false; error: string };

export type AutomationBridgeCommand =
  | { type: 'automations.list'; requestId: string }
  | { type: 'automations.create'; requestId: string; input: AutomationInput }
  | { type: 'automations.update'; requestId: string; id: string; patch: AutomationPatch }
  | { type: 'automations.delete'; requestId: string; id: string }
  | { type: 'automations.setEnabled'; requestId: string; id: string; enabled: boolean }
  | { type: 'automations.runNow'; requestId: string; id: string }
  | {
      type: 'automations.confirmProposal';
      requestId: string;
      id: string;
      input?: AutomationInput | undefined;
    };
