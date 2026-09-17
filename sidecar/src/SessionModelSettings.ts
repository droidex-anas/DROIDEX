import { factoryReasoningEffort, type FactoryRuntime } from './DroidRuntime.js';
import type { LiveSession } from './SessionLifecycle.js';
import type { SessionRegistry } from './SessionRegistry.js';
import type {
  ClientCommand,
  ConfigurableSessionRole,
  FactoryDefaultSettings,
  ServerEvent,
  SessionSummary,
} from './protocol.js';
import { defaultsModeForSummary, errMsg, modelDefaultForMode } from './sessionHelpers.js';
import { DEFAULT_PROVIDER, type ProviderKind } from './providers/providerKind.js';
import { writeProviderSessionSettings } from './providers/providerSessionSettings.js';
import type { ProviderModelSettings } from './providers/session.js';

type AgentSettings = Partial<Record<ConfigurableSessionRole, ProviderModelSettings>>;
type SettingsError = Omit<Extract<ServerEvent, { type: 'error' }>, 'type'>;

interface Dependencies {
  registry: SessionRegistry<LiveSession>;
  runtime: FactoryRuntime;
  getFactoryDefaults: () => Promise<FactoryDefaultSettings>;
  providerDefaultModelId: (provider: ProviderKind) => string | undefined;
  maxContextTokensForModel: (modelId?: string) => number | undefined;
  isShutdownStarted: () => boolean;
  refreshPrimary: (live: LiveSession, modelChanged: boolean) => Promise<void>;
  onPrimaryModelChanged: (summary: SessionSummary, from: string, to: string) => void;
  onSettled: () => void;
  emitError: (error: SettingsError) => void;
}

interface MutationQueue {
  tail: Promise<unknown>;
  generation: number;
}

// Both bridge commands, and replay before send, share one ordered settings owner.
export class SessionModelSettings {
  private readonly pending = new Map<string, AgentSettings>();
  private readonly queues = new Map<string, MutationQueue>();

  constructor(private readonly d: Dependencies) {}

  hasPending(appSessionId: string): boolean {
    return this.pending.has(appSessionId) || this.queues.has(appSessionId);
  }

  async waitForMutations(appSessionId: string): Promise<void> {
    let queue = this.queues.get(appSessionId);
    while (queue) {
      // The command owns reporting rejection; resume uses the last accepted choice.
      await queue.tail.catch(() => undefined);
      queue = this.queues.get(appSessionId);
    }
  }

  forget(appSessionId: string): void {
    this.pending.delete(appSessionId);
    const queue = this.queues.get(appSessionId);
    if (queue) queue.generation += 1;
  }

  project(summary: SessionSummary): SessionSummary {
    for (const [agent, settings] of Object.entries(this.pending.get(summary.appSessionId) ?? {})) {
      Object.assign(summary, this.summaryPatch(agent as ConfigurableSessionRole, settings));
    }
    return summary;
  }

  async updateAgent(cmd: Extract<ClientCommand, { type: 'settings.agent.update' }>): Promise<void> {
    if (!cmd.appSessionId) return;
    try {
      await this.update(cmd.appSessionId, cmd.agent, cmd);
    } catch (error) {
      this.d.emitError({
        appSessionId: cmd.appSessionId,
        message: `Could not update agent settings: ${errMsg(error)}`,
      });
    }
  }

  update(
    requestedId: string,
    agent: ConfigurableSessionRole,
    settings: ProviderModelSettings,
  ): Promise<void> {
    if (settings.modelId === undefined && settings.reasoningEffort === undefined)
      return Promise.resolve();
    return this.serialize(
      requestedId,
      async (appSessionId, live, isCurrent) => {
        const summary = this.d.registry.getCanonicalSummary(appSessionId);
        if (agent !== 'primary' && summary && summary.sessionPurpose !== 'mission-control') {
          this.d.emitError({
            code: 'agent.settings_unsupported',
            appSessionId,
            message: 'Worker and validator model settings only apply to Mission Control sessions.',
          });
          return;
        }
        if (!summary) {
          this.remember(appSessionId, agent, settings);
          return;
        }
        const selected = mergeSettings(this.pending.get(appSessionId)?.[agent], settings);
        const runtimeSettings = await this.runtimeSettings(summary, agent, selected);
        if (!isCurrent()) return;
        const selection = summary.provider === DEFAULT_PROVIDER ? runtimeSettings : selected;
        const next = { ...summary, ...this.summaryPatch(agent, selection) };
        const change = await this.primaryModelChange(summary, next, agent, settings);
        if (!isCurrent()) return;
        await this.applyProvider(summary, live, agent, runtimeSettings, isCurrent);
        if (!isCurrent()) return;
        this.persistAccepted(summary, live, agent, selection);
        if (agent !== 'primary') return;
        // Only a model change earns a row; a new effort shows on the chip.
        if (change) this.d.onPrimaryModelChanged(next, change.from, change.to);
        if (live) await this.d.refreshPrimary(live, selected.modelId !== undefined);
      },
      undefined,
    );
  }

  applyPending(requestedId: string): Promise<boolean> {
    return this.serialize(
      requestedId,
      async (appSessionId, live, isCurrent) => {
        const pending = this.pending.get(appSessionId);
        if (!live || !pending) return true;
        try {
          let patch: Partial<SessionSummary> = {};
          for (const [agent, settings] of Object.entries(pending)) {
            const role = agent as ConfigurableSessionRole;
            const resolved = await this.runtimeSettings(live.summary, role, settings);
            if (!isCurrent()) return false;
            await this.applyLive(live, role, resolved);
            if (!isCurrent()) return false;
            const selection = live.summary.provider === DEFAULT_PROVIDER ? resolved : settings;
            patch = { ...patch, ...this.summaryPatch(role, selection) };
          }
          if (live.summary.provider !== DEFAULT_PROVIDER && pending.primary)
            writeProviderSessionSettings(appSessionId, pending.primary);
          this.pending.delete(appSessionId);
          try {
            this.d.registry.updateSummary(appSessionId, patch);
          } catch (error) {
            this.pending.set(appSessionId, pending);
            throw error;
          }
          if (pending.primary?.modelId !== undefined) await this.d.refreshPrimary(live, true);
          return isCurrent();
        } catch (error) {
          if (isCurrent())
            this.d.emitError({
              appSessionId,
              message: `Could not apply selected model before send: ${errMsg(error)}`,
            });
          return false;
        }
      },
      false,
    );
  }

  private async applyProvider(
    summary: SessionSummary,
    live: LiveSession | undefined,
    agent: ConfigurableSessionRole,
    settings: ProviderModelSettings,
    isCurrent: () => boolean,
  ): Promise<void> {
    if (live) {
      await this.applyLive(live, agent, settings);
      return;
    }
    if (summary.provider !== DEFAULT_PROVIDER) return;
    const session = await this.d.runtime.loadSession(
      summary.providerSessionId ?? summary.appSessionId,
    );
    try {
      if (isCurrent()) await session.updateSettings(createSessionSettingsForAgent(agent, settings));
    } finally {
      await session.close();
    }
  }

  private async primaryModelChange(
    previous: SessionSummary,
    next: SessionSummary,
    agent: ConfigurableSessionRole,
    settings: ProviderModelSettings,
  ): Promise<{ from: string; to: string } | undefined> {
    if (agent !== 'primary' || settings.modelId === undefined) return;
    const [from, to] = await Promise.all([
      this.effectiveModelId(previous),
      this.effectiveModelId(next),
    ]);
    if (from && to && from !== to) return { from, to };
  }

  private persistAccepted(
    summary: SessionSummary,
    live: LiveSession | undefined,
    agent: ConfigurableSessionRole,
    settings: ProviderModelSettings,
  ): void {
    const appSessionId = summary.appSessionId;
    // Droid's daemon owns its adjacent settings. Other providers need our
    // file as well as the registry row, so a file-only rebuild keeps the choice.
    if (agent === 'primary' && summary.provider !== DEFAULT_PROVIDER)
      writeProviderSessionSettings(appSessionId, settings);
    const previousPending = this.pending.get(appSessionId);
    if (live) {
      const remaining = Object.fromEntries(
        Object.entries(previousPending ?? {}).filter(([role]) => role !== agent),
      );
      if (Object.keys(remaining).length > 0) this.pending.set(appSessionId, remaining);
      else this.pending.delete(appSessionId);
    } else this.remember(appSessionId, agent, settings);
    try {
      const patch = this.summaryPatch(agent, settings);
      if (live) this.d.registry.updateSummary(appSessionId, patch);
      else this.d.registry.updateStoredSummary(appSessionId, patch);
    } catch (error) {
      if (previousPending) this.pending.set(appSessionId, previousPending);
      else this.pending.delete(appSessionId);
      throw error;
    }
  }

  private serialize<T>(
    requestedId: string,
    apply: (
      appSessionId: string,
      live: LiveSession | undefined,
      isCurrent: () => boolean,
    ) => Promise<T>,
    staleResult: T,
  ): Promise<T> {
    const live = this.d.registry.getLive(requestedId);
    const summary = live?.summary ?? this.d.registry.getCanonicalSummary(requestedId);
    const appSessionId = summary?.appSessionId ?? requestedId;
    const session = live?.session;
    const queue = this.queues.get(appSessionId) ?? { tail: Promise.resolve(), generation: 0 };
    const generation = queue.generation;
    const isCurrent = () =>
      !this.d.isShutdownStarted() &&
      queue.generation === generation &&
      this.d.registry.getLive(appSessionId) === live &&
      (!live || (live.session === session && live.closeMode === undefined)) &&
      (live !== undefined ||
        this.d.registry.getCanonicalSummary(appSessionId)?.providerSessionId ===
          summary?.providerSessionId);
    const next = queue.tail
      .catch(() => undefined)
      .then(async () => {
        if (!isCurrent()) return staleResult;
        try {
          return await apply(appSessionId, live, isCurrent);
        } catch (error) {
          if (!isCurrent()) return staleResult;
          throw error;
        }
      });
    queue.tail = next;
    this.queues.set(appSessionId, queue);
    return next.finally(() => {
      if (queue.tail === next) {
        this.queues.delete(appSessionId);
        this.d.onSettled();
      }
    });
  }

  private remember(
    appSessionId: string,
    agent: ConfigurableSessionRole,
    settings: ProviderModelSettings,
  ): void {
    const agents = { ...this.pending.get(appSessionId) };
    agents[agent] = mergeSettings(agents[agent], settings);
    this.pending.set(appSessionId, agents);
  }

  private async runtimeSettings(
    summary: SessionSummary,
    agent: ConfigurableSessionRole,
    settings: ProviderModelSettings,
  ): Promise<ProviderModelSettings> {
    if (settings.modelId !== null) return settings;
    if (summary.provider !== DEFAULT_PROVIDER) {
      return { ...settings, modelId: this.d.providerDefaultModelId(summary.provider) ?? null };
    }
    const defaults = await this.d.getFactoryDefaults();
    let modelId: string | undefined;
    if (agent === 'worker') modelId = defaults.workerModelId;
    else if (agent === 'validator') modelId = defaults.validatorModelId;
    else modelId = modelDefaultForMode(defaultsModeForSummary(summary), defaults);
    if (!modelId)
      throw new Error('The Droid default model is unavailable. Choose a model explicitly.');
    return { ...settings, modelId };
  }

  private async effectiveModelId(summary: SessionSummary): Promise<string | undefined> {
    if (summary.modelId) return summary.modelId;
    if (summary.provider !== DEFAULT_PROVIDER)
      return this.d.providerDefaultModelId(summary.provider);
    return modelDefaultForMode(defaultsModeForSummary(summary), await this.d.getFactoryDefaults());
  }

  private async applyLive(
    live: LiveSession,
    agent: ConfigurableSessionRole,
    settings: ProviderModelSettings,
  ): Promise<void> {
    if (agent === 'primary') {
      await live.session.setModel(settings);
      return;
    }
    if (live.droid) await live.droid.updateSettings(createSessionSettingsForAgent(agent, settings));
  }

  private summaryPatch(
    agent: ConfigurableSessionRole,
    settings: ProviderModelSettings,
  ): Partial<SessionSummary> {
    const patch: Partial<SessionSummary> = {};
    // A cleared effort is stored as none.
    const effort = settings.reasoningEffort ?? undefined;
    if (agent === 'primary') {
      if (settings.modelId !== undefined) {
        patch.modelId = settings.modelId ?? undefined;
        patch.maxContextTokens = this.d.maxContextTokensForModel(settings.modelId ?? undefined);
      }
      if (settings.reasoningEffort !== undefined) patch.reasoningEffort = effort;
    } else if (agent === 'worker') {
      if (settings.modelId !== undefined) patch.workerModelId = settings.modelId ?? undefined;
      if (settings.reasoningEffort !== undefined) patch.workerReasoningEffort = effort;
    } else {
      if (settings.modelId !== undefined) patch.validatorModelId = settings.modelId ?? undefined;
      if (settings.reasoningEffort !== undefined) patch.validatorReasoningEffort = effort;
    }
    return patch;
  }
}

export function createSessionSettingsForAgent(
  agent: ConfigurableSessionRole,
  settings: ProviderModelSettings,
): Record<string, unknown> {
  // Every Droid model publishes its levels, so a cleared effort never reaches
  // here in practice; Droid keeps its own when it does.
  const effort = settings.reasoningEffort
    ? factoryReasoningEffort(settings.reasoningEffort)
    : undefined;
  if (agent === 'primary') {
    return {
      ...(settings.modelId ? { modelId: settings.modelId, specModeModelId: settings.modelId } : {}),
      ...(effort !== undefined ? { reasoningEffort: effort, specModeReasoningEffort: effort } : {}),
    };
  }
  const missionSettings: Record<string, unknown> = {};
  if (agent === 'worker') {
    if (settings.modelId) missionSettings.workerModel = settings.modelId;
    if (effort !== undefined) missionSettings.workerReasoningEffort = effort;
  } else {
    if (settings.modelId) missionSettings.validationWorkerModel = settings.modelId;
    if (effort !== undefined) missionSettings.validationWorkerReasoningEffort = effort;
  }
  return Object.keys(missionSettings).length > 0 ? { missionSettings } : {};
}

function mergeSettings(
  previous: ProviderModelSettings | undefined,
  patch: ProviderModelSettings,
): ProviderModelSettings {
  return {
    ...previous,
    ...(patch.modelId !== undefined ? { modelId: patch.modelId } : {}),
    ...(patch.reasoningEffort !== undefined ? { reasoningEffort: patch.reasoningEffort } : {}),
  };
}
