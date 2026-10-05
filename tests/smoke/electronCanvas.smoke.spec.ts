// Canvas preview-host gate (spec §6): generated code runs in an opaque-origin
// `sandbox="allow-scripts"` srcdoc frame inside the real DROIDEX window. A
// sandbox attribute alone does not prove CPU isolation, so this smoke asks the
// questions from outside the renderer: while a preview spins forever, does the
// host main thread still answer, does the frame live in its own OS process, and
// does removing the frame end that process?
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const HOST_RESPONSE_DEADLINE_MS = 3_000;

interface FrameProcesses {
  hostOsProcessId: number;
  frames: Array<{ osProcessId: number; url: string }>;
}

// The CSP and sandbox the production preview document will carry. Keep this in
// step with the preview document owner once Task 3 introduces it.
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "worker-src 'none'",
  'img-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function previewDocument(body: string, script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"></head><body>${body}<script>(() => {${script}})();</script></body></html>`;
}

// Answers the host's instruction once, then spins the frame's main thread.
const SPIN_SCRIPT = `
  const report = (payload) => parent.postMessage({ probe: 'spin', ...payload }, '*');
  addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.command !== 'spin') return;
    report({ state: 'spinning' });
    // Let the report leave the frame before its thread stops yielding.
    setTimeout(() => {
      const until = Date.now() + 60_000;
      while (Date.now() < until) {}
      report({ state: 'finished' });
    }, 50);
  });
  report({ state: 'ready' });
`;

// Tries every escape the production bridge must refuse and reports what the
// platform did about each one.
const ESCAPE_SCRIPT = `
  const results = {};
  const done = () => parent.postMessage({ probe: 'escape', results }, '*');
  const settle = (name, promise) => promise.then(
    (value) => { results[name] = value; },
    (error) => { results[name] = 'rejected: ' + String(error && error.message || error); },
  );
  results.cookie = (() => { try { return document.cookie === '' ? 'empty' : 'readable'; } catch (error) { return 'blocked: ' + error.name; } })();
  results.localStorage = (() => { try { localStorage.setItem('x', '1'); return 'writable'; } catch (error) { return 'blocked: ' + error.name; } })();
  results.parentDocument = (() => { try { return parent.document ? 'readable' : 'empty'; } catch (error) { return 'blocked: ' + error.name; } })();
  results.popup = (() => { try { return window.open('about:blank') ? 'opened' : 'null'; } catch (error) { return 'blocked: ' + error.name; } })();
  const workerOutcome = new Promise((resolve) => {
    try {
      const worker = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' })));
      worker.onmessage = () => resolve('ran');
      worker.onerror = () => resolve('errored');
      setTimeout(() => resolve('silent'), 1_000);
    } catch (error) { resolve('blocked: ' + error.name); }
  });
  results.topNavigation = (() => { try { top.location.href = 'https://example.invalid/'; return 'assigned'; } catch (error) { return 'blocked: ' + error.name; } })();
  const probes = [
    settle('worker', workerOutcome),
    settle('fetch', fetch('https://example.invalid/').then(() => 'allowed')),
    settle('websocket', new Promise((resolve) => {
      try {
        const socket = new WebSocket('wss://example.invalid/');
        socket.onerror = () => resolve('errored');
        socket.onopen = () => resolve('opened');
      } catch (error) { resolve('blocked: ' + error.name); }
    })),
  ];
  Promise.all(probes).then(done);
`;

// Posts as fast as a tight loop allows for a short burst so the host can show
// it stays interactive and can count what arrived.
const FLOOD_COUNT = 200_000;
const FLOOD_SCRIPT = `
  const startedAt = performance.now();
  for (let sent = 1; sent <= ${String(FLOOD_COUNT)}; sent += 1) parent.postMessage({ probe: 'flood', sent }, '*');
  parent.postMessage({ probe: 'flood', done: true, sent: ${String(FLOOD_COUNT)}, sendMs: performance.now() - startedAt }, '*');
`;

// Grows memory until the platform stops the frame.
const ALLOCATE_SCRIPT = `
  parent.postMessage({ probe: 'allocate', state: 'started' }, '*');
  const hoard = [];
  setTimeout(function grow() {
    for (let index = 0; index < 8; index += 1) hoard.push(new Uint8Array(64 * 1024 * 1024).fill(index));
    parent.postMessage({ probe: 'allocate', state: 'growing', mib: hoard.length * 64 }, '*');
    setTimeout(grow, 0);
  }, 0);
`;

async function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not answer within ${String(HOST_RESPONSE_DEADLINE_MS)}ms`)),
      HOST_RESPONSE_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function frameProcesses(app: ElectronApplication): Promise<FrameProcesses> {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('No window');
    const { mainFrame } = window.webContents;
    return {
      hostOsProcessId: mainFrame.osProcessId,
      frames: mainFrame.frames.map((frame) => ({ osProcessId: frame.osProcessId, url: frame.url })),
    };
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('[C1] a runaway preview frame cannot freeze the DROIDEX window', async () => {
  for (const artifact of ['dist/index.html', 'electron/main.cjs']) {
    assert.ok(existsSync(artifact), `missing ${artifact}`);
  }

  const smokeHome = mkdtempSync(path.join(tmpdir(), 'droidex-canvas-smoke-'));
  const userData = path.join(smokeHome, 'user-data');
  mkdirSync(userData, { recursive: true });
  // A DROIDEX-hosted shell exports ELECTRON_RUN_AS_NODE, which would turn the
  // launched Electron into a bare Node process.
  const {
    FACTORY_API_KEY: _factoryApiKey,
    DROID_PATH: _droidPath,
    ELECTRON_RUN_AS_NODE: _runAsNode,
    ...unauthenticatedEnvironment
  } = process.env;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [path.resolve('electron/main.cjs'), `--user-data-dir=${userData}`],
      cwd: process.cwd(),
      env: {
        ...unauthenticatedEnvironment,
        HOME: smokeHome,
        DROIDEX_USER_DATA_DIR: userData,
        ELECTRON_START_URL: `data:text/html;charset=utf-8,${encodeURIComponent(
          '<!doctype html><html><body>Canvas smoke bootstrap</body></html>',
        )}`,
        SIDECAR_ENTRY: path.resolve('sidecar/test-fixtures/childSessionsSidecar.mjs'),
        CHILD_SESSIONS_SMOKE_LOG: path.join(smokeHome, 'commands.jsonl'),
        BRIDGE_PORT: '0',
        NODE_BIN: process.execPath,
      },
    });
    const page = await app.firstWindow();
    await page.evaluate(async () => {
      await window.droidControl!.setOnboarding({
        completed: true,
        cliAutoUpdate: false,
        appAutoUpdate: false,
      });
    });
    await page.goto(pathToFileURL(path.resolve('dist/index.html')).href);
    await page.waitForLoadState('domcontentloaded');

    // Host-side collector: every probe frame reports through postMessage and
    // the test reads the collected reports from outside the renderer.
    await page.evaluate(() => {
      const reports: unknown[] = [];
      const counts = { flood: 0 };
      window.addEventListener('message', (event) => {
        const data: unknown = event.data;
        if (typeof data !== 'object' || data === null || !('probe' in data)) return;
        if ((data as { probe: string }).probe === 'flood') {
          counts.flood += 1;
          if (!('done' in data)) return;
        }
        reports.push(data);
      });
      Object.assign(window, { __canvasProbe: { reports, counts } });
    });
    const reports = () =>
      page.evaluate(() => (window as unknown as { __canvasProbe: { reports: unknown[] } }).__canvasProbe.reports);
    const mountFrame = (id: string, html: string) =>
      page.evaluate(
        ([frameId, srcdoc]) => {
          const frame = document.createElement('iframe');
          frame.id = frameId;
          frame.setAttribute('sandbox', 'allow-scripts');
          frame.setAttribute('referrerpolicy', 'no-referrer');
          frame.srcdoc = srcdoc;
          frame.style.cssText = 'width:320px;height:120px;border:0';
          document.body.append(frame);
        },
        [id, html] as const,
      );
    const unmountFrame = (id: string) =>
      page.evaluate((frameId) => {
        document.getElementById(frameId)?.remove();
      }, id);
    const before = await frameProcesses(app);

    // 1. Infinite loop. The frame must land in another OS process and the host
    //    must keep answering while it spins.
    await mountFrame('spin', previewDocument('<p>spin</p>', SPIN_SCRIPT));
    await expect
      .poll(async () => (await reports()).some((r) => (r as { state?: string }).state === 'ready'))
      .toBe(true);
    const spinning = await frameProcesses(app);
    const spinFrame = spinning.frames.find((frame) => frame.url.startsWith('about:srcdoc'));
    assert.ok(spinFrame, `preview frame missing from ${JSON.stringify(spinning)}`);
    assert.notEqual(
      spinFrame.osProcessId,
      spinning.hostOsProcessId,
      'preview frame shares the host renderer process',
    );
    await page.evaluate(() => {
      const frame = document.getElementById('spin') as HTMLIFrameElement;
      frame.contentWindow?.postMessage({ command: 'spin' }, '*');
    });
    await expect
      .poll(async () => (await reports()).some((r) => (r as { state?: string }).state === 'spinning'))
      .toBe(true);
    const hostLatencies: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      const startedAt = Date.now();
      const answer = await withDeadline(
        page.evaluate(() => {
          document.title = `probe-${String(Date.now())}`;
          return document.title.length;
        }),
        `host round ${String(round)}`,
      );
      assert.ok(answer > 0);
      hostLatencies.push(Date.now() - startedAt);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const mainAlive = await withDeadline(
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.isCrashed()),
      'electron main',
    );
    assert.equal(mainAlive, false);

    // 2. Terminate. Removing the element must end the spinning process.
    await unmountFrame('spin');
    await expect
      .poll(() => processAlive(spinFrame.osProcessId), { timeout: 15_000 })
      .toBe(false);
    assert.equal((await frameProcesses(app)).frames.length, before.frames.length);

    // 3. Escapes the production bridge relies on the platform to refuse.
    await mountFrame('escape', previewDocument('<p>escape</p>', ESCAPE_SCRIPT));
    await expect
      .poll(async () => (await reports()).find((r) => (r as { probe?: string }).probe === 'escape'))
      .toBeDefined();
    const escape = (await reports()).find((r) => (r as { probe?: string }).probe === 'escape') as {
      results: Record<string, string>;
    };
    await unmountFrame('escape');
    assert.equal(escape.results.fetch.startsWith('rejected'), true, escape.results.fetch);
    assert.equal(escape.results.websocket, 'errored', escape.results.websocket);
    assert.equal(escape.results.popup, 'null', escape.results.popup);
    assert.notEqual(escape.results.worker, 'ran', escape.results.worker);
    assert.equal(escape.results.parentDocument.startsWith('blocked'), true, escape.results.parentDocument);
    assert.equal(escape.results.cookie.startsWith('blocked'), true, escape.results.cookie);
    assert.equal(escape.results.localStorage.startsWith('blocked'), true, escape.results.localStorage);
    assert.equal(page.url(), pathToFileURL(path.resolve('dist/index.html')).href);

    // 4. Message flood. The host must keep answering and the burst must end.
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      const gone: unknown[] = [];
      contents?.on('render-process-gone', (_event, details) => gone.push(details));
      Object.assign(globalThis, { __canvasRendererGone: gone });
    });
    const floodStartedAt = Date.now();
    await mountFrame('flood', previewDocument('<p>flood</p>', FLOOD_SCRIPT));
    const isFloodDone = (r: unknown) =>
      (r as { probe?: string; done?: boolean }).probe === 'flood' && (r as { done?: boolean }).done === true;
    const floodHostLatencies: number[] = [];
    while (Date.now() - floodStartedAt < 60_000) {
      const askedAt = Date.now();
      const current = await reports();
      floodHostLatencies.push(Date.now() - askedAt);
      if (current.some(isFloodDone)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const floodDrainMs = Date.now() - floodStartedAt;
    const rendererGone = await app.evaluate(
      () => (globalThis as unknown as { __canvasRendererGone: unknown[] }).__canvasRendererGone,
    );
    assert.deepEqual(rendererGone, [], `host renderer died during flood: ${JSON.stringify(rendererGone)}`);
    const floodDone = (await reports()).find(isFloodDone) as
      | { sent: number; sendMs: number }
      | undefined;
    const floodCount = await page.evaluate(() => (window as unknown as { __canvasProbe: { counts: { flood: number } } }).__canvasProbe.counts.flood);
    await unmountFrame('flood');
    assert.ok(floodDone, `flood of ${String(floodCount)} messages did not drain within 60s`);

    // 5. Memory pressure. The frame may die; the host may not.
    await mountFrame('allocate', previewDocument('<p>allocate</p>', ALLOCATE_SCRIPT));
    await expect
      .poll(async () => (await reports()).some((r) => (r as { probe?: string; state?: string }).probe === 'allocate' && (r as { state?: string }).state === 'started'))
      .toBe(true);
    const allocateStartedAt = Date.now();
    let allocateFrame: FrameProcesses['frames'][number] | undefined;
    while (Date.now() - allocateStartedAt < 30_000) {
      const current = await withDeadline(frameProcesses(app), 'electron main during allocation');
      allocateFrame = current.frames.find((frame) => frame.url.startsWith('about:srcdoc')) ?? allocateFrame;
      if (allocateFrame && !processAlive(allocateFrame.osProcessId)) break;
      await withDeadline(page.evaluate(() => 1 + 1), 'host during allocation');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const allocateReports = (await reports()).filter((r) => (r as { probe?: string }).probe === 'allocate') as Array<{ mib?: number }>;
    const peakMib = Math.max(0, ...allocateReports.map((r) => r.mib ?? 0));
    const allocateProcessDied = allocateFrame ? !processAlive(allocateFrame.osProcessId) : false;
    await unmountFrame('allocate');
    assert.equal(await withDeadline(page.evaluate(() => 1 + 1), 'host after allocation'), 2);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.isCrashed()), false);

    console.log(
      JSON.stringify(
        {
          hostOsProcessId: spinning.hostOsProcessId,
          spinFrameOsProcessId: spinFrame.osProcessId,
          hostLatenciesMsWhileSpinning: hostLatencies,
          escape: escape.results,
          flood: {
            sent: floodDone.sent,
            sendMs: floodDone.sendMs,
            received: floodCount,
            drainMs: floodDrainMs,
            hostLatencyMsWhileDraining: floodHostLatencies,
          },
          allocate: { peakMib, frameProcessDied: allocateProcessDied },
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await app?.close();
    } finally {
      rmSync(smokeHome, { recursive: true, force: true });
    }
  }
});
