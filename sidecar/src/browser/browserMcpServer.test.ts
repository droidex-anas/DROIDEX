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
      'browser_viewport',
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

test('a browser the agent opens starts at desktop size, and browser_open goes back, forward and reloads', async () => {
  const modes: unknown[] = [];
  const calls: string[] = [];
  let open = false;
  const outcome = (title: string, url: string) => ({ state: {}, text: `[${title} · ${url}]` });
  const manager = {
    hasSession: () => open,
    async open(input: { viewportMode?: string }) {
      modes.push(input.viewportMode);
      open = true;
      return outcome('Example', 'https://example.com/');
    },
    async goBack() {
      calls.push('back');
      return outcome('History', 'https://example.com/history');
    },
    async goForward() {
      calls.push('forward');
      return outcome('History', 'https://example.com/history');
    },
    async reload() {
      calls.push('reload');
      return outcome('History', 'https://example.com/history');
    },
  } as unknown as BrowserSessionManager;
  const browserOpen = createBrowserMcpServer(manager, () => 'm1').tools.find(
    (tool) => tool.name === 'browser_open',
  );

  const opened = await browserOpen?.handler({ url: 'https://example.com' });
  await browserOpen?.handler({ url: 'https://example.org' });
  assert.deepEqual(modes, ['desktop', undefined]);
  assert.match(JSON.stringify(opened), /Opened the page.*\[Example · https:\/\/example.com\/\]/);

  for (const action of ['back', 'forward', 'reload']) await browserOpen?.handler({ action });
  assert.deepEqual(calls, ['back', 'forward', 'reload']);
});
