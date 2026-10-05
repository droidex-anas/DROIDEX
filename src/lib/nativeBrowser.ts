import { isDesktop } from './desktop';
import type { NativeBrowserChord } from './shortcuts';
import type {
  BrowserBox,
  BrowserConsoleEvent,
  BrowserElementInspection,
  BrowserNetworkEvent,
  BrowserNativeAction,
  BrowserNativeRequest,
  BrowserNativeResult,
  BrowserNativeSnapshot,
  BrowserScrollDirection,
  DesignAnchor,
  DesignAnchorDetail,
  DesignSelectionScreenshot,
  DesignStrokePoint,
} from '../types/bridge';

export type NativeBrowserBox = BrowserBox;

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

export interface NativeBrowserAgentAction {
  requestId: string;
  browserSessionId: string;
  action: BrowserNativeAction;
  url?: string;
  x?: number;
  y?: number;
  selector?: string;
  text?: string;
  key?: string;
  direction?: BrowserScrollDirection;
  pixels?: number;
  viewport?: BrowserNativeRequest['viewport'];
  clearNetworkLog?: boolean;
  clearConsoleLog?: boolean;
}

export interface NativeBrowserAgentResult {
  requestId: string;
  ok: boolean;
  snapshot?: BrowserNativeSnapshot;
  inspection?: BrowserElementInspection;
  networkEvents?: BrowserNetworkEvent[];
  consoleEvents?: BrowserConsoleEvent[];
  error?: string;
}

export function nativeBrowserAgentActionFromRequest(
  request: BrowserNativeRequest,
): NativeBrowserAgentAction {
  return {
    requestId: request.requestId,
    browserSessionId: request.browserSessionId,
    action: request.action,
    x: request.x,
    y: request.y,
    selector: request.selector,
    text: request.text,
    key: request.key,
    direction: request.direction,
    pixels: request.pixels,
    ...(request.viewport ? { viewport: request.viewport } : {}),
    ...(request.clearNetworkLog !== undefined ? { clearNetworkLog: request.clearNetworkLog } : {}),
    ...(request.clearConsoleLog !== undefined ? { clearConsoleLog: request.clearConsoleLog } : {}),
  };
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

export async function setNativeBrowserShown(
  browserSessionId: string,
  shown: boolean,
): Promise<void> {
  await window.droidControl!.nativeBrowserShown(browserSessionId, shown);
}

async function openNativeBrowser(
  browserSessionId: string,
  url: string,
  viewport?: { width: number; height: number; deviceScaleFactor: number },
): Promise<void> {
  if (!isDesktop()) return;
  await window.droidControl!.nativeBrowserOpen(browserSessionId, url, viewport);
}

async function closeNativeBrowser(browserSessionId: string): Promise<void> {
  if (!isDesktop()) return;
  await window.droidControl!.nativeBrowserClose(browserSessionId);
}

async function reloadNativeBrowser(browserSessionId: string): Promise<void> {
  if (!isDesktop()) return;
  await window.droidControl!.nativeBrowserReload(browserSessionId);
}

export async function goBackNativeBrowser(browserSessionId: string): Promise<boolean> {
  if (!isDesktop()) return false;
  return window.droidControl!.nativeBrowserGoBack(browserSessionId);
}

export async function goForwardNativeBrowser(browserSessionId: string): Promise<boolean> {
  if (!isDesktop()) return false;
  return window.droidControl!.nativeBrowserGoForward(browserSessionId);
}

async function runNativeBrowserAgentAction(
  request: NativeBrowserAgentAction,
  timeoutMs = 10_000,
): Promise<NativeBrowserAgentResult> {
  if (!isDesktop()) throw new Error('The browser is only available in the desktop app.');
  return new Promise((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      fn();
    };
    const timeout = window.setTimeout(() => {
      finish(() => {
        reject(new Error(`The browser action ${request.action} timed out.`));
      });
    }, timeoutMs);

    unlisten = window.droidControl!.onNativeBrowserAgentResult((result) => {
      if (result.requestId !== request.requestId) return;
      window.clearTimeout(timeout);
      finish(() => {
        resolve(result);
      });
    });
    window
      .droidControl!.nativeBrowserAgentAction(request)
      .then((result) => {
        if (result?.requestId !== request.requestId) return;
        window.clearTimeout(timeout);
        finish(() => {
          resolve(result);
        });
      })
      .catch((err) => {
        window.clearTimeout(timeout);
        finish(() => {
          reject(err);
        });
      });
  });
}

export async function performDesktopNativeBrowserRequest(
  request: BrowserNativeRequest,
): Promise<BrowserNativeResult> {
  try {
    if (!isDesktop()) throw new Error('The browser is only available in the desktop app.');
    if (request.action === 'close') {
      await closeNativeBrowser(request.browserSessionId);
      return nativeResult(request, true);
    }
    if (request.action === 'open') {
      const targetUrl = request.url ?? 'about:blank';
      await openNativeBrowser(request.browserSessionId, targetUrl, request.viewport);
      return nativeResult(request, true, await detachedSnapshot(request, targetUrl));
    }
    if (request.action === 'reload') {
      const loaded = waitForNextNativeBrowserLoad(request.browserSessionId).catch(() => undefined);
      await reloadNativeBrowser(request.browserSessionId);
      const event = await loaded;
      return nativeResult(request, true, await detachedSnapshot(request, event?.url));
    }
    if (request.action === 'goBack' || request.action === 'goForward') {
      const loaded = waitForNextNativeBrowserLoad(request.browserSessionId).catch(() => undefined);
      const moved =
        request.action === 'goBack'
          ? await goBackNativeBrowser(request.browserSessionId)
          : await goForwardNativeBrowser(request.browserSessionId);
      const event = moved ? await loaded : undefined;
      return nativeResult(request, true, await detachedSnapshot(request, event?.url));
    }
    if (request.action === 'capture') {
      const image = await nativeBrowserCapture(request.browserSessionId, request.box, {
        fullPage: request.fullPage,
        deviceScaleFactor: request.deviceScaleFactor,
      });
      return { ...nativeResult(request, true), image };
    }
    const result = await runNativeBrowserAgentAction(nativeBrowserAgentActionFromRequest(request));
    return {
      ...nativeResult(request, result.ok),
      snapshot: result.snapshot,
      inspection: result.inspection,
      networkEvents: result.networkEvents,
      consoleEvents: result.consoleEvents,
      error: result.error,
    };
  } catch (error) {
    return nativeResult(request, false, undefined, ipcErrorMessage(error));
  }
}

// Electron wraps errors thrown in main as "Error invoking remote method '…':
// Error: <message>"; only the message means anything to an agent or the user.
function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}

function nativeResult(
  request: BrowserNativeRequest,
  ok: boolean,
  snapshot?: BrowserNativeSnapshot,
  error?: string,
): BrowserNativeResult {
  return {
    requestId: request.requestId,
    appSessionId: request.appSessionId,
    browserSessionId: request.browserSessionId,
    ok,
    snapshot,
    error,
  };
}

async function detachedSnapshot(
  request: BrowserNativeRequest,
  fallbackUrl = 'about:blank',
): Promise<BrowserNativeSnapshot> {
  const result = await runNativeBrowserAgentAction({
    requestId: `${request.requestId}:snapshot`,
    browserSessionId: request.browserSessionId,
    action: 'snapshot',
  }).catch(() => undefined);
  return result?.ok && result.snapshot
    ? result.snapshot
    : { url: fallbackUrl, scroll: { x: 0, y: 0 }, refs: [] };
}

export interface NativeBrowserCaptureOptions {
  fullPage?: boolean;
  deviceScaleFactor?: number;
}

async function nativeBrowserCapture(
  browserSessionId: string,
  box?: NativeBrowserBox,
  options?: NativeBrowserCaptureOptions,
): Promise<string | undefined> {
  if (!isDesktop()) return undefined;
  return window.droidControl!.nativeBrowserCapture(browserSessionId, box, options);
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

export async function onNativeBrowserSelection(
  handler: (selection: NativeBrowserSelection) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
  return window.droidControl!.onNativeBrowserSelection(handler);
}

export async function onNativeBrowserDesignPrompt(
  handler: (prompt: NativeBrowserDesignPrompt) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
  return window.droidControl!.onNativeBrowserDesignPrompt(handler);
}

export async function onNativeBrowserLoaded(
  handler: (event: NativeBrowserLoaded) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
  return window.droidControl!.onNativeBrowserLoaded(handler);
}

export async function onNativeBrowserLoadFailed(
  handler: (event: NativeBrowserLoadFailed) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
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

async function waitForNextNativeBrowserLoad(
  browserSessionId: string,
  timeoutMs = 8_000,
): Promise<NativeBrowserLoaded> {
  if (!isDesktop()) throw new Error('The browser is only available in the desktop app.');
  return new Promise((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      fn();
    };
    const timeout = window.setTimeout(() => {
      finish(() => {
        reject(new Error('The browser page did not finish loading in time.'));
      });
    }, timeoutMs);
    void onNativeBrowserLoaded((event) => {
      if (event.browserSessionId !== browserSessionId) return;
      window.clearTimeout(timeout);
      finish(() => {
        resolve(event);
      });
    })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      })
      .catch((err) => {
        window.clearTimeout(timeout);
        finish(() => {
          reject(err);
        });
      });
  });
}
