import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserWindow, WebContents } from 'electron';
import { expect, type ElectronApplication } from '@playwright/test';
import { bounded, previewDocument } from './canvasSmoke';

declare global {
  var __canvasGuest: {
    window: BrowserWindow;
    guest: WebContents | null;
    evidence: {
      sent: number;
      sendMs: number;
      received: number;
      elapsedMs: number;
      chatGone: unknown[];
      guestGone: unknown[];
    };
  };
  interface Window {
    __canvasDirect: number;
  }
}

export async function mountWebview(app: ElectronApplication, script: string) {
  const source = previewDocument(
    '<p>Canvas guest</p>',
    script + ';document.body.dataset.canvasReady="true";',
  );
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about:; worker-src 'none'; connect-src 'none'"><style>html,body{margin:0;width:100%;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style><body><iframe sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><script>
    const frame = document.querySelector('iframe');
    const child = frame.contentWindow;
    let received = 0, startedAt = 0;
    addEventListener('message', event => {
      if (event.source !== child || event.data?.probe !== 'flood') return;
      received++;
      if (received % 10000 === 0) console.log('WEBVIEW_RECEIVED ' + JSON.stringify({
        received, elapsedMs: performance.now() - startedAt,
      }));
    });
    window.start = () => { startedAt = performance.now(); child.postMessage('start', '*'); };
    frame.srcdoc = ${JSON.stringify(source).replaceAll('<', '\\u003c')};
  </script>`;
  await bounded(
    app.evaluate(({ session }, html) => {
      // Reuse an already privileged scheme only in the scratch profile.
      session.defaultSession.protocol.unhandle('droidex-favicon');
      session.defaultSession.protocol.handle('droidex-favicon', (request) => {
        const allowed = request.url === 'droidex-favicon://canvas-webview/host';
        return new Response(allowed ? html : 'Forbidden', {
          status: allowed ? 200 : 403,
          headers: { 'Content-Type': 'text/html' },
        });
      });
    }, html),
    'guest protocol',
  );
  const nextWindow = app.waitForEvent('window');
  await bounded(
    app.evaluate(
      ({ BrowserWindow }, files) => {
        const window = new BrowserWindow({
          width: 1000,
          height: 700,
          webPreferences: {
            preload: files.preload,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webviewTag: true,
          },
        });
        const evidence = {
          sent: 0,
          sendMs: 0,
          received: 0,
          elapsedMs: 0,
          chatGone: [] as unknown[],
          guestGone: [] as unknown[],
        };
        globalThis.__canvasGuest = { window, guest: null, evidence };
        window.webContents.on('will-attach-webview', (event, preferences, params) => {
          if (params.src !== 'droidex-favicon://canvas-webview/host') {
            event.preventDefault();
            return;
          }
          delete preferences.preload;
          delete params.preload;
          preferences.nodeIntegration = false;
          preferences.nodeIntegrationInSubFrames = false;
          preferences.contextIsolation = true;
          preferences.sandbox = true;
          preferences.webSecurity = true;
          preferences.webviewTag = false;
        });
        window.webContents.on('render-process-gone', (_event, details) =>
          evidence.chatGone.push(details),
        );
        window.webContents.on('did-attach-webview', (_event, guest) => {
          globalThis.__canvasGuest.guest = guest;
          guest.setWindowOpenHandler(() => ({ action: 'deny' }));
          guest.on('will-navigate', (event, url) => {
            if (url !== 'droidex-favicon://canvas-webview/host') event.preventDefault();
          });
          guest.on('render-process-gone', (_event, details) => evidence.guestGone.push(details));
          guest.on('console-message', (event) => {
            if (event.message.startsWith('WEBVIEW_SENT ')) {
              evidence.sent = 200000;
              evidence.sendMs = Number(event.message.slice(13));
            }
            if (event.message.startsWith('WEBVIEW_RECEIVED '))
              Object.assign(evidence, JSON.parse(event.message.slice(17)));
          });
        });
        void window.loadURL(files.url);
      },
      {
        preload: path.resolve('electron/preload.cjs'),
        url: pathToFileURL(path.resolve('dist/index.html')).href,
      },
    ),
    'guest probe window',
  );
  const page = await bounded(nextWindow, 'guest probe page', 10000);
  await page.waitForLoadState('domcontentloaded');
  await bounded(
    page.evaluate(
      (preload) => {
        const guest = document.createElement('webview');
        guest.id = 'canvas-webview';
        guest.setAttribute('src', 'droidex-favicon://canvas-webview/host');
        // Deliberately unsafe requests must be stripped by the attachment boundary.
        guest.setAttribute('preload', preload);
        guest.setAttribute('nodeintegration', '');
        guest.setAttribute(
          'webpreferences',
          'nodeIntegrationInSubFrames=yes,contextIsolation=no,sandbox=no,webSecurity=no,webviewTag=yes',
        );
        guest.style.cssText =
          'display:flex;position:fixed;left:100px;top:100px;width:200px;height:200px';
        document.body.append(guest);
        window.__canvasDirect = 0;
        addEventListener('message', (event) => {
          if (event.data?.probe === 'flood') window.__canvasDirect++;
        });
      },
      pathToFileURL(path.resolve('electron/preload.cjs')).href,
    ),
    'mount guest',
  );
  await expect
    .poll(() =>
      bounded(
        app.evaluate(() =>
          globalThis.__canvasGuest.guest?.mainFrame.frames.some(
            (frame) => frame.url === 'about:srcdoc',
          ),
        ),
        'guest attached',
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      bounded(
        app.evaluate(() => {
          const guest = globalThis.__canvasGuest.guest;
          if (!guest) throw new Error('Guest not attached');
          return guest.mainFrame.frames[0].executeJavaScript('document.body.dataset.canvasReady');
        }),
        'generated ready',
      ),
    )
    .toBe('true');
  const pids = await bounded(
    app.evaluate(() => {
      const { window, guest } = globalThis.__canvasGuest;
      if (!guest) throw new Error('Guest not attached');
      // Electron 39 exposes this probe-only inspector without a public type declaration.
      const inspect: unknown = Reflect.get(guest, 'getLastWebPreferences');
      if (typeof inspect !== 'function') throw new Error('Missing guest preference inspector');
      const preferences: unknown = Reflect.apply(inspect, guest, []);
      if (!preferences || typeof preferences !== 'object')
        throw new Error('Invalid guest preferences');
      const flag = (name: string) => {
        const value: unknown = Reflect.get(preferences, name);
        if (typeof value !== 'boolean') throw new Error('Invalid guest preference: ' + name);
        return value;
      };
      const preload: unknown = Reflect.get(preferences, 'preload');
      if (preload !== undefined && typeof preload !== 'string')
        throw new Error('Invalid guest preload');
      return {
        chat: window.webContents.mainFrame.osProcessId,
        guest: guest.mainFrame.osProcessId,
        generated: guest.mainFrame.frames[0].osProcessId,
        safety: {
          preload: preload ?? null,
          nodeIntegration: flag('nodeIntegration'),
          nodeIntegrationInSubFrames: flag('nodeIntegrationInSubFrames'),
          contextIsolation: flag('contextIsolation'),
          sandbox: flag('sandbox'),
          webSecurity: flag('webSecurity'),
          webviewTag: flag('webviewTag'),
        },
      };
    }),
    'guest PIDs',
  );
  return { page, pids };
}
