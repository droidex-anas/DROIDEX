import type { Project } from './types.js';
import type { ProjectPort } from './sessions.js';
import type { ProjectWakeQueue } from './ProjectWakeQueue.js';
import type { ProjectInbox } from './projectInbox.js';
import { inboxFull } from './projectMessages.js';
import { unreadThreadNote } from './projectMessages.js';

/** Owns hold generations and the pause/resume race against interruption. */
export class ProjectHolds {
  private readonly generations = new WeakMap<Project, number>();
  private readonly pausing = new Map<Project, Promise<string[]>>();
  constructor(
    private readonly sessions: ProjectPort,
    private readonly wakes: ProjectWakeQueue,
    private readonly inbox: ProjectInbox,
    private readonly persist: () => Promise<void>,
    private readonly isOpen: () => boolean,
  ) {}
  generation(project: Project): number | undefined {
    return this.generations.get(project);
  }
  note(project: Project): void {
    this.generations.set(project, (this.generations.get(project) ?? 0) + 1);
  }
  private requireOpen(): void {
    if (!this.isOpen()) throw new Error('Projects are shutting down.');
  }

  pause(project: Project, caller?: string): Promise<string[]> {
    const pending = this.pausing.get(project);
    if (pending) {
      this.note(project);
      return pending;
    }
    const work = this.interruptProject(project, caller).finally(() => this.pausing.delete(project));
    this.pausing.set(project, work);
    return work;
  }

  private async interruptProject(project: Project, caller?: string): Promise<string[]> {
    this.wakes.invalidate(project);
    this.note(project);
    project.paused = true;
    const interrupted = project.threads
      .filter(
        (thread) =>
          thread.appSessionId !== caller && this.sessions.get(thread.appSessionId)?.streaming,
      )
      .map((thread) => thread.appSessionId);
    project.interrupted = [...new Set([...(project.interrupted ?? []), ...interrupted])];
    const stopping = Promise.allSettled(interrupted.map((id) => this.sessions.interrupt(id)));
    await this.persist();
    if (!this.isOpen()) return interrupted;
    const stopped = await stopping;
    this.requireOpen();
    await this.persist();
    const failure = stopped.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return interrupted;
  }

  async resume(project: Project, acknowledgeDelivery = false): Promise<string[]> {
    const holds = this.generation(project);
    const lead = project.threads.find((thread) => !thread.ownerAppSessionId);
    const leadCurrent = lead ? this.wakes.targetGuard(lead.appSessionId) : () => true;
    const pausing = this.pausing.get(project);
    if (pausing) await pausing;
    this.requireOpen();
    if (this.generation(project) !== holds)
      throw new Error(
        'A newer Pause canceled this Resume. Resume again when you want work to continue.',
      );
    if (!leadCurrent() && project.interrupted)
      project.interrupted = project.interrupted.filter((id) => id !== lead?.appSessionId);
    if (project.delivery) {
      if (project.delivery.state === 'sending')
        throw new Error('A delivery is settling. Try resuming again.');
      if (!acknowledgeDelivery)
        throw new Error('Review the uncertain delivery before resuming without replay.');
      delete project.delivery;
    }
    const shouldWake = project.paused || (project.leadStopped ?? project.leadFailed);
    this.wakes.invalidate(project);
    project.paused = false;
    if (leadCurrent()) {
      delete project.leadStopped;
      delete project.leadFailed;
    }
    if (!project.leadFailed) delete project.error;
    const resumed = [...(project.interrupted ?? [])];
    if (
      shouldWake &&
      lead &&
      !project.pending.some((message) => message.to === lead.appSessionId)
    ) {
      const unread = unreadThreadNote(project);
      // A full inbox still wakes the lead, through the flag delivered when a slot frees.
      if (unread && !inboxFull(project))
        this.inbox.enqueue(project, {
          from: lead.appSessionId,
          to: lead.appSessionId,
          kind: 'message',
          text: unread,
        });
      else if (unread || !this.sessions.get(lead.appSessionId)?.streaming)
        project.wakePending = 'resume';
    }
    this.inbox.refill(project);
    await this.persist();
    this.wakes.kick(project);
    return resumed;
  }
}
