import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { canvasClient } from './canvasClient';
import { keepImageCoverCapture, useKitCapture } from './kitCaptures';

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
  await unmount();

  class FakeImage {
    naturalWidth = 1;
    naturalHeight = 1;
    async decode() {}
  }
  class FakeCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
    getContext() {
      return { drawImage() {} };
    }
    async convertToBlob() {
      return new Blob(['png']);
    }
  }
  for (const [key, value] of Object.entries({ Image: FakeImage, OffscreenCanvas: FakeCanvas })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(canvasClient.designSystems, 'saveCapture', async () => {});
  const raceRef = { ...ref, id: 'saved-during-read' };
  function Race() {
    shown = useKitCapture(raceRef, 'cover');
    return null;
  }
  await act(async () => root.render(createElement(Race)));
  assert.equal(read.mock.callCount(), 4);
  await unmount();
  await keepImageCoverCapture(raceRef, 'image', { widthPx: 1, heightPx: 1 });
  // Both modes of 512 more covers push the saved entry past the entry cap.
  for (let i = 0; i < 512; i += 1) {
    await keepImageCoverCapture({ ...ref, id: `eviction-${String(i)}` }, 'image', {
      widthPx: 1,
      heightPx: 1,
    });
  }
  await act(async () => root.render(createElement(Race)));
  assert.equal(shown, undefined, 'the saved entry was evicted');
  assert.equal(read.mock.callCount(), 4, 'the stale read still occupies its slot');
  await act(async () => settle(null));
  assert.equal(read.mock.callCount(), 5, 'the mounted consumer gets exactly one replacement read');
  await act(async () => settle('saved-png'));
  assert.equal(shown, 'data:image/png;base64,saved-png');
  assert.equal(read.mock.callCount(), 5);
});
