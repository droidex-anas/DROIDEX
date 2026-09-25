import { useEffect, useState } from 'react';

/**
 * Owns the microphone while voice mode wants it. Tracks stop on mute, close,
 * or unmount, so the OS mic indicator never outlives the feature. Denial is a
 * state, not an error: the user can refuse at the OS prompt, or the machine
 * can have no microphone, and the app says so rather than failing.
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
    // Every attempt asks again from nothing known: a refusal, or a machine with
    // no microphone at the time, must not decide the next conversation.
    setDenied(false);
    setStream(null);
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
        // A device can be unplugged or taken by another app while the call is
        // up. The conversation stops hearing anything, and saying so is the
        // difference between a silent microphone and one that looks fine.
        for (const track of next.getAudioTracks())
          track.addEventListener('ended', () => {
            if (!cancelled) setDenied(true);
          });
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
