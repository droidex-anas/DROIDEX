import { motion, useReducedMotion } from 'framer-motion';
import { VoiceOrb } from './VoiceOrb';
import { voiceStatusLabel } from './voiceStatus';
import type { Voice } from './useVoice';

/**
 * The conversation with the chat in view: the orb floats above the composer
 * and nothing else is drawn, because the composer itself becomes the voice's
 * controls and the transcript keeps what was said. Clicking the orb goes back
 * to the full surface.
 */
export function VoiceOrbDock({ voice }: { voice: Voice }) {
  const reducedMotion = useReducedMotion();
  if (voice.view !== 'dock') return null;
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
        <VoiceOrb stream={session.micStream} size={72} />
      </button>
      <span className="text-[11px] text-droid-text-muted">
        {voiceStatusLabel(session.status, session.muted, session.micDenied, session.error)}
      </span>
    </motion.div>
  );
}
