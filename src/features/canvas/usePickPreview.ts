// What the element panel's style fields do to the selected element. The
// option a list rests on previews on the element, and leaving the list
// unpicked puts back what the property had before; a pick previews and
// commits at once. While an option previews, the field keeps showing what it
// showed before, since the guest reports the hovered value as the element's
// own. Every edit names the element it was drawn for, so a callback that
// outlives the selection edits nothing.

import { useState } from 'react';
import type { ElementEditDraft } from './elementEditDraft';
import type { ElementRef } from './protocol';

/** The property a list is previewing an option of, and what it had before. */
export interface PickerHover {
  element: ElementRef;
  property: string;
  /** The property's own preview before the hover; undefined when it had none. */
  before: string | undefined;
  /** What the field showed before the hover. */
  face: string;
  /** The option it previews now. */
  previewing: string;
}

export interface PickPreviewInputs {
  draft: ElementEditDraft;
  /** What the guest last reported for each property. */
  computed: Readonly<Record<string, string>>;
  readOnly: boolean;
  /** These return false, and edit nothing, once `element` is no longer the selection. */
  onPreview: (property: string, value: string, element: ElementRef) => boolean;
  onRevert: (property: string, element: ElementRef) => boolean;
  onCommit: (element: ElementRef) => void;
}

export function usePickPreview(inputs: PickPreviewInputs) {
  const [hover, setHover] = useState<PickerHover | null>(null);
  return pickPreview(hover, setHover, inputs);
}

/** The hook's work, over the hover it holds. */
export function pickPreview(
  hover: PickerHover | null,
  setHover: (hover: PickerHover | null) => void,
  { draft, computed, readOnly, onPreview, onRevert, onCommit }: PickPreviewInputs,
) {
  const { element } = draft;
  const held = heldOn(hover, draft);
  if (held !== hover) setHover(held);
  const own = (property: string): string =>
    Object.hasOwn(draft.values, property)
      ? (draft.values[property] ?? '')
      : (computed[property] ?? '');
  /** Puts back what the hovered property had; false once the selection has moved on. */
  const restore = ({ property, before }: PickerHover): boolean =>
    before === undefined ? onRevert(property, element) : onPreview(property, before, element);
  const endHover = (property: string) => {
    if (held?.property === property) setHover(null);
  };
  return {
    /** A property's value as the panel shows it: its preview, else what the guest computed. */
    value: (property: string): string => (held?.property === property ? held.face : own(property)),
    previewed: (property: string): boolean =>
      held?.property === property
        ? held.before !== undefined
        : Object.hasOwn(draft.values, property),
    /** A typed or dragged value, which takes the place of an option the list previews. */
    preview: (property: string) => (next: string) => {
      if (onPreview(property, next, element)) endHover(property);
    },
    revert: (property: string) => () => {
      if (onRevert(property, element)) endHover(property);
    },
    /** Commits every preview but a hovered option, which only a pick makes the value. */
    commit: () => {
      if (held && !restore(held)) return;
      setHover(null);
      onCommit(element);
    },
    /** A pick from a segment, option or token: previews the value and commits at once. */
    pick: (property: string) => (next: string) => {
      if (readOnly || !onPreview(property, next, element)) return;
      setHover(null);
      onCommit(element);
    },
    /** The option a list rests on, previewed; null puts back what was there. */
    hover: (property: string) => (next: string | null) => {
      if (next === null) {
        if (held?.property === property && restore(held)) setHover(null);
        return;
      }
      if (readOnly) return;
      const before = Object.hasOwn(draft.values, property) ? draft.values[property] : undefined;
      const face = own(property);
      if (!onPreview(property, next, element)) return;
      setHover(
        held?.property === property
          ? { ...held, previewing: next }
          : { element, property, before, face, previewing: next },
      );
    },
  };
}

/**
 * The hover as the draft stands now. A commit moves the draft onto the
 * revision it made with the previews it did not carry, and a hover whose
 * option is among them goes along; any other change of element ends it.
 */
function heldOn(hover: PickerHover | null, draft: ElementEditDraft): PickerHover | null {
  if (hover === null || hover.element === draft.element) return hover;
  return draft.values[hover.property] === hover.previewing
    ? { ...hover, element: draft.element }
    : null;
}
