import type { SteeredReportDelivery } from '../SessionLifecycle.js';
import { randomUUID } from 'node:crypto';
import type { SessionManager } from '../SessionManager.js';
import type { ProviderStatus, ServerEvent, SessionSummary } from '../protocol.js';
import type { ProjectPort } from './ProjectService.js';
import type { ThreadInput, ThreadSettings } from './types.js';

interface Launch {
  bind: (session: SessionSummary) => Promise<void>;
  session?: SessionSummary;
  error?: string;
}

type Host = Pick<
  SessionManager,
  | 'handle'
  | 'createAutomaticSession'
  | 'automaticRuntimeLoad'
  | 'makeAutomaticRuntimeRoom'
  | 'sessionSummary'
  | 'transcriptTail'
  | 'isSessionLive'
  | 'isQuestionPending'
  | 'isApprovalPending'
  | 'pendingApproval'
  | 'approveFor'
  | 'deliverScheduledMessage'
  | 'providerCatalog'
  | 'answerQuestion'
  | 'steerRunningTurn'
  | 'resourceCounts'
>;

/** Correlates session creation and commits membership before the first provider turn. */
export class ProjectSessions implements ProjectPort {
  private readonly launching = new Map<string, Launch>();

  constructor(private readonly host: Host) {}

  get(appSessionId: string): SessionSummary | undefined {
    return this.host.sessionSummary(appSessionId);
  }

  transcriptTail(appSessionId: string, limit: number) {
    return this.host.transcriptTail(appSessionId, limit, true);
  }

  runtimeLoad(): { live: number; limit: number } {
    return this.host.automaticRuntimeLoad();
  }

  makeRoom(appSessionId: string): Promise<boolean> {
    return this.host.makeAutomaticRuntimeRoom(appSessionId);
  }

  catalog(): Promise<ProviderStatus[]> {
    return this.host.providerCatalog();
  }

  async create(
    input: ThreadInput,
    bind: Launch['bind'],
    clientRef = `project:${randomUUID()}`,
    appSessionId?: string,
    start: 'user' | 'automatic' = 'automatic',
  ): Promise<SessionSummary | null | undefined> {
    // A launch is found again by its clientRef, so two in flight must not share one.
    if (this.launching.has(clientRef))
      throw new Error('A project with this request is already starting.');
    const launch: Launch = { bind };
    this.launching.set(clientRef, launch);
    try {
      const { prompt, ...settings } = input;
      const command = {
        ...settings,
        type: 'session.create' as const,
        clientRef,
        goal: prompt,
        sessionPurpose: 'chat' as const,
        interactionMode: 'auto' as const,
      };
      if (start === 'user') await this.host.handle(command);
      else if (!(await this.host.createAutomaticSession(command, appSessionId))) return null;
      if (launch.error) throw new Error(launch.error);
      // Admission can close after the bind (a shutdown, a cancelled resume),
      // and that path reports no error at all. Its cleanup can leave a
      // historical row behind, so the question is whether the conversation is
      // open, not whether the manager has heard of it.
      if (launch.session && !this.host.isSessionLive(launch.session.appSessionId)) return undefined;
      return launch.session;
    } finally {
      if (this.launching.get(clientRef) === launch) this.launching.delete(clientRef);
    }
  }

  async beforeFirstTurn(session: SessionSummary, clientRef: string): Promise<void> {
    const launch = this.launching.get(clientRef);
    if (!launch) return;
    await launch.bind(session);
    launch.session = session;
  }

  observe(event: ServerEvent): void {
    if (event.type !== 'error' || !event.clientRef) return;
    const launch = this.launching.get(event.clientRef);
    if (launch) launch.error = event.message;
  }

  deliver(appSessionId: string, prompt: string, isCurrent: () => boolean) {
    return this.host.deliverScheduledMessage(appSessionId, prompt, isCurrent);
  }

  isAsking(appSessionId: string, requestId: string): boolean {
    return this.host.isQuestionPending(appSessionId, requestId);
  }

  isLive(appSessionId: string): boolean {
    return this.host.isSessionLive(appSessionId);
  }

  awaitingApproval(appSessionId: string): boolean {
    return this.host.isApprovalPending(appSessionId);
  }

  pendingApproval(appSessionId: string, requestId?: string) {
    return this.host.pendingApproval(appSessionId, requestId);
  }

  approveFor(source: string, target: string, requestId: string, decision: 'allow' | 'deny') {
    return this.host.approveFor(source, target, requestId, decision);
  }

  configure(appSessionId: string, settings: ThreadSettings): Promise<void> {
    return this.host.handle({ type: 'session.updateSettings', appSessionId, ...settings });
  }

  steer(
    appSessionId: string,
    prompt: string,
    isCurrent: () => boolean,
    now: boolean,
    delivery?: SteeredReportDelivery,
  ) {
    return this.host.steerRunningTurn(appSessionId, prompt, isCurrent, now, delivery);
  }

  rename(appSessionId: string, title: string): Promise<void> {
    return this.host.handle({ type: 'session.rename', appSessionId, title });
  }

  interrupt(appSessionId: string): Promise<void> {
    return this.host.handle({ type: 'session.interrupt', appSessionId });
  }

  answer(
    appSessionId: string,
    requestId: string,
    answers: { index: number; question: string; answer: string }[],
  ): boolean {
    return this.host.answerQuestion(appSessionId, requestId, answers);
  }
}
