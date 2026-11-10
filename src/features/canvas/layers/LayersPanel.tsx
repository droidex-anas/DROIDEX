// The layers panel docked at the board's left: one row per frame in the
// canvas's own order, saying how its build stands. A click picks the frame,
// Shift or ⌘ adds it to the selection, a double-click renames it, and a row
// under the pointer lights its frame on the board. The tree is one tab stop
// whose rows the keyboard walks through aria-activedescendant, so a canvas of
// any size mounts only its visible rows.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { X } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { isTypeaheadKey, typeaheadIndex } from '../../../components/ui/menuKeys';
import { isLayersKey, LAYERS_KEY_LABEL } from '../boardKeys';
import { frameStatus } from '../previewLabels';
import type { CanvasFrame } from '../protocol';
import { LayerRow } from './LayerRow';
import { activeRow, layerKey, type LayerKey } from './layerKeys';

// Row's padding around one body line.
const ROW_PX = 34;
// How long typed letters keep adding to one type-ahead query, as in a menu.
const TYPEAHEAD_RESET_MS = 500;
const LAYER_HOVER = 'data-layer-hover';

export interface LayersPanelProps {
  frames: readonly CanvasFrame[];
  selectedFrameIds: readonly string[];
  agentWorking: boolean;
  /** Undefined where this chat cannot write to the canvas, so its rows do not rename. */
  onRename: ((frame: CanvasFrame, name: string) => Promise<unknown>) | undefined;
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
  onPick,
  onFocusFrame,
  onLeave,
  onClose,
}: LayersPanelProps) {
  const tree = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const treeId = useId();
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // A selection made on the board takes the keyboard's row to it.
  const [seenSelection, setSeenSelection] = useState(selectedFrameIds);
  if (seenSelection !== selectedFrameIds) {
    setSeenSelection(selectedFrameIds);
    if (movedTo !== null && !selectedFrameIds.includes(movedTo)) setMovedTo(null);
  }
  const typeahead = useRef({ query: '', resetAt: 0 });
  const lightFrame = useBoardLight(tree);
  const designIds = frames.map((frame) => frame.designId);
  const activeIndex = activeRow(designIds, movedTo, selectedFrameIds);
  const active = activeIndex >= 0 ? frames[activeIndex] : undefined;
  const virtualizer = useVirtualizer({
    count: frames.length,
    getScrollElement: () => tree.current,
    getItemKey: (index) => frames[index].designId,
    estimateSize: () => ROW_PX,
    overscan: 8,
    // Rows paint on the first frame, before the tree has been measured.
    initialRect: { width: 0, height: ROW_PX * 24 },
  });
  const selected = new Set(selectedFrameIds);
  const rowId = (designId: string) => `${treeId}-${designId}`;

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

  const moveTo = (index: number) => {
    setMovedTo(frames[index].designId);
    virtualizer.scrollToIndex(index);
  };
  // Closed from inside, the panel hands the keyboard to the board first, so focus is not lost with it.
  const close = () => {
    if (active) onLeave(active.designId);
    onClose();
  };
  const rename = (frame: CanvasFrame) => {
    if (onRename) setRenamingId(frame.designId);
  };
  const run = (key: LayerKey, frame: CanvasFrame) => {
    if (key.kind === 'move') moveTo(key.index);
    else if (key.kind === 'pick') onPick(frame.designId, true);
    else if (key.kind === 'focus') onFocusFrame(frame.designId);
    else if (key.kind === 'rename') rename(frame);
    else onLeave(frame.designId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The name field keeps its own keys.
    if (event.target !== event.currentTarget || !active) return;
    const key = layerKey(event, activeIndex, frames.length);
    if (key) {
      event.preventDefault();
      run(key, active);
      return;
    }
    if (!isTypeaheadKey(event)) return;
    const now = Date.now();
    const query = now < typeahead.current.resetAt ? typeahead.current.query + event.key : event.key;
    typeahead.current = { query, resetAt: now + TYPEAHEAD_RESET_MS };
    const match = typeaheadIndex(
      frames.map((frame) => frame.name),
      query,
      activeIndex,
    );
    if (match < 0) return;
    event.preventDefault();
    moveTo(match);
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
        <h2 className="text-body-strong text-primary">Layers</h2>
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
      {frames.length === 0 ? (
        <p className="px-5 text-caption text-secondary">No frames yet</p>
      ) : (
        <div
          ref={tree}
          role="tree"
          aria-label="Frames"
          aria-multiselectable
          aria-activedescendant={active ? rowId(active.designId) : undefined}
          tabIndex={0}
          className="canvas-layers-tree min-h-0 flex-1 overflow-y-auto px-2 pb-2"
          onKeyDown={onKeyDown}
          onPointerLeave={() => {
            lightFrame(null);
          }}
        >
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const frame = frames[item.index];
              return (
                <LayerRow
                  key={item.key}
                  id={rowId(frame.designId)}
                  frame={frame}
                  stage={frameStatus(frame, agentWorking).stage}
                  position={item.index + 1}
                  count={frames.length}
                  top={item.start}
                  selected={selected.has(frame.designId)}
                  active={item.index === activeIndex}
                  rename={renamingId === frame.designId ? onRename : undefined}
                  onRenameDone={() => {
                    // The field has to be gone before the tree takes the keyboard back.
                    flushSync(() => {
                      setRenamingId(null);
                    });
                    tree.current?.focus({ preventScroll: true });
                  }}
                  onClick={(event) => {
                    setMovedTo(frame.designId);
                    onPick(frame.designId, event.shiftKey || event.metaKey || event.ctrlKey);
                  }}
                  onDoubleClick={() => {
                    rename(frame);
                  }}
                  onHover={() => {
                    lightFrame(frame.designId);
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * Lights the frame a row names on the board beside the panel, as the pointer
 * over the frame itself would. The attribute is the board stylesheet's, and
 * the frame keeps it no longer than the panel is up.
 */
function useBoardLight(tree: RefObject<HTMLElement | null>) {
  const lit = useRef<Element | null>(null);
  useEffect(() => {
    const held = lit;
    return () => {
      held.current?.removeAttribute(LAYER_HOVER);
    };
  }, []);
  return (designId: string | null) => {
    lit.current?.removeAttribute(LAYER_HOVER);
    lit.current =
      designId === null
        ? null
        : (tree.current
            ?.closest('[data-canvas-board]')
            ?.querySelector(`[data-design-frame="${CSS.escape(designId)}"]`) ?? null);
    lit.current?.setAttribute(LAYER_HOVER, '');
  };
}
