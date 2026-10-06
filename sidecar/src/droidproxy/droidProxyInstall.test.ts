import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  downloadFile,
  installDroidProxyApp,
  parseSha256File,
  sha256FileHex,
} from './droidProxyInstall.js';
import { droidProxyInstallUnavailable } from './droidProxy.js';

test('checksum files parse in coreutils and bare-hash form, and file hashes match the platform', async (t) => {
  const hash = '1ba65a863cd82cf3a122f78503edf6424a75453c39290df70aceefe1bd4a650e';
  assert.equal(parseSha256File(`${hash}  DroidProxy-arm64.zip\n`), hash);
  assert.equal(parseSha256File(`${hash}\n`), hash);
  assert.equal(parseSha256File(`${hash.toUpperCase()}  file.zip`), hash);
  for (const junk of ['<html>proxy error page</html>', '', 'xyz  file.zip'])
    assert.equal(parseSha256File(junk), undefined);

  const path = join(scratchDir(t), 'payload.bin');
  const bytes = Buffer.from('droidproxy-install-fixture');
  writeFileSync(path, bytes);
  assert.equal(await sha256FileHex(path), createHash('sha256').update(bytes).digest('hex'));
});

test('droidProxyInstallUnavailable gates on platform and architecture', () => {
  assert.equal(droidProxyInstallUnavailable('darwin', 'arm64'), undefined);
  assert.equal(droidProxyInstallUnavailable('darwin', 'x64'), 'unsupported-arch');
  assert.equal(droidProxyInstallUnavailable('linux', 'arm64'), 'unsupported-platform');
  assert.equal(droidProxyInstallUnavailable('win32', 'x64'), 'unsupported-platform');
});

function scratchDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'droidex-dl-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A local HTTP server answering every request with `handler`, closed after the test. */
async function serve(t: TestContext, handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${String(address.port)}/file`;
}

test('downloadFile streams bytes with progress, with or without a content length', async (t) => {
  const payload = Buffer.alloc(256 * 1024, 7);
  for (const length of [String(payload.length), undefined]) {
    const url = await serve(t, (_req, res) => {
      res.writeHead(200, length ? { 'content-length': length } : {});
      res.end(payload);
    });
    const dest = join(scratchDir(t), 'out.bin');
    const seen: Array<[number, number | undefined]> = [];
    await downloadFile(url, dest, (received, total) => {
      seen.push([received, total]);
    });
    assert.deepEqual(readFileSync(dest), payload);
    assert.deepEqual(seen.at(-1), [payload.length, length ? payload.length : undefined]);
  }
});

test('downloadFile rejects HTTP failures, an absurd length and a destination write error', async (t) => {
  const failures: [
    number,
    Record<string, string>,
    boolean,
    RegExp | ((error: unknown) => boolean),
  ][] = [
    [404, {}, false, /HTTP 404/],
    [200, { 'content-length': '999999999999' }, false, /larger than expected/],
    // The destination is a directory, and the write error must not hang the download.
    [
      200,
      {},
      true,
      (error) => error instanceof Error && 'code' in error && error.code === 'EISDIR',
    ],
  ];
  for (const [status, headers, intoDirectory, expected] of failures) {
    const url = await serve(t, (_req, res) => {
      res.writeHead(status, headers);
      res.end(status === 200 && !headers['content-length'] ? Buffer.alloc(256 * 1024) : 'nope');
    });
    const dir = scratchDir(t);
    await assert.rejects(
      downloadFile(url, intoDirectory ? dir : join(dir, 'out.bin'), () => {}),
      expected,
    );
  }
});

test('downloadFile aborts on signal', async (t) => {
  const payload = Buffer.alloc(1024 * 1024, 9);
  const url = await serve(t, (_req, res) => {
    res.writeHead(200, { 'content-length': String(payload.length) });
    res.write(payload.subarray(0, 1024));
    // Hold the connection open; the abort below must win, not the body.
  });
  const abort = new AbortController();
  const done = downloadFile(url, join(scratchDir(t), 'out.bin'), () => {}, abort.signal);
  abort.abort();
  await assert.rejects(
    done,
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
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
