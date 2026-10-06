// The renderer's half of the preview pull channel (spec §6).
//
// There is no guest preload: the board drives a preview through the webview
// element's `executeJavaScript`, with exactly these two audited literals. Every
// payload is a JSON-serialised argument to a fixed string, so nothing the
// sidecar or a design produced is ever interpolated as code.
//
// What comes back is untrusted. A snapshot is accepted only when it echoes the
// instance this board started and carries nothing outside the bounded event
// shapes below; the intermediate in `electron/canvasPreview.cjs` enforces the
// same caps on the way in.

import type { CanvasDiagnostic } from './protocol';

/** Events one snapshot may carry, matching the intermediate's queue cap. */
export const MAX_PREVIEW_SNAPSHOT_EVENTS = 64;
const MAX_PREVIEW_DIAGNOSTICS = 8;
const MAX_PREVIEW_TEXT = 512;
/** The queue cap times the largest event the guest will keep, with headroom. */
const MAX_PREVIEW_SNAPSHOT_BYTES = 64 * 1024;

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

/** Everything a preview may report. Task 8 fills `selection`/`interaction`. */
export type PreviewEvent =
  | { event: 'ready' }
  | { event: 'resize'; width: number; height: number }
  | { event: 'diagnostics'; diagnostics: CanvasDiagnostic[] }
  | { event: 'selection'; elementId: string; instancePath: string }
  | { event: 'interaction'; kind: string };

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
      return present(value.elementId) && present(value.instancePath)
        ? {
            event: 'selection',
            elementId: clamp(value.elementId),
            instancePath: clamp(value.instancePath),
          }
        : null;
    case 'interaction':
      return present(value.kind) ? { event: 'interaction', kind: clamp(value.kind) } : null;
    default:
      return null;
  }
}

function readDiagnostics(value: unknown): PreviewEvent | null {
  if (!Array.isArray(value) || value.length > MAX_PREVIEW_DIAGNOSTICS) return null;
  const diagnostics: CanvasDiagnostic[] = [];
  for (const entry of value) {
    if (!record(entry) || !present(entry.code) || typeof entry.message !== 'string') return null;
    diagnostics.push({ code: clamp(entry.code), message: clamp(entry.message) });
  }
  return { event: 'diagnostics', diagnostics };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function present(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * A text field is display data. Past the structural bounds it carries no
 * security consequence, so an over-long one is cut rather than used as a reason
 * to refuse the snapshot: refusing one would end a guest over a diagnostic, and
 * the intermediate already cuts to the same bound from the other side. The cut
 * lands on a code point boundary, so a character is never split in half.
 */
function clamp(value: string): string {
  if (utf8Bytes(value) <= MAX_PREVIEW_TEXT) return value;
  let cut = '';
  for (const character of value) {
    if (utf8Bytes(cut + character) > MAX_PREVIEW_TEXT) break;
    cut += character;
  }
  return cut;
}

const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return encoder.encode(value).length;
}
