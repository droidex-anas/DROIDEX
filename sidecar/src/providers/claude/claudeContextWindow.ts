// `[1m]` is how the Claude CLI names a model's extended-context variant. The
// catalog spells it inside `resolvedModel` rather than publishing a row of its
// own, so everything that has to read a window out of a model id lives here.
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ContextWindowTokens } from '../../protocol.js';

const EXTENDED_CONTEXT = /\[1m\]$/i;

export function hasExtendedContext(id: string | undefined): boolean {
  return EXTENDED_CONTEXT.test(id ?? '');
}

export function withoutExtendedContext(id: string | undefined): string {
  return (id ?? '').replace(EXTENDED_CONTEXT, '');
}

// Only catalog-backed variants are selectable; an unknown capacity stays unknown.
export function claudeContextModel(
  modelId: string | undefined,
  window: ContextWindowTokens | undefined,
  catalog: ModelInfo[],
): string | undefined {
  if (window === undefined) return modelId;
  if (!modelId) throw new Error('Choose a Claude model before selecting its context window.');
  const base = withoutExtendedContext(modelId);
  if (window === 200000) return base;
  const row = catalog.find((model) => model.value === base || model.resolvedModel === base);
  const extended = catalog.find(
    (model) =>
      hasExtendedContext(model.value) &&
      (withoutExtendedContext(model.value) === base ||
        withoutExtendedContext(model.value) === row?.value),
  );
  if (extended) return extended.value;
  // A row the CLI itself resolves to an extended variant already runs at 1M,
  // as does one whose own description says so.
  if (row && hasExtendedContext(row.resolvedModel)) return row.value;
  if (row && /\b1m\b.*context|context.*\b1m\b/i.test(`${row.displayName} ${row.description}`))
    return row.value;
  throw new Error(`1M context is unavailable for ${base} in the Claude Code catalog.`);
}

export function claudeContextEnv(
  env: NodeJS.ProcessEnv,
  window: ContextWindowTokens | undefined,
): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  if (window === 200000) childEnv.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1';
  else if (window === 1000000) delete childEnv.CLAUDE_CODE_DISABLE_1M_CONTEXT;
  return childEnv;
}
