// Variants (spec §4, §9): sibling frames seeded from one pinned revision of a
// source frame, and the plain request that asks the chat's agent to rework
// them. The frames are reserved first so the request can pin them.

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
    })),
  };
}

function variantName(sourceName: string, number: number): string {
  const suffix = ` (Variant ${String(number)})`;
  return sourceName.slice(0, MAX_FRAME_NAME_LENGTH - suffix.length).trimEnd() + suffix;
}

function nextVariantNumber(sourceName: string, boardNames: readonly string[]): number {
  let highest = 0;
  for (const name of boardNames) {
    const number = Number(/ \(Variant (\d+)\)$/.exec(name)?.[1]);
    if (number > highest && variantName(sourceName, number) === name) highest = number;
  }
  return highest + 1;
}

/** What the user asks for, in their words; the pinned variants say which frames. */
export function variantPrompt(sourceName: string, choice: VariantChoice): string {
  const { label, change } = ASK[choice.kind];
  const direction = choice.direction.trim();
  const ask = `Make ${String(choice.count)} ${label}variants of ${sourceName}`;
  const lines = [
    direction ? `${ask}: ${direction}` : `${ask}.`,
    `Each pinned frame starts as a copy of ${sourceName}; give each ${change}, ` +
      `distinct from the others, and leave ${sourceName} as it is.`,
  ];
  if (choice.kind === 'explore') lines.push(EXPLORE_FREELY);
  return lines.join('\n');
}
