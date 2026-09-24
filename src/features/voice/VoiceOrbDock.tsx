import { motion, useReducedMotion } from 'framer-motion';
import { VoiceOrb } from './VoiceOrb';
import { voiceStatusIsLive, voiceStatusLabel } from './voiceStatus';
import { useVoiceConversation } from './VoiceProvider';

/**
 * The conversation with the chat in view: the orb floats above the composer
 * and nothing else is drawn, because the composer itself becomes the voice's
 * controls and the transcript keeps what was said. Clicking the orb goes back
 * to the full surface.
 */
export function VoiceOrbDock() {
  const voice = useVoiceConversation();
  const reducedMotion = useReducedMotion();
  const { session } = voice;

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.9 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="pointer-events-none mb-4 flex flex-col items-center gap-1.5"
    >
      <button
        type="button"
        aria-label="Open the voice surface"
        title="Open the voice surface"
        onClick={voice.expand}
        className="pointer-events-auto rounded-full focus-visible:outline focus-visible:outline-droid-border-hover"
      >
        <VoiceOrb micStream={session.micStream} replyStream={session.replyStream} size={72} />
      </button>
      <span
        className={`text-[11px] ${
          voiceStatusIsLive(voice.activity) ? 'shimmer-text font-medium' : 'text-droid-text-muted'
        }`}
      >
        {voiceStatusLabel(voice.activity)}
      </span>
    </motion.div>
  );
}
