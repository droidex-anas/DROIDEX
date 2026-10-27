// What a direct edit has previewed on one selected element but not yet
// committed. A preview only means something against the revision it was drawn
// on, so a refused commit drops the draft, and a newer revision of the design
// takes the selection along without its previews.

import type { EditElementInput, StyleChange } from './elementEditProtocol';
import type { CanvasFrame, ElementRef, SourceElement } from './protocol';
import { styleKind } from './styleProperties';

export interface ElementEditDraft {
  canvasId: string;
  element: ElementRef;
  /**
   * Where the element is written, as its revision's element map says. An
   * element ID only lives within one revision, so this is how the selection
   * finds the same element in the next one.
   */
  site: SourceElement;
  /** Previewed values by style property, as the user entered them. */
  values: Readonly<Record<string, string>>;
  /** The one commit awaiting its reply; each edit moves the revision on. */
  pendingMutationId: string | null;
}

export function editDraft(
  canvasId: string,
  element: ElementRef,
  site: SourceElement,
): ElementEditDraft {
  return { canvasId, element, site, values: {}, pendingMutationId: null };
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

/** Takes one property's preview back, leaving the element as its revision draws it. */
export function revertStyle(draft: ElementEditDraft, property: string): ElementEditDraft {
  if (!Object.hasOwn(draft.values, property)) return draft;
  const values = Object.fromEntries(
    Object.entries(draft.values).filter(([previewed]) => previewed !== property),
  );
  return { ...draft, values };
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
  const change: StyleChange = {
    kind,
    property,
    value: canonicalValue(property, draft.values[property]),
  };
  return {
    draft: { ...draft, pendingMutationId: mutationId },
    input: { mutationId, edit: { element: draft.element, change } },
  };
}

/**
 * The value as the sidecar's grammar reads it: lowercase, single-spaced, and a
 * bare zero length as `0px`, which is what a kit's zero token holds.
 */
function canonicalValue(property: string, value: string): string {
  const canonical = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return canonical === '0' && isLength(property) ? '0px' : canonical;
}

function isLength(property: string): boolean {
  const kind = styleKind(property);
  return (
    kind === 'spacing' || kind === 'size' || property === 'fontSize' || property === 'letterSpacing'
  );
}

/**
 * Settles the pending commit; a reply for any other mutation changes nothing.
 * An edit that made a new revision stays pending until `followRevision` moves
 * the draft onto it, so nothing is committed against the revision it replaced.
 */
export function settleCommit(
  draft: ElementEditDraft | null,
  mutationId: string,
  outcome: { status: 'edited'; revisionId: string } | { status: 'refused' },
): ElementEditDraft | null {
  if (draft?.pendingMutationId !== mutationId) return draft;
  if (outcome.status === 'refused') return null;
  return outcome.revisionId === draft.element.revisionId
    ? { ...draft, pendingMutationId: null }
    : draft;
}

/**
 * The draft once its frame has moved on. While the newer revision builds, the
 * older one is still on show and the draft stays on it. Once it has built, the
 * selection moves to the element written at the same place, with the previews
 * dropped because the source now says what they said; when nothing is written
 * there any more, or the revision did not build, the draft goes.
 */
export function followRevision(
  draft: ElementEditDraft | null,
  frame: CanvasFrame,
): ElementEditDraft | null {
  if (draft?.element.designId !== frame.designId) return draft;
  if (frame.revisionId === draft.element.revisionId) return draft;
  const { build } = frame;
  if (build.status === 'ready' && build.revisionId === frame.revisionId) {
    const site = build.elements.find(
      (element) =>
        element.file === draft.site.file &&
        element.start === draft.site.start &&
        element.tagName === draft.site.tagName,
    );
    if (!site) return null;
    return {
      ...draft,
      element: { ...draft.element, revisionId: build.revisionId, elementId: site.elementId },
      site,
      values: {},
      pendingMutationId: null,
    };
  }
  if (build.status === 'pending' || build.status === 'building') return draft;
  return build.revisionId === frame.revisionId ? null : draft;
}
