import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
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

type PendingOpen = { appSessionId: string } | null;

// Faithful fake of main's pending click: reads leave it, a matching ack clears it.
async function mountWithNotifications(t: TestContext, main: { pending: PendingOpen }) {
  const acks: string[] = [];
  const storage = new Map<string, string>();
  const document = {
    nodeType: 9,
    activeElement: null,
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  };
  let push!: (payload: { appSessionId: string }) => void;
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
      onNotificationActivate: (handler: typeof push) => {
        push = handler;
        return () => {};
      },
      readPendingNotificationSession: async () => main.pending,
      ackNotificationActivate: async (appSessionId: string) => {
        acks.push(appSessionId);
        if (main.pending?.appSessionId === appSessionId) main.pending = null;
        return { ok: true };
      },
    },
  };
  const restoreGlobals: Array<() => void> = [];
  for (const [key, value] of Object.entries({ window, document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restoreGlobals.push(() => {
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
  t.after(async () => {
    await act(async () => root.unmount());
    for (const restore of restoreGlobals) restore();
  });
  await act(async () => root.render(createElement(StoreProvider, null, createElement(Harness))));
  return { acks, getState: () => getState(), dispatch: (action: Action) => dispatch(action), push };
}

test('a notification click for a chat that has not loaded opens it once the chat arrives', async (t) => {
  const main = { pending: { appSessionId: 'restored' } as PendingOpen };
  const app = await mountWithNotifications(t, main);
  assert.deepEqual(app.acks, []);
  assert.deepEqual(main.pending, { appSessionId: 'restored' });

  await act(async () => {
    app.dispatch({ type: 'SESSION_LIST', sessions: [sessionSummary('restored')] });
  });
  assert.equal(app.getState().activeAppSessionId, 'restored');
  assert.deepEqual(app.acks, ['restored']);
  assert.equal(main.pending, null);
});

test('a late push for an older click does not replace the chat main opened', async (t) => {
  const main = { pending: { appSessionId: 'newer' } as PendingOpen };
  const app = await mountWithNotifications(t, main);
  await act(async () => {
    app.dispatch({
      type: 'SESSION_LIST',
      sessions: [sessionSummary('older'), sessionSummary('newer')],
    });
  });
  assert.equal(app.getState().activeAppSessionId, 'newer');

  await act(async () => app.push({ appSessionId: 'older' }));
  assert.equal(app.getState().activeAppSessionId, 'newer');
  assert.deepEqual(app.acks, ['newer']);
});
