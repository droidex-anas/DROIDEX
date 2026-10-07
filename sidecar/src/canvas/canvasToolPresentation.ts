import {
  CANVAS_MCP_SERVER_NAME,
  CANVAS_TOOL_NAMES,
  type CanvasToolName,
} from './canvasMcpNames.js';
import type { TranscriptEvent } from '../protocol.js';
import { objectValue } from '../values.js';

export interface CanvasActivity {
  toolUseId: string;
  action: 'create' | 'write' | 'inspect' | 'arrange' | 'theme';
  designIds: string[];
  state: 'running' | 'completed' | 'failed';
  message: string;
}

export interface ToolProvenance {
  serverName: string;
  toolName: string;
  toolUseId: string;
}

export interface CanvasToolBinding {
  toolUseId: string;
  sourceSessionId: string;
  action: CanvasActivity['action'];
  designIds: string[];
  revisionId?: string;
  frameNames?: string[];
}

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const ACTIONS: Record<CanvasToolName, CanvasActivity['action']> = {
  canvas_read: 'inspect',
  canvas_create: 'create',
  canvas_write: 'write',
  canvas_inspect: 'inspect',
  canvas_arrange: 'arrange',
  canvas_theme: 'theme',
};
const VERBS = {
  create: ['Creating designs', 'Created designs', 'Could not create designs'],
  write: ['Updating design', 'Updated design', 'Could not update design'],
  inspect: ['Inspecting canvas', 'Inspected canvas', 'Could not inspect canvas'],
  arrange: ['Arranging designs', 'Arranged designs', 'Could not arrange designs'],
  theme: ['Reading design system', 'Read design system', 'Could not read design system'],
} as const;

export function canvasToolName(name: string | undefined): CanvasToolName | undefined {
  if (!name) return undefined;
  let prefix = `mcp__${CANVAS_MCP_SERVER_NAME}__`;
  if (!name.startsWith(prefix)) prefix = `${CANVAS_MCP_SERVER_NAME}___`;
  if (!name.startsWith(prefix)) return undefined;
  const toolName = name.slice(prefix.length);
  return CANVAS_TOOL_NAMES.find((candidate) => candidate === toolName);
}

export function canvasToolProvenance(
  name: string | undefined,
  toolUseId: string | undefined,
): ToolProvenance | undefined {
  const toolName = canvasToolName(name);
  return toolName && toolUseId
    ? { serverName: CANVAS_MCP_SERVER_NAME, toolName, toolUseId }
    : undefined;
}

export function safeFrameName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name || name.length > 120) return undefined;
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return undefined;
  }
  return name;
}

function designIds(value: unknown): string[] {
  const input = objectValue(value);
  if (!input) return [];
  const ids = new Set<string>();
  const add = (candidate: unknown) => {
    if (typeof candidate === 'string' && IDENTIFIER.test(candidate)) ids.add(candidate);
  };
  add(input.designId);
  const frames = Array.isArray(input.frames) ? input.frames : [];
  for (const frame of frames.slice(0, 50)) add(objectValue(frame)?.designId);
  return [...ids];
}

function resultReferences(
  text: string | undefined,
): Pick<CanvasToolBinding, 'designIds' | 'revisionId' | 'frameNames'> {
  if (!text || text.length > 256_000) return { designIds: [] };
  try {
    const value: unknown = JSON.parse(text);
    const record = objectValue(value);
    const revisionId = record?.revisionId;
    const frames = Array.isArray(record?.frames) ? record.frames : [];
    const frameNames = frames.slice(0, 50).flatMap((frame) => {
      const name = safeFrameName(objectValue(frame)?.name);
      return name ? [name] : [];
    });
    return {
      designIds: designIds(value),
      ...(typeof revisionId === 'string' && IDENTIFIER.test(revisionId) ? { revisionId } : {}),
      ...(frameNames.length ? { frameNames } : {}),
    };
  } catch {
    return { designIds: [] };
  }
}

function bindingSource(event: TranscriptEvent): string {
  return event.role === 'primary' ? 'primary' : event.sourceSessionId;
}

function bindingKey(sourceSessionId: string, toolUseId: string): string {
  return `${sourceSessionId}\0${toolUseId}`;
}

function bindingFrom(
  provenance: ToolProvenance,
  event: TranscriptEvent,
): CanvasToolBinding | undefined {
  if (provenance.serverName !== CANVAS_MCP_SERVER_NAME || !provenance.toolUseId) return undefined;
  const toolName = CANVAS_TOOL_NAMES.find((name) => name === provenance.toolName);
  if (!toolName) return undefined;
  return {
    toolUseId: provenance.toolUseId,
    sourceSessionId: bindingSource(event),
    action: ACTIONS[toolName],
    designIds: designIds(event.toolArgs),
  };
}

function activity(binding: CanvasToolBinding, event: TranscriptEvent): CanvasActivity {
  let state: CanvasActivity['state'] = 'completed';
  if (event.kind === 'tool_call') state = 'running';
  else if (event.kind === 'error' || event.isError || event.interrupted) state = 'failed';
  const verb = VERBS[binding.action];
  let message: string = verb[1];
  if (event.interrupted) message = 'Canvas tool stopped.';
  else if (state === 'running') message = verb[0];
  else if (state === 'failed') message = verb[2];
  if (state === 'completed' && binding.action === 'write' && binding.revisionId)
    message = `${message} · ${binding.revisionId}`;
  if (state === 'completed' && binding.action === 'create' && binding.frameNames?.length === 1)
    message = `Created ${binding.frameNames[0]}`;
  return {
    toolUseId: binding.toolUseId,
    action: binding.action,
    designIds: binding.designIds,
    state,
    message,
  };
}

export class CanvasToolPresentation {
  private readonly bindings = new Map<string, CanvasToolBinding>();

  constructor(
    bindings: Iterable<CanvasToolBinding> = [],
    private readonly remember?: (binding: CanvasToolBinding) => void,
  ) {
    for (const binding of bindings)
      this.bindings.set(bindingKey(binding.sourceSessionId, binding.toolUseId), binding);
  }

  hasBinding(event: TranscriptEvent): boolean {
    return Boolean(
      event.toolUseId && this.bindings.has(bindingKey(bindingSource(event), event.toolUseId)),
    );
  }

  clearBindings(sourceSessionId: string): void {
    for (const [key, binding] of this.bindings) {
      if (binding.sourceSessionId === sourceSessionId) this.bindings.delete(key);
    }
  }

  project(event: TranscriptEvent, provenance?: ToolProvenance): TranscriptEvent {
    if (event.kind !== 'tool_call' && event.kind !== 'tool_result' && event.kind !== 'error')
      return event;
    if (canvasToolName(event.toolName) && !event.toolUseId) {
      return {
        ...event,
        kind: 'error',
        toolName: undefined,
        toolArgs: undefined,
        text: 'Canvas tool event lacked a tool-use ID.',
        isError: true,
      };
    }
    provenance ??= canvasToolProvenance(event.toolName, event.toolUseId);
    const toolUseId = event.canvasActivity?.toolUseId ?? event.toolUseId;
    const key = toolUseId ? bindingKey(bindingSource(event), toolUseId) : undefined;
    let binding = key ? this.bindings.get(key) : undefined;
    if (binding && event.toolName && !provenance && !event.canvasActivity) {
      if (key) this.bindings.delete(key);
      return event;
    }
    if (event.canvasActivity && !binding)
      binding = {
        toolUseId: event.canvasActivity.toolUseId,
        sourceSessionId: bindingSource(event),
        action: event.canvasActivity.action,
        designIds: event.canvasActivity.designIds,
      };
    if (provenance && (event.kind === 'tool_call' || !binding)) {
      const next = bindingFrom(provenance, event);
      if (next) {
        let selected = binding;
        if (selected?.action !== next.action) selected = next;
        else if (next.designIds.length) {
          selected = {
            ...selected,
            designIds: [...new Set([...selected.designIds, ...next.designIds])],
          };
        }
        if (
          binding?.action !== selected.action ||
          binding.designIds.join() !== selected.designIds.join()
        ) {
          binding = selected;
          this.remember?.(binding);
          this.bindings.set(bindingKey(binding.sourceSessionId, binding.toolUseId), binding);
        }
      }
    }
    if (!binding) return event;
    if (event.kind === 'tool_result') {
      const { designIds: ids, revisionId, frameNames } = resultReferences(event.text);
      const knownIds = binding.designIds;
      const nextFrameNames = frameNames?.join();
      if (
        ids.some((id) => !knownIds.includes(id)) ||
        (revisionId && revisionId !== binding.revisionId) ||
        (nextFrameNames !== undefined && nextFrameNames !== binding.frameNames?.join())
      ) {
        binding = {
          ...binding,
          designIds: [...new Set([...binding.designIds, ...ids])],
          ...(revisionId ? { revisionId } : {}),
          ...(frameNames ? { frameNames } : {}),
        };
        this.remember?.(binding);
        this.bindings.set(bindingKey(binding.sourceSessionId, binding.toolUseId), binding);
      }
    }
    const shown = activity(binding, event);
    return {
      ...event,
      kind: event.kind === 'error' ? 'tool_result' : event.kind,
      toolName: `Canvas ${binding.action}`,
      toolArgs: undefined,
      text: event.kind !== 'tool_call' ? shown.message : undefined,
      canvasActivity: shown,
    };
  }
}
