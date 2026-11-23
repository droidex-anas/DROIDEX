import { useSyncExternalStore } from 'react';

export function chatPinStore<T>() {
  const NONE: readonly T[] = [];
  // Only chats holding pins have an entry, so this never grows with the chats visited.
  let pinsByChat: Readonly<Record<string, readonly T[]>> = {};
  const listeners = new Set<() => void>();

  function publish(appSessionId: string, pins: readonly T[]) {
    const others = Object.entries(pinsByChat).filter(([id]) => id !== appSessionId);
    pinsByChat = Object.fromEntries(pins.length > 0 ? [...others, [appSessionId, pins]] : others);
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function get(appSessionId: string): readonly T[] {
    return pinsByChat[appSessionId] ?? NONE;
  }

  function usePins(appSessionId: string | null): readonly T[] {
    return useSyncExternalStore(subscribe, () => (appSessionId ? get(appSessionId) : NONE));
  }

  return { get, usePins, publish };
}
