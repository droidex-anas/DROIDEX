import { isDesktop } from './desktop';
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

export function onNativeBrowserClosed(
  handler: (event: { browserSessionId: string }) => void,
): () => void {
  if (!isDesktop()) return () => undefined;
  return window.droidControl!.onNativeBrowserClosed(handler);
}
