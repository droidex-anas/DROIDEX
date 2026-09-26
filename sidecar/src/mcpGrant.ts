import { createHash } from 'node:crypto';
import { isAutomationMutationTool, splitNamespacedTool } from './automations/permissionPolicy.js';
import { sessionsGrantScope } from './sessionsMcpPolicy.js';

// Keep the names as the provider supplied them: existing grants use that exact
// spelling, including Droid's combined server___tool form.
export function mcpGrantSignature(
  serverName: string,
  toolName: string,
  input: Record<string, unknown>,
): string {
  const key = `mcp::${serverName}::${toolName}`;
  const scope = sessionsGrantScope(serverName, toolName, input);
  if (scope !== undefined) return scope ? `${key}::${scope}` : '';
  const split = splitNamespacedTool(toolName);
  if (!isAutomationMutationTool(serverName || split.serverName, split.toolName)) return key;
  const args = toolArgumentDigest(input);
  return args ? `${key}::${args}` : '';
}

// Argument values can include secrets, so a stored grant keeps only a bounded
// digest. A payload that cannot be serialized cannot earn an Always allow.
function toolArgumentDigest(input: Record<string, unknown>): string {
  let serialized: string;
  try {
    serialized = stableJson(input);
  } catch {
    return '';
  }
  return createHash('sha256').update(serialized).digest('hex').slice(0, 32);
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      });
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
