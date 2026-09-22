import { useCallback, useState } from 'react';
import { useMicStream } from './useMicStream';

// Off until Codex can open a realtime voice session on a ChatGPT sign-in: its
// app-server (0.154) refuses `thread/realtime/start` without API key auth. The
// orb, dock and overlay stay built so turning this on is the only change.
export const VOICE_MODE_ENABLED = false as boolean;

type VoiceView = 'off' | 'full' | 'compact';

export interface VoiceMode {
  view: VoiceView;
  muted: boolean;
  /** Epoch ms when the current voice session opened; 0 while off. */
  openedAtMs: number;
  micStream: MediaStream | null;
  micDenied: boolean;
  start: () => void;
  stop: () => void;
  showFull: () => void;
  showCompact: () => void;
  toggleMuted: () => void;
}

/**
 * Voice mode is composer-owned chrome: full-screen while talking, a dock above
 * the composer when the user wants the transcript back. The hook owns the
 * session so the microphone survives full ↔ compact switches; the surfaces
 * below only render it.
 */
export function useVoiceMode(): VoiceMode {
  const [view, setView] = useState<VoiceView>('off');
  const [muted, setMuted] = useState(false);
  const [openedAtMs, setOpenedAtMs] = useState(0);
  const mic = useMicStream(view !== 'off' && !muted);

  const start = useCallback(() => {
    setMuted(false);
    setOpenedAtMs(Date.now());
    setView('full');
  }, []);
  const stop = useCallback(() => {
    setView('off');
  }, []);
  const showFull = useCallback(() => {
    setView((current) => (current === 'off' ? current : 'full'));
  }, []);
  const showCompact = useCallback(() => {
    setView((current) => (current === 'off' ? current : 'compact'));
  }, []);
  const toggleMuted = useCallback(() => {
    setMuted((current) => !current);
  }, []);

  return {
    view,
    muted,
    openedAtMs,
    micStream: mic.stream,
    micDenied: mic.denied,
    start,
    stop,
    showFull,
    showCompact,
    toggleMuted,
  };
}

/** The single status line both voice surfaces show. */
export function voiceStatusLabel(muted: boolean, micDenied: boolean): string {
  if (muted) return 'Muted';
  if (micDenied) return 'Microphone unavailable';
  return 'Listening…';
}
