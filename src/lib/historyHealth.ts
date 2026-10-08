import type { ServerEvent } from '../types/bridge';

type HistoryPersistenceHealth = 'ok' | 'degraded' | 'unavailable';
type HistorySearchHealth = 'ok' | 'unavailable';

export interface HistoryHealthSnapshot {
  persistence: HistoryPersistenceHealth;
  search: HistorySearchHealth;
  searchUnavailableMessage?: string;
}

const listeners = new Set<() => void>();

let persistence: HistoryPersistenceHealth = 'ok';
let searchUnavailableMessage: string | undefined;

function emit(): void {
  for (const listener of listeners) listener();
}

export function isHistoryStatusError(event: ServerEvent): boolean {
  return (
    event.type === 'error' &&
    (event.code === 'history.persistence_degraded' ||
      event.code === 'history.search_unavailable' ||
      event.code === 'history.unavailable')
  );
}

export function applyHistoryServerEvent(event: ServerEvent): void {
  if (event.type === 'history.persistenceRecovered') {
    if (persistence === 'ok') return;
    persistence = 'ok';
    emit();
    return;
  }
  if (event.type === 'error' && event.code === 'history.unavailable') {
    if (persistence === 'unavailable') return;
    persistence = 'unavailable';
    emit();
    return;
  }
  if (event.type === 'error' && event.code === 'history.persistence_degraded') {
    if (persistence !== 'ok') return;
    persistence = 'degraded';
    emit();
    return;
  }
  if (event.type === 'error' && event.code === 'history.search_unavailable') {
    if (searchUnavailableMessage === event.message) return;
    searchUnavailableMessage = event.message;
    emit();
    return;
  }
  if (event.type === 'sessions.searchResults' && searchUnavailableMessage !== undefined) {
    searchUnavailableMessage = undefined;
    emit();
  }
}

export function getHistoryHealth(): HistoryHealthSnapshot {
  return {
    persistence,
    search:
      persistence === 'unavailable' || searchUnavailableMessage !== undefined
        ? 'unavailable'
        : 'ok',
    ...(searchUnavailableMessage !== undefined ? { searchUnavailableMessage } : {}),
  };
}

export function subscribeHistoryHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetHistoryHealthForTests(): void {
  persistence = 'ok';
  searchUnavailableMessage = undefined;
  emit();
}
