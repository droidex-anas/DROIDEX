import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServerConfig } from '@factory/droid-sdk';
import { codexMcpConfig } from './codexMcp.js';

test('HTTP session tools retain their URL and authorization headers', () => {
  const server: McpServerConfig = { name: 'droidex_threads', type: 'http', url: 'http://127.0.0.1:1234/mcp', headers: [{ name: 'Authorization', value: 'Bearer test-only' }] };
  assert.deepEqual(codexMcpConfig([server]), { mcp_servers: {
    droidex_threads: { url: server.url, http_headers: { Authorization: 'Bearer test-only' } },
  } });
  const resumed = { ...server, url: 'http://127.0.0.1:5678/mcp', headers: [{ name: 'Authorization', value: 'Bearer rotated-test-only' }] };
  assert.deepEqual(codexMcpConfig([resumed]), { mcp_servers: {
    droidex_threads: { url: resumed.url, http_headers: { Authorization: 'Bearer rotated-test-only' } },
  } });
});

test('stdio arguments and environment retain their original shape', () => {
  const server: McpServerConfig = { name: 'local', command: 'node', args: ['server.js'], env: { MODE: 'test' } };
  assert.deepEqual(codexMcpConfig([server]), { mcp_servers: { local: {
    command: 'node', args: ['server.js'], env: { MODE: 'test' },
  } } });
  assert.deepEqual(codexMcpConfig(), {});
});

test('unsupported SSE configuration is rejected rather than silently dropping tools', () => {
  assert.throws(() => codexMcpConfig([{ name: 'legacy', type: 'sse', url: 'http://127.0.0.1:1234/sse', headers: [] }]), /SSE/);
});
