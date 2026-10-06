import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { expect, test } from '@playwright/test';
import {
  bounded,
  framePid,
  mountFrame,
  processAlive,
  terminateFrame,
  withCanvasHost,
  withNetworkListener,
} from './canvasSmoke';
import { mountWebview } from './canvasWebview';

function escapeScript(networkUrl: string): string {
  return `
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
    settle('fetch', fetch(${JSON.stringify(networkUrl + '/fetch')}).then(() => 'allowed')),
    settle('websocket', new Promise((resolve) => {
      try {
        const socket = new WebSocket(${JSON.stringify(networkUrl.replace('http:', 'ws:') + '/socket')});
        socket.onerror = () => resolve('errored');
        socket.onopen = () => resolve('opened');
      } catch (error) { resolve('blocked: ' + error.name); }
    })),
  ];
  Promise.all(probes).then(done);
`;
}

test('[C1] opaque preview isolates CPU and refuses escapes', async () => {
  await withNetworkListener(async ({ url: networkUrl, attempts, openSockets }) => {
    await withCanvasHost(async (app, page) => {
      await app.evaluate(({ BrowserWindow }) => {
        Object.assign(globalThis, { __spinEntered: false });
        BrowserWindow.getAllWindows()[0].webContents.on('console-message', (event) => {
          if (event.message === 'CANVAS_SPIN_ENTERED')
            Reflect.set(globalThis, '__spinEntered', true);
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
          if (event.data?.probe === 'escape')
            Object.assign(window, { __escape: event.data.results });
        });
      });
      const hostUrl = page.url();
      const positiveControl = await bounded(
        page.evaluate(async (url) => {
          const response = await fetch(url + '/fetch');
          const body = await response.text();
          await new Promise<void>((resolve, reject) => {
            const socket = new WebSocket(url.replace('http:', 'ws:') + '/socket');
            socket.onerror = () => reject(new Error('Host WebSocket could not reach listener'));
            socket.onopen = () => {
              socket.close();
              resolve();
            };
          });
          return body;
        }, networkUrl),
        'host network positive control',
      );
      assert.equal(positiveControl, 'reachable');
      assert.equal(attempts.requests, 1);
      assert.equal(attempts.upgrades, 1);
      assert.ok(attempts.connections >= 2);
      await expect.poll(openSockets).toBe(0);
      const hostAttempts = { ...attempts };
      await mountFrame(page, escapeScript(networkUrl));
      await expect
        .poll(() =>
          bounded(
            page.evaluate(() => Reflect.get(window, '__escape')),
            'escape collector',
          ),
        )
        .not.toBeNull();
      assert.deepEqual(attempts, hostAttempts, 'generated frame reached the network listener');
      const results = await page.evaluate(() => Reflect.get(window, '__escape'));
      for (const name of ['parentDocument', 'cookie', 'localStorage', 'topNavigation'])
        assert.match(results[name], /^blocked/);
      assert.match(results.fetch, /^rejected/);
      assert.equal(results.websocket, 'errored');
      assert.equal(results.popup, 'null');
      assert.notEqual(results.worker, 'ran');
      assert.equal(page.url(), hostUrl);
      console.log(
        JSON.stringify({
          escapes: results,
          hostAttempts,
          generatedAttempts: {
            connections: attempts.connections - hostAttempts.connections,
            requests: attempts.requests - hostAttempts.requests,
            upgrades: attempts.upgrades - hostAttempts.upgrades,
          },
        }),
      );
    });
  });
});

/**
 * A generous bound on one call made while the flood is in flight. It guards
 * against a hang, not against slowness: how long the chat takes to answer under a
 * guest flood is a property of the machine, not of this code. Measured on one
 * Apple M4, the chat's p95 stays at 11–34 ms while its single worst sample ranges
 * over 1.1–3.3 s — it exceeded the previous 3,000 ms bound on an idle machine as
 * well as under ten busy cores, and that bound also failed under load at the base
 * commit. The latencies are therefore reported, and what this case asserts is
 * containment: nothing reached the chat, the guest received the flood, no renderer
 * died, both processes kept answering, and both child processes were released.
 */
const FLOOD_CALL_BOUND_MS = 30_000;

test('[C2] a webview guest contains ancestor flooding and releases its processes', async () => {
  for (const recovery of ['remove', 'crash'] as const) {
    await withCanvasHost(async (app) => {
      const { page, pids } = await mountWebview(
        app,
        `
        addEventListener('message', () => {
          const startedAt = performance.now();
          for (let sequence = 0; sequence < 200000; sequence++)
            top.postMessage({ probe: 'flood', sequence }, '*');
          console.log('WEBVIEW_SENT ' + (performance.now() - startedAt));
        }, { once: true });
      `,
      );
      assert.equal(new Set([pids.chat, pids.guest, pids.generated]).size, 3);
      assert.deepEqual(pids.safety, {
        preload: null,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      });
      await bounded(
        page.evaluate(() => {
          const guest = document.querySelector<Electron.WebviewTag>('#canvas-webview');
          if (!guest) throw new Error('Missing webview');
          return guest.executeJavaScript('window.start()');
        }),
        'start ancestor flood',
        FLOOD_CALL_BOUND_MS,
      );
      const chatLatencies: number[] = [];
      const mainLatencies: number[] = [];
      const startedAt = performance.now();
      await expect
        .poll(
          async () => {
            const chatAskedAt = performance.now();
            const chatPing = bounded(
              page.evaluate(() => 2),
              'chat during guest flood',
              FLOOD_CALL_BOUND_MS,
            ).then((value) => {
              assert.equal(value, 2);
              chatLatencies.push(performance.now() - chatAskedAt);
            });
            const mainAskedAt = performance.now();
            const mainPing = bounded(
              app.evaluate(() => {
                const { sent, received } = globalThis.__canvasGuest.evidence;
                return { sent, received };
              }),
              'main during guest flood',
              FLOOD_CALL_BOUND_MS,
            ).then((counts) => {
              mainLatencies.push(performance.now() - mainAskedAt);
              return counts;
            });
            const [, counts] = await Promise.all([chatPing, mainPing]);
            // Receipt, not the sender's count: the sender finishes its loop in its
            // own process long before the guest has drained anything, so waiting
            // on `sent` alone and asserting receipt afterwards is a race.
            return (
              counts.sent === 200000 &&
              counts.received > 0 &&
              performance.now() - startedAt >= 10000
            );
          },
          { timeout: 30000, intervals: [50] },
        )
        .toBe(true);
      const evidence = await bounded(
        app.evaluate(() => globalThis.__canvasGuest.evidence),
        'guest evidence',
        FLOOD_CALL_BOUND_MS,
      );
      const direct = await bounded(
        page.evaluate(() => window.__canvasDirect),
        'chat message count',
        FLOOD_CALL_BOUND_MS,
      );
      // Containment: nothing the generated frame sent reached the chat, and the
      // guest did receive the flood — without that second fact the first one
      // would hold just as well for a flood that never happened.
      assert.equal(direct, 0);
      assert.ok(evidence.received > 0, 'the guest never received the flood');
      assert.deepEqual(evidence.chatGone, []);
      // Liveness without a wall-clock threshold: both processes answered
      // repeatedly throughout the window, however long each answer took.
      assert.ok(chatLatencies.length >= 5, 'the chat stopped answering during the flood');
      assert.ok(mainLatencies.length >= 5, 'main stopped answering during the flood');
      const recoveryAt = performance.now();
      if (recovery === 'remove') {
        await bounded(
          page.evaluate(() => document.getElementById('canvas-webview')?.remove()),
          'remove guest',
          FLOOD_CALL_BOUND_MS,
        );
      } else {
        await bounded(
          app.evaluate(() => {
            const guest = globalThis.__canvasGuest.guest;
            if (!guest) throw new Error('Guest not attached');
            guest.forcefullyCrashRenderer();
          }),
          'main crash guest',
          FLOOD_CALL_BOUND_MS,
        );
      }
      const callMs = performance.now() - recoveryAt;
      await expect
        .poll(() => [pids.guest, pids.generated].filter(processAlive), {
          timeout: 10000,
          intervals: [10],
        })
        .toEqual([]);
      const goneMs = performance.now() - recoveryAt;
      const afterAt = performance.now();
      assert.equal(
        await bounded(
          page.evaluate(() => 2),
          'chat after guest recovery',
          FLOOD_CALL_BOUND_MS,
        ),
        2,
      );
      const afterMs = performance.now() - afterAt;
      const settled = await bounded(
        app.evaluate(() => {
          const { window, guest, evidence } = globalThis.__canvasGuest;
          if (!guest) throw new Error('Guest not attached');
          return {
            chatPid: window.webContents.mainFrame.osProcessId,
            chatGone: evidence.chatGone,
            guestGone: evidence.guestGone,
            guestDestroyed: guest.isDestroyed(),
            guestCrashed: !guest.isDestroyed() && guest.isCrashed(),
          };
        }),
        'settled guest',
        FLOOD_CALL_BOUND_MS,
      );
      assert.equal(settled.chatPid, pids.chat);
      assert.deepEqual(settled.chatGone, []);
      assert.equal(recovery === 'remove' ? settled.guestDestroyed : settled.guestCrashed, true);
      const p95 = (values: number[]) =>
        [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1];
      console.log(
        JSON.stringify({
          webview: {
            recovery,
            pids,
            ...evidence,
            ...settled,
            direct,
            samples: chatLatencies.length,
            chatMaxMs: Math.max(...chatLatencies),
            chatP95Ms: p95(chatLatencies),
            mainMaxMs: Math.max(...mainLatencies),
            mainP95Ms: p95(mainLatencies),
            callMs,
            goneMs,
            afterMs,
          },
        }),
      );
    });
  }
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
