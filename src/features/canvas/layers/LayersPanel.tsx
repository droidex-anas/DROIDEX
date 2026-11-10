// The layers panel at the board's left: a row per frame, front to back, saying how its
// build stands. A click picks the frame (Shift or ⌘ adds it), a double-click renames it,
// a row under the pointer lights its frame, and its eye and handle hide and restack it.
// The tree is one tab stop whose rows the keyboard walks through aria-activedescendant,
// so a canvas of any size mounts only its visible rows.

import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { X } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { isLayersKey, LAYERS_KEY_LABEL } from '../boardKeys';
import { frameStatus } from '../previewLabels';
import type { CanvasFrame } from '../protocol';
import { LayerRow } from './LayerRow';
import { HIDE_KEY_LABEL, layerKey, type LayerKey } from './layerKeys';
import { useBoardLight } from './useBoardLight';
import { useKeyboardRow } from './useKeyboardRow';
import { useRestack } from './useRestack';

// Row's padding around one body line.
const ROW_PX = 34;

export interface LayersPanelProps {
  /** Back to front, as the board stacks them. */
  frames: readonly CanvasFrame[];
  selectedFrameIds: readonly string[];
  agentWorking: boolean;
  /** Undefined where this chat cannot write to the canvas, as are `onSetHidden` and `onReorder`. */
  onRename: ((frame: CanvasFrame, name: string) => Promise<unknown>) | undefined;
  onSetHidden: ((frame: CanvasFrame, hidden: boolean) => void) | undefined;
  /** Every frame's designId, back to front. */
  onReorder: ((designIds: string[]) => void) | undefined;
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
  onRename,
  onSetHidden,
  onReorder,
  onPick,
  onFocusFrame,
  onLeave,
  onClose,
}: LayersPanelProps) {
  const tree = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const treeId = useId();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const rows = [...frames].reverse();
  const designIds = rows.map((frame) => frame.designId);
  const { movedTo, activeIndex, moveTo, typeTo } = useKeyboardRow(rows, selectedFrameIds);
  const boardLight = useBoardLight(tree);
  const stack = useRestack(list, designIds, ROW_PX, onReorder);
  const active = activeIndex >= 0 ? rows[activeIndex] : undefined;
  const editingIndex = renamingId === null ? -1 : designIds.indexOf(renamingId);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tree.current,
    getItemKey: (index) => rows[index].designId,
    estimateSize: () => ROW_PX,
    overscan: 8,
    // Rows paint on the first frame, before the tree has been measured.
    initialRect: { width: 0, height: ROW_PX * 24 },
    // aria-activedescendant names the keyboard's row and a field holds its draft, so
    // neither unmounts when the list scrolls away from it.
    rangeExtractor: (range) => {
      const indexes = new Set(defaultRangeExtractor(range));
      for (const kept of [activeIndex, editingIndex]) if (kept >= 0) indexes.add(kept);
      return [...indexes].sort((a, b) => a - b);
    },
  });
  const selected = new Set(selectedFrameIds);
  const rowId = (designId: string) => `${treeId}-${designId}`;
  const helpId = `${treeId}-help`;

  // A frame that leaves the canvas ends its rename, so it does not reopen if the frame comes
  // back; the keyboard stays in the panel instead of falling to the page with the field.
  const renamedFrameGone = renamingId !== null && !designIds.includes(renamingId);
  useLayoutEffect(() => {
    if (!renamedFrameGone) return;
    setRenamingId(null);
    if (document.activeElement === document.body) {
      (tree.current ?? closeButton.current)?.focus({ preventScroll: true });
    }
  }, [renamedFrameGone]);

  // The list brings the keyboard's row into view wherever it moves to, and only then.
  const revealRow = useEffectEvent((designId: string) => {
    const index = designIds.indexOf(designId);
    if (index >= 0) virtualizer.scrollToIndex(index);
  });
  useEffect(() => {
    if (movedTo !== null) revealRow(movedTo);
  }, [movedTo]);

  // Closed from inside, the panel hands the keyboard to the board first, so focus is not lost with it.
  const close = () => {
    if (active) onLeave(active.designId);
    onClose();
  };
  const rename = (frame: CanvasFrame) => {
    if (onRename) setRenamingId(frame.designId);
  };
  const run = (key: LayerKey, frame: CanvasFrame) => {
    if (key.kind === 'move') moveTo(rows[key.index].designId);
    else if (key.kind === 'restack') stack.restack(frame.designId, key.index);
    else if (key.kind === 'pick') onPick(frame.designId, true);
    else if (key.kind === 'focus') onFocusFrame(frame.designId);
    else if (key.kind === 'rename') rename(frame);
    else if (key.kind === 'toggle-hidden') onSetHidden?.(frame, !frame.hidden);
    else onLeave(frame.designId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The name field keeps its own keys.
    if (event.target !== event.currentTarget || !active) return;
    const key = layerKey(event, activeIndex, rows.length);
    if (key) run(key, active);
    if (key || typeTo(event)) event.preventDefault();
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
      <div className="flex shrink-0 items-center justify-between gap-2 py-2 pl-5 pr-2">
        <Tooltip label="Front to back" placement="bottom">
          <h2 className="text-body-strong text-primary">Layers</h2>
        </Tooltip>
        <Button
          ref={closeButton}
          variant="ghost"
          size="sm"
          icon={X}
          aria-label="Close layers"
          title={`Close (${LAYERS_KEY_LABEL})`}
          onClick={close}
        />
      </div>
      {rows.length === 0 ? (
        <p className="px-5 text-caption text-secondary">No frames yet</p>
      ) : (
        <div
          ref={tree}
          role="tree"
          aria-label="Frames, front to back"
          aria-multiselectable
          aria-activedescendant={active ? rowId(active.designId) : undefined}
          tabIndex={0}
          data-dragging={stack.dragging || undefined}
          className="canvas-layers-tree min-h-0 flex-1 overflow-y-auto px-2 pb-2"
          onKeyDown={onKeyDown}
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
          <div
            ref={list}
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
            {...stack.listHandlers}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const frame = rows[item.index];
              return (
                <LayerRow
                  key={item.key}
                  id={rowId(frame.designId)}
                  frame={frame}
                  stage={frameStatus(frame, agentWorking).stage}
                  position={item.index + 1}
                  count={rows.length}
                  top={item.start}
                  selected={selected.has(frame.designId)}
                  active={item.index === activeIndex}
                  describedBy={onReorder && helpId}
                  rename={renamingId === frame.designId ? onRename : undefined}
                  onRenameDone={() => {
                    // The field has to be gone before the tree takes the keyboard back.
                    flushSync(() => {
                      setRenamingId(null);
                    });
                    tree.current?.focus({ preventScroll: true });
                  }}
                  onClick={(event) => {
                    moveTo(frame.designId);
                    onPick(frame.designId, event.shiftKey || event.metaKey || event.ctrlKey);
                  }}
                  onDoubleClick={() => {
                    rename(frame);
                  }}
                  onLight={() => {
                    boardLight.light(frame.designId);
                  }}
                  onUnlight={() => {
                    boardLight.unlight(frame.designId);
                  }}
                  onSetHidden={onSetHidden}
                  onGrab={onReorder && stack.grab}
                />
              );
            })}
            {stack.dropGap !== null && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 h-0.5 -translate-y-px rounded-full bg-selection"
                style={{ top: stack.dropGap * ROW_PX }}
              />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
