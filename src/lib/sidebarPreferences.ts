import {
  DEFAULT_SIDEBAR_PREFERENCES,
  loadSidebarActivity,
  saveSidebarActivity,
  type SidebarActivityPreferences,
} from './sidebarActivity';

/* The one copy of the sidebar's saved preferences, settle markers included.
   The Sidebar reads it while mounted, and the window's answer to a chat's
   sidebar request writes it whether the Sidebar is mounted or not, so neither
   can overwrite the other's change from a stale copy. */

let current: SidebarActivityPreferences | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? (descriptor.value as Storage) : undefined;
}

export function sidebarPreferences(): SidebarActivityPreferences {
  if (current) return current;
  try {
    const saved = storage();
    current = saved ? loadSidebarActivity(saved) : { ...DEFAULT_SIDEBAR_PREFERENCES, settled: {} };
  } catch (error) {
    console.error('Unable to load sidebar activity preferences', error);
    current = { ...DEFAULT_SIDEBAR_PREFERENCES, settled: {} };
  }
  return current;
}

export function subscribeSidebarPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Saves the preferences, then applies them, and returns whether the save
    worked. A change the user asked for is dropped when it cannot be saved;
    'keep' applies it anyway, for tidying that must not retry on every render. */
export function updateSidebarPreferences(
  next: SidebarActivityPreferences,
  unsaved: 'drop' | 'keep' = 'drop',
): boolean {
  const saved = save(next);
  if (saved || unsaved === 'keep') {
    current = next;
    for (const listener of listeners) listener();
  }
  return saved;
}

function save(next: SidebarActivityPreferences): boolean {
  try {
    const target = storage();
    if (!target) return false;
    saveSidebarActivity(target, next);
    return true;
  } catch {
    return false;
  }
}
