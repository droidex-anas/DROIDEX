// One shared kit list for the picker and transcript chips. Changes during a
// read coalesce into one follow-up; socket health also invalidates the list
// when a reconnect only replays events and emits no connection event.

import { useSyncExternalStore } from 'react';
import { getRuntimeHealth, subscribeRuntimeHealth } from '../../lib/runtimeHealth';
import { canvasClient } from './canvasClient';
import { canvasMessage } from './client';
import { followLatest } from './designSystemChoices';
import type { KitList } from './designSystemsState';

let list: KitList = { status: 'loading' };
let stale = true;
let activeRead: symbol | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: KitList): void {
  list = next;
  for (const listener of listeners) listener();
}

function read(): void {
  if (activeRead || !stale || listeners.size === 0 || getRuntimeHealth().transport !== 'connected')
    return;
  const token = Symbol();
  activeRead = token;
  stale = false;
  const started = generation;
  void canvasClient.designSystems.list().then(
    (systems) => {
      if (activeRead !== token) return;
      activeRead = null;
      if (started === generation) {
        followLatest(systems);
        publish({ status: 'listed', systems });
      }
      read();
    },
    (error: unknown) => {
      if (activeRead !== token) return;
      activeRead = null;
      if (started === generation) {
        stale = true;
        publish({ status: 'failed', message: canvasMessage(error) });
        return;
      }
      read();
    },
  );
}

function reread(): void {
  generation += 1;
  stale = true;
  read();
}

function retry(): void {
  publish({ status: 'loading' });
  reread();
}

let stopWatching: (() => void) | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    const stopChanges = canvasClient.subscribeDesignSystems(reread);
    let transport = getRuntimeHealth().transport;
    const stopHealth = subscribeRuntimeHealth(() => {
      const next = getRuntimeHealth().transport;
      if (next === transport) return;
      transport = next;
      activeRead = null;
      reread();
    });
    stopWatching = () => {
      stopChanges();
      stopHealth();
    };
  }
  read();
  return () => {
    listeners.delete(listener);
    if (listeners.size !== 0) return;
    stopWatching?.();
    stopWatching = undefined;
    // Kit changes are unobserved while there are no readers.
    activeRead = null;
    stale = true;
  };
}

function snapshot(): KitList {
  return list;
}

/** The kits, with a quiet reread or an explicit loading retry. */
export function useKitList(): { list: KitList; reread: () => void; retry: () => void } {
  return { list: useSyncExternalStore(subscribe, snapshot, snapshot), reread, retry };
}
