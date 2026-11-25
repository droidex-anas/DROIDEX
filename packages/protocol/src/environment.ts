import type {
  Autonomy,
  ContextWindowTokens,
  ReasoningEffort,
  SessionInteractionMode,
} from './sessions.js';
import type { ProviderKind, ProviderReadiness } from './providers.js';
import type { SkillInfo } from './catalog.js';

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

export interface ProviderStatus {
  provider: ProviderKind;
  readiness: ProviderReadiness;
  version?: string;
  // Who the harness CLI is signed in as. Absent when it reports no sign-in,
  // which does not block a chat: the CLI may reach its models another way.
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
// decides which updater owns the binary; the ChatGPT app updates its own copy.
export type HarnessInstallSource = 'homebrew' | 'npm' | 'native' | 'chatgpt';

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

export interface CliInfo {
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

export interface ContextBreakdownCategory {
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
export interface SessionSearchMatch {
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
