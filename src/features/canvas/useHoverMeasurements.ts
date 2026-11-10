// What Alt measures under the pointer, as a design tool does: in Select, from
// the selected frames to the frame under the pointer; in Edit, from the picked
// element to the element under the pointer, or to its frame's edges over the
// frame's empty space, the design's root or the picked element itself. Every
// rect comes from what the board already draws, so measuring asks the guest nothing.

import { useEffect, useState, type RefObject } from 'react';
import { pushEscapeLayer } from '../../components/ui/escapeStack';
import { boardPoint } from './boardCoordinates';
import { boundsOf, type PlacedFrame, type Point } from './canvasGeometry';
import type { BoardInteraction } from './canvasState';
import type { SnapGap, SnapMarks } from './frameSnap';
import { measureBetween } from './measureDistances';
import { isDesignRoot, isDrawn } from './previewDocument';
import type { FrameRect } from './protocol';
import type { ElementSelection } from './useElementEditor';
import { isPicked, type HoveredElement } from './useElementHover';

interface PickedAndHovered {
  selection: ElementSelection | null;
  hover: { hovered: HoveredElement | null; move: HoverAt };
}

/** Asks what is under a point in a design's own pixels, as a pointer over it does. */
type HoverAt = (designId: string, at: Point) => void;

export function useHoverMeasurements(
  board: RefObject<HTMLElement | null>,
  drawn: readonly PlacedFrame[],
  interaction: BoardInteraction,
  editor: PickedAndHovered,
): SnapMarks {
  const { frameId, letGo } = useAltHoveredFrame(
    board,
    interaction.mode === 'edit' ? editor.hover.move : null,
  );
  let gaps: SnapGap[] = [];
  if (frameId !== null && interaction.mode === 'select')
    gaps = frameGaps(drawn, interaction.selectedFrameIds, frameId);
  if (frameId !== null && interaction.mode === 'edit') gaps = elementGaps(drawn, frameId, editor);
  const measuring = gaps.length > 0;
  // Shown distances are the topmost thing Escape closes, so no layer under them swallows it.
  useEffect(() => (measuring ? pushEscapeLayer(letGo) : undefined), [measuring, letGo]);
  return { guides: [], gaps };
}

/**
 * The frame under the pointer while Alt is held, else null, and letting go of
 * Alt. The pointer is followed without a render until Alt goes down, so a plain
 * hover costs nothing. Alt's release can land in another app, so losing the
 * window lets go of it too.
 */
function useAltHoveredFrame(board: RefObject<HTMLElement | null>, hoverAt: HoverAt | null) {
  const [frameId, setFrameId] = useState<string | null>(null);
  const [alt] = useState(() => {
    let held = false;
    let underPointer: string | null = null;
    let askHover: HoverAt | null = null;
    const show = () => {
      setFrameId(held ? underPointer : null);
    };
    // What is under a resting pointer may have moved there since it last moved.
    const lookUnder = (root: HTMLElement, pointer: Point) => {
      const hit = document.elementFromPoint(pointer.x, pointer.y);
      underPointer = hit && root.contains(hit) ? frameOf(hit) : null;
      const overlay = hit?.closest<HTMLElement>('[data-canvas-input-overlay]');
      if (overlay && underPointer !== null) askHover?.(underPointer, boardPoint(overlay, pointer));
    };
    return {
      setHoverAt: (next: HoverAt | null) => {
        askHover = next;
      },
      press: (root: HTMLElement, pointer: Point | null) => {
        if (pointer) lookUnder(root, pointer);
        held = true;
        show();
      },
      letGo: () => {
        held = false;
        show();
      },
      over: (next: string | null) => {
        underPointer = next;
        if (held) show();
      },
    };
  });
  alt.setHoverAt(hoverAt);
  useEffect(() => {
    const root = board.current;
    if (!root) return undefined;
    let pointer: Point | null = null;
    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onPointerOver = (event: PointerEvent) => {
      onPointerMove(event);
      alt.over(frameOf(event.target));
    };
    const onPointerLeave = () => {
      pointer = null;
      alt.over(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt' && !event.repeat) alt.press(root, pointer);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') alt.letGo();
    };
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerover', onPointerOver);
    root.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', alt.letGo);
    return () => {
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerover', onPointerOver);
      root.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', alt.letGo);
    };
  }, [board, alt]);
  return { frameId, letGo: alt.letGo };
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
  if (hovered?.designId === frameId && !isPicked(picked, hovered) && !isDesignRoot(hovered.element))
    return measureBetween(from, inWorld(frame, hovered.element.rect));
  return measureBetween(from, frame);
}

/** An element's box on the board: the sheet lays the design out one pixel to a world unit. */
function inWorld(frame: FrameRect, element: FrameRect): FrameRect {
  return { ...element, x: frame.x + element.x, y: frame.y + element.y };
}
