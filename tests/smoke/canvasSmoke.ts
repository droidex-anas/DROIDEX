import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; worker-src 'none'; img-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function previewDocument(body: string, script: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"></head><body>${body}<script>(()=>{${script}})();</script></body></html>`;
}

export async function bounded<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 3_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Brings the app window forward, so pointer input has somewhere to land. */
export async function focusHost(app: ElectronApplication): Promise<void> {
  await bounded(
    app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
    }),
    'focus host window',
  );
}

/** A loopback listener that counts everything that reaches it. */
export interface NetworkListener {
  url: string;
  attempts: { connections: number; requests: number; upgrades: number };
  openSockets: () => number;
}

/**
 * A loopback UDP listener, because ICE never becomes a TCP connection: CSP's
 * `connect-src` does not govern WebRTC, so "no network" has to be measured on a
 * datagram socket as well as on a stream one.
 */
export interface DatagramListener {
  url: string;
  datagrams: () => number;
}

export async function withDatagramListener(
  use: (listener: DatagramListener) => Promise<void>,
): Promise<void> {
  const socket = createSocket('udp4');
  let datagrams = 0;
  socket.on('message', () => {
    datagrams += 1;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, '127.0.0.1', resolve);
    });
    await use({
      url: `127.0.0.1:${String(socket.address().port)}`,
      datagrams: () => datagrams,
    });
  } finally {
    await new Promise<void>((resolve) => socket.close(resolve));
  }
}

/**
 * Runs `use` with a real HTTP/WebSocket listener, so "no network" is measured
 * at a socket rather than inferred from an error message.
 */
export async function withNetworkListener(
  use: (listener: NetworkListener) => Promise<void>,
): Promise<void> {
  const sockets = new Set<Socket>();
  const attempts = { connections: 0, requests: 0, upgrades: 0 };
  const server = createServer((_request, response) => {
    attempts.requests += 1;
    response.writeHead(200, { 'Access-Control-Allow-Origin': '*', Connection: 'close' });
    response.end('reachable');
  });
  server.on('connection', (socket) => {
    attempts.connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket) => {
    attempts.upgrades += 1;
    const key = request.headers['sec-websocket-key'];
    assert.equal(typeof key, 'string');
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('data', () => socket.destroy());
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await use({
      url: `http://127.0.0.1:${String(address.port)}`,
      attempts,
      openSockets: () => sockets.size,
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function descendants(rootPid: number): number[] {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((row) => row.trim().split(/\s+/).map(Number));
  const owned = new Set([rootPid]);
  for (let pass = 0; pass < rows.length; pass += 1) {
    const before = owned.size;
    for (const [pid, parent] of rows) if (owned.has(parent)) owned.add(pid);
    if (owned.size === before) break;
  }
  return [...owned];
}

export async function withCanvasHost(
  run: (app: ElectronApplication, page: Page) => Promise<void>,
): Promise<void> {
  const smokeHome = mkdtempSync(path.join(tmpdir(), 'droidex-canvas-smoke-'));
  const environment = { ...process.env };
  for (const name of ['FACTORY_API_KEY', 'DROID_PATH', 'ELECTRON_RUN_AS_NODE'])
    delete environment[name];
  let app: ElectronApplication | undefined;
  let childPids: number[] = [];
  try {
    app = await electron.launch({
      args: [path.resolve('electron/main.cjs')],
      cwd: process.cwd(),
      env: {
        ...environment,
        HOME: smokeHome,
        DROIDEX_USER_DATA_DIR: path.join(smokeHome, 'profile'),
        ELECTRON_START_URL: 'data:text/html,Canvas%20smoke%20bootstrap',
        SIDECAR_ENTRY: path.resolve('sidecar/test-fixtures/childSessionsSidecar.mjs'),
        CHILD_SESSIONS_SMOKE_LOG: path.join(smokeHome, 'commands.jsonl'),
        BRIDGE_PORT: '0',
        NODE_BIN: process.execPath,
      },
    });
    const rootPid = app.process().pid;
    if (!rootPid) throw new Error('Electron launched without a PID');
    childPids = descendants(rootPid);
    const page = await app.firstWindow();
    await bounded(
      page.evaluate(async () => {
        if (!window.droidControl) throw new Error('Missing preload');
        await window.droidControl.setOnboarding({
          completed: true,
          cliAutoUpdate: false,
          appAutoUpdate: false,
        });
      }),
      'bootstrap',
    );
    await page.goto(pathToFileURL(path.resolve('dist/index.html')).href, {
      waitUntil: 'domcontentloaded',
    });
    await bounded(
      page.evaluate(() => {
        // These probes need no live agent connection.
        document.title = 'Canvas runtime smoke';
      }),
      'host ready',
    );
    console.log('canvas host ready');
    await run(app, page);
  } finally {
    try {
      if (app) {
        const pid = app.process().pid;
        if (pid) childPids = [...new Set([...childPids, ...descendants(pid)])];
        try {
          await bounded(app.close(), 'Electron close', 5_000);
        } catch (error) {
          console.log(String(error));
        } finally {
          const terminationErrors: unknown[] = [];
          for (const childPid of childPids.reverse()) {
            try {
              process.kill(childPid, 'SIGKILL');
            } catch (error) {
              if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
                terminationErrors.push(error);
            }
          }
          await expect.poll(() => childPids.filter(processAlive), { timeout: 10_000 }).toEqual([]);
          assert.deepEqual(terminationErrors, [], 'failed to terminate owned child processes');
        }
      }
      assert.equal(
        childPids.some(processAlive),
        false,
        'owned Electron/sidecar child survived cleanup',
      );
    } finally {
      rmSync(smokeHome, { recursive: true, force: true });
    }
  }
}

export async function mountFrame(
  page: Page,
  script: string,
  body = '<p>preview</p>',
): Promise<void> {
  await bounded(
    page.evaluate(
      (srcdoc) => {
        const frame = document.createElement('iframe');
        frame.id = 'canvas-probe';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.srcdoc = srcdoc;
        frame.style.cssText =
          'position:fixed;top:20px;left:20px;width:320px;height:120px;border:0;z-index:99999';
        document.body.append(frame);
      },
      previewDocument(body, script + '; document.body.dataset.canvasReady="true";'),
    ),
    'mount preview',
  );
  await expect(page.frameLocator('#canvas-probe').locator('body')).toHaveAttribute(
    'data-canvas-ready',
    'true',
  );
}

export async function framePid(app: ElectronApplication): Promise<number> {
  return bounded(
    app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const frame = contents.mainFrame.frames.find((frame) => frame.url.startsWith('about:srcdoc'));
      if (!frame || frame.osProcessId <= 0) return 0;
      if (frame.osProcessId === contents.mainFrame.osProcessId)
        throw new Error('Preview shares host process');
      return frame.osProcessId;
    }),
    'frame PID',
  );
}

export async function terminateFrame(app: ElectronApplication, pid: number): Promise<void> {
  await bounded(
    app.evaluate(({ BrowserWindow }, previewPid) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const frame = contents.mainFrame.frames.find((frame) => frame.osProcessId === previewPid);
      if (!frame || frame.osProcessId === contents.mainFrame.osProcessId)
        throw new Error('Unsafe preview PID');
      process.kill(frame.osProcessId, 'SIGKILL');
    }, pid),
    'main-process termination',
  );
}
