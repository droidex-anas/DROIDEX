// What the board picks in a design's live preview: the element, where its
// source is written, and for a text range the words it spans. Every surface
// that picks, shows or sends an element uses this one shape.

import type { PreviewFinding } from './previewDocument';
import type { CanvasFrame, FrameRect } from './protocol';

export interface PickedElement {
  designId: string;
  revisionId: string;
  elementId: string;
  instancePath: string;
  /** Where its source is written: the offsets locate it, the line is for display. */
  source: { file: string; start: number; end: number; line: number };
  tagName: string;
  component: string | null;
  /** Its box in the design's own pixels, which a crop of it is cut from. */
  box: FrameRect;
  /** For a text range: the text it spans and the box that text is drawn in. */
  text: { excerpt: string; box: FrameRect } | null;
}

/**
 * The element a probe of the design's `revisionId` preview found, once that
 * revision has built and maps it to source; null before then.
 */
export function pickedElement(
  frame: Pick<CanvasFrame, 'designId' | 'build'>,
  revisionId: string,
  finding: PreviewFinding,
): PickedElement | null {
  const { build } = frame;
  if (build.status !== 'ready' || build.revisionId !== revisionId) return null;
  const site = build.elements.find((element) => element.elementId === finding.elementId);
  if (!site) return null;
  return {
    designId: frame.designId,
    revisionId,
    elementId: site.elementId,
    instancePath: finding.instancePath,
    source: { file: site.file, start: site.start, end: site.end, line: site.line },
    tagName: site.tagName,
    component: site.component,
    box: finding.rect,
    text: finding.text && { excerpt: finding.text.excerpt, box: finding.text.rect },
  };
}
