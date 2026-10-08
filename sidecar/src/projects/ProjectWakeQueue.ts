import type { AutomationDeliveryReceipt } from '../automations/types.js';
import type { ProjectPort } from './sessions.js';
import type { Project, ProjectThread, ThreadMessage, ThreadWait } from './types.js';
import { wakePrompt, isAsked, isOwnerUpdate, batch } from './projectMessages.js';

const MAX_ACTIVE = 2;

// Hold delivery bursts that suggest threads are looping instead of making progress.
// These marks are transient; a restart resets them.
const LOOP_WINDOW_MS = 5 * 60_000;
const LOOP_LIMIT = 60;

export class ProjectWakeQueue {
  private readonly projects = new Set<Project>();
  private starting?: { project: Project; work: Promise<void> };
  private startCapacityBlocked = false;
  private readonly acceptedMessages = new WeakSet<ThreadMessage>();
  private readonly recent = new Map<string, number[]>();
  private readonly generations = new Map<string, number>();
  private readonly targetGenerations = new Map<string, number>();
  private readonly pumping = new Map<
    string,
    {
      work: Promise<void>;
      resuming: boolean;
      wakingLead: boolean;
      target: string;
      project: Project;
    }
  >();
  private readonly active = new Map<string, { project: Project; settled: Promise<void> }>();
  /** Recipients a delivery found busy, skipped until they settle. */
  private readonly busyTargets = new Set<string>();
  private readonly capacityWaiting = new Set<string>();
  private readonly revisions = new Map<string, number>();
  private capacityRevision = 0;
  private scheduled?: NodeJS.Immediate;
  private started = false;
  private closed = false;

  constructor(
    private readonly sessions: Pick<
      ProjectPort,
      'deliver' | 'steer' | 'get' | 'isLive' | 'awaitingApproval' | 'pendingApproval'
    >,
    private readonly save: () => Promise<void>,
    private readonly fail: (project: Project, error: unknown) => void,
    /** Room opened in a project's inbox, so reports that found it full can queue. */
    private readonly refill: (project: Project) => void,
    private readonly refusalRecovery: (
      project: Project,
      target: string,
    ) => (messages: ThreadMessage[]) => boolean,
    private readonly launch?: (project: Project, thread: ProjectThread) => Promise<boolean>,
  ) {}

  waitReason(appSessionId: string): ThreadWait | undefined {
    const starts = this.waitingStarts();
    const start = starts.findIndex(({ thread }) => thread.appSessionId === appSessionId);
    if (start >= 0) return { kind: 'start', position: start + 1 };
    const waiting = [...this.capacityWaiting];
    const slot = waiting.indexOf(appSessionId);
    if (slot >= 0) return { kind: 'slot', position: slot + 1 };
    if (this.busyTargets.has(appSessionId)) return { kind: 'turn' };
    return undefined;
  }

  hasWaitingStarts(): boolean {
    return this.waitingStarts().length > 0 || this.hasWaitingResume();
  }

  private waitingStarts(): { project: Project; thread: ProjectThread }[] {
    return [...this.projects]
      .flatMap((project) =>
        project.threads
          .filter((thread) => thread.queuedSpawn?.phase === 'queued')
          .map((thread) => ({ project, thread })),
      )
      .sort((a, b) => (a.thread.queuedSpawn?.order ?? 0) - (b.thread.queuedSpawn?.order ?? 0));
  }

  private hasWaitingResume(): boolean {
    return [...this.projects].some((project) => this.nextDelivery(project)?.mode === 'resume');
  }

  private hasPendingResume(project: Project): boolean {
    return project.pending.some(
      (message) =>
        !(isLead(project, message.to) && (project.leadStopped ?? project.leadFailed)) &&
        !this.sessions.isLive(message.to) &&
        !project.threads.some((thread) => thread.appSessionId === message.to && thread.queuedSpawn),
    );
  }

  private nextDelivery(project: Project) {
    if (project.paused || project.delivery || this.pumping.has(project.id)) return;
    const hasSlot = this.running() < MAX_ACTIVE;
    let waiting: { target: string; mode: 'steer' | 'resume' | 'live' } | undefined;
    const candidates = new Map<string, { target: string; ownerUpdate: boolean }>();
    for (const message of project.pending) {
      const candidate = candidates.get(message.to);
      const ownerUpdate = isOwnerUpdate(project, message);
      if (candidate) candidate.ownerUpdate ||= ownerUpdate;
      else candidates.set(message.to, { target: message.to, ownerUpdate });
    }
    const threads = new Map(project.threads.map((thread) => [thread.appSessionId, thread]));
    const eligible = [...candidates.values()]
      .flatMap(({ target, ownerUpdate }) => {
        const thread = threads.get(target);
        const lead = thread !== undefined && !thread.ownerAppSessionId;
        if (
          (lead && (project.leadStopped ?? project.leadFailed)) ||
          thread?.queuedSpawn ||
          this.busyTargets.has(target) ||
          this.capacityWaiting.has(target)
        )
          return [];
        const live = this.sessions.isLive(target);
        const streaming = this.sessions.get(target)?.streaming === true;
        let mode: 'steer' | 'live' | 'resume' = live ? 'live' : 'resume';
        if (live && streaming && ownerUpdate) mode = 'steer';
        if (mode !== 'steer' && this.active.has(target)) return [];
        return [{ target, mode, lead, sleepingLead: lead && !streaming }];
      })
      .sort((a, b) => Number(b.sleepingLead) - Number(a.sleepingLead));
    for (const candidate of eligible) {
      if (candidate.mode === 'steer' || hasSlot || candidate.lead) return candidate;
      if (!waiting || (waiting.mode !== 'resume' && candidate.mode === 'resume'))
        waiting = candidate;
    }
    return waiting;
  }

  targetGuard(appSessionId: string): () => boolean {
    const generation = this.targetGenerations.get(appSessionId);
    return () => !this.closed && this.targetGenerations.get(appSessionId) === generation;
  }

  guard(project: Project, target?: string): () => boolean {
    const generation = this.generations.get(project.id);
    const targetCurrent = target ? this.targetGuard(target) : undefined;
    return () =>
      !this.closed &&
      !project.paused &&
      this.generations.get(project.id) === generation &&
      (!targetCurrent || targetCurrent());
  }

  invalidate(project: Project): void {
    this.recent.delete(project.id);
    this.generations.set(project.id, (this.generations.get(project.id) ?? 0) + 1);
    for (const thread of project.threads) {
      this.busyTargets.delete(thread.appSessionId);
      this.capacityWaiting.delete(thread.appSessionId);
    }
  }

  invalidateTarget(appSessionId: string): void {
    this.targetGenerations.set(appSessionId, (this.targetGenerations.get(appSessionId) ?? 0) + 1);
    this.busyTargets.delete(appSessionId);
    this.capacityWaiting.delete(appSessionId);
  }

  /** History must be ready to resolve recipients before deliveries start. */
  start(projects: Iterable<Project>): void {
    this.started = true;
    for (const project of projects) this.kick(project);
  }

  kick(project: Project): void {
    if (this.closed) return;
    this.projects.add(project);
    this.refill(project);
    if (project.paused) return;
    this.schedule();
  }

  available(project: Project, appSessionId: string): void {
    if (this.closed) return;
    this.revisions.set(appSessionId, (this.revisions.get(appSessionId) ?? 0) + 1);
    this.busyTargets.delete(appSessionId);
    this.capacityWaiting.delete(appSessionId);
    this.kick(project);
  }

  capacityChanged(projects: Iterable<Project>): void {
    if (this.closed) return;
    this.capacityRevision += 1;
    this.startCapacityBlocked = false;
    this.capacityWaiting.clear();
    for (const project of projects) this.kick(project);
  }

  // An idle session may free capacity, including for a refusal still being recorded.
  sessionIdle(projects: Iterable<Project>): void {
    if (this.closed) return;
    this.capacityRevision += 1;
    if (this.capacityWaiting.size || this.waitingStarts().length) this.capacityChanged(projects);
  }

  /** A delivered turn stopped on, or resumed from, a request only the user can answer. */
  waitingChanged(): void {
    if (!this.closed) this.schedule();
  }

  async settle(project: Project): Promise<void> {
    // Steered handoffs are admissions too; neither waits for consumption.
    await Promise.all([
      this.pumping.get(project.id)?.work,
      this.starting?.project === project ? this.starting.work : undefined,
    ]);
  }

  /** Waits for admission only, never for the resulting provider turn. */
  async dispatch(project: Project, message: ThreadMessage): Promise<boolean> {
    if (!this.started || this.closed || project.paused) return false;
    this.schedule();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await this.settle(project);
    return this.acceptedMessages.has(message);
  }

  close(): void {
    this.closed = true;
    this.recent.clear();
    if (this.scheduled) clearImmediate(this.scheduled);
    this.scheduled = undefined;
    this.projects.clear();
    this.busyTargets.clear();
    this.capacityWaiting.clear();
  }

  async flush(): Promise<void> {
    while (this.pumping.size || this.active.size || this.starting) {
      const turns = [...this.active.values()].map((turn) => turn.settled);
      await Promise.allSettled([
        ...[...this.pumping.values()].map((admission) => admission.work),
        ...turns,
        ...(this.starting ? [this.starting.work] : []),
      ]);
    }
  }

  private schedule(): void {
    if (this.closed || !this.started || this.scheduled) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      const deliveries = [...this.projects]
        .map((project) => ({ project, next: this.nextDelivery(project) }))
        .sort(
          (a, b) =>
            Number(Boolean(b.next && isLead(b.project, b.next.target))) -
            Number(Boolean(a.next && isLead(a.project, a.next.target))),
        );
      for (const { project, next } of deliveries) {
        if (
          !next ||
          (next.mode !== 'steer' && !isLead(project, next.target) && this.running() >= MAX_ACTIVE)
        )
          continue;
        this.projects.delete(project);
        this.projects.add(project);
        const work = this.deliver(project, next.target, next.mode === 'steer')
          .catch((error: unknown) => {
            this.fail(project, error);
          })
          .finally(() => {
            this.pumping.delete(project.id);
            this.kick(project);
            this.schedule();
          });
        this.pumping.set(project.id, {
          work,
          resuming: next.mode === 'resume',
          wakingLead: next.mode !== 'steer' && isLead(project, next.target),
          target: next.target,
          project,
        });
      }
      this.startNext();
    });
  }

  private startNext(): void {
    if (
      !this.launch ||
      this.starting ||
      this.startCapacityBlocked ||
      [...this.pumping.values()].some((admission) => admission.wakingLead) ||
      [...this.projects].some((project) => {
        const next = this.nextDelivery(project);
        return next && next.mode !== 'steer' && isLead(project, next.target);
      }) ||
      [...this.pumping.values()].some((admission) => admission.resuming) ||
      this.hasWaitingResume()
    )
      return;
    const next = this.waitingStarts().find(
      ({ project }) => !project.paused && !project.delivery && !this.hasPendingResume(project),
    );
    if (!next) return;
    const isCurrent = this.guard(next.project);
    const capacityRevision = this.capacityRevision;
    const work = this.launch(next.project, next.thread)
      .then(
        (started) => {
          this.startCapacityBlocked =
            !started && isCurrent() && this.capacityRevision === capacityRevision;
        },
        (error: unknown) => {
          if (isCurrent()) this.fail(next.project, error);
        },
      )
      .finally(() => {
        this.starting = undefined;
        this.schedule();
      });
    this.starting = { project: next.project, work };
  }

  private running(): number {
    let count = [...this.pumping.values()].filter(
      (admission) => !isLead(admission.project, admission.target),
    ).length;
    // Questions and approvals release delivery slots until answered.
    // Continuing those turns can briefly exceed the limit.
    for (const [target, turn] of this.active)
      if (
        !isLead(turn.project, target) &&
        !isAskingOwner(turn.project, target) &&
        !this.sessions.awaitingApproval(target)
      )
        count += 1;
    return count;
  }

  /** False when this project has woken far more often than work could explain. */
  private admit(project: Project): boolean {
    const now = Date.now();
    const marks = (this.recent.get(project.id) ?? []).filter((at) => now - at < LOOP_WINDOW_MS);
    marks.push(now);
    this.recent.set(project.id, marks);
    return marks.length <= loopLimit(project);
  }

  private async deliver(project: Project, target: string, steering: boolean): Promise<void> {
    const projectCurrent = this.guard(project, target);
    const isCurrent = () =>
      projectCurrent() && !(isLead(project, target) && (project.leadStopped ?? project.leadFailed));
    if (!isCurrent()) return;
    if (!this.admit(project)) {
      this.fail(
        project,
        new Error(
          `DROIDEX held this project because its delivery loop exceeded ${String(loopLimit(project))} deliveries in 5 minutes for ${String(project.threads.length)} threads. Review repeated instructions and reports, then resume.`,
        ),
      );
      await this.save();
      return;
    }
    const targetRevision = this.revisions.get(target);
    const capacityRevision = this.capacityRevision;
    const messages = batch(project, target, steering);
    const restore = this.refusalRecovery(project, target);
    const ids = new Set(messages.map((message) => message.id));
    project.pending = project.pending.filter((message) => !ids.has(message.id));
    const claim: NonNullable<Project['delivery']> = { state: 'sending', messages };
    project.delivery = claim;
    const clearUnread = () => {
      // A late acknowledgement cannot mark a newer reply as read.
      for (const message of messages) {
        if (message.kind !== 'result' || !message.replyId) continue;
        const thread = project.threads.find((thread) => thread.appSessionId === message.from);
        if (thread?.replyId === message.replyId) delete thread.unread;
      }
    };
    // Withdraw owner updates that are no longer needed before delivery or retry.
    const relevant = (message: ThreadMessage) =>
      isAsked(project, message) &&
      (!steering || message.kind !== 'message' || isOwnerUpdate(project, message)) &&
      (message.kind !== 'approval' ||
        this.sessions.pendingApproval(message.from, message.approvalId)?.requestId ===
          message.approvalId);
    // A to-do finished meanwhile leaves the claimed batch; the prompt built from
    // the whole batch must not go out then.
    const batchSize = messages.length;
    const stillAsked = () => messages.length === batchSize && messages.every(relevant);
    let receipt: AutomationDeliveryReceipt;
    let handedOff = false;
    try {
      await this.save();
      const prompt = wakePrompt(project, target, messages);
      const current = () => isCurrent() && stillAsked();
      if (steering) {
        await this.sessions.steer(target, prompt, current, false, {
          accepted: () => {
            if (handedOff) return;
            handedOff = true;
            for (const message of messages) this.acceptedMessages.add(message);
            delete project.delivery;
          },
          acknowledged: () => {
            if (!isCurrent()) return;
            clearUnread();
            // save already holds projects and publishes persistence failures.
            void this.save().catch(() => undefined);
          },
          declined: (reason) => {
            if (reason !== 'refused' || !handedOff || this.closed) return;
            handedOff = false;
            for (const message of messages) this.acceptedMessages.delete(message);
            const restored = restore(messages.filter(relevant));
            this.recent.get(project.id)?.pop();
            if (restored) this.park(target, 'target', capacityRevision, targetRevision);
            void this.save()
              .then(() => {
                this.kick(project);
              })
              .catch(() => undefined);
          },
        });
        receipt = current() ? { status: 'busy', retryOn: 'target' } : { status: 'cancelled' };
      } else
        receipt = await this.sessions.deliver(target, prompt, current, isLead(project, target));
    } catch (error) {
      receipt = {
        status: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    // The handoff callbacks own settlement, including definitive refusal recovery.
    if (project.delivery !== claim) {
      await this.save();
      return;
    }
    // Only scheduled turns can have an unknown outcome.
    if (receipt.status === 'unavailable' && !steering) {
      claim.state = 'uncertain';
      this.fail(project, new Error(receipt.error));
      await this.save();
      return;
    }
    // Only this claim is settled. Messages that arrived during admission remain queued.
    delete project.delivery;
    if (receipt.status !== 'accepted') {
      project.pending.unshift(...messages.filter(relevant));
      if (receipt.status === 'unavailable') this.fail(project, new Error(receipt.error));
      // A recipient that never woke does not count as a lap.
      this.recent.get(project.id)?.pop();
      // A cancelled generation or a dropped question cannot park its recipient.
      if (receipt.status === 'busy' && isCurrent() && stillAsked())
        this.park(target, receipt.retryOn, capacityRevision, targetRevision);
      await this.save();
      return;
    }

    for (const message of messages) this.acceptedMessages.add(message);
    clearUnread();
    const release = () => {
      this.active.delete(target);
      this.available(project, target);
      this.schedule();
    };
    // Acceptance and turn completion are different. Hold the slot until settlement.
    const settled = receipt.settled.then(release, release);
    this.active.set(target, { project, settled });
    await this.save();
  }

  /** Where a refused delivery waits: for room to run its recipient, or for the recipient to settle. */
  private park(
    target: string,
    retryOn: 'target' | 'capacity',
    capacityRevision: number,
    targetRevision: number | undefined,
  ): void {
    // A recipient that became available meanwhile has nothing left to wait for.
    if (this.revisions.get(target) !== targetRevision) return;
    if (retryOn === 'target') this.busyTargets.add(target);
    else if (this.capacityRevision === capacityRevision) this.capacityWaiting.add(target);
  }
}

function isLead(project: Project, target: string): boolean {
  return project.threads.some(
    (thread) => thread.appSessionId === target && !thread.ownerAppSessionId,
  );
}

function loopLimit(project: Project): number {
  return Math.max(LOOP_LIMIT, 3 * project.threads.length);
}

function isAskingOwner(project: Project, appSessionId: string): boolean {
  return project.threads.some((thread) => thread.appSessionId === appSessionId && thread.ask);
}
