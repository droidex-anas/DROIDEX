// The canvas's Tag in chat toggles beside kit catalog entries: which chat a kit
// document tags in, and how a toggle reads and changes the chat's tags. Only the
// lazy canvas surfaces use this, so it stays off the composer's entry chunk.

import { createContext } from 'react';
import {
  componentPinKey,
  componentPins,
  tagComponent,
  unpinComponents,
  type ComponentPin,
} from './componentPins';

/** The chat a kit document's catalog tags entries in, where the document has one. */
export const TaggingChat = createContext<string | null>(null);

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
