import { AutomationAttachments } from './automationAttachments.js';
import { AutomationDeliveries, type DeliverAutomationMessage } from './automationDeliveries.js';
import { automationCommandSchema } from './automationSchemas.js';
import { join } from 'node:path';
import type { ServerEvent } from '../protocol.js';
import { AutomationCatalog } from './automationCatalog.js';
import { hasModelSelection } from './automationInput.js';
import { AutomationProposals } from './automationProposals.js';
import { type SessionCreateCommand } from './automationRunRecord.js';
import { AutomationRuns } from './automationRuns.js';
import { AutomationScheduler, disableForMissingSelection } from './automationScheduler.js';
import {
  AutomationStoreFile,
  buildAutomationSnapshot,
  emptyAutomationStore,
  restoreAutomationStore,
  storeHasRunSession,
  trimAutomationStore,
} from './automationStore.js';
import {
  mergeSessionContext,
  SessionContextCache,
  type AutomationSessionContext,
} from './sessionContexts.js';
import type {
  Automation,
  AutomationBridgeCommand,
  AutomationBridgeEvent,
  AutomationInput,
  AutomationPatch,
  AutomationProposal,
  AutomationReasoningEffort,
  AutomationRun,
  AutomationSnapshot,
  AutomationStore,
} from './types.js';
import {
  createAutomationWorkspace,
  releaseAutomationWorkspace,
  resolveAutomationWorkspace,
  type AutomationWorkspaceCreator,
  type AutomationWorkspacePreparer,
  type AutomationWorkspaceReleaser,
} from './workspace.js';

interface AutomationManagerOptions {
  dataDir: string;
  emit: (event: AutomationBridgeEvent) => void;
  launchSession: (command: SessionCreateCommand) => Promise<void>;
  deliverMessage?: DeliverAutomationMessage;
  closeSession?: (appSessionId: string) => Promise<void>;
  prepareWorkspace?: AutomationWorkspacePreparer;
  createWorkspace?: AutomationWorkspaceCreator;
  releaseWorkspace?: AutomationWorkspaceReleaser;
  resolveSessionContext?: (appSessionId: string) => Promise<AutomationSessionContext | null>;
  validateSelection?: (
    modelId: string,
    reasoningEffort: AutomationReasoningEffort,
  ) => Promise<void>;
  now?: () => number;
  schedulerRecheckMs?: number;
  launchRetryMs?: number;
  turnSettleGraceMs?: number;
}

let configuredManager: AutomationManager | null = null;

export function configureAutomationManager(options: AutomationManagerOptions): AutomationManager {
  if (configuredManager) return configuredManager;
  configuredManager = new AutomationManager(options);
  return configuredManager;
}

export function getAutomationManager(): AutomationManager {
  if (!configuredManager) throw new Error('DROIDEX automations are not initialized.');
  return configuredManager;
}

export async function isUnattendedAutomationSession(
  appSessionId: string | undefined,
): Promise<boolean> {
  const manager = configuredManager;
  if (!appSessionId || !manager) return false;
  try {
    await manager.waitUntilReady();
    return manager.isRunSession(appSessionId);
  } catch {
    // If automation state cannot be loaded, do not grant mutation permissions
    // or attach automation tools to a session whose origin is unknown.
    return true;
  }
}

/** Composes definition, schedule, launch, delivery, and proposal owners on one durable writer. */
export class AutomationManager {
  private readonly storeFile: AutomationStoreFile;
  private readonly emit: (event: AutomationBridgeEvent) => void;
  private readonly resolveSessionContext: (
    appSessionId: string,
  ) => Promise<AutomationSessionContext | null>;
  private readonly now: () => number;
  private store: AutomationStore = emptyAutomationStore();
  private readonly sessionContexts = new SessionContextCache();
  private readonly runs: AutomationRuns;
  private readonly deliveries: AutomationDeliveries;
  private readonly attachments: AutomationAttachments;
  private readonly scheduler: AutomationScheduler;
  private readonly catalog: AutomationCatalog;
  private readonly proposals: AutomationProposals;
  private readonly ready: Promise<void>;
  private readonly startup: Promise<void>;
  private readonly inFlight = new Set<Promise<void>>();
  private mutationTail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: AutomationManagerOptions) {
    this.attachments = new AutomationAttachments(options.dataDir);
    this.storeFile = new AutomationStoreFile(join(options.dataDir, 'automations.json'));
    this.emit = options.emit;
    this.resolveSessionContext = options.resolveSessionContext ?? (() => Promise.resolve(null));
    this.now = options.now ?? Date.now;
    const validateSelection = options.validateSelection ?? (() => Promise.resolve(undefined));
    const shared = {
      store: () => this.store,
      now: () => this.now(),
      commit: <T>(apply: () => T | Promise<T>) => this.commit(apply),
      validateSelection,
      attachments: this.attachments,
    };
    this.runs = new AutomationRuns({
      ...shared,
      isClosed: () => this.closed,
      persist: (apply) => this.persistMutation(apply),
      launchSession: options.launchSession,
      closeSession: options.closeSession ?? (() => Promise.resolve()),
      prepareWorkspace: options.prepareWorkspace ?? resolveAutomationWorkspace,
      createWorkspace:
        options.createWorkspace ??
        (options.prepareWorkspace ? () => Promise.resolve() : createAutomationWorkspace),
      releaseWorkspace: options.releaseWorkspace ?? releaseAutomationWorkspace,
      rearmScheduler: () => {
        this.scheduler.arm();
      },
      launchRetryMs: options.launchRetryMs,
      turnSettleGraceMs: options.turnSettleGraceMs,
    });
    this.deliveries = new AutomationDeliveries({
      ...shared,
      collectAttachments: () => {
        void this.runExclusive(() => this.attachments.collect(this.store)).catch(
          (error: unknown) => {
            console.error('Could not clean automation attachments', error);
          },
        );
      },
      isClosed: () => this.closed,
      persist: (apply) => this.persistMutation(apply),
      deliver:
        options.deliverMessage ??
        (() =>
          Promise.resolve({
            status: 'unavailable',
            error: 'Scheduled session delivery is not available.',
          })),
    });
    this.scheduler = new AutomationScheduler({
      store: shared.store,
      now: shared.now,
      isClosed: () => this.closed,
      runs: this.runs,
      flushDue: () => this.flushDue(),
      recheckMs: options.schedulerRecheckMs,
    });
    this.catalog = new AutomationCatalog({
      ...shared,
      sessionContext: (appSessionId) => this.resolvedContext(appSessionId),
      runs: this.runs,
    });
    this.proposals = new AutomationProposals({
      ...shared,
      sessionContext: (appSessionId) => this.resolvedContext(appSessionId),
      automations: this.catalog,
    });
    this.ready = this.initialize();
    this.startup = this.ready.then(async () => {
      await this.runs.releaseRecovered();
      this.runs.startQueued();
      this.deliveries.startQueued();
    });
    void this.startup.catch((error: unknown) => {
      console.error('Could not initialize DROIDEX automations', error);
    });
  }

  async snapshot(): Promise<AutomationSnapshot> {
    await this.ready;
    return this.snapshotNow();
  }

  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  async observeSessionAvailability(appSessionId: string): Promise<void> {
    await this.ready;
    if (!this.closed) this.deliveries.sessionAvailable(appSessionId);
  }

  async observeSchedulingCapacity(): Promise<void> {
    await this.ready;
    if (!this.closed) this.deliveries.capacityChanged();
  }

  isRunSession(appSessionId: string): boolean {
    return storeHasRunSession(this.store, appSessionId);
  }

  async publishSnapshot(): Promise<void> {
    this.emit({ type: 'automations.snapshot', snapshot: await this.snapshot() });
  }

  async create(input: AutomationInput): Promise<Automation> {
    await this.ready;
    return this.catalog.create(input);
  }

  async createFromSession(input: AutomationInput, sourceAppSessionId: string): Promise<Automation> {
    await this.ready;
    return this.catalog.createFromSession(input, sourceAppSessionId);
  }

  async update(id: string, patch: AutomationPatch): Promise<Automation> {
    await this.ready;
    return this.catalog.update(id, patch);
  }

  async setEnabled(id: string, enabled: boolean): Promise<Automation> {
    return this.update(id, { enabled });
  }

  async remove(id: string): Promise<void> {
    await this.ready;
    await this.commit(() => {
      this.catalog.require(id);
      if (this.runs.hasActiveFor(id)) {
        throw new Error('Wait for the active automation run to finish before deleting it.');
      }
      if (this.runs.hasReviewWorkspaceFor(id)) {
        throw new Error('Close the automation review chat before deleting it.');
      }
      this.catalog.discard(id);
      this.proposals.unlinkAutomation(id, this.now());
    });
  }

  async runNow(id: string): Promise<AutomationRun> {
    await this.ready;
    return this.runs.queueManual(id);
  }

  async propose(input: AutomationInput, sourceAppSessionId: string): Promise<AutomationProposal> {
    await this.ready;
    return this.proposals.propose(input, sourceAppSessionId);
  }

  async confirmProposal(id: string, input?: AutomationInput): Promise<Automation> {
    await this.ready;
    return this.proposals.confirm(id, input);
  }

  /** Transcript tokens from ordinary chats never enter the async observer. */
  observeSessionEvent(event: ServerEvent): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (event.type === 'session.created' && this.runs.hasStartingClientRef(event.clientRef)) {
      this.runs.rememberPendingAdopt(event.session.appSessionId);
    }
    if (
      event.type === 'event.appended' &&
      !this.store.sessionOrigins[event.event.appSessionId] &&
      !this.runs.isAdopting(event.event.appSessionId)
    ) {
      return Promise.resolve();
    }
    return this.track(this.handleSessionEvent(event));
  }

  async handleBridgeCommand(value: unknown): Promise<boolean> {
    if (
      !value ||
      typeof value !== 'object' ||
      !('type' in value) ||
      typeof value.type !== 'string' ||
      !value.type.startsWith('automations.') ||
      !('requestId' in value) ||
      typeof value.requestId !== 'string'
    )
      return false;
    const parsed = automationCommandSchema.safeParse(value);
    if (!parsed.success) {
      this.emit({
        type: 'automations.result',
        requestId: value.requestId,
        ok: false,
        error: parsed.error.issues.some(
          (issue) => issue.path.length === 1 && issue.path[0] === 'type',
        )
          ? `Unknown automations command: ${value.type}`
          : parsed.error.message,
      });
      return true;
    }
    const command = parsed.data;
    try {
      const runId = await this.runCommand(command);
      this.emit({
        type: 'automations.result',
        requestId: command.requestId,
        ok: true,
        ...(runId ? { runId } : {}),
      });
    } catch (error) {
      this.emit({
        type: 'automations.result',
        requestId: command.requestId,
        ok: false,
        error: errorMessage(error),
      });
    }
    return true;
  }

  /** Stop scheduling and settle owned work; borrowed sessions are never closed here. */
  async shutdown(): Promise<void> {
    this.closed = true;
    await this.startup.catch(() => undefined);
    this.scheduler.stop();
    this.runs.stop();
    this.sessionContexts.clear();
    await this.settleInFlightWork();
    await this.storeFile.flush();
  }

  private async runCommand(command: AutomationBridgeCommand): Promise<string | undefined> {
    switch (command.type) {
      case 'automations.list':
        await this.publishSnapshot();
        return;
      case 'automations.create':
        await this.create(command.input);
        return;
      case 'automations.update':
        await this.update(command.id, command.patch);
        return;
      case 'automations.delete':
        await this.remove(command.id);
        return;
      case 'automations.setEnabled':
        await this.setEnabled(command.id, command.enabled);
        return;
      case 'automations.runNow':
        return (await this.runNow(command.id)).id;
      case 'automations.confirmProposal':
        await this.confirmProposal(command.id, command.input);
        return;
    }
  }

  private async handleSessionEvent(event: ServerEvent): Promise<void> {
    await this.ready;
    if (this.closed) return;
    if (event.type === 'session.created' || event.type === 'session.updated') {
      this.sessionContexts.observe(event.session);
    }
    await this.runs.applySessionEvent(event);
    this.deliveries.observe(event);
  }

  /** Repeat because settling work can enqueue another owned cleanup. */
  private async settleInFlightWork(): Promise<void> {
    for (let pass = 0; pass < 5; pass += 1) {
      await this.mutationTail;
      await this.deliveries.pending();
      const pending = [...this.inFlight];
      const drain = this.runs.pending();
      if (drain) pending.push(drain);
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  private track(work: Promise<void>): Promise<void> {
    const tracked = work.finally(() => {
      this.inFlight.delete(tracked);
    });
    this.inFlight.add(tracked);
    return tracked;
  }

  /** Recover interrupted launches and ambiguous deliveries before draining durable queues. */
  private async initialize(): Promise<void> {
    this.store = await this.storeFile.read(this.now());
    const now = this.now();
    for (const automation of this.store.automations) {
      if (
        !automation.enabled ||
        automation.target.kind === 'existing-session' ||
        hasModelSelection(automation)
      )
        continue;
      disableForMissingSelection(automation, now);
    }
    this.runs.failInterrupted(now);
    if (!this.closed) this.scheduler.processDue();
    trimAutomationStore(this.store);
    await this.storeFile.write(this.store);
    await this.attachments.collect(this.store);
    if (this.closed) return;
    this.scheduler.arm();
  }

  private runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const done = this.mutationTail.then(work, work);
    this.mutationTail = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  }

  /** Roll back the complete store, including schedule advances, if persistence fails. */
  private async commit<T>(apply: () => T | Promise<T>): Promise<T> {
    try {
      const result = await this.runExclusive(async () => {
        const previous = structuredClone(this.store);
        try {
          const applied = await apply();
          this.scheduler.processDue();
          trimAutomationStore(this.store);
          await this.persistAndPublish();
          return applied;
        } catch (error) {
          restoreAutomationStore(this.store, previous);
          this.emit({ type: 'automations.snapshot', snapshot: this.snapshotNow() });
          throw error;
        } finally {
          await this.attachments.collect(this.store).catch((error: unknown) => {
            console.error('Could not clean automation attachments', error);
          });
        }
      });
      this.runs.startQueued();
      this.deliveries.startQueued();
      return result;
    } finally {
      if (!this.closed) this.scheduler.arm();
    }
  }

  private persistMutation(apply: () => void): Promise<void> {
    return this.runExclusive(async () => {
      const previous = structuredClone(this.store);
      try {
        apply();
        await this.persistAndPublish();
      } catch (error) {
        restoreAutomationStore(this.store, previous);
        this.emit({ type: 'automations.snapshot', snapshot: this.snapshotNow() });
        throw error;
      }
    });
  }

  private async flushDue(): Promise<void> {
    const queued = await this.runExclusive(async () => {
      if (this.closed) return false;
      const previous = structuredClone(this.store);
      try {
        if (!this.scheduler.processDue()) return false;
        trimAutomationStore(this.store);
        await this.persistAndPublish();
        return true;
      } catch (error) {
        restoreAutomationStore(this.store, previous);
        this.emit({ type: 'automations.snapshot', snapshot: this.snapshotNow() });
        throw error;
      }
    });
    if (queued) {
      this.runs.startQueued();
      this.deliveries.startQueued();
    }
  }

  private async persistAndPublish(): Promise<void> {
    await this.storeFile.write(this.store);
    this.emit({ type: 'automations.snapshot', snapshot: this.snapshotNow() });
  }

  private async resolvedContext(appSessionId: string): Promise<AutomationSessionContext | null> {
    return mergeSessionContext(
      this.sessionContexts.get(appSessionId),
      await this.resolveSessionContext(appSessionId),
    );
  }

  private snapshotNow(): AutomationSnapshot {
    return buildAutomationSnapshot(this.store, {
      ready: !this.closed,
      nextWakeAt: this.scheduler.nextWakeAt(),
      activeRunId: this.runs.activeRunId(),
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
