// `[1m]` is how the Claude CLI names a model's extended-context variant. The
// catalog spells it inside `resolvedModel` rather than publishing a row of its
// own, so everything that has to read a window out of a model id lives here.
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ContextWindowTokens } from '../../protocol.js';

const EXTENDED_CONTEXT = /\[1m\]$/i;
// Some catalogs name the window in prose instead of in the id.
const DESCRIBES_EXTENDED_CONTEXT = /\b1m\b.*context|context.*\b1m\b/i;

export function hasExtendedContext(id: string | undefined): boolean {
  return EXTENDED_CONTEXT.test(id ?? '');
}

export function withoutExtendedContext(id: string | undefined): string {
  return (id ?? '').replace(EXTENDED_CONTEXT, '');
}

// The one rule for whether a model can run 1M, used both by the catalog the
// picker reads and by the launch below, so the picker never offers a window the
// adapter then refuses. The answer is the suffixed id the catalog itself
// spells: DROIDEX never invents one the CLI has not published.
export function claudeExtendedContextId(
  model: ModelInfo,
  catalog: ModelInfo[],
): string | undefined {
  if (hasExtendedContext(model.value)) return model.value;
  if (hasExtendedContext(model.resolvedModel)) return model.resolvedModel;
  const names = [model.value, model.resolvedModel].map(withoutExtendedContext).filter(Boolean);
  for (const row of catalog)
    for (const id of [row.value, row.resolvedModel])
      if (hasExtendedContext(id) && names.includes(withoutExtendedContext(id))) return id;
  return DESCRIBES_EXTENDED_CONTEXT.test(`${model.displayName} ${model.description}`)
    ? model.value
    : undefined;
}

export function claudeContextModel(
  modelId: string | undefined,
  window: ContextWindowTokens | undefined,
  catalog: ModelInfo[],
): string | undefined {
  if (window === undefined) return modelId;
  if (!modelId) throw new Error('Choose a Claude model before selecting its context window.');
  if (window === 200000) return withoutExtendedContext(modelId);
  // An id that already names the extended variant is its own evidence.
  if (hasExtendedContext(modelId)) return modelId;
  const row = catalog.find(
    (model) =>
      withoutExtendedContext(model.value) === modelId ||
      withoutExtendedContext(model.resolvedModel) === modelId,
  );
  const extended = row && claudeExtendedContextId(row, catalog);
  if (extended) return extended;
  throw new Error(`The Claude Code catalog offers no 1M context window for ${modelId}.`);
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
