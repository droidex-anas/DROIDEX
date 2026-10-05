import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { expect, test } from '@playwright/test';
import {
  bounded,
  framePid,
  mountFrame,
  processAlive,
  previewDocument,
  terminateFrame,
  withCanvasHost,
} from './canvasSmoke';

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

test('[C1] opaque preview isolates CPU and refuses escapes', async () => {
  await withCanvasHost(async (app, page) => {
    await app.evaluate(({ BrowserWindow }) => {
      Object.assign(globalThis, { __spinEntered: false });
      BrowserWindow.getAllWindows()[0].webContents.on('console-message', (event) => {
        if (event.message === 'CANVAS_SPIN_ENTERED') Reflect.set(globalThis, '__spinEntered', true);
      });
    });
    await mountFrame(
      page,
      "addEventListener('message',()=>{console.log('CANVAS_SPIN_ENTERED');while(true){}},{once:true});",
    );
    await expect.poll(() => framePid(app)).toBeGreaterThan(0);
    const pid = await framePid(app);
    await bounded(
      page.evaluate(() => {
        document
          .querySelector<HTMLIFrameElement>('#canvas-probe')
          ?.contentWindow?.postMessage('spin', '*');
      }),
      'start spin',
    );
    await expect
      .poll(() => app.evaluate(() => Reflect.get(globalThis, '__spinEntered')))
      .toBe(true);
    assert.equal(
      await bounded(
        page.evaluate(() => 2),
        'host while spinning',
      ),
      2,
    );
    await terminateFrame(app, pid);
    await expect.poll(() => processAlive(pid)).toBe(false);
    await page.evaluate(() => document.getElementById('canvas-probe')?.remove());
    await page.evaluate(() => {
      Object.assign(window, { __escape: null });
      addEventListener('message', (event) => {
        if (event.data?.probe === 'escape') Object.assign(window, { __escape: event.data.results });
      });
    });
    const hostUrl = page.url();
    await mountFrame(page, ESCAPE_SCRIPT);
    await expect
      .poll(() =>
        bounded(
          page.evaluate(() => Reflect.get(window, '__escape')),
          'escape collector',
        ),
      )
      .not.toBeNull();
    const results = await page.evaluate(() => Reflect.get(window, '__escape'));
    for (const name of ['parentDocument', 'cookie', 'localStorage', 'topNavigation'])
      assert.match(results[name], /^blocked/);
    assert.match(results.fetch, /^rejected/);
    assert.equal(results.websocket, 'errored');
    assert.equal(results.popup, 'null');
    assert.notEqual(results.worker, 'ran');
    assert.equal(page.url(), hostUrl);
    console.log(JSON.stringify({ escapes: results }));
  });
});

test('[C2] an isolated preview host contains a 200000-message burst', async () => {
  await withCanvasHost(async (app, page) => {
    const document = previewDocument(
      '<p>Flood probe</p>',
      `
      addEventListener('message', () => {
        const startedAt = performance.now();
        for (let sent = 0; sent < 200000; sent += 1) top.postMessage({ bad: true }, '*');
        console.log('ISOLATED_SENT ' + (performance.now() - startedAt));
      }, { once: true });
    `,
    );
    await app.evaluate(async ({ BrowserWindow, WebContentsView }, html) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      const preview = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      mainWindow.contentView.addChildView(preview);
      preview.setBounds({ x: 20, y: 20, width: 320, height: 120 });
      const evidence = {
        sent: 0,
        received: 0,
        sendMs: 0,
        killMs: 0,
        rateMs: 0,
        hostGone: [] as unknown[],
      };
      const appContents = mainWindow.webContents;
      appContents.on('render-process-gone', (_event, details) => evidence.hostGone.push(details));
      preview.webContents.on('console-message', (event) => {
        if (event.message.startsWith('ISOLATED_SENT ')) {
          evidence.sent = 200000;
          evidence.sendMs = Number(event.message.slice(14));
        }
        if (!event.message.startsWith('ISOLATED_RATE ')) return;
        const report = JSON.parse(event.message.slice(14));
        evidence.received = report.received;
        evidence.rateMs = report.elapsedMs;
        if (report.received < 10000) return;
        const at = performance.now();
        preview.webContents.forcefullyCrashRenderer();
        evidence.killMs = performance.now() - at;
      });
      Object.assign(globalThis, { __isolated: { preview, evidence } });
      await preview.webContents.loadURL('data:text/html,<body>Isolated preview host</body>');

      if (preview.webContents.mainFrame.osProcessId === appContents.mainFrame.osProcessId)
        throw new Error('Preview host shares DROIDEX process');
      await preview.webContents.executeJavaScript(`
        let received = 0;
        let startedAt = 0;
        addEventListener('message', () => {
          received += 1;
          if (received === 10000) console.log('ISOLATED_RATE ' + JSON.stringify({
            received, elapsedMs: performance.now() - startedAt,
          }));
        });
        const frame = document.createElement('iframe');
        frame.sandbox = 'allow-scripts';
        frame.srcdoc = ${JSON.stringify(html)};
        frame.onload = () => {
          startedAt = performance.now();
          frame.contentWindow.postMessage('flood', '*');
        };
        document.body.append(frame);
      `);
    }, document);
    const latencies: number[] = [];
    const mainLatencies: number[] = [];
    await expect
      .poll(
        async () => {
          const at = performance.now();
          assert.equal(
            await bounded(
              page.evaluate(() => 2),
              'DROIDEX host during isolated flood',
            ),
            2,
          );
          latencies.push(performance.now() - at);
          const mainAt = performance.now();
          const received = await bounded(
            app.evaluate(() => Reflect.get(globalThis, '__isolated').evidence.received),
            'main during isolated flood',
          );
          mainLatencies.push(performance.now() - mainAt);
          return received;
        },
        { timeout: 30000, intervals: [100] },
      )
      .toBe(10000);
    const afterAt = performance.now();
    assert.equal(
      await bounded(
        page.evaluate(() => 2),
        'DROIDEX host after isolated termination',
      ),
      2,
    );
    const afterMs = performance.now() - afterAt;
    const evidence = await app.evaluate(({ BrowserWindow }) => {
      const state = Reflect.get(globalThis, '__isolated');
      const out = { ...state.evidence, previewCrashed: state.preview.webContents.isCrashed() };
      BrowserWindow.getAllWindows()[0].contentView.removeChildView(state.preview);
      state.preview.webContents.close();
      return out;
    });
    assert.equal(evidence.sent, 200_000);
    assert.deepEqual(evidence.hostGone, []);
    assert.equal(evidence.previewCrashed, true);
    const p95 = (values: number[]) =>
      [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1];
    console.log(
      JSON.stringify({
        isolatedPreviewHost: {
          ...evidence,
          latencies,
          chatMaxMs: Math.max(...latencies),
          chatP95Ms: p95(latencies),
          mainLatencies,
          mainMaxMs: Math.max(...mainLatencies),
          mainP95Ms: p95(mainLatencies),
          afterMs,
        },
      }),
    );
  });
});

test('[C3] frame memory exhaustion preserves the host', async () => {
  await withCanvasHost(async (app, page) => {
    await app.evaluate(({ BrowserWindow }) => {
      const evidence = { peakMib: 0, gone: [] as unknown[] };
      Object.assign(globalThis, { __memory: evidence });
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.on('render-process-gone', (_event, details) => evidence.gone.push(details));
      contents.on('console-message', (event) => {
        if (event.message.startsWith('CANVAS_MIB '))
          evidence.peakMib = Number(event.message.slice(11));
      });
    });
    // Packed double arrays reach V8 heap exhaustion instead of unbounded ArrayBuffer growth.
    await mountFrame(
      page,
      `addEventListener('message',()=>{
      const hoard=[];
      function grow(){hoard.push(new Array(8*1024*1024).fill(1.5));console.log('CANVAS_MIB '+hoard.length*64);setTimeout(grow,0);}
      grow();
    },{once:true});`,
    );
    await expect.poll(() => framePid(app)).toBeGreaterThan(0);
    const pid = await framePid(app);
    const hostPid = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.mainFrame.osProcessId,
    );
    const startedAt = performance.now();
    await page.evaluate(() =>
      document
        .querySelector<HTMLIFrameElement>('#canvas-probe')
        ?.contentWindow?.postMessage('allocate', '*'),
    );
    const latencies: number[] = [];
    let peakRssMiB = 0;
    await expect
      .poll(
        async () => {
          const askedAt = performance.now();
          assert.equal(
            await bounded(
              page.evaluate(() => 2),
              'host during allocation',
            ),
            2,
          );
          latencies.push(performance.now() - askedAt);
          if (processAlive(pid)) {
            try {
              const rssKiB = Number(
                execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
              );
              peakRssMiB = Math.max(peakRssMiB, rssKiB / 1024);
            } catch (error) {
              if (processAlive(pid)) throw error;
            }
          }
          return !processAlive(pid);
        },
        { timeout: 30_000, intervals: [100] },
      )
      .toBe(true);
    const recoveryAt = performance.now();
    assert.equal(
      await bounded(
        page.evaluate(() => 2),
        'host after frame death',
      ),
      2,
    );
    const recoveryMs = performance.now() - recoveryAt;
    assert.equal(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.mainFrame.osProcessId,
      ),
      hostPid,
    );
    const evidence = await app.evaluate(() => Reflect.get(globalThis, '__memory'));
    assert.ok(evidence.peakMib > 0, 'No memory allocation measured');
    console.log(
      JSON.stringify({
        memory: {
          ...evidence,
          peakRssMiB,
          latencies,
          deathMs: performance.now() - startedAt,
          recoveryMs,
          frameDied: !processAlive(pid),
        },
      }),
    );
    assert.deepEqual(evidence.gone, []);
  });
});
