import { useSyncExternalStore } from 'react';

// What a new chat shows above and behind its composer. The new-chat home and
// Appearance settings live in separate trees, so the look owns a small
// persisted store instead of growing the root store.

export const ART_PRESETS = ['glow', 'rotor', 'ridgeline', 'contour'] as const;
export type ArtPreset = (typeof ART_PRESETS)[number];
export type SavedBackgroundId = `image-${string}`;
export type Backdrop = 'none' | ArtPreset | SavedBackgroundId;
export type LogoChoice = 'harness' | 'wordmark' | 'none';

// An image the user added, kept as a data URL so it can be picked again later.
export interface SavedBackground {
  id: SavedBackgroundId;
  image: string;
}

export interface NewChatLook {
  // A saved id is only valid while that background is in `savedBackgrounds`.
  backdrop: Backdrop;
  logo: LogoChoice;
  // Redraw saved images in the harness-lit dither instead of as they are.
  ditherImage: boolean;
  savedBackgrounds: readonly SavedBackground[];
}

// Each image fills a few hundred kilobytes of the renderer's localStorage.
export const MAX_SAVED_BACKGROUNDS = 8;

const PREFERENCES_KEY = 'droid-new-chat-look';
const IMAGE_KEY_PREFIX = 'droid-new-chat-background:';

const DEFAULT_LOOK: NewChatLook = {
  backdrop: 'glow',
  logo: 'harness',
  ditherImage: true,
  savedBackgrounds: [],
};

const LOGOS: readonly LogoChoice[] = ['harness', 'wordmark', 'none'];

interface StoredPreferences {
  backdrop: Backdrop;
  logo: LogoChoice;
  ditherImage: boolean;
  savedBackgroundIds: SavedBackgroundId[];
}

function getLocalStorage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? (descriptor.value as Storage) : undefined;
}

function isSavedBackgroundId(value: unknown): value is SavedBackgroundId {
  return typeof value === 'string' && value.startsWith('image-');
}

function readSavedBackgrounds(storage: Storage, ids: unknown): SavedBackground[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter(isSavedBackgroundId).flatMap((id) => {
    const image = storage.getItem(IMAGE_KEY_PREFIX + id);
    return image?.startsWith('data:image/') ? [{ id, image }] : [];
  });
}

function validBackdrop(value: unknown, saved: readonly SavedBackground[]): Backdrop {
  if (value === 'none') return value;
  const preset = ART_PRESETS.find((name) => name === value);
  if (preset) return preset;
  const image = saved.find((background) => background.id === value);
  return image ? image.id : DEFAULT_LOOK.backdrop;
}

export function loadNewChatLook(): NewChatLook {
  const storage = getLocalStorage();
  if (!storage) return DEFAULT_LOOK;
  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    const stored = (raw ? JSON.parse(raw) : {}) as Partial<
      Record<keyof StoredPreferences, unknown>
    >;
    const savedBackgrounds = readSavedBackgrounds(storage, stored.savedBackgroundIds);
    return {
      backdrop: validBackdrop(stored.backdrop, savedBackgrounds),
      logo: LOGOS.find((value) => value === stored.logo) ?? DEFAULT_LOOK.logo,
      ditherImage:
        typeof stored.ditherImage === 'boolean' ? stored.ditherImage : DEFAULT_LOOK.ditherImage,
      savedBackgrounds,
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

let current: NewChatLook | null = null;
const listeners = new Set<() => void>();

function snapshot(): NewChatLook {
  current ??= loadNewChatLook();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNewChatLook(): NewChatLook {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function writePreferences(storage: Storage | undefined, look: NewChatLook): void {
  const preferences: StoredPreferences = {
    backdrop: look.backdrop,
    logo: look.logo,
    ditherImage: look.ditherImage,
    savedBackgroundIds: look.savedBackgrounds.map((background) => background.id),
  };
  storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

function publish(next: NewChatLook): void {
  current = next;
  for (const listener of listeners) listener();
}

export function updateNewChatLook(
  patch: Partial<Pick<NewChatLook, 'backdrop' | 'logo' | 'ditherImage'>>,
): void {
  const next = { ...snapshot(), ...patch };
  writePreferences(getLocalStorage(), next);
  publish(next);
}

// Stores the image and selects it. Persists before applying, so a full storage
// quota leaves the live look untouched; throws on that failure.
export function addSavedBackground(image: string): void {
  const look = snapshot();
  if (look.savedBackgrounds.length >= MAX_SAVED_BACKGROUNDS) {
    throw new Error('Saved background limit reached');
  }
  const background: SavedBackground = { id: `image-${crypto.randomUUID()}`, image };
  const next: NewChatLook = {
    ...look,
    backdrop: background.id,
    savedBackgrounds: [...look.savedBackgrounds, background],
  };
  const storage = getLocalStorage();
  const imageKey = IMAGE_KEY_PREFIX + background.id;
  try {
    storage?.setItem(imageKey, image);
    writePreferences(storage, next);
  } catch (error) {
    storage?.removeItem(imageKey);
    throw error;
  }
  publish(next);
}

export function removeSavedBackground(id: SavedBackgroundId): void {
  const look = snapshot();
  const next: NewChatLook = {
    ...look,
    backdrop: look.backdrop === id ? DEFAULT_LOOK.backdrop : look.backdrop,
    savedBackgrounds: look.savedBackgrounds.filter((background) => background.id !== id),
  };
  const storage = getLocalStorage();
  writePreferences(storage, next);
  storage?.removeItem(IMAGE_KEY_PREFIX + id);
  publish(next);
}
