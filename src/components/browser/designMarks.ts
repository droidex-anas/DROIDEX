import { useSyncExternalStore } from 'react';
import type { DesignReference } from '../../types/bridge';

// The marks a chat has picked in its browser page and not sent yet: each one a
// design reference whose anchor carries its number. They show as chips in the
// composer and as numbered outlines on the page, and go out with the next
// prompt. A number stays with its mark while others come and go, so an @2
// already typed keeps meaning the same mark; numbering starts again at 1 once
// every mark is gone.

const NONE: readonly DesignReference[] = [];
let marksByChat: Readonly<Record<string, readonly DesignReference[] | undefined>> = {};
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(appSessionId: string, marks: readonly DesignReference[]): void {
  marksByChat = { ...marksByChat, [appSessionId]: marks.length > 0 ? marks : undefined };
  for (const listener of listeners) listener();
}

export function designMarks(appSessionId: string | undefined): readonly DesignReference[] {
  return (appSessionId ? marksByChat[appSessionId] : undefined) ?? NONE;
}

export function useDesignMarks(appSessionId: string | undefined): readonly DesignReference[] {
  return useSyncExternalStore(
    subscribe,
    () => designMarks(appSessionId),
    () => NONE,
  );
}

/** Adds a pick as the next mark, or updates the mark it already is; returns it numbered. */
export function addDesignMark(appSessionId: string, reference: DesignReference): DesignReference {
  const marks = designMarks(appSessionId);
  const existing = marks.find((mark) => mark.id === reference.id);
  const number =
    existing?.anchor.mark ?? Math.max(0, ...marks.map((mark) => mark.anchor.mark ?? 0)) + 1;
  const numbered = { ...reference, anchor: { ...reference.anchor, mark: number } };
  set(
    appSessionId,
    existing
      ? marks.map((mark) => (mark.id === reference.id ? numbered : mark))
      : [...marks, numbered],
  );
  return numbered;
}

export function removeDesignMark(appSessionId: string, id: string): void {
  set(
    appSessionId,
    designMarks(appSessionId).filter((mark) => mark.id !== id),
  );
}

/** Replaces the chat's marks, as when a queued design prompt comes back to the composer. */
export function setDesignMarks(appSessionId: string, marks: readonly DesignReference[]): void {
  set(appSessionId, marks);
}

/** The chip's name: the component, else the element's name or text, else its tag. */
export function designMarkLabel(mark: DesignReference): string {
  const { anchor } = mark;
  if (anchor.kind !== 'element') return anchor.strokes ? 'Sketch' : 'Area';
  return anchor.source?.component ?? anchor.name ?? anchor.text ?? anchor.tag ?? anchor.label;
}
