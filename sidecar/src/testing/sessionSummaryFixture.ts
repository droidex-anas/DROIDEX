import type { SessionSummary } from '../protocol.js';

/** A paused Droid chat summary; tests override only the fields they depend on. */
export function sessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  const appSessionId = overrides.appSessionId ?? 'app';
  return {
    appSessionId,
    providerSessionId: appSessionId,
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: appSessionId,
    goal: appSessionId,
    cwd: '',
    autonomy: 'low',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
