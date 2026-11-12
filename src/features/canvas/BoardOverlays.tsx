// What the board draws over its frames in their own coordinates, inside the
// world layer so pan and zoom carry it: the agents at work, Edit's and
// Design's element outlines, a picked path's points, the box around a
// multi-selection, and the marks, in that order.

import { AnnotationLayer, type AnnotationLayerProps } from './AnnotationLayer';
import type { PlacedFrame } from './canvasGeometry';
import type { CanvasMotion } from './canvasMotion';
import type { CanvasPresence, LandedWrites } from './canvasPresence';
import { CanvasPresenceLayer } from './CanvasPresenceLayer';
import type { BoardInteraction } from './canvasState';
import type { PickedOnBoard } from './elementOnBoard';
import { ElementOutlines, type PickOutline } from './ElementOutlines';
import { PathGrips } from './paths/PathGrips';
import type { PreviewRuns } from './previewRuns';
import type { CanvasFrame } from './protocol';
import { SelectionBounds } from './SelectionBounds';
import type { ReadSource } from './useChangeTours';
import type { ElementEditor } from './useElementEditor';
import type { HoveredElement } from './useElementHover';

export function BoardOverlays({
  frames,
  drawn,
  visible,
  scale,
  motion,
  presence,
  writes,
  runs,
  readSource,
  selected,
  path,
  hovered,
  hoveredComponent,
  picks,
  interaction,
  marks,
  pointerTaken,
}: {
  frames: readonly CanvasFrame[];
  /** Where the board draws each frame. */
  drawn: PlacedFrame[];
  /** The frames on screen. */
  visible: readonly string[];
  scale: number;
  motion: CanvasMotion;
  presence: CanvasPresence;
  writes: LandedWrites;
  runs: PreviewRuns;
  readSource: ReadSource;
  selected: PickedOnBoard | null;
  /** The picked path's points, and how a move of one previews and commits. */
  path: ElementEditor['path'];
  hovered: HoveredElement | null;
  hoveredComponent: string | null;
  picks: readonly PickOutline[];
  interaction: BoardInteraction;
  /** What the annotation editor draws and the presses it takes back. */
  marks: Omit<AnnotationLayerProps, 'frames' | 'scale' | 'interactive'>;
  /** A drawing tool or a held Space has the pointer, so the marks let presses through. */
  pointerTaken: boolean;
}) {
  return (
    <>
      <CanvasPresenceLayer
        presence={presence}
        writes={writes}
        frames={frames}
        drawn={drawn}
        visible={visible}
        motion={motion}
        runs={runs}
        readSource={readSource}
      />
      <ElementOutlines
        drawn={drawn}
        scale={scale}
        selected={selected}
        hovered={hovered}
        hoveredComponent={hoveredComponent}
        picks={picks}
      />
      {selected && path.shape && (
        // Its offset in the source holds while an edit rewrites its data, so a burst of nudges keeps focus.
        <PathGrips
          key={`${selected.selection.draft.site.file}:${String(selected.selection.draft.site.start)}`}
          shape={path.shape}
          frame={selected.frame}
          scale={scale}
          preview={path.preview}
          commit={path.commit}
        />
      )}
      <SelectionBounds drawn={drawn} selectedFrameIds={interaction.selectedFrameIds} />
      <AnnotationLayer
        {...marks}
        frames={frames}
        scale={scale}
        interactive={interaction.mode === 'select' && !pointerTaken}
      />
    </>
  );
}
