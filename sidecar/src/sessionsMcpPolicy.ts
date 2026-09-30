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
  ['session_list', 'List DROIDEX chats'],
  ['session_read', 'Read a DROIDEX chat'],
  ['session_send', 'Message a DROIDEX chat'],
  ['session_stop', 'Stop a DROIDEX chat'],
  ['session_mark', 'Mark DROIDEX chats'],
]);

// Reading and steering this chat's own threads only moves text between
// conversations DROIDEX already owns, and none of it can put a thread past the
// autonomy of the chat that started it. Reading the sidebar changes nothing.
// Starting a chat spends real work under its own autonomy, and messaging,
// stopping or moving a chat the user follows acts on their work, so those ask
// unless this chat runs at High.
const ALWAYS_ALLOWED = new Set([
  'thread_send',
  'thread_read',
  'thread_configure',
  'thread_stop',
  'plan_set',
  'session_list',
  'session_read',
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

/**
 * How far one "Always allow" reaches for a session tool, as a suffix of its
 * grant key: undefined when it covers the whole tool, as for any other tool,
 * and an empty string when the request cannot be granted at all. Allowing a
 * chat to start threads must not also let it start sidebar chats, allowing it
 * to message or stop one chat must not reach every other chat, and a mark is
 * allowed only for the exact chats it named.
 */
export function sessionsGrantScope(
  serverName: string,
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  switch (sessionsTool(serverName, toolName)) {
    case 'thread_spawn':
      if (input.reportBack === true) return 'thread';
      if (input.reportBack === false) return 'chat';
      return '';
    case 'session_send':
    case 'session_stop':
      return typeof input.sessionId === 'string' ? input.sessionId : '';
    case 'session_mark': {
      const ids: unknown = input.sessionIds;
      if (typeof input.mark !== 'string' || !Array.isArray(ids) || !ids.length) return '';
      if (!ids.every((id): id is string => typeof id === 'string')) return '';
      return `${input.mark}:${[...new Set(ids)].sort().join(',')}`;
    }
    default:
      return undefined;
  }
}

/** The bare tool name when this is one of DROIDEX's session tools, or an empty string. */
function sessionsTool(serverName: string, toolName: string): string {
  const split = splitNamespacedTool(toolName.trim());
  if (normalizeMcpServerName(serverName || split.serverName) !== SESSIONS_MCP_SERVER_NAME)
    return '';
  const tool = split.toolName.trim().toLowerCase();
  return TOOL_TITLES.has(tool) ? tool : '';
}
