import { useSyncExternalStore } from 'react';

// What a new chat shows above and behind its composer. The new-chat home and
// Appearance settings live in separate trees, so the look owns a small
// persisted store instead of growing the root store.

export const ART_PRESETS = ['glow', 'rotor', 'ridgeline', 'contour'] as const;
export type ArtPreset = (typeof ART_PRESETS)[number];
export type Backdrop = 'none' | ArtPreset | 'custom';
export type LogoChoice = 'harness' | 'wordmark' | 'custom' | 'none';

export interface NewChatLook {
  backdrop: Backdrop;
  logo: LogoChoice;
  // Redraw an uploaded background in the harness-lit dither instead of as is.
  ditherImage: boolean;
  // Uploads are data URLs; a 'custom' choice is only valid while its image exists.
  backgroundImage: string | null;
  logoImage: string | null;
}

const PREFERENCES_KEY = 'droid-new-chat-look';
const BACKGROUND_IMAGE_KEY = 'droid-new-chat-background-image';
const LOGO_IMAGE_KEY = 'droid-new-chat-logo-image';

const DEFAULT_LOOK: NewChatLook = {
  backdrop: 'glow',
  logo: 'harness',
  ditherImage: true,
  backgroundImage: null,
  logoImage: null,
};

const BACKDROPS: readonly Backdrop[] = ['none', ...ART_PRESETS, 'custom'];
const LOGOS: readonly LogoChoice[] = ['harness', 'wordmark', 'custom', 'none'];

function getLocalStorage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? (descriptor.value as Storage) : undefined;
}

function readImage(storage: Storage, key: string): string | null {
  const value = storage.getItem(key);
  return value?.startsWith('data:image/') ? value : null;
}

export function loadNewChatLook(): NewChatLook {
  const storage = getLocalStorage();
  if (!storage) return DEFAULT_LOOK;
  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    const saved = (raw ? JSON.parse(raw) : {}) as Partial<Record<keyof NewChatLook, unknown>>;
    const backgroundImage = readImage(storage, BACKGROUND_IMAGE_KEY);
    const logoImage = readImage(storage, LOGO_IMAGE_KEY);
    const backdrop = BACKDROPS.find((value) => value === saved.backdrop) ?? DEFAULT_LOOK.backdrop;
    const logo = LOGOS.find((value) => value === saved.logo) ?? DEFAULT_LOOK.logo;
    return {
      backdrop: backdrop === 'custom' && !backgroundImage ? DEFAULT_LOOK.backdrop : backdrop,
      logo: logo === 'custom' && !logoImage ? DEFAULT_LOOK.logo : logo,
      ditherImage:
        typeof saved.ditherImage === 'boolean' ? saved.ditherImage : DEFAULT_LOOK.ditherImage,
      backgroundImage,
      logoImage,
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

function writeImage(storage: Storage, key: string, image: string | null): void {
  if (image) storage.setItem(key, image);
  else storage.removeItem(key);
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

// Persists first and applies only after every write lands, so a full storage
// quota (a large upload) leaves the live look untouched. Throws on failure.
export function updateNewChatLook(patch: Partial<NewChatLook>): void {
  const next = { ...snapshot(), ...patch };
  if (next.backdrop === 'custom' && !next.backgroundImage) next.backdrop = DEFAULT_LOOK.backdrop;
  if (next.logo === 'custom' && !next.logoImage) next.logo = DEFAULT_LOOK.logo;
  const storage = getLocalStorage();
  if (storage) {
    if ('backgroundImage' in patch) writeImage(storage, BACKGROUND_IMAGE_KEY, next.backgroundImage);
    if ('logoImage' in patch) writeImage(storage, LOGO_IMAGE_KEY, next.logoImage);
    storage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ backdrop: next.backdrop, logo: next.logo, ditherImage: next.ditherImage }),
    );
  }
  current = next;
  for (const listener of listeners) listener();
}
