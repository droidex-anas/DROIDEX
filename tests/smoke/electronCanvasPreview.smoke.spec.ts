// The production preview host, exercised through the app's own window, the owned
// privileged scheme and the `will-attach-webview` hardening main installs before
// the renderer loads anything. The Task 1 isolation probes stay in
// electronCanvas.smoke.spec.ts; nothing here fakes a boundary.

import assert from 'node:assert/strict';
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
  askGuest,
  compileDesign,
  guestUrl,
  inspectGuest,
  mountPreviewGuest,
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
 * Every egress path CSP's fetch directives do not obviously cover. ICE is the
 * one the reviewer got a datagram out of; `sendBeacon`, `a[ping]` and the
 * prefetch hints are the siblings worth holding to the same standard.
 *
 * `stunUrl` is a UDP listener and `httpUrl` a stream one; the design must reach
 * neither. The anchor is clicked from an effect rather than at module scope,
 * because clicking one before this document has mounted ends the document.
 */
function egressDesign(stunUrl: string, httpUrl: string): SourceFiles {
  return {
    'main.tsx': `import { useEffect, useState } from 'react';

const tried: string[] = [];
try {
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: ${JSON.stringify(`stun:${stunUrl}`)} }],
  });
  peer.createDataChannel('canvas');
  void peer.createOffer().then((offer) => peer.setLocalDescription(offer));
  tried.push('ice');
} catch (error) {
  tried.push('ice refused: ' + String(error));
}
void navigator.sendBeacon?.(${JSON.stringify(httpUrl + '/beacon')});
for (const rel of ['dns-prefetch', 'preconnect', 'prefetch']) {
  const hint = document.createElement('link');
  hint.rel = rel;
  hint.href = ${JSON.stringify(httpUrl + '/hint')};
  document.head.append(hint);
}

export default function Hey() {
  const [pinged, setPinged] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      const ping = document.createElement('a');
      ping.setAttribute('ping', ${JSON.stringify(httpUrl + '/ping')});
      // A fragment, so the click fires the ping rather than leaving the page.
      ping.href = '#canvas';
      document.documentElement.append(ping);
      ping.click();
      setPinged(true);
    }, 200);
    return () => clearTimeout(timer);
  }, []);
  return <p className={pinged ? 'block h-96 w-48' : 'block h-24 w-48'}>{tried.join(',')}</p>;
}
`,
  };
}

test('[C6] no generated network path reaches a listener, including ICE', async () => {
  await withDatagramListener(async (datagram) => {
    await withNetworkListener(async ({ url, attempts }) => {
      const design = await compileDesign(egressDesign(datagram.url, url));
      await withCanvasHost(async (app, page) => {
        const guestId = await mountPreviewGuest(page);
        const instance = newInstance('ice');
        assert.equal(
          await askGuest(page, previewStartScript(instance, design.html)),
          PREVIEW_STARTED,
        );
        await expect
          .poll(
            async () =>
              (await drainGuest(page, instance)).events.some((event) => event.event === 'ready'),
            { timeout: 20_000, intervals: [100] },
          )
          .toBe(true);
        // Give every attempt the design made room to land before measuring.
        for (let poll = 0; poll < 20; poll += 1) await drainGuest(page, instance);

        assert.equal(datagram.datagrams(), 0, 'ICE reached the UDP listener');
        assert.deepEqual(attempts, { connections: 0, requests: 0, upgrades: 0 });
        // The design is still running, so none of this ended the guest either.
        assert.equal(await guestUrl(app, guestId), GUEST_URL);
        console.log(
          JSON.stringify({ generatedNetwork: { datagrams: datagram.datagrams(), ...attempts } }),
        );
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
