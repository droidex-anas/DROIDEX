import type { RequestPermissionRequestParams } from '@factory/droid-sdk';
import type { PermissionKind, PermissionRequest } from '@droidex/protocol';
import { automationToolDisplayTitle } from '../../automations/permissionPolicy.js';
import { mcpGrantSignature } from '../../mcpGrant.js';
import { sessionsToolDisplay } from '../../sessionsMcpPolicy.js';
import { uniqueStrings } from '../../values.js';

const PERMISSION_KIND: Record<string, PermissionKind> = {
  edit: 'edit',
  exec: 'exec',
  create: 'create',
  apply_patch: 'apply_patch',
  mcp_tool: 'mcp',
  exit_spec_mode: 'spec',
};

interface ConfirmationDetail {
  type?: string;
  [k: string]: unknown;
}

// Extract the primary confirmation detail. The Droid SDK shape is
// `params.toolUses[0].details`; older/alternate shapes used `confirmations` or a
// bare `confirmation`, which we still fall back to defensively.
function primaryConfirmation(params: RequestPermissionRequestParams): ConfirmationDetail {
  const p = params as unknown as Record<string, unknown>;
  const toolUses = p.toolUses as Record<string, unknown>[] | undefined;
  if (Array.isArray(toolUses) && toolUses.length > 0) {
    const details = toolUses[0].details as ConfirmationDetail | undefined;
    if (details) return details;
  }
  const list = p.confirmations as Record<string, unknown>[] | undefined;
  if (Array.isArray(list) && list.length > 0) {
    const item = list[0];
    const nested = item.confirmation;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as ConfirmationDetail;
    }
    return item;
  }
  const confirmation = p.confirmation;
  if (confirmation && typeof confirmation === 'object' && !Array.isArray(confirmation)) {
    return confirmation as ConfirmationDetail;
  }
  return {};
}

// The tool's actual call arguments live on the tool-use block, not the
// confirmation detail.
function primaryToolInput(params: RequestPermissionRequestParams): Record<string, unknown> {
  const p = params as unknown as Record<string, unknown>;
  const toolUses = p.toolUses as Record<string, unknown>[] | undefined;
  if (Array.isArray(toolUses) && toolUses.length > 0) {
    const toolUse = toolUses[0].toolUse as Record<string, unknown> | undefined;
    const input = toolUse?.input;
    if (input && typeof input === 'object') return input as Record<string, unknown>;
  }
  return {};
}

// Build a readable summary of an MCP tool request: its arguments (so the user
// can see *what* it will do, e.g. the URL a browser tool will open) plus the
// declared impact level when present.
function mcpToolDetail(c: ConfirmationDetail, input: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const rendered = typeof value === 'string' ? value : JSON.stringify(value);
    if (!rendered || rendered === '{}') continue;
    lines.push(`${key}: ${rendered}`);
  }
  if (typeof c.impactLevel === 'string' && c.impactLevel) {
    lines.push(`Impact: ${c.impactLevel}`);
  }
  return lines.join('\n');
}

export function classifyPermission(
  appSessionId: string,
  requestId: string,
  params: RequestPermissionRequestParams,
): PermissionRequest {
  if (params.toolUses.length > 1) return classifyPermissionBundle(appSessionId, requestId, params);
  const c = primaryConfirmation(params);
  const type = typeof c.type === 'string' ? c.type : 'other';
  let title = 'Permission required';
  let detail = '';
  let plan: string | undefined;
  let options: string[] | undefined;
  let kind: PermissionKind = PERMISSION_KIND[type] ?? 'other';

  switch (type) {
    case 'exit_spec_mode':
      title = typeof c.title === 'string' ? c.title : 'Plan ready for review';
      plan = typeof c.plan === 'string' ? c.plan : '';
      detail = plan;
      options = Array.isArray(c.optionNames)
        ? c.optionNames.filter((name): name is string => typeof name === 'string')
        : undefined;
      kind = 'spec';
      break;
    case 'propose_mission':
      title = typeof c.title === 'string' ? c.title : 'Mission plan proposed';
      plan = typeof c.proposal === 'string' ? c.proposal : '';
      detail = plan;
      kind = 'mission_plan';
      break;
    case 'start_mission_run':
      title = 'Start mission run';
      detail = `Running missions: ${typeof c.runningMissionCount === 'number' ? String(c.runningMissionCount) : '0'}`;
      kind = 'other';
      break;
    case 'exec': {
      title = 'Run command';
      const fullCommand = typeof c.fullCommand === 'string' ? c.fullCommand : '';
      const command = typeof c.command === 'string' ? c.command : '';
      detail = fullCommand || command || JSON.stringify(c);
      break;
    }
    case 'edit':
    case 'create':
      title = type === 'create' ? 'Create file' : 'Edit file';
      detail =
        (typeof c.filePath === 'string' ? c.filePath : '') ||
        (typeof c.fileName === 'string' ? c.fileName : '');
      break;
    case 'apply_patch':
      title = 'Apply patch';
      detail =
        (typeof c.fileName === 'string' ? c.fileName : '') ||
        (typeof c.filePath === 'string' ? c.filePath : '');
      break;
    case 'mcp_tool': {
      const rawTool = typeof c.toolName === 'string' ? c.toolName : '';
      // MCP tools are namespaced as `server___tool`; split for a readable label.
      const [splitServer, splitTool] = rawTool.includes('___')
        ? [rawTool.slice(0, rawTool.indexOf('___')), rawTool.slice(rawTool.indexOf('___') + 3)]
        : ['', rawTool];
      const serverName =
        typeof c.serverName === 'string' && c.serverName ? c.serverName : splitServer;
      const toolName = splitTool;
      const input = primaryToolInput(params);
      const display = sessionsToolDisplay(serverName, toolName, input);
      const droidexTitle = display?.title ?? automationToolDisplayTitle(serverName, toolName);
      if (droidexTitle) title = droidexTitle;
      else if (toolName && serverName) title = `${serverName} · ${toolName}`;
      else if (toolName) title = toolName;
      else if (serverName) title = `${serverName} tool`;
      else title = 'External tool';
      detail = display?.detail ?? mcpToolDetail(c, input);
      break;
    }
    default:
      detail = JSON.stringify(c);
  }

  return {
    appSessionId,
    requestId,
    kind,
    title,
    detail,
    canAlwaysAllow: Boolean(permissionSignature(params)),
    plan,
    options,
    raw: params,
  };
}

// One answer covers every tool in a bundle, so the card names them all and
// shows each one's own detail rather than presenting the first as the whole.
function classifyPermissionBundle(
  appSessionId: string,
  requestId: string,
  params: RequestPermissionRequestParams,
): PermissionRequest {
  const tools = params.toolUses.map((toolUse) =>
    classifyPermission(appSessionId, requestId, { ...params, toolUses: [toolUse] }),
  );
  const kind = tools.every((tool) => tool.kind === tools[0].kind) ? tools[0].kind : 'other';
  return {
    appSessionId,
    requestId,
    kind,
    title: uniqueStrings(tools.map((tool) => tool.title)).join(', '),
    detail: tools
      .map((tool) => (tool.detail ? `${tool.title}\n${tool.detail}` : tool.title))
      .join('\n\n'),
    canAlwaysAllow: false,
    raw: params,
  };
}

export function confirmationType(params: RequestPermissionRequestParams): string {
  const type = primaryConfirmation(params).type;
  return typeof type === 'string' ? type : 'other';
}

// Stable key identifying "the same action" so an app-level allowlist can honor
// "Always allow" even when the underlying agent does not persist the grant.
// An empty string means the request is not eligible for always-allow caching,
// as no bundle is: a grant keyed by one of its tools would let a later bundle
// carry other tools through under it. Nor is a call from a Droid script: the
// daemon reads "always" for a script as allowing every command of its impact.
export function permissionSignature(params: RequestPermissionRequestParams): string {
  if (params.toolUses.length > 1) return '';
  const c = primaryConfirmation(params);
  if (c.inScript === true) return '';
  const type = typeof c.type === 'string' ? c.type : 'other';
  switch (type) {
    case 'exec': {
      const fullCommand = typeof c.fullCommand === 'string' ? c.fullCommand : '';
      const command = typeof c.command === 'string' ? c.command : '';
      const concreteCommand = fullCommand || command;
      return concreteCommand ? `exec::${concreteCommand}` : '';
    }
    case 'mcp_tool':
      return mcpToolSignature(params, c);
    case 'edit':
    case 'create':
    case 'apply_patch': {
      // Scope file-write grants to the specific path so "Always allow" cannot
      // bypass prompts for unrelated files. No identifiable path => ineligible.
      const path =
        typeof c.filePath === 'string' && c.filePath
          ? c.filePath
          : typeof c.fileName === 'string' && c.fileName
            ? c.fileName
            : '';
      return path ? `${type}::${path}` : '';
    }
    default:
      return '';
  }
}

// An MCP grant covers the server and tool, narrowed for the tools whose one
// call must not authorize a different later one: a DROIDEX automation mutation
// by its arguments, thread_spawn by the kind of chat it starts.
function mcpToolSignature(params: RequestPermissionRequestParams, c: ConfirmationDetail): string {
  const serverName = typeof c.serverName === 'string' ? c.serverName : '';
  const toolName = typeof c.toolName === 'string' ? c.toolName : '';
  if (!toolName) return '';
  return mcpGrantSignature(serverName, toolName, primaryToolInput(params));
}
