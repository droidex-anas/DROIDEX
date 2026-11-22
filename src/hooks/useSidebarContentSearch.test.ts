import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { bridge } from '../lib/bridge';
import { useSidebarContentSearch } from './useSidebarContentSearch';
import type { ServerEvent } from '@droidex/protocol';

test('content hits belong only to the current query, including during debounce', async (t) => {
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
  let receive: (event: ServerEvent) => void = () => {};
  t.mock.method(bridge, 'subscribe', (listener: typeof receive) => {
    receive = listener;
    return () => {};
  });
  const requests: string[] = [];
  t.mock.method(bridge, 'send', (command: { type: string; requestId?: string }) => {
    if (command.type === 'sessions.search' && command.requestId) requests.push(command.requestId);
    return true;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result!: ReturnType<typeof useSidebarContentSearch>;
  function Harness({ query }: { query: string }) {
    result = useSidebarContentSearch(query);
    return null;
  }
  const root = createRoot(container as unknown as HTMLElement);
  const render = async (query: string) => {
    await act(async () => root.render(createElement(Harness, { query })));
  };
  const reply = async (requestId: string, snippet: string) => {
    await act(async () =>
      receive({
        type: 'sessions.searchResults',
        requestId,
        indexingIncomplete: false,
        results: [{ appSessionId: 'build', matches: [{ snippet, author: 'user', ts: 1 }] }],
      }),
    );
  };
  await render('alpha');
  await act(async () => t.mock.timers.tick(250));
  await reply(requests[0], 'alpha only');
  assert.equal(result.contentResults.get('build')?.[0].snippet, 'alpha only');
  await render('bravo');
  assert.equal(result.contentResults.size, 0, 'previous query hits must disappear before debounce');
  await act(async () => t.mock.timers.tick(250));
  await reply(requests[1], 'bravo only');
  await reply(requests[0], 'late alpha');
  assert.equal(result.contentResults.get('build')?.[0].snippet, 'bravo only');
  await render('');
  assert.equal(result.contentResults.size, 0);
  await render('charlie');
  await act(async () => t.mock.timers.tick(250));
  await act(async () =>
    receive({
      type: 'error',
      code: 'history.search_unavailable',
      requestId: requests[2],
      message: 'Unavailable',
    }),
  );
  assert.equal(result.searchUnavailable, true);
  assert.equal(result.contentResults.size, 0);
});
