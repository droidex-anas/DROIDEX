import type { BrowserNativeRequest, BrowserNativeResult } from '../protocol.js';
import { boundedInt } from '../values.js';

// The desktop app's main process owns the browser pages, and spawns this
// process with a private IPC channel. A request goes out under its own id and
// is answered by a `browser.result` with that id. Nothing is ever resent: a
// request still waiting when the channel closes, or past its timeout, fails,
// and a late answer is dropped.

const BROWSER_REQUEST_TIMEOUT_MS = boundedInt(
  process.env.DROID_CONTROL_BROWSER_NATIVE_TIMEOUT_MS,
  12_000,
  1_000,
  60_000,
);

export type RequestBrowser = (request: BrowserNativeRequest) => Promise<BrowserNativeResult>;

export type BrowserChannelProcess = Pick<NodeJS.Process, 'on' | 'send' | 'connected'>;

interface Pending {
  resolve: (result: BrowserNativeResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createDesktopBrowserChannel(
  channel: BrowserChannelProcess = process,
  timeoutMs = BROWSER_REQUEST_TIMEOUT_MS,
): RequestBrowser {
  const pending = new Map<string, Pending>();

  function settle(id: string): Pending | undefined {
    const entry = pending.get(id);
    if (!entry) return undefined;
    pending.delete(id);
    clearTimeout(entry.timer);
    return entry;
  }

  channel.on('message', (message: unknown) => {
    if (!isBrowserResult(message)) return;
    settle(message.id)?.resolve(message.result);
  });
  channel.on('disconnect', () => {
    for (const id of [...pending.keys()]) {
      settle(id)?.reject(new Error('The DROIDEX browser closed before it answered.'));
    }
  });

  return (request) => {
    const send = channel.send?.bind(channel);
    if (!send || !channel.connected) {
      return Promise.reject(new Error('The browser is only available in the DROIDEX desktop app.'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        settle(request.requestId)?.reject(
          new Error(
            `DROIDEX browser did not respond to ${request.action} within ${String(timeoutMs)}ms.`,
          ),
        );
      }, timeoutMs);
      pending.set(request.requestId, { resolve, reject, timer });
      send({ type: 'browser.request', id: request.requestId, request }, (error) => {
        if (error) settle(request.requestId)?.reject(error);
      });
    });
  };
}

function isBrowserResult(
  message: unknown,
): message is { type: 'browser.result'; id: string; result: BrowserNativeResult } {
  if (!message || typeof message !== 'object') return false;
  const { type, id, result } = message as Record<string, unknown>;
  return (
    type === 'browser.result' && typeof id === 'string' && !!result && typeof result === 'object'
  );
}
