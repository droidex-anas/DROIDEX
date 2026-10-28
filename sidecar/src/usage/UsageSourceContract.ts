import type { UsageEvent } from './types.js';

export interface OpaqueUsageCursor {
  sourcePath: string;
  sourceId: string;
  adapterName: string;
  adapterVersion: number;
  state: string;
  revision: number;
}

export type OpaqueUsageCursorAdvance = Omit<OpaqueUsageCursor, 'revision'>;

export interface OpaqueUsageIngestBatch {
  expectedCursor: OpaqueUsageCursor | null;
  nextCursor: OpaqueUsageCursorAdvance;
  reset: boolean;
  events: readonly UsageEvent[];
}

/** Commits an adapter cursor and its normalized events atomically. */
export interface OpaqueUsageSourceStore {
  usageSourceCursor(sourcePath: string, adapterName: string): OpaqueUsageCursor | null;
  ingestUsageSource(batch: OpaqueUsageIngestBatch): {
    insertedEvents: number;
    cursor: OpaqueUsageCursor;
  };
}
