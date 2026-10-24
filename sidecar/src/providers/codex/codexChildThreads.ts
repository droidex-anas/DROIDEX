import type { NormalizedEvent } from '../../normalize.js';
import type { ChildRole } from '../../protocol.js';
import { errMsg } from '../../errors.js';
import type { ProviderChildSession, ProviderModelSettings } from '../session.js';
import type { AppServerClient } from './appServer.js';
import { CodexEventMapper, errorOf, isObject, turnOf } from './codexEvents.js';
import { threadItem, toolCall, type ThreadItem } from './codexItems.js';
import type { CodexRateLimits } from './codexRateLimits.js';

// Child threads share their parent's app-server connection, but each owns its
// item correlation and turn lifecycle. Their rows never enter the parent turn.
export class CodexChildThreads {
  private readonly threads = new Map<string, { mapper: CodexEventMapper; role: ChildRole }>();
  private readonly settled = new Set<string>();
  private readonly recoveredItems = new Map<string, Set<string>>();
  private readonly snapshots = new Map<
    string,
    Map<string, { kind: 'text' | 'thinking'; text: string }>
  >();
  private readonly restoredCalls = new Map<string, Set<string>>();
  private readonly recovering = new Map<string, { method: string; params: unknown }[]>();
  private readonly heldNotifications: { method: string; params: unknown }[] = [];
  private observing = false;
  private generation = 0;

  constructor(
    private readonly appSessionId: string,
    private model: ProviderModelSettings,
    private readonly usage: CodexRateLimits,
    private readonly rootThreadId: () => string | undefined,
  ) {}

  setModel(model: ProviderModelSettings): void {
    this.model = model;
  }

  start(): NormalizedEvent[] {
    this.observing = true;
    return this.heldNotifications
      .splice(0)
      .flatMap(({ method, params }) => this.map(method, params) ?? []);
  }

  observe(events: NormalizedEvent[]): NormalizedEvent[] {
    return events.flatMap((event) => {
      const child = event.childSession;
      const id = child?.providerSessionId;
      if (!id) return [event];
      // A child's code-mode activity can refer to the parent without spawning it.
      if (id === this.rootThreadId()) return [];
      if (child.done || child.status === 'completed' || child.status === 'failed')
        this.settled.add(id);
      else if (child.status === 'running') this.settled.delete(id);
      const existing = this.threads.get(id);
      if (existing) {
        if (child.role) existing.role = child.role;
        return [{ ...event, childSession: { ...child, role: existing.role } }];
      }
      this.threads.set(id, {
        role: child.role ?? 'worker',
        mapper: new CodexEventMapper(this.appSessionId, {
          modelId: child.modelId ?? this.model.modelId,
          reasoningEffort: child.reasoningEffort ?? this.model.reasoningEffort,
        }),
      });
      return [{ ...event, childSession: { ...child, role: child.role ?? 'worker' } }];
    });
  }

  started(params: unknown): NormalizedEvent[] {
    if (!isObject(params) || !isObject(params.thread)) return [];
    const parent = params.thread.parentThreadId;
    if (typeof parent !== 'string') return [];
    return this.threads.get(parent)?.mapper.childThreadStarted(params, parent) ?? [];
  }

  restore(
    client: AppServerClient,
    children: readonly ProviderChildSession[],
    deliver: (events: NormalizedEvent[]) => void,
  ): void {
    for (const child of children) {
      this.observe([{ childSession: child }]);
      if (child.transcriptAvailable) continue;
      const threadId = child.providerSessionId;
      const mapper = this.threads.get(threadId)?.mapper;
      if (!mapper || this.recovering.has(threadId)) continue;
      const queued: { method: string; params: unknown }[] = [];
      this.recovering.set(threadId, queued);
      const generation = this.generation;
      void this.readHistory(client, threadId, mapper, generation).then(
        (events) => {
          if (generation !== this.generation) return;
          this.recovering.delete(threadId);
          deliver(events);
          for (const notification of queued)
            deliver(this.map(notification.method, notification.params) ?? []);
          this.recoveredItems.delete(threadId);
          this.restoredCalls.delete(threadId);
        },
        (error: unknown) => {
          if (generation !== this.generation) return;
          this.recovering.delete(threadId);
          this.recoveredItems.delete(threadId);
          this.snapshots.delete(threadId);
          this.restoredCalls.delete(threadId);
          deliver([
            this.owned(
              mapper.errorEvent(
                new Error(
                  `Could not read Codex agent transcript: ${errMsg(error)}. Reopen the parent chat to retry.`,
                ),
              ),
              threadId,
            ),
          ]);
          for (const notification of queued)
            deliver(this.map(notification.method, notification.params) ?? []);
        },
      );
    }
  }

  private async readHistory(
    client: AppServerClient,
    threadId: string,
    mapper: CodexEventMapper,
    generation: number,
  ): Promise<NormalizedEvent[]> {
    const events: NormalizedEvent[] = [];
    const recovered = new Set<string>();
    this.recoveredItems.set(threadId, recovered);
    const snapshots = new Map<string, { kind: 'text' | 'thinking'; text: string }>();
    this.snapshots.set(threadId, snapshots);
    const calls = new Set<string>();
    this.restoredCalls.set(threadId, calls);
    let cursor: string | null = null;
    do {
      const response: unknown = await client.request('thread/turns/list', {
        threadId,
        sortDirection: 'asc',
        itemsView: 'full',
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (generation !== this.generation) return [];
      if (
        !isObject(response) ||
        !Array.isArray(response.data) ||
        (response.nextCursor !== null && typeof response.nextCursor !== 'string')
      )
        throw new Error('Codex returned an invalid child history page');
      const turns: unknown[] = response.data;
      for (const value of turns) {
        const turn = turnOf({ turn: value }, this.usage);
        if (!turn || !isObject(value) || !Array.isArray(value.items))
          throw new Error('Codex returned an invalid child history turn');
        mapper.beginTurn();
        const items: unknown[] = value.items;
        for (const item of items) {
          const parsed = threadItem({ item });
          if (parsed.type === 'ignored') continue;
          const text = itemText(parsed);
          if (turn.status === 'inProgress' && text?.text) snapshots.set(parsed.id, text);
          const call = toolCall(parsed);
          if (call && parsed.type !== 'functionCallOutput') {
            events.push(...mapper.map('item/started', { threadId, item }));
            if ('status' in parsed && parsed.status === 'inProgress') {
              calls.add(parsed.id);
              continue;
            }
          }
          if (!snapshots.has(parsed.id)) recovered.add(parsed.id);
          events.push(...mapper.map('item/completed', { threadId, turnId: turn.id, item }));
        }
        events.push(this.status(threadId, childStatus(turn.status)));
      }
      cursor = response.nextCursor;
    } while (cursor);
    events.unshift({
      childSession: {
        providerSessionId: threadId,
        transcriptAvailable: true,
        streamFidelity: 'token',
      },
    });
    return events.map((event) => this.owned(event, threadId));
  }

  map(method: string, params: unknown): NormalizedEvent[] | undefined {
    if (!isObject(params) || typeof params.threadId !== 'string') return undefined;
    const threadId = params.threadId;
    const mapper = this.threads.get(threadId)?.mapper;
    if (!mapper) return undefined;
    if (!this.observing) {
      this.heldNotifications.push({ method, params });
      return [];
    }
    const queued = this.recovering.get(threadId);
    if (queued) {
      queued.push({ method, params });
      return [];
    }
    if (
      this.settled.has(threadId) &&
      method !== 'turn/started' &&
      method !== 'turn/completed' &&
      method !== 'error'
    )
      return [];
    const restored = this.reconcileItem(method, params, threadId, mapper);
    if (restored) return restored;
    const events = this.lifecycle(method, params, threadId, mapper) ?? mapper.map(method, params);
    return this.observe(events).map((event) => this.owned(event, threadId));
  }

  private reconcileItem(
    method: string,
    params: Record<string, unknown>,
    threadId: string,
    mapper: CodexEventMapper,
  ): NormalizedEvent[] | undefined {
    let itemId = typeof params.itemId === 'string' ? params.itemId : undefined;
    if (!itemId && isObject(params.item) && typeof params.item.id === 'string')
      itemId = params.item.id;
    if (!itemId) return undefined;
    if (this.recoveredItems.get(threadId)?.has(itemId)) return [];
    if (method === 'item/started' && this.restoredCalls.get(threadId)?.has(itemId)) return [];
    const snapshot = this.snapshots.get(threadId)?.get(itemId);
    if (!snapshot) return undefined;
    if (
      method === 'item/reasoning/textDelta' ||
      method === 'item/reasoning/summaryTextDelta' ||
      method === 'item/agentMessage/delta'
    )
      return [];
    if (method === 'item/completed') {
      this.snapshots.get(threadId)?.delete(itemId);
      const completed = itemText(threadItem(params));
      if (completed?.kind !== snapshot.kind || !completed.text.startsWith(snapshot.text)) {
        return [
          this.owned(
            mapper.errorEvent(
              new Error(
                'Codex changed an active agent item while its history was restored. Reopen the parent chat to read its transcript again.',
              ),
            ),
            threadId,
          ),
        ];
      }
      const delta = completed.text.slice(snapshot.text.length);
      const deltaMethod =
        snapshot.kind === 'text' ? 'item/agentMessage/delta' : 'item/reasoning/textDelta';
      return mapper
        .map(deltaMethod, { ...params, itemId, delta })
        .map((event) => this.owned(event, threadId));
    }
    return undefined;
  }

  private lifecycle(
    method: string,
    params: Record<string, unknown>,
    threadId: string,
    mapper: CodexEventMapper,
  ): NormalizedEvent[] | undefined {
    if (method === 'turn/started') {
      this.settled.delete(threadId);
      mapper.beginTurn();
      return [this.status(threadId, 'running')];
    }
    if (method === 'turn/completed') {
      const turn = turnOf(params, this.usage);
      if (!turn) return [];
      this.settled.add(threadId);
      return [
        ...(turn.error ? [mapper.errorEvent(turn.error)] : []),
        this.status(threadId, childStatus(turn.status)),
      ];
    }
    if (method === 'error') {
      const failure = errorOf(params, this.usage);
      return failure ? [mapper.errorEvent(failure.error)] : [];
    }
    return undefined;
  }

  private owned(event: NormalizedEvent, threadId: string): NormalizedEvent {
    if (event.tokens)
      return {
        childSession: {
          providerSessionId: threadId,
          role: this.threads.get(threadId)?.role,
          tokensUsed: event.tokens.tokensIn + event.tokens.tokensOut,
        },
      };
    if (event.transcript)
      return {
        ...event,
        childOwner: { kind: 'provider-session', id: threadId },
      };
    if (event.childSession) {
      const id = event.childSession.providerSessionId;
      const role = id ? this.threads.get(id)?.role : undefined;
      if (role) return { ...event, childSession: { ...event.childSession, role } };
    }
    return event;
  }

  close(): void {
    this.generation += 1;
    this.heldNotifications.length = 0;
    this.recovering.clear();
    this.recoveredItems.clear();
    this.snapshots.clear();
    this.restoredCalls.clear();
    this.settled.clear();
    this.threads.clear();
  }

  private status(
    providerSessionId: string,
    status: 'running' | 'paused' | 'completed' | 'failed',
  ): NormalizedEvent {
    return {
      childSession: {
        providerSessionId,
        status,
        done: status === 'completed' || status === 'failed',
        transcriptAvailable: true,
        streamFidelity: 'token',
      },
    };
  }
}

function itemText(item: ThreadItem): { kind: 'text' | 'thinking'; text: string } | undefined {
  if (item.type === 'agentMessage') return { kind: 'text', text: item.text };
  if (item.type === 'reasoning')
    return {
      kind: 'thinking',
      text: (item.content.length ? item.content : item.summary).join('\n\n'),
    };
  return undefined;
}

function childStatus(status: string | undefined): 'running' | 'paused' | 'completed' | 'failed' {
  if (status === 'inProgress') return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
  return 'paused';
}
