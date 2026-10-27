// The revision history the frame toolbar shows for one frame: its newest
// revisions, and Restore behind an inline confirm. A read or a restore answers
// only the frame it was asked for, so a late reply never lands on a frame the
// toolbar has moved on from.

import { CanvasRequestError, canvasMessage } from './client';
import type { RestoreRevisionInput, RevisionSummary } from './protocol';

/** One read asks for the sidecar's whole page. */
export const REVISION_PAGE_SIZE = 50;

export interface HistoryClient {
  /** The newest `REVISION_PAGE_SIZE` revisions of a design on this canvas. */
  listRevisions: (designId: string) => Promise<RevisionSummary[]>;
  restoreRevision: (input: RestoreRevisionInput) => Promise<unknown>;
}

/** The frame on show and the head its history is read against. */
export interface HistoryTarget {
  designId: string;
  headRevisionId: string;
}

export type RevisionList =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  /** `complete` when the page reached the design's first revision, so each can be numbered. */
  | { status: 'listed'; revisions: RevisionSummary[]; complete: boolean };

export type RestoreState =
  | { status: 'idle' }
  | { status: 'confirming'; revisionId: string }
  | { status: 'restoring'; revisionId: string }
  | { status: 'refused'; message: string };

export interface HistoryState {
  list: RevisionList;
  restore: RestoreState;
}

const LOADING: RevisionList = { status: 'loading' };
const IDLE: RestoreState = { status: 'idle' };

export const CHANGED_SINCE_READ = 'This frame changed since its history was read. Pick again.';

export class FrameHistory {
  private target: HistoryTarget | null = null;
  /** Bumped by every read, so only the newest one is applied. */
  private reads = 0;
  private state: HistoryState = { list: LOADING, restore: IDLE };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: HistoryClient) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly read = (): HistoryState => this.state;

  /** Shows `target`'s history, read again whenever the frame or its head changes. */
  show(target: HistoryTarget): void {
    const shown = this.target;
    if (shown?.designId === target.designId && shown.headRevisionId === target.headRevisionId)
      return;
    this.target = target;
    // A restore keeps saying so while its own write moves this frame's head.
    const keep = shown?.designId === target.designId && this.state.restore.status === 'restoring';
    this.set({ list: LOADING, restore: keep ? this.state.restore : IDLE });
    void this.load();
  }

  /** The toolbar went away: nothing still on its way may change this. */
  dispose(): void {
    this.target = null;
    this.reads += 1;
  }

  reload(): void {
    this.set({ ...this.state, list: LOADING });
    void this.load();
  }

  confirm(revisionId: string): void {
    if (this.state.restore.status === 'restoring') return;
    this.set({ ...this.state, restore: { status: 'confirming', revisionId } });
  }

  cancel(): void {
    if (this.state.restore.status === 'restoring') return;
    this.set({ ...this.state, restore: IDLE });
  }

  /**
   * Restores the confirmed revision over the head it was confirmed against.
   * True once the sidecar wrote it; the new head then arrives with the canvas.
   */
  async restore(): Promise<boolean> {
    const { restore } = this.state;
    const target = this.target;
    if (restore.status !== 'confirming' || !target) return false;
    const { revisionId } = restore;
    this.set({ ...this.state, restore: { status: 'restoring', revisionId } });
    const stillShown = () =>
      this.target?.designId === target.designId &&
      this.state.restore.status === 'restoring' &&
      this.state.restore.revisionId === revisionId;
    try {
      // CAS on the head means a retried restore can never land twice.
      await this.client.restoreRevision({
        mutationId: crypto.randomUUID(),
        designId: target.designId,
        revisionId,
        expectedRevisionId: target.headRevisionId,
      });
    } catch (error) {
      if (!stillShown()) return false;
      const changed = error instanceof CanvasRequestError && error.code === 'revision_conflict';
      const message = changed ? CHANGED_SINCE_READ : canvasMessage(error);
      this.set({ ...this.state, restore: { status: 'refused', message } });
      if (changed) this.reload();
      return false;
    }
    if (stillShown()) this.set({ ...this.state, restore: IDLE });
    return true;
  }

  private async load(): Promise<void> {
    const target = this.target;
    if (!target) return;
    this.reads += 1;
    const read = this.reads;
    let list: RevisionList;
    try {
      const revisions = await this.client.listRevisions(target.designId);
      list = { status: 'listed', revisions, complete: revisions.length < REVISION_PAGE_SIZE };
    } catch (error) {
      list = { status: 'failed', message: canvasMessage(error) };
    }
    if (read === this.reads) this.set({ ...this.state, list });
  }

  private set(next: HistoryState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
