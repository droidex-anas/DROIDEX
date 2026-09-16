import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { NormalizedEvent } from '../../normalize.js';
import type { ChildSessionSignal } from '../../subagentSignals.js';

type SystemMessage = Extract<SDKMessage, { type: 'system' }>;
type TaskStarted = Extract<SystemMessage, { subtype: 'task_started' }>;
type TaskProgress = Extract<SystemMessage, { subtype: 'task_progress' }>;
type TaskUpdated = Extract<SystemMessage, { subtype: 'task_updated' }>;
type BackgroundTasks = Extract<SystemMessage, { subtype: 'background_tasks_changed' }>;

export class ClaudeSubagents {
  private readonly children = new Map<string, ChildSessionSignal>();
  private readonly workflows = new Map<string, { name: string; toolUseId?: string }>();
  private backgroundTaskIds = new Set<string>();
  private turnSpawnToolUseId?: string;

  beginTurn(): void {
    this.turnSpawnToolUseId = undefined;
  }

  noteToolUse(name: string, id: string): void {
    if (name === 'Task' || name === 'Agent' || name === 'Workflow') this.turnSpawnToolUseId = id;
  }

  map(message: SystemMessage, modelId: string | undefined): NormalizedEvent[] {
    switch (message.subtype) {
      case 'task_started':
        return this.started(message, modelId);
      case 'task_progress':
        return this.progress(message, modelId);
      case 'task_updated':
        return this.updated(message);
      case 'task_notification':
        this.workflows.delete(message.task_id);
        if (!this.children.has(message.task_id)) return [];
        return this.update(message.task_id, {
          ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
          status: message.status === 'completed' ? 'completed' : 'failed',
        });
      case 'background_tasks_changed':
        return this.backgroundTasksChanged(message);
      default:
        return [];
    }
  }

  private started(message: TaskStarted, modelId: string | undefined): NormalizedEvent[] {
    if (message.ambient || message.skip_transcript) return [];
    if (message.task_type === 'local_workflow') {
      if (message.workflow_name)
        this.workflows.set(message.task_id, {
          name: message.workflow_name,
          toolUseId: message.tool_use_id ?? this.turnSpawnToolUseId,
        });
      return [];
    }
    if (message.task_type !== 'local_agent' && !message.subagent_type) return [];
    const workflow = this.workflowFor(message.tool_use_id);
    const toolUseId = message.tool_use_id ?? workflow?.toolUseId ?? this.turnSpawnToolUseId;
    return this.update(message.task_id, {
      toolUseId,
      label: message.description,
      ...(message.prompt ? { prompt: message.prompt } : {}),
      ...(modelId ? { modelId } : {}),
      ...(workflow ? { group: workflow.name } : {}),
      status: 'running',
    });
  }

  private progress(message: TaskProgress, modelId: string | undefined): NormalizedEvent[] {
    const known = this.children.get(message.task_id);
    if (!known && !message.subagent_type) return [];
    return this.update(message.task_id, {
      ...(!known ? { modelId, label: message.description, status: 'running' } : {}),
      ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
      activity: { preview: message.summary ?? message.description },
    });
  }

  private updated(message: TaskUpdated): NormalizedEvent[] {
    const { status, description } = message.patch;
    if (this.workflows.has(message.task_id)) {
      if (status === 'completed' || status === 'failed' || status === 'killed')
        this.workflows.delete(message.task_id);
      return [];
    }
    if (!this.children.has(message.task_id)) return [];
    return this.update(message.task_id, {
      ...(status ? { status: status === 'killed' ? 'failed' : status } : {}),
      ...(description ? { activity: { preview: description } } : {}),
    });
  }

  private backgroundTasksChanged(message: BackgroundTasks): NormalizedEvent[] {
    const current = new Set(
      message.tasks
        .filter((task) => task.task_type === 'local_agent' && !task.ambient)
        .map((task) => task.task_id),
    );
    const events: NormalizedEvent[] = [];
    // This list covers background work only. Disappearance is not proof of success.
    for (const id of this.backgroundTaskIds) {
      const child = this.children.get(id);
      if (!current.has(id) && child && (child.status === 'running' || child.status === 'pending'))
        events.push(...this.update(id, { status: 'paused' }));
    }
    this.backgroundTaskIds = current;
    return events;
  }

  private workflowFor(
    toolUseId: string | undefined,
  ): { name: string; toolUseId?: string } | undefined {
    for (const workflow of this.workflows.values())
      if (toolUseId && workflow.toolUseId === toolUseId) return workflow;
    // Internal workflow agents may have no tool-use block of their own.
    return !toolUseId && this.workflows.size === 1
      ? this.workflows.values().next().value
      : undefined;
  }

  private update(taskId: string, patch: Partial<ChildSessionSignal>): NormalizedEvent[] {
    const child: ChildSessionSignal = {
      ...this.children.get(taskId),
      ...patch,
      providerSessionId: taskId,
      transcriptAvailable: false,
    };
    this.children.set(taskId, child);
    return [{ childSession: child }];
  }
}
