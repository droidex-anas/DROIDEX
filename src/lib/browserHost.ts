import { useId, useLayoutEffect, useSyncExternalStore } from 'react';
import { releaseNativeBrowser, reserveNativeBrowser, setNativeBrowserShown } from './nativeBrowser';

// Each chat's browser page is a <webview> the Browser host mounts once at the
// app root. Moving a <webview> to another parent destroys its page, so the pane
// never owns one: it publishes a slot and the host lays the page over it.
//
// A page is awake only while the pane shows it or an agent has work in flight
// on it; an agent can work in a page while the pane is closed or showing
// another chat. Otherwise the page is asleep: parked where Chromium stops its
// frames and throttles its timers, with its state kept. A page asleep for
// UNLOAD_AFTER_MS, or beyond MAX_LIVE_PAGES, is unloaded: its process goes and
// main keeps its URL to load again the next time the page is needed.

const MAX_LIVE_PAGES = 3;
const UNLOAD_AFTER_MS = 10 * 60_000;

export interface BrowserPage {
  browserSessionId: string;
  /** Carries the one-time token main issued for this page to attach with. */
  src: string;
  key: string;
}

interface BrowserSlot {
  browserSessionId: string;
  /** CSS anchor name of the pane's slot element. */
  anchor: string;
  rounded: boolean;
}

export interface BrowserHostState {
  /** Mounted pages in creation order; never reordered. */
  pages: readonly BrowserPage[];
  slot: BrowserSlot | null;
  /** Sessions with agent work in flight, by request count. */
  working: Readonly<Record<string, number>>;
}

let state: BrowserHostState = { pages: [], slot: null, working: {} };
const listeners = new Set<() => void>();
const reserving = new Map<string, Promise<void>>();
const lastUsed = new Map<string, number>();
const unloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
let useCounter = 0;

function update(next: Partial<BrowserHostState>): void {
  state = { ...state, ...next };
  scheduleUnloads();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getBrowserHostState(): BrowserHostState {
  return state;
}

export function useBrowserHost(): BrowserHostState {
  return useSyncExternalStore(subscribe, getBrowserHostState, getBrowserHostState);
}

function touch(browserSessionId: string): void {
  lastUsed.set(browserSessionId, ++useCounter);
}

/** Mounts the session's page if it is not mounted yet. */
function ensureBrowserPage(browserSessionId: string): Promise<void> {
  touch(browserSessionId);
  if (state.pages.some((page) => page.browserSessionId === browserSessionId))
    return Promise.resolve();
  const pending = reserving.get(browserSessionId);
  if (pending) return pending;
  const reservation = reserveNativeBrowser(browserSessionId)
    .then(({ src, generation }) => {
      // Closed while main was issuing the token.
      if (reserving.get(browserSessionId) !== reservation) return;
      update({
        pages: [
          ...state.pages,
          { browserSessionId, src, key: `${browserSessionId}:${String(generation)}` },
        ],
      });
      unloadOverCap();
    })
    .finally(() => {
      if (reserving.get(browserSessionId) === reservation) reserving.delete(browserSessionId);
    });
  reserving.set(browserSessionId, reservation);
  return reservation;
}

/** Runs agent work on a session's page, keeping the page mounted throughout. */
export async function withBrowserPage<T>(
  browserSessionId: string,
  run: () => Promise<T>,
): Promise<T> {
  const wasAwake =
    isBrowserPageAwake(state, browserSessionId) &&
    state.pages.some((page) => page.browserSessionId === browserSessionId);
  setWorking(browserSessionId, 1);
  try {
    await ensureBrowserPage(browserSessionId);
    // A sleeping page paints nothing, so a capture sent before the host has
    // shown it again would wait forever.
    if (!wasAwake) await nextPaint();
    return await run();
  } finally {
    setWorking(browserSessionId, -1);
    unloadOverCap();
  }
}

export function closeBrowserPage(browserSessionId: string): void {
  reserving.delete(browserSessionId);
  lastUsed.delete(browserSessionId);
  if (!state.pages.some((page) => page.browserSessionId === browserSessionId)) return;
  update({ pages: state.pages.filter((page) => page.browserSessionId !== browserSessionId) });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

function setWorking(browserSessionId: string, delta: 1 | -1): void {
  const { [browserSessionId]: current = 0, ...others } = state.working;
  const count = current + delta;
  update({ working: count > 0 ? { ...others, [browserSessionId]: count } : others });
}

export function isBrowserPageAwake(host: BrowserHostState, browserSessionId: string): boolean {
  return (
    host.slot?.browserSessionId === browserSessionId || Boolean(host.working[browserSessionId])
  );
}

function unloadPages(browserSessionIds: Set<string>): void {
  if (browserSessionIds.size === 0) return;
  update({ pages: state.pages.filter((page) => !browserSessionIds.has(page.browserSessionId)) });
  for (const browserSessionId of browserSessionIds)
    void releaseNativeBrowser(browserSessionId).catch(() => undefined);
}

// Over the cap, the least recently used sleeping pages are unloaded first. An
// awake page is never unloaded, so the cap can be exceeded while all are awake.
function unloadOverCap(): void {
  const excess = state.pages.length - MAX_LIVE_PAGES;
  if (excess <= 0) return;
  const asleep = state.pages
    .filter((page) => !isBrowserPageAwake(state, page.browserSessionId))
    .sort(
      (a, b) => (lastUsed.get(a.browserSessionId) ?? 0) - (lastUsed.get(b.browserSessionId) ?? 0),
    );
  unloadPages(new Set(asleep.slice(0, excess).map((page) => page.browserSessionId)));
}

function scheduleUnloads(): void {
  for (const [browserSessionId, timer] of unloadTimers) {
    const mounted = state.pages.some((page) => page.browserSessionId === browserSessionId);
    if (mounted && !isBrowserPageAwake(state, browserSessionId)) continue;
    clearTimeout(timer);
    unloadTimers.delete(browserSessionId);
  }
  for (const { browserSessionId } of state.pages) {
    if (isBrowserPageAwake(state, browserSessionId) || unloadTimers.has(browserSessionId)) continue;
    unloadTimers.set(
      browserSessionId,
      setTimeout(() => {
        unloadTimers.delete(browserSessionId);
        if (!isBrowserPageAwake(state, browserSessionId)) unloadPages(new Set([browserSessionId]));
      }, UNLOAD_AFTER_MS),
    );
  }
}

function setSlot(slot: BrowserSlot | null): void {
  const previous = state.slot?.browserSessionId;
  update({ slot });
  const next = slot?.browserSessionId;
  if (previous === next) return;
  if (previous) void setNativeBrowserShown(previous, false).catch(() => undefined);
  if (next) void setNativeBrowserShown(next, true).catch(() => undefined);
  unloadOverCap();
}

/**
 * Shows the session's page over the calling element while it is mounted and
 * not hidden. Returns the CSS anchor name the element must carry.
 */
export function useBrowserSlot(
  browserSessionId: string | undefined,
  { hidden, rounded }: { hidden: boolean; rounded: boolean },
): string {
  const anchor = `--browser-slot-${useId().replace(/[^\w-]/g, '')}`;
  useLayoutEffect(() => {
    if (!browserSessionId || hidden) return;
    void ensureBrowserPage(browserSessionId).catch(() => undefined);
    setSlot({ browserSessionId, anchor, rounded });
    return () => {
      if (state.slot?.anchor === anchor) setSlot(null);
    };
  }, [anchor, browserSessionId, hidden, rounded]);
  return anchor;
}
