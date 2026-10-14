self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// No session, keys, or profile payloads are cached by the service worker.
self.addEventListener('push', (event) => {
  let url = '/';
  try {
    const payload = event.data?.json();
    if (typeof payload?.url === 'string') {
      const requested = new URL(payload.url, self.location.origin);
      if (requested.origin === self.location.origin && /^\/[a-z][a-z0-9-]{2,29}$/.test(requested.pathname)) url = requested.pathname;
    }
  } catch { /* Invalid payloads still show a generic notification. */ }
  event.waitUntil(self.registration.showNotification('DROIDEX needs your attention', {
    body: 'Open DROIDEX Remote to view your laptop.',
    icon: '/icon.svg',
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
