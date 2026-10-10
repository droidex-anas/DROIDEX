// The frames a chat's next prompt carries to its agent. Spec §4: a selected
// design shows as a composer chip, and sending pins its revision to that
// request. The board adds frames and keeps them current; the composer shows,
// sends and clears them. Neither owns the other, so they live here, by chat.

import { useSyncExternalStore } from 'react';
import type { CanvasFrame, CanvasSnapshot, CanvasTurnContext } from './protocol';

/** The sidecar's limit on the designs one request may pin. */
const MAX_PINNED = 32;

export interface FramePin {
  canvasId: string;
  designId: string;
  revisionId: string | null;
  name: string;
  /** Its size on the board, as the chip and the size badge show it. */
  size: string;
  designSystem: CanvasFrame['designSystem'];
}

const NONE: readonly FramePin[] = [];
// Only chats holding pins have an entry, and only boards on screen are kept, so
// neither grows with the chats a session has visited.
let pinsByChat: Readonly<Record<string, readonly FramePin[]>> = {};
/** The attached board each chat's pane is showing, which decides what a pin can name. */
const boards = new Map<string, CanvasSnapshot>();
const listeners = new Set<() => void>();

function publish(appSessionId: string, pins: readonly FramePin[]) {
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

export function framePins(appSessionId: string): readonly FramePin[] {
  return pinsByChat[appSessionId] ?? NONE;
}

export function useFramePins(appSessionId: string | null): readonly FramePin[] {
  return useSyncExternalStore(subscribe, () => (appSessionId ? framePins(appSessionId) : NONE));
}

function pinOf(canvasId: string, frame: CanvasFrame): FramePin {
  const { width, height } = frame.rect;
  return {
    canvasId,
    designId: frame.designId,
    revisionId: frame.revisionId,
    name: frame.name,
    size: `${String(Math.round(width))} × ${String(Math.round(height))}`,
    designSystem: frame.designSystem,
  };
}

/** The same frame, however its revision, name or size has moved since. */
function samePlace(a: FramePin, b: FramePin): boolean {
  return a.canvasId === b.canvasId && a.designId === b.designId;
}

function samePin(a: FramePin, b: FramePin): boolean {
  return (
    a.canvasId === b.canvasId &&
    a.designId === b.designId &&
    a.revisionId === b.revisionId &&
    a.name === b.name &&
    a.size === b.size &&
    a.designSystem.id === b.designSystem.id &&
    a.designSystem.version === b.designSystem.version &&
    a.designSystem.mode === b.designSystem.mode
  );
}

/**
 * Adds a frame to the chat's next prompt, or takes it off if it is there. A
 * request pins frames of one canvas, so a frame from another starts over.
 */
export function toggleFramePin(appSessionId: string, canvasId: string, frame: CanvasFrame): void {
  const held = framePins(appSessionId).filter((pin) => pin.canvasId === canvasId);
  if (held.some((pin) => pin.designId === frame.designId))
    publish(
      appSessionId,
      held.filter((pin) => pin.designId !== frame.designId),
    );
  else if (held.length < MAX_PINNED) publish(appSessionId, [...held, pinOf(canvasId, frame)]);
}

/** Takes these frames off the chat's next prompt, or all of them. */
export function unpinFrames(
  appSessionId: string,
  pins: readonly FramePin[] = framePins(appSessionId),
) {
  const held = framePins(appSessionId);
  if (pins.length > 0)
    publish(
      appSessionId,
      held.filter((pin) => !pins.some((gone) => samePlace(pin, gone))),
    );
}

/**
 * Puts a queued prompt's frames back on the draft it is being edited in, by the
 * same rule as `syncFramePins`: only frames still on the chat's attached board.
 * A chat whose pane has not shown its board yet keeps the prompt's own canvas.
 */
export function restoreFramePins(appSessionId: string, pins: readonly FramePin[]): void {
  const canvasId = pins.at(0)?.canvasId;
  if (canvasId === undefined) return;
  const held = framePins(appSessionId);
  const merged = [...held, ...pins.filter((pin) => !held.some((own) => samePlace(own, pin)))];
  const board = boards.get(appSessionId);
  const next = board ? onBoard(merged, board) : merged.filter((pin) => pin.canvasId === canvasId);
  publishChanged(appSessionId, held, next.slice(0, MAX_PINNED));
}

/**
 * Keeps the chat's pins as its attached canvas now has them: a frame renamed,
 * resized or rebuilt is pinned as it is now, and a deleted frame, or one from a
 * canvas the chat has left, is dropped. Only a change publishes.
 */
export function syncFramePins(appSessionId: string, attached: CanvasSnapshot): () => void {
  boards.set(appSessionId, attached);
  const held = framePins(appSessionId);
  publishChanged(appSessionId, held, onBoard(held, attached));
  // Called when the board goes, so a closed pane does not keep its whole snapshot.
  return () => {
    if (boards.get(appSessionId) === attached) boards.delete(appSessionId);
  };
}

/** The pins that name a frame on the attached board, as that frame now is. */
function onBoard(pins: readonly FramePin[], attached: CanvasSnapshot): FramePin[] {
  const frames = new Map(attached.frames.map((frame) => [frame.designId, frame]));
  return pins.flatMap((pin) => {
    const frame = pin.canvasId === attached.canvasId ? frames.get(pin.designId) : undefined;
    return frame ? [pinOf(attached.canvasId, frame)] : [];
  });
}

function publishChanged(appSessionId: string, held: readonly FramePin[], next: FramePin[]) {
  if (next.length !== held.length || next.some((pin, index) => !samePin(pin, held[index])))
    publish(appSessionId, next);
}

/**
 * The turn context a send carries: the frames' revisions as they are now, in
 * fresh objects, so nothing that changes afterwards can retarget the request.
 */
export function canvasContextOf(pins: readonly FramePin[] = NONE): CanvasTurnContext | undefined {
  const first = pins.at(0);
  if (!first) return undefined;
  return {
    designs: pins.map(({ designId, revisionId }) => ({ designId, revisionId })),
    elements: [],
    designSystem: { ...first.designSystem },
  };
}

// Mirrored by sidecar/src/canvas/canvasFramesPrompt.ts, which strips the block
// back out of a stored prompt so the bubble shows the frames as chips.
const FRAMES_OPEN =
  '<canvas_frames>\nThe user pinned these canvas frames to this request; "this" and "it" mean them.';
const FRAMES_CLOSE = '</canvas_frames>';

/**
 * The prompt with its pinned frames named after the user's words. The turn's
 * lease already holds them, but a model that acts before it reads would not
 * know which frame "this one" is.
 */
export function promptWithFramePins(prompt: string, pins: readonly FramePin[] = NONE): string {
  if (pins.length === 0) return prompt;
  const frames = pins.map(
    (pin) => `<frame id="${pin.designId}">${pin.name.replace(/\s+/g, ' ')}</frame>`,
  );
  const block = [FRAMES_OPEN, ...frames, FRAMES_CLOSE].join('\n');
  return prompt ? `${prompt}\n\n${block}` : block;
}
