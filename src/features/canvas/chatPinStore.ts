import { useSyncExternalStore } from 'react';

export function createChatPinStore<T>() {
  const NONE: readonly T[] = [];
  // Only chats holding pins have an entry, so this never grows with the chats visited.
  const pinsByChat = new Map<string, readonly T[]>();
  const listeners = new Set<() => void>();

  function publish(appSessionId: string, pins: readonly T[]) {
    if (pins.length > 0) pinsByChat.set(appSessionId, pins);
    else pinsByChat.delete(appSessionId);
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function get(appSessionId: string): readonly T[] {
    return pinsByChat.get(appSessionId) ?? NONE;
  }

  function usePins(appSessionId: string | null): readonly T[] {
    return useSyncExternalStore(subscribe, () => (appSessionId ? get(appSessionId) : NONE));
  }

  return { get, usePins, publish };
}
