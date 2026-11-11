// The layers panel at the board's left: a row per frame, front to back, saying how its
// build stands. A click picks the frame (Shift or ⌘ adds it), a double-click renames it,
// a row under the pointer lights its frame, and its eye and handle hide and restack it.
// A frame that has built opens on its layers as its source writes them; a click picks a
// layer's element in Edit and the pointer outlines it on the board, and the board's own
// pick and hover find their layer's row. A layer's handle, or ⌥ with the arrows, moves it
// in its source. The tree is one tab stop whose rows the keyboard walks through
// aria-activedescendant, so a canvas of any size mounts only its visible rows.

import { useEffect, useEffectEvent, useId, useRef, type KeyboardEvent } from 'react';
import type { HistoryStep } from '../boardHistory';
import { historyStep, isLayersKey } from '../boardKeys';
import { frameStatus } from '../previewLabels';
import type { CanvasFrame } from '../protocol';
import type { ElementEntry } from './ElementRow';
import { LayerDropLine } from './LayerDropLine';
import { LayerListRow } from './LayerListRow';
import { LayersHeader } from './LayersHeader';
import { HIDE_KEY_LABEL, layerKey, type LayerKey } from './layerKeys';
import type { LayerElements } from './layerElements';
import { rowInset, type LayerEntry } from './layerRows';
import { useBoardLight } from './useBoardLight';
import { useElementMove, type MoveLayer } from './useElementMove';
import { useElementRows } from './useElementRows';
import { useKeyboardRow } from './useKeyboardRow';
import { useLayerList } from './useLayerList';
import { useLayerRows } from './useLayerRows';
import { useRenaming } from './useRenaming';
import { useRestack } from './useRestack';

// Row's padding around one body line.
const ROW_PX = 34;

type FrameEntry = Extract<LayerEntry, { kind: 'frame' }>;

export interface LayersPanelProps {
  /** Back to front, as the board stacks them. */
  frames: readonly CanvasFrame[];
  selectedFrameIds: readonly string[];
  agentWorking: boolean;
  elements: LayerElements;
  /** Undefined where this chat cannot write to the canvas, as are `onSetHidden` and `onReorder`. */
  onRename: ((frame: CanvasFrame, name: string) => Promise<unknown>) | undefined;
  onSetHidden: ((frame: CanvasFrame, hidden: boolean) => void) | undefined;
  /** Every frame's designId, back to front. */
  onReorder: ((designIds: string[]) => void) | undefined;
  onMoveLayer: MoveLayer | undefined;
  /** ⌘Z and its redo keys step the board's history; false where there is no step. */
  onHistory: (step: HistoryStep) => boolean;
  onPick: (designId: string, additive: boolean) => void;
  /** Enter: the board centres the frame and takes the keyboard. */
  onFocusFrame: (designId: string) => void;
  /** Escape: the keyboard goes back to the board, on this frame's label. */
  onLeave: (designId: string) => void;
  onClose: () => void;
}

export function LayersPanel({
  frames,
  selectedFrameIds,
  agentWorking,
  elements,
  onRename,
  onSetHidden,
  onReorder,
  onMoveLayer,
  onHistory,
  onPick,
  onFocusFrame,
  onLeave,
  onClose,
}: LayersPanelProps) {
  const tree = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const treeId = useId();
  const { rows, fold, rowOf, reveal, readRest } = useLayerRows(frames, elements.runs);
  const keys = rows.map((row) => row.key);
  const { movedTo, activeIndex, moveTo, typeTo } = useKeyboardRow(rows, selectedFrameIds);
  const elementRows = useElementRows(elements, rowOf, reveal, moveTo);
  const boardLight = useBoardLight(tree, elements.hover);
  const stack = useRestack(
    list,
    rows.map((row) => (row.kind === 'frame' ? row.key : null)),
    ROW_PX,
    onReorder,
  );
  const move = useElementMove({
    list,
    rows,
    rowPx: ROW_PX,
    pickedKey: elementRows.pickedKey,
    reveal,
    moveTo,
    pick: elements.pick,
    onMoveLayer,
  });
  const active = activeIndex >= 0 ? rows[activeIndex] : undefined;
  const renaming = useRenaming(keys, onRename, tree, closeButton);
  const kept = [activeIndex, renaming.index];
  const { virtualizer, revealRestacked } = useLayerList(tree, keys, ROW_PX, kept, movedTo);
  const shownRows = virtualizer.getVirtualItems().map((item) => ({ item, row: rows[item.index] }));
  // A row on show past what its frame's preview has read has the rest read.
  const unreadShown = [
    ...new Set(
      shownRows.flatMap(({ row }) =>
        row.kind === 'element' && row.drawn?.state === 'unread' ? [row.frame.designId] : [],
      ),
    ),
  ].join(' ');
  const readRestOf = useEffectEvent((designIds: string) => {
    for (const designId of designIds.split(' ')) readRest(designId);
  });
  useEffect(() => {
    if (unreadShown) readRestOf(unreadShown);
  }, [unreadShown]);
  const selected = new Set(selectedFrameIds);
  const rowId = (key: string) => `${treeId}-${key}`;
  const helpId = `${treeId}-help`;
  const moveHelpId = `${treeId}-move-help`;

  // Closed from inside, the panel hands the keyboard to the board first, so focus is not lost with it.
  const close = () => {
    if (active) onLeave(active.frame.designId);
    onClose();
  };
  /** Shows or hides a row's children; the keyboard stays on the tree, on that row, after a caret's click too. */
  const toggle = (row: LayerEntry, shown: boolean) => {
    moveTo(row.key);
    fold(row, shown);
    tree.current?.focus({ preventScroll: true });
  };
  /** Right opens a closed row, then goes to its first child; Left closes an open row, then goes to its parent. */
  const openOrClose = (opening: boolean, row: LayerEntry) => {
    const open = row.kind === 'note' ? null : row.open;
    if (open !== null && open !== opening) toggle(row, opening);
    else if (opening && open) moveTo(rows[activeIndex + 1].key);
    else if (!opening && row.kind !== 'frame') moveTo(row.parentKey);
  };
  const runOnFrame = (key: LayerKey, row: FrameEntry) => {
    const { designId } = row.frame;
    if (key.kind === 'restack') {
      // The keys count rows; a frame moves past the next frame, whatever opens under it.
      if (!stack.step(designId, Math.sign(key.index - activeIndex))) return;
      // The keyboard goes with the frame, as it does with a dragged one.
      moveTo(designId);
      revealRestacked(designId);
    } else if (key.kind === 'pick') onPick(designId, true);
    else if (key.kind === 'focus') onFocusFrame(designId);
    else if (key.kind === 'rename') renaming.start(designId);
    else if (key.kind === 'toggle-hidden') onSetHidden?.(row.frame, !row.frame.hidden);
  };
  const run = (key: LayerKey, row: LayerEntry) => {
    if (key.kind === 'move') moveTo(rows[key.index].key);
    else if (key.kind === 'leave') onLeave(row.frame.designId);
    else if (key.kind === 'open' || key.kind === 'close') openOrClose(key.kind === 'open', row);
    else if (row.kind === 'frame') runOnFrame(key, row);
    else if (row.kind === 'element') runOnElement(key, row);
  };
  const runOnElement = (key: LayerKey, row: ElementEntry) => {
    if (key.kind === 'pick' || key.kind === 'focus') elementRows.pick(row);
    else if (key.kind === 'restack') move.step(row, key.index < activeIndex ? 'up' : 'down');
    else if (key.kind === 'outdent') move.step(row, 'out');
    else if (key.kind === 'indent') move.step(row, 'in');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The name field keeps its own keys.
    if (event.target !== event.currentTarget || !active) return;
    const key = layerKey(event, activeIndex, rows.length);
    if (key?.kind === 'leave') {
      stack.cancel();
      move.cancel();
    }
    if (key) run(key, active);
    const step = key ? null : historyStep(event);
    if (key || (step && onHistory(step)) || typeTo(event)) event.preventDefault();
  };

  return (
    <aside
      aria-label="Layers"
      className="flex h-full w-sidebar shrink-0 flex-col bg-surface"
      onKeyDown={(event) => {
        if (!isLayersKey(event) || event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <LayersHeader closeButton={closeButton} onClose={close} />
      {rows.length === 0 ? (
        <p className="px-5 text-caption text-secondary">No frames yet</p>
      ) : (
        <div
          ref={tree}
          role="tree"
          aria-label="Frames, front to back"
          aria-multiselectable
          aria-activedescendant={active ? rowId(active.key) : undefined}
          tabIndex={0}
          data-dragging={stack.dragging || move.dragging || undefined}
          data-refused={move.line?.drop.state === 'refused' || undefined}
          className="canvas-layers-tree min-h-0 flex-1 overflow-y-auto px-2 pb-2"
          onKeyDown={onKeyDown}
          {...move.handlers}
          onFocus={(event) => {
            // A click's focus would scroll the row being clicked out from under the pointer.
            if (event.target !== event.currentTarget || !event.target.matches(':focus-visible'))
              return;
            virtualizer.scrollToIndex(activeIndex);
          }}
        >
          {onReorder && (
            <span id={helpId} className="sr-only">
              {`${HIDE_KEY_LABEL} hides or shows the frame. Alt with Up or Down moves it a layer toward the front or back.`}
            </span>
          )}
          {onMoveLayer && (
            <span id={moveHelpId} className="sr-only">
              Alt with Up or Down moves the layer before or after the one beside it. Alt with Left
              moves it out of the layer holding it, and with Right into the layer above it.
            </span>
          )}
          <div
            ref={list}
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
            {...stack.listHandlers}
          >
            {shownRows.map(({ item, row }) => {
              const { designId } = row.frame;
              return (
                <LayerListRow
                  key={row.key}
                  row={row}
                  id={rowId(row.key)}
                  top={item.start}
                  active={item.index === activeIndex}
                  stage={frameStatus(row.frame, agentWorking).stage}
                  selected={
                    row.kind === 'frame'
                      ? selected.has(designId)
                      : row.key === elementRows.pickedKey
                  }
                  lit={row.key === elementRows.litKey}
                  describedBy={
                    row.kind === 'frame' ? onReorder && helpId : onMoveLayer && moveHelpId
                  }
                  rename={
                    row.kind === 'frame' && renaming.designId === designId ? onRename : undefined
                  }
                  onToggle={(folded) => {
                    toggle(folded, !folded.open);
                  }}
                  onFrameClick={(frameId, event) => {
                    moveTo(frameId);
                    onPick(frameId, event.shiftKey || event.metaKey || event.ctrlKey);
                  }}
                  onRenameStart={renaming.start}
                  onRenameDone={renaming.done}
                  onToolPress={(frameId) => {
                    // The keyboard stays on the tree, on this row, for a chord or Escape after the press.
                    moveTo(frameId);
                    tree.current?.focus({ preventScroll: true });
                  }}
                  onSetHidden={onSetHidden}
                  onGrab={onReorder && stack.grab}
                  onGrabElement={
                    onMoveLayer &&
                    ((event, grabbed) => {
                      moveTo(grabbed.key);
                      tree.current?.focus({ preventScroll: true });
                      move.grab(event, grabbed);
                    })
                  }
                  onPickElement={elementRows.pick}
                  onLight={boardLight.light}
                  onUnlight={boardLight.unlight}
                />
              );
            })}
            {stack.dropGap !== null && (
              <LayerDropLine top={stack.dropGap * ROW_PX} left={0} refusal={null} />
            )}
            {move.line && move.line.drop.state !== 'still' && (
              <LayerDropLine
                top={move.line.gap * ROW_PX}
                left={rowInset(move.line.level)}
                refusal={move.line.drop.state === 'refused' ? move.line.drop.reason : null}
              />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
