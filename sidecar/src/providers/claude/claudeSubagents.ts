import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { NormalizedEvent } from '../../normalize.js';
import type { ChildActivity, ChildStatus } from '../../protocol.js';
import { taskPollTargetId, type ChildSessionSignal } from '../../subagentSignals.js';
import { trimmedString as str } from '../../values.js';

type SystemMessage = Extract<SDKMessage, { type: 'system' }>;
type TaskStarted = Extract<SystemMessage, { subtype: 'task_started' }>;
type TaskProgress = Extract<SystemMessage, { subtype: 'task_progress' }>;
type TaskUpdated = Extract<SystemMessage, { subtype: 'task_updated' }>;

interface WorkflowRun {
  name: string;
  toolUseId?: string;
  // Provider ids of the agents this run has reported, so a workflow that stops
  // can settle the ones its last snapshot still showed working.
  agentIds: Set<string>;
}

// One agent inside a workflow's progress snapshot. The CLI sends this array on
// `task_progress` outside the SDK's declared shape, so it is read defensively.
interface WorkflowAgentEntry {
  agentId?: string;
  label?: string;
  model?: string;
  phaseTitle?: string;
  promptPreview?: string;
  resultPreview?: string;
  state?: string;
}

function workflowAgentEntries(message: TaskProgress): WorkflowAgentEntry[] {
  const progress: unknown = Reflect.get(message, 'workflow_progress');
  if (!Array.isArray(progress)) return [];
  return progress.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const read = (key: string) => str(Reflect.get(entry, key));
    return Reflect.get(entry, 'type') === 'workflow_agent'
      ? [
          {
            agentId: read('agentId'),
            label: read('label'),
            model: read('model'),
            phaseTitle: read('phaseTitle'),
            promptPreview: read('promptPreview'),
            resultPreview: read('resultPreview'),
            state: read('state'),
          },
        ]
      : [];
  });
}

// The CLI's own reading of an entry: 'done' and 'error' are terminal, and an
// agent that has an id has left the queue, so anything else is working.
function workflowAgentStatus(state: string | undefined): ChildStatus {
  if (state === 'done') return 'completed';
  if (state === 'error') return 'failed';
  return 'running';
}

// A task that was killed stopped because something asked it to; only a real
// failure wears the failed status.
function taskStatus(status: NonNullable<TaskUpdated['patch']['status']>): ChildStatus {
  return status === 'killed' ? 'paused' : status;
}

// Whether every field this patch would write already holds that value, so the
// snapshot repeats what the row already says.
function writesNothingNew(known: ChildSessionSignal, patch: Partial<ChildSessionSignal>): boolean {
  return Object.entries(patch).every(([key, value]) =>
    key === 'activity'
      ? known.activity?.preview === (value as ChildActivity | undefined)?.preview
      : known[key as keyof ChildSessionSignal] === value,
  );
}

// The three tools that start a subagent. Their input is the whole brief the
// subagent is given, so a call to one of them is both a spawn correlation and a
// row whose arguments the parent's transcript must not keep in full.
export const isSpawnToolName = (name: string): boolean =>
  name === 'Task' || name === 'Agent' || name === 'Workflow';

export class ClaudeSubagents {
  private readonly children = new Map<string, ChildSessionSignal>();
  private readonly workflows = new Map<string, WorkflowRun>();
  private turnSpawnToolUseId?: string;

  beginTurn(): void {
    this.turnSpawnToolUseId = undefined;
  }

  noteToolUse(name: string, id: string): void {
    if (isSpawnToolName(name)) this.turnSpawnToolUseId = id;
  }

  // The agent a call is about, when it is about one. `TaskOutput` and `TaskStop`
  // read and stop background shell commands with the same names they use for
  // agents, so the task id is what tells the two apart: only an id this mapper
  // is already tracking as a child belongs to an agent.
  pollsChildSessionId(name: string, input: unknown): string | undefined {
    const taskId = taskPollTargetId(name, input);
    return taskId !== undefined && this.children.has(taskId) ? taskId : undefined;
  }

  map(message: SystemMessage, modelId: string | undefined): NormalizedEvent[] {
    switch (message.subtype) {
      case 'task_started':
        return this.started(message, modelId);
      case 'task_progress':
        return this.progress(message, modelId);
      case 'task_updated':
        return this.updated(message);
      case 'task_notification': {
        // Stopping is something the user did, not something the agent failed
        // at; only a real failure wears the failed status.
        const ended =
          message.status === 'completed'
            ? 'completed'
            : message.status === 'stopped'
              ? 'paused'
              : 'failed';
        const workflow = this.workflows.get(message.task_id);
        if (workflow) {
          this.workflows.delete(message.task_id);
          return this.settleWorkflowAgents(workflow, ended);
        }
        if (!this.children.has(message.task_id)) return [];
        return this.update(message.task_id, {
          ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
          status: ended,
        });
      }
      // Ids only, and an id leaves this list for every reason a task can end:
      // finished, stopped, killed. Disappearance therefore says that something
      // happened, never what. Status comes from task_notification and
      // task_updated, which say which it was. A late 'completed' is honest; a
      // 'paused' inferred from an absent id is a lie the user sees flash by.
      case 'background_tasks_changed':
        return [];
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
          agentIds: new Set(),
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
    const workflow = this.workflows.get(message.task_id);
    if (workflow) return this.workflowAgents(message, workflow);
    const known = this.children.get(message.task_id);
    if (!known && !message.subagent_type) return [];
    return this.update(message.task_id, {
      ...(!known ? { modelId, label: message.description, status: 'running' } : {}),
      ...(message.tool_use_id ? { toolUseId: message.tool_use_id } : {}),
      // The agent's own running total, which belongs to its row rather than to
      // the parent's session totals.
      ...(message.usage.total_tokens ? { tokensUsed: message.usage.total_tokens } : {}),
      activity: { preview: message.summary ?? message.description },
    });
  }

  private updated(message: TaskUpdated): NormalizedEvent[] {
    const { status, description } = message.patch;
    const workflow = this.workflows.get(message.task_id);
    if (workflow) {
      if (status !== 'completed' && status !== 'failed' && status !== 'killed') return [];
      this.workflows.delete(message.task_id);
      return this.settleWorkflowAgents(workflow, taskStatus(status));
    }
    if (!this.children.has(message.task_id)) return [];
    return this.update(message.task_id, {
      ...(status ? { status: taskStatus(status) } : {}),
      ...(description ? { activity: { preview: description } } : {}),
    });
  }

  // A workflow's agents never get a `task_started` of their own: the CLI reports
  // the whole fan-out as a snapshot array on the workflow's own `task_progress`.
  // Each entry is one agent and carries what a child needs — its id, label,
  // model, phase and prompt — so without this the whole wave is invisible.
  private workflowAgents(message: TaskProgress, workflow: WorkflowRun): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    for (const entry of workflowAgentEntries(message)) {
      // An agent still waiting for a slot has no id yet; it appears when it starts.
      const providerSessionId = entry.agentId;
      if (!providerSessionId) continue;
      const status = workflowAgentStatus(entry.state);
      const preview = entry.resultPreview;
      const patch: Partial<ChildSessionSignal> = {
        toolUseId: workflow.toolUseId,
        label: entry.label,
        group: workflow.name,
        status,
        ...(entry.promptPreview ? { prompt: entry.promptPreview } : {}),
        ...(entry.model ? { modelId: entry.model } : {}),
        ...(entry.phaseTitle ? { phase: entry.phaseTitle } : {}),
        ...(preview ? { activity: { preview } } : {}),
      };
      // One snapshot arrives per agent transition and each repeats every agent,
      // so only a snapshot that changes something the row shows is an event.
      const known = this.children.get(providerSessionId);
      if (known && writesNothingNew(known, patch)) continue;
      workflow.agentIds.add(providerSessionId);
      events.push(...this.update(providerSessionId, patch));
    }
    return events;
  }

  // The workflow stopped, so nothing more will arrive for an agent the last
  // snapshot still showed working.
  private settleWorkflowAgents(workflow: WorkflowRun, status: ChildStatus): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    for (const agentId of workflow.agentIds) {
      const child = this.children.get(agentId);
      if (child && child.status !== 'completed' && child.status !== 'failed')
        events.push(...this.update(agentId, { status }));
    }
    return events;
  }

  private workflowFor(toolUseId: string | undefined): WorkflowRun | undefined {
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
