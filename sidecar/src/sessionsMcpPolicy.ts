import { normalizeMcpServerName, splitNamespacedTool } from './automations/permissionPolicy.js';

/** The single MCP server name DROIDEX registers for its session tools. */
export const SESSIONS_MCP_SERVER_NAME = 'droidex-sessions';

const TOOL_TITLES = new Map([
  ['thread_spawn', 'Start a DROIDEX chat'],
  ['thread_send', 'Message a DROIDEX thread'],
  ['thread_read', 'Read a DROIDEX thread'],
  ['thread_configure', 'Adjust a DROIDEX thread'],
  ['thread_stop', 'Stop a DROIDEX thread'],
  ['plan_set', 'Update the DROIDEX project plan'],
]);

// Reading and steering this chat's own threads only moves text between
// conversations DROIDEX already owns, and none of it can put a thread past the
// autonomy of the chat that started it. Starting a chat spends real work under
// its own autonomy, so it asks unless this chat runs at High.
const ALWAYS_ALLOWED = new Set([
  'thread_send',
  'thread_read',
  'thread_configure',
  'thread_stop',
  'plan_set',
]);

export function sessionsToolDisplayTitle(serverName: string, toolName: string): string | null {
  return TOOL_TITLES.get(sessionsTool(serverName, toolName)) ?? null;
}

export function shouldAutoApproveSessionsTool(
  serverName: string,
  toolName: string,
  autonomy: string | undefined,
  unattended = false,
): boolean {
  const tool = sessionsTool(serverName, toolName);
  if (!tool) return false;
  if (ALWAYS_ALLOWED.has(tool)) return true;
  if (unattended) return false;
  return autonomy === 'high';
}

/** The bare tool name when this is one of DROIDEX's session tools, or an empty string. */
function sessionsTool(serverName: string, toolName: string): string {
  const split = splitNamespacedTool(toolName.trim());
  if (normalizeMcpServerName(serverName || split.serverName) !== SESSIONS_MCP_SERVER_NAME)
    return '';
  const tool = split.toolName.trim().toLowerCase();
  return TOOL_TITLES.has(tool) ? tool : '';
}
