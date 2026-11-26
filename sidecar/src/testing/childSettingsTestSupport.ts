import assert from 'node:assert/strict';

import type {
  Autonomy,
  ChildSessionSummary,
  ServerEvent,
  SessionRole,
  SessionSummary,
} from '@droidex/protocol';
import { FakeFactorySession } from './fakeFactoryRuntime.js';
import type { SessionManagerTestContext } from './sessionManagerTestContext.js';

export function latestSessionList(events: ServerEvent[]): SessionSummary[] {
  return events.filter((event) => event.type === 'sessions.list').at(-1)?.sessions ?? [];
}

// History reads cross worker and threadpool boundaries, so one event-loop
// turn no longer drains the pipeline that publishes them. Wait for the
// observable event itself: each iteration yields the loop so the real work
// completes, and the bound only turns a broken pipeline into a failure.
export async function waitForEvent(
  events: ServerEvent[],
  predicate: (event: ServerEvent) => boolean,
): Promise<void> {
  for (let attempts = 0; attempts < 1000; attempts += 1) {
    if (events.some(predicate)) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('expected event never arrived');
}

export async function createMission(
  h: SessionManagerTestContext,
  options: {
    workerModel?: string;
    validatorModel?: string;
  } = {},
): Promise<void> {
  await h.create({
    sessionPurpose: 'mission-control',
    clientRef: 'child-settings',
    title: 'Child settings',
    goal: 'go',
    interactionMode: 'agi',
    autonomy: 'low',
    ...options,
  });
  await h.waitForIdle();
}

export async function openChild(
  h: SessionManagerTestContext,
  childSessionId: string,
  providerSessionId: string,
  role: Exclude<SessionRole, 'primary'>,
  modelId: string,
): Promise<FakeFactorySession> {
  return openChildForParent(h, 'provider-1', { childSessionId, providerSessionId, role, modelId });
}

export async function openChildForParent(
  h: SessionManagerTestContext,
  parentAppSessionId: string,
  input: {
    childSessionId: string;
    providerSessionId: string;
    role: Exclude<SessionRole, 'primary'>;
    modelId: string;
    initAutonomy?: Autonomy;
  },
): Promise<FakeFactorySession> {
  const child = new FakeFactorySession(input.providerSessionId, {}, h.calls);
  child.setInitModel(input.modelId);
  if (input.initAutonomy !== undefined) child.setInitAutonomy(input.initAutonomy);
  h.history.seedChildSessions([
    {
      parentAppSessionId,
      childSessionId: input.childSessionId,
      providerSessionId: input.providerSessionId,
      role: input.role,
      status: 'paused',
      modelId: input.modelId,
      spawnLink: { kind: 'spawn', id: `spawn-${input.childSessionId}` },
      transcriptAvailable: true,
      updatedAt: Date.now(),
    },
  ]);
  h.runtime.loadQueue.set(input.providerSessionId, [child]);
  await h.handle({
    type: 'child.open',
    parentAppSessionId,
    childSessionId: input.childSessionId,
    requestId: `open-${input.childSessionId}`,
  });
  assert.equal(
    h.events.some(
      (event) =>
        event.type === 'child.updated' &&
        event.parentAppSessionId === parentAppSessionId &&
        event.childSessionId === input.childSessionId &&
        event.access === 'ready',
    ),
    true,
  );
  return child;
}

export function exactSettingsEvents(
  events: ServerEvent[],
  parentAppSessionId: string,
  childSessionId: string,
): ChildSessionSummary[] {
  return events.flatMap((event) =>
    event.type === 'session.child' &&
    event.child.parentAppSessionId === parentAppSessionId &&
    event.child.childSessionId === childSessionId
      ? [event.child]
      : [],
  );
}
