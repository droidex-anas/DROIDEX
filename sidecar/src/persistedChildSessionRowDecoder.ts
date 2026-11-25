import type { ReasoningEffort } from '@droidex/protocol';
import type { PersistedChildSession, PersistedChildSpawnLink } from './history.js';
import { decodeProviderSessionIdList } from './historyProviderIds.js';
import { historySchemaRecovery } from './historySchema.js';
import { reasoningValue } from './modelCatalog.js';
import { numberValue, stringValue } from './values.js';

export function persistedChildSessionFromRow(row: Record<string, unknown>): PersistedChildSession {
  const parentAppSessionId = stringValue(row.parent_app_session_id);
  const childSessionId = stringValue(row.child_session_id);
  const role = persistedChildRole(row.role);
  const status = persistedChildStatus(row.status);
  const modelId = stringValue(row.model_id);
  const updatedAt = numberValue(row.updated_at);
  if (!parentAppSessionId || !childSessionId || !modelId || updatedAt === undefined)
    throw new Error(historySchemaRecovery());
  const spawnLink = persistedChildSpawnLink(row);
  const previousProviderSessionIds = decodeProviderSessionIdList(
    row.previous_provider_session_ids,
    historySchemaRecovery(),
  );
  return {
    parentAppSessionId,
    childSessionId,
    ...whenString(row.provider_session_id, (providerSessionId) => ({ providerSessionId })),
    ...(previousProviderSessionIds.length > 0 ? { previousProviderSessionIds } : {}),
    role,
    ...whenString(row.label, (label) => ({ label })),
    ...whenString(row.prompt, (prompt) => ({ prompt })),
    ...whenString(row.group_name, (group) => ({ group })),
    ...whenString(row.phase, (phase) => ({ phase })),
    status,
    modelId,
    ...whenReasoning(row.reasoning_effort),
    ...(spawnLink ? { spawnLink } : {}),
    transcriptAvailable: numberValue(row.transcript_available) === 1,
    ...whenNumber(row.started_at, (startedAt) => ({ startedAt })),
    ...whenNumber(row.settled_at, (settledAt) => ({ settledAt })),
    updatedAt,
  };
}

function persistedChildRole(value: unknown): PersistedChildSession['role'] {
  const role = stringValue(value);
  if (role === 'worker' || role === 'validator') return role;
  throw new Error(historySchemaRecovery());
}

function persistedChildStatus(value: unknown): PersistedChildSession['status'] {
  const status = stringValue(value);
  if (
    status === 'pending' ||
    status === 'running' ||
    status === 'paused' ||
    status === 'completed' ||
    status === 'failed'
  )
    return status;
  throw new Error(historySchemaRecovery());
}

function persistedChildSpawnLink(
  row: Record<string, unknown>,
): PersistedChildSpawnLink | undefined {
  const kind = stringValue(row.spawn_link_kind);
  const id = stringValue(row.spawn_link_id);
  if (kind === undefined && id === undefined) return undefined;
  if ((kind === 'tool-use' || kind === 'spawn') && id) return { kind, id };
  throw new Error(historySchemaRecovery());
}

function whenString<T extends object>(
  value: unknown,
  create: (value: string) => T,
): T | Record<string, never> {
  const resolved = stringValue(value);
  return resolved === undefined ? {} : create(resolved);
}

function whenNumber<T extends object>(
  value: unknown,
  create: (value: number) => T,
): T | Record<string, never> {
  const resolved = numberValue(value);
  return resolved === undefined ? {} : create(resolved);
}

function whenReasoning(
  value: unknown,
): { reasoningEffort: ReasoningEffort } | Record<string, never> {
  const reasoningEffort = reasoningValue(value);
  return reasoningEffort === undefined ? {} : { reasoningEffort };
}
