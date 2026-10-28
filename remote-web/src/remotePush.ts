import { decodeBase64 } from '../../packages/remote/src/index';
import type { RemoteNotificationState } from '../../src/lib/desktop';
import type { RemoteConnection } from './remoteConnection';

const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const needsHomeScreen = () =>
  /iPhone|iPad/.test(navigator.userAgent) &&
  !window.matchMedia('(display-mode: standalone)').matches &&
  !('standalone' in navigator && navigator.standalone === true);

// The laptop only hands its push key to a browser it remembers between visits.
function pushPublicKey(connection: RemoteConnection): string | null {
  return connection.status.kind === 'ready' ? connection.status.pushPublicKey : null;
}

export async function pushState(connection: RemoteConnection): Promise<RemoteNotificationState> {
  if (needsHomeScreen()) return 'needs-home-screen';
  if (!supported()) return 'unsupported';
  if (!pushPublicKey(connection)) return 'not-remembered';
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function setPush(
  connection: RemoteConnection,
  enabled: boolean,
): Promise<RemoteNotificationState> {
  const publicKey = pushPublicKey(connection);
  if (!publicKey || !supported()) return pushState(connection);
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  if (!enabled) {
    if (current) {
      await connection.updatePush(null);
      if (!(await current.unsubscribe()))
        throw new Error(
          'Unable to turn notifications off. Retry or remove this site’s notification permission.',
        );
    }
    return 'off';
  }
  if (current) return 'on';
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error('Allow notifications for this site in your browser settings, then retry.');
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64(publicKey),
  });
  const details = subscription.toJSON();
  if (!details.endpoint || !details.keys?.p256dh || !details.keys.auth) {
    await subscription.unsubscribe();
    throw new Error('This browser did not provide a valid notification subscription.');
  }
  try {
    await connection.updatePush({
      endpoint: details.endpoint,
      keys: { p256dh: details.keys.p256dh, auth: details.keys.auth },
    });
  } catch (reason) {
    await subscription.unsubscribe();
    throw reason;
  }
  return 'on';
}
