import { PERMISSION_SEMANTICS_REVISION } from '../permissionSemantics.js';
import {
  automationFilesSchema,
  automationScheduleSchema,
  automationTargetSchema,
} from './automationSchemas.js';
import {
  isReasoningEffort,
  isAutonomy,
  missingProposalFields,
  normalizeAutomationInput,
} from './automationInput.js';
import { nextAutomationRun } from './schedule.js';
import type {
  Automation,
  AutomationInput,
  AutomationProposal,
  AutomationRun,
  AutomationRunStatus,
  AutomationStore,
} from './types.js';

const STORE_VERSION = 1;

export function parseAutomationStore(value: unknown, now: number): AutomationStore {
  const raw = recordValue(value);
  if (!raw) throw new Error('The automations store is not an object.');
  if (raw.version !== STORE_VERSION) {
    throw new Error(
      `Unsupported automations store version ${JSON.stringify(raw.version)}; DROIDEX writes version ${String(STORE_VERSION)}.`,
    );
  }
  if (
    !Array.isArray(raw.automations) ||
    !Array.isArray(raw.runs) ||
    !Array.isArray(raw.proposals)
  ) {
    throw new Error('The automations store is missing its automations, runs, or proposals list.');
  }

  if (
    raw.permissionSemanticsRevision !== undefined &&
    raw.permissionSemanticsRevision !== PERMISSION_SEMANTICS_REVISION
  )
    throw new Error('Unsupported automation permission semantics revision.');
  // These definitions run on Droid, whose stored levels retain their meaning.
  // The revision is persisted by initialize() before the scheduler can run.
  const automations = raw.automations
    .map((candidate) => parseAutomation(candidate, now))
    .filter((candidate): candidate is Automation => candidate !== null);
  const automationIds = new Set(automations.map((automation) => automation.id));
  const runs = raw.runs
    .map((candidate) => parseRun(candidate, now))
    .filter(
      (candidate): candidate is AutomationRun =>
        candidate !== null && automationIds.has(candidate.automationId),
    );
  const proposals = raw.proposals
    .map((candidate) => parseProposal(candidate, automationIds, now))
    .filter((candidate): candidate is AutomationProposal => candidate !== null);
  return {
    version: STORE_VERSION,
    permissionSemanticsRevision: PERMISSION_SEMANTICS_REVISION,
    automations,
    runs,
    proposals,
    sessionOrigins: parseSessionOrigins(raw.sessionOrigins),
  };
}

function parseAutomation(value: unknown, now: number): Automation | null {
  const raw = recordValue(value);
  if (!raw || typeof raw.id !== 'string') return null;
  const input = parseStoredAutomationInput(raw);
  if (!input) {
    console.error('Dropped an invalid automation record');
    return null;
  }
  try {
    const normalized = normalizeAutomationInput(input);
    const storedNextRunAt = finiteNumberOrNull(raw.nextRunAt);
    return {
      id: raw.id,
      ...normalized,
      nextRunAt:
        normalized.enabled && storedNextRunAt === null
          ? nextAutomationRun(normalized.schedule, normalized.timezone, now)
          : storedNextRunAt,
      lastRunAt: finiteNumberOrNull(raw.lastRunAt),
      lastRunStatus: parseRunStatus(raw.lastRunStatus),
      lastRunError: stringOrNull(raw.lastRunError),
      lastRunDurationMs: finiteNumberOrNull(raw.lastRunDurationMs),
      lastAppSessionId: stringOrNull(raw.lastAppSessionId),
      completedAt: finiteNumberOrNull(raw.completedAt),
      createdAt: finiteNumber(raw.createdAt, now),
      updatedAt: finiteNumber(raw.updatedAt, now),
    };
  } catch (error) {
    console.error('Dropped an invalid automation record', error);
    return null;
  }
}

function parseRun(value: unknown, now: number): AutomationRun | null {
  const raw = recordValue(value);
  if (!raw || typeof raw.id !== 'string' || typeof raw.automationId !== 'string') return null;
  const snapshot = parseRunAutomationSnapshot(raw.automation);
  if (!snapshot) return null;
  return {
    id: raw.id,
    automationId: raw.automationId,
    automation: snapshot,
    scheduledAt: finiteNumber(raw.scheduledAt, now),
    requestedAt: finiteNumber(raw.requestedAt, now),
    trigger: raw.trigger === 'manual' ? 'manual' : 'schedule',
    status: parseRunStatus(raw.status) ?? 'failed',
    startedAt: finiteNumberOrNull(raw.startedAt),
    finishedAt: finiteNumberOrNull(raw.finishedAt),
    clientRef: stringOrNull(raw.clientRef),
    appSessionId: stringOrNull(raw.appSessionId),
    resolvedCwd: stringOrNull(raw.resolvedCwd),
    error: stringOrNull(raw.error),
    effectiveModelId: stringOrNull(raw.effectiveModelId),
    effectiveReasoningEffort: isReasoningEffort(raw.effectiveReasoningEffort)
      ? raw.effectiveReasoningEffort
      : null,
    selectionVerified: typeof raw.selectionVerified === 'boolean' ? raw.selectionVerified : null,
  };
}

function parseProposal(
  value: unknown,
  automationIds: ReadonlySet<string>,
  now: number,
): AutomationProposal | null {
  const raw = recordValue(value);
  const draftRaw = raw ? recordValue(raw.draft) : null;
  if (
    !raw ||
    !draftRaw ||
    typeof raw.id !== 'string' ||
    typeof raw.sourceAppSessionId !== 'string'
  ) {
    return null;
  }
  const input = parseStoredAutomationInput(draftRaw);
  if (!input) return null;
  try {
    const draft = normalizeAutomationInput(input);
    const storedAutomationId =
      typeof raw.automationId === 'string' && automationIds.has(raw.automationId)
        ? raw.automationId
        : null;
    const storedStatus = parseProposalStatus(raw.status);
    // A confirmed proposal whose automation is gone is a draft again, never a
    // dangling link to an automation the user deleted.
    const status = storedStatus === 'confirmed' && !storedAutomationId ? 'draft' : storedStatus;
    return {
      id: raw.id,
      sourceAppSessionId: raw.sourceAppSessionId,
      draft,
      status,
      missingFields: status === 'confirmed' ? [] : missingProposalFields(draft),
      automationId: storedAutomationId,
      createdAt: finiteNumber(raw.createdAt, now),
      updatedAt: finiteNumber(raw.updatedAt, now),
      confirmedAt: finiteNumberOrNull(raw.confirmedAt),
    };
  } catch (error) {
    console.error('Dropped an invalid automation proposal', error);
    return null;
  }
}

function parseStoredAutomationInput(raw: Record<string, unknown>): AutomationInput | null {
  if (
    typeof raw.title !== 'string' ||
    typeof raw.prompt !== 'string' ||
    !recordValue(raw.schedule)
  ) {
    return null;
  }
  const { target: storedTarget, files: storedFiles } = raw;
  const schedule = automationScheduleSchema.safeParse(raw.schedule);
  const target = automationTargetSchema.safeParse(storedTarget ?? { kind: 'new-session' });
  const files = automationFilesSchema.safeParse(storedFiles ?? []);
  if (!schedule.success || !target.success || !files.success) return null;
  const input: AutomationInput = {
    target: target.data,
    files: files.data,
    title: raw.title,
    prompt: raw.prompt,
    workspaceCwd: stringOrNull(raw.workspaceCwd),
    executionMode: raw.executionMode === 'worktree' ? 'worktree' : 'local',
    enabled: raw.enabled !== false,
    schedule: schedule.data,
    modelId: stringOrNull(raw.modelId),
    reasoningEffort: isReasoningEffort(raw.reasoningEffort) ? raw.reasoningEffort : null,
    autonomy: isAutonomy(raw.autonomy) ? raw.autonomy : undefined,
  };
  if (typeof raw.timezone === 'string') input.timezone = raw.timezone;
  return input;
}

function parseRunAutomationSnapshot(value: unknown): AutomationRun['automation'] | null {
  const raw = recordValue(value);
  if (
    !raw ||
    typeof raw.id !== 'string' ||
    typeof raw.title !== 'string' ||
    typeof raw.prompt !== 'string'
  ) {
    return null;
  }
  const { target: storedTarget, files: storedFiles } = raw;
  const target = automationTargetSchema.safeParse(storedTarget ?? { kind: 'new-session' });
  const files = automationFilesSchema.safeParse(storedFiles ?? []);
  if (!target.success || !files.success) return null;
  return {
    target: target.data,
    files: files.data,
    id: raw.id,
    title: raw.title,
    prompt: raw.prompt,
    workspaceCwd: stringOrNull(raw.workspaceCwd),
    executionMode: raw.executionMode === 'worktree' ? 'worktree' : 'local',
    timezone: typeof raw.timezone === 'string' ? raw.timezone : 'UTC',
    modelId: stringOrNull(raw.modelId),
    reasoningEffort: isReasoningEffort(raw.reasoningEffort) ? raw.reasoningEffort : null,
    autonomy: isAutonomy(raw.autonomy) ? raw.autonomy : 'low',
  };
}

function parseSessionOrigins(value: unknown): AutomationStore['sessionOrigins'] {
  const origins = recordValue(value) ?? {};
  const sessionOrigins: AutomationStore['sessionOrigins'] = {};
  for (const [appSessionId, candidate] of Object.entries(origins)) {
    const origin = recordValue(candidate);
    if (
      !origin ||
      typeof origin.automationId !== 'string' ||
      typeof origin.automationTitle !== 'string' ||
      typeof origin.runId !== 'string'
    ) {
      continue;
    }
    sessionOrigins[appSessionId] = {
      automationId: origin.automationId,
      automationTitle: origin.automationTitle,
      runId: origin.runId,
      trigger: origin.trigger === 'manual' ? 'manual' : 'schedule',
    };
  }
  return sessionOrigins;
}

function parseProposalStatus(value: unknown): AutomationProposal['status'] {
  return value === 'confirmed' ? 'confirmed' : 'draft';
}

function parseRunStatus(value: unknown): AutomationRunStatus | null {
  return value === 'queued' ||
    value === 'starting' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed'
    ? value
    : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
