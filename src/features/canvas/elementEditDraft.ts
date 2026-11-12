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
  /**
   * What the element drew for each previewed property before its first
   * preview, which a blur's preview keeps the rest of the filter from.
   */
  drawn: Readonly<Record<string, string>>;
  /** The previewed text, or null while the element shows its own. */
  text: string | null;
  /** A path's moved data, which commits as it is previewed; null while it draws its own. */
  d: string | null;
  /**
   * The one commit awaiting its reply and what it carries; each edit moves the
   * revision on, to the one its reply names.
   */
  pending: {
    mutationId: string;
    change: 'style' | 'text' | 'path';
    revisionId: string | null;
  } | null;
}

export function editDraft(
  canvasId: string,
  element: ElementRef,
  site: SourceElement,
): ElementEditDraft {
  return { canvasId, element, site, values: {}, drawn: {}, text: null, d: null, pending: null };
}

/** Something typed or picked here is not saved yet. */
export function hasPreviews(draft: ElementEditDraft): boolean {
  return draft.text !== null || draft.d !== null || Object.keys(draft.values).length > 0;
}

/**
 * Previews `value` for `property`, which the element draws as `drawn` now. A
 * property outside the edit whitelist cannot be previewed, so it is ignored.
 */
export function previewStyle(
  draft: ElementEditDraft,
  property: string,
  value: string,
  drawn: string,
): ElementEditDraft {
  if (!STYLE_PROPERTIES.includes(property)) return draft;
  return {
    ...draft,
    values: { ...draft.values, [property]: value },
    // Once previewed, the element draws the preview, which is not its own.
    drawn: Object.hasOwn(draft.drawn, property)
      ? draft.drawn
      : { ...draft.drawn, [property]: drawn },
  };
}

/** Takes one property's preview back, leaving the element as its revision draws it. */
export function revertStyle(draft: ElementEditDraft, property: string): ElementEditDraft {
  if (!Object.hasOwn(draft.values, property)) return draft;
  return {
    ...draft,
    values: without(draft.values, property),
    drawn: without(draft.drawn, property),
  };
}

function without(record: Readonly<Record<string, string>>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));
}

const BLUR_PROPERTIES = new Set(['filter', 'backdropFilter']);
const BLUR_FUNCTION = /(?:^|\s)blur\([^()]*\)/g;

/** The CSS the guest draws each previewed property with. */
export function previewedStyles(draft: ElementEditDraft): Record<string, string> {
  return Object.fromEntries(
    Object.entries(draft.values).map(([property, value]) => [
      property,
      previewValue(property, value, draft.drawn[property] ?? ''),
    ]),
  );
}

/**
 * A picked kit token, or a list of them, is named by the edit but drawn
 * through var(), as the class it saves as is. A blur's class sets one function
 * of a filter the element's other classes compose, so its preview keeps the
 * rest of what the element drew in order: the blur takes the drawn one's
 * place, or leads as Tailwind composes it, and None takes only the blur.
 */
function previewValue(property: string, value: string, drawn: string): string {
  const css = value.startsWith('--')
    ? value
        .split(',')
        .map((name) => `var(${name.trim()})`)
        .join(', ')
    : value;
  if (!BLUR_PROPERTIES.has(property)) return css;
  const rest = drawn.trim() === 'none' ? '' : drawn;
  const blurs = rest.match(BLUR_FUNCTION) ?? [];
  // Two blurs are no one step to replace, and the writer refuses them.
  if (blurs.length > 1) return drawn;
  let blur = '';
  if (value.startsWith('--')) blur = `blur(${css})`;
  else if (value !== 'none') blur = value;
  const filter = blurs.length === 1 ? rest.replace(BLUR_FUNCTION, ` ${blur}`) : `${blur} ${rest}`;
  return filter.replace(/\s+/g, ' ').trim() || 'none';
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
    draft: { ...draft, pending: { mutationId, change: 'style', revisionId: null } },
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
    draft: { ...draft, pending: { mutationId, change: 'text', revisionId: null } },
    input: {
      mutationId,
      edit: { element: draft.element, change: { kind: 'text', value: draft.text } },
    },
  };
}

/**
 * The edit that writes `d`, a moved path's data, as the path's own. It
 * previews from the moment it is sent, so the path holds still while it saves;
 * null while another commit is pending.
 */
export function commitPath(
  draft: ElementEditDraft,
  mutationId: string,
  d: string,
): { draft: ElementEditDraft; input: EditElementInput } | null {
  if (draft.pending !== null) return null;
  return {
    draft: { ...draft, d, pending: { mutationId, change: 'path', revisionId: null } },
    input: { mutationId, edit: { element: draft.element, change: { kind: 'path', d } } },
  };
}

export type CommitOutcome = { status: 'edited'; revisionId: string } | { status: 'refused' };

/**
 * Settles the pending commit; a reply for any other mutation changes nothing.
 * An edit that made a new revision stays pending, now naming it, until
 * `followRevision` moves the draft onto it, so nothing is committed against
 * the revision it replaced.
 */
export function settleCommit(
  draft: ElementEditDraft | null,
  mutationId: string,
  outcome: CommitOutcome,
): ElementEditDraft | null {
  if (draft?.pending?.mutationId !== mutationId) return draft;
  if (outcome.status === 'refused') return null;
  if (outcome.revisionId === draft.element.revisionId) return { ...draft, pending: null };
  return { ...draft, pending: { ...draft.pending, revisionId: outcome.revisionId } };
}

/**
 * The draft once its frame has moved on. While the newer revision builds, the
 * older one is still on show and the draft stays on it. Once it has built, the
 * selection moves to the element written at the same place. The previews its
 * own commit carried are dropped because the source now says what they said;
 * the other kinds' stay only on the revision that commit made. When
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
    const committed =
      draft.pending?.revisionId === build.revisionId ? draft.pending.change : undefined;
    const keeps = (change: 'style' | 'text') => committed !== undefined && committed !== change;
    return {
      ...draft,
      element: { ...draft.element, revisionId: build.revisionId, elementId: site.elementId },
      site,
      values: keeps('style') ? draft.values : {},
      drawn: keeps('style') ? draft.drawn : {},
      text: keeps('text') ? draft.text : null,
      // A path's data is only ever previewed while its own commit saves.
      d: null,
      pending: null,
    };
  }
  if (build.status === 'pending' || build.status === 'building') return draft;
  return build.revisionId === frame.revisionId ? null : draft;
}
