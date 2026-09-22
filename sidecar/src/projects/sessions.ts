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
  | 'sessionSummary'
  | 'isSessionLive'
  | 'deliverScheduledMessage'
  | 'providerCatalog'
  | 'answerQuestion'
>;

/** Correlates session creation and commits membership before the first provider turn. */
export class ProjectSessions implements ProjectPort {
  private readonly launching = new Map<string, Launch>();

  constructor(private readonly host: Host) {}

  get(appSessionId: string): SessionSummary | undefined {
    return this.host.sessionSummary(appSessionId);
  }

  catalog(): Promise<ProviderStatus[]> {
    return this.host.providerCatalog();
  }

  async create(input: ThreadInput, bind: Launch['bind']): Promise<SessionSummary | undefined> {
    const clientRef = `project:${randomUUID()}`;
    const launch: Launch = { bind };
    this.launching.set(clientRef, launch);
    try {
      const { prompt, ...settings } = input;
      await this.host.handle({
        ...settings,
        type: 'session.create',
        clientRef,
        goal: prompt,
        sessionPurpose: 'chat',
        interactionMode: 'auto',
      });
      if (launch.error) throw new Error(launch.error);
      // Admission can close after the bind — a shutdown, a cancelled resume —
      // and that path reports no error at all. Its cleanup can leave a
      // historical row behind, so the question is whether the conversation is
      // open, not whether the manager has heard of it.
      if (launch.session && !this.host.isSessionLive(launch.session.appSessionId)) return undefined;
      return launch.session;
    } finally {
      this.launching.delete(clientRef);
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

  configure(appSessionId: string, settings: ThreadSettings): Promise<void> {
    return this.host.handle({ type: 'session.updateSettings', appSessionId, ...settings });
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
