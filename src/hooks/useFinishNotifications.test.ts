import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { bridge } from '../lib/bridge';
import { sessionSummary } from '../test/sessionSummary';
import { useFinishNotifications } from './useFinishNotifications';
import {
  StoreProvider,
  useStoreApi,
  useStoreDispatch,
  type Action,
  type AppState,
} from './useStore';

test('a notification click before the session list opens its chat once the list arrives', async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
  });
  const storage = new Map<string, string>();
  const document = {
    nodeType: 9,
    activeElement: null,
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  };
  // Main's pending open is take-and-clear: the renderer's first pull consumes it.
  let pending: { appSessionId: string } | null = { appSessionId: 'restored' };
  const acks: string[] = [];
  const window = {
    document,
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    droidex: {
      onNotificationActivate: () => () => {},
      takePendingNotificationSession: async () => {
        const taken = pending;
        pending = null;
        return taken;
      },
      ackNotificationActivate: async (appSessionId: string) => {
        acks.push(appSessionId);
        return { ok: true };
      },
    },
  };
  for (const [key, value] of Object.entries({ window, document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(bridge, 'subscribeBatch', () => () => {});
  t.mock.method(bridge, 'subscribeRuntimeReplaced', () => () => {});
  t.mock.method(bridge, 'send', () => true);
  let getState!: () => AppState;
  let dispatch!: (action: Action) => void;
  function Harness() {
    useFinishNotifications(true);
    getState = useStoreApi().getState;
    dispatch = useStoreDispatch();
    return null;
  }
  const container = {
    nodeType: 1,
    tagName: 'DIV',
    ownerDocument: document,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    addEventListener() {},
    removeEventListener() {},
    textContent: '',
  };
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => root.render(createElement(StoreProvider, null, createElement(Harness))));
  assert.equal(pending, null);
  assert.deepEqual(acks, []);

  await act(async () => {
    dispatch({ type: 'SESSION_LIST', sessions: [sessionSummary('restored')] });
  });
  assert.equal(getState().activeAppSessionId, 'restored');
  assert.deepEqual(acks, ['restored']);
});
