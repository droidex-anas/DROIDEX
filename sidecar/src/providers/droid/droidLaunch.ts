import { DecompSessionType } from '@factory/droid-sdk';

import { factoryReasoningEffort, type CreateRuntimeSessionOptions } from '../../DroidRuntime.js';
import type {
  FactoryDefaultSettings,
  ReasoningEffort,
  SessionInteractionMode,
  SessionSummary,
} from '../../protocol.js';
import { DEFAULT_PROVIDER, type ProviderKind } from '../providerKind.js';

// What a Droid session launches with beyond the settings every provider shares.
export type DroidLaunchSettings = Pick<
  CreateRuntimeSessionOptions,
  | 'specModeModelId'
  | 'specModeReasoningEffort'
  | 'decompSessionType'
  | 'workerModelId'
  | 'workerReasoningEffort'
  | 'validatorModelId'
  | 'validatorReasoningEffort'
  | 'compactionModel'
  | 'compactionTokenLimit'
  | 'compactionThresholdCheckEnabled'
>;

// session.create must never reach the Droid runtime with a reasoning level
// its SDK cannot represent (Codex's 'ultra', for instance): checked here,
// before any process or transport opens, the same way autonomy is required
// up front instead of failing deep inside session creation.
export function requireDroidReasoningSupported(
  provider: ProviderKind,
  command: {
    reasoningEffort?: ReasoningEffort;
    workerReasoning?: ReasoningEffort;
    validatorReasoning?: ReasoningEffort;
  },
): void {
  if (provider !== DEFAULT_PROVIDER) return;
  for (const effort of [
    command.reasoningEffort,
    command.workerReasoning,
    command.validatorReasoning,
  ])
    if (effort !== undefined) factoryReasoningEffort(effort);
}

export function droidLaunchSettings(input: {
  command: {
    modelId?: string;
    reasoningEffort?: ReasoningEffort;
    sessionPurpose: SessionSummary['sessionPurpose'];
  };
  interactionMode: SessionInteractionMode;
  primary: { modelId?: string; reasoningEffort?: ReasoningEffort };
  agents: Pick<
    SessionSummary,
    'workerModelId' | 'workerReasoningEffort' | 'validatorModelId' | 'validatorReasoningEffort'
  >;
  defaults: FactoryDefaultSettings;
  compactionModel: string;
  compactionTokenLimit: number;
}): DroidLaunchSettings {
  const usePrimaryForSpec =
    input.interactionMode === 'spec' ||
    Boolean(input.command.modelId) ||
    Boolean(input.command.reasoningEffort);
  const specModeModelId = usePrimaryForSpec ? input.primary.modelId : input.defaults.specModelId;
  const specModeReasoningEffort = usePrimaryForSpec
    ? input.primary.reasoningEffort
    : input.defaults.specReasoningEffort;
  return {
    ...(specModeModelId !== undefined ? { specModeModelId } : {}),
    ...(specModeReasoningEffort !== undefined ? { specModeReasoningEffort } : {}),
    ...(input.command.sessionPurpose === 'mission-control'
      ? { decompSessionType: DecompSessionType.Orchestrator }
      : {}),
    ...input.agents,
    compactionModel: input.compactionModel,
    compactionTokenLimit: input.compactionTokenLimit,
    compactionThresholdCheckEnabled: true,
  };
}
