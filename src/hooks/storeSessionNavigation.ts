import { chatsBesideFocus, livePage, type TabAction } from '../features/tabs/tabStrip';
import { focusedTile } from '../features/tabs/tileGrid';
import type { AppState } from './useStore';

export function withoutKey<T>(
  record: Partial<Record<string, T>>,
  key: string,
): Partial<Record<string, T>> {
  if (!(key in record)) return record;
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

// The action that closes the live chat's place, when that is `appSessionId`.
export function closeLiveChat(state: AppState, appSessionId: string): TabAction | null {
  const live = livePage(state);
  if (live.kind === 'chat' && live.appSessionId === appSessionId) {
    return { type: 'CLOSE_TAB', tabId: state.tabStrip.activeTabId };
  }
  if (live.kind !== 'tiles') return null;
  const tile = focusedTile(live.grid);
  const shown = tile.page.kind === 'chat' && tile.page.appSessionId === appSessionId;
  return shown ? { type: 'CLOSE_TILE', tileId: tile.id } : null;
}

// The tiles beside the focused one are on screen too, so showing them reads them.
export function withTilesSeen(state: AppState, seenAt: number): AppState {
  const seen = chatsBesideFocus(state.tabStrip).filter(
    (appSessionId) =>
      Object.hasOwn(state.sessions, appSessionId) && state.sessionLastSeen[appSessionId] !== seenAt,
  );
  if (seen.length === 0) return state;
  const sessionLastSeen = { ...state.sessionLastSeen };
  for (const appSessionId of seen) sessionLastSeen[appSessionId] = seenAt;
  return { ...state, sessionLastSeen };
}
