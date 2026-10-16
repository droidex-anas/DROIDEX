self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Images on the laptop have no URL a browser can load. The page that asked for
// one fetches its bytes through its encrypted connection (remoteEntry.tsx).
const LOCAL_IMAGE_PATH = '/__droidex_remote/local-image';
const LOCAL_IMAGE_TIMEOUT_MS = 60_000;
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== LOCAL_IMAGE_PATH) return;
  event.respondWith(localImage(event.clientId, url.searchParams.get('src')));
});
async function localImage(clientId, src) {
  const client = clientId ? await self.clients.get(clientId) : undefined;
  if (!client || !src) return new Response('Image unavailable', { status: 404 });
  const reply = await new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), LOCAL_IMAGE_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    client.postMessage({ type: 'droidex-local-image', src }, [channel.port2]);
  });
  if (!reply?.ok) return new Response('Image unavailable', { status: 404 });
  return new Response(reply.image.data, {
    headers: {
      'content-type': reply.image.mime,
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    },
  });
}

// No session, keys, or profile payloads are cached by the service worker.
self.addEventListener('push', (event) => {
  let url = '/__droidex_remote/app';
  try {
    const payload = event.data?.json();
    if (typeof payload?.url === 'string') {
      const requested = new URL(payload.url, self.location.origin);
      if (requested.origin === self.location.origin && /^\/[a-z][a-z0-9-]{2,29}$/.test(requested.pathname)) url = requested.pathname;
    }
  } catch { /* Invalid payloads still show a generic notification. */ }
  event.waitUntil(self.registration.showNotification('DROIDEX needs your attention', {
    body: 'Open DROIDEX Remote to view your laptop.',
    icon: '/__droidex_remote/icon.svg',
    tag: 'droidex-attention',
    data: { url },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(async (windows) => {
    const client = windows[0];
    if (client) {
      await client.navigate(event.notification.data.url);
      return client.focus();
    }
    return self.clients.openWindow(event.notification.data.url);
  }));
});
