import type { Autonomy, ProviderKind } from '../types/bridge';

// The four autonomy levels are the app's four permission modes, in one
// vocabulary every harness speaks. The persisted app default lives in
// localStorage, initializes on first run, and is edited only from Settings;
// per-draft and per-session values never rewrite it.

export const AUTONOMY_LEVELS: readonly Autonomy[] = ['off', 'low', 'medium', 'high'];

export const FIRST_RUN_DEFAULT_AUTONOMY: Autonomy = 'medium';

export const AUTONOMY_LABELS: Record<Autonomy, string> = {
  off: 'Supervised',
  low: 'Auto-accept edits',
  medium: 'Auto',
  high: 'Full access',
};

export const AUTONOMY_DESCRIPTIONS: Record<Autonomy, string> = {
  off: 'Ask before commands and file changes.',
  low: 'Auto-approve edits, ask before other actions.',
  medium: 'Supported providers approve routine actions; others still ask.',
  high: 'Allow commands and edits without prompts.',
};

// What the chosen mode means on the chat's own harness, where the harness
// makes it mean something in particular. Absent when it means nothing extra,
// so the menu never invents a consequence to fill the line.
export function autonomyConsequence(
  provider: ProviderKind | undefined,
  level: Autonomy,
): string | undefined {
  if (provider === 'claude' && level === 'medium') return "Auto uses Claude Code's classifier.";
  if (provider === 'codex') return 'Approvals update now; native sandbox changes on the next turn.';
  if (provider === 'droid' && level === 'high') return "Droid's safety checks can still ask.";
  return undefined;
}

const DEFAULT_AUTONOMY_STORAGE_KEY = 'droid-default-autonomy';

function getLocalStorage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? (descriptor.value as Storage) : undefined;
}

export function normalizeAutonomy(value: unknown): Autonomy | undefined {
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high') return value;
  return undefined;
}

export function loadDefaultAutonomy(): Autonomy {
  try {
    return (
      normalizeAutonomy(getLocalStorage()?.getItem(DEFAULT_AUTONOMY_STORAGE_KEY)) ??
      FIRST_RUN_DEFAULT_AUTONOMY
    );
  } catch {
    return FIRST_RUN_DEFAULT_AUTONOMY;
  }
}

export function saveDefaultAutonomy(level: Autonomy): void {
  try {
    getLocalStorage()?.setItem(DEFAULT_AUTONOMY_STORAGE_KEY, level);
  } catch {
    /* ignore */
  }
}

// Missions drive the product's most autonomous behavior, so starting one
// requires High autonomy; anything lower is an explicit user choice to make.
export function missionStartAllowed(level: Autonomy): boolean {
  return level === 'high';
}
