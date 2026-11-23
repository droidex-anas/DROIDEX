import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { canvasClient } from './canvasClient';
import { useKitCapture } from './kitCaptures';

test('failed capture reads retry on remount, while absence stays cached and in-flight reads deduplicate', async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
  });
  const document = {
    nodeType: 9,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  const window = { document, HTMLIFrameElement: class {} };
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
  const root = createRoot(container as unknown as HTMLElement);
  const ref = { id: 'retry-capture', version: 1, mode: 'light' } as const;
  let settle: (png: string | null) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const read = t.mock.method(
    canvasClient.designSystems,
    'readCapture',
    () =>
      new Promise<string | null>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      }),
  );
  t.mock.method(console, 'error', () => {});
  let shown: string | null | undefined;
  function Probe() {
    shown = useKitCapture(ref, 'cover');
    return null;
  }
  const render = async () => {
    await act(async () => root.render(createElement(Probe)));
  };
  const unmount = async () => {
    await act(async () => root.render(null));
  };
  await render();
  await unmount();
  await render();
  assert.equal(read.mock.callCount(), 1);
  await act(async () => fail(new Error('transient read failure')));
  assert.equal(shown, null, 'a failed read lets current consumers fall back');
  await render();
  assert.equal(read.mock.callCount(), 1, 'a failure must not start a retry loop');
  await unmount();
  await render();
  assert.equal(read.mock.callCount(), 2, 'remount retries the failed read');
  await act(async () => settle('existing-png'));
  assert.equal(shown, 'data:image/png;base64,existing-png');
  await unmount();
  await render();
  assert.equal(read.mock.callCount(), 2);
  await unmount();
  function Absent() {
    shown = useKitCapture(ref, 'preview');
    return null;
  }
  await act(async () => root.render(createElement(Absent)));
  await act(async () => settle(null));
  assert.equal(shown, null);
  await unmount();
  await act(async () => root.render(createElement(Absent)));
  assert.equal(read.mock.callCount(), 3, 'absence remains cached');
});
