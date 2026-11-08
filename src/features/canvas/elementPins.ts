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
/** About the characters a chip's label fits before the chip cuts it off. */
const LABEL_CHARS = 30;
/** What a long name leaves the detail, so a chip still tells its picks apart. */
const MIN_DETAIL_CHARS = 12;

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

/**
 * What a chip calls a pick: its name, its frame, and what tells it apart from
 * other picks of the element. When that is longer than a chip shows, the frame
 * goes first, then the middle of the detail, then, for a long name, the middle
 * of the name too.
 */
export function elementLabel({ frameName, element }: ElementPin): string {
  const name = elementName(element);
  const detail = elementDetail(element);
  const full = `${name} in ${frameName} · ${detail}`;
  if (full.length <= LABEL_CHARS) return full;
  const room = LABEL_CHARS - ' · '.length;
  const shownDetail = middleCut(detail, Math.max(room - name.length, MIN_DETAIL_CHARS));
  return `${middleCut(name, room - shownDetail.length)} · ${shownDetail}`;
}

/** What tells two picks of one element apart: the words it spans, else where it is written. */
function elementDetail({ text, source }: PickedElement): string {
  if (text) return `“${text.excerpt.replace(/\s+/g, ' ').trim()}”`;
  return `${source.file.split('/').at(-1) ?? source.file}:${String(source.line)}`;
}

/** `text` in at most `room` characters, its middle cut out; its ends always stay. */
function middleCut(text: string, room: number): string {
  if (text.length <= room) return text;
  const kept = Math.max(room - 1, 2);
  const head = Math.ceil(kept / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (kept - head))}`;
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
 * only those the chat's attached board still has at the revision they were
 * picked in. With no board on screen nothing can confirm that, so none come back.
 */
export function restoreElementPins(appSessionId: string, pins: readonly ElementPin[]): void {
  const board = attachedBoard(appSessionId);
  if (!board) return;
  const held = elementPins(appSessionId);
  const keys = new Set(held.map(elementPinKey));
  const merged = [...held, ...pins.filter((pin) => !keys.has(elementPinKey(pin)))];
  publishChanged(appSessionId, held, onBoard(merged, board).slice(0, MAX_PINNED_ELEMENTS));
}

/**
 * Keeps the chat's picks as its attached canvas now has them: a renamed frame
 * names them as it is now, and a deleted or rebuilt frame, or a canvas the chat
 * has left, takes its picks along. Only a change publishes.
 */
export function syncElementPins(appSessionId: string, attached: CanvasSnapshot): void {
  const held = elementPins(appSessionId);
  publishChanged(appSessionId, held, onBoard(held, attached));
}

/**
 * The picks whose frame is on the attached board at the revision they were
 * picked in, named as that frame now is. A rebuilt frame may no longer hold the
 * element, so its picks go.
 */
function onBoard(pins: readonly ElementPin[], attached: CanvasSnapshot): ElementPin[] {
  const frames = new Map(attached.frames.map((frame) => [frame.designId, frame]));
  return pins.flatMap((pin) => {
    const frame = pin.canvasId === attached.canvasId ? frames.get(pin.element.designId) : undefined;
    if (frame?.revisionId !== pin.element.revisionId) return [];
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
