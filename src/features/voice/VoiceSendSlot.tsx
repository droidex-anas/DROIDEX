import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { VoiceButton } from './VoiceButton';

const ON_STAGE = { y: 0, scale: 1, opacity: 1 };
const SWAP = { duration: 0.2, ease: [0.16, 1, 0.3, 1] } as const;

/**
 * Voice and send share the composer's action slot; the draft decides which is
 * on stage. Both stay mounted so the swap is transform-only, and the parked
 * one drops out of hit-testing (and, inside each button, out of focus).
 */
export default function VoiceSendSlot({
  showSend,
  onVoice,
  children,
}: {
  showSend: boolean;
  onVoice: () => void;
  /** The send button, told by the caller that it is parked while voice shows. */
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const parked = (y: number) => (reducedMotion ? { opacity: 0 } : { y, scale: 0.6, opacity: 0 });
  const transition = reducedMotion ? { duration: 0 } : SWAP;

  return (
    <div className="relative h-8 w-8 shrink-0">
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={showSend ? parked(-12) : ON_STAGE}
        transition={transition}
        style={{ pointerEvents: showSend ? 'none' : undefined }}
      >
        <VoiceButton parked={showSend} onClick={onVoice} />
      </motion.div>
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={showSend ? ON_STAGE : parked(12)}
        transition={transition}
        style={{ pointerEvents: showSend ? undefined : 'none' }}
      >
        {children}
      </motion.div>
    </div>
  );
}
