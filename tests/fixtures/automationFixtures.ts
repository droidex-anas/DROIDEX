import type { Page } from '@playwright/test';
import type {
  Automation,
  AutomationProposal,
  AutomationSnapshot,
  ServerEvent,
  SessionSummary,
  TranscriptEvent,
} from '@droidex/protocol';
import { defaultAutomationDraft } from '../../src/features/automations/schedule';
import { automationCommandSchema } from '../../sidecar/src/automations/automationSchemas';
import {
  createAutomationRecord,
  normalizeAutomationInput,
} from '../../sidecar/src/automations/automationInput';

export const session: SessionSummary = {
  appSessionId: 'scheduled-target',
  provider: 'droid',
  providerSessionId: 'replaceable-provider',
  sessionPurpose: 'chat',
  interactionMode: 'auto',
  role: 'primary',
  title: 'Continue the review',
  goal: 'Review the pending changes',
  cwd: '',
  workspaceKind: 'none',
  autonomy: 'medium',
  phase: 'completed',
  features: [],
  tokensIn: 0,
  tokensOut: 0,
  contextTokens: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export function scheduledPrompt(index = 0, now = Date.now()): Automation {
  return {
    ...defaultAutomationDraft(null, null, null),
    id: `scheduled-${String(index)}`,
    title: `Continue review ${String(index)}`,
    prompt: 'Continue once the limit resets',
    target: { kind: 'existing-session', appSessionId: session.appSessionId },
    schedule: { kind: 'once', runAt: now + 3_600_000 },
    timezone: 'UTC',
    nextRunAt: now + 3_600_000,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    lastRunDurationMs: null,
    lastAppSessionId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function automationBridge(
  page: Page,
  automations: Automation[] = [],
  sessions: SessionSummary[] = [session],
  options: { proposals?: AutomationProposal[]; history?: TranscriptEvent[]; now?: number } = {},
) {
  const now = () => options.now ?? Date.now();
  const snapshot: AutomationSnapshot = {
    automations,
    runs: [],
    proposals: options.proposals ?? [],
    sessionOrigins: {},
    activeRunCount: 0,
    queuedRunCount: 0,
    scheduler: { ready: true, nextWakeAt: null, activeRunId: null },
  };
  const requests: unknown[] = [];
  let settle: ((ok: boolean) => void) | undefined;
  let emitSnapshot = () => {
    throw new Error('Bridge is not connected.');
  };
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let sequence = 0;
      const emit = (event: ServerEvent) => {
        sequence += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'automation-test',
            firstSeq: sequence,
            lastSeq: sequence,
            events: [{ seq: sequence, event }],
          }),
        );
      };
      emitSnapshot = () => emit({ type: 'automations.snapshot', snapshot });
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command: unknown = JSON.parse(message);
        if (typeof command !== 'object' || command === null || !('type' in command)) return;
        if (command.type === 'connect') {
          emit({ type: 'connection', status: 'connected' });
        }
        if (command.type === 'sessions.list') {
          emit({
            type: 'sessions.list',
            sessions,
            earlierSessionsByCwd: {},
          });
        }
        if (
          command.type === 'session.loadHistory' &&
          'appSessionId' in command &&
          typeof command.appSessionId === 'string'
        ) {
          emit({
            type: 'session.history',
            appSessionId: command.appSessionId,
            progress: [],
            transcripts: options.history ?? [],
          });
        }
        // The chat list waits for the project graph before it draws, as it
        // does against the real sidecar.
        if (command.type === 'projects.list') {
          emit({ type: 'projects.snapshot', projects: [] });
        }
        if (command.type === 'automations.list') {
          emit({ type: 'automations.snapshot', snapshot });
        }
        if (command.type === 'catalog.models') {
          emit({
            type: 'catalog.updated',
            catalog: 'models',
            items: [
              {
                id: 'default-model',
                displayName: 'Default model',
                isCustom: false,
                isDefault: true,
                supportedReasoningEfforts: ['high'],
                defaultReasoningEffort: 'high',
              },
            ],
          });
        }
        const parsed = automationCommandSchema.safeParse(command);
        if (!parsed.success) return;
        const mutation = parsed.data;
        if (mutation.type === 'automations.confirmProposal') {
          requests.push(command);
          const proposal = snapshot.proposals.find((entry) => entry.id === mutation.id);
          if (!proposal) throw new Error('The proposal being confirmed does not exist.');
          const automation = createAutomationRecord(
            normalizeAutomationInput(mutation.input ?? proposal.draft),
            now(),
          );
          snapshot.automations.push(automation);
          Object.assign(proposal, {
            status: 'confirmed',
            draft: mutation.input ?? proposal.draft,
            automationId: automation.id,
            confirmedAt: now(),
          });
          emit({ type: 'automations.snapshot', snapshot });
          emit({ type: 'automations.result', requestId: mutation.requestId, ok: true });
        }
        if (mutation.type === 'automations.update' || mutation.type === 'automations.setEnabled') {
          requests.push(command);
          const automation = snapshot.automations.find((entry) => entry.id === mutation.id);
          if (!automation) throw new Error('The automation being changed does not exist.');
          if (mutation.type === 'automations.update') {
            Object.assign(
              automation,
              normalizeAutomationInput({ ...automation, ...mutation.patch }),
            );
          } else {
            automation.enabled = mutation.enabled;
            if (!mutation.enabled) {
              automation.nextRunAt = null;
              if (
                automation.lastRunStatus === 'queued' ||
                automation.lastRunStatus === 'starting'
              ) {
                automation.lastRunStatus = 'failed';
              }
            }
          }
          emit({ type: 'automations.snapshot', snapshot });
          emit({ type: 'automations.result', requestId: mutation.requestId, ok: true });
        }
        if (mutation.type === 'automations.create') {
          const requestId = mutation.requestId;
          requests.push(command);
          settle = (ok) => {
            if (ok) {
              snapshot.automations.push(
                createAutomationRecord(normalizeAutomationInput(mutation.input), now()),
              );
              emit({ type: 'automations.snapshot', snapshot });
            }
            emit(
              ok
                ? { type: 'automations.result', requestId, ok: true }
                : {
                    type: 'automations.result',
                    requestId,
                    ok: false,
                    error: 'The attachment could not be saved.',
                  },
            );
          };
        }
      });
    },
  );
  return {
    requests,
    refresh(proposals?: AutomationProposal[]) {
      if (proposals) snapshot.proposals = proposals;
      emitSnapshot();
    },
    settle(ok: boolean) {
      if (!settle) throw new Error('No automation save is pending.');
      settle(ok);
    },
  };
}
