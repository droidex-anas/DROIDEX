// What a key means on the board: the zoom, mode and annotation tool shortcuts, Edit's element keys, which elements
// keep their own keys, and how focus moves between frames and between marks.
// The board reads these; nothing here touches React state.

import type { KeyboardEvent } from 'react';
import { draftBounds, isTextDraft, type AnnotationTool } from './annotationGeometry';
import type { ShownMark } from './annotationWrites';
import type { ZoomCommand } from './BoardControls';
import { arrowDirection, nudgeStep, type Point } from './canvasGeometry';
import type { BoardMode } from './canvasState';
import type { FrameRect } from './protocol';

/** The zoom keys a design tool uses: + and −, and ⇧1, ⇧2 and ⇧0. */
export function zoomShortcut(event: KeyboardEvent): ZoomCommand | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  // The shifted digits go by key position first: on some layouts ⇧1 types +.
  if (event.shiftKey && event.code === 'Digit1') return 'fit';
  if (event.shiftKey && event.code === 'Digit2') return 'selection';
  if (event.shiftKey && event.code === 'Digit0') return 'actual';
  if (event.key === '+' || event.key === '=') return 'in';
  if (event.key === '-' || event.key === '_') return 'out';
  return null;
}

/** V for Select, I for Interact and E for Edit element, as the rail's tips say. */
export function modeShortcut(event: KeyboardEvent): BoardMode | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key === 'v' || event.key === 'V') return 'select';
  if (event.key === 'i' || event.key === 'I') return 'interact';
  if (event.key === 'e' || event.key === 'E') return 'edit';
  return null;
}

const ANNOTATION_KEYS = new Map<string, AnnotationTool>([
  ['p', 'draw'],
  ['r', 'rect'],
  ['o', 'ellipse'],
  ['l', 'line'],
  ['a', 'arrow'],
  ['t', 'text'],
  ['n', 'note'],
]);

/** A letter per annotation tool, as the rail's tips say. */
export function annotationShortcut(event: KeyboardEvent): AnnotationTool | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  return ANNOTATION_KEYS.get(event.key.toLowerCase()) ?? null;
}

/** Backspace or Delete, unmodified, as the frame menu's Delete says. */
export function isDeleteKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  return event.key === 'Backspace' || event.key === 'Delete';
}

/** ⌘Z, or Ctrl+Z off the Mac. */
export function isUndoKey(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === 'z';
}

/** Edit's keys: Enter for the first element, or into the panel once one is picked; the arrows step. */
export function elementStep(event: KeyboardEvent): 'first' | 'next' | 'previous' | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key === 'Enter') return 'first';
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') return 'next';
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') return 'previous';
  return null;
}

/** The frame whose name label this is, or null for anything else. */
export function frameHeaderOf(target: EventTarget): string | null {
  if (!(target instanceof HTMLElement) || target.dataset.frameHeader === undefined) return null;
  return target.closest<HTMLElement>('[data-design-frame]')?.dataset.designFrame ?? null;
}

/** The annotation mark that is this element, or null for anything else. */
export function annotationMarkOf(target: EventTarget): string | null {
  return target instanceof SVGElement ? (target.dataset.annotation ?? null) : null;
}

export function isBoardControl(target: EventTarget): boolean {
  return target instanceof HTMLElement && target.closest('[data-board-controls]') !== null;
}

export function isBoardEditor(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('input, textarea, select, [role="textbox"]') !== null)
  );
}

/**
 * Frames or marks as a reader meets them: rows from the top, each read left to
 * right. One joins a row when its top sits within half the first one's height
 * of that row's top, so a slightly lower neighbour is not read after the next row.
 */
export function readingOrder<Item extends { rect: FrameRect }>(items: readonly Item[]): Item[] {
  const byTop = [...items].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const rows: Item[][] = [];
  for (const item of byTop) {
    const row = rows.at(-1);
    const lead = row?.[0];
    if (row && lead && item.rect.y < lead.rect.y + lead.rect.height / 2) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) => [...row].sort((a, b) => a.rect.x - b.rect.x));
}

/**
 * Where a key moves focus from `from`, in reading order: the arrows one frame
 * or mark back or on, Home and End to either end. Null for any other key, and
 * for an arrow with a modifier, which nudges instead.
 */
export function focusStep(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  order: readonly string[],
  from: string,
): string | null {
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  const at = order.indexOf(from);
  if (at < 0 || order.length === 0) return null;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return order[Math.min(at + 1, order.length - 1)];
    case 'ArrowLeft':
    case 'ArrowUp':
      return order[Math.max(at - 1, 0)];
    case 'Home':
      return order[0];
    case 'End':
      return order[order.length - 1];
    default:
      return null;
  }
}

/** The marks in reading order, and the one holding their tab stop: the selected mark, else the first. */
export function markFocusOrder(marks: readonly ShownMark[], selectedId: string | null) {
  const order = readingOrder(
    marks.map(({ draft }) => ({ id: draft.id, rect: draftBounds(draft) })),
  ).map((mark) => mark.id);
  const tabStopId =
    selectedId !== null && order.includes(selectedId) ? selectedId : (order.at(0) ?? null);
  return { order, tabStopId };
}

export type MarkKey =
  | { kind: 'delete'; neighbour: string | null }
  | { kind: 'type' }
  | { kind: 'focus'; id: string }
  | { kind: 'nudge'; step: Point };

/**
 * A key on a focused mark, as on a frame's label: the arrows, Home and End
 * move to another mark, ⌥ and an arrow nudge it, ⇧ for ten, Delete removes it
 * for the mark beside it, and Enter types into a label or note.
 */
export function markKey(
  event: KeyboardEvent,
  order: readonly string[],
  mark: ShownMark,
): MarkKey | null {
  const { id } = mark.draft;
  if (isDeleteKey(event)) {
    const at = order.indexOf(id);
    return { kind: 'delete', neighbour: order.at(at + 1) ?? (at > 0 ? order[at - 1] : null) };
  }
  if (event.key === 'Enter' && isTextDraft(mark.draft)) return { kind: 'type' };
  const next = focusStep(event, order, id);
  if (next !== null) return { kind: 'focus', id: next };
  const direction = arrowDirection(event.key);
  if (!direction || !event.altKey) return null;
  return { kind: 'nudge', step: nudgeStep(direction, event.shiftKey) };
}
