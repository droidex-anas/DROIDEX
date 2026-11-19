import type { DroidProfile, ProviderKind } from './providers.js';

export type SessionPhase =
  | 'intake'
  | 'planning'
  | 'awaiting_plan_approval'
  | 'awaiting_run_start'
  | 'initializing'
  | 'running'
  | 'orchestrator_turn'
  | 'paused'
  | 'completed'
  | 'failed';

export type FeatureStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type SessionRole = 'primary' | 'worker' | 'validator';

export type SessionPurpose = 'chat' | 'design' | 'mission-control';

export type SessionInteractionMode = 'auto' | 'spec' | 'agi';

export type ResponseFormat = 'app-create' | 'app-followup';

// Product permissions, independent of interactionMode: off = Supervised,
// low = Auto-accept edits, medium = Auto, high = Full access. Provider safety
// rules still apply; Codex changes take effect on the next turn.
export type Autonomy = 'off' | 'low' | 'medium' | 'high';

export type ReasoningEffort =
  | 'off'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  // Codex's top level: maximum reasoning with automatic task delegation.
  | 'ultra'
  | 'dynamic';

// The context windows a chat can be pinned to. A chat that picks none runs the
// window its provider chooses.
export type ContextWindowTokens = 200000 | 1000000;

export interface BridgeFeature {
  id: string;
  description: string;
  status: FeatureStatus;
  skillName: string;
  preconditions: string[];
  expectedBehavior: string[];
  verificationSteps: string[];
  fulfills?: string[];
  milestone?: string;
}

export interface ProgressEntry {
  type: string;
  timestamp: string;
  title?: string;
  message?: string;
  featureId?: string;
  workerChildSessionId?: string;
}

export type ChildRole = 'worker' | 'validator';

// 'failed' is terminal like 'completed': the agent stopped, but it did not
// deliver. Never fold the two together in a count, a label, or a tint.
export type ChildStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

export type StreamFidelity = 'token' | 'tool' | 'state';

export interface ChildSpawnLink {
  kind: 'tool-use' | 'spawn';
  id: string;
}

// Live activity of an autonomous child, as observed by polling its background
// task from the parent: the task's status ("Running", "Completed") and the last
// line it had produced at that moment.
export interface ChildActivity {
  phase?: string;
  preview?: string;
}

export interface ChildSessionSummary {
  parentAppSessionId: string;
  childSessionId: string;
  role: ChildRole;
  status: ChildStatus;
  label?: string;
  prompt?: string;
  // Orchestration name and phase title, when reported by the provider.
  group?: string;
  phase?: string;
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  // Confirmed effective autonomy, runtime-scoped: present only while the child
  // is live in this runtime (opened at least once). Absent for historical or
  // never-opened children; never inherited from the parent.
  autonomy?: Autonomy;
  spawnLink?: ChildSpawnLink;
  transcriptAvailable: boolean;
  startedAt?: number;
  // When the child reached 'completed' or 'failed'. Absent while it can still
  // run, and absent for children stored before this was recorded.
  settledAt?: number;
  // Provider-declared: how live output actually arrives. Orthogonal to phase.
  streamFidelity: StreamFidelity;
  // Live-only (never persisted) and absent unless the parent actually polled the
  // child; autonomous children stream nothing to the parent themselves.
  activity?: ChildActivity;
  // What this child alone has spent, as its own provider reports it. Live-only,
  // and absent for a provider that reports no per-child usage. The parent's
  // tokensIn/tokensOut never include it.
  tokensUsed?: number;
  // Live-only: waiting for a runtime slot. Never persisted; never means running.
  queued?: boolean;
}

// Where a session was copied from. A fork is a top-level chat of its own; a
// side chat stays attached to its source and is never a sidebar row. Events
// before `forkedAt` (epoch ms) are the source conversation the copy inherited.
export interface SessionLineage {
  kind: 'fork' | 'side';
  sourceAppSessionId: string;
  forkedAt: number;
}

export type UsageWindow = 'five_hour' | 'daily' | 'weekly' | 'monthly';

// A usage limit as the harness reported it. `model` names the one model family
// the limit covers ('Opus'); `resetsAt` is epoch ms, set only while still ahead.
export interface UsageLimit {
  window?: UsageWindow;
  model?: string;
  resetsAt?: number;
}

// One limit window of a harness account, as the harness reported it. `id` is
// the harness's own name for the window, so an update that carries one window
// lands on the row a full read drew. `durationMs` is the window's length, and
// `updatedAt` (epoch ms) when this window was last read or pushed.
export interface UsageMeter {
  id: string;
  window?: UsageWindow;
  model?: string;
  usedPercent: number;
  resetsAt?: number;
  durationMs?: number;
  updatedAt: number;
}

// What an account holds beside its windows, shown and never spent: Codex limit
// resets, Claude extra usage, a Factory extra-usage balance.
export type UsageExtra =
  | { kind: 'limit_resets'; available: number }
  | { kind: 'extra_usage'; usedPercent?: number }
  | { kind: 'extra_balance'; cents: number };

// A harness account's usage. `stale` marks meters kept after a later read
// failed; `unavailable` says why an account has no meters at all.
export interface ProviderUsage {
  provider: ProviderKind;
  meters: UsageMeter[];
  extra?: UsageExtra;
  unavailable?: 'no_api_key' | 'no_plan_limits';
  stale?: boolean;
}

// A model change the transcript records. `cause` is set when the harness made
// the change by itself: 'usage_limit' when it said the limit was why.
export interface ModelSwitch {
  from: string;
  to: string;
  cause?: 'harness' | 'usage_limit';
}

export interface SessionSummary {
  droidProfile?: DroidProfile;
  appSessionId: string;
  providerSessionId?: string;
  compactedFromProviderSessionIds?: string[];
  missionId?: string;
  // Fixed when the session is copied from another; absent for an original.
  lineage?: SessionLineage;
  // Agent runtime this session is bound to, fixed at creation.
  provider: ProviderKind;
  // Provider-owned handle for resuming this conversation, when the provider
  // does not let us pin its session id (Codex threads). Absent for Droid.
  resumeId?: string;
  // Absent means the agent receives the Canvas tools each time it opens, as on
  // Droid and Claude Code. A Codex thread keeps the dynamic tools it declared on
  // `thread/start`, so a Codex session records which: 'none' is a thread started
  // without them, which no resume can add.
  canvasTools?: 'at_start' | 'none';
  sessionPurpose: SessionPurpose;
  interactionMode: SessionInteractionMode;
  role: 'primary' | 'user';
  title: string;
  goal: string;
  cwd: string;
  workspaceKind?: 'folder' | 'none';
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  // The fast mode the chat asked for, never a claim about delivered speed.
  fastMode?: boolean;
  // The window the user picked for this chat. Absent means the provider's own,
  // which is what `maxContextTokens` then reports.
  contextWindowTokens?: ContextWindowTokens;
  compactionModel?: string;
  workerModelId?: string;
  workerReasoningEffort?: ReasoningEffort;
  validatorModelId?: string;
  validatorReasoningEffort?: ReasoningEffort;
  autonomy: Autonomy;
  phase: SessionPhase;
  streaming?: boolean; // true while a turn is actively generating
  // Set when a runtime restart could not continue this session's in-flight turn.
  interruptReason?: string;
  queuedSends?: number;
  // The steers sent while a turn ran that the model has not taken in yet, in
  // the order they were sent, as the chat shows them.
  pendingSteers?: { id: string; text: string; canWithdraw: boolean }[];
  proposal?: string; // markdown plan from propose_mission
  features: BridgeFeature[];
  tokensIn: number;
  tokensOut: number;
  contextTokens: number;
  contextRemainingTokens?: number;
  contextAccuracy?: 'exact' | 'estimated';
  contextUpdatedAt?: string;
  maxContextTokens?: number;
  // Live-only: the limit this chat's last turn was refused on. The turn runner
  // is its only writer; the next turn that ends without an error clears it.
  usageLimit?: UsageLimit;
  // The auto-compaction trigger the sidecar last armed on the daemon for this
  // session (already clamped below the model window), cleared when arming
  // failed. Recorded as diagnostic/persisted truth; compaction itself is
  // announced by the daemon and rendered in the transcript.
  compactionTokenLimit?: number;
  // In-place daemon auto-compactions completed on this session; the renderer
  // uses it as a monotonic generation when invalidating stale context telemetry.
  autoCompactions?: number;
  createdAt: number;
  updatedAt: number;
}
