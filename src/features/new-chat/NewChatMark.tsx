import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BrandMark } from '../../components/BrandMark';
import { ModelIcon } from '../../components/ModelIcon';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../providers/providerIdentity';
import { useNewChatLook } from './newChatLook';
import { useDraftHarness } from './useDraftHarness';

const SWAP = { duration: 0.45, ease: [0.22, 1, 0.36, 1] } as const;
const HIDDEN = { opacity: 0, scale: 0.7, filter: 'blur(6px)' };

// The mark above a new chat's greeting. Following the harness, it swaps with a
// blurred cross-fade and a small turn whenever the draft changes harness.
export function NewChatMark() {
  const { logo, logoImage } = useNewChatLook();
  const harness = useDraftHarness();
  const reduceMotion = useReducedMotion();
  if (logo === 'none') return null;

  let key: string;
  let mark: ReactNode;
  if (logo === 'custom' && logoImage) {
    key = 'custom';
    mark = <img src={logoImage} alt="Logo" className="max-h-14 max-w-44 object-contain" />;
  } else if (logo === 'wordmark') {
    key = 'wordmark';
    mark = <BrandMark size={34} className="text-accent" />;
  } else {
    key = harness;
    mark = (
      <span role="img" aria-label={PROVIDER_LABELS[harness]} className="flex">
        <ModelIcon provider={PROVIDER_MARKS[harness]} size={40} />
      </span>
    );
  }

  return (
    <div className="grid h-14 place-items-center">
      <AnimatePresence initial={false}>
        <motion.div
          key={key}
          className="col-start-1 row-start-1"
          initial={reduceMotion ? { opacity: 0 } : { ...HIDDEN, rotate: -45 }}
          animate={{ opacity: 1, scale: 1, rotate: 0, filter: 'blur(0px)' }}
          exit={reduceMotion ? { opacity: 0 } : { ...HIDDEN, rotate: 45 }}
          transition={SWAP}
        >
          {mark}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
