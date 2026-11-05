import {
  CANVAS_MCP_SERVER_NAME,
  CANVAS_TOOL_NAMES,
  type CanvasToolName,
} from './canvasMcpNames.js';
import type { TranscriptEvent } from '../protocol.js';
import { objectValue } from '../values.js';

export interface CanvasActivity {
  toolUseId: string;
  action: 'create' | 'write' | 'inspect' | 'arrange' | 'annotate' | 'theme';
  designIds: string[];
  state: 'running' | 'completed' | 'failed';
  message: string;
  /** The canvas a create or write changed, as its reply named it. */
  canvasId?: string;
  /** The name of the first frame a create reserved. */
  title?: string;
  /** This create gave an unattached chat its canvas, so it is the chat's first artifact. */
  firstArtifact?: true;
  /** The kit a theme call saved, proposed or applied; its reference only, never its content. */
  designSystem?: KitReference;
}

/** A proposal's version is the one it was made on. */
export interface KitReference {
  id: string;
  version: number;
  status: 'saved' | 'proposed' | 'applied';
}

const THEME_OPERATIONS = ['list', 'read', 'save', 'apply'] as const;
type ThemeOperation = (typeof THEME_OPERATIONS)[number];

export interface ToolProvenance {
  serverName: string;
  toolName: string;
  toolUseId: string;
}

export interface CanvasToolBinding {
  occurrenceId: string;
  toolUseId: string;
  sourceSessionId: string;
  action: CanvasActivity['action'];
  designIds: string[];
  revisionId?: string;
  frameNames?: string[];
  canvasId?: string;
  firstArtifact?: true;
  /** What a theme call was asked to do, which its messages name. */
  themeOperation?: ThemeOperation;
  designSystem?: KitReference;
}

type ResultReferences = Pick<
  CanvasToolBinding,
  'designIds' | 'revisionId' | 'frameNames' | 'canvasId' | 'firstArtifact' | 'designSystem'
>;

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const ACTIONS: Record<CanvasToolName, CanvasActivity['action']> = {
  canvas_read: 'inspect',
  canvas_create: 'create',
  canvas_write: 'write',
  canvas_inspect: 'inspect',
  canvas_arrange: 'arrange',
  canvas_annotate: 'annotate',
  canvas_theme: 'theme',
};
const VERBS = {
  create: ['Creating designs', 'Created designs', 'Could not create designs'],
  write: ['Updating design', 'Updated design', 'Could not update design'],
  inspect: ['Inspecting canvas', 'Inspected canvas', 'Could not inspect canvas'],
  arrange: ['Arranging designs', 'Arranged designs', 'Could not arrange designs'],
  annotate: ['Annotating canvas', 'Annotated canvas', 'Could not annotate canvas'],
  theme: ['Reading design system', 'Read design system', 'Could not read design system'],
} as const;
const THEME_VERBS: Record<ThemeOperation, readonly [string, string, string]> = {
  list: VERBS.theme,
  read: VERBS.theme,
  save: ['Saving design system', 'Saved design system', 'Could not save design system'],
  apply: ['Applying design system', 'Applied design system', 'Could not apply design system'],
};

function canvasToolName(name: string | undefined): CanvasToolName | undefined {
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
    if (isIdentifier(candidate)) ids.add(candidate);
  };
  add(input.designId);
  const frames = Array.isArray(input.frames) ? input.frames : [];
  for (const frame of frames.slice(0, 50)) add(objectValue(frame)?.designId);
  return [...ids];
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

export function kitReference(value: unknown): KitReference | undefined {
  const kit = objectValue(value);
  if (!kit) return undefined;
  const { id, version, status } = kit;
  if (status !== 'saved' && status !== 'proposed' && status !== 'applied') return undefined;
  if (!isIdentifier(id) || typeof version !== 'number' || !Number.isSafeInteger(version))
    return undefined;
  return version < 1 ? undefined : { id, version, status };
}

// A save answers with the kit it saved or the base it proposed on; apply with the kit it applied.
function kitIn(record: Record<string, unknown> | undefined): KitReference | undefined {
  if (record?.status === 'proposed')
    return kitReference({ id: record.id, version: record.baseVersion, status: 'proposed' });
  if (record?.status === 'saved' || record?.status === 'applied')
    return kitReference({ ...objectValue(record.ref), status: record.status });
  return undefined;
}

export function themeOperation(value: unknown): ThemeOperation | undefined {
  return THEME_OPERATIONS.find((operation) => operation === value);
}

function resultReferences(text: string | undefined): ResultReferences {
  if (!text || text.length > 256_000) return { designIds: [] };
  try {
    return referencesIn(objectValue(JSON.parse(text)));
  } catch {
    return { designIds: [] };
  }
}

function referencesIn(record: Record<string, unknown> | undefined): ResultReferences {
  // A create answers under `created` and a write under `receipt`; reads answer at the top.
  const answer = objectValue(record?.created) ?? objectValue(record?.receipt) ?? record;
  const revisionId = answer?.revisionId;
  const canvasId = answer?.canvasId ?? record?.canvasId;
  const frameNames = safeFrameNames(answer?.frames);
  const designSystem = kitIn(record);
  return {
    designIds: designIds(answer),
    ...(isIdentifier(revisionId) ? { revisionId } : {}),
    ...(isIdentifier(canvasId) ? { canvasId } : {}),
    ...(frameNames.length ? { frameNames } : {}),
    ...(record?.chatAttached === true ? { firstArtifact: true } : {}),
    ...(designSystem ? { designSystem } : {}),
  };
}

function safeFrameNames(value: unknown): string[] {
  const frames = Array.isArray(value) ? value : [];
  return frames.slice(0, 50).flatMap((frame) => {
    const name = safeFrameName(objectValue(frame)?.name);
    return name ? [name] : [];
  });
}

/** The binding with what its result named, or the same binding when it named nothing new. */
function withResult(binding: CanvasToolBinding, result: ResultReferences): CanvasToolBinding {
  const { designIds: ids, ...named } = result;
  const changed =
    ids.some((id) => !binding.designIds.includes(id)) ||
    (named.revisionId !== undefined && named.revisionId !== binding.revisionId) ||
    (named.frameNames !== undefined && named.frameNames.join() !== binding.frameNames?.join()) ||
    (named.canvasId !== undefined && named.canvasId !== binding.canvasId) ||
    (named.firstArtifact === true && binding.firstArtifact !== true) ||
    (named.designSystem !== undefined &&
      !sameKitReference(named.designSystem, binding.designSystem));
  if (!changed) return binding;
  return { ...binding, ...named, designIds: [...new Set([...binding.designIds, ...ids])] };
}

function sameKitReference(a: KitReference, b: KitReference | undefined): boolean {
  return a.id === b?.id && a.version === b.version && a.status === b.status;
}

function bindingSource(event: TranscriptEvent): string {
  return event.role === 'primary' ? 'primary' : event.sourceSessionId;
}

function bindingKey(sourceSessionId: string, toolUseId: string, occurrenceId: string): string {
  return `${sourceSessionId}\0${toolUseId}\0${occurrenceId}`;
}

function bindingFrom(
  provenance: ToolProvenance,
  event: TranscriptEvent,
): CanvasToolBinding | undefined {
  if (provenance.serverName !== CANVAS_MCP_SERVER_NAME || !provenance.toolUseId) return undefined;
  const toolName = CANVAS_TOOL_NAMES.find((name) => name === provenance.toolName);
  if (!toolName) return undefined;
  const operation =
    toolName === 'canvas_theme'
      ? themeOperation(objectValue(event.toolArgs)?.operation)
      : undefined;
  return {
    occurrenceId: event.id,
    toolUseId: provenance.toolUseId,
    sourceSessionId: bindingSource(event),
    action: ACTIONS[toolName],
    designIds: designIds(event.toolArgs),
    ...(operation ? { themeOperation: operation } : {}),
  };
}

function activity(binding: CanvasToolBinding, event: TranscriptEvent): CanvasActivity {
  let state: CanvasActivity['state'] = 'completed';
  if (event.kind === 'tool_call') state = 'running';
  else if (event.kind === 'error' || event.isError || event.interrupted) state = 'failed';
  const verb = binding.themeOperation ? THEME_VERBS[binding.themeOperation] : VERBS[binding.action];
  let message = completedMessage(binding, verb[1]);
  if (event.interrupted) message = 'Canvas tool stopped.';
  else if (state === 'running') message = verb[0];
  else if (state === 'failed') message = verb[2];
  const kit =
    state === 'completed' && binding.action === 'theme' ? binding.designSystem : undefined;
  return {
    toolUseId: binding.toolUseId,
    action: binding.action,
    designIds: binding.designIds,
    state,
    message,
    ...artifactNames(binding),
    ...(kit ? { designSystem: kit } : {}),
  };
}

function completedMessage(binding: CanvasToolBinding, done: string): string {
  if (binding.action === 'theme' && binding.designSystem) return kitMessage(binding.designSystem);
  if (binding.action === 'write' && binding.revisionId) return `${done} · ${binding.revisionId}`;
  if (binding.action === 'create' && binding.frameNames?.length === 1)
    return `Created ${binding.frameNames[0]}`;
  return done;
}

// Names the kit by id only: its name is the user's content and stays out of the transcript.
function kitMessage({ id, version, status }: KitReference): string {
  if (status === 'proposed') return `Proposed changes to design system ${id}`;
  return `${status === 'saved' ? 'Created' : 'Applied'} design system ${id} · v${String(version)}`;
}

/** What names the artifact a create or write made, for the transcript's card. */
function artifactNames(
  binding: CanvasToolBinding,
): Pick<CanvasActivity, 'canvasId' | 'title' | 'firstArtifact'> {
  return {
    ...(binding.canvasId ? { canvasId: binding.canvasId } : {}),
    ...(binding.frameNames?.length ? { title: binding.frameNames[0] } : {}),
    ...(binding.firstArtifact ? { firstArtifact: true } : {}),
  };
}

export class CanvasToolPresentation {
  private readonly bindings = new Map<string, CanvasToolBinding>();
  private readonly active = new Map<string, CanvasToolBinding>();
  private readonly settled = new Set<string>();

  constructor(
    bindings: Iterable<CanvasToolBinding> = [],
    private readonly remember?: (binding: CanvasToolBinding) => void,
  ) {
    const candidates = new Map<string, Map<string, CanvasToolBinding>>();
    for (const binding of bindings) {
      this.bindings.set(
        bindingKey(binding.sourceSessionId, binding.toolUseId, binding.occurrenceId),
        binding,
      );
      const key = `${binding.sourceSessionId}\0${binding.toolUseId}`;
      const occurrences = candidates.get(key) ?? new Map<string, CanvasToolBinding>();
      occurrences.set(binding.occurrenceId, binding);
      candidates.set(key, occurrences);
    }
    for (const [key, occurrences] of candidates) {
      if (occurrences.size === 1) {
        for (const binding of occurrences.values()) this.active.set(key, binding);
      }
    }
  }

  hasBinding(event: TranscriptEvent): boolean {
    return Boolean(
      event.toolUseId && this.active.has(`${bindingSource(event)}\0${event.toolUseId}`),
    );
  }

  clearBindings(sourceSessionId: string): void {
    for (const [key, binding] of this.active) {
      if (binding.sourceSessionId === sourceSessionId) this.active.delete(key);
    }
    for (const [key, binding] of this.bindings) {
      if (binding.sourceSessionId === sourceSessionId) {
        this.bindings.delete(key);
        this.settled.delete(key);
      }
    }
  }

  project(
    event: TranscriptEvent,
    provenance?: ToolProvenance,
    occurrenceId?: string,
  ): TranscriptEvent {
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
    const source = bindingSource(event);
    const activeKey = toolUseId ? `${source}\0${toolUseId}` : undefined;
    if (event.toolName && !provenance && !event.canvasActivity) {
      if (activeKey) this.active.delete(activeKey);
      return event;
    }
    let binding = activeKey ? this.active.get(activeKey) : undefined;
    if (occurrenceId && toolUseId)
      binding = this.bindings.get(bindingKey(source, toolUseId, occurrenceId));
    if (
      event.kind === 'tool_call' &&
      binding &&
      this.settled.has(bindingKey(source, binding.toolUseId, binding.occurrenceId))
    )
      binding = undefined;
    if (event.canvasActivity && !binding)
      binding = {
        occurrenceId: occurrenceId ?? event.id,
        toolUseId: event.canvasActivity.toolUseId,
        sourceSessionId: bindingSource(event),
        action: event.canvasActivity.action,
        designIds: event.canvasActivity.designIds,
        ...(event.canvasActivity.designSystem
          ? { designSystem: event.canvasActivity.designSystem }
          : {}),
      };
    if (provenance && (event.kind === 'tool_call' || !binding)) {
      const next = bindingFrom(provenance, event);
      if (next) {
        next.occurrenceId = occurrenceId ?? binding?.occurrenceId ?? event.id;
        let selected = binding;
        if (selected?.action !== next.action) selected = next;
        else {
          selected = {
            ...selected,
            occurrenceId: next.occurrenceId,
            designIds: [...new Set([...selected.designIds, ...next.designIds])],
            ...(next.themeOperation ? { themeOperation: next.themeOperation } : {}),
          };
        }
        if (
          binding?.occurrenceId !== selected.occurrenceId ||
          binding.action !== selected.action ||
          binding.designIds.join() !== selected.designIds.join() ||
          binding.themeOperation !== selected.themeOperation
        ) {
          binding = selected;
          this.remember?.(binding);
          this.bindings.set(
            bindingKey(binding.sourceSessionId, binding.toolUseId, binding.occurrenceId),
            binding,
          );
        }
      }
    }
    if (!binding) return event;
    if (activeKey) this.active.set(activeKey, binding);
    if (event.kind === 'tool_result') {
      const named = withResult(binding, resultReferences(event.text));
      if (named !== binding) {
        binding = named;
        this.remember?.(binding);
        this.bindings.set(
          bindingKey(binding.sourceSessionId, binding.toolUseId, binding.occurrenceId),
          binding,
        );
        if (activeKey) this.active.set(activeKey, binding);
      }
    }
    const shown = activity(binding, event);
    if (event.kind !== 'tool_call')
      this.settled.add(bindingKey(source, binding.toolUseId, binding.occurrenceId));
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
