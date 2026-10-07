import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { BrowserViewportMode } from '../types/bridge';
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
  /** The page's corners, as a CSS border radius. */
  radius: string;
  /** A standard-size page drawn at this scale; Fit pages fill the slot. */
  scale?: number;
}

export interface BrowserHostState {
  /** Mounted pages in creation order; never reordered. */
  pages: readonly BrowserPage[];
  slot: BrowserSlot | null;
  /** Sessions main has agent work in flight on, as main last reported. */
  working: Readonly<Record<string, true>>;
  /**
   * Sessions an agent's turn is using, each with the turn it belongs to: from
   * its first request on the page until that turn is over, so the pause while
   * the model thinks between two steps still counts.
   */
  engaged: Readonly<Record<string, string>>;
  /** Sessions whose page crashed and has not loaded since, even with the pane closed. */
  crashed: Readonly<Record<string, true>>;
}

let state: BrowserHostState = { pages: [], slot: null, working: {}, engaged: {}, crashed: {} };
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
 * Mounts the session's page if it is not mounted yet. `savedUrl` and
 * `savedMode` are the page and the size the app last saw there, which main
 * takes up again after an app restart.
 */
function ensureBrowserPage(
  browserSessionId: string,
  savedUrl?: string,
  savedMode?: BrowserViewportMode,
): Promise<void> {
  touch(browserSessionId);
  if (state.pages.some((page) => page.browserSessionId === browserSessionId))
    return Promise.resolve();
  const pending = reserving.get(browserSessionId);
  if (pending) return pending;
  const reservation = reserveNativeBrowser(browserSessionId, savedUrl, savedMode)
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
 * Main starts or finishes agent work on a session's page. The page stays
 * mounted and awake while any work is in flight; main waits for it to attach
 * and lifts its own throttling, so it renders even while the window is hidden.
 */
export function setBrowserPageWorking(
  browserSessionId: string,
  working: boolean,
  savedUrl?: string,
  savedMode?: BrowserViewportMode,
): void {
  if (browserSessionId in state.working !== working) {
    update({
      working: withFlag(state.working, browserSessionId, working),
    });
  }
  if (working) void ensureBrowserPage(browserSessionId, savedUrl, savedMode).catch(() => undefined);
  else unloadOverCap();
}

export function closeBrowserPage(browserSessionId: string): void {
  reserving.delete(browserSessionId);
  lastUsed.delete(browserSessionId);
  setBrowserPageCrashed(browserSessionId, false);
  if (browserSessionId in state.engaged)
    update({ engaged: without(state.engaged, browserSessionId) });
  if (state.slot?.browserSessionId === browserSessionId) setSlot(null);
  if (!state.pages.some((page) => page.browserSessionId === browserSessionId)) return;
  update({ pages: state.pages.filter((page) => page.browserSessionId !== browserSessionId) });
}

export function setBrowserPageCrashed(browserSessionId: string, crashed: boolean): void {
  if (browserSessionId in state.crashed === crashed) return;
  update({ crashed: withFlag(state.crashed, browserSessionId, crashed) });
}

/** A request of the chat's turn `turn` reached the page. */
export function engageBrowserPage(browserSessionId: string, turn: string): void {
  if (state.engaged[browserSessionId] !== turn)
    update({ engaged: { ...state.engaged, [browserSessionId]: turn } });
}

/** The page's turn is over: its agent is done with it once no request is left on it. */
export function releaseBrowserPage(browserSessionId: string): void {
  if (browserSessionId in state.engaged && !(browserSessionId in state.working))
    update({ engaged: without(state.engaged, browserSessionId) });
}

function withFlag(
  flags: Readonly<Record<string, true>>,
  browserSessionId: string,
  on: boolean,
): Readonly<Record<string, true>> {
  return on ? { ...flags, [browserSessionId]: true } : without(flags, browserSessionId);
}

function without<T>(record: Readonly<Record<string, T>>, browserSessionId: string) {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== browserSessionId));
}

/**
 * Where an agent's turn is using any of these pages: nowhere, only in the page
 * the pane shows, or in a page out of sight (another chat's pane, or none open).
 */
export type BrowserAgentPresence = 'none' | 'shown' | 'background';

export function useBrowserAgentPresence(
  browserSessionIds: readonly (string | undefined)[],
): BrowserAgentPresence {
  const presence = (): BrowserAgentPresence => {
    const used = browserSessionIds.filter((id) => id !== undefined && id in state.engaged);
    if (used.length === 0) return 'none';
    return used.every((id) => id === state.slot?.browserSessionId) ? 'shown' : 'background';
  };
  return useSyncExternalStore(subscribe, presence, presence);
}

export function useBrowserPageCrashed(browserSessionId: string | undefined): boolean {
  const crashed = () => browserSessionId !== undefined && browserSessionId in state.crashed;
  return useSyncExternalStore(subscribe, crashed, crashed);
}

export function isBrowserPageAwake(host: BrowserHostState, browserSessionId: string): boolean {
  return host.slot?.browserSessionId === browserSessionId || browserSessionId in host.working;
}

function unloadPages(browserSessionIds: Set<string>): void {
  if (browserSessionIds.size === 0) return;
  for (const browserSessionId of browserSessionIds) lastUsed.delete(browserSessionId);
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
  {
    hidden,
    radius,
    scale,
    url,
    viewportMode,
  }: {
    hidden: boolean;
    radius: string;
    scale?: number;
    url: string;
    viewportMode: BrowserViewportMode;
  },
): string {
  const anchor = `--browser-slot-${useId().replace(/[^\w-]/g, '')}`;
  const latest = useRef({ radius, scale, url, viewportMode });
  latest.current = { radius, scale, url, viewportMode };
  useLayoutEffect(() => {
    if (!browserSessionId || hidden) return;
    void ensureBrowserPage(browserSessionId, latest.current.url, latest.current.viewportMode).catch(
      () => undefined,
    );
    const { radius: corners, scale: drawnAt } = latest.current;
    setSlot({ browserSessionId, anchor, radius: corners, scale: drawnAt });
    return () => {
      if (state.slot?.anchor === anchor) setSlot(null);
    };
  }, [anchor, browserSessionId, hidden]);
  // Corners and scale follow the pane in place; withdrawing the slot would put
  // the page to sleep for a frame.
  useLayoutEffect(() => {
    const slot = state.slot;
    if (slot?.anchor === anchor && (slot.radius !== radius || slot.scale !== scale))
      update({ slot: { ...slot, radius, scale } });
  }, [anchor, radius, scale]);
  return anchor;
}
