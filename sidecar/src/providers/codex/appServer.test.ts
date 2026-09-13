import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { AppServerClient } from './appServer.js';

// A stand-in app server that answers over the same stdio framing the real one
// uses, and exercises the cases a transport gets wrong: a response split across
// chunks, CRLF terminators, a server request, and a last line with no
// terminator before the process exits.
const FAKE_SERVER = `#!/usr/bin/env node
const write = (text) => process.stdout.write(text);
let rest = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  rest += chunk;
  let end = rest.indexOf('\\n');
  while (end >= 0) {
    const line = rest.slice(0, end);
    rest = rest.slice(end + 1);
    end = rest.indexOf('\\n');
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === 'ping') {
      const response = JSON.stringify({ id: message.id, result: { pong: true } }) + '\\r\\n';
      write(response.slice(0, 6));
      setTimeout(() => write(response.slice(6)), 10);
    } else if (message.method === 'ask') {
      write(JSON.stringify({ id: 'server-1', method: 'unknown/method', params: {} }) + '\\n');
    } else if (message.error) {
      write(JSON.stringify({ method: 'answered', params: { code: message.error.code } }) + '\\n');
    } else if (message.method === 'quit') {
      write(JSON.stringify({ method: 'tail', params: {} }));
      process.exit(0);
    }
  }
});
`;

const directory = mkdtempSync(join(tmpdir(), 'codex-transport-'));
const executable = join(directory, 'fake-app-server.mjs');
writeFileSync(executable, FAKE_SERVER);
chmodSync(executable, 0o755);

const clients: AppServerClient[] = [];
function connect(): AppServerClient {
  const client = new AppServerClient(executable, directory);
  clients.push(client);
  return client;
}

after(async () => {
  await Promise.all(clients.map((client) => client.close()));
});

test('reassembles a response split across chunks and terminated with CRLF', async () => {
  assert.deepEqual(await connect().request('ping', {}), { pong: true });
});

test('answers an unimplemented server request with method-not-found', async () => {
  const client = connect();
  const answered = new Promise<unknown>((resolve) => {
    client.onNotification('answered', resolve);
  });
  client.notify('ask');
  assert.deepEqual(await answered, { code: -32601 });
});

test('delivers an unterminated final line and fails pending requests on exit', async () => {
  const client = connect();
  const tail = new Promise<void>((resolve) => {
    client.onNotification('tail', () => {
      resolve();
    });
  });
  const pending = client.request('never/answered', {});
  client.notify('quit');
  await tail;
  await assert.rejects(pending, /exited with code 0/);
});
