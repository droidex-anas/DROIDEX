// Variants (spec §4, §9): sibling frames seeded from one pinned revision of a
// source frame, and the plain request that asks the chat's agent to rework
// them. The frames are reserved first so the request can pin them.

import type { CanvasFrame, CreateFramesInput, DesignSystemRef, RevisionRef } from './protocol';
import { MAX_FRAME_NAME_LENGTH } from './wireValidation';

export type VariantKind = 'layout' | 'style' | 'colour';

/** One create request carries at most this many frames. */
export const MAX_VARIANTS = 4;

export interface VariantChoice {
  kind: VariantKind;
  count: number;
  /** The user's own words about what to change; empty when they gave none. */
  direction: string;
}

/** The source frame as it was when the user asked, so a later build cannot retarget it. */
export interface VariantSource {
  canvasId: string;
  revision: RevisionRef;
  name: string;
  width: number;
  height: number;
  designSystem: DesignSystemRef;
}

/** What Make variants starts from, or null for a frame with no source yet. */
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

const CHANGE: Record<VariantKind, string> = {
  layout: 'layout',
  style: 'visual style',
  colour: 'colour palette',
};

export function variantFrames(
  source: VariantSource,
  choice: VariantChoice,
  mutationId: string,
): CreateFramesInput {
  return {
    mutationId,
    placeBeside: { designId: source.revision.designId },
    frames: Array.from({ length: choice.count }, (_, index) => ({
      name: variantName(source.name, choice.kind, index + 1),
      width: source.width,
      height: source.height,
      designSystem: { ...source.designSystem },
      seed: { kind: 'revision', canvasId: source.canvasId, revision: { ...source.revision } },
    })),
  };
}

function variantName(sourceName: string, kind: VariantKind, ordinal: number): string {
  const suffix = ` · ${kind} ${String(ordinal)}`;
  return sourceName.slice(0, MAX_FRAME_NAME_LENGTH - suffix.length).trimEnd() + suffix;
}

/** What the user asks for, in their words; the pinned variants say which frames. */
export function variantPrompt(sourceName: string, choice: VariantChoice): string {
  const direction = choice.direction.replace(/\s+/g, ' ').trim();
  const change = CHANGE[choice.kind];
  const ask =
    choice.count === 1
      ? `Make a ${choice.kind} variant of ${sourceName}`
      : `Make ${String(choice.count)} ${choice.kind} variants of ${sourceName}`;
  const targets =
    choice.count === 1
      ? `The pinned frame starts as a copy of ${sourceName}; give it a different ${change}`
      : `Each pinned frame starts as a copy of ${sourceName}; give each a different ${change}`;
  return `${direction ? `${ask}: ${direction}` : `${ask}.`}\n${targets} and leave ${sourceName} as it is.`;
}
