// What a direct edit has previewed on one selected element but not yet
// committed. A preview only means something against the revision it was drawn
// on, so a refused commit drops the draft, and a newer revision of the design
// takes the selection along without the previews it made stale.

import type { EditElementInput } from './elementEditProtocol';
import type { CanvasFrame, ElementRef, SourceElement } from './protocol';
import { STYLE_PROPERTIES } from './styleProperties';

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
  /** The previewed text, or null while the element shows its own. */
  text: string | null;
  /**
   * The one commit awaiting its reply and what it carries; each edit moves the
   * revision on.
   */
  pending: { mutationId: string; change: 'style' | 'text' } | null;
}

export function editDraft(
  canvasId: string,
  element: ElementRef,
  site: SourceElement,
): ElementEditDraft {
  return { canvasId, element, site, values: {}, text: null, pending: null };
}

/** Something typed or picked here is not saved yet. */
export function hasPreviews(draft: ElementEditDraft): boolean {
  return draft.text !== null || Object.keys(draft.values).length > 0;
}

/** A property outside the edit whitelist cannot be previewed, so it is ignored. */
export function previewStyle(
  draft: ElementEditDraft,
  property: string,
  value: string,
): ElementEditDraft {
  if (!STYLE_PROPERTIES.includes(property)) return draft;
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

export function previewText(draft: ElementEditDraft, text: string): ElementEditDraft {
  return { ...draft, text };
}

export function revertText(draft: ElementEditDraft): ElementEditDraft {
  return draft.text === null ? draft : { ...draft, text: null };
}

/**
 * The one edit that commits every previewed property, so they make one
 * revision; null while another commit is pending or nothing is previewed.
 */
export function commitStyles(
  draft: ElementEditDraft,
  mutationId: string,
): { draft: ElementEditDraft; input: EditElementInput } | null {
  const styles = Object.entries(draft.values).map(([property, value]) => ({
    property,
    // The sidecar's grammar reads values lowercase and single-spaced.
    value: value.trim().toLowerCase().replace(/\s+/g, ' '),
  }));
  if (draft.pending !== null || styles.length === 0) return null;
  return {
    draft: { ...draft, pending: { mutationId, change: 'style' } },
    input: { mutationId, edit: { element: draft.element, change: { kind: 'style', styles } } },
  };
}

/**
 * The edit that writes the previewed text as the element's own. Text is a
 * separate edit from styles, so each commits apart from the other's previews.
 */
export function commitText(
  draft: ElementEditDraft,
  mutationId: string,
): { draft: ElementEditDraft; input: EditElementInput } | null {
  if (draft.pending !== null || draft.text === null) return null;
  return {
    draft: { ...draft, pending: { mutationId, change: 'text' } },
    input: {
      mutationId,
      edit: { element: draft.element, change: { kind: 'text', value: draft.text } },
    },
  };
}

export type CommitOutcome = { status: 'edited'; revisionId: string } | { status: 'refused' };

/**
 * Settles the pending commit; a reply for any other mutation changes nothing.
 * An edit that made a new revision stays pending until `followRevision` moves
 * the draft onto it, so nothing is committed against the revision it replaced.
 */
export function settleCommit(
  draft: ElementEditDraft | null,
  mutationId: string,
  outcome: CommitOutcome,
): ElementEditDraft | null {
  if (draft?.pending?.mutationId !== mutationId) return draft;
  if (outcome.status === 'refused') return null;
  return outcome.revisionId === draft.element.revisionId ? { ...draft, pending: null } : draft;
}

/**
 * The draft once its frame has moved on. While the newer revision builds, the
 * older one is still on show and the draft stays on it. Once it has built, the
 * selection moves to the element written at the same place. The previews its
 * own commit carried are dropped because the source now says what they said;
 * the other kind's stay, unless a revision it did not make arrived. When
 * nothing is written there any more, or the revision did not build, the draft
 * goes.
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
    const committed = draft.pending?.change;
    return {
      ...draft,
      element: { ...draft.element, revisionId: build.revisionId, elementId: site.elementId },
      site,
      values: committed === 'text' ? draft.values : {},
      text: committed === 'style' ? draft.text : null,
      pending: null,
    };
  }
  if (build.status === 'pending' || build.status === 'building') return draft;
  return build.revisionId === frame.revisionId ? null : draft;
}
