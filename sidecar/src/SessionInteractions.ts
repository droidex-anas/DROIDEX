import { isUnattendedAutomationSession } from './automations/AutomationManager.js';
import { shouldAutoApproveAutomationTool } from './automations/permissionPolicy.js';
import {
  isAlwaysOutcome,
  isApprovalOutcome,
  normalizePermissionOutcome,
} from './permissionOutcomes.js';
import type {
  PermissionKind,
  PermissionOutcome,
  ServerEvent,
  SessionQuestion,
  SessionSummary,
} from './protocol.js';
import {
  nextInteractionRequestId,
  type ProviderApprovalRequest,
  type ProviderInteractions,
  type ProviderQuestionAnswers,
} from './providers/interactions.js';
import { errMsg } from './sessionHelpers.js';

interface PendingPermission {
  resolve: (outcome: PermissionOutcome) => void;
  kind: PermissionKind;
  signature?: string;
}

interface InteractionScope {
  pendingPermissions: Map<string, PendingPermission>;
  pendingQuestions: Map<string, (answers: ProviderQuestionAnswers) => void>;
  permissionGrants: Set<string>;
}

export interface InteractionLiveSession {
  summary: SessionSummary;
}

type InteractionError = Omit<Extract<ServerEvent, { type: 'error' }>, 'type'>;

export interface SessionInteractionsDependencies {
  getLiveSession: (id: string) => InteractionLiveSession | undefined;
  updateSummary: (id: string, patch: Partial<SessionSummary>) => void;
  // Moves the provider in and out of planning. The summary that goes with it is
  // this layer's own, which is why the provider call is all this does.
  setProviderSpecMode: (appSessionId: string, spec: boolean) => Promise<void>;
  emit: (event: ServerEvent) => void;
  emitError: (error: InteractionError) => void;
}

export class SessionInteractions {
  private readonly scopes = new Map<string, InteractionScope>();

  constructor(private readonly dependencies: SessionInteractionsDependencies) {}

  interactionsFor(ref: { id: string }): ProviderInteractions {
    return {
      requestApproval: (approval) => this.decideApproval(ref.id, approval),
      requestQuestion: (questions) => this.askQuestion(ref.id, questions),
      cancelPending: () => {
        this.cancelPending(ref.id);
      },
    };
  }

  // A turn settles whatever it was waiting on. Without this the provider's own
  // callback gives up on an interrupt while the resolver and its card stay
  // behind, so the next turn starts under a prompt nobody can answer.
  cancelPending(sessionId: string): void {
    const liveSession = this.dependencies.getLiveSession(sessionId);
    const scope = liveSession ? this.scopes.get(liveSession.summary.appSessionId) : undefined;
    if (!scope) return;
    const appSessionId = liveSession?.summary.appSessionId ?? sessionId;
    for (const [requestId, pending] of [...scope.pendingPermissions]) {
      scope.pendingPermissions.delete(requestId);
      pending.resolve('cancel');
      this.dependencies.emit({ type: 'interaction.cancelled', appSessionId, requestId });
    }
    for (const [requestId, resolve] of [...scope.pendingQuestions]) {
      scope.pendingQuestions.delete(requestId);
      resolve({ cancelled: true, answers: [] });
      this.dependencies.emit({ type: 'interaction.cancelled', appSessionId, requestId });
    }
  }

  private async decideApproval(
    sessionId: string,
    approval: ProviderApprovalRequest,
  ): Promise<PermissionOutcome> {
    const liveSession = this.dependencies.getLiveSession(sessionId);
    const autonomy = liveSession?.summary.autonomy;
    const tool = approval.automationTool;
    const safeForUnattended =
      tool !== undefined &&
      shouldAutoApproveAutomationTool(tool.serverName, tool.toolName, autonomy, true);
    const safeForInteractive =
      tool !== undefined &&
      shouldAutoApproveAutomationTool(tool.serverName, tool.toolName, autonomy);
    if (
      safeForUnattended ||
      (safeForInteractive &&
        !(await isUnattendedAutomationSession(liveSession?.summary.appSessionId)))
    ) {
      return 'proceed_once';
    }
    return await new Promise<PermissionOutcome>((resolve) => {
      const { request, signature } = approval;
      const scope = liveSession ? this.scope(liveSession.summary.appSessionId) : undefined;
      if (scope && signature && scope.permissionGrants.has(signature)) {
        resolve('proceed_always');
        return;
      }
      if (liveSession && scope) {
        scope.pendingPermissions.set(request.requestId, {
          resolve,
          kind: request.kind,
          ...(signature ? { signature } : {}),
        });
        if (approval.confirmationType === 'propose_mission') {
          this.dependencies.updateSummary(sessionId, {
            phase: 'awaiting_plan_approval',
            proposal: request.detail,
          });
        } else if (approval.confirmationType === 'start_mission_run') {
          this.dependencies.updateSummary(sessionId, { phase: 'awaiting_run_start' });
        }
      }
      this.dependencies.emit({ type: 'approval.requested', request });
    });
  }

  private askQuestion(
    sessionId: string,
    questions: SessionQuestion['questions'],
  ): Promise<ProviderQuestionAnswers> {
    return new Promise<ProviderQuestionAnswers>((resolve) => {
      const liveSession = this.dependencies.getLiveSession(sessionId);
      const requestId = nextInteractionRequestId();
      if (liveSession) {
        this.scope(liveSession.summary.appSessionId).pendingQuestions.set(requestId, resolve);
      }
      this.dependencies.emit({
        type: 'question.requested',
        question: { appSessionId: sessionId, requestId, questions },
      });
    });
  }

  async respondToApproval(appSessionId: string, requestId: string, outcome: string): Promise<void> {
    const liveSession = this.dependencies.getLiveSession(appSessionId);
    if (!liveSession) return;
    const scope = this.scopes.get(liveSession.summary.appSessionId);
    const pending = scope?.pendingPermissions.get(requestId);
    if (!scope || !pending) return;
    scope.pendingPermissions.delete(requestId);
    let normalized: PermissionOutcome;
    try {
      normalized = normalizePermissionOutcome(outcome);
    } catch (error) {
      this.dependencies.emitError({
        code: 'permission.invalid_outcome',
        appSessionId,
        message: errMsg(error),
      });
      normalized = 'cancel';
    }
    if (pending.signature && isAlwaysOutcome(outcome)) {
      scope.permissionGrants.add(pending.signature);
    }
    // An approved plan runs in Auto, so the provider has to leave planning
    // first. If it refuses, the plan is declined instead of approved into a
    // session that is still planning.
    if (pending.kind === 'spec' && isApprovalOutcome(normalized)) {
      const left = await this.prepareSpecExitForRun(liveSession);
      if (!left) {
        pending.resolve('cancel');
        return;
      }
    }
    pending.resolve(normalized);
  }

  respondToQuestion(
    appSessionId: string,
    requestId: string,
    cancelled: boolean,
    answers: { index: number; question: string; answer: string }[],
  ): void {
    const liveSession = this.dependencies.getLiveSession(appSessionId);
    if (!liveSession) return;
    const scope = this.scopes.get(liveSession.summary.appSessionId);
    const resolve = scope?.pendingQuestions.get(requestId);
    if (!scope || !resolve) return;
    scope.pendingQuestions.delete(requestId);
    resolve({ cancelled, answers });
  }

  forgetSession(appSessionId: string): void {
    this.scopes.delete(appSessionId);
  }

  private scope(appSessionId: string): InteractionScope {
    const existing = this.scopes.get(appSessionId);
    if (existing) return existing;
    const created: InteractionScope = {
      pendingPermissions: new Map(),
      pendingQuestions: new Map(),
      permissionGrants: new Set(),
    };
    this.scopes.set(appSessionId, created);
    return created;
  }

  // The provider leaves planning first and the summary follows it: a chat that
  // reads as Auto while its session is still planning is the state this whole
  // path exists to avoid. Whichever half fails, the session and the chat are put
  // back into Spec together and the plan is declined for another round.
  private async prepareSpecExitForRun(liveSession: InteractionLiveSession): Promise<boolean> {
    const appSessionId = liveSession.summary.appSessionId;
    try {
      await this.dependencies.setProviderSpecMode(appSessionId, false);
    } catch (error) {
      this.reportSpecExitFailure(appSessionId, error);
      return false;
    }
    // The session that asked is the only one published onto: a replacement keeps
    // the mode it opened with, and the plan is declined.
    if (this.dependencies.getLiveSession(appSessionId) !== liveSession) return false;
    try {
      this.dependencies.updateSummary(appSessionId, { interactionMode: 'auto', phase: 'running' });
      return true;
    } catch (error) {
      // The provider already left planning; without a record of it the chat and
      // its session disagree, so the provider is put back where the chat is.
      await this.dependencies.setProviderSpecMode(appSessionId, true).catch(() => undefined);
      this.reportSpecExitFailure(appSessionId, error);
      return false;
    }
  }

  private reportSpecExitFailure(appSessionId: string, error: unknown): void {
    this.dependencies.emitError({
      code: 'spec.exit_failed',
      appSessionId,
      message: `Could not switch spec session to Auto before run: ${errMsg(error)}`,
    });
  }
}
