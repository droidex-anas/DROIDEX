import {
  deliverScheduledMessage,
  type ScheduledTurnDelivery,
} from './sessionAutomationDelivery.js';
import type { AutomationDeliveryReceipt } from './automations/types.js';
import { type McpServerConfig, type SdkMcpServer } from '@factory/droid-sdk';
import { randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FactorySession } from './DroidRuntime.js';
import { droidexUserDataDir } from './droidexPaths.js';
import { sessionFilePath } from './history.js';
import type {
  ClientCommand,
  FactoryDefaultSettings,
  ProviderMention,
  ServerEvent,
  SessionLineage,
  SessionPurpose,
  SessionSummary,
  SkillInfo,
} from './protocol.js';
import type { SessionRegistry } from './SessionRegistry.js';
import type { PrimaryAutomaticCompactionTarget, SessionCompaction } from './SessionCompaction.js';
import type { SessionEventFlow } from './SessionEventFlow.js';
import type { LiveOperationTarget, SessionContext } from './SessionContext.js';
import type { ChildSessions } from './ChildSessions.js';
import type { AgentProcessMonitor } from './processes/AgentProcessMonitor.js';
import { errMsg } from './errors.js';
import {
  buildCreatedSessionSummary,
  buildResumedProviderSummary,
  buildResumedSession,
  createDefaultsModeForCommand,
  createInteractionModeForCommand,
  createMissionAgentDefaultsForMode,
  createModelDefaultsForProvider,
  requireAutonomyForCommand,
  resumeHandle,
} from './sessionOpening.js';
import type { ProviderInteractions } from './providers/interactions.js';
import { requireProviderKind, type ProviderKind } from './providers/providerKind.js';
import { failedTurnSummary, type PrimaryTurnRequest } from './providers/primaryTurn.js';
import { UsageLimitError, usageLimitDetails } from './providers/usageLimit.js';
import {
  droidLaunchSettings,
  requireDroidReasoningSupported,
} from './providers/droid/droidLaunch.js';
import { droidSessionOf } from './providers/droid/DroidProviderSession.js';
import { userPromptDisplay } from './sessionTranscriptParser.js';
import type {
  DelegatedTurnEnd,
  Provider,
  ProviderSession,
  SteerOutcome,
} from './providers/session.js';

const MAX_AUTOMATIC_SESSION_RUNTIMES = 20;
const MAX_RECENT_STEER_OUTCOMES = 64;
// How long a settled turn waits for Send now's interrupt. A harness that never
// answers it must not leave the chat busy for good.
const SEND_NOW_INTERRUPT_WAIT_MS = 5_000;

export type SessionCreateCommand = Extract<ClientCommand, { type: 'session.create' }>;

export interface SessionBranch {
  lineage: SessionLineage;
  prompt: string;
}

async function sessionRuntimeCwd(appCwd: string): Promise<string> {
  if (appCwd) return appCwd;
  const chatCwd = join(droidexUserDataDir(), 'chats');
  await mkdir(chatCwd, { recursive: true });
  return chatCwd;
}

interface LocalMcpResource {
  close(): Promise<void>;
}
interface AdmittedPrompt {
  liveSession: LiveSession;
  stops: number;
}
interface DeferredClose {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  started: boolean;
  retryOnFailure?: boolean;
  retryTimer?: ReturnType<typeof setTimeout>;
}
interface CloseOperation {
  deferred: DeferredClose;
  created: boolean;
}
export interface StartedLocalMcpResources {
  servers: LocalMcpResource[];
  configs: McpServerConfig[];
  inAppServers?: SdkMcpServer[];
}
export interface SessionPrompt {
  text: string;
  mentions?: ProviderMention[];
  // See PrimaryTurnRequest.notice: set for a turn the app owes the chat.
  notice?: string;
  // A typed steer is listed as pending until the model
  // takes it in, whether the harness holds it or it waits on the queue.
  steerId?: string;
  // When it was sent, relative to the chat's other prompts.
  order: number;
  // Nobody typed it (a scheduled delivery, a message from another chat), so
  // the chat has not shown it and the turn draws it.
  announce?: true;
  // The sender's guard on a message from another chat. Once it turns false the
  // prompt is dropped wherever it waits, as a Stop drops it.
  isCurrent?: () => boolean;
  delivery?: SteeredReportDelivery;
}

/** Acceptance settles handoff; acknowledgement only clears the reply's unread flag. */
export interface SteeredReportDelivery {
  accepted: () => void;
  declined: (reason: 'stale' | 'refused') => void;
  acknowledged?: () => void;
}

interface LiveTurnState {
  streaming: boolean;
  autoCompacting: boolean;
  pendingSends: SessionPrompt[];
  // Steers the harness holds for the running turn and has not delivered yet.
  steers: SessionPrompt[];
  interruptingToSend?: boolean;
  // Send now's interrupt while it is in flight. A turn that ends on its own
  // first waits for it, or it would stop the turn started after it.
  sendNowInterrupt?: Promise<void>;
  // Counts the turns the provider started by itself, so a settlement that
  // waited knows whether another began meanwhile.
  delegatedTurns?: number;
  // A turn the provider started is running on the chat's own source.
  delegatedTurnOpen?: boolean;
  // Includes its transcript flush and Send now interrupt, before a typed turn can start.
  delegatedTurnSettled?: Promise<void>;
  interrupting?: boolean; // Marks user Stop so the resulting stream abort settles quietly.
}
type SessionCloseMode = 'discard-pending' | 'preserve-pending';
export interface LiveSession extends LiveTurnState {
  summary: SessionSummary;
  session: ProviderSession;
  // The SDK session behind the provider session, for the subsystems only Droid
  // has: context stats, compaction, spec mode, rewind and child sessions.
  // Absent on every other provider, and each of those subsystems is skipped.
  droid?: FactorySession;
  closeMode?: SessionCloseMode;
  closePromise?: Promise<void>;
  turnPromise?: Promise<void>;
  restartBeforeNextTurn?: boolean;
  providerClosePromise?: Promise<void>;
  mcpServers: LocalMcpResource[];
  // Running MCP handles reused when compaction swaps the provider session.
  mcpConfigs: McpServerConfig[];
  todoDisabledForDesign?: boolean;
  compacting?: boolean; // Manual-compaction overlap guard; auto-compaction is separate.
  unsubscribe?: () => void; // Primary provider notification subscription, replaced on swap.
  catalogUnsubscribe?: () => void;
}
type LifecycleError = Omit<Extract<ServerEvent, { type: 'error' }>, 'type'>;

export interface SessionLifecycleDependencies {
  onUserPrompt?: (appSessionId: string) => void;
  beforeFirstTurn?: ((session: SessionSummary, clientRef: string) => Promise<void>) | undefined;
  onSessionAvailable?: ((appSessionId: string) => void) | undefined;
  // A scheduled runtime slot was released without a session closing.
  onScheduledCapacityChanged?: (() => void) | undefined;
  provider: (kind: ProviderKind) => Provider;
  providerDefaultModelId?: (kind: ProviderKind) => string | undefined;
  registry: SessionRegistry<LiveSession>;
  ensureConnected: () => void;
  getFactoryDefaults: () => Promise<FactoryDefaultSettings>;
  maxContextTokensForModel: (modelId?: string) => number | undefined;
  startLocalMcpServers: (
    ref: { id: string; clientRef?: string; purpose?: SessionPurpose },
    kind: ProviderKind,
    cwd?: string,
  ) => Promise<StartedLocalMcpResources>;
  interactionsFor: (ref: { id: string }) => ProviderInteractions;
  compaction: Pick<
    SessionCompaction,
    'resolveLimit' | 'arm' | 'subscribePrimary' | 'afterTurn' | 'cancel' | 'forgetSession'
  >;
  isShutdownStarted: () => boolean;
  childSessions: Pick<ChildSessions, 'attachParent' | 'closeParent' | 'retryAgentWave'>;
  agentProcesses: Pick<
    AgentProcessMonitor,
    'track' | 'untrack' | 'killSession' | 'setIgnoredCommands'
  >;
  applyPendingSettingsToSummary: (summary: SessionSummary) => SessionSummary;
  recordLineage: (appSessionId: string, lineage: SessionLineage) => void;
  applyPendingSessionSettings: (appSessionId: string) => Promise<boolean>;
  waitForSettingsMutations?: (appSessionId: string) => Promise<void>;
  runPrimaryTurn: (liveSession: LiveSession, request: PrimaryTurnRequest) => Promise<void>;
  eventFlow: Pick<SessionEventFlow, 'apply' | 'beginTurn'>;
  context: Pick<
    SessionContext,
    'refresh' | 'stopPolling' | 'stopSession' | 'forgetSession' | 'preserveUsage'
  >;
  hasPendingInteractions: (appSessionId: string) => boolean;
  hasActiveSettingsChanges: (appSessionId: string) => boolean;
  // Durable transcript for a provider that keeps no session file of its own.
  // Opened with the live session, released when it closes.
  openProviderTranscript: (summary: SessionSummary) => void;
  forgetProviderTranscript: (appSessionId: string) => void | Promise<void>;
  forgetInteractions: (appSessionId: string) => void;
  forgetEventFlow: (appSessionId: string) => void;
  forgetMissionControl: (appSessionId: string) => void;
  forgetPendingSettings: (appSessionId: string) => void;
  closeBrowserSession: (appSessionId: string) => Promise<void>;
  // Ends a live voice conversation before the provider session it runs on is
  // torn down, so no realtime session is left open.
  stopVoiceSession: (appSessionId: string) => Promise<void>;
  emit: (event: ServerEvent) => void;
  emitError: (error: LifecycleError) => void;
  // A live progress row while a turn stops to send now; it is not stored.
  appendProgress: (appSessionId: string, text: string) => void;
  // The transcript row a crashed runtime leaves behind, stored with the chat.
  appendError: (
    appSessionId: string,
    message: string,
    details?: ReturnType<typeof usageLimitDetails>,
  ) => void;
  // A steer the harness has just delivered into the running turn: the row that
  // marks where the model took it in, and what the transcript stores.
  appendSteer: (appSessionId: string, text: string, steerId: string) => void | Promise<void>;
  catalogUpdated: (liveSession: LiveSession, items: SkillInfo[]) => void;
  emitSessionList: (closedProviderSessionId: string) => void | Promise<void>;
  settleStreaming: (appSessionId: string, sourceSessionId: string) => Promise<void>;
  // Releases the longest-idle runtime other than this one; true when one went.
  releaseRuntimeForCapacity: (excludedAppSessionId: string) => Promise<boolean>;
}
export class SessionLifecycle {
  private readonly deferredCloses = new WeakMap<LiveSession, DeferredClose>();
  private automaticCreates = 0;
  private readonly steerOutcomes = new WeakMap<
    LiveSession,
    Map<string, Pick<SessionPrompt, 'text' | 'mentions'> | 'delivered'>
  >();
  private readonly resumeOperations = new Map<string, Promise<boolean>>();
  private readonly canceledResumes = new Set<string>();
  // A close after a native copy is announced cancels that fork's first open,
  // but must not prevent a deliberate resume after the attempt ends.
  private readonly forkOpens = new Map<string, 'pending' | 'closed'>();
  // How often each chat was stopped or discarded. A prompt that was accepted
  // but has not started its turn compares the count it was accepted at, so a
  // Stop takes it back even while there is no runtime to interrupt.
  private readonly stops = new Map<string, number>();
  // A chat relaunching on a new context window: the prompts waiting for it, in
  // the order they were sent, since it has no runtime to queue them on, and the
  // usage limit it is held on, which its reopened summary carries.
  private readonly relaunches = new Map<
    string,
    { waiting: SessionPrompt[]; usageLimit: SessionSummary['usageLimit'] }
  >();

  constructor(private readonly dependencies: SessionLifecycleDependencies) {}

  beginForkOpen(appSessionId: string): void {
    this.forkOpens.set(this.chatKey(appSessionId), 'pending');
  }

  endForkOpen(appSessionId: string): void {
    this.forkOpens.delete(this.chatKey(appSessionId));
  }

  isCloseRequested(appSessionId: string): boolean {
    return this.forkOpens.get(this.chatKey(appSessionId)) === 'closed';
  }
  // Provisional opens stop counting once registration turns them into live runtimes.
  runtimeLoad(): { live: number; limit: number } {
    const registry = this.dependencies.registry;
    const opening = [...this.resumeOperations.keys()].filter((id) => !registry.getLive(id)).length;
    return {
      live: registry.liveCount + this.automaticCreates + opening,
      limit: MAX_AUTOMATIC_SESSION_RUNTIMES,
    };
  }

  private canStartAutomaticRuntime(): boolean {
    return this.runtimeLoad().live < MAX_AUTOMATIC_SESSION_RUNTIMES;
  }

  async createAutomatic(command: SessionCreateCommand, appSessionId?: string): Promise<boolean> {
    if (!this.canStartAutomaticRuntime()) return false;
    this.automaticCreates += 1;
    let reserved = true;
    const release = () => {
      if (!reserved) return;
      reserved = false;
      this.automaticCreates -= 1;
    };
    try {
      await this.create(command, undefined, appSessionId, release);
      return true;
    } finally {
      release();
      this.dependencies.onScheduledCapacityChanged?.();
    }
  }

  async makeAutomaticRuntimeRoom(appSessionId: string): Promise<boolean> {
    if (!this.canStartAutomaticRuntime())
      await this.dependencies.releaseRuntimeForCapacity(appSessionId);
    return this.canStartAutomaticRuntime();
  }

  // A branch keeps the user's goal while its first prompt carries the source transcript.
  async create(
    command: SessionCreateCommand,
    branch?: SessionBranch,
    requestedAppSessionId?: string,
    releaseCreateReservation?: () => void,
  ): Promise<void> {
    const d = this.dependencies;
    d.ensureConnected();
    const appCwd = command.cwd ?? '';
    const ref = {
      id: requestedAppSessionId ?? '',
      clientRef: command.clientRef,
      purpose: command.sessionPurpose,
    };
    let pendingMcpServers: LocalMcpResource[] = [];
    let pendingSession: ProviderSession | undefined;
    let pendingLiveSession: LiveSession | undefined;

    try {
      // Validate the required autonomy snapshot and the provider binding before
      // any slow or fallible discovery work so a bad command always gets its own
      // diagnostic instead of failing mid-open.
      const autonomy = requireAutonomyForCommand(command);
      // Resolved here so an unroutable provider fails before any resource starts.
      const kind = requireProviderKind(command.provider);
      requireDroidReasoningSupported(kind, command);
      if (kind === 'droid' && command.fastMode !== undefined)
        throw new Error('Droid does not support fast mode.');
      if (command.contextWindowTokens !== undefined && kind !== 'claude')
        throw new Error('Context window selection is only supported for Claude Code chats.');
      const provider = d.provider(kind);
      const defaults = await d.getFactoryDefaults();
      const interactionMode = createInteractionModeForCommand(command, defaults);
      const defaultsMode = createDefaultsModeForCommand(command, interactionMode);
      const primary = createModelDefaultsForProvider(kind, defaultsMode, command, defaults);
      const agents = createMissionAgentDefaultsForMode(defaultsMode, command, defaults);
      const compactionModel =
        command.compactionModel ?? defaults.compactionModel ?? 'current-model';
      const compactionTokenLimit = await d.compaction.resolveLimit({
        modelId: primary.modelId,
        uiOverride: {
          ...(command.compactionTokenLimit !== undefined
            ? { compactionTokenLimit: command.compactionTokenLimit }
            : {}),
          ...(command.compactionTokenLimitPerModel !== undefined
            ? { compactionTokenLimitPerModel: command.compactionTokenLimitPerModel }
            : {}),
        },
        defaults,
      });
      const runtimeCwd = await sessionRuntimeCwd(appCwd);
      this.requireOpenAdmission();
      const mcp = await d.startLocalMcpServers(ref, kind, appCwd);
      pendingMcpServers = mcp.servers;
      const providerSession = await provider.create({
        appSessionId: requestedAppSessionId,
        cwd: runtimeCwd,
        interactionMode,
        autonomy,
        ...primary,
        ...(kind !== 'droid' && !primary.modelId
          ? { modelId: d.providerDefaultModelId?.(kind) }
          : {}),
        contextWindowTokens: command.contextWindowTokens,
        mcpServers: mcp.configs,
        interactions: d.interactionsFor(ref),
        ...(kind === 'droid'
          ? {
              droidLaunch: droidLaunchSettings({
                command,
                interactionMode,
                primary,
                agents,
                defaults,
                compactionModel,
                compactionTokenLimit,
              }),
            }
          : { fastMode: command.fastMode ?? false }),
        ...(mcp.inAppServers ? { inAppMcpServers: mcp.inAppServers } : {}),
      });
      pendingSession = providerSession;
      const droid = droidSessionOf(providerSession);
      this.requireOpenAdmission();
      const autoCompactionArmed =
        droid !== undefined &&
        (await d.compaction.arm(
          {
            session: droid,
            isCurrent: () => !d.isShutdownStarted() && pendingSession === providerSession,
          },
          compactionTokenLimit,
        ));
      this.requireOpenAdmission();

      const appSessionId = requestedAppSessionId ?? providerSession.providerSessionId;
      const maxContextTokens =
        kind === 'droid' ? d.maxContextTokensForModel(primary.modelId) : undefined;
      const created = buildCreatedSessionSummary({
        command,
        appSessionId,
        interactionMode,
        primary,
        compactionModel,
        agents,
        autonomy,
        provider: kind,
        ...(providerSession.resumeId ? { resumeId: providerSession.resumeId } : {}),
        ...(maxContextTokens !== undefined ? { maxContextTokens } : {}),
        ...(autoCompactionArmed ? { compactionTokenLimit } : {}),
        now: Date.now(),
      });
      created.providerSessionId = providerSession.providerSessionId;
      const summary = branch ? { ...created, lineage: branch.lineage } : created;
      if (branch) d.recordLineage(appSessionId, branch.lineage);
      ref.id = appSessionId;
      const liveSession = createLiveSession(summary, providerSession, droid, mcp);
      pendingLiveSession = liveSession;
      this.subscribeAutomaticCompaction(liveSession);
      this.subscribeBackgroundEvents(liveSession);
      await d.registry.register(liveSession, () => {
        this.requireOpenAdmission();
        releaseCreateReservation?.();
      });
      this.subscribeCatalog(liveSession);
      this.observeProviderClosure(liveSession);
      // Registered first, so the failed-open path that unregisters also releases it.
      d.openProviderTranscript(summary);
      this.trackProviderProcess(appSessionId, providerSession, mcp.configs);
      d.childSessions.attachParent(appSessionId);
      // Commit dependent ownership before the provider can execute its first task.
      if (d.beforeFirstTurn) {
        await d.beforeFirstTurn(summary, command.clientRef);
        this.requireOpenAdmission();
        if (
          d.registry.getLive(appSessionId) !== liveSession ||
          liveSession.closeMode ||
          providerSession.isClosed
        ) {
          throw new Error('The session closed before its first turn.');
        }
      }
      d.emit({ type: 'session.created', clientRef: command.clientRef, session: summary });
      // A chat can open with nothing to say: voice mode creates the session so
      // the conversation has a thread to attach to, and the first request
      // arrives spoken. Driving an empty prompt would run a turn about nothing.
      const prompt = branch
        ? sessionPrompt(branch.prompt)
        : sessionPrompt(command.goal, command.mentions);
      if (prompt.text.trim() || prompt.mentions?.length) {
        void this.driveInBackground(appSessionId, prompt);
      }
    } catch (error) {
      await this.cleanupFailedOpen(pendingMcpServers, pendingSession, pendingLiveSession);
      if (!isOpenAdmissionClosed(error)) {
        d.emitError({
          code: 'session.create_failed',
          clientRef: command.clientRef,
          message: errMsg(error),
        });
      }
    }
  }

  async resume(requestedAppSessionId: string, automatic = false): Promise<boolean> {
    const d = this.dependencies;
    const historical = d.registry.getCanonicalSummary(requestedAppSessionId);
    const appSessionId = historical?.appSessionId ?? requestedAppSessionId;
    const liveSession = d.registry.getLive(appSessionId);
    const closing = liveSession?.providerClosePromise ?? liveSession?.closePromise;
    if (closing) {
      await closing;
      if (d.isShutdownStarted()) return false;
    }
    if (this.isCloseRequested(appSessionId)) return false;
    const pending = this.resumeOperations.get(appSessionId);
    if (pending) return pending;
    if (automatic && !d.registry.getLive(appSessionId) && !this.canStartAutomaticRuntime())
      return false;

    const operation = this.resumeOnce(requestedAppSessionId).finally(() => {
      if (this.resumeOperations.get(appSessionId) !== operation) return;
      this.resumeOperations.delete(appSessionId);
      this.canceledResumes.delete(appSessionId);
      // A resume that produced a runtime spent the slot it was holding, and
      // registering it already announced the session. One that failed or was
      // cancelled hands the slot back silently, so say so.
      if (!d.registry.getLive(appSessionId)) d.onScheduledCapacityChanged?.();
    });
    this.resumeOperations.set(appSessionId, operation);
    return operation;
  }

  private async resumeOnce(requestedAppSessionId: string): Promise<boolean> {
    const d = this.dependencies;
    d.ensureConnected();
    const historical = d.registry.getCanonicalSummary(requestedAppSessionId);
    const appSessionId = historical?.appSessionId ?? requestedAppSessionId;
    const providerSessionId = historical?.providerSessionId ?? requestedAppSessionId;
    const existing = d.registry.getLive(appSessionId);
    if (existing) {
      const projectedSummary =
        d.registry.resolveSummary(appSessionId) ??
        d.applyPendingSettingsToSummary({ ...existing.summary });
      d.emit({
        type: 'session.created',
        clientRef: `resume:${appSessionId}`,
        session: projectedSummary,
      });
      this.refreshContext(existing);
      return true;
    }

    const requireCurrentResume = (): void => {
      this.requireOpenAdmission();
      if (this.canceledResumes.has(appSessionId) || this.isCloseRequested(appSessionId))
        throw new OpenAdmissionClosedError();
      if (
        historical &&
        d.registry.getCanonicalSummary(appSessionId)?.providerSessionId !==
          historical.providerSessionId
      ) {
        throw new Error('The target session changed while it was being resumed.');
      }
    };
    const ref = { id: appSessionId, purpose: historical?.sessionPurpose };
    let pendingMcpServers: LocalMcpResource[] = [];
    let pendingSession: ProviderSession | undefined;
    let pendingLiveSession: LiveSession | undefined;
    try {
      const transcriptPath = sessionFilePath(providerSessionId);
      if (transcriptPath) {
        try {
          accessSync(transcriptPath, constants.R_OK);
        } catch {
          throw new Error(
            'This chat’s provider transcript is unavailable. Restore the transcript or reconnect the provider account, then try again.',
          );
        }
      }
      // Resolved before any resource starts, so a session bound to a provider
      // this build cannot route fails before it costs anything. A summary that
      // predates the binding has none and resumes on the default provider.
      const kind = requireProviderKind(historical?.provider);
      const provider = d.provider(kind);
      const mcp = await d.startLocalMcpServers(ref, kind, historical?.cwd);
      pendingMcpServers = mcp.servers;
      const runtimeCwd = await sessionRuntimeCwd(historical?.cwd ?? '');
      requireCurrentResume();
      const providerSession = await provider.resume(providerSessionId, {
        appSessionId,
        ...resumeHandle(historical),
        interactions: d.interactionsFor(ref),
        ...(mcp.inAppServers ? { inAppMcpServers: mcp.inAppServers } : {}),
        cwd: runtimeCwd,
        modelId: historical?.modelId,
        reasoningEffort: historical?.reasoningEffort,
        fastMode: historical?.fastMode,
        contextWindowTokens: historical?.contextWindowTokens,
        autonomy: historical?.autonomy,
        interactionMode: historical?.interactionMode,
        ...(kind !== 'droid' && !historical?.modelId
          ? { modelId: d.providerDefaultModelId?.(kind) }
          : {}),
        mcpServers: mcp.configs,
      });
      pendingSession = providerSession;
      requireCurrentResume();
      const session = droidSessionOf(providerSession);
      const summary = await this.resumedSummary(session, {
        requireCurrent: requireCurrentResume,
        historical,
        appSessionId,
        providerSessionId,
        isCurrent: () => !d.isShutdownStarted() && pendingSession === providerSession,
      });
      // A closed settings write must settle before registration changes its target.
      await d.waitForSettingsMutations?.(appSessionId);
      requireCurrentResume();
      // A relaunching chat is still held on the limit its last turn was refused on.
      const usageLimit = this.relaunches.get(appSessionId)?.usageLimit;
      const projectedSummary = d.applyPendingSettingsToSummary({
        ...summary,
        ...(usageLimit ? { usageLimit } : {}),
      });
      const liveSession = createLiveSession(projectedSummary, providerSession, session, mcp);
      if (projectedSummary.contextWindowTokens !== historical?.contextWindowTokens)
        liveSession.restartBeforeNextTurn = true;
      pendingLiveSession = liveSession;
      this.subscribeAutomaticCompaction(liveSession);
      this.subscribeBackgroundEvents(liveSession);
      await d.registry.register(liveSession, requireCurrentResume);
      this.subscribeCatalog(liveSession);
      this.observeProviderClosure(liveSession);
      // Registered first, so the failed-open path that unregisters also releases it.
      d.openProviderTranscript(projectedSummary);
      this.trackProviderProcess(appSessionId, providerSession, mcp.configs);
      d.childSessions.attachParent(appSessionId);
      d.emit({
        type: 'session.created',
        clientRef: `resume:${appSessionId}`,
        session: projectedSummary,
      });
      d.emit({ type: 'session.updated', session: projectedSummary });
      if (
        projectedSummary.sessionPurpose === 'mission-control' &&
        projectedSummary.features.length > 0
      ) {
        d.emit({
          type: 'mission.features',
          appSessionId,
          ...(projectedSummary.missionId !== undefined
            ? { missionId: projectedSummary.missionId }
            : {}),
          features: projectedSummary.features,
        });
      }
      this.refreshContext(liveSession);
      return true;
    } catch (error) {
      await this.cleanupFailedOpen(pendingMcpServers, pendingSession, pendingLiveSession);
      if (!isOpenAdmissionClosed(error))
        d.emitError({ appSessionId, providerSessionId, message: errMsg(error) });
      return false;
    }
  }

  // Droid reads its own resumed state back from the daemon and arms the
  // auto-compaction the summary then advertises. Every other provider keeps no
  // session file of its own, so the stored summary is its whole record.
  private async resumedSummary(
    session: FactorySession | undefined,
    input: {
      historical: SessionSummary | undefined;
      appSessionId: string;
      providerSessionId: string;
      isCurrent: () => boolean;
      requireCurrent: () => void;
    },
  ): Promise<SessionSummary> {
    if (!session) return buildResumedProviderSummary(input.historical, input.appSessionId);
    const d = this.dependencies;
    const defaults = await d.getFactoryDefaults();
    const resumed = buildResumedSession({
      init: session.initResult,
      historical: input.historical,
      appSessionId: input.appSessionId,
      providerSessionId: input.providerSessionId,
      defaults,
      maxContextTokensForModel: d.maxContextTokensForModel,
      now: Date.now(),
    });
    const summary = resumed.summary;
    const projectedModel = d.applyPendingSettingsToSummary({ ...summary }).modelId;
    const limit = await d.compaction.resolveLimit({
      modelId: projectedModel,
      exposed: resumed.exposedCompaction,
    });
    input.requireCurrent();
    if (
      await d.compaction.arm(
        { appSessionId: input.appSessionId, session, isCurrent: input.isCurrent },
        limit,
      )
    ) {
      summary.compactionTokenLimit = limit;
    }
    return summary;
  }

  private subscribeCatalog(liveSession: LiveSession): void {
    const { session } = liveSession;
    if (!session.catalogItems) return;
    const publish = (items: SkillInfo[]) => {
      if (
        this.dependencies.registry.getLive(liveSession.summary.appSessionId) === liveSession &&
        liveSession.session === session &&
        !liveSession.closeMode
      )
        this.dependencies.catalogUpdated(liveSession, items);
    };
    liveSession.catalogUnsubscribe = session.onCatalogUpdated?.(publish);
    void session.catalogItems().then(publish, (error: unknown) => {
      if (this.dependencies.registry.getLive(liveSession.summary.appSessionId) !== liveSession)
        return;
      this.dependencies.emitError({
        appSessionId: liveSession.summary.appSessionId,
        code: 'catalog.skills_failed',
        message: `Could not load this session's provider catalog: ${errMsg(error)}`,
        recoverable: true,
      });
    });
  }

  deliverScheduled(
    appSessionId: string,
    prompt: string,
    isCurrent: () => boolean,
    wakingProjectLead = false,
  ): Promise<AutomationDeliveryReceipt> {
    // Lead wakes bypass the soft cap so workers waiting on the lead cannot deadlock.
    const automatic = !wakingProjectLead;
    return deliverScheduledMessage(
      {
        dependencies: this.dependencies,
        canResume: () => !automatic || this.canStartAutomaticRuntime(),
        makeRoom: (id) => this.dependencies.releaseRuntimeForCapacity(id),
        resume: (id) => this.resume(id, automatic),
        start: (id, text, delivery) =>
          this.driveInBackground(id, { ...sessionPrompt(text), announce: true }, delivery),
      },
      appSessionId,
      prompt,
      isCurrent,
    );
  }

  /**
   * Steers a prompt nobody typed into the turn a live session is running, as
   * the user's Steer does: the harness takes it in at its own next step, and
   * one the turn cannot take waits behind it. Resolves once the chat has taken
   * the prompt, never waiting for the delivery. False when no turn is running
   * or the prompt was not taken, so the caller delivers it another way.
   * `isCurrent` turning false withdraws it: this resolves false while the chat
   * has not taken it, and one that went on behind the turn is dropped there.
   * `now` sends it as Send now does: the turn stops and the prompt runs next.
   * A delivery report settles at the provider call and never joins that queue.
   */
  async steerRunningTurn(
    appSessionId: string,
    text: string,
    isCurrent: () => boolean,
    now = false,
    delivery?: SteeredReportDelivery,
  ): Promise<boolean> {
    const liveSession = this.dependencies.registry.getLive(appSessionId);
    if (delivery && (!liveSession || !this.canReceiveReport(liveSession) || !isCurrent())) {
      delivery.declined('stale');
      return false;
    }
    if (!liveSession || liveSession.closeMode) return false;
    if (!liveSession.streaming && !liveSession.compacting && !liveSession.autoCompacting)
      return false;
    const steerId = randomUUID();
    const prompt = { ...sessionPrompt(text, undefined, steerId), isCurrent, delivery };
    // Reports stay with their sender while the chat is unavailable; they never
    // resume a runtime or join a typed prompt's relaunch queue.
    const admitted = delivery
      ? { liveSession, stops: this.stopCount(appSessionId) }
      : await this.admitPrompt(appSessionId, prompt);
    if (admitted === 'held') return true;
    if (!admitted) return false;
    // A Stop or the caller's guard can change between admission and this line.
    if (this.stopCount(appSessionId) !== admitted.stops || !isCurrent()) {
      delivery?.declined('stale');
      return false;
    }
    if (now && !delivery) {
      // A runtime replaced during admission would carry the prompt off with it.
      if (this.dependencies.registry.getLive(appSessionId) !== admitted.liveSession) return false;
      admitted.liveSession.pendingSends.push(prompt);
      this.updateQueuedSends(admitted.liveSession);
      // Not awaited: a turn that ended meanwhile runs this one at once, and the
      // caller may be the chat that turn needs an answer from.
      void this.sendNow(appSessionId, steerId).catch((error: unknown) => {
        this.dependencies.emitError({ appSessionId, message: errMsg(error) });
      });
      return true;
    }
    void this.handOver(appSessionId, admitted, prompt).catch((error: unknown) => {
      if (!this.dependencies.isShutdownStarted())
        this.dependencies.emitError({ appSessionId, message: errMsg(error) });
    });
    return true;
  }

  async send(
    requestedAppSessionId: string,
    text: string,
    mentions?: ProviderMention[],
    steerId?: string,
  ): Promise<void> {
    await this.sendPrompt(requestedAppSessionId, sessionPrompt(text, mentions, steerId));
  }

  // A redelivered prompt keeps what it was sent with, so one nobody typed is
  // still drawn when it finally runs.
  private async sendPrompt(requestedAppSessionId: string, prompt: SessionPrompt): Promise<void> {
    const admitted = await this.admitPrompt(requestedAppSessionId, prompt);
    if (!admitted || admitted === 'held') return;
    // A Stop can land between admission and this line.
    if (this.stopCount(requestedAppSessionId) !== admitted.stops) return;
    this.dependencies.onUserPrompt?.(requestedAppSessionId);
    await this.handOver(requestedAppSessionId, admitted, prompt);
  }

  // Gives an admitted prompt to the chat: into the running turn, behind it, or
  // as the next turn.
  private async handOver(
    requestedAppSessionId: string,
    admitted: AdmittedPrompt,
    prompt: SessionPrompt,
  ): Promise<void> {
    const { liveSession } = admitted;
    if (prompt.steerId) {
      if ((await this.steer(liveSession, prompt)) || prompt.delivery) return;
      // A Stop, a new runtime, or its sender withdrawing it since it was sent
      // takes it back.
      if (
        this.stopCount(requestedAppSessionId) !== admitted.stops ||
        this.dependencies.registry.getLive(liveSession.summary.appSessionId) !== liveSession ||
        isWithdrawn(prompt)
      )
        return;
    }
    // A steer the turn could not take goes on as an ordinary message: behind
    // the turn, or as the next turn if this one settled meanwhile.
    if (liveSession.streaming || liveSession.compacting || liveSession.autoCompacting) {
      liveSession.pendingSends.push(prompt);
      this.updateQueuedSends(liveSession);
      return;
    }
    await this.drive(liveSession.summary.appSessionId, prompt);
  }

  // Reports settle at handoff and never enter the typed-message queues.
  private async steer(liveSession: LiveSession, prompt: SessionPrompt): Promise<boolean> {
    const appSessionId = liveSession.summary.appSessionId;
    const session = liveSession.session;
    const steerId = prompt.steerId;
    const stops = this.stopCount(appSessionId);
    const turn = liveSession.turnPromise;
    const delegatedTurns = liveSession.delegatedTurns;
    const isCurrent = () =>
      this.dependencies.registry.getLive(appSessionId) === liveSession &&
      liveSession.session === session &&
      liveSession.turnPromise === turn &&
      liveSession.delegatedTurns === delegatedTurns &&
      this.stopCount(appSessionId) === stops &&
      !isWithdrawn(prompt);
    if (
      !steerId ||
      !isCurrent() ||
      !liveSession.streaming ||
      liveSession.compacting ||
      liveSession.autoCompacting ||
      liveSession.interrupting ||
      liveSession.interruptingToSend ||
      (prompt.delivery && !this.canReceiveReport(liveSession))
    ) {
      prompt.delivery?.declined('stale');
      return false;
    }
    if (!prompt.delivery) {
      liveSession.steers.push(prompt);
      this.updateQueuedSends(liveSession);
    }
    let outcome: SteerOutcome;
    prompt.delivery?.accepted();
    try {
      outcome = await session.steer(prompt.text, prompt.mentions, steerId);
    } catch {
      outcome = prompt.delivery ? 'unconfirmed' : false;
    }
    if (outcome === false && prompt.delivery) {
      prompt.delivery.declined('refused');
      return true;
    }
    // Compaction can replace the provider while this live session still owns the steer.
    if (this.dependencies.registry.getLive(appSessionId) !== liveSession) return true;
    const held = removePrompt(liveSession.steers, prompt);
    if (outcome === false) {
      if (liveSession.pendingSends.includes(prompt)) {
        this.updateQueuedSends(liveSession);
        return true;
      }
      return !held;
    }
    if (prompt.delivery && !isCurrent()) return true;
    if (this.stopCount(appSessionId) !== stops || isWithdrawn(prompt)) return true;
    // Send now may have queued it again just as the harness delivered it. It
    // leaves the queue at once, so a turn settling while the row is written
    // cannot send it a second time; the list is published after the row, since
    // the chat drops its pending bubble once the steer leaves it.
    removePrompt(liveSession.pendingSends, prompt);
    this.rememberSteerOutcome(
      liveSession,
      prompt,
      outcome === 'withdrawn' ? 'withdrawn' : 'delivered',
    );
    if (outcome === true) prompt.delivery?.acknowledged?.();
    if (outcome !== 'withdrawn')
      await this.dependencies.appendSteer(appSessionId, prompt.text, steerId);
    if (
      prompt.delivery
        ? isCurrent()
        : this.dependencies.registry.getLive(appSessionId) === liveSession
    )
      this.updateQueuedSends(liveSession);
    return true;
  }

  // Resolves to the prompt's full text once the model can no longer see it,
  // so a window that no longer holds the draft can still give it back whole.
  async withdrawSteer(
    appSessionId: string,
    steerId: string,
  ): Promise<Pick<SessionPrompt, 'text' | 'mentions'> | undefined> {
    const liveSession = this.dependencies.registry.getLive(appSessionId);
    if (!liveSession) return undefined;
    const prompt = [...liveSession.steers, ...liveSession.pendingSends].find(
      (pending) => pending.steerId === steerId,
    );
    if (!prompt) {
      const outcome = this.steerOutcomes.get(liveSession)?.get(steerId);
      return outcome === 'delivered' ? undefined : outcome;
    }
    if (!liveSession.steers.includes(prompt)) {
      removePrompt(liveSession.pendingSends, prompt);
      this.rememberSteerOutcome(liveSession, prompt, 'withdrawn');
      this.updateQueuedSends(liveSession);
      return prompt;
    }
    const session = liveSession.session;
    if (!session.withdrawSteer) return undefined;
    const withdrawn = await session.withdrawSteer(steerId).catch(() => false);
    if (!withdrawn) return undefined;
    // Harness confirmation reclaims this prompt even if its runtime closed meanwhile.
    this.rememberSteerOutcome(liveSession, prompt, 'withdrawn');
    return prompt;
  }

  // A lost bridge answer can be requested again without guessing from the pending list.
  private rememberSteerOutcome(
    liveSession: LiveSession,
    prompt: SessionPrompt,
    outcome: 'withdrawn' | 'delivered',
  ): void {
    if (prompt.delivery || !prompt.steerId) return;
    let outcomes = this.steerOutcomes.get(liveSession);
    if (!outcomes) {
      outcomes = new Map();
      this.steerOutcomes.set(liveSession, outcomes);
    }
    outcomes.delete(prompt.steerId);
    outcomes.set(
      prompt.steerId,
      outcome === 'withdrawn'
        ? { text: prompt.text, ...(prompt.mentions ? { mentions: prompt.mentions } : {}) }
        : 'delivered',
    );
    if (outcomes.size > MAX_RECENT_STEER_OUTCOMES) {
      const oldest = outcomes.keys().next().value;
      if (oldest !== undefined) outcomes.delete(oldest);
    }
  }

  // Stops the running turn so this steer runs next. The interrupt drops every
  // steer the harness has not delivered, so the rest of the queue follows it
  // in the order it was sent. A steer the model already took in has nothing
  // left to send.
  async sendNow(appSessionId: string, steerId: string): Promise<void> {
    const liveSession = this.dependencies.registry.getLive(appSessionId);
    if (!liveSession || !steerId) return;
    const prompt = [...liveSession.steers, ...liveSession.pendingSends].find(
      (pending) => pending.steerId === steerId,
    );
    if (!prompt) return;
    // Keep harness ownership until its delivery/cancellation settles, even
    // while Send now also puts the prompt on the app's queue.
    const rest = [...new Set([...liveSession.steers, ...liveSession.pendingSends])]
      .filter((pending) => pending !== prompt)
      .sort((a, b) => a.order - b.order);
    liveSession.pendingSends = [prompt, ...rest];
    this.updateQueuedSends(liveSession);
    // Compaction is never cut short, and an interrupt already in flight sends
    // the front of the queue when the turn it stops settles.
    if (
      liveSession.compacting ||
      liveSession.autoCompacting ||
      liveSession.interrupting ||
      liveSession.interruptingToSend
    )
      return;
    // Nothing to stop: it runs now, as a send to an idle chat does.
    if (!liveSession.streaming) {
      liveSession.pendingSends.shift();
      this.updateQueuedSends(liveSession);
      await this.drive(appSessionId, prompt);
      return;
    }
    liveSession.interruptingToSend = true;
    this.dependencies.appendProgress(appSessionId, 'Stopping the turn to send now...');
    // A refusal is reported first, so the turn settling after it sees it.
    const interrupt = liveSession.session.interrupt().catch((error: unknown) => {
      liveSession.interruptingToSend = false;
      this.dependencies.emitError({
        code: 'session.send_now_failed',
        appSessionId,
        message: `Could not stop the turn to send now: ${errMsg(error)}`,
      });
    });
    // Capped, like the settlement that waits on it, so a harness that never
    // answers cannot hold the command either.
    const settled = new Promise<void>((resolve) => {
      setTimeout(resolve, SEND_NOW_INTERRUPT_WAIT_MS).unref();
      void interrupt.then(resolve);
    });
    liveSession.sendNowInterrupt = settled;
    await settled;
    if (liveSession.sendNowInterrupt === settled) liveSession.sendNowInterrupt = undefined;
  }

  // Where a prompt the user sent goes: the live session to send it to, 'held'
  // when it now waits for a chat that is relaunching, or nowhere, because a
  // Stop or its sender took it back or the chat could not take it. A relaunch
  // can begin while the send is being prepared. The caller checks the Stop
  // count again once this resolves.
  private async admitPrompt(
    id: string,
    prompt: SessionPrompt,
  ): Promise<AdmittedPrompt | 'held' | undefined> {
    if (this.waitForRelaunch(id, prompt)) return 'held';
    const stops = this.stopCount(id);
    const liveSession = await this.prepareToSend(id);
    if (this.stopCount(id) !== stops || isWithdrawn(prompt)) return undefined;
    if (!liveSession) {
      if (this.waitForRelaunch(id, prompt)) return 'held';
      return undefined;
    }
    return { liveSession, stops };
  }

  // Acceptance transfers the wave to the background-turn error owner. Compaction
  // defers acceptance; an ordinary active/queued turn already carries the results.
  wakeForSettledAgents(appSessionId: string, prompt: string, notice: string): boolean {
    const liveSession = this.dependencies.registry.getLive(appSessionId);
    if (!liveSession || liveSession.closeMode || this.dependencies.isShutdownStarted())
      return false;
    if (liveSession.interrupting || liveSession.interruptingToSend) return false;
    if (liveSession.compacting || liveSession.autoCompacting) return false;
    if (liveSession.summary.sessionPurpose === 'mission-control') return true;
    if (liveSession.streaming || liveSession.pendingSends.length > 0) return true;
    void this.driveInBackground(liveSession.summary.appSessionId, {
      ...sessionPrompt(prompt),
      notice,
    });
    return true;
  }

  async interrupt(requestedAppSessionId: string): Promise<void> {
    this.noteStop(requestedAppSessionId);
    this.relaunches.get(this.chatKey(requestedAppSessionId))?.waiting.splice(0);
    const liveSession = this.dependencies.registry.getLive(requestedAppSessionId);
    if (!liveSession) return;
    const appSessionId = liveSession.summary.appSessionId;
    // The harness drops the steers it holds when the turn stops.
    liveSession.pendingSends = [];
    liveSession.steers = [];
    if (liveSession.compacting) {
      // Clearing the queue mid-compaction is bookkeeping, not activity.
      this.dependencies.registry.updateSummary(appSessionId, queueSummary(liveSession), {
        touchActivity: false,
      });
      return;
    }
    const wasAutoCompacting = liveSession.autoCompacting;
    const compactionTarget = this.primaryAutomaticCompactionTarget(liveSession);
    const session = liveSession.session;
    const turn = liveSession.turnPromise;
    const isCurrent = () =>
      !this.dependencies.isShutdownStarted() &&
      this.dependencies.registry.getLive(appSessionId) === liveSession &&
      !liveSession.closeMode &&
      liveSession.session === session;
    liveSession.interrupting = true;
    try {
      await liveSession.session.interrupt();
    } catch (error) {
      liveSession.interrupting = false;
      throw error;
    }
    if (!isCurrent()) {
      liveSession.interrupting = false;
      return;
    }
    if (wasAutoCompacting && compactionTarget) {
      this.dependencies.compaction.cancel(compactionTarget);
    }
    // A turn started while the receipt was on its way is not the one this Stop stopped.
    if (liveSession.turnPromise && liveSession.turnPromise !== turn) {
      this.dependencies.registry.updateSummary(appSessionId, queueSummary(liveSession));
      return;
    }
    if (!liveSession.streaming) liveSession.interrupting = false;
    this.dependencies.registry.updateSummary(appSessionId, {
      phase: 'paused',
      streaming: false,
      ...queueSummary(liveSession),
    });
    // A wave that finished during the Stop was held back; the Stop is over.
    if (!liveSession.interrupting) this.dependencies.childSessions.retryAgentWave(appSessionId);
  }

  async settleAfterCompaction(
    appSessionId: string,
    previousLiveSession?: LiveSession,
  ): Promise<void> {
    if (this.dependencies.isShutdownStarted()) return;
    const liveSession = this.dependencies.registry.getLive(appSessionId);
    if (!liveSession) {
      if (previousLiveSession && previousLiveSession.closeMode !== 'discard-pending') {
        const queued = previousLiveSession.pendingSends.splice(0);
        await this.redeliverQueuedSends(appSessionId, queued);
      }
      return;
    }
    if (liveSession.closeMode) return;
    this.dependencies.childSessions.retryAgentWave(appSessionId);
    if (liveSession.streaming || liveSession.compacting || liveSession.autoCompacting) return;
    const next = liveSession.pendingSends.shift();
    if (next === undefined) {
      this.dependencies.onSessionAvailable?.(appSessionId);
      return;
    }
    this.updateQueuedSends(liveSession);
    await this.drive(liveSession.summary.appSessionId, next);
  }

  async close(requestedId: string, mode: SessionCloseMode = 'discard-pending'): Promise<void> {
    // A resume in flight is filed under the chat's own id.
    const appSessionId = this.chatKey(requestedId);
    // Closing a chat for good takes back whatever was about to be sent to it.
    if (mode === 'discard-pending') {
      this.noteStop(appSessionId);
      const relaunch = this.relaunches.get(appSessionId);
      this.relaunches.delete(appSessionId);
      relaunch?.waiting.splice(0);
    }
    const pendingResume = this.resumeOperations.get(appSessionId);
    if (pendingResume) this.canceledResumes.add(appSessionId);
    if (mode === 'discard-pending' && this.forkOpens.has(appSessionId))
      this.forkOpens.set(appSessionId, 'closed');
    const liveSession = this.dependencies.registry.getLive(appSessionId);
    if (!liveSession) {
      await pendingResume;
      return;
    }
    const operation = this.beginClose(liveSession, mode);
    if (operation.created || operation.deferred.retryTimer) await this.finishClose(liveSession);
    await operation.deferred.promise;
  }

  private beginClose(liveSession: LiveSession, mode: SessionCloseMode): CloseOperation {
    if (mode === 'discard-pending') {
      liveSession.closeMode = mode;
      liveSession.pendingSends = [];
      liveSession.steers = [];
    } else {
      liveSession.closeMode ??= mode;
    }
    const existing = this.deferredCloses.get(liveSession);
    if (existing) return { deferred: existing, created: false };

    let resolve = (): void => undefined;
    let reject = (error: unknown): void => {
      void error;
    };
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const deferred = { promise, resolve, reject, started: false };
    this.deferredCloses.set(liveSession, deferred);
    liveSession.closePromise = promise;
    return { deferred, created: true };
  }

  private async finishClose(liveSession: LiveSession): Promise<void> {
    const deferred = this.deferredCloses.get(liveSession);
    if (!deferred || deferred.started) return;
    clearTimeout(deferred.retryTimer);
    deferred.started = true;
    try {
      await this.closeSessionResources(liveSession);
      deferred.resolve();
    } catch (error) {
      if (this.dependencies.registry.getLive(liveSession.summary.appSessionId) === liveSession) {
        if (deferred.retryOnFailure && !this.dependencies.isShutdownStarted()) {
          if (!deferred.retryTimer) console.warn(`Session cleanup deferred: ${errMsg(error)}`);
          deferred.started = false;
          deferred.retryTimer = setTimeout(() => {
            void this.finishClose(liveSession);
          }, 5000);
          deferred.retryTimer.unref();
          return;
        }
        liveSession.closeMode = undefined;
        liveSession.closePromise = undefined;
      }
      deferred.reject(error);
    } finally {
      if (deferred.started) this.deferredCloses.delete(liveSession);
    }
  }

  private async closeSessionResources(liveSession: LiveSession): Promise<void> {
    const d = this.dependencies;
    const closedProviderSessionId = liveSession.session.providerSessionId;
    let firstError: unknown;
    const run = async (action: () => void | Promise<void>): Promise<void> => {
      try {
        await action();
      } catch (error) {
        firstError ??= error;
      }
    };

    await run(() => d.stopVoiceSession(liveSession.summary.appSessionId));

    // First, while every provider process of this session is still alive and
    // still the parent of what it spawned: the dev servers are descendants of
    // `droid`, and once it exits they are reparented to launchd and no longer
    // reachable from its pid. Child runtimes are tracked under this same
    // session id, so this takes their servers too.
    await d.agentProcesses.killSession(liveSession.summary.appSessionId);
    await run(() => d.childSessions.closeParent(liveSession.summary.appSessionId));
    await run(() => {
      d.context.stopSession(liveSession);
    });
    await run(() => {
      const compactionTarget = this.primaryAutomaticCompactionTarget(liveSession);
      if (compactionTarget) d.compaction.cancel(compactionTarget);
    });
    await run(() => {
      d.compaction.forgetSession(liveSession.summary.appSessionId);
    });
    await run(() => {
      liveSession.unsubscribe?.();
      liveSession.catalogUnsubscribe?.();
    });
    for (const server of liveSession.mcpServers) {
      await run(() => server.close());
    }
    const untrack = this.untrackProviderProcess(
      liveSession.summary.appSessionId,
      liveSession.session,
    );
    await run(() => liveSession.session.close());
    untrack?.();
    await run(() => d.closeBrowserSession(liveSession.summary.appSessionId));
    await run(() => {
      d.context.forgetSession(liveSession);
    });
    let unregistered: LiveSession | undefined;
    try {
      await d.forgetProviderTranscript(liveSession.summary.appSessionId);
      if (d.registry.getLive(liveSession.summary.appSessionId) === liveSession) {
        unregistered = await d.registry.unregister(liveSession.summary.appSessionId);
      }
    } catch (error) {
      firstError ??= error;
    }
    if (unregistered) {
      await run(() => {
        d.forgetMissionControl(liveSession.summary.appSessionId);
      });
      await run(() => {
        d.forgetPendingSettings(liveSession.summary.appSessionId);
      });
      d.emit({ type: 'session.closed', appSessionId: liveSession.summary.appSessionId });
      await run(() => {
        d.forgetInteractions(liveSession.summary.appSessionId);
      });
      await run(() => {
        d.forgetEventFlow(liveSession.summary.appSessionId);
      });
    }
    await run(() => d.emitSessionList(closedProviderSessionId));
    if (firstError !== undefined) throw errorFromUnknown(firstError);
  }

  async closeAll(): Promise<void> {
    this.forkOpens.clear();
    if (this.dependencies.isShutdownStarted()) {
      for (const liveSession of this.dependencies.registry.liveSessionsSnapshot())
        clearTimeout(this.deferredCloses.get(liveSession)?.retryTimer);
    }
    // One concurrent kill pass before the serialized closes. Each close kills
    // its own processes too (idempotent, and the only owner when a single
    // session closes), but paying the kill grace one session at a time would
    // overrun the sidecar's force-exit budget and leave the last session's
    // dev server running — and its history unflushed.
    const live = this.dependencies.registry
      .liveSessionsSnapshot()
      .map((liveSession) => liveSession.summary.appSessionId);
    const killed = await Promise.allSettled(
      live.map((id) => this.dependencies.agentProcesses.killSession(id)),
    );
    const failed = new Set(live.filter((_id, index) => killed[index].status === 'rejected'));
    let firstError: unknown = killed.find((result) => result.status === 'rejected')?.reason;
    // Re-read: the kill pass awaited, so the live set may have moved.
    const scheduled = this.dependencies.registry
      .liveSessionsSnapshot()
      .filter((liveSession) => !failed.has(liveSession.summary.appSessionId))
      .map((liveSession) => ({
        liveSession,
        close: this.beginClose(liveSession, 'discard-pending'),
      }));
    for (const { liveSession, close } of scheduled) {
      if (close.created || close.deferred.retryTimer) await this.finishClose(liveSession);
      try {
        await close.deferred.promise;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw errorFromUnknown(firstError);
  }

  // Every live provider process of a session must be a tracked root, so the
  // monitor can find (and later kill) whatever that process spawns.
  private trackProviderProcess(
    appSessionId: string,
    session: ProviderSession,
    mcpConfigs: readonly McpServerConfig[],
  ): void {
    const d = this.dependencies;
    // Before the first scan, so a configured MCP server never reaches the chip.
    d.agentProcesses.setIgnoredCommands(appSessionId, stdioMcpCommandLines(mcpConfigs));
    const process = session.process;
    if (process) d.agentProcesses.track(appSessionId, process.pid, () => process.isAlive());
  }

  // The pid has to be read while the session still holds it, but released only
  // after it closes, so this hands back the release for the caller to run then.
  private untrackProviderProcess(
    appSessionId: string,
    session: ProviderSession,
  ): (() => void) | undefined {
    const processId = session.process?.pid;
    if (processId === undefined) return undefined;
    return () => {
      this.dependencies.agentProcesses.untrack(processId, appSessionId);
    };
  }

  private requireOpenAdmission(): void {
    if (this.dependencies.isShutdownStarted()) throw new OpenAdmissionClosedError();
  }

  // Context stats and compaction are Droid's own; a session on any other
  // provider has no target and every caller skips that work.
  private primaryContextTarget(liveSession: LiveSession): LiveOperationTarget | undefined {
    const d = this.dependencies;
    const droid = liveSession.droid;
    if (!droid) return undefined;
    const appSessionId = liveSession.summary.appSessionId;
    const session = liveSession.session;
    return {
      appSessionId,
      providerSessionId: session.providerSessionId,
      sourceSessionId: appSessionId,
      session: droid,
      isCurrent: () =>
        !d.isShutdownStarted() &&
        d.registry.getLive(appSessionId) === liveSession &&
        !liveSession.closeMode &&
        liveSession.session === session,
    };
  }

  private primaryAutomaticCompactionTarget(
    liveSession: LiveSession,
  ): PrimaryAutomaticCompactionTarget | undefined {
    const target = this.primaryContextTarget(liveSession);
    return target ? { ...target, kind: 'primary', liveSession } : undefined;
  }

  private subscribeAutomaticCompaction(liveSession: LiveSession): void {
    const target = this.primaryAutomaticCompactionTarget(liveSession);
    if (target) this.dependencies.compaction.subscribePrimary(target);
  }

  private subscribeBackgroundEvents(liveSession: LiveSession): void {
    const appSessionId = liveSession.summary.appSessionId;
    const session = liveSession.session;
    let resolveDelegatedTurn: (() => void) | undefined;
    let usageLimitAtStart: SessionSummary['usageLimit'];
    const releaseDelegatedTurn = () => {
      if (liveSession.session === session) liveSession.delegatedTurnSettled = undefined;
      resolveDelegatedTurn?.();
    };
    void session.closed?.then(releaseDelegatedTurn);
    const isCurrent = () =>
      !this.dependencies.isShutdownStarted() &&
      !liveSession.closeMode &&
      liveSession.session === session &&
      this.dependencies.registry.getLive(appSessionId) === liveSession;
    const events = session.onBackgroundEvent?.((normalized) => {
      if (!isCurrent()) return;
      this.dependencies.eventFlow.apply(appSessionId, appSessionId, 'primary', normalized);
    });
    // A turn the provider started by itself is the session's turn like any
    // other: it streams, it can be stopped, and a typed prompt waits behind it.
    const delegated = session.onDelegatedTurn?.((running, end) => {
      if (!isCurrent()) return;
      if (running) {
        liveSession.streaming = true;
        liveSession.delegatedTurns = (liveSession.delegatedTurns ?? 0) + 1;
        liveSession.delegatedTurnOpen = true;
        usageLimitAtStart = liveSession.summary.usageLimit;
        resolveDelegatedTurn?.();
        liveSession.delegatedTurnSettled = new Promise<void>((resolve) => {
          resolveDelegatedTurn = resolve;
        });
        // A settled turn leaves the chat's own source closed, and nothing else
        // reopens it for a turn the provider started: without this the spoken
        // request's work is dropped as post-turn noise.
        this.dependencies.eventFlow.beginTurn(appSessionId, appSessionId);
        this.dependencies.registry.updateSummary(appSessionId, {
          phase: 'running',
          streaming: true,
          ...queueSummary(liveSession),
        });
        return;
      }
      liveSession.delegatedTurnOpen = false;
      // Its rows are all in: anything later is noise, as after a typed turn's
      // end. A typed turn still draining its rows closes the source itself.
      if (!liveSession.turnPromise)
        this.dependencies.eventFlow.apply(appSessionId, appSessionId, 'primary', { done: true });
      // The chat stays busy until the turn's last words are written, so what
      // reads its reply as it settles (a project report) has them, and until
      // Send now's interrupt settles, so nothing new starts under it.
      const turn = liveSession.delegatedTurns;
      const resolve = resolveDelegatedTurn;
      const reservation = liveSession.delegatedTurnSettled;
      const usageLimit = usageLimitAtStart;
      void this.dependencies
        .settleStreaming(appSessionId, appSessionId)
        .then(
          () => this.afterDelegatedFlush(liveSession, turn, isCurrent, end, usageLimit),
          (error: unknown) => {
            if (!isCurrent()) return;
            this.dependencies.emitError({
              appSessionId,
              message: `Could not settle the session transcript: ${errMsg(error)}`,
            });
            // A reply that was not written did not complete, as for a typed turn.
            const failed = error instanceof Error ? error : new Error(errMsg(error));
            return this.afterDelegatedFlush(
              liveSession,
              turn,
              isCurrent,
              end?.status === 'completed' ? { status: 'failed', error: failed } : end,
              usageLimit,
            );
          },
        )
        .catch((error: unknown) => {
          this.dependencies.emitError({ appSessionId, message: errMsg(error) });
        })
        .finally(() => {
          // Released however the settle ended, so a waiting typed turn never spins.
          if (liveSession.delegatedTurnSettled === reservation)
            liveSession.delegatedTurnSettled = undefined;
          resolve?.();
        });
    });
    if (events ?? delegated)
      liveSession.unsubscribe = () => {
        events?.();
        delegated?.();
        releaseDelegatedTurn();
      };
  }

  // Send now can begin while the transcript flushes, so its interrupt is read
  // only once the flush is done.
  private async afterDelegatedFlush(
    liveSession: LiveSession,
    turn: number | undefined,
    isCurrent: () => boolean,
    end: DelegatedTurnEnd | undefined,
    usageLimitAtStart: SessionSummary['usageLimit'],
  ): Promise<void> {
    if (liveSession.sendNowInterrupt) await liveSession.sendNowInterrupt;
    if (!isCurrent()) return;
    if (liveSession.delegatedTurns === turn) {
      liveSession.delegatedTurnSettled = undefined;
      this.settleDelegatedTurn(liveSession, end, usageLimitAtStart);
    }
    // A newer turn owns the chat now, but a refusal still holds it.
    else if (end?.status === 'failed' && end.error instanceof UsageLimitError)
      this.holdOnRefusal(liveSession, end.error);
  }

  private holdOnRefusal(liveSession: LiveSession, refusal: UsageLimitError): void {
    const appSessionId = liveSession.summary.appSessionId;
    this.dependencies.registry.updateSummary(appSessionId, failedTurnSummary(refusal));
    // A refusal leaves no row of its own; the typed path writes this notice too.
    // A notice that cannot be written must not leave the turn unsettled.
    try {
      this.dependencies.appendError(appSessionId, refusal.message, usageLimitDetails(refusal));
    } catch (error) {
      this.dependencies.emitError({ appSessionId, message: errMsg(error) });
    }
  }

  private settleDelegatedTurn(
    liveSession: LiveSession,
    end: DelegatedTurnEnd | undefined,
    usageLimitAtStart: SessionSummary['usageLimit'],
  ): void {
    const appSessionId = liveSession.summary.appSessionId;
    // A Stop lands before the turn reports itself finished, so the flags it
    // set are cleared here as they are for a typed turn.
    const stopped = liveSession.interrupting === true || liveSession.interruptingToSend === true;
    // A finished reply can lift an existing hold, but never a refusal that
    // arrived while it ran, including from an overlapping typed turn. Writing
    // the outcome can fail; the chat still settles below.
    try {
      if (end?.status === 'failed') {
        if (end.error instanceof UsageLimitError) this.holdOnRefusal(liveSession, end.error);
        else this.dependencies.registry.updateSummary(appSessionId, failedTurnSummary(end.error));
      } else if (
        end?.status === 'completed' &&
        !stopped &&
        liveSession.summary.usageLimit === usageLimitAtStart &&
        liveSession.summary.usageLimit
      )
        this.dependencies.registry.updateSummary(appSessionId, { usageLimit: undefined });
    } catch (error) {
      this.dependencies.emitError({ appSessionId, message: errMsg(error) });
    }
    // A typed turn still preparing or draining keeps the queue reserved.
    if (liveSession.turnPromise) return;
    liveSession.streaming = false;
    liveSession.interrupting = false;
    liveSession.interruptingToSend = false;
    this.publishTurnSettled(liveSession);
    if (stopped) this.dependencies.childSessions.retryAgentWave(appSessionId);
    // A runtime that has gone takes the queue with it through the close
    // path, which reopens and redelivers. Taking a prompt off it here would
    // spend it on a client that cannot run it.
    if (liveSession.session.isClosed) return;
    const next = liveSession.pendingSends.shift();
    if (next !== undefined) void this.driveInBackground(appSessionId, next);
  }

  private observeProviderClosure(liveSession: LiveSession): void {
    const d = this.dependencies;
    const session = liveSession.session;
    const appSessionId = liveSession.summary.appSessionId;
    const isCurrent = () =>
      !d.isShutdownStarted() &&
      d.registry.getLive(appSessionId) === liveSession &&
      liveSession.session === session &&
      !liveSession.closeMode;
    const closeAfterTurn = async (error: Error | undefined): Promise<void> => {
      const turn = liveSession.turnPromise;
      // The turn owns its diagnostic and transcript settlement. Wait for it
      // without taking over its error handling before releasing the runtime.
      if (turn) await turn.catch(() => undefined);
      if (!isCurrent()) return;
      // No turn owned this failure, so the chat would otherwise keep no record
      // of the runtime dying: leave the same row a failed turn leaves.
      if (error && !turn) {
        d.appendError(appSessionId, error.message);
        d.emitError({ appSessionId, message: error.message });
      }
      const { deferred } = this.beginClose(liveSession, 'preserve-pending');
      // Keep ownership until cleanup succeeds; sends must not reuse a dead runtime.
      deferred.retryOnFailure = true;
      await this.finishClose(liveSession);
      await deferred.promise;
    };
    void session.closed
      ?.then((error) => {
        if (!isCurrent()) return;
        liveSession.providerClosePromise = closeAfterTurn(error).finally(() => {
          liveSession.providerClosePromise = undefined;
        });
        return liveSession.providerClosePromise;
      })
      .catch((error: unknown) => {
        d.emitError({ appSessionId, message: `Could not release session: ${errMsg(error)}` });
      });
  }

  private refreshContext(liveSession: LiveSession): void {
    const target = this.primaryContextTarget(liveSession);
    if (target) void this.dependencies.context.refresh(target);
  }

  private async prepareToSend(appSessionId: string): Promise<LiveSession | undefined> {
    let liveSession = this.dependencies.registry.getLive(appSessionId);
    // A send that lands while the runtime is being released must wait for that
    // close and reopen, not vanish. Retirement makes this window reachable.
    const closing = liveSession?.providerClosePromise ?? liveSession?.closePromise;
    if (closing) {
      await closing;
      if (this.dependencies.isShutdownStarted()) return undefined;
      liveSession = this.dependencies.registry.getLive(appSessionId);
    }
    if (!liveSession) {
      const resumed = await this.resume(appSessionId);
      if (!resumed) return undefined;
      liveSession = this.dependencies.registry.getLive(appSessionId);
    }
    if (liveSession?.closeMode) return undefined;
    if (!liveSession) {
      const message = `Session ${appSessionId} is not resumable`;
      this.dependencies.emitError({ appSessionId, message });
      return undefined;
    }
    if (liveSession.streaming && liveSession.summary.provider === 'claude') return liveSession;
    const settingsApplied = await this.dependencies.applyPendingSessionSettings(
      liveSession.summary.appSessionId,
    );
    return settingsApplied && !liveSession.closeMode ? liveSession : undefined;
  }

  private async cleanupFailedOpen(
    mcpServers: LocalMcpResource[],
    session: ProviderSession | undefined,
    liveSession: LiveSession | undefined,
  ): Promise<void> {
    if (
      liveSession &&
      this.dependencies.registry.getLive(liveSession.summary.appSessionId) === liveSession
    ) {
      const { deferred } = this.beginClose(liveSession, 'discard-pending');
      deferred.retryOnFailure = true;
      void deferred.promise.catch((error: unknown) => {
        console.warn(`Failed-open provider cleanup failed: ${errMsg(error)}`);
      });
      await this.finishClose(liveSession);
      return;
    }
    if (liveSession) {
      liveSession.closeMode = 'discard-pending';
      try {
        await this.dependencies.agentProcesses.killSession(liveSession.summary.appSessionId);
      } catch (error) {
        liveSession.closeMode = undefined;
        console.warn(`Failed-open provider cleanup deferred: ${errMsg(error)}`);
        return;
      }
    }
    liveSession?.unsubscribe?.();
    liveSession?.catalogUnsubscribe?.();
    if (liveSession)
      await runBestEffortAsync(() =>
        this.dependencies.childSessions.closeParent(liveSession.summary.appSessionId),
      );
    if (liveSession) this.dependencies.compaction.forgetSession(liveSession.summary.appSessionId);
    await Promise.all(mcpServers.map((server) => runBestEffortAsync(() => server.close())));
    if (session) {
      const untrack = liveSession
        ? this.untrackProviderProcess(liveSession.summary.appSessionId, session)
        : undefined;
      await runBestEffortAsync(() => session.close());
      untrack?.();
    }
    if (
      liveSession &&
      this.dependencies.registry.getLive(liveSession.summary.appSessionId) === liveSession
    ) {
      this.dependencies.context.forgetSession(liveSession);
      if (await this.dependencies.registry.unregister(liveSession.summary.appSessionId)) {
        this.dependencies.forgetInteractions(liveSession.summary.appSessionId);
        this.dependencies.forgetEventFlow(liveSession.summary.appSessionId);
        await this.dependencies.forgetProviderTranscript(liveSession.summary.appSessionId);
        this.dependencies.forgetMissionControl(liveSession.summary.appSessionId);
        this.dependencies.forgetPendingSettings(liveSession.summary.appSessionId);
      }
    }
  }

  private async drive(
    appSessionId: string,
    prompt: SessionPrompt,
    delivery?: ScheduledTurnDelivery,
  ): Promise<void> {
    const d = this.dependencies;
    const stops = this.stopCount(appSessionId);
    const liveSession = d.registry.getLive(appSessionId);
    if (!liveSession || d.isShutdownStarted()) {
      delivery?.declined('stale');
      return;
    }
    if (liveSession.summary.provider === 'claude' && !liveSession.closeMode) {
      await d.waitForSettingsMutations?.(appSessionId);
      if (d.isShutdownStarted() || this.stopCount(appSessionId) !== stops) {
        delivery?.declined('stale');
        return;
      }
    }
    if (d.registry.getLive(appSessionId) !== liveSession || liveSession.closeMode) {
      delivery?.declined('stale');
      // The runtime was released under this send. A prompt the user typed
      // reopens the chat, as a send to any released chat does.
      if (liveSession.closeMode === 'preserve-pending' && !delivery && !prompt.notice)
        await this.sendPrompt(appSessionId, prompt);
      return;
    }
    if (liveSession.streaming) {
      // Scheduled work keeps its receipt and cancellation guard outside the user queue.
      if (delivery) {
        delivery.declined('stale');
        return;
      }
      liveSession.pendingSends.push(prompt);
      this.updateQueuedSends(liveSession);
      return;
    }
    // Its sender withdrew it while it waited, so what was queued behind it runs instead.
    if (isWithdrawn(prompt)) {
      delivery?.declined('stale');
      const next = liveSession.pendingSends.shift();
      if (next === undefined) return;
      this.updateQueuedSends(liveSession);
      await this.drive(appSessionId, next);
      return;
    }
    // A scheduled prompt keeps the runtime it reserved; the new window waits
    // for the next message the user sends.
    if (liveSession.restartBeforeNextTurn && !delivery) {
      await this.relaunch(liveSession, prompt);
      return;
    }
    await this.runTurn(liveSession, prompt, delivery);
  }

  // Marks the chat as streaming before it first yields, so a send that arrives
  // meanwhile queues behind this turn.
  private async runTurn(
    liveSession: LiveSession,
    prompt: SessionPrompt,
    delivery?: ScheduledTurnDelivery,
  ): Promise<void> {
    const d = this.dependencies;
    const stableAppSessionId = liveSession.summary.appSessionId;
    let turn: Promise<void> | undefined;
    try {
      this.rememberSteerOutcome(liveSession, prompt, 'delivered');
      liveSession.streaming = true;
      // Persist resumed activity immediately so the chat stays near the top
      // even if the app closes mid-turn. The renderer suppresses unread while
      // streaming; completion advances the timestamp again for review.
      d.registry.updateSummary(stableAppSessionId, {
        phase: liveSession.summary.sessionPurpose === 'mission-control' ? 'planning' : 'running',
        streaming: true,
        interruptReason: undefined,
        ...queueSummary(liveSession),
      });
      turn = liveSession.turnPromise = d.runPrimaryTurn(liveSession, {
        prompt: prompt.text,
        ...(prompt.mentions ? { mentions: prompt.mentions } : {}),
        ...(delivery ? { delivery } : {}),
        ...(prompt.notice ? { notice: prompt.notice } : {}),
        ...(prompt.steerId || prompt.announce ? { announce: true as const } : {}),
        ...(prompt.steerId ? { steerId: prompt.steerId } : {}),
        ...(prompt.isCurrent ? { stillAllowed: prompt.isCurrent } : {}),
      });
      await turn;
    } finally {
      delivery?.declined('unknown');
      // This turn's rows are all in. One the provider started meanwhile, and
      // still running, keeps the source open; one that ended left it to us,
      // unless the next typed turn it started already owns the source.
      if (
        d.registry.getLive(stableAppSessionId) === liveSession &&
        !liveSession.closeMode &&
        !d.isShutdownStarted() &&
        !liveSession.delegatedTurnOpen &&
        liveSession.turnPromise === turn
      )
        d.eventFlow.apply(stableAppSessionId, stableAppSessionId, 'primary', { done: true });
      if (liveSession.sendNowInterrupt) await liveSession.sendNowInterrupt;
      // Keep the reservation through the interrupt so delegated settlement cannot also drain.
      if (liveSession.turnPromise === turn) liveSession.turnPromise = undefined;
      // Only the last owner advances the queue, after both streams have flushed.
      if (!liveSession.delegatedTurnSettled && !liveSession.turnPromise)
        await this.settleTypedTurn(liveSession, stableAppSessionId);
    }
  }

  private async settleTypedTurn(liveSession: LiveSession, stableAppSessionId: string) {
    const d = this.dependencies;
    const stopped = liveSession.interrupting === true || liveSession.interruptingToSend === true;
    liveSession.interruptingToSend = false;
    liveSession.interrupting = false;
    liveSession.streaming = false;
    // A wave held back while the Stop was outstanding is owed once it is over.
    if (stopped) d.childSessions.retryAgentWave(stableAppSessionId);
    // Let the closure observer claim cleanup before advancing the queue.
    if (liveSession.session.isClosed) await liveSession.session.closed;
    if (liveSession.providerClosePromise) {
      if (d.registry.getLive(stableAppSessionId) === liveSession)
        this.publishTurnSettled(liveSession);
      // The closure observer reports cleanup failures; keep queued sends here
      // until the runtime can actually be released.
      await liveSession.providerClosePromise.catch(() => undefined);
    }
    if (d.isShutdownStarted() || liveSession.closeMode === 'discard-pending') {
      liveSession.pendingSends = [];
    } else if (d.registry.getLive(stableAppSessionId) !== liveSession) {
      const queued = liveSession.pendingSends.splice(0);
      if (queued.length > 0) void this.redeliverQueuedSends(stableAppSessionId, queued);
    } else if (liveSession.autoCompacting) {
      const compactionTarget = this.primaryAutomaticCompactionTarget(liveSession);
      if (compactionTarget) d.compaction.afterTurn(compactionTarget);
      this.publishTurnSettled(liveSession);
    } else {
      const next = liveSession.pendingSends.shift();
      this.publishTurnSettled(liveSession);
      if (next !== undefined) void this.driveInBackground(stableAppSessionId, next);
    }
  }

  // Returns the turn so a scheduled delivery can await the settlement it
  // reserved; ordinary callers discard it.
  private driveInBackground(
    appSessionId: string,
    prompt: SessionPrompt | string,
    delivery?: ScheduledTurnDelivery,
  ): Promise<void> {
    const input = typeof prompt === 'string' ? sessionPrompt(prompt) : prompt;
    return this.drive(appSessionId, input, delivery).catch((error: unknown) => {
      if (!this.dependencies.isShutdownStarted())
        this.dependencies.emitError({ appSessionId, message: errMsg(error) });
    });
  }

  // Queue/steer bookkeeping: never moves updatedAt on its own.
  private updateQueuedSends(liveSession: LiveSession): void {
    this.publishTurnState(liveSession, false);
  }

  // The turn ended (completed, failed, or stopped): this is the "model has
  // finally responded" moment, so the summary's updatedAt moves now.
  private publishTurnSettled(liveSession: LiveSession): void {
    this.publishTurnState(liveSession, true);
  }

  private publishTurnState(liveSession: LiveSession, turnSettled: boolean): void {
    this.dependencies.registry.updateSummary(
      liveSession.summary.appSessionId,
      { streaming: liveSession.streaming, ...queueSummary(liveSession) },
      { touchActivity: turnSettled },
    );
  }

  private canReceiveReport(liveSession: LiveSession): boolean {
    return (
      !this.dependencies.isShutdownStarted() &&
      liveSession.streaming &&
      !liveSession.session.isClosed &&
      !liveSession.closeMode &&
      !liveSession.compacting &&
      !liveSession.autoCompacting &&
      !liveSession.interrupting &&
      !liveSession.interruptingToSend &&
      !this.relaunches.has(liveSession.summary.appSessionId)
    );
  }

  // A chat whose context window changed runs on a new process. The runtime is
  // released and reopened the way an idle one is. The prompt that found it
  // stale, what was queued behind it and what is sent meanwhile wait here in
  // order, because for that long the chat has no runtime to queue them on.
  private async relaunch(stale: LiveSession, prompt: SessionPrompt): Promise<void> {
    const d = this.dependencies;
    const appSessionId = stale.summary.appSessionId;
    const usage = { tokensIn: stale.summary.tokensIn, tokensOut: stale.summary.tokensOut };
    const waiting = [prompt, ...stale.pendingSends.splice(0)];
    const relaunch = { waiting, usageLimit: stale.summary.usageLimit };
    this.relaunches.set(appSessionId, relaunch);
    // A discarding close removes the queue; a Stop only empties it.
    const abandoned = () => d.isShutdownStarted() || this.relaunches.get(appSessionId) !== relaunch;
    let liveSession: LiveSession | undefined;
    let reason = '';
    try {
      await this.close(appSessionId, 'preserve-pending');
      if (abandoned()) return;
      if (await this.resume(appSessionId)) {
        if (abandoned()) return;
        d.context.preserveUsage(appSessionId, usage);
        // A preference accepted while the chat was relaunching belongs to the
        // turn about to start.
        if (await d.applyPendingSessionSettings(appSessionId))
          liveSession = d.registry.getLive(appSessionId);
      }
      if (abandoned()) return;
    } catch (error) {
      if (abandoned()) return;
      reason = ` (${errMsg(error)})`;
    } finally {
      if (this.relaunches.get(appSessionId) === relaunch) this.relaunches.delete(appSessionId);
    }
    // From here to the turn nothing yields: a send that arrives later finds a
    // chat that is streaming and queues behind it.
    if (!liveSession || liveSession.closeMode) {
      // Said even when a Stop took every message back: the runtime is still
      // the stale one.
      const lost = waiting.length > 0 ? `, so ${unsent(waiting.length)} not sent` : '';
      d.emitError({
        appSessionId,
        message: `The chat could not restart on its new context window${reason}${lost}.`,
      });
      return;
    }
    // A prompt its sender withdrew while the chat restarted is not sent.
    const wanted = waiting.filter((queued) => !isWithdrawn(queued));
    if (wanted.length === 0) return;
    const [first, ...rest] = wanted;
    liveSession.pendingSends.unshift(...(liveSession.streaming ? wanted : rest));
    if (liveSession.streaming) this.updateQueuedSends(liveSession);
    else if (liveSession.restartBeforeNextTurn) await this.relaunch(liveSession, first);
    else await this.runTurn(liveSession, first);
  }

  // A relaunch queues typed prompts; reports stay pending with their sender.
  private waitForRelaunch(id: string, prompt: SessionPrompt): boolean {
    const relaunch = this.relaunches.get(this.chatKey(id));
    if (!relaunch) return false;
    if (prompt.delivery) prompt.delivery.declined('stale');
    else relaunch.waiting.push(prompt);
    return true;
  }

  private stopCount(id: string): number {
    return this.stops.get(this.chatKey(id)) ?? 0;
  }

  private noteStop(id: string): void {
    this.stops.set(this.chatKey(id), this.stopCount(id) + 1);
  }

  // A chat is addressed by its own id or by its provider's, and one that is
  // resuming or relaunching has no live session to resolve either through.
  private chatKey(id: string): string {
    return this.dependencies.registry.getCanonicalSummary(id)?.appSessionId ?? id;
  }

  private async redeliverQueuedSends(appSessionId: string, queued: SessionPrompt[]): Promise<void> {
    for (const prompt of queued) {
      if (this.dependencies.isShutdownStarted()) continue;
      try {
        await this.sendPrompt(appSessionId, prompt);
      } catch (error) {
        this.dependencies.emitError({
          appSessionId,
          message: `Could not deliver a queued message after compaction recovery: ${errMsg(error)}`,
        });
      }
    }
  }
}

function unsent(count: number): string {
  return count === 1 ? 'your message was' : `${String(count)} messages were`;
}

let promptOrder = 0;

function sessionPrompt(
  text: string,
  mentions?: ProviderMention[],
  steerId?: string,
): SessionPrompt {
  return {
    text,
    ...(mentions?.length ? { mentions } : {}),
    ...(steerId ? { steerId } : {}),
    order: ++promptOrder,
  };
}

function isWithdrawn(prompt: SessionPrompt): boolean {
  return prompt.isCurrent?.() === false;
}

// What the chat shows of its queue: how many sends wait, and the steers the
// model has not taken in yet, whether the harness holds them or the queue does.
function queueSummary(
  liveSession: LiveSession,
): Pick<SessionSummary, 'queuedSends' | 'pendingSteers'> {
  const pendingSteers = [...new Set([...liveSession.steers, ...liveSession.pendingSends])]
    .sort((a, b) => a.order - b.order)
    .flatMap((prompt) =>
      prompt.steerId
        ? [
            {
              id: prompt.steerId,
              text: userPromptDisplay(prompt.text).text,
              canWithdraw:
                !liveSession.steers.includes(prompt) || !!liveSession.session.withdrawSteer,
            },
          ]
        : [],
    );
  return { queuedSends: liveSession.pendingSends.length, pendingSteers };
}

// Takes the prompt out of the list; false when it was no longer there.
function removePrompt(prompts: SessionPrompt[], prompt: SessionPrompt): boolean {
  const index = prompts.indexOf(prompt);
  if (index < 0) return false;
  prompts.splice(index, 1);
  return true;
}

function createLiveSession(
  summary: SessionSummary,
  session: ProviderSession,
  droid: FactorySession | undefined,
  mcp: StartedLocalMcpResources,
): LiveSession {
  return {
    summary,
    session,
    ...(droid ? { droid } : {}),
    streaming: false,
    pendingSends: [],
    steers: [],
    mcpServers: mcp.servers,
    mcpConfigs: mcp.configs,
    autoCompacting: false,
  };
}

// The command line `droid` spawns for each stdio MCP server, in the shape a
// process table prints it.
function stdioMcpCommandLines(configs: readonly McpServerConfig[]): string[] {
  return configs.flatMap((config) =>
    'command' in config ? [[config.command, ...config.args].join(' ')] : [],
  );
}

async function runBestEffortAsync(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Cleanup continues through the remaining resources.
  }
}

class OpenAdmissionClosedError extends Error {}

function isOpenAdmissionClosed(error: unknown): boolean {
  return error instanceof OpenAdmissionClosedError;
}

function errorFromUnknown(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
