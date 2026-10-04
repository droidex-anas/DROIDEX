import type { ChildSessionSummary } from '../types/bridge';

/** A paused worker child; tests override only the fields their assertions read. */
export function childSummary(
  parentAppSessionId: string,
  childSessionId: string,
  overrides: Partial<ChildSessionSummary> = {},
): ChildSessionSummary {
  return {
    parentAppSessionId,
    childSessionId,
    role: 'worker',
    status: 'paused',
    modelId: 'model-default',
    transcriptAvailable: true,
    streamFidelity: 'state',
    ...overrides,
  };
}
