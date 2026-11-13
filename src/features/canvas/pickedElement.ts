// What the board picks in a design's live preview: the element, where its
// source is written, and for a text range the words it spans. Every surface
// that picks, shows or sends an element uses this one shape.

import type { PreviewFinding } from './previewDocument';
import type { CanvasFrame, FrameRect, OutlineNode } from './protocol';

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
  const site = elementSite(frame, revisionId, finding.elementId);
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

/** Where an element of the design's `revisionId` is written, known once that revision has built. */
export function elementSite(
  frame: Pick<CanvasFrame, 'build'>,
  revisionId: string,
  elementId: string,
) {
  const { build } = frame;
  if (build.status !== 'ready' || build.revisionId !== revisionId) return undefined;
  return build.elements.find((element) => element.elementId === elementId);
}

/** The layer a board Delete names, or why it names none. */
export type PickedLayer = { row: OutlineNode } | { refusal: string };

const UNRESOLVED_USAGE =
  'Can’t tell this element from the component that draws it. Delete it from the layers panel.';

/**
 * The layer Delete removes for an element picked in the design's `revisionId`,
 * once that revision has built: the element's own outline row, or where it is
 * all a component draws, the row of that component's usage. An element drawn
 * in several places has a row for each, all one written element that renders
 * more than once, so whichever is named is refused as its lock says. Under a
 * usage named otherwise than its component (`import { Card as C }`), only JSX
 * written at the usage is named; anything else is refused rather than risk
 * editing the component in place of the usage.
 */
export function pickedLayer(
  frame: Pick<CanvasFrame, 'build'>,
  revisionId: string,
  elementId: string,
): PickedLayer | undefined {
  const { build } = frame;
  if (build.status !== 'ready' || build.revisionId !== revisionId) return undefined;
  const { nodes } = build.outline;
  const rows = nodes.filter((node) => node.elementId === elementId);
  if (rows.length === 0) return undefined;
  const [row] = rows;
  if (rows.length > 1) return { row };
  const usage = nodes.find((node) => node.nodeId === row.parentId);
  if (usage?.kind !== 'instance') return { row };
  const writtenIn = (node: OutlineNode) => siteOf(build, node)?.component;
  if (writtenIn(row) !== usage.name)
    return isWrittenAtUsage(build, row, usage) ? { row } : { refusal: UNRESOLVED_USAGE };
  // The usage also lists the JSX passed in its props, written outside its component.
  const drawsOnlyRow = nodes.every(
    (node) =>
      node.parentId !== usage.nodeId ||
      node === row ||
      (node.kind === 'element' && writtenIn(node) !== usage.name),
  );
  return { row: drawsOnlyRow ? usage : row };
}

type ReadyBuild = Extract<CanvasFrame['build'], { status: 'ready' }>;

function siteOf(build: ReadyBuild, node: OutlineNode | undefined) {
  return build.elements.find((element) => element.elementId === node?.elementId);
}

/**
 * Whether `row` is written inside the nearest element holding `usage`, as JSX
 * passed in the usage's props is; a component's own elements are written elsewhere.
 */
function isWrittenAtUsage(build: ReadyBuild, row: OutlineNode, usage: OutlineNode): boolean {
  const { nodes } = build.outline;
  const parentOf = (node: OutlineNode) => nodes.find((each) => each.nodeId === node.parentId);
  let holder = parentOf(usage);
  while (holder && holder.kind !== 'element') holder = parentOf(holder);
  const written = siteOf(build, row);
  const around = siteOf(build, holder);
  if (!written || !around) return false;
  return written.file === around.file && written.start >= around.start && written.end <= around.end;
}
