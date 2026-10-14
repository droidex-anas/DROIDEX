import { useEffect, useState, type SyntheticEvent } from 'react';
import { ChevronRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { HANDLE_PATTERN } from '../../packages/remote/src/index';
import { forgetDevice, LAST_HANDLE_KEY, readDevice } from './deviceStore';
import { PublicProfile } from './PublicProfile';
import { Brand } from './Brand';
import { Remote } from './Remote';
import './onboarding.css';

export function App() {
  const requested = window.location.pathname.slice(1);
  const [handle, setHandle] = useState(HANDLE_PATTERN.test(requested) ? requested : '');
  const [pin, setPin] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(handle));
  const [error, setError] = useState('');
  useEffect(() => {
    if (requested) return;
    try {
      const recent = localStorage.getItem(LAST_HANDLE_KEY);
      if (recent && HANDLE_PATTERN.test(recent)) {
        window.history.replaceState(null, '', `/${recent}`);
        setHandle(recent);
      }
    } catch {
      setError('Browser storage is unavailable. Enable site storage to remember your laptop.');
    }
  }, [requested]);
  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    const fragmentPin = new URLSearchParams(window.location.hash.slice(1)).get('key');
    setLoading(true);
    setPin(null);
    void readDevice(handle)
      .then((device) => {
        if (cancelled) return;
        const nextPin =
          fragmentPin && /^[A-Za-z0-9_-]{43}$/.test(fragmentPin)
            ? fragmentPin
            : (device?.pin ?? null);
        setPin(nextPin);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Device storage is unavailable.');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);
  if (requested === 'p') return <PublicProfile />;
  if (handle && pin)
    return (
      <Remote
        handle={handle}
        pin={pin}
        onForget={async () => {
          await forgetDevice(handle);
          try {
            localStorage.removeItem(LAST_HANDLE_KEY);
          } catch {
            setError(
              'This browser could not clear its recent username. Clear this site’s browser data to remove it.',
            );
          }
          window.history.replaceState(null, '', '/');
          setHandle('');
          setPin(null);
        }}
      />
    );
  let description = 'See your agents, steer a task, and stay in the loop from your phone.';
  if (handle)
    description =
      'Open Settings → Remote access in DROIDEX on your laptop, then scan its pairing QR code.';
  if (loading) description = 'Checking this browser…';
  return (
    <main className="welcome">
      <Brand />
      <div className="welcome-symbol">
        <LockKeyhole size={30} strokeWidth={1.5} />
      </div>
      <h1>{handle ? 'Your laptop. Your key.' : 'Your laptop, within reach.'}</h1>
      <p>{description}</p>
      {!loading && (
        <div className="surface welcome-card">
          <ShieldCheck size={20} />
          <div>
            <strong>{handle ? `@${handle} is locked` : 'Private by design'}</strong>
            <p>
              Your laptop verifies every device. Its pairing code also verifies your laptop’s
              identity.
            </p>
          </div>
        </div>
      )}
      {!loading && (
        <form
          className="handle-form"
          onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
            event.preventDefault();
            const input = new FormData(event.currentTarget).get('handle');
            if (typeof input !== 'string' || !HANDLE_PATTERN.test(input)) {
              setError('Use 3–30 lowercase letters, numbers, or hyphens. Start with a letter.');
              return;
            }
            setError('');
            window.history.replaceState(null, '', `/${input}`);
            setHandle(input);
          }}
        >
          <label htmlFor="handle">Already paired this browser?</label>
          <div className="field-row">
            <input
              id="handle"
              name="handle"
              placeholder="Your username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              maxLength={30}
              defaultValue={handle}
            />
            <button className="primary icon-button" aria-label="Open your remote">
              <ChevronRight size={20} />
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="fine-print">No account. No cloud agents. Keep DROIDEX open on your laptop.</p>
    </main>
  );
}
