import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createCropMutations, createPendingAdditions } from './attachmentStaging';
import { useImageAttachments } from './useImageAttachments';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('a late older crop discards only its own file and preserves the newest crop', async (t) => {
  const pending: { resolve: (path: string) => void }[] = [];
  const discarded: string[] = [];
  let firstSave = true;
  const document = {
    nodeType: 9,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      let crop: unknown;
      return {
        getContext: () => ({
          drawImage(_image: unknown, x: number, y: number, width: number, height: number) {
            crop = { x, y, width, height };
          },
        }),
        toDataURL: () => JSON.stringify(crop),
      };
    },
  };
  const window = {
    document,
    HTMLIFrameElement: class {},
    droidex: {
      saveImage: () => {
        if (firstSave) {
          firstSave = false;
          return Promise.resolve('/original.png');
        }
        return new Promise<string>((resolve) => pending.push({ resolve }));
      },
      discardImage: async (path: string) => {
        discarded.push(path);
      },
    },
  };
  const globals = {
    window,
    document,
    IS_REACT_ACT_ENVIRONMENT: true,
    FileReader: class {
      result = 'data:image/png;base64,original';
      onload = () => {};
      readAsDataURL() {
        queueMicrotask(() => this.onload());
      }
    },
    Image: class {
      naturalWidth = 1000;
      naturalHeight = 1000;
      onload = () => {};
      set src(_value: string) {
        queueMicrotask(() => this.onload());
      }
    },
  };
  for (const [key, value] of Object.entries(globals)) {
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
  let attachments!: ReturnType<typeof useImageAttachments>;
  function Harness() {
    attachments = useImageAttachments('original');
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => attachments.addBlob(new Blob(['image'], { type: 'image/png' })));
    const id = attachments.images[0].id;
    const olderRect = { x: 100, y: 100, width: 100, height: 100 };
    const newerRect = { x: 200, y: 200, width: 200, height: 200 };
    let older!: Promise<void>;
    let newer!: Promise<void>;
    await act(async () => {
      older = attachments.applyCrop(id, olderRect);
    });
    await act(async () => {
      newer = attachments.applyCrop(id, newerRect);
    });
    assert.equal(pending.length, 2);
    await act(async () => {
      pending[1].resolve('/newer.png');
      await newer;
    });
    assert.equal(attachments.images[0].path, '/newer.png');
    await act(async () => {
      pending[0].resolve('/older.png');
      await older;
    });
    assert.equal(attachments.images[0].path, '/newer.png');
    assert.deepEqual(JSON.parse(attachments.images[0].preview), newerRect);
    assert.deepEqual(discarded, ['/original.png', '/older.png']);
  } finally {
    await act(async () => root.unmount());
  }
});

test('submit waits for a crop that starts while an addition is still encoding', async () => {
  const additions = createPendingAdditions();
  const crops = createCropMutations();
  const add = deferred();
  const crop = deferred();
  additions.track(add.promise);
  let ready = false;
  const waiting = (async () => {
    await additions.knownSettled();
    await crops.waitBeforeCutoff(1);
    ready = true;
  })();
  crops.track(0, crop.promise);
  add.resolve();
  await tick();
  assert.equal(ready, false);
  crop.resolve();
  await waiting;
  assert.equal(ready, true);
});

test('submit does not wait for a crop of an attachment past cutoff', async () => {
  const crops = createCropMutations();
  const crop = deferred();
  crops.track(1, crop.promise);
  await crops.waitBeforeCutoff(1);
  crop.resolve();
});
