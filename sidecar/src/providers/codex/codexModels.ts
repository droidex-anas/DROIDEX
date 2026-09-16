// The Codex model catalogue as DROIDEX model info: one page at a time, and only
// the entries a picker can actually show and select.
import { reasoningValue } from '../../modelCatalog.js';
import type { ModelInfo, ReasoningEffort } from '../../protocol.js';
import type { AppServerClient } from './appServer.js';

interface CodexModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  hidden: boolean;
  supportedReasoningEfforts: { reasoningEffort: string }[];
  defaultReasoningEffort: string;
}

// `configuredId` is the model the CLI is set to start on. It is listed even
// when Codex hides it, so the picker's default row carries the same reasoning
// efforts as any other row instead of a bare id; every other hidden model stays
// out of the picker.
export async function listModels(
  client: AppServerClient,
  configuredId: string | undefined,
): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: CodexModel[]; nextCursor: string | null } = await client.request(
      'model/list',
      { includeHidden: true, ...(cursor ? { cursor } : {}) },
    );
    // A model with no id cannot be selected and one with no name cannot be
    // shown, so neither belongs in the picker.
    for (const model of page.data) {
      if (model.hidden && model.id !== configuredId) continue;
      if (named(model.id) && named(model.displayName)) models.push(providerModel(model));
    }
    cursor = page.nextCursor;
  } while (cursor);
  return models;
}

function providerModel(model: CodexModel): ModelInfo {
  const efforts = model.supportedReasoningEfforts
    .map((option) => reasoningValue(option.reasoningEffort))
    .filter((effort): effort is ReasoningEffort => effort !== undefined);
  const fallback = reasoningValue(model.defaultReasoningEffort);
  return {
    id: model.id,
    displayName: model.displayName,
    provider: 'openai',
    isCustom: false,
    isDefault: model.isDefault,
    ...(efforts.length > 0 ? { supportedReasoningEfforts: efforts } : {}),
    ...(fallback ? { defaultReasoningEffort: fallback } : {}),
  };
}

function named(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}
