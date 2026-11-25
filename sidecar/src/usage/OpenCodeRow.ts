import { createHash } from 'node:crypto';

import { objectValue } from '../values.js';
import type { UsageEvent } from './types.js';

const MAX_TEXT_BYTES = 1_024;
const MAX_MODEL_LENGTH = 160;
const MAX_DATE_MS = 8_640_000_000_000_000;

export interface OpenCodeMessageRow {
  rowId: number;
  id: string | null;
  sessionId: string | null;
  data: unknown;
  created: number | null;
}

type NormalizedRow =
  | { kind: 'event'; event: UsageEvent }
  | { kind: 'unfinished' | 'skip' | 'malformed' };

// eslint-disable-next-line complexity -- Keep the row outcomes and provider field fallbacks together.
export function normalizeOpenCodeRow(row: OpenCodeMessageRow, sourceId: string): NormalizedRow {
  if (typeof row.data !== 'string') return { kind: 'malformed' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return { kind: 'malformed' };
  }
  const message = objectValue(parsed);
  if (!message) return { kind: 'malformed' };
  const role = message.role;
  if (role !== undefined && role !== 'assistant') return { kind: 'skip' };
  const time = objectValue(message.time);
  const completed = time?.completed;
  if (completed === undefined || completed === null) return { kind: 'unfinished' };
  if (count(completed) === null) return { kind: 'malformed' };
  const tokens = objectValue(message.tokens);
  const cache = objectValue(tokens?.cache);
  const cacheReadTokens = count(cache?.read);
  const cacheWriteTokens = count(cache?.write);
  const reasoningTokens = count(tokens?.reasoning);
  const inputTokens = completeSum(count(tokens?.input), cacheReadTokens, cacheWriteTokens);
  const outputTokens = completeSum(count(tokens?.output), reasoningTokens);
  const providerCostMicrousd = costMicrousd(message.cost);
  if (!hasUsage(inputTokens, outputTokens, providerCostMicrousd)) return { kind: 'skip' };
  const modelReference = objectValue(message.model);
  const model =
    modelText(modelReference?.id) ??
    modelText(modelReference?.modelID) ??
    modelText(message.modelID);
  const tsMs = count(time?.created) ?? row.created;
  if (!model || tsMs === null || tsMs > MAX_DATE_MS) return { kind: 'malformed' };
  const sessionId = row.sessionId ?? readOpenCodeText(message.sessionID);
  const messageId = row.id ?? readOpenCodeText(message.id);
  const identity =
    messageId ??
    hash(
      [
        sourceId,
        row.rowId,
        sessionId,
        tsMs,
        model,
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
        reasoningTokens,
        providerCostMicrousd,
      ].join('\0'),
    );
  return {
    kind: 'event',
    event: {
      dedupeKey: `opencode:${identity.length <= 900 ? identity : hash(identity)}`,
      harnessId: 'opencode',
      harnessDisplayName: 'OpenCode',
      provider: modelText(modelReference?.providerID) ?? modelText(message.providerID),
      sourceId,
      sessionId,
      project: null,
      sessionStartedAtMs: null,
      tsMs,
      model,
      serviceTier: null,
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      reasoningTokens,
      providerCostMicrousd,
      estimatedCostMicrousd: null,
      pricingVersion: null,
    },
  };
}

export function readOpenCodeText(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value) <= MAX_TEXT_BYTES &&
    !value.includes('\0')
    ? value
    : null;
}
function modelText(value: unknown): string | null {
  const model = readOpenCodeText(value);
  return model && model.length <= MAX_MODEL_LENGTH ? model : null;
}
function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}
function completeSum(...values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Number.isSafeInteger(total) ? total : null;
}
function costMicrousd(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const result = Math.round(value * 1_000_000);
  return Number.isSafeInteger(result) ? result : null;
}
function hasUsage(...values: (number | null)[]): boolean {
  return values.some((value) => value !== null && value > 0);
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
