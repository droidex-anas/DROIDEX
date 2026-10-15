import { Mic, MicOff, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
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
      <Button
        variant="ghost"
        shape="round"
        icon={session.muted ? MicOff : Mic}
        aria-label={session.muted ? 'Unmute' : 'Mute'}
        title={session.muted ? 'Unmute' : 'Mute'}
        aria-pressed={session.muted}
        onClick={session.toggleMuted}
      />
      <Button
        variant="primary"
        shape="round"
        icon={X}
        onClick={voice.close}
        aria-label="End voice"
        title="End voice"
      />
    </div>
  );
}
