import type {
  BrowserNativeAction,
  BrowserNativeRequest,
  BrowserNativeResult,
} from '../types/bridge';
import { closeBrowserPage, withBrowserPage } from './browserHost';
import { isDesktop } from './desktop';
import { performDesktopNativeBrowserRequest } from './nativeBrowser';

// Outside the desktop app the pane's iframe answers browser requests.
export interface NativeBrowserController {
  perform(request: BrowserNativeRequest): Promise<BrowserNativeResult>;
}

let controller: NativeBrowserController | null = null;
const waiters = new Set<() => void>();

export function registerNativeBrowserController(next: NativeBrowserController): () => void {
  controller = next;
  for (const notify of waiters) notify();
  waiters.clear();
  return () => {
    if (controller === next) controller = null;
  };
}

// Reading the logs or recording the viewport never needs the page itself.
const PAGELESS_ACTIONS = new Set<BrowserNativeAction>(['close', 'resize', 'network', 'console']);

// In the desktop app an agent request wakes the chat's page in the Browser
// host, mounting it if needed, and keeps it awake until the request settles,
// whether or not the pane is open.
export async function performNativeBrowserRequest(
  request: BrowserNativeRequest,
  savedUrl?: string,
): Promise<BrowserNativeResult> {
  if (isDesktop()) {
    if (request.action === 'close') closeBrowserPage(request.browserSessionId);
    if (PAGELESS_ACTIONS.has(request.action)) return performDesktopNativeBrowserRequest(request);
    return withBrowserPage(
      request.browserSessionId,
      () => performDesktopNativeBrowserRequest(request),
      savedUrl,
    );
  }
  const active = controller ?? (await waitForController(8_000));
  return active.perform(request);
}

function waitForController(timeoutMs: number): Promise<NativeBrowserController> {
  if (controller) return Promise.resolve(controller);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      waiters.delete(notify);
      reject(new Error('The browser pane is not open.'));
    }, timeoutMs);
    const notify = () => {
      if (!controller) return;
      window.clearTimeout(timeout);
      waiters.delete(notify);
      resolve(controller);
    };
    waiters.add(notify);
  });
}
