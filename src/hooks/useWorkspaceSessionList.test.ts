import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ClientCommand } from '@droidex/protocol';
import { bridge } from '../lib/bridge';
import type { WorkspaceScope } from '../lib/workspaces';
import { StoreProvider } from './useStore';
import { useWorkspaceSessionList } from './useWorkspaceSessionList';

test('only ready scopes subscribe, keeping current scope and reveal choices through reconnects', async (t) => {
  const document = {
    nodeType: 9,
    activeElement: null,
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    document,
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
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
  const lists: ClientCommand[] = [];
  t.mock.method(bridge, 'send', (command: ClientCommand) => {
    if (command.type === 'sessions.list') lists.push(command);
    return true;
  });
  const reconnects = new Set<() => void>();
  t.mock.method(bridge, 'onReconnected', (listener: () => void) => {
    reconnects.add(listener);
    return () => reconnects.delete(listener);
  });
  const reconnect = () => {
    for (const listener of reconnects) listener();
  };
  let reveal!: (cwds: readonly string[]) => void;
  function Harness({ scopes, enabled }: { scopes: WorkspaceScope[]; enabled: boolean }) {
    reveal = useWorkspaceSessionList(scopes, enabled);
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
  const render = (scopes: WorkspaceScope[], enabled: boolean) =>
    act(async () => {
      root.render(createElement(StoreProvider, null, createElement(Harness, { scopes, enabled })));
    });
  const scopes = [{ cwd: '/repo', executionCwds: ['/repo', '/linked', '/repo'] }];
  await render(scopes, false);
  reconnect();
  assert.equal(lists.length, 0);
  await render(scopes, true);
  assert.equal(lists.length, 1);
  await act(async () => reveal(['/linked']));
  reconnect();
  assert.equal(lists.length, 3);
  assert.deepEqual(lists[2], {
    type: 'sessions.list',
    workspaceCwds: ['/repo', '/linked'],
    includePlainChats: true,
    revealEarlierCwds: ['/linked'],
  });
  await render([], true);
  reconnect();
  assert.equal(lists.length, 5);
  assert.deepEqual(lists[4], {
    type: 'sessions.list',
    workspaceCwds: [],
    includePlainChats: true,
    revealEarlierCwds: ['/linked'],
  });
  await render(scopes, false);
  reconnect();
  assert.equal(lists.length, 5);
  assert.equal(reconnects.size, 0);
});
