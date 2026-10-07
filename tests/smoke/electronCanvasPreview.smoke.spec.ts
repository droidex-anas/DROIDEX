// The production preview host, exercised through the app's own window, the owned
// privileged scheme and the `will-attach-webview` hardening main installs before
// the renderer loads anything. The Task 1 isolation probes stay in
// electronCanvas.smoke.spec.ts; nothing here fakes a boundary.

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { SourceFiles } from '../../sidecar/src/canvas/schema';
import { CHART_DESIGN } from '../../sidecar/src/canvas/fixtures/chart';
import { DROIDEX_DESIGN_SYSTEM } from '../../sidecar/src/canvas/presets/droidex';
import {
  PREVIEW_POLL_SCRIPT,
  PREVIEW_STARTED,
  previewNonce,
  previewStartScript,
  readPreviewSnapshot,
  type PreviewInstance,
} from '../../src/features/canvas/previewDocument';
import {
  askGuest,
  compileDesign,
  generatedFrameUrl,
  guestUrl,
  inspectGuest,
  mountPreviewGuest,
  mountZoomedPreview,
} from './canvasPreviewHost';
import {
  bounded,
  processAlive,
  withCanvasHost,
  withDatagramListener,
  withNetworkListener,
} from './canvasSmoke';

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

test('the production preview host renders a compiled chart offline', async () => {
  const design = await compileDesign(CHART_DESIGN);
  await withCanvasHost(async (app, page) => {
    const guestId = await mountPreviewGuest(page);
    const instance = newInstance('chart');
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);
    await expect
      .poll(
        async () =>
          (await drainGuest(page, instance)).events.some((event) => event.event === 'ready'),
        { timeout: 20_000, intervals: [100] },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          app.evaluate(({ webContents }, id) => {
            const frame = webContents.fromId(id)?.mainFrame.frames[0];
            return frame?.executeJavaScript(
              `({ title: document.querySelector('h1')?.textContent,
                  bars: document.querySelectorAll('.recharts-bar-rectangle').length })`,
            );
          }, guestId),
        { timeout: 20_000, intervals: [100] },
      )
      .toEqual({ title: 'Weekly visits', bars: 3 });
  });
});

test('[C8] captures the kit starter at its rendered size and refuses a released guest', async () => {
  const starter = DROIDEX_DESIGN_SYSTEM.examples['Hey.tsx'];
  assert.ok(starter);
  const design = await compileDesign({ 'main.tsx': starter });
  await withCanvasHost(async (app, page) => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(900, 900);
    });
    const guestId = await mountPreviewGuest(page);
    await page.evaluate(() => {
      const guest = document.getElementById('canvas-preview-guest');
      if (!guest) throw new Error('Missing guest');
      guest.style.width = '720px';
      guest.style.height = '720px';
    });
    const instance: PreviewInstance = {
      nonce: previewNonce(),
      designId: 'dsg_capture',
      revisionId: 'rev_capture',
      generation: 1,
    };
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);
    await expect
      .poll(
        async () =>
          (await drainGuest(page, instance)).events.some((event) => event.event === 'ready'),
        { timeout: 20_000, intervals: [100] },
      )
      .toBe(true);

    const scaleFactor = await page.evaluate(() => window.devicePixelRatio);
    const began = performance.now();
    const captured = await bounded(
      page.evaluate(
        ({ guestId, scaleFactor, generation }) =>
          window.droidControl?.canvasPreviewCapture({
            requestId: 'smoke_capture',
            guestId,
            canvasId: 'cv_smoke',
            designId: 'dsg_capture',
            revisionId: 'rev_capture',
            generation,
            width: 720,
            height: 720,
            scaleFactor,
          }),
        { guestId, scaleFactor, generation: instance.generation },
      ),
      'starter capture',
      10_000,
    );
    const captureMs = performance.now() - began;
    assert.ok(captured?.ok, `capture failed: ${JSON.stringify(captured)}`);
    const png = Buffer.from(captured.bytes);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 720 * scaleFactor);
    assert.equal(png.readUInt32BE(20), 720 * scaleFactor);
    const cached = await page.evaluate(() =>
      window.droidControl?.canvasThumbnailRead('cv_smoke', 'dsg_capture', 'rev_capture'),
    );
    assert.deepEqual(Buffer.from(cached ?? []), png);
    assert.equal(
      await page.evaluate(() =>
        window.droidControl?.canvasThumbnailRead('cv_smoke', 'dsg_capture', 'rev_other'),
      ),
      null,
    );

    await page.evaluate((id) => {
      document.getElementById('canvas-preview-guest')?.remove();
      return window.droidControl?.canvasPreviewTerminate(id);
    }, guestId);
    const unavailable = await page.evaluate(
      (id) =>
        window.droidControl?.canvasPreviewCapture({
          requestId: 'smoke_released',
          guestId: id,
          canvasId: 'cv_smoke',
          designId: 'dsg_capture',
          revisionId: 'rev_capture',
          generation: 1,
          width: 720,
          height: 720,
          scaleFactor: window.devicePixelRatio,
        }),
      guestId,
    );
    assert.deepEqual(unavailable?.ok, false);
    if (unavailable && !unavailable.ok) assert.equal(unavailable.error.code, 'capture_unavailable');
    console.log(
      JSON.stringify({
        starterCapture: { css: '720x720', scaleFactor, bytes: png.length, captureMs },
      }),
    );
  });
});

test('a transparent design keeps its alpha in the captured PNG', async () => {
  const design = await compileDesign({
    'main.tsx': `export default function Clear() {
  return <><style>{'html, body, #canvas-root { background: transparent !important; }'}</style>
    <div style={{ width: 40, height: 40, background: 'rgb(0 0 255 / 50%)' }} />
  </>;
}
`,
  });
  await withCanvasHost(async (_app, page) => {
    const guestId = await mountPreviewGuest(page);
    const instance: PreviewInstance = {
      nonce: previewNonce(),
      designId: 'dsg_clear',
      revisionId: 'rev_clear',
      generation: 1,
    };
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);
    await expect
      .poll(
        async () =>
          (await drainGuest(page, instance)).events.some((event) => event.event === 'ready'),
        { timeout: 20_000, intervals: [100] },
      )
      .toBe(true);
    const alpha = await page.evaluate(
      async ({ guestId, scaleFactor }) => {
        const captured = await window.droidControl?.canvasPreviewCapture({
          requestId: 'smoke_transparent',
          guestId,
          canvasId: 'cv_smoke',
          designId: 'dsg_clear',
          revisionId: 'rev_clear',
          generation: 1,
          width: 400,
          height: 300,
          scaleFactor,
        });
        if (!captured?.ok) throw new Error(JSON.stringify(captured));
        const bitmap = await createImageBitmap(new Blob([captured.bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Missing image decoder');
        context.drawImage(bitmap, 0, 0);
        return {
          outside: context.getImageData(bitmap.width - 1, bitmap.height - 1, 1, 1).data[3],
          inside: context.getImageData(10, 10, 1, 1).data[3],
        };
      },
      { guestId, scaleFactor: await page.evaluate(() => window.devicePixelRatio) },
    );
    assert.equal(alpha.outside, 0);
    assert.ok(alpha.inside > 0 && alpha.inside < 255);
  });
});

test('a scale(0.5) board preview captures the full layout viewport and far edge', async () => {
  const design = await compileDesign({
    'main.tsx': `export default () => <div style={{ display: 'flex', width: 720, height: 720 }}>
      <div style={{ width: 360, background: 'red' }} />
      <div style={{ width: 360, background: 'blue' }} />
    </div>;`,
  });
  await withCanvasHost(async (app, page) => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(900, 900),
    );
    await mountZoomedPreview(page, design.html);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.droidControl?.canvasThumbnailRead('cv_zoom', 'dsg_zoom', 'rev_zoom'),
          ),
        { timeout: 20_000, intervals: [100] },
      )
      .not.toBeNull();
    const probe = await page.evaluate(async () => {
      const capture = Reflect.get(window, '__canvasZoomCapture') as () => Promise<{
        bytes: Uint8Array;
      }>;
      const image = await capture();
      const bitmap = await createImageBitmap(new Blob([image.bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Missing image decoder');
      context.drawImage(bitmap, 0, 0);
      const guest = document.querySelector<HTMLElement>('#canvas-zoom-probe webview');
      if (!guest) throw new Error('Missing zoomed guest');
      return {
        layoutWidth: guest.offsetWidth,
        layoutHeight: guest.offsetHeight,
        displayedWidth: guest.getBoundingClientRect().width,
        pngWidth: bitmap.width,
        pngHeight: bitmap.height,
        scaleFactor: window.devicePixelRatio,
        rightPixel: [...context.getImageData(bitmap.width - 1, 10, 1, 1).data],
      };
    });
    console.log(`ZOOM_PROBE ${JSON.stringify(probe)}`);
    assert.equal(probe.displayedWidth, 360);
    assert.equal(probe.layoutWidth, 720);
    assert.equal(probe.layoutHeight, 720);
    assert.equal(probe.pngWidth, 720 * probe.scaleFactor);
    assert.equal(probe.pngHeight, 720 * probe.scaleFactor);
    assert.deepEqual(probe.rightPixel, [0, 0, 255, 255]);
  });
});

test('a chart that throws during render reports a preview error without becoming ready', async () => {
  const design = await compileDesign({
    'main.tsx': `import { Bar, BarChart } from 'recharts';

export default function BrokenChart() {
  return <BarChart width={480} height={260} data={[{ visits: 12 }]}>
    <Bar dataKey="visits" isAnimationActive={false}
      shape={() => { throw new Error('Chart shape failed'); }} />
  </BarChart>;
}
`,
  });
  await withCanvasHost(async (_app, page) => {
    await mountPreviewGuest(page);
    const instance = newInstance('broken-chart');
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);
    const seen: string[] = [];
    await expect
      .poll(
        async () => {
          for (const event of (await drainGuest(page, instance)).events) {
            seen.push(event.event);
            if (event.event === 'diagnostics')
              for (const diagnostic of event.diagnostics) seen.push(diagnostic.message);
          }
          return seen.some((entry) => entry.includes('Chart shape failed'));
        },
        { timeout: 10_000, intervals: [100] },
      )
      .toBe(true);
    assert.equal(seen.includes('ready'), false, 'a failed first render cannot become ready');
  });
});

test('[C5] main ends a guest the board asks about, and refuses one it never attached', async () => {
  // A design that keeps running, so the only thing that ends this guest is the
  // board's own request: main's probe of a live design never fires its deadline.
  const design = await compileDesign({
    'main.tsx': 'export default () => <p className="block h-24 w-48">Hey</p>;\n',
  });
  await withCanvasHost(async (app, page) => {
    const guestId = await mountPreviewGuest(page);
    const instance = newInstance('ask');
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);
    await expect
      .poll(
        async () =>
          (await drainGuest(page, instance)).events.some((event) => event.event === 'ready'),
        { timeout: 20_000, intervals: [100] },
      )
      .toBe(true);
    const pids = (await inspectGuest(app, guestId)).pids;
    const owned = [...new Set([pids.guest, pids.generated])].filter(
      (pid) => pid > 0 && pid !== pids.chat,
    );
    assert.equal(owned.length, 2, 'the design holds a process of its own');

    // The runtime's own path when a poll or the readiness deadline expires.
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
    console.log(JSON.stringify({ requestedTermination: { ...pids, owned, goneMs } }));
  });
});

/**
 * Every egress path a fetch directive does not obviously cover. ICE is the one
 * the reviewer got out, over UDP and then over TURN with TCP, which is dialling a
 * remote TCP endpoint; WebTransport, `sendBeacon` and the prefetch hints are the
 * siblings worth holding to the same standard.
 *
 * Each attempt reports itself through the production channel before the test
 * measures anything, so "zero at the listener" can never mean "never tried".
 * `stunUrl` is a UDP listener and `httpUrl` a stream one.
 */
function egressDesign(stunUrl: string, httpUrl: string): SourceFiles {
  const turn = `turn:${httpUrl.replace('http://', '')}?transport=tcp`;
  return {
    'main.tsx': `import { useEffect, useState } from 'react';

const tried: string[] = [];
const attempt = (name: string, run: () => void) => {
  try {
    run();
    tried.push(name);
  } catch (error) {
    tried.push(name + ' refused: ' + String(error).slice(0, 40));
  }
};
const report = () => {
  const said = tried.join(' ');
  setTimeout(() => {
    throw new Error('EGRESS ' + said);
  }, 0);
};

const negotiate = (peer: RTCPeerConnection) => {
  peer.createDataChannel('canvas');
  void peer.createOffer().then((offer) => peer.setLocalDescription(offer));
};
const servers = [
  { urls: ${JSON.stringify(`stun:${stunUrl}`)} },
  { urls: ${JSON.stringify(turn)}, username: 'u', credential: 'c' },
];

// Negotiated at once, and again on a peer that existed well before it: the
// reviewer found both timings reached a TURN server over TCP.
attempt('ice-now', () => negotiate(new RTCPeerConnection({ iceServers: servers })));
const waiting = new RTCPeerConnection({ iceServers: servers });
attempt('beacon', () => {
  navigator.sendBeacon?.(${JSON.stringify(httpUrl + '/beacon')});
});
attempt('hints', () => {
  for (const rel of ['dns-prefetch', 'preconnect', 'prefetch']) {
    const hint = document.createElement('link');
    hint.rel = rel;
    hint.href = ${JSON.stringify(httpUrl + '/hint')};
    document.head.append(hint);
  }
});
attempt('webtransport', () => {
  void new WebTransport(${JSON.stringify(httpUrl.replace('http://', 'https://') + '/wt')}).ready.catch(
    () => undefined,
  );
});

export default function Hey() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      attempt('ice-late', () => negotiate(waiting));
      report();
      setLate(true);
    }, 200);
    return () => clearTimeout(timer);
  }, []);
  return <p className={late ? 'block h-96 w-48' : 'block h-24 w-48'}>{tried.length}</p>;
}
`,
  };
}

/**
 * `a[ping]` on its own guest, because clicking the anchor stops that document
 * running: anything measured after it in the same design would be measuring a
 * dead frame. The attempt reports itself before the click.
 */
function pingDesign(httpUrl: string): SourceFiles {
  return {
    'main.tsx': `import { useEffect, useState } from 'react';

export default function Hey() {
  const [clicked, setClicked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      const ping = document.createElement('a');
      ping.setAttribute('ping', ${JSON.stringify(httpUrl + '/ping')});
      // A fragment, so the click never aims this frame at the listener itself.
      ping.href = '#canvas';
      document.documentElement.append(ping);
      setClicked(true);
      setTimeout(() => {
        throw new Error('EGRESS ping');
      }, 0);
      setTimeout(() => ping.click(), 50);
    }, 200);
    return () => clearTimeout(timer);
  }, []);
  return <p className={clicked ? 'block h-96 w-48' : 'block h-24 w-48'}>ping</p>;
}
`,
  };
}

/** The paths the design must have attempted before zero means anything. */
const EGRESS_PATHS = ['ice-now', 'beacon', 'hints', 'webtransport', 'ice-late'];

/** Drains until every named path has reported itself, then lets traffic land. */
async function awaitAttempts(page: Page, instance: PreviewInstance, paths: readonly string[]) {
  const reported = new Set<string>();
  const collect = async () => {
    for (const event of (await drainGuest(page, instance)).events) {
      if (event.event !== 'diagnostics') continue;
      for (const diagnostic of event.diagnostics) {
        if (!diagnostic.message.includes('EGRESS ')) continue;
        for (const path of paths) if (diagnostic.message.includes(path)) reported.add(path);
      }
    }
    return reported;
  };
  await expect
    .poll(
      async () => {
        const seen = await collect();
        return paths.every((path) => seen.has(path));
      },
      { timeout: 30_000, intervals: [100] },
    )
    .toBe(true);
  for (let poll = 0; poll < 20; poll += 1) await collect();
  return [...reported];
}

test('[C6] no generated network path reaches a listener, including ICE over TCP', async () => {
  await withDatagramListener(async (datagram) => {
    await withNetworkListener(async ({ url, attempts }) => {
      const quiet = { connections: 0, requests: 0, upgrades: 0 };
      const egress = await compileDesign(egressDesign(datagram.url, url));
      const ping = await compileDesign(pingDesign(url));

      await withCanvasHost(async (app, page) => {
        const guestId = await mountPreviewGuest(page);
        const instance = newInstance('egress');
        assert.equal(
          await askGuest(page, previewStartScript(instance, egress.html)),
          PREVIEW_STARTED,
        );
        const reported = await awaitAttempts(page, instance, EGRESS_PATHS);

        assert.equal(datagram.datagrams(), 0, 'ICE reached the UDP listener');
        assert.deepEqual(attempts, quiet);
        // Still the document that was mounted rather than a replacement: every
        // path above reported itself from inside it before this measured.
        assert.match(await generatedFrameUrl(app, guestId), /^about:srcdoc/);
        assert.equal(await guestUrl(app, guestId), GUEST_URL);
        console.log(JSON.stringify({ generatedNetwork: { ...attempts, reported } }));
      });

      // The ping on its own guest, so its click cannot cut the measurement short.
      await withCanvasHost(async (app, page) => {
        const guestId = await mountPreviewGuest(page);
        const instance = newInstance('ping');
        assert.equal(
          await askGuest(page, previewStartScript(instance, ping.html)),
          PREVIEW_STARTED,
        );
        await awaitAttempts(page, instance, ['ping']);
        // The marker is written before the click, so it alone proves nothing. The
        // click's own effect is the fragment it leaves on the frame; without this
        // the case would pass with the click removed entirely.
        await expect
          .poll(() => generatedFrameUrl(app, guestId), { timeout: 20_000, intervals: [100] })
          .toMatch(/#canvas$/);

        assert.deepEqual(attempts, quiet, 'a[ping] reached the listener');
        assert.equal(datagram.datagrams(), 0);
      });
    });
  });
});

test('[C7] main ends a design that stops running after it reported ready', async () => {
  const design = await compileDesign({
    'main.tsx': `import { useEffect, useState } from 'react';

export default function Hey() {
  const [wedged, setWedged] = useState(false);
  useEffect(() => {
    // Readiness is reported for a frame that paints, and only then does the
    // design stop running: the renderer's polls measure the intermediate, which
    // stays responsive, so only main's own probe of this frame can see it.
    const timer = setTimeout(() => setWedged(true), 500);
    return () => clearTimeout(timer);
  }, []);
  if (wedged) {
    const until = Date.now() + 600_000;
    while (Date.now() < until) {}
  }
  return <p className="block h-24 w-48">Hey</p>;
}
`,
  });
  await withCanvasHost(async (app, page) => {
    const guestId = await mountPreviewGuest(page);
    const instance = newInstance('wedge');
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);
    await expect
      .poll(
        async () =>
          (await drainGuest(page, instance)).events.some((event) => event.event === 'ready'),
        { timeout: 20_000, intervals: [100] },
      )
      .toBe(true);
    const pids = (await inspectGuest(app, guestId)).pids;
    const owned = [...new Set([pids.guest, pids.generated])].filter(
      (pid) => pid > 0 && pid !== pids.chat,
    );
    assert.deepEqual(owned.filter(processAlive), owned);

    // Nobody asks main to do this: its own probe of the design's frame misses
    // its deadline and main ends the guest, taking the wedged design with it.
    const startedAt = performance.now();
    await expect
      .poll(() => owned.filter(processAlive), { timeout: 30_000, intervals: [50] })
      .toEqual([]);
    const goneMs = performance.now() - startedAt;

    // Main no longer owns it, so a later renderer request has nothing to end.
    // Polling a crashed guest never answers at all, which is what the runtime's
    // own poll deadline is for; `previewRuntime.test.ts` owns that half.
    assert.equal(
      await bounded(
        page.evaluate((id) => window.droidControl?.canvasPreviewTerminate(id), guestId),
        'refused terminate',
      ),
      false,
    );
    assert.equal(
      await bounded(
        page.evaluate(() => 2),
        'chat after design termination',
      ),
      2,
    );
    console.log(JSON.stringify({ wedgedAfterReady: { ...pids, owned, goneMs } }));
  });
});

/** The first wide-character diagnostic in a raw `drain()` answer, uncut by us. */
function rawDiagnostic(answer: unknown): string {
  assert.equal(typeof answer, 'string');
  const parsed: unknown = JSON.parse(answer as string);
  assert.ok(parsed && typeof parsed === 'object');
  const events: unknown = Reflect.get(parsed, 'events');
  assert.ok(Array.isArray(events));
  for (const event of events) {
    if (Reflect.get(event, 'event') !== 'diagnostics') continue;
    const diagnostics: unknown = Reflect.get(event, 'diagnostics');
    if (!Array.isArray(diagnostics)) continue;
    for (const diagnostic of diagnostics) {
      const text: unknown = Reflect.get(diagnostic, 'message');
      if (typeof text === 'string' && text.includes('界')) return text;
    }
  }
  return '';
}

test('[C8] a wide-character diagnostic is truncated, and never ends the preview', async () => {
  // 200 three-byte characters: 200 code units, 600 bytes. A cap counted in code
  // units lets it through; a reader that refuses over 512 bytes then throws the
  // whole snapshot away and ends the guest over a diagnostic.
  const design = await compileDesign({
    'main.tsx': `import { useEffect, useState } from 'react';

export default function Hey() {
  const [thrown, setThrown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setThrown(true);
      setTimeout(() => {
        throw new Error('界'.repeat(200));
      }, 0);
    }, 200);
    return () => clearTimeout(timer);
  }, []);
  return <p className={thrown ? 'block h-96 w-48' : 'block h-24 w-48'}>Hey</p>;
}
`,
  });
  await withCanvasHost(async (app, page) => {
    const guestId = await mountPreviewGuest(page);
    const instance = newInstance('wide');
    assert.equal(await askGuest(page, previewStartScript(instance, design.html)), PREVIEW_STARTED);

    // Drained raw as well as through the production reader: the renderer trims an
    // over-long field, so checking only its output would pass even if the
    // intermediate still cut by code unit and handed over 616 bytes.
    let raw = '';
    let message = '';
    await expect
      .poll(
        async () => {
          const answer = await askGuest(page, PREVIEW_POLL_SCRIPT);
          const snapshot = readPreviewSnapshot(answer, instance);
          assert.ok(snapshot, 'the guest answered with a snapshot for this instance');
          for (const event of snapshot.events) {
            if (event.event !== 'diagnostics') continue;
            for (const diagnostic of event.diagnostics)
              if (diagnostic.message.includes('界')) {
                message = diagnostic.message;
                raw = rawDiagnostic(answer);
              }
          }
          return message.length > 0;
        },
        { timeout: 20_000, intervals: [100] },
      )
      .toBe(true);

    // The intermediate's own cut, before the renderer normalizes anything.
    assert.ok(raw.includes('界'), 'the raw snapshot carried the diagnostic');
    assert.equal(Buffer.byteLength(raw, 'utf8') <= 512, true, 'the intermediate cut by code unit');
    assert.equal(raw, message, 'the two sides disagree about where to cut');

    // Cut to the byte cap on a code point boundary: 170 characters is 510 bytes,
    // and a 171st would be 513.
    assert.equal(Buffer.byteLength(message, 'utf8') <= 512, true);
    assert.equal(message.includes('�'), false, 'a character was split in half');
    assert.equal(
      [...message].every((character) => character.length === 1),
      true,
    );
    assert.ok(message.includes('界'.repeat(100)), 'the diagnostic still says something');

    // The guest is untouched: a diagnostic is display data, not a reason to end a
    // preview, and the design is still running.
    assert.equal(await guestUrl(app, guestId), GUEST_URL);
    assert.equal(await generatedFrameUrl(app, guestId), 'about:srcdoc');
    assert.deepEqual(await drainGuest(page, instance), { events: [], dropped: 0 });
    console.log(
      JSON.stringify({
        wideDiagnostic: {
          characters: [...message].length,
          bytes: Buffer.byteLength(message, 'utf8'),
        },
      }),
    );
  });
});
