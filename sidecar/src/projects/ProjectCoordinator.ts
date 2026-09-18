import { randomUUID } from 'node:crypto';

import type { ServerEvent, SessionSummary } from '../protocol.js';
import type { Project, ProjectCommand, ProjectEvent, ProjectThread } from './types.js';
import { ProjectStore } from './ProjectStore.js';

export interface ProjectCoordinatorOptions {
  dataDir: string;
  emit: (event: ProjectEvent) => void;
  session: (appSessionId: string) => SessionSummary | undefined;
  send: (appSessionId: string, text: string) => Promise<void>;
}

export class ProjectCoordinator {
  readonly ready: Promise<void>;
  private readonly store: ProjectStore;

  constructor(private readonly options: ProjectCoordinatorOptions) {
    this.store = new ProjectStore(options.dataDir);
    this.ready = this.store.load();
  }

  async handle(command: ProjectCommand | { type: string }): Promise<boolean> {
    if (!isProjectCommand(command)) return false;
    await this.ready;

    switch (command.type) {
      case 'project.list':
        this.publish();
        return true;
      case 'project.create':
        await this.create(command);
        return true;
      case 'project.attach':
        await this.attach(command);
        return true;
      case 'project.removeThread':
        await this.removeThread(command.projectId, command.threadId);
        return true;
      case 'project.send':
        await this.send(command.projectId, command.threadId, command.text);
        return true;
    }
  }

  async observe(event: ServerEvent): Promise<void> {
    await this.ready;
    if (event.type === 'session.updated') {
      await this.updateThread(event.session);
      return;
    }
    if (event.type === 'session.closed') {
      await this.updateStatus(event.appSessionId, 'idle');
      return;
    }
    if (event.type === 'question.requested') {
      await this.updateStatus(event.question.appSessionId, 'waiting');
      return;
    }
    if (event.type === 'approval.requested') {
      await this.updateStatus(event.request.appSessionId, 'waiting');
    }
  }

  async onSessionAvailable(appSessionId: string): Promise<void> {
    await this.ready;
    await this.updateStatus(appSessionId, 'idle');
  }

  private async create(command: Extract<ProjectCommand, { type: 'project.create' }>): Promise<void> {
    const session = this.options.session(command.controllerAppSessionId);
    if (!session) throw new Error('Project controller session was not found.');
    const now = Date.now();
    const thread = threadFromSession(session, now, 'Controller');
    const project: Project = {
      id: randomUUID(),
      title: command.title.trim() || 'Untitled project',
      cwd: command.cwd,
      controllerThreadId: thread.id,
      threads: [thread],
      updatedAt: now,
    };
    await this.store.replace([project, ...this.store.list()]);
    this.options.emit({ type: 'project.created', requestId: command.requestId, project });
    this.publish();
  }

  private async attach(command: Extract<ProjectCommand, { type: 'project.attach' }>): Promise<void> {
    const session = this.options.session(command.appSessionId);
    if (!session) throw new Error('Project thread session was not found.');
    await this.change(command.projectId, (project) => {
      if (project.threads.some((thread) => thread.appSessionId === command.appSessionId)) return project;
      const thread = threadFromSession(session, Date.now(), command.title, command.parentThreadId);
      return { ...project, threads: [...project.threads, thread], updatedAt: Date.now() };
    });
  }

  private async removeThread(projectId: string, threadId: string): Promise<void> {
    await this.change(projectId, (project) => {
      if (project.controllerThreadId === threadId) throw new Error('The controller thread cannot be removed.');
      return {
        ...project,
        threads: project.threads.filter((thread) => thread.id !== threadId),
        updatedAt: Date.now(),
      };
    });
  }

  private async send(projectId: string, threadId: string, text: string): Promise<void> {
    const project = this.project(projectId);
    const thread = project.threads.find((item) => item.id === threadId);
    if (!thread) throw new Error('Project thread was not found.');
    await this.options.send(thread.appSessionId, text);
  }

  private async updateThread(session: SessionSummary): Promise<void> {
    const status = session.streaming ? 'running' : session.phase === 'failed' ? 'failed' : session.phase === 'completed' ? 'done' : 'idle';
    let changed = false;
    const projects = this.store.list().map((project) => {
      const index = project.threads.findIndex((thread) => thread.appSessionId === session.appSessionId);
      if (index < 0) return project;
      const threads = [...project.threads];
      const previous = threads[index];
      const next = {
        ...previous,
        provider: session.provider,
        modelId: session.modelId,
        reasoningEffort: session.reasoningEffort,
        autonomy: session.autonomy,
        status,
        updatedAt: session.updatedAt,
      };
      if (
        previous.provider === next.provider &&
        previous.modelId === next.modelId &&
        previous.reasoningEffort === next.reasoningEffort &&
        previous.autonomy === next.autonomy &&
        previous.status === next.status &&
        previous.updatedAt === next.updatedAt
      )
        return project;
      threads[index] = next;
      changed = true;
      return { ...project, threads, updatedAt: Date.now() };
    });
    if (changed) {
      await this.store.replace(projects);
      this.publish();
    }
  }

  private async updateStatus(appSessionId: string, status: ProjectThread['status']): Promise<void> {
    let changed = false;
    const projects = this.store.list().map((project) => {
      const index = project.threads.findIndex((thread) => thread.appSessionId === appSessionId);
      if (index < 0 || project.threads[index].status === status) return project;
      const threads = [...project.threads];
      threads[index] = { ...threads[index], status, updatedAt: Date.now() };
      changed = true;
      return { ...project, threads, updatedAt: Date.now() };
    });
    if (changed) {
      await this.store.replace(projects);
      this.publish();
    }
  }

  private async change(projectId: string, mutate: (project: Project) => Project): Promise<void> {
    const projects = this.store.list();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new Error('Project was not found.');
    const next = [...projects];
    next[index] = mutate(projects[index]);
    await this.store.replace(next);
    this.publish();
  }

  private project(projectId: string): Project {
    const project = this.store.list().find((item) => item.id === projectId);
    if (!project) throw new Error('Project was not found.');
    return project;
  }

  private publish(): void {
    this.options.emit({ type: 'projects.updated', projects: this.store.list() });
  }
}

function threadFromSession(
  session: SessionSummary,
  now: number,
  title?: string,
  parentThreadId?: string,
): ProjectThread {
  return {
    id: randomUUID(),
    appSessionId: session.appSessionId,
    ...(parentThreadId ? { parentThreadId } : {}),
    title: title?.trim() || session.title || 'Thread',
    provider: session.provider,
    modelId: session.modelId,
    reasoningEffort: session.reasoningEffort,
    autonomy: session.autonomy,
    status: session.streaming ? 'running' : 'idle',
    updatedAt: now,
  };
}


function isProjectCommand(command: ProjectCommand | { type: string }): command is ProjectCommand {
  return (
    command.type === 'project.list' ||
    command.type === 'project.create' ||
    command.type === 'project.attach' ||
    command.type === 'project.removeThread' ||
    command.type === 'project.send'
  );
}
