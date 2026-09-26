import { Mic, MicOff, X } from 'lucide-react';
import { useVoiceConversation } from './VoiceProvider';

/**
 * What the composer's action slot becomes while a conversation runs beside the
 * chat: mute, and hang up. Typing still works, so the draft keeps its own
 * controls and only the send button gives way.
 */
export function VoiceComposerControls() {
  const voice = useVoiceConversation();
  const { session } = voice;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={session.muted ? 'Unmute' : 'Mute'}
        title={session.muted ? 'Unmute' : 'Mute'}
        aria-pressed={session.muted}
        onClick={session.toggleMuted}
        className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${
          session.muted
            ? 'bg-droid-surface text-droid-text'
            : 'text-droid-text-muted hover:bg-droid-bg/40 hover:text-droid-text'
        }`}
      >
        {session.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      <button
        type="button"
        aria-label="End voice"
        title="End voice"
        onClick={voice.close}
        className="grid h-8 w-8 place-items-center rounded-full bg-droid-text text-droid-bg transition-opacity hover:opacity-90"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
