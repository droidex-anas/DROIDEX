import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { decodeBase64 } from '../../packages/remote/src/index';
import type { RemoteCommand } from '../../packages/remote/src/application';

export function PushSettings({
  publicKey,
  send,
}: {
  publicKey: string;
  send: (command: RemoteCommand) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIphone = /iPhone|iPad/.test(navigator.userAgent);
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true);
  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    void navigator.serviceWorker.ready
      .then(async (registration) => {
        const subscription = await registration.pushManager.getSubscription();
        if (!disposed) setEnabled(Boolean(subscription));
      })
      .catch(() => {
        if (!disposed) setError('Notification setup is unavailable. Reload this page to retry.');
      });
    return () => {
      disposed = true;
    };
  }, [supported]);
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        await send({ type: 'push.unsubscribe' });
        if (!(await current.unsubscribe()))
          throw new Error(
            'Unable to turn notifications off. Retry or remove this site’s notification permission.',
          );
        setEnabled(false);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted')
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
        await send({
          type: 'push.subscribe',
          subscription: {
            endpoint: details.endpoint,
            keys: { p256dh: details.keys.p256dh, auth: details.keys.auth },
          },
        });
      } catch (reason) {
        await subscription.unsubscribe();
        throw reason;
      }
      setEnabled(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change notifications.');
    } finally {
      setBusy(false);
    }
  }
  if (isIphone && !installed)
    return (
      <p className="notification-hint">
        For approval notifications on iPhone, use Share → Add to Home Screen, then open DROIDEX
        there.
      </p>
    );
  if (!supported) return null;
  let label = enabled ? 'Turn off notifications' : 'Enable approval notifications';
  if (busy) label = 'Updating notifications…';
  return (
    <div className="notification-settings">
      <button disabled={busy} onClick={() => void toggle()}>
        {enabled ? <BellOff size={16} /> : <Bell size={16} />}
        {label}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
