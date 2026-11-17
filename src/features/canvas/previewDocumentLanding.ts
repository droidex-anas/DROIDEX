// Where a layer added in or after a drawn element would start, as its preview
// guest finds by putting a probe in its place: the design's own layout,
// clipping and overlaps decide whether the frame would show it.

import { jsonArgument, readAnswer, readRect, type PreviewNode } from './previewDocument';
import type { FrameRect } from './protocol';

/** Last inside the element, or right after it. */
export type PreviewLandingPlace = 'inside' | 'after';

/** Its box in the design's pixels, or `unseen` where the frame would not show it. */
export type PreviewLanding = FrameRect | 'unseen';

/** Asks where a layer added at `place` of one drawn instance would start; the call itself answers. */
export function previewLandingScript(node: PreviewNode, place: PreviewLandingPlace): string {
  const asked = { elementId: node.elementId, instancePath: node.instancePath, place };
  return `globalThis.__droidexCanvasPreview.landing(${jsonArgument(asked)})`;
}

/** A landing answer, or null when the answer is not one or the instance is not drawn. */
export function readPreviewLanding(value: unknown): PreviewLanding | null {
  const parsed = readAnswer(value);
  return parsed === false ? 'unseen' : readRect(parsed);
}
