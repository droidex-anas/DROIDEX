import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from 'react';
import { AnimatePresence } from 'framer-motion';
import { Spinner } from '@droidex/icons';
import type { RemoteArtScene } from '../../src/features/remote/RemoteArt';
import { Button } from '../../src/components/ui/Button';
import type { RemoteBrowserControls } from '../../src/lib/desktop';
import { GateLayout, GateScreen, type GateStep } from './GateLayout';
import { LaunchScreen } from './LaunchScreen';
import { loadLaptopRenderer } from './laptopRenderer';
import { ReconnectPill } from './ReconnectPill';
import type { ConnectionStatus, RemoteConnection } from './remoteConnection';
import { applyLaptopTheme } from './systemTheme';
import { UnlockScreen } from './UnlockScreen';

type GateStatus = Exclude<ConnectionStatus, { kind: 'connecting' }>;

const GATE: Record<GateStatus['kind'], { scene: RemoteArtScene; step?: GateStep }> = {
  code: { scene: 'key', step: 1 },
  pairing: { scene: 'waiting', step: 2 },
  ready: { scene: 'live', step: 3 },
  denied: { scene: 'denied' },
  removed: { scene: 'denied' },
  offline: { scene: 'offline' },
  error: { scene: 'offline' },
};

/** The laptop's DROIDEX once this browser is unlocked, and the screens that get it there. */
export function RemoteApp({
  connection,
  controls,
}: {
  connection: RemoteConnection;
  controls: RemoteBrowserControls;
}) {
  const status = useSyncExternalStore(
    (listener) => connection.onStatus(listener),
    () => connection.status,
  );
  const [Renderer, setRenderer] = useState<ComponentType | null>(null);
  const [loadError, setLoadError] = useState('');
  // A browser approved just now sees the journey finish; a trusted one goes straight in.
  const [approvedHere, setApprovedHere] = useState(false);
  if (status.kind === 'pairing' && !approvedHere) setApprovedHere(true);
  const loading = useRef(false);

  useLayoutEffect(() => {
    applyLaptopTheme(connection.handle);
  }, [connection.handle]);

  useEffect(() => {
    if (status.kind !== 'ready' || loading.current) return;
    loading.current = true;
    loadLaptopRenderer(connection).then(
      (component) => {
        setRenderer(() => component);
      },
      (reason: unknown) => {
        loading.current = false;
        setLoadError(reason instanceof Error ? reason.message : 'DROIDEX could not start.');
      },
    );
  }, [connection, status.kind]);

  const reconnecting = status.kind === 'connecting' || status.kind === 'offline';
  const appVisible = Renderer !== null && (status.kind === 'ready' || reconnecting);

  let overlay;
  if (loadError)
    overlay = (
      <GateLayout key="gate" handle={connection.handle} scene="offline">
        <GateScreen title="DROIDEX couldn’t open" line={loadError}>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        </GateScreen>
      </GateLayout>
    );
  // Until the laptop answers, a trusted browser cannot tell whether it needs a
  // code, so it shows the launch screen instead of flashing a gate.
  else if (status.kind === 'connecting' || (status.kind === 'ready' && !approvedHere))
    overlay = (
      <LaunchScreen
        key="launch"
        message={status.kind === 'ready' ? 'Opening DROIDEX…' : 'Connecting to your laptop…'}
      />
    );
  else
    overlay = (
      <GateLayout key="gate" handle={connection.handle} {...GATE[status.kind]}>
        <AnimatePresence mode="wait" initial={false}>
          <StatusScreen
            key={status.kind}
            status={status}
            connection={connection}
            controls={controls}
          />
        </AnimatePresence>
      </GateLayout>
    );

  return (
    <>
      {Renderer && <Renderer />}
      <ReconnectPill
        status={Renderer && reconnecting ? status.kind : null}
        retry={() => {
          connection.retry();
        }}
      />
      <AnimatePresence>{!appVisible && overlay}</AnimatePresence>
    </>
  );
}

function StatusScreen({
  status,
  connection,
  controls,
}: {
  status: GateStatus;
  connection: RemoteConnection;
  controls: RemoteBrowserControls;
}) {
  const retry = () => {
    connection.retry();
  };
  switch (status.kind) {
    case 'code':
      return (
        <UnlockScreen
          status={status}
          // A browser trusted before keeps its expiry; a new one has none.
          expired={(connection.device?.expiresAt ?? 0) > 0}
          authenticate={(code) => connection.authenticate(code)}
        />
      );
    case 'pairing':
      return (
        <GateScreen
          title="Approve on your laptop"
          line="DROIDEX on your laptop is asking whether to trust this browser. Choose Approve there to continue."
        >
          <WaitingLine text="Waiting for your laptop. Keep this page open." />
        </GateScreen>
      );
    case 'ready':
      return (
        <GateScreen
          title="You’re connected"
          line={`This browser now runs DROIDEX from @${connection.handle}.`}
        >
          <WaitingLine text="Opening DROIDEX…" />
        </GateScreen>
      );
    case 'offline':
      return (
        <GateScreen
          title="Can’t reach your laptop"
          line="Make sure it’s awake, online and running DROIDEX with Remote on. This page reconnects by itself."
        >
          <div className="flex items-center justify-between gap-3">
            <WaitingLine text="Trying again…" />
            <Button onClick={retry}>Retry now</Button>
          </div>
        </GateScreen>
      );
    case 'denied':
      return (
        <GateScreen
          title="Your laptop declined this browser"
          line="If that was a mistake, ask again and choose Approve on your laptop."
        >
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" onClick={retry}>
              Ask again
            </Button>
            <Button variant="ghost" size="lg" onClick={() => void controls.forget()}>
              Forget this browser
            </Button>
          </div>
        </GateScreen>
      );
    case 'removed':
      return (
        <GateScreen
          title="This browser was removed"
          line="Your laptop removed access for this browser. Unlock again to reconnect."
        >
          <Button variant="primary" size="lg" className="w-full" onClick={retry}>
            Unlock again
          </Button>
        </GateScreen>
      );
    case 'error':
      return (
        <GateScreen title="Couldn’t connect" line={<span role="alert">{status.message}</span>}>
          <Button variant="primary" size="lg" className="w-full" onClick={retry}>
            Try again
          </Button>
        </GateScreen>
      );
  }
}

function WaitingLine({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-body text-muted">
      <Spinner className="size-icon-sm motion-safe:animate-spin-slow" aria-hidden="true" />
      {text}
    </p>
  );
}
