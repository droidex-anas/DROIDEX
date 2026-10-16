import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from 'react';
import { AnimatePresence } from 'framer-motion';
import { Laptop, ShieldX, TriangleAlert, Unplug, WifiOff } from 'lucide-react';
import { Spinner } from '@droidex/icons';
import { ghostButton, primaryButton, secondaryButton } from '../../src/components/buttonStyles';
import type { RemoteBrowserControls } from '../../src/lib/desktop';
import { GateLayout, GateScreen, JourneySteps, largeButton } from './GateLayout';
import { LaunchScreen } from './LaunchScreen';
import { loadLaptopRenderer } from './laptopRenderer';
import { ReconnectPill } from './ReconnectPill';
import type { ConnectionStatus, RemoteConnection } from './remoteConnection';
import { applyLaptopTheme } from './systemTheme';
import { UnlockScreen } from './UnlockScreen';

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
      <GateLayout key="gate" handle={connection.handle}>
        <GateScreen icon={<Unplug size={24} strokeWidth={1.5} />} title="DROIDEX couldn’t open">
          <p>{loadError}</p>
          <button
            className={`${primaryButton} ${largeButton} w-full`}
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </button>
        </GateScreen>
      </GateLayout>
    );
  // Until the laptop answers, a trusted browser cannot tell whether it needs a
  // code, so it shows the launch screen instead of flashing a gate.
  else if (status.kind === 'connecting' || status.kind === 'ready')
    overlay = (
      <LaunchScreen
        key="launch"
        message={status.kind === 'ready' ? 'Opening DROIDEX…' : 'Connecting to your laptop…'}
      />
    );
  else
    overlay = (
      <GateLayout key="gate" handle={connection.handle}>
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
  status: Exclude<ConnectionStatus, { kind: 'connecting' | 'ready' }>;
  connection: RemoteConnection;
  controls: RemoteBrowserControls;
}) {
  const retry = () => {
    connection.retry();
  };
  switch (status.kind) {
    case 'offline':
      return (
        <GateScreen icon={<WifiOff size={24} strokeWidth={1.5} />} title="Can’t reach your laptop">
          <p>
            Make sure it’s awake, online, and running DROIDEX with Remote turned on. This page
            reconnects by itself.
          </p>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-droid-elevated/60 px-3.5 py-3">
            <p className="flex items-center gap-2 text-[13px]">
              <Spinner className="h-3.5 w-3.5 text-droid-text-muted motion-safe:animate-spin-slow" />
              Trying again…
            </p>
            <button className={secondaryButton} onClick={retry}>
              Retry now
            </button>
          </div>
        </GateScreen>
      );
    case 'code':
      return <UnlockScreen connection={connection} status={status} />;
    case 'pairing':
      return (
        <GateScreen
          progress={<JourneySteps current="Approve" />}
          icon={
            <span className="relative">
              <Laptop size={24} strokeWidth={1.5} />
              <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-droid-green motion-safe:animate-pulse" />
            </span>
          }
          title="Approve on your laptop"
        >
          <p>
            DROIDEX on your laptop is asking whether to trust this browser. Choose{' '}
            <strong className="font-medium text-droid-text">Approve</strong> there to continue.
          </p>
          <p role="status" className="flex items-center gap-2 text-[13px] text-droid-text-muted">
            <Spinner className="h-3.5 w-3.5 motion-safe:animate-spin-slow" />
            Waiting for your laptop. Keep this page open.
          </p>
        </GateScreen>
      );
    case 'denied':
      return (
        <GateScreen
          icon={<ShieldX size={24} strokeWidth={1.5} />}
          title="Your laptop declined this browser"
        >
          <p>If that was a mistake, request access again and approve it on your laptop.</p>
          <div className="grid gap-2">
            <button className={`${primaryButton} ${largeButton}`} onClick={retry}>
              Request again
            </button>
            <button
              className={`${ghostButton} ${largeButton}`}
              onClick={() => void controls.forget()}
            >
              Forget this browser
            </button>
          </div>
        </GateScreen>
      );
    case 'error':
      return (
        <GateScreen icon={<TriangleAlert size={24} strokeWidth={1.5} />} title="Couldn’t connect">
          <p role="alert">{status.message}</p>
          <button className={`${primaryButton} ${largeButton} w-full`} onClick={retry}>
            Try again
          </button>
        </GateScreen>
      );
  }
}
