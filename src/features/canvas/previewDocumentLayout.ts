// Whether a design's preview guest shows the elements one layer of its
// outline drew. The compiler gives each JSX usage a row is written at that
// row's id, so the guest finds what the usage drew even where a component
// draws it.

import { readAnswer, readRect } from './previewDocument';
import type { FrameRect } from './protocol';

/** Its box in the design's pixels, or `unseen` where the frame does not show it. */
export type PreviewShown = FrameRect | 'unseen';

/** Asks whether the frame shows what the layer `nodeId` drew; the call itself answers. */
export function previewShownScript(nodeId: string): string {
  return `globalThis.__droidexCanvasPreview.shown(${JSON.stringify({ nodeId })})`;
}

/** A shown answer, or null when it is not one or the layer is not drawn. */
export function readPreviewShown(value: unknown): PreviewShown | null {
  const parsed = readAnswer(value);
  return parsed === false ? 'unseen' : readRect(parsed);
}
