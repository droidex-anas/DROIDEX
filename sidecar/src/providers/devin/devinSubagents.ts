import type { SessionNotification } from '@agentclientprotocol/sdk/unstable';
import type { NormalizedEvent } from '../../normalize.js';
import type { ChildSessionSignal } from '../../subagentSignals.js';
import { objectValue, trimmedString } from '../../values.js';
import type { ProviderChildSession } from '../session.js';
import { DevinEvents } from './devinEvents.js';

export function devinChildId(update: {
  _meta?: Record<string, unknown> | null;
}): string | undefined {
  const context = objectValue(update._meta?.['cognition.ai/subagent_context']);
  const id = trimmedString(context?.parentAgentId);
  return id === 'root' ? undefined : id;
}

interface DevinChild {
  signal: ChildSessionSignal;
  mapper: DevinEvents;
  permissions: AbortController;
}

function lifecycleMeta({ update }: SessionNotification): Record<string, unknown> | undefined {
  if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return;
  const meta = update._meta;
  if (
    meta &&
    ('cognition.ai/subagent_started' in meta || 'cognition.ai/subagent_completed' in meta)
  )
    return meta;
  return undefined;
}

export class DevinSubagents {
  private readonly children = new Map<string, DevinChild>();
  private readonly replayedChildren = new Set<string>();

  constructor(
    private readonly appSessionId: string,
    private readonly parentSessionId: string,
  ) {}

  restore(children: readonly ProviderChildSession[]): void {
    for (const child of children) {
      if (child.providerSessionId === this.parentSessionId) continue;
      const observed = this.children.get(child.providerSessionId)?.signal;
      this.child(child.providerSessionId, {
        providerSessionId: child.providerSessionId,
        role: child.role,
        status: child.status,
        reasoningEffort: child.reasoningEffort,
        transcriptAvailable: child.transcriptAvailable,
        streamFidelity: 'token',
        ...observed,
        modelId: observed?.modelId ?? child.modelId,
      });
    }
  }

  replay(notification: SessionNotification): void {
    const meta = lifecycleMeta(notification);
    if (!meta) return;
    for (const event of this.lifecycle(meta)) {
      const id = event.childSession?.providerSessionId;
      if (id) this.replayedChildren.add(id);
    }
  }

  takeReplayedChildren(): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    for (const id of this.replayedChildren) {
      const child = this.children.get(id);
      if (child && !settled(child.signal)) events.push({ childSession: child.signal });
    }
    this.replayedChildren.clear();
    return events;
  }

  permissionSignal(id: string): AbortSignal | undefined {
    const child = this.children.get(id);
    return child && !child.signal.done && child.signal.status === 'running'
      ? child.permissions.signal
      : undefined;
  }

  cancelPermissions(): void {
    for (const child of this.children.values()) {
      child.permissions.abort();
      child.permissions = new AbortController();
    }
  }

  close(): void {
    for (const child of this.children.values()) child.permissions.abort();
    this.children.clear();
    this.replayedChildren.clear();
  }

  // Undefined leaves a primary update to the parent's mapper; an empty array
  // consumes child traffic that cannot safely be attributed.
  map(notification: SessionNotification): NormalizedEvent[] | undefined {
    const { update } = notification;
    const meta = lifecycleMeta(notification);
    if (meta) return this.lifecycle(meta);
    const id = devinChildId(update);
    if (!id) return undefined;
    const child = this.children.get(id);
    if (!child || settled(child.signal)) return [];
    // Child context updates have no verified independent spend accounting.
    if (update.sessionUpdate === 'usage_update') return [];
    return this.owned(id, child.mapper.map(notification));
  }

  private lifecycle(meta: Record<string, unknown>): NormalizedEvent[] {
    const started = objectValue(meta['cognition.ai/subagent_started']);
    const completed = objectValue(meta['cognition.ai/subagent_completed']);
    const id = trimmedString((completed ?? started)?.agentId);
    if (!id || id === 'root' || id === this.parentSessionId) return [];
    const known = this.children.get(id);
    if (known && settled(known.signal)) return [];
    let status: ChildSessionSignal['status'] = 'running';
    if (completed) status = completed.success === false ? 'failed' : 'completed';
    const summary = trimmedString(completed?.summary);
    const child = this.child(id, {
      ...known?.signal,
      providerSessionId: id,
      ...(started
        ? {
            label: trimmedString(started.title),
            prompt: trimmedString(started.task),
            modelId: trimmedString(started.model),
          }
        : {}),
      status,
      done: Boolean(completed),
      ...(completed
        ? { activity: { phase: status, ...(summary ? { preview: summary } : {}) } }
        : {}),
      transcriptAvailable: true,
      streamFidelity: 'token',
    });
    if (completed) child.permissions.abort();
    const events: NormalizedEvent[] = [{ childSession: child.signal }];
    if (summary)
      events.push(
        ...this.owned(
          id,
          child.mapper.map({
            sessionId: this.parentSessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: summary },
            },
          }),
        ),
      );
    return events;
  }

  private child(id: string, signal: ChildSessionSignal): DevinChild {
    const known = this.children.get(id);
    if (known) {
      known.signal = signal;
      return known;
    }
    const child: DevinChild = {
      signal,
      mapper: new DevinEvents(this.appSessionId, id, signal.role ?? 'worker'),
      permissions: new AbortController(),
    };
    this.children.set(id, child);
    return child;
  }

  private owned(id: string, events: NormalizedEvent[]): NormalizedEvent[] {
    return events.map((event) => ({ ...event, childOwner: { kind: 'provider-session', id } }));
  }
}

function settled(signal: ChildSessionSignal): boolean {
  return signal.done === true || signal.status === 'completed' || signal.status === 'failed';
}
