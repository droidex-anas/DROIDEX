// The real `DesignPreview` driven in the built app's renderer, to hold the one
// contract no server render can reach: after a read misses, the next build
// transition has to read again.
//
// A rebuild of identical source is content-addressed to the same `artifactId`, so
// the component cannot key that re-read on the artifact's name. React commits only
// the final props of a batched pair of renders, so `building` → `ready` for one
// revision arrives as a single commit whose revision, status and artifact ID are
// exactly what the frame already had — and whose `generation` is the attempt that
// produced the recovered document. That counter is the signal; `[C10]` holds the
// other side of it, where an arrange re-sends a frame with its build unmoved.
//
// Nothing here is added to production code. The probe is bundled from source with
// the esbuild the sidecar declares, and evaluated in the page.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { withCanvasHost } from './canvasSmoke';

/** The one build state the probe recovers into, named once so it cannot drift. */
const ARTIFACT_ID = 'a'.repeat(64);
const ARTIFACT_HTML =
  '<!doctype html><html><body><div id="canvas-root">recovered</div></body></html>';

/**
 * esbuild is declared by the sidecar, not the root, so it is resolved from there
 * rather than relied on as a hoisted transitive of the root's toolchain.
 */
interface BrowserBundler {
  build(options: Record<string, unknown>): Promise<{ outputFiles?: { text: string }[] }>;
}

function sidecarEsbuild(): BrowserBundler {
  const fromSidecar = createRequire(path.resolve('sidecar/package.json'));
  return fromSidecar('esbuild') as BrowserBundler;
}

/**
 * The probe: the real component, a container and root, a render entry point, and
 * one `readArtifact` whose identity never changes — so a re-read can only be the
 * component deciding it needs one, never a new callback forcing it.
 */
const PROBE = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { applyCanvasChange } from '../../src/features/canvas/applyCanvasChange';
import { DesignPreview } from '../../src/features/canvas/DesignPreview';
import type {
  CanvasBuildState,
  CanvasFrame,
  CanvasSnapshot,
} from '../../src/features/canvas/protocol';

const probe = { reads: 0, available: false };

const container = document.createElement('div');
container.id = 'canvas-recovery-probe';
container.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px;z-index:99999';
document.body.append(container);
const root = createRoot(container);

// Declared once and never replaced: the component's own deps are the only thing
// that can ask for another read.
const readArtifact = () => {
  probe.reads += 1;
  return Promise.resolve(
    probe.available ? { artifactId: ${JSON.stringify(ARTIFACT_ID)}, html: ${JSON.stringify(ARTIFACT_HTML)} } : null,
  );
};

const frameFor = (build: CanvasBuildState): CanvasFrame => ({
  designId: 'dsg_recover',
  name: 'Hey',
  rect: { x: 0, y: 0, width: 400, height: 300 },
  layoutVersion: 1,
  revisionId: 'r',
  designSystem: { id: 'droidex', version: 1, mode: 'dark' },
  build,
});

// The projection the board holds, extended the way the client extends it.
let snapshot: CanvasSnapshot = { canvasId: 'cv_recover', sequence: 1, frames: [] };

const show = () => {
  const [frame] = snapshot.frames;
  root.render(
    createElement(DesignPreview, {
      canvasId: snapshot.canvasId,
      frame,
      revisionId: 'r',
      readArtifact,
      reportPreview: () => undefined,
    }),
  );
};

Object.assign(window, {
  __canvasRecovery: {
    probe,
    renderBuild(build: CanvasBuildState) {
      snapshot = { ...snapshot, frames: [frameFor(build)] };
      show();
    },
    /**
     * An arrange response: the sidecar re-sends the frame it moved, with a fresh
     * frame object and the build exactly as it was.
     */
    arrange(rect: { x: number; y: number; width: number; height: number }) {
      const [held] = snapshot.frames;
      snapshot = applyCanvasChange(snapshot, {
        canvasId: snapshot.canvasId,
        sequence: snapshot.sequence + 1,
        frames: [{ ...held, rect, layoutVersion: held.layoutVersion + 1, build: { ...held.build } }],
        removedDesignIds: [],
      });
      show();
    },
  },
});
`;

async function installProbe(page: Page): Promise<void> {
  const bundled = await sidecarEsbuild().build({
    stdin: {
      contents: PROBE,
      resolveDir: path.resolve('tests/smoke'),
      sourcefile: 'canvasRecoveryProbe.tsx',
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const [output] = bundled.outputFiles ?? [];
  assert.ok(output, 'the probe bundle produced no output');
  // Wrapped so the bundle is one expression; CDP evaluation needs no CSP relief
  // on this page, which ships no policy of its own.
  await page.evaluate(`(() => { ${output.text} })()`);
}

interface ProbeView {
  reads: number;
  text: string;
  guests: number;
}

async function readProbe(page: Page): Promise<ProbeView> {
  return page.evaluate(() => {
    const recovery = Reflect.get(window, '__canvasRecovery') as { probe: { reads: number } };
    const container = document.getElementById('canvas-recovery-probe');
    return {
      reads: recovery.probe.reads,
      text: container?.textContent ?? '',
      guests: container?.querySelectorAll('webview').length ?? 0,
    };
  });
}

test('[C9] a build transition after a lost artifact reads again and mounts it', async () => {
  await withCanvasHost(async (_app, page) => {
    await installProbe(page);

    // A frame that is `ready` for a revision whose document the cache has lost.
    await page.evaluate((artifactId) => {
      const recovery = Reflect.get(window, '__canvasRecovery') as {
        renderBuild: (build: unknown) => void;
      };
      recovery.renderBuild({ status: 'ready', revisionId: 'r', artifactId, generation: 1 });
    }, ARTIFACT_ID);

    await expect
      .poll(async () => (await readProbe(page)).reads, { timeout: 20_000, intervals: [50] })
      .toBe(1);
    const missed = await readProbe(page);
    assert.match(missed.text, /Building this preview again/);
    assert.equal(missed.guests, 0);

    // The runtime finishes the rebuild. `building` and `ready` arrive in one task,
    // so React commits only the second: same revision, same status, same content
    // hash, and a `generation` of 2 where the frame had 1.
    await page.evaluate((artifactId) => {
      const recovery = Reflect.get(window, '__canvasRecovery') as {
        probe: { available: boolean };
        renderBuild: (build: unknown) => void;
      };
      recovery.probe.available = true;
      recovery.renderBuild({ status: 'building', revisionId: 'r', generation: 2 });
      recovery.renderBuild({ status: 'ready', revisionId: 'r', artifactId, generation: 2 });
    }, ARTIFACT_ID);

    await expect
      .poll(async () => (await readProbe(page)).reads, { timeout: 20_000, intervals: [50] })
      .toBe(2);
    await expect
      .poll(async () => (await readProbe(page)).guests, { timeout: 20_000, intervals: [50] })
      .toBe(1);

    const recovered = await readProbe(page);
    assert.equal(recovered.text.includes('Building this preview again'), false);
    assert.equal(
      await page.evaluate(
        () =>
          document
            .getElementById('canvas-recovery-probe')
            ?.querySelector('webview')
            ?.getAttribute('src') ?? '',
      ),
      'droidex-canvas-preview://preview/guest',
    );
    console.log(JSON.stringify({ artifactRecovery: { ...recovered, artifactId: ARTIFACT_ID } }));
  });
});

test('[C10] arranging a loaded frame keeps its preview and its state', async () => {
  await withCanvasHost(async (_app, page) => {
    await installProbe(page);

    // A frame whose document is there from the start, so the preview mounts.
    await page.evaluate((artifactId) => {
      const recovery = Reflect.get(window, '__canvasRecovery') as {
        probe: { available: boolean };
        renderBuild: (build: unknown) => void;
      };
      recovery.probe.available = true;
      recovery.renderBuild({ status: 'ready', revisionId: 'r', artifactId, generation: 1 });
    }, ARTIFACT_ID);

    await expect
      .poll(async () => (await readProbe(page)).guests, { timeout: 20_000, intervals: [50] })
      .toBe(1);
    const mounted = await readProbe(page);
    assert.equal(mounted.reads, 1);
    // The guest element itself, so a replacement is visible as a different node.
    const before = await page.evaluate(() => {
      const guest = document.getElementById('canvas-recovery-probe')?.querySelector('webview');
      Object.assign(window, { __canvasGuestNode: guest });
      return guest?.isConnected ?? false;
    });
    assert.equal(before, true);

    // An arrange: a new frame object, a new layout version, a build whose values
    // did not move. Nothing about the preview has changed.
    await page.evaluate(() => {
      const recovery = Reflect.get(window, '__canvasRecovery') as {
        arrange: (rect: { x: number; y: number; width: number; height: number }) => void;
      };
      recovery.arrange({ x: 120, y: 90, width: 400, height: 300 });
    });

    // Settle anything the arrange could have scheduled before reading.
    for (let turn = 0; turn < 10; turn += 1) await readProbe(page);
    const arranged = await readProbe(page);
    assert.equal(arranged.reads, 1, 'an arrange re-read the artifact');
    assert.equal(arranged.guests, 1);
    assert.equal(
      await page.evaluate(() => {
        const held = Reflect.get(window, '__canvasGuestNode') as Element | undefined;
        const guest = document.getElementById('canvas-recovery-probe')?.querySelector('webview');
        return held === guest && (guest?.isConnected ?? false);
      }),
      true,
      'the arrange replaced the guest, so a mounted preview lost its state',
    );
    console.log(JSON.stringify({ arrangeKeptPreview: arranged }));
  });
});
