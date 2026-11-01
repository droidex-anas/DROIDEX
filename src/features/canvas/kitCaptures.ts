// The pictures of a kit version's previews (design system documents spec §3,
// §7): what a tile shows while it holds no live slot, and the cover a picker row
// and the composer chip show. The sidecar keeps them beside the version; this
// window reads each when it is first shown and swaps in any capture it saves.

import { useEffect, useSyncExternalStore } from 'react';
import { canvasClient } from './canvasClient';
import { base64 } from './captureCanvasImage';
import type { DesignSystemRef } from './protocol';
import { MAX_KIT_CAPTURE_BASE64_LENGTH } from './wireValidation';

// Device pixels up to 2x keep a tile sharp at its own size on a Retina screen.
const MAX_CAPTURE_SCALE = 2;

// Past this many data URL characters, captures no tile shows are let go, least
// recently shown first, and read again from the sidecar when one is.
const MAX_RETAINED_CHARS = 32 * 1024 * 1024;

// A data URL per kit version, mode and item, or null once its read found none,
// least recently shown first.
const captures = new Map<string, string | null>();
let retainedChars = 0;
// How many mounted tiles, rows and chips show each key; those are never let go.
const shown = new Map<string, number>();
const reading = new Set<string>();
const listeners = new Set<() => void>();

function captureKey(ref: DesignSystemRef, item: string): string {
  return JSON.stringify([ref.id, ref.version, ref.mode, item]);
}

function show(key: string, png: string | null): void {
  forget(key);
  const url = png === null ? null : `data:image/png;base64,${png}`;
  captures.set(key, url);
  retainedChars += url?.length ?? 0;
  for (const [held, heldUrl] of captures) {
    if (retainedChars <= MAX_RETAINED_CHARS) break;
    if (heldUrl !== null && !shown.has(held)) forget(held);
  }
  for (const listener of listeners) listener();
}

function forget(key: string): void {
  retainedChars -= captures.get(key)?.length ?? 0;
  captures.delete(key);
}

/** Counts `key` as shown, and as the most recently shown. */
function hold(key: string): () => void {
  shown.set(key, (shown.get(key) ?? 0) + 1);
  const url = captures.get(key);
  if (url !== undefined) {
    captures.delete(key);
    captures.set(key, url);
  }
  return () => {
    const count = shown.get(key);
    if (count === 1) shown.delete(key);
    else if (count !== undefined) shown.set(key, count - 1);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The capture's URL: undefined while it is read, null when that item has not
 * rendered live in that mode yet, or when `ref` is null.
 */
export function useKitCapture(
  ref: DesignSystemRef | null,
  item: string,
): string | null | undefined {
  const key = ref === null ? null : captureKey(ref, item);
  const capture = useSyncExternalStore(subscribe, () => (key === null ? null : captures.get(key)));
  const id = ref?.id;
  const version = ref?.version;
  const mode = ref?.mode;
  useEffect(() => {
    if (key === null || id === undefined || version === undefined || mode === undefined) return;
    const release = hold(key);
    if (captures.has(key) || reading.has(key)) return release;
    reading.add(key);
    canvasClient.designSystems
      .readCapture({ id, version, mode }, item)
      .then(
        (png) => {
          if (!captures.has(key)) show(key, png);
        },
        (error: unknown) => {
          console.error('A design system preview capture could not be read:', error);
          if (!captures.has(key)) show(key, null);
        },
      )
      .finally(() => {
        reading.delete(key);
      });
    return release;
  }, [key, id, version, mode, item]);
  return capture;
}

/** Keeps a live preview's pixels as that item's capture, at its own size in device pixels. */
export async function keepKitCapture(
  ref: DesignSystemRef,
  item: string,
  bytes: Uint8Array,
  widthPx: number,
): Promise<void> {
  const scale = Math.min(MAX_CAPTURE_SCALE, Math.max(1, window.devicePixelRatio));
  let png = await scaledPng(bytes, Math.round(widthPx * scale));
  // A capture too detailed for the limit at device scale is still worth keeping at CSS scale.
  if (png === null && scale > 1) png = await scaledPng(bytes, widthPx);
  if (png === null) return;
  await canvasClient.designSystems.saveCapture(ref, item, png);
  show(captureKey(ref, item), png);
}

/** The PNG at most `widthPx` pixels wide as base64, or null when it is over the sidecar's limit. */
async function scaledPng(bytes: Uint8Array, widthPx: number): Promise<string | null> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
  try {
    const scale = Math.min(1, widthPx / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const encoded = base64(new Uint8Array(await blob.arrayBuffer()));
    return encoded.length <= MAX_KIT_CAPTURE_BASE64_LENGTH ? encoded : null;
  } finally {
    bitmap.close();
  }
}
