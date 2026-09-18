import assert from 'node:assert/strict';
import test from 'node:test';

import type { McpServerInfo } from '../../types/bridge';
import { recordMcpCatalog, toolSourceMark } from './toolSourceMark';

const server = (name: string, host?: string): McpServerInfo => ({
  name,
  status: 'connected',
  source: 'user',
  isManaged: false,
  ...(host === undefined ? {} : { host }),
});

test('a tool source wears its server host, and nothing when the server has none', () => {
  // Before any catalog arrives every source falls back to its written name.
  assert.equal(toolSourceMark('linear'), null);

  recordMcpCatalog([
    server('linear', 'mcp.linear.app'),
    server('gh_tools', 'github.com'),
    server('local-tools'),
  ]);

  assert.equal(toolSourceMark('linear')?.host, 'mcp.linear.app');
  assert.equal(toolSourceMark('linear')?.isGitHub, false);
  // Sources reach rows humanized, so `gh_tools` is matched as "gh tools".
  assert.equal(toolSourceMark('gh tools')?.isGitHub, true);
  // A stdio server has no endpoint, and a tool with no server has no source.
  assert.equal(toolSourceMark('local tools'), null);
  assert.equal(toolSourceMark(undefined), null);
});

test('a server that reports no host this time drops the host it had before', () => {
  recordMcpCatalog([server('notion', 'mcp.notion.com')]);
  assert.equal(toolSourceMark('notion')?.host, 'mcp.notion.com');

  // The same server over stdio in another workspace: explicitly hostless, so
  // the cached endpoint goes with it.
  recordMcpCatalog([server('notion')]);
  assert.equal(toolSourceMark('notion'), null);
});
