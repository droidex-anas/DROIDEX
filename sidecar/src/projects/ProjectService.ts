import { randomUUID } from 'node:crypto';
import type { ClientCommand, ServerEvent, SessionSummary } from '../protocol.js';
import { ProjectStore } from './store.js';
import { wakePrompt } from './wake.js';
import type { Project, ProjectThread, ProjectWake, SpawnThreadInput } from './types.js';

interface ProjectHost {
  dataDir: string;
  emit: (event: ServerEvent) => void;
  summary: (sessionId: string) => SessionSummary | undefined;
  create: (command: Extract<ClientCommand, { type: 'session.create' }>) => Promise<void>;
  send: (sessionId: string, text: string, current?: boolean) => Promise<void>;
  wake: (sessionId: string, text: string) => Promise<boolean>;
}

export class ProjectService {
  private readonly store: ProjectStore;
  private readonly ready: Promise<void>;
  private readonly pendingWake = new Map<string, ProjectWake[]>();
  private readonly spawning = new Map<string, { projectId: string; parentId: string; task: string; title: string }>();

  constructor(private readonly host: ProjectHost) {
    this.store = new ProjectStore(host.dataDir);
    this.ready = this.store.load();
  }

  async list(): Promise<readonly Project[]> { await this.ready; return this.store.list(); }

  async publish(): Promise<void> {
    await this.ready;
    this.host.emit({ type: 'projects.updated', projects: [...this.store.list()] });
  }

  assertMember(projectId: string, sessionId: string): void {
    const project = this.requireProject(projectId);
    if (!project.threads.some((thread) => thread.sessionId === sessionId))
      throw new Error('This session is not part of the project.');
  }

  async create(title: string, controllerSessionId: string): Promise<Project> {
    await this.ready;
    const summary = this.requireSummary(controllerSessionId);
    const controller = thread(summary, 'Controller');
    const project: Project = {
      id: randomUUID(), title: title.trim() || summary.title || 'Project', cwd: summary.cwd,
      controllerId: controller.id, threads: [controller], updatedAt: Date.now(),
    };
    await this.save([project, ...this.store.list()]);
    return project;
  }

  async spawn(input: SpawnThreadInput): Promise<{ clientRef: string }> {
    await this.ready;
    const project = this.requireProject(input.projectId);
    const parent = this.requireThread(project, input.parentId);
    const source = this.requireSummary(parent.sessionId);
    const ref = `project:${randomUUID()}`;
    this.spawning.set(ref, {
      projectId: project.id, parentId: parent.id, task: input.task,
      title: input.title?.trim() || shortTitle(input.task),
    });
    await this.host.create({
      type: 'session.create', clientRef: ref, cwd: project.cwd, title: input.title?.trim() || shortTitle(input.task),
      goal: input.task, sessionPurpose: 'chat', provider: input.provider ?? source.provider,
      interactionMode: 'auto', modelId: input.model, reasoningEffort: input.reasoning,
      autonomy: input.autonomy ?? source.autonomy,
    });
    return { clientRef: ref };
  }

  async inspect(projectId: string): Promise<Project> {
    await this.ready;
    return this.requireProject(projectId);
  }

  async steer(projectId: string, threadId: string, text: string): Promise<void> {
    const thread = this.requireThread(this.requireProject(projectId), threadId);
    await this.host.send(thread.sessionId, text, true);
  }

  async observe(event: ServerEvent): Promise<void> {
    await this.ready;
    if (event.type === 'session.created') {
      const pending = this.spawning.get(event.clientRef);
      if (!pending) return;
      this.spawning.delete(event.clientRef);
      await this.attach(pending, event.session);
      return;
    }
    if (event.type === 'session.updated') await this.sync(event.session);
    if (event.type === 'question.requested')
      await this.markWaiting(event.question.appSessionId, 'Agent needs input');
    if (event.type === 'approval.requested')
      await this.markWaiting(event.request.appSessionId, event.request.title);
  }

  async userWake(projectId: string, text: string): Promise<void> {
    await this.ready;
    this.queue(projectId, { kind: 'user', text });
    await this.flush(projectId);
  }

  private async attach(pending: { projectId: string; parentId: string; task: string; title: string }, summary: SessionSummary): Promise<void> {
    await this.change(pending.projectId, (project) => ({
      ...project, updatedAt: Date.now(),
      threads: [...project.threads, { ...thread(summary, pending.title, pending.parentId), task: pending.task }],
    }));
  }

  private async sync(summary: SessionSummary): Promise<void> {
    const hit = findThread(this.store.list(), summary.appSessionId);
    if (!hit) return;
    const nextState = state(summary);
    const previous = hit.thread.state;
    if (previous === nextState && hit.thread.updatedAt === summary.updatedAt) return;
    await this.change(hit.project.id, (project) => ({
      ...project, updatedAt: Date.now(),
      threads: project.threads.map((item) => item.id === hit.thread.id ? {
        ...item, provider: summary.provider, model: summary.modelId, reasoning: summary.reasoningEffort,
        autonomy: summary.autonomy, state: nextState, updatedAt: summary.updatedAt,
      } : item),
    }));
    if (hit.thread.id === hit.project.controllerId || previous === nextState) return;
    if (nextState === 'done' || nextState === 'failed') {
      this.queue(hit.project.id, { kind: nextState === 'done' ? 'thread.done' : 'thread.failed', threadId: hit.thread.id, title: hit.thread.title });
      await this.flush(hit.project.id);
    }
  }

  private async markWaiting(sessionId: string, result: string): Promise<void> {
    const hit = findThread(this.store.list(), sessionId);
    if (!hit || hit.thread.id === hit.project.controllerId || hit.thread.state === 'waiting') return;
    await this.change(hit.project.id, (project) => ({
      ...project, updatedAt: Date.now(),
      threads: project.threads.map((item) => item.id === hit.thread.id ? { ...item, state: 'waiting', result, updatedAt: Date.now() } : item),
    }));
    this.queue(hit.project.id, { kind: 'thread.waiting', threadId: hit.thread.id, title: hit.thread.title, result });
    await this.flush(hit.project.id);
  }

  private queue(projectId: string, event: ProjectWake): void {
    this.pendingWake.set(projectId, [...(this.pendingWake.get(projectId) ?? []), event]);
  }

  private async flush(projectId: string): Promise<void> {
    const events = this.pendingWake.get(projectId);
    if (!events?.length) return;
    const project = this.requireProject(projectId);
    const controller = this.requireThread(project, project.controllerId);
    const accepted = await this.host.wake(controller.sessionId, wakePrompt(events));
    if (accepted) this.pendingWake.delete(projectId);
  }

  private async change(id: string, mutate: (project: Project) => Project): Promise<void> {
    const projects = [...this.store.list()];
    const index = projects.findIndex((project) => project.id === id);
    if (index < 0) throw new Error('Project not found.');
    projects[index] = mutate(projects[index]);
    await this.save(projects);
  }

  private async save(projects: Project[]): Promise<void> {
    await this.store.write(projects);
    this.host.emit({ type: 'projects.updated', projects });
  }

  private requireProject(id: string): Project {
    const project = this.store.list().find((item) => item.id === id);
    if (!project) throw new Error('Project not found.');
    return project;
  }

  private requireThread(project: Project, id: string): ProjectThread {
    const value = project.threads.find((item) => item.id === id);
    if (!value) throw new Error('Project thread not found.');
    return value;
  }

  private requireSummary(id: string): SessionSummary {
    const value = this.host.summary(id);
    if (!value) throw new Error('Session not found.');
    return value;
  }
}

function findThread(projects: readonly Project[], sessionId: string) {
  for (const project of projects) {
    const thread = project.threads.find((item) => item.sessionId === sessionId);
    if (thread) return { project, thread };
  }
}

function thread(summary: SessionSummary, title?: string, parentId?: string): ProjectThread {
  return {
    id: randomUUID(), sessionId: summary.appSessionId, ...(parentId ? { parentId } : {}),
    title: title || summary.title || 'Thread', provider: summary.provider, model: summary.modelId,
    reasoning: summary.reasoningEffort, autonomy: summary.autonomy,
    state: state(summary), updatedAt: summary.updatedAt,
  };
}

function state(summary: SessionSummary): ProjectThread['state'] {
  if (summary.streaming) return 'running';
  if (summary.phase === 'failed') return 'failed';
  if (summary.phase === 'completed') return 'done';
  return 'idle';
}

function shortTitle(task: string): string {
  return task.trim().replace(/\s+/g, ' ').slice(0, 64) || 'Thread';
}
