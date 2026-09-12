import type { ServerEvent } from '../protocol.js';
import { automationExecutionPrompt, type AutomationAttachments } from './automationAttachments.js';
import { projectActiveRun, projectSettledRun } from './automationRunRecord.js';
import type { AutomationDeliveryReceipt, AutomationRun, AutomationStore } from './types.js';

export type DeliverAutomationMessage = (
  appSessionId: string,
  prompt: string,
  isCurrent: () => boolean,
) => Promise<AutomationDeliveryReceipt>;

interface DeliveryOptions {
  store: () => AutomationStore;
  now: () => number;
  isClosed: () => boolean;
  persist: (apply: () => void) => Promise<void>;
  deliver: DeliverAutomationMessage;
  attachments: AutomationAttachments;
  collectAttachments: () => void;
}

/** Existing chats are borrowed, never owned. Two resumes at a time, one attempt per target. */
export class AutomationDeliveries {
  private readonly inFlightAttempts = new Map<string, Promise<void>>();
  private readonly unsettledTurns = new Set<string>();
  private readonly retryBlockedTargets = new Set<string>();
  private readonly availabilityChangedDuringAttempt = new Set<string>();

  constructor(private readonly options: DeliveryOptions) {}

  startQueued(): void {
    if (this.options.isClosed()) return;
    const queuedTargets = new Set(
      this.options
        .store()
        .runs.flatMap((run) =>
          run.status === 'queued' && run.automation.target.kind === 'existing-session'
            ? [run.automation.target.appSessionId]
            : [],
        ),
    );
    for (const id of this.retryBlockedTargets) {
      if (!queuedTargets.has(id) && !this.inFlightAttempts.has(id))
        this.retryBlockedTargets.delete(id);
    }
    const ordered = this.options
      .store()
      .runs.filter((run) => run.status === 'queued')
      .sort((left, right) => left.requestedAt - right.requestedAt);
    for (const run of ordered) {
      if (new Set([...this.inFlightAttempts.keys(), ...this.unsettledTurns]).size >= 2) break;
      const target = run.automation.target;
      if (target.kind !== 'existing-session' || run.status !== 'queued') continue;
      const id = target.appSessionId;
      if (
        this.inFlightAttempts.has(id) ||
        this.unsettledTurns.has(id) ||
        this.retryBlockedTargets.has(id)
      )
        continue;
      const attempt = this.attempt(run, id)
        .catch((error: unknown) => {
          console.error('Could not persist scheduled message delivery', error);
        })
        .finally(() => {
          this.inFlightAttempts.delete(id);
          if (this.availabilityChangedDuringAttempt.delete(id)) this.retryBlockedTargets.delete(id);
          this.startQueued();
        });
      this.inFlightAttempts.set(id, attempt);
    }
  }

  observe(event: ServerEvent): void {
    let id: string;
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        if (event.session.streaming) return;
        id = event.session.appSessionId;
        break;
      case 'session.closed':
        this.retryBlockedTargets.clear();
        this.startQueued();
        return;
      default:
        return;
    }
    this.sessionAvailable(id);
  }

  sessionAvailable(appSessionId: string): void {
    if (this.inFlightAttempts.has(appSessionId))
      this.availabilityChangedDuringAttempt.add(appSessionId);
    if (this.retryBlockedTargets.delete(appSessionId)) this.startQueued();
  }

  async pending(): Promise<void> {
    await Promise.allSettled(this.inFlightAttempts.values());
  }

  private async attempt(run: AutomationRun, appSessionId: string): Promise<void> {
    // Also inhibits an immediate retry if a store failure restores queued.
    this.retryBlockedTargets.add(appSessionId);
    await this.options.persist(() => {
      const current = this.find(run.id);
      if (current?.status !== 'queued' || this.options.isClosed()) return;
      current.status = 'starting';
      current.startedAt = this.options.now();
      current.appSessionId = appSessionId;
      current.error = null;
      const automation = this.options
        .store()
        .automations.find((item) => item.id === current.automationId);
      if (automation) projectActiveRun(automation, current, 'starting', this.options.now());
    });
    const isCurrent = () =>
      !this.options.isClosed() && this.find(run.id) === run && run.status === 'starting';
    if (!isCurrent()) return;
    const releaseAttachments = this.options.attachments.retain(run.automation.files);
    let receipt: AutomationDeliveryReceipt;
    try {
      receipt = await this.options.deliver(
        appSessionId,
        automationExecutionPrompt(run.automation.prompt, run.automation.files),
        isCurrent,
      );
    } catch {
      // A thrown adapter error provides no acceptance guarantee. Never replay it.
      receipt = {
        status: 'unavailable',
        error: 'Delivery outcome unknown; inspect conversation before retrying.',
      };
    }
    if (receipt.status === 'accepted') {
      this.unsettledTurns.add(appSessionId);
      void receipt.settled
        .catch((error: unknown) => {
          console.error('Scheduled message turn failed', error);
        })
        .finally(() => {
          releaseAttachments();
          this.options.collectAttachments();
          this.unsettledTurns.delete(appSessionId);
          this.retryBlockedTargets.delete(appSessionId);
          this.startQueued();
        });
    } else {
      releaseAttachments();
      this.options.collectAttachments();
    }
    if (this.options.isClosed()) return;
    await this.options.persist(() => {
      const current = this.find(run.id);
      if (current?.status !== 'starting') return;
      if (receipt.status === 'busy') {
        current.status = 'queued';
        current.startedAt = null;
        const automation = this.options
          .store()
          .automations.find((item) => item.id === current.automationId);
        if (automation) {
          automation.lastRunStatus = 'queued';
          automation.lastRunDurationMs = null;
        }
        return;
      }
      current.status = receipt.status === 'accepted' ? 'completed' : 'failed';
      current.finishedAt = this.options.now();
      current.error = receipt.status === 'unavailable' ? receipt.error : null;
      const automation = this.options
        .store()
        .automations.find((item) => item.id === current.automationId);
      if (automation) projectSettledRun(automation, current, this.options.now());
    });
    if (receipt.status !== 'busy') this.retryBlockedTargets.delete(appSessionId);
  }

  private find(id: string): AutomationRun | undefined {
    return this.options.store().runs.find((run) => run.id === id);
  }
}
