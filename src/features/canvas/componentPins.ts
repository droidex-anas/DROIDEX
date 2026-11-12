// The kit components a chat's next prompt asks its agent to build with. The `@`
// menu tags them from the catalog of the kit the request runs under; the
// composer shows them as chips, writes them into the prompt and clears them, as
// framePins.ts does for frames, by chat.

import { useSyncExternalStore } from 'react';
import { toast } from '../../lib/toast';
import type { DesignSystemChoice } from './designSystemChoices';
import type { DesignSystemRef } from './protocol';

/** A prompt names a few components; past that it is asking for a whole kit. */
const MAX_PINNED_COMPONENTS = 8;

export interface ComponentPin {
  /** The kit version whose catalog has the entry, which the agent reads it from. */
  kit: DesignSystemRef;
  kitName: string;
  /** The catalog entry's name. */
  name: string;
}

const NONE: readonly ComponentPin[] = [];
// Only chats holding pins have an entry, so this never grows with the chats visited.
let pinsByChat: Readonly<Record<string, readonly ComponentPin[]>> = {};
const listeners = new Set<() => void>();

function publish(appSessionId: string, pins: readonly ComponentPin[]) {
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

export function componentPins(appSessionId: string): readonly ComponentPin[] {
  return pinsByChat[appSessionId] ?? NONE;
}

export function useComponentPins(appSessionId: string | null): readonly ComponentPin[] {
  return useSyncExternalStore(subscribe, () => (appSessionId ? componentPins(appSessionId) : NONE));
}

/** One tag's identity: the entry of one kit, whichever version it was tagged from. */
export function componentPinKey({ kit, name }: ComponentPin): string {
  return JSON.stringify([kit.id, name]);
}

/**
 * What the chips call the tags: each entry's name, and its kit's name beside
 * it once the tags come from more than one kit. Mirrored by
 * sidecar/src/canvas/canvasPinsPrompt.ts for the sent prompt's bubble.
 */
export function componentLabels(pins: readonly ComponentPin[]): string[] {
  const kits = new Set(pins.map((pin) => pin.kit.id));
  return pins.map((pin) => (kits.size > 1 ? `${pin.name} · ${pin.kitName}` : pin.name));
}

/**
 * Tags the entry in the chat's next prompt beside the ones it has, while it has
 * room. An entry tagged already takes this tag's kit version and mode.
 */
export function tagComponent(appSessionId: string, pin: ComponentPin): void {
  const held = componentPins(appSessionId);
  const key = componentPinKey(pin);
  if (held.some((each) => componentPinKey(each) === key)) {
    publish(
      appSessionId,
      held.map((each) => (componentPinKey(each) === key ? pin : each)),
    );
    return;
  }
  if (held.length >= MAX_PINNED_COMPONENTS) {
    toast.error(
      `A prompt tags at most ${String(MAX_PINNED_COMPONENTS)} components, so this one wasn’t added.`,
    );
    return;
  }
  publish(appSessionId, [...held, pin]);
}

/** Takes these components off the chat's next prompt, or all of them. */
export function unpinComponents(
  appSessionId: string,
  pins: readonly ComponentPin[] = componentPins(appSessionId),
): void {
  if (pins.length === 0) return;
  const gone = new Set(pins.map(componentPinKey));
  publish(
    appSessionId,
    componentPins(appSessionId).filter((pin) => !gone.has(componentPinKey(pin))),
  );
}

/**
 * The tags as a prompt sends them: those of the request's kit follow it to its
 * current version and mode, so the agent reads the entry the frames build with.
 * When the request runs under the canvas's choice, they take its name too.
 */
export function pinsUnderKit(
  pins: readonly ComponentPin[],
  kit: DesignSystemRef | null,
  choice: DesignSystemChoice | null,
): readonly ComponentPin[] {
  if (kit === null) return pins;
  const kitName = choice?.ref.id === kit.id ? choice.name : null;
  const isBehind = (pin: ComponentPin) =>
    pin.kit.id === kit.id &&
    (pin.kit.version !== kit.version ||
      pin.kit.mode !== kit.mode ||
      (kitName !== null && pin.kitName !== kitName));
  if (!pins.some(isBehind)) return pins;
  return pins.map((pin) =>
    isBehind(pin) ? { ...pin, kit: { ...kit }, kitName: kitName ?? pin.kitName } : pin,
  );
}

/** Puts a queued prompt's components back beside the ones the draft has, as far as it has room. */
export function restoreComponentPins(appSessionId: string, pins: readonly ComponentPin[]): void {
  const held = componentPins(appSessionId);
  const keys = new Set(held.map(componentPinKey));
  const added = pins.filter((pin) => !keys.has(componentPinKey(pin)));
  if (added.length > 0) publish(appSessionId, [...held, ...added].slice(0, MAX_PINNED_COMPONENTS));
}
