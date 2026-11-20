import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useUtilityPaneWidth } from './useUtilityPaneWidth';

async function setup(
  t: test.TestContext,
  stored: Record<string, string> = {},
  storageFails = false,
) {
  let available = 1600;
  const storage = new Map(Object.entries(stored));
  let observeResize = () => {};
  let disconnected = false;
  const node = { getBoundingClientRect: () => ({ width: available }) };
  const document = {
    nodeType: 9,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    document,
    innerWidth: 1600,
    HTMLIFrameElement: class {},
  };
  const globals = {
    document,
    window,
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: {
      getItem(key: string) {
        if (storageFails) throw new Error('Storage unavailable');
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (storageFails) throw new Error('Storage unavailable');
        storage.set(key, value);
      },
    },
    ResizeObserver: class {
      constructor(callback: () => void) {
        observeResize = callback;
      }
      observe(target: unknown) {
        assert.equal(target, node);
      }
      disconnect() {
        disconnected = true;
      }
    },
  };
  const descriptors = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
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
  const ref = { current: node as unknown as HTMLDivElement };
  let pane!: ReturnType<typeof useUtilityPaneWidth>;
  function Harness() {
    pane = useUtilityPaneWidth(ref);
    return null;
  }
  const root = createRoot(container as unknown as HTMLElement);
  let unmounted = false;
  async function unmount() {
    if (!unmounted) await act(async () => root.unmount());
    unmounted = true;
  }
  t.after(async () => {
    await unmount();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await act(async () => root.render(createElement(Harness)));
  return {
    pane: () => pane,
    storage,
    async resize(width: number) {
      available = width;
      await act(async () => {
        observeResize();
      });
    },
    async drag(width: number) {
      await act(async () => pane.setWidth(width));
    },
    async finish(width: number) {
      await act(async () => pane.persistWidth(width));
    },
    unmount,
    cleanedUp: () => disconnected,
  };
}

test('clamps resizing to the row and persists only the completed drag', async (t) => {
  const h = await setup(t, { 'droid-utility-pane-width': '900' });
  assert.equal(h.pane().width, 900);
  assert.equal(h.pane().maxWidth, 980);
  await h.resize(1200);
  assert.equal(h.pane().contentRowWidth, 1200);
  assert.equal(h.pane().width, 680);
  assert.equal(h.pane().maxWidth, 680);
  assert.equal(h.storage.get('droid-utility-pane-width'), '900');
  await h.drag(600.4);
  assert.equal(h.pane().width, 600.4);
  assert.equal(h.storage.get('droid-utility-pane-width'), '900');
  await h.finish(999);
  assert.equal(h.pane().width, 680);
  assert.equal(h.storage.get('droid-utility-pane-width'), '680');
  await h.finish(100);
  assert.equal(h.pane().width, 420);
  assert.equal(h.storage.get('droid-utility-pane-width'), '420');
  await h.resize(800);
  assert.equal(h.pane().maxWidth, 420);
  await h.unmount();
  assert.equal(h.cleanedUp(), true);
});

for (const [name, stored, expected] of [
  ['empty storage', {}, 560],
  ['legacy width', { 'droid-browser-pane-width': '700' }, 700],
  ['invalid stored width', { 'droid-utility-pane-width': 'invalid' }, 560],
  ['oversized stored width', { 'droid-utility-pane-width': '2000' }, 980],
  [
    'current width takes precedence',
    {
      'droid-utility-pane-width': '650.6',
      'droid-browser-pane-width': '700',
    },
    651,
  ],
] as const) {
  test(`restores sizing with ${name}`, async (t) => {
    const h = await setup(t, stored);
    assert.equal(h.pane().width, expected);
  });
}

test('storage failures preserve usable in-memory sizing', async (t) => {
  const h = await setup(t, {}, true);
  assert.equal(h.pane().width, 560);
  await h.finish(720);
  assert.equal(h.pane().width, 720);
  assert.equal(h.storage.size, 0);
});
