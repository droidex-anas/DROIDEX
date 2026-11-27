import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useStagedAttachments } from './useStagedAttachments';

test('staging owns ordered intake, cutoff clearing, removal and discard clearing', async (t) => {
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
  const discarded: string[] = [];
  const discard = async (path: string) => {
    discarded.push(path);
  };
  let staged!: ReturnType<typeof useStagedAttachments<{ id: string; path: string }>>;
  function Harness() {
    staged = useStagedAttachments(discard);
    return null;
  }
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Harness))));
    assert.deepEqual(await staged.whenReady(1), []);
    assert.equal(staged.reserveSequence(), 0);
    assert.equal(staged.reserveSequence(5), 5);
    assert.equal(staged.reserveSequence(2), 2);
    assert.equal(staged.reserveSequence(), 6);
    await act(async () => {
      staged.insert({ id: 'late', path: '/late' }, 5);
      staged.insert({ id: 'early', path: '/early' }, 0);
    });
    assert.deepEqual(
      staged.items.map((item) => item.id),
      ['early', 'late'],
    );
    assert.deepEqual(await staged.whenReady(5), [{ id: 'early', path: '/early' }]);
    await act(async () => staged.clearReady(5));
    assert.deepEqual(staged.items, [{ id: 'late', path: '/late' }]);
    assert.deepEqual(discarded, []);
    await act(async () => {
      staged.remove('missing');
      staged.remove('late');
      staged.remove('late');
    });
    assert.deepEqual(discarded, ['/late']);
    const stamp = staged.additions.stamp();
    staged.additions.track(Promise.reject(new Error('encode failed')));
    await staged.whenReady(10);
    await act(async () => {
      staged.insert({ id: 'submitted', path: '/submitted' }, 6);
      staged.clear();
    });
    assert.equal(staged.additions.isStale(stamp), true);
    assert.deepEqual(discarded, ['/late']);
    await act(async () => {
      staged.insert({ id: 'abandoned', path: '/abandoned' }, 7);
      staged.clearAndDiscard();
      staged.clearAndDiscard();
    });
    assert.deepEqual(staged.items, []);
    assert.deepEqual(discarded, ['/late', '/abandoned']);
  } finally {
    await act(async () => root.unmount());
  }
});
