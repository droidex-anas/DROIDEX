// What each design's live preview last did, in the words of the pane running
// it. A compiler cannot see a design that throws while it renders; the pane
// can, and this is how the agent hears it. Nothing here is durable or
// canonical: it is the latest report per design, for whichever revision ran.

import { designKey } from './canvasBuildStates.js';
import type { CanvasFrame, PreviewReport } from './protocol.js';

type PreviewListener = (canvasId: string, report: PreviewReport) => void;

export class CanvasPreviewReports {
  private readonly latest = new Map<string, PreviewReport>();
  private readonly listeners = new Set<PreviewListener>();

  record(canvasId: string, report: PreviewReport): void {
    this.latest.set(designKey(canvasId, report.designId), report);
    for (const listener of this.listeners) listener(canvasId, report);
  }

  /** The latest report on the frame's current revision, or null when no pane ran it. */
  reportFor(
    canvasId: string,
    frame: Pick<CanvasFrame, 'designId' | 'revisionId'>,
  ): PreviewReport | null {
    const report = this.latest.get(designKey(canvasId, frame.designId)) ?? null;
    return report?.revisionId === frame.revisionId ? report : null;
  }

  subscribe(listener: PreviewListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
