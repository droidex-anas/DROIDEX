import { Check, Copy, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RemoteSetup, RemoteState } from '../../packages/remote/src/desktop';
import { ghostButton, primaryButton, secondaryButton } from './buttonStyles';

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

function QrTile({ image, alt }: { image: string; alt: string }) {
  return (
    <div className="relative flex h-44 w-44 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-droid-sm">
      {image ? (
        <img src={image} alt={alt} className="droid-rise h-40 w-40" />
      ) : (
        <div
          role="status"
          aria-label="Preparing code"
          className="h-36 w-36 animate-pulse rounded-lg bg-black/5"
        />
      )}
    </div>
  );
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
  const [showKey, setShowKey] = useState(false);
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
  if (!setup) {
    return (
      <div className="space-y-3">
        <p className="text-[12px] leading-[18px] text-droid-text-muted">
          Every new device needs a fresh code from your authenticator app and your laptop’s
          approval. Any TOTP app works.
        </p>
        <button
          className={primaryButton}
          disabled={busy || starting}
          onClick={() => {
            void begin();
          }}
        >
          <KeyRound size={13} />
          {starting ? 'Preparing…' : 'Set up authenticator'}
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-5 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await api.confirmRemoteAuthenticator(code);
          return api.configureRemote({ enabled: true });
        });
      }}
    >
      <QrTile image={qr} alt="Scan with your authenticator app" />
      <div className="flex min-w-0 flex-1 flex-col">
        <ol className="space-y-1 text-[12px] leading-[18px] text-droid-text-secondary">
          <li>1. Scan the code with your authenticator app.</li>
          <li>2. Enter the 6-digit code it shows.</li>
        </ol>
        <button
          type="button"
          className="mt-1 self-start text-[11px] text-droid-text-muted underline decoration-droid-text-muted/40 underline-offset-2 hover:text-droid-text"
          onClick={() => {
            setShowKey(!showKey);
          }}
        >
          {showKey ? 'Hide setup key' : 'Can’t scan? Enter the key instead'}
        </button>
        {showKey && (
          <code className="mt-2 block select-all break-all rounded-lg bg-droid-elevated px-3 py-2 text-[11px] text-droid-text-secondary">
            {setup.secret}
          </code>
        )}
        <label className="mt-4 block text-[12px] text-droid-text-secondary">
          Authenticator code
          <input
            required
            autoFocus
            pattern="[0-9]{6}"
            placeholder="000000"
            className="mt-1.5 block h-11 w-full max-w-[220px] rounded-lg bg-droid-elevated px-3 font-mono text-[18px] tabular-nums tracking-[0.4em] text-droid-text placeholder:text-droid-text-muted/40 focus:outline-none focus-visible:bg-droid-active"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
          />
        </label>
        <div className="mt-4">
          <button type="submit" className={primaryButton} disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Verify and turn on Remote'}
          </button>
        </div>
      </div>
    </form>
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
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1400);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  if (!url) {
    return (
      <p className="text-[12px] leading-[18px] text-droid-text-muted">
        Turn Remote on to show a pairing code.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5 sm:flex-row">
      <QrTile image={qr} alt="Scan with your phone camera to connect to your laptop" />
      <div className="flex min-w-0 flex-1 flex-col">
        <ol className="space-y-1 text-[12px] leading-[18px] text-droid-text-secondary">
          <li>1. Scan with your phone camera.</li>
          <li>2. Enter a fresh authenticator code on the phone.</li>
          <li>3. Approve the phone here on your laptop.</li>
        </ol>
        <p className="mt-3 text-[11px] leading-[18px] text-droid-text-muted">
          The pairing link proves it is your laptop. Your username alone only opens a locked screen.
        </p>
        <div className="mt-auto pt-4">
          <button
            className={copied ? secondaryButton : ghostButton}
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
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy pairing link'}
          </button>
        </div>
      </div>
    </div>
  );
}
