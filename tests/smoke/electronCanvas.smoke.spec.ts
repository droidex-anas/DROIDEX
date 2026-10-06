import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { SourceFiles } from '../../sidecar/src/canvas/schema';
import {
  PREVIEW_POLL_SCRIPT,
  PREVIEW_STARTED,
  previewNonce,
  previewStartScript,
  readPreviewSnapshot,
  type PreviewInstance,
} from '../../src/features/canvas/previewDocument';
import {
  PREVIEW_POLL_INTERVAL_MS,
  PREVIEW_READY_DEADLINE_MS,
} from '../../src/features/canvas/previewRuntime';
import {
  bounded,
  framePid,
  mountFrame,
  processAlive,
  terminateFrame,
  withCanvasHost,
  withNetworkListener,
} from './canvasSmoke';
import {
  askGuest,
  compileDesign,
  guestUrl,
  inspectGuest,
  mountPreviewGuest,
} from './canvasPreviewHost';
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
            ).then((value) => {
              assert.equal(value, 2);
              chatLatencies.push(performance.now() - chatAskedAt);
            });
            const mainAskedAt = performance.now();
            const mainPing = bounded(
              app.evaluate(() => globalThis.__canvasGuest.evidence.sent),
              'main during guest flood',
            ).then((sent) => {
              mainLatencies.push(performance.now() - mainAskedAt);
              return sent;
            });
            const [, sent] = await Promise.all([chatPing, mainPing]);
            return sent === 200000 && performance.now() - startedAt >= 10000;
          },
          { timeout: 30000, intervals: [50] },
        )
        .toBe(true);
      const evidence = await bounded(
        app.evaluate(() => globalThis.__canvasGuest.evidence),
        'guest evidence',
      );
      const direct = await bounded(
        page.evaluate(() => window.__canvasDirect),
        'chat message count',
      );
      assert.equal(direct, 0);
      assert.ok(evidence.received > 0);
      assert.deepEqual(evidence.chatGone, []);
      const recoveryAt = performance.now();
      if (recovery === 'remove') {
        await bounded(
          page.evaluate(() => document.getElementById('canvas-webview')?.remove()),
          'remove guest',
        );
      } else {
        await bounded(
          app.evaluate(() => {
            const guest = globalThis.__canvasGuest.guest;
            if (!guest) throw new Error('Guest not attached');
            guest.forcefullyCrashRenderer();
          }),
          'main crash guest',
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

const SAFE_GUEST = {
  preload: null,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
};

const GUEST_URL = 'droidex-canvas-preview://preview/guest';

/**
 * A design that grows when it is clicked, takes its own instance nonce the way
 * any code in the preview could, and spends it on messages the intermediate must
 * refuse. It also tries to reach `networkUrl`, which it must never get to.
 */
function spoofingDesign(networkUrl: string): SourceFiles {
  return {
    'main.tsx': `import { useState } from 'react';

const WRONG_NONCE = '${'f'.repeat(32)}';
const host = window.parent;

// Nothing hands generated code the nonce, but the host's reporter shares this
// document and runs after this bundle, and \`parent\` is replaceable, so a design
// can take one: the nonce correlates messages, it does not authorize them.
function steal(message, origin) {
  host.postMessage(message, origin);
  const nonce = String(message.canvasPreview || '');
  if (!nonce) return;
  Object.defineProperty(window, 'parent', { configurable: true, value: host });
  // Over the message cap, under the real nonce: dropped and counted.
  host.postMessage({ canvasPreview: nonce, event: 'diagnostics',
    diagnostics: [{ code: 'flood', message: 'x'.repeat(8000) }] }, '*');
  // A shape the intermediate does not know, under the real nonce.
  host.postMessage({ canvasPreview: nonce, event: 'takeover', width: 4242, height: 4242 }, '*');
  // The right shape under a nonce that is not this instance's.
  host.postMessage({ canvasPreview: WRONG_NONCE, event: 'resize', width: 4242, height: 4242 }, '*');
}
Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage: steal } });

void fetch(${JSON.stringify(networkUrl + '/design')}).catch(() => undefined);
const beacon = new Image();
beacon.src = ${JSON.stringify(networkUrl + '/pixel')};

export default function Hey() {
  const [tall, setTall] = useState(false);
  return (
    <button type="button" onClick={() => setTall(true)}
      className={tall ? 'block h-96 w-48' : 'block h-24 w-48'}>Hey</button>
  );
}
`,
  };
}

/** One poll of the production pull channel, validated by the production reader. */
async function drainGuest(page: Page, instance: PreviewInstance) {
  const answer = await askGuest(page, PREVIEW_POLL_SCRIPT);
  const snapshot = readPreviewSnapshot(answer, instance);
  assert.ok(snapshot, 'the guest answered with a snapshot for this instance');
  return snapshot;
}

/** Brings the app window forward, so pointer input has somewhere to land. */
async function focusHost(app: ElectronApplication): Promise<void> {
  await bounded(
    app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
    }),
    'focus host window',
  );
}

function newInstance(designId: string): PreviewInstance {
  return { nonce: previewNonce(), designId, revisionId: `rev_${designId}`, generation: 1 };
}

test('[C4] the production host runs a compiled design and refuses every spoof', async () => {
  await withNetworkListener(async ({ url: networkUrl, attempts }) => {
    const design = await compileDesign(spoofingDesign(networkUrl));
    await withCanvasHost(async (app, page) => {
      const guestId = await mountPreviewGuest(page);
      const attached = await inspectGuest(app, guestId);

      // Production `will-attach-webview` stripped the deliberately unsafe request.
      assert.deepEqual(attached.safety, SAFE_GUEST);
      // The owned scheme serves exactly one URL.
      assert.equal(
        await bounded(
          app.evaluate(({ net }) =>
            net.fetch('droidex-canvas-preview://preview/other').then((response) => response.status),
          ),
          'scheme refusal',
        ),
        403,
      );

      const instance = newInstance('smoke');
      assert.equal(
        await askGuest(page, previewStartScript(instance, design.html)),
        PREVIEW_STARTED,
      );
      // One guest holds one instance, so a second start reaches nothing.
      assert.equal(
        await askGuest(page, previewStartScript(instance, design.html)),
        'already_started',
      );

      let height = 0;
      let dropped = 0;
      const seen: string[] = [];
      await expect
        .poll(
          async () => {
            const snapshot = await drainGuest(page, instance);
            dropped += snapshot.dropped;
            for (const event of snapshot.events) {
              seen.push(event.event);
              if (event.event === 'resize') height = event.height;
            }
            return seen.includes('ready');
          },
          { timeout: 20_000, intervals: [100] },
        )
        .toBe(true);
      const beforeClick = height;
      assert.ok(beforeClick > 0, 'the compiled design reported its own size');
      const mounted = await inspectGuest(app, guestId);
      assert.equal(
        new Set([mounted.pids.chat, mounted.pids.guest, mounted.pids.generated]).size,
        3,
        'chat, guest and generated design hold three processes',
      );

      // A real pointer press on the app window, over the guest. Hit-test routing
      // into an out-of-process frame follows paint, so the click is repeated
      // until the compiled button's React state grows the element.
      await focusHost(app);
      await expect
        .poll(
          async () => {
            await page.mouse.click(40, 40);
            for (const event of (await drainGuest(page, instance)).events)
              if (event.event === 'resize') height = event.height;
            return height;
          },
          { timeout: 20_000, intervals: [200] },
        )
        .toBeGreaterThan(beforeClick);

      // The oversized message was dropped and counted; neither a wrong nonce nor
      // an unknown shape ever became an event.
      assert.ok(dropped > 0, 'the oversized message was dropped and counted');
      assert.deepEqual(
        [...new Set(seen)].filter((name) => name !== 'ready' && name !== 'resize'),
        [],
      );
      assert.notEqual(height, 4242);

      // A message from the guest's own window is not a message from its iframe.
      await askGuest(
        page,
        `window.postMessage({ canvasPreview: ${JSON.stringify(instance.nonce)}, event: 'resize', width: 4242, height: 4242 }, '*')`,
      );
      assert.deepEqual(await drainGuest(page, instance), { events: [], dropped: 0 });

      // Nothing in the guest reached the listener, and nothing navigated away.
      assert.deepEqual(attempts, { connections: 0, requests: 0, upgrades: 0 });
      await askGuest(page, "try { location.href = 'https://example.invalid/' } catch {}");
      await askGuest(page, "try { window.open('https://example.invalid/') } catch {}");
      assert.equal(await guestUrl(app, guestId), GUEST_URL);
      console.log(
        JSON.stringify({
          productionGuest: { ...mounted, artifactBytes: design.html.length, dropped, height },
        }),
      );
    });
  });
});

test('[C5] main ends a guest whose design never finishes rendering', async () => {
  const hanging = await compileDesign({
    'main.tsx': `export default function Hey() {
  const until = Date.now() + 600_000;
  while (Date.now() < until) {}
  return <p>never</p>;
}
`,
  });
  await withCanvasHost(async (app, page) => {
    const guestId = await mountPreviewGuest(page);
    const instance = newInstance('hang');
    assert.equal(await askGuest(page, previewStartScript(instance, hanging.html)), PREVIEW_STARTED);
    await expect
      .poll(() => inspectGuest(app, guestId).then((guest) => guest.pids.generated))
      .toBeGreaterThan(0);
    const pids = (await inspectGuest(app, guestId)).pids;
    // A design that wedges inside its very first script may not have been moved
    // into its own process yet; ending the guest releases it either way.
    const owned = [...new Set([pids.guest, pids.generated])].filter(
      (pid) => pid > 0 && pid !== pids.chat,
    );

    // The guest answers every poll the runtime would have made before its ready
    // deadline, so what ends this preview is that deadline, not a lost guest.
    const polls = Math.ceil(PREVIEW_READY_DEADLINE_MS / PREVIEW_POLL_INTERVAL_MS);
    for (let poll = 0; poll < polls; poll += 1) {
      const snapshot = await drainGuest(page, instance);
      assert.equal(
        snapshot.events.some((event) => event.event === 'ready'),
        false,
        'a wedged design cannot report ready',
      );
    }

    // What the runtime does once that deadline passes: ask main, which ends the
    // guest through its own handle without consulting it.
    const terminatedAt = performance.now();
    assert.equal(
      await bounded(
        page.evaluate((id) => window.droidControl?.canvasPreviewTerminate(id), guestId),
        'terminate request',
      ),
      true,
    );
    await expect
      .poll(() => owned.filter(processAlive), { timeout: 10_000, intervals: [10] })
      .toEqual([]);
    const goneMs = performance.now() - terminatedAt;

    // Main refuses an ID it no longer holds and one it never attached.
    for (const unknown of [guestId, 999_999]) {
      assert.equal(
        await bounded(
          page.evaluate((id) => window.droidControl?.canvasPreviewTerminate(id), unknown),
          'refused terminate',
        ),
        false,
      );
    }
    assert.equal(
      await bounded(
        page.evaluate(() => 2),
        'chat after guest termination',
      ),
      2,
    );
    console.log(JSON.stringify({ hungDesign: { ...pids, polls, owned, goneMs } }));
  });
});
