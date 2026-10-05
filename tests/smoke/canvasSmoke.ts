import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
