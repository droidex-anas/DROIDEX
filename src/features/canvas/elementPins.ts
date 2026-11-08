// The elements a chat's next prompt points its agent at. Design picks them on
// the board; the composer shows them as chips, sends them as the turn's element
// references and clears them, as framePins.ts does for frames, by chat.

import { useSyncExternalStore } from 'react';
import { toast } from '../../lib/toast';
import { attachedBoard } from './framePins';
import type { PickedElement } from './pickedElement';
import type { CanvasFrame, CanvasSnapshot } from './protocol';

/** The sidecar's limit on the elements one request may pin. */
const MAX_PINNED_ELEMENTS = 32;

export interface ElementPin {
  canvasId: string;
  frameName: string;
  /** The frame's width when it was picked, which its capture is scaled against for a crop. */
  frameWidth: number;
  element: PickedElement;
}

const NONE: readonly ElementPin[] = [];
// Only chats holding pins have an entry, so this never grows with the chats visited.
let pinsByChat: Readonly<Record<string, readonly ElementPin[]>> = {};
const listeners = new Set<() => void>();

function publish(appSessionId: string, pins: readonly ElementPin[]) {
  const others = Object.entries(pinsByChat).filter(([id]) => id !== appSessionId);
  pinsByChat = Object.fromEntries(pins.length > 0 ? [...others, [appSessionId, pins]] : others);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function elementPins(appSessionId: string): readonly ElementPin[] {
  return pinsByChat[appSessionId] ?? NONE;
}

export function useElementPins(appSessionId: string | null): readonly ElementPin[] {
  return useSyncExternalStore(subscribe, () => (appSessionId ? elementPins(appSessionId) : NONE));
}

/** One pick's identity: the element instance, and for a text range the words it spans. */
export function elementPinKey({ canvasId, element }: ElementPin): string {
  const { designId, elementId, instancePath, text } = element;
  return JSON.stringify([canvasId, designId, elementId, instancePath, text?.excerpt ?? null]);
}

/** What a chip and the quick prompt call a pick: its component, else its tag. */
export function elementName({ component, tagName }: PickedElement): string {
  return component ?? `<${tagName}>`;
}

/** What tells two picks of one element apart: the words it spans, else where it is written. */
export function elementDetail({ text, source }: PickedElement): string {
  if (text) return `“${text.excerpt.replace(/\s+/g, ' ').trim()}”`;
  return `${source.file.split('/').at(-1) ?? source.file}:${String(source.line)}`;
}

/**
 * Points the chat's next prompt at `element` in `frame`: in place of the
 * elements it pointed at, or beside them when `additive`, where picking one
 * already there takes it off. A request pins elements of one canvas.
 */
export function pickElement(
  appSessionId: string,
  canvasId: string,
  frame: CanvasFrame,
  element: PickedElement,
  additive: boolean,
): void {
  const pin: ElementPin = {
    canvasId,
    frameName: frame.name,
    frameWidth: frame.rect.width,
    element,
  };
  if (!additive) {
    publish(appSessionId, [pin]);
    return;
  }
  const key = elementPinKey(pin);
  const held = elementPins(appSessionId).filter((each) => each.canvasId === canvasId);
  if (held.some((each) => elementPinKey(each) === key)) {
    publish(
      appSessionId,
      held.filter((each) => elementPinKey(each) !== key),
    );
    return;
  }
  if (held.length >= MAX_PINNED_ELEMENTS) {
    toast.error(
      `A prompt points at most ${String(MAX_PINNED_ELEMENTS)} elements, so this one wasn’t added.`,
    );
    return;
  }
  publish(appSessionId, [...held, pin]);
}

/** Takes these elements off the chat's next prompt, or all of them. */
export function unpinElements(
  appSessionId: string,
  pins: readonly ElementPin[] = elementPins(appSessionId),
): void {
  if (pins.length === 0) return;
  const gone = new Set(pins.map(elementPinKey));
  publish(
    appSessionId,
    elementPins(appSessionId).filter((pin) => !gone.has(elementPinKey(pin))),
  );
}

/**
 * Puts a queued prompt's elements back on the draft it is being edited in:
 * only those whose frame is still on the chat's attached board, or, before the
 * pane has shown it, those of the prompt's own canvas.
 */
export function restoreElementPins(appSessionId: string, pins: readonly ElementPin[]): void {
  const canvasId = pins.at(0)?.canvasId;
  if (canvasId === undefined) return;
  const held = elementPins(appSessionId);
  const keys = new Set(held.map(elementPinKey));
  const merged = [...held, ...pins.filter((pin) => !keys.has(elementPinKey(pin)))];
  const board = attachedBoard(appSessionId);
  const next = board ? onBoard(merged, board) : merged.filter((pin) => pin.canvasId === canvasId);
  publishChanged(appSessionId, held, next.slice(0, MAX_PINNED_ELEMENTS));
}

/**
 * Keeps the chat's picks as its attached canvas now has them: a renamed frame
 * names them as it is now, and a deleted frame, or a canvas the chat has left,
 * takes its picks along. Only a change publishes.
 */
export function syncElementPins(appSessionId: string, attached: CanvasSnapshot): void {
  const held = elementPins(appSessionId);
  publishChanged(appSessionId, held, onBoard(held, attached));
}

/** The picks whose frame is on the attached board, named as that frame now is. */
function onBoard(pins: readonly ElementPin[], attached: CanvasSnapshot): ElementPin[] {
  const frames = new Map(attached.frames.map((frame) => [frame.designId, frame]));
  return pins.flatMap((pin) => {
    const frame = pin.canvasId === attached.canvasId ? frames.get(pin.element.designId) : undefined;
    if (!frame) return [];
    return [frame.name === pin.frameName ? pin : { ...pin, frameName: frame.name }];
  });
}

function publishChanged(
  appSessionId: string,
  held: readonly ElementPin[],
  next: readonly ElementPin[],
) {
  if (next.length !== held.length || next.some((pin, index) => pin !== held[index]))
    publish(appSessionId, next);
}
