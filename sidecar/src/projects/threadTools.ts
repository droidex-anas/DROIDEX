import { normalizeMcpServerName } from '../automations/permissionPolicy.js';

/** The single MCP server name DROIDEX registers for project thread tools. */
export const THREAD_MCP_SERVER_NAME = 'droidex-threads';

const TOOL_TITLES: Record<string, string> = {
  thread_spawn: 'Start DROIDEX thread',
  thread_send: 'Message DROIDEX thread',
  thread_read: 'Read DROIDEX thread',
  thread_configure: 'Adjust DROIDEX thread',
  thread_stop: 'Stop DROIDEX thread',
  plan_set: 'Update the DROIDEX project plan',
};

// Spawning is the one tool that spends real work: it opens another conversation
// that edits files under its own autonomy. Everything else only reads, retunes
// or moves text between conversations DROIDEX already owns, or stops one, and
// none of them can put a thread past the autonomy its owner already has.
const ALWAYS_SAFE = new Set([
  'thread_send',
  'thread_read',
  'thread_configure',
  'thread_stop',
  'plan_set',
]);

export function threadToolDisplayTitle(serverName: string, toolName: string): string | null {
  if (!isThreadServer(serverName)) return null;
  const tool = threadToolName(toolName);
  return tool ? TOOL_TITLES[tool] : null;
}

export function shouldAutoApproveThreadTool(
  serverName: string,
  toolName: string,
  autonomy: string | undefined,
  unattended = false,
): boolean {
  if (!isThreadServer(serverName)) return false;
  const tool = threadToolName(toolName);
  if (!tool) return false;
  if (ALWAYS_SAFE.has(tool)) return true;
  if (unattended) return false;
  return autonomy === 'high';
}

function threadToolName(value: string): string {
  const bare = splitNamespacedTool(value.trim()).toolName.trim().toLowerCase();
  return bare in TOOL_TITLES ? bare : '';
}

function isThreadServer(serverName: string): boolean {
  return normalizeMcpServerName(serverName) === THREAD_MCP_SERVER_NAME;
}

function splitNamespacedTool(value: string): { serverName: string; toolName: string } {
  if (value.includes('___')) {
    const marker = value.indexOf('___');
    return { serverName: value.slice(0, marker), toolName: value.slice(marker + 3) };
  }
  const mcpMatch = /^mcp__([^_].*?)__([^_].*)$/i.exec(value);
  if (mcpMatch) return { serverName: mcpMatch[1], toolName: mcpMatch[2] };
  return { serverName: '', toolName: value };
}
