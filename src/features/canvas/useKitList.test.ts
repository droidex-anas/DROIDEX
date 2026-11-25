import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { setTransportHealth } from '../../lib/runtimeHealth';
import { fakeCanvasBridge } from '../../test/canvasTransport';
import { canvasClient } from './canvasClient';
import { CanvasClient } from './client';
import { useKitList } from './useKitList';
import type { DesignSystemSummary } from '@droidex/protocol';

test('kit readers share reads, invalidation, failures and socket recovery', async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
    setTransportHealth('disconnected');
  });
  const document = {
    nodeType: 9,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  const window = { document, HTMLIFrameElement: class {}, droidex: {} };
  for (const [key, value] of Object.entries({ window, document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
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
  const bridge = fakeCanvasBridge();
  const client = new CanvasClient(bridge.transport);
  t.mock.method(
    canvasClient.designSystems,
    'list',
    client.designSystems.list.bind(client.designSystems),
  );
  let subscriptions = 0;
  t.mock.method(canvasClient, 'subscribeDesignSystems', (listener: (id: string) => void) => {
    subscriptions++;
    const stop = client.subscribeDesignSystems(listener);
    return () => {
      subscriptions--;
      stop();
    };
  });
  const root = createRoot(container as unknown as HTMLElement);
  const readers: ReturnType<typeof useKitList>[] = [];
  function Reader({ index }: { index: number }) {
    readers[index] = useKitList();
    return null;
  }
  const render = (count: number) =>
    act(async () =>
      root.render(
        Array.from({ length: count }, (_, index) => createElement(Reader, { key: index, index })),
      ),
    );
  const count = () => bridge.count('canvas.listDesignSystems');
  const reply = (systems: DesignSystemSummary[] = []) =>
    act(async () =>
      bridge.deliver({
        type: 'canvas.result',
        requestId: bridge.last('canvas.listDesignSystems').requestId,
        ok: true,
        reply: { kind: 'designSystems', systems },
      }),
    );
  const change = () => bridge.deliver({ type: 'canvas.designSystemsChanged', id: 'kit' });
  const kit: DesignSystemSummary = {
    id: 'kit',
    name: 'Current kit',
    version: 2,
    kind: 'user',
    cover: false,
    proposal: false,
    savedAt: null,
    swatches: {
      light: { surface: 'white', accent: 'blue' },
      dark: { surface: 'black', accent: 'blue' },
    },
  };

  setTransportHealth('disconnected');
  await render(50);
  assert.equal(count(), 0, 'never read offline');
  await act(async () => setTransportHealth('connected'));
  assert.equal(count(), 1, '50 readers share the first request');
  assert.equal(subscriptions, 1);
  await reply();
  assert.ok(readers.every(({ list }) => list.status === 'listed' && list.systems.length === 0));
  await render(51);
  assert.equal(count(), 1, 'a current list needs no new request');
  assert.strictEqual(readers[50].list, readers[0].list);

  await act(async () => {
    change();
    change();
    change();
  });
  assert.equal(count(), 2);
  await reply([{ ...kit, name: 'Obsolete kit', version: 1 }]);
  assert.equal(count(), 3, 'in-flight changes queue exactly one follow-up');
  assert.deepEqual(readers[0].list, { status: 'listed', systems: [] });
  await reply([kit]);
  assert.ok(
    readers.every(({ list }) => list.status === 'listed' && list.systems[0].name === kit.name),
  );
  assert.equal(count(), 3);
  await act(async () => change());
  assert.equal(count(), 4, 'one change means one read');
  await reply([kit]);

  await act(async () => readers[0].reread());
  assert.deepEqual(readers[0].list, { status: 'listed', systems: [kit] });
  await act(async () =>
    bridge.deliver({
      type: 'canvas.result',
      requestId: bridge.last('canvas.listDesignSystems').requestId,
      ok: false,
      error: { code: 'not_found', message: 'Kit list unavailable' },
    }),
  );
  assert.ok(
    readers.every(
      ({ list }) => list.status === 'failed' && list.message === 'Kit list unavailable',
    ),
  );
  await act(async () => readers[1].retry());
  assert.ok(readers.every(({ list }) => list.status === 'loading'));
  assert.equal(count(), 6);
  await reply([kit]);

  await act(async () => readers[0].reread());
  const lostRequestId = bridge.last('canvas.listDesignSystems').requestId;
  assert.equal(count(), 7);
  await act(async () => setTransportHealth('disconnected'));
  await act(async () => readers[0].reread());
  assert.equal(count(), 7);
  await act(async () => setTransportHealth('connected'));
  assert.equal(count(), 8, 'reconnect starts a read without waiting for the lost reply');
  await act(async () =>
    bridge.deliver({
      type: 'canvas.result',
      requestId: lostRequestId,
      ok: true,
      reply: { kind: 'designSystems', systems: [] },
    }),
  );
  assert.deepEqual(readers[0].list, { status: 'listed', systems: [kit] });
  assert.equal(count(), 8, 'the abandoned read cannot start another request');
  await reply([{ ...kit, name: 'Renamed while offline' }]);
  assert.ok(
    readers.every(
      ({ list }) => list.status === 'listed' && list.systems[0].name === 'Renamed while offline',
    ),
  );
  await render(0);
  assert.equal(subscriptions, 0);
  await act(async () => change());
  assert.equal(count(), 8, 'last unmount releases the change watch');
});
