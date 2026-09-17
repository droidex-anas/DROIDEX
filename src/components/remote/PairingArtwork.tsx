import { useCallback, useEffect, useRef, useState } from 'react';

export type PairingArtworkPhase =
  | 'intro' | 'scan' | 'verifying' | 'approval' | 'syncing'
  | 'connected' | 'running' | 'offline' | 'error';

const artworkURL = new URL('./remote-artwork/droidex-artwork.html', document.baseURI).href;
export const pairingGuideURL = new URL('./remote-artwork/droidex-pairing-guide.svg', document.baseURI).href;

// This frame receives only enum/boolean presentation state, never a QR, model,
// prompt, credential, workspace path, or computer name.
export function PairingArtwork({ phase }: { phase: PairingArtworkPhase }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [active, setActive] = useState(() => !document.hidden);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreference = () => setReducedMotion(preference.matches);
    const onVisibility = () => setActive(!document.hidden);
    preference.addEventListener('change', onPreference);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      preference.removeEventListener('change', onPreference);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const update = useCallback(() => {
    // A sandboxed local frame has an opaque origin. The receiver also verifies
    // event.source === parent; only its exact contentWindow is targeted here.
    frame.current?.contentWindow?.postMessage(
      { type: 'droidex.artwork', phase, reducedMotion, active }, '*',
    );
  }, [phase, reducedMotion, active]);

  useEffect(update, [update]);

  return (
    <iframe
      ref={frame}
      src={artworkURL}
      onLoad={update}
      title="Illustration of DROIDEX on a computer and phone"
      aria-hidden="true"
      tabIndex={-1}
      sandbox="allow-scripts"
      className="pointer-events-none block w-full border-0"
      style={{ aspectRatio: '1000 / 660', maxHeight: 340 }}
    />
  );
}

export function desktopArtworkPhase(
  status: DesktopRemoteStatus | null,
  starting: boolean,
): PairingArtworkPhase {
  if (starting || status?.enabling) return 'verifying';
  if (!status?.enabled) return 'intro';
  if (status.pending) return 'approval';
  if (status.device) {
    if (!status.connected) return 'offline';
    if (status.sync?.state === 'loading') return 'syncing';
    return (status.running ?? 0) > 0 ? 'running' : 'connected';
  }
  return status.expired ? 'intro' : 'scan';
}
