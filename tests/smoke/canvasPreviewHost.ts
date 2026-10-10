// Drives the production preview host: the app's own main window, the owned
// privileged scheme, and the `will-attach-webview` hardening main installs
// before the renderer loads anything. Nothing here fakes a boundary; the guest
// it mounts is the one a board mounts.

import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CompilerWorker, type CompiledDesign } from '../../sidecar/src/canvas/compiler';
import { DEFAULT_DESIGN_SYSTEM_REF } from '../../sidecar/src/canvas/designSystems';
import type { SourceFiles } from '../../sidecar/src/canvas/schema';
import { bounded } from './canvasSmoke';

export const GUEST_ELEMENT_ID = 'canvas-preview-guest';

/** What main reports about a guest it attached, and the processes behind it. */
export interface MountedGuest {
  guestId: number;
  pids: { chat: number; guest: number; generated: number };
  safety: Record<string, unknown>;
}

/** The production artifact for one design, compiled by the real compiler. */
export async function compileDesign(files: SourceFiles): Promise<CompiledDesign> {
  const compiler = new CompilerWorker();
  try {
    return await compiler.compile(
      {
        designId: 'dsg_smoke',
        revisionId: 'rev_smoke',
        generation: 1,
        files,
        designSystem: DEFAULT_DESIGN_SYSTEM_REF,
      },
      new AbortController().signal,
    );
  } finally {
    await compiler.terminate();
  }
}

/**
 * Mounts one guest in the production window, requesting everything the
 * attachment boundary must refuse. Answers once main has attached it and the
 * intermediate's own iframe exists.
 */
export async function mountPreviewGuest(page: Page): Promise<number> {
  const url = await bounded(
    page.evaluate(() => window.droidControl?.canvasPreviewUrl ?? null),
    'preview url',
  );
  expect(url).toBe('droidex-canvas-preview://preview/guest');
  const guestId = await bounded(
    page.evaluate(
      ({ id, src }) => {
        const guest = document.createElement('webview') as HTMLElement & {
          getWebContentsId: () => number;
        };
        guest.id = id;
        guest.setAttribute('src', src);
        // Deliberately unsafe requests the attachment boundary must strip.
        guest.setAttribute('preload', 'file:///etc/passwd');
        guest.setAttribute('nodeintegration', '');
        guest.setAttribute(
          'webpreferences',
          'nodeIntegrationInSubFrames=yes,contextIsolation=no,sandbox=no,webSecurity=no,webviewTag=yes',
        );
        guest.style.cssText =
          'display:flex;position:fixed;left:0;top:0;width:400px;height:300px;z-index:99999';
        document.body.append(guest);
        return new Promise<number>((resolve) => {
          guest.addEventListener('dom-ready', () => resolve(guest.getWebContentsId()), {
            once: true,
          });
        });
      },
      { id: GUEST_ELEMENT_ID, src: url as string },
    ),
    'mount preview guest',
    15_000,
  );
  return guestId;
}

/** Mounts the real renderer component beneath a board zoom, including its capture registry. */
export async function mountZoomedPreview(page: Page, html: string): Promise<void> {
  const fromSidecar = createRequire(path.resolve('sidecar/package.json'));
  const bundler = fromSidecar('esbuild') as {
    build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
  };
  const bundled = await bundler.build({
    stdin: {
      contents: `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewGuestFrame } from '../../src/features/canvas/DesignPreview';
import { captureCanvasImage } from '../../src/features/canvas/captureCanvasImage';
const container = document.createElement('div');
container.id = 'canvas-zoom-probe';
container.style.cssText = 'position:fixed;left:0;top:0;width:720px;height:720px;transform:scale(0.5);transform-origin:top left;z-index:99999';
document.body.append(container);
createRoot(container).render(createElement(PreviewGuestFrame, {
  canvasId: 'cv_zoom', designId: 'dsg_zoom', revisionId: 'rev_zoom', generation: 1,
  showingRevisionId: null, html: ${JSON.stringify(html)}, diagnostics: [],
  reportPreview: () => undefined,
}));
Object.assign(window, { __canvasZoomCapture: () =>
  captureCanvasImage('cv_zoom', { designId: 'dsg_zoom', revisionId: 'rev_zoom' }, new AbortController().signal) });
`,
      resolveDir: path.resolve('tests/smoke'),
      sourcefile: 'canvasZoomProbe.tsx',
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await page.evaluate(`(() => { ${bundled.outputFiles[0].text} })()`);
}

/** What main can prove about one attached guest, read through its own handle. */
export async function inspectGuest(
  app: ElectronApplication,
  guestId: number,
): Promise<MountedGuest> {
  return bounded(
    app.evaluate(({ BrowserWindow, webContents }, id) => {
      const guest = webContents.fromId(id);
      if (!guest) throw new Error('Main does not know that guest');
      const chat = BrowserWindow.getAllWindows()[0].webContents;
      // Electron 39 exposes this inspector without a public type declaration.
      const inspect: unknown = Reflect.get(guest, 'getLastWebPreferences');
      if (typeof inspect !== 'function') throw new Error('Missing guest preference inspector');
      const preferences: unknown = Reflect.apply(inspect, guest, []);
      if (!preferences || typeof preferences !== 'object')
        throw new Error('Invalid guest preferences');
      const flag = (name: string): unknown => Reflect.get(preferences, name);
      const generated = guest.mainFrame.frames[0];
      return {
        guestId: id,
        pids: {
          chat: chat.mainFrame.osProcessId,
          guest: guest.mainFrame.osProcessId,
          generated: generated ? generated.osProcessId : 0,
        },
        safety: {
          preload: flag('preload') ?? null,
          nodeIntegration: flag('nodeIntegration'),
          nodeIntegrationInSubFrames: flag('nodeIntegrationInSubFrames'),
          contextIsolation: flag('contextIsolation'),
          sandbox: flag('sandbox'),
          webSecurity: flag('webSecurity'),
          webviewTag: flag('webviewTag'),
        },
      };
    }, guestId),
    'inspect guest',
  );
}

/** Runs one of the board's own scripts in the guest, as the pull channel does. */
export async function askGuest(page: Page, code: string): Promise<unknown> {
  return bounded(
    page.evaluate(
      ({ id, script }) => {
        const guest = document.getElementById(id) as (HTMLElement & Electron.WebviewTag) | null;
        if (!guest) throw new Error('Missing preview guest');
        return guest.executeJavaScript(script);
      },
      { id: GUEST_ELEMENT_ID, script: code },
    ),
    'guest script',
    10_000,
  );
}

/** The page's own view of the guest URL, so navigation can be checked. */
export async function guestUrl(app: ElectronApplication, guestId: number): Promise<string> {
  return bounded(
    app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL() ?? 'gone', guestId),
    'guest url',
  );
}

/** The generated design's own frame URL, so a probe cannot replace it unseen. */
export async function generatedFrameUrl(
  app: ElectronApplication,
  guestId: number,
): Promise<string> {
  return bounded(
    app.evaluate(({ webContents }, id) => {
      const guest = webContents.fromId(id);
      if (!guest) throw new Error('Main does not know that guest');
      return guest.mainFrame.frames[0]?.url ?? 'none';
    }, guestId),
    'generated frame url',
  );
}
