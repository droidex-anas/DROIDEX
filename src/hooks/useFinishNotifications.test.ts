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

async function mountWithNotifications(
  t: TestContext,
  readPending: () => Promise<PendingOpen>,
  acks: string[],
) {
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
      readPendingNotificationSession: readPending,
      ackNotificationActivate: async (appSessionId: string) => {
        acks.push(appSessionId);
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
  return { getState: () => getState(), dispatch: (action: Action) => dispatch(action), push };
}

test('a notification click for a chat that has not loaded opens it once the chat arrives', async (t) => {
  // Main keeps the pending open until a matching ack.
  const acks: string[] = [];
  const app = await mountWithNotifications(t, async () => ({ appSessionId: 'restored' }), acks);
  assert.deepEqual(acks, []);

  await act(async () => {
    app.dispatch({ type: 'SESSION_LIST', sessions: [sessionSummary('restored')] });
  });
  assert.equal(app.getState().activeAppSessionId, 'restored');
  assert.deepEqual(acks, ['restored']);
});

test('a read that settles after a newer click does not reopen the older chat', async (t) => {
  const delayedReads: Array<(pending: PendingOpen) => void> = [];
  let readCount = 0;
  const acks: string[] = [];
  const app = await mountWithNotifications(
    t,
    () => {
      readCount += 1;
      if (readCount === 1) return Promise.resolve({ appSessionId: 'older' });
      return new Promise((resolve) => delayedReads.push(resolve));
    },
    acks,
  );

  await act(async () => {
    app.dispatch({
      type: 'SESSION_LIST',
      sessions: [sessionSummary('older'), sessionSummary('newer')],
    });
  });
  await act(async () => app.push({ appSessionId: 'newer' }));
  assert.equal(delayedReads.length, 2);
  const [olderRead, newerRead] = delayedReads;
  await act(async () => newerRead({ appSessionId: 'newer' }));
  await act(async () => olderRead({ appSessionId: 'older' }));
  assert.equal(app.getState().activeAppSessionId, 'newer');
  assert.deepEqual(acks, ['newer']);
});
