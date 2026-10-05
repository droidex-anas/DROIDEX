import { isDesktop } from './desktop';
import type { NativeBrowserChord } from './shortcuts';
import type {
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

/** A key press the desktop host took from a browser page because it matched an app chord. */
export type NativeBrowserKeyPress = Required<
  Pick<KeyboardEventInit, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat'>
>;

/** Main is running agent work on the session's page, or has finished it. */
export interface NativeBrowserWorking {
  browserSessionId: string;
  working: boolean;
}

// Main issues the one-time token a page's <webview> must carry to attach.
export async function reserveNativeBrowser(
  browserSessionId: string,
  savedUrl?: string,
): Promise<{ src: string; generation: number }> {
  return window.droidControl!.nativeBrowserReserve(browserSessionId, savedUrl);
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

export async function setNativeBrowserDesignMode(
  browserSessionId: string,
  active: boolean,
): Promise<void> {
  if (!isDesktop()) return;
  await window.droidControl!.nativeBrowserSetDesignMode(browserSessionId, active);
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

/**
 * Has the desktop host take `chords` from a focused browser page, whose key
 * presses never reach this window, and hand each press to `onPress`.
 */
export function forwardNativeBrowserShortcuts(
  chords: NativeBrowserChord[],
  onPress: (press: NativeBrowserKeyPress) => void,
): () => void {
  const desktop = window.droidControl;
  if (!desktop) return () => undefined;
  const setHostChords = (next: NativeBrowserChord[]) => {
    desktop.nativeBrowserSetShortcuts(next).catch((error: unknown) => {
      console.error('[nativeBrowser] the host did not take the browser shortcuts:', error);
    });
  };
  setHostChords(chords);
  const stopListening = desktop.onNativeBrowserShortcut(onPress);
  return () => {
    stopListening();
    // Otherwise the host keeps taking these presses from the page with no one to hand them to.
    setHostChords([]);
  };
}

export function onNativeBrowserWorking(handler: (event: NativeBrowserWorking) => void): () => void {
  if (!isDesktop()) return () => undefined;
  return window.droidControl!.onNativeBrowserWorking(handler);
}

export function onNativeBrowserClosed(
  handler: (event: { browserSessionId: string }) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return window.droidControl!.onNativeBrowserClosed(handler);
}
