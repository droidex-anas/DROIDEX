// What the board's keys, rail, zoom bar and frame size menus ask of it: a mode,
// a zoom, or a new place for frames. Each command means the same wherever it
// is asked, and each placement is one layout write through the board's hand.

import {
  alignRects,
  distributeRects,
  type AlignEdge,
  type DistributeAxis,
  type PlacedFrame,
  type Point,
} from './canvasGeometry';
import {
  picksElements,
  type BoardInteraction,
  type BoardInteractionEvent,
  type BoardMode,
} from './canvasState';
import type { FrameSize } from './FrameSizeMenu';
import type { CanvasFrame, FrameRect } from './protocol';
import type { ZoomCommand } from './ZoomControl';

interface CommandInputs {
  interaction: BoardInteraction;
  frames: CanvasFrame[];
  /** Where every frame is drawn, which is what a fit measures. */
  drawn: PlacedFrame[];
  dispatch: (event: BoardInteractionEvent) => void;
  /** Design is open only where the board can point the chat's prompt at elements. */
  canDesign: boolean;
  /** Puts the annotation tool down, as every mode change does. */
  dropTool: () => void;
  fitTo: (rects: readonly FrameRect[]) => void;
  zoomTo: (scale: number) => void;
  stepZoom: (direction: 1 | -1) => void;
  /** One layout write for frames the user has finished placing (`useBoardGestures`). */
  place: (designIds: readonly string[], nextRects: (rects: FrameRect[]) => FrameRect[]) => void;
}

export function boardCommands({
  interaction,
  frames,
  drawn,
  dispatch,
  canDesign,
  dropTool,
  fitTo,
  zoomTo,
  stepZoom,
  place,
}: CommandInputs) {
  const selected = interaction.selectedFrameIds;
  return {
    setMode: (next: BoardMode) => {
      if (next === 'design' && !canDesign) return;
      dropTool();
      if (next === interaction.mode) return;
      if (next === 'select') {
        dispatch({ type: 'escape' });
        return;
      }
      if (picksElements(next)) {
        dispatch({ type: next });
        return;
      }
      const target = selected.at(0) ?? frames.at(0)?.designId;
      if (target !== undefined) dispatch({ type: 'interact', designId: target });
    },
    zoom: (command: ZoomCommand) => {
      if (command === 'fit') fitTo(drawn.map(({ rect }) => rect));
      else if (command === 'selection')
        fitTo(drawn.filter(({ designId }) => selected.includes(designId)).map(({ rect }) => rect));
      else if (command === 'actual') zoomTo(1);
      else stepZoom(command === 'in' ? 1 : -1);
    },
    nudge: (step: Point) => {
      place(selected, (rects) =>
        rects.map((rect) => ({ ...rect, x: rect.x + step.x, y: rect.y + step.y })),
      );
    },
    align: (edge: AlignEdge) => {
      place(selected, (rects) => alignRects(rects, edge));
    },
    distribute: (axis: DistributeAxis) => {
      place(selected, (rects) => distributeRects(rects, axis));
    },
    /** A typed size or a screen for one frame, which keeps its top-left corner. */
    resize: (frame: CanvasFrame, size: FrameSize) => {
      place([frame.designId], (rects) => rects.map((rect) => ({ ...rect, ...size })));
    },
  };
}
