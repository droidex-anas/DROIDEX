// The board's world layer: every frame, placed in canvas space under the one
// transform that pans and zooms the board, with the overlays drawn over them in
// the same space. The transform is the stage's to write, so a pan or a zoom
// moves the layer without rendering it.

import type { ReactNode } from 'react';
import type { BoardStage } from './boardStage';
import type { PlacedFrame, Point, Viewport } from './canvasGeometry';
import { showsFrameTools, type BoardInteraction, type BoardInteractionEvent } from './canvasState';
import type { CanvasPresence } from './canvasPresence';
import { DesignFrame, type DesignFrameProps } from './DesignFrame';
import type { FrameActions } from './FrameToolbar';
import type { HeldFrame } from './heldFrames';
import type { CanvasFrame } from './protocol';
import { toolbarRoom } from './toolbarPlacement';
import type { useBoardPreviews } from './useBoardPreviews';
import type { ElementEditor } from './useElementEditor';

interface BoardWorldProps extends Pick<
  DesignFrameProps,
  | 'canvasId'
  | 'scale'
  | 'motion'
  | 'capturePointer'
  | 'onOpenSource'
  | 'onTagFrames'
  | 'onDelete'
  | 'onHold'
  | 'onResize'
  | 'onDesignPress'
  | 'onFocusLabel'
> {
  frames: CanvasFrame[];
  /** Where each of `frames` is drawn, in the same order. */
  drawn: PlacedFrame[];
  /** The live view, which places the layer. */
  stage: BoardStage;
  /** Where the view last settled, which a frame toolbar is placed for. */
  viewport: Viewport;
  /** The part of the board no panel covers, which a frame toolbar keeps to. */
  size: Point;
  /** The frames the board opened with, which are simply there; later ones arrive. */
  openedWith: ReadonlySet<string>;
  visible: string[];
  interaction: BoardInteraction;
  dispatch: (event: BoardInteractionEvent) => void;
  /** The frames a hand gesture holds, each laid out where its hold began. */
  heldFrames: readonly HeldFrame[];
  presence: CanvasPresence;
  previews: ReturnType<typeof useBoardPreviews>;
  editor: ElementEditor;
  pinnedIds?: ReadonlySet<string>;
  frameActions: FrameActions;
  /** The one frame the Tab key reaches. */
  tabStopId: string | null | undefined;
  focusBoard: () => void;
  /** The overlays, drawn over the frames. */
  children: ReactNode;
}

export function BoardWorld({
  canvasId,
  frames,
  drawn,
  stage,
  viewport,
  size,
  scale,
  motion,
  openedWith,
  visible,
  interaction,
  dispatch,
  heldFrames,
  presence,
  capturePointer,
  previews,
  editor,
  pinnedIds,
  frameActions,
  tabStopId,
  focusBoard,
  onOpenSource,
  onTagFrames,
  onDelete,
  onHold,
  onResize,
  onDesignPress,
  onFocusLabel,
  children,
}: BoardWorldProps) {
  return (
    <div ref={stage.attach} className="absolute left-0 top-0" style={{ transformOrigin: '0 0' }}>
      {frames.map((frame, index) => (
        <DesignFrame
          key={frame.designId}
          canvasId={canvasId}
          frame={frame}
          rect={drawn[index].rect}
          scale={scale}
          motion={motion}
          arriving={!openedWith.has(frame.designId)}
          visible={visible.includes(frame.designId)}
          mode={interaction.mode}
          selected={interaction.selectedFrameIds.includes(frame.designId)}
          multiSelect={interaction.selectedFrameIds.length > 1}
          toolbarRoom={
            showsFrameTools(interaction, frame.designId)
              ? toolbarRoom(viewport, drawn, frame.designId, size)
              : null
          }
          interacted={interaction.interactedFrameId === frame.designId}
          heldFrom={heldFrames.find(({ designId }) => designId === frame.designId)?.from ?? null}
          worker={presence.get(frame.designId)?.agent}
          capturePointer={capturePointer}
          shownRevisionId={previews.shown.get(frame.designId) ?? null}
          preview={previews.preview(frame)}
          released={previews.released.includes(frame.designId)}
          onExitInteract={() => {
            dispatch({ type: 'escape' });
            focusBoard();
          }}
          onOpenSource={onOpenSource}
          tagged={pinnedIds?.has(frame.designId) ?? false}
          onTagFrames={onTagFrames}
          actions={frameActions}
          onDelete={onDelete}
          onHold={onHold}
          onResize={onResize}
          onPick={(picked, additive) => {
            dispatch({ type: 'pick', designId: picked.designId, additive });
          }}
          onInteract={(picked) => {
            dispatch({ type: 'interact', designId: picked.designId });
          }}
          onPickElement={(picked, at) => {
            editor.pick(picked.designId, at);
          }}
          onDesignPress={onDesignPress}
          onHoverElement={(hovered, at) => {
            if (at) editor.hover.move(hovered.designId, at);
            else editor.hover.clear();
          }}
          onEditEnter={(picked) => {
            editor.enter(picked.designId);
          }}
          elementPicked={editor.selection?.draft.element.designId === frame.designId}
          elementHovered={editor.hover.hovered?.designId === frame.designId}
          tabStop={frame.designId === tabStopId}
          onFocusLabel={onFocusLabel}
        />
      ))}
      {children}
    </div>
  );
}
