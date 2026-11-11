// One row of the layers tree, as its kind draws it: a frame, a layer under an
// open frame, or a note saying what an open frame's layers cannot show.

import type { MouseEvent, PointerEvent } from 'react';
import type { PreviewNode } from '../previewDocument';
import type { FrameStatus } from '../previewLabels';
import type { CanvasFrame } from '../protocol';
import { ElementRow, NoteRow, type ElementEntry } from './ElementRow';
import { isMovable } from './layerMoves';
import { LayerRow } from './LayerRow';
import type { LayerEntry } from './layerRows';

export function LayerListRow({
  row,
  id,
  top,
  active,
  stage,
  selected,
  describedBy,
  rename,
  lit,
  onToggle,
  onFrameClick,
  onRenameStart,
  onRenameDone,
  onToolPress,
  onSetHidden,
  onGrab,
  onGrabElement,
  onPickElement,
  onLight,
  onUnlight,
}: {
  row: LayerEntry;
  id: string;
  /** Where the row sits in the list, in pixels. */
  top: number;
  /** The keyboard is on this row. */
  active: boolean;
  /** A frame row's build stage. */
  stage: FrameStatus['stage'];
  /** A frame row's frame is selected on the board, or an element row's element is picked. */
  selected: boolean;
  /** An element row's element is under the board's pointer. */
  lit: boolean;
  /** What tells how to restack a frame row, or move an element row, from the keyboard. */
  describedBy: string | undefined;
  /** Set while this frame row is being renamed. */
  rename: ((frame: CanvasFrame, name: string) => Promise<unknown>) | undefined;
  onToggle: (row: Exclude<LayerEntry, { kind: 'note' }>) => void;
  onFrameClick: (designId: string, event: MouseEvent<HTMLElement>) => void;
  onRenameStart: (designId: string) => void;
  onRenameDone: () => void;
  onToolPress: (designId: string) => void;
  onSetHidden: ((frame: CanvasFrame, hidden: boolean) => void) | undefined;
  onGrab: ((event: PointerEvent<HTMLElement>, designId: string) => void) | undefined;
  onGrabElement: ((event: PointerEvent<HTMLElement>, row: ElementEntry) => void) | undefined;
  onPickElement: (row: ElementEntry) => void;
  /** The pointer came onto a row, whose key owns the light until it leaves. */
  onLight: (owner: string, designId: string, node: PreviewNode | null) => void;
  onUnlight: (owner: string) => void;
}) {
  if (row.kind === 'note') return <NoteRow id={id} top={top} active={active} entry={row} />;
  if (row.kind === 'element') {
    const movable = isMovable(row);
    return (
      <ElementRow
        id={id}
        top={top}
        active={active}
        entry={row}
        selected={selected}
        lit={lit}
        describedBy={movable ? describedBy : undefined}
        onPick={onPickElement}
        onToggle={onToggle}
        onGrab={movable ? onGrabElement : undefined}
        onLight={onLight}
        onUnlight={onUnlight}
      />
    );
  }
  const { frame } = row;
  return (
    <LayerRow
      id={id}
      top={top}
      active={active}
      frame={frame}
      stage={stage}
      position={row.position}
      count={row.count}
      selected={selected}
      open={row.open}
      onToggle={() => {
        onToggle(row);
      }}
      describedBy={describedBy}
      rename={rename}
      onRenameDone={onRenameDone}
      onClick={(event) => {
        onFrameClick(frame.designId, event);
      }}
      onDoubleClick={() => {
        onRenameStart(frame.designId);
      }}
      onLight={(designId) => {
        onLight(row.key, designId, null);
      }}
      onUnlight={() => {
        onUnlight(row.key);
      }}
      onToolPress={() => {
        onToolPress(frame.designId);
      }}
      onSetHidden={onSetHidden}
      onGrab={onGrab}
    />
  );
}
