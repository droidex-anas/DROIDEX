// Variants (spec §4, §9): sibling frames seeded from one pinned revision of a
// source frame, and the plain request that asks the chat's agent to rework
// them. The frames are reserved first so the request can pin them.

import { elementName } from './elementPins';
import type { PickedElement } from './pickedElement';
import type { CanvasFrame, CreateFramesInput, DesignSystemRef, RevisionRef } from './protocol';
import { MAX_FRAME_NAME_LENGTH } from './wireValidation';

/** What changes; `explore` may leave the kit and the project's look behind. */
export type VariantKind = 'any' | 'layout' | 'style' | 'colour' | 'explore';

/** How many variants one request makes; the sidecar creates at most four frames at once. */
export type VariantCount = 2 | 3 | 4;

export interface VariantChoice {
  kind: VariantKind;
  count: VariantCount;
  /** The user's own words about what to change, sent as typed; empty when they gave none. */
  direction: string;
}

/** What one click on Variants asks for. */
export const DEFAULT_VARIANT_CHOICE: VariantChoice = { kind: 'any', count: 3, direction: '' };

/** The source frame as it was when the user asked, so a later build cannot retarget it. */
export interface VariantSource {
  canvasId: string;
  revision: RevisionRef;
  name: string;
  width: number;
  height: number;
  designSystem: DesignSystemRef;
}

/** What variants start from, or null for a frame with no source yet. */
export function variantSource(canvasId: string, frame: CanvasFrame): VariantSource | null {
  if (!frame.revisionId) return null;
  const { width, height } = frame.rect;
  return {
    canvasId,
    revision: { designId: frame.designId, revisionId: frame.revisionId },
    name: frame.name,
    width,
    height,
    designSystem: frame.designSystem,
  };
}

/** How the request names each kind, and what it asks of each variant. */
const ASK: Record<VariantKind, { label: string; change: string }> = {
  any: {
    label: '',
    change:
      'a different take on it within the current design system (layout, visual style or colour)',
  },
  layout: { label: 'layout ', change: 'a different layout' },
  style: { label: 'style ', change: 'a different visual style' },
  colour: { label: 'colour ', change: 'a different colour palette' },
  explore: { label: 'exploratory ', change: 'a clearly different visual direction' },
};
const EXPLORE_FREELY =
  'Explore freely: the variants need not follow the current design system or the project’s look, ' +
  'but keep their code clean and their colours, type and spacing in tokens.';

/**
 * Copies of the source named "Name (Variant N)", numbered after the variants
 * of that name already on the board so a second set does not repeat the first.
 */
export function variantFrames(
  source: VariantSource,
  count: VariantCount,
  mutationId: string,
  boardNames: readonly string[],
): CreateFramesInput {
  const first = nextVariantNumber(source.name, boardNames);
  return {
    mutationId,
    placeBeside: { designId: source.revision.designId },
    frames: Array.from({ length: count }, (_, index) => ({
      name: variantName(source.name, first + index),
      width: source.width,
      height: source.height,
      designSystem: { ...source.designSystem },
      seed: { kind: 'revision', canvasId: source.canvasId, revision: { ...source.revision } },
      variantOf: source.revision.designId,
    })),
  };
}

const VARIANT_SUFFIX = / \(Variant (\d+)\)$/;

function variantName(sourceName: string, number: number): string {
  const suffix = ` (Variant ${String(number)})`;
  return sourceName.slice(0, MAX_FRAME_NAME_LENGTH - suffix.length).trimEnd() + suffix;
}

/** A frame name and its " (Variant N)" suffix, which a shortened label keeps whole. */
export function splitVariantName(name: string): { base: string; suffix: string } {
  const match = VARIANT_SUFFIX.exec(name);
  if (!match) return { base: name, suffix: '' };
  return { base: name.slice(0, match.index), suffix: match[0] };
}

function nextVariantNumber(sourceName: string, boardNames: readonly string[]): number {
  let highest = 0;
  for (const name of boardNames) {
    const number = Number(VARIANT_SUFFIX.exec(name)?.[1]);
    if (number > highest && variantName(sourceName, number) === name) highest = number;
  }
  return highest + 1;
}

/** What the user asks for, in their words; the pinned variants say which frames. */
export function variantPrompt(sourceName: string, choice: VariantChoice): string {
  return request(
    sourceName,
    choice,
    `Each pinned frame starts as a copy of ${sourceName}; give each ${ASK[choice.kind].change}, ` +
      `distinct from the others, and leave ${sourceName} as it is.`,
  );
}

/**
 * The same request for elements picked in the source: each variant changes
 * only them. Their element IDs belong to the source's revision, so the request
 * finds them by where they are written, which every copy shares.
 */
export function elementVariantPrompt(
  sourceName: string,
  picks: readonly PickedElement[],
  choice: VariantChoice,
): string {
  const source = `${sourceName}’s source`;
  const [first] = picks;
  const one = picks.length === 1;
  const subject = one
    ? pickName(first)
    : PICK_LIST.format(picks.map((pick) => `${pickName(pick)} (${pickPlace(pick)})`));
  return request(
    `${subject} in ${sourceName}`,
    choice,
    `Each pinned frame starts as a copy of ${sourceName}. In each, change only ` +
      `${one ? `that element (${pickPlace(first)} of ${source}` : `those elements (at those lines of ${source}`}, ` +
      `the same lines in every copy) to ${ASK[choice.kind].change}, distinct from the others, ` +
      `and leave everything else and ${sourceName} itself as they are.`,
  );
}

const PICK_LIST = new Intl.ListFormat('en', { type: 'conjunction' });

function pickPlace({ source }: PickedElement): string {
  return `${source.file} line ${String(source.line)}`;
}

function request(subject: string, choice: VariantChoice, instruction: string): string {
  const direction = choice.direction.trim();
  const ask = `Make ${String(choice.count)} ${ASK[choice.kind].label}variants of ${subject}`;
  const lines = [direction ? `${ask}: ${direction}` : `${ask}.`, instruction];
  if (choice.kind === 'explore') lines.push(EXPLORE_FREELY);
  return lines.join('\n');
}

/** A pick as the request names it: its component or tag, and any words it spans. */
function pickName(element: PickedElement): string {
  const words = element.text?.excerpt.replace(/\s+/g, ' ').trim();
  return words ? `${elementName(element)} “${words}”` : elementName(element);
}
