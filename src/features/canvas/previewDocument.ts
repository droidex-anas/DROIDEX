// The renderer's half of the preview pull channel (spec §6).
//
// There is no guest preload: the board drives a preview through the webview
// element's `executeJavaScript`, with exactly the seven audited literals below.
// Every payload is a JSON-serialised argument to a fixed string, so nothing the
// sidecar or a design produced is ever interpolated as code.
//
// What comes back is untrusted. A snapshot is accepted only when it echoes the
// instance this board started and carries nothing outside the bounded event
// shapes below; the intermediate in `electron/canvasPreview.cjs` enforces the
// same caps on the way in.

import type { CanvasDiagnostic, FrameRect } from './protocol';

/** Events one snapshot may carry, matching the intermediate's queue cap. */
export const MAX_PREVIEW_SNAPSHOT_EVENTS = 64;
const MAX_PREVIEW_DIAGNOSTICS = 8;
const MAX_PREVIEW_TEXT = 512;
/** Style properties one selection command may name, as the intermediate caps them. */
const MAX_PREVIEW_STYLE_PROPERTIES = 64;
/** Bytes one queued event may measure, as the intermediate accepts it. */
const MAX_PREVIEW_EVENT_BYTES = 4096;
/** Bytes a selection may measure: the intermediate gives it its own cap and keeps only one. */
const MAX_PREVIEW_SELECTION_BYTES = 16384;
/** The queue cap times the largest event, plus the one selection the guest keeps, with headroom. */
const MAX_PREVIEW_SNAPSHOT_BYTES =
  MAX_PREVIEW_SNAPSHOT_EVENTS * MAX_PREVIEW_EVENT_BYTES + MAX_PREVIEW_SELECTION_BYTES + 1024;

/** One live preview's identity, minted by the board and echoed by the guest. */
export interface PreviewInstance {
  /**
   * Correlates this instance's messages. Code inside the preview can read it, so
   * it is not an authorization boundary (spec §6).
   */
  nonce: string;
  designId: string;
  revisionId: string;
  generation: number;
}

/**
 * The element a preview has selected, as its guest reports it: the source
 * marker, the path from the document body that tells repeated instances apart,
 * its box in the design's own pixels and the computed values of the style
 * properties the board asked for. Display data and a selection hint only.
 */
export interface PreviewElement {
  elementId: string;
  instancePath: string;
  rect: FrameRect;
  styles: Record<string, string>;
  /**
   * Its text when that is all it holds and fits the cap, else null. Never cut,
   * since what the board shows here it may write back as the whole text.
   */
  text: string | null;
  /** Its parent's computed `display`, which decides whether it is a flex or grid item. */
  parentDisplay: string;
}

/** Whether the guest draws the element at all; one it does not, as under `display: none`, measures 0 × 0 at the origin. */
export function isDrawn(rect: FrameRect): boolean {
  return rect.x !== 0 || rect.y !== 0 || rect.width !== 0 || rect.height !== 0;
}

/** The element under the pointer, which the board outlines and names before it is picked. */
export interface PreviewHover {
  elementId: string;
  instancePath: string;
  rect: FrameRect;
  tagName: string;
  /**
   * How far its box can grow up and down, across its width, before it meets
   * other content, in the design's pixels; null where nothing is in the way.
   */
  room: { above: number | null; below: number | null };
}

/** The text between two points in the design's pixels, from where a press went down. */
export interface PreviewTextRange {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** What a probe asks about: the element at a point, or the text between two points. */
export type PreviewProbe = { at: { x: number; y: number } } | PreviewTextRange;

/**
 * What a probe found, in the design's own pixels: the marked element and its
 * box, and for two points the text between them, cut to the text cap, with the
 * box it is drawn in. A probe selects nothing.
 */
export interface PreviewFinding {
  elementId: string;
  instancePath: string;
  rect: FrameRect;
  text: { excerpt: string; rect: FrameRect } | null;
}

/**
 * Everything a preview may report; nothing produces `interaction` yet. A
 * `selection` echoes the sequence number of the pick or select it answers.
 */
export type PreviewEvent =
  | { event: 'ready' }
  | { event: 'resize'; width: number; height: number }
  | { event: 'diagnostics'; diagnostics: CanvasDiagnostic[] }
  | { event: 'selection'; sequence: number; element: PreviewElement | null }
  | { event: 'interaction'; kind: string };

/** A pick at a point in the design's own pixels, or a keyboard step through its elements. */
export type PreviewPick = { x: number; y: number } | { step: 'first' | 'next' | 'previous' };

/** An element to select by its marker and path, with the inline styles and text it previews. */
export interface PreviewTarget {
  elementId: string;
  instancePath: string;
  styles: Record<string, string>;
  text: string | null;
}

/** One drained queue, with how many messages the guest dropped under its cap. */
export interface PreviewSnapshot {
  events: PreviewEvent[];
  dropped: number;
}

/** A fresh instance nonce. 32 hex characters, the charset the guest accepts. */
export function previewNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Hands the guest its identity and the artifact document to mount. */
export function previewStartScript(instance: PreviewInstance, html: string): string {
  return `globalThis.__droidexCanvasPreview.start(${jsonArgument({ ...instance, html })})`;
}

/** What the guest answers a start with when it installed this instance. */
export const PREVIEW_STARTED = 'started';

/** Drains the guest's bounded queue and answers with one JSON snapshot. */
export const PREVIEW_POLL_SCRIPT = 'globalThis.__droidexCanvasPreview.drain()';

/**
 * Selects the element under a point or the next one along; a `selection` event
 * carrying `sequence` answers.
 */
export function previewPickScript(
  pick: PreviewPick,
  properties: readonly string[],
  sequence: number,
): string {
  return `globalThis.__droidexCanvasPreview.pick(${jsonArgument({ ...pick, properties, sequence })})`;
}

/**
 * Selects one named element, or none, and previews its styles; a `selection`
 * event carrying `sequence` answers.
 */
export function previewSelectScript(
  target: PreviewTarget | null,
  properties: readonly string[],
  sequence: number,
): string {
  return `globalThis.__droidexCanvasPreview.select(${jsonArgument({ target, properties, sequence })})`;
}

/** Asks which element is under a point in the design's pixels; the call itself answers. */
export function previewHoverScript(at: { x: number; y: number }): string {
  return `globalThis.__droidexCanvasPreview.hover(${jsonArgument({ x: at.x, y: at.y })})`;
}

/** Asks what is at a point or between two points in the design's pixels; the call itself answers. */
export function previewProbeScript(probe: PreviewProbe): string {
  return `globalThis.__droidexCanvasPreview.probe(${jsonArgument(probe)})`;
}

/**
 * Sets a kit's draft token values on the design's root, replacing the set this
 * guest was given before; an empty set puts the saved values back.
 */
export function previewSetTokensScript(tokens: Readonly<Record<string, string>>): string {
  return `globalThis.__droidexCanvasPreview.setTokens(${jsonArgument({ tokens })})`;
}

/**
 * A JSON literal that is also a safe JS expression: escaping `<` means no
 * artifact can close an element or open a tag wherever the code is placed.
 */
function jsonArgument(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/**
 * The snapshot a poll returned, or null when it is not this instance's. A
 * refused snapshot means the guest is no longer the one this board started, so
 * the caller ends it rather than guessing.
 */
export function readPreviewSnapshot(
  value: unknown,
  instance: PreviewInstance,
): PreviewSnapshot | null {
  // Bytes, not code units: a snapshot of astral characters is four times its
  // length, and this cap is named in bytes.
  if (typeof value !== 'string' || utf8Bytes(value) > MAX_PREVIEW_SNAPSHOT_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!record(parsed)) return null;
  if (
    parsed.nonce !== instance.nonce ||
    parsed.designId !== instance.designId ||
    parsed.revisionId !== instance.revisionId ||
    parsed.generation !== instance.generation
  ) {
    return null;
  }
  if (!count(parsed.dropped)) return null;
  if (!Array.isArray(parsed.events) || parsed.events.length > MAX_PREVIEW_SNAPSHOT_EVENTS)
    return null;
  const events: PreviewEvent[] = [];
  for (const candidate of parsed.events) {
    const event = readEvent(candidate);
    if (!event) return null;
    events.push(event);
  }
  return { events, dropped: parsed.dropped };
}

function readEvent(value: unknown): PreviewEvent | null {
  if (!record(value)) return null;
  switch (value.event) {
    case 'ready':
      return { event: 'ready' };
    case 'resize':
      return count(value.width) && count(value.height)
        ? { event: 'resize', width: value.width, height: value.height }
        : null;
    case 'diagnostics':
      return readDiagnostics(value.diagnostics);
    case 'selection':
      return readSelection(value);
    case 'interaction':
      return present(value.kind)
        ? { event: 'interaction', kind: clampPreviewText(value.kind) }
        : null;
    default:
      return null;
  }
}

function readDiagnostics(value: unknown): PreviewEvent | null {
  if (!Array.isArray(value) || value.length > MAX_PREVIEW_DIAGNOSTICS) return null;
  const diagnostics: CanvasDiagnostic[] = [];
  for (const entry of value) {
    if (!record(entry) || !present(entry.code) || typeof entry.message !== 'string') return null;
    diagnostics.push({
      code: clampPreviewText(entry.code),
      message: clampPreviewText(entry.message),
    });
  }
  return { event: 'diagnostics', diagnostics };
}

/** A hover's answer, or null when nothing marked is under the point or the answer is not one. */
export function readPreviewHover(value: unknown): PreviewHover | null {
  const parsed = readAnswer(value);
  if (!record(parsed) || !present(parsed.elementId) || !present(parsed.tagName)) return null;
  const rect = readRect(parsed.rect);
  if (!rect || typeof parsed.instancePath !== 'string' || !record(parsed.room)) return null;
  const { above, below } = parsed.room;
  if (!isRoom(above) || !isRoom(below)) return null;
  return {
    elementId: clampPreviewText(parsed.elementId),
    instancePath: clampPreviewText(parsed.instancePath),
    rect,
    tagName: clampPreviewText(parsed.tagName),
    room: { above, below },
  };
}

/** A probe's answer, or null when nothing marked is there or the answer is not one. */
export function readPreviewFinding(value: unknown): PreviewFinding | null {
  const parsed = readAnswer(value);
  if (!record(parsed) || !present(parsed.elementId) || typeof parsed.instancePath !== 'string')
    return null;
  const rect = readRect(parsed.rect);
  if (!rect) return null;
  let text: PreviewFinding['text'] = null;
  if (parsed.text !== null) {
    if (!record(parsed.text) || typeof parsed.text.excerpt !== 'string') return null;
    const textRect = readRect(parsed.text.rect);
    if (!textRect) return null;
    text = { excerpt: clampPreviewText(parsed.text.excerpt), rect: textRect };
  }
  return {
    elementId: clampPreviewText(parsed.elementId),
    instancePath: clampPreviewText(parsed.instancePath),
    rect,
    text,
  };
}

/** A direct answer's JSON, within one event's cap, or undefined. */
function readAnswer(value: unknown): unknown {
  if (typeof value !== 'string' || utf8Bytes(value) > MAX_PREVIEW_EVENT_BYTES) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRoom(value: unknown): value is number | null {
  return value === null || (finite(value) && value >= 0);
}

function readSelection({ sequence, element }: Record<string, unknown>): PreviewEvent | null {
  if (!count(sequence) || sequence === 0) return null;
  if (element === null) return { event: 'selection', sequence, element: null };
  if (
    !record(element) ||
    !present(element.elementId) ||
    typeof element.instancePath !== 'string' ||
    typeof element.parentDisplay !== 'string'
  )
    return null;
  const rect = readRect(element.rect);
  if (!rect || !record(element.styles)) return null;
  const styles: Record<string, string> = {};
  const entries = Object.entries(element.styles);
  if (entries.length > MAX_PREVIEW_STYLE_PROPERTIES) return null;
  for (const [name, style] of entries) {
    if (typeof style !== 'string') return null;
    styles[name] = clampPreviewText(style);
  }
  return {
    event: 'selection',
    sequence,
    element: {
      elementId: clampPreviewText(element.elementId),
      instancePath: clampPreviewText(element.instancePath),
      rect,
      styles,
      text: whole(element.text),
      parentDisplay: clampPreviewText(element.parentDisplay),
    },
  };
}

/** A box in the design's own pixels, which may start above or left of its viewport. */
function readRect(value: unknown): FrameRect | null {
  if (!record(value)) return null;
  const { x, y, width, height } = value;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null;
  return width < 0 || height < 0 ? null : { x, y, width, height };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function present(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * A text field is display data. Past the structural bounds it carries no
 * security consequence, so an over-long one is cut rather than used as a reason
 * to refuse the snapshot: refusing one would end a guest over a diagnostic, and
 * the intermediate already cuts to the same bound from the other side. The cut
 * lands on a code point boundary, so a character is never split in half. The
 * element panel cuts typed text the same way, so what it previews is what it saves.
 */
export function clampPreviewText(value: string): string {
  if (utf8Bytes(value) <= MAX_PREVIEW_TEXT) return value;
  let cut = '';
  for (const character of value) {
    if (utf8Bytes(cut + character) > MAX_PREVIEW_TEXT) break;
    cut += character;
  }
  return cut;
}

/** Text the board may write back whole: within the cap, or none at all. */
function whole(value: unknown): string | null {
  return typeof value === 'string' && utf8Bytes(value) <= MAX_PREVIEW_TEXT ? value : null;
}

const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return encoder.encode(value).length;
}
