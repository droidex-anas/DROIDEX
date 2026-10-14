import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import type { RemoteSetup, RemoteState } from '../../packages/remote/src/desktop';

const button =
  'min-h-11 rounded-xl bg-droid-active px-4 py-2 text-[13px] font-medium text-droid-text transition-colors hover:bg-droid-elevated disabled:opacity-40';

function useRemoteQr(value: string, setError: (message: string) => void) {
  const [qr, setQr] = useState({ value: '', image: '' });
  useEffect(() => {
    if (!value) return;
    const api = window.droidControl;
    if (!api) return;
    let active = true;
    void api
      .remoteQr(value)
      .then((image) => {
        if (active) setQr({ value, image });
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Could not create the pairing code.');
      });
    return () => {
      active = false;
    };
  }, [value, setError]);
  return qr.value === value ? qr.image : '';
}

export function RemoteAuthenticatorSetup({
  busy,
  run,
  setError,
}: {
  busy: boolean;
  run: (action: () => Promise<RemoteState>) => Promise<boolean>;
  setError: (message: string) => void;
}) {
  const [setup, setSetup] = useState<RemoteSetup | null>(null);
  const [code, setCode] = useState('');
  const [starting, setStarting] = useState(false);
  const qr = useRemoteQr(setup?.uri ?? '', setError);
  const api = window.droidControl;
  if (!api) return null;
  const begin = async () => {
    setStarting(true);
    setError('');
    try {
      setSetup(await api.setupRemoteAuthenticator());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not set up the authenticator.');
    } finally {
      setStarting(false);
    }
  };
  return (
    <section className="space-y-4">
      <div>
        <p className="text-[11px] text-droid-text-muted">2 of 3</p>
        <h3 className="mt-1 text-[15px] font-medium text-droid-text">Set up your authenticator</h3>
        <p className="mt-1.5 text-[12px] leading-5 text-droid-text-muted">
          A fresh code and your laptop’s approval protect every new device.
        </p>
      </div>
      {!setup ? (
        <button
          className={button}
          disabled={busy || starting}
          onClick={() => {
            void begin();
          }}
        >
          {starting ? 'Setting up…' : 'Set up authenticator'}
        </button>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api.confirmRemoteAuthenticator(code);
              return api.configureRemote({ enabled: true });
            });
          }}
        >
          {qr ? (
            <img src={qr} alt="Scan with your authenticator" className="h-48 w-48 rounded-xl p-2" />
          ) : (
            <p role="status" className="text-[12px] text-droid-text-muted">
              Preparing your setup code…
            </p>
          )}
          <p className="text-[12px] text-droid-text-secondary">
            Scan with your authenticator, then enter its current code.
          </p>
          <details className="text-[12px] text-droid-text-muted">
            <summary className="cursor-pointer py-1">Enter setup key manually</summary>
            <code className="mt-2 block select-all break-all rounded-lg bg-droid-elevated p-3">
              {setup.secret}
            </code>
          </details>
          <label className="block text-[12px] text-droid-text-secondary">
            Authenticator code
            <input
              required
              pattern="[0-9]{6}"
              className="mt-1.5 block min-h-11 w-full rounded-xl bg-droid-elevated px-3 text-[14px] tabular-nums tracking-widest text-droid-text focus:outline-none focus-visible:bg-droid-active"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </label>
          <button type="submit" className={button} disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Verify and turn on Remote'}
          </button>
        </form>
      )}
    </section>
  );
}

export function RemotePairingCode({
  url,
  setError,
}: {
  url: string | undefined;
  setError: (message: string) => void;
}) {
  const qr = useRemoteQr(url ?? '', setError);
  const [copied, setCopied] = useState(false);
  if (!url) return null;
  return (
    <section className="space-y-3">
      <div>
        <p className="text-[11px] text-droid-text-muted">3 of 3</p>
        <h3 className="mt-1 text-[15px] font-medium text-droid-text">Connect your phone</h3>
      </div>
      {qr ? (
        <img
          src={qr}
          alt="Scan with your phone camera to connect to your laptop"
          className="h-48 w-48 rounded-xl p-2"
        />
      ) : (
        <p role="status" className="text-[12px] text-droid-text-muted">
          Preparing your pairing code…
        </p>
      )}
      <p className="max-w-sm text-[12px] leading-5 text-droid-text-secondary">
        Scan with your phone camera, enter a fresh authenticator code, then approve the device here
        on your laptop.
      </p>
      <button
        className={`${button} inline-flex items-center gap-2`}
        onClick={() => {
          void navigator.clipboard
            .writeText(url)
            .then(() => {
              setCopied(true);
            })
            .catch(() => {
              setError('Could not copy the pairing link. Scan the code instead.');
            });
        }}
      >
        <Copy size={14} />
        {copied ? 'Copied' : 'Copy pairing link'}
      </button>
      <p className="text-[11px] leading-5 text-droid-text-muted">
        The pairing link verifies your laptop’s identity. Your username alone opens a locked screen.
      </p>
    </section>
  );
}
