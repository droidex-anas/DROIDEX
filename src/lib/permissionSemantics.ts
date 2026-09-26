import type { Autonomy } from '../types/bridge';
import { loadDefaultAutonomy, normalizeAutonomy } from './autonomy';

const REVISION_KEY = 'droid-permission-semantics-revision';

// Brief 13 resets the provider-neutral default once: its old value cannot name
// equivalent permissions across providers. Session overrides are unaffected.
export function loadDefaultPermissionMode(): Autonomy {
  try {
    let storage: Storage | undefined;
    if (typeof window !== 'undefined') storage = window.localStorage;
    else {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      if (descriptor && 'value' in descriptor) storage = descriptor.value as Storage;
    }
    if (!storage) return 'off';
    const revision = storage.getItem(REVISION_KEY);
    if (revision !== '1') {
      storage.setItem('droid-default-autonomy', 'off');
      storage.setItem(REVISION_KEY, '1');
    }
    if (!normalizeAutonomy(storage.getItem('droid-default-autonomy'))) return 'off';
    return loadDefaultAutonomy();
  } catch {
    return 'off';
  }
}
