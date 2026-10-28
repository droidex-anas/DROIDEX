import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HANDLE_PATTERN, isRecord } from '../../packages/remote/src/index';
import { LAST_HANDLE_KEY, readDevice } from './deviceStore';
import { RemoteApp } from './RemoteApp';
import { RemoteConnection } from './remoteConnection';
import { createRemoteBrowserControls, createRemoteDesktopApi } from './remoteDesktopApi';
import { applySystemTheme } from './systemTheme';
import { Welcome } from './Welcome';
import '../../src/index.css';

const PIN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function startRemote(container: HTMLElement, requested: string): Promise<void> {
  applySystemTheme();
  const root = createRoot(container);
  let handle = HANDLE_PATTERN.test(requested) ? requested : '';
  let pin: string | null = null;
  let error = '';
  try {
    if (!requested) {
      const recent = localStorage.getItem(LAST_HANDLE_KEY);
      if (recent && HANDLE_PATTERN.test(recent)) {
        window.history.replaceState(null, '', `/${recent}`);
        handle = recent;
      }
    }
    if (handle) {
      // A pairing link carries the laptop's key in its fragment, which never reaches a server.
      const linked = new URLSearchParams(window.location.hash.slice(1)).get('key');
      pin = linked && PIN_PATTERN.test(linked) ? linked : ((await readDevice(handle))?.pin ?? null);
    }
  } catch (reason) {
    error = reason instanceof Error ? reason.message : 'Browser storage is unavailable.';
  }
  if (!handle || !pin) {
    root.render(<Welcome handle={handle} error={error} />);
    return;
  }

  const connection = new RemoteConnection(handle, pin);
  const controls = createRemoteBrowserControls(connection);
  window.droidex = createRemoteDesktopApi(connection, controls);
  serveLocalImages(connection);
  root.render(
    <StrictMode>
      <RemoteApp connection={connection} controls={controls} />
    </StrictMode>,
  );
}

// The service worker answers the renderer's local-image URLs with bytes it asks this page for.
function serveLocalImages(connection: RemoteConnection): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const request = event.data;
    const port = event.ports.at(0);
    if (!port || !isRecord(request) || request.type !== 'droidex-local-image') return;
    if (typeof request.src !== 'string') return;
    connection.call('readLocalImage', [request.src]).then(
      (image) => {
        port.postMessage({ ok: true, image });
      },
      () => {
        port.postMessage({ ok: false });
      },
    );
  });
  navigator.serviceWorker.startMessages();
}
