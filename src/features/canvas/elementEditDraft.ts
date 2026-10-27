// What a direct edit has previewed on one selected element but not yet
// committed. A preview only means something against the revision it was drawn
// on, so a refused commit, or a newer revision of the design, drops the draft.

import type { EditElementInput, StyleChange } from './elementEditProtocol';
import type { ElementRef } from './protocol';
import { styleKind } from './styleProperties';

export interface ElementEditDraft {
  canvasId: string;
  element: ElementRef;
  /** Previewed values by style property, as the user entered them. */
  values: Readonly<Record<string, string>>;
  /** The one commit awaiting its reply; each edit moves the revision on. */
  pendingMutationId: string | null;
}

export function editDraft(canvasId: string, element: ElementRef): ElementEditDraft {
  return { canvasId, element, values: {}, pendingMutationId: null };
}

/** A property outside the edit whitelist cannot be previewed, so it is ignored. */
export function previewStyle(
  draft: ElementEditDraft,
  property: string,
  value: string,
): ElementEditDraft {
  if (styleKind(property) === null) return draft;
  return { ...draft, values: { ...draft.values, [property]: value } };
}

/** The edit that commits one previewed property, or null while another commit is pending. */
export function commitStyle(
  draft: ElementEditDraft,
  property: string,
  mutationId: string,
): { draft: ElementEditDraft; input: EditElementInput } | null {
  const kind = styleKind(property);
  if (draft.pendingMutationId !== null || kind === null || !Object.hasOwn(draft.values, property))
    return null;
  const change: StyleChange = { kind, property, value: draft.values[property] };
  return {
    draft: { ...draft, pendingMutationId: mutationId },
    input: { mutationId, edit: { element: draft.element, change } },
  };
}

/** Settles the pending commit; a reply for any other mutation changes nothing. */
export function settleCommit(
  draft: ElementEditDraft | null,
  mutationId: string,
  outcome: 'edited' | 'refused',
): ElementEditDraft | null {
  if (draft?.pendingMutationId !== mutationId) return draft;
  return outcome === 'edited' ? { ...draft, pendingMutationId: null } : null;
}

export function afterRevision(
  draft: ElementEditDraft | null,
  designId: string,
  revisionId: string | null,
): ElementEditDraft | null {
  if (draft?.element.designId !== designId) return draft;
  return draft.element.revisionId === revisionId ? draft : null;
}
