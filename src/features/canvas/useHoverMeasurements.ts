// What Alt measures under the pointer, as a design tool does: in Select, from
// the selected frames to the frame under the pointer; in Edit, from the picked
// element to the element under the pointer, or to its frame's edges over the
// frame's empty space or the picked element itself. Every rect comes from what
// the board already draws, so measuring asks the guest nothing.

import { useEffect, useState, type RefObject } from 'react';
import { boundsOf, type PlacedFrame } from './canvasGeometry';
import type { BoardInteraction } from './canvasState';
import type { SnapGap, SnapMarks } from './frameSnap';
import { measureBetween } from './measureDistances';
import { isDrawn } from './previewDocument';
import type { FrameRect } from './protocol';
import type { ElementSelection } from './useElementEditor';
import { isPicked, type HoveredElement } from './useElementHover';

interface PickedAndHovered {
  selection: ElementSelection | null;
  hover: { hovered: HoveredElement | null };
}

export function useHoverMeasurements(
  board: RefObject<HTMLElement | null>,
  drawn: readonly PlacedFrame[],
  interaction: BoardInteraction,
  editor: PickedAndHovered,
): SnapMarks {
  const frameId = useAltHoveredFrame(board);
  if (frameId === null) return { guides: [], gaps: [] };
  let gaps: SnapGap[] = [];
  if (interaction.mode === 'select') gaps = frameGaps(drawn, interaction.selectedFrameIds, frameId);
  if (interaction.mode === 'edit') gaps = elementGaps(drawn, frameId, editor);
  return { guides: [], gaps };
}

/**
 * The frame under the pointer while Alt is held, else null. The pointer is
 * followed without a render until Alt goes down, so a plain hover costs nothing.
 * Alt's release can land in another app, so losing the window lets go of it, as Escape does.
 */
function useAltHoveredFrame(board: RefObject<HTMLElement | null>): string | null {
  const [frameId, setFrameId] = useState<string | null>(null);
  useEffect(() => {
    const root = board.current;
    if (!root) return undefined;
    let underPointer: string | null = null;
    let altHeld = false;
    const show = () => {
      setFrameId(altHeld ? underPointer : null);
    };
    const onPointerOver = (event: PointerEvent) => {
      underPointer = frameOf(event.target);
      if (altHeld) show();
    };
    const onPointerLeave = () => {
      underPointer = null;
      show();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') altHeld = true;
      else if (event.key === 'Escape') altHeld = false;
      else return;
      show();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Alt') return;
      altHeld = false;
      show();
    };
    const letGo = () => {
      altHeld = false;
      show();
    };
    root.addEventListener('pointerover', onPointerOver);
    root.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', letGo);
    return () => {
      root.removeEventListener('pointerover', onPointerOver);
      root.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', letGo);
    };
  }, [board]);
  return frameId;
}

function frameOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-design-frame]')?.dataset.designFrame ?? null;
}

function frameGaps(
  drawn: readonly PlacedFrame[],
  selectedFrameIds: readonly string[],
  hoveredId: string,
): SnapGap[] {
  if (selectedFrameIds.includes(hoveredId)) return [];
  const selected = boundsOf(
    drawn.filter(({ designId }) => selectedFrameIds.includes(designId)).map(({ rect }) => rect),
  );
  const hovered = drawn.find(({ designId }) => designId === hoveredId)?.rect;
  return selected && hovered ? measureBetween(selected, hovered) : [];
}

function elementGaps(
  drawn: readonly PlacedFrame[],
  frameId: string,
  { selection, hover }: PickedAndHovered,
): SnapGap[] {
  const picked = selection?.draft.element;
  const frame = drawn.find(({ designId }) => designId === frameId)?.rect;
  // A hidden element has no box to measure from; the panel says it is hidden.
  if (!selection || picked?.designId !== frameId || !frame || !isDrawn(selection.shown.rect))
    return [];
  const from = inWorld(frame, selection.shown.rect);
  const { hovered } = hover;
  if (hovered?.designId === frameId && !isPicked(picked, hovered))
    return measureBetween(from, inWorld(frame, hovered.element.rect));
  return measureBetween(from, frame);
}

/** An element's box on the board: the sheet lays the design out one pixel to a world unit. */
function inWorld(frame: FrameRect, element: FrameRect): FrameRect {
  return { ...element, x: frame.x + element.x, y: frame.y + element.y };
}
