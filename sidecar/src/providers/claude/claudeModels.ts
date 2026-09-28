// The Claude Code model catalogue as DROIDEX model info, and the model a chat
// that pins none starts on.
import type { ModelInfo as ClaudeModelInfo } from '@anthropic-ai/claude-agent-sdk';

import { reasoningValue } from '../../modelCatalog.js';
import type { ContextWindowTokens, ModelInfo, ReasoningEffort } from '../../protocol.js';
import { hasExtendedContext, withoutExtendedContext } from './claudeContextWindow.js';

// The catalog row the CLI publishes for "whatever is recommended", rather than
// for a model of its own.
const RECOMMENDED = 'default';

// The rows a picker can show: the recommendation is resolved into a model of
// its own by claudeDefaultModel, so it is never listed as one.
export function claudeModelRows(
  catalog: ClaudeModelInfo[],
  configuredEffort: ReasoningEffort | undefined,
): ModelInfo[] {
  return catalog
    .filter((model) => model.value !== RECOMMENDED)
    .flatMap((model) => providerModel(model, configuredEffort));
}

export interface ClaudeDefaultModel {
  // The catalog row the picker lists and the composer names.
  modelId: string;
  // What reaches the CLI for a chat that pins no model of its own.
  launchModelId: string;
  // Set when the CLI's own default runs that model at its extended window.
  contextWindowTokens?: ContextWindowTokens;
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
  const row = catalog.find(
    (model) =>
      model.value !== RECOMMENDED &&
      (withoutExtendedContext(model.value) === named ||
        withoutExtendedContext(model.resolvedModel) === named),
  );
  return {
    modelId: row?.value ?? wanted,
    launchModelId: wanted,
    ...(hasExtendedContext(wanted) ? { contextWindowTokens: 1_000_000 as const } : {}),
  };
}

// A catalog entry missing its id or label cannot be selected or shown, so it is
// dropped rather than published as a blank row. A model the CLI gives no effort
// levels for — Haiku — offers none here either, and its rows show no stepper.
function providerModel(
  model: ClaudeModelInfo,
  configured: ReasoningEffort | undefined,
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
