// The Claude Code model catalogue as DROIDEX model info, and the model a chat
// that pins none starts on.
import type { ModelInfo as ClaudeModelInfo, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { reasoningValue } from '../../modelCatalog.js';
import type { ContextWindowTokens, ModelInfo, ReasoningEffort } from '../../protocol.js';
import {
  claudeContextModel,
  claudeExtendedContextId,
  hasExtendedContext,
  withoutExtendedContext,
} from './claudeContextWindow.js';

// The catalog row the CLI publishes for "whatever is recommended", rather than
// for a model of its own.
const RECOMMENDED = 'default';

// The family names the CLI accepts on its command line. It publishes some of
// them as catalog rows and some not, so a configured default may name one that
// the picker would otherwise have no row for.
const FAMILY_ALIASES = ['opus', 'sonnet', 'haiku'];

// The rows a picker can show: the recommendation is resolved into a model of
// its own by claudeDefaultModel, so it is never listed as one.
export function claudeModelRows(
  catalog: ClaudeModelInfo[],
  configuredEffort: ReasoningEffort | undefined,
  defaultModel: ClaudeDefaultModel | undefined,
): ModelInfo[] {
  const rows = catalog
    .filter((model) => model.value !== RECOMMENDED)
    .flatMap((model) => providerModel(model, configuredEffort, catalog));
  const alias = aliasRow(defaultModel, catalog, rows);
  return alias ? [alias, ...rows] : rows;
}

// A default that names a family alias rather than a catalog row still has to be
// a row the picker lists and selects. The entry says only what the app knows:
// the alias and the window its suffix asks for, never a version. Its
// capabilities come from the newest row of the same family, or none at all.
function aliasRow(
  defaultModel: ClaudeDefaultModel | undefined,
  catalog: ClaudeModelInfo[],
  rows: ModelInfo[],
): ModelInfo | undefined {
  if (defaultModel?.aliasFamily === undefined) return undefined;
  const prefix = `claude-${defaultModel.aliasFamily}-`;
  const relative = catalog.find(
    (model) =>
      model.value !== RECOMMENDED &&
      (model.value.startsWith(prefix) ||
        withoutExtendedContext(model.resolvedModel).startsWith(prefix)),
  );
  const capabilities = rows.find((row) => row.id === relative?.value);
  return {
    id: defaultModel.modelId,
    displayName: defaultModel.aliasFamily.replace(/^./, (first) => first.toUpperCase()),
    // What ModelIcon reads to draw the Anthropic mark.
    provider: 'anthropic',
    isCustom: false,
    // The suffix on the user's own setting is the only evidence there is: the
    // catalog has no row for the alias, so nothing else spells a 1M id for it.
    maxContextTokens: hasExtendedContext(defaultModel.modelId) ? 1_000_000 : 200_000,
    ...(capabilities?.supportsFastMode !== undefined
      ? { supportsFastMode: capabilities.supportsFastMode }
      : {}),
    ...(capabilities?.supportedReasoningEfforts
      ? {
          supportedReasoningEfforts: capabilities.supportedReasoningEfforts,
          ...(capabilities.defaultReasoningEffort
            ? { defaultReasoningEffort: capabilities.defaultReasoningEffort }
            : {}),
        }
      : {}),
  };
}

export interface ClaudeDefaultModel {
  // The catalog row the picker lists and the composer names.
  modelId: string;
  // What reaches the CLI for a chat that pins no model of its own.
  launchModelId: string;
  // Set when the CLI's own default runs that model at its extended window.
  contextWindowTokens?: ContextWindowTokens;
  // Set when `modelId` names a family alias instead of a catalog row, so the
  // picker is given an entry for it.
  aliasFamily?: string;
}

// The model a new Claude Code session starts on, named the way the catalog names
// it: the CLI's own `model` setting when the user configured one, otherwise the
// row it recommends. Either can name a model by alias or by wire id, and either
// can carry the extended-context suffix, which the catalog spells inside
// `resolvedModel` instead of publishing as a row. The suffix is therefore set
// aside to find the row the picker lists and kept for what reaches the CLI.
export function claudeDefaultModel(
  catalog: ClaudeModelInfo[],
  configured: string | undefined,
): ClaudeDefaultModel | undefined {
  const recommended = catalog.find((model) => model.value === RECOMMENDED);
  const recommendation = recommended?.resolvedModel ?? recommended?.value;
  // A setting of `default` is the CLI's own word for "whatever is recommended",
  // not a model, so it resolves the same way an absent setting does.
  const wanted = configured === RECOMMENDED ? recommendation : (configured ?? recommendation);
  if (!wanted) return undefined;
  const named = withoutExtendedContext(wanted);
  const row = catalogRow(catalog, wanted);
  return {
    modelId: row?.value ?? wanted,
    launchModelId: wanted,
    ...(row === undefined && FAMILY_ALIASES.includes(named) ? { aliasFamily: named } : {}),
    ...(hasExtendedContext(wanted) ? { contextWindowTokens: 1_000_000 as const } : {}),
  };
}

// The catalog row a model the CLI names by alias or by wire id is listed under.
function catalogRow(catalog: ClaudeModelInfo[], id: string): ClaudeModelInfo | undefined {
  const named = withoutExtendedContext(id);
  return catalog.find(
    (model) =>
      model.value !== RECOMMENDED &&
      (withoutExtendedContext(model.value) === named ||
        withoutExtendedContext(model.resolvedModel) === named),
  );
}

// A model the CLI reports, named the way the picker names it. An id no row
// covers is kept as it is.
export function claudeCatalogModelId(id: string, catalog: ClaudeModelInfo[]): string {
  return catalogRow(catalog, id)?.value ?? id;
}

// The id that reaches the CLI. A chat on the default model that pins no window
// runs what the CLI's own default would, suffix included, even though the row
// the picker lists for it is the unsuffixed one.
export function claudeLaunchModel(
  modelId: string | undefined,
  window: ContextWindowTokens | undefined,
  catalog: ClaudeModelInfo[],
  defaultModel: ClaudeDefaultModel | undefined,
): string | undefined {
  const onDefault = modelId === undefined || modelId === defaultModel?.modelId;
  if (onDefault && window === undefined && defaultModel) return defaultModel.launchModelId;
  return claudeContextModel(modelId ?? defaultModel?.launchModelId, window, catalog);
}

// A catalog entry missing its id or label cannot be selected or shown, so it is
// dropped rather than published as a blank row. A model the CLI gives no effort
// levels for — Haiku — offers none here either, and its rows show no stepper.
function providerModel(
  model: ClaudeModelInfo,
  configured: ReasoningEffort | undefined,
  catalog: ClaudeModelInfo[],
): ModelInfo[] {
  const id = model.value.trim();
  const displayName = versionedDisplayName(model.displayName.trim(), model.description);
  if (!id || !displayName) return [];
  const cliEfforts = (model.supportedEffortLevels ?? []).flatMap((level) => {
    const effort = reasoningValue(level);
    return effort ? [effort] : [];
  });
  // Ultracode is not one of the CLI's levels: it is xhigh plus standing workflow
  // orchestration, so it rides above the published set on the models that can
  // reach xhigh and is absent everywhere else. It is never a starting level, so
  // the default still comes from what the CLI itself publishes.
  const efforts: ReasoningEffort[] = cliEfforts.includes('xhigh')
    ? [...cliEfforts, 'ultra']
    : cliEfforts;
  return [
    {
      id,
      displayName,
      provider: 'anthropic',
      // The ceiling the window menu offers, by the one catalog-evidence rule.
      maxContextTokens: claudeExtendedContextId(model, catalog) ? 1_000_000 : 200_000,
      ...(model.supportsFastMode !== undefined ? { supportsFastMode: model.supportsFastMode } : {}),
      isCustom: false,
      ...(efforts.length > 0
        ? {
            supportedReasoningEfforts: efforts,
            defaultReasoningEffort: defaultEffort(cliEfforts, configured),
          }
        : {}),
    },
  ];
}

// The CLI labels a model by its alias ("Opus") and leads its description with
// the versioned name ("Opus 5 with 1M context · …"); the picker shows the version.
function versionedDisplayName(displayName: string, description: string | undefined): string {
  const match = /^(\S+) (\d+(?:\.\d+)*)\b/.exec(description ?? '');
  if (!match || !displayName.startsWith(match[1]) || /^\S+ \d/.test(displayName))
    return displayName;
  return `${match[1]} ${match[2]}${displayName.slice(match[1].length)}`;
}

// The level a chat on this model starts on: the CLI's own configured effort
// where the model supports it, otherwise the SDK's documented model default.
function defaultEffort(
  efforts: ReasoningEffort[],
  configured: ReasoningEffort | undefined,
): ReasoningEffort {
  if (configured && efforts.includes(configured)) return configured;
  return efforts.includes('high') ? 'high' : efforts[efforts.length - 1];
}

// Plan mode can override the pinned model inside the CLI; this reports its
// choice without changing it.
export function planningModelNotice(
  message: Extract<SDKMessage, { type: 'assistant' }>,
  modelId: string | undefined,
): string | undefined {
  const model = message.message.model;
  if (
    !modelId ||
    message.parent_tool_use_id ||
    model === '<synthetic>' ||
    matchesModel(modelId, model)
  )
    return undefined;
  return `Planning on ${model}, Claude Code's plan-mode model.`;
}

function matchesModel(selected: string, actual: string): boolean {
  const model = selected.replace(/\[1m\]$/i, '');
  if (model === actual) return true;
  // The picker also publishes CLI aliases, while assistant frames carry wire ids.
  return !model.startsWith('claude-') && actual.startsWith(`claude-${model}-`);
}
