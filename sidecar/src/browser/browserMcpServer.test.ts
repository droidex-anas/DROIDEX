import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserMcpServer } from './browserMcpServer.js';
import type { BrowserSessionManager } from './BrowserSessionManager.js';

test('browser MCP server exposes agent-facing names and typed inputs', () => {
  const server = createBrowserMcpServer({} as BrowserSessionManager, () => 'm1');

  assert.equal(server.name, 'droidex-browser');
  assert.deepEqual(
    server.tools.map((tool) => tool.name),
    [
      'browser_open',
      'browser_read_page',
      'browser_read_text',
      'browser_find',
      'browser_screenshot',
      'browser_click',
      'browser_hover',
      'browser_fill',
      'browser_type',
      'browser_press',
      'browser_resize',
      'browser_scroll',
      'browser_wait',
      'browser_batch',
      'browser_inspect',
      'browser_network',
      'browser_console',
      'browser_fill_login',
      'design-mode',
      'design_reference',
    ],
  );
  assert.ok(server.tools.find((tool) => tool.name === 'browser_open')?.inputSchema?.url);
  assert.ok(server.tools.find((tool) => tool.name === 'browser_screenshot')?.inputSchema?.ref);
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

test('browser_open keeps high-detail viewport scale by default', async () => {
  let openedViewport: { width: number; height: number; deviceScaleFactor?: number } | undefined;
  const manager = {
    async open(input: {
      viewport?: { width: number; height: number; deviceScaleFactor?: number };
    }) {
      openedViewport = input.viewport;
      return { state: {}, text: '[Example · https://example.com/]' };
    },
  } as unknown as BrowserSessionManager;
  const server = createBrowserMcpServer(manager, () => 'm1');
  const browserOpen = server.tools.find((tool) => tool.name === 'browser_open');

  const result = await browserOpen?.handler({
    url: 'https://example.com',
    viewport: { width: 1000, height: 700 },
    viewportMode: 'custom',
  });

  assert.equal(openedViewport?.deviceScaleFactor, 2);
  assert.match(JSON.stringify(result), /Opened the page.*\[Example · https:\/\/example.com\/\]/);
});

test('browser_open goes back, forward and reloads', async () => {
  const calls: string[] = [];
  const outcome = { state: {}, text: '[History · https://example.com/history]' };
  const manager = {
    async goBack() {
      calls.push('back');
      return outcome;
    },
    async goForward() {
      calls.push('forward');
      return outcome;
    },
    async reload() {
      calls.push('reload');
      return outcome;
    },
  } as unknown as BrowserSessionManager;
  const browserOpen = createBrowserMcpServer(manager, () => 'm1').tools.find(
    (tool) => tool.name === 'browser_open',
  );

  for (const action of ['back', 'forward', 'reload']) await browserOpen?.handler({ action });

  assert.deepEqual(calls, ['back', 'forward', 'reload']);
});
