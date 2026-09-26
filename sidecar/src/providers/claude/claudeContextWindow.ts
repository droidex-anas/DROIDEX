import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderModelSettings } from '../session.js';

// Only catalog-backed variants are selectable; an unknown capacity stays unknown.
export function claudeContextModel(
  modelId: string | undefined,
  window: ProviderModelSettings['contextWindowTokens'],
  catalog: ModelInfo[],
): string | undefined {
  if (window === undefined) return modelId;
  if (!modelId) throw new Error('Choose a Claude model before selecting its context window.');
  const base = modelId.replace(/\[1m\]$/i, '');
  if (window === 200000) return base;
  const row = catalog.find((model) => model.value === base || model.resolvedModel === base);
  const extended = catalog.find(
    (model) =>
      /\[1m\]$/i.test(model.value) &&
      (model.value.replace(/\[1m\]$/i, '') === base ||
        (row !== undefined && model.value.replace(/\[1m\]$/i, '') === row.value)),
  );
  if (extended) return extended.value;
  if (row && /\b1m\b.*context|context.*\b1m\b/i.test(`${row.displayName} ${row.description}`))
    return row.value;
  throw new Error(`1M context is unavailable for ${base} in the Claude Code catalog.`);
}

export function claudeContextEnv(
  env: NodeJS.ProcessEnv,
  window: ProviderModelSettings['contextWindowTokens'],
): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  if (window === 200000) childEnv.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1';
  else if (window === 1000000) delete childEnv.CLAUDE_CODE_DISABLE_1M_CONTEXT;
  return childEnv;
}
