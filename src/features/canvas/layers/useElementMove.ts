import { useEffect, useEffectEvent, useState, type PointerEvent, type RefObject } from 'react';
import { boardPoint } from '../boardCoordinates';
import type { Point } from '../canvasGeometry';
import type { ElementEntry } from './ElementRow';
import { dropLine, stepPlace, type LayerPlace, type LayerStep } from './layerMoves';
import { LEVEL_STEP_PX, type LayerEntry } from './layerRows';
import { DRAG_THRESHOLD_PX } from './useRestack';

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

/**
 * Moves the layers of a list whose rows are `rows`, each `rowPx` tall: by
 * dragging an element row's handle to a boundary between rows, at the depth
 * the pointer's travel sideways asks for, or by a keyboard step. `onMove`
 * sends the move. The list holds the pointer through a drag.
 */
export function useElementMove({
  list,
  rows,
  rowPx,
  onMove,
}: {
  list: RefObject<HTMLElement | null>;
  rows: readonly LayerEntry[];
  rowPx: number;
  onMove: (row: ElementEntry, place: LayerPlace) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
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
      if (place) onMove(row, place);
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
        if (drop.state === 'drop' && row.kind === 'element') onMove(row, drop.place);
      },
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
        if (drag?.pointerId === event.pointerId) setDrag(null);
      },
    },
  };
}

function revisionOf(row: LayerEntry): Drag['revision'] {
  const { revisionId, build } = row.frame;
  return { frame: revisionId, built: build.status === 'ready' ? build.revisionId : null };
}

function isSameRevision(row: LayerEntry, revision: Drag['revision']): boolean {
  const now = revisionOf(row);
  return now.frame === revision.frame && now.built === revision.built;
}
