import assert from 'node:assert/strict';
import test from 'node:test';
import { RUNTIME_UNAVAILABLE } from './compiler.js';
import { compilerResponse } from './compilerResponse.js';

test('a reply the protocol does not define is not an answer', () => {
  // What the forked compiler sends is the one thing here this module does not
  // write, and an unknown reason would otherwise reach the renderer as advice
  // to restart. This covers the rule, not its wiring: `liveCompiler`'s listener
  // calling it, losing and ending the process, and the next build forking a
  // replacement, are exercised only by a throwaway probe driving a real child,
  // because nothing can make the packaged worker send a malformed reply —
  // `compilerEnv` deletes NODE_OPTIONS and the entry path is not injectable.
  const unavailable = {
    requestId: 1,
    status: 'unavailable',
    reason: 'damaged-runtime',
    message: RUNTIME_UNAVAILABLE,
  };
  assert.deepEqual(compilerResponse(unavailable), unavailable);
  assert.deepEqual(compilerResponse({ requestId: 2, status: 'stopped' }), {
    requestId: 2,
    status: 'stopped',
  });
  const edited = {
    requestId: 3,
    status: 'edited',
    files: { 'main.tsx': '<h1>Changed</h1>' },
    landed: null,
  };
  assert.deepEqual(compilerResponse(edited), edited);

  for (const malformed of [
    null,
    'stopped',
    { status: 'stopped' },
    { requestId: '1', status: 'stopped' },
    { requestId: 1, status: 'invented' },
    { ...unavailable, reason: 'invented' },
    { ...unavailable, reason: undefined },
    { ...unavailable, reason: { damaged: true } },
    { ...unavailable, message: 12 },
    { requestId: 1, status: 'ready' },
    { requestId: 1, status: 'ready', design: { artifactId: 'a', html: 'h' } },
    { requestId: 1, status: 'failed' },
    { requestId: 1, status: 'edited', files: { '../outside.tsx': 'bad' } },
    { ...edited, landed: 'not-a-row' },
    { requestId: 1, status: 'edit_failed', code: 'unknown', message: 'bad' },
    { requestId: 1, status: 'catalogChecked', failures: [null, { entry: 42, diagnostic: 'oops' }] },
  ]) {
    assert.equal(compilerResponse(malformed), null, JSON.stringify(malformed));
  }
});
