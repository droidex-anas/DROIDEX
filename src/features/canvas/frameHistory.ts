// The versions the frame toolbar lists for one frame, and switching the frame
// to show one of them. A read or a switch answers only the frame it was asked
// for, so a late reply never lands on a frame the toolbar has moved on from.

import { CanvasRequestError, canvasMessage } from './client';
import type { RevisionSummary, SwitchRevisionInput } from './protocol';
import { MAX_REVISION_PAGE_SIZE } from './wireValidation';

export interface HistoryClient {
  /** The newest `MAX_REVISION_PAGE_SIZE` revisions of a design on this canvas. */
  listRevisions: (designId: string) => Promise<RevisionSummary[]>;
  switchRevision: (input: SwitchRevisionInput) => Promise<unknown>;
}

/** The frame on show and the head its history is read against. */
export interface HistoryTarget {
  designId: string;
  headRevisionId: string;
}

export type RevisionList =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  /** `complete` when the page reached the design's first revision. */
  | { status: 'listed'; revisions: RevisionSummary[]; complete: boolean };

/** The version number of a listed revision. */
export function revisionNumber(list: RevisionList, revisionId: string | null): number | null {
  if (list.status !== 'listed') return null;
  return list.revisions.find((revision) => revision.revisionId === revisionId)?.version ?? null;
}

const LOADING: RevisionList = { status: 'loading' };

export const CHANGED_SINCE_READ = 'This frame changed since its versions were read. Pick again.';

export class FrameHistory {
  private target: HistoryTarget | null = null;
  /** Bumped by every read, so only the newest one is applied. */
  private reads = 0;
  private switching = false;
  private list: RevisionList = LOADING;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: HistoryClient) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly read = (): RevisionList => this.list;

  /** Shows `target`'s versions, read again whenever the frame or its head changes. */
  show(target: HistoryTarget): void {
    const shown = this.target;
    if (shown?.designId === target.designId && shown.headRevisionId === target.headRevisionId)
      return;
    this.target = target;
    this.set(LOADING);
    void this.load();
  }

  /** The toolbar went away: nothing still on its way may change this. */
  dispose(): void {
    this.target = null;
    this.reads += 1;
  }

  reload(): void {
    this.set(LOADING);
    void this.load();
  }

  /**
   * Shows `revisionId` on the frame, against the head its versions were read
   * for. Resolves with why the sidecar refused, or null once it moved or when
   * there is nothing to say: the new head arrives with the canvas.
   */
  async switchTo(revisionId: string): Promise<string | null> {
    const target = this.target;
    if (!target || this.switching || revisionId === target.headRevisionId) return null;
    this.switching = true;
    try {
      // CAS on the head means a retried switch can never land on a newer edit.
      await this.client.switchRevision({
        mutationId: crypto.randomUUID(),
        designId: target.designId,
        revisionId,
        expectedRevisionId: target.headRevisionId,
      });
      return null;
    } catch (error) {
      if (this.target?.designId !== target.designId) return null;
      if (!(error instanceof CanvasRequestError && error.code === 'revision_conflict'))
        return canvasMessage(error);
      this.reload();
      return CHANGED_SINCE_READ;
    } finally {
      this.switching = false;
    }
  }

  private async load(): Promise<void> {
    const target = this.target;
    if (!target) return;
    this.reads += 1;
    const read = this.reads;
    let list: RevisionList;
    try {
      const revisions = await this.client.listRevisions(target.designId);
      list = { status: 'listed', revisions, complete: revisions.length < MAX_REVISION_PAGE_SIZE };
    } catch (error) {
      list = { status: 'failed', message: canvasMessage(error) };
    }
    if (read === this.reads) this.set(list);
  }

  private set(next: RevisionList): void {
    this.list = next;
    for (const listener of this.listeners) listener();
  }
}
