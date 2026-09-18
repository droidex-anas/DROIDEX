import type { ProjectView } from './types';

export function isProjectView(value: unknown): value is ProjectView {
  if (!record(value) || !text(value.id, 200) || !text(value.title, 120)) return false;
  if (
    typeof value.paused !== 'boolean' ||
    !count(value.wakesLeft, 20) ||
    !count(value.launching, 8)
  )
    return false;
  if (!count(value.queued, 64) || !count(value.uncertain, 64)) return false;
  if (value.error !== undefined && !text(value.error, 2_000)) return false;
  if (!Array.isArray(value.threads) || value.threads.length > 8) return false;
  const owners = new Map<string, string | undefined>();
  for (const thread of value.threads) {
    if (
      !record(thread) ||
      !text(thread.appSessionId, 200) ||
      !text(thread.title, 120) ||
      typeof thread.waiting !== 'boolean'
    )
      return false;
    if (thread.ownerAppSessionId !== undefined && !text(thread.ownerAppSessionId, 200))
      return false;
    if (owners.has(thread.appSessionId)) return false;
    owners.set(thread.appSessionId, thread.ownerAppSessionId);
  }
  if (owners.size && [...owners.values()].filter((owner) => owner === undefined).length !== 1)
    return false;
  for (const [id, parent] of owners) {
    const seen = new Set([id]);
    let owner = parent;
    while (owner !== undefined) {
      if (seen.has(owner) || !owners.has(owner)) return false;
      seen.add(owner);
      owner = owners.get(owner);
    }
  }
  return (
    Array.isArray(value.uncertainTargets) &&
    value.uncertainTargets.length <= 8 &&
    value.uncertainTargets.every((id: unknown) => typeof id === 'string' && owners.has(id))
  );
}

export function isProjectResult(value: Record<string, unknown>): boolean {
  if (!text(value.requestId, 200)) return false;
  if (value.ok === false) return text(value.error, 8_192);
  return (
    value.ok === true &&
    (value.projectId === undefined || text(value.projectId, 200)) &&
    (value.appSessionId === undefined || text(value.appSessionId, 200))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function count(value: unknown, max: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
