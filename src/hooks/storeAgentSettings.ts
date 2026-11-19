import {
  applyFactoryCompactionDefaults,
  normalizeTokenLimit,
  saveCompactionTokenLimit,
  saveCompactionTokenLimitPerModel,
} from '../lib/compactionSettings';
import { mergePendingModelSettings, type PendingModelSettings } from '../lib/pendingModelSettings';
import { reuseUnchangedStatuses } from '../features/providers/providerIdentity';
import {
  PROVIDER_KINDS,
  type Autonomy,
  type ContextWindowTokens,
  type FactoryDefaultSettings,
  type ModelInfo,
  type ProviderKind,
  type ProviderStatus,
  type ProviderUsage,
  type ReasoningEffort,
  type SkillInfo,
} from '@droidex/protocol';
import { sanitizeAgentConfig, type HarnessModel, type MissionRole } from './persistedUiPreferences';
import type { AppState } from './useStore';

export type AgentSettingsAction =
  | { type: 'MODELS_LIST'; models: ModelInfo[] }
  | { type: 'PROVIDER_STATUSES'; statuses: ProviderStatus[] }
  | { type: 'USAGE_UPDATED'; usage: ProviderUsage }
  | { type: 'BRIDGE_SNAPSHOT' }
  | { type: 'SET_DRAFT_PROVIDER'; provider: ProviderKind }
  | {
      type: 'SKILLS_LIST';
      skills: SkillInfo[];
      providerSessionId: string | null;
    }
  | { type: 'FACTORY_DEFAULTS'; defaults: FactoryDefaultSettings }
  | { type: 'SET_HARNESS_MODEL'; provider: ProviderKind; model: HarnessModel }
  | { type: 'SET_AGENT_MODEL'; agent: MissionRole; modelId?: string }
  | { type: 'SET_AGENT_REASONING'; agent: MissionRole; reasoning: ReasoningEffort | undefined }
  | { type: 'SET_COMPACTION_MODEL_GLOBAL'; compactionModel: string }
  | { type: 'SET_COMPACTION_TOKEN_LIMIT_GLOBAL'; limit?: number }
  | { type: 'SET_COMPACTION_TOKEN_LIMIT_FOR_MODEL'; modelId: string; limit?: number }
  | { type: 'SET_DEFAULT_AUTONOMY'; autonomy: Autonomy }
  | { type: 'SET_DRAFT_AUTONOMY'; autonomy: Autonomy }
  | { type: 'SET_DRAFT_FAST_MODE'; fastMode: boolean }
  | { type: 'SET_DRAFT_CONTEXT_WINDOW'; contextWindowTokens: ContextWindowTokens | null }
  | {
      type: 'AUTONOMY_UPDATE_REQUESTED';
      appSessionId: string;
      requestId: string;
      autonomy: Autonomy;
    }
  | { type: 'AUTONOMY_UPDATE_SETTLED'; appSessionId: string; requestId: string }
  | {
      type: 'MODEL_UPDATE_REQUESTED';
      appSessionId: string;
      requestId: string;
      settings: PendingModelSettings;
    }
  | { type: 'MODEL_UPDATE_SETTLED'; appSessionId: string; requestId: string }
  // The sidecar was replaced: nothing it was working on will be answered.
  | {
      type: 'SETTINGS_UPDATES_UNANSWERED';
      liveAppSessionIds: ReadonlySet<string>;
      resentRequestIds: ReadonlySet<string>;
    };

export function reduceAgentSettings(state: AppState, action: AgentSettingsAction): AppState {
  switch (action.type) {
    case 'MODELS_LIST':
      return {
        ...state,
        models: action.models,
        agentConfig: sanitizeAgentConfig(state.agentConfig, action.models),
      };

    case 'PROVIDER_STATUSES': {
      const providerStatuses = reuseUnchangedStatuses(state.providerStatuses, action.statuses);
      return providerStatuses === state.providerStatuses ? state : { ...state, providerStatuses };
    }

    case 'SET_DRAFT_PROVIDER':
      return { ...state, draftProvider: action.provider };

    case 'USAGE_UPDATED':
      return { ...state, usage: { ...state.usage, [action.usage.provider]: action.usage } };

    // A fresh stream may come from a new sidecar, maybe on another account:
    // the usage the last one read is unconfirmed until this one answers.
    case 'BRIDGE_SNAPSHOT': {
      const usage: AppState['usage'] = {};
      for (const provider of PROVIDER_KINDS) {
        const known = state.usage[provider];
        if (known) usage[provider] = { ...known, stale: true };
      }
      return { ...state, usage };
    }

    case 'SKILLS_LIST':
      return {
        ...state,
        skills: action.skills,
        skillsProviderSessionId: action.providerSessionId,
      };

    case 'FACTORY_DEFAULTS': {
      const next = sanitizeAgentConfig(
        {
          worker: {
            modelId: state.agentConfig.worker.modelId ?? action.defaults.workerModelId,
            reasoning: state.agentConfig.worker.modelId
              ? state.agentConfig.worker.reasoning
              : (action.defaults.workerReasoningEffort ?? state.agentConfig.worker.reasoning),
          },
          validator: {
            modelId: state.agentConfig.validator.modelId ?? action.defaults.validatorModelId,
            reasoning: state.agentConfig.validator.modelId
              ? state.agentConfig.validator.reasoning
              : (action.defaults.validatorReasoningEffort ?? state.agentConfig.validator.reasoning),
          },
        },
        state.models,
      );

      // Seed Factory defaults only before local compaction settings exist. An
      // explicit clear stores an empty local value and must not resurrect
      // Factory's old per-model/default threshold on the next defaults event.
      const compactionDefaults = applyFactoryCompactionDefaults(state, action.defaults);

      return {
        ...state,
        agentConfig: next,
        ...compactionDefaults,
        compactionSettingsRev: state.compactionSettingsRev + 1,
      };
    }

    case 'SET_HARNESS_MODEL':
      return {
        ...state,
        harnessModels: { ...state.harnessModels, [action.provider]: action.model },
      };

    case 'SET_AGENT_MODEL':
      return {
        ...state,
        agentConfig: {
          ...state.agentConfig,
          [action.agent]: { ...state.agentConfig[action.agent], modelId: action.modelId },
        },
      };

    case 'SET_AGENT_REASONING':
      return {
        ...state,
        agentConfig: {
          ...state.agentConfig,
          [action.agent]: { ...state.agentConfig[action.agent], reasoning: action.reasoning },
        },
      };

    case 'SET_COMPACTION_MODEL_GLOBAL':
      return { ...state, compactionModel: action.compactionModel };

    case 'SET_COMPACTION_TOKEN_LIMIT_GLOBAL': {
      const limit = normalizeTokenLimit(action.limit);
      saveCompactionTokenLimit(limit);
      return {
        ...state,
        compactionTokenLimit: limit,
        compactionSettingsRev: state.compactionSettingsRev + 1,
      };
    }

    case 'SET_COMPACTION_TOKEN_LIMIT_FOR_MODEL': {
      const limit = normalizeTokenLimit(action.limit);
      const next = { ...state.compactionTokenLimitPerModel };
      if (limit === undefined) Reflect.deleteProperty(next, action.modelId);
      else next[action.modelId] = limit;
      saveCompactionTokenLimitPerModel(next);
      return {
        ...state,
        compactionTokenLimitPerModel: next,
        compactionSettingsRev: state.compactionSettingsRev + 1,
      };
    }

    case 'SET_DEFAULT_AUTONOMY':
      return { ...state, defaultAutonomy: action.autonomy };

    case 'SET_DRAFT_AUTONOMY':
      return { ...state, draftAutonomy: action.autonomy };

    case 'SET_DRAFT_FAST_MODE':
      return { ...state, draftFastMode: action.fastMode };

    case 'SET_DRAFT_CONTEXT_WINDOW':
      return { ...state, draftContextWindowTokens: action.contextWindowTokens };

    case 'AUTONOMY_UPDATE_REQUESTED':
      return {
        ...state,
        pendingAutonomy: {
          ...state.pendingAutonomy,
          [action.appSessionId]: { requestId: action.requestId, autonomy: action.autonomy },
        },
      };

    case 'AUTONOMY_UPDATE_SETTLED': {
      if (state.pendingAutonomy[action.appSessionId]?.requestId !== action.requestId) return state;
      return {
        ...state,
        pendingAutonomy: Object.fromEntries(
          Object.entries(state.pendingAutonomy).filter(([id]) => id !== action.appSessionId),
        ),
      };
    }

    case 'MODEL_UPDATE_REQUESTED':
      return {
        ...state,
        pendingModelUpdates: {
          ...state.pendingModelUpdates,
          [action.appSessionId]: {
            requestId: action.requestId,
            settings: mergePendingModelSettings(
              state.pendingModelUpdates[action.appSessionId]?.settings,
              action.settings,
            ),
          },
        },
      };

    case 'SETTINGS_UPDATES_UNANSWERED': {
      // Only a live chat's change the old sidecar took is lost: the snapshot
      // carries that chat's confirmed settings, which then show. A closed chat
      // gets no summary here, and a request resent on reconnect is answered by
      // the new sidecar.
      const kept = Object.entries(state.pendingModelUpdates).filter(
        ([appSessionId, pending]) =>
          !action.liveAppSessionIds.has(appSessionId) ||
          (pending !== undefined && action.resentRequestIds.has(pending.requestId)),
      );
      // Unresent autonomy requests cannot settle in the replacement, even for absent chats.
      const keptAutonomy = Object.entries(state.pendingAutonomy).filter(
        ([, pending]) => pending !== undefined && action.resentRequestIds.has(pending.requestId),
      );
      if (
        kept.length === Object.keys(state.pendingModelUpdates).length &&
        keptAutonomy.length === Object.keys(state.pendingAutonomy).length
      )
        return state;
      return {
        ...state,
        pendingModelUpdates: Object.fromEntries(kept),
        pendingAutonomy: Object.fromEntries(keptAutonomy),
      };
    }

    case 'MODEL_UPDATE_SETTLED': {
      if (state.pendingModelUpdates[action.appSessionId]?.requestId !== action.requestId)
        return state;
      return {
        ...state,
        pendingModelUpdates: Object.fromEntries(
          Object.entries(state.pendingModelUpdates).filter(([id]) => id !== action.appSessionId),
        ),
      };
    }
  }
}
