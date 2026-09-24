import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  downloadFile,
  installDroidProxyApp,
  parseSha256File,
  sha256FileHex,
} from './droidProxyInstall.js';

test('parseSha256File accepts coreutils and bare-hash formats, rejects junk', () => {
  const hash = '1ba65a863cd82cf3a122f78503edf6424a75453c39290df70aceefe1bd4a650e';
  assert.equal(parseSha256File(`${hash}  DroidProxy-arm64.zip\n`), hash);
  assert.equal(parseSha256File(`${hash}\n`), hash);
  assert.equal(parseSha256File(`${hash.toUpperCase()}  file.zip`), hash);
  assert.equal(parseSha256File('<html>proxy error page</html>'), undefined);
  assert.equal(parseSha256File(''), undefined);
  assert.equal(parseSha256File('xyz  file.zip'), undefined);
});

test('sha256FileHex matches the platform hash of file bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'droidex-sha-'));
  const path = join(dir, 'payload.bin');
  const bytes = Buffer.from('droidproxy-install-fixture');
  writeFileSync(path, bytes);
  assert.equal(await sha256FileHex(path), createHash('sha256').update(bytes).digest('hex'));
});

async function withServer(
  handler: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const { createServer } = await import('node:http');
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await run(`http://127.0.0.1:${String(address.port)}`);
  } finally {
    server.close();
  }
}

test('downloadFile streams bytes with progress and total', async () => {
  const payload = Buffer.alloc(256 * 1024, 7);
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-length': String(payload.length) });
      res.end(payload);
    },
    async (baseUrl) => {
      const dir = mkdtempSync(join(tmpdir(), 'droidex-dl-'));
      const dest = join(dir, 'out.bin');
      const seen: Array<[number, number | undefined]> = [];
      await downloadFile(`${baseUrl}/file`, dest, (received, total) => {
        seen.push([received, total]);
      });
      const { readFileSync } = await import('node:fs');
      assert.deepEqual(readFileSync(dest), payload);
      assert.ok(seen.length > 0);
      assert.deepEqual(seen.at(-1), [payload.length, payload.length]);
    },
  );
});

test('downloadFile works without a content length', async () => {
  const payload = Buffer.from('chunked-ish');
  await withServer(
    (_req, res) => {
      res.writeHead(200);
      res.end(payload);
    },
    async (baseUrl) => {
      const dir = mkdtempSync(join(tmpdir(), 'droidex-dl-'));
      const dest = join(dir, 'out.bin');
      let last: [number, number | undefined] = [0, undefined];
      await downloadFile(`${baseUrl}/file`, dest, (received, total) => {
        last = [received, total];
      });
      assert.deepEqual(last, [payload.length, undefined]);
    },
  );
});

test('downloadFile refuses an absurd content length before reading', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-length': '999999999999' });
      res.end('nope');
    },
    async (baseUrl) => {
      const dir = mkdtempSync(join(tmpdir(), 'droidex-dl-'));
      await assert.rejects(
        downloadFile(`${baseUrl}/file`, join(dir, 'out.bin'), () => {}),
        /larger than expected/,
      );
    },
  );
});

test('downloadFile surfaces HTTP failures', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(404);
      res.end('missing');
    },
    async (baseUrl) => {
      const dir = mkdtempSync(join(tmpdir(), 'droidex-dl-'));
      await assert.rejects(
        downloadFile(`${baseUrl}/file`, join(dir, 'out.bin'), () => {}),
        /HTTP 404/,
      );
    },
  );
});

test('downloadFile aborts on signal', async () => {
  const payload = Buffer.alloc(1024 * 1024, 9);
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-length': String(payload.length) });
      res.write(payload.subarray(0, 1024));
      // Hold the connection open; the abort below must win, not the body.
    },
    async (baseUrl) => {
      const dir = mkdtempSync(join(tmpdir(), 'droidex-dl-'));
      const abort = new AbortController();
      const done = downloadFile(`${baseUrl}/file`, join(dir, 'out.bin'), () => {}, abort.signal);
      abort.abort();
      await assert.rejects(
        done,
        (error: unknown) => error instanceof Error && error.name === 'AbortError',
      );
    },
  );
});

test(
  'install refuses off-platform without touching the network',
  { skip: process.platform === 'darwin' },
  async () => {
    let progressed = false;
    const result = await installDroidProxyApp(() => {
      progressed = true;
    });
    assert.deepEqual(result, { ok: false, message: 'DroidProxy is a macOS app.' });
    assert.equal(progressed, false);
  },
);
