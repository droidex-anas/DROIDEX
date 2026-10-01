import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
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
  /** Sessions whose page crashed and has not loaded since, even with the pane closed. */
  crashed: Readonly<Record<string, true>>;
}

let state: BrowserHostState = { pages: [], slot: null, working: {}, crashed: {} };
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

/**
 * Mounts the session's page if it is not mounted yet. `savedUrl` is the page
 * the app last saw there, which main reopens after an app restart.
 */
function ensureBrowserPage(browserSessionId: string, savedUrl?: string): Promise<void> {
  touch(browserSessionId);
  if (state.pages.some((page) => page.browserSessionId === browserSessionId))
    return Promise.resolve();
  const pending = reserving.get(browserSessionId);
  if (pending) return pending;
  const reservation = reserveNativeBrowser(browserSessionId, savedUrl)
    .then(({ src, generation }) => {
      if (reserving.get(browserSessionId) !== reservation)
        throw new Error('The browser page was closed.');
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

/**
 * Runs agent work on a session's page, keeping it mounted and awake
 * throughout. Main lifts the page's own throttling for the work, so it renders
 * even while the app window is hidden.
 */
export async function withBrowserPage<T>(
  browserSessionId: string,
  run: () => Promise<T>,
  savedUrl?: string,
): Promise<T> {
  setWorking(browserSessionId, 1);
  try {
    await ensureBrowserPage(browserSessionId, savedUrl);
    return await run();
  } finally {
    setWorking(browserSessionId, -1);
    unloadOverCap();
  }
}

export function closeBrowserPage(browserSessionId: string): void {
  reserving.delete(browserSessionId);
  lastUsed.delete(browserSessionId);
  setBrowserPageCrashed(browserSessionId, false);
  if (!state.pages.some((page) => page.browserSessionId === browserSessionId)) return;
  update({ pages: state.pages.filter((page) => page.browserSessionId !== browserSessionId) });
}

export function setBrowserPageCrashed(browserSessionId: string, crashed: boolean): void {
  if (browserSessionId in state.crashed === crashed) return;
  update({
    crashed: crashed
      ? { ...state.crashed, [browserSessionId]: true }
      : Object.fromEntries(Object.entries(state.crashed).filter(([id]) => id !== browserSessionId)),
  });
}

export function useBrowserPageCrashed(browserSessionId: string | undefined): boolean {
  const crashed = () => browserSessionId !== undefined && browserSessionId in state.crashed;
  return useSyncExternalStore(subscribe, crashed, crashed);
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
}

/**
 * Shows the session's page over the calling element while it is mounted and
 * not hidden. Returns the CSS anchor name the element must carry.
 */
export function useBrowserSlot(
  browserSessionId: string | undefined,
  { hidden, rounded, url }: { hidden: boolean; rounded: boolean; url: string },
): string {
  const anchor = `--browser-slot-${useId().replace(/[^\w-]/g, '')}`;
  const latest = useRef({ rounded, url });
  latest.current = { rounded, url };
  useLayoutEffect(() => {
    if (!browserSessionId || hidden) return;
    void ensureBrowserPage(browserSessionId, latest.current.url).catch(() => undefined);
    setSlot({ browserSessionId, anchor, rounded: latest.current.rounded });
    return () => {
      if (state.slot?.anchor === anchor) setSlot(null);
    };
  }, [anchor, browserSessionId, hidden]);
  // Corners follow the pane in place; withdrawing the slot would put the page
  // to sleep for a frame.
  useLayoutEffect(() => {
    if (state.slot?.anchor === anchor && state.slot.rounded !== rounded)
      update({ slot: { ...state.slot, rounded } });
  }, [anchor, rounded]);
  return anchor;
}
