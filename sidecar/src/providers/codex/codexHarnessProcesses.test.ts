import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { codexHome, isCodexHarnessProcess } from './codexHarnessProcesses.js';

test('Codex helpers are the harness’s own processes, and the agent’s commands are not', () => {
  const plugin = join(codexHome(), 'plugins', 'cache', 'openai-bundled', 'cua', 'require.mjs');
  assert.equal(isCodexHarnessProcess('/Applications/Codex/bin/node_repl'), true);
  assert.equal(isCodexHarnessProcess('/Applications/Codex/bin/codex-code-mode-host'), true);
  assert.equal(isCodexHarnessProcess(`/usr/bin/node --import file://${plugin} cua-repl.mjs`), true);

  assert.equal(isCodexHarnessProcess('node /w/node_modules/.bin/vite'), false);
  assert.equal(isCodexHarnessProcess('python3 -m http.server 8000'), false);
  assert.equal(isCodexHarnessProcess('cat node_repl'), false);
});
