// The chat area: the active tab's chat, or its tiles side by side, each with
// its own transcript and composer. A chat or a tile dragged over a tile can
// split it, take its place or swap with it.

import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import ChatView from '../../components/ChatView';
import PromptInput from '../../components/PromptInput';
import { ComposerHeight } from '../../components/composer/ComposerHeight';
import {
  shallowEqual,
  useStoreDispatch,
  useStoreSelector,
  type AppState,
} from '../../hooks/useStore';
import { useSessionHistory } from '../../hooks/useSessionHistory';
import { isEmbedded } from '../../lib/embed';
import { activeGrid } from './tabStrip';
import type { TileChrome } from './TileChrome';
import { TileDivider } from './TileDivider';
import { endPlaceDrag, usePlaceDrag } from './tileDrag';
import { TileDropTarget } from './TileDropTarget';
import {
  withColumnSplit,
  withRowSplit,
  withTilePage,
  type TileGrid,
  type TilePage,
} from './tileGrid';
import { assignPanes, tileBoxes, type PaneSlot, type TileBox, type TileDrop } from './tileLayout';

// An unsplit tab's page as a grid of one, so a drop can split it.
const PAGE_TILE_ID = 'page';
const GUTTER_PX = 6;
const DIVIDER_PX = 8;

type Resize =
  | { kind: 'columns'; split: number }
  | { kind: 'rows'; columnIndex: number; split: number };

function selectTileSource(state: AppState) {
  return {
    grid: isEmbedded() ? null : activeGrid(state.tabStrip),
    activeAppSessionId: state.activeAppSessionId,
    tabId: state.tabStrip.activeTabId,
  };
}

function focusComposer(area: HTMLElement, tileId: string) {
  const pane = area.querySelector(`[data-tile-id="${CSS.escape(tileId)}"]`);
  if (!pane || pane.contains(document.activeElement)) return;
  pane.querySelector<HTMLElement>('[role="textbox"][aria-label="Prompt"]')?.focus();
}

// The focused place's tile shows the live chat. Only the page's identity is
// read here, so a new chat's draft is left to the views that edit it.
function liveGrid(stored: TileGrid | null, activeAppSessionId: string | null): TileGrid {
  const page: TilePage = activeAppSessionId
    ? { kind: 'chat', appSessionId: activeAppSessionId }
    : { kind: 'new-chat', draft: null };
  if (stored) return withTilePage(stored, stored.focusedTileId, page);
  return {
    columns: [{ tiles: [{ id: PAGE_TILE_ID, page }], rowSplit: 0.5 }],
    columnSplit: 0.5,
    focusedTileId: PAGE_TILE_ID,
  };
}

// Which tiles sit in which column of which tab: the layout a divider drags on.
function layoutKey(tabId: string, grid: TileGrid): string {
  const columns = grid.columns.map((column) => column.tiles.map((tile) => tile.id).join(','));
  return `${tabId}/${columns.join('|')}`;
}

function resized(grid: TileGrid, resize: Resize | null): TileGrid {
  if (!resize) return grid;
  return resize.kind === 'columns'
    ? withColumnSplit(grid, resize.split)
    : withRowSplit(grid, resize.columnIndex, resize.split);
}

function percent(fraction: number): string {
  return `${String(fraction * 100)}%`;
}

const FULL_AREA: CSSProperties = { left: 0, top: 0, width: '100%', height: '100%' };

// Interior edges give up half a gutter each, so neighbors sit a gutter apart.
function boxStyle(box: TileBox): CSSProperties {
  const half = GUTTER_PX / 2;
  const left = box.atLeft ? 0 : half;
  const right = box.atRight ? 0 : half;
  const top = box.atTop ? 0 : half;
  const bottom = box.atBottom ? 0 : half;
  return {
    left: `calc(${percent(box.left)} + ${String(left)}px)`,
    top: `calc(${percent(box.top)} + ${String(top)}px)`,
    width: `calc(${percent(box.width)} - ${String(left + right)}px)`,
    height: `calc(${percent(box.height)} - ${String(top + bottom)}px)`,
  };
}

const TilePane = memo(function TilePane({
  appSessionId,
  tileId,
  focused,
  atTop,
  atLeft,
  rightInset,
  isObscured,
  besidePane,
  underBrowser,
  composerHost,
}: {
  appSessionId: string | null;
  // Null while the tab is not split.
  tileId: string | null;
  focused: boolean;
  atTop: boolean;
  atLeft: boolean;
  rightInset: boolean;
  isObscured: boolean;
  besidePane: boolean;
  underBrowser: boolean;
  composerHost: RefObject<HTMLElement | null> | null;
}) {
  // App loads the focused chat's history; the other tiles load their own.
  useSessionHistory(focused || isEmbedded() ? null : appSessionId);
  const tile: TileChrome | undefined = tileId ? { id: tileId, focused, atTop, atLeft } : undefined;
  // Under an expanded browser only the composer shows; the transcript keeps
  // its place, hidden, so the same composer and its draft stay mounted.
  return (
    <>
      <div
        aria-hidden={underBrowser || undefined}
        className={underBrowser ? 'invisible flex min-h-0 flex-1 flex-col' : 'contents'}
      >
        <ChatView
          appSessionId={appSessionId}
          rightInset={rightInset}
          isObscured={isObscured}
          besidePane={besidePane}
          {...(tile ? { tile } : {})}
        />
      </div>
      <ComposerHeight target={composerHost} className={underBrowser ? 'pointer-events-auto' : ''}>
        <PromptInput
          appSessionId={appSessionId}
          rightInset={rightInset && !underBrowser}
          compact={underBrowser}
        />
      </ComposerHeight>
    </>
  );
});

export function ChatTiles({
  rightInset,
  isObscured,
  besidePane,
  underBrowser,
  composerHost,
}: {
  rightInset: boolean;
  isObscured: boolean;
  besidePane: boolean;
  // An expanded browser lays the focused tile's composer under its page and
  // hides the rest of the tiles.
  underBrowser: boolean;
  // Where the focused composer publishes its height for the browser to keep clear.
  composerHost: RefObject<HTMLElement | null>;
}) {
  const dispatch = useStoreDispatch();
  const source = useStoreSelector(selectTileSource, shallowEqual);
  const drag = usePlaceDrag();
  const areaRef = useRef<HTMLDivElement>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  const live = liveGrid(source.grid, source.activeAppSessionId);
  // A drag belongs to one layout: a tile closing or a tab switch mid-drag
  // drops the preview and remounts the dividers, so the release commits nothing.
  const layout = layoutKey(source.tabId, live);
  const [resizeLayout, setResizeLayout] = useState(layout);
  if (layout !== resizeLayout) {
    setResizeLayout(layout);
    setResize(null);
  }
  const grid = resized(live, resize);
  const isSplit = source.grid !== null;
  const boxes = tileBoxes(grid);

  const committedPanes = useRef<PaneSlot[]>([]);
  const panes = assignPanes(
    committedPanes.current,
    boxes.map((box) => box.tile),
  );
  useLayoutEffect(() => {
    committedPanes.current = panes;
  });
  // Panes stay in slot order so React never reorders their DOM, which would
  // reset scroll positions; a moved tile only changes its pane's position.
  const placed = boxes
    .map((box, index) => ({ box, slot: panes[index].slot }))
    .sort((a, b) => a.slot - b.slot);

  // The keyboard follows the focused tile when a shortcut, a split, a drop or
  // a closed neighbor moves it. A press keeps the focus it gave, and switching
  // tabs leaves focus where it was.
  const pressedTileId = useRef<string | null>(null);
  const focusedPlace = useRef({ tabId: source.tabId, tileId: grid.focusedTileId });
  useEffect(() => {
    const previous = focusedPlace.current;
    const pressed = pressedTileId.current;
    focusedPlace.current = { tabId: source.tabId, tileId: grid.focusedTileId };
    pressedTileId.current = null;
    const tileId = grid.focusedTileId;
    const moved = previous.tabId === source.tabId && previous.tileId !== tileId;
    const area = areaRef.current;
    if (!moved || pressed === tileId || !area) return;
    // A tile that just mounted settles its editor first, StrictMode replay included.
    const frame = requestAnimationFrame(() => {
      focusComposer(area, tileId);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [source.tabId, grid.focusedTileId]);

  const focus = (tileId: string) => {
    if (isSplit && tileId !== grid.focusedTileId) dispatch({ type: 'FOCUS_TILE', tileId });
  };

  const commitResize = (next: Resize) => {
    setResize(null);
    dispatch(
      next.kind === 'columns'
        ? { type: 'RESIZE_TILE_COLUMNS', split: next.split }
        : { type: 'RESIZE_TILE_ROWS', columnIndex: next.columnIndex, split: next.split },
    );
  };

  const drop = (targetTileId: string, result: TileDrop) => {
    endPlaceDrag();
    const target = targetTileId === PAGE_TILE_ID ? null : targetTileId;
    switch (result.kind) {
      case 'move':
        dispatch({ type: 'MOVE_TILE', tileId: result.tileId, targetTileId, edge: result.edge });
        return;
      case 'split':
        dispatch({
          type: 'SPLIT_TILE',
          targetTileId: target,
          edge: result.edge,
          appSessionId: result.appSessionId,
        });
        return;
      case 'show':
        dispatch({ type: 'DROP_CHAT', tileId: target, appSessionId: result.appSessionId });
    }
  };

  return (
    <div ref={areaRef} className={`relative min-h-0 min-w-0 flex-1 ${resize ? 'select-none' : ''}`}>
      {placed.map(({ box, slot }) => {
        const { tile } = box;
        const focused = tile.id === grid.focusedTileId;
        return (
          <div
            key={slot}
            data-tile-id={tile.id}
            className={`absolute flex-col overflow-hidden ${
              underBrowser && !focused ? 'hidden' : 'flex'
            }`}
            style={underBrowser ? FULL_AREA : boxStyle(box)}
            onPointerDownCapture={() => {
              pressedTileId.current = tile.id;
              focus(tile.id);
            }}
            onFocusCapture={() => {
              focus(tile.id);
            }}
          >
            <TilePane
              appSessionId={tile.page.kind === 'chat' ? tile.page.appSessionId : null}
              tileId={isSplit ? tile.id : null}
              focused={focused}
              atTop={box.atTop}
              atLeft={box.atLeft}
              rightInset={rightInset && box.atRight}
              isObscured={isObscured}
              // A tile left of another ends its scrollbar mid-window, as the
              // utility pane does.
              besidePane={besidePane || !box.atRight}
              underBrowser={underBrowser && focused}
              composerHost={focused ? composerHost : null}
            />
            {drag && !isObscured && (
              <TileDropTarget
                grid={grid}
                drag={drag}
                tileId={tile.id}
                onDrop={(result) => {
                  drop(tile.id, result);
                }}
              />
            )}
          </div>
        );
      })}
      {grid.columns.length > 1 && !underBrowser && (
        <TileDivider
          key={layout}
          orientation="vertical"
          split={grid.columnSplit}
          label="Resize columns"
          areaRef={areaRef}
          style={{
            left: `calc(${percent(grid.columnSplit)} - ${String(DIVIDER_PX / 2)}px)`,
            top: 0,
            bottom: 0,
            width: DIVIDER_PX,
          }}
          onPreview={(split) => {
            setResize({ kind: 'columns', split });
          }}
          onCommit={(split) => {
            commitResize({ kind: 'columns', split });
          }}
        />
      )}
      {boxes
        .filter((box) => !underBrowser && box.atTop && !box.atBottom)
        .map((box) => {
          const { columnIndex } = box;
          return (
            <TileDivider
              key={`${layout}/${box.tile.id}`}
              orientation="horizontal"
              split={grid.columns[columnIndex].rowSplit}
              label="Resize tiles"
              areaRef={areaRef}
              style={{
                left: percent(box.left),
                width: percent(box.width),
                top: `calc(${percent(box.height)} - ${String(DIVIDER_PX / 2)}px)`,
                height: DIVIDER_PX,
              }}
              onPreview={(split) => {
                setResize({ kind: 'rows', columnIndex, split });
              }}
              onCommit={(split) => {
                commitResize({ kind: 'rows', columnIndex, split });
              }}
            />
          );
        })}
    </div>
  );
}
