// The pictures of a kit version's previews (design system documents spec §3,
// §7): what a tile shows while it holds no live slot, and the cover a picker row
// and the composer chip show, which for an image cover is drawn from the image.
// The sidecar keeps them beside the version; this window reads each when it is
// first shown and swaps in any capture it saves.

import { useEffect, useSyncExternalStore } from 'react';
import { canvasClient } from './canvasClient';
import { base64 } from './captureCanvasImage';
import { KitCaptureCache } from './kitCaptureCache';
import type { DesignSystemRef } from './protocol';
import type { PreviewMode } from './PreviewModeToggle';
import { MAX_KIT_CAPTURE_BASE64_LENGTH } from './wireValidation';

// Device pixels up to 2x keep a tile sharp at its own size on a Retina screen.
const MAX_CAPTURE_SCALE = 2;
const MODES: readonly PreviewMode[] = ['light', 'dark'];

// Keyed by kit version, mode and item; held by each mounted tile, row and chip.
// A capture let go is read again from the sidecar when one shows it.
const captures = new KitCaptureCache(32 * 1024 * 1024);
const reading = new Set<string>();
const listeners = new Set<() => void>();

function captureKey(ref: DesignSystemRef, item: string): string {
  return JSON.stringify([ref.id, ref.version, ref.mode, item]);
}

function show(key: string, png: string | null): void {
  captures.set(key, png === null ? null : `data:image/png;base64,${png}`);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The capture's URL: undefined while it is read, null when that item has not
 * been captured in that mode yet, or when `ref` is null.
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
    const release = captures.hold(key);
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
  const scale = deviceScale();
  let png = await scaledPng(bytes, Math.round(widthPx * scale));
  // A capture too detailed for the limit at device scale is still worth keeping at CSS scale.
  if (png === null && scale > 1) png = await scaledPng(bytes, widthPx);
  if (png === null) return;
  await canvasClient.designSystems.saveCapture(ref, item, png);
  show(captureKey(ref, item), png);
}

/**
 * Keeps an image cover, whole and centred in the cover's size, as the cover's
 * capture in both modes. The margins stay clear, so a row or chip shows the
 * kit's surface around it.
 */
export async function keepImageCoverCapture(
  kit: Omit<DesignSystemRef, 'mode'>,
  imageUrl: string,
  size: { widthPx: number; heightPx: number },
): Promise<void> {
  const image = new Image();
  image.src = imageUrl;
  await image.decode();
  const scale = deviceScale();
  let png = await letterboxedPng(image, size, scale);
  if (png === null && scale > 1) png = await letterboxedPng(image, size, 1);
  if (png === null) return;
  for (const mode of MODES) {
    const ref = { ...kit, mode };
    await canvasClient.designSystems.saveCapture(ref, 'cover', png);
    show(captureKey(ref, 'cover'), png);
  }
}

function deviceScale(): number {
  return Math.min(MAX_CAPTURE_SCALE, Math.max(1, window.devicePixelRatio));
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
    return await encodedPng(canvas);
  } finally {
    bitmap.close();
  }
}

async function letterboxedPng(
  image: HTMLImageElement,
  size: { widthPx: number; heightPx: number },
  scale: number,
): Promise<string | null> {
  const canvas = new OffscreenCanvas(
    Math.round(size.widthPx * scale),
    Math.round(size.heightPx * scale),
  );
  const context = canvas.getContext('2d');
  if (!context) return null;
  const fit = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * fit;
  const height = image.naturalHeight * fit;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return encodedPng(canvas);
}

async function encodedPng(canvas: OffscreenCanvas): Promise<string | null> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const encoded = base64(new Uint8Array(await blob.arrayBuffer()));
  return encoded.length <= MAX_KIT_CAPTURE_BASE64_LENGTH ? encoded : null;
}
