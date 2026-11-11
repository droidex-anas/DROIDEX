import { useEffect, useEffectEvent, useState, type PointerEvent, type RefObject } from 'react';
import { boardPoint } from '../boardCoordinates';
import type { Point } from '../canvasGeometry';
import type { ElementEdited } from '../elementEditProtocol';
import type { PreviewNode } from '../previewDocument';
import type { Drawn } from './drawnLayers';
import type { ElementEntry } from './ElementRow';
import { dropLine, stepPlace, type LayerPlace, type LayerStep } from './layerMoves';
import { LEVEL_STEP_PX, type LayerEntry } from './layerRows';
import type { RowSearch } from './useLayerRows';
import { DRAG_THRESHOLD_PX } from './useRestack';

/** A row of a frame's revision's outline, as a move names it. */
export interface LayerRef {
  designId: string;
  revisionId: string;
  nodeId: string;
}

/** What a move answers: the edit, or null where it was refused and said so. */
export type MoveLayer = (layer: LayerRef, place: LayerPlace) => Promise<ElementEdited | null>;

interface Drag {
  key: string;
  /** The frame's revision at the grab, and the built one its rows showed; null while building. */
  revision: { frame: string | null; built: string | null };
  /** The pointer that pressed the handle; any other one is ignored until it lets go. */
  pointerId: number;
  /** Where the press started, in list pixels. */
  start: Point;
  /** The row boundary nearest the pointer and the level it asks for; null until it passes the threshold. */
  over: { gap: number; level: number } | null;
}

/** A moved layer's row, followed until its frame has built the revision it landed in. */
interface Landing {
  designId: string;
  revisionId: string;
  nodeId: string;
  /** Its element was picked, so the pick goes with it. */
  picked: boolean;
  /** The row once found, while its element waits to be drawn. */
  key: string | null;
}

/**
 * Moves the layers of a list whose rows are `rows`, each `rowPx` tall: by
 * dragging an element row's handle to a boundary between rows, at the depth
 * the pointer's travel sideways asks for, or by a keyboard step. Once the
 * move has built, the keyboard goes to the row it landed on, and a picked
 * element is picked again there. The list holds the pointer through a drag.
 */
export function useElementMove({
  list,
  rows,
  rowPx,
  pickedKey,
  reveal,
  moveTo,
  pick,
  onMoveLayer,
}: {
  list: RefObject<HTMLElement | null>;
  rows: readonly LayerEntry[];
  rowPx: number;
  pickedKey: string | null;
  reveal: (designId: string, row: { nodeId: string }) => RowSearch;
  moveTo: (key: string) => void;
  pick: (designId: string, node: PreviewNode) => void;
  /** Undefined where this chat cannot change the canvas. */
  onMoveLayer: MoveLayer | undefined;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const follow = useLanding(rows, reveal, moveTo, pick);
  const subject = drag ? rows.findIndex((row) => row.key === drag.key) : -1;
  // Row ids are places in the source, so once the frame moves on a row may name another layer.
  const held = drag !== null && subject >= 0 && isSameRevision(rows[subject], drag.revision);
  const line = held && drag.over ? dropLine(rows, subject, drag.over.gap, drag.over.level) : null;
  const cancel = () => {
    if (!drag) return;
    if (list.current?.hasPointerCapture(drag.pointerId))
      list.current.releasePointerCapture(drag.pointerId);
    setDrag(null);
  };
  const cancelDrag = useEffectEvent(cancel);
  const dragging = drag !== null;
  useEffect(() => {
    if (dragging && !held) cancelDrag();
  }, [dragging, held]);
  useEffect(() => {
    if (!dragging) return;
    const onBlur = () => {
      cancelDrag();
    };
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
    };
  }, [dragging]);

  const move = (row: ElementEntry, place: LayerPlace) => {
    const { designId, build } = row.frame;
    if (!onMoveLayer || build.status !== 'ready') return;
    const picked = row.key === pickedKey;
    const layer = { designId, revisionId: build.revisionId, nodeId: row.node.nodeId };
    void onMoveLayer(layer, place).then((edited) => {
      if (edited?.landed)
        follow({ designId, revisionId: edited.receipt.revisionId, nodeId: edited.landed, picked });
    });
  };
  // The pointer in the list's own pixels, which the app's UI zoom does not scale.
  const listPoint = (event: PointerEvent<HTMLElement>): Point =>
    list.current
      ? boardPoint(list.current, { x: event.clientX, y: event.clientY })
      : { x: 0, y: 0 };
  /** The boundary and level the pointer asks for, or null while it has not passed the threshold. */
  const overAt = (event: PointerEvent<HTMLElement>, current: Drag): Drag['over'] => {
    const { x, y } = listPoint(event);
    const travel = Math.hypot(x - current.start.x, y - current.start.y);
    if (current.over === null && travel < DRAG_THRESHOLD_PX) return null;
    const gap = Math.round(y / rowPx);
    const level = rows[subject].level + Math.round((x - current.start.x) / LEVEL_STEP_PX);
    return { gap, level };
  };
  return {
    dragging: line !== null,
    /** Where the dragged layer would drop, and whether it can. */
    line,
    /** Moves the layer on `row` a step, where it has somewhere to go. */
    step: (row: ElementEntry, step: LayerStep) => {
      const place = stepPlace(rows, rows.indexOf(row), step);
      if (place) move(row, place);
    },
    /** Ends a drag without moving its layer. */
    cancel,
    grab: (event: PointerEvent<HTMLElement>, row: ElementEntry) => {
      if (event.button !== 0 || drag || !list.current) return;
      event.preventDefault();
      event.stopPropagation();
      list.current.setPointerCapture(event.pointerId);
      setDrag({
        key: row.key,
        revision: revisionOf(row),
        pointerId: event.pointerId,
        start: listPoint(event),
        over: null,
      });
    },
    /** For the list's container, which the list's captured pointer events bubble to. */
    handlers: {
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (drag?.pointerId !== event.pointerId || !held) return;
        const over = overAt(event, drag);
        if (over && (over.gap !== drag.over?.gap || over.level !== drag.over.level))
          setDrag({ ...drag, over });
      },
      // Where the pointer lets go decides, since the last move may not have rendered yet.
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        if (drag?.pointerId !== event.pointerId) return;
        setDrag(null);
        const over = held ? overAt(event, drag) : null;
        if (!over) return;
        const { drop } = dropLine(rows, subject, over.gap, over.level);
        const row = rows[subject];
        if (drop.state === 'drop' && row.kind === 'element') move(row, drop.place);
      },
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
        if (drag?.pointerId === event.pointerId) setDrag(null);
      },
    },
  };
}

/**
 * Follows a moved layer to the row it landed on, once its frame has built
 * that revision, and picks its element there when it was picked before.
 */
function useLanding(
  rows: readonly LayerEntry[],
  reveal: (designId: string, row: { nodeId: string }) => RowSearch,
  moveTo: (key: string) => void,
  pick: (designId: string, node: PreviewNode) => void,
) {
  const [landing, setLanding] = useState<Landing | null>(null);
  if (landing?.key === null) {
    const search = landedRow(rows, landing, reveal);
    if (search.state === 'found') {
      moveTo(search.key);
      setLanding(landing.picked ? { ...landing, key: search.key } : null);
    } else if (search.state === 'missing') setLanding(null);
  }
  const drawn = landing?.key ? drawnAt(rows, landing.key) : null;
  const landedNode = drawn?.state === 'drawn' ? drawn.node : null;
  if (landing?.key && !landedNode && !mayBeDrawn(rows, landing, drawn)) setLanding(null);
  // The board's pick is the board's state, so it changes after this render, not during it.
  const pickLanded = useEffectEvent((node: PreviewNode) => {
    if (landing) pick(landing.designId, node);
    setLanding(null);
  });
  useEffect(() => {
    if (landedNode) pickLanded(landedNode);
  }, [landedNode]);
  return (moved: Omit<Landing, 'key'>) => {
    setLanding({ ...moved, key: null });
  };
}

/** A moved layer's row once its frame has built the revision it landed in. */
function landedRow(
  rows: readonly LayerEntry[],
  landing: Landing,
  reveal: (designId: string, row: { nodeId: string }) => RowSearch,
): RowSearch {
  const frame = rows.find((row) => row.key === landing.designId)?.frame;
  // Another write to the frame, or a build that failed, leaves the row where it is.
  if (frame?.revisionId !== landing.revisionId || frame.build.status === 'failed')
    return { state: 'missing' };
  const { build } = frame;
  if (build.status !== 'ready' || build.revisionId !== landing.revisionId)
    return { state: 'waiting' };
  return reveal(landing.designId, { nodeId: landing.nodeId });
}

/**
 * Whether a landed row's element may yet be drawn: its frame still shows the
 * revision it landed in, and the preview is reading it or, for a moment
 * between the old run and the new one, holds no run at all.
 */
function mayBeDrawn(rows: readonly LayerEntry[], landing: Landing, drawn: Drawn | null): boolean {
  if (drawn?.state !== 'reading' && drawn?.state !== 'unread') return false;
  return rows.find((row) => row.key === landing.designId)?.frame.revisionId === landing.revisionId;
}

function revisionOf(row: LayerEntry): Drag['revision'] {
  const { revisionId, build } = row.frame;
  return { frame: revisionId, built: build.status === 'ready' ? build.revisionId : null };
}

function isSameRevision(row: LayerEntry, revision: Drag['revision']): boolean {
  const now = revisionOf(row);
  return now.frame === revision.frame && now.built === revision.built;
}

function drawnAt(rows: readonly LayerEntry[], key: string): Drawn | null {
  const row = rows.find((each) => each.key === key);
  return row?.kind === 'element' ? row.drawn : null;
}
