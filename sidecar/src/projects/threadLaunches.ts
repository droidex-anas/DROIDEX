import { randomUUID } from 'node:crypto';
import type { SessionSummary } from '../protocol.js';
import type { ProjectPort } from './sessions.js';
import type { ProjectWakeQueue } from './ProjectWakeQueue.js';
import type { Project, ProjectThread, ThreadInput } from './types.js';
import {
  checkWithinAutonomy,
  THREAD_BRIEF,
  threadPrompt,
  type ThreadCheckout,
} from './threadStart.js';
import { failureReport } from './projectMessages.js';
import { removeThread } from './projectTurns.js';
import { LEDGER_LIMITS } from './store.js';

interface ThreadLaunchInput extends ThreadInput {
  workspace?: ThreadCheckout;
}

/** Owns queued launch order and binding before the first task reaches a provider. */
export class ThreadLaunches {
  private spawnOrder = 0;
  constructor(
    private readonly sessions: ProjectPort,
    private readonly wakes: ProjectWakeQueue,
    private readonly membership: Map<string, Project>,
    private readonly persist: (project: Project) => Promise<void>,
    private readonly commit: (source: string, project: Project) => void,
    private readonly reportFailure: (
      project: Project,
      thread: ProjectThread,
      text: string,
      replyId?: string,
      leadAlert?: boolean,
    ) => void,
  ) {}

  loaded(thread: ProjectThread): void {
    if (thread.queuedSpawn?.phase === 'opening') thread.queuedSpawn.phase = 'queued';
    this.spawnOrder = Math.max(this.spawnOrder, thread.queuedSpawn?.order ?? 0);
  }

  private requireSession(id: string): SessionSummary {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Session is no longer available.');
    return session;
  }

  async enqueue(
    project: Project,
    { workspace, ...input }: ThreadLaunchInput,
    ownerAppSessionId: string,
    isCurrent: () => boolean,
  ): Promise<ProjectThread> {
    if (!isCurrent()) throw new Error('Project launch was cancelled.');
    const load = this.sessions.runtimeLoad();
    const phase = load.live >= load.limit || this.wakes.hasWaitingStarts() ? 'queued' : 'opening';
    const thread: ProjectThread = {
      appSessionId: randomUUID(),
      ownerAppSessionId,
      title: input.title,
      reply: '',
      waiting: false,
      queuedSpawn: { phase, input, order: ++this.spawnOrder, workspace },
    };
    if (phase === 'queued') this.commit(ownerAppSessionId, project);
    delete project.done;
    project.threads.push(thread);
    this.membership.set(thread.appSessionId, project);
    try {
      await this.persist(project);
      if (!isCurrent()) throw new Error('Project launch was cancelled.');
      return thread;
    } catch (error) {
      removeThread(project, thread);
      this.membership.delete(thread.appSessionId);
      await this.persist(project);
      throw error;
    }
  }

  async open(project: Project, thread: ProjectThread, isCurrent: () => boolean): Promise<boolean> {
    const projectCurrent = isCurrent;
    const targetCurrent = this.wakes.guard(project, thread.appSessionId);
    isCurrent = () => projectCurrent() && targetCurrent();
    const queued = thread.queuedSpawn;
    const owner = thread.ownerAppSessionId;
    if (!queued || !owner) throw new Error('Only an identified, unstarted thread can open.');
    const wasQueued = queued.phase === 'queued';
    let opened = false;
    queued.phase = 'opening';
    const { input, workspace } = queued;
    project.launching += 1;
    try {
      await this.persist(project);
      if (!isCurrent()) throw new Error('Project launch was cancelled.');
      const prompt = `${THREAD_BRIEF}\n\nTask:\n${threadPrompt(input.prompt, workspace)}`;
      const bound = this.sessions.get(thread.appSessionId);
      if (bound?.providerSessionId) {
        checkWithinAutonomy(this.requireSession(owner), input.autonomy);
        const settings = {
          ...(bound.autonomy !== input.autonomy ? { autonomy: input.autonomy } : {}),
          ...(input.modelId && input.modelId !== bound.modelId ? { modelId: input.modelId } : {}),
          ...(input.reasoningEffort && input.reasoningEffort !== bound.reasoningEffort
            ? { reasoningEffort: input.reasoningEffort }
            : {}),
        };
        if (Object.keys(settings).length)
          await this.sessions.configure(thread.appSessionId, settings);
        if (!isCurrent()) throw new Error('Project launch was cancelled.');
        await this.bind(project, thread, isCurrent);
        if (!isCurrent()) throw new Error('Project launch was cancelled.');
        const receipt = await this.sessions.deliver(thread.appSessionId, prompt, isCurrent);
        if (receipt.status === 'busy') return false;
        if (receipt.status === 'unavailable') throw new Error(receipt.error);
        if (receipt.status === 'cancelled') throw new Error('Project launch was cancelled.');
        opened = true;
        return true;
      }
      const session = await this.sessions.create(
        { ...input, prompt },
        async (created) => {
          checkWithinAutonomy(this.requireSession(owner), input.autonomy);
          if (created.appSessionId !== thread.appSessionId)
            throw new Error('The harness changed the thread identity.');
          await this.bind(project, thread, isCurrent);
        },
        undefined,
        thread.appSessionId,
      );
      if (session === null) {
        this.commit(owner, project);
        return false;
      }
      if (!session)
        throw new Error('The selected harness did not start this thread and reported no reason.');
      opened = true;
      return true;
    } catch (error) {
      if (wasQueued && isCurrent()) {
        queued.phase = 'failed';
        thread.queuedSpawn = queued;
        thread.error = (error instanceof Error ? error.message : String(error)).slice(
          0,
          LEDGER_LIMITS.threadError,
        );
        this.reportFailure(
          project,
          thread,
          failureReport(thread.title, thread.error),
          undefined,
          true,
        );
        return true;
      }
      if (!wasQueued) {
        removeThread(project, thread);
        this.membership.delete(thread.appSessionId);
      }
      throw error;
    } finally {
      if (thread.queuedSpawn?.phase === 'opening' && !opened) thread.queuedSpawn.phase = 'queued';
      project.launching -= 1;
      await this.persist(project);
    }
  }

  async bind(project: Project, thread: ProjectThread, isCurrent: () => boolean) {
    if (!isCurrent()) throw new Error('Project launch was cancelled.');
    if (!project.threads.includes(thread)) project.threads.push(thread);
    this.membership.set(thread.appSessionId, project);
    if (thread.ownerAppSessionId) this.commit(thread.ownerAppSessionId, project);
    // Name it before its first turn, so its own plan_set title wins.
    await this.sessions.rename(thread.appSessionId, thread.title).catch((error: unknown) => {
      console.warn(`Could not name project thread ${thread.appSessionId}:`, error);
    });
    if (!isCurrent()) throw new Error('Project launch was cancelled.');
    await this.persist(project);
    if (!isCurrent()) throw new Error('Project launch was cancelled.');
  }
}
