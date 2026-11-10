// What the element panel's pickers do to the selected element. The option a
// list rests on previews on the element, and leaving the list unpicked puts
// back what the property had before; a pick previews and commits at once.
// While an option previews, the field keeps showing what it showed before,
// since the guest reports the hovered value as the element's own.

import { useState } from 'react';
import type { ElementEditDraft } from './elementEditDraft';

/** The property a list is previewing an option of, and what it had before. */
export interface PickerHover {
  element: ElementEditDraft['element'];
  property: string;
  /** The property's own preview before the hover; undefined when it had none. */
  before: string | undefined;
  /** What the field showed before the hover. */
  face: string;
}

export interface PickPreviewInputs {
  draft: ElementEditDraft;
  /** What the guest last reported for each property. */
  computed: Readonly<Record<string, string>>;
  readOnly: boolean;
  onPreview: (property: string, value: string) => void;
  onRevert: (property: string) => void;
  onCommit: () => void;
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
  // A hover on another element, or another revision of it, is over.
  const held = hover?.element === draft.element ? hover : null;
  const own = (property: string): string =>
    Object.hasOwn(draft.values, property)
      ? (draft.values[property] ?? '')
      : (computed[property] ?? '');
  return {
    /** A property's value as the panel shows it: its preview, else what the guest computed. */
    value: (property: string): string => (held?.property === property ? held.face : own(property)),
    previewed: (property: string): boolean =>
      held?.property === property
        ? held.before !== undefined
        : Object.hasOwn(draft.values, property),
    /** A pick from a segment, option or token: previews the value and commits at once. */
    pick: (property: string) => (next: string) => {
      if (readOnly) return;
      setHover(null);
      onPreview(property, next);
      onCommit();
    },
    /** The option a list rests on, previewed; null puts back what was there. */
    hover: (property: string) => (next: string | null) => {
      if (next === null) {
        if (held?.property !== property) return;
        setHover(null);
        if (held.before === undefined) onRevert(property);
        else onPreview(property, held.before);
        return;
      }
      if (readOnly) return;
      if (held?.property !== property) {
        const before = Object.hasOwn(draft.values, property) ? draft.values[property] : undefined;
        setHover({ element: draft.element, property, before, face: own(property) });
      }
      onPreview(property, next);
    },
  };
}
