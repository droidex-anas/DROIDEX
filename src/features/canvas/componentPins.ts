// The kit components a chat's next prompt asks its agent to build with. The `@`
// menu tags them from the catalog of the kit the request runs under; the
// composer shows them as chips, writes them into the prompt and clears them, as
// framePins.ts does for frames, by chat.

import { createContext, useSyncExternalStore } from 'react';
import { toast } from '../../lib/toast';
import type { DesignSystemChoice } from './designSystemChoices';
import type { PropPick } from './elementEditProtocol';
import type { CatalogListing, DesignSystemRef } from './protocol';

/** A prompt names a few components; past that it is asking for a whole kit. */
const MAX_PINNED_COMPONENTS = 8;

export interface ComponentPin {
  /** The kit version whose catalog has the entry, which the agent reads it from. */
  kit: DesignSystemRef;
  kitName: string;
  /** The catalog entry's name. */
  name: string;
  /** The options picked for the entry's props where they differ from its defaults. */
  props: readonly PropPick[];
}

/** The chat a kit document's catalog tags entries in, where the document has one. */
export const TaggingChat = createContext<string | null>(null);

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
 * What the chips call the tags: each entry's name with its picked options, and
 * its kit's name beside it once the tags come from more than one kit. Mirrored
 * by sidecar/src/canvas/canvasPinsPrompt.ts for the sent prompt's bubble.
 */
export function componentLabels(pins: readonly ComponentPin[]): string[] {
  const kits = new Set(pins.map((pin) => pin.kit.id));
  return pins.map((pin) => {
    const picked = pin.props.map(({ value }) => value).join(', ');
    const entry = picked === '' ? pin.name : `${pin.name} (${picked})`;
    return kits.size > 1 ? `${entry} · ${pin.kitName}` : entry;
  });
}

/**
 * Tags the entry in the chat's next prompt beside the ones it has, while it has
 * room. An entry tagged already takes this tag's kit version, mode and options.
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

/** How the chat's next prompt holds an entry: with these options, with others, or not at all. */
export type ComponentTag = 'tagged' | 'other-options' | 'untagged';

export function componentTag(pins: readonly ComponentPin[], pin: ComponentPin): ComponentTag {
  const key = componentPinKey(pin);
  const held = pins.find((each) => componentPinKey(each) === key);
  if (!held) return 'untagged';
  // Kit versions may list an entry's props in different orders, so picks match by name.
  const sameOptions =
    held.props.length === pin.props.length &&
    held.props.every((pick) =>
      pin.props.some((each) => each.name === pick.name && each.value === pick.value),
    );
  return sameOptions ? 'tagged' : 'other-options';
}

/** Tags the entry with these options, or takes it off when the prompt tags it with them already. */
export function toggleComponentPin(appSessionId: string, pin: ComponentPin): void {
  if (componentTag(componentPins(appSessionId), pin) === 'tagged')
    unpinComponents(appSessionId, [pin]);
  else tagComponent(appSessionId, pin);
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
 * Takes off the tags a prompt was composed with, as they were then: one tagged
 * again while the prompt was being sent stays for the next prompt.
 */
export function unpinSentComponents(appSessionId: string, sent: readonly ComponentPin[]): void {
  if (sent.length === 0) return;
  const gone = new Set(sent);
  publish(
    appSessionId,
    componentPins(appSessionId).filter((pin) => !gone.has(pin)),
  );
}

/**
 * The tags as a prompt sends them: those of the request's kit follow it to its
 * current version and mode, so the agent reads the entry the frames build with.
 * When the request runs under the canvas's choice, they take its name too, and
 * once that version's catalog is read, only the options its entry still offers.
 */
export function pinsUnderKit(
  pins: readonly ComponentPin[],
  kit: DesignSystemRef | null,
  choice: DesignSystemChoice | null,
  catalog: readonly CatalogListing[] | null,
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
    isBehind(pin)
      ? {
          kit: { ...kit },
          kitName: kitName ?? pin.kitName,
          name: pin.name,
          props: catalog === null ? pin.props : offeredPicks(pin, catalog),
        }
      : pin,
  );
}

function offeredPicks({ name, props }: ComponentPin, catalog: readonly CatalogListing[]) {
  const entry = catalog.find((each) => each.name === name);
  return props.filter((pick) =>
    entry?.props.some((prop) => prop.name === pick.name && prop.options.includes(pick.value)),
  );
}

/**
 * Puts a queued prompt's components back beside the ones the draft has, as far
 * as it has room. A queued tag of an entry the draft holds takes its place, so
 * the prompt keeps the kit version and options it was queued with.
 */
export function restoreComponentPins(appSessionId: string, pins: readonly ComponentPin[]): void {
  if (pins.length === 0) return;
  const queued = new Map(pins.map((pin) => [componentPinKey(pin), pin]));
  const held = componentPins(appSessionId);
  const heldKeys = new Set(held.map(componentPinKey));
  const merged = [
    ...held.map((pin) => queued.get(componentPinKey(pin)) ?? pin),
    ...pins.filter((pin) => !heldKeys.has(componentPinKey(pin))),
  ];
  publish(appSessionId, merged.slice(0, MAX_PINNED_COMPONENTS));
}
