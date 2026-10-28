import assert from 'node:assert/strict';

import { ToolConfirmationType, type RequestPermissionRequestParams } from '@factory/droid-sdk';

import type { ServerEvent } from '../protocol.js';
import { droidInteractionHandlers } from '../providers/droid/droidInteractions.js';
import { SessionInteractions, type InteractionLiveSession } from '../SessionInteractions.js';
import { sessionSummary } from './sessionSummaryFixture.js';

interface HarnessOptions {
  rejectProviderUpdate?: boolean;
  throwSummaryUpdate?: boolean;
}

export function createInteractionsHarness(options: HarnessOptions = {}) {
  const emitted: ServerEvent[] = [];
  const errors: Omit<Extract<ServerEvent, { type: 'error' }>, 'type'>[] = [];
  const trace: string[] = [];
  const liveSessions = new Map<string, InteractionLiveSession>();

  const addLiveSession = (appSessionId: string, providerSessionId = appSessionId) => {
    const liveSession: InteractionLiveSession = {
      session: {
        get autonomy() {
          return liveSession.summary.autonomy;
        },
      },
      summary: sessionSummary({
        appSessionId,
        providerSessionId,
        cwd: '/workspace',
        workspaceKind: 'folder',
      }),
    };
    liveSessions.set(appSessionId, liveSession);
    return liveSession;
  };
  const interactions = new SessionInteractions({
    getLiveSession: (id) =>
      [...liveSessions.values()].find(
        (liveSession) =>
          liveSession.summary.appSessionId === id || liveSession.summary.providerSessionId === id,
      ),
    setProviderSpecMode: (_id, spec) => {
      trace.push(spec ? 'provider:spec' : 'provider:auto');
      return !spec && options.rejectProviderUpdate
        ? Promise.reject(new Error('provider rejected'))
        : Promise.resolve();
    },
    updateSummary: (id, patch) => {
      const liveSession = liveSessions.get(id);
      if (!liveSession) return;
      trace.push(`publish:${patch.interactionMode ?? patch.phase ?? ''}`);
      if (options.throwSummaryUpdate) throw new Error('summary persistence failed');
      Object.assign(liveSession.summary, patch);
    },
    emit: (event) => {
      emitted.push(event);
    },
    emitError: (error) => {
      trace.push(`error:${error.code ?? ''}`);
      errors.push(error);
    },
  });
  const handlers = (ref: { id: string }) =>
    droidInteractionHandlers(ref, interactions.interactionsFor(ref));
  return {
    addLiveSession,
    askUserHandler: (ref: { id: string }) => handlers(ref).askUserHandler,
    emitted,
    errors,
    interactions,
    liveSessions,
    permissionHandler: (ref: { id: string }) => handlers(ref).permissionHandler,
    trace,
  };
}

export function permissionInput(
  toolUseId: string,
  command = 'pwd',
): RequestPermissionRequestParams {
  return {
    toolUses: [
      {
        toolUse: {
          type: 'tool_use',
          id: toolUseId,
          name: 'Bash',
          input: { command },
        },
        confirmationType: ToolConfirmationType.Execute,
        details: {
          type: ToolConfirmationType.Execute,
          fullCommand: command,
          command,
        },
      },
    ],
    options: [],
  };
}

export function approvalRequests(events: ServerEvent[]) {
  return events.filter(
    (event): event is Extract<ServerEvent, { type: 'approval.requested' }> =>
      event.type === 'approval.requested',
  );
}

export function latestApprovalRequest(events: ServerEvent[]) {
  const event = approvalRequests(events).at(-1);
  assert.ok(event);
  return event.request;
}
