import type { MessagePort } from 'node:worker_threads';

import type {
  RemoteUsageSync,
  UsageSyncState as RemoteUsageSyncState,
} from '../../../packages/remote/src/usage.js';
import type { OpenCodeReconcileResult } from './OpenCodeIngest.js';
import type { DroidSettingsReconcileResult } from './DroidSettingsIngest.js';
import type { UsageReconcileResult, UsageSourceRoot } from './UsageIngest.js';
import type { UsageSnapshot } from './UsageSnapshot.js';

export type UsageSyncState = RemoteUsageSyncState;
export type UsageSyncStatus = RemoteUsageSync;

export interface UsageWorkerSnapshot extends UsageSnapshot {
  sync: UsageSyncStatus;
}

export interface UsageWorkerData {
  databasePath: string;
  roots?: UsageSourceRoot[];
  openCodeRoots?: string[];
  droidSettingsRoots?: string[];
  timeZone?: string;
}

export interface UsageWorkerReconcileResult {
  jsonl: UsageReconcileResult;
  openCode: OpenCodeReconcileResult;
  droidSettings: DroidSettingsReconcileResult;
}

export type UsageWorkerRequest =
  | { type: 'snapshot' }
  | { type: 'reconcile' }
  | { type: 'record-droidex-sessions'; ids: string[] }
  | { type: 'close' };

export type UsageWorkerValue =
  | UsageWorkerSnapshot
  | UsageWorkerReconcileResult
  | { insertedSessions: number }
  | { closed: true };

export type UsageWorkerResponse =
  | { ok: true; value: UsageWorkerValue }
  | { ok: false; error: { name: string; message: string; code?: string } };

export interface UsageWorkerEnvelope {
  request: UsageWorkerRequest;
  replyPort: MessagePort;
}

export function usageWorkerError(value: UsageWorkerResponse & { ok: false }): Error {
  const error = new Error(value.error.message);
  error.name = value.error.name;
  if (value.error.code) Object.assign(error, { code: value.error.code });
  return error;
}

export function serializeUsageWorkerError(error: unknown): UsageWorkerResponse & { ok: false } {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return {
      ok: false,
      error: {
        name: error.name,
        message: error.message,
        ...(code ? { code } : {}),
      },
    };
  }
  return { ok: false, error: { name: 'Error', message: String(error) } };
}
