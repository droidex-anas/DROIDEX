// The design system each canvas's next requests are pinned to (spec §10). The
// renderer composes every request's turn context, so the user's explicit choice
// lives here, by canvas, and persists; a canvas without one uses DROIDEX. A
// request copies the choice when it is composed, so a later change reaches only
// requests composed after it.

import { useSyncExternalStore } from 'react';
import type { DesignSystemRef } from './protocol';

export interface DesignSystemChoice {
  ref: DesignSystemRef;
  /** The kit's name when it was chosen, so the chip needs no list request. */
  name: string;
}

/** The sidecar's DEFAULT_DESIGN_SYSTEM_REF, which a request without a choice runs under. */
export const DEFAULT_DESIGN_SYSTEM: DesignSystemChoice = {
  ref: { id: 'droidex', version: 1, mode: 'light' },
  name: 'DROIDEX',
};

/** The Design home's key: its prompt makes a canvas that has no ID yet. Canvas IDs are UUIDs. */
export const NEW_CANVAS_KEY = 'new-canvas';

const STORAGE_KEY = 'droidex.canvasDesignSystems';
// A deleted canvas's choice is never read again, so only the newest are kept.
const MAX_CHOICES = 200;
const MAX_NAME_LENGTH = 120;

let choices: Readonly<Record<string, DesignSystemChoice>> | null = null;
const listeners = new Set<() => void>();
// What a Design home send was pinned to, until the canvas it makes exists.
const owedByCreate = new Map<string, DesignSystemChoice>();

function storage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? (descriptor.value as Storage) : undefined;
}

function isChoice(value: unknown): value is DesignSystemChoice {
  if (typeof value !== 'object' || value === null) return false;
  const { ref, name } = value as { ref?: unknown; name?: unknown };
  if (typeof ref !== 'object' || ref === null) return false;
  const { id, version, mode } = ref as { id?: unknown; version?: unknown; mode?: unknown };
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    typeof id === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(id) &&
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= 0 &&
    (mode === 'light' || mode === 'dark')
  );
}

function loaded(): Readonly<Record<string, DesignSystemChoice>> {
  if (choices) return choices;
  choices = {};
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed === 'object' && parsed !== null)
      choices = Object.fromEntries(Object.entries(parsed).filter(([, choice]) => isChoice(choice)));
  } catch {
    // An unreadable record is a lost preference, never a failed composer.
  }
  return choices;
}

function publish(next: Record<string, DesignSystemChoice>) {
  choices = Object.fromEntries(Object.entries(next).slice(-MAX_CHOICES));
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(choices));
  } catch {
    // Still in effect for this window when storage is full or unavailable.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The user's explicit choice for this canvas, or null when it runs under DROIDEX. */
export function designSystemChoice(key: string): DesignSystemChoice | null {
  return loaded()[key] ?? null;
}

export function useDesignSystemChoice(key: string | null): DesignSystemChoice | null {
  return useSyncExternalStore(subscribe, () => (key ? designSystemChoice(key) : null));
}

/** Pins future requests on this canvas to `choice`; null returns it to the default. */
export function chooseDesignSystem(key: string, choice: DesignSystemChoice | null): void {
  const rest = Object.fromEntries(Object.entries(loaded()).filter(([id]) => id !== key));
  // Re-inserted last, so the newest choices are the ones the cap keeps.
  publish(choice ? { ...rest, [key]: { ref: { ...choice.ref }, name: choice.name } } : rest);
}

/** Holds the Design home's choice for the canvas the send `clientRef` will make. */
export function oweCreatedCanvasChoice(clientRef: string): void {
  const choice = designSystemChoice(NEW_CANVAS_KEY);
  if (choice) owedByCreate.set(clientRef, choice);
}

/** Gives the canvas a Design home send made the choice that send was pinned to. */
export function settleCreatedCanvasChoice(clientRef: string, canvasId: string | null): void {
  const choice = owedByCreate.get(clientRef);
  owedByCreate.delete(clientRef);
  if (choice && canvasId !== null && !designSystemChoice(canvasId))
    chooseDesignSystem(canvasId, choice);
}
