import { isDesktop } from './desktop';
import type {
  BrowserViewportMode,
  DesignAnchor,
  DesignAnchorDetail,
  DesignSelectionScreenshot,
  DesignStrokePoint,
} from '../types/bridge';

export interface NativeBrowserSelection {
  browserSessionId?: string;
  anchor: DesignAnchor;
  detail?: DesignAnchorDetail;
  url: string;
  title?: string;
  scroll?: { x: number; y: number };
  screenshot?: DesignSelectionScreenshot;
  strokes?: DesignStrokePoint[][];
}

export interface NativeBrowserLoaded {
  browserSessionId?: string;
  url: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export interface NativeBrowserLoadFailed {
  browserSessionId?: string;
  url: string;
  error?: string;
  crashed?: boolean;
}

export interface NativeBrowserDesignPrompt {
  selection: NativeBrowserSelection;
  instruction: string;
}

/** Where an agent's pointer action lands, in the page's own CSS pixels. */
export interface NativeBrowserAgentPoint {
  browserSessionId: string;
  x: number;
  y: number;
}

/** One frame of a page's small live picture, for the transcript's Browser card. */
export interface NativeBrowserFrame {
  browserSessionId: string;
  /** A JPEG, base64. */
  image: string;
  /** The page's own width in CSS pixels. */
  width: number;
  /** The frame the page ended on, sent as its picture stops. */
  last?: boolean;
}

/** Main is running agent work on the session's page, or has finished it. */
export interface NativeBrowserWorking {
  browserSessionId: string;
  working: boolean;
}

// Main issues the one-time token a page's <webview> must carry to attach.
export async function reserveNativeBrowser(
  browserSessionId: string,
  savedUrl?: string,
  savedMode?: BrowserViewportMode,
): Promise<{ src: string; generation: number }> {
  return window.droidControl!.nativeBrowserReserve(browserSessionId, savedUrl, savedMode);
}

export async function releaseNativeBrowser(browserSessionId: string): Promise<void> {
  await window.droidControl!.nativeBrowserRelease(browserSessionId);
}

/** Sessions main has agent work in flight on, for a host that just mounted. */
export async function listWorkingNativeBrowsers(): Promise<string[]> {
  return (await window.droidControl?.nativeBrowserWorkingSessions()) ?? [];
}

export async function setNativeBrowserShown(
  browserSessionId: string,
  shown: boolean,
): Promise<void> {
  await window.droidControl!.nativeBrowserShown(browserSessionId, shown);
}

export async function goBackNativeBrowser(browserSessionId: string): Promise<boolean> {
  if (!isDesktop()) return false;
  return window.droidControl!.nativeBrowserGoBack(browserSessionId);
}

export async function goForwardNativeBrowser(browserSessionId: string): Promise<boolean> {
  if (!isDesktop()) return false;
  return window.droidControl!.nativeBrowserGoForward(browserSessionId);
}

/** `scale` is how large the pane draws the page, so design labels keep their size. */
export async function setNativeBrowserDesignMode(
  browserSessionId: string,
  active: boolean,
  scale = 1,
): Promise<void> {
  if (!isDesktop()) return;
  await window.droidControl!.nativeBrowserSetDesignMode(browserSessionId, active, scale);
}

export async function setNativeBrowserPencilMode(
  browserSessionId: string,
  active: boolean,
): Promise<void> {
  if (!isDesktop()) return;
  await window.droidControl!.nativeBrowserSetPencilMode(browserSessionId, active);
}

export function onNativeBrowserSelection(
  handler: (selection: NativeBrowserSelection) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return window.droidControl!.onNativeBrowserSelection(handler);
}

export function onNativeBrowserDesignPrompt(
  handler: (prompt: NativeBrowserDesignPrompt) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return window.droidControl!.onNativeBrowserDesignPrompt(handler);
}

export function onNativeBrowserLoaded(handler: (event: NativeBrowserLoaded) => void): () => void {
  if (!isDesktop()) return () => undefined;
  return window.droidControl!.onNativeBrowserLoaded(handler);
}

export function onNativeBrowserLoadFailed(
  handler: (event: NativeBrowserLoadFailed) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return window.droidControl!.onNativeBrowserLoadFailed(handler);
}

export function onNativeBrowserWorking(handler: (event: NativeBrowserWorking) => void): () => void {
  if (!isDesktop()) return () => undefined;
  return window.droidControl!.onNativeBrowserWorking(handler);
}

export function onNativeBrowserAgentPoint(
  handler: (event: NativeBrowserAgentPoint) => void,
): () => void {
  return window.droidControl?.onNativeBrowserAgentPoint(handler) ?? (() => undefined);
}

// How many cards are watching each page: main is told when the first one
// starts and when the last one stops.
const watchers = new Map<string, number>();
// The card that stopped watching a page last, still waiting for its final frame.
const awaitingLast = new Map<string, () => void>();

/** Receives a page's live picture until the returned function is called. */
export function watchNativeBrowser(
  browserSessionId: string,
  handler: (frame: NativeBrowserFrame) => void,
): () => void {
  const api = window.droidControl;
  if (!api) return () => undefined;
  // A new watch is a new picture: the card before it takes nothing more.
  awaitingLast.get(browserSessionId)?.();
  const count = watchers.get(browserSessionId) ?? 0;
  watchers.set(browserSessionId, count + 1);
  if (count === 0) void api.nativeBrowserWatch(browserSessionId, true);
  const unsubscribe = api.onNativeBrowserFrame((frame) => {
    if (frame.browserSessionId === browserSessionId) handler(frame);
  });
  return () => {
    unsubscribe();
    const left = (watchers.get(browserSessionId) ?? 1) - 1;
    if (left > 0) {
      watchers.set(browserSessionId, left);
      return;
    }
    watchers.delete(browserSessionId);
    // Main sends the frame the page ended on as it stops; that one is still taken.
    const stop = () => {
      clearTimeout(timer);
      unsubscribeLast();
      if (awaitingLast.get(browserSessionId) === stop) awaitingLast.delete(browserSessionId);
    };
    const unsubscribeLast = api.onNativeBrowserFrame((frame) => {
      if (frame.browserSessionId !== browserSessionId || !frame.last) return;
      stop();
      handler(frame);
    });
    const timer = setTimeout(stop, 1000);
    awaitingLast.set(browserSessionId, stop);
    void api.nativeBrowserWatch(browserSessionId, false);
  };
}

export function onNativeBrowserClosed(
  handler: (event: { browserSessionId: string }) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return window.droidControl!.onNativeBrowserClosed(handler);
}
