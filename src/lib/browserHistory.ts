export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  typedCount: number;
  /** Unix time in milliseconds. */
  lastVisitedAt: number;
}

export interface BrowserHistoryApi {
  /** Host or URL prefixes precede title matches. Limits are 1 to 50, default 8. */
  suggest(input: string, limit?: number): Promise<BrowserHistoryEntry[]>;
  /** Mark the tab's next navigation as typed; only its successful destination is recorded. */
  recordTyped(appSessionId: string, url: string): Promise<void>;
  remove(url: string): Promise<void>;
  clear(): Promise<void>;
}

export function getBrowserHistory(): BrowserHistoryApi {
  const desktop = window.droidControl;
  if (!desktop) throw new Error('Browser history is only available in the desktop app.');
  return desktop.browserHistory;
}
