import type { MessagePort } from 'node:worker_threads';

import type { PersistedChildSession } from './history.js';
import { HistorySearchUnavailableError } from './historySearchSchema.js';
import type {
  SessionFileChange,
  SessionFileReconciliation,
  SessionFileSnapshot,
} from './sessionFileCache.js';
import type { HistorySearchReply, SessionSummary, TranscriptEvent } from './protocol.js';

export interface PersistedEventMetadata {
  id: string;
  sourceSessionId: string;
  appSessionId: string;
  kind: TranscriptEvent['kind'];
  ts: number;
}

export interface HistoryPersistenceBatch {
  events: PersistedEventMetadata[];
  summaries: SessionSummary[];
  children: PersistedChildSession[];
  estimatedBytes: number;
}

export interface HistoryPersistenceResult {
  durationMs: number;
  initializationMs?: number;
  eventsWritten: number;
  summariesWritten: number;
  childrenWritten: number;
}

export interface HistoryWriterLease {
  owner: string;
  generation: number;
  processId: number;
}

export interface HistoryPersistenceQueueSnapshot {
  pendingEntries: number;
  pendingEstimatedBytes: number;
  inFlightEntries: number;
  inFlightEstimatedBytes: number;
  peakEntries: number;
  peakEstimatedBytes: number;
  batchesCommitted: number;
  rowsCommitted: number;
  failures: number;
  retries: number;
}

export type HistoryWorkerRequest =
  | { type: 'persist'; batch: HistoryPersistenceBatch }
  | { type: 'durability-barrier' }
  | { type: 'reconcile-files' }
  | { type: 'session-file-snapshot' }
  | {
      type: 'reconcile-file-paths';
      changes: SessionFileChange[];
    }
  | { type: 'indexing-idle'; isIdle: boolean }
  | { type: 'search'; query: string }
  | { type: 'close' };

export type HistoryWorkerValue =
  | HistoryPersistenceResult
  | SessionFileReconciliation
  | SessionFileSnapshot
  | HistorySearchReply
  | { durable: true }
  | { accepted: true }
  | { closed: true };

export type HistoryWorkerResponse =
  | { ok: true; value: HistoryWorkerValue }
  | { ok: false; error: SerializedHistoryWorkerError };

export interface SerializedHistoryWorkerError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  errcode?: number;
  errstr?: string;
}

export interface HistoryWorkerEnvelope {
  request: HistoryWorkerRequest;
  replyPort: MessagePort;
  writerLease?: HistoryWriterLease;
}

export function emptyPersistenceBatch(): HistoryPersistenceBatch {
  return { events: [], summaries: [], children: [], estimatedBytes: 0 };
}

export function persistenceRowCount(batch: HistoryPersistenceBatch): number {
  return batch.events.length + batch.summaries.length + batch.children.length;
}

export function eventMetadata(event: TranscriptEvent): PersistedEventMetadata {
  return {
    id: event.id,
    sourceSessionId: event.sourceSessionId,
    appSessionId: event.appSessionId,
    kind: event.kind,
    ts: event.ts,
  };
}

export function serializeHistoryWorkerError(error: unknown): SerializedHistoryWorkerError {
  if (error instanceof Error) {
    const serialized: SerializedHistoryWorkerError = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) serialized.stack = error.stack;
    if ('code' in error && typeof error.code === 'string') serialized.code = error.code;
    if ('errcode' in error && typeof error.errcode === 'number') serialized.errcode = error.errcode;
    if ('errstr' in error && typeof error.errstr === 'string') serialized.errstr = error.errstr;
    return serialized;
  }
  return { name: 'Error', message: String(error) };
}

export function historyWorkerError(error: SerializedHistoryWorkerError): Error {
  if (error.name === 'HistorySearchUnavailableError') {
    return new HistorySearchUnavailableError(error.message);
  }
  const resolved: Error & SerializedHistoryWorkerError = new Error(error.message);
  resolved.name = error.name;
  if (error.stack) resolved.stack = error.stack;
  if (error.code !== undefined) resolved.code = error.code;
  if (error.errcode !== undefined) resolved.errcode = error.errcode;
  if (error.errstr !== undefined) resolved.errstr = error.errstr;
  return resolved;
}
