import { useEffect, useState } from 'react';
import { ChevronUp, Mic, MicOff, X } from 'lucide-react';
import { voiceStatusLabel, type VoiceMode } from './useVoiceMode';
import { VoiceOrb } from './VoiceOrb';

const ghostClass =
  'rounded-lg p-1.5 text-droid-text-muted transition-colors hover:bg-droid-bg/40 hover:text-droid-text';

/**
 * Compact voice surface: a dock above the composer so the transcript and tool
 * calls stay visible while voice is running.
 */
export function VoiceDock({ voice }: { voice: VoiceMode }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (voice.view !== 'compact') return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [voice.view]);

  if (voice.view !== 'compact') return null;

  return (
    <div className="mb-2 flex items-center gap-3 rounded-2xl border border-droid-border bg-droid-elevated px-3 py-2 shadow-droid motion-safe:animate-slide-up">
      <VoiceOrb stream={voice.micStream} size={34} />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] leading-tight text-droid-text">
          {voiceStatusLabel(voice.muted, voice.micDenied)}
        </div>
        <div className="text-[11px] leading-tight text-droid-text-muted">
          Voice · {elapsedLabel(nowMs - voice.openedAtMs)}
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={voice.toggleMuted}
          aria-pressed={voice.muted}
          aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
          title={voice.muted ? 'Unmute' : 'Mute'}
          className={ghostClass}
        >
          {voice.muted ? (
            <MicOff className="h-3.5 w-3.5 text-droid-red" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={voice.showFull}
          aria-label="Expand voice mode"
          title="Expand voice mode"
          className={ghostClass}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={voice.stop}
          aria-label="End voice mode"
          title="End voice mode"
          className={ghostClass}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function elapsedLabel(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}
