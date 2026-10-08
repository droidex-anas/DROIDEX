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
