// A chat dragged from the sidebar, or a tile dragged by its header, toward the
// chat area. The browser hides drag data until the drop, so the drop targets
// read what is being dragged from here.

import { useSyncExternalStore, type DragEvent } from 'react';

export type PlaceDrag = { kind: 'chat'; appSessionId: string } | { kind: 'tile'; tileId: string };

const PLACE_DRAG_TYPE = 'application/x-droidex-place';

let current: PlaceDrag | null = null;
let pendingStart: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function publish(next: PlaceDrag | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startPlaceDrag(event: DragEvent, drag: PlaceDrag): void {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(PLACE_DRAG_TYPE, '');
  // Chromium cancels a drag whose page changes under the pointer as it starts,
  // so the drop targets appear a tick later.
  pendingStart = setTimeout(() => {
    pendingStart = null;
    publish(drag);
  });
}

export function endPlaceDrag(): void {
  if (pendingStart !== null) {
    clearTimeout(pendingStart);
    pendingStart = null;
  }
  if (current) publish(null);
}

/** Makes an element the handle that drags its tile to another place in the grid. */
export function tileHandleProps(tileId: string) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      startPlaceDrag(event, { kind: 'tile', tileId });
    },
    onDragEnd: endPlaceDrag,
  };
}

export function isPlaceDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(PLACE_DRAG_TYPE);
}

export function usePlaceDrag(): PlaceDrag | null {
  return useSyncExternalStore(subscribe, () => current);
}
