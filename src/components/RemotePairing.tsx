import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound } from '@droidex/icons';
import type { RemoteSetup, RemoteState } from '../../packages/remote/src/desktop';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Field';

function useRemoteQr(value: string, setError: (message: string) => void) {
  const [qr, setQr] = useState({ value: '', image: '' });
  useEffect(() => {
    if (!value) return;
    const api = window.droidex;
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

// The code image carries its own white quiet zone, so it scans in either theme.
function QrCode({ image, alt }: { image: string; alt: string }) {
  if (!image)
    return (
      <div
        role="status"
        aria-label="Preparing code"
        className="size-40 shrink-0 animate-pulse rounded-lg bg-elevated"
      />
    );
  return <img src={image} alt={alt} className="droid-rise size-40 shrink-0 rounded-lg" />;
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
  const api = window.droidex;
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
      <div>
        <Button
          variant="primary"
          size="lg"
          icon={KeyRound}
          loading={starting}
          disabled={busy || starting}
          onClick={() => {
            void begin();
          }}
        >
          Show setup code
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-6 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await api.confirmRemoteAuthenticator(code);
          return api.configureRemote({ enabled: true });
        });
      }}
    >
      <QrCode image={qr} alt="Setup code for your authenticator app" />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col items-start gap-1">
          <p className="text-body text-secondary">
            Scan it with 1Password, Google Authenticator or any authenticator app.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2.5"
            aria-expanded={showKey}
            onClick={() => {
              setShowKey(!showKey);
            }}
          >
            {showKey ? 'Hide setup key' : 'Can’t scan? Show the key'}
          </Button>
          {showKey && (
            <code className="block select-all break-all rounded-md bg-elevated px-3 py-2 font-mono text-code-sm text-secondary">
              {setup.secret}
            </code>
          )}
        </div>
        <Field label="Code from the app">
          <Input
            required
            autoFocus
            pattern="[0-9]{6}"
            placeholder="000000"
            className="max-w-48 font-mono tabular-nums tracking-widest"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
            }}
          />
        </Field>
        <div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy}
            disabled={busy || code.length !== 6}
          >
            Verify and go live
          </Button>
        </div>
      </div>
    </form>
  );
}

export function RemotePairingCode({
  url,
  setError,
}: {
  url: string;
  setError: (message: string) => void;
}) {
  const qr = useRemoteQr(url, setError);
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
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      <QrCode image={qr} alt="Pairing code: scan it with your other device’s camera" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        <p className="text-body text-secondary">
          Scan it with your phone or tablet camera, or copy the link to another computer.
        </p>
        <p className="text-caption text-muted">
          The link carries this laptop’s key. Share it only with your own devices.
        </p>
        <Button
          icon={copied ? Check : Copy}
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
          {copied ? 'Copied' : 'Copy pairing link'}
        </Button>
      </div>
    </div>
  );
}
