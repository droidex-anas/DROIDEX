import { useEffect, useState } from 'react';

/**
 * Owns the microphone while voice mode wants it. Tracks stop on mute, close,
 * or unmount, so the OS mic indicator never outlives the feature. Denial is a
 * state, not an error: the packaged app ships without a microphone usage
 * description (see builderConfig.test.cjs), and the browser can simply say no.
 */
// The DOM lib types mediaDevices as always present, but it is undefined in
// non-secure contexts.
function mediaDevices(): MediaDevices | undefined {
  return navigator.mediaDevices;
}

export function useMicStream(active: boolean): { stream: MediaStream | null; denied: boolean } {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!active) return;
    const devices = mediaDevices();
    if (!devices) {
      setDenied(true);
      return;
    }
    let cancelled = false;
    let acquired: MediaStream | null = null;
    devices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((next) => {
        if (cancelled) {
          for (const track of next.getTracks()) track.stop();
          return;
        }
        acquired = next;
        setStream(next);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => {
      cancelled = true;
      if (acquired) for (const track of acquired.getTracks()) track.stop();
    };
  }, [active]);

  return { stream: active ? stream : null, denied: active && denied };
}
