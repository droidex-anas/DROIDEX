import type { AppServerClient } from './appServer.js';
import type { PermissionOutcome } from '../../protocol.js';
import { CodexSession } from './codexSession.js';

/**
 * An app-server client that records notification and request handlers and
 * answers requests with `request`, or with an empty catalog page.
 */
export function fakeClient(request: (method: string, params: Record<string, unknown>) => unknown) {
  const notifications = new Map<string, (params: unknown) => void>();
  const requests = new Map<string, (params: unknown) => Promise<unknown>>();
  let onClose: (error: Error, cleanExit: boolean) => void = () => undefined;
  const client = {
    onNotification: (method: string, handler: (params: unknown) => void) =>
      notifications.set(method, handler),
    onRequest: (method: string, handler: (params: unknown) => Promise<unknown>) =>
      requests.set(method, handler),
    onUnsupportedRequest: () => undefined,
    onClose: (listener: typeof onClose) => {
      onClose = listener;
    },
    notify: () => undefined,
    close: () => Promise.resolve(),
    request: async (method: string, params: Record<string, unknown>) => {
      if (method === 'skills/list') return { data: [] };
      if (method === 'plugin/installed') return { marketplaces: [] };
      return (await request(method, params)) ?? { data: [], nextCursor: null };
    },
  } as unknown as AppServerClient;
  return {
    client,
    notifications,
    requests,
    endProcess: (error: Error) => {
      onClose(error, false);
    },
  };
}

export function codexSession(
  client: AppServerClient,
  appSessionId: string,
  cwd = '/tmp',
  requestApproval: () => Promise<PermissionOutcome> = () => Promise.reject(new Error('unused')),
): CodexSession {
  return new CodexSession({
    appSessionId,
    client,
    cwd,
    autonomy: 'low',
    model: {},
    interactions: {
      requestApproval,
      requestQuestion: () => Promise.resolve({ cancelled: true, answers: [] }),
      isActive: () => true,
      cancelPending: () => undefined,
    },
  });
}
