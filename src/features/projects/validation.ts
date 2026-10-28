import type { ProjectStep, ProjectThread, ProjectView } from './types';

export function isProjectView(value: unknown): value is ProjectView {
  if (!record(value) || !isProjectMetadata(value) || !isThreadList(value.threads)) return false;
  if (!isPlan(value.plan)) return false;
  if (!Array.isArray(value.todos) || value.todos.length > 40 || !value.todos.every(isTodo))
    return false;
  if (
    !record(value.runtimeLoad) ||
    !count(value.runtimeLoad.live) ||
    !count(value.runtimeLoad.limit) ||
    value.runtimeLoad.limit === 0
  )
    return false;
  const owners = new Map(
    value.threads.map((thread) => [thread.appSessionId, thread.ownerAppSessionId]),
  );
  return owners.size === value.threads.length && validOwnership(owners);
}

function isTodo(value: unknown): boolean {
  return (
    record(value) &&
    text(value.id, 200) &&
    text(value.text, 400) &&
    (value.after === undefined || text(value.after, 200)) &&
    (value.dueAt === undefined || count(value.dueAt)) &&
    (value.due === undefined || value.due === true)
  );
}

function isProjectMetadata(value: Record<string, unknown>): boolean {
  return (
    text(value.id, 200) &&
    text(value.title, 120) &&
    (value.brief === undefined ||
      (typeof value.brief === 'string' && value.brief.length <= 2_000)) &&
    (value.cwd === undefined || text(value.cwd, 4_096)) &&
    (value.startedAt === undefined || count(value.startedAt)) &&
    (value.done === undefined ||
      (record(value.done) && count(value.done.at) && text(value.done.outcome, 600))) &&
    typeof value.paused === 'boolean' &&
    (value.leadStopped === undefined || value.leadStopped === true) &&
    // A project starts as many threads as its work needs; only its queues are bounded.
    count(value.launching) &&
    count(value.queued, 64) &&
    count(value.uncertain, 64) &&
    (value.error === undefined || text(value.error, 2_000))
  );
}

function isPlan(value: unknown): value is ProjectStep[] {
  return (
    Array.isArray(value) &&
    value.length <= 60 &&
    value.every(
      (step: unknown) =>
        record(step) &&
        text(step.id, 200) &&
        text(step.title, 200) &&
        (step.milestone === undefined || text(step.milestone, 80)) &&
        (step.note === undefined || text(step.note, 400)) &&
        (step.threadAppSessionId === undefined || text(step.threadAppSessionId, 200)) &&
        (step.state === undefined ||
          ['planned', 'doing', 'review', 'done', 'blocked'].includes(step.state as string)),
    )
  );
}

function isThreadList(value: unknown): value is ProjectThread[] {
  return (
    Array.isArray(value) &&
    value.every(
      (thread: unknown) =>
        record(thread) &&
        text(thread.appSessionId, 200) &&
        text(thread.title, 120) &&
        typeof thread.waiting === 'boolean' &&
        (thread.unread === undefined || thread.unread === true) &&
        typeof thread.state === 'string' &&
        [
          'working',
          'queued',
          'waiting',
          'approval',
          'rate-limited',
          'stopped',
          'failed',
          'idle',
        ].includes(thread.state) &&
        (thread.resetsAt === undefined || count(thread.resetsAt)) &&
        (thread.approval === undefined ||
          (record(thread.approval) &&
            text(thread.approval.requestId, 200) &&
            text(thread.approval.summary, 600))) &&
        (thread.state !== 'approval' || thread.approval !== undefined) &&
        (thread.wait === undefined || isThreadWait(thread.wait)) &&
        (thread.ownerAppSessionId === undefined || text(thread.ownerAppSessionId, 200)),
    )
  );
}

function isThreadWait(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === 'turn') return true;
  return (
    (value.kind === 'start' || value.kind === 'slot') &&
    count(value.position) &&
    value.position !== 0
  );
}

function validOwnership(owners: Map<string, string | undefined>): boolean {
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
  return true;
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
function count(value: unknown, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
