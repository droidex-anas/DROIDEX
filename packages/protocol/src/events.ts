import type {
  BridgeFeature,
  ChildSessionSummary,
  ProgressEntry,
  ProviderUsage,
  SessionSummary,
} from './sessions.js';
import type { CanvasEvent } from './canvas.js';
import type { ProjectEvent } from './projects.js';
import type { McpServerEvent } from './mcp.js';
import type { AutomationBridgeEvent } from './automations.js';
import type {
  ContextStatsSnapshot,
  DroidProxyInstallPhase,
  DroidProxyProviderKey,
  DroidProxyStatus,
  EnvironmentReport,
  FactoryDefaultSettings,
  HarnessCliProvider,
  HarnessCliState,
  ProviderStatus,
  SessionHistoryEntry,
  SessionSearchResult,
} from './environment.js';
import type { ProviderMention } from './catalog.js';
import type {
  AgentProcess,
  PermissionRequest,
  SessionQuestion,
  TranscriptEvent,
} from './transcript.js';
import type { BrowserState } from './browser.js';
import type { SidebarRequest } from './sidebar.js';

export type ChildUpdatedEvent =
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

export interface SessionChildEvent {
  type: 'session.child';
  event: 'upserted';
  child: ChildSessionSummary;
  runtimeAvailable: boolean;
  runtimeGeneration: number;
}

export interface ChildErrorEvent {
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
  | CanvasEvent
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
      type: 'harness.cli.install.progress';
      provider: HarnessCliProvider;
      stream: 'stdout' | 'stderr';
      line: string;
    }
  | {
      type: 'harness.cli.install.done';
      provider: HarnessCliProvider;
      ok: boolean;
      exitCode: number;
    }
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
  // Removes a settled or abandoned approval, or an abandoned question.
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
      mode?: 'replace' | 'prepend' | 'refresh';
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

export const BRIDGE_PROTOCOL_VERSION = 10 as const;

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
