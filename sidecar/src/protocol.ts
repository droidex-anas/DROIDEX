import type { ProjectCommand, ProjectEvent } from './projects/types.js';
// Bridge protocol shared between the Node sidecar and the React frontend.
// The frontend keeps a mirror copy at src/types/bridge.ts — keep them in sync.

import type { AutomationBridgeCommand, AutomationBridgeEvent } from './automations/types.js';
import type { McpClientCommand, McpServerEvent } from './mcpProtocol.js';
import type { ProviderMention, SkillInfo } from './providers/catalog.js';
import type { ProviderKind } from './providers/providerKind.js';
import type { SidebarRequest, SidebarResult } from './sidebar/protocol.js';
export type { ProviderMention, SkillInfo } from './providers/catalog.js';
export type {
  McpServerInfo,
  McpServerInput,
  McpStatusSummary,
  McpToolInfo,
} from './mcpProtocol.js';

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

export interface AgentProcess {
  pid: number;
  name: string;
  command: string;
  originCommand?: string;
  startedAt: number;
  ports: number[];
}

export interface TranscriptEvent {
  id: string;
  appSessionId: string;
  sourceSessionId: string;
  role: SessionRole;
  ts: number;
  // Monotonic canonical order for primary-session scrollback, stamped during
  // replay from the compaction-chain position. Survives equal `ts` collisions
  // so restored history never reorders. Live events omit it (they are newest).
  seq?: number;
  endTs?: number;
  // Provider-native position a fork can branch from: the Droid message id, the
  // Codex turn id, or the Claude prompt uuid of the turn that produced the event.
  forkPointId?: string;
  kind: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'error' | 'status' | 'compaction';
  text?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolUseId?: string;
  isError?: boolean;
  // A 'tool_call' the provider knows is about a child session it is already
  // tracking: polling that agent for output, or stopping it. The same tool
  // names also read and stop background shell commands, so only the provider
  // can tell the two apart, and the feed must not guess from the name.
  pollsChildSessionId?: string;
  // A 'tool_result' for a call that never ran because the user stopped the
  // turn, with Stop or Send now. Reported by the harness, not inferred from the
  // text: it is not a failure and must not read as one.
  interrupted?: true;
  // The pictures a 'tool_result' carried (a screenshot, an image file the agent
  // read), as files saved in the profile. Their bytes are never in `text`.
  images?: string[];
  // For a 'compaction' divider: how many messages the compaction summarized away.
  removedCount?: number;
  author?: 'user';
  // Frontend display metadata for user-authored prompt chips.
  skills?: string[];
  files?: string[];
  browserRefs?: BrowserTranscriptReference[];
  // Side-chat answers the user attached to this prompt.
  sideChatReplies?: string[];
  steered?: boolean;
  // Links the delivered user row to its pending steer, including ordinary-turn fallback.
  steerId?: string;
  // Set on a row whose text was said out loud in a voice conversation.
  spoken?: boolean;
  compactType?: 'auto' | 'manual';
  modelSwitch?: ModelSwitch;
  errorKind?: 'usage_limit';
  resetsAt?: number;
  // A 'status' row that only says what the app is doing right now (booting a
  // CLI, stopping a turn to send now). It is shown live and never stored, so
  // reopening the session does not replay stale progress.
  transient?: true;
}

type BrowserTranscriptReferenceKind = 'element' | 'region' | 'text';

export interface BrowserTranscriptReference {
  id: string;
  label: string;
  kind: BrowserTranscriptReferenceKind;
  url?: string;
  selector?: string;
  imageDataUrl?: string;
}

export type PermissionKind =
  | 'edit'
  | 'exec'
  | 'create'
  | 'apply_patch'
  | 'mcp'
  | 'spec'
  | 'mission_plan'
  | 'other';
export type ConfigurableSessionRole = 'primary' | 'worker' | 'validator';

export interface PermissionRequest {
  appSessionId: string;
  requestId: string;
  kind: PermissionKind;
  title: string;
  detail: string; // Concrete command, file path, or tool input.
  canAlwaysAllow: boolean;
  diff?: string;
  plan?: string; // full plan/spec body (exit_spec_mode)
  options?: string[]; // custom option names offered by the tool
  raw: unknown;
}

export interface SessionQuestion {
  appSessionId: string;
  requestId: string;
  questions: {
    index: number;
    question: string;
    header?: string;
    options: { label: string; description?: string }[];
    multiSelect?: boolean;
  }[];
}

export interface QuestionAnswer {
  index: number;
  question: string;
  selected: string[];
  custom?: string;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  provider?: string;
  isCustom: boolean;
  isDefault?: boolean;
  maxContextTokens?: number;
  supportedReasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  // Whether the harness can run this model faster for more usage. Absent while
  // the catalog has not said; only an explicit false disables the toggle.
  supportsFastMode?: boolean;
}

// What a provider can do for the user right now. Derived from what the sidecar
// already knows about each runtime; see providers/providerStatus.ts.
type ProviderReadiness = 'ready' | 'missing' | 'unauthenticated' | 'unsupported' | 'error';

export interface ProviderStatus {
  provider: ProviderKind;
  readiness: ProviderReadiness;
  version?: string;
  accountLabel?: string;
  message?: string;
  // The model a new chat on this provider starts on when it pins none: what the
  // harness itself is configured with, so the app can name it instead of
  // calling it "Default". Absent when the harness reports none.
  defaultModelId?: string;
  // The window that default runs on when the chat picks none, for the harnesses
  // whose own default names an extended-context variant. Absent means the app
  // knows only that the provider chooses.
  defaultContextWindowTokens?: ContextWindowTokens;
  models: ModelInfo[];
  items?: SkillInfo[];
}

// The harnesses whose CLI DROIDEX runs but does not ship: Claude Code and Codex.
export type HarnessCliProvider = Exclude<ProviderKind, 'droid'>;
// Where a harness CLI was installed from, read off its resolved binary. It
// decides which updater owns the binary.
export type HarnessInstallSource = 'homebrew' | 'npm' | 'native';

export type HarnessCliState =
  | { provider: HarnessCliProvider; installed: false }
  | {
      provider: HarnessCliProvider;
      installed: true;
      path: string;
      source: HarnessInstallSource;
      version?: string;
      updating: boolean;
      // Why the last update from the app failed; cleared by a successful one.
      updateError?: string;
    };
// OAuth subscription providers the DroidProxy settings page can report on.
// Mirrors DroidProxy's provider set, not DROIDEX's harness set.
export type DroidProxyProviderKey =
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'kimi'
  | 'junie'
  | 'grok'
  | 'copilot'
  | 'meta';
// One connected OAuth account. Metadata only: emails, expiry, and flags.
// Tokens and keys never cross the bridge.
// One-click install pipeline stages, in order.
export type DroidProxyInstallPhase =
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'launching'
  | 'applying';
export interface DroidProxyAccount {
  provider: DroidProxyProviderKey;
  // Auth-file name for accounts whose enabled state can be edited here.
  id?: string;
  email?: string;
  login?: string;
  // ISO timestamp when the stored credential expires, if the auth file says.
  expired?: string;
  disabled: boolean;
}
export interface DroidProxyProviderState {
  provider: DroidProxyProviderKey;
  // DroidProxy's own per-provider toggle, read from its preferences.
  enabled: boolean;
  // Whether DROIDEX can run this provider's browser login itself.
  canLoginHere: boolean;
  accounts: DroidProxyAccount[];
}
export interface DroidProxyStatus {
  appInstalled: boolean;
  // localhost:8317, the endpoint Factory models point at.
  proxyRunning: boolean;
  // 127.0.0.1:8318, DroidProxy's OAuth backend.
  backendRunning: boolean;
  loginBinaryAvailable: boolean;
  // Provider with an assisted login in flight, so a remounted settings page
  // can restore its waiting state instead of offering a dead Connect.
  loginInProgress?: DroidProxyProviderKey;
  // Install pipeline stage in flight, so a remounted page restores progress
  // instead of offering Install over a running download.
  installInProgress?: DroidProxyInstallPhase;
  // Why one-click install is off the table on this machine, if it is: the
  // releases ship Apple Silicon macOS builds only.
  installUnavailable?: 'unsupported-platform' | 'unsupported-arch';
  // DroidProxy's Meta contributor-mode flag: picks the Muse Spark variant.
  metaContributorMode: boolean;
  // Enabled catalog size: how many entries Apply writes.
  factoryModelCount: number;
  // Whether the proxy catalog is merged into Factory custom models.
  factoryModelsInstalled: boolean;
  providers: DroidProxyProviderState[];
}

export interface FactoryDefaultSettings {
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  compactionModel?: string;
  compactionTokenLimit?: number;
  compactionTokenLimitPerModel?: Record<string, number>;
  autonomy?: Autonomy;
  interactionMode?: SessionInteractionMode;
  specModelId?: string;
  specReasoningEffort?: ReasoningEffort;
  missionOrchestratorModelId?: string;
  missionOrchestratorReasoningEffort?: ReasoningEffort;
  workerModelId?: string;
  workerReasoningEffort?: ReasoningEffort;
  validatorModelId?: string;
  validatorReasoningEffort?: ReasoningEffort;
}

export type InstallChannel = 'script' | 'brew' | 'npm';

export interface PackageManagers {
  brew: boolean;
  npm: boolean;
  curl: boolean;
  pnpm: boolean;
}

interface CliInfo {
  present: boolean;
  path: string;
  version?: string;
}

export interface EnvironmentReport {
  platform: NodeJS.Platform;
  arch: string;
  osVersion: string;
  node: { present: boolean; version?: string };
  cli: CliInfo;
  packageManagers: PackageManagers;
  auth: { apiKeyConfigured: boolean; loginPresent: boolean };
  availableChannels: InstallChannel[];
}

export interface ContextStatsSnapshot {
  used: number;
  remaining: number;
  limit: number;
  accuracy: 'exact' | 'estimated';
  updatedAt: string;
  breakdown?: ContextBreakdownSnapshot;
  // In-place compactions completed on this agent session; set for worker
  // snapshots (top-level sessions carry their generation on the summary instead).
  compactions?: number;
}

interface ContextBreakdownCategory {
  name: string;
  tokens: number;
  colorKey?: string;
}

export interface ContextBreakdownSnapshot {
  modelId?: string;
  modelDisplayName?: string;
  contextBudget: number;
  usedTokens: number;
  freeTokens: number;
  categories: ContextBreakdownCategory[];
}

export interface SessionHistoryEntry {
  providerSessionId: string;
  title: string;
  cwd?: string;
  modifiedTime: number;
  createdTime: number;
  messageCount: number;
}

// One transcript line that matched a sessions.search query, shaped for the
// sidebar's result row: a snippet centered on the match plus enough context
// (author, timestamp) to recognize the conversation moment.
interface SessionSearchMatch {
  snippet: string;
  author: 'user' | 'assistant';
  ts: number;
}

// A session whose transcript matched the query. Title matching itself happens
// renderer-side over the session list; the sidecar only reports content hits.
export interface SessionSearchResult {
  appSessionId: string;
  matches: SessionSearchMatch[];
}

export interface HistorySearchReply {
  results: SessionSearchResult[];
  indexingIncomplete: boolean;
}

export interface BrowserViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export type BrowserViewportMode = 'fit' | 'desktop' | 'laptop' | 'tablet' | 'mobile';

/** The scheme a page is asked for; auto follows the system's setting. */
export type BrowserColorScheme = 'light' | 'dark' | 'auto';
type BrowserScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface BrowserBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BrowserState {
  browserSessionId: string;
  appSessionId?: string;
  url: string;
  title?: string;
  viewport: BrowserViewport;
  viewportMode: BrowserViewportMode;
  scroll: { x: number; y: number };
  canGoBack?: boolean;
  canGoForward?: boolean;
  error?: string;
}

interface BrowserNativeSnapshot {
  url: string;
  title?: string;
  scroll: { x: number; y: number };
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export interface BrowserElementInspection {
  selector: string;
  tagName: string;
  role?: string;
  name?: string;
  text?: string;
  attributes: Record<string, string>;
  /** Computed styles that say how it looks: colours, font, display, spacing. */
  styles: Record<string, string>;
  box: BrowserBox;
  html: string;
  iframe?: {
    src?: string;
    accessible: boolean;
  };
}

export interface BrowserNetworkEvent {
  timestamp: number;
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  error?: string;
  durationMs?: number;
  /** The size the server stated, when it stated one. */
  bytes?: number;
  cached?: boolean;
}

export interface BrowserConsoleEvent {
  timestamp: number;
  level: number;
  message: string;
  line?: number;
  source?: string;
}

type BrowserNativeAction =
  | 'open'
  | 'reload'
  | 'goBack'
  | 'goForward'
  | 'snapshot'
  | 'readPage'
  | 'readText'
  | 'find'
  | 'click'
  | 'hover'
  | 'fill'
  | 'type'
  | 'press'
  | 'scroll'
  | 'resize'
  | 'colorScheme'
  | 'inspect'
  | 'network'
  | 'console'
  | 'screenshot'
  | 'close'
  | 'fillCredentials'
  | 'wait'
  | 'awaitViewport'
  | 'evaluate';

export interface BrowserNativeRequest {
  requestId: string;
  appSessionId: string;
  browserSessionId: string;
  action: BrowserNativeAction;
  url?: string;
  viewport?: BrowserViewport;
  viewportMode?: BrowserViewportMode;
  colorScheme?: BrowserColorScheme;
  /** browser_evaluate: the JavaScript to run in the page. */
  script?: string;
  ref?: string;
  filter?: 'interactive' | 'all';
  maxChars?: number;
  query?: string;
  x?: number;
  y?: number;
  selector?: string;
  text?: string;
  /** browser_wait: text that must be gone, an address fragment, how long. */
  textGone?: string;
  urlIncludes?: string;
  waitMs?: number;
  value?: string;
  submit?: boolean;
  key?: string;
  repeat?: number;
  button?: 'left' | 'right' | 'middle';
  count?: number;
  modifiers?: string[];
  direction?: BrowserScrollDirection;
  pixels?: number;
  region?: BrowserBox;
  fullPage?: boolean;
  format?: 'jpeg' | 'png';
}

export interface BrowserNativeResult {
  requestId: string;
  appSessionId: string;
  browserSessionId: string;
  ok: boolean;
  snapshot?: BrowserNativeSnapshot;
  inspection?: BrowserElementInspection;
  networkEvents?: BrowserNetworkEvent[];
  consoleEvents?: BrowserConsoleEvent[];
  image?: string;
  mimeType?: 'image/jpeg' | 'image/png';
  /** What the reading tools show the agent; for a screenshot, its geometry. */
  text?: string;
  /** How many lines browser_find matched. */
  matches?: number;
  error?: string;
}

interface ElementSource {
  framework?: 'react' | 'vue' | 'svelte' | 'unknown';
  component?: string;
  componentChain?: string[];
  file?: string;
  line?: number;
  column?: number;
  confidence: 'exact' | 'attribute' | 'heuristic' | 'none';
}

interface DesignAnchorAncestor {
  tag: string;
  component?: string;
  selector?: string;
}

interface DesignStrokePoint {
  x: number;
  y: number;
}

export interface DesignSelectionScreenshot {
  base64: string;
  box: BrowserBox;
}

export interface DesignAnchor {
  id: string;
  kind: 'element' | 'region' | 'text';
  label: string;
  tag?: string;
  role?: string;
  name?: string;
  text?: string;
  box: BrowserBox;
  source?: ElementSource;
  screenshotPath?: string;
  strokes?: DesignStrokePoint[][];
  /** The mark's number in the composer, which the user writes as @1, @2. */
  mark?: number;
}

export interface DesignAnchorDetail {
  id: string;
  selector: string;
  selectorVerified: boolean;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  ancestors: DesignAnchorAncestor[];
  html?: string;
}

interface DesignReference {
  id: string;
  anchor: DesignAnchor;
  detail?: DesignAnchorDetail;
  url: string;
  title?: string;
  viewport?: BrowserViewport;
  scroll?: { x: number; y: number };
  screenshot?: DesignSelectionScreenshot;
  createdAt?: string;
}

export type PermissionOutcome =
  | 'proceed_once'
  | 'proceed_always'
  | 'proceed_auto_run'
  | 'proceed_auto_run_low'
  | 'proceed_auto_run_medium'
  | 'proceed_auto_run_high'
  | 'proceed_new_session'
  | 'proceed_new_session_low'
  | 'proceed_new_session_medium'
  | 'proceed_new_session_high'
  | 'proceed_edit'
  | 'refuse'
  | 'cancel';

// ── Frontend -> Sidecar ──────────────────────────────────────────────
export type ClientCommand =
  | ProjectCommand
  | AutomationBridgeCommand
  | McpClientCommand
  | { type: 'connect'; apiKey?: string }
  | { type: 'runtime.status' }
  | { type: 'auth.status' }
  | { type: 'env.detect' }
  | { type: 'cli.install'; channel: InstallChannel }
  | { type: 'cli.update'; channel?: InstallChannel }
  | { type: 'harness.cli.check' }
  | { type: 'harness.cli.update'; provider: HarnessCliProvider }
  | { type: 'droidproxy.status' }
  | { type: 'droidproxy.launch' }
  | { type: 'droidproxy.login'; provider: DroidProxyProviderKey }
  | { type: 'droidproxy.login.cancel' }
  | {
      type: 'droidproxy.account.setEnabled';
      provider: DroidProxyProviderKey;
      id: string;
      enabled: boolean;
    }
  | { type: 'droidproxy.install' }
  | { type: 'droidproxy.install.cancel' }
  | { type: 'droidproxy.factoryModels.apply' }
  | { type: 'catalog.models' }
  | { type: 'provider.refresh' }
  // Asks for a harness's account usage, answered by `usage.updated`. With
  // `panelOpen`, /usage shows it: the read may start a short-lived harness
  // process when no session of the harness is live. `immediate` skips the
  // pause kept between automatic reads.
  | { type: 'usage.refresh'; provider: ProviderKind; panelOpen: boolean; immediate: boolean }
  | { type: 'catalog.tools'; providerSessionId?: string }
  | { type: 'catalog.skills'; providerSessionId?: string }
  | { type: 'settings.defaults' }
  | {
      type: 'session.create';
      clientRef: string;
      cwd?: string;
      title: string;
      goal: string;
      // Catalog rows staged with the first prompt, as on a send.
      mentions?: ProviderMention[];
      sessionPurpose: SessionPurpose;
      // Omitted means the default provider.
      provider?: ProviderKind;
      interactionMode?: SessionInteractionMode;
      modelId?: string;
      reasoningEffort?: ReasoningEffort;
      fastMode?: boolean;
      contextWindowTokens?: ContextWindowTokens;
      compactionModel?: string;
      compactionTokenLimit?: number | null;
      compactionTokenLimitPerModel?: Record<string, number>;
      // Explicit snapshot chosen by the sender; there is no sidecar fallback.
      autonomy: Autonomy;
      workerModel?: string;
      workerReasoning?: ReasoningEffort;
      validatorModel?: string;
      validatorReasoning?: ReasoningEffort;
      responseFormat?: ResponseFormat;
    }
  | {
      type: 'session.send';
      appSessionId: string;
      text: string;
      mentions?: ProviderMention[];
      responseFormat?: ResponseFormat;
      // Hands the prompt to the running turn as a steer under this id, which
      // the renderer chose for its own row. Absent, a send while a turn runs
      // waits for the turn to end.
      steerId?: string;
    }
  // Stops the running turn so a steer the model has not taken in yet goes first.
  | { type: 'session.sendNow'; appSessionId: string; steerId: string }
  // Replies with session.steerWithdrawn; true confirms the model cannot see it.
  | { type: 'session.withdrawSteer'; appSessionId: string; steerId: string; requestId: string }
  | { type: 'session.repairApp'; appSessionId: string; error: string; source: string }
  | { type: 'session.resume'; appSessionId: string }
  | { type: 'session.interrupt'; appSessionId: string }
  | {
      type: 'voice.start';
      appSessionId: string;
      sdp: string;
      /** Names this negotiation, so its answer is not taken by the next one. */
      attempt: string;
      voice?: string;
      narration?: VoiceNarration;
    }
  | { type: 'voice.stop'; appSessionId: string }
  | { type: 'voice.voices'; appSessionId: string }
  | {
      type: 'session.updateSettings';
      appSessionId: string;
      modelId?: string | null;
      // null clears the effort: the model chosen offers none.
      reasoningEffort?: ReasoningEffort | null;
      // Omitted leaves the chat's fast mode as it is.
      fastMode?: boolean;
      // Omitted leaves the chat's context window as it is.
      contextWindowTokens?: ContextWindowTokens;
      // Echoed by each model or autonomy settlement event, including failures.
      requestId?: string;
      autonomy?: Autonomy;
      interactionMode?: SessionInteractionMode;
    }
  | { type: 'session.compact'; appSessionId: string; customInstructions?: string }
  | {
      // Copies a session into a new one, answered with this clientRef. On the
      // source's provider the conversation is copied and the answer is
      // `session.forked`, then `prompt` (if any) is sent to the copy. Another
      // provider cannot copy it, nor can a side chat copy a turn in progress,
      // so then a new session opens on the source transcript plus `prompt`,
      // answered by `session.created` like any create. A fork of a streaming
      // session fails. `forkPointId` (an answer's) cuts a native copy after
      // that answer; without it the whole conversation is copied.
      type: 'session.fork';
      clientRef: string;
      appSessionId: string;
      lineage: SessionLineage['kind'];
      title: string;
      forkPointId?: string;
      prompt?: string;
      provider?: ProviderKind;
      modelId?: string;
      reasoningEffort?: ReasoningEffort;
    }
  | { type: 'session.rename'; appSessionId: string; title: string }
  | {
      // Full-transcript Markdown export ("Copy as Markdown"). `title` is the
      // renderer's effective (possibly user-renamed) title for the header.
      type: 'session.exportMarkdown';
      appSessionId: string;
      requestId: string;
      title?: string;
    }
  | { type: 'sessions.reanchorCwd'; requestId: string; fromCwd: string; toCwd: string }
  | { type: 'session.rewindInfo'; appSessionId: string }
  | { type: 'session.rewind'; appSessionId: string; rewindId?: string }
  | { type: 'session.close'; appSessionId: string }
  | { type: 'session.processes.stop'; appSessionId: string; pid: number }
  | {
      type: 'sessions.list';
      workspaceCwds?: string[];
      includePlainChats?: boolean;
      // Workspaces whose pre-existing session bound the user lifted.
      revealEarlierCwds?: string[];
    }
  | { type: 'session.loadHistory'; appSessionId: string; cursor?: string; limit?: number }
  | { type: 'sessions.search'; requestId: string; query: string }
  | { type: 'history.indexingIdle'; isIdle: boolean }
  | {
      type: 'app.backgroundWork';
      tier: 'interactive' | 'hidden' | 'low-power';
      // The chat the user is working in, and every chat on screen including it.
      focusedAppSessionId: string | null;
      visibleAppSessionIds: string[];
    }
  | {
      type: 'child.open';
      parentAppSessionId: string;
      childSessionId: string;
      requestId: string;
    }
  | {
      type: 'child.send';
      parentAppSessionId: string;
      childSessionId: string;
      text: string;
      responseFormat?: ResponseFormat;
    }
  | { type: 'child.interrupt'; parentAppSessionId: string; childSessionId: string }
  | {
      type: 'child.loadHistory';
      parentAppSessionId: string;
      childSessionId: string;
      cursor?: string;
      limit?: number;
    }
  | {
      type: 'child.updateSettings';
      parentAppSessionId: string;
      childSessionId: string;
      modelId: string | null;
      reasoningEffort?: ReasoningEffort;
    }
  | {
      type: 'approval.respond';
      appSessionId: string;
      requestId: string;
      outcome: PermissionOutcome;
    }
  | {
      type: 'question.respond';
      appSessionId: string;
      requestId: string;
      cancelled: boolean;
      answers: QuestionAnswer[];
    }
  | { type: 'history.list' }
  | { type: 'history.page'; providerSessionId: string; cursor?: string; limit?: number }
  | {
      type: 'settings.agent.update';
      appSessionId?: string;
      agent: ConfigurableSessionRole;
      modelId?: string | null;
      reasoningEffort?: ReasoningEffort | null;
    }
  | {
      // Snapshot of the app's explicitly configured compaction limits. A null
      // global or empty per-model map means the user cleared that tier; omitted
      // fields continue following CLI-file defaults.
      type: 'settings.compaction.update';
      compactionTokenLimit?: number | null;
      compactionTokenLimitPerModel?: Record<string, number>;
    }
  | {
      type: 'browser.open';
      appSessionId: string;
      url: string;
      viewport?: BrowserViewport;
      viewportMode?: BrowserViewportMode;
    }
  | { type: 'browser.close'; appSessionId: string }
  | { type: 'browser.reload'; appSessionId: string }
  | {
      // The browsers the app kept from its last run, sent on each connection.
      // The sidecar takes up any it lacks under the same id, leaving the page.
      type: 'browser.restore';
      browsers: {
        appSessionId: string;
        browserSessionId: string;
        url: string;
        viewport: BrowserViewport;
        viewportMode: BrowserViewportMode;
      }[];
    }
  | {
      type: 'browser.resizeViewport';
      appSessionId: string;
      viewport: BrowserViewport;
      viewportMode: BrowserViewportMode;
      /** The pane's size for Fit, taken only while the page is on Fit. */
      follow?: boolean;
    }
  | { type: 'browser.design.addReference'; appSessionId: string; reference: DesignReference }
  /** Marks the user took away or picked again, so design-mode reads only live ones. */
  | { type: 'browser.design.removeReferences'; appSessionId: string; ids: string[] }
  | {
      type: 'browser.design.sendPrompt';
      appSessionId: string;
      instruction: string;
      /** The prompt's own snapshots of its marks, each under an id no other pick has. */
      references: DesignReference[];
      mentions?: ProviderMention[];
      responseFormat?: ResponseFormat;
    }
  | { type: 'sidebar.result'; result: SidebarResult };

type ChildUpdatedEvent =
  | {
      type: 'child.updated';
      parentAppSessionId: string;
      childSessionId: string;
      requestId: string;
      access: 'ready';
      runtimeGeneration: number;
    }
  | {
      type: 'child.updated';
      parentAppSessionId: string;
      childSessionId: string;
      requestId: string;
      access: 'history';
    };

interface SessionChildEvent {
  type: 'session.child';
  event: 'upserted';
  child: ChildSessionSummary;
  runtimeAvailable: boolean;
  runtimeGeneration: number;
}

interface ChildErrorEvent {
  type: 'child.error';
  parentAppSessionId: string;
  childSessionId: string;
  operation: 'open' | 'loadHistory' | 'send' | 'interrupt' | 'settings';
  requestId: string | null;
  code: string;
  message: string;
  recoverable: boolean;
}

// ── Sidecar -> Frontend ──────────────────────────────────────────────
// How much of the agent's work a voice session speaks while it runs.
export type VoiceNarration = 'brief' | 'commentary';

export type ServerEvent =
  | ProjectEvent
  | { type: 'voice.answer'; appSessionId: string; sdp: string; attempt: string }
  | { type: 'voice.state'; appSessionId: string; status: 'live' | 'closed' }
  | {
      type: 'voice.transcript';
      appSessionId: string;
      role: 'user' | 'assistant';
      text: string;
      final: boolean;
    }
  | { type: 'voice.voices'; appSessionId: string; voices: string[]; defaultVoice?: string }
  | { type: 'voice.error'; appSessionId: string; message: string }
  | McpServerEvent
  | AutomationBridgeEvent
  | { type: 'connection'; status: 'connected' | 'error'; message?: string }
  | {
      type: 'runtime.updated';
      status: { mode: 'cli_auth'; droidPath: string; apiKeyConfigured: boolean };
    }
  | { type: 'env.report'; report: EnvironmentReport }
  | {
      type: 'cli.install.progress';
      phase: 'install' | 'update';
      stream: 'stdout' | 'stderr';
      line: string;
    }
  | { type: 'cli.install.done'; phase: 'install' | 'update'; ok: boolean; exitCode: number }
  | { type: 'harness.cli.report'; clis: HarnessCliState[] }
  | {
      type: 'harness.cli.update.done';
      provider: HarnessCliProvider;
      ok: boolean;
      previousVersion?: string;
      version?: string;
    }
  | { type: 'droidproxy.report'; status: DroidProxyStatus }
  | { type: 'droidproxy.login.started'; provider: DroidProxyProviderKey }
  | {
      type: 'droidproxy.account.updated';
      provider: DroidProxyProviderKey;
      id: string;
      enabled: boolean;
      ok: boolean;
      message?: string;
    }
  | {
      type: 'droidproxy.login.done';
      provider: DroidProxyProviderKey;
      ok: boolean;
      cancelled?: boolean;
      message?: string;
    }
  | {
      type: 'droidproxy.install.progress';
      phase: DroidProxyInstallPhase;
      receivedBytes?: number;
      totalBytes?: number;
    }
  | {
      type: 'droidproxy.install.done';
      ok: boolean;
      cancelled?: boolean;
      message?: string;
    }
  | {
      type: 'droidproxy.factoryModels.applied';
      ok: boolean;
      applied: number;
      removed: number;
      backupPath?: string;
      message?: string;
    }
  | { type: 'session.created'; clientRef: string; session: SessionSummary }
  // A copied session, stored and closed; its first send resumes it.
  | { type: 'session.forked'; clientRef: string; session: SessionSummary }
  | { type: 'session.model_update_applied'; appSessionId: string; requestId: string }
  | { type: 'session.autonomy_update_applied'; appSessionId: string; requestId: string }
  | { type: 'session.updated'; session: SessionSummary }
  | {
      type: 'session.steerWithdrawn';
      appSessionId: string;
      steerId: string;
      requestId: string;
      withdrawn: boolean;
      // The prompt's full text and catalog mentions, sent when it was withdrawn.
      text?: string;
      mentions?: ProviderMention[];
    }
  | { type: 'session.closed'; appSessionId: string }
  | { type: 'session.processes'; appSessionId: string; processes: AgentProcess[] }
  | { type: 'sessions.processes'; processes: Record<string, AgentProcess[]> }
  | {
      type: 'sessions.cwdReanchored';
      requestId: string;
      ok: boolean;
      count: number;
      message?: string;
    }
  // "Copy as Markdown" reply: success and failure carry disjoint payloads.
  | {
      type: 'session.markdownExported';
      requestId: string;
      ok: true;
      markdown: string;
    }
  | {
      type: 'session.markdownExported';
      requestId: string;
      ok: false;
      message: string;
    }
  | ChildUpdatedEvent
  | ChildErrorEvent
  | { type: 'event.appended'; event: TranscriptEvent }
  | { type: 'approval.requested'; request: PermissionRequest }
  | { type: 'question.requested'; question: SessionQuestion }
  // An approval or question the session will never get an answer for, because
  // the turn that raised it ended first.
  | { type: 'interaction.cancelled'; appSessionId: string; requestId: string }
  // A question another chat answered, so the window stops asking it.
  | { type: 'question.answered'; appSessionId: string; requestId: string }
  | {
      type: 'context.updated';
      appSessionId: string;
      sourceSessionId: string;
      parentAppSessionId?: string;
      childSessionId?: string;
      stats: ContextStatsSnapshot;
      breakdown?: unknown;
    }
  | {
      type: 'catalog.updated';
      catalog: 'models' | 'tools' | 'skills';
      items: unknown[];
      providerSessionId?: string | null;
    }
  | { type: 'provider.status'; statuses: ProviderStatus[] }
  | { type: 'usage.updated'; usage: ProviderUsage }
  | { type: 'settings.defaults'; defaults: FactoryDefaultSettings }
  | {
      type: 'error';
      code?: string;
      clientRef?: string;
      // Echoed from the offending command when it carried one, so requesters
      // can tell their own failure apart from a foreign command's.
      requestId?: string;
      appSessionId?: string;
      providerSessionId?: string;
      message: string;
      recoverable?: boolean;
    }
  | {
      type: 'mission.features';
      appSessionId: string;
      missionId?: string;
      features: BridgeFeature[];
    }
  | { type: 'mission.progress'; appSessionId: string; missionId?: string; entries: ProgressEntry[] }
  | SessionChildEvent
  | { type: 'spec.content'; appSessionId: string; path: string; content: string }
  | {
      type: 'sessions.list';
      sessions: SessionSummary[];
      // Pre-existing sessions withheld per requested cwd; a missing key means
      // the folder has nothing more to reveal.
      earlierSessionsByCwd: Record<string, number>;
    }
  | {
      type: 'session.history';
      appSessionId: string;
      childSessionId?: string;
      progress: ProgressEntry[];
      transcripts: TranscriptEvent[];
      childSessions?: ChildSessionSummary[];
      mode?: 'replace' | 'prepend';
      olderCursor?: string;
      // Restore telemetry: how many transcript events this page delivered and
      // whether older history remains to page in. Lets the client show an
      // explicit restoring/partial/complete state instead of guessing.
      loadedCount?: number;
      hasMore?: boolean;
    }
  | {
      type: 'session.history.error';
      appSessionId: string;
      childSessionId?: string;
      message: string;
    }
  | {
      type: 'sessions.searchResults';
      requestId: string;
      results: SessionSearchResult[];
      indexingIncomplete: boolean;
    }
  | { type: 'history.persistenceRecovered' }
  | { type: 'history.list'; sessions: SessionHistoryEntry[] }
  | { type: 'browser.updated'; state: BrowserState }
  | { type: 'sidebar.request'; request: SidebarRequest }
  | {
      type: 'browser.closed';
      appSessionId: string;
      /** Closed with the chat's runtime, not by the user: the pane stays open for a new page. */
      keepPane?: boolean;
    }
  | { type: 'browser.error'; appSessionId?: string; message: string };

export const BRIDGE_PROTOCOL_VERSION = 9 as const;

export interface SequencedServerEvent {
  seq: number;
  event: ServerEvent;
}

export interface ServerEventBatch {
  type: 'events.batch';
  generation: string;
  firstSeq: number;
  lastSeq: number;
  events: SequencedServerEvent[];
}

export interface PersistenceRecovery {
  durable: boolean;
  hadUnflushedWork: boolean;
  message?: string;
  unavailableReason?: string;
  searchUnavailableReason?: string;
}

export interface InterruptedSessionRecord {
  appSessionId: string;
  childSessionId?: string;
  reason: string;
}

export interface BridgeRuntimeSnapshot {
  runtime: { mode: 'cli_auth'; droidPath: string; apiKeyConfigured: boolean };
  sessions: SessionSummary[];
  children: ChildSessionSummary[];
  processes: Record<string, AgentProcess[]>;
  persistence: PersistenceRecovery;
  interrupted: InterruptedSessionRecord[];
}

export interface BridgeResetMessage {
  type: 'bridge.reset';
  generation: string;
  lastSeq: number;
  reason: 'invalid_resume';
}

export interface BridgeSnapshotMessage {
  type: 'bridge.snapshot';
  generation: string;
  lastSeq: number;
  reason: 'generation_changed' | 'replay_unavailable';
  snapshot: BridgeRuntimeSnapshot;
}

export type ServerWireMessage =
  | Extract<ServerEvent, { type: 'error' }>
  | ServerEventBatch
  | BridgeResetMessage
  | BridgeSnapshotMessage;
