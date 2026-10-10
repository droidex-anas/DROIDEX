import { normalizeMcpServerName, splitNamespacedTool } from '../automations/permissionPolicy.js';

export const CANVAS_MCP_SERVER_NAME = 'droidex-canvas';
export const CANVAS_TOOL_NAMES = [
  'canvas_read',
  'canvas_create',
  'canvas_write',
  'canvas_inspect',
  'canvas_arrange',
  'canvas_theme',
] as const;
export type CanvasToolName = (typeof CANVAS_TOOL_NAMES)[number];

// Canvas tools never ask, at any autonomy and in unattended runs alike: they
// reach only the canvases the user attached to this chat, and every write lands
// as a durable revision, so an approval card would add friction and no safety.
export function shouldAutoApproveCanvasTool(serverName: string, toolName: string): boolean {
  const split = splitNamespacedTool(toolName.trim());
  if (normalizeMcpServerName(serverName || split.serverName) !== CANVAS_MCP_SERVER_NAME)
    return false;
  const tool = split.toolName.trim().toLowerCase();
  return CANVAS_TOOL_NAMES.some((name) => name === tool);
}
