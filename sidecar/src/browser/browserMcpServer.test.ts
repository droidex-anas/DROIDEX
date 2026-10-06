import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserMcpServer } from './browserMcpServer.js';
import type { BrowserSessionManager } from './BrowserSessionManager.js';

test('browser MCP server exposes agent-facing names and typed inputs', () => {
  const server = createBrowserMcpServer({} as BrowserSessionManager, () => 'm1');

  assert.equal(server.name, 'droidmaxx-browser');
  assert.deepEqual(
    server.tools.map((tool) => tool.name),
    [
      'browser_open',
      'browser_snapshot',
      'browser_reload',
      'browser_back',
      'browser_forward',
      'browser_screenshot',
      'browser_click',
      'browser_hover',
      'browser_select',
      'browser_type',
      'browser_keypress',
      'browser_resize',
      'browser_scroll',
      'browser_wait',
      'browser_inspect',
      'browser_network',
      'browser_console',
      'browser_fill_login',
      'design-mode',
      'design_reference',
    ],
  );
  assert.ok(server.tools.find((tool) => tool.name === 'browser_open')?.inputSchema?.url);
  assert.ok(
    server.tools.find((tool) => tool.name === 'browser_screenshot')?.inputSchema?.deviceScaleFactor,
  );
  assert.match(
    server.tools.find((tool) => tool.name === 'browser_open')?.description ?? '',
    /Do not ask the user for a URL/,
  );
});

test('browser MCP handlers return visible tool errors', async () => {
  const manager = {
    designContext() {
      throw new Error('Browser session is not open yet.');
    },
  } as unknown as BrowserSessionManager;
  const server = createBrowserMcpServer(manager, () => 'm1');
  const designMode = server.tools.find((tool) => tool.name === 'design-mode');

  const result = await designMode?.handler({});

  assert.equal((result as { isError?: boolean }).isError, true);
  assert.match(JSON.stringify(result), /Browser session is not open yet/);
});

test('browser_open keeps high-detail viewport scale by default, and navigation tools return the page state', async () => {
  let openedViewport: { width: number; height: number; deviceScaleFactor?: number } | undefined;
  const state = (url: string) => ({
    url,
    viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
    viewportMode: 'fit' as const,
    scroll: { x: 0, y: 0 },
    refs: [],
  });
  const manager = {
    async open(input: {
      viewport?: { width: number; height: number; deviceScaleFactor?: number };
    }) {
      openedViewport = input.viewport;
      return state('https://example.com');
    },
    async reload() {
      return state('https://example.com/reloaded');
    },
    async goBack() {
      return state('https://example.com/back');
    },
    async goForward() {
      return state('https://example.com/forward');
    },
  } as unknown as BrowserSessionManager;
  const server = createBrowserMcpServer(manager, () => 'm1');
  const handler = (name: string) => server.tools.find((tool) => tool.name === name)?.handler;

  const opened = await handler('browser_open')?.({
    url: 'https://example.com',
    viewport: { width: 1000, height: 700 },
    viewportMode: 'custom',
  });
  assert.equal(openedViewport?.deviceScaleFactor, 2);
  assert.match(String(opened), /Opened the live DROIDEX browser/);

  for (const [name, url] of [
    ['browser_reload', /example.com\/reloaded/],
    ['browser_back', /example.com\/back/],
    ['browser_forward', /example.com\/forward/],
  ] as const) {
    assert.match(String(await handler(name)?.({})), url, name);
  }
});
