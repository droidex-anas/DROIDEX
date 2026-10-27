// The library item a Design home send starts its new canvas from (spec §7).
// It is armed on the home, moves to the send that makes the canvas, and is
// handed out once when that canvas exists, so a remount or a replayed
// attachment read never places a second copy. Leaving the home drops it.

import { useSyncExternalStore } from 'react';
import type { LibraryItem } from './protocol';

export interface CreatedCanvasSeed {
  item: LibraryItem;
  /** Fixed when the send is made, so the placement it owes commits at most once. */
  mutationId: string;
}

let armed: LibraryItem | null = null;
const listeners = new Set<() => void>();
const owedByCreate = new Map<string, CreatedCanvasSeed>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The item the Design home's next send starts from, or null to start blank. */
export function armLibrarySeed(item: LibraryItem | null): void {
  if (armed === item) return;
  armed = item;
  for (const listener of listeners) listener();
}

export function useArmedLibrarySeed(): LibraryItem | null {
  return useSyncExternalStore(subscribe, () => armed);
}

/** Moves the armed item to the send `clientRef`, so the next send starts blank. */
export function oweCreatedCanvasSeed(clientRef: string): void {
  if (!armed) return;
  owedByCreate.set(clientRef, { item: armed, mutationId: crypto.randomUUID() });
  armLibrarySeed(null);
}

/** The seed the send `clientRef` owes its canvas, handed out once. */
export function takeCreatedCanvasSeed(clientRef: string): CreatedCanvasSeed | null {
  const seed = owedByCreate.get(clientRef) ?? null;
  owedByCreate.delete(clientRef);
  return seed;
}
