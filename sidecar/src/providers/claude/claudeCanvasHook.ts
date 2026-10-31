import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { CANVAS_MCP_SERVER_NAME } from '../../canvas/canvasMcpNames.js';
import { EXPIRED_TURN } from '../../canvas/canvasError.js';

/** Each Claude process keeps its own tool-use binding until that process closes. */
export function claudeCanvasHook(
  scopeForRead: () => string | undefined,
): NonNullable<NonNullable<Options['hooks']>['PreToolUse']>[number] {
  const reads = new Map<string, string>();
  return {
    matcher: `mcp__${CANVAS_MCP_SERVER_NAME}__.*`,
    hooks: [
      (input) => {
        if (input.hook_event_name !== 'PreToolUse') return Promise.resolve({});
        // Auto hands the call to the CLI's classifier, which may refuse it
        // before canUseTool is asked. Asking routes it to DROIDEX's own rule,
        // which allows every Canvas tool without a card.
        const ask = input.permission_mode === 'auto';
        if (
          input.tool_name !== `mcp__${CANVAS_MCP_SERVER_NAME}__canvas_read` &&
          input.tool_name !== `mcp__${CANVAS_MCP_SERVER_NAME}__canvas_inspect`
        )
          return Promise.resolve(
            ask
              ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } }
              : {},
          );
        const provided =
          typeof input.tool_input === 'object' && input.tool_input !== null
            ? (input.tool_input as Record<string, unknown>)
            : {};
        const prior = reads.get(input.tool_use_id);
        const requested = typeof provided.scopeId === 'string' ? provided.scopeId : undefined;
        const scopeId = prior ?? requested ?? scopeForRead();
        if (!scopeId || (prior && requested && prior !== requested))
          return Promise.resolve({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: `scope_expired: ${EXPIRED_TURN}`,
            },
          });
        reads.set(input.tool_use_id, scopeId);
        return Promise.resolve({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            ...(ask ? { permissionDecision: 'ask' as const } : {}),
            updatedInput: { ...provided, scopeId },
          },
        });
      },
    ],
  };
}
