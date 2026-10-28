import { useEffect } from 'react';
import { CHAT_METADATA_STORAGE_KEY, loadChatMetadata } from '../lib/chatMetadata';
import { onSharedStorage, type SharedStorageChange } from '../lib/desktop';
import { loadWorkspaceCwds } from './persistedUiPreferences';
import type { Action } from './useStore';

/** Shows projects and chat organization changed in another copy of the app (the laptop window or a Remote browser). */
export function useSharedStorage(dispatch: (action: Action) => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    return onSharedStorage((change) => {
      const action = receiveSharedStorage(change);
      if (action) dispatch(action);
    });
  }, [dispatch, enabled]);
}

// Stores the value first, so saving the dispatched state finds it unchanged
// and does not relay it back.
function receiveSharedStorage({ key, value }: SharedStorageChange): Action | null {
  if (localStorage.getItem(key) === value) return null;
  localStorage.setItem(key, value);
  if (key === CHAT_METADATA_STORAGE_KEY) {
    return { type: 'SET_CHAT_METADATA', chatMetadata: loadChatMetadata() };
  }
  return { type: 'SET_WORKSPACE_CWDS', cwds: loadWorkspaceCwds() };
}
