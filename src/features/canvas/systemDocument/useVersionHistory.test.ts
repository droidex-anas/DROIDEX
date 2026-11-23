import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { canvasClient } from '../canvasClient';
import { useVersionHistory } from './useVersionHistory';
import type { DesignSystemVersionContent } from '@droidex/protocol';

async function mountHistory(t: TestContext, id: string) {
  t.after(async () => unmount());
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
  let history!: ReturnType<typeof useVersionHistory>;
  function Harness() {
    history = useVersionHistory(id);
    return null;
  }
  const root = createRoot(container as unknown as HTMLElement);
  const unmount = () => act(async () => root.unmount());
  await act(async () => root.render(createElement(Harness)));
  return { current: () => history, unmount };
}

const content: DesignSystemVersionContent = { name: 'Kit', cover: null, sections: [] };
const versions = [3, 2, 1].map((version) => ({
  version,
  savedAt: new Date(0).toISOString(),
  savedBy: { actor: 'user' as const },
}));

for (const stop of ['unmount', 'close'] as const) {
  test(`${stop} stops the version summary chain before the next read`, async (t) => {
    t.mock.method(canvasClient.designSystems, 'versions', async () => versions);
    const reads: number[] = [];
    let finish!: (value: DesignSystemVersionContent) => void;
    const pending = new Promise<DesignSystemVersionContent>((resolve) => {
      finish = resolve;
    });
    t.mock.method(
      canvasClient.designSystems,
      'readVersionContent',
      async ({ version }: { version: number }) => {
        reads.push(version);
        return reads.length === 1 ? pending : content;
      },
    );
    const app = await mountHistory(t, stop);
    await act(async () => app.current().openMenu());
    assert.deepEqual(reads, [3]);
    if (stop === 'unmount') await app.unmount();
    else await act(async () => app.current().close());
    await act(async () => finish(content));
    assert.deepEqual(reads, [3], 'only the already-dispatched read may finish');
  });
}

test('history summarizes each immutable version once and handles empty and failed lists', async (t) => {
  t.mock.method(canvasClient.designSystems, 'versions', async () => versions);
  const reads: number[] = [];
  t.mock.method(
    canvasClient.designSystems,
    'readVersionContent',
    async ({ version }: { version: number }) => {
      reads.push(version);
      return content;
    },
  );
  const app = await mountHistory(t, 'healthy');
  await act(async () => app.current().openMenu());
  assert.deepEqual(
    [...app.current().summarized],
    [
      [3, 'No changes'],
      [2, 'No changes'],
      [1, 'Created'],
    ],
  );
  assert.deepEqual(reads, [3, 2, 1]);
  await act(async () => app.current().close());
  await act(async () => app.current().openMenu());
  assert.equal(reads.length, 3);
  t.mock.method(canvasClient.designSystems, 'versions', async () => []);
  await act(async () => app.current().openMenu());
  assert.deepEqual(app.current().list, { status: 'listed', versions: [] });
  assert.equal(app.current().summarized.size, 0);
  t.mock.method(canvasClient.designSystems, 'versions', async () => {
    throw new Error('Unavailable');
  });
  await act(async () => app.current().openMenu());
  assert.deepEqual(app.current().list, { status: 'failed', message: 'Unavailable' });
});
