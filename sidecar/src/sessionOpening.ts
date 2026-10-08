// What a session opens with: the settings and summary a create command resolves
// to, and the summary a resumed runtime projects from its stored record.
import type { CompactionTokenLimitPatch } from './compaction.js';
import type { SessionInitResult } from './DroidRuntime.js';
import { bridgeFeature } from './missionFeatures.js';
import { phaseFromState } from './MissionControlPolicy.js';
import { reasoningValue } from './modelCatalog.js';
import { modelDefaultForMode, reasoningDefaultForMode } from './modeDefaults.js';
import type {
  Autonomy,
  ClientCommand,
  FactoryDefaultSettings,
  ReasoningEffort,
  SessionInteractionMode,
  SessionPhase,
  SessionSummary,
} from './protocol.js';
import { DEFAULT_PROVIDER, type ProviderKind } from './providers/providerKind.js';
import { normalizeAutonomy, stringValue } from './values.js';

function classifySession(
  init: SessionInitResult,
  historical?: SessionSummary,
): Pick<SessionSummary, 'sessionPurpose' | 'interactionMode' | 'role' | 'missionId'> {
  const session = init.session ?? {};
  const decompType = stringValue(session.decompSessionType);
  const missionId = stringValue(session.decompMissionId) ?? historical?.missionId;

  if (decompType === 'worker' || decompType === 'validator') {
    throw new Error('Child provider sessions cannot be resumed as top-level sessions.');
  }

  const mode = init.settings?.interactionMode ?? (init.mission ? 'agi' : undefined);
  if (isMissionControl(init, historical, decompType, missionId)) {
    return missionControlClassification(mode, historical, missionId);
  }
  return standardSessionClassification(mode, historical);
}

function standardSessionClassification(
  mode: string | undefined,
  historical?: SessionSummary,
): ReturnType<typeof classifySession> {
  if (mode === 'spec' || historical?.interactionMode === 'spec') {
    return {
      sessionPurpose: historical?.sessionPurpose ?? 'chat',
      interactionMode: 'spec',
      role: 'primary',
    };
  }

  return {
    sessionPurpose: historical?.sessionPurpose ?? 'chat',
    interactionMode: mode === 'agi' ? 'agi' : 'auto',
    role: 'primary',
  };
}

function isMissionControl(
  init: SessionInitResult,
  historical: SessionSummary | undefined,
  decompType: string | undefined,
  missionId: string | undefined,
): boolean {
  return (
    decompType === 'orchestrator' ||
    Boolean(missionId) ||
    historical?.sessionPurpose === 'mission-control' ||
    (Boolean(init.mission) && !historical?.sessionPurpose)
  );
}

function missionControlClassification(
  mode: string | undefined,
  historical: SessionSummary | undefined,
  missionId: string | undefined,
): ReturnType<typeof classifySession> {
  const resolvedMissionId = missionId ?? historical?.appSessionId;
  const interactionMode =
    mode === 'auto' || mode === 'spec' || mode === 'agi'
      ? mode
      : (historical?.interactionMode ?? 'agi');
  return {
    sessionPurpose: 'mission-control',
    interactionMode,
    role: 'primary',
    ...(resolvedMissionId !== undefined ? { missionId: resolvedMissionId } : {}),
  };
}

function phaseFromInit(init: SessionInitResult): SessionPhase {
  return phaseFromState(init.mission?.state) ?? 'paused';
}

// session.create must carry an explicit autonomy snapshot chosen by the
// sender; the sidecar never invents one. Anything missing or invalid fails
// fast instead of silently falling back to a default.
export function requireAutonomyForCommand(command: { autonomy?: Autonomy }): Autonomy {
  const autonomy = normalizeAutonomy(command.autonomy);
  if (!autonomy) {
    throw new Error(
      'session.create requires an explicit autonomy level (off, low, medium, or high)',
    );
  }
  return autonomy;
}

// Factory's defaults are the Droid CLI's own, so a session on another provider
// starts on the model and reasoning effort the command named, or on whatever
// its own harness is configured with.
export function createModelDefaultsForProvider(
  provider: ProviderKind,
  mode: SessionInteractionMode,
  command: { modelId?: string; reasoningEffort?: ReasoningEffort },
  defaults: Parameters<typeof createModelDefaultsForMode>[2],
): { modelId?: string; reasoningEffort?: ReasoningEffort } {
  if (provider === DEFAULT_PROVIDER) return createModelDefaultsForMode(mode, command, defaults);
  return {
    ...(command.modelId !== undefined ? { modelId: command.modelId } : {}),
    ...(command.reasoningEffort !== undefined ? { reasoningEffort: command.reasoningEffort } : {}),
  };
}

function createModelDefaultsForMode(
  mode: SessionInteractionMode,
  command: { modelId?: string; reasoningEffort?: ReasoningEffort },
  defaults: Pick<
    FactoryDefaultSettings,
    | 'modelId'
    | 'reasoningEffort'
    | 'specModelId'
    | 'specReasoningEffort'
    | 'missionOrchestratorModelId'
    | 'missionOrchestratorReasoningEffort'
  >,
): { modelId?: string; reasoningEffort?: ReasoningEffort } {
  const modelId = command.modelId ?? modelDefaultForMode(mode, defaults);
  const reasoningEffort = command.reasoningEffort ?? reasoningDefaultForMode(mode, defaults);
  return {
    ...(modelId !== undefined ? { modelId } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  };
}

export function createMissionAgentDefaultsForMode(
  mode: SessionInteractionMode,
  command: {
    workerModel?: string;
    workerReasoning?: ReasoningEffort;
    validatorModel?: string;
    validatorReasoning?: ReasoningEffort;
  },
  defaults: Pick<
    FactoryDefaultSettings,
    'workerModelId' | 'workerReasoningEffort' | 'validatorModelId' | 'validatorReasoningEffort'
  >,
): Pick<
  SessionSummary,
  'workerModelId' | 'workerReasoningEffort' | 'validatorModelId' | 'validatorReasoningEffort'
> {
  if (mode !== 'agi') return {};
  const workerModelId = command.workerModel ?? defaults.workerModelId;
  const workerReasoningEffort = command.workerReasoning ?? defaults.workerReasoningEffort;
  const validatorModelId = command.validatorModel ?? defaults.validatorModelId;
  const validatorReasoningEffort = command.validatorReasoning ?? defaults.validatorReasoningEffort;
  return {
    ...(workerModelId !== undefined ? { workerModelId } : {}),
    ...(workerReasoningEffort !== undefined ? { workerReasoningEffort } : {}),
    ...(validatorModelId !== undefined ? { validatorModelId } : {}),
    ...(validatorReasoningEffort !== undefined ? { validatorReasoningEffort } : {}),
  };
}

type SessionCreateCommand = Extract<ClientCommand, { type: 'session.create' }>;

export function createInteractionModeForCommand(
  command: SessionCreateCommand,
  defaults: FactoryDefaultSettings,
): SessionInteractionMode {
  if (command.interactionMode) return command.interactionMode;
  if (command.sessionPurpose === 'mission-control') return 'agi';
  return defaults.interactionMode ?? 'auto';
}

export function createDefaultsModeForCommand(
  command: SessionCreateCommand,
  interactionMode: SessionInteractionMode,
): SessionInteractionMode {
  if (command.sessionPurpose === 'mission-control') return 'agi';
  return interactionMode === 'spec' ? 'spec' : 'auto';
}

export function buildCreatedSessionSummary(input: {
  command: SessionCreateCommand;
  appSessionId: string;
  interactionMode: SessionInteractionMode;
  primary: { modelId?: string; reasoningEffort?: ReasoningEffort };
  compactionModel: string;
  agents: Pick<
    SessionSummary,
    'workerModelId' | 'workerReasoningEffort' | 'validatorModelId' | 'validatorReasoningEffort'
  >;
  autonomy: Autonomy;
  provider: ProviderKind;
  // The provider's own handle for reopening the conversation, when it keeps one.
  resumeId?: string;
  maxContextTokens?: number;
  compactionTokenLimit?: number;
  now: number;
}): SessionSummary {
  const { command, appSessionId, primary, agents } = input;
  const cwd = command.cwd ?? '';
  return {
    appSessionId,
    providerSessionId: appSessionId,
    ...(command.sessionPurpose === 'mission-control' ? { missionId: appSessionId } : {}),
    provider: input.provider,
    ...(input.provider !== DEFAULT_PROVIDER ? { fastMode: command.fastMode ?? false } : {}),
    ...(input.resumeId ? { resumeId: input.resumeId } : {}),
    sessionPurpose: command.sessionPurpose,
    interactionMode: input.interactionMode,
    role: 'primary',
    title: command.title,
    goal: command.goal,
    cwd,
    workspaceKind: cwd ? 'folder' : 'none',
    ...(primary.modelId !== undefined ? { modelId: primary.modelId } : {}),
    ...(input.command.contextWindowTokens !== undefined
      ? { contextWindowTokens: input.command.contextWindowTokens }
      : {}),
    ...(primary.reasoningEffort !== undefined ? { reasoningEffort: primary.reasoningEffort } : {}),
    compactionModel: input.compactionModel,
    ...agents,
    autonomy: input.autonomy,
    phase: 'intake',
    streaming: false,
    queuedSends: 0,
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    ...(input.maxContextTokens !== undefined ? { maxContextTokens: input.maxContextTokens } : {}),
    ...(input.compactionTokenLimit !== undefined
      ? { compactionTokenLimit: input.compactionTokenLimit }
      : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

// A provider that keeps no session file of its own has no init result to read
// its state back from: the stored summary is the session's own record. Without
// one there is nothing to reopen, so the resume fails instead of quietly
// starting a fresh conversation under the same identity.
export function buildResumedProviderSummary(
  historical: SessionSummary | undefined,
  appSessionId: string,
): SessionSummary {
  if (!historical)
    throw new Error(`Session ${appSessionId} has no stored transcript to reopen from.`);
  return {
    ...historical,
    appSessionId,
    providerSessionId: historical.providerSessionId ?? appSessionId,
    phase: historical.phase === 'running' ? 'paused' : historical.phase,
    streaming: false,
    queuedSends: 0,
    pendingSteers: [],
  };
}

interface BuildResumedSessionInput {
  init: SessionInitResult;
  historical?: SessionSummary | undefined;
  appSessionId: string;
  providerSessionId: string;
  defaults: FactoryDefaultSettings;
  maxContextTokensForModel: (modelId?: string) => number | undefined;
  now: number;
}

// The provider's own resume handle, when a stored summary carries one.
export const resumeHandle = (summary: SessionSummary | undefined) =>
  summary?.resumeId ? { resumeId: summary.resumeId } : {};

export function buildResumedSession(input: BuildResumedSessionInput): {
  summary: SessionSummary;
  exposedCompaction: CompactionTokenLimitPatch;
} {
  const classification = classifySession(input.init, input.historical);
  return {
    summary: {
      appSessionId: input.appSessionId,
      providerSessionId: input.providerSessionId,
      compactedFromProviderSessionIds: input.historical?.compactedFromProviderSessionIds ?? [],
      provider: input.historical?.provider ?? DEFAULT_PROVIDER,
      ...resumeHandle(input.historical),
      ...classification,
      ...resumedLocation(input),
      ...resumedModelSettings(input),
      phase:
        classification.sessionPurpose === 'mission-control'
          ? phaseFromInit(input.init)
          : (input.historical?.phase ?? 'paused'),
      streaming: false,
      queuedSends: 0,
      ...(input.historical?.proposal !== undefined ? { proposal: input.historical.proposal } : {}),
      features: resumedFeatures(input.init, classification.sessionPurpose),
      ...resumedUsage(input.historical),
      createdAt: input.historical?.createdAt ?? input.now,
      // Resuming (to read or to prepare a send) is not user-visible activity:
      // keep the historical updatedAt so the session does not jump to the top
      // of the sidebar or read as unread. A real turn moves it when it settles.
      updatedAt: input.historical?.updatedAt ?? input.now,
    },
    exposedCompaction: exposedCompaction(input.init),
  };
}

function resumedLocation(
  input: BuildResumedSessionInput,
): Pick<SessionSummary, 'title' | 'goal' | 'cwd' | 'workspaceKind'> {
  const historical = input.historical;
  const cwd =
    historical?.workspaceKind === 'none'
      ? ''
      : firstNonEmpty(
          historical?.cwd,
          stringValue(input.init.cwd),
          stringValue(input.init.session?.cwd),
        );
  const title = firstNonEmpty(
    stringValue(input.init.session?.title),
    stringValue(input.init.session?.sessionTitle),
    historical?.title,
  );
  return {
    title: title.length > 0 ? title : `Session ${input.providerSessionId.slice(0, 8)}`,
    goal: historical?.goal ?? '',
    cwd,
    workspaceKind: cwd ? 'folder' : (historical?.workspaceKind ?? 'none'),
  };
}

type ResumedModelSettings = Pick<SessionSummary, 'autonomy' | 'compactionModel'> &
  Partial<
    Pick<
      SessionSummary,
      | 'modelId'
      | 'reasoningEffort'
      | 'workerModelId'
      | 'workerReasoningEffort'
      | 'validatorModelId'
      | 'validatorReasoningEffort'
      | 'maxContextTokens'
    >
  >;

function resumedModelSettings(input: BuildResumedSessionInput): ResumedModelSettings {
  return {
    ...resumedBaseModelSettings(input),
    ...resumedPrimaryModelSettings(input),
    ...resumedAgentSettings(input.historical, input.defaults),
  };
}

function resumedBaseModelSettings(
  input: BuildResumedSessionInput,
): Pick<ResumedModelSettings, 'autonomy' | 'compactionModel'> {
  const { init, historical, defaults } = input;
  return {
    compactionModel:
      init.settings?.compactionModel ??
      historical?.compactionModel ??
      defaults.compactionModel ??
      'current-model',
    autonomy: historical?.autonomy ?? normalizeAutonomy(init.settings?.autonomyLevel) ?? 'off',
  };
}

function resumedPrimaryModelSettings(
  input: BuildResumedSessionInput,
): Partial<ResumedModelSettings> {
  const { init, historical, defaults } = input;
  const modelId = init.settings?.modelId ?? historical?.modelId ?? defaults.modelId;
  const reasoningEffort =
    reasoningValue(init.settings?.reasoningEffort) ??
    historical?.reasoningEffort ??
    defaults.reasoningEffort;
  const maxContextTokens = historical?.maxContextTokens ?? input.maxContextTokensForModel(modelId);
  return {
    ...(modelId !== undefined ? { modelId } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(maxContextTokens !== undefined ? { maxContextTokens } : {}),
  };
}

function resumedAgentSettings(
  historical: SessionSummary | undefined,
  defaults: FactoryDefaultSettings,
): Partial<ResumedModelSettings> {
  const workerModelId = historical?.workerModelId ?? defaults.workerModelId;
  const workerReasoningEffort = historical?.workerReasoningEffort ?? defaults.workerReasoningEffort;
  const validatorModelId = historical?.validatorModelId ?? defaults.validatorModelId;
  const validatorReasoningEffort =
    historical?.validatorReasoningEffort ?? defaults.validatorReasoningEffort;
  const settings: Partial<ResumedModelSettings> = {};
  if (workerModelId !== undefined) settings.workerModelId = workerModelId;
  if (workerReasoningEffort !== undefined) settings.workerReasoningEffort = workerReasoningEffort;
  if (validatorModelId !== undefined) settings.validatorModelId = validatorModelId;
  if (validatorReasoningEffort !== undefined)
    settings.validatorReasoningEffort = validatorReasoningEffort;
  return settings;
}

type ResumedUsage = Pick<SessionSummary, 'tokensIn' | 'tokensOut' | 'contextTokens'> &
  Partial<
    Pick<
      SessionSummary,
      'contextRemainingTokens' | 'contextAccuracy' | 'contextUpdatedAt' | 'autoCompactions'
    >
  >;

function resumedUsage(historical?: SessionSummary): ResumedUsage {
  return {
    tokensIn: historical?.tokensIn ?? 0,
    tokensOut: historical?.tokensOut ?? 0,
    // Current-context telemetry is live provider state, not durable session
    // history. A resumed session refreshes it immediately; carrying an old
    // exact stream reading across clients can pin the meter at 100% forever.
    contextTokens: 0,
    ...(historical?.autoCompactions !== undefined
      ? { autoCompactions: historical.autoCompactions }
      : {}),
  };
}

function resumedFeatures(
  init: SessionInitResult,
  purpose: SessionSummary['sessionPurpose'],
): SessionSummary['features'] {
  return purpose === 'mission-control' ? (init.mission?.features ?? []).map(bridgeFeature) : [];
}

function exposedCompaction(init: SessionInitResult): CompactionTokenLimitPatch {
  return {
    ...(init.settings?.compactionTokenLimit !== undefined
      ? { compactionTokenLimit: init.settings.compactionTokenLimit }
      : {}),
    ...(init.settings?.compactionTokenLimitPerModel !== undefined
      ? { compactionTokenLimitPerModel: init.settings.compactionTokenLimitPerModel }
      : {}),
  };
}

function firstNonEmpty(...values: (string | undefined)[]): string {
  return values.find(Boolean) ?? '';
}
