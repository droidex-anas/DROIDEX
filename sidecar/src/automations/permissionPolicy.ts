export type AutomationPermissionAutonomy = 'off' | 'low' | 'medium' | 'high';

/** The single MCP server name DROIDEX registers for automation tools. */
export const AUTOMATION_MCP_SERVER_NAME = 'droidex-automations';
export const AUTOMATION_RUN_CLIENT_REF_PREFIX = 'automation:';

/** Run chats must not receive automation tools on create (`automation:`) or resume. */
export function shouldAttachAutomationMcp(
  clientRef: string | undefined,
  isRunSession: boolean,
): boolean {
  return !clientRef?.startsWith(AUTOMATION_RUN_CLIENT_REF_PREFIX) && !isRunSession;
}

// The registration guard and this policy must agree on what counts as the
// automation server, otherwise a configured server differing only by case or
// separator could register alongside it and inherit its trust.
export function normalizeMcpServerName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
}

const TOOL_TITLES: Record<string, string> = {
  automation_propose: 'Prepare DROIDEX automation',
  automation_list: 'View DROIDEX automations',
  automation_create: 'Create DROIDEX automation',
  automation_update: 'Update DROIDEX automation',
  automation_set_enabled: 'Pause or resume DROIDEX automation',
  automation_run_now: 'Run DROIDEX automation',
  automation_delete: 'Delete DROIDEX automation',
};

const AUTOMATION_TOOLS = new Set(Object.keys(TOOL_TITLES));

const ALWAYS_SAFE = new Set(['automation_propose', 'automation_list']);

const HIGH_AUTONOMY_SAFE = new Set([
  'automation_create',
  'automation_update',
  'automation_set_enabled',
  'automation_run_now',
]);

export function automationToolDisplayTitle(serverName: string, toolName: string): string | null {
  if (!isAutomationServer(serverName)) return null;
  const tool = automationToolName(toolName);
  return tool ? TOOL_TITLES[tool] : null;
}

export function shouldAutoApproveAutomationTool(
  serverName: string,
  toolName: string,
  autonomy: AutomationPermissionAutonomy | undefined,
  unattended = false,
): boolean {
  if (!isAutomationServer(serverName)) return false;
  const tool = automationToolName(toolName);
  if (!tool) return false;
  if (ALWAYS_SAFE.has(tool)) return true;
  if (unattended) return false;
  return autonomy === 'high' && HIGH_AUTONOMY_SAFE.has(tool);
}

export function isAutomationMutationTool(serverName: string, toolName: string): boolean {
  if (!isAutomationServer(serverName)) return false;
  const tool = automationToolName(toolName);
  return Boolean(tool) && !ALWAYS_SAFE.has(tool);
}

interface McpToolTarget {
  serverName: string;
  toolName: string;
}

/**
 * The server and tool of every tool a Droid permission request covers, or none
 * when any of them is not an MCP tool: a request that bundles a command or an
 * edit with an MCP call must never be approved on the MCP tool's behalf.
 */
export function mcpPermissionTargets(params: unknown): McpToolTarget[] {
  const raw = recordValue(params);
  const toolUses: unknown[] = raw && Array.isArray(raw.toolUses) ? raw.toolUses : [];
  const targets: McpToolTarget[] = [];
  for (const toolUse of toolUses) {
    const target = mcpToolTarget(toolUse);
    if (!target) return [];
    targets.push(target);
  }
  return targets;
}

function mcpToolTarget(toolUse: unknown): McpToolTarget | null {
  const details = recordValue(recordValue(toolUse)?.details) ?? {};
  if (stringValue(details.type) !== 'mcp_tool') return null;
  const rawToolName = stringValue(details.toolName);
  const explicitServerName = stringValue(details.serverName);
  const split = splitNamespacedTool(rawToolName);
  if (
    explicitServerName &&
    split.serverName &&
    normalizeMcpServerName(explicitServerName) !== normalizeMcpServerName(split.serverName)
  ) {
    return null;
  }
  const serverName = explicitServerName || split.serverName;
  const toolName = split.toolName;
  return toolName ? { serverName, toolName } : null;
}

/**
 * The canonical automation tool name for a possibly namespaced tool name, or an
 * empty string when the value is not one of the automation tools.
 */
function automationToolName(value: string): string {
  const tool = splitNamespacedTool(value.trim()).toolName.trim().toLowerCase();
  return AUTOMATION_TOOLS.has(tool) ? tool : '';
}

function isAutomationServer(serverName: string): boolean {
  return normalizeMcpServerName(serverName) === AUTOMATION_MCP_SERVER_NAME;
}

/** Splits `mcp__server__tool` / `server___tool` into its two halves. */
export function splitNamespacedTool(value: string): { serverName: string; toolName: string } {
  if (value.includes('___')) {
    const marker = value.indexOf('___');
    return { serverName: value.slice(0, marker), toolName: value.slice(marker + 3) };
  }
  const mcpMatch = /^mcp__([^_].*?)__([^_].*)$/i.exec(value);
  if (mcpMatch) {
    const [, serverName, toolName] = mcpMatch;
    return { serverName, toolName };
  }
  return { serverName: '', toolName: value };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
